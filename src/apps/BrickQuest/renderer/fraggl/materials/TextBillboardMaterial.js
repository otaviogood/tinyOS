import { Material } from './Material.js';
import textBillboardShader from './shaders/textBillboard.wgsl?raw';

/**
 * Material for rendering text billboards with transparency
 * Simple unlit material with alpha blending from texture
 */
export class TextBillboardMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'TextBillboardMaterial';
        this.map = params.map || null; // Texture
        this.color = params.color || [1, 1, 1, 1]; // Tint color
        this.pipeline = null;
    }

    copy(source) {
        super.copy(source);
        this.map = source.map;
        this.color = Array.isArray(source.color) ? source.color.slice() : [1, 1, 1, 1];
        return this;
    }

    getWGSL() {
        return textBillboardShader;
    }

    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, // position
            { arrayStride: 2 * 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] }, // uv
        ];
    }

    getBindGroupLayout(device) {
        if (!this._bgl) {
            const entries = [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, // color
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
            ];
            this._bgl = device.createBindGroupLayout({ entries });
        }
        return this._bgl;
    }

    getBindGroupEntries(renderer) {
        // Create uniform buffer for color
        if (!this._colorBuffer) {
            this._colorBuffer = renderer.device.createBuffer({
                size: 16, // vec4f
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
        }

        // Update color
        const c = Array.isArray(this.color) ? this.color : [1, 1, 1, 1];
        const colorData = new Float32Array([c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1]);
        renderer.device.queue.writeBuffer(this._colorBuffer, 0, colorData);

        // Get texture view and sampler (check if texture has image property set)
        const texture = this.map && this.map.image ? this.map : null;
        let sampler, textureView;
        if (texture) {
            textureView = renderer.getTextureView(texture);
            sampler = renderer.getOrCreateSampler(texture);
        }
        // Fall back to default texture if none provided or not ready
        if (!textureView) {
            textureView = renderer.getFallbackTextureView();
            sampler = renderer.getFallbackSampler();
        }

        return [
            { binding: 0, resource: { buffer: this._colorBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: textureView }
        ];
    }

    setVertexBuffers(pass, renderer, gpu, geo, mesh) {
        // Position buffer
        pass.setVertexBuffer(0, gpu.position);
        
        // UV buffer
        const uvAttr = geo.attributes.get('uv');
        if (uvAttr && !gpu.uv) {
            const data = uvAttr.array;
            gpu.uv = renderer.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
            renderer.device.queue.writeBuffer(gpu.uv, 0, data);
        }
        
        if (gpu.uv) {
            pass.setVertexBuffer(1, gpu.uv);
        }
    }

    getPipelineState() {
        return {
            cullMode: 'none',
            depthWriteEnabled: this.depthWrite,
            depthCompare: this.depthTest ? 'less' : 'always'
        };
    }
}

