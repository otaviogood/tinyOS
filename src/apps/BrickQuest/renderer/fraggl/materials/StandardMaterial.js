import { Material } from './Material.js';
import standardShader from './shaders/standard.wgsl?raw';

export class StandardMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'StandardMaterial';
        this.baseColor = params.baseColor || [1, 1, 1]; // linear RGB
        this.metallic = params.metallic ?? 0.0;
        this.roughness = params.roughness ?? 0.05;
        this.map = params.map || null; // Texture (sRGB by default)
        this.pipeline = null;
        this.__gpu = null; // { buffer, bindGroup }
    }

    copy(source) {
        super.copy(source);
        this.baseColor = Array.isArray(source.baseColor) ? source.baseColor.slice() : [1, 1, 1];
        this.metallic = source.metallic;
        this.roughness = source.roughness;
        this.map = source.map;
        return this;
    }

    // Self-contained shader code
    getWGSL() {
        return standardShader;
    }

    // Define vertex buffer layout
    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, // position
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }, // normal
            { arrayStride: 2 * 4, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }, // uv
            { arrayStride: 4,     attributes: [{ shaderLocation: 3, offset: 0, format: 'unorm8x4' }] }   // color
        ];
    }

    // Define bind group layout for material-specific resources
    getBindGroupLayout(device) {
        if (!this._bgl) {
            /** @type {GPUBindGroupLayoutEntry[]} */
            const entries = [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: /** @type {GPUBufferBindingType} */('uniform') } }, // Material
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: /** @type {GPUBufferBindingType} */('uniform') } }, // LightBlock
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: /** @type {GPUSamplerBindingType} */('comparison') } }, // shadowSampler
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: /** @type {GPUTextureSampleType} */('depth') } }, // shadowMap
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: /** @type {GPUSamplerBindingType} */('filtering') } }, // baseSampler
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: /** @type {GPUTextureSampleType} */('float') } }  // baseMap
            ];
            this._bgl = device.createBindGroupLayout({ entries });
        }
        return this._bgl;
    }

    // Provide bind group entries (renderer will call this to get material resources)
    getBindGroupEntries(renderer) {
        // Create buffers once
        if (!this._matBuffer) {
            this._matBuffer = renderer.device.createBuffer({ 
                size: 12 * 4, // 48 bytes for material uniforms
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
            });
        }
        if (!this._lightBuffer) {
            this._lightBuffer = renderer.device.createBuffer({ 
                size: 128, // 128 bytes for light block
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
            });
        }

        // Update material uniform buffer with current values
        const hasMap = this.map ? 1 : 0;
        const offset = this.map?.offset || [0, 0];
        const scale = this.map?.repeat || [1, 1];
        const bc = Array.isArray(this.baseColor) ? this.baseColor : [1, 1, 1, 1];
        const alpha = (typeof this.opacity === 'number' ? this.opacity : 1);
        const matData = new Float32Array([
            (bc[0] ?? 1), (bc[1] ?? 1), (bc[2] ?? 1), (bc[3] ?? 1),
            (this.metallic ?? 0), (this.roughness ?? 0.5), hasMap, alpha,
            (offset[0] ?? 0), (offset[1] ?? 0),
            (scale[0] ?? 1), (scale[1] ?? 1)
        ]);
        renderer.device.queue.writeBuffer(this._matBuffer, 0, matData);

        // Update light buffer (get from renderer's frame lights)
        const lights = renderer._frameDirectionalLights || [{ direction: { x: 0, y: -1, z: -1 }, intensity: 1.0, color: [1, 1, 1], shadow: { radius: 1.0 } }];
        const count = Math.min(3, lights.length);
        const ab = new ArrayBuffer(128);
        const dv = new DataView(ab);
        let baseOffset = 0;
        for (let i = 0; i < 3; i++) {
            const L = i < count ? lights[i] : { direction: { x: 0, y: -1, z: -1 }, intensity: 0.0, color: [0, 0, 0], shadow: { radius: 1.0 } };
            const dir = [L.direction.x, L.direction.y, L.direction.z];
            const len = Math.hypot(dir[0], dir[1], dir[2]) || 1.0;
            const nd0 = dir[0] / len, nd1 = dir[1] / len, nd2 = dir[2] / len;
            const radius = (L.shadow && L.shadow.radius) ? L.shadow.radius : 1.0;
            dv.setFloat32(baseOffset + 0, nd0, true);
            dv.setFloat32(baseOffset + 4, nd1, true);
            dv.setFloat32(baseOffset + 8, nd2, true);
            dv.setFloat32(baseOffset + 12, L.intensity, true);
            dv.setFloat32(baseOffset + 16, L.color[0], true);
            dv.setFloat32(baseOffset + 20, L.color[1], true);
            dv.setFloat32(baseOffset + 24, L.color[2], true);
            const effectiveRadius = (i === 0 && lights[0] && lights[0].castShadow === true) ? radius : 0.0;
            dv.setFloat32(baseOffset + 28, effectiveRadius, true);
            baseOffset += 32;
        }
        dv.setUint32(96, count, true);
        dv.setUint32(100, (renderer._frameShadowsEnabled | 0), true);
        renderer.device.queue.writeBuffer(this._lightBuffer, 0, ab);

        // Get texture and sampler
        const texture = this.map && this.map.image ? this.map : null;
        let sampler, textureView;
        if (texture) {
            textureView = renderer.getTextureView(texture);
            sampler = renderer.getOrCreateSampler(texture);
        }
        if (!textureView) {
            textureView = renderer.getFallbackTextureView();
            sampler = renderer.getFallbackSampler();
        }

        // Return entries (bind group will be cached by renderer based on these)
        return [
            { binding: 0, resource: { buffer: this._matBuffer } },
            { binding: 1, resource: { buffer: this._lightBuffer } },
            { binding: 2, resource: renderer.shadowSampler },
            { binding: 3, resource: renderer.shadowView },
            { binding: 4, resource: sampler },
            { binding: 5, resource: textureView }
        ];
    }

    // Set vertex buffers for rendering
    setVertexBuffers(pass, renderer, gpu, geo, mesh) {
        // Buffer 0: position (shared - cached on geometry)
        pass.setVertexBuffer(0, gpu.position);
        
        // Buffer 1: normal (shared - cached on geometry, or default)
        if (!gpu.normal) {
            const normalAttr = geo.attributes.get('normal');
            if (normalAttr) {
                gpu.normal = renderer.device.createBuffer({ 
                    size: normalAttr.array.byteLength, 
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST 
                });
                renderer.device.queue.writeBuffer(gpu.normal, 0, normalAttr.array);
            }
        }
        if (!gpu.normal && !gpu.defaultNormal) {
            const count = geo.vertexCount || 1;
            const data = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                data[i * 3 + 2] = 1.0; // default normal pointing up
            }
            gpu.defaultNormal = renderer.device.createBuffer({ 
                size: data.byteLength, 
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST 
            });
            renderer.device.queue.writeBuffer(gpu.defaultNormal, 0, data);
        }
        pass.setVertexBuffer(1, gpu.normal || gpu.defaultNormal);
        
        // Buffer 2: uv (shared - cached on geometry, or default)
        if (!gpu.uv) {
            const uvAttr = geo.attributes.get('uv') || geo.attributes.get('uv0') || geo.attributes.get('uv1');
            if (uvAttr) {
                gpu.uv = renderer.device.createBuffer({ 
                    size: uvAttr.array.byteLength, 
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST 
                });
                renderer.device.queue.writeBuffer(gpu.uv, 0, uvAttr.array);
            }
        }
        if (!gpu.uv && !gpu.defaultUV) {
            const count = geo.vertexCount || 1;
            const data = new Float32Array(count * 2); // zeros
            gpu.defaultUV = renderer.device.createBuffer({ 
                size: data.byteLength, 
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST 
            });
            renderer.device.queue.writeBuffer(gpu.defaultUV, 0, data);
        }
        pass.setVertexBuffer(2, gpu.uv || gpu.defaultUV);
        
        // Buffer 3: color
        // If geometry has color attribute, use it (shared)
        // Otherwise use default white (shared)
        const colorAttr = geo.attributes.get('color');
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
        
        if (!colorAttr && !gpu.defaultColor) {
            const count = geo.vertexCount || 1;
            const data = new Uint8Array(count * 4).fill(255); // white
            gpu.defaultColor = renderer.device.createBuffer({ 
                size: data.byteLength, 
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST 
            });
            renderer.device.queue.writeBuffer(gpu.defaultColor, 0, data);
        }
        
        pass.setVertexBuffer(3, gpu.color || gpu.defaultColor);
    }
}


