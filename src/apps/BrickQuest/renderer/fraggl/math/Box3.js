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

import { Vector3 } from './Vector3.js';
/**
 * Represents an axis-aligned bounding box (AABB) in 3D space.
 */
class Box3 {

    /**
     * Constructs a new bounding box.
     *
     * @param {Vector3} [min=(Infinity,Infinity,Infinity)] - A vector representing the lower boundary of the box.
     * @param {Vector3} [max=(-Infinity,-Infinity,-Infinity)] - A vector representing the upper boundary of the box.
     */
    constructor(min = new Vector3(+Infinity, +Infinity, +Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {

        /**
         * This flag can be used for type testing.
         *
         * @type {boolean}
         * @readonly
         * @default true
         */
        this.isBox3 = true;

        /**
         * The lower boundary of the box.
         *
         * @type {Vector3}
         */
        this.min = min;

        /**
         * The upper boundary of the box.
         *
         * @type {Vector3}
         */
        this.max = max;

    }

    /**
     * Sets the lower and upper boundaries of this box.
     * Please note that this method only copies the values from the given objects.
     *
     * @param {Vector3} min - The lower boundary of the box.
     * @param {Vector3} max - The upper boundary of the box.
     * @return {Box3} A reference to this bounding box.
     */
    set(min, max) {

        this.min.copy(min);
        this.max.copy(max);

        return this;

    }

    /**
     * Sets the upper and lower bounds of this box so it encloses the position data
     * in the given array.
     *
     * @param {Array<number>} array - An array holding 3D position data.
     * @return {Box3} A reference to this bounding box.
     */
    setFromArray(array) {

        this.makeEmpty();

        if (!array) return this;

        for (let i = 0, il = array.length; i < il; i += 3) {

            _vector.set(array[i] ?? 0, array[i + 1] ?? 0, array[i + 2] ?? 0);
            this.expandByPoint(_vector);

        }

        return this;

    }

    /**
     * Sets the upper and lower bounds of this box so it encloses the position data
     * in the given buffer attribute.
     *
     * @param {Object} attribute - A buffer attribute holding 3D position data.
     * @return {Box3} A reference to this bounding box.
     */
    setFromBufferAttribute(attribute) {

        this.makeEmpty();

        const count = getAttributeCount(attribute);

        for (let i = 0; i < count; i++) {

            readAttributeItem(attribute, i, _vector);
            this.expandByPoint(_vector);

        }

        return this;

    }

    /**
     * Sets the upper and lower bounds of this box so it encloses the position data
     * in the given array.
     *
     * @param {Array<Vector3>} points - An array holding 3D position data as instances of {@link Vector3}.
     * @return {Box3} A reference to this bounding box.
     */
    setFromPoints(points) {

        this.makeEmpty();

        if (!points) return this;

        for (let i = 0, il = points.length; i < il; i++) {

            this.expandByPoint(points[i]);

        }

        return this;

    }

    /**
     * Centers this box on the given center vector and sets this box's width, height and depth to the given size values.
     *
     * @param {Vector3} center - The center of the box.
     * @param {Vector3} size - The x, y and z dimensions of the box.
     * @return {Box3} A reference to this bounding box.
     */
    setFromCenterAndSize(center, size) {

        const halfSize = _vector.copy(size).multiplyScalar(0.5);

        this.min.copy(center).sub(halfSize);
        this.max.copy(center).add(halfSize);

        return this;

    }

    /**
     * Computes the world-axis-aligned bounding box for the given 3D object (including its children), accounting for the object's world transform.
     *
     * @param {Object} object - The 3D object to compute the bounding box for.
     * @param {boolean} [precise=false] - If set to `true`, computes the smallest world AABB at the expense of more computation.
     * @return {Box3} A reference to this bounding box.
     */
    setFromObject(object, precise = false) {

        this.makeEmpty();

        if (!object) return this;

        if (typeof object.updateMatrixWorld === 'function') {

            object.updateMatrixWorld(true);

        }

        return this.expandByObject(object, precise);

    }

    /**
     * Returns a new box with copied values from this instance.
     *
     * @return {Box3} A clone of this instance.
     */
    clone() {

        return new this.constructor().copy(this);

    }

    /**
     * Copies the values of the given box to this instance.
     *
     * @param {Box3} box - The box to copy.
     * @return {Box3} A reference to this bounding box.
     */
    copy(box) {

        this.min.copy(box.min);
        this.max.copy(box.max);

        return this;

    }

    /**
     * Makes this box empty which means it encloses a zero space in 3D.
     *
     * @return {Box3} A reference to this bounding box.
     */
    makeEmpty() {

        this.min.x = this.min.y = this.min.z = +Infinity;
        this.max.x = this.max.y = this.max.z = -Infinity;

        return this;

    }

    /**
     * Returns true if this box includes zero points within its bounds.
     * Note that a box with equal lower and upper bounds still includes one point, the one both bounds share.
     *
     * @return {boolean} Whether this box is empty or not.
     */
    isEmpty() {

        return (this.max.x < this.min.x) || (this.max.y < this.min.y) || (this.max.z < this.min.z);

    }

    /**
     * Returns the center point of this box.
     *
     * @param {Vector3} target - The target vector that is used to store the method's result.
     * @return {Vector3} The center point.
     */
    getCenter(target) {

        return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);

    }

    /**
     * Returns the dimensions of this box.
     *
     * @param {Vector3} target - The target vector that is used to store the method's result.
     * @return {Vector3} The size.
     */
    getSize(target) {

        return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min);

    }

    /**
     * Expands the boundaries of this box to include the given point.
     *
     * @param {Vector3} point - The point that should be included by the bounding box.
     * @return {Box3} A reference to this bounding box.
     */
    expandByPoint(point) {

        this.min.min(point);
        this.max.max(point);

        return this;

    }

    /**
     * Expands this box equilaterally by the given vector. The width, height and depth of this box will be expanded by the respective components of the vector in both directions.
     *
     * @param {Vector3} vector - The vector that should expand the bounding box.
     * @return {Box3} A reference to this bounding box.
     */
    expandByVector(vector) {

        this.min.sub(vector);
        this.max.add(vector);

        return this;

    }

    /**
     * Expands each dimension of the box by the given scalar. If negative, the dimensions of the box will be contracted.
     *
     * @param {number} scalar - The scalar value that should expand the bounding box.
     * @return {Box3} A reference to this bounding box.
     */
    expandByScalar(scalar) {

        this.min.addScalar(-scalar);
        this.max.addScalar(scalar);

        return this;

    }

    /**
     * Returns true if the given point lies within or on the boundaries of this box.
     *
     * @param {Vector3} point - The point to test.
     * @return {boolean} Whether the bounding box contains the given point or not.
     */
    containsPoint(point) {

        return point.x >= this.min.x && point.x <= this.max.x &&
            point.y >= this.min.y && point.y <= this.max.y &&
            point.z >= this.min.z && point.z <= this.max.z;

    }

    /**
     * Returns true if this bounding box includes the entirety of the given bounding box.
     * If this box and the given one are identical, this function also returns true.
     *
     * @param {Box3} box - The bounding box to test.
     * @return {boolean} Whether this bounding box contains the given bounding box or not.
     */
    containsBox(box) {

        return this.min.x <= box.min.x && box.max.x <= this.max.x &&
            this.min.y <= box.min.y && box.max.y <= this.max.y &&
            this.min.z <= box.min.z && box.max.z <= this.max.z;

    }

    /**
     * Returns a point as a proportion of this box's width, height and depth.
     *
     * @param {Vector3} point - A point in 3D space.
     * @param {Vector3} target - The target vector that is used to store the method's result.
     * @return {Vector3} A point as a proportion of this box's width, height and depth.
     */
    getParameter(point, target) {

        // This can potentially have a divide by zero if the box has a size dimension of 0.

        return target.set(
            (point.x - this.min.x) / (this.max.x - this.min.x),
            (point.y - this.min.y) / (this.max.y - this.min.y),
            (point.z - this.min.z) / (this.max.z - this.min.z)
        );

    }

    /**
     * Returns true if the given bounding box intersects with this bounding box.
     *
     * @param {Box3} box - The bounding box to test.
     * @return {boolean} Whether the given bounding box intersects with this bounding box.
     */
    intersectsBox(box) {

        return box.max.x >= this.min.x && box.min.x <= this.max.x &&
            box.max.y >= this.min.y && box.min.y <= this.max.y &&
            box.max.z >= this.min.z && box.min.z <= this.max.z;

    }

    /**
     * Returns true if the given bounding sphere intersects with this bounding box.
     *
     * @param {Object} sphere - The bounding sphere to test.
     * @return {boolean} Whether the given bounding sphere intersects with this bounding box.
     */
    intersectsSphere(sphere) {

        if (!sphere || !sphere.center) return false;

        this.clampPoint(sphere.center, _vector);

        const radius = sphere.radius || 0;

        return _vector.distanceToSquared(sphere.center) <= (radius * radius);

    }

    /**
     * Returns true if the given plane intersects with this bounding box.
     *
     * @param {Object} plane - The plane to test.
     * @return {boolean} Whether the given plane intersects with this bounding box.
     */
    intersectsPlane(plane) {

        if (!plane || !plane.normal) return false;

        let min, max;

        if (plane.normal.x > 0) {

            min = plane.normal.x * this.min.x;
            max = plane.normal.x * this.max.x;

        } else {

            min = plane.normal.x * this.max.x;
            max = plane.normal.x * this.min.x;

        }

        if (plane.normal.y > 0) {

            min += plane.normal.y * this.min.y;
            max += plane.normal.y * this.max.y;

        } else {

            min += plane.normal.y * this.max.y;
            max += plane.normal.y * this.min.y;

        }

        if (plane.normal.z > 0) {

            min += plane.normal.z * this.min.z;
            max += plane.normal.z * this.max.z;

        } else {

            min += plane.normal.z * this.max.z;
            max += plane.normal.z * this.min.z;

        }

        const constant = plane.constant || 0;

        return (min <= -constant && max >= -constant);

    }

    /**
     * Returns true if the given triangle intersects with this bounding box.
     *
     * @param {Object} triangle - The triangle to test.
     * @return {boolean} Whether the given triangle intersects with this bounding box.
     */
    intersectsTriangle(triangle) {

        if (this.isEmpty() || !triangle) {

            return false;

        }

        this.getCenter(_center);
        _extents.subVectors(this.max, _center);

        _v0.copy(triangle.a).sub(_center);
        _v1.copy(triangle.b).sub(_center);
        _v2.copy(triangle.c).sub(_center);

        _f0.subVectors(_v1, _v0);
        _f1.subVectors(_v2, _v1);
        _f2.subVectors(_v0, _v2);

        let axes = [
            0, -_f0.z, _f0.y,
            0, -_f1.z, _f1.y,
            0, -_f2.z, _f2.y,
            _f0.z, 0, -_f0.x,
            _f1.z, 0, -_f1.x,
            _f2.z, 0, -_f2.x,
            -_f0.y, _f0.x, 0,
            -_f1.y, _f1.x, 0,
            -_f2.y, _f2.x, 0
        ];

        if (!satForAxes(axes, _v0, _v1, _v2, _extents)) {

            return false;

        }

        axes = [1, 0, 0, 0, 1, 0, 0, 0, 1];

        if (!satForAxes(axes, _v0, _v1, _v2, _extents)) {

            return false;

        }

        _triangleNormal.crossVectors(_f0, _f1);
        axes = [_triangleNormal.x, _triangleNormal.y, _triangleNormal.z];

        return satForAxes(axes, _v0, _v1, _v2, _extents);

    }

    /**
     * Clamps the given point within the bounds of this box.
     *
     * @param {Vector3} point - The point to clamp.
     * @param {Vector3} target - The target vector that is used to store the method's result.
     * @return {Vector3} The clamped point.
     */
    clampPoint(point, target) {

        return target.copy(point).clamp(this.min, this.max);

    }

    /**
     * Returns the euclidean distance from any edge of this box to the specified point.
     * If the given point lies inside of this box, the distance will be `0`.
     *
     * @param {Vector3} point - The point to compute the distance to.
     * @return {number} The euclidean distance.
     */
    distanceToPoint(point) {

        return this.clampPoint(point, _vector).distanceTo(point);

    }

    /**
     * Returns a bounding sphere that encloses this bounding box.
     *
     * @param {Object} target - The target sphere that is used to store the method's result.
     * @return {Object} The bounding sphere that encloses this bounding box.
     */
    getBoundingSphere(target) {

        if (!target) return target;

        if (this.isEmpty()) {

            if (typeof target.makeEmpty === 'function') {

                target.makeEmpty();

            } else {

                if (target.center && target.center.isVector3) {

                    target.center.set(0, 0, 0);

                }

                target.radius = 0;

            }

        } else {

            if (!target.center || !target.center.isVector3) {

                target.center = target.center || new Vector3();

            }

            this.getCenter(target.center);
            target.radius = this.getSize(_vector).length() * 0.5;

        }

        return target;

    }

    /**
     * Computes the intersection of this bounding box and the given one, setting the upper bound of this box to the lesser of the two boxes' upper bounds and the lower bound of this box to the greater of the two boxes' lower bounds.
     * If there's no overlap, makes this box empty.
     *
     * @param {Box3} box - The bounding box to intersect with.
     * @return {Box3} A reference to this bounding box.
     */
    intersect(box) {

        this.min.max(box.min);
        this.max.min(box.max);

        if (this.isEmpty()) this.makeEmpty();

        return this;

    }

    /**
     * Computes the union of this box and the given one, setting the upper bound of this box to the greater of the two boxes' upper bounds and the lower bound of this box to the lesser of the two boxes' lower bounds.
     *
     * @param {Box3} box - The bounding box that will be unioned with this instance.
     * @return {Box3} A reference to this bounding box.
     */
    union(box) {

        this.min.min(box.min);
        this.max.max(box.max);

        return this;

    }

    /**
     * Transforms this bounding box by the given 4x4 transformation matrix.
     *
     * @param {Object} matrix - The transformation matrix.
     * @return {Box3} A reference to this bounding box.
     */
    applyMatrix4(matrix) {

        if (this.isEmpty()) return this;

        _points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix);
        _points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix);
        _points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix);
        _points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix);
        _points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix);
        _points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix);
        _points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix);
        _points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix);

        return this.setFromPoints(_points);

    }

    /**
     * Adds the given offset to both the upper and lower bounds of this bounding box, effectively moving it in 3D space.
     *
     * @param {Vector3} offset - The offset that should be used to translate the bounding box.
     * @return {Box3} A reference to this bounding box.
     */
    translate(offset) {

        this.min.add(offset);
        this.max.add(offset);

        return this;

    }

    /**
     * Returns true if this bounding box is equal with the given one.
     *
     * @param {Box3} box - The box to test for equality.
     * @return {boolean} Whether this bounding box is equal with the given one.
     */
    equals(box) {

        return box.min.equals(this.min) && box.max.equals(this.max);

    }

    /**
     * Returns a serialized structure of the bounding box.
     *
     * @return {Object} Serialized structure with fields representing the object state.
     */
    toJSON() {

        return {
            min: this.min.toArray(),
            max: this.max.toArray()
        };

    }

    /**
     * Returns a serialized structure of the bounding box.
     *
     * @param {Object} json - The serialized json to set the box from.
     * @return {Box3} A reference to this bounding box.
     */
    fromJSON(json) {

        this.min.fromArray(json.min);
        this.max.fromArray(json.max);
        return this;

    }

    /**
     * Expands this box so it includes the given object.
     *
     * @param {Object} object - The object to expand the box by.
     * @param {boolean} [precise=false] - Whether to compute precise bounds.
     * @return {Box3} A reference to this bounding box.
     */
    expandByObject(object, precise = false) {

        if (!object) return this;

        const geometry = object.geometry;

        if (geometry !== undefined) {

            const positionAttribute = getPositionAttribute(geometry);
            const isInstanced = object.isInstancedMesh === true;

            if (precise === true && positionAttribute && typeof object.getVertexPosition === 'function' && !isInstanced) {

                const count = getAttributeCount(positionAttribute);

                for (let i = 0; i < count; i++) {

                    if (object.isMesh === true) {

                        object.getVertexPosition(i, _vector);

                    } else {

                        readAttributeItem(positionAttribute, i, _vector);

                    }

                    _vector.applyMatrix4(object.matrixWorld);
                    this.expandByPoint(_vector);

                }

            } else {

                const boundingBox = getGeometryBoundingBox(geometry, positionAttribute);

                if (boundingBox) {

                    _box.copy(boundingBox).applyMatrix4(object.matrixWorld);
                    this.union(_box);

                }

            }

        }

        const children = object.children || [];

        for (let i = 0, l = children.length; i < l; i++) {

            this.expandByObject(children[i], precise);

        }

        return this;

    }

}

const _points = [];
for (let i = 0; i < 8; i++) _points.push(new Vector3());

const _vector = new Vector3();
const _box = new Box3();

const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();

const _f0 = new Vector3();
const _f1 = new Vector3();
const _f2 = new Vector3();

const _center = new Vector3();
const _extents = new Vector3();
const _triangleNormal = new Vector3();
const _testAxis = new Vector3();

function satForAxes(axes, v0, v1, v2, extents) {

    for (let i = 0, j = axes.length - 3; i <= j; i += 3) {

        _testAxis.fromArray(axes, i);

        const r = extents.x * Math.abs(_testAxis.x) + extents.y * Math.abs(_testAxis.y) + extents.z * Math.abs(_testAxis.z);

        const p0 = v0.dot(_testAxis);
        const p1 = v1.dot(_testAxis);
        const p2 = v2.dot(_testAxis);

        if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) {

            return false;

        }

    }

    return true;

}

function getPositionAttribute(geometry) {

    if (!geometry) return null;

    if (typeof geometry.getAttribute === 'function') {

        return geometry.getAttribute('position') || null;

    }

    const attributes = geometry.attributes;

    if (!attributes) return null;

    if (typeof attributes.get === 'function') {

        return attributes.get('position') || null;

    }

    if (attributes instanceof Map) {

        return attributes.get('position') || null;

    }

    return attributes.position || null;

}

function getAttributeCount(attribute) {

    if (!attribute) return 0;

    if (Number.isFinite(attribute.count)) return attribute.count | 0;

    const array = attribute.array ?? attribute;
    const itemSize = attribute.itemSize ?? 3;

    if (!array || typeof array.length !== 'number' || itemSize <= 0) return 0;

    return Math.floor(array.length / itemSize);

}

function readAttributeItem(attribute, index, target) {

    if (!attribute) {

        return target.set(0, 0, 0);

    }

    if (typeof attribute.getX === 'function') {

        target.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index));

    } else {

        const array = attribute.array ?? attribute;
        const itemSize = attribute.itemSize ?? 3;
        const offset = index * itemSize;

        target.set(
            array[offset] ?? 0,
            array[offset + 1] ?? 0,
            array[offset + 2] ?? 0
        );

    }

    return target;

}

function getGeometryBoundingBox(geometry, positionAttribute) {

    let boundingBox = geometry.boundingBox;

    if (boundingBox && boundingBox.isBox3 === true) {

        return boundingBox;

    }

    const attribute = positionAttribute || getPositionAttribute(geometry);
    const count = getAttributeCount(attribute);

    if (count === 0) {

        boundingBox = boundingBox && boundingBox.isBox3 === true ? boundingBox : new Box3();
        boundingBox.makeEmpty();
        geometry.boundingBox = boundingBox;
        return boundingBox;

    }

    boundingBox = boundingBox && boundingBox.isBox3 === true ? boundingBox : new Box3();
    boundingBox.makeEmpty();

    for (let i = 0; i < count; i++) {

        readAttributeItem(attribute, i, _vector);
        boundingBox.expandByPoint(_vector);

    }

    geometry.boundingBox = boundingBox;

    return boundingBox;

}

export { Box3 };
