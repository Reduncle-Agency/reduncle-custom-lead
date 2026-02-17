# Integración con Shopify

## 📁 Archivo Liquid para Shopify

He creado el archivo `visualizador-3d-pro.liquid` que puedes usar en tu tema de Shopify.

### Cómo usar:

1. **Sube el archivo a tu tema:**
   - Ve a: `Online Store > Themes > Actions > Edit code`
   - Ve a: `Sections`
   - Crea un nuevo archivo: `visualizador-3d-pro.liquid`
   - Copia el contenido del archivo que creé

2. **Configuración en Shopify:**
   - Ve a: `Online Store > Themes > Customize`
   - Añade la sección "Visualizador 3D Pro"
   - Configura:
     - **URL de Render**: `https://reduncle-custom-lead.onrender.com`
     - **Modo**: 
       - `iframe` = Muestra la página dentro de Shopify
       - `redirect` = Redirige a la página completa

### Opciones disponibles:

**Modo iframe (recomendado):**
- La página se muestra dentro de Shopify
- El usuario no sale de tu tienda
- Mejor experiencia integrada

**Modo redirect:**
- Redirige directamente a Render
- El usuario sale de Shopify
- Útil si quieres que vean la página completa

### Para mostrar una página de cliente específica:

Si quieres mostrar una página personalizada de un cliente específico, usa:
```
https://reduncle-custom-lead.onrender.com/client/CLIENT_ID_AQUI
```

### Ejemplo de uso dinámico:

Si quieres que cada cliente vea su propia página, puedes usar metafields de Shopify:

```liquid
{% assign client_id = customer.metafields.custom.client_id %}
{% if client_id %}
  {% assign render_url = 'https://reduncle-custom-lead.onrender.com/client/' | append: client_id %}
{% else %}
  {% assign render_url = 'https://reduncle-custom-lead.onrender.com' %}
{% endif %}
```
