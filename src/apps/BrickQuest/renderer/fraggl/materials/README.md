# Fraggl Material System

**Self-contained materials with plain WGSL shaders.** No chunks, no composition, no JavaScript wrappers.

## Quick Start

### 1. Write a shader (plain `.wgsl` file)

```wgsl
// shaders/myshader.wgsl
struct Frame { viewProj: mat4x4f, cameraPos: vec3f, exposure: f32, lightViewProj: mat4x4f };

@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;

@vertex fn vs_main(@location(0) pos: vec3f) -> @builtin(position) vec4f {
    return u_frame.viewProj * (u_model * vec4f(pos, 1.0));
}

@fragment fn fs_main() -> @location(0) vec4f {
    return vec4f(1.0, 0.0, 0.0, 1.0);
}
```

### 2. Create a material class

```javascript
import { Material } from './Material.js';
import myShader from './shaders/myshader.wgsl?raw';

export class MyMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'MyMaterial';
    }

    getWGSL() {
        return myShader;
    }

    getVertexBufferLayouts() {
        return [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }
        ];
    }

    setVertexBuffers(pass, renderer, gpu, geo, mesh) {
        pass.setVertexBuffer(0, gpu.position);
    }
}
```

### 3. Use it

```javascript
const mat = new MyMaterial();
const mesh = new Mesh(geometry, mat);
```

## Architecture

### Bind Group Convention

All Fraggl materials use 3 bind groups:

```wgsl
// Group 0: Frame uniforms (renderer provides)
@group(0) @binding(0) var<uniform> u_frame: Frame;

// Group 1: Per-object transforms (renderer provides)
@group(1) @binding(0) var<uniform> u_model: mat4x4f;
@group(1) @binding(1) var<uniform> u_normal: mat3x3f;

// Group 2: Material resources (your material provides)
@group(2) @binding(0) var<uniform> u_mat: YourMaterialStruct;
@group(2) @binding(1) var yourSampler: sampler;
@group(2) @binding(2) var yourTexture: texture_2d<f32>;
```

### Required Methods

Every material must implement:

- **`getWGSL()`** - Returns shader code string
- **`getVertexBufferLayouts()`** - Returns vertex buffer layout array
- **`setVertexBuffers(pass, renderer, gpu, geo, mesh)`** - Binds vertex buffers

### Optional Methods

- **`getBindGroupLayout(device)`** - Returns bind group layout for group 2
- **`getBindGroupEntries(renderer)`** - Returns bind group entries for group 2
- **`getPipelineState()`** - Returns `{ cullMode, depthWriteEnabled, depthCompare }`

## Built-in Materials

### BasicMaterial
Unlit with vertex colors or solid material color.

```javascript
new BasicMaterial({ color: [1, 0, 0, 1] })
```

### StandardMaterial  
PBR-like with lighting, shadows, and textures.

```javascript
new StandardMaterial({ 
    baseColor: [0.8, 0.2, 0.2], 
    roughness: 0.5, 
    metallic: 0.0,
    map: texture 
})
```

### SkyboxMaterial
Skybox rendering with texture.

```javascript
new SkyboxMaterial({ map: skyTexture })
```

### LineBasicMaterial
Line rendering.

```javascript
new LineBasicMaterial({ color: [1, 1, 0, 1] })
```

### WireframeMaterial
Debug wireframe using barycentric coordinates.

```javascript
new WireframeMaterial({ 
    color: [1, 0.6, 0.2, 1], 
    thickness: 1.5 
})
```

## Common Patterns

### Material with Uniform

```javascript
getBindGroupLayout(device) {
    return device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
    });
}

getBindGroupEntries(renderer) {
    if (!this._buffer) {
        this._buffer = renderer.device.createBuffer({
            size: 16, // Must be 16-byte aligned
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
    }
    
    const data = new Float32Array([this.myValue, 0, 0, 0]);
    renderer.device.queue.writeBuffer(this._buffer, 0, data);
    
    return [{ binding: 0, resource: { buffer: this._buffer } }];
}
```

### Material with Texture

```javascript
getBindGroupLayout(device) {
    return device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
        ]
    });
}

getBindGroupEntries(renderer) {
    const textureView = this.map ? renderer.getTextureView(this.map) : renderer.getFallbackTextureView();
    const sampler = this.map ? renderer.getOrCreateSampler(this.map) : renderer.getFallbackSampler();
    
    return [
        { binding: 0, resource: sampler },
        { binding: 1, resource: textureView }
    ];
}
```

### Vertex Buffers with Material Color

```javascript
setVertexBuffers(pass, renderer, gpu, geo, mesh) {
    pass.setVertexBuffer(0, gpu.position);
    
    // If no geometry color, create solid color buffer from material.color
    const colorAttr = geo.attributes.get('color');
    if (!colorAttr) {
        let meshCache = renderer._objCache.get(mesh);
        if (!meshCache) {
            meshCache = {};
            renderer._objCache.set(mesh, meshCache);
        }
        
        const count = geo.vertexCount || 1;
        const rgba = this.color;
        const r = Math.round((rgba[0] ?? 1) * 255);
        const g = Math.round((rgba[1] ?? 1) * 255);
        const b = Math.round((rgba[2] ?? 1) * 255);
        const a = Math.round((rgba[3] ?? 1) * 255);
        const colorKey = (r << 24) | (g << 16) | (b << 8) | a;
        
        if (!meshCache.colorBuffer || meshCache._colorKey !== colorKey) {
            const data = new Uint8Array(count * 4);
            for (let i = 0; i < count; i++) {
                data[i*4] = r; data[i*4+1] = g; data[i*4+2] = b; data[i*4+3] = a;
            }
            meshCache.colorBuffer = renderer.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
            renderer.device.queue.writeBuffer(meshCache.colorBuffer, 0, data);
            meshCache._colorKey = colorKey;
        }
        
        pass.setVertexBuffer(1, meshCache.colorBuffer);
    }
}
```

## Important Notes

### WGSL Uniform Alignment

Uniform buffers have strict alignment rules:
- `f32` - 4 bytes, 4-byte aligned
- `vec2f` - 8 bytes, 8-byte aligned
- `vec3f` - 12 bytes, **16-byte aligned** ⚠️
- `vec4f` - 16 bytes, 16-byte aligned

**Tip:** Use `vec4f` instead of `vec3f` in uniforms to avoid padding issues.

### Gamma Correction

Always gamma encode at the end of your fragment shader:

```wgsl
color = pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2));
```

### Vertex Count

Get vertex count from geometry:

```javascript
const count = geo.vertexCount || 1;
```

### Caching

- **Cache on geometry (`gpu`)** - Shared buffers (position, normal, UV)
- **Cache on mesh (`renderer._objCache.get(mesh)`)** - Per-mesh buffers (material colors)
- **Cache on material (`this._buffer`)** - Material uniforms

## File Organization

```
materials/
  shaders/
    basic.wgsl          - BasicMaterial shader
    standard.wgsl       - StandardMaterial shader  
    skybox.wgsl         - SkyboxMaterial shader
    line.wgsl           - LineBasicMaterial shader
    wireframe.wgsl      - WireframeMaterial shader
  BasicMaterial.js
  StandardMaterial.js
  SkyboxMaterial.js
  LineBasicMaterial.js
  WireframeMaterial.js
  Material.js           - Base class
```

## Tips

1. **Start simple** - Copy `BasicMaterial.js` and modify
2. **Vite import** - Use `import shader from './shaders/myshader.wgsl?raw'`
3. **Test incrementally** - Small changes, verify often
4. **Watch console** - WGSL errors show up in browser console
5. **Use vec4f** - Avoid vec3f in uniforms (alignment issues)

## WebGPU-Specific

- WGSL types: `vec3f` (not `vec3`), `f32` (not `float`)
- Entry points: `vs_main` and `fs_main`
- No `#include` - Use JavaScript imports for shader reuse
- Manual sRGB encoding required
- Explicit bind group layouts

---

**Result:** A clean, maintainable system where custom materials are just a `.wgsl` file + a minimal Material class. No framework complexity, just straightforward WebGPU rendering.

