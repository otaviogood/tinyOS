// @ts-nocheck
import { Group, Box3, Vector3, Matrix4, Matrix3, Quaternion, Euler, BufferGeometry, BufferAttribute, Mesh } from "./fraggl/index.js";
import { Box3Helper } from "./fraggl/helpers/Box3Helper.js";

// Centralized chunk state shared by renderer and systems that manage chunk groups
export const chunkState = {
    CHUNK_SIZE: null,
    CHUNK_HEIGHT: null,
    chunkGroups: new Map(),
    chunkDebugVisible: false,
    chunkDebugWireframes: new Map(), // chunkKey -> Box3Helper
};

let sceneRef = null;

export function initializeChunkManager(scene) {
    sceneRef = scene || null;
}

export function getChunkOriginFromKey(state, key) {
    if (!key || state.CHUNK_SIZE == null || state.CHUNK_HEIGHT == null) return { x: 0, y: 0, z: 0 };
    const parts = String(key).split(',');
    const cx = parseInt(parts[0] || '0', 10) | 0;
    const cy = parseInt(parts[1] || '0', 10) | 0;
    const cz = parseInt(parts[2] || '0', 10) | 0;
    return { x: cx * state.CHUNK_SIZE, y: cy * state.CHUNK_HEIGHT, z: cz * state.CHUNK_SIZE };
}

export function ensureChunkGroup(cx, cy, cz) {
    const key = `${cx},${cy},${cz}`;
    let group = chunkState.chunkGroups.get(key);
    if (group) return group;
    group = new Group();
    const origin = getChunkOriginFromKey(chunkState, key);
    group.position.set(origin.x, origin.y, origin.z);
    group.userData.chunkKey = key;
    if (sceneRef) sceneRef.add(group);
    chunkState.chunkGroups.set(key, group);

    // Create wireframe box for this chunk if debug mode is enabled
    if (chunkState.chunkDebugVisible && chunkState.CHUNK_SIZE != null && chunkState.CHUNK_HEIGHT != null) {
        const chunkBox = new Box3(
            new Vector3(0, 0, 0),
            new Vector3(chunkState.CHUNK_SIZE, chunkState.CHUNK_HEIGHT, chunkState.CHUNK_SIZE)
        );
        const boxHelper = new Box3Helper(chunkBox, 0x00ff00);
        boxHelper.visible = chunkState.chunkDebugVisible;
        group.add(boxHelper);
        chunkState.chunkDebugWireframes.set(key, boxHelper);
    }

    return group;
}

export function setChunkConfig(cfg) {
    chunkState.CHUNK_SIZE = (cfg && typeof cfg.size === 'number') ? cfg.size : null;
    chunkState.CHUNK_HEIGHT = (cfg && typeof cfg.height === 'number') ? cfg.height : null;
    for (const group of chunkState.chunkGroups.values()) {
        if (!group) continue;
        group.visible = chunkState.CHUNK_SIZE != null;
    }
}

export function setChunkDebugVisible(visible) {
    chunkState.chunkDebugVisible = !!visible;

    // Update visibility of existing wireframes
    for (const wireframe of chunkState.chunkDebugWireframes.values()) {
        if (wireframe) wireframe.visible = chunkState.chunkDebugVisible;
    }

    // Create wireframes for chunks that don't have them yet
    if (chunkState.chunkDebugVisible && chunkState.CHUNK_SIZE != null && chunkState.CHUNK_HEIGHT != null) {
        for (const [chunkKey, group] of chunkState.chunkGroups.entries()) {
            if (!group) continue;
            if (chunkState.chunkDebugWireframes.has(chunkKey)) continue;

            const chunkBox = new Box3(
                new Vector3(0, 0, 0),
                new Vector3(chunkState.CHUNK_SIZE, chunkState.CHUNK_HEIGHT, chunkState.CHUNK_SIZE)
            );
            const boxHelper = new Box3Helper(chunkBox, 0x00ff00);
            group.add(boxHelper);
            chunkState.chunkDebugWireframes.set(chunkKey, boxHelper);
        }
    }
}

// Shared chunk mesh registry
export const chunkMeshData = new Map();

export function ensureRecordForChunk(chunkKey) {
    let record = chunkMeshData.get(chunkKey);
    if (!record) {
        record = { group: null, low: null, high: null, classic: null, pick: null, version: null, signature: null, cachedBricks: {}, hasClassicOnly: false };
        chunkMeshData.set(chunkKey, record);
    }
    if (!record.group) {
        const parts = String(chunkKey).split(',').map((v) => parseInt(v || '0', 10) | 0);
        record.group = ensureChunkGroup(parts[0], parts[1], parts[2]);
    }
    return record;
}

export function disposeChunkMesh(record) {
    if (!record) return;
    for (const kind of ['low','high','classic']) {
        const entry = record[kind];
        if (!entry) continue;
        // Handle single mesh or array of meshes (classic batching)
        if (entry.mesh && record.group) {
            record.group.remove(entry.mesh);
        }
        if (entry.mesh) entry.mesh.geometry = null;
        if (Array.isArray(entry.meshes)) {
            for (const m of entry.meshes) {
                if (m && record.group) record.group.remove(m);
            }
            entry.meshes.length = 0;
        }
        if (entry.geometry && typeof entry.geometry.dispose === 'function') {
            try { entry.geometry.dispose(); } catch (_) {}
        }
        record[kind] = null;
    }
    record.version = null;
    record.signature = null;
    record.hasClassicOnly = false;
}

export function getBricksArrayFromRecord(record) {
    const entries = Object.entries(record.cachedBricks || {});
    const out = [];
    for (const [id, b] of entries) {
        if (!b || typeof b !== 'object' || typeof b.pieceId !== 'string') continue;
        out.push({ id, ...b });
    }
    return out;
}

export function removeChunkGroupAndInstances(chunkKey) {
    const record = chunkMeshData.get(chunkKey);
    if (!record) return;
    if (record.group && sceneRef) {
        sceneRef.remove(record.group);
    }
    chunkMeshData.delete(chunkKey);
    chunkState.chunkGroups.delete(chunkKey);
    
    // Remove wireframe for this chunk
    const wireframe = chunkState.chunkDebugWireframes.get(chunkKey);
    if (wireframe && record.group) {
        record.group.remove(wireframe);
        wireframe.geometry = null;
    }
    chunkState.chunkDebugWireframes.delete(chunkKey);
}

// Temp variables reused during geometry building to avoid allocations
const tempMatrix = new Matrix4();
const tempMatrixNormal = new Matrix3();
const tempQuaternion = new Quaternion();
const tempEuler = new Euler();
const tempScale = new Vector3(1, 1, 1);
const tempPosition = new Vector3();

export function buildBakedGeometryForChunk({ chunkKey, bricks, useConvex = false, brickGeometries, convexGeometries, paletteLinear }) {
    if (!Array.isArray(bricks) || !bricks.length) return null;
    const origin = getChunkOriginFromKey(chunkState, chunkKey);

    let totalVertices = 0;
    let totalIndices = 0;
    const sourceGeometries = new Array(bricks.length);
    
    // Pre-fetch all geometries and cache the source map lookup
    const geomSource = useConvex ? convexGeometries : brickGeometries;
    const fallbackSource = useConvex ? brickGeometries : null;

    for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        const geom = geomSource.get(b.pieceId) || (fallbackSource ? fallbackSource.get(b.pieceId) : null);
        if (!geom || !geom.attributes || !geom.attributes.get('position')) {
            sourceGeometries[i] = null;
            continue;
        }
        sourceGeometries[i] = geom;
        totalVertices += geom.attributes.get('position').count | 0;
        const idAttr = geom.index;
        totalIndices += idAttr ? (idAttr.count | 0) : ((geom.attributes.get('position').count / 3) | 0) * 3;
    }
    
    if (totalVertices === 0 || totalIndices === 0) {
        return null;
    }

    const useUint32 = totalVertices > 65535;
    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const colors = new Uint8Array(totalVertices * 4);
    const indices = useUint32 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

    const boundsMin = new Vector3(Infinity, Infinity, Infinity);
    const boundsMax = new Vector3(-Infinity, -Infinity, -Infinity);

    let vertexOffset = 0;
    let indexOffset = 0;

    for (let brickIdx = 0; brickIdx < bricks.length; brickIdx++) {
        const brick = bricks[brickIdx];
        const geom = sourceGeometries[brickIdx];
        if (!geom) continue;

        // Direct attribute access like Three.js
        const posAttr = geom.attributes.get('position');
        const normalAttr = geom.attributes.get('normal');
        const indexAttr = geom.index;
        const vertCount = posAttr.count | 0;
        if (!vertCount) continue;

        const paletteIndex = brick.colorIndex | 0;
        const rgb = paletteLinear[paletteIndex] || [0.9, 0.9, 0.9];

        tempPosition.set(
            (brick.position?.x ?? 0) - origin.x,
            (brick.position?.y ?? 0) - origin.y,
            (brick.position?.z ?? 0) - origin.z
        );

        if (brick.rotation) {
            tempEuler.set(brick.rotation.x ?? 0, brick.rotation.y ?? 0, brick.rotation.z ?? 0, brick.rotation.order || 'XYZ');
            tempQuaternion.setFromEuler(tempEuler, false);
        } else {
            tempQuaternion.set(0, 0, 0, 1);
        }

        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        tempMatrixNormal.getNormalMatrixFromMatrix4(tempMatrix);
        
        // Update chunk bounds by transforming piece bounding box corners (much faster than per-vertex)
        if (geom.boundingBox) {
            const bb = geom.boundingBox;
            const m = tempMatrix.elements;
            // Transform 8 corners of the piece's bounding box
            for (let cornerIdx = 0; cornerIdx < 8; cornerIdx++) {
                const x = (cornerIdx & 1) ? bb.max.x : bb.min.x;
                const y = (cornerIdx & 2) ? bb.max.y : bb.min.y;
                const z = (cornerIdx & 4) ? bb.max.z : bb.min.z;
                const tx = m[0]*x + m[4]*y + m[8]*z + m[12];
                const ty = m[1]*x + m[5]*y + m[9]*z + m[13];
                const tz = m[2]*x + m[6]*y + m[10]*z + m[14];
                if (tx < boundsMin.x) boundsMin.x = tx; if (ty < boundsMin.y) boundsMin.y = ty; if (tz < boundsMin.z) boundsMin.z = tz;
                if (tx > boundsMax.x) boundsMax.x = tx; if (ty > boundsMax.y) boundsMax.y = ty; if (tz > boundsMax.z) boundsMax.z = tz;
            }
        }

        // Cache matrix elements in local variables for faster access
        const m = tempMatrix.elements;
        const m0 = m[0], m1 = m[1], m2 = m[2];
        const m4 = m[4], m5 = m[5], m6 = m[6];
        const m8 = m[8], m9 = m[9], m10 = m[10];
        const m12 = m[12], m13 = m[13], m14 = m[14];
        
        const nm = tempMatrixNormal.elements;
        const nm0 = nm[0], nm1 = nm[1], nm2 = nm[2];
        const nm3 = nm[3], nm4 = nm[4], nm5 = nm[5];
        const nm6 = nm[6], nm7 = nm[7], nm8 = nm[8];

        // Pre-compute color multipliers (avoid repeated multiplication)
        const colorR = rgb[0] * 255;
        const colorG = rgb[1] * 255;
        const colorB = rgb[2] * 255;

        // Cache source arrays
        const posArray = posAttr.array;
        const norArray = normalAttr.array;
        
        // Precompute bases and use running offsets to avoid per-iteration multiplies  
        const base3 = vertexOffset * 3;
        // Fast color path: pack RGBA into 32-bit and write once per vertex
        const colors32 = new Uint32Array(colors.buffer, colors.byteOffset, colors.length >>> 2);
        const packedRGBA = (255 << 24) | (Math.round(colorB) << 16) | (Math.round(colorG) << 8) | Math.round(colorR);
        let pOff = 0;
        let vOut = base3;
        let c32Out = vertexOffset;
        
        for (let i = 0; i < vertCount; i++, pOff += 3, vOut += 3) {
            const px = posArray[pOff + 0];
            const py = posArray[pOff + 1];
            const pz = posArray[pOff + 2];
            const tx = m0 * px + m4 * py + m8  * pz + m12;
            const ty = m1 * px + m5 * py + m9  * pz + m13;
            const tz = m2 * px + m6 * py + m10 * pz + m14;
            positions[vOut + 0] = tx;
            positions[vOut + 1] = ty;
            positions[vOut + 2] = tz;
            const nx = norArray[pOff + 0];
            const ny = norArray[pOff + 1];
            const nz = norArray[pOff + 2];
            const ntx = nm0 * nx + nm3 * ny + nm6 * nz;
            const nty = nm1 * nx + nm4 * ny + nm7 * nz;
            const ntz = nm2 * nx + nm5 * ny + nm8 * nz;
            normals[vOut + 0] = ntx;
            normals[vOut + 1] = nty;
            normals[vOut + 2] = ntz;
            colors32[c32Out++] = packedRGBA;
        }

        if (indexAttr) {
            const idxArray = indexAttr.array;
            let outOff = indexOffset;
            const base = vertexOffset;
            for (let i = 0, c = indexAttr.count | 0; i < c; i++) {
                indices[outOff++] = (base + (idxArray[i] | 0)) | 0;
            }
            indexOffset += indexAttr.count | 0;
        } else {
            // Non-indexed geometry
            for (let i = 0; i < vertCount; i++) {
                indices[indexOffset + i] = (vertexOffset + i) | 0;
            }
            indexOffset += vertCount | 0;
        }

        vertexOffset += vertCount;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 4, true));
    geometry.setIndex(new BufferAttribute(indices, 1));

    const bounds = new Box3();
    bounds.min.copy(boundsMin);
    bounds.max.copy(boundsMax);
    geometry.boundingBox = bounds;
    // Skip computeBoundingSphere - not needed for chunk meshes (only raycast uses it, we use AABB picking)

    const brickIndexToBrickId = bricks.map((b) => b.id);

    return { geometry, brickIndexToBrickId, bounds };
}

// Build merged AABB proxy geometry for all classic pieces in a chunk
export function buildClassicAabbGeometryForChunk({ chunkKey, bricks, pieceMeta, paletteLinear }) {
	if (!Array.isArray(bricks) || bricks.length === 0) return null;
	const origin = getChunkOriginFromKey(chunkState, chunkKey);

	const isClassicPiece = (pieceId) => {
		if (!pieceId || !pieceMeta || typeof pieceMeta.get !== 'function') return false;
		const meta = pieceMeta.get(pieceId);
		return !!(meta && meta.classicInfo);
	};

	// Batch to avoid exceeding hardware/index limits; keep batches within 8,000 boxes (~64k verts)
	const MAX_BOXES_PER_BATCH = 8000;
	const geometries = [];
	const boundsMin = new Vector3(Infinity, Infinity, Infinity);
	const boundsMax = new Vector3(-Infinity, -Infinity, -Infinity);

	let positions = null;
	let indices = null;
    let classicInfos = null; // Uint32 per-vertex, carries original 16-bit classicInfo
    let rgba8s = null; // Uint32 per-vertex, packed RGBA8 color
	let centers = null; // Float32 per-vertex vec3, world-space center per box (chunk space before u_model)
	let axesX = null; // Float32 per-vertex vec3, local X axis (chunk space)
	let axesY = null; // Float32 per-vertex vec3, local Y axis (chunk space)
	let boxIdx = 0; // index within current batch
	let posOut = 0;
	let idxOut = 0;

	function startBatch(capacity) {
		positions = new Float32Array(capacity * 8 * 3);
		indices = (capacity * 8) > 65535 ? new Uint32Array(capacity * 36) : new Uint16Array(capacity * 36);
		classicInfos = new Uint32Array(capacity * 8);
		centers = new Float32Array(capacity * 8 * 3);
		axesX = new Float32Array(capacity * 8 * 3);
		axesY = new Float32Array(capacity * 8 * 3);
        rgba8s = new Uint32Array(capacity * 8);
		boxIdx = 0;
		posOut = 0;
		idxOut = 0;
	}

	function finishBatch() {
		if (!positions || boxIdx === 0) return;
		const usedPositions = positions.subarray(0, boxIdx * 8 * 3);
		const usedIndices = indices.subarray(0, boxIdx * 36);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(usedPositions, 3));
		// classicInfo: 1 component per-vertex (stored as Uint32 to preserve 16-bit payload exactly)
		const usedClassic = classicInfos.subarray(0, boxIdx * 8);
		geometry.setAttribute('classicInfo', new BufferAttribute(usedClassic, 1));
        // rgba8 color per-vertex (Uint32)
        const usedRGBA = rgba8s.subarray(0, boxIdx * 8);
        geometry.setAttribute('rgba8', new BufferAttribute(usedRGBA, 1));
		// center attribute: vec3f repeated per vertex of each box
		const usedCenters = centers.subarray(0, boxIdx * 8 * 3);
		geometry.setAttribute('center', new BufferAttribute(usedCenters, 3));
		// axis attributes: vec3f repeated per vertex of each box
		const usedAxesX = axesX.subarray(0, boxIdx * 8 * 3);
		const usedAxesY = axesY.subarray(0, boxIdx * 8 * 3);
		geometry.setAttribute('axisX', new BufferAttribute(usedAxesX, 3));
		geometry.setAttribute('axisY', new BufferAttribute(usedAxesY, 3));
		geometry.setIndex(new BufferAttribute(usedIndices, 1));
		geometries.push(geometry);
		positions = null;
		indices = null;
		classicInfos = null;
		centers = null;
		axesX = null;
		axesY = null;
        rgba8s = null;
	}

	startBatch(Math.min(MAX_BOXES_PER_BATCH, Math.max(1, bricks.length)));

	for (let i = 0; i < bricks.length; i++) {
		const brick = bricks[i];
		if (!brick || !isClassicPiece(brick.pieceId)) continue;
		const meta = pieceMeta.get(brick.pieceId) || {};
		const pa = meta.partAABB || {};
		const bbMinArr = Array.isArray(pa.bboxMin) ? pa.bboxMin : (Array.isArray(pa.min) ? pa.min : null);
		const bbMaxArr = Array.isArray(pa.bboxMax) ? pa.bboxMax : (Array.isArray(pa.max) ? pa.max : null);
		if (!bbMinArr || !bbMaxArr) continue;

		// Ensure batch has room
		if (boxIdx >= MAX_BOXES_PER_BATCH) {
			finishBatch();
			startBatch(Math.min(MAX_BOXES_PER_BATCH, (bricks.length - i)));
		}

		tempPosition.set(
			(brick.position?.x ?? 0),
			(brick.position?.y ?? 0),
			(brick.position?.z ?? 0)
		);
		if (brick.rotation) {
			tempEuler.set(brick.rotation.x ?? 0, brick.rotation.y ?? 0, brick.rotation.z ?? 0, brick.rotation.order || 'XYZ');
			tempQuaternion.setFromEuler(tempEuler, false);
		} else {
			tempQuaternion.set(0, 0, 0, 1);
		}
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);

        // Debug-only partLocalMatrix support removed; AABB assumed in part local already

		const lx0 = bbMinArr[0], ly0 = bbMinArr[1], lz0 = bbMinArr[2];
		const lx1 = bbMaxArr[0], ly1 = bbMaxArr[1], lz1 = bbMaxArr[2];
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		const m = tempMatrix.elements;
		for (let c = 0; c < 8; c++) {
			const x = (c & 1) ? lx1 : lx0;
			const y = (c & 2) ? ly1 : ly0;
			const z = (c & 4) ? lz1 : lz0;
			const tx = m[0]*x + m[4]*y + m[8]*z + m[12] - origin.x;
			const ty = m[1]*x + m[5]*y + m[9]*z + m[13] - origin.y;
			const tz = m[2]*x + m[6]*y + m[10]*z + m[14] - origin.z;
			if (tx < minX) minX = tx; if (ty < minY) minY = ty; if (tz < minZ) minZ = tz;
			if (tx > maxX) maxX = tx; if (ty > maxY) maxY = ty; if (tz > maxZ) maxZ = tz;
		}

		const baseVertex = boxIdx * 8;
		// Compute center in chunk space (before u_model adds chunk transform)
		const cX = (minX + maxX) * 0.5;
		const cY = (minY + maxY) * 0.5;
		const cZ = (minZ + maxZ) * 0.5;
		positions[posOut + 0]  = minX; positions[posOut + 1]  = minY; positions[posOut + 2]  = minZ;
		positions[posOut + 3]  = maxX; positions[posOut + 4]  = minY; positions[posOut + 5]  = minZ;
		positions[posOut + 6]  = minX; positions[posOut + 7]  = maxY; positions[posOut + 8]  = minZ;
		positions[posOut + 9]  = maxX; positions[posOut + 10] = maxY; positions[posOut + 11] = minZ;
		positions[posOut + 12] = minX; positions[posOut + 13] = minY; positions[posOut + 14] = maxZ;
		positions[posOut + 15] = maxX; positions[posOut + 16] = minY; positions[posOut + 17] = maxZ;
		positions[posOut + 18] = minX; positions[posOut + 19] = maxY; positions[posOut + 20] = maxZ;
		positions[posOut + 21] = maxX; positions[posOut + 22] = maxY; positions[posOut + 23] = maxZ;
		posOut += 24;

		// Fill center per-vertex (8 vertices per box)
		{
			const baseCenter = baseVertex * 3;
			for (let v = 0; v < 8; v++) {
				const o = baseCenter + v * 3;
				centers[o + 0] = cX;
				centers[o + 1] = cY;
				centers[o + 2] = cZ;
			}
		}

		// Fill axes per-vertex (derive from rotation part of tempMatrix)
		{
			const baseAxes = baseVertex * 3;
			const axX = m[0], axY = m[1], axZ = m[2]; // X axis
			const ayX = m[4], ayY = m[5], ayZ = m[6]; // Y axis
			for (let v = 0; v < 8; v++) {
				let o = baseAxes + v * 3;
				axesX[o + 0] = axX; axesX[o + 1] = axY; axesX[o + 2] = axZ;
				axesY[o + 0] = ayX; axesY[o + 1] = ayY; axesY[o + 2] = ayZ;
			}
		}

        // Fill classicInfo per-vertex (8 vertices per box)
		const ci = (meta && typeof meta.classicInfo === 'number') ? (meta.classicInfo >>> 0) : 0;
		for (let v = 0; v < 8; v++) {
			classicInfos[baseVertex + v] = ci;
		}

        // Fill color RGBA8 per-vertex from palette at bake time (defaults to white)
        {
            const paletteIndex = (brick && Number.isFinite(brick.colorIndex)) ? (brick.colorIndex | 0) : 0;
            const rgb = (Array.isArray(paletteLinear) && paletteLinear[paletteIndex]) ? paletteLinear[paletteIndex] : [1, 1, 1];
            const r = Math.max(0, Math.min(255, Math.round((rgb[0] ?? 1) * 255)));
            const g = Math.max(0, Math.min(255, Math.round((rgb[1] ?? 1) * 255)));
            const b = Math.max(0, Math.min(255, Math.round((rgb[2] ?? 1) * 255)));
            const a = 255;
            // Pack as RGBA with R in least-significant byte to match WGSL unpack
            const packed = (a << 24) | (b << 16) | (g << 8) | r;
            for (let v = 0; v < 8; v++) {
                rgba8s[baseVertex + v] = packed >>> 0;
            }
        }

		if (minX < boundsMin.x) boundsMin.x = minX; if (minY < boundsMin.y) boundsMin.y = minY; if (minZ < boundsMin.z) boundsMin.z = minZ;
		if (maxX > boundsMax.x) boundsMax.x = maxX; if (maxY > boundsMax.y) boundsMax.y = maxY; if (maxZ > boundsMax.z) boundsMax.z = maxZ;

		const v = baseVertex;
		const pattern = [
			0,2,1, 1,2,3,
			4,5,6, 6,5,7,
			0,4,2, 2,4,6,
			1,3,5, 5,3,7,
			0,1,4, 4,1,5,
			2,6,3, 3,6,7,
		];
		for (let p = 0; p < 36; p++, idxOut++) {
			indices[idxOut] = (v + pattern[p]) | 0;
		}

		boxIdx++;
	}

		finishBatch();
		const bounds = new Box3();
		bounds.min.copy(boundsMin);
		bounds.max.copy(boundsMax);
		// Assign bounds to all batch geometries for culling and frustum checks
		for (let g of geometries) g.boundingBox = bounds;
		return { geometries, brickIndexToBrickId: null, bounds };
}

export function rebuildChunkMeshesLOD(chunkKey, record, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial }) {
    const rebuildStart = performance.now();
    const bricksForBuild = getBricksArrayFromRecord(record);
    if (!bricksForBuild.length) { disposeChunkMesh(record); return { duration: 0, rebuilt: false }; }

	const isClassicPiece = (pieceId) => {
		if (!pieceId || !pieceMeta || typeof pieceMeta.get !== 'function') return false;
		const meta = pieceMeta.get(pieceId);
		return !!(meta && meta.classicInfo);
	};
	const nonClassicBricks = [];
	const classicBricks = [];
	for (let i = 0; i < bricksForBuild.length; i++) {
		const b = bricksForBuild[i];
		if (isClassicPiece(b.pieceId)) classicBricks.push(b); else nonClassicBricks.push(b);
	}
    // Debug log removed
    
    // Always (re)build low LOD from convex
	{
		const bakedLow = buildBakedGeometryForChunk({ chunkKey, bricks: nonClassicBricks, useConvex: true, brickGeometries, convexGeometries, paletteLinear });
        if (bakedLow) {
            if (!record.low || !record.low.mesh) {
                // Default: no BVH for baked chunk meshes (uses AABB picking instead)
                const mesh = new Mesh(bakedLow.geometry, bakedMaterial);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                record.group.add(mesh);
                record.low = { mesh, geometry: bakedLow.geometry, brickMap: bakedLow.brickIndexToBrickId };
            } else {
                record.low.mesh.geometry = bakedLow.geometry;
                record.low.geometry = bakedLow.geometry;
                record.low.brickMap = bakedLow.brickIndexToBrickId;
            }
            if (bakedLow.bounds) {
                record.group.userData = record.group.userData || {};
                record.group.userData.chunkBounds = bakedLow.bounds;
            }
        }
    }
    // Conditionally build high LOD when near
    const ud = record.group.userData || {};
    const wantHigh = ud.lod === 0; // 0=high, 1=low
	if (wantHigh) {
		const bakedHigh = buildBakedGeometryForChunk({ chunkKey, bricks: nonClassicBricks, useConvex: false, brickGeometries, convexGeometries, paletteLinear });
        if (bakedHigh) {
            if (!record.high || !record.high.mesh) {
                // Default: no BVH for baked chunk meshes (uses AABB picking instead)
                const mesh = new Mesh(bakedHigh.geometry, bakedMaterial);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                record.group.add(mesh);
                record.high = { mesh, geometry: bakedHigh.geometry, brickMap: bakedHigh.brickIndexToBrickId };
            } else {
                record.high.mesh.geometry = bakedHigh.geometry;
                record.high.geometry = bakedHigh.geometry;
                record.high.brickMap = bakedHigh.brickIndexToBrickId;
            }

    // (old classic proxy path removed in favor of batched path below)
        }
    }
    // Build/update classic AABB proxy mesh (wireframe/basic)
    {
        const classicGeo = buildClassicAabbGeometryForChunk({ chunkKey, bricks: classicBricks, pieceMeta, paletteLinear });
        if (classicGeo) {
            const geos = classicGeo.geometries || [];
            if (!record.classic) record.classic = { meshes: [] };
            // Grow meshes list
            while (record.classic.meshes.length < geos.length) {
                const mesh = new Mesh(geos[record.classic.meshes.length], classicMaterial);
                // Enable shadow casting so classic proxies contribute to shadow maps
                mesh.castShadow = true;
                mesh.receiveShadow = false;
                record.group.add(mesh);
                record.classic.meshes.push(mesh);
            }
            // Shrink meshes list
            while (record.classic.meshes.length > geos.length) {
                const m = record.classic.meshes.pop();
                if (m) record.group.remove(m);
            }
            for (let i = 0; i < geos.length; i++) {
                record.classic.meshes[i].geometry = geos[i];
            }
            if (classicGeo.bounds) {
                const udo = record.group.userData || (record.group.userData = {});
                if (!udo.chunkBounds) udo.chunkBounds = classicGeo.bounds.clone(); else { udo.chunkBounds.min.min(classicGeo.bounds.min); udo.chunkBounds.max.max(classicGeo.bounds.max); }
            }
        } else if (record.classic && Array.isArray(record.classic.meshes)) {
            for (const m of record.classic.meshes) if (m) record.group.remove(m);
            record.classic.meshes.length = 0;
            record.classic = null;
        }
    }

    // Update picking data
    const pick = buildAabbPickDataForChunk(chunkKey, bricksForBuild, brickGeometries);
    if (pick) {
        record.pick = { boxes: pick.boxes, bounds: pick.bounds };
    }
    // Toggle visibility according to current LOD
	if (record.low && record.low.mesh) record.low.mesh.visible = !(ud.lod === 0);
	if (record.high && record.high.mesh) record.high.mesh.visible = (ud.lod === 0);
    if (record.classic && Array.isArray(record.classic.meshes)) {
        for (const m of record.classic.meshes) if (m) m.visible = true;
    }
    // Mark whether this chunk currently only has classic proxies (no low/high baked meshes)
    {
        const hasLow = !!(record.low && record.low.mesh);
        const hasHigh = !!(record.high && record.high.mesh);
        const hasClassic = !!(record.classic && Array.isArray(record.classic.meshes) && record.classic.meshes.length > 0);
        record.hasClassicOnly = hasClassic && !hasLow && !hasHigh;
    }
    
    // Track rebuild timing
    const rebuildDuration = performance.now() - rebuildStart;
    return { duration: rebuildDuration, rebuilt: true };
}

// Build a lightweight picking dataset: world-space AABB per brick plus chunk bounds
export function buildAabbPickDataForChunk(chunkKey, bricks, brickGeometries) {
    if (!Array.isArray(bricks) || bricks.length === 0) return null;
    const boxes = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const tempPos = new Vector3();
    const tempQuat = new Quaternion();
    const tempMat = new Matrix4();
    const tempScale1 = new Vector3(1, 1, 1);
    const bbMin = new Vector3();
    const bbMax = new Vector3();
    const tempEuler = new Euler();
    
    // Reuse corner Vector3s to avoid 8 allocations per brick
    const corner = new Vector3();

    function transformPieceAabbToWorld(pieceGeom, matrix, outMin, outMax) {
        if (!pieceGeom.boundingBox) {
            try { pieceGeom.computeBoundingBox(); } catch (_) {}
        }
        const bb = pieceGeom.boundingBox;
        if (!bb) { outMin.set(0,0,0); outMax.set(0,0,0); return; }
        const min = bb.min, max = bb.max;
        outMin.set(Infinity, Infinity, Infinity);
        outMax.set(-Infinity, -Infinity, -Infinity);
        
        // Manually transform 8 corners without allocating new Vector3s
        const m = matrix.elements;
        for (let i = 0; i < 8; i++) {
            const x = (i & 1) ? max.x : min.x;
            const y = (i & 2) ? max.y : min.y;
            const z = (i & 4) ? max.z : min.z;
            const tx = m[0]*x + m[4]*y + m[8]*z + m[12];
            const ty = m[1]*x + m[5]*y + m[9]*z + m[13];
            const tz = m[2]*x + m[6]*y + m[10]*z + m[14];
            if (tx < outMin.x) outMin.x = tx; if (ty < outMin.y) outMin.y = ty; if (tz < outMin.z) outMin.z = tz;
            if (tx > outMax.x) outMax.x = tx; if (ty > outMax.y) outMax.y = ty; if (tz > outMax.z) outMax.z = tz;
        }
    }

    for (let bi = 0; bi < bricks.length; bi++) {
        const b = bricks[bi];
        const pieceGeom = brickGeometries.get(b.pieceId);
        if (!pieceGeom) continue;
        
        // Build transform matrix directly instead of using compose (avoid overhead)
        tempPos.set(b.position?.x ?? 0, b.position?.y ?? 0, b.position?.z ?? 0);
        if (b.rotation) {
            tempEuler.set(b.rotation.x ?? 0, b.rotation.y ?? 0, b.rotation.z ?? 0, b.rotation.order || 'XYZ');
            tempQuat.setFromEuler(tempEuler, false);
        } else {
            tempQuat.set(0, 0, 0, 1);
        }
        tempMat.compose(tempPos, tempQuat, tempScale1);
        transformPieceAabbToWorld(pieceGeom, tempMat, bbMin, bbMax);
        boxes.push({
            min: { x: bbMin.x, y: bbMin.y, z: bbMin.z },
            max: { x: bbMax.x, y: bbMax.y, z: bbMax.z },
            brickId: b.id,
            pieceId: b.pieceId,
            pos: { x: b.position?.x ?? 0, y: b.position?.y ?? 0, z: b.position?.z ?? 0 },
            rot: { x: b.rotation?.x || 0, y: b.rotation?.y || 0, z: b.rotation?.z || 0 }
        });
        if (bbMin.x < minX) minX = bbMin.x; if (bbMin.y < minY) minY = bbMin.y; if (bbMin.z < minZ) minZ = bbMin.z;
        if (bbMax.x > maxX) maxX = bbMax.x; if (bbMax.y > maxY) maxY = bbMax.y; if (bbMax.z > maxZ) maxZ = bbMax.z;
    }
    const bounds = new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
    return { boxes, bounds };
}

// Reconcile chunks and bricks from server updates
export function reconcileChunksAndBricks(chunks, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial }) {
    if (!chunks || typeof chunks !== 'object') return;

    // Only remove explicitly provided keys (optional partial removal)
    const removeKeys = Array.isArray(chunks.__removeKeys) ? chunks.__removeKeys : null;
    if (removeKeys) {
        for (const key of removeKeys) {
            removeChunkGroupAndInstances(key);
        }
    }

    for (const [chunkKey, chunk] of Object.entries(chunks)) {
        const bricksObj = chunk?.bricks || {};
        const record = ensureRecordForChunk(chunkKey);

        // Merge bricks into a cached snapshot so partial updates don't clear previous bricks
        if (chunk && chunk.__full === true) {
            record.cachedBricks = {};
        }
        if (!record.cachedBricks) record.cachedBricks = {};
        // Apply updates: set or delete
        for (const [id, brick] of Object.entries(bricksObj)) {
            if (brick == null || (typeof brick === 'object' && brick.__delete)) {
                delete record.cachedBricks[id];
            } else if (brick && typeof brick === 'object') {
                record.cachedBricks[id] = brick;
            }
        }

        const cachedEntries = Object.entries(record.cachedBricks);
        const needsClear = cachedEntries.length === 0;
        if (needsClear) {
            disposeChunkMesh(record);
            continue;
        }

        const chunkVersion = chunk?.version ?? 0;
        const filtered = [];
        for (const [id, brick] of cachedEntries) {
            if (!brick || typeof brick !== 'object' || typeof brick.pieceId !== 'string') continue;
            filtered.push({ id, brick });
        }

        if (!filtered.length) {
            disposeChunkMesh(record);
            continue;
        }

        const signature = chunkVersion
            ? `${chunkVersion}:${filtered.length}`
            : `${filtered.length}:${filtered.map(({ id, brick }) => `${id}:${brick.pieceId}:${brick.colorIndex | 0}:${(brick.rotation?.x ?? 0).toFixed(3)}:${(brick.rotation?.y ?? 0).toFixed(3)}:${(brick.rotation?.z ?? 0).toFixed(3)}`).join(',')}`;
        if (record.signature !== signature) {
            record.version = chunkVersion;
            record.signature = signature;
            // Rebuild both low/high as needed; visibility toggled per current LOD
            rebuildChunkMeshesLOD(chunkKey, record, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
        }
    }
}

// Remove a brick from any chunk it's in - returns chunk key for reconciliation
export function findAndMarkBrickForRemoval(brickId) {
    if (!brickId) return null;
    for (const [chunkKey, record] of chunkMeshData.entries()) {
        const maps = [];
        if (record?.low?.brickMap) maps.push(record.low.brickMap);
        if (record?.high?.brickMap) maps.push(record.high.brickMap);
        const includes = maps.some((m) => Array.isArray(m) && m.includes(brickId));
        if (includes) {
            // Mark for deletion in cached bricks
            if (record.cachedBricks && record.cachedBricks[brickId]) {
                delete record.cachedBricks[brickId];
            }
            return chunkKey;
        }
    }
    return null;
}

// Remove a brick from a specific chunk
export function removeBrickInChunk(chunkKey, brickId, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial }) {
    if (!chunkKey || !brickId) return;
    const record = chunkMeshData.get(chunkKey);
    if (!record) return;
    // Update cached bricks
    if (record.cachedBricks && record.cachedBricks[brickId]) {
        delete record.cachedBricks[brickId];
        // Rebuild chunk to reflect removal
        const bricksForBuild = getBricksArrayFromRecord(record);
        if (bricksForBuild.length === 0) {
            disposeChunkMesh(record);
        } else {
            rebuildChunkMeshesLOD(chunkKey, record, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
        }
    }
}

// Create/update a brick mesh in a chunk
export function createBrickInChunk(brick, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial }) {
    if (!brick || !brick.chunkKey) return;
    const record = ensureRecordForChunk(brick.chunkKey);
    if (!record.cachedBricks) record.cachedBricks = {};
    record.cachedBricks[brick.id] = brick;
    // Rebuild chunk to show new brick
    rebuildChunkMeshesLOD(brick.chunkKey, record, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
}

// Clear all chunk data
export function clearAllChunks() {
    for (const record of chunkMeshData.values()) {
        disposeChunkMesh(record);
        if (record.group && sceneRef) {
            sceneRef.remove(record.group);
        }
    }
    chunkMeshData.clear();
    chunkState.chunkGroups.clear();
    
    // Clean up all wireframes
    for (const wireframe of chunkState.chunkDebugWireframes.values()) {
        if (wireframe && wireframe.geometry) {
            wireframe.geometry = null;
        }
    }
    chunkState.chunkDebugWireframes.clear();
}

// Count triangles in all visible chunks
export function countChunkTriangles() {
    let total = 0;
    let debugCounts = { chunks: 0, highLOD: 0, lowLOD: 0, culledDist: 0, culledFrustum: 0 };
    
    for (const record of chunkMeshData.values()) {
        if (!record) continue;
        
        const group = record.group;
        // Skip chunks that are culled (beyond render distance or outside frustum)
        if (group && !group.visible) {
            // Check if it was frustum culled or distance culled
            const ud = group.userData || {};
            if (ud.frustumCulled) {
                debugCounts.culledFrustum++;
            } else {
                debugCounts.culledDist++;
            }
            continue;
        }
        
        debugCounts.chunks++;
        
        // Count high LOD if visible (nearby chunks)
        if (record.high?.mesh?.visible && record.high.geometry) {
            const geom = record.high.geometry;
            const idx = geom.index;
            if (idx && idx.count) {
                const tris = (idx.count / 3) | 0;
                total += tris;
                debugCounts.highLOD += tris;
            }
        }
        
        // Count low LOD if visible (far chunks)
        if (record.low?.mesh?.visible && record.low.geometry) {
            const geom = record.low.geometry;
            const idx = geom.index;
            if (idx && idx.count) {
                const tris = (idx.count / 3) | 0;
                total += tris;
                debugCounts.lowLOD += tris;
            }
        }
    }
    
    return { total, debugCounts };
}

// Update chunk LOD selection and visibility culling
const tempVecLOD = new Vector3();
export function updateChunkLODAndCulling(camera, frustum, RENDER_DISTANCE, LOD_DISTANCE, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial }) {
    let lastChunkRebuildMs = 0;
    let totalChunkRebuildsThisFrame = 0;
    
    if (chunkState.chunkGroups && chunkState.chunkGroups.size > 0) {
        for (const [chunkKey, group] of chunkState.chunkGroups.entries()) {
            if (!group) continue;
            const ud = group.userData || (group.userData = {});
            // Distance-based chunk culling using chunk centroid vs render distance
            let centroidX, centroidY, centroidZ;
            if (chunkState.CHUNK_SIZE != null && chunkState.CHUNK_HEIGHT != null) {
                centroidX = group.position.x + (chunkState.CHUNK_SIZE * 0.5);
                centroidY = group.position.y + (chunkState.CHUNK_HEIGHT * 0.5);
                centroidZ = group.position.z + (chunkState.CHUNK_SIZE * 0.5);
            } else if (ud.chunkBounds) {
                const c = ud.chunkBounds.getCenter(new Vector3());
                centroidX = c.x; centroidY = c.y; centroidZ = c.z;
            } else {
                centroidX = group.position.x; centroidY = group.position.y; centroidZ = group.position.z;
            }
            tempVecLOD.set(centroidX, centroidY, centroidZ);
            const distToCentroid = tempVecLOD.distanceTo(camera.position);
            const beyondFar = Number.isFinite(RENDER_DISTANCE) && distToCentroid > RENDER_DISTANCE;
            
            // Frustum culling: check if chunk bounds are outside view frustum
            let outsideFrustum = false;
            if (!beyondFar && ud.chunkBounds) {
                outsideFrustum = !frustum.intersectsBox(ud.chunkBounds);
            }

            // Mark frustum status for stats/logic; only distance affects group visibility here
            ud.frustumCulled = outsideFrustum;
            group.visible = !beyondFar;
            
            const record = chunkMeshData.get(chunkKey);
            if (!group.visible) {
                continue;
            }
            // Ensure bounds exist
            if (!ud.chunkBounds && record) {
                const bounds = new Box3();
                let any = false;
                if (record.low && record.low.geometry && record.low.geometry.boundingBox) {
                    const bb = record.low.geometry.boundingBox;
                    const min = bb.min.clone().add(group.position);
                    const max = bb.max.clone().add(group.position);
                    bounds.min.min(min); bounds.max.max(max); any = true;
                }
                if (record.high && record.high.geometry && record.high.geometry.boundingBox) {
                    const bb = record.high.geometry.boundingBox;
                    const min = bb.min.clone().add(group.position);
                    const max = bb.max.clone().add(group.position);
                    if (!any) { bounds.min.copy(min); bounds.max.copy(max); any = true; } else { bounds.min.min(min); bounds.max.max(max); }
                }
                if (any) ud.chunkBounds = bounds;
            }
            // LOD selection per chunk (distance-based)
            const desiredLod = (distToCentroid > LOD_DISTANCE) ? 1 : 0; // 0=high,1=low
            ud.lod = desiredLod;
            if (record) {
                if (desiredLod === 0) {
                    // Need high detail nearby
                    if ((!record.high || !record.high.mesh) && !record.hasClassicOnly) {
                        const result = rebuildChunkMeshesLOD(chunkKey, record, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
                        if (result.rebuilt) {
                            lastChunkRebuildMs += result.duration;
                            totalChunkRebuildsThisFrame++;
                        }
                    }
                } else {
                    // Ensure low exists
                    if ((!record.low || !record.low.mesh) && !record.hasClassicOnly) {
                        const result = rebuildChunkMeshesLOD(chunkKey, record, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
                        if (result.rebuilt) {
                            lastChunkRebuildMs += result.duration;
                            totalChunkRebuildsThisFrame++;
                        }
                    }
                }
                // Toggle visibility according to desired LOD
                if (record.low && record.low.mesh) record.low.mesh.visible = (desiredLod !== 0);
                if (record.high && record.high.mesh) record.high.mesh.visible = (desiredLod === 0);
            }
        }
    }
    
    return { lastChunkRebuildMs, totalChunkRebuildsThisFrame };
}

// Raycast against all chunks to find brick candidates
export function raycastAgainstChunks(ray, maxDistance) {
    const candidates = [];
    
    for (const [chunkKey, record] of chunkMeshData.entries()) {
        const pick = record && record.pick;
        if (!pick || !pick.boxes || pick.boxes.length === 0) continue;
        
        // Early out: test ray against chunk bounds first
        const cb = pick.bounds;
        if (cb && !ray.intersectsBox(cb)) continue;
        
        // Test ray against each brick's AABB in this chunk
        for (let i = 0; i < pick.boxes.length; i++) {
            const b = pick.boxes[i];
            const box = new Box3(
                new Vector3(b.min.x, b.min.y, b.min.z),
                new Vector3(b.max.x, b.max.y, b.max.z)
            );
            const hitPoint = new Vector3();
            if (!ray.intersectBox(box, hitPoint)) continue;
            
            const dist = hitPoint.distanceTo(ray.origin);
            if (dist > maxDistance) continue;
            
            candidates.push({
                distance: dist,
                point: hitPoint.clone(),
                brickId: b.brickId,
                chunkKey,
                pieceId: b.pieceId,
                pos: b.pos,
                rot: b.rot,
            });
        }
    }
    
    return candidates;
}

// Find the pick box data for a specific brick in a chunk
export function findPickBoxForBrick(chunkKey, brickId) {
    const record = chunkMeshData.get(chunkKey);
    if (!record || !record.pick || !record.pick.boxes) return null;
    
    for (const b of record.pick.boxes) {
        if (b.brickId === brickId) return b;
    }
    
    return null;
}

