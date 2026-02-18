const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const PROXY_URL = process.env.PROXY_URL || "https://reduncle-custom-lead.onrender.com";

app.use(express.json());

// Endpoint simple que recibe el token desde Shopify y lo envía al proxy
app.post('/receive-token', async (req, res) => {
  try {
    const { shop, accessToken, scope } = req.body;
    
    console.log(`📥 Token recibido para shop: ${shop}`);
    
    if (!shop || !accessToken) {
      return res.status(400).json({ error: 'Faltan shop o accessToken' });
    }
    
    // Enviar al proxy
    console.log(`📤 Enviando token al proxy: ${PROXY_URL}/api/shopify/token`);
    
    const response = await fetch(`${PROXY_URL}/api/shopify/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop,
        accessToken,
        scope: scope || "",
      }),
    });
    
    const responseData = await response.json();
    
    if (response.ok) {
      console.log(`✅ Token enviado exitosamente al proxy`);
      res.json({ success: true, message: 'Token enviado al proxy', proxyResponse: responseData });
    } else {
      console.error(`❌ Error del proxy: ${response.status}`, responseData);
      res.status(500).json({ error: 'Error al enviar token al proxy', details: responseData });
    }
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ status: 'ok', proxyUrl: PROXY_URL });
});

app.listen(PORT, () => {
  console.log(`🚀 Token Sender corriendo en puerto ${PORT}`);
  console.log(`📡 Proxy URL: ${PROXY_URL}`);
  console.log(`📥 Endpoint: POST /receive-token`);
});
