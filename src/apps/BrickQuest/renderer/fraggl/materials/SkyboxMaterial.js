import { Material } from './Material.js';
import skyboxShader from './shaders/skybox.wgsl?raw';

export class SkyboxMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'SkyboxMaterial';
        this.map = params.map || null; // Texture
        this.uvOffset = params.uvOffset || [0, 0];
        this.uvScale = params.uvScale || [1, 1];
        this.transparent = false;
        // Draw first with depth test enabled and no depth writes so world can overdraw
        this.depthTest = true;
        this.depthWrite = false;
        this.isSkybox = true;
    }

    copy(source) {
        super.copy(source);
        this.map = source.map;
        this.uvOffset = Array.isArray(source.uvOffset) ? source.uvOffset.slice() : [0, 0];
        this.uvScale = Array.isArray(source.uvScale) ? source.uvScale.slice() : [1, 1];
        return this;
    }

    // Provide material-owned WGSL to keep renderer generic
    getWGSL() {
        return skyboxShader;
    }

    // Renderer can request the bind group layout for this material
    getBindGroupLayout(device) {
        if (!this._bgl) {
            this._bgl = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: /** @type {GPUSamplerBindingType} */('filtering') } },
                    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: /** @type {GPUTextureSampleType} */('float') } }
                ]
            });
        }
        return this._bgl;
    }

    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 2 * 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] }
        ];
    }

    setVertexBuffers(pass, renderer, gpu, geo) {
        pass.setVertexBuffer(0, gpu.position);
        // Fallback to default UV buffer if renderer helper is private
        if (!gpu.uv) {
            const attr = geo && geo.attributes && (geo.attributes.get ? (geo.attributes.get('uv') || geo.attributes.get('uv0') || geo.attributes.get('uv1')) : (geo.attributes.uv || geo.attributes.uv0 || geo.attributes.uv1));
            if (attr && renderer && renderer.device && !gpu.uv) {
                gpu.uv = renderer.device.createBuffer({ size: attr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(gpu.uv, 0, attr.array);
            }
        }
        if (gpu.uv) pass.setVertexBuffer(1, gpu.uv);
    }

    getPipelineState() {
        // As a normal mesh, we still want front-face culling and no depth write
        // Use 'less-equal' so skybox fragments at the far plane are not rejected
        return { cullMode: 'front', depthWriteEnabled: false, depthCompare: 'less-equal' };
    }

    getBindGroupEntries(renderer) {
        const texture = this.map && this.map.image ? this.map : null;
        let sampler = null, textureView = null;
        if (texture) {
            textureView = renderer.getTextureView(texture);
            sampler = renderer.getOrCreateSampler(texture);
        }
        if (!textureView) {
            textureView = renderer.getFallbackTextureView();
            sampler = renderer.getFallbackSampler();
        }
        if (!textureView || !sampler) return null;
        return [
            { binding: 0, resource: sampler },
            { binding: 1, resource: textureView }
        ];
    }
}


