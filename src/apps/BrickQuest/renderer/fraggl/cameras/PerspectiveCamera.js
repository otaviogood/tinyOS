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

import { Camera } from './Camera.js';
import { Matrix4 } from '../math/Matrix4.js';
import { RAD2DEG, DEG2RAD } from '../math/MathUtils.js';
import { Vector2 } from '../math/Vector2.js';
import { Vector3 } from '../math/Vector3.js';

const _tmpV3 = new Vector3();
const _minTarget = new Vector2();
const _maxTarget = new Vector2();

export class PerspectiveCamera extends Camera {
    constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
        super();
        this.isPerspectiveCamera = true;
        this.type = 'PerspectiveCamera';

        this.fov = fov;
        this.zoom = 1;
        this.near = near;
        this.far = far;
        this.focus = 10;
        this.aspect = aspect;
        this.view = null; // { enabled, fullWidth, fullHeight, offsetX, offsetY, width, height }
        this.filmGauge = 35; // mm, used only with filmOffset
        this.filmOffset = 0; // horizontal shift in filmGauge units

		this.updateProjectionMatrix();
    }

    copy(source, recursive) {
        super.copy(source, recursive);
        this.fov = source.fov;
        this.zoom = source.zoom;
        this.near = source.near;
        this.far = source.far;
        this.focus = source.focus;
        this.aspect = source.aspect;
        this.view = source.view === null ? null : Object.assign({}, source.view);
        this.filmGauge = source.filmGauge;
        this.filmOffset = source.filmOffset;
        return this;
    }

    // Photography helpers
    setFocalLength(focalLength) {
        const vExtentSlope = 0.5 * this.getFilmHeight() / focalLength;
        this.fov = RAD2DEG * 2 * Math.atan(vExtentSlope);
        this.updateProjectionMatrix();
    }

    getFocalLength() {
        const vExtentSlope = Math.tan(DEG2RAD * 0.5 * this.fov);
        return 0.5 * this.getFilmHeight() / vExtentSlope;
    }

    getEffectiveFOV() {
        return RAD2DEG * 2 * Math.atan(Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom);
    }

    getFilmWidth() {
        return this.filmGauge * Math.min(this.aspect, 1);
    }

    getFilmHeight() {
        return this.filmGauge / Math.max(this.aspect, 1);
    }

    // View rectangle helpers
    getViewBounds(distance, minTarget, maxTarget) {
        _tmpV3.set(-1, -1, 0.5).applyMatrix4(this.projectionMatrixInverse);
        minTarget.set(_tmpV3.x, _tmpV3.y).multiplyScalar(-distance / _tmpV3.z);
        _tmpV3.set(1, 1, 0.5).applyMatrix4(this.projectionMatrixInverse);
        maxTarget.set(_tmpV3.x, _tmpV3.y).multiplyScalar(-distance / _tmpV3.z);
    }

    getViewSize(distance, target) {
        this.getViewBounds(distance, _minTarget, _maxTarget);
        return target.subVectors(_maxTarget, _minTarget);
    }

    // Multi-viewport support
    setViewOffset(fullWidth, fullHeight, x, y, width, height) {
        this.aspect = fullWidth / fullHeight;
        if (this.view === null) {
            this.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
        }
        this.view.enabled = true;
        this.view.fullWidth = fullWidth;
        this.view.fullHeight = fullHeight;
        this.view.offsetX = x;
        this.view.offsetY = y;
        this.view.width = width;
        this.view.height = height;
        this.updateProjectionMatrix();
    }

    clearViewOffset() {
        if (this.view !== null) this.view.enabled = false;
        this.updateProjectionMatrix();
    }

    updateProjectionMatrix() {
        const near = this.near;
        let top = near * Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom;
        let height = 2 * top;
        let width = this.aspect * height;
        let left = -0.5 * width;
        const view = this.view;

        if (view !== null && view.enabled) {
            const fullWidth = view.fullWidth;
            const fullHeight = view.fullHeight;
            left += view.offsetX * width / fullWidth;
            top -= view.offsetY * height / fullHeight;
            width *= view.width / fullWidth;
            height *= view.height / fullHeight;
        }

        const skew = this.filmOffset;
        if (skew !== 0) left += near * skew / this.getFilmWidth();

        // Use off-center perspective variant to support view offsets and filmOffset
        this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far);
        this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }
}


