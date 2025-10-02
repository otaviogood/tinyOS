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

import { BufferAttribute } from './BufferAttribute.js';
import { Box3 } from '../math/Box3.js';
import { Sphere } from '../math/Sphere.js';
import { Vector3 } from '../math/Vector3.js';
import { Matrix3 } from '../math/Matrix3.js';
import { Matrix4 } from '../math/Matrix4.js';

let _geometryId = 0;
const _vector = new Vector3();

export class BufferGeometry {
    constructor() {
        this.id = _geometryId++;
        this.isBufferGeometry = true;
        this.attributes = new Map();
        this.morphAttributes = new Map();
        this.index = null;
        this.boundingBox = null;
        this.boundingSphere = null;
        this.drawRange = { start: 0, count: Infinity };
        this.groups = [];
        this.userData = {};
        this.vertexCount = 0;
    }

    getAttribute(name) {
        return this.attributes.get(name);
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    setAttribute(name, attribute, itemSize, normalized = false) {
        let attr = attribute;
        if (!(attribute instanceof BufferAttribute)) {
            if (attribute == null) {
                throw new Error(`BufferGeometry.setAttribute('${name}'): attribute is null or undefined.`);
            }
            if (itemSize == null) {
                throw new Error(`BufferGeometry.setAttribute('${name}'): itemSize must be provided for raw array inputs.`);
            }
            attr = new BufferAttribute(attribute, itemSize, normalized);
        }
        this.attributes.set(name, attr);
        if (name === 'position') {
            this.vertexCount = attr.count;
        } else if (!this.vertexCount) {
            this.vertexCount = attr.count;
        }
        this.boundingBox = null;
        this.boundingSphere = null;
        return this;
    }

    deleteAttribute(name) {
        const result = this.attributes.delete(name);
        if (name === 'position') {
            this.vertexCount = 0;
        }
        return result;
    }

    setIndex(index, itemSize = 1, normalized = false) {
        if (index == null) {
            this.index = null;
            return this;
        }
        if (index instanceof BufferAttribute) {
            this.index = index;
            return this;
        }
        let array;
        if (Array.isArray(index)) {
            const max = index.reduce((m, v) => Math.max(m, v | 0), 0);
            const needs32 = max > 65535;
            array = needs32 ? new Uint32Array(index) : new Uint16Array(index);
        } else if (ArrayBuffer.isView(index)) {
            if (index instanceof Uint32Array || index instanceof Uint16Array || index instanceof Uint8Array) {
                array = index instanceof Uint8Array ? new Uint16Array(index) : index;
            } else {
                throw new TypeError('BufferGeometry.setIndex expects a Uint16Array or Uint32Array.');
            }
        } else {
            throw new TypeError('BufferGeometry.setIndex expects an array or typed array.');
        }
        this.index = new BufferAttribute(array, itemSize, normalized);
        return this;
    }

    getIndex() {
        return this.index;
    }

    addGroup(start, count, materialIndex = 0) {
        this.groups.push({ start, count, materialIndex });
        return this;
    }

    clearGroups() {
        this.groups.length = 0;
    }

    setDrawRange(start, count) {
        this.drawRange.start = start;
        this.drawRange.count = count;
        return this;
    }

    clone() {
        return new this.constructor().copy(this);
    }

    copy(source) {
        this.attributes = new Map();
        for (const [name, attr] of source.attributes) {
            this.attributes.set(name, attr.clone());
        }
        this.morphAttributes = new Map();
        for (const [name, list] of source.morphAttributes) {
            this.morphAttributes.set(name, list.map(attr => attr.clone()));
        }
        this.index = source.index ? source.index.clone() : null;
        this.boundingBox = source.boundingBox ? source.boundingBox.clone() : null;
        this.boundingSphere = source.boundingSphere ? source.boundingSphere.clone() : null;
        this.drawRange = { start: source.drawRange.start, count: source.drawRange.count };
        this.groups = source.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex }));
        this.userData = { ...source.userData };
        this.vertexCount = source.vertexCount;
        return this;
    }

    computeBoundingBox() {
        const position = this.attributes.get('position');
        if (!position) {
            this.boundingBox = this.boundingBox || new Box3();
            this.boundingBox.makeEmpty();
            return this.boundingBox;
        }
        if (position.itemSize < 3) {
            throw new Error('BufferGeometry.computeBoundingBox: position attribute itemSize must be >= 3.');
        }
        const box = this.boundingBox || new Box3();
        box.makeEmpty();
        const array = position.array;
        const stride = position.itemSize;
        for (let i = 0, l = position.count; i < l; i++) {
            const offset = i * stride;
            const x = array[offset];
            const y = array[offset + 1];
            const z = array[offset + 2];
            _vector.set(x, y, z);
            box.expandByPoint(_vector);
        }
        this.boundingBox = box;
        return box;
    }

    computeBoundingSphere() {
        const position = this.attributes.get('position');
        if (!position) {
            this.boundingSphere = this.boundingSphere || new Sphere();
            this.boundingSphere.makeEmpty?.();
            return this.boundingSphere;
        }
        if (position.itemSize < 3) {
            throw new Error('BufferGeometry.computeBoundingSphere: position attribute itemSize must be >= 3.');
        }
        const sphere = this.boundingSphere || new Sphere();
        const box = this.boundingBox ? this.boundingBox : this.computeBoundingBox();
        const center = sphere.center;
        box.getCenter(center);
        let maxRadiusSq = 0;
        const array = position.array;
        const stride = position.itemSize;
        for (let i = 0, l = position.count; i < l; i++) {
            const offset = i * stride;
            const x = array[offset];
            const y = array[offset + 1];
            const z = array[offset + 2];
            _vector.set(x, y, z);
            maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
        }
        sphere.center = center;
        sphere.radius = Math.sqrt(maxRadiusSq);
        this.boundingSphere = sphere;
        return sphere;
    }

    applyMatrix4(matrix) {
        if (!(matrix instanceof Matrix4)) {
            throw new TypeError('BufferGeometry.applyMatrix4 expects a Matrix4.');
        }
        const position = this.attributes.get('position');
        if (position) {
            position.applyMatrix4(matrix);
        }
        const normal = this.attributes.get('normal');
        if (normal) {
            const normalMatrix = new Matrix3().getNormalMatrixFromMatrix4(matrix);
            normal.applyNormalMatrix(normalMatrix);
        }
        this.boundingBox = null;
        this.boundingSphere = null;
        return this;
    }

    dispose() {
        this.dispatchEvent?.({ type: 'dispose' });
    }
}

