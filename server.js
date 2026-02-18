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

// Configurar multer para subida de imágenes (guardar en logos/ para GitHub)
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        // Guardar en logos/ (raíz del proyecto) para poder hacer commit a GitHub
        const uploadDir = path.join(__dirname, 'logos');
        await fs.ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
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

// Endpoint para subir logo
app.post('/api/upload-logo', upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No se proporcionó ninguna imagen'
            });
        }
        
        const filename = req.file.filename;
        console.log(`📤 Logo subido: ${filename}`);
        
        // Hacer commit y push a GitHub
        try {
            // Git add
            await execPromise(`git add logos/${filename}`, { cwd: __dirname });
            console.log(`✅ Logo agregado a git: logos/${filename}`);
            
            // Git commit
            await execPromise(`git commit -m "Agregar logo: ${filename}"`, { cwd: __dirname });
            console.log(`✅ Logo commiteado a git`);
            
            // Git push (en background para no bloquear la respuesta)
            exec(`git push origin main`, { cwd: __dirname }, (error, stdout, stderr) => {
                if (error) {
                    console.error('⚠️ Error al hacer push (se puede hacer manualmente):', error.message);
                } else {
                    console.log(`✅ Logo pusheado a GitHub: logos/${filename}`);
                }
            });
        } catch (gitError) {
            console.error('⚠️ Error en git (continuando de todas formas):', gitError.message);
            // Continuar aunque falle git, el archivo ya está guardado
        }
        
        // Construir URL de GitHub raw
        const githubRepo = process.env.GITHUB_REPO || 'Reduncle-Agency/reduncle-custom-lead';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';
        const logoUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/logos/${filename}`;
        
        console.log('✅ Logo subido correctamente:', logoUrl);
        
        res.json({
            success: true,
            url: logoUrl,
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

// Endpoint para servir logos desde la carpeta logos/
app.use('/logos', express.static(path.join(__dirname, 'logos')));

// Endpoint para crear nueva página de cliente
app.post('/api/create-client', async (req, res) => {
    console.log('📥 POST /api/create-client recibido');
    console.log('📋 Body recibido:', req.body ? 'Sí' : 'No');
    
    try {
        const { prompt, logoUrl: logoUrlFromBody } = req.body;
        console.log('📝 Prompt recibido:', prompt ? `Sí (${prompt.length} caracteres)` : 'No');
        console.log('🖼️ Logo URL recibida:', logoUrlFromBody || 'No');
        
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
        
        // Guardar HTML personalizado
        const publicDir = path.join(__dirname, 'public', 'clients');
        await fs.ensureDir(publicDir);
        await fs.writeFile(
            path.join(publicDir, `${clientId}.html`),
            personalizedHtml
        );
        
        // Construir URL con TODOS los parámetros de información del cliente y logo
        let clientUrl = `${req.protocol}://${req.get('host')}/client/${clientId}`;
        const urlParams = new URLSearchParams();
        
        if (clientInfo.nombre) {
            urlParams.append('clientName', encodeURIComponent(clientInfo.nombre));
        }
        if (clientInfo.empresa) {
            urlParams.append('clientCompany', encodeURIComponent(clientInfo.empresa));
        }
        if (clientInfo.objetivos) {
            urlParams.append('clientObjetivos', encodeURIComponent(clientInfo.objetivos));
        }
        if (clientInfo.alcance) {
            urlParams.append('clientAlcance', encodeURIComponent(clientInfo.alcance));
        }
        if (clientInfo.timeline) {
            urlParams.append('clientTimeline', encodeURIComponent(clientInfo.timeline));
        }
        if (clientInfo.equipo) {
            urlParams.append('clientEquipo', encodeURIComponent(clientInfo.equipo));
        }
        if (clientInfo.precio) {
            urlParams.append('clientPrecio', encodeURIComponent(clientInfo.precio));
        }
        if (logoUrl) {
            urlParams.append('logo', encodeURIComponent(logoUrl));
        }
        
        if (urlParams.toString()) {
            clientUrl += '?' + urlParams.toString();
        }
        
        // Log en consola (visible en Render logs)
        console.log('═══════════════════════════════════════════════════════');
        console.log('✅ CLIENTE CREADO EXITOSAMENTE');
        console.log('═══════════════════════════════════════════════════════');
        console.log('📋 ID del Cliente:', clientId);
        console.log('🔗 URL Personalizada:', clientUrl);
        console.log('📝 Prompt (primeros 200 caracteres):', promptText.substring(0, 200) + (promptText.length > 200 ? '...' : ''));
        console.log('⏰ Creado:', new Date().toISOString());
        console.log('═══════════════════════════════════════════════════════');
        
        // Guardar en archivo (persistencia básica)
        await saveClientsToFile();
        
        res.json({
            success: true,
            clientId: clientId,
            url: clientUrl,
            message: 'Cliente creado exitosamente',
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

// Servir página por defecto (template)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor
app.listen(PORT, async () => {
    // Cargar clientes existentes al iniciar
    await loadClientsFromFile();
    
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📝 Endpoint para crear cliente: POST /api/create-client`);
    console.log(`🌐 Ver cliente: GET /client/:clientId`);
    console.log(`📋 Listar clientes: GET /api/clients`);
    if (!openai) {
        console.log('⚠️  OPENAI_API_KEY no configurada. Se usará personalización básica.');
    }
});
