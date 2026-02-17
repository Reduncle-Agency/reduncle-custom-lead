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

INSTRUCCIONES CRÍTICAS:
- SOLO cambia los TEXTOS visibles al usuario (títulos, párrafos, listas)
- NO modifiques NINGÚN código JavaScript, CSS, o estructura HTML
- NO toques el código de Three.js, animaciones, o efectos visuales
- El coche 3D debe seguir funcionando exactamente igual
- Mantén TODOS los estilos, clases, IDs, y atributos intactos
- Solo personaliza los contenidos de texto dentro de <h1>, <h2>, <h3>, <p>, <li>, etc.

Devuelve SOLO el HTML completo sin explicaciones ni markdown.`;
        } else {
            prompt = `Personaliza SOLO los TEXTOS de este HTML para el cliente.

Datos del cliente:
Nombre: ${clientData.nombre || 'Cliente'}
Empresa: ${clientData.empresa || ''}
Objetivos: ${clientData.objetivos || ''}
Alcance: ${clientData.alcance || ''}
Timeline: ${clientData.timeline || ''}
Equipo: ${clientData.equipo || ''}
Precio: ${clientData.precio || ''}

INSTRUCCIONES CRÍTICAS:
- SOLO cambia los TEXTOS visibles (títulos, párrafos, listas)
- NO modifiques JavaScript, CSS, o estructura HTML
- NO toques Three.js, animaciones, o efectos
- El coche 3D debe funcionar igual
- Mantén TODOS los estilos y código intactos

Devuelve SOLO el HTML completo sin explicaciones.`;
        }

        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un experto en personalizar SOLO TEXTOS en páginas web. 

REGLAS CRÍTICAS (NO VIOLAR):
1. MANTÉN TODO EL CÓDIGO INTACTO:
   - NO modifiques NINGÚN JavaScript (Three.js, animaciones, efectos, funciones)
   - NO modifiques NINGÚN CSS (estilos, animaciones, efectos visuales, clases)
   - NO modifiques la estructura HTML (divs, clases, IDs, atributos)
   - NO modifiques los scripts de Three.js, GLTFLoader, o cualquier código de animación
   - NO modifiques los event listeners, funciones de scroll, o efectos visuales

2. SOLO PUEDES CAMBIAR:
   - Los TEXTOS dentro de las etiquetas <h1>, <h2>, <h3>, <p>, <li>, <div> con contenido de texto
   - Los textos descriptivos de las secciones (Objetivos, Alcance, Timeline, Equipo, Precio, Contacto)
   - Los títulos y descripciones de los pasos del circuito
   - Mantén la estructura exacta de las listas y secciones

3. EL COCHE 3D DEBE FUNCIONAR:
   - NO toques NADA del código relacionado con Three.js
   - NO modifiques el canvas, renderer, scene, camera, o car
   - NO cambies los scripts de importación de Three.js
   - El coche 3D debe seguir funcionando exactamente igual

4. EFECTOS VISUALES:
   - NO modifiques CSS de animaciones, transiciones, o efectos
   - NO cambies colores, gradientes, o efectos visuales
   - Solo cambia los textos, mantén todos los estilos

IMPORTANTE: Si no estás 100% seguro de si algo es texto o código, NO LO TOQUES. Solo cambia textos claramente visibles al usuario.`
                },
                {
                    role: "user",
                    content: prompt + "\n\nHTML COMPLETO (mantén TODO el código intacto, solo cambia textos):\n" + templateHtml
                }
            ],
            temperature: 0.3, // Temperatura más baja para ser más conservador
            max_tokens: 16000 // Más tokens para el HTML completo
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
