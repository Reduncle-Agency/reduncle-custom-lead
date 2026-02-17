# 🖥️ Ver el Proyecto Localmente

## 🚀 Opción 1: Script Automático (Más Fácil)

### Windows:
- **Doble clic** en `renderizar.bat`
- O ejecuta en PowerShell: `.\renderizar.ps1`

El script automáticamente:
- Detecta si tienes Python, Node.js o PHP
- Inicia un servidor local
- Abre tu navegador en `http://localhost:8000`

## 🐍 Opción 2: Python

```bash
python -m http.server 8000
```

Luego abre: http://localhost:8000

## 📦 Opción 3: Node.js

```bash
npx serve -p 8000
```

Luego abre: http://localhost:8000

## 🐘 Opción 4: PHP

```bash
php -S localhost:8000
```

Luego abre: http://localhost:8000

## 💻 Opción 5: VS Code Live Server

1. Instala la extensión "Live Server" en VS Code
2. Haz clic derecho en `index.html`
3. Selecciona "Open with Live Server"

## ⚠️ Importante

**Necesitas un servidor local** porque:
- Los navegadores bloquean la carga de archivos locales por seguridad (CORS)
- Three.js necesita cargar módulos ES6 que requieren un servidor HTTP

## 🛑 Detener el Servidor

Presiona `Ctrl + C` en la terminal donde está corriendo el servidor.

## ✅ Verificar que Funciona

1. El navegador se abre automáticamente
2. Deberías ver el fondo oscuro con el texto del proyecto
3. El coche 3D debería aparecer en el centro
4. Al hacer scroll, el coche debería circular

## 🔧 Solución de Problemas

### Si el coche no aparece:
- Abre la consola del navegador (F12)
- Revisa si hay errores en rojo
- Verifica que la URL del CDN de Shopify esté correcta

### Si el servidor no inicia:
- Verifica que Python/Node.js/PHP esté instalado
- Asegúrate de que el puerto 8000 no esté en uso
- Prueba con otro puerto: `python -m http.server 8080`
