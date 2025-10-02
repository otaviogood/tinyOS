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
import { Matrix4 } from '../math/Matrix4.js';

export class Camera extends Object3D {
    constructor() {
        super();
		// three.js-like flags
		this.isCamera = true;
		this.type = 'Camera';

		// matrices
		this.projectionMatrix = new Matrix4();
		this.projectionMatrixInverse = new Matrix4();
		this.viewMatrix = new Matrix4(); // alias for matrixWorldInverse
		this.matrixWorldInverse = new Matrix4();

		// depth configuration
		this._reversedDepth = false;
    }

    updateMatrices() {
        this.updateMatrixWorld();
		// compute view matrix and cached inverses
		this.matrixWorldInverse.copy(this.matrixWorld).invert();
		this.viewMatrix.copy(this.matrixWorldInverse);
		this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }

	get reversedDepth() {
		return this._reversedDepth;
	}

	copy(source, recursive) {
		super.copy(source, recursive);
		this.projectionMatrix.copy(source.projectionMatrix);
		this.projectionMatrixInverse.copy(source.projectionMatrixInverse);
		this.matrixWorldInverse.copy(source.matrixWorldInverse);
		this.viewMatrix.copy(source.viewMatrix);
		this._reversedDepth = !!source._reversedDepth;
		return this;
	}

	clone() {
		const ctor = /** @type {new () => any} */ (this.constructor);
		return new ctor().copy(this, true);
	}

	// Cameras look down -Z. Return normalized world-space forward.
	getWorldDirection(target) {
		const te = this.matrixWorld.elements;
		target.x = -te[8];
		target.y = -te[9];
		target.z = -te[10];
		return target.normalize();
	}

	updateMatrixWorld(force) {
		super.updateMatrixWorld(force);
		this.matrixWorldInverse.copy(this.matrixWorld).invert();
		this.viewMatrix.copy(this.matrixWorldInverse);
	}

	updateWorldMatrix(updateParents, updateChildren) {
		super.updateWorldMatrix(updateParents, updateChildren);
		this.matrixWorldInverse.copy(this.matrixWorld).invert();
		this.viewMatrix.copy(this.matrixWorldInverse);
	}
}


