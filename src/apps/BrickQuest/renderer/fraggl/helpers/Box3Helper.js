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

import { LineSegments } from '../core/LineSegments.js';
import { BufferGeometry } from '../core/BufferGeometry.js';
import { BufferAttribute } from '../core/BufferAttribute.js';
import { LineBasicMaterial } from '../materials/LineBasicMaterial.js';

/**
 * Visualizes a Box3 with a wireframe cube aligned to the axes.
 */
export class Box3Helper extends LineSegments {
    constructor(box, color = 0xffff00) {
        const indices = new Uint16Array([0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7]);
        const positions = [
            1, 1, 1,  -1, 1, 1,  -1,-1, 1,   1,-1, 1,
            1, 1,-1,  -1, 1,-1,  -1,-1,-1,   1,-1,-1
        ];
        const geometry = new BufferGeometry();
        geometry.setIndex(new BufferAttribute(indices, 1));
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        const matColor = Array.isArray(color) ? color : [
            ((color >> 16) & 255) / 255,
            ((color >> 8) & 255) / 255,
            (color & 255) / 255,
            1
        ];
        const material = new LineBasicMaterial({ color: matColor, depthWrite: false, transparent: true });
        super(geometry, material);
        this.box = box;
        this.type = 'Box3Helper';
        if (this.geometry.computeBoundingSphere) this.geometry.computeBoundingSphere();
    }

    updateMatrixWorld(force) {
        const box = this.box;
        if (!box || box.isEmpty()) return;
        box.getCenter(this.position);
        box.getSize(this.scale);
        this.scale.multiplyScalar(0.5);
        super.updateMatrixWorld(force);
    }

    dispose() {
        this.geometry?.dispose?.();
        this.material?.dispose?.();
    }
}


