# fraggl

Fraggl is a WebGPU-only rendering toolkit being built to replace the legacy three.js based renderer. The design goal is to deliver a modern, low-level API that feels familiar to three.js users while exposing the flexibility you need to write custom WGSL shaders, manage GPU resources directly, and experiment with renderer features without carrying browser or API fallbacks.

---

## Why Fraggl?
- **WebGPU first**: assumes a WebGPU-capable browser and device. There are no WebGL or Canvas fallbacks.
- **Three.js inspired scene graph**: `Object3D`, `Scene`, `Mesh`, `Group`, `BufferGeometry`, and the math library mirror three.js conventions so existing gameplay code can migrate incrementally.
- **Shader-centric workflow**: materials are thin wrappers around WGSL programs. Pipelines are cached per material and you can extend the renderer with bespoke shaders.
- **Deterministic resource management**: bind groups, uniform buffers, textures, and pipelines are cached and reused per WebGPU device to avoid dangling GPU resources.

---

## What’s implemented today
- **Core math & scene graph**
  - Vectors, matrices, quaternions, frustums, rays, and bounding helpers.
  - `Object3D` hierarchy with world-matrix propagation and visibility flags.
  - `Scene` traversal updates world matrices and culls invisible branches automatically.
- **Cameras**
  - `Camera` base class with view matrix updates.
  - `PerspectiveCamera` with projection matrix computation and packed view-projection uniform.
- **Renderer** (`WebGPURenderer`)
  - WebGPU adapter/device bootstrap, swapchain and depth buffer setup, pixel ratio management.
  - Frame uniform buffer that stores `viewProj`, camera world position, exposure, and the active directional light shadow matrix.
  - Per-object uniform buffers for model and normal matrices; bind group layouts are fixed so custom pipelines plug in easily.
  - Pipeline cache keyed by material, including standard vertex attribute layouts.
  - Scene traversal that draws visible `Mesh` instances, with automatic shadow pass execution before the main pass.
- **Drawables**
  - `BufferGeometry` with attribute/index storage and GPU buffer uploads.
  - `Mesh` couples geometry and material, just like three.js.
- **Materials**
  - `BasicMaterial`: solid color pipeline used for bring-up and debugging.
  - `StandardMaterial`: skeleton for physically based shading; currently supports base color, lambert-style diffuse, directional light uniforms, and UV transforms.
- **Lighting & shadows**
  - `DirectionalLight` with shadow settings; renderer binds the first visible directional light per frame.
  - Depth-only shadow map pass (1024×1024 by default) with compare sampler.
- **Asset loading**
  - `GLTFLoader` tailored for BrickQuest brick assets.
  - `Texture` and `TextureLoader` with sampler/texture caching.
- **Testing**
  - Browser harness renders a spinning, indexed cube with normals and a directional light.

---

## Quick start
```js
import {
  Scene,
  PerspectiveCamera,
  WebGPURenderer,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  StandardMaterial,
  DirectionalLight
} from './fraggl/index.js';

const canvas = document.querySelector('canvas');
const renderer = new WebGPURenderer({ canvas, clearColor: { r: 0.05, g: 0.05, b: 0.08, a: 1 } });
await renderer.init();

const scene = new Scene();

const camera = new PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
camera.position.set(4, 3, 6);
camera.lookAt(0, 0, 0);

const light = new DirectionalLight({ direction: { x: -0.5, y: -1, z: -0.25 }, intensity: 3.0 });
scene.add(light);

const geometry = new BufferGeometry();
geometry.setAttribute('position', new BufferAttribute(Float32Array.from([...]), 3));
geometry.setAttribute('normal', new BufferAttribute(Float32Array.from([...]), 3));
geometry.setIndex(new BufferAttribute(Uint16Array.from([...]), 1));

const material = new StandardMaterial({ baseColor: [1, 0.7, 0.4] });
const mesh = new Mesh(geometry, material);
scene.add(mesh);

function frame() {
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
```

---

## Renderer architecture
- **Frame uniforms**: `WebGPURenderer` uploads `Frame` data containing the camera view-projection matrix, camera position, exposure, and the directional light shadow matrix once per frame.
- **Model uniforms**: every `Mesh` maintains a GPU buffer with its model matrix and normal matrix; reused between draws to avoid redundant uploads.
- **Material bind groups**: materials describe their uniform layout once. Standard material instances share a bind group layout so textures and lighting uniforms are bound consistently.
- **Shadow pipeline**: the renderer executes a depth-only pass before the main render, writing to a cached shadow map texture and reusing it in the lighting stage.

---

## Shader model
- Shaders are written in WGSL. The default `BasicMaterial` and `StandardMaterial` ship with reference WGSL programs you can copy or extend.
- All fragment shader outputs are assumed to be in linear space and are gamma-encoded to sRGB before storing to the swapchain.
- Extend materials by subclassing `Material`, overriding `getPipelineDefinition`, and providing the WGSL source plus any resource bindings you need. The renderer will cache the resulting pipeline.

---

## Integration notes
- Fraggl exports a three.js-like API surface via `fraggl/index.js`. You can mix it into existing BrickQuest code while progressively replacing three.js usage.
- Because WebGPU state is explicit, avoid implicit global state mutations. Pass references (`renderer`, `scene`, `camera`) down where needed.

---

## Roadmap & known gaps
- **Picking & raycasts**: replacement for the three-mesh-bvh workflow
- **Tools & diagnostics**: GPU timing scopes, renderdoc markers, runtime stats UI.
- **Shadow improvements**: cascaded shadow maps (CSM) and PCF refinements.

