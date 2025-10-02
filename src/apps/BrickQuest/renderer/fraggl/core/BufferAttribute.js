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

import { Matrix3 } from '../math/Matrix3.js';
import { Matrix4 } from '../math/Matrix4.js';
import { Vector3 } from '../math/Vector3.js';

const _vector = new Vector3();
const _normal = new Vector3();

function toTypedArray(array) {
    if (ArrayBuffer.isView(array)) return array;
    if (Array.isArray(array)) return new Float32Array(array);
    throw new TypeError('BufferAttribute expects a typed array or array of numbers.');
}

export class BufferAttribute {
    constructor(array, itemSize, normalized = false) {
        const typed = toTypedArray(array);
        if (!Number.isInteger(itemSize) || itemSize <= 0) {
            throw new TypeError('BufferAttribute itemSize must be a positive integer.');
        }
        if (typed.length % itemSize !== 0) {
            throw new Error('BufferAttribute array length must be divisible by the itemSize.');
        }

        this.isBufferAttribute = true;
        this.array = typed;
        this.itemSize = itemSize;
        this.count = typed.length / itemSize;
        this.normalized = !!normalized;
        this.usage = 'static';
        this.needsUpdate = false;
    }

    setUsage(usage) {
        this.usage = usage;
        return this;
    }

    clone() {
        return new BufferAttribute(this.array.slice(0), this.itemSize, this.normalized);
    }

    copy(source) {
        this.array = source.array.slice(0);
        this.itemSize = source.itemSize;
        this.count = source.count;
        this.normalized = source.normalized;
        this.usage = source.usage;
        this.needsUpdate = true;
        return this;
    }

    getX(index) {
        return this.array[index * this.itemSize];
    }

    getY(index) {
        if (this.itemSize < 2) return 0;
        return this.array[index * this.itemSize + 1];
    }

    getZ(index) {
        if (this.itemSize < 3) return 0;
        return this.array[index * this.itemSize + 2];
    }

    getW(index) {
        if (this.itemSize < 4) return 0;
        return this.array[index * this.itemSize + 3];
    }

    setX(index, x) {
        this.array[index * this.itemSize] = x;
        this.needsUpdate = true;
        return this;
    }

    setY(index, y) {
        if (this.itemSize < 2) return this;
        this.array[index * this.itemSize + 1] = y;
        this.needsUpdate = true;
        return this;
    }

    setZ(index, z) {
        if (this.itemSize < 3) return this;
        this.array[index * this.itemSize + 2] = z;
        this.needsUpdate = true;
        return this;
    }

    setW(index, w) {
        if (this.itemSize < 4) return this;
        this.array[index * this.itemSize + 3] = w;
        this.needsUpdate = true;
        return this;
    }

    setXYZ(index, x, y, z) {
        const offset = index * this.itemSize;
        this.array[offset] = x;
        if (this.itemSize > 1) this.array[offset + 1] = y;
        if (this.itemSize > 2) this.array[offset + 2] = z;
        this.needsUpdate = true;
        return this;
    }

    setXYZW(index, x, y, z, w) {
        const offset = index * this.itemSize;
        this.array[offset] = x;
        if (this.itemSize > 1) this.array[offset + 1] = y;
        if (this.itemSize > 2) this.array[offset + 2] = z;
        if (this.itemSize > 3) this.array[offset + 3] = w;
        this.needsUpdate = true;
        return this;
    }

    toArray(array = [], offset = 0) {
        array.set(this.array, offset);
        return array;
    }

    applyMatrix4(matrix) {
        if (!(matrix instanceof Matrix4)) throw new TypeError('applyMatrix4 expects a Matrix4.');
        if (this.itemSize < 3) return this;
        for (let i = 0; i < this.count; i++) {
            _vector.fromArray(this.array, i * this.itemSize);
            _vector.applyMatrix4(matrix);
            _vector.toArray(this.array, i * this.itemSize);
        }
        this.needsUpdate = true;
        return this;
    }

    applyNormalMatrix(matrix) {
        if (!(matrix instanceof Matrix3)) throw new TypeError('applyNormalMatrix expects a Matrix3.');
        if (this.itemSize < 3) return this;
        for (let i = 0; i < this.count; i++) {
            _normal.fromArray(this.array, i * this.itemSize);
            _normal.applyMatrix3(matrix).normalize();
            _normal.toArray(this.array, i * this.itemSize);
        }
        this.needsUpdate = true;
        return this;
    }

    transformDirection(matrix) {
        if (!(matrix instanceof Matrix4)) throw new TypeError('transformDirection expects a Matrix4.');
        if (this.itemSize < 3) return this;
        for (let i = 0; i < this.count; i++) {
            _vector.fromArray(this.array, i * this.itemSize);
            _vector.transformDirection(matrix);
            _vector.toArray(this.array, i * this.itemSize);
        }
        this.needsUpdate = true;
        return this;
    }
}


