const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');
const multer = require('multer');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar multer para subida de imágenes (guardar en public/uploads/)
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        // Guardar en public/uploads/ para que sean accesibles públicamente
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        await fs.ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Nombre único: uuid-timestamp-originalname
        const uniqueName = `${uuidv4()}-${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

// Función para hacer commit de imagen a GitHub

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes (JPG, PNG, SVG, WEBP, GIF)'));
        }
    }
});

// Middleware
app.use(express.json({ limit: '10mb' })); // Aumentar límite para imágenes base64
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
// Servir imágenes subidas desde public/uploads/
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Headers para permitir iframes (CORS)
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Manejar preflight OPTIONS explícitamente
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Inicializar OpenAI (se configurará con variable de entorno)
let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
}

// Almacenamiento en memoria (en producción usar base de datos)
const clients = new Map();

// Almacenamiento de tokens de Shopify (shop -> token)
const shopifyTokens = new Map();

// Función para guardar clientes en archivo JSON (persistencia básica)
async function saveClientsToFile() {
    try {
        const clientsData = Array.from(clients.entries()).map(([id, client]) => ({
            id: client.id,
            prompt: client.prompt,
            createdAt: client.createdAt,
            url: client.url
        }));
        const dataPath = path.join(__dirname, 'data', 'clients.json');
        await fs.ensureDir(path.dirname(dataPath));
        await fs.writeJson(dataPath, clientsData, { spaces: 2 });
    } catch (error) {
        console.error('Error al guardar clientes:', error);
    }
}

// Cargar clientes al iniciar (si existe el archivo)
async function loadClientsFromFile() {
    try {
        const dataPath = path.join(__dirname, 'data', 'clients.json');
        if (await fs.pathExists(dataPath)) {
            const clientsData = await fs.readJson(dataPath);
            clientsData.forEach(client => {
                clients.set(client.id, {
                    id: client.id,
                    data: {},
                    prompt: client.prompt,
                    createdAt: new Date(client.createdAt),
                    url: client.url
                });
            });
            console.log(`✅ Cargados ${clients.size} clientes desde archivo`);
        }
    } catch (error) {
        console.error('Error al cargar clientes:', error);
    }
}

// Función para extraer SOLO los textos que necesitan personalización (sin HTML)
function extractTextsOnly(html) {
    const texts = [];
    
    // Función helper para extraer texto
    function extractText(pattern, tagName) {
        const regex = new RegExp(pattern, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null) {
            if (match[1]) {
                const text = match[1].trim();
                // Solo agregar si tiene contenido y no es código
                if (text.length > 0 && !text.startsWith('<') && !text.includes('function') && !text.includes('const ')) {
                    texts.push({
                        original: text,
                        tag: tagName,
                        fullMatch: match[0],
                        index: match.index
                    });
                }
            }
        }
    }
    
    // Extraer textos de diferentes etiquetas (usando [\s\S]*? para contenido multilínea)
    extractText('<h1[^>]*>([\\s\\S]*?)</h1>', 'h1');
    extractText('<h2[^>]*>([\\s\\S]*?)</h2>', 'h2');
    extractText('<h3[^>]*>([\\s\\S]*?)</h3>', 'h3');
    extractText('<p[^>]*>([\\s\\S]*?)</p>', 'p');
    extractText('<li[^>]*>([\\s\\S]*?)</li>', 'li');
    extractText('<div class="circuit-step-title">([\\s\\S]*?)</div>', 'circuit-step-title');
    extractText('<div class="circuit-step-description">([\\s\\S]*?)</div>', 'circuit-step-description');
    
    // Ordenar por posición en el HTML
    texts.sort((a, b) => a.index - b.index);
    
    return { texts };
}

// Función para reemplazar textos en el HTML original
function replaceTextsInHtml(html, personalizedTexts) {
    let result = html;
    
    // Reemplazar en orden inverso para no afectar los índices
    personalizedTexts.reverse().forEach(item => {
        // Escapar caracteres especiales del texto original
        const escapedOriginal = item.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Construir el patrón según el tag
        let openTag, closeTag;
        if (item.tag === 'h1') {
            openTag = '<h1[^>]*>';
            closeTag = '</h1>';
        } else if (item.tag === 'h2') {
            openTag = '<h2[^>]*>';
            closeTag = '</h2>';
        } else if (item.tag === 'h3') {
            openTag = '<h3[^>]*>';
            closeTag = '</h3>';
        } else if (item.tag === 'p') {
            openTag = '<p[^>]*>';
            closeTag = '</p>';
        } else if (item.tag === 'li') {
            openTag = '<li[^>]*>';
            closeTag = '</li>';
        } else if (item.tag === 'circuit-step-title') {
            openTag = '<div class="circuit-step-title">';
            closeTag = '</div>';
        } else if (item.tag === 'circuit-step-description') {
            openTag = '<div class="circuit-step-description">';
            closeTag = '</div>';
        } else {
            return; // Skip si no reconocemos el tag
        }
        
        // Crear regex que busca el texto entre las etiquetas
        const regex = new RegExp(`(${openTag})${escapedOriginal}(${closeTag})`, 'gi');
        
        // Reemplazar solo la primera ocurrencia
        result = result.replace(regex, (match, p1, p2) => {
            return `${p1}${item.personalized}${p2}`;
        });
    });
    
    return result;
}

// Función para reemplazar secciones en el HTML original
function replaceTextSections(html, personalizedSections) {
    let result = html;
    
    // Reemplazar cada sección completa (incluyendo el div.section)
    // Sección 1 (h1)
    if (personalizedSections.h1) {
        const h1Match = personalizedSections.h1.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const restContent = personalizedSections.h1.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '').trim();
        if (h1Match) {
            result = result.replace(
                /<div class="section">\s*<h1[^>]*>[\s\S]*?<\/h1>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i,
                `<div class="section">\n                <h1>${h1Match[1]}</h1>${restContent ? '\n                ' + restContent : ''}\n            </div>`
            );
        }
    }
    
    // Sección Objetivos
    if (personalizedSections.objetivos) {
        result = result.replace(
            /<div class="section">\s*<h2[^>]*>🎯 Objetivos<\/h2>[\s\S]*?<\/div>\s*(?=<div class="section">|<\/div>)/i,
            `<div class="section">\n                <h2>🎯 Objetivos</h2>\n${personalizedSections.objetivos}\n            </div>`
        );
    }
    
    // Sección Alcance
    if (personalizedSections.alcance) {
        result = result.replace(
            /<div class="section">\s*<h2[^>]*>📋 Alcance del Proyecto<\/h2>[\s\S]*?<\/div>\s*(?=<div class="section">|<\/div>)/i,
            `<div class="section">\n                <h2>📋 Alcance del Proyecto</h2>\n${personalizedSections.alcance}\n            </div>`
        );
    }
    
    // Sección Timeline
    if (personalizedSections.timeline) {
        result = result.replace(
            /<div class="section">\s*<h2[^>]*>📅 Timeline y Planificación<\/h2>[\s\S]*?<\/div>\s*(?=<div class="section">|<\/div>)/i,
            `<div class="section">\n                <h2>📅 Timeline y Planificación</h2>\n${personalizedSections.timeline}\n            </div>`
        );
    }
    
    // Sección Equipo
    if (personalizedSections.equipo) {
        result = result.replace(
            /<div class="section">\s*<h2[^>]*>👥 Con Quien Trabajamos<\/h2>[\s\S]*?<\/div>\s*(?=<div class="section">|<\/div>)/i,
            `<div class="section">\n                <h2>👥 Con Quien Trabajamos</h2>\n${personalizedSections.equipo}\n            </div>`
        );
    }
    
    // Sección Precio
    if (personalizedSections.precio) {
        result = result.replace(
            /<div class="section">\s*<h2[^>]*>💰 Inversión<\/h2>[\s\S]*?<\/div>\s*(?=<div class="section">|<\/div>)/i,
            `<div class="section">\n                <h2>💰 Inversión</h2>\n${personalizedSections.precio}\n            </div>`
        );
    }
    
    // Sección Contacto
    if (personalizedSections.contacto) {
        result = result.replace(
            /<div class="section"[^>]*>\s*<h2[^>]*>📞 Contacto<\/h2>[\s\S]*?<\/div>\s*(?=<div class="section">|<\/div>|$)/i,
            `<div class="section" style="margin-bottom: 600px !important;">\n                <h2>📞 Contacto</h2>\n${personalizedSections.contacto}\n            </div>`
        );
    }
    
    return result;
}

// Función para encontrar la última imagen en logos/
async function getLatestLogo() {
    try {
        const logosDir = path.join(__dirname, 'logos');
        if (!await fs.pathExists(logosDir)) {
            return null;
        }
        
        const files = await fs.readdir(logosDir);
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(f));
        
        if (imageFiles.length === 0) {
            return null;
        }
        
        // Ordenar por fecha de modificación (más reciente primero)
        const filesWithStats = await Promise.all(
            imageFiles.map(async (file) => {
                const filePath = path.join(logosDir, file);
                const stats = await fs.stat(filePath);
                return { file, mtime: stats.mtime };
            })
        );
        
        filesWithStats.sort((a, b) => b.mtime - a.mtime);
        const latestFile = filesWithStats[0].file;
        
        // URL de GitHub raw
        const githubRepo = process.env.GITHUB_REPO || 'Reduncle-Agency/reduncle-custom-lead';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';
        const githubUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/logos/${latestFile}`;
        
        console.log(`🖼️ Última imagen encontrada: ${latestFile}`);
        return githubUrl;
    } catch (error) {
        console.error('❌ Error al buscar última imagen:', error);
        return null;
    }
}

// Función para convertir GID de Shopify a URL de imagen
function convertShopifyGidToUrl(gid) {
    if (!gid || !gid.includes('gid://')) {
        return gid; // Si no es un GID, retornar tal cual
    }
    
    // Extraer el ID del GID
    // Formato: gid://shopify/MediaImage/123456789
    const match = gid.match(/gid:\/\/shopify\/MediaImage\/(\d+)/);
    if (!match) {
        console.warn('⚠️ Formato de GID no reconocido:', gid);
        return gid; // Retornar tal cual si no se puede convertir
    }
    
    const imageId = match[1];
    
    // Construir URL de Shopify
    // Necesitamos el shop domain, pero como no lo tenemos, retornamos el GID
    // El cliente deberá proporcionar la URL completa o el shop domain
    // Por ahora, retornamos el GID y el frontend deberá manejarlo
    console.log('📋 GID de Shopify detectado:', gid);
    console.log('💡 Para convertir a URL, se necesita el shop domain. Por ahora se usará el GID.');
    
    // Si el GID viene con shop domain en alguna variable de entorno, usarlo
    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    if (shopDomain) {
        // Construir URL de imagen de Shopify
        // Formato: https://{shop}.myshopify.com/cdn/shop/files/{filename} o similar
        // Pero necesitamos más información, así que por ahora retornamos el GID
        return gid;
    }
    
    return gid; // Retornar GID para que se maneje en el frontend o se use directamente
}

// Función para extraer información del cliente del prompt
function extractClientInfoFromPrompt(prompt) {
    const info = {
        nombre: null,
        empresa: null,
        objetivos: null,
        alcance: null,
        timeline: null,
        equipo: null,
        precio: null,
        details: null
    };
    
    if (!prompt) return info;
    
    // Función auxiliar para extraer contenido de una sección
    function extractSection(titlePattern, stopPattern) {
        const regex = new RegExp(`${titlePattern}([\\s\\S]*?)(?=${stopPattern}|$)`, 'i');
        const match = prompt.match(regex);
        if (match) {
            let content = match[1].trim();
            // Limpiar guiones iniciales y espacios
            content = content.replace(/^[-•]\s*/gm, '').trim();
            // Eliminar líneas vacías al inicio y final
            content = content.replace(/^\n+|\n+$/g, '');
            return content;
        }
        return null;
    }
    
    // Extraer información del cliente (sección especial)
    const clienteSection = extractSection('Información del cliente:', '(?:Objetivos|Alcance|Timeline|Equipo|Precio|Tono|Estilo)');
    if (clienteSection) {
        // Buscar Nombre dentro de la sección de información del cliente
        const nameMatch = clienteSection.match(/-?\s*Nombre[\s:]+([^\n\r]+)/i);
        if (nameMatch) {
            info.nombre = nameMatch[1].trim().replace(/^-\s*/, '');
        }
        
        // Buscar Empresa dentro de la sección de información del cliente
        const companyMatch = clienteSection.match(/-?\s*Empresa[\s:]+([^\n\r]+)/i);
        if (companyMatch) {
            info.empresa = companyMatch[1].trim().replace(/^-\s*/, '');
        }
    }
    
    // Si no se encontró en la sección, buscar directamente
    if (!info.nombre) {
        const nameMatch = prompt.match(/-?\s*Nombre[\s:]+([^\n\r]+)/i);
        if (nameMatch) {
            info.nombre = nameMatch[1].trim().replace(/^-\s*/, '');
        }
    }
    
    if (!info.empresa) {
        const companyMatch = prompt.match(/-?\s*Empresa[\s:]+([^\n\r]+)/i);
        if (companyMatch) {
            info.empresa = companyMatch[1].trim().replace(/^-\s*/, '');
        }
    }
    
    // Extraer Objetivos del proyecto
    info.objetivos = extractSection('Objetivos (?:del proyecto)?:', '(?:Alcance|Timeline|Equipo|Precio|Tono|Estilo)');
    if (!info.objetivos) {
        info.objetivos = extractSection('Objetivos:', '(?:Alcance|Timeline|Equipo|Precio|Tono|Estilo)');
    }
    
    // Extraer Alcance del proyecto
    info.alcance = extractSection('Alcance (?:del proyecto)?:', '(?:Timeline|Equipo|Precio|Objetivos|Tono|Estilo)');
    if (!info.alcance) {
        info.alcance = extractSection('Alcance:', '(?:Timeline|Equipo|Precio|Objetivos|Tono|Estilo)');
    }
    
    // Extraer Timeline
    info.timeline = extractSection('Timeline:', '(?:Equipo|Precio|Objetivos|Alcance|Tono|Estilo)');
    
    // Extraer Equipo
    info.equipo = extractSection('Equipo:', '(?:Precio|Objetivos|Alcance|Timeline|Tono|Estilo)');
    
    // Extraer Precio (puede tener símbolos €, $, etc.)
    const precioMatch = prompt.match(/Precio[\s:]+([^\n\r]+?)(?:\n\s*(?:Tono|Estilo|Equipo|Objetivos|Alcance|Timeline)|$)/is);
    if (precioMatch) {
        info.precio = precioMatch[1].trim().replace(/^[-•]\s*/, '');
    }
    
    // Log para debugging
    console.log('📋 Información extraída:', {
        nombre: info.nombre,
        empresa: info.empresa,
        objetivos: info.objetivos ? info.objetivos.substring(0, 50) + '...' : null,
        alcance: info.alcance ? info.alcance.substring(0, 50) + '...' : null,
        timeline: info.timeline ? info.timeline.substring(0, 50) + '...' : null,
        equipo: info.equipo ? info.equipo.substring(0, 50) + '...' : null,
        precio: info.precio
    });
    
    return info;
}

// Función para personalizar el HTML con IA (OPTIMIZADA - solo envía textos)
async function personalizeContent(clientData, templateHtml, customPrompt = null) {
    if (!openai) {
        console.warn('OpenAI no configurado, usando personalización básica');
        // Si no hay API key, usar datos directamente sin IA
        return templateHtml
            .replace(/\{\{cliente\.nombre\}\}/g, clientData.nombre || 'Cliente')
            .replace(/\{\{cliente\.empresa\}\}/g, clientData.empresa || '')
            .replace(/\{\{cliente\.objetivos\}\}/g, clientData.objetivos || '')
            .replace(/\{\{cliente\.alcance\}\}/g, clientData.alcance || '')
            .replace(/\{\{cliente\.timeline\}\}/g, clientData.timeline || '')
            .replace(/\{\{cliente\.equipo\}\}/g, clientData.equipo || '')
            .replace(/\{\{cliente\.precio\}\}/g, clientData.precio || '');
    }

    try {
        // Extraer URL de logo/imagen del prompt si está presente
        let logoUrl = null;
        if (customPrompt) {
            // Buscar URLs de imágenes en el prompt (http/https, .jpg, .png, .svg, .webp, etc.)
            const imageUrlRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|svg|webp|gif|bmp))/gi;
            const imageMatches = customPrompt.match(imageUrlRegex);
            if (imageMatches && imageMatches.length > 0) {
                logoUrl = imageMatches[0]; // Usar la primera URL de imagen encontrada
                console.log(`🖼️ Logo encontrado en prompt: ${logoUrl}`);
            }
        }
        
        console.log('📝 Extrayendo SOLO textos del HTML...');
        const { texts, placeholders } = extractTextsOnly(templateHtml);
        
        if (texts.length === 0) {
            console.warn('⚠️ No se encontraron textos para personalizar');
            return templateHtml;
        }
        
        console.log(`✅ Extraídos ${texts.length} textos (${texts.reduce((sum, t) => sum + t.original.length, 0)} caracteres totales)`);
        
        // Log de textos extraídos para debug (especialmente precio)
        const precioTexts = texts.filter(t => t.original.toLowerCase().includes('precio') || t.original.toLowerCase().includes('inversión') || t.original.toLowerCase().includes('cotización'));
        if (precioTexts.length > 0) {
            console.log(`💰 Textos relacionados con precio encontrados: ${precioTexts.length}`);
            precioTexts.forEach(t => console.log(`   - [${t.tag}] ${t.original.substring(0, 50)}...`));
        }
        
        // Crear lista de textos para enviar a ChatGPT
        const textsList = texts.map((t, i) => `${i + 1}. [${t.tag}] ${t.original}`).join('\n');
        
        // Si hay un prompt personalizado, usarlo; si no, usar el prompt por defecto
        let prompt;
        if (customPrompt) {
            let logoInstruction = '';
            if (logoUrl) {
                logoInstruction = `\n\n🖼️ LOGO DISPONIBLE:
- URL del logo: ${logoUrl}
- El logo se inyectará automáticamente en la página después de personalizar los textos
- No necesitas mencionar el logo en tu respuesta, solo personaliza los textos`;
            }
            
            prompt = `${customPrompt}${logoInstruction}

INSTRUCCIONES IMPORTANTES:
- Personaliza SOLO los textos siguientes según el prompt anterior
- Si el prompt menciona un PRECIO, INVERSIÓN, o COSTO, asegúrate de personalizar TODOS los textos relacionados con precio (incluyendo "Precio del Proyecto", "Personalizado según necesidades", "Contacta con nosotros para una cotización", etc.)
- Mantén el formato: número. [tipo] texto_personalizado
- NO cambies los números ni los tipos entre corchetes
- Devuelve SOLO la lista de textos personalizados, uno por línea, sin explicaciones

TEXTOS A PERSONALIZAR:
${textsList}`;
        } else {
            prompt = `Personaliza estos textos para el cliente:

Datos del cliente:
Nombre: ${clientData.nombre || 'Cliente'}
Empresa: ${clientData.empresa || ''}
Objetivos: ${clientData.objetivos || ''}
Alcance: ${clientData.alcance || ''}
Timeline: ${clientData.timeline || ''}
Equipo: ${clientData.equipo || ''}
Precio: ${clientData.precio || ''}

INSTRUCCIONES IMPORTANTES:
- Personaliza SOLO los textos siguientes según los datos del cliente
- Si hay un PRECIO especificado arriba (${clientData.precio || 'NO HAY PRECIO'}), asegúrate de personalizar TODOS los textos relacionados con precio:
  * "Precio del Proyecto" → usa el precio especificado
  * "Personalizado según necesidades" → reemplázalo con el precio real
  * "Contacta con nosotros para una cotización" → personalízalo según el precio
- Mantén el formato: número. [tipo] texto_personalizado
- NO cambies los números ni los tipos entre corchetes
- Devuelve SOLO la lista de textos personalizados, uno por línea, sin explicaciones

TEXTOS A PERSONALIZAR:
${textsList}`;
        }

        console.log(`🤖 Enviando ${texts.length} textos a OpenAI (${textsList.length} caracteres)...`);
        const startTime = Date.now();
        
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un experto en personalizar textos. 

IMPORTANTE:
- Personaliza TODOS los textos, especialmente los relacionados con PRECIO, INVERSIÓN, y COTIZACIÓN
- Si el prompt menciona un precio específico, úsalo en los textos relacionados con precio
- Devuelve SOLO los textos personalizados en el mismo formato que recibes (número. [tipo] texto), uno por línea, sin explicaciones
- Asegúrate de personalizar TODOS los textos, especialmente los del precio`
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 2000 // Mucho menos porque solo enviamos textos
        });
        
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️ OpenAI respondió en ${elapsedTime} segundos`);

        let personalizedTextsResponse = completion.choices[0].message.content.trim();
        
        // Parsear la respuesta de ChatGPT
        const personalizedTexts = [];
        const lines = personalizedTextsResponse.split('\n');
        
        lines.forEach((line, index) => {
            const match = line.match(/^\d+\.\s*\[([^\]]+)\]\s*(.+)$/);
            if (match && texts[index]) {
                personalizedTexts.push({
                    ...texts[index],
                    personalized: match[2].trim()
                });
            } else if (texts[index]) {
                // Si no coincide el formato, usar el texto original
                console.warn(`⚠️ No se pudo parsear línea ${index + 1}: ${line}`);
                personalizedTexts.push({
                    ...texts[index],
                    personalized: texts[index].original
                });
            }
        });
        
        console.log(`🔄 Reemplazando ${personalizedTexts.length} textos en HTML original...`);
        
        // Verificar textos de precio personalizados
        const precioPersonalizados = personalizedTexts.filter(t => 
            t.original.toLowerCase().includes('precio') || 
            t.original.toLowerCase().includes('personalizado') || 
            t.original.toLowerCase().includes('cotización') ||
            t.personalized.toLowerCase().includes('precio') ||
            t.personalized.toLowerCase().includes('€') ||
            t.personalized.toLowerCase().includes('euro')
        );
        if (precioPersonalizados.length > 0) {
            console.log(`💰 Textos de precio personalizados: ${precioPersonalizados.length}`);
            precioPersonalizados.forEach(t => console.log(`   - "${t.original.substring(0, 40)}..." → "${t.personalized.substring(0, 40)}..."`));
        }
        
        // Reemplazar textos en el HTML original
        let finalHtml = replaceTextsInHtml(templateHtml, personalizedTexts);
        
        // Inyectar logo si está disponible
        if (logoUrl) {
            console.log(`🖼️ Inyectando logo en HTML: ${logoUrl}`);
            // Buscar el elemento logo-img y actualizar su src
            const logoImgRegex = /<img id="logo-img"[^>]*src="[^"]*"/i;
            if (logoImgRegex.test(finalHtml)) {
                // Reemplazar el src vacío o existente con la URL del logo
                finalHtml = finalHtml.replace(
                    /<img id="logo-img"[^>]*src="[^"]*"/i,
                    `<img id="logo-img" src="${logoUrl}"`
                );
                // Asegurar que el logo esté visible
                finalHtml = finalHtml.replace(
                    /<img id="logo-img"[^>]*style="[^"]*"/i,
                    (match) => {
                        if (match.includes('display: none')) {
                            return match.replace('display: none', 'display: block');
                        }
                        return match;
                    }
                );
                console.log('✅ Logo inyectado correctamente en el HTML');
            } else {
                console.warn('⚠️ No se encontró el elemento logo-img en el HTML');
            }
        }
        
        // Verificar que el precio se haya reemplazado en el HTML final
        const precioEnHtml = finalHtml.match(/<h3[^>]*>([^<]*precio[^<]*)<\/h3>/i) || finalHtml.match(/<p[^>]*>([^<]*€[^<]*)<\/p>/i);
        if (precioEnHtml) {
            console.log(`✅ Precio encontrado en HTML final: "${precioEnHtml[1].substring(0, 50)}..."`);
        } else {
            console.warn(`⚠️ No se encontró precio en el HTML final. Verifica que se haya personalizado.`);
        }
        
        console.log('✅ HTML personalizado generado exitosamente');
        console.log(`📊 Tamaño del HTML final: ${finalHtml.length} caracteres`);
        
        return finalHtml;
    } catch (error) {
        console.error('Error al personalizar con IA:', error);
        // Fallback: usar reemplazo simple
        return templateHtml
            .replace(/\{\{cliente\.nombre\}\}/g, clientData.nombre || 'Cliente')
            .replace(/\{\{cliente\.empresa\}\}/g, clientData.empresa || '')
            .replace(/\{\{cliente\.objetivos\}\}/g, clientData.objetivos || '')
            .replace(/\{\{cliente\.alcance\}\}/g, clientData.alcance || '')
            .replace(/\{\{cliente\.timeline\}\}/g, clientData.timeline || '')
            .replace(/\{\{cliente\.equipo\}\}/g, clientData.equipo || '')
            .replace(/\{\{cliente\.precio\}\}/g, clientData.precio || '');
    }
}

// Endpoint para subir imagen (logo u otra imagen)
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No se proporcionó ninguna imagen'
            });
        }
        
        const filename = req.file.filename;
        const filePath = req.file.path;
        
        // Verificar que el archivo se guardó correctamente
        const fileExists = await fs.pathExists(filePath);
        if (!fileExists) {
            console.error(`❌ El archivo no se guardó correctamente: ${filePath}`);
            return res.status(500).json({
                success: false,
                error: 'Error al guardar la imagen en el servidor'
            });
        }
        
        // Obtener estadísticas del archivo
        const stats = await fs.stat(filePath);
        console.log(`📤 Imagen subida: ${filename}`);
        console.log(`📁 Guardada en: ${filePath}`);
        console.log(`📊 Tamaño: ${stats.size} bytes`);
        
        // Hacer commit y push a GitHub para persistencia
        const githubRepo = process.env.GITHUB_REPO || 'Reduncle-Agency/reduncle-custom-lead';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';
        const relativePath = `public/uploads/${filename}`;
        
        try {
            // Git add
            await execPromise(`git add ${relativePath}`, { cwd: __dirname });
            console.log(`✅ Imagen agregada a git: ${relativePath}`);
            
            // Git commit
            await execPromise(`git commit -m "Agregar imagen: ${filename}"`, { cwd: __dirname });
            console.log(`✅ Imagen commiteada a git`);
            
            // Git push (en background para no bloquear la respuesta)
            exec(`git push origin ${githubBranch}`, { cwd: __dirname }, (error, stdout, stderr) => {
                if (error) {
                    console.error('⚠️ Error al hacer push (se puede hacer manualmente):', error.message);
                } else {
                    console.log(`✅ Imagen pusheada a GitHub: ${relativePath}`);
                }
            });
        } catch (gitError) {
            console.error('⚠️ Error en git (continuando de todas formas):', gitError.message);
            // Continuar aunque falle git, el archivo ya está guardado localmente
        }
        
        // URL de GitHub (persistente para siempre)
        const githubUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${relativePath}`;
        
        // URL local de Render (funciona mientras el servicio esté activo)
        const HOST = process.env.HOST || 'https://reduncle-custom-lead.onrender.com';
        const localUrl = `${HOST}/uploads/${filename}`;
        
        console.log(`✅ Imagen disponible en GitHub: ${githubUrl}`);
        res.json({
            success: true,
            url: githubUrl, // URL de GitHub (persistente) o local (temporal)
            filename: filename,
            path: `/uploads/${filename}`,
            size: stats.size
        });
    } catch (error) {
        console.error('❌ Error al subir imagen:', error);
        console.error('❌ Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint legacy para compatibilidad (acepta 'logo' como campo)
app.post('/api/upload-logo', upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No se proporcionó ninguna imagen'
            });
        }
        
        const filename = req.file.filename;
        const filePath = req.file.path;
        
        // Verificar que el archivo se guardó correctamente
        const fileExists = await fs.pathExists(filePath);
        if (!fileExists) {
            return res.status(500).json({
                success: false,
                error: 'Error al guardar la imagen en el servidor'
            });
        }
        
        const stats = await fs.stat(filePath);
        console.log(`📤 Logo subido: ${filename}`);
        console.log(`📁 Guardada en: ${filePath}`);
        
        // Subir a GitHub usando la API
        const githubRepo = process.env.GITHUB_REPO || 'Reduncle-Agency/reduncle-custom-lead';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';
        const githubToken = process.env.GITHUB_TOKEN;
        const relativePath = `public/uploads/${filename}`;
        
        let githubUrl = null;
        
        if (githubToken) {
            try {
                // Leer el archivo como base64
                const fileContent = await fs.readFile(filePath);
                const base64Content = fileContent.toString('base64');
                
                // Obtener el SHA del archivo si existe (para actualizar) o null (para crear)
                let fileSha = null;
                try {
                    const getFileUrl = `https://api.github.com/repos/${githubRepo}/contents/${relativePath}`;
                    const getFileResponse = await fetch(getFileUrl, {
                        headers: {
                            'Authorization': `token ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    
                    if (getFileResponse.ok) {
                        const fileData = await getFileResponse.json();
                        fileSha = fileData.sha;
                        console.log(`📄 Archivo existe en GitHub, SHA: ${fileSha}`);
                    }
                } catch (getError) {
                    // El archivo no existe, se creará nuevo
                    console.log(`📄 Archivo nuevo, se creará en GitHub`);
                }
                
                // Subir/actualizar el archivo en GitHub
                const uploadUrl = `https://api.github.com/repos/${githubRepo}/contents/${relativePath}`;
                const uploadData = {
                    message: `Agregar logo: ${filename}`,
                    content: base64Content,
                    branch: githubBranch
                };
                
                if (fileSha) {
                    uploadData.sha = fileSha;
                }
                
                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(uploadData)
                });
                
                if (uploadResponse.ok) {
                    const result = await uploadResponse.json();
                    githubUrl = result.content.html_url.replace('/blob/', '/raw/');
                    console.log(`✅ Logo subido a GitHub: ${githubUrl}`);
                } else {
                    const errorText = await uploadResponse.text();
                    console.error('❌ Error al subir a GitHub:', uploadResponse.status, errorText);
                }
            } catch (githubError) {
                console.error('⚠️ Error al subir a GitHub (continuando de todas formas):', githubError.message);
            }
        } else {
            console.log('⚠️ GITHUB_TOKEN no configurado, la imagen solo estará disponible localmente');
        }
        
        // Si no se pudo subir a GitHub, usar URL local
        if (!githubUrl) {
            const HOST = process.env.HOST || 'https://reduncle-custom-lead.onrender.com';
            githubUrl = `${HOST}/uploads/${filename}`;
            console.log(`⚠️ Usando URL local (temporal): ${githubUrl}`);
        }
        
        console.log(`✅ Logo disponible en GitHub: ${githubUrl}`);
        
        res.json({
            success: true,
            url: githubUrl, // URL de GitHub (persistente)
            filename: filename
        });
    } catch (error) {
        console.error('❌ Error al subir logo:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para crear nueva página de cliente
app.post('/api/create-client', async (req, res) => {
    console.log('📥 POST /api/create-client recibido');
    console.log('📋 Body recibido:', req.body ? 'Sí' : 'No');
    
    try {
        const { clientName, prompt, logoUrl: logoUrlFromBody } = req.body;
        console.log('👤 Nombre del cliente recibido:', clientName || 'No');
        console.log('📝 Prompt recibido:', prompt ? `Sí (${prompt.length} caracteres)` : 'No');
        console.log('🖼️ Logo URL recibida:', logoUrlFromBody || 'No');
        
        if (!clientName || !clientName.trim()) {
            console.log('❌ Error: Nombre del cliente vacío');
            return res.status(400).json({
                success: false,
                error: 'El nombre del cliente es requerido'
            });
        }
        
        if (!prompt || !prompt.trim()) {
            console.log('❌ Error: Prompt vacío');
            return res.status(400).json({
                success: false,
                error: 'El prompt es requerido'
            });
        }
        
        const promptText = prompt.trim();
        console.log('🔄 Iniciando personalización con IA...');
        
        // Generar ID único para el cliente
        const clientId = uuidv4();
        
        // Leer template HTML
        const templatePath = path.join(__dirname, 'index.html');
        const templateHtml = await fs.readFile(templatePath, 'utf-8');
        
        // Extraer información del cliente del prompt
        const clientInfo = extractClientInfoFromPrompt(promptText);
        console.log('📋 Información del cliente extraída:', clientInfo);
        
        // Obtener logo del cliente (prioridad: logoUrl del body > extraer del prompt)
        let logoUrl = logoUrlFromBody || null;
        
        if (!logoUrl) {
            // Intentar extraer del prompt como fallback
            const logoUrlMatch = promptText.match(/Logo de la empresa:\s*(https?:\/\/[^\s\n]+)/i);
            if (logoUrlMatch) {
                logoUrl = logoUrlMatch[1];
                console.log('🖼️ Logo encontrado en prompt:', logoUrl);
            } else {
                console.log('ℹ️ No se encontró logo para este cliente');
            }
        } else {
            // Convertir GID de Shopify a URL si es necesario
            if (logoUrl.includes('gid://')) {
                logoUrl = convertShopifyGidToUrl(logoUrl);
                console.log('🖼️ Logo GID procesado:', logoUrl);
            } else {
                console.log('🖼️ Logo recibido desde formulario:', logoUrl);
            }
        }
        
        // Personalizar contenido con IA usando solo el prompt
        const personalizedHtml = await personalizeContent({}, templateHtml, promptText);
        
        // Guardar datos del cliente
        clients.set(clientId, {
            id: clientId,
            data: {},
            prompt: promptText,
            clientInfo: clientInfo,
            logoUrl: logoUrl, // URL del logo (puede ser de Shopify o de GitHub)
            createdAt: new Date(),
            url: `/client/${clientId}`
        });
        
        // Guardar HTML personalizado localmente (backup)
        const publicDir = path.join(__dirname, 'public', 'clients');
        await fs.ensureDir(publicDir);
        await fs.writeFile(
            path.join(publicDir, `${clientId}.html`),
            personalizedHtml
        );
        
        // Guardar en GitHub en carpeta del cliente
        const sanitizedClientName = clientName.trim().replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const githubFolderPath = `public/clientes/${sanitizedClientName}`;
        const githubHtmlPath = `${githubFolderPath}/index.html`;
        const githubLogoPath = logoUrl ? `${githubFolderPath}/logo${path.extname(new URL(logoUrl).pathname).split('?')[0] || '.png'}` : null;
        const githubReadmePath = `${githubFolderPath}/README.md`;
        
        // INYECTAR información del cliente en el HTML antes de guardar en GitHub
        let htmlToSave = personalizedHtml;
        
        // Inyectar información del cliente en el HTML (igual que en /client/:clientId)
        if (clientInfo.nombre) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-name-text"[^>]*><\/p>/i,
                `<p style="font-size: 32px; font-weight: 800; color: #ff0000; margin-bottom: 8px; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);" id="client-name-text">${clientInfo.nombre}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-name-section" style="display: none;[^"]*">/i,
                '<div id="client-name-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.empresa) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-company-text"[^>]*><\/p>/i,
                `<p style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;" id="client-company-text">${clientInfo.empresa}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-company-section" style="display: none;[^"]*">/i,
                '<div id="client-company-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.objetivos) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-objetivos-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-objetivos-text">${clientInfo.objetivos}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-objetivos-section" style="display: none;[^"]*">/i,
                '<div id="client-objetivos-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.alcance) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-alcance-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-alcance-text">${clientInfo.alcance}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-alcance-section" style="display: none;[^"]*">/i,
                '<div id="client-alcance-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.timeline) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-timeline-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-timeline-text">${clientInfo.timeline}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-timeline-section" style="display: none;[^"]*">/i,
                '<div id="client-timeline-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.equipo) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-equipo-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-equipo-text">${clientInfo.equipo}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-equipo-section" style="display: none;[^"]*">/i,
                '<div id="client-equipo-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.precio) {
            htmlToSave = htmlToSave.replace(
                /<p[^>]*id="client-precio-text"[^>]*><\/p>/i,
                `<p style="font-size: 20px; font-weight: 700; color: #ff0000; line-height: 1.7; margin-left: 20px;" id="client-precio-text">${clientInfo.precio}</p>`
            );
            htmlToSave = htmlToSave.replace(
                /<div id="client-precio-section" style="display: none;[^"]*">/i,
                '<div id="client-precio-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        
        // Inyectar logo si está disponible
        if (logoUrl) {
            htmlToSave = htmlToSave.replace(
                /<img id="logo-img"[^>]*src="[^"]*"/i,
                `<img id="logo-img" src="${logoUrl}"`
            );
            htmlToSave = htmlToSave.replace(
                /<img id="logo-img"[^>]*style="[^"]*"/i,
                (match) => {
                    if (match.includes('display: none')) {
                        return match.replace('display: none', 'display: block');
                    }
                    return match;
                }
            );
        }
        
        console.log('✅ Información del cliente inyectada en HTML para GitHub');
        
        let githubUrl = null;
        const githubToken = process.env.GITHUB_TOKEN;
        const githubRepo = process.env.GITHUB_REPO || 'Reduncle-Agency/reduncle-custom-lead';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';
        
        console.log('🔍 Verificando GITHUB_TOKEN:', githubToken ? '✅ Configurado' : '❌ NO configurado');
        console.log('📁 Carpeta del cliente en GitHub:', githubFolderPath);
        console.log('📄 Ruta HTML en GitHub:', githubHtmlPath);
        
        if (githubToken) {
            try {
                // 1. Guardar el HTML (index.html) con información del cliente inyectada
                console.log('📤 Subiendo HTML a GitHub...');
                const htmlBase64 = Buffer.from(htmlToSave, 'utf-8').toString('base64');
                let htmlSha = null;
                
                try {
                    const getHtmlUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubHtmlPath}`;
                    console.log('🔍 Verificando si existe HTML en GitHub:', getHtmlUrl);
                    const getHtmlResponse = await fetch(getHtmlUrl, {
                        headers: {
                            'Authorization': `token ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    if (getHtmlResponse.ok) {
                        const fileData = await getHtmlResponse.json();
                        htmlSha = fileData.sha;
                        console.log('📝 HTML existente encontrado, SHA:', htmlSha.substring(0, 10) + '...');
                    } else {
                        console.log('📝 HTML no existe aún, se creará nuevo');
                    }
                } catch (e) {
                    console.log('📝 HTML no existe aún (error esperado):', e.message);
                }
                
                const uploadHtmlUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubHtmlPath}`;
                const uploadHtmlData = {
                    message: `Crear/actualizar página HTML para cliente: ${clientName}`,
                    content: htmlBase64,
                    branch: githubBranch
                };
                if (htmlSha) uploadHtmlData.sha = htmlSha;
                
                console.log('📤 Subiendo HTML a:', uploadHtmlUrl);
                const htmlResponse = await fetch(uploadHtmlUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(uploadHtmlData)
                });
                
                if (htmlResponse.ok) {
                    const htmlResult = await htmlResponse.json();
                    console.log(`✅ HTML guardado en GitHub: ${githubHtmlPath}`);
                    console.log(`✅ Commit SHA: ${htmlResult.commit.sha.substring(0, 10)}...`);
                } else {
                    const errorText = await htmlResponse.text();
                    console.error('❌ Error al guardar HTML:', htmlResponse.status, htmlResponse.statusText);
                    console.error('❌ Detalles:', errorText);
                }
                
                // 2. Guardar el logo en la carpeta del cliente (si existe)
                if (logoUrl && githubLogoPath) {
                    try {
                        // Descargar el logo desde la URL
                        const logoResponse = await fetch(logoUrl);
                        if (logoResponse.ok) {
                            const logoBuffer = await logoResponse.arrayBuffer();
                            const logoBase64 = Buffer.from(logoBuffer).toString('base64');
                            
                            let logoSha = null;
                            try {
                                const getLogoUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubLogoPath}`;
                                const getLogoResponse = await fetch(getLogoUrl, {
                                    headers: {
                                        'Authorization': `token ${githubToken}`,
                                        'Accept': 'application/vnd.github.v3+json'
                                    }
                                });
                                if (getLogoResponse.ok) {
                                    const fileData = await getLogoResponse.json();
                                    logoSha = fileData.sha;
                                }
                            } catch (e) {}
                            
                            const uploadLogoUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubLogoPath}`;
                            const uploadLogoData = {
                                message: `Guardar logo para cliente: ${clientName}`,
                                content: logoBase64,
                                branch: githubBranch
                            };
                            if (logoSha) uploadLogoData.sha = logoSha;
                            
                            const logoUploadResponse = await fetch(uploadLogoUrl, {
                                method: 'PUT',
                                headers: {
                                    'Authorization': `token ${githubToken}`,
                                    'Accept': 'application/vnd.github.v3+json',
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(uploadLogoData)
                            });
                            
                            
                            if (logoUploadResponse.ok) {
                                console.log(`✅ Logo guardado en GitHub: ${githubLogoPath}`);
                            }
                        }
                    } catch (logoError) {
                        console.error('⚠️ Error al guardar logo:', logoError.message);
                    }
                }
                
                // 3. Crear README.md con el enlace permanente
                const permanentUrl = `${req.protocol}://${req.get('host')}/github-page/${sanitizedClientName}`;
                const readmeContent = `# Página Personalizada - ${clientName}

## 📋 Información del Cliente
- **Nombre:** ${clientInfo.nombre || clientName}
- **Empresa:** ${clientInfo.empresa || 'N/A'}
- **Creado:** ${new Date().toLocaleString('es-ES')}

## 🔗 Enlace Permanente
**URL:** ${permanentUrl}

Este enlace es **permanente** y no caduca. La página está guardada en GitHub y siempre estará disponible.

## 📁 Archivos
- \`index.html\` - Página personalizada completa
${logoUrl ? `- \`logo${path.extname(new URL(logoUrl).pathname).split('?')[0] || '.png'}\` - Logo del cliente` : '- Sin logo'}

## 📝 Notas
${clientInfo.objetivos ? `**Objetivos:** ${clientInfo.objetivos}\n` : ''}${clientInfo.alcance ? `**Alcance:** ${clientInfo.alcance}\n` : ''}${clientInfo.precio ? `**Precio:** ${clientInfo.precio}\n` : ''}
`;
                
                const readmeBase64 = Buffer.from(readmeContent, 'utf-8').toString('base64');
                let readmeSha = null;
                
                try {
                    const getReadmeUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubReadmePath}`;
                    const getReadmeResponse = await fetch(getReadmeUrl, {
                        headers: {
                            'Authorization': `token ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    if (getReadmeResponse.ok) {
                        const fileData = await getReadmeResponse.json();
                        readmeSha = fileData.sha;
                    }
                } catch (e) {}
                
                const uploadReadmeUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubReadmePath}`;
                const uploadReadmeData = {
                    message: `Crear/actualizar README para cliente: ${clientName}`,
                    content: readmeBase64,
                    branch: githubBranch
                };
                if (readmeSha) uploadReadmeData.sha = readmeSha;
                
                console.log('📤 Subiendo README a GitHub...');
                const readmeResponse = await fetch(uploadReadmeUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(uploadReadmeData)
                });
                
                if (readmeResponse.ok) {
                    const readmeResult = await readmeResponse.json();
                    console.log(`✅ README guardado en GitHub: ${githubReadmePath}`);
                    console.log(`✅ Commit SHA: ${readmeResult.commit.sha.substring(0, 10)}...`);
                } else {
                    const errorText = await readmeResponse.text();
                    console.error('❌ Error al guardar README:', readmeResponse.status, readmeResponse.statusText);
                    console.error('❌ Detalles:', errorText);
                }
                
                // URL permanente - solo si el HTML se guardó correctamente
                const htmlResponseCheck = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${githubHtmlPath}`, {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                if (htmlResponseCheck.ok) {
                    githubUrl = permanentUrl;
                    console.log(`✅ Carpeta del cliente creada en GitHub: ${githubFolderPath}`);
                    console.log(`🌐 URL permanente: ${githubUrl}`);
                } else {
                    console.error('⚠️ El HTML no se guardó correctamente, no se puede crear URL permanente');
                }
                
            } catch (githubError) {
                console.error('⚠️ Error al guardar en GitHub (continuando de todas formas):', githubError.message);
                console.error('⚠️ Stack:', githubError.stack);
            }
        } else {
            console.log('⚠️ GITHUB_TOKEN no configurado, la página solo estará disponible localmente');
        }
        
        // Construir URL: prioridad GitHub (persistente), luego local (temporal)
        let clientUrl = githubUrl || `${req.protocol}://${req.get('host')}/client/${clientId}`;
        
        // Log en consola (visible en Render logs)
        console.log('═══════════════════════════════════════════════════════');
        console.log('✅ CLIENTE CREADO EXITOSAMENTE');
        console.log('═══════════════════════════════════════════════════════');
        console.log('👤 Nombre del Cliente:', clientName);
        console.log('📋 ID del Cliente:', clientId);
        console.log('📁 Carpeta en GitHub:', githubFolderPath);
        console.log('🔗 URL Personalizada (GitHub):', githubUrl || 'No se guardó en GitHub');
        console.log('🔗 URL Local (Render):', `${req.protocol}://${req.get('host')}/client/${clientId}`);
        console.log('🔗 URL Final Devuelta:', clientUrl);
        console.log('📝 Prompt (primeros 200 caracteres):', promptText.substring(0, 200) + (promptText.length > 200 ? '...' : ''));
        console.log('⏰ Creado:', new Date().toISOString());
        console.log('═══════════════════════════════════════════════════════');
        
        // Guardar en archivo (persistencia básica)
        await saveClientsToFile();
        
        res.json({
            success: true,
            clientId: clientId,
            url: clientUrl, // URL permanente (GitHub) o temporal (Render)
            permanentUrl: githubUrl || null, // URL permanente si se guardó en GitHub
            temporaryUrl: githubUrl ? null : `${req.protocol}://${req.get('host')}/client/${clientId}`, // URL temporal solo si no hay permanente
            message: githubUrl ? 'Cliente creado exitosamente. Página guardada permanentemente en GitHub.' : 'Cliente creado exitosamente. Página disponible temporalmente en Render.',
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para servir página desde GitHub por nombre de cliente
app.get('/github-page/:clientName', async (req, res) => {
    try {
        const { clientName } = req.params;
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const githubRepo = process.env.GITHUB_REPO || 'Reduncle-Agency/reduncle-custom-lead';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';
        const githubFilePath = `public/clientes/${sanitizedClientName}/index.html`;
        
        // Obtener el HTML desde GitHub
        const githubRawUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${githubFilePath}`;
        
        try {
            const response = await fetch(githubRawUrl);
            if (response.ok) {
                const html = await response.text();
                res.setHeader('Content-Type', 'text/html');
                res.send(html);
            } else {
                res.status(404).send('Página no encontrada en GitHub');
            }
        } catch (error) {
            console.error('Error al obtener página desde GitHub:', error);
            res.status(500).send('Error al cargar la página desde GitHub');
        }
    } catch (error) {
        console.error('Error en /github-page:', error);
        res.status(500).send('Error del servidor');
    }
});

// Endpoint para servir página personalizada del cliente
app.get('/client/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const client = clients.get(clientId);
        
        if (!client) {
            return res.status(404).send('Cliente no encontrado');
        }
        
        // Intentar leer HTML personalizado del caché
        const cachedPath = path.join(__dirname, 'public', 'clients', `${clientId}.html`);
        
        let html;
        if (await fs.pathExists(cachedPath)) {
            html = await fs.readFile(cachedPath, 'utf-8');
        } else {
            // Si no existe caché, generar de nuevo
            const templatePath = path.join(__dirname, 'index.html');
            const templateHtml = await fs.readFile(templatePath, 'utf-8');
            html = await personalizeContent(client.data, templateHtml, client.prompt);
        }
        
        // Inyectar información del cliente en el HTML
        const clientInfo = client.clientInfo || extractClientInfoFromPrompt(client.prompt);
        
        // Obtener logo específico de este cliente
        let logoUrl = client.logoUrl || null;
        
        if (!logoUrl) {
            // Intentar extraer del prompt como fallback
            const logoUrlMatch = client.prompt.match(/Logo de la empresa:\s*(https?:\/\/[^\s\n]+)/i);
            if (logoUrlMatch) {
                logoUrl = logoUrlMatch[1];
                console.log(`🖼️ Logo extraído del prompt: ${logoUrl}`);
            }
        } else {
            console.log(`🖼️ Usando logoUrl guardado: ${logoUrl}`);
        }
        
        // Inyectar TODA la información del cliente dentro de la sección "Nuestro Proyecto"
        if (clientInfo.nombre) {
            html = html.replace(
                /<p[^>]*id="client-name-text"[^>]*><\/p>/i,
                `<p style="font-size: 32px; font-weight: 800; color: #ff0000; margin-bottom: 8px; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);" id="client-name-text">${clientInfo.nombre}</p>`
            );
            html = html.replace(
                /<div id="client-name-section" style="display: none;[^"]*">/i,
                '<div id="client-name-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.empresa) {
            html = html.replace(
                /<p[^>]*id="client-company-text"[^>]*><\/p>/i,
                `<p style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;" id="client-company-text">${clientInfo.empresa}</p>`
            );
            html = html.replace(
                /<div id="client-company-section" style="display: none;[^"]*">/i,
                '<div id="client-company-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.objetivos) {
            html = html.replace(
                /<p[^>]*id="client-objetivos-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-objetivos-text">${clientInfo.objetivos}</p>`
            );
            html = html.replace(
                /<div id="client-objetivos-section" style="display: none;[^"]*">/i,
                '<div id="client-objetivos-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.alcance) {
            html = html.replace(
                /<p[^>]*id="client-alcance-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-alcance-text">${clientInfo.alcance}</p>`
            );
            html = html.replace(
                /<div id="client-alcance-section" style="display: none;[^"]*">/i,
                '<div id="client-alcance-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.timeline) {
            html = html.replace(
                /<p[^>]*id="client-timeline-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-timeline-text">${clientInfo.timeline}</p>`
            );
            html = html.replace(
                /<div id="client-timeline-section" style="display: none;[^"]*">/i,
                '<div id="client-timeline-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.equipo) {
            html = html.replace(
                /<p[^>]*id="client-equipo-text"[^>]*><\/p>/i,
                `<p style="font-size: 17px; color: #555; line-height: 1.7; margin-left: 20px;" id="client-equipo-text">${clientInfo.equipo}</p>`
            );
            html = html.replace(
                /<div id="client-equipo-section" style="display: none;[^"]*">/i,
                '<div id="client-equipo-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        if (clientInfo.precio) {
            html = html.replace(
                /<p[^>]*id="client-precio-text"[^>]*><\/p>/i,
                `<p style="font-size: 20px; font-weight: 700; color: #ff0000; line-height: 1.7; margin-left: 20px;" id="client-precio-text">${clientInfo.precio}</p>`
            );
            html = html.replace(
                /<div id="client-precio-section" style="display: none;[^"]*">/i,
                '<div id="client-precio-section" style="display: block; margin-bottom: 16px;">'
            );
        }
        
        // Inyectar logo si está disponible
        if (logoUrl) {
            html = html.replace(
                /<img id="logo-img"[^>]*src="[^"]*"/i,
                `<img id="logo-img" src="${logoUrl}"`
            );
            html = html.replace(
                /<img id="logo-img"[^>]*style="[^"]*"/i,
                (match) => {
                    if (match.includes('display: none')) {
                        return match.replace('display: none', 'display: block');
                    }
                    return match;
                }
            );
        }
        
        res.send(html);
    } catch (error) {
        console.error('Error al servir página del cliente:', error);
        res.status(500).send('Error al cargar la página');
    }
});

// Endpoint para obtener datos del cliente
app.get('/api/client/:clientId', (req, res) => {
    const { clientId } = req.params;
    const client = clients.get(clientId);
    
    if (!client) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    res.json(client);
});

// Endpoint para recibir token de Shopify cuando se instala la app
app.post('/api/shopify/token', (req, res) => {
    try {
        console.log(`📥 POST /api/shopify/token recibido`);
        console.log(`📦 Body recibido:`, JSON.stringify(req.body));
        
        const { shop, accessToken, scope } = req.body;
        
        if (!shop || !accessToken) {
            console.error(`❌ Faltan datos: shop=${shop}, accessToken=${accessToken ? 'presente' : 'ausente'}`);
            return res.status(400).json({ error: 'Faltan shop o accessToken' });
        }
        
        // Guardar token asociado a la tienda
        shopifyTokens.set(shop, {
            accessToken,
            scope: scope || '',
            receivedAt: new Date().toISOString(),
        });
        
        console.log(`✅ Token recibido y guardado para tienda: ${shop}`);
        console.log(`📝 Token (primeros 20 chars): ${accessToken.substring(0, 20)}...`);
        console.log(`📊 Total de tokens guardados: ${shopifyTokens.size}`);
        
        res.json({ 
            success: true, 
            message: `Token guardado para ${shop}`,
            shop,
        });
    } catch (error) {
        console.error('❌ Error al guardar token:', error);
        console.error('❌ Stack:', error.stack);
        res.status(500).json({ error: 'Error al guardar token', details: error.message });
    }
});

// Endpoint para obtener token de una tienda
app.get('/api/shopify/token/:shop', (req, res) => {
    const { shop } = req.params;
    console.log(`🔍 GET /api/shopify/token/${shop} solicitado`);
    console.log(`📊 Tokens disponibles: ${Array.from(shopifyTokens.keys()).join(', ')}`);
    
    const tokenData = shopifyTokens.get(shop);
    
    if (!tokenData) {
        console.log(`❌ No se encontró token para ${shop}`);
        return res.status(404).json({ error: `No se encontró token para ${shop}` });
    }
    
    console.log(`✅ Token encontrado para ${shop}`);
    res.json({
        shop,
        accessToken: tokenData.accessToken,
        scope: tokenData.scope,
        receivedAt: tokenData.receivedAt,
    });
});

// Endpoint para listar todas las tiendas con tokens
app.get('/api/shopify/tokens', (req, res) => {
    const tokens = Array.from(shopifyTokens.entries()).map(([shop, data]) => ({
        shop,
        scope: data.scope,
        receivedAt: data.receivedAt,
        tokenPreview: data.accessToken.substring(0, 20) + '...',
    }));
    
    res.json({ tokens });
});

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Panel de administración
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// RUTAS OAUTH PARA OBTENER TOKEN DE SHOPIFY
// ============================================

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || process.env.CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || process.env.CLIENT_SECRET;
const HOST_URL = process.env.HOST || 'https://reduncle-custom-lead.onrender.com';
const REDIRECT_URI = `${HOST_URL}/callback`;

// Endpoint de prueba
app.get('/test-oauth', (req, res) => {
    res.send(`
        <h1>🔑 OAuth Token Sender</h1>
        <p>Para obtener el token permanente, haz clic en el botón:</p>
        <a href="/auth?shop=red-uncle-agency.myshopify.com" style="display: inline-block; padding: 15px 30px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 18px;">
            🚀 Obtener Token Permanente
        </a>
        <hr>
        <p><strong>O visita directamente:</strong></p>
        <code>https://reduncle-custom-lead.onrender.com/auth?shop=red-uncle-agency.myshopify.com</code>
    `);
});

// Endpoint 1: Iniciar OAuth (llamado automáticamente cuando se instala la app)
app.get('/auth', (req, res) => {
    console.log('========================================');
    console.log('📥 GET /auth recibido');
    console.log('Query params:', JSON.stringify(req.query));
    console.log('CLIENT_ID configurado:', SHOPIFY_CLIENT_ID ? 'SÍ' : 'NO');
    console.log('CLIENT_SECRET configurado:', SHOPIFY_CLIENT_SECRET ? 'SÍ' : 'NO');
    console.log('========================================');
    
    // Shopify puede pasar el shop como query param
    let shop = req.query.shop;
    
    // Si no viene en query, intentar extraer del host o de otros lugares
    if (!shop) {
        // Shopify a veces pasa el shop en el header o en el referer
        const referer = req.get('referer') || '';
        const shopMatch = referer.match(/https?:\/\/([^.]+\.myshopify\.com)/);
        if (shopMatch) {
            shop = shopMatch[1];
        }
    }
    
    // Si viene desde el enlace de instalación de custom app, extraer del signature
    if (!shop && req.query.signature) {
        // El signature contiene el permanent_domain, pero necesitamos parsearlo
        // Por ahora, requerimos que venga el shop como query param
    }
    
    if (!shop) {
        return res.status(400).send(`
            <h1>Missing shop parameter</h1>
            <p>Use: <a href="/auth?shop=tu-tienda.myshopify.com">/auth?shop=tu-tienda.myshopify.com</a></p>
            <p>O configura la App URL en Shopify Partners Dashboard para que redirija automáticamente.</p>
        `);
    }
    
    if (!SHOPIFY_CLIENT_ID) {
        console.error('❌ CLIENT_ID no configurado');
        return res.status(500).send('CLIENT_ID not configured. Verifica las variables de entorno en Render.');
    }
    
    console.log(`🚀 Iniciando OAuth para shop: ${shop}`);
    console.log(`🔑 CLIENT_ID: ${SHOPIFY_CLIENT_ID.substring(0, 10)}...`);
    
    const authUrl = `https://${shop}/admin/oauth/authorize?` +
        `client_id=${SHOPIFY_CLIENT_ID}&` +
        `scope=read_products,write_products&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    
    console.log(`📤 Redirigiendo a: ${authUrl}`);
    console.log(`📍 REDIRECT_URI: ${REDIRECT_URI}`);
    
    res.redirect(authUrl);
});

// Endpoint 2: Callback OAuth
app.get('/callback', async (req, res) => {
    const { shop, code } = req.query;
    
    console.log('========================================');
    console.log('📥 CALLBACK RECIBIDO');
    console.log('Shop:', shop);
    console.log('Code:', code ? 'presente' : 'ausente');
    console.log('========================================');
    
    if (!shop || !code) {
        console.error('❌ Faltan shop o code');
        return res.status(400).send('Missing shop or code');
    }
    
    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
        console.error('❌ CLIENT_ID o CLIENT_SECRET no configurados');
        return res.status(500).send('CLIENT_ID or CLIENT_SECRET not configured');
    }
    
    try {
        console.log(`🔄 Intercambiando code por token en: https://${shop}/admin/oauth/access_token`);
        
        const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: SHOPIFY_CLIENT_ID,
                client_secret: SHOPIFY_CLIENT_SECRET,
                code: code
            })
        });
        
        const data = await response.json();
        console.log('📦 Respuesta de Shopify:', JSON.stringify(data));
        
        if (data.access_token) {
            console.log('========================================');
            console.log('✅ ACCESS TOKEN PERMANENTE OBTENIDO:');
            console.log(data.access_token);
            console.log('Shop:', shop);
            console.log('Scope:', data.scope);
            console.log('========================================');
            
            // Enviar token al proxy (mismo servidor)
            console.log(`📤 Enviando token al proxy: ${HOST_URL}/api/shopify/token`);
            try {
                const proxyResponse = await fetch(`${HOST_URL}/api/shopify/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        shop: shop,
                        accessToken: data.access_token,
                        scope: data.scope || 'read_products,write_products'
                    })
                });
                
                const proxyData = await proxyResponse.json();
                console.log('📥 Respuesta del proxy:', JSON.stringify(proxyData));
                
                if (proxyResponse.ok) {
                    console.log('✅✅✅ Token enviado al proxy exitosamente ✅✅✅');
                } else {
                    console.error('❌ Error al enviar token al proxy:', proxyData);
                }
            } catch (error) {
                console.error('❌ Error al enviar token al proxy:', error.message);
                console.error('❌ Stack:', error.stack);
            }
        } else {
            console.error('❌ Error obteniendo token de Shopify:', data);
        }
        
        res.send('OK - Token obtenido y enviado al proxy. Revisa los logs de Render.');
    } catch (error) {
        console.error('❌ Error completo:', error);
        console.error('❌ Stack:', error.stack);
        res.status(500).send('Error');
    }
});

// Servir página por defecto (template)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor
app.listen(PORT, async () => {
    // Cargar clientes existentes al iniciar
    await loadClientsFromFile();
    
    // Crear directorio de uploads si no existe
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    await fs.ensureDir(uploadsDir);
    console.log(`📁 Directorio de uploads: ${uploadsDir}`);
    
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📝 Endpoint para crear cliente: POST /api/create-client`);
    console.log(`🌐 Ver cliente: GET /client/:clientId`);
    console.log(`📋 Listar clientes: GET /api/clients`);
    console.log(`🖼️  Subir imagen: POST /api/upload-image o POST /api/upload-logo`);
    console.log(`📂 Imágenes accesibles en: https://reduncle-custom-lead.onrender.com/uploads/`);
    if (!openai) {
        console.log('⚠️  OPENAI_API_KEY no configurada. Se usará personalización básica.');
    }
});
