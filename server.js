const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Función para extraer solo las secciones de texto que necesitan personalización
function extractTextSections(html) {
    // Extraer secciones completas (incluyendo el div.section) para mantener estilos
    const section1 = html.match(/<div class="section">\s*<h1[^>]*>([\s\S]*?)<\/h1>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i);
    const sectionObjetivos = html.match(/<div class="section">\s*<h2[^>]*>🎯 Objetivos<\/h2>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i);
    const sectionAlcance = html.match(/<div class="section">\s*<h2[^>]*>📋 Alcance del Proyecto<\/h2>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i);
    const sectionTimeline = html.match(/<div class="section">\s*<h2[^>]*>📅 Timeline y Planificación<\/h2>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i);
    const sectionEquipo = html.match(/<div class="section">\s*<h2[^>]*>👥 Con Quien Trabajamos<\/h2>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i);
    const sectionPrecio = html.match(/<div class="section">\s*<h2[^>]*>💰 Inversión<\/h2>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>)/i);
    const sectionContacto = html.match(/<div class="section"[^>]*>\s*<h2[^>]*>📞 Contacto<\/h2>([\s\S]*?)<\/div>\s*(?=<div class="section">|<\/div>|$)/i);
    
    // Extraer solo el contenido interno (sin el div.section) para enviar a ChatGPT
    const sections = {
        h1: section1 ? (section1[1] + (section1[2] || '')) : '',
        objetivos: sectionObjetivos ? sectionObjetivos[1] : '',
        alcance: sectionAlcance ? sectionAlcance[1] : '',
        timeline: sectionTimeline ? sectionTimeline[1] : '',
        equipo: sectionEquipo ? sectionEquipo[1] : '',
        precio: sectionPrecio ? sectionPrecio[1] : '',
        contacto: sectionContacto ? sectionContacto[1] : ''
    };
    
    // NO remover estilos ni clases - mantener todo intacto
    Object.keys(sections).forEach(key => {
        if (sections[key]) {
            sections[key] = sections[key].trim();
        }
    });
    
    return sections;
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
        console.log('📝 Extrayendo secciones de texto del HTML...');
        const textSections = extractTextSections(templateHtml);
        
        // Crear un HTML simplificado solo con las secciones de texto
        const simplifiedHtml = `
<h1>${textSections.h1}</h1>

<h2>🎯 Objetivos</h2>
${textSections.objetivos}

<h2>📋 Alcance del Proyecto</h2>
${textSections.alcance}

<h2>📅 Timeline y Planificación</h2>
${textSections.timeline}

<h2>👥 Con Quien Trabajamos</h2>
${textSections.equipo}

<h2>💰 Inversión</h2>
${textSections.precio}

<h2>📞 Contacto</h2>
${textSections.contacto}
`.trim();
        
        console.log(`✅ HTML simplificado: ${simplifiedHtml.length} caracteres (vs ${templateHtml.length} del original)`);
        
        // Si hay un prompt personalizado, usarlo; si no, usar el prompt por defecto
        let prompt;
        if (customPrompt) {
            prompt = `${customPrompt}

INSTRUCCIONES CRÍTICAS:
- Personaliza SOLO los TEXTOS dentro de las etiquetas (contenido de <h1>, <h2>, <p>, <li>, <div class="circuit-step-title">, etc.)
- Mantén TODA la estructura HTML intacta (incluyendo <div class="circuit-track">, <div class="circuit-step">, <div class="circuit-node">, etc.)
- Mantén TODOS los atributos (class, id, data-step, style, etc.)
- NO cambies los emojis (🎯, 📋, 📅, 👥, 💰, 📞)
- NO cambies la estructura de circuitos, solo personaliza los textos dentro de circuit-step-title y circuit-step-description
- Devuelve SOLO el HTML completo de las secciones sin explicaciones ni markdown

HTML a personalizar:
${simplifiedHtml}`;
        } else {
            prompt = `Personaliza estos textos para el cliente:
Nombre: ${clientData.nombre || 'Cliente'}
Empresa: ${clientData.empresa || ''}
Objetivos: ${clientData.objetivos || ''}
Alcance: ${clientData.alcance || ''}
Timeline: ${clientData.timeline || ''}
Equipo: ${clientData.equipo || ''}
Precio: ${clientData.precio || ''}

INSTRUCCIONES CRÍTICAS:
- Personaliza SOLO los TEXTOS dentro de las etiquetas (contenido de <h1>, <h2>, <p>, <li>, <div class="circuit-step-title">, etc.)
- Mantén TODA la estructura HTML intacta (incluyendo <div class="circuit-track">, <div class="circuit-step">, <div class="circuit-node">, etc.)
- Mantén TODOS los atributos (class, id, data-step, style, etc.)
- NO cambies los emojis (🎯, 📋, 📅, 👥, 💰, 📞)
- NO cambies la estructura de circuitos, solo personaliza los textos dentro de circuit-step-title y circuit-step-description
- Devuelve SOLO el HTML completo de las secciones sin explicaciones ni markdown

HTML a personalizar:
${simplifiedHtml}`;
        }

        console.log('🤖 Enviando a OpenAI (modelo optimizado)...');
        const startTime = Date.now();
        
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un experto en personalizar SOLO TEXTOS de páginas web manteniendo TODA la estructura HTML.

REGLAS CRÍTICAS:
- Solo personaliza los TEXTOS dentro de las etiquetas HTML (contenido de <h1>, <h2>, <p>, <li>, <div class="circuit-step-title">, <div class="circuit-step-description">, etc.)
- Mantén TODAS las etiquetas HTML intactas (incluyendo <div class="circuit-track">, <div class="circuit-step">, <div class="circuit-node">, etc.)
- Mantén TODOS los atributos (class, id, data-step, style, etc.)
- NO cambies emojis (🎯, 📋, 📅, 👥, 💰, 📞)
- NO cambies estructura de circuitos, solo los textos dentro de circuit-step-title y circuit-step-description
- Devuelve SOLO el HTML completo de las secciones sin explicaciones ni markdown`
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 4000 // Mucho menos tokens porque solo enviamos textos
        });
        
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️ OpenAI respondió en ${elapsedTime} segundos`);

        let personalizedHtml = completion.choices[0].message.content;
        
        // Limpiar el HTML si viene con markdown
        if (personalizedHtml.includes('```html')) {
            personalizedHtml = personalizedHtml.split('```html')[1].split('```')[0];
        } else if (personalizedHtml.includes('```')) {
            personalizedHtml = personalizedHtml.split('```')[1].split('```')[0];
        }
        
        personalizedHtml = personalizedHtml.trim();
        
        console.log('🔄 Reemplazando secciones en HTML original...');
        
        // Extraer las secciones personalizadas del resultado
        // ChatGPT devuelve el contenido después de cada h2, necesitamos capturarlo todo
        const personalizedSections = {
            h1: (() => {
                const match = personalizedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                if (match) {
                    // Si hay contenido después del h1, incluirlo
                    const afterH1 = personalizedHtml.split(/<\/h1>/i)[1];
                    if (afterH1 && !afterH1.trim().startsWith('<h2')) {
                        return match[1] + afterH1.split(/<h2/i)[0];
                    }
                    return match[1];
                }
                return textSections.h1;
            })(),
            objetivos: personalizedHtml.match(/<h2[^>]*>🎯 Objetivos<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i)?.[1]?.trim() || textSections.objetivos,
            alcance: personalizedHtml.match(/<h2[^>]*>📋 Alcance del Proyecto<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i)?.[1]?.trim() || textSections.alcance,
            timeline: personalizedHtml.match(/<h2[^>]*>📅 Timeline y Planificación<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i)?.[1]?.trim() || textSections.timeline,
            equipo: personalizedHtml.match(/<h2[^>]*>👥 Con Quien Trabajamos<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i)?.[1]?.trim() || textSections.equipo,
            precio: personalizedHtml.match(/<h2[^>]*>💰 Inversión<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i)?.[1]?.trim() || textSections.precio,
            contacto: personalizedHtml.match(/<h2[^>]*>📞 Contacto<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/i)?.[1]?.trim() || textSections.contacto
        };
        
        // Reemplazar en el HTML original
        const finalHtml = replaceTextSections(templateHtml, personalizedSections);
        
        console.log('✅ HTML personalizado generado exitosamente');
        
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
