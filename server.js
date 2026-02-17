const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar multer para subida de imágenes
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'logos');
        await fs.ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

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
app.use(express.json());
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
        
        const logoUrl = `${req.protocol}://${req.get('host')}/logos/${req.file.filename}`;
        
        console.log('✅ Logo subido:', logoUrl);
        
        res.json({
            success: true,
            url: logoUrl,
            filename: req.file.filename
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
        const { prompt } = req.body;
        console.log('📝 Prompt recibido:', prompt ? `Sí (${prompt.length} caracteres)` : 'No');
        
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
        
        // Personalizar contenido con IA usando solo el prompt
        const personalizedHtml = await personalizeContent({}, templateHtml, promptText);
        
        // Guardar datos del cliente
        clients.set(clientId, {
            id: clientId,
            data: {},
            prompt: promptText,
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
        
        const clientUrl = `${req.protocol}://${req.get('host')}/client/${clientId}`;
        
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
        
        if (await fs.pathExists(cachedPath)) {
            const html = await fs.readFile(cachedPath, 'utf-8');
            return res.send(html);
        }
        
        // Si no existe caché, generar de nuevo
        const templatePath = path.join(__dirname, 'index.html');
        const templateHtml = await fs.readFile(templatePath, 'utf-8');
        const personalizedHtml = await personalizeContent(client.data, templateHtml, client.prompt);
        
        res.send(personalizedHtml);
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

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
