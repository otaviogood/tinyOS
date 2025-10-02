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

export class Matrix3 {
    constructor() {
        this.elements = new Float32Array(9);
        this.identity();
    }

    identity() {
        const e = this.elements;
        e[0] = 1; e[3] = 0; e[6] = 0;
        e[1] = 0; e[4] = 1; e[7] = 0;
        e[2] = 0; e[5] = 0; e[8] = 1;
        return this;
    }

    copy(m) { this.elements.set(m.elements); return this; }

    // this = a * b
    multiply(a, b) {
        const ae = a.elements, be = b.elements, te = this.elements;
        const a11 = ae[0], a12 = ae[3], a13 = ae[6];
        const a21 = ae[1], a22 = ae[4], a23 = ae[7];
        const a31 = ae[2], a32 = ae[5], a33 = ae[8];

        const b11 = be[0], b12 = be[3], b13 = be[6];
        const b21 = be[1], b22 = be[4], b23 = be[7];
        const b31 = be[2], b32 = be[5], b33 = be[8];

        te[0] = a11*b11 + a12*b21 + a13*b31;
        te[3] = a11*b12 + a12*b22 + a13*b32;
        te[6] = a11*b13 + a12*b23 + a13*b33;

        te[1] = a21*b11 + a22*b21 + a23*b31;
        te[4] = a21*b12 + a22*b22 + a23*b32;
        te[7] = a21*b13 + a22*b23 + a23*b33;

        te[2] = a31*b11 + a32*b21 + a33*b31;
        te[5] = a31*b12 + a32*b22 + a33*b32;
        te[8] = a31*b13 + a32*b23 + a33*b33;
        return this;
    }

    // Set from upper-left 3x3 of a Matrix4
    setFromMatrix4(m4) {
        const me = m4.elements; const te = this.elements;
        te[0] = me[0]; te[3] = me[4]; te[6] = me[8];
        te[1] = me[1]; te[4] = me[5]; te[7] = me[9];
        te[2] = me[2]; te[5] = me[6]; te[8] = me[10];
        return this;
    }

    // Invert and transpose this matrix (for normal matrix)
    getNormalMatrixFromMatrix4(m4) {
        this.setFromMatrix4(m4);
        this.invert();
        this.transpose();
        return this;
    }

    invert() {
        const m = this.elements;
        const n11 = m[0], n21 = m[1], n31 = m[2];
        const n12 = m[3], n22 = m[4], n32 = m[5];
        const n13 = m[6], n23 = m[7], n33 = m[8];

        const t11 = n33 * n22 - n32 * n23;
        const t12 = n32 * n13 - n33 * n12;
        const t13 = n23 * n12 - n22 * n13;

        const det = n11 * t11 + n21 * t12 + n31 * t13;

        if (det === 0) {
            return this.set(
                0, 0, 0,
                0, 0, 0,
                0, 0, 0
            );
        }

        const detInv = 1 / det;

        m[0] = t11 * detInv;
        m[1] = (n31 * n23 - n33 * n21) * detInv;
        m[2] = (n32 * n21 - n31 * n22) * detInv;

        m[3] = t12 * detInv;
        m[4] = (n33 * n11 - n31 * n13) * detInv;
        m[5] = (n31 * n12 - n32 * n11) * detInv;

        m[6] = t13 * detInv;
        m[7] = (n21 * n13 - n23 * n11) * detInv;
        m[8] = (n22 * n11 - n21 * n12) * detInv;

        return this;
    }

    transpose() {
        const m = this.elements;
        let tmp;
        tmp = m[3]; m[3] = m[1]; m[1] = tmp;
        tmp = m[6]; m[6] = m[2]; m[2] = tmp;
        tmp = m[7]; m[7] = m[5]; m[5] = tmp;
        return this;
    }
}


