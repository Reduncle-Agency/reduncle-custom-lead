const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const HOST = process.env.HOST || 'https://reduncle-custom-lead.onrender.com';
const REDIRECT_URI = `${HOST}/callback`;

// Endpoint 1: Iniciar OAuth
app.get('/auth', (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${CLIENT_ID}&` +
    `scope=read_products,write_products&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  
  res.redirect(authUrl);
});

// Endpoint 2: Callback OAuth
app.get('/callback', async (req, res) => {
  const { shop, code } = req.query;
  
  if (!shop || !code) {
    return res.status(400).send('Missing shop or code');
  }
  
  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code
      })
    });
    
    const data = await response.json();
    
    if (data.access_token) {
      console.log('========================================');
      console.log('ACCESS TOKEN PERMANENTE:');
      console.log(data.access_token);
      console.log('========================================');
      
      // Enviar token al proxy
      try {
        const proxyResponse = await fetch(`${HOST}/api/shopify/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop: shop,
            accessToken: data.access_token,
            scope: data.scope || 'read_products,write_products'
          })
        });
        
        if (proxyResponse.ok) {
          console.log('✅ Token enviado al proxy exitosamente');
        } else {
          console.error('❌ Error al enviar token al proxy:', await proxyResponse.text());
        }
      } catch (error) {
        console.error('❌ Error al enviar token al proxy:', error.message);
      }
    } else {
      console.error('Error:', data);
    }
    
    res.send('OK');
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
