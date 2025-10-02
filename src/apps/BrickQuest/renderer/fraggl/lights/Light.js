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

function toFloatColor(color) {
    if (color == null) return [1, 1, 1];

    if (typeof color === 'number') {
        const r = ((color >> 16) & 255) / 255;
        const g = ((color >> 8) & 255) / 255;
        const b = (color & 255) / 255;
        return [r, g, b];
    }

    if (Array.isArray(color)) {
        if (color.length >= 3) {
            const r = color[0];
            const g = color[1];
            const b = color[2];
            const needsNormalize = r > 1 || g > 1 || b > 1;
            if (needsNormalize) {
                return [r / 255, g / 255, b / 255];
            }
            return [r, g, b];
        }
        throw new Error('Light color array must contain at least 3 components.');
    }

    if (typeof color === 'object') {
        const r = color.r ?? color.x;
        const g = color.g ?? color.y;
        const b = color.b ?? color.z;
        if (r != null && g != null && b != null) {
            const needsNormalize = r > 1 || g > 1 || b > 1;
            if (needsNormalize) {
                return [r / 255, g / 255, b / 255];
            }
            return [r, g, b];
        }
    }

    throw new Error('Unsupported light color format.');
}

export class Light extends Object3D {
    constructor(color = 0xffffff, intensity = 1) {
        super();

        this.isLight = true;
        this.type = 'Light';
        this.color = toFloatColor(color);
        this.intensity = intensity;
    }

    setColor(color) {
        this.color = toFloatColor(color);
        return this;
    }

    setIntensity(intensity) {
        this.intensity = intensity;
        return this;
    }

    copy(source) {
        super.copy?.(source);
        if (!source || !source.isLight) return this;

        this.color = source.color.slice();
        this.intensity = source.intensity;
        return this;
    }

    dispose() {
        // Base class has no GPU resources yet.
    }
}


