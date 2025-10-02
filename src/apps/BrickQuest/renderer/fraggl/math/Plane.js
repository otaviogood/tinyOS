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

import { Matrix3 } from './Matrix3.js';
import { Vector3 } from './Vector3.js';

const _vector1 = new Vector3();
const _vector2 = new Vector3();
const _normalMatrix = new Matrix3();

class Plane {

    constructor(normal = new Vector3(1, 0, 0), constant = 0) {

        this.isPlane = true;

        this.normal = normal;
        this.constant = constant;

    }

    set(normal, constant) {

        this.normal.copy(normal);
        this.constant = constant;

        return this;

    }

    setComponents(x, y, z, w) {

        this.normal.set(x, y, z);
        this.constant = w;

        return this;

    }

    setFromNormalAndCoplanarPoint(normal, point) {

        this.normal.copy(normal);
        this.constant = -point.dot(this.normal);

        return this;

    }

    setFromCoplanarPoints(a, b, c) {

        const normal = _vector1.subVectors(c, b).cross(_vector2.subVectors(a, b)).normalize();

        return this.setFromNormalAndCoplanarPoint(normal, a);

    }

    copy(plane) {

        this.normal.copy(plane.normal);
        this.constant = plane.constant;

        return this;

    }

    normalize() {

        const inverseNormalLength = 1.0 / this.normal.length();
        this.normal.multiplyScalar(inverseNormalLength);
        this.constant *= inverseNormalLength;

        return this;

    }

    negate() {

        this.normal.negate();
        this.constant *= -1;

        return this;

    }

    distanceToPoint(point) {

        return this.normal.dot(point) + this.constant;

    }

    distanceToSphere(sphere) {

        return this.distanceToPoint(sphere.center) - sphere.radius;

    }

    projectPoint(point, target) {

        return target.copy(point).addScaledVector(this.normal, -this.distanceToPoint(point));

    }

    intersectLine(line, target) {

        const direction = line.delta(_vector1);
        const denominator = this.normal.dot(direction);

        if (denominator === 0) {

            if (this.distanceToPoint(line.start) === 0) {

                return target.copy(line.start);

            }

            return null;

        }

        const t = -(line.start.dot(this.normal) + this.constant) / denominator;

        if (t < 0 || t > 1) {

            return null;

        }

        return target.copy(line.start).addScaledVector(direction, t);

    }

    intersectsLine(line) {

        const startSign = this.distanceToPoint(line.start);
        const endSign = this.distanceToPoint(line.end);

        return (startSign < 0 && endSign > 0) || (endSign < 0 && startSign > 0);

    }

    intersectsBox(box) {

        return box.intersectsPlane(this);

    }

    intersectsSphere(sphere) {

        return sphere.intersectsPlane(this);

    }

    coplanarPoint(target) {

        return target.copy(this.normal).multiplyScalar(-this.constant);

    }

    applyMatrix4(matrix, optionalNormalMatrix) {

        const normalMatrix = optionalNormalMatrix || _normalMatrix.getNormalMatrixFromMatrix4(matrix);

        const referencePoint = this.coplanarPoint(_vector1).applyMatrix4(matrix);

        const normal = this.normal.applyMatrix3(normalMatrix).normalize();

        this.constant = -referencePoint.dot(normal);

        return this;

    }

    translate(offset) {

        this.constant -= offset.dot(this.normal);

        return this;

    }

    equals(plane) {

        return plane.normal.equals(this.normal) && plane.constant === this.constant;

    }

    clone() {

        return new this.constructor().copy(this);

    }

}

export { Plane };


