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

import { Quaternion } from './Quaternion.js';
import { clamp } from './MathUtils.js';

const warn = console.warn ? console.warn.bind(console) : () => {};

let _quaternion = null;
function getReusableQuaternion() {
    if (!_quaternion) {
        _quaternion = new Quaternion();
    }
    return _quaternion;
}

export class Euler {

    constructor(x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER) {

        this.isEuler = true;

        this._x = x;
        this._y = y;
        this._z = z;
        this._order = order;

    }

    get x() {

        return this._x;

    }

    set x(value) {

        this._x = value;
        this._onChangeCallback();

    }

    get y() {

        return this._y;

    }

    set y(value) {

        this._y = value;
        this._onChangeCallback();

    }

    get z() {

        return this._z;

    }

    set z(value) {

        this._z = value;
        this._onChangeCallback();

    }

    get order() {

        return this._order;

    }

    set order(value) {

        this._order = value;
        this._onChangeCallback();

    }

    set(x, y, z, order = this._order) {

        this._x = x;
        this._y = y;
        this._z = z;
        this._order = order;

        this._onChangeCallback();

        return this;

    }

    clone() {

        const Constructor = /** @type {new (...args: any[]) => this} */ (this.constructor);
        return new Constructor(this._x, this._y, this._z, this._order);

    }

    copy(euler) {

        this._x = euler._x;
        this._y = euler._y;
        this._z = euler._z;
        this._order = euler._order;

        this._onChangeCallback();

        return this;

    }

    setFromRotationMatrix(m, order = this._order, update = true) {

        const te = m.elements;
        const m11 = te[0], m12 = te[4], m13 = te[8];
        const m21 = te[1], m22 = te[5], m23 = te[9];
        const m31 = te[2], m32 = te[6], m33 = te[10];

        switch (order) {

        case 'XYZ':

            this._y = Math.asin(clamp(m13, -1, 1));

            if (Math.abs(m13) < 0.9999999) {

                this._x = Math.atan2(-m23, m33);
                this._z = Math.atan2(-m12, m11);

            } else {

                this._x = Math.atan2(m32, m22);
                this._z = 0;

            }

            break;

        case 'YXZ':

            this._x = Math.asin(-clamp(m23, -1, 1));

            if (Math.abs(m23) < 0.9999999) {

                this._y = Math.atan2(m13, m33);
                this._z = Math.atan2(m21, m22);

            } else {

                this._y = Math.atan2(-m31, m11);
                this._z = 0;

            }

            break;

        case 'ZXY':

            this._x = Math.asin(clamp(m32, -1, 1));

            if (Math.abs(m32) < 0.9999999) {

                this._y = Math.atan2(-m31, m33);
                this._z = Math.atan2(-m12, m22);

            } else {

                this._y = 0;
                this._z = Math.atan2(m21, m11);

            }

            break;

        case 'ZYX':

            this._y = Math.asin(-clamp(m31, -1, 1));

            if (Math.abs(m31) < 0.9999999) {

                this._x = Math.atan2(m32, m33);
                this._z = Math.atan2(m21, m11);

            } else {

                this._x = 0;
                this._z = Math.atan2(-m12, m22);

            }

            break;

        case 'YZX':

            this._z = Math.asin(clamp(m21, -1, 1));

            if (Math.abs(m21) < 0.9999999) {

                this._x = Math.atan2(-m23, m22);
                this._y = Math.atan2(-m31, m11);

            } else {

                this._x = 0;
                this._y = Math.atan2(m13, m33);

            }

            break;

        case 'XZY':

            this._z = Math.asin(-clamp(m12, -1, 1));

            if (Math.abs(m12) < 0.9999999) {

                this._x = Math.atan2(m32, m22);
                this._y = Math.atan2(m13, m11);

            } else {

                this._x = Math.atan2(-m23, m33);
                this._y = 0;

            }

            break;

        default:

            warn('Euler: .setFromRotationMatrix() encountered an unknown order: ' + order);

        }

        this._order = order;

        if (update === true) this._onChangeCallback();

        return this;

    }

    setFromQuaternion(q, order = this._order, update = true) {

        const x = q._x ?? q.x ?? 0;
        const y = q._y ?? q.y ?? 0;
        const z = q._z ?? q.z ?? 0;
        const w = q._w ?? q.w ?? 1;

        const xx = x * x;
        const yy = y * y;
        const zz = z * z;
        const xy = x * y;
        const xz = x * z;
        const yz = y * z;
        const wx = w * x;
        const wy = w * y;
        const wz = w * z;

        const te = new Float32Array(16);
        te[0] = 1 - 2 * (yy + zz);
        te[1] = 2 * (xy + wz);
        te[2] = 2 * (xz - wy);
        te[3] = 0;

        te[4] = 2 * (xy - wz);
        te[5] = 1 - 2 * (xx + zz);
        te[6] = 2 * (yz + wx);
        te[7] = 0;

        te[8] = 2 * (xz + wy);
        te[9] = 2 * (yz - wx);
        te[10] = 1 - 2 * (xx + yy);
        te[11] = 0;

        te[12] = 0;
        te[13] = 0;
        te[14] = 0;
        te[15] = 1;

        const tempMatrix = { elements: te };

        return this.setFromRotationMatrix(tempMatrix, order, update);

    }

    setFromVector3(v, order = this._order) {

        return this.set(v.x, v.y, v.z, order);

    }

    reorder(newOrder) {

        const q = getReusableQuaternion();
        q.setFromEuler(this);

        return this.setFromQuaternion(q, newOrder);

    }

    equals(euler) {

        return euler._x === this._x && euler._y === this._y && euler._z === this._z && euler._order === this._order;

    }

    fromArray(array) {

        this._x = array[0];
        this._y = array[1];
        this._z = array[2];
        if (array[3] !== undefined) this._order = array[3];

        this._onChangeCallback();

        return this;

    }

    toArray(array = [], offset = 0) {

        array[offset] = this._x;
        array[offset + 1] = this._y;
        array[offset + 2] = this._z;
        array[offset + 3] = this._order;

        return array;

    }

    _onChange(callback) {

        this._onChangeCallback = callback;

        return this;

    }

    _onChangeCallback() {}

    *[Symbol.iterator]() {

        yield this._x;
        yield this._y;
        yield this._z;
        yield this._order;

    }

}

Euler.DEFAULT_ORDER = 'XYZ';

