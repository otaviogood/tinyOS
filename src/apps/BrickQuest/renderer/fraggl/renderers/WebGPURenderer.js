import { Matrix4 } from "../math/Matrix4.js";
import { Vector3 } from "../math/Vector3.js";
import { Material as FragglMaterial } from "../materials/Material.js";

const WRAP_MODE_MAP = {
    repeat: 'repeat',
    'clamp-to-edge': 'clamp-to-edge',
    'mirror-repeat': 'mirror-repeat'
};

const FILTER_MODE_MAP = {
    nearest: 'nearest',
    linear: 'linear'
};

export class WebGPURenderer {
    constructor(params = {}) {
        this.canvas = params.canvas || null;
        this.device = null;
        this.context = null;
        this.format = null;
        this.depthTexture = null;
        this.depthView = null;
        this.clearColor = params.clearColor || { r: 0, g: 0, b: 0, a: 1 };
        this.size = { width: 1, height: 1 };
        this.pixelRatio = 1;
        this.exposure = params.exposure ?? 1.0;
        this.outputColorSpace = 'srgb';
        this._configured = false;
        this.pipelineCache = new Map();
        this._pipelinePerMaterial = new WeakMap();
        this.info = { render: { calls: 0 }, reset: () => { this.info.render.calls = 0; } };
        // Per-device GPU resource caches to avoid cross-device buffer usage
        this._geoCache = new WeakMap();  // BufferGeometry -> { position, normal, color, uv, index, indexFormat, defaultUV }
        this._objCache = new WeakMap();  // Object3D -> { modelBuffer, normalBuffer, modelBindGroup }
        this._matCache = new WeakMap();  // Material -> { custom material cache }
        this._textureCache = new WeakMap(); // Texture -> { texture, view, width, height, format, version }
        this._samplerCache = new Map(); // key: `${min}:${mag}:${wrapS}:${wrapT}:${mip}` -> GPUSampler
        this._fallbackTextureInfo = null;
        this._fallbackSampler = null;
        this.disableShadows = false;
    }

    // Public helpers for materials to use (wrap private caches)
    getTextureView(texture) {
        const info = this.#getTextureGPU ? this.#getTextureGPU(texture) : null;
        return info ? info.view : null;
    }
    getOrCreateSampler(texture) {
        return this.#getSamplerForTexture ? this.#getSamplerForTexture(texture) : null;
    }
    getFallbackTextureView() {
        const fb = this.#getFallbackTexture ? this.#getFallbackTexture() : null;
        return fb ? fb.view : null;
    }
    getFallbackSampler() {
        return this.#getFallbackSampler ? this.#getFallbackSampler() : null;
    }

    _recreateShadowResources(size) {
        if (this.shadowTexture) this.shadowTexture.destroy?.();
        this.shadowTexture = this.device.createTexture({ size: { width: size, height: size, depthOrArrayLayers: 1 }, format: /** @type {GPUTextureFormat} */(this._shadowDepthFormat), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.shadowView = this.shadowTexture.createView();
    }

    async init(canvas) {
        this.canvas = canvas || this.canvas;
        if (!navigator.gpu) throw new Error('WebGPU not supported');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No GPU adapter');
        
        // Request timestamp-query feature for accurate GPU timings if available
        /** @type {GPUFeatureName[]} */
        const features = [];
        if (adapter.features.has('timestamp-query')) {
            features.push('timestamp-query');
            this._supportsTimestampQuery = true;
        } else {
            this._supportsTimestampQuery = false;
            console.warn('WebGPU timestamp-query feature not supported on this device. GPU timing will not be available.');
        }
        
        this.device = await adapter.requestDevice({ requiredFeatures: features });
        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this._configureContext();
        this.setSize(this.canvas.clientWidth || this.canvas.width, this.canvas.clientHeight || this.canvas.height);

        // Create a frame uniform buffer (viewProj, cameraPos, exposure, lightViewProj, lightDirWS)
        // Layout (floats): 16 viewProj + 4(camPos, exposure) + 16 lightViewProj + 4(lightDirWS,pad) = 40 floats = 160 bytes
        this.frameUniformBuffer = this.device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.frameBindGroupLayout = this.device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }]
        });
        this.frameBindGroup = this.device.createBindGroup({ layout: this.frameBindGroupLayout, entries: [{ binding: 0, resource: { buffer: this.frameUniformBuffer } }] });

        this.modelBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
            ]
        });

        // Timestamp query resources for accurate GPU timing with double buffering
        if (this._supportsTimestampQuery) {
            this._timestampQuerySet = this.device.createQuerySet({
                type: 'timestamp',
                count: 2, // start and end timestamps
            });
            this._timestampBuffer = this.device.createBuffer({
                size: 2 * 8, // 2 timestamps * 8 bytes each (u64)
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            // Double buffer the read buffers so we never skip a frame
            this._timestampReadBuffers = [
                this.device.createBuffer({
                    size: 2 * 8,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                }),
                this.device.createBuffer({
                    size: 2 * 8,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                })
            ];
            this._timestampBufferIndex = 0;
            this._timestampBufferMapped = [false, false]; // Track which buffers are currently mapped
            this._timestampReadbacks = []; // Track pending readback promises
            this._lastGpuTimeNs = 0;
        }

        // Shadow resources (single directional light)
        this.shadowMapSize = 1024;
        this._shadowDepthFormat = 'depth16unorm';
        this._recreateShadowResources(this.shadowMapSize);
        this.shadowSampler = this.device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
        this.shadowBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // frame (reuse frame for lightViewProj)
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }
            ]
        });
        this.shadowBindGroup = this.device.createBindGroup({ layout: this.shadowBindGroupLayout, entries: [
            { binding: 0, resource: { buffer: this.frameUniformBuffer } },
            { binding: 1, resource: this.shadowSampler },
            { binding: 2, resource: this.shadowView }
        ]});

        // (Removed debug overlay pipelines)
    }

    _configureContext() {
        if (!this.context || !this.device) return;
        const colorSpace = this.outputColorSpace === 'display-p3' ? 'display-p3' : 'srgb';
        this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied', colorSpace });
        this._configured = true;
    }

    setSize(width, height, updateStyle = true) {
        this.size.width = width;
        this.size.height = height;
        const w = Math.max(1, Math.floor(width * this.pixelRatio));
        const h = Math.max(1, Math.floor(height * this.pixelRatio));
        if (this.canvas) {
            this.canvas.width = w;
            this.canvas.height = h;
            if (updateStyle && this.canvas.style) {
                this.canvas.style.width = width + 'px';
                this.canvas.style.height = height + 'px';
            }
        }
        if (this.device) {
            this.depthTexture?.destroy?.();
            this.depthTexture = this.device.createTexture({ size: { width: w, height: h, depthOrArrayLayers: 1 }, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
            this.depthView = this.depthTexture.createView();
        }
    }

    setPixelRatio(dpr) {
        this.pixelRatio = Math.max(0.5, Math.min(4, dpr || 1));
        if (this.canvas && this.size.width && this.size.height) {
            this.setSize(this.size.width, this.size.height, false);
        }
    }
    getPixelRatio() { return this.pixelRatio; }
    getSize() { return { width: this.size.width, height: this.size.height }; }
    #clamp01(v) { return Math.max(0, Math.min(1, v ?? 0)); }
    setClearColor(hexOrObj, a = 1) {
        if (typeof hexOrObj === 'number') {
            const r = ((hexOrObj >> 16) & 255) / 255;
            const g = ((hexOrObj >> 8) & 255) / 255;
            const b = (hexOrObj & 255) / 255;
            this.clearColor = { r, g, b, a: this.#clamp01(a) };
        } else if (hexOrObj && typeof hexOrObj === 'object') {
            this.clearColor = {
                r: hexOrObj.r ?? 0,
                g: hexOrObj.g ?? 0,
                b: hexOrObj.b ?? 0,
                a: this.#clamp01(hexOrObj.a ?? a)
            };
        }
    }
    getClearColor(target) {
        if (target && typeof target === 'object') {
            target.r = this.clearColor.r;
            target.g = this.clearColor.g;
            target.b = this.clearColor.b;
            return target;
        }
        return { r: this.clearColor.r, g: this.clearColor.g, b: this.clearColor.b };
    }
    setClearAlpha(alpha) {
        this.clearColor.a = this.#clamp01(alpha);
    }
    getClearAlpha() {
        return this.clearColor.a;
    }
    setExposure(e) { this.exposure = Math.max(0, e || 0); }
    setOutputColorSpace(colorSpace) {
        const normalized = (colorSpace || '').toLowerCase();
        if (normalized !== 'srgb' && normalized !== 'display-p3') {
            throw new Error(`Unsupported color space: ${colorSpace}`);
        }
        if (normalized === this.outputColorSpace) return;
        this.outputColorSpace = normalized;
        if (this._configured) {
            this._configureContext();
        }
    }
    getGpuTimeMs() {
        // Returns accurate GPU time in milliseconds from timestamp queries, or 0 if not supported
        return this._lastGpuTimeNs ? this._lastGpuTimeNs / 1000000.0 : 0;
    }

    beginFrame() {
        const colorView = this.context.getCurrentTexture().createView();
        const encoder = this.device.createCommandEncoder();
        
        // Set up render pass with timestamp queries if supported
        /** @type {GPURenderPassDescriptor} */
        const passDescriptor = {
            colorAttachments: [{ view: colorView, clearValue: this.clearColor, loadOp: /** @type {GPULoadOp} */('clear'), storeOp: /** @type {GPUStoreOp} */('store') }],
            depthStencilAttachment: { view: this.depthView, depthClearValue: 1.0, depthLoadOp: /** @type {GPULoadOp} */('clear'), depthStoreOp: /** @type {GPUStoreOp} */('store') }
        };
        
        // Add timestamp queries to measure GPU time if supported
        if (this._supportsTimestampQuery && this._timestampQuerySet) {
            passDescriptor.timestampWrites = {
                querySet: this._timestampQuerySet,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1
            };
        }
        
        const pass = encoder.beginRenderPass(passDescriptor);
        return { encoder, pass };
    }

    endFrame(encoder, pass) {
        pass.end();
        
        let timestampReadBuffer = null;
        let bufferIndex = -1;
        
        // Resolve timestamp queries with double buffering
        if (this._supportsTimestampQuery && this._timestampQuerySet && this._timestampReadBuffers) {
            // Find an available buffer (not currently mapped)
            const currentIndex = this._timestampBufferIndex;
            const nextIndex = (currentIndex + 1) % 2;
            
            // Prefer the next buffer, but use current if next is still mapped
            if (!this._timestampBufferMapped[nextIndex]) {
                bufferIndex = nextIndex;
                this._timestampBufferIndex = nextIndex;
            } else if (!this._timestampBufferMapped[currentIndex]) {
                bufferIndex = currentIndex;
                // Don't advance index, try again next frame
            }
            // If both are mapped, skip this frame (shouldn't happen often with double buffering)
            
            if (bufferIndex >= 0) {
                const currentBuffer = this._timestampReadBuffers[bufferIndex];
                
                // Resolve queries and copy to the current read buffer
                encoder.resolveQuerySet(
                    this._timestampQuerySet,
                    0, // first query
                    2, // query count
                    this._timestampBuffer,
                    0  // destination offset
                );
                encoder.copyBufferToBuffer(
                    this._timestampBuffer,
                    0,
                    currentBuffer,
                    0,
                    16 // 2 * 8 bytes
                );
                
                timestampReadBuffer = currentBuffer;
            }
        }
        
        const commandBuffer = encoder.finish();
        this.device.queue.submit([commandBuffer]);
        
        // Now that commands are submitted, start async readback
        if (timestampReadBuffer && bufferIndex >= 0) {
            this._timestampBufferMapped[bufferIndex] = true;
            
            const readbackPromise = this.device.queue.onSubmittedWorkDone()
                .then(() => timestampReadBuffer.mapAsync(GPUMapMode.READ))
                .then(() => {
                    const times = new BigUint64Array(timestampReadBuffer.getMappedRange());
                    const startTime = times[0];
                    const endTime = times[1];
                    this._lastGpuTimeNs = Number(endTime - startTime);
                    timestampReadBuffer.unmap();
                    this._timestampBufferMapped[bufferIndex] = false;
                })
                .catch((err) => {
                    console.warn('Failed to read GPU timestamps:', err);
                    // Make sure to unmap on error and clear flag
                    try { 
                        timestampReadBuffer.unmap(); 
                    } catch(e) {}
                    this._timestampBufferMapped[bufferIndex] = false;
                });
            
            // Keep only the last few readback promises to prevent memory leaks
            this._timestampReadbacks.push(readbackPromise);
            if (this._timestampReadbacks.length > 3) {
                this._timestampReadbacks.shift();
            }
        }
    }

    async render(scene, camera) {
        if (!this.device) throw new Error('Call init() before render');
        camera.updateMatrices();
        // Ensure scene graph world matrices are current
        scene.updateMatrixWorld(true);
        // Update frame uniforms (viewProj, cameraPos, exposure, lightViewProj, lightDirWS)
        const viewProj = new Float32Array(40); // 16 viewProj + 4(camPos, exposure) + 16 lightViewProj + 4(lightDirWS,pad)
        // Compute viewProj = projection * view via Matrix4 helper
        if (!this._tmpViewProj) this._tmpViewProj = new Matrix4();
        this._tmpViewProj.multiply(camera.projectionMatrix, camera.viewMatrix);
        viewProj.set(this._tmpViewProj.elements, 0);
        // camera position (from matrixWorld)
        const invView_14 = camera.matrixWorld.elements;
        viewProj[16] = invView_14[12];
        viewProj[17] = invView_14[13];
        viewProj[18] = invView_14[14];
        viewProj[19] = this.exposure;
        const camPos = { x: viewProj[16], y: viewProj[17], z: viewProj[18] };

        // Build a directional light viewProj for shadows; if anything fails, fall back to identity
        try {
            const lightsArr = this._frameDirectionalLights = this.#collectDirectionalLights(scene);
            const L = lightsArr.length ? lightsArr[0] : { direction: { x: 0, y: -1, z: -1 }, intensity: 1.0, color: [1,1,1], shadow: { mapSize: { width: this.shadowMapSize, height: this.shadowMapSize }, bias: -0.0005, normalBias: 0.0, radius: 1.0, camera: { left: -20, right: 20, top: 20, bottom: -20, near: 0.5, far: 200 } } };
            // Compute frame-level flag for shadow enabling
            const hasCastersFrame = this.sceneHasShadowCasters(scene);
            const firstCastsFrame = !!(lightsArr[0] && lightsArr[0].castShadow === true);
            this._frameShadowsEnabled = (!this.disableShadows && hasCastersFrame && firstCastsFrame) ? 1 : 0;
            // Ensure shadow resources reflect light.shadow.mapSize
            const desired = Math.max(1, L.shadow?.mapSize?.width || this.shadowMapSize);
            if (desired !== this.shadowMapSize) {
                this.shadowMapSize = desired;
                this._recreateShadowResources(this.shadowMapSize);
            }
            const lx = L.direction.x, ly = L.direction.y, lz = L.direction.z;
            const invLen = 1/Math.hypot(lx, ly, lz);
            const ndx = lx*invLen, ndy = ly*invLen, ndz = lz*invLen;
            // Compute a simple scene bounds from mesh world positions
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            const stackB = [scene];
            const visibleMap = new WeakMap();
            visibleMap.set(scene, scene.visible !== false);
            while (stackB.length) {
                const o = stackB.pop();
                const parentVisible = o.parent ? visibleMap.get(o.parent) !== false : true;
                const selfVisible = parentVisible && o.visible !== false;
                visibleMap.set(o, selfVisible);
                for (const c of o.children) stackB.push(c);
                if (!selfVisible) continue;
                if (o.geometry && o.material) {
                    const me = o.matrixWorld.elements;
                    const x = me[12], y = me[13], z = me[14];
                    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
                    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
                }
            }
            if (!isFinite(minX)) { minX = -10; minY = -10; minZ = -10; maxX = 10; maxY = 10; maxZ = 10; }
            const centerX = (minX + maxX) * 0.5;
            const centerY = (minY + maxY) * 0.5;
            const centerZ = (minZ + maxZ) * 0.5;
            const extentX = (maxX - minX) * 0.5;
            const extentY = (maxY - minY) * 0.5;
            const extentZ = (maxZ - minZ) * 0.5;
            const radius = Math.max(extentX, extentY, extentZ) + 2.0;
            const target = new Vector3(centerX, centerY, centerZ);
            const lightDist = Math.max(20, radius * 3.0);

            // Use the light's actual position if it's been explicitly set, otherwise compute from scene bounds
            let lightPos;
            let shadowTarget = target; // Default to scene center
            if (L.position && (L.position.x !== 0 || L.position.y !== 0 || L.position.z !== 0)) {
                // Light position has been explicitly set (not the default 0,0,0)
                lightPos = new Vector3(L.position.x, L.position.y, L.position.z);
                // When light position is explicitly set, use the shadow target if available
                if (L.shadow && L.shadow.target) {
                    // @ts-ignore - target property added to LightShadow class
                    shadowTarget = new Vector3(L.shadow.target.x, L.shadow.target.y, L.shadow.target.z);
                } else {
                    // Otherwise, assume the light is looking at the camera/player position
                    // For now, use scene center as fallback
                    shadowTarget = target;
                }
            } else {
                // Compute light position from scene bounds and light direction
                lightPos = new Vector3(target.x - ndx*lightDist, target.y - ndy*lightDist, target.z - ndz*lightDist);
            }
            // Compute light view/projection using Matrix4 helpers
            if (!this._tmpLightView) this._tmpLightView = new Matrix4();
            if (!this._tmpLightProj) this._tmpLightProj = new Matrix4();
            if (!this._tmpLightVP) this._tmpLightVP = new Matrix4();
            const upVec = new Vector3(0, 1, 0);
            // Build world-to-light view matrix (inverse of lookAt transform)
            this._tmpLightView.makeLookAt(lightPos, shadowTarget, upVec).invert();
            const lightView = this._tmpLightView.elements;
            {
                // Compute near/far in light view space using scene AABB corners
                const corners = [
                    [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, minZ], [minX, maxY, maxZ],
                    [maxX, minY, minZ], [maxX, minY, maxZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]
                ];
                let minZls = Infinity, maxZls = -Infinity;
                for (let i = 0; i < 8; i++) {
                    const x = corners[i][0], y = corners[i][1], z = corners[i][2];
                    const zls = lightView[2]*x + lightView[6]*y + lightView[10]*z + lightView[14];
                    if (zls < minZls) minZls = zls;
                    if (zls > maxZls) maxZls = zls;
                }
                // Convert light-space z to positive distances along -Z (view forward)
                // z_view is negative in front of the light. We want positive near/far distances.
                const margin = Math.max(2.0, radius * 0.25);
                let near = Math.max(0.001, (-maxZls) - margin);
                let far  = (-minZls) + margin;
                if (!(far > near + 1e-5)) { far = near + 10.0; }

                // Lateral extents from radius (could be refined by transforming corners on x/y as well)
                const cs = L.shadow?.camera;
                const useManual = !!cs;
                const orthoSize = Math.max(20.0, radius * 2.0);
                const left = useManual ? cs.left : -orthoSize;
                const right = useManual ? cs.right : orthoSize;
                const bottom = useManual ? cs.bottom : -orthoSize;
                const top = useManual ? cs.top : orthoSize;
                near = useManual ? cs.near : near;
                far = useManual ? cs.far : far;
                // Use shadow camera bounds from light configuration if available, otherwise use computed bounds
                let shadowLeft = left, shadowRight = right, shadowBottom = bottom, shadowTop = top, shadowNear = near, shadowFar = far;
                if (L.shadow && L.shadow.camera) {
                    const cam = L.shadow.camera;
                    shadowLeft = cam.left !== undefined ? cam.left : left;
                    shadowRight = cam.right !== undefined ? cam.right : right;
                    shadowBottom = cam.bottom !== undefined ? cam.bottom : bottom;
                    shadowTop = cam.top !== undefined ? cam.top : top;
                    shadowNear = cam.near !== undefined ? cam.near : near;
                    shadowFar = cam.far !== undefined ? cam.far : far;
                }

                // WebGPU 0..1 depth range
                this._tmpLightProj.makeOrthographic(shadowLeft, shadowRight, shadowBottom, shadowTop, shadowNear, shadowFar);
            }
            // lightViewProj = lightProj * lightView
            if (!this._tmpLightVP) this._tmpLightVP = new Matrix4();
            this._tmpLightVP.multiply(this._tmpLightProj, this._tmpLightView);
            viewProj.set(this._tmpLightVP.elements, 20);
            // Store world-space light direction (from light → scene)
            viewProj[36] = ndx; viewProj[37] = ndy; viewProj[38] = ndz; viewProj[39] = 0.0;
        } catch (_) {
            // identity lightViewProj
            viewProj[20]=1; viewProj[24]=0; viewProj[28]=0; viewProj[32]=0;
            viewProj[21]=0; viewProj[25]=1; viewProj[29]=0; viewProj[33]=0;
            viewProj[22]=0; viewProj[26]=0; viewProj[30]=1; viewProj[34]=0;
            viewProj[23]=0; viewProj[27]=0; viewProj[31]=0; viewProj[35]=1;
            this._frameShadowsEnabled = 0;
            // Fallback light dir = downward
            viewProj[36] = 0.0; viewProj[37] = -1.0; viewProj[38] = 0.0; viewProj[39] = 0.0;
        }

        // Upload frame uniforms now that lightViewProj is computed
        this.device.queue.writeBuffer(this.frameUniformBuffer, 0, viewProj.buffer, viewProj.byteOffset, viewProj.byteLength);

        // Execute shadow pass only if needed; skip entirely when disabled
        if (!this.disableShadows && this.sceneHasShadowCasters(scene)) {
            try { this._renderShadowPass(scene, camera); } catch (_) { }
        }

        // Frame uniforms will be uploaded after we compute lightViewProj below
        const { encoder, pass } = this.beginFrame();

        // Build frustum for culling
        const frustum = this.#buildFrustum(camera);

        // Collect visible meshes; separate opaque and transparent
        const opaqueBatches = new Map();
        const transparentList = [];
        const stack = [scene];
        const visibleAncestors = new WeakMap();
        visibleAncestors.set(scene, scene.visible !== false);

        while (stack.length) {
            const obj = stack.pop();
            const parentVisible = obj.parent ? visibleAncestors.get(obj.parent) !== false : true;
            const selfVisible = parentVisible && obj.visible !== false;
            visibleAncestors.set(obj, selfVisible);
            for (const c of obj.children) stack.push(c);
            if (!selfVisible) continue;
            if (obj.geometry && obj.material) {
                // Frustum culling check
                if (this.#isInFrustum(obj, frustum, camera)) {
                    if (obj.material.transparent) {
                        const me = obj.matrixWorld.elements;
                        const mx = me[12], my = me[13], mz = me[14];
                        const dx = mx - camPos.x, dy = my - camPos.y, dz = mz - camPos.z;
                        const depth2 = dx*dx + dy*dy + dz*dz;
                        transparentList.push({ mesh: obj, depth2 });
                    } else {
                        const materialKey = this.#getMaterialKey(obj.material);
                        if (!opaqueBatches.has(materialKey)) {
                            opaqueBatches.set(materialKey, []);
                        }
                        opaqueBatches.get(materialKey).push(obj);
                    }
                }
            }
        }

        // Draw opaque first in batches
        for (const [materialKey, meshes] of opaqueBatches) {
            this.#drawMeshBatch(pass, meshes, camera);
        }

        // Draw transparent back-to-front
        transparentList.sort((a, b) => b.depth2 - a.depth2);
        for (const entry of transparentList) {
            this.#drawMesh(pass, entry.mesh, camera);
        }

        // (Removed debug overlays)

        this.endFrame(encoder, pass);
    }

    #getOrCreatePipeline(material) {
        const existing = this._pipelinePerMaterial.get(material);
        if (existing) return existing;
        const device = this.device;
        // All materials must provide their own shader and vertex layouts
        if (typeof material.getWGSL !== 'function') {
            throw new Error(`Material ${material.type || 'unknown'} must implement getWGSL()`);
        }
        if (typeof material.getVertexBufferLayouts !== 'function') {
            throw new Error(`Material ${material.type || 'unknown'} must implement getVertexBufferLayouts()`);
        }
        
        const code = material.getWGSL();
        if (!code || typeof code !== 'string') {
            throw new Error(`Material ${material.type || 'unknown'}.getWGSL() must return a string`);
        }
        
        const buffers = material.getVertexBufferLayouts();
        if (!Array.isArray(buffers)) {
            throw new Error(`Material ${material.type || 'unknown'}.getVertexBufferLayouts() must return an array`);
        }
        
        const shader = device.createShaderModule({ code });
        const isTransparent = !!material.transparent;
        const isLineMaterial = material.constructor && material.constructor.name === 'LineBasicMaterial';
        // Material provides its own bind group layout (or none)
        const materialBGL = (typeof material.getBindGroupLayout === 'function') ? material.getBindGroupLayout(this.device) : null;
        const bindGroupLayouts = materialBGL 
            ? [this.frameBindGroupLayout, this.modelBindGroupLayout, materialBGL]
            : [this.frameBindGroupLayout, this.modelBindGroupLayout];
        const layout = device.createPipelineLayout({ bindGroupLayouts });
        const customPS = (typeof material.getPipelineState === 'function') ? material.getPipelineState() : null;
        const primitive = /** @type {GPUPrimitiveState} */({
            topology: /** @type {GPURenderPipelineDescriptor["primitive"]["topology"]} */(isLineMaterial ? 'line-list' : 'triangle-list'),
            cullMode: /** @type {GPUCullMode} */(isLineMaterial ? 'none' : (customPS && customPS.cullMode ? customPS.cullMode : 'back'))
        });
        const depthWriteEnabled = customPS ? !!customPS.depthWriteEnabled : (isTransparent ? !!material.depthWrite : true);
        const depthCompare = (material.depthTest === false) ? 'always' : (customPS && customPS.depthCompare ? customPS.depthCompare : 'less');
        /** @type {GPUBlendState | undefined} */
        let blend = undefined;
        if (isTransparent) {
            const mode = (material.blending || 'normal');
            if (mode === 'additive' || mode === 'add') {
                blend = {
                    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
                };
            } else if (mode === 'none') {
                blend = undefined;
            } else {
                // normal alpha blending
                blend = {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                };
            }
        }
        const targets = [{ format: this.format, ...(blend ? { blend } : {}) }];
        const pipeline = device.createRenderPipeline({
            layout,
            vertex: { module: shader, entryPoint: 'vs_main', buffers: /** @type {any} */ (buffers) },
            fragment: { module: shader, entryPoint: 'fs_main', targets: /** @type {any} */(targets) },
            primitive,
            depthStencil: { format: 'depth24plus', depthWriteEnabled, depthCompare }
        });
        this._pipelinePerMaterial.set(material, pipeline);
        return pipeline;
    }

    // Removed: #basicWGSL() and #standardWGSL() - materials now provide their own shaders
    // Removed: #getMaterialBGL() - materials provide their own bind group layouts

    #drawMesh(pass, mesh, camera) {
        const pipeline = this.#getOrCreatePipeline(mesh.material);
        pass.setPipeline(pipeline);

        // Upload or use cached buffers per geometry (only create once)
        const geo = mesh.geometry;
        let gpu = this._geoCache.get(geo);
        if (!gpu) {
            gpu = {};
            this._geoCache.set(geo, gpu);

            const device = this.device;
            const positionAttr = this.#getGeometryAttribute(geo, 'position');
            if (positionAttr) {
                gpu.position = device.createBuffer({ size: positionAttr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                device.queue.writeBuffer(gpu.position, 0, positionAttr.array);
            }
            const normalAttr = this.#getGeometryAttribute(geo, 'normal');
            if (normalAttr) {
                gpu.normal = device.createBuffer({ size: normalAttr.array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                device.queue.writeBuffer(gpu.normal, 0, normalAttr.array);
            }
            if (geo.index) {
                const arr = geo.index.array;
                const format = arr instanceof Uint32Array ? 'uint32' : 'uint16';
                const byteLength = arr.byteLength;
                const paddedByteLength = (byteLength + 3) & ~3;
                gpu.indexFormat = format;
                gpu.index = device.createBuffer({ size: paddedByteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
                const srcBytes = new Uint8Array(arr.buffer, arr.byteOffset, byteLength);
                const uploadBytes = paddedByteLength === byteLength ? srcBytes : (() => {
                    const padded = new Uint8Array(paddedByteLength);
                    padded.set(srcBytes);
                    return padded;
                })();
                device.queue.writeBuffer(gpu.index, 0, uploadBytes);
            }
        }

        // Update uniforms: model, normal and frame ViewProj
        let modelArray = mesh.matrixWorld.elements;
        // Create per-object uniform buffers lazily (only create once)
        let oc = this._objCache.get(mesh);
        if (!oc) {
            oc = {
                modelBuffer: this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
                normalBuffer: this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
            };
            oc.modelBindGroup = this.device.createBindGroup({ layout: this.modelBindGroupLayout, entries: [
                { binding: 0, resource: { buffer: oc.modelBuffer } },
                { binding: 1, resource: { buffer: oc.normalBuffer } }
            ] });
            this._objCache.set(mesh, oc);
        }

        // Only update model buffer if matrix has changed
        if (!oc.lastModelMatrix || !this.#matricesEqual(oc.lastModelMatrix, modelArray)) {
            this.device.queue.writeBuffer(oc.modelBuffer, 0, modelArray.buffer, modelArray.byteOffset, modelArray.byteLength);
            oc.lastModelMatrix = new Float32Array(modelArray); // Cache the matrix
        }
        // Normal matrix from inverse-transpose of model (upper-left 3x3) - cache if unchanged
        const currentModelMatrix = mesh.matrixWorld.elements;
        const needsNormalUpdate = !oc.lastNormalMatrix || !this.#matricesEqual(oc.lastNormalMatrix, currentModelMatrix);

        if (needsNormalUpdate) {
            if (!this._tmpMat4) this._tmpMat4 = { elements: new Float32Array(16) };
            this._tmpMat4.elements.set(currentModelMatrix);
            // compute inverse transpose of 3x3
            const m = this._tmpMat4.elements;
            const a11 = m[0], a12 = m[4], a13 = m[8];
            const a21 = m[1], a22 = m[5], a23 = m[9];
            const a31 = m[2], a32 = m[6], a33 = m[10];
            const b11 = a22*a33 - a23*a32;
            const b12 = a13*a32 - a12*a33;
            const b13 = a12*a23 - a13*a22;
            const det = a11*b11 + a21*b12 + a31*b13;
            let n0,n1,n2,n3,n4,n5,n6,n7,n8;
            if (det !== 0) {
                const invDet = 1.0 / det;
                n0 = b11 * invDet;
                n3 = (a23*a31 - a21*a33) * invDet;
                n6 = (a21*a32 - a22*a31) * invDet;
                n1 = b12 * invDet;
                n4 = (a11*a33 - a13*a31) * invDet;
                n7 = (a12*a31 - a11*a32) * invDet;
                n2 = b13 * invDet;
                n5 = (a13*a21 - a11*a23) * invDet;
                n8 = (a11*a22 - a12*a21) * invDet;
            } else {
                n0=1; n3=0; n6=0; n1=0; n4=1; n7=0; n2=0; n5=0; n8=1;
            }
            // Pack mat3 columns into 16-byte strides for WGSL uniform layout
            const normalPadded = new Float32Array(12);
            normalPadded[0] = n0; normalPadded[1] = n1; normalPadded[2] = n2; normalPadded[3] = 0.0; // padding
            normalPadded[4] = n3; normalPadded[5] = n4; normalPadded[6] = n5; normalPadded[7] = 0.0; // padding
            normalPadded[8] = n6; normalPadded[9] = n7; normalPadded[10] = n8; normalPadded[11] = 0.0; // padding
            this.device.queue.writeBuffer(oc.normalBuffer, 0, normalPadded);
            oc.lastNormalMatrix = new Float32Array(currentModelMatrix); // Cache the matrix
        }
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setBindGroup(1, oc.modelBindGroup);

        // Material uniforms / bindings
        if (typeof mesh.material.getBindGroupEntries === 'function') {
            const entries = mesh.material.getBindGroupEntries(this);
            if (entries && entries.length) {
                if (!this._matCache.has(mesh.material)) this._matCache.set(mesh.material, {});
                const mc = this._matCache.get(mesh.material);
                const layout = (typeof mesh.material.getBindGroupLayout === 'function') ? mesh.material.getBindGroupLayout(this.device) : null;
                if (layout) {
                    mc._bindGroup = this.device.createBindGroup({ layout, entries });
                    pass.setBindGroup(2, mc._bindGroup);
                }
            }
        }

        // Vertex buffers - materials handle their own setup
        if (typeof mesh.material.setVertexBuffers === 'function') {
            mesh.material.setVertexBuffers(pass, this, gpu, geo, mesh);
        } else {
            // Fallback: just bind position (minimal for materials without setVertexBuffers)
            pass.setVertexBuffer(0, gpu.position);
        }
        if (gpu.index) {
            pass.setIndexBuffer(gpu.index, gpu.indexFormat);
            pass.drawIndexed(geo.index.array.length, 1, 0, 0, 0);
        } else {
            pass.draw(geo.vertexCount, 1, 0, 0);
        }
        this.info.render.calls++;
    }

    #getGeometryAttribute(geo, name) {
        if (!geo) return null;
        if (typeof geo.getAttribute === 'function') {
            const attr = geo.getAttribute(name);
            if (attr) return attr;
        }
        const attrs = geo.attributes;
        if (!attrs) return null;
        if (attrs instanceof Map) return attrs.get(name) || null;
        if (typeof attrs === 'object') return attrs[name] || null;
        return null;
    }

    #getVertexCount(geo) {
        if (!geo) return 0;
        if (typeof geo.getVertexCount === 'function') {
            const vc = geo.getVertexCount();
            if (typeof vc === 'number' && vc >= 0) return vc;
        }
        if (typeof geo.vertexCount === 'number') return Math.max(0, geo.vertexCount);
        const position = this.#getGeometryAttribute(geo, 'position');
        if (position) {
            if (typeof position.count === 'number') return Math.max(0, position.count);
            if (position.array && position.itemSize) {
                return Math.max(0, Math.floor(position.array.length / position.itemSize));
            }
        }
        return 0;
    }

    #matricesEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (Math.abs(a[i] - b[i]) > 0.0001) return false;
        }
        return true;
    }

    #getMaterialKey(material) {
        // Simple batching by material instance
        // Materials with same type and properties should share a pipeline
        return material.uuid || material.id || material.constructor.name || 'default';
    }

    #drawMeshBatch(pass, meshes, camera) {
        if (!meshes.length) return;

        // Use the first mesh's pipeline for the batch
        const firstMesh = meshes[0];
        const pipeline = this.#getOrCreatePipeline(firstMesh.material);
        pass.setPipeline(pipeline);

        // Draw each mesh in the batch
        for (const mesh of meshes) {
            this.#drawMesh(pass, mesh, camera);
        }
    }

    #buildFrustum(camera) {
        const matrix = camera.matrixWorldInverse;
        const proj = camera.projectionMatrix;
        const viewProj = new Matrix4().multiply(proj, matrix);

        const planes = [];
        const m = viewProj.elements;

        // Left plane
        planes.push({
            normal: { x: m[3] + m[0], y: m[7] + m[4], z: m[11] + m[8] },
            distance: m[15] + m[12]
        });

        // Right plane
        planes.push({
            normal: { x: m[3] - m[0], y: m[7] - m[4], z: m[11] - m[8] },
            distance: m[15] - m[12]
        });

        // Bottom plane
        planes.push({
            normal: { x: m[3] + m[1], y: m[7] + m[5], z: m[11] + m[9] },
            distance: m[15] + m[13]
        });

        // Top plane
        planes.push({
            normal: { x: m[3] - m[1], y: m[7] - m[5], z: m[11] - m[9] },
            distance: m[15] - m[13]
        });

        // Near plane
        planes.push({
            normal: { x: m[3] + m[2], y: m[7] + m[6], z: m[11] + m[10] },
            distance: m[15] + m[14]
        });

        // Far plane
        planes.push({
            normal: { x: m[3] - m[2], y: m[7] - m[6], z: m[11] - m[10] },
            distance: m[15] - m[14]
        });

        // Normalize planes
        for (const plane of planes) {
            const len = Math.sqrt(plane.normal.x * plane.normal.x + plane.normal.y * plane.normal.y + plane.normal.z * plane.normal.z);
            plane.normal.x /= len;
            plane.normal.y /= len;
            plane.normal.z /= len;
            plane.distance /= len;
        }

        return planes;
    }

    #isInFrustum(obj, planes, camera) {
        // Quick AABB check - if no bounding box, assume visible
        if (!obj.geometry || !obj.geometry.boundingBox) return true;

        const box = obj.geometry.boundingBox;
        const worldMatrix = obj.matrixWorld;
        const center = box.getCenter(new Vector3());
        const size = box.getSize(new Vector3());

        // Transform center to world space
        center.applyMatrix4(worldMatrix);

        // Check all planes
        for (const plane of planes) {
            const normal = plane.normal;
            const distance = plane.distance;

            // Find the farthest point in the direction opposite to the plane normal
            const radius = size.x * Math.abs(normal.x) + size.y * Math.abs(normal.y) + size.z * Math.abs(normal.z);
            const signedDistance = center.x * normal.x + center.y * normal.y + center.z * normal.z + distance;

            // If the sphere is completely behind the plane, cull it
            if (signedDistance + radius < 0) {
                return false;
            }
        }

        return true;
    }


    #getSamplerForTexture(texture) {
        const minFilter = FILTER_MODE_MAP[texture.minFilter] || 'linear';
        const magFilter = FILTER_MODE_MAP[texture.magFilter] || 'linear';
        const wrapS = WRAP_MODE_MAP[texture.wrapS] || 'repeat';
        const wrapT = WRAP_MODE_MAP[texture.wrapT] || 'repeat';
        const key = `${minFilter}:${magFilter}:${wrapS}:${wrapT}:${texture.generateMipmaps ? 'mip' : 'nomip'}`;
        let sampler = this._samplerCache.get(key);
        if (sampler) return sampler;
        sampler = this.device.createSampler({
            addressModeU: wrapS,
            addressModeV: wrapT,
            addressModeW: wrapS,
            minFilter,
            magFilter,
            mipmapFilter: texture.generateMipmaps ? 'linear' : 'nearest'
        });
        this._samplerCache.set(key, sampler);
        return sampler;
    }

    #getFallbackSampler() {
        if (!this._fallbackSampler) {
            this._fallbackSampler = this.device.createSampler({
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                minFilter: 'nearest',
                magFilter: 'nearest',
                mipmapFilter: 'nearest'
            });
        }
        return this._fallbackSampler;
    }

    #getFallbackTexture() {
        if (!this._fallbackTextureInfo) {
            const texture = this.device.createTexture({
                size: { width: 1, height: 1, depthOrArrayLayers: 1 },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            const data = new Uint8Array([255, 255, 255, 255]);
            this.device.queue.writeTexture(
                { texture },
                data,
                { bytesPerRow: 4 },
                { width: 1, height: 1, depthOrArrayLayers: 1 }
            );
            this._fallbackTextureInfo = { texture, view: texture.createView() };
        }
        return this._fallbackTextureInfo;
    }

    #getTextureGPU(texture) {
        if (!texture || !texture.image) return null;
        let cache = this._textureCache.get(texture);
        const source = texture.image;
        const width = source.width || source.videoWidth || source.naturalWidth || source.displayWidth || 0;
        const height = source.height || source.videoHeight || source.naturalHeight || source.displayHeight || 0;
        if (!width || !height) return cache || null;
        const format = texture.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm';
        const needsNewTexture = !cache || cache.width !== width || cache.height !== height || cache.format !== format;
        const needsUpload = texture.needsUpload || (cache && cache.version !== texture.version);

        if (needsNewTexture) {
            cache?.texture?.destroy?.();
            const gpuTexture = this.device.createTexture({
                size: { width, height, depthOrArrayLayers: 1 },
                format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            cache = { texture: gpuTexture, view: gpuTexture.createView(), width, height, format, version: texture.version };
            this._textureCache.set(texture, cache);
            texture.needsUpload = true;
        }

        if (needsUpload || texture.needsUpload) {
            try {
                this.device.queue.copyExternalImageToTexture(
                    { source },
                    { texture: cache.texture },
                    { width, height }
                );
                texture.needsUpload = false;
                cache.version = texture.version;
            } catch (err) {
                console.warn('Failed to upload texture to GPU', err);
                return null;
            }
        }

        return cache;
    }


    #findDirectionalLight(root) {
        const stack = [root];
        while (stack.length) {
            const o = stack.pop();
            for (const c of o.children) stack.push(c);
            if (o.isDirectionalLight) return o;
        }
        return null;
    }

    #collectDirectionalLights(root) {
        // Preserve scene child order and place shadow-casting lights first
        const primary = [];
        const secondary = [];
        const stack = [root];
        while (stack.length) {
            const o = stack.pop();
            // Push children in reverse so we pop the first child first (preserve insertion order)
            if (o.children && o.children.length) {
                for (let i = o.children.length - 1; i >= 0; i--) stack.push(o.children[i]);
            }
            if (o.isDirectionalLight) {
                if (o.castShadow === true) primary.push(o); else secondary.push(o);
                if (primary.length + secondary.length >= 3) break;
            }
        }
        return primary.concat(secondary).slice(0, 3);
    }
}

// Shadow rendering helpers
WebGPURenderer.prototype._renderShadowPass = function(scene, camera) {
    // If shadows are disabled, skip entirely
    if (this.disableShadows) { return; }
    if (!this._shadowPipeline) {
        const shader = this.device.createShaderModule({ code: `
struct Frame { viewProj: mat4x4f, cameraPos: vec3f, exposure: f32, lightViewProj: mat4x4f };
@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;
@vertex fn vs_main(@location(0) pos: vec3f) -> @builtin(position) vec4f {
  let worldPos = u_model * vec4f(pos, 1.0);
  return u_frame.lightViewProj * worldPos;
}
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(0.0); }
` });
        this._shadowPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.frameBindGroupLayout, this.modelBindGroupLayout] }),
            vertex: { module: shader, entryPoint: 'vs_main', buffers: [{ arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
            fragment: { module: shader, entryPoint: 'fs_main', targets: [] },
            primitive: { topology: 'triangle-list', cullMode: 'back' },
            depthStencil: { format: 'depth16unorm', depthWriteEnabled: true, depthCompare: 'less', depthBias: 1, depthBiasSlopeScale: 1.5, depthBiasClamp: 0.0 }
        });
    }
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' }
    });
    const stack = [scene];
    const visibleMap = new WeakMap();
    visibleMap.set(scene, scene.visible !== false);
    while (stack.length) {
        const obj = stack.pop();
        const parentVisible = obj.parent ? visibleMap.get(obj.parent) !== false : true;
        const selfVisible = parentVisible && obj.visible !== false;
        visibleMap.set(obj, selfVisible);
        for (const c of obj.children) stack.push(c);
        if (!selfVisible) continue;
        if (obj.geometry && obj.material) {
            if (!obj.castShadow) continue;
            const geo = obj.geometry;
            let gpu = this._geoCache.get(geo); if (!gpu) { gpu = {}; this._geoCache.set(geo, gpu); }
            if (!gpu.position) {
                gpu.position = this.device.createBuffer({ size: geo.attributes.get('position').array.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                this.device.queue.writeBuffer(gpu.position, 0, geo.attributes.get('position').array);
            }
            if (!gpu.index && geo.index) {
                const arr = geo.index.array;
                const format = arr instanceof Uint32Array ? 'uint32' : 'uint16';
                const byteLength = arr.byteLength;
                const paddedByteLength = (byteLength + 3) & ~3;
                gpu.indexFormat = format;
                gpu.index = this.device.createBuffer({ size: paddedByteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
                const srcBytes = new Uint8Array(arr.buffer, arr.byteOffset, byteLength);
                const uploadBytes = paddedByteLength === byteLength ? srcBytes : (() => {
                    const padded = new Uint8Array(paddedByteLength);
                    padded.set(srcBytes);
                    return padded;
                })();
                this.device.queue.writeBuffer(gpu.index, 0, uploadBytes);
            }
            // upload per-object model buffer for shadow pass too
            let oc = this._objCache.get(obj);
            if (!oc) {
                oc = {
                    modelBuffer: this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
                    normalBuffer: this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
                };
                oc.modelBindGroup = this.device.createBindGroup({ layout: this.modelBindGroupLayout, entries: [
                    { binding: 0, resource: { buffer: oc.modelBuffer } },
                    { binding: 1, resource: { buffer: oc.normalBuffer } }
                ] });
                this._objCache.set(obj, oc);
            }
            const modelArray = obj.matrixWorld.elements;
            this.device.queue.writeBuffer(oc.modelBuffer, 0, modelArray.buffer, modelArray.byteOffset, modelArray.byteLength);
            pass.setPipeline(this._shadowPipeline);
            pass.setBindGroup(0, this.frameBindGroup);
            pass.setBindGroup(1, oc.modelBindGroup);
            pass.setVertexBuffer(0, gpu.position);
            if (gpu.index) { pass.setIndexBuffer(gpu.index, gpu.indexFormat); pass.drawIndexed(geo.index.array.length, 1, 0, 0, 0); }
            else { pass.draw(geo.vertexCount, 1, 0, 0); }
        }
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
};

WebGPURenderer.prototype.sceneHasShadowCasters = function(root) {
    const stack = [root];
    while (stack.length) {
        const o = stack.pop();
        for (const c of o.children) stack.push(c);
        if (o.castShadow === true) return true;
    }
    return false;
};









