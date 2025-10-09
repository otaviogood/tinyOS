import { Material } from './Material.js';
import classicShader from './shaders/classic.wgsl?raw';

export class ClassicMaterial extends Material {
    constructor(params = {}) {
        super(params);
        this.type = 'ClassicMaterial';
        this.pipeline = null;
        this._bgl = null;
        this._lightBuffer = null;
    }

    getWGSL() {
        return classicShader;
    }

    getVertexBufferLayouts() {
        return [
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            // classicInfo packed as uint32 per-vertex
            { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'uint32' }] },
            // center attribute: vec3f
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] },
            // axisX, axisY attributes: vec3f each
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }] },
            { arrayStride: 3 * 4, attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x3' }] },
            // rgba8 color packed as uint32 per-vertex (R in LSB, A in MSB)
            { arrayStride: 4, attributes: [{ shaderLocation: 5, offset: 0, format: 'uint32' }] }
        ];
    }

    setVertexBuffers(pass, renderer, gpu, geo/*, mesh */) {
        pass.setVertexBuffer(0, gpu.position);
        // Ensure classicInfo buffer is available and bound for slot 1
        if (!gpu.classicInfo && renderer && renderer.device && geo && typeof geo.getAttribute === 'function') {
            const attr = geo.getAttribute('classicInfo');
            if (attr && attr.array) {
                gpu.classicInfo = renderer.device.createBuffer({ size: attr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(
                    gpu.classicInfo,
                    0,
                    new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)
                );
            } else {
                // Fallback: bind a zeroed buffer matching vertex count so slot 1 is always set
                const posAttr = geo.getAttribute('position');
                const count = posAttr && Number.isFinite(posAttr.count) ? (posAttr.count | 0) : 0;
                const zeros = new Uint32Array(Math.max(1, count));
                gpu.classicInfo = renderer.device.createBuffer({ size: zeros.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(gpu.classicInfo, 0, zeros);
            }
        }
        // Bind slot 1 regardless (must be set to satisfy pipeline requirements)
        if (gpu.classicInfo) {
            pass.setVertexBuffer(1, gpu.classicInfo);
        } else {
            // Absolute fallback: create a 4-byte zero buffer
            const zeros = new Uint32Array(1);
            gpu.classicInfo = renderer.device.createBuffer({ size: 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            renderer.device.queue.writeBuffer(gpu.classicInfo, 0, zeros);
            pass.setVertexBuffer(1, gpu.classicInfo);
        }

        // Ensure center buffer for slot 2
        if (!gpu.center && renderer && renderer.device && geo && typeof geo.getAttribute === 'function') {
            const attr = geo.getAttribute('center');
            if (attr && attr.array) {
                gpu.center = renderer.device.createBuffer({ size: attr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(
                    gpu.center,
                    0,
                    new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)
                );
            }
        }
        if (gpu.center) {
            pass.setVertexBuffer(2, gpu.center);
        } else {
            // Fallback: bind dummy zero vec3 to satisfy layout
            if (!gpu.center) {
                const zeros = new Float32Array(3);
                gpu.center = renderer.device.createBuffer({ size: zeros.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(gpu.center, 0, zeros);
            }
            pass.setVertexBuffer(2, gpu.center);
        }

        // axisX buffer (slot 3)
        if (!gpu.axisX && renderer && renderer.device && geo && typeof geo.getAttribute === 'function') {
            const attr = geo.getAttribute('axisX');
            if (attr && attr.array) {
                gpu.axisX = renderer.device.createBuffer({ size: attr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(
                    gpu.axisX,
                    0,
                    new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)
                );
            }
        }
        if (gpu.axisX) {
            pass.setVertexBuffer(3, gpu.axisX);
        } else {
            if (!gpu.axisX) {
                const zeros = new Float32Array(3);
                gpu.axisX = renderer.device.createBuffer({ size: zeros.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(gpu.axisX, 0, zeros);
            }
            pass.setVertexBuffer(3, gpu.axisX);
        }

        // axisY buffer (slot 4)
        if (!gpu.axisY && renderer && renderer.device && geo && typeof geo.getAttribute === 'function') {
            const attr = geo.getAttribute('axisY');
            if (attr && attr.array) {
                gpu.axisY = renderer.device.createBuffer({ size: attr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(
                    gpu.axisY,
                    0,
                    new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)
                );
            }
        }
        if (gpu.axisY) {
            pass.setVertexBuffer(4, gpu.axisY);
        } else {
            if (!gpu.axisY) {
                const zeros = new Float32Array(3);
                gpu.axisY = renderer.device.createBuffer({ size: zeros.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(gpu.axisY, 0, zeros);
            }
            pass.setVertexBuffer(4, gpu.axisY);
        }

        // rgba8 color buffer (slot 5)
        if (!gpu.rgba8 && renderer && renderer.device && geo && typeof geo.getAttribute === 'function') {
            const attr = geo.getAttribute('rgba8');
            if (attr && attr.array) {
                gpu.rgba8 = renderer.device.createBuffer({ size: attr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(
                    gpu.rgba8,
                    0,
                    new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)
                );
            } else {
                const posAttr = geo.getAttribute('position');
                const count = posAttr && Number.isFinite(posAttr.count) ? (posAttr.count | 0) : 0;
                const zeros = new Uint32Array(Math.max(1, count));
                gpu.rgba8 = renderer.device.createBuffer({ size: zeros.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                renderer.device.queue.writeBuffer(gpu.rgba8, 0, zeros);
            }
        }
        if (gpu.rgba8) {
            pass.setVertexBuffer(5, gpu.rgba8);
        }
    }

    getPipelineState() {
        // As a normal mesh, we still want front-face culling and no depth write
        // Use 'less-equal' so skybox fragments at the far plane are not rejected
        return { cullMode: 'back', depthWriteEnabled: true, depthCompare: 'less-equal' };
    }

    // Bind lights uniform + shadow resources similar to StandardMaterial
    getBindGroupLayout(device) {
        if (!this._bgl) {
            /** @type {GPUBindGroupLayoutEntry[]} */
            const entries = [
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: /** @type {GPUBufferBindingType} */('uniform') } }, // LightBlock
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: /** @type {GPUSamplerBindingType} */('comparison') } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: /** @type {GPUTextureSampleType} */('depth') } }
            ];
            this._bgl = device.createBindGroupLayout({ entries });
        }
        return this._bgl;
    }

    getBindGroupEntries(renderer) {
        // Ensure light buffer exists and is updated per frame
        if (!this._lightBuffer) {
            this._lightBuffer = renderer.device.createBuffer({
                size: 128,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
        }

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

        return [
            { binding: 1, resource: { buffer: this._lightBuffer } },
            { binding: 2, resource: renderer.shadowSampler },
            { binding: 3, resource: renderer.shadowView }
        ];
    }

}



