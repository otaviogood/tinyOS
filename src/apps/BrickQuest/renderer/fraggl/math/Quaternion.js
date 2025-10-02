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

import { clamp, setQuaternionFromProperEuler } from './MathUtils.js';
import { Euler } from './Euler.js';

class Quaternion {

    constructor(x = 0, y = 0, z = 0, w = 1) {

        this.isQuaternion = true;

        this._x = x;
        this._y = y;
        this._z = z;
        this._w = w;

    }

    static slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t) {

        let x0 = src0[srcOffset0 + 0];
        let y0 = src0[srcOffset0 + 1];
        let z0 = src0[srcOffset0 + 2];
        let w0 = src0[srcOffset0 + 3];

        let x1 = src1[srcOffset1 + 0];
        let y1 = src1[srcOffset1 + 1];
        let z1 = src1[srcOffset1 + 2];
        let w1 = src1[srcOffset1 + 3];

        if (t <= 0) {

            dst[dstOffset + 0] = x0;
            dst[dstOffset + 1] = y0;
            dst[dstOffset + 2] = z0;
            dst[dstOffset + 3] = w0;

            return;

        }

        if (t >= 1) {

            dst[dstOffset + 0] = x1;
            dst[dstOffset + 1] = y1;
            dst[dstOffset + 2] = z1;
            dst[dstOffset + 3] = w1;

            return;

        }

        if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {

            let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;

            if (dot < 0) {

                x1 = -x1;
                y1 = -y1;
                z1 = -z1;
                w1 = -w1;

                dot = -dot;

            }

            let s = 1 - t;

            if (dot < 0.9995) {

                const theta = Math.acos(dot);
                const sin = Math.sin(theta);

                s = Math.sin(s * theta) / sin;
                t = Math.sin(t * theta) / sin;

                x0 = x0 * s + x1 * t;
                y0 = y0 * s + y1 * t;
                z0 = z0 * s + z1 * t;
                w0 = w0 * s + w1 * t;

            } else {

                x0 = x0 * s + x1 * t;
                y0 = y0 * s + y1 * t;
                z0 = z0 * s + z1 * t;
                w0 = w0 * s + w1 * t;

                const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);

                x0 *= f;
                y0 *= f;
                z0 *= f;
                w0 *= f;

            }

        }

        dst[dstOffset + 0] = x0;
        dst[dstOffset + 1] = y0;
        dst[dstOffset + 2] = z0;
        dst[dstOffset + 3] = w0;

    }

    static multiplyQuaternionsFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1) {

        const x0 = src0[srcOffset0];
        const y0 = src0[srcOffset0 + 1];
        const z0 = src0[srcOffset0 + 2];
        const w0 = src0[srcOffset0 + 3];

        const x1 = src1[srcOffset1];
        const y1 = src1[srcOffset1 + 1];
        const z1 = src1[srcOffset1 + 2];
        const w1 = src1[srcOffset1 + 3];

        dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
        dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
        dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
        dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;

        return dst;

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

    get w() {

        return this._w;

    }

    set w(value) {

        this._w = value;
        this._onChangeCallback();

    }

    set(x, y, z, w) {

        this._x = x;
        this._y = y;
        this._z = z;
        this._w = w;

        this._onChangeCallback();

        return this;

    }

    clone() {

        const Constructor = /** @type {new (...args: any[]) => this} */ (this.constructor);
        return new Constructor(this._x, this._y, this._z, this._w);

    }

    copy(quaternion) {

        this._x = quaternion.x;
        this._y = quaternion.y;
        this._z = quaternion.z;
        this._w = quaternion.w;

        this._onChangeCallback();

        return this;

    }

    setFromEuler(euler, update = true) {

        if (!euler || euler.isEuler !== true) {
            const ex = euler?.x ?? 0;
            const ey = euler?.y ?? 0;
            const ez = euler?.z ?? 0;
            const eo = euler?.order ?? 'XYZ';
            euler = _euler.set(ex, ey, ez, eo);
            euler.isEuler = true;
        }

        let x = euler._x ?? euler.x;
        let y = euler._y ?? euler.y;
        let z = euler._z ?? euler.z;
        let order = euler._order ?? euler.order ?? 'XYZ';

        const cos = Math.cos;
        const sin = Math.sin;

        const c1 = cos(x / 2);
        const c2 = cos(y / 2);
        const c3 = cos(z / 2);

        const s1 = sin(x / 2);
        const s2 = sin(y / 2);
        const s3 = sin(z / 2);

        switch (order) {

            case 'XYZ':
                this._x = s1 * c2 * c3 + c1 * s2 * s3;
                this._y = c1 * s2 * c3 - s1 * c2 * s3;
                this._z = c1 * c2 * s3 + s1 * s2 * c3;
                this._w = c1 * c2 * c3 - s1 * s2 * s3;
                break;

            case 'YXZ':
                this._x = s1 * c2 * c3 + c1 * s2 * s3;
                this._y = c1 * s2 * c3 - s1 * c2 * s3;
                this._z = c1 * c2 * s3 - s1 * s2 * c3;
                this._w = c1 * c2 * c3 + s1 * s2 * s3;
                break;

            case 'ZXY':
                this._x = s1 * c2 * c3 - c1 * s2 * s3;
                this._y = c1 * s2 * c3 + s1 * c2 * s3;
                this._z = c1 * c2 * s3 + s1 * s2 * c3;
                this._w = c1 * c2 * c3 - s1 * s2 * s3;
                break;

            case 'ZYX':
                this._x = s1 * c2 * c3 - c1 * s2 * s3;
                this._y = c1 * s2 * c3 + s1 * c2 * s3;
                this._z = c1 * c2 * s3 - s1 * s2 * c3;
                this._w = c1 * c2 * c3 + s1 * s2 * s3;
                break;

            case 'YZX':
                this._x = s1 * c2 * c3 + c1 * s2 * s3;
                this._y = c1 * s2 * c3 + s1 * c2 * s3;
                this._z = c1 * c2 * s3 - s1 * s2 * c3;
                this._w = c1 * c2 * c3 - s1 * s2 * s3;
                break;

            case 'XZY':
                this._x = s1 * c2 * c3 - c1 * s2 * s3;
                this._y = c1 * s2 * c3 - s1 * c2 * s3;
                this._z = c1 * c2 * s3 + s1 * s2 * c3;
                this._w = c1 * c2 * c3 + s1 * s2 * s3;
                break;

            case 'XYX':
            case 'YZY':
            case 'ZXZ':
            case 'XZX':
            case 'YXY':
            case 'ZYZ':
                setQuaternionFromProperEuler(this, x, y, z, order);
                break;

            default:
                console.warn('Quaternion: .setFromEuler() encountered an unknown order: ' + order);

        }

        if (update === true) this._onChangeCallback();

        return this;

    }

    setFromAxisAngle(axis, angle) {

        const halfAngle = angle / 2;
        const s = Math.sin(halfAngle);

        this._x = axis.x * s;
        this._y = axis.y * s;
        this._z = axis.z * s;
        this._w = Math.cos(halfAngle);

        this._onChangeCallback();

        return this;

    }

    setFromRotationMatrix(m) {

        const te = m.elements;

        const m11 = te[0]; const m12 = te[4]; const m13 = te[8];
        const m21 = te[1]; const m22 = te[5]; const m23 = te[9];
        const m31 = te[2]; const m32 = te[6]; const m33 = te[10];

        const trace = m11 + m22 + m33;

        if (trace > 0) {

            const s = 0.5 / Math.sqrt(trace + 1.0);

            this._w = 0.25 / s;
            this._x = (m32 - m23) * s;
            this._y = (m13 - m31) * s;
            this._z = (m21 - m12) * s;

        } else if (m11 > m22 && m11 > m33) {

            const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);

            this._w = (m32 - m23) / s;
            this._x = 0.25 * s;
            this._y = (m12 + m21) / s;
            this._z = (m13 + m31) / s;

        } else if (m22 > m33) {

            const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);

            this._w = (m13 - m31) / s;
            this._x = (m12 + m21) / s;
            this._y = 0.25 * s;
            this._z = (m23 + m32) / s;

        } else {

            const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);

            this._w = (m21 - m12) / s;
            this._x = (m13 + m31) / s;
            this._y = (m23 + m32) / s;
            this._z = 0.25 * s;

        }

        this._onChangeCallback();

        return this;

    }

    setFromUnitVectors(vFrom, vTo) {

        let r = vFrom.dot(vTo) + 1;

        if (r < 1e-8) {

            r = 0;

            if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {

                this._x = -vFrom.y;
                this._y = vFrom.x;
                this._z = 0;
                this._w = r;

            } else {

                this._x = 0;
                this._y = -vFrom.z;
                this._z = vFrom.y;
                this._w = r;

            }

        } else {

            this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
            this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
            this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
            this._w = r;

        }

        return this.normalize();

    }

    angleTo(q) {

        return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));

    }

    rotateTowards(q, step) {

        const angle = this.angleTo(q);

        if (angle === 0) return this;

        const t = Math.min(1, step / angle);

        this.slerp(q, t);

        return this;

    }

    identity() {

        return this.set(0, 0, 0, 1);

    }

    invert() {

        return this.conjugate();

    }

    conjugate() {

        this._x *= -1;
        this._y *= -1;
        this._z *= -1;

        this._onChangeCallback();

        return this;

    }

    dot(v) {

        return this._x * v._x + this._y * v._y + this._z * v._z + this._w * v._w;

    }

    lengthSq() {

        return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;

    }

    length() {

        return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);

    }

    normalize() {

        let l = this.length();

        if (l === 0) {

            this._x = 0;
            this._y = 0;
            this._z = 0;
            this._w = 1;

        } else {

            l = 1 / l;

            this._x = this._x * l;
            this._y = this._y * l;
            this._z = this._z * l;
            this._w = this._w * l;

        }

        this._onChangeCallback();

        return this;

    }

    multiply(q) {

        return this.multiplyQuaternions(this, q);

    }

    premultiply(q) {

        return this.multiplyQuaternions(q, this);

    }

    multiplyQuaternions(a, b) {

        const qax = a._x; const qay = a._y; const qaz = a._z; const qaw = a._w;
        const qbx = b._x; const qby = b._y; const qbz = b._z; const qbw = b._w;

        this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
        this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
        this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
        this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

        this._onChangeCallback();

        return this;

    }

    slerp(qb, t) {

        if (t <= 0) return this;
        if (t >= 1) return this.copy(qb);

        let x = qb._x;
        let y = qb._y;
        let z = qb._z;
        let w = qb._w;

        let dot = this.dot(qb);

        if (dot < 0) {

            x = -x;
            y = -y;
            z = -z;
            w = -w;

            dot = -dot;

        }

        let s = 1 - t;

        if (dot < 0.9995) {

            const theta = Math.acos(dot);
            const sin = Math.sin(theta);

            s = Math.sin(s * theta) / sin;
            t = Math.sin(t * theta) / sin;

            this._x = this._x * s + x * t;
            this._y = this._y * s + y * t;
            this._z = this._z * s + z * t;
            this._w = this._w * s + w * t;

            this._onChangeCallback();

        } else {

            this._x = this._x * s + x * t;
            this._y = this._y * s + y * t;
            this._z = this._z * s + z * t;
            this._w = this._w * s + w * t;

            this.normalize();

        }

        return this;

    }

    slerpQuaternions(qa, qb, t) {

        return this.copy(qa).slerp(qb, t);

    }

    random() {

        const theta1 = 2 * Math.PI * Math.random();
        const theta2 = 2 * Math.PI * Math.random();

        const x0 = Math.random();
        const r1 = Math.sqrt(1 - x0);
        const r2 = Math.sqrt(x0);

        return this.set(
            r1 * Math.sin(theta1),
            r1 * Math.cos(theta1),
            r2 * Math.sin(theta2),
            r2 * Math.cos(theta2),
        );

    }

    equals(quaternion) {

        return (quaternion._x === this._x) && (quaternion._y === this._y) && (quaternion._z === this._z) && (quaternion._w === this._w);

    }

    fromArray(array, offset = 0) {

        this._x = array[offset];
        this._y = array[offset + 1];
        this._z = array[offset + 2];
        this._w = array[offset + 3];

        this._onChangeCallback();

        return this;

    }

    toArray(array = [], offset = 0) {

        array[offset] = this._x;
        array[offset + 1] = this._y;
        array[offset + 2] = this._z;
        array[offset + 3] = this._w;

        return array;

    }

    fromBufferAttribute(attribute, index) {

        this._x = attribute.getX(index);
        this._y = attribute.getY(index);
        this._z = attribute.getZ(index);
        this._w = attribute.getW(index);

        this._onChangeCallback();

        return this;

    }

    toJSON() {

        return this.toArray();

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
        yield this._w;

    }

}

Quaternion.prototype._onChangeCallback = function () {};

const _euler = new Euler();
_euler.isEuler = true;

export { Quaternion };
