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

import { CylinderGeometry } from './CylinderGeometry.js';

/**
 * A geometry class for representing a cone.
 *
 * ```js
 * const geometry = new ConeGeometry(5, 20, 32);
 * const material = new BasicMaterial({ color: [1.0, 1.0, 0.0, 1.0] });
 * const cone = new Mesh(geometry, material);
 * scene.add(cone);
 * ```
 *
 * @augments CylinderGeometry
 */
export class ConeGeometry extends CylinderGeometry {

    /**
     * Constructs a new cone geometry.
     *
     * @param {number} [radius=1] - Radius of the cone base.
     * @param {number} [height=1] - Height of the cone.
     * @param {number} [radialSegments=32] - Number of segmented faces around the circumference of the cone.
     * @param {number} [heightSegments=1] - Number of rows of faces along the height of the cone.
     * @param {boolean} [openEnded=false] - Whether the base of the cone is open or capped.
     * @param {number} [thetaStart=0] - Start angle for first segment, in radians.
     * @param {number} [thetaLength=Math.PI*2] - The central angle, often called theta, of the circular sector, in radians.
     * The default value results in a complete cone.
     */
    constructor(
        radius = 1,
        height = 1,
        radialSegments = 32,
        heightSegments = 1,
        openEnded = false,
        thetaStart = 0,
        thetaLength = Math.PI * 2
    ) {
        super(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);

        this.type = 'ConeGeometry';

        /**
         * Holds the constructor parameters that have been
         * used to generate the geometry. Any modification
         * after instantiation does not change the geometry.
         *
         * @type {Object}
         */
        this.parameters = {
            radius: radius,
            height: height,
            radialSegments: radialSegments,
            heightSegments: heightSegments,
            openEnded: openEnded,
            thetaStart: thetaStart,
            thetaLength: thetaLength
        };
    }

    /**
     * Factory method for creating an instance of this class from the given
     * JSON object.
     *
     * @param {Object} data - A JSON object representing the serialized geometry.
     * @return {ConeGeometry} A new instance.
     */
    static fromJSON(data) {
        return new ConeGeometry(
            data.radius,
            data.height,
            data.radialSegments,
            data.heightSegments,
            data.openEnded,
            data.thetaStart,
            data.thetaLength
        );
    }
}

