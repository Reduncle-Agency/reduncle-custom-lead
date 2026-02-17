# 🏎️ Visualizador 3D de Coche F1

Una aplicación web interactiva que muestra un modelo 3D de un coche de Fórmula 1 que circula en círculos. El coche se controla con el scroll del mouse y se detiene gradualmente cuando no hay movimiento.

## ✨ Características

- 🎮 **Control con scroll**: Acelera o frena el coche con el scroll del mouse
- 🔄 **Movimiento circular**: El coche circula alrededor del centro de la pantalla
- 🎨 **Diseño moderno**: Interfaz con efecto glassmorphism y fondo oscuro
- 📱 **Responsive**: Se adapta a diferentes tamaños de pantalla
- ⚡ **Rendimiento optimizado**: Sin sombras ni elementos 3D innecesarios

## 🚀 Cómo usar

### Opción 1: Servidor local simple

1. Clona o descarga este repositorio
2. Abre una terminal en la carpeta del proyecto
3. Ejecuta uno de estos comandos:

**Con Python:**
```bash
python -m http.server 8000
```

**Con Node.js (npx):**
```bash
npx serve
```

**Con PHP:**
```bash
php -S localhost:8000
```

4. Abre tu navegador en `http://localhost:8000`

### Opción 2: GitHub Pages

1. Sube este repositorio a GitHub
2. Ve a Settings > Pages en tu repositorio
3. Selecciona la rama `main` y la carpeta `/root`
4. Tu sitio estará disponible en `https://tu-usuario.github.io/nombre-repo`

### Opción 3: VS Code Live Server

1. Instala la extensión "Live Server" en VS Code
2. Haz clic derecho en `index.html`
3. Selecciona "Open with Live Server"

## 📁 Estructura del proyecto

```
.
├── index.html          # Página principal con el contenido web
├── app.js              # Lógica de Three.js y animación del coche
└── README.md         # Este archivo
```

**Nota:** El modelo 3D se carga desde el CDN de Shopify, no necesita estar en el repositorio.

## 🛠️ Tecnologías utilizadas

- **Three.js**: Librería 3D para WebGL
- **HTML5/CSS3**: Estructura y estilos
- **JavaScript ES6+**: Lógica de la aplicación

## 📝 Notas importantes

- El modelo 3D se carga desde el CDN de Shopify, por lo que no necesitas subir el archivo `.glb` al repositorio.
- Para desarrollo local, necesitas un servidor porque los navegadores bloquean la carga de archivos locales por seguridad (CORS).
- El proyecto funciona perfectamente con GitHub Pages sin necesidad de servidor adicional.

## 🎯 Funcionalidades

- **Scroll hacia abajo**: Acelera el coche
- **Scroll hacia arriba**: Frena o invierte la dirección
- **Sin scroll**: El coche frena gradualmente hasta detenerse
- **Contenido web**: Scroll por la página para ver información del proyecto

## 📄 Licencia

Este proyecto es de código abierto. Siéntete libre de usarlo y modificarlo.

## 👨‍💻 Autor

Tu nombre aquí

---

¡Disfruta del visualizador! 🏎️💨
