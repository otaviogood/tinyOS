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

import { Vector3 } from '../math/Vector3.js';
import { Quaternion } from '../math/Quaternion.js';
import { Euler } from '../math/Euler.js';
import { Matrix4 } from '../math/Matrix4.js';

// reusable temporaries (module scoped)
const _v1 = new Vector3();
const _v2 = new Vector3();
const _q1 = new Quaternion();
const _m1 = new Matrix4();
const _target = new Vector3();
const _position = new Vector3();
const _scale = new Vector3();
const _quat = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);

export class Object3D {
    constructor() {
        this.position = new Vector3();
        this.quaternion = new Quaternion();
        this.rotation = new Euler();
        this.scale = new Vector3(1, 1, 1);

        this.matrix = new Matrix4();
        this.matrixWorld = new Matrix4();
        this.matrixAutoUpdate = true;
        this.matrixWorldNeedsUpdate = true;

        // orientation helpers
        this.up = (Object3D.DEFAULT_UP ? Object3D.DEFAULT_UP.clone() : new Vector3(0, 1, 0));
        this.isObject3D = true;
        this.type = 'Object3D';

        this.parent = null;
        this.children = [];
        this.visible = true;
        this.name = '';
        this.userData = {};

        // shadow flags similar to three.js
        this.castShadow = false;
        this.receiveShadow = false;

        // keep quaternion and euler rotation in sync
        const self = this;
        this.rotation._onChange(function () { self.quaternion.setFromEuler(self.rotation, false); });
        this.quaternion._onChange(function () { self.rotation.setFromQuaternion(self.quaternion, self.rotation.order, false); });
        // default type flags so type guards work
        this.isCamera = false;
        this.isLight = false;
    }

    // keep quaternion in sync with rotation for simple demos
    setRotationFromEuler(e) {
        // Copying/setting Euler triggers its onChange callback, which updates the quaternion.
        if (this.rotation.copy) {
            this.rotation.copy(e);
        } else {
            this.rotation.set(e.x, e.y, e.z, e.order);
        }
        // Do not call quaternion.setFromEuler again here to avoid redundant updates and
        // potential numerical churn that can manifest as visible jitter.
        return this;
    }

    setRotationFromAxisAngle(axis, angle) { this.quaternion.setFromAxisAngle(axis, angle); return this; }
    setRotationFromMatrix(m) { this.quaternion.setFromRotationMatrix(m); return this; }
    setRotationFromQuaternion(q) { this.quaternion.copy(q); return this; }

    applyMatrix4(matrix) {
        if (this.matrixAutoUpdate) this.updateMatrix();
        this.matrix.premultiply(matrix);
        this.matrix.decompose(this.position, this.quaternion, this.scale);
        this.matrixWorldNeedsUpdate = true;
    }

    applyQuaternion(q) { this.quaternion.premultiply(q); return this; }

    rotateOnAxis(axis, angle) {
        _q1.setFromAxisAngle(axis, angle);
        this.quaternion.multiply(_q1);
        return this;
    }

    rotateOnWorldAxis(axis, angle) {
        _q1.setFromAxisAngle(axis, angle);
        this.quaternion.premultiply(_q1);
        return this;
    }

    rotateX(angle) { return this.rotateOnAxis(_xAxis, angle); }
    rotateY(angle) { return this.rotateOnAxis(_yAxis, angle); }
    rotateZ(angle) { return this.rotateOnAxis(_zAxis, angle); }

    translateOnAxis(axis, distance) {
        _v1.copy(axis).applyQuaternion(this.quaternion);
        this.position.add(_v1.multiplyScalar(distance));
        return this;
    }

    translateX(distance) { return this.translateOnAxis(_xAxis, distance); }
    translateY(distance) { return this.translateOnAxis(_yAxis, distance); }
    translateZ(distance) { return this.translateOnAxis(_zAxis, distance); }

    localToWorld(vector) { this.updateWorldMatrix(true, false); return vector.applyMatrix4(this.matrixWorld); }
    worldToLocal(vector) { this.updateWorldMatrix(true, false); return vector.applyMatrix4(_m1.copy(this.matrixWorld).invert()); }

    getWorldPosition(target) { this.updateWorldMatrix(true, false); return target.setFromMatrixPosition(this.matrixWorld); }
    getWorldQuaternion(target) { this.updateWorldMatrix(true, false); this.matrixWorld.decompose(_position, target, _scale); return target; }
    getWorldScale(target) { this.updateWorldMatrix(true, false); this.matrixWorld.decompose(_position, _quat, target); return target; }
    getWorldDirection(target) { this.updateWorldMatrix(true, false); const e = this.matrixWorld.elements; return target.set(e[8], e[9], e[10]).normalize(); }

    lookAt(x, y, z) {
        if (x && x.isVector3) _target.copy(x); else _target.set(x, y, z);
        const parent = this.parent;
        this.updateWorldMatrix(true, false);
        _position.setFromMatrixPosition(this.matrixWorld);
        if (this.isCamera || this.isLight) _m1.lookAt(_position, _target, this.up); else _m1.lookAt(_target, _position, this.up);
        this.quaternion.setFromRotationMatrix(_m1);
        if (parent) {
            _m1.extractRotation(parent.matrixWorld);
            _q1.setFromRotationMatrix(_m1);
            this.quaternion.premultiply(_q1.invert());
        }
    }

    add(child) {
        if (child.parent) child.parent.remove(child);
        child.parent = this;
        this.children.push(child);
        return this;
    }

    remove(child) {
        const i = this.children.indexOf(child);
        if (i !== -1) {
            this.children.splice(i, 1);
            child.parent = null;
        }
        return this;
    }

    removeFromParent() { if (this.parent) this.parent.remove(this); return this; }

    clear() { return this.remove(...this.children.slice()); }

    attach(object) {
        this.updateWorldMatrix(true, false);
        _m1.copy(this.matrixWorld).invert();
        if (object.parent) {
            object.parent.updateWorldMatrix(true, false);
            _m1.multiply(object.parent.matrixWorld);
        }
        object.applyMatrix4(_m1);
        object.removeFromParent();
        object.parent = this;
        this.children.push(object);
        object.updateWorldMatrix(false, true);
        return this;
    }

    traverse(callback) {
        callback(this);
        for (const child of this.children) child.traverse(callback);
    }

    traverseVisible(callback) {
        if (this.visible === false) return;
        callback(this);
        for (const child of this.children) child.traverseVisible(callback);
    }

    traverseAncestors(callback) {
        const p = this.parent;
        if (p) { callback(p); p.traverseAncestors(callback); }
    }

    getObjectByProperty(property, value) {
        if (this[property] === value) return this;
        for (const child of this.children) {
            const result = child.getObjectByProperty(property, value);
            if (result) return result;
        }
        return null;
    }

    getObjectByName(name) {
        return this.getObjectByProperty('name', name);
    }

    getObjectById(id) {
        return this.getObjectByProperty('id', id);
    }

    updateMatrix() {
        this.matrix.makeTRS(this.position, this.quaternion, this.scale);
    }

    updateMatrixWorld(force = false) {
        if (this.matrixAutoUpdate) this.updateMatrix();
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiply(this.parent.matrixWorld, this.matrix);
        for (const child of this.children) child.updateMatrixWorld(force);
    }

	updateWorldMatrix(updateParents = false, updateChildren = false) {
		if (updateParents && this.parent) {
			this.parent.updateWorldMatrix(true, false);
		}
		if (this.matrixAutoUpdate) this.updateMatrix();
		if (this.parent === null) this.matrixWorld.copy(this.matrix);
		else this.matrixWorld.multiply(this.parent.matrixWorld, this.matrix);
		if (updateChildren) {
			for (const child of this.children) child.updateWorldMatrix(false, true);
		}
	}

	copy(source, recursive = true) {
		this.position.copy(source.position);
		this.quaternion.copy(source.quaternion);
		if (this.rotation.copy) this.rotation.copy(source.rotation);
		this.scale.copy(source.scale);
		if (source.up) this.up.copy(source.up);
		this.matrix.copy(source.matrix);
		this.matrixWorld.copy(source.matrixWorld);
		this.matrixAutoUpdate = source.matrixAutoUpdate;
		this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
		this.visible = source.visible;
		this.name = source.name;
		this.userData = JSON.parse(JSON.stringify(source.userData || {}));
		this.castShadow = !!source.castShadow;
		this.receiveShadow = !!source.receiveShadow;
		if (recursive) for (const c of source.children) this.add(c.clone(true));
		return this;
	}

	clone(recursive = true) {
		const ctor = /** @type {new () => any} */ (this.constructor);
		return new ctor().copy(this, recursive);
	}
}

// defaults similar to three.js
Object3D.DEFAULT_UP = new Vector3(0, 1, 0);


