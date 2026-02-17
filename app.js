import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Variables globales
let scene, camera, renderer, car, carGroup;
let angle = 0; // Ángulo de la trayectoria circular
let rotationSpeed = 0; // Velocidad de rotación (controlada por scroll)
let radius = 6; // Radio del círculo (más grande)
const friction = 0.95; // Fricción (0.95 = frena gradualmente, más bajo = frena más rápido)
const minSpeed = 0.001; // Velocidad mínima antes de detenerse completamente

// Inicializar la escena
function init() {
    // Crear escena con fondo transparente
    scene = new THREE.Scene();
    scene.background = null; // Sin fondo

    // Crear cámara
    const container = document.getElementById('canvas-container');
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 6, 12);
    camera.lookAt(0, 0, 0);
    
    // Crear un grupo para el coche (para facilitar el movimiento)
    carGroup = new THREE.Group();
    scene.add(carGroup);

    // Crear renderer con transparencia
    renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0); // Fondo transparente
    renderer.shadowMap.enabled = false; // Sin sombras para mejor rendimiento
    container.appendChild(renderer.domElement);

    // Agregar luces para iluminar solo el coche
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight1.position.set(5, 10, 5);
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, 5, -5);
    scene.add(directionalLight2);

    // Luz puntual para mejor iluminación
    const pointLight = new THREE.PointLight(0xffffff, 0.6);
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);

    // Cargar el modelo del coche desde CDN de Shopify
    const loader = new GLTFLoader();
    loader.load(
        'https://cdn.shopify.com/3d/models/0a1c5e3c0fb6a380/Meshy_AI_Red_Formula_1_0217154143_texture.glb',
        function(gltf) {
            car = gltf.scene;
            
            // Calcular el centro del modelo
            const box = new THREE.Box3().setFromObject(car);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            
            // Centrar el modelo
            car.position.x = -center.x;
            car.position.y = -center.y;
            car.position.z = -center.z;
            
            // Escalar el coche más grande
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 5 / maxDim; // Más grande (antes era 3)
            car.scale.multiplyScalar(scale);
            
            // Desactivar sombras para mejor rendimiento
            car.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                }
            });
            
            // Agregar el coche al grupo
            carGroup.add(car);
            
            // Ocultar loading
            document.getElementById('loading').style.display = 'none';
        },
        function(progress) {
            console.log('Progreso de carga:', (progress.loaded / progress.total * 100) + '%');
        },
        function(error) {
            console.error('Error al cargar el modelo:', error);
            document.getElementById('loading').textContent = 'Error al cargar el modelo';
        }
    );

    // Event listener para el scroll
    window.addEventListener('wheel', onScroll, { passive: true });
    
    // Ajustar tamaño al redimensionar ventana
    window.addEventListener('resize', onWindowResize);
    
    // Iniciar animación
    animate();
}

// Manejar el scroll
function onScroll(event) {
    // Controlar la velocidad de rotación con el scroll
    const delta = event.deltaY * 0.0001; // Sensibilidad del scroll
    rotationSpeed += delta;
    
    // Limitar la velocidad (opcional, para evitar velocidades extremas)
    rotationSpeed = Math.max(-0.05, Math.min(0.05, rotationSpeed));
}

// Animación suave
function animate() {
    requestAnimationFrame(animate);
    
    if (carGroup && car) {
        // Aplicar fricción (frena gradualmente cuando no hay scroll)
        rotationSpeed *= friction;
        
        // Detener completamente si la velocidad es muy pequeña
        if (Math.abs(rotationSpeed) < minSpeed) {
            rotationSpeed = 0;
        }
        
        // Actualizar el ángulo de la trayectoria circular
        angle += rotationSpeed;
        
        // Calcular la posición del coche en el círculo
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        // Mover el grupo del coche
        carGroup.position.x = x;
        carGroup.position.z = z;
        carGroup.position.y = 0;
        
        // Orientar el coche hacia la dirección del movimiento
        // La dirección tangente al círculo es perpendicular al radio
        const tangentX = -Math.sin(angle);
        const tangentZ = Math.cos(angle);
        
        // Calcular el punto hacia donde debe mirar el coche
        const lookX = x + tangentX;
        const lookZ = z + tangentZ;
        
        // Hacer que el coche mire hacia donde se mueve (conduciendo)
        car.lookAt(lookX, 0, lookZ);
        
        // Ajustar la rotación del coche según la orientación inicial del modelo
        car.rotateY(Math.PI / 2); // Ajuste según el modelo
    }
    
    renderer.render(scene, camera);
}

// Ajustar tamaño de ventana
function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    renderer.setSize(width, height);
}

// Inicializar cuando se carga la página
init();
