// Global variables
let scene, camera, renderer, controls;
let terrains = []; // Array to store all loaded terrains
let grid = { size: 10, cellSize: 10 };
let gridHelpers = [];

// Dragging variables
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let selectedTerrain = null;
let isDragging = false;
let dragOffset = new THREE.Vector3();

// Initialize the application
init();

function init() {
    createScene();
    setupEventListeners();
    createGrid();
    animate();
}

function createScene() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(50, 50, 50);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('container3D').appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 1;
    controls.panSpeed = 2.0;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 1.5;

    // Window resize handler
    window.addEventListener('resize', onWindowResize);
}

function setupEventListeners() {
    const fileInput = document.getElementById('fileInput');
    const addTerrainBtn = document.getElementById('addTerrainBtn');
    const gridSizeInput = document.getElementById('gridSize');
    const cellSizeInput = document.getElementById('cellSize');

    fileInput.addEventListener('change', handleFileSelect);
    addTerrainBtn.addEventListener('click', () => fileInput.click());

    gridSizeInput.addEventListener('change', (e) => {
        grid.size = parseInt(e.target.value);
        updateGrid();
    });

    cellSizeInput.addEventListener('change', (e) => {
        grid.cellSize = parseInt(e.target.value);
        updateGrid();
    });

    // Mouse events for dragging - FIXED: Use pointer events for better compatibility
    renderer.domElement.addEventListener('pointerdown', onMouseDown);
    renderer.domElement.addEventListener('pointermove', onMouseMove);
    renderer.domElement.addEventListener('pointerup', onMouseUp);
}

function createGrid() {
    updateGrid();
}

function updateGrid() {
    // Remove old grid helpers
    gridHelpers.forEach(helper => scene.remove(helper));
    gridHelpers = [];

    // Create new grid - center it at origin
    const gridSize = grid.size * grid.cellSize;
    const gridHelper = new THREE.GridHelper(gridSize, grid.size, 0x444444, 0x888888);
    gridHelper.position.y = 0;
    scene.add(gridHelper);
    gridHelpers.push(gridHelper);

    // Add coordinate axes that extend into negative space
    const axesSize = gridSize * 0.6;
    const axesHelper = new THREE.AxesHelper(axesSize);
    scene.add(axesHelper);
    gridHelpers.push(axesHelper);

    // Add origin marker
    const originGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const originMarker = new THREE.Mesh(originGeometry, originMaterial);
    originMarker.position.set(0, 0.5, 0);
    scene.add(originMarker);
    gridHelpers.push(originMarker);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        loadTerrain(file);
    }
    event.target.value = ''; // Reset input
}

// Terrain management functions
function loadTerrain(file) {
    const reader = new FileReader();

    reader.onload = function (e) {
        const loader = new THREE.GLTFLoader();

        loader.load(
            URL.createObjectURL(file),
            function (gltf) {
                const terrain = createTerrainObject(gltf.scene, file.name);
                terrains.push(terrain);
                scene.add(terrain.model);

                // Position at next available grid position
                positionTerrainOnGrid(terrain);

                // Add to UI list
                addTerrainToUI(terrain);

                console.log('Terrain loaded:', terrain);
            },
            function (xhr) {
                console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            function (error) {
                console.error('Error loading terrain:', error);
            }
        );
    };

    reader.readAsArrayBuffer(file);
}

function createTerrainObject(model, name) {
    const terrain = {
        id: Date.now(),
        name: name,
        model: model,
        gridPosition: { x: 0, z: 0 },
        dimensions: { width: 0, depth: 0, height: 0 },
        rotation: 0,
        visible: true
    };

    // Calculate terrain dimensions after scaling
    calculateTerrainDimensions(terrain);

    return terrain;
}

function calculateTerrainDimensions(terrain) {
    const box = new THREE.Box3().setFromObject(terrain.model);
    const size = box.getSize(new THREE.Vector3());

    terrain.dimensions.width = size.x;
    terrain.dimensions.depth = size.z;
    terrain.dimensions.height = size.y;

    console.log(`Terrain "${terrain.name}" dimensions:`, terrain.dimensions);
}

function positionTerrainOnGrid(terrain) {
    // Find the next available position that fits this terrain
    const position = findAvailableGridPosition(terrain);
    terrain.gridPosition = position;
    updateTerrainPosition(terrain);
}

function findAvailableGridPosition(terrain) {
    // Calculate how many grid cells this terrain occupies
    const cellsWide = Math.ceil(terrain.dimensions.width / grid.cellSize);
    const cellsDeep = Math.ceil(terrain.dimensions.depth / grid.cellSize);

    console.log(`Terrain occupies ${cellsWide}x${cellsDeep} grid cells`);

    // Allow negative positions - expand search range
    const searchRange = grid.size;

    for (let z = -searchRange; z < grid.size - cellsDeep + 1; z++) {
        for (let x = -searchRange; x < grid.size - cellsWide + 1; x++) {
            if (!isPositionOccupied(x, z, cellsWide, cellsDeep, terrain.id)) {
                return { x: x, z: z };
            }
        }
    }

    // If no position found, place at origin (might overlap)
    return { x: 0, z: 0 };
}

function isPositionOccupied(x, z, width, depth, excludeTerrainId) {
    for (const terrain of terrains) {
        if (terrain.id === excludeTerrainId) continue;

        const terrainWidth = Math.ceil(terrain.dimensions.width / grid.cellSize);
        const terrainDepth = Math.ceil(terrain.dimensions.depth / grid.cellSize);

        // Check if rectangles overlap - now handles negative coordinates
        const noOverlap =
            x + width <= terrain.gridPosition.x ||
            terrain.gridPosition.x + terrainWidth <= x ||
            z + depth <= terrain.gridPosition.z ||
            terrain.gridPosition.z + terrainDepth <= z;

        if (!noOverlap) {
            return true; // Position is occupied
        }
    }
    return false; // Position is free
}

function updateTerrainPosition(terrain) {
    // Calculate how many grid cells this terrain occupies
    const cellsWide = Math.ceil(terrain.dimensions.width / grid.cellSize);
    const cellsDeep = Math.ceil(terrain.dimensions.depth / grid.cellSize);

    // Center the terrain within its grid cells
    const offsetX = (cellsWide * grid.cellSize - terrain.dimensions.width) / 2;
    const offsetZ = (cellsDeep * grid.cellSize - terrain.dimensions.depth) / 2;

    // Position with proper grid snapping and centering
    terrain.model.position.x = terrain.gridPosition.x * grid.cellSize + offsetX;
    terrain.model.position.z = terrain.gridPosition.z * grid.cellSize + offsetZ;
    terrain.model.rotation.y = terrain.rotation;

    console.log(`Positioned "${terrain.name}" at grid (${terrain.gridPosition.x}, ${terrain.gridPosition.z})`);
}

// MOUSE INTERACTION FUNCTIONS
function onMouseDown(event) {
    event.preventDefault();
    updateMousePosition(event);

    // Check if clicking on a terrain
    raycaster.setFromCamera(mouse, camera);

    // Get all meshes from all terrains for intersection testing
    const allMeshes = [];
    terrains.forEach(terrain => {
        terrain.model.traverse(child => {
            if (child.isMesh) {
                allMeshes.push(child);
            }
        });
    });

    const intersects = raycaster.intersectObjects(allMeshes, true);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;

        // Find which terrain was clicked by finding the parent terrain model
        let parent = clickedObject;
        while (parent && parent !== scene) {
            const terrain = terrains.find(t => t.model === parent);
            if (terrain) {
                selectedTerrain = terrain;
                break;
            }
            parent = parent.parent;
        }

        if (selectedTerrain) {
            isDragging = true;
            controls.enabled = false; // Disable orbit controls while dragging

            // Calculate drag offset (mouse position vs terrain position)
            const intersectPoint = intersects[0].point;
            dragOffset.set(
                intersectPoint.x - selectedTerrain.model.position.x,
                0,
                intersectPoint.z - selectedTerrain.model.position.z
            );

            // Visual feedback - highlight selected terrain
            highlightTerrain(selectedTerrain, true);
        }
    }
}

function onMouseMove(event) {
    if (!isDragging || !selectedTerrain) return;

    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);

    // Create a plane at the terrain's height for dragging
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectionPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectionPoint);

    // Apply drag offset and snap to grid
    const worldX = intersectionPoint.x - dragOffset.x;
    const worldZ = intersectionPoint.z - dragOffset.z;

    // Convert world position to grid position
    const gridX = Math.round(worldX / grid.cellSize);
    const gridZ = Math.round(worldZ / grid.cellSize);

    // Check if new position is valid
    const cellsWide = Math.ceil(selectedTerrain.dimensions.width / grid.cellSize);
    const cellsDeep = Math.ceil(selectedTerrain.dimensions.depth / grid.cellSize);

    if (isValidGridPosition(gridX, gridZ, cellsWide, cellsDeep, selectedTerrain.id)) {
        // Update terrain position
        selectedTerrain.gridPosition.x = gridX;
        selectedTerrain.gridPosition.z = gridZ;
        updateTerrainPosition(selectedTerrain);
    }
}

function onMouseUp() {
    if (isDragging && selectedTerrain) {
        highlightTerrain(selectedTerrain, false);
        updateTerrainUI(selectedTerrain);
    }
    isDragging = false;
    selectedTerrain = null;
    controls.enabled = true; // Re-enable orbit controls
}

function updateMousePosition(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function highlightTerrain(terrain, highlight) {
    terrain.model.traverse((child) => {
        if (child.isMesh) {
            if (highlight) {
                child.userData.originalMaterial = child.material;
                // Create a highlight material
                const originalColor = child.material.color ? child.material.color.clone() : new THREE.Color(0xffffff);
                child.material = new THREE.MeshPhongMaterial({
                    color: originalColor,
                    emissive: 0x00ff00,
                    emissiveIntensity: 0.3
                });
            } else {
                if (child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }
            }
        }
    });
}

function isValidGridPosition(x, z, width, depth, excludeTerrainId) {
    // Allow negative positions (west/south of origin)
    // Only check upper bounds and collisions
    return (x + width <= grid.size &&
        z + depth <= grid.size &&
        !isPositionOccupied(x, z, width, depth, excludeTerrainId));
}

// UI FUNCTIONS
function addTerrainToUI(terrain) {
    const container = document.getElementById('terrainsContainer');

    const cellsWide = Math.ceil(terrain.dimensions.width / grid.cellSize);
    const cellsDeep = Math.ceil(terrain.dimensions.depth / grid.cellSize);

    const terrainElement = document.createElement('div');
    terrainElement.className = 'terrain-item';
    terrainElement.innerHTML = `
        <strong>${terrain.name}</strong>
        <div>Size: ${terrain.dimensions.width.toFixed(1)}×${terrain.dimensions.depth.toFixed(1)}m</div>
        <div>Position: (${terrain.gridPosition.x}, ${terrain.gridPosition.z}) [${cellsWide}×${cellsDeep}]</div>
        <div class="terrain-controls">
            <button onclick="rotateTerrain(${terrain.id})">Rotate</button>
            <button onclick="centerOnTerrain(${terrain.id})">Focus</button>
            <button onclick="removeTerrain(${terrain.id})">Remove</button>
        </div>
    `;

    container.appendChild(terrainElement);
}

function updateTerrainListUI() {
    const container = document.getElementById('terrainsContainer');
    container.innerHTML = '';
    terrains.forEach(terrain => addTerrainToUI(terrain));
}

function updateTerrainUI(terrain) {
    // Update the terrain's position display in UI
    const terrainElements = document.getElementsByClassName('terrain-item');
    for (let element of terrainElements) {
        if (element.innerHTML.includes(terrain.id)) {
            const positionDiv = element.querySelector('div:nth-child(3)');
            if (positionDiv) {
                const cellsWide = Math.ceil(terrain.dimensions.width / grid.cellSize);
                const cellsDeep = Math.ceil(terrain.dimensions.depth / grid.cellSize);
                positionDiv.textContent = `Position: (${terrain.gridPosition.x}, ${terrain.gridPosition.z}) [${cellsWide}×${cellsDeep}]`;
            }
        }
    }
}

// GLOBAL UI FUNCTIONS
window.rotateTerrain = function (terrainId) {
    const terrain = terrains.find(t => t.id === terrainId);
    if (terrain) {
        // Store current position before rotation
        const currentGridPos = { ...terrain.gridPosition };

        // Rotate 90 degrees
        terrain.rotation = (terrain.rotation + Math.PI / 2) % (Math.PI * 2);

        // Swap width and depth for collision checking
        [terrain.dimensions.width, terrain.dimensions.depth] =
            [terrain.dimensions.depth, terrain.dimensions.width];

        // Try to keep the terrain in the same position
        const cellsWide = Math.ceil(terrain.dimensions.width / grid.cellSize);
        const cellsDeep = Math.ceil(terrain.dimensions.depth / grid.cellSize);

        // Check if current position still works after rotation
        if (isValidGridPosition(currentGridPos.x, currentGridPos.z, cellsWide, cellsDeep, terrain.id)) {
            // Position is still valid - keep it
            terrain.gridPosition = currentGridPos;
        } else {
            // Position is now invalid (would overlap) - find nearest valid position
            const newPosition = findNearestValidPosition(terrain, currentGridPos);
            terrain.gridPosition = newPosition;
        }

        // Update the terrain position and UI
        updateTerrainPosition(terrain);
        updateTerrainListUI();

        console.log(`Rotated terrain "${terrain.name}" to position (${terrain.gridPosition.x}, ${terrain.gridPosition.z})`);
    }
};

window.centerOnTerrain = function (terrainId) {
    const terrain = terrains.find(t => t.id === terrainId);
    if (terrain) {
        const box = new THREE.Box3().setFromObject(terrain.model);
        const center = box.getCenter(new THREE.Vector3());

        controls.target.copy(center);
        controls.update();
    }
};

window.removeTerrain = function (terrainId) {
    const terrainIndex = terrains.findIndex(t => t.id === terrainId);
    if (terrainIndex !== -1) {
        const terrain = terrains[terrainIndex];
        scene.remove(terrain.model);
        terrains.splice(terrainIndex, 1);
        updateTerrainListUI();
    }
};

// UTILITY FUNCTIONS
function findObjectByName(object, name) {
    let result = null;
    object.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes(name.toLowerCase())) {
            result = child;
        }
    });
    return result;
}

function applyScaleReference(terrain, refCube) {
    // Your existing scale reference logic here
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}