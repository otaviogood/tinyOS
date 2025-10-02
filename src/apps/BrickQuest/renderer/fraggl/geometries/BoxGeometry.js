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

import { BufferGeometry } from '../core/BufferGeometry.js';
import { BufferAttribute } from '../core/BufferAttribute.js';
import { Vector3 } from '../math/Vector3.js';

/**
 * A geometry class for a rectangular cuboid with a given width, height, and depth.
 * On creation, the cuboid is centred on the origin, with each edge parallel to one
 * of the axes.
 *
 * ```js
 * const geometry = new BoxGeometry(1, 1, 1);
 * const material = new BasicMaterial({ color: [0.0, 1.0, 0.0, 1.0] });
 * const cube = new Mesh(geometry, material);
 * scene.add(cube);
 * ```
 *
 * @augments BufferGeometry
 */
export class BoxGeometry extends BufferGeometry {

    /**
     * Constructs a new box geometry.
     *
     * @param {number} [width=1] - The width along the X axis.
     * @param {number} [height=1] - The height along the Y axis.
     * @param {number} [depth=1] - The depth along the Z axis.
     * @param {number} [widthSegments=1] - Segments along width.
     * @param {number} [heightSegments=1] - Segments along height.
     * @param {number} [depthSegments=1] - Segments along depth.
     */
    constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
        super();

        this.type = 'BoxGeometry';

        this.parameters = {
            width: width,
            height: height,
            depth: depth,
            widthSegments: widthSegments,
            heightSegments: heightSegments,
            depthSegments: depthSegments
        };

        const scope = this;

        widthSegments = Math.floor(widthSegments);
        heightSegments = Math.floor(heightSegments);
        depthSegments = Math.floor(depthSegments);

        // buffers
        const indices = [];
        const vertices = [];
        const normals = [];
        const uvs = [];

        // helper variables
        let numberOfVertices = 0;
        let groupStart = 0;

        // build each side of the box geometry
        buildPlane('z', 'y', 'x', -1, -1, depth, height, width, depthSegments, heightSegments, 0); // +x
        buildPlane('z', 'y', 'x',  1, -1, depth, height, -width, depthSegments, heightSegments, 1); // -x
        buildPlane('x', 'z', 'y',  1,  1, width, depth, height, widthSegments, depthSegments, 2); // +y
        buildPlane('x', 'z', 'y',  1, -1, width, depth, -height, widthSegments, depthSegments, 3); // -y
        buildPlane('x', 'y', 'z',  1, -1, width, height, depth, widthSegments, heightSegments, 4); // +z
        buildPlane('x', 'y', 'z', -1, -1, width, height, -depth, widthSegments, heightSegments, 5); // -z

        // build geometry
        this.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
        this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
        this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));

        function buildPlane(u, v, w, udir, vdir, width, height, depth, gridX, gridY, materialIndex) {
            const segmentWidth = width / gridX;
            const segmentHeight = height / gridY;

            const widthHalf = width / 2;
            const heightHalf = height / 2;
            const depthHalf = depth / 2;

            const gridX1 = gridX + 1;
            const gridY1 = gridY + 1;

            let vertexCounter = 0;
            let groupCount = 0;

            const vector = new Vector3();

            // generate vertices, normals and uvs
            for (let iy = 0; iy < gridY1; iy++) {
                const y = iy * segmentHeight - heightHalf;
                for (let ix = 0; ix < gridX1; ix++) {
                    const x = ix * segmentWidth - widthHalf;

                    // set values to correct vector component
                    vector[u] = x * udir;
                    vector[v] = y * vdir;
                    vector[w] = depthHalf;

                    // now apply vector to vertex buffer
                    vertices.push(vector.x, vector.y, vector.z);

                    // set values to correct vector component for normal
                    vector[u] = 0;
                    vector[v] = 0;
                    vector[w] = depth > 0 ? 1 : -1;

                    normals.push(vector.x, vector.y, vector.z);

                    // uvs
                    uvs.push(ix / gridX, 1 - (iy / gridY));

                    vertexCounter += 1;
                }
            }

            // indices
            for (let iy = 0; iy < gridY; iy++) {
                for (let ix = 0; ix < gridX; ix++) {
                    const a = numberOfVertices + ix + gridX1 * iy;
                    const b = numberOfVertices + ix + gridX1 * (iy + 1);
                    const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
                    const d = numberOfVertices + (ix + 1) + gridX1 * iy;

                    indices.push(a, b, d);
                    indices.push(b, c, d);
                    groupCount += 6;
                }
            }

            scope.addGroup(groupStart, groupCount, materialIndex);
            groupStart += groupCount;
            numberOfVertices += vertexCounter;
        }
    }

    copy(source) {
        super.copy(source);
        this.parameters = Object.assign({}, source.parameters);
        return this;
    }

    /**
     * Factory method for creating an instance of this class from the given JSON object.
     * @param {Object} data - A JSON object representing the serialized geometry.
     * @return {BoxGeometry}
     */
    static fromJSON(data) {
        return new BoxGeometry(
            data.width,
            data.height,
            data.depth,
            data.widthSegments,
            data.heightSegments,
            data.depthSegments
        );
    }
}


