import { Material } from './Material.js';
import wireframeShader from './shaders/wireframe.wgsl?raw';

/**
 * WireframeMaterial - Simple example of a custom material
 * Shows how easy it is to create materials with plain .wgsl files
 */
export class WireframeMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'WireframeMaterial';
        this.color = params.color || [0, 1, 0, 1];
        this.thickness = params.thickness ?? 1.0;
        this.transparent = true; // Wireframes need transparency for edge rendering
        this.depthWrite = false;
    }

    copy(source) {
        super.copy(source);
        this.color = Array.isArray(source.color) ? source.color.slice() : [0, 1, 0, 1];
        this.thickness = source.thickness;
        return this;
    }

    getWGSL() {
        return wireframeShader;
    }

    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }
        ];
    }

    getPipelineState() {
        return {
            cullMode: 'none', // Show both sides for wireframe
            depthWriteEnabled: false, // Don't write depth for transparent wireframes
            depthCompare: 'less'
        };
    }

    getBindGroupLayout(device) {
        if (!this._bgl) {
            this._bgl = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: /** @type {GPUBufferBindingType} */('uniform') } }
                ]
            });
        }
        return this._bgl;
    }

    getBindGroupEntries(renderer) {
        if (!this._buffer) {
            this._buffer = renderer.device.createBuffer({
                size: 48, // vec4(16) + f32(4) + padding(12) + vec3(12) = 48 bytes (WGSL uniform alignment)
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
        }

        // WGSL uniform buffer layout:
        // - vec4f color: offset 0, size 16
        // - f32 thickness: offset 16, size 4
        // - padding to align vec3f: 12 bytes
        // - vec3f _pad: offset 32, size 12
        const data = new Float32Array(12); // 48 bytes / 4 = 12 floats
        data[0] = this.color[0] ?? 0;
        data[1] = this.color[1] ?? 1;
        data[2] = this.color[2] ?? 0;
        data[3] = this.color[3] ?? 1;
        data[4] = this.thickness ?? 1.0;
        // data[5-7] implicit zeros for padding
        // data[8-10] implicit zeros for _pad vec3f
        
        renderer.device.queue.writeBuffer(this._buffer, 0, data);

        return [
            { binding: 0, resource: { buffer: this._buffer } }
        ];
    }

    setVertexBuffers(pass, renderer, gpu, geo) {
        pass.setVertexBuffer(0, gpu.position);
    }
}

