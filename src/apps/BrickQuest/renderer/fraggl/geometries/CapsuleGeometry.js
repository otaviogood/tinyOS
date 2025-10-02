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
 * A geometry class for representing a capsule.
 * The capsule is composed of a cylinder with hemispherical caps.
 *
 * ```js
 * const geometry = new CapsuleGeometry(1, 1, 4, 8, 1);
 * ```
 *
 * @augments BufferGeometry
 */
export class CapsuleGeometry extends BufferGeometry {

	/**
	 * Constructs a new capsule geometry.
	 *
	 * @param {number} [radius=1] - Radius of the capsule (cylinder radius and cap radius).
	 * @param {number} [height=1] - Height of the cylindrical middle section.
	 * @param {number} [capSegments=4] - Number of curve segments used to build each cap (>= 1).
	 * @param {number} [radialSegments=8] - Number of segmented faces around the circumference (>= 3).
	 * @param {number} [heightSegments=1] - Rows of faces along the height of the cylinder part (>= 1).
	 */
	constructor(radius = 1, height = 1, capSegments = 4, radialSegments = 8, heightSegments = 1) {
		super();

		this.type = 'CapsuleGeometry';

		this.parameters = {
			radius: radius,
			height: height,
			capSegments: capSegments,
			radialSegments: radialSegments,
			heightSegments: heightSegments
		};

		height = Math.max(0, height);
		capSegments = Math.max(1, Math.floor(capSegments));
		radialSegments = Math.max(3, Math.floor(radialSegments));
		heightSegments = Math.max(1, Math.floor(heightSegments));

		// buffers
		const indices = [];
		const vertices = [];
		const normals = [];
		const uvs = [];

		// helper variables
		const halfHeight = height / 2;
		const capArcLength = (Math.PI / 2) * radius;
		const cylinderPartLength = height;
		const totalArcLength = 2 * capArcLength + cylinderPartLength;

		const numVerticalSegments = capSegments * 2 + heightSegments;
		const verticesPerRow = radialSegments + 1;

		const normal = new Vector3();
		const vertex = new Vector3();

		for (let iy = 0; iy <= numVerticalSegments; iy++) {
			let currentArcLength = 0;
			let profileY = 0;
			let profileRadius = 0;
			let normalYComponent = 0;

			if (iy <= capSegments) {
				// bottom cap
				const segmentProgress = iy / capSegments;
				const angle = (segmentProgress * Math.PI) / 2;
				profileY = -halfHeight - radius * Math.cos(angle);
				profileRadius = radius * Math.sin(angle);
				normalYComponent = -radius * Math.cos(angle);
				currentArcLength = segmentProgress * capArcLength;
			} else if (iy <= capSegments + heightSegments) {
				// middle section
				const segmentProgress = (iy - capSegments) / heightSegments;
				profileY = -halfHeight + segmentProgress * height;
				profileRadius = radius;
				normalYComponent = 0;
				currentArcLength = capArcLength + segmentProgress * cylinderPartLength;
			} else {
				// top cap
				const segmentProgress = (iy - capSegments - heightSegments) / capSegments;
				const angle = (segmentProgress * Math.PI) / 2;
				profileY = halfHeight + radius * Math.sin(angle);
				profileRadius = radius * Math.cos(angle);
				normalYComponent = radius * Math.sin(angle);
				currentArcLength = capArcLength + cylinderPartLength + segmentProgress * capArcLength;
			}

			const v = Math.max(0, Math.min(1, currentArcLength / totalArcLength));

			// special case for the poles
			let uOffset = 0;
			if (iy === 0) {
				uOffset = 0.5 / radialSegments;
			} else if (iy === numVerticalSegments) {
				uOffset = -0.5 / radialSegments;
			}

			for (let ix = 0; ix <= radialSegments; ix++) {
				const u = ix / radialSegments;
				const theta = u * Math.PI * 2;
				const sinTheta = Math.sin(theta);
				const cosTheta = Math.cos(theta);

				// vertex
				vertex.x = -profileRadius * cosTheta;
				vertex.y = profileY;
				vertex.z = profileRadius * sinTheta;
				vertices.push(vertex.x, vertex.y, vertex.z);

				// normal
				normal.set(-profileRadius * cosTheta, normalYComponent, profileRadius * sinTheta);
				normal.normalize();
				normals.push(normal.x, normal.y, normal.z);

				// uv
				uvs.push(u + uOffset, v);
			}

			if (iy > 0) {
				const prevIndexRow = (iy - 1) * verticesPerRow;
				for (let ix = 0; ix < radialSegments; ix++) {
					const i1 = prevIndexRow + ix;
					const i2 = prevIndexRow + ix + 1;
					const i3 = iy * verticesPerRow + ix;
					const i4 = iy * verticesPerRow + ix + 1;

					indices.push(i1, i2, i3);
					indices.push(i2, i4, i3);
				}
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
	 * @return {CapsuleGeometry}
	 */
	static fromJSON(data) {
		return new CapsuleGeometry(
			data.radius,
			data.height,
			data.capSegments,
			data.radialSegments,
			data.heightSegments
		);
	}
}


