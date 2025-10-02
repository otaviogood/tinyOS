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

import { Object3D } from './Object3D.js';
import { BufferGeometry } from './BufferGeometry.js';
import { BasicMaterial } from '../materials/BasicMaterial.js';
import { Matrix4 } from '../math/Matrix4.js';
import { Ray } from '../math/Ray.js';
import { Sphere } from '../math/Sphere.js';
import { Vector2 } from '../math/Vector2.js';
import { Vector3 } from '../math/Vector3.js';
import { Box3 } from '../math/Box3.js';
import { BackSide, DoubleSide, FrontSide } from '../materials/Material.js';

const _inverseMatrix = new Matrix4();
const _ray = new Ray();
const _sphere = new Sphere();
const _sphereHitAt = new Vector3();

const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();

const _tempA = new Vector3();
const _morphA = new Vector3();

const _intersectionPoint = new Vector3();
const _intersectionPointWorld = new Vector3();
const _barycoord = new Vector3();
const _faceNormal = new Vector3();
const _tmpVec0 = new Vector3();
const _tmpVec1 = new Vector3();
const _tmpVec2 = new Vector3();

function getGeometryAttribute(geometry, name) {
    if (!geometry) return undefined;
    if (typeof geometry.getAttribute === 'function') return geometry.getAttribute(name);
    if (geometry.attributes instanceof Map) return geometry.attributes.get(name);
    return geometry.attributes ? geometry.attributes[name] : undefined;
}

function getGeometryMorphAttribute(geometry, name) {
    if (!geometry || !geometry.morphAttributes) return undefined;
    const morphAttributes = geometry.morphAttributes;
    if (morphAttributes instanceof Map) return morphAttributes.get(name);
    if (typeof morphAttributes === 'object') return morphAttributes[name];
    return undefined;
}

function ensureArrayLike(value) {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value.length === 'number') return Array.from(value);
    return undefined;
}

function computeBarycoord(point, a, b, c, target) {
    _tmpVec0.subVectors(b, a);
    _tmpVec1.subVectors(c, a);
    _tmpVec2.subVectors(point, a);

    const dot00 = _tmpVec0.dot(_tmpVec0);
    const dot01 = _tmpVec0.dot(_tmpVec1);
    const dot11 = _tmpVec1.dot(_tmpVec1);
    const dot20 = _tmpVec2.dot(_tmpVec0);
    const dot21 = _tmpVec2.dot(_tmpVec1);

    const denom = dot00 * dot11 - dot01 * dot01;
    if (denom === 0) {
        target.set(-1, -1, -1);
        return target;
    }

    const v = (dot11 * dot20 - dot01 * dot21) / denom;
    const w = (dot00 * dot21 - dot01 * dot20) / denom;
    target.set(1 - v - w, v, w);
    return target;
}

function interpolateAttribute(attribute, a, b, c, barycoord, target) {
    if (!attribute) return null;

    const { itemSize } = attribute;
    const alpha = barycoord.x;
    const beta = barycoord.y;
    const gamma = barycoord.z;

    if (itemSize >= 3 && target instanceof Vector3) {
        target.set(0, 0, 0);
        target.addScaledVector(_tmpVec0.fromBufferAttribute(attribute, a), alpha);
        target.addScaledVector(_tmpVec1.fromBufferAttribute(attribute, b), beta);
        target.addScaledVector(_tmpVec2.fromBufferAttribute(attribute, c), gamma);
        return target;
    }

    if (itemSize >= 2 && target instanceof Vector2) {
        const ax = attribute.getX(a);
        const ay = attribute.getY(a);
        const bx = attribute.getX(b);
        const by = attribute.getY(b);
        const cx = attribute.getX(c);
        const cy = attribute.getY(c);
        target.set(
            ax * alpha + bx * beta + cx * gamma,
            ay * alpha + by * beta + cy * gamma
        );
        return target;
    }

    return null;
}

function computeFaceNormal(a, b, c, target) {
    _tmpVec0.subVectors(c, b);
    _tmpVec1.subVectors(a, b);
    return target.crossVectors(_tmpVec0, _tmpVec1).normalize();
}

// -------------------------------------------------------------
// Triangle BVH (per-geometry) for fast raycasting
// -------------------------------------------------------------

const _triangleBVHCache = new WeakMap();

function _getGeometryAttributeCount(attr) {
    if (!attr) return 0;
    if (Number.isFinite(attr.count)) return attr.count | 0;
    const array = attr.array ?? attr;
    const itemSize = attr.itemSize ?? 3;
    if (!array || typeof array.length !== 'number' || itemSize <= 0) return 0;
    return Math.floor(array.length / itemSize);
}

function _getGeometryIndex(geometry) {
    return geometry.index ?? geometry.getIndex?.();
}

function buildTriangleBVH(geometry) {
    if (!geometry) return null;
    const position = getGeometryAttribute(geometry, 'position');
    const indexAttr = _getGeometryIndex(geometry);
    const vertexCount = _getGeometryAttributeCount(position);
    if (!position || vertexCount < 3) return null;

    let triCount;
    if (indexAttr && indexAttr.count) {
        triCount = Math.floor(indexAttr.count / 3);
    } else {
        triCount = Math.floor(vertexCount / 3);
    }
    if (triCount <= 0) return null;

    const triOrder = new Int32Array(triCount);
    const triCentroids = new Float32Array(triCount * 3);
    const triBoundsMin = new Float32Array(triCount * 3);
    const triBoundsMax = new Float32Array(triCount * 3);

    const va = new Vector3();
    const vb = new Vector3();
    const vc = new Vector3();

    for (let t = 0; t < triCount; t++) {
        triOrder[t] = t;
        let a, b, c;
        if (indexAttr && indexAttr.count) {
            const i = t * 3;
            a = indexAttr.getX(i);
            b = indexAttr.getX(i + 1);
            c = indexAttr.getX(i + 2);
        } else {
            const i = t * 3;
            a = i; b = i + 1; c = i + 2;
        }
        va.fromBufferAttribute(position, a);
        vb.fromBufferAttribute(position, b);
        vc.fromBufferAttribute(position, c);
        const off = t * 3;
        triBoundsMin[off] = Math.min(va.x, vb.x, vc.x);
        triBoundsMin[off + 1] = Math.min(va.y, vb.y, vc.y);
        triBoundsMin[off + 2] = Math.min(va.z, vb.z, vc.z);
        triBoundsMax[off] = Math.max(va.x, vb.x, vc.x);
        triBoundsMax[off + 1] = Math.max(va.y, vb.y, vc.y);
        triBoundsMax[off + 2] = Math.max(va.z, vb.z, vc.z);
        triCentroids[off] = (va.x + vb.x + vc.x) / 3;
        triCentroids[off + 1] = (va.y + vb.y + vc.y) / 3;
        triCentroids[off + 2] = (va.z + vb.z + vc.z) / 3;
    }

    const nodes = [];
    const nodeBounds = [];

    function computeRangeBounds(start, count, outMin, outMax) {
        outMin.set(+Infinity, +Infinity, +Infinity);
        outMax.set(-Infinity, -Infinity, -Infinity);
        for (let i = 0; i < count; i++) {
            const triIndex = triOrder[start + i];
            const off = triIndex * 3;
            const minx = triBoundsMin[off], miny = triBoundsMin[off + 1], minz = triBoundsMin[off + 2];
            const maxx = triBoundsMax[off], maxy = triBoundsMax[off + 1], maxz = triBoundsMax[off + 2];
            if (minx < outMin.x) outMin.x = minx; if (miny < outMin.y) outMin.y = miny; if (minz < outMin.z) outMin.z = minz;
            if (maxx > outMax.x) outMax.x = maxx; if (maxy > outMax.y) outMax.y = maxy; if (maxz > outMax.z) outMax.z = maxz;
        }
    }

    function partition(start, count, axis, pivot) {
        let i = start, j = start + count - 1;
        while (i <= j) {
            const oi = triOrder[i] * 3 + axis;
            if (triCentroids[oi] < pivot) {
                i++;
            } else {
                const tmp = triOrder[i];
                triOrder[i] = triOrder[j];
                triOrder[j] = tmp;
                j--;
            }
        }
        return i;
    }

    function buildNode(start, count, depth) {
        const min = new Vector3();
        const max = new Vector3();
        computeRangeBounds(start, count, min, max);
        const nodeIndex = nodes.length;
        nodes.push({ start, count, left: -1, right: -1 });
        nodeBounds.push({ min, max });
        if (count <= 8 || depth >= 32) return nodeIndex;

        const sizeX = max.x - min.x;
        const sizeY = max.y - min.y;
        const sizeZ = max.z - min.z;
        let axis = 0;
        if (sizeY > sizeX && sizeY >= sizeZ) axis = 1; else if (sizeZ > sizeX && sizeZ >= sizeY) axis = 2;

        let sum = 0;
        for (let i = 0; i < count; i++) sum += triCentroids[(triOrder[start + i] * 3) + axis];
        const pivot = sum / count;
        const mid = partition(start, count, axis, pivot);

        const leftCount = mid - start;
        if (leftCount === 0 || leftCount === count) {
            // fallback: split by half after sorting
            const slice = Array.from(triOrder.subarray(start, start + count));
            slice.sort((a, b) => triCentroids[a * 3 + axis] - triCentroids[b * 3 + axis]);
            for (let i = 0; i < slice.length; i++) triOrder[start + i] = slice[i];
            const half = count >> 1;
            const leftIndex = buildNode(start, half, depth + 1);
            const rightIndex = buildNode(start + half, count - half, depth + 1);
            nodes[nodeIndex].left = leftIndex;
            nodes[nodeIndex].right = rightIndex;
            return nodeIndex;
        }

        const leftIndex = buildNode(start, leftCount, depth + 1);
        const rightIndex = buildNode(mid, count - leftCount, depth + 1);
        nodes[nodeIndex].left = leftIndex;
        nodes[nodeIndex].right = rightIndex;
        return nodeIndex;
    }

    const root = buildNode(0, triCount, 0);
    return { root, nodes, nodeBounds, triOrder, triCount };
}

function ensureGeometryBVH(geometry) {
    let bvh = _triangleBVHCache.get(geometry);
    if (!bvh) {
        bvh = buildTriangleBVH(geometry);
        if (bvh) _triangleBVHCache.set(geometry, bvh);
    }
    return bvh || null;
}

export class Mesh extends Object3D {
    constructor(geometry = new BufferGeometry(), material = new BasicMaterial(), options = {}) {
        super();

        this.isMesh = true;
        this.type = 'Mesh';

        this._geometry = null;
        this._buildBVH = options.buildBVH || false; // Opt-in: only build BVH if explicitly requested
        this.geometry = geometry;
        this.material = material;

        this.morphTargetDictionary = undefined;
        this.morphTargetInfluences = undefined;

        this.count = 1;

        this.updateMorphTargets();
    }

    get geometry() {
        return this._geometry;
    }

    set geometry(g) {
        this._geometry = g;
        // BVH building is expensive (~100ms for large geometries)
        // Only build eagerly if explicitly requested; otherwise build lazily in raycast if needed
        if (g && this._buildBVH) {
            try { ensureGeometryBVH(g); } catch (_) {}
        }
    }

    copy(source, recursive) {
        super.copy(source, recursive);

        if (source.morphTargetInfluences !== undefined) {
            this.morphTargetInfluences = source.morphTargetInfluences.slice();
        } else {
            this.morphTargetInfluences = undefined;
        }

        if (source.morphTargetDictionary !== undefined) {
            this.morphTargetDictionary = { ...source.morphTargetDictionary };
        } else {
            this.morphTargetDictionary = undefined;
        }

        this.material = Array.isArray(source.material) ? source.material.slice() : source.material;
        this.geometry = source.geometry;
        this.count = source.count;

        return this;
    }

    updateMorphTargets() {
        const geometry = this.geometry;
        if (!geometry) {
            this.morphTargetDictionary = undefined;
            this.morphTargetInfluences = undefined;
            return;
        }

        const morphAttributes = geometry.morphAttributes;
        let morphArray;
        if (morphAttributes instanceof Map) {
            const iterator = morphAttributes.values().next();
            morphArray = iterator.done ? undefined : iterator.value;
        } else if (morphAttributes && typeof morphAttributes === 'object') {
            const keys = Object.keys(morphAttributes);
            morphArray = keys.length > 0 ? morphAttributes[keys[0]] : undefined;
        }

        morphArray = ensureArrayLike(morphArray);

        if (!morphArray || morphArray.length === 0) {
            this.morphTargetDictionary = undefined;
            this.morphTargetInfluences = undefined;
            return;
        }

        this.morphTargetInfluences = [];
        this.morphTargetDictionary = {};

        for (let i = 0; i < morphArray.length; i++) {
            const attr = morphArray[i];
            const name = attr?.name ?? String(i);
            this.morphTargetInfluences.push(0);
            this.morphTargetDictionary[name] = i;
        }
    }

    getVertexPosition(index, target = new Vector3()) {
        const geometry = this.geometry;
        if (!geometry) return target.set(0, 0, 0);

        const position = getGeometryAttribute(geometry, 'position');
        if (!position) return target.set(0, 0, 0);

        target.fromBufferAttribute(position, index);

        const morphPosition = getGeometryMorphAttribute(geometry, 'position');
        const morphTargetsRelative = geometry.morphTargetsRelative === true;
        const morphInfluences = this.morphTargetInfluences;

        if (morphPosition && morphInfluences) {
            _morphA.set(0, 0, 0);
            for (let i = 0, il = morphPosition.length; i < il; i++) {
                const influence = morphInfluences[i];
                if (!influence) continue;
                const morphAttribute = morphPosition[i];
                if (!morphAttribute) continue;

                _tempA.fromBufferAttribute(morphAttribute, index);

                if (morphTargetsRelative) {
                    _morphA.addScaledVector(_tempA, influence);
                } else {
                    _morphA.addScaledVector(_tempA.sub(target), influence);
                }
            }

            target.add(_morphA);
        }

        return target;
    }

    raycast(raycaster, intersects) {
        const geometry = this.geometry;
        let material = this.material;
        const matrixWorld = this.matrixWorld;

        if (!geometry || material === undefined) return;
        if (Array.isArray(material) && material.length === 0) return;

        if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
        if (!geometry.boundingSphere) return;

        _sphere.copy(geometry.boundingSphere);
        _sphere.applyMatrix4(matrixWorld);

        const near = raycaster?.near ?? 0;
        const far = raycaster?.far ?? Infinity;

        _ray.copy(raycaster?.ray ?? new Ray());
        if (near > 0) _ray.recast(near);

        if (_sphere.containsPoint(_ray.origin) === false) {
            if (_ray.intersectSphere(_sphere, _sphereHitAt) === null) return;
            if (Number.isFinite(far) && _ray.origin.distanceToSquared(_sphereHitAt) > (far - near) * (far - near)) return;
        }

        _inverseMatrix.copy(matrixWorld).invert();
        _ray.copy(raycaster?.ray ?? new Ray()).applyMatrix4(_inverseMatrix);

        if (geometry.boundingBox) {
            if (_ray.intersectBox(geometry.boundingBox, _tmpVec0) === null) return;
        }

        this._computeIntersections(raycaster, intersects, _ray);
    }

    _computeIntersections(raycaster, intersects, rayLocalSpace) {
        const geometry = this.geometry;
        const material = this.material;
        if (!geometry || !material) return;

        const index = geometry.index ?? geometry.getIndex?.();
        const position = getGeometryAttribute(geometry, 'position');
        if (!position) return;

        const uv = getGeometryAttribute(geometry, 'uv');
        const uv1 = getGeometryAttribute(geometry, 'uv1') || getGeometryAttribute(geometry, 'uv2');
        const normal = getGeometryAttribute(geometry, 'normal');
        const groups = geometry.groups ?? [];
        const drawRange = geometry.drawRange ?? { start: 0, count: Infinity };

        const materials = Array.isArray(material) ? material : [material];

        const singleMaterial = materials[0];
        const canUseBVH = (groups.length === 0 && materials.length === 1);
        const bvh = canUseBVH ? ensureGeometryBVH(geometry) : null;

        const intersectTriangle = (materialToUse, a, b, c, faceIndex) => {
            if (!materialToUse || materialToUse.visible === false) return;
            const intersection = checkGeometryIntersection(this, materialToUse, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
            if (!intersection) return;
            intersection.faceIndex = faceIndex;
            intersects.push(intersection);
        };

        if (bvh) {
            const tmpBox = new Box3();
            const triStart = Math.max(0, drawRange.start);
            const triEndIndexed = index ? Math.min(index.count, drawRange.start + drawRange.count) : null;
            const vertexCount = position.count;
            const endVertices = Math.min(vertexCount, drawRange.start + drawRange.count);

            const stack = [bvh.root];
            while (stack.length) {
                const nodeIndex = stack.pop();
                if (nodeIndex == null) continue;
                const node = bvh.nodes[nodeIndex];
                const bounds = bvh.nodeBounds[nodeIndex];
                tmpBox.min.copy(bounds.min);
                tmpBox.max.copy(bounds.max);
                if (rayLocalSpace.intersectBox(tmpBox, _tmpVec0) === null) continue;

                if (node.left === -1 && node.right === -1) {
                    for (let i = 0; i < node.count; i++) {
                        const triIndex = bvh.triOrder[node.start + i];
                        const first = triIndex * 3;
                        // Respect drawRange
                        if (index) {
                            if (first < triStart || (first + 2) >= triEndIndexed) continue;
                            const a = index.getX(first);
                            const b = index.getX(first + 1);
                            const c = index.getX(first + 2);
                            intersectTriangle(singleMaterial, a, b, c, triIndex);
                        } else {
                            const startV = Math.max(0, drawRange.start);
                            if (first < startV || (first + 2) >= endVertices) continue;
                            const a = first;
                            const b = first + 1;
                            const c = first + 2;
                            intersectTriangle(singleMaterial, a, b, c, triIndex);
                        }
                    }
                } else {
                    if (node.left !== -1) stack.push(node.left);
                    if (node.right !== -1) stack.push(node.right);
                }
            }
            return;
        }

        // Fallback to linear iteration (groups/materials aware)
        if (index) {
            const start = Math.max(0, drawRange.start);
            const end = Math.min(index.count, drawRange.start + drawRange.count);

            if (materials.length > 1 && groups.length > 0) {
                for (const group of groups) {
                    const groupMaterial = materials[group.materialIndex] ?? materials[0];
                    const groupStart = Math.max(group.start, start);
                    const groupEnd = Math.min(end, group.start + group.count);
                    for (let i = groupStart; i < groupEnd; i += 3) {
                        const a = index.getX(i);
                        const b = index.getX(i + 1);
                        const c = index.getX(i + 2);
                        const faceIndex = Math.floor(i / 3);
                        const hit = checkGeometryIntersection(this, groupMaterial, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
                        if (!hit) continue;
                        hit.faceIndex = faceIndex;
                        hit.face.materialIndex = group.materialIndex ?? 0;
                        intersects.push(hit);
                    }
                }
            } else {
                for (let i = start; i < end; i += 3) {
                    const a = index.getX(i);
                    const b = index.getX(i + 1);
                    const c = index.getX(i + 2);
                    intersectTriangle(singleMaterial, a, b, c, Math.floor(i / 3));
                }
            }
        } else {
            const vertexCount = position.count;
            const start = Math.max(0, drawRange.start);
            const end = Math.min(vertexCount, drawRange.start + drawRange.count);

            if (materials.length > 1 && groups.length > 0) {
                for (const group of groups) {
                    const groupMaterial = materials[group.materialIndex] ?? materials[0];
                    const groupStart = Math.max(group.start, start);
                    const groupEnd = Math.min(end, group.start + group.count);
                    for (let i = groupStart; i < groupEnd; i += 3) {
                        const a = i;
                        const b = i + 1;
                        const c = i + 2;
                        const hit = checkGeometryIntersection(this, groupMaterial, raycaster, rayLocalSpace, uv, uv1, normal, a, b, c);
                        if (!hit) continue;
                        hit.faceIndex = Math.floor(i / 3);
                        hit.face.materialIndex = group.materialIndex ?? 0;
                        intersects.push(hit);
                    }
                }
            } else {
                for (let i = start; i < end; i += 3) {
                    const a = i;
                    const b = i + 1;
                    const c = i + 2;
                    intersectTriangle(singleMaterial, a, b, c, Math.floor(i / 3));
                }
            }
        }
    }
}

function checkIntersection(object, material, raycaster, ray, pA, pB, pC, point) {
    let intersect = null;

    if (material.side === BackSide) {
        intersect = ray.intersectTriangle(pC, pB, pA, true, point);
    } else {
        const backfaceCulling = material.side === FrontSide;
        intersect = ray.intersectTriangle(pA, pB, pC, backfaceCulling, point);
    }

    if (intersect === null) return null;

    _intersectionPointWorld.copy(point).applyMatrix4(object.matrixWorld);

    const distance = (raycaster?.ray ?? ray).origin.distanceTo(_intersectionPointWorld);
    const near = raycaster?.near ?? 0;
    const far = raycaster?.far ?? Infinity;

    if (distance < near || distance > far) return null;

    return {
        distance,
        point: _intersectionPointWorld.clone(),
        object
    };
}

function checkGeometryIntersection(object, material, raycaster, ray, uv, uv1, normal, a, b, c) {
    object.getVertexPosition(a, _vA);
    object.getVertexPosition(b, _vB);
    object.getVertexPosition(c, _vC);

    const intersection = checkIntersection(object, material, raycaster, ray, _vA, _vB, _vC, _intersectionPoint);
    if (!intersection) return null;

    computeBarycoord(_intersectionPoint, _vA, _vB, _vC, _barycoord);

    if (uv) {
        const uvTarget = new Vector2();
        interpolateAttribute(uv, a, b, c, _barycoord, uvTarget);
        intersection.uv = uvTarget;
    }

    if (uv1) {
        const uv1Target = new Vector2();
        interpolateAttribute(uv1, a, b, c, _barycoord, uv1Target);
        intersection.uv1 = uv1Target;
    }

    if (normal) {
        const normalTarget = new Vector3();
        interpolateAttribute(normal, a, b, c, _barycoord, normalTarget);
        if (normalTarget.dot(ray.direction) > 0) normalTarget.multiplyScalar(-1);
        intersection.normal = normalTarget.normalize();
    }

    const face = {
        a,
        b,
        c,
        normal: computeFaceNormal(_vA, _vB, _vC, _faceNormal.clone()),
        materialIndex: 0
    };

    intersection.face = face;
    intersection.barycoord = _barycoord.clone();

    return intersection;
}

