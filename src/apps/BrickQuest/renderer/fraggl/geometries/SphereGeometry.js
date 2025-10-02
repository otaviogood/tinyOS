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
 * A geometry class for generating a sphere geometry.
 *
 * ```js
 * const geometry = new SphereGeometry(15, 32, 16);
 * const material = new BasicMaterial({ color: [1.0, 1.0, 0.0, 1.0] });
 * const sphere = new Mesh(geometry, material);
 * scene.add(sphere);
 * ```
 *
 * @augments BufferGeometry
 */
export class SphereGeometry extends BufferGeometry {

	/**
	 * Constructs a new sphere geometry.
	 *
	 * @param {number} [radius=1] - The sphere radius.
	 * @param {number} [widthSegments=32] - The number of horizontal segments. Minimum value is 3.
	 * @param {number} [heightSegments=16] - The number of vertical segments. Minimum value is 2.
	 * @param {number} [phiStart=0] - The horizontal starting angle in radians.
	 * @param {number} [phiLength=Math.PI*2] - The horizontal sweep angle size.
	 * @param {number} [thetaStart=0] - The vertical starting angle in radians.
	 * @param {number} [thetaLength=Math.PI] - The vertical sweep angle size.
	 */
	constructor(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
		super();

		this.type = 'SphereGeometry';

		/**
		 * Holds the constructor parameters used to generate the geometry.
		 * Any modification after instantiation does not change the geometry.
		 */
		this.parameters = {
			radius: radius,
			widthSegments: widthSegments,
			heightSegments: heightSegments,
			phiStart: phiStart,
			phiLength: phiLength,
			thetaStart: thetaStart,
			thetaLength: thetaLength
		};

		widthSegments = Math.max(3, Math.floor(widthSegments));
		heightSegments = Math.max(2, Math.floor(heightSegments));

		const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);

		let index = 0;
		const grid = [];

		const vertex = new Vector3();
		const normal = new Vector3();

		// buffers
		const indices = [];
		const vertices = [];
		const normals = [];
		const uvs = [];

		// generate vertices, normals and uvs
		for (let iy = 0; iy <= heightSegments; iy++) {
			const verticesRow = [];
			const v = iy / heightSegments;

			// special case for the poles
			let uOffset = 0;
			if (iy === 0 && thetaStart === 0) {
				uOffset = 0.5 / widthSegments;
			} else if (iy === heightSegments && thetaEnd === Math.PI) {
				uOffset = -0.5 / widthSegments;
			}

			for (let ix = 0; ix <= widthSegments; ix++) {
				const u = ix / widthSegments;

				// vertex
				vertex.x = -radius * Math.cos(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);
				vertex.y = radius * Math.cos(thetaStart + v * thetaLength);
				vertex.z = radius * Math.sin(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);

				vertices.push(vertex.x, vertex.y, vertex.z);

				// normal
				normal.copy(vertex).normalize();
				normals.push(normal.x, normal.y, normal.z);

				// uv
				uvs.push(u + uOffset, 1 - v);

				verticesRow.push(index++);
			}

			grid.push(verticesRow);
		}

		// indices
		for (let iy = 0; iy < heightSegments; iy++) {
			for (let ix = 0; ix < widthSegments; ix++) {
				const a = grid[iy][ix + 1];
				const b = grid[iy][ix];
				const c = grid[iy + 1][ix];
				const d = grid[iy + 1][ix + 1];

				if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
				if (iy !== heightSegments - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
			}
		}

		// build geometry
		this.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
		this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
		this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
		this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
	}

	copy(source) {
		super.copy(source);
		this.parameters = Object.assign({}, source.parameters);
		return this;
	}

	/**
	 * Factory method for creating an instance of this class from the given JSON object.
	 * @param {Object} data - A JSON object representing the serialized geometry.
	 * @return {SphereGeometry} A new instance.
	 */
	static fromJSON(data) {
		return new SphereGeometry(
			data.radius,
			data.widthSegments,
			data.heightSegments,
			data.phiStart,
			data.phiLength,
			data.thetaStart,
			data.thetaLength
		);
	}
}


