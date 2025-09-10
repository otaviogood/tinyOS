// @ts-nocheck
import * as THREE from "three";

// Convert Float32 normals to normalized Int16 for bandwidth savings
function quantizeNormalsToInt16(geometry) {
    if (!geometry || !geometry.attributes || !geometry.attributes.normal) return;
    const attr = geometry.attributes.normal;
    // Already quantized
    if (attr.array instanceof Int16Array) return;
    const count = attr.count | 0;
    const src = attr.array;
    if (!src || !Number.isFinite(count) || count <= 0) return;
    const dst = new Int16Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
        const v = src[i];
        // Clamp to [-1, 1] and scale to Int16 range
        const clamped = v < -1 ? -1 : (v > 1 ? 1 : v);
        dst[i] = Math.round(clamped * 32767);
    }
    const newAttr = new THREE.BufferAttribute(dst, 3, true /* normalized */);
    geometry.setAttribute('normal', newAttr);
}

export async function fetchPieceIdsFromCSV() {
	try {
		const res = await fetch('/apps/bricks/exported_pieces.csv', { cache: 'no-cache' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const text = await res.text();
		const lines = text.split(/\r?\n/);
		const ids = [];
		const seen = new Set();
		for (const raw of lines) {
			if (!raw) continue;
			const line = raw.trim();
			if (!line) continue;
			const parts = line.split(',');
			if (!parts.length) continue;
			const id = (parts[0] || '').trim();
			if (!id || seen.has(id)) continue;
			ids.push(id);
			seen.add(id);
		}
		return ids;
	} catch (e) {
		console.warn('Failed to load exported_pieces.csv, falling back to minimal piece set', e);
		return [
			'3001','3002','3003','3004','3005','3008','3009','3010',
			'3020','3021','3022','3023','3024','3029','3030','3031',
			'3032','3034','3035','3460','3623','3666','3710','3795',
			'3832','4070','41539'
		];
	}
}

export async function loadBrickModel({ gltfLoader, setLoading, setupBrickMaterials, brickGeometries, collisionGeometries, convexGeometries }) {
	const pieceIds = await fetchPieceIdsFromCSV();
	return new Promise((resolve, reject) => {
		setLoading("Loading LEGO parts library...");
		gltfLoader.load(
			"/apps/bricks/all_pieces.gltf",
			function (gltf) {
				console.time('[BrickQuest] loadBrickModel');
				const legoPartsLibrary = gltf.scene.getObjectByName("LegoPartsLibrary");
				if (!legoPartsLibrary) {
					reject(new Error("LegoPartsLibrary not found in GLTF"));
					return;
				}
				setupBrickMaterials();
				let loadedCount = 0;
				for (const pieceId of pieceIds) {
					const piece = legoPartsLibrary.getObjectByName(pieceId);
					if (!piece) {
						console.warn(`Piece ${pieceId} not found in GLTF`);
						continue;
					}
					let partMesh = null;
					const partNode = piece.getObjectByName("part");
					if (partNode) {
						if (partNode.isMesh || partNode.isSkinnedMesh) partMesh = partNode; else {
							partNode.traverse((child) => { if (!partMesh && (child.isMesh || child.isSkinnedMesh)) partMesh = child; });
						}
					} else {
						piece.traverse((child) => {
							if (!partMesh && (child.isMesh || child.isSkinnedMesh)) {
								const ud = child.userData || {};
								const typeTag = ud.type || (ud.extras && ud.extras.type);
								if (typeTag === "part") partMesh = child;
							}
						});
					}
					if (!partMesh) {
						console.warn(`Piece ${pieceId}: 'part' node not found; using first mesh as fallback`);
						piece.traverse((child) => { if (!partMesh && (child.isMesh || child.isSkinnedMesh)) partMesh = child; });
					}
					if (partMesh && partMesh.geometry) {
						const geometry = partMesh.geometry.clone();
						// Keep geometry as-authored; baked path uses vertex colors
						// Quantize normals to Int16 normalized
						quantizeNormalsToInt16(geometry);
						geometry.computeBoundingBox();
						geometry.computeBoundingSphere();
						geometry.computeBoundsTree();
						brickGeometries.set(pieceId, geometry);
						loadedCount++;
					}
					let partNoStudsMesh = null;
					const pnsNode = piece.getObjectByName("partnostuds");
					if (pnsNode) {
						if (pnsNode.isMesh || pnsNode.isSkinnedMesh) partNoStudsMesh = pnsNode; else {
							pnsNode.traverse((child) => { if (!partNoStudsMesh && (child.isMesh || child.isSkinnedMesh)) partNoStudsMesh = child; });
						}
					}
					if (!partNoStudsMesh) {
						piece.traverse((child) => {
							if (!partNoStudsMesh && (child.isMesh || child.isSkinnedMesh)) {
								const ud = child.userData || {};
								const typeTag = ud.type || (ud.extras && ud.extras.type);
								if (typeTag === "partnostuds") partNoStudsMesh = child;
							}
						});
					}
					if (partNoStudsMesh && partNoStudsMesh.geometry) {
						const colGeom = partNoStudsMesh.geometry.clone();
						// Quantize normals to Int16 normalized (if present)
						quantizeNormalsToInt16(colGeom);
						try { colGeom.computeBoundsTree(); } catch (_) {}
						collisionGeometries.set(pieceId, colGeom);
					}

					// Optional convex mesh for LOD rendering
					if (convexGeometries) {
						let convexMesh = null;
						const convexNode = piece.getObjectByName("convex");
						if (convexNode) {
							if (convexNode.isMesh || convexNode.isSkinnedMesh) convexMesh = convexNode; else {
								convexNode.traverse((child) => { if (!convexMesh && (child.isMesh || child.isSkinnedMesh)) convexMesh = child; });
							}
						} else {
							piece.traverse((child) => {
								if (!convexMesh && (child.isMesh || child.isSkinnedMesh)) {
									const ud = child.userData || {};
									const typeTag = ud.type || (ud.extras && ud.extras.type);
									if (typeTag === "convex") convexMesh = child;
								}
							});
						}
						if (convexMesh && convexMesh.geometry) {
							const lodGeom = convexMesh.geometry.clone();
							// Quantize normals to Int16 normalized (if present)
							quantizeNormalsToInt16(lodGeom);
							lodGeom.computeBoundingBox();
							lodGeom.computeBoundingSphere();
							try { lodGeom.computeBoundsTree(); } catch (_) {}
							convexGeometries.set(pieceId, lodGeom);
						}
					}
				}
				setLoading("");
				resolve();
				console.timeEnd('[BrickQuest] loadBrickModel');
			},
			function (progress) {
				if (progress.lengthComputable) {
					const percentComplete = (progress.loaded / progress.total) * 100;
					setLoading(`Loading: ${Math.round(percentComplete)}%`);
				}
			},
			function (error) {
				console.error("Error loading GLTF model:", error);
				setLoading("Error loading model");
				reject(error);
			}
		);
	});
}


