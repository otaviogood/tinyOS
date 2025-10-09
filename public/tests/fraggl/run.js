import { Scene, PerspectiveCamera, WebGPURenderer, Mesh, StandardMaterial, DirectionalLight, Vector3, Group, GLTFLoader, TextureLoader, Box3, Box3Helper, ConeGeometry, CylinderGeometry, CapsuleGeometry, BoxGeometry, SphereGeometry, WireframeMaterial } from '/src/apps/BrickQuest/renderer/fraggl/index.js';

function traverse(object, fn) {
  fn(object);
  for (const child of object.children || []) traverse(child, fn);
}

function markCastersAndReceivers(object) {
  traverse(object, (obj) => {
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

async function main() {
  const canvas = document.getElementById('c');
  if (!canvas) throw new Error('Canvas #c not found');

  const scene = new Scene();

  const renderer = new WebGPURenderer({ canvas, clearColor: { r: 0.1, g: 0.12, b: 0.16, a: 1 } });
  await renderer.init(canvas);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.setExposure(1.0);

  const camera = new PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 200);
  camera.position.set(5, 4, 8);
  camera.setRotationFromEuler(camera.rotation.set(-0.4, 0.6, 0));

  const light = new DirectionalLight([1, 1, 1], 2);
  light.direction = new Vector3(-1.5, -3, -0.75).normalize();
  light.shadow.mapSize.width = 1024;
  light.shadow.mapSize.height = 1024;
  light.shadow.radius = 1.5;
  light.shadow.bias = -0.002;
  light.shadow.camera.left = -15;
  light.shadow.camera.right = 15;
  light.shadow.camera.top = 15;
  light.shadow.camera.bottom = -15;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 50;
  scene.add(light);

  const floorGeo = new BoxGeometry(1, 1, 1);
  const textureLoader = new TextureLoader();
  const skyTexture = await textureLoader.loadAsync('/apps/sky4.webp', {
    colorSpace: 'srgb',
    minFilter: 'linear',
    magFilter: 'linear',
    generateMipmaps: true
  });
  skyTexture.wrapS = 'repeat';
  skyTexture.wrapT = 'repeat';
  skyTexture.repeat = [1, 1];

  const floorMat = new StandardMaterial({ baseColor: [1, 1, 1], roughness: 0.8, metallic: 0, map: skyTexture });

  const loader = new GLTFLoader();
  const { scene: plateRoot } = await loader.loadAsync('../../apps/bricks/individual/3024_PLATE_1X1.gltf');

  // The individual brick glTF contains multiple child meshes for studs/convex etc.
  const plateGroup = new Group();
  plateGroup.add(plateRoot);
  plateGroup.position.set(0, 1.5, 0);
  plateGroup.scale.set(0.1, 0.1, 0.1); // convert from LDraw units (0.01 studs) to scene scale
  const plateMaterial = new StandardMaterial({ baseColor: [0.95, 0.95, 0.98], roughness: 0.35, metallic: 0.0 });
  traverse(plateRoot, (obj) => {
    if (obj instanceof Mesh) {
      if (!obj.material) obj.material = plateMaterial;
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  markCastersAndReceivers(plateGroup);
  scene.add(plateGroup);

  {
    const coneGeo = new ConeGeometry(1.5, 1.5, 16, 1, false, 0, Math.PI * 2);
    const coneMat = new WireframeMaterial({ color: [1, 0.6, 0.2, 1] });
    // const coneMat = new StandardMaterial({ baseColor: [1, 0.6, 0.2], roughness: 0.4, metallic: 0.0 });
    const cone = new Mesh(coneGeo, coneMat);
    cone.position.set(-1.5, 0.95, 3);
    cone.castShadow = true;
    cone.receiveShadow = true;
    scene.add(cone);
  }

  // Sphere test
  {
    const sphGeo = new SphereGeometry(0.75, 24, 16, 0, Math.PI * 2, 0, Math.PI);
    const sphMat = new StandardMaterial({ baseColor: [0.8, 0.2, 0.9], roughness: 0.35, metallic: 0.0 });
    const sph = new Mesh(sphGeo, sphMat);
    sph.position.set(-3.0, 1.0, -0.25);
    sph.castShadow = true;
    sph.receiveShadow = true;
    scene.add(sph);
  }

  // Transparent cylinder test
  {
    const cylGeo = new CylinderGeometry(0.6, 0.6, 2.0, 24, 1, false, 0, Math.PI * 2);
    const cylMat = new StandardMaterial({
      baseColor: [0.2, 0.7, 1.0, 1.0],
      roughness: 0.25,
      metallic: 0.0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    });
    const cyl = new Mesh(cylGeo, cylMat);
    cyl.position.set(1.6, 1.0, 0.3);
    cyl.castShadow = false;
    cyl.receiveShadow = false;
    scene.add(cyl);
  }

  // Capsule test
  {
    const capGeo = new CapsuleGeometry(0.5, 1.0, 6, 24, 1);
    const capMat = new StandardMaterial({ baseColor: [0.3, 1.0, 0.4], roughness: 0.4, metallic: 0.0 });
    const cap = new Mesh(capGeo, capMat);
    cap.position.set(3.0, 2.0, 0.5);
    cap.castShadow = true;
    cap.receiveShadow = true;
    scene.add(cap);
  }

  // Debug bounding box helper for the rotating plate group
  const bbox = new Box3();
  bbox.setFromObject(plateGroup, true);
  const boxHelper = new Box3Helper(bbox, 0xffff00);
  scene.add(boxHelper);

  const floor = new Mesh(floorGeo, floorMat);
  floor.scale.set(10, 0.25, 10);
  floor.position.set(0, -0.125, 0);
  floor.castShadow = false;
  floor.receiveShadow = true;
  scene.add(floor);

  markCastersAndReceivers(light);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  resize();
  window.addEventListener('resize', resize);

  let lastTime = performance.now();

  function tick(now) {
    const delta = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    plateGroup.rotation.y += delta * 1.1;
    plateGroup.rotation.x = Math.sin(now * 0.0005) * 0.25;
    plateGroup.setRotationFromEuler(plateGroup.rotation);

    // Keep the debug box in sync with the animated object
    bbox.setFromObject(plateGroup, true);

    renderer.render(scene, camera).catch((err) => console.error('Render failed', err));
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

main().catch((err) => {
  const results = document.getElementById('results');
  if (results) {
    results.textContent = 'Error: ' + err.message;
    results.className = 'fail';
  }
  console.error(err);
});

