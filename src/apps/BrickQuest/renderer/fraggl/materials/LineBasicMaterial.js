import { Material } from './Material.js';
import lineShader from './shaders/line.wgsl?raw';

export class LineBasicMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'LineBasicMaterial';
        // RGBA in 0..1, matches BasicMaterial convention
        this.color = params.color || [1, 1, 0, 1];
        this.depthTest = params.depthTest ?? true;
        this.depthWrite = params.depthWrite ?? false;
        this.transparent = params.transparent ?? false;
        this.linewidth = params.linewidth ?? 1; // future: expand to wide lines via shader
    }

    getWGSL() {
        return lineShader;
    }

    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, // position
            { arrayStride: 4,     attributes: [{ shaderLocation: 1, offset: 0, format: 'unorm8x4' }] }   // color
        ];
    }

    getPipelineState() {
        return {
            cullMode: 'none', // Lines have no culling
            depthWriteEnabled: this.depthWrite,
            depthCompare: this.depthTest ? 'less' : 'always'
        };
    }

    setVertexBuffers(pass, renderer, gpu, geo, mesh) {
        // Buffer 0: position
        pass.setVertexBuffer(0, gpu.position);
        
        // Buffer 1: color from material.color (per-mesh)
        let meshCache = renderer._objCache.get(mesh);
        if (!meshCache) {
            meshCache = {};
            renderer._objCache.set(mesh, meshCache);
        }
        
        const count = geo.vertexCount || 1;
        const matColor = Array.isArray(this.color) ? this.color : [1, 1, 0, 1];
        const r = Math.max(0, Math.min(255, Math.round((matColor[0] ?? 1) * 255)));
        const g = Math.max(0, Math.min(255, Math.round((matColor[1] ?? 1) * 255)));
        const b = Math.max(0, Math.min(255, Math.round((matColor[2] ?? 0) * 255)));
        const a = Math.max(0, Math.min(255, Math.round((matColor[3] ?? 1) * 255)));
        const colorKey = (r << 24) | (g << 16) | (b << 8) | a;
        
        if (!meshCache.lineColorBuffer || meshCache._lineColorKey !== colorKey || meshCache._lineColorCount !== count) {
            const data = new Uint8Array(count * 4);
            for (let i = 0; i < count; i++) {
                const offset = i * 4;
                data[offset + 0] = r;
                data[offset + 1] = g;
                data[offset + 2] = b;
                data[offset + 3] = a;
            }
            
            meshCache.lineColorBuffer = renderer.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
            renderer.device.queue.writeBuffer(meshCache.lineColorBuffer, 0, data);
            meshCache._lineColorKey = colorKey;
            meshCache._lineColorCount = count;
        }
        
        pass.setVertexBuffer(1, meshCache.lineColorBuffer);
    }
}


