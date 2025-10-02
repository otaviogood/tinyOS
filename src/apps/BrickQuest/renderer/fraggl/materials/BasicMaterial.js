import { Material } from './Material.js';
import basicShader from './shaders/basic.wgsl?raw';

export class BasicMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'BasicMaterial';
        this.color = params.color || [1, 0, 0, 1];
        this.pipeline = null; // cached GPU pipeline
    }

    // Self-contained shader code
    getWGSL() {
        return basicShader;
    }

    // Define vertex buffer layout
    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, // position
            { arrayStride: 4,     attributes: [{ shaderLocation: 1, offset: 0, format: 'unorm8x4' }] }   // color
        ];
    }

    // Set vertex buffers for rendering
    setVertexBuffers(pass, renderer, gpu, geo, mesh) {
        // Buffer 0: position (shared - cached on geometry)
        pass.setVertexBuffer(0, gpu.position);
        
        // Buffer 1: color
        const colorAttr = geo.attributes.get('color');
        
        // If geometry has color attribute, use it (shared, cached on geometry)
        if (colorAttr && !gpu.color) {
            let uploadArray = colorAttr.array;
            const stride = colorAttr.itemSize || 4;
            let count = colorAttr.count;
            if (!Number.isFinite(count)) {
                count = Math.floor(uploadArray.length / stride);
            }
            
            // Convert to Uint8Array with 4 components if needed
            if (!(uploadArray instanceof Uint8Array) || stride !== 4) {
                const packed = new Uint8Array(count * 4);
                for (let i = 0; i < count; i++) {
                    const base = i * stride;
                    if (uploadArray instanceof Uint8Array) {
                        packed[i * 4 + 0] = uploadArray[base + 0] ?? 255;
                        packed[i * 4 + 1] = uploadArray[base + 1] ?? packed[i * 4 + 0];
                        packed[i * 4 + 2] = uploadArray[base + 2] ?? packed[i * 4 + 1];
                        packed[i * 4 + 3] = stride > 3 ? (uploadArray[base + 3] ?? 255) : 255;
                    } else {
                        // Float array - convert to Uint8
                        const r = uploadArray[base + 0] ?? 1;
                        const g = uploadArray[base + 1] ?? r;
                        const b = uploadArray[base + 2] ?? g;
                        const a = stride > 3 ? (uploadArray[base + 3] ?? 1) : 1;
                        packed[i * 4 + 0] = Math.max(0, Math.min(255, Math.round(r * 255)));
                        packed[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
                        packed[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
                        packed[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
                    }
                }
                uploadArray = packed;
            }
            
            gpu.color = renderer.device.createBuffer({
                size: uploadArray.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
            renderer.device.queue.writeBuffer(gpu.color, 0, uploadArray);
        }
        
        // If no geometry color, use material.color (per-mesh, cached on mesh)
        if (!colorAttr) {
            // Get mesh cache from renderer
            let meshCache = renderer._objCache.get(mesh);
            if (!meshCache) {
                meshCache = {};
                renderer._objCache.set(mesh, meshCache);
            }
            
            const count = geo.vertexCount || 1;
            const matColor = Array.isArray(this.color) ? this.color : [1, 0, 0, 1];
            const r = Math.max(0, Math.min(255, Math.round((matColor[0] ?? 1) * 255)));
            const g = Math.max(0, Math.min(255, Math.round((matColor[1] ?? 0) * 255)));
            const b = Math.max(0, Math.min(255, Math.round((matColor[2] ?? 0) * 255)));
            const a = Math.max(0, Math.min(255, Math.round((matColor[3] ?? 1) * 255)));
            const colorKey = (r << 24) | (g << 16) | (b << 8) | a;
            
            // Only recreate buffer if color or vertex count changed
            if (!meshCache.basicMaterialColorBuffer || meshCache._colorKey !== colorKey || meshCache._colorCount !== count) {
                const data = new Uint8Array(count * 4);
                for (let i = 0; i < count; i++) {
                    const offset = i * 4;
                    data[offset + 0] = r;
                    data[offset + 1] = g;
                    data[offset + 2] = b;
                    data[offset + 3] = a;
                }
                
                meshCache.basicMaterialColorBuffer = renderer.device.createBuffer({
                    size: data.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                renderer.device.queue.writeBuffer(meshCache.basicMaterialColorBuffer, 0, data);
                meshCache._colorKey = colorKey;
                meshCache._colorCount = count;
            }
            
            pass.setVertexBuffer(1, meshCache.basicMaterialColorBuffer);
            return;
        }
        
        pass.setVertexBuffer(1, gpu.color);
    }
}


