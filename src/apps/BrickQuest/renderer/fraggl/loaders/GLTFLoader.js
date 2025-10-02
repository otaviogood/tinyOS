/**
 * Based on Three.js
 * Original work Copyright © 2010-2024 Three.js authors
 * https://github.com/mrdoob/three.js/
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import { Object3D } from '../core/Object3D.js';
import { Mesh } from '../core/Mesh.js';
import { BufferGeometry } from '../core/BufferGeometry.js';
import { BufferAttribute } from '../core/BufferAttribute.js';
import { StandardMaterial } from '../materials/StandardMaterial.js';
import { TextureLoader } from '../textures/TextureLoader.js';

// Minimal glTF 2.0 loader (JSON .gltf + external .bin).
// - Supports meshes/primitives with POSITION, NORMAL, COLOR_0, TEXCOORD_0, indices
// - Minimal PBR material support: baseColorFactor/baseColorTexture (sRGB)
// - Ignores skins/animations/lights/cameras
// - Builds a flat hierarchy of Meshes under a root Object3D, respecting nodes/meshes
// References for semantics shaped by three.js GLTFLoader:
// https://raw.githubusercontent.com/mrdoob/three.js/refs/heads/dev/examples/jsm/loaders/GLTFLoader.js

export class GLTFLoader {
    constructor() {
        this.path = '';
        this.requestInit = undefined;
        this.textureLoader = new TextureLoader();
        this._materialCache = null;
        this._textureCache = new Map();
        this._texturePromises = new Map();
    }

    setPath(path) { this.path = path || ''; return this; }
    setRequestInit(init) { this.requestInit = init; return this; }

    async loadAsync(url) {
        const normalizedBase = this.path ? this.path.replace(/\/?$/, '/') : '';
        const resourceURL = normalizedBase ? normalizedBase + url : url;
        const base = this.#resolveBase(resourceURL);
        
        const json = await this.#fetchJSON(resourceURL);
        const buffers = await this.#loadBuffers(json, base);
        
        const bufferViews = json.bufferViews || [];
        const accessors = json.accessors || [];
        const images = json.images || [];
        const textures = json.textures || [];
        const materials = json.materials || [];
        this.textureLoader.setPath(base);
        this._materialCache = new Array(materials.length);

        function getTypedArrayForAccessor(acc) {
            const bv = bufferViews[acc.bufferView];
            const buffer = buffers[bv.buffer];
            const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
            const byteLength = acc.count * GLTFLoader.#getNumComponents(acc.type) * GLTFLoader.#componentTypeByteSize(acc.componentType);
            const slice = buffer.slice(byteOffset, byteOffset + byteLength);
            switch (acc.componentType) {
                case 5126: return new Float32Array(slice); // FLOAT
                case 5123: return new Uint16Array(slice); // UNSIGNED_SHORT
                case 5125: return new Uint32Array(slice); // UNSIGNED_INT
                case 5122: return new Int16Array(slice); // SHORT
                case 5121: return new Uint8Array(slice); // UNSIGNED_BYTE
                case 5120: return new Int8Array(slice); // BYTE
                default: throw new Error('Unsupported accessor componentType ' + acc.componentType);
            }
        }

        const root = new Object3D();
        // Build nodes and meshes
        const nodes = (json.nodes || []).map(() => new Object3D());

        // Apply node transforms
        for (let i = 0; i < nodes.length; i++) {
            const n = json.nodes[i];
            const o = nodes[i];
            if (n.name) o.name = n.name;
            if (n.translation) { o.position.set(n.translation[0], n.translation[1], n.translation[2]); }
            if (n.rotation) { o.quaternion.set(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]); }
            if (n.scale) { o.scale.set(n.scale[0], n.scale[1], n.scale[2]); }
            if (n.extras) {
                o.userData = o.userData || {};
                // Shallow copy is sufficient for extras (avoid expensive JSON round-trip)
                Object.assign(o.userData, n.extras);
            }
        }

        // Create meshes per node if needed
        for (let i = 0; i < nodes.length; i++) {
            const n = json.nodes[i];
            if (n.mesh !== undefined) {
                const meshDef = json.meshes[n.mesh];
                // Each primitive becomes a Mesh (no material handling)
                for (const prim of meshDef.primitives) {
                    const geo = new BufferGeometry();
                    // attributes
                    const attrs = prim.attributes || {};
                    if (attrs.POSITION !== undefined) {
                        const acc = accessors[attrs.POSITION];
                        const arr = getTypedArrayForAccessor(acc);
                        geo.setAttribute('position', new BufferAttribute(arr, 3));
                    }
                    if (attrs.NORMAL !== undefined) {
                        const acc = accessors[attrs.NORMAL];
                        const arr = getTypedArrayForAccessor(acc);
                        geo.setAttribute('normal', new BufferAttribute(arr, 3));
                    }
                    if (attrs.COLOR_0 !== undefined) {
                        const colorAccessorIdx = attrs.COLOR_0;
                        const acc = accessors[colorAccessorIdx];
                        const arr = getTypedArrayForAccessor(acc);
                        const numComp = GLTFLoader.#getNumComponents(acc.type);
                        // Expand RGB -> RGBA with alpha=1 (optimized with running offsets)
                        if (numComp === 3) {
                            const rgb = arr instanceof Float32Array ? arr : new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
                            const vertCount = rgb.length / 3;
                            const rgba = new Float32Array(vertCount * 4);
                            let srcIdx = 0, dstIdx = 0;
                            for (let k = 0; k < vertCount; k++, srcIdx += 3, dstIdx += 4) {
                                rgba[dstIdx] = rgb[srcIdx];
                                rgba[dstIdx + 1] = rgb[srcIdx + 1];
                                rgba[dstIdx + 2] = rgb[srcIdx + 2];
                                rgba[dstIdx + 3] = 1.0;
                            }
                            geo.setAttribute('color', new BufferAttribute(rgba, 4, true));
                        } else if (numComp === 4) {
                            const rgba = arr instanceof Float32Array ? arr : new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
                            geo.setAttribute('color', new BufferAttribute(rgba, 4));
                        }
                    }
                    if (attrs.TEXCOORD_0 !== undefined) {
                        const acc = accessors[attrs.TEXCOORD_0];
                        const arr = getTypedArrayForAccessor(acc);
                        const uv = arr instanceof Float32Array ? arr : new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
                        geo.setAttribute('uv', new BufferAttribute(uv, 2));
                    }
                    // indices
                    if (prim.indices !== undefined) {
                        const acc = accessors[prim.indices];
                        const arr = getTypedArrayForAccessor(acc);
                        geo.setIndex(arr); // renderer will pick format based on typed array
                    }

                    // Skip material loading entirely - it's replaced later anyway in fragglRenderer
                    // Enable BVH for loaded piece geometries (needed for precise raycasting)
                    const mesh = new Mesh(geo, null, { buildBVH: true });
                    if (prim.extras) {
                        // Shallow copy is sufficient for extras (avoid expensive JSON round-trip)
                        mesh.userData = { ...(mesh.userData || {}), ...prim.extras };
                    }
                    nodes[i].add(mesh);
                }
            }
        }

        // Build hierarchy
        const sceneIndex = (json.scene !== undefined) ? json.scene : 0;
        const scene = (json.scenes && json.scenes[sceneIndex]) || { nodes: [] };
        function attachChildren(parent, nodeIndex) {
            const o = nodes[nodeIndex];
            parent.add(o);
            const def = json.nodes[nodeIndex] || {};
            const kids = def.children || [];
            for (const c of kids) attachChildren(o, c);
        }
        for (const nIdx of scene.nodes || []) attachChildren(root, nIdx);

        // Optional: compute local matrices now
        root.updateMatrixWorld(true);

        return { scene: root, json };
    }

    static #getNumComponents(type) {
        switch (type) {
            case 'SCALAR': return 1;
            case 'VEC2': return 2;
            case 'VEC3': return 3;
            case 'VEC4': return 4;
            case 'MAT2': return 4;
            case 'MAT3': return 9;
            case 'MAT4': return 16;
            default: throw new Error('Unknown accessor type ' + type);
        }
    }

    static #componentTypeByteSize(ct) {
        switch (ct) {
            case 5120: // BYTE
            case 5121: // UNSIGNED_BYTE
                return 1;
            case 5122: // SHORT
            case 5123: // UNSIGNED_SHORT
                return 2;
            case 5125: // UNSIGNED_INT
            case 5126: // FLOAT
                return 4;
            default: throw new Error('Unknown componentType ' + ct);
        }
    }

    static #ensureFloat32(typed) {
        return (typed instanceof Float32Array) ? typed : new Float32Array(typed.buffer, typed.byteOffset, typed.byteLength / 4);
    }

    #resolveBase(url) {
        if (this.path) return this.path;
        try {
            const u = new URL(url, window.location.href);
            const parts = u.pathname.split('/');
            parts.pop();
            u.pathname = parts.join('/') + '/';
            return u.toString();
        } catch (_) {
            const idx = url.lastIndexOf('/');
            return idx !== -1 ? url.slice(0, idx + 1) : '';
        }
    }

    async #fetchJSON(url) {
        const res = await fetch(url, this.requestInit);
        if (!res.ok) throw new Error('Failed to fetch glTF JSON: ' + res.status);
        return await res.json();
    }

    async #loadBuffers(json, base) {
        const buffers = [];
        for (let i = 0; i < (json.buffers || []).length; i++) {
            const b = json.buffers[i];
            if (b.uri && b.uri.startsWith('data:')) {
                const data = GLTFLoader.#decodeDataURI(b.uri);
                buffers.push(data);
            } else if (b.uri) {
                const url = base + b.uri;
                const res = await fetch(url, this.requestInit);
                if (!res.ok) throw new Error('Failed to fetch buffer: ' + url);
                const ab = await res.arrayBuffer();
                buffers.push(ab);
            } else {
                // Some files may inline BIN in GLB (not supported here)
                throw new Error('Buffer without uri not supported in minimal loader');
            }
        }
        return buffers;
    }

    async #getMaterial(index, materials, textures, images, base, json) {
        if (index < 0 || index >= materials.length) return null;
        const cached = this._materialCache[index];
        if (cached) return cached;
        const matDef = materials[index] || {};
        const baseColor = Array.isArray(matDef.pbrMetallicRoughness?.baseColorFactor)
            ? matDef.pbrMetallicRoughness.baseColorFactor.slice(0, 3)
            : [1, 1, 1];
        const metallic = Number.isFinite(matDef.pbrMetallicRoughness?.metallicFactor)
            ? matDef.pbrMetallicRoughness.metallicFactor
            : 0.0;
        const roughness = Number.isFinite(matDef.pbrMetallicRoughness?.roughnessFactor)
            ? matDef.pbrMetallicRoughness.roughnessFactor
            : 0.5;
        let map = null;
        const baseColorTexture = matDef.pbrMetallicRoughness?.baseColorTexture;
        let uvIndex = 0;
        if (baseColorTexture && baseColorTexture.index !== undefined) {
            uvIndex = Number.isFinite(baseColorTexture.texCoord) ? baseColorTexture.texCoord : 0;
            map = await this.#getTexture(baseColorTexture.index, textures, images, base, json, true, uvIndex);
        }
        const material = new StandardMaterial({ baseColor, metallic, roughness, map });
        material.userData = material.userData || {};
        material.userData.baseColorUV = uvIndex;
        this._materialCache[index] = material;
        return material;
    }

    async #getTexture(index, textures, images, base, json, srgb = true, texCoordIndex = 0) {
        if (index < 0 || index >= textures.length) return null;
        if (this._textureCache.has(index)) return this._textureCache.get(index);
        if (this._texturePromises.has(index)) return await this._texturePromises.get(index);
        const texDef = textures[index] || {};
        const sourceIndex = texDef.source;
        if (sourceIndex === undefined || !images[sourceIndex]) return null;
        const imageDef = images[sourceIndex];
        const url = imageDef.uri || null;
        if (!url) return null; // data uris handled in loader but prefer external for now
        const promise = (async () => {
            const texture = await this.textureLoader.loadAsync(url, { colorSpace: srgb ? 'srgb' : 'linear' });
            // apply texture transform if extension exists
            const texTransform = GLTFLoader.#getTextureTransform(texDef, json, texCoordIndex);
            if (texTransform) {
                texture.wrapS = 'repeat';
                texture.wrapT = 'repeat';
                texture.offset = texTransform.offset;
                texture.repeat = texTransform.scale;
            }
            this._textureCache.set(index, texture);
            this._texturePromises.delete(index);
            return texture;
        })();
        this._texturePromises.set(index, promise);
        return await promise;
    }

    static #getTextureTransform(texDef, json, texCoordIndex = 0) {
        const ext = texDef.extensions?.KHR_texture_transform;
        if (!ext) return null;
        const offset = Array.isArray(ext.offset) ? ext.offset.slice(0, 2) : [0, 0];
        const scale = Array.isArray(ext.scale) ? ext.scale.slice(0, 2) : [1, 1];
        const texCoord = Number.isFinite(ext.texCoord) ? ext.texCoord : texCoordIndex;
        return { offset, scale, texCoord };
    }

    static #decodeDataURI(uri) {
        const m = uri.match(/^data:[^;]+;base64,(.*)$/);
        if (!m) throw new Error('Unsupported data URI');
        const binary = atob(m[1]);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
}


