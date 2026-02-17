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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

// Función para personalizar el HTML con IA
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
        // Si hay un prompt personalizado, usarlo; si no, usar el prompt por defecto
        let prompt;
        if (customPrompt) {
            prompt = `${customPrompt}

Datos del cliente:
Nombre: ${clientData.nombre || 'Cliente'}
Empresa: ${clientData.empresa || ''}
Objetivos: ${clientData.objetivos || ''}
Alcance: ${clientData.alcance || ''}
Timeline: ${clientData.timeline || ''}
Equipo: ${clientData.equipo || ''}
Precio: ${clientData.precio || ''}

Mantén la estructura HTML, CSS y JavaScript intactos. Solo personaliza los textos y datos según el prompt.
Devuelve SOLO el HTML completo sin explicaciones.`;
        } else {
            prompt = `Personaliza este HTML para el cliente:
Nombre: ${clientData.nombre || 'Cliente'}
Empresa: ${clientData.empresa || ''}
Objetivos: ${clientData.objetivos || ''}
Alcance: ${clientData.alcance || ''}
Timeline: ${clientData.timeline || ''}
Equipo: ${clientData.equipo || ''}
Precio: ${clientData.precio || ''}

Mantén la estructura HTML, CSS y JavaScript intactos. Solo personaliza los textos y datos del cliente.
Reemplaza los placeholders {{cliente.*}} con los datos reales del cliente.
Devuelve SOLO el HTML completo sin explicaciones.`;
        }

        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "Eres un experto en personalizar páginas web. Mantén toda la estructura HTML, CSS y JavaScript. Solo cambia los textos y datos según las instrucciones."
                },
                {
                    role: "user",
                    content: prompt + "\n\nHTML original (primeros 8000 caracteres):\n" + templateHtml.substring(0, 8000)
                }
            ],
            temperature: 0.7,
            max_tokens: 8000
        });

        let personalizedHtml = completion.choices[0].message.content;
        
        // Limpiar el HTML si viene con markdown
        if (personalizedHtml.includes('```html')) {
            personalizedHtml = personalizedHtml.split('```html')[1].split('```')[0];
        } else if (personalizedHtml.includes('```')) {
            personalizedHtml = personalizedHtml.split('```')[1].split('```')[0];
        }
        
        return personalizedHtml.trim();
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
    try {
        const { prompt } = req.body;
        
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                error: 'El prompt es requerido'
            });
        }
        
        const promptText = prompt.trim();
        
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
