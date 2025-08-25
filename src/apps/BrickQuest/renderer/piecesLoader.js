// @ts-nocheck
import * as THREE from "three";

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
						try {
							piece.updateWorldMatrix(true, false);
							partMesh.updateWorldMatrix(true, false);
							const pieceWorld = piece.matrixWorld;
							const partWorld = partMesh.matrixWorld;
							const pieceWorldInv = new THREE.Matrix4().copy(pieceWorld).invert();
							const localToPiece = new THREE.Matrix4().multiplyMatrices(pieceWorldInv, partWorld);
							geometry.applyMatrix4(localToPiece);
						} catch (e) {
							console.warn(`Failed to bake transform for piece ${pieceId}:`, e);
						}
						if (!geometry.attributes.normal) geometry.computeVertexNormals();
						geometry.normalizeNormals();
						// Keep geometry as-authored; material ignores per-vertex color (we use per-instance colors)
						// Ensure bounds exist for better culling even though InstancedMesh disables frustum culling
						geometry.computeBoundingBox();
						geometry.computeBoundingSphere();
						try { geometry.computeBoundsTree(); } catch (_) {}
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
						try {
							piece.updateWorldMatrix(true, false);
							partNoStudsMesh.updateWorldMatrix(true, false);
							const pieceWorld = piece.matrixWorld;
							const pnsWorld = partNoStudsMesh.matrixWorld;
							const pieceWorldInv = new THREE.Matrix4().copy(pieceWorld).invert();
							const localToPiece = new THREE.Matrix4().multiplyMatrices(pieceWorldInv, pnsWorld);
							colGeom.applyMatrix4(localToPiece);
						} catch (e) {
							console.warn(`Failed to bake transform for partnostuds ${pieceId}:`, e);
						}
						if (!colGeom.attributes.normal) colGeom.computeVertexNormals();
						colGeom.normalizeNormals();
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
							try {
								piece.updateWorldMatrix(true, false);
								convexMesh.updateWorldMatrix(true, false);
								const pieceWorld = piece.matrixWorld;
								const convexWorld = convexMesh.matrixWorld;
								const pieceWorldInv = new THREE.Matrix4().copy(pieceWorld).invert();
								const localToPiece = new THREE.Matrix4().multiplyMatrices(pieceWorldInv, convexWorld);
								lodGeom.applyMatrix4(localToPiece);
							} catch (e) {
								console.warn(`Failed to bake transform for convex ${pieceId}:`, e);
							}
							if (!lodGeom.attributes.normal) lodGeom.computeVertexNormals();
							lodGeom.normalizeNormals();
							lodGeom.computeBoundingBox();
							lodGeom.computeBoundingSphere();
							try { lodGeom.computeBoundsTree(); } catch (_) {}
							convexGeometries.set(pieceId, lodGeom);
						}
					}
				}
				setLoading("");
				resolve();
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


