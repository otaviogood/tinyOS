const path = require('path');
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const THREE = require('three');
const { MeshBVH } = require('three-mesh-bvh');

// Brick stud data from GLTF - will store data for all pieces
const brickPiecesData = new Map(); // pieceId -> { studs: [], antiStuds: [] }
const pieceCollisionCache = new Map(); // pieceId -> { geomNoStuds, geomNoStudsShrunk, bboxNoStuds }

// Note: Shrunk geometry is now authored at export time and stored as a 'shrunk' node in GLTF.

// Load piece list dynamically from exported_pieces.csv
function loadPieceListFromCSV() {
    try {
        const csvPath = path.join(__dirname, '..', 'public', 'apps', 'bricks', 'exported_pieces.csv');
        const csvText = fs.readFileSync(csvPath, 'utf8');
        const lines = csvText.split(/\r?\n/);
        const seen = new Set();
        const result = [];
        for (const raw of lines) {
            if (!raw) continue;
            const line = raw.trim();
            if (!line) continue;
            const parts = line.split(',');
            if (!parts.length) continue;
            const id = (parts[0] || '').trim();
            if (!id || seen.has(id)) continue;
            const color = ((parts[1] || '').trim()) || 'white';
            const name = (parts.slice(2).join(',') || '').trim();
            result.push({ id, color, name });
            seen.add(id);
        }
        return result;
    } catch (e) {
        console.error('Failed to load exported_pieces.csv, falling back to minimal piece list:', e);
        // Minimal fallback to keep server functional
        return [
            { id: '3001', color: 'white', name: 'brick 2x4' },
            { id: '3022', color: 'blue', name: 'plate 2x2' },
            { id: '41539', color: 'blue', name: 'plate 8x8' },
        ];
    }
}

const PIECE_LIST = loadPieceListFromCSV();

// Load brick stud data AND partnostuds geometry from GLTF file for all pieces
async function loadBrickStudData() {
    try {
        const gltfPath = path.join(__dirname, '..', 'public', 'apps', 'bricks', 'all_pieces.gltf');
        const io = new NodeIO();
        const document = await io.read(gltfPath);

        // Find the root node that contains the LEGO parts library
        const rootNode = document.getRoot().listNodes().find((node) => node.getName() === 'LegoPartsLibrary');
        if (!rootNode) {
            console.error('LegoPartsLibrary not found in GLTF');
            return;
        }

        let loadedCount = 0;
        for (const pieceInfo of PIECE_LIST) {
            const piece = rootNode.listChildren().find((child) => child.getName() === pieceInfo.id);
            if (!piece) {
                console.warn(`Piece ${pieceInfo.id} not found in GLTF`);
                continue;
            }

            // Extract stud data from extras
            const extras = piece.getExtras();
            const pieceData = {
                studs: [],
                antiStuds: [],
            };

            if (extras) {
                if (extras.studs) {
                    pieceData.studs = extras.studs;
                }
                if (extras.antiStuds) {
                    pieceData.antiStuds = extras.antiStuds;
                }
            }

            brickPiecesData.set(pieceInfo.id, pieceData);

            // Extract 'part', 'partnostuds', 'shrunk' and 'convex' geometries for collision
            // - partnostuds: used for existing world bricks (no studs) broad & narrow phase
            // - shrunk: used for the moving/ghost piece when available
            // - convex: convex hull mesh for narrow-phase (capsule vs convex)
            // - part: fallback if partnostuds is missing
            const partNode = piece.listChildren().find((child) => child.getName() === 'part');
            const partNoStudsNode = piece.listChildren().find((child) => child.getName() === 'partnostuds');
            const shrunkNode = piece.listChildren().find((child) => child.getName() === 'shrunk');
            const convexNode = piece.listChildren().find((child) => child.getName() === 'convex');

            let geomPart = null;
            let geomPartNoStuds = null;
            let geomShrunk = null;
            let geomConvex = null;

            if (!partNode) {
                console.warn(`part not found for piece ${pieceInfo.id}`);
            } else {
                const mesh = partNode.getMesh();
                if (!mesh) {
                    console.warn(`part node has no mesh for piece ${pieceInfo.id}`);
                } else {
                    const prim = mesh.listPrimitives()[0];
                    if (!prim) {
                        console.warn(`No primitives in part mesh for piece ${pieceInfo.id}`);
                    } else {
                        const posAcc = prim.getAttribute('POSITION');
                        const idxAcc = prim.getIndices();
                        if (!posAcc) {
                            console.warn(`part primitive missing POSITION for piece ${pieceInfo.id}`);
                        } else {
                            const positionArray = posAcc.getArray();
                            const indexArray = idxAcc ? idxAcc.getArray() : null;

                            const geometry = new THREE.BufferGeometry();
                            const posTyped = positionArray.buffer
                                ? new Float32Array(positionArray.buffer, positionArray.byteOffset, positionArray.length)
                                : new Float32Array(positionArray);
                            geometry.setAttribute('position', new THREE.BufferAttribute(posTyped, 3));
                            if (indexArray) {
                                const TypedIdx = indexArray.constructor;
                                const idxTyped = indexArray.buffer
                                    ? new TypedIdx(indexArray.buffer, indexArray.byteOffset, indexArray.length)
                                    : new TypedIdx(indexArray);
                                geometry.setIndex(new THREE.BufferAttribute(idxTyped, 1));
                            }
                            // Bake 'part' node's local transform into geometry so it's in piece-local space
                            try {
                                const t = partNode.getTranslation?.() || [0, 0, 0];
                                const r = partNode.getRotation?.() || [0, 0, 0, 1];
                                const s = partNode.getScale?.() || [1, 1, 1];
                                const mat = new THREE.Matrix4().compose(
                                    new THREE.Vector3(t[0], t[1], t[2]),
                                    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
                                    new THREE.Vector3(s[0], s[1], s[2])
                                );
                                geometry.applyMatrix4(mat);
                            } catch (e) {
                                console.warn(`Failed to bake transform for part ${pieceInfo.id}:`, e);
                            }

                            geometry.computeVertexNormals();
                            geometry.computeBoundingBox();
                            geometry.computeBoundsTree();
                            geomPart = geometry;
                        }
                    }
                }
            }

            if (!partNoStudsNode) {
                // If missing, we'll fallback to 'part' geometry later
                console.warn(`partnostuds not found for piece ${pieceInfo.id}`);
            } else {
                const mesh = partNoStudsNode.getMesh();
                if (!mesh) {
                    console.warn(`partnostuds node has no mesh for piece ${pieceInfo.id}`);
                } else {
                    const prim = mesh.listPrimitives()[0];
                    if (!prim) {
                        console.warn(`No primitives in partnostuds mesh for piece ${pieceInfo.id}`);
                    } else {
                        const posAcc = prim.getAttribute('POSITION');
                        const idxAcc = prim.getIndices();
                        if (!posAcc) {
                            console.warn(`partnostuds primitive missing POSITION for piece ${pieceInfo.id}`);
                        } else {
                            const positionArray = posAcc.getArray();
                            const indexArray = idxAcc ? idxAcc.getArray() : null;

                            const geometry = new THREE.BufferGeometry();
                            const posTyped = positionArray.buffer
                                ? new Float32Array(positionArray.buffer, positionArray.byteOffset, positionArray.length)
                                : new Float32Array(positionArray);
                            geometry.setAttribute('position', new THREE.BufferAttribute(posTyped, 3));
                            if (indexArray) {
                                const TypedIdx = indexArray.constructor;
                                const idxTyped = indexArray.buffer
                                    ? new TypedIdx(indexArray.buffer, indexArray.byteOffset, indexArray.length)
                                    : new TypedIdx(indexArray);
                                geometry.setIndex(new THREE.BufferAttribute(idxTyped, 1));
                            }
                            // Bake 'partnostuds' node's local transform into geometry so it's in piece-local space
                            try {
                                const t = partNoStudsNode.getTranslation?.() || [0, 0, 0];
                                const r = partNoStudsNode.getRotation?.() || [0, 0, 0, 1];
                                const s = partNoStudsNode.getScale?.() || [1, 1, 1];
                                const mat = new THREE.Matrix4().compose(
                                    new THREE.Vector3(t[0], t[1], t[2]),
                                    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
                                    new THREE.Vector3(s[0], s[1], s[2])
                                );
                                geometry.applyMatrix4(mat);
                            } catch (e) {
                                console.warn(`Failed to bake transform for partnostuds ${pieceInfo.id}:`, e);
                            }

                            geometry.computeVertexNormals();
                            geometry.computeBoundingBox();
                            geometry.computeBoundsTree();
                            geomPartNoStuds = geometry;
                        }
                    }
                }
            }

            if (!shrunkNode) {
                // No runtime shrinking fallback; rely on exported 'shrunk' geometry only
                console.warn(`shrunk not found for piece ${pieceInfo.id}`);
            } else {
                const mesh = shrunkNode.getMesh();
                if (!mesh) {
                    console.warn(`shrunk node has no mesh for piece ${pieceInfo.id}`);
                } else {
                    const prim = mesh.listPrimitives()[0];
                    if (!prim) {
                        console.warn(`No primitives in shrunk mesh for piece ${pieceInfo.id}`);
                    } else {
                        const posAcc = prim.getAttribute('POSITION');
                        const idxAcc = prim.getIndices();
                        if (!posAcc) {
                            console.warn(`shrunk primitive missing POSITION for piece ${pieceInfo.id}`);
                        } else {
                            const positionArray = posAcc.getArray();
                            const indexArray = idxAcc ? idxAcc.getArray() : null;

                            const geometry = new THREE.BufferGeometry();
                            const posTyped = positionArray.buffer
                                ? new Float32Array(positionArray.buffer, positionArray.byteOffset, positionArray.length)
                                : new Float32Array(positionArray);
                            geometry.setAttribute('position', new THREE.BufferAttribute(posTyped, 3));
                            if (indexArray) {
                                const TypedIdx = indexArray.constructor;
                                const idxTyped = indexArray.buffer
                                    ? new TypedIdx(indexArray.buffer, indexArray.byteOffset, indexArray.length)
                                    : new TypedIdx(indexArray);
                                geometry.setIndex(new THREE.BufferAttribute(idxTyped, 1));
                            }
                            // Bake 'shrunk' node's local transform into geometry so it's in piece-local space
                            try {
                                const t = shrunkNode.getTranslation?.() || [0, 0, 0];
                                const r = shrunkNode.getRotation?.() || [0, 0, 0, 1];
                                const s = shrunkNode.getScale?.() || [1, 1, 1];
                                const mat = new THREE.Matrix4().compose(
                                    new THREE.Vector3(t[0], t[1], t[2]),
                                    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
                                    new THREE.Vector3(s[0], s[1], s[2])
                                );
                                geometry.applyMatrix4(mat);
                            } catch (e) {
                                console.warn(`Failed to bake transform for shrunk ${pieceInfo.id}:`, e);
                            }

                            geometry.computeVertexNormals();
                            geometry.computeBoundingBox();
                            geometry.computeBoundsTree();
                            geomShrunk = geometry;
                        }
                    }
                }
            }

            // Assume convex exists and is valid
            {
                const mesh = convexNode.getMesh();
                const prim = mesh.listPrimitives()[0];
                const posAcc = prim.getAttribute('POSITION');
                const idxAcc = prim.getIndices();
                const positionArray = posAcc.getArray();
                const indexArray = idxAcc ? idxAcc.getArray() : null;

                const geometry = new THREE.BufferGeometry();
                const posTyped = positionArray.buffer
                    ? new Float32Array(positionArray.buffer, positionArray.byteOffset, positionArray.length)
                    : new Float32Array(positionArray);
                geometry.setAttribute('position', new THREE.BufferAttribute(posTyped, 3));
                if (indexArray) {
                    const TypedIdx = indexArray.constructor;
                    const idxTyped = indexArray.buffer
                        ? new TypedIdx(indexArray.buffer, indexArray.byteOffset, indexArray.length)
                        : new TypedIdx(indexArray);
                    geometry.setIndex(new THREE.BufferAttribute(idxTyped, 1));
                }
                // Bake 'convex' node's local transform into geometry so it's in piece-local space
                const t = convexNode.getTranslation?.() || [0, 0, 0];
                const r = convexNode.getRotation?.() || [0, 0, 0, 1];
                const s = convexNode.getScale?.() || [1, 1, 1];
                const mat = new THREE.Matrix4().compose(
                    new THREE.Vector3(t[0], t[1], t[2]),
                    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
                    new THREE.Vector3(s[0], s[1], s[2])
                );
                geometry.applyMatrix4(mat);

                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                geometry.computeBoundsTree();
                geomConvex = geometry;
            }

            const chosenStaticGeom = geomPartNoStuds || geomPart;
            if (chosenStaticGeom) {
                pieceCollisionCache.set(pieceInfo.id, {
                    // Reuse existing keys so the rest of the code path remains unchanged
                    // Now map to 'partnostuds' when available; fallback to 'part'
                    geomNoStuds: chosenStaticGeom,
                    geomNoStudsShrunk: geomShrunk,
                    bboxNoStuds: chosenStaticGeom.boundingBox ? chosenStaticGeom.boundingBox.clone() : null,
                    geomConvex: geomConvex,
                });
            }
            loadedCount++;

            console.log(
                `Loaded piece ${pieceInfo.id}: ${pieceData.studs.length} studs, ${pieceData.antiStuds.length} anti-studs`
            );
        }

        console.log(`Successfully loaded ${loadedCount} pieces out of ${PIECE_LIST.length}`);
    } catch (error) {
        console.error('Error loading brick stud data from GLTF:', error);
        // Initialize empty data for all pieces if loading fails
        for (const pieceInfo of PIECE_LIST) {
            brickPiecesData.set(pieceInfo.id, { studs: [], antiStuds: [] });
        }
    }
}

function getQuaternionFromRotation(rotation) {
    // rotation can be:
    // - number (treated as yaw)
    // - { x, y, z } Euler angles in radians
    if (rotation == null) {
        return new THREE.Quaternion();
    }
    if (typeof rotation === 'number') {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, 0));
    }
    const rx = Number.isFinite(rotation.x) ? rotation.x : 0;
    const ry = Number.isFinite(rotation.y) ? rotation.y : 0;
    const rz = Number.isFinite(rotation.z) ? rotation.z : 0;
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
}

function getWorldAABBForPiece(pieceId, position, rotation) {
    const cache = pieceCollisionCache.get(pieceId);
    if (!cache) return null;
    const { bboxNoStuds } = cache;
    const box = bboxNoStuds.clone();
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
        return null;
    }
    const quat = getQuaternionFromRotation(rotation);
    const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x, position.y, position.z),
        quat,
        new THREE.Vector3(1, 1, 1)
    );
    return box.applyMatrix4(mat);
}

function aabbIntersects(a, b) {
    return (
        a.min.x <= b.max.x && a.max.x >= b.min.x &&
        a.min.y <= b.max.y && a.max.y >= b.min.y &&
        a.min.z <= b.max.z && a.max.z >= b.min.z
    );
}

function testGhostCollision(payload, gameState) {
    const { pieceId, position } = payload || {};
    if (!pieceId || !position) return false;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return false;

    const ghostCache = pieceCollisionCache.get(pieceId);
    if (!ghostCache) return true;
    // Use shrunk geometry for the ghost to tolerate touching-without-overlap
    const ghostGeom = ghostCache.geomNoStudsShrunk || ghostCache.geomNoStuds;

    const ghostAABB = getWorldAABBForPiece(pieceId, position, payload.rotation ?? payload.rotationY ?? 0);
    if (!ghostAABB) return false;
    const candidates = [];
    // Use world AABB BVH to collect overlapping bricks efficiently
    queryBVHForAABB(ghostAABB, (boxIndex) => {
        const brickId = worldCollision.owners[boxIndex];
        const brick = gameState.bricks && gameState.bricks[brickId];
        if (!brick) return;
        if (!pieceCollisionCache.get(brick.pieceId)) return;
        candidates.push(brick);
    });

    // Also block if ghost overlaps any player's capsule AABB
    if (gameState && gameState.players) {
        for (const player of Object.values(gameState.players)) {
            if (!player || !player.position) continue;
            const px = player.position.x;
            const py = player.position.y;
            const pz = player.position.z;
            const sy0 = py - CAPSULE_HALF_HEIGHT;
            const sy1 = py + CAPSULE_HALF_HEIGHT;
            const capsuleAABB = new THREE.Box3(
                new THREE.Vector3(px - CAPSULE_RADIUS, sy0 - CAPSULE_RADIUS, pz - CAPSULE_RADIUS),
                new THREE.Vector3(px + CAPSULE_RADIUS, sy1 + CAPSULE_RADIUS, pz + CAPSULE_RADIUS)
            );
            if (aabbIntersects(ghostAABB, capsuleAABB)) {
                return true;
            }
        }
    }

    if (candidates.length === 0) return false;

    const bvh = ghostGeom.boundsTree || new MeshBVH(ghostGeom);

    const candidateData = candidates.map((b) => {
        const cache = pieceCollisionCache.get(b.pieceId);
        const bRot = b.rotation || { x: 0, y: 0, z: 0 };
        const bQuat = getQuaternionFromRotation(bRot);
        const mat = new THREE.Matrix4().compose(
            new THREE.Vector3(b.position.x, b.position.y, b.position.z),
            bQuat,
            new THREE.Vector3(1, 1, 1)
        );
        // Use 'partnostuds' for existing bricks (geomNoStuds is mapped to partnostuds when available)
        const geom = cache.geomNoStuds;
        if (!geom.boundsTree) geom.computeBoundsTree();
        if (!geom.boundingBox) geom.computeBoundingBox();
        return { geometry: geom, matrixWorld: mat };
    });

    // Use a single precise intersection test with exported 'shrunk' geometry
    const gQuat = getQuaternionFromRotation(payload.rotation ?? payload.rotationY ?? 0);
    const ghostMat = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x, position.y, position.z),
        gQuat,
        new THREE.Vector3(1, 1, 1)
    );
    const ghostMatInv = new THREE.Matrix4().copy(ghostMat).invert();

    for (const c of candidateData) {
        const otherToGhostLocal = new THREE.Matrix4().multiplyMatrices(ghostMatInv, c.matrixWorld);
        const hit = bvh.intersectsGeometry(c.geometry, otherToGhostLocal);
        if (hit) {
            return true; // direct collision
        }
    }

    return false;
}

// Temp objects reused across calls to reduce allocations
const _tmpMat4 = new THREE.Matrix4();
const _tmpBox3 = new THREE.Box3();
const _tmpVec3a = new THREE.Vector3();
const _tmpVec3b = new THREE.Vector3();
const _tmpVec3c = new THREE.Vector3();
const _tmpVec3d = new THREE.Vector3();
const _tmpVec3e = new THREE.Vector3();
const _tmpVec3f = new THREE.Vector3();
const _tmpVec3g = new THREE.Vector3();
const _tmpVec3h = new THREE.Vector3();
const _tmpVec3i = new THREE.Vector3();
const _tmpVec3j = new THREE.Vector3();

function testGhostCollisionWithDebug(payload, gameState) {
    const { pieceId, position } = payload || {};
    let broadCount = 0;
    let prunedCount = 0;
    const t0 = process.hrtime.bigint();
    let tAabbEnd = t0;
    let tBroadEnd = t0;
    let tBuildEnd = t0;
    let tNarrowEnd = t0;
    if (!pieceId || !position) return { colliding: false, broadCount, prunedCount };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return { colliding: false, broadCount, prunedCount };

    const ghostCache = pieceCollisionCache.get(pieceId);
    if (!ghostCache) return { colliding: true, broadCount, prunedCount };
    const ghostGeom = ghostCache.geomNoStudsShrunk || ghostCache.geomNoStuds;
    if (!ghostGeom.boundingBox) ghostGeom.computeBoundingBox();

    const ghostAABB = getWorldAABBForPiece(pieceId, position, payload.rotation ?? payload.rotationY ?? 0);
    tAabbEnd = process.hrtime.bigint();
    if (!ghostAABB) return { colliding: false, broadCount, prunedCount };
    const candidates = [];
    queryBVHForAABB(ghostAABB, (boxIndex) => {
        const brickId = worldCollision.owners[boxIndex];
        const brick = gameState.bricks && gameState.bricks[brickId];
        if (!brick) return;
        if (!pieceCollisionCache.get(brick.pieceId)) return;
        candidates.push(brick);
    });
    broadCount = candidates.length | 0;
    tBroadEnd = process.hrtime.bigint();

    // Player capsule block (unchanged)
    if (gameState && gameState.players) {
        for (const player of Object.values(gameState.players)) {
            if (!player || !player.position) continue;
            const px = player.position.x;
            const py = player.position.y;
            const pz = player.position.z;
            const sy0 = py - CAPSULE_HALF_HEIGHT;
            const sy1 = py + CAPSULE_HALF_HEIGHT;
            const capsuleAABB = new THREE.Box3(
                new THREE.Vector3(px - CAPSULE_RADIUS, sy0 - CAPSULE_RADIUS, pz - CAPSULE_RADIUS),
                new THREE.Vector3(px + CAPSULE_RADIUS, sy1 + CAPSULE_RADIUS, pz + CAPSULE_RADIUS)
            );
            if (aabbIntersects(ghostAABB, capsuleAABB)) {
                return { colliding: true, broadCount, prunedCount };
            }
        }
    }

    if (candidates.length === 0) {
        const tEnd = process.hrtime.bigint();
        return { colliding: false, broadCount, prunedCount, timings: {
            aabbMs: Number(tAabbEnd - t0) / 1e6,
            broadMs: Number(tBroadEnd - tAabbEnd) / 1e6,
            buildMs: 0,
            narrowMs: 0,
            totalMs: Number(tEnd - t0) / 1e6,
        } };
    }

    const bvh = ghostGeom.boundsTree || new MeshBVH(ghostGeom);

    const candidateData = candidates.map((b) => {
        const cache = pieceCollisionCache.get(b.pieceId);
        const bRot = b.rotation || { x: 0, y: 0, z: 0 };
        const bQuat = getQuaternionFromRotation(bRot);
        const mat = new THREE.Matrix4().compose(
            new THREE.Vector3(b.position.x, b.position.y, b.position.z),
            bQuat,
            new THREE.Vector3(1, 1, 1)
        );
        const geom = cache.geomNoStuds;
        if (!geom.boundsTree) geom.computeBoundsTree();
        if (!geom.boundingBox) geom.computeBoundingBox();
        return { geometry: geom, matrixWorld: mat };
    });
    tBuildEnd = process.hrtime.bigint();

    const gQuat = getQuaternionFromRotation(payload.rotation ?? payload.rotationY ?? 0);
    const ghostMat = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x, position.y, position.z),
        gQuat,
        new THREE.Vector3(1, 1, 1)
    );
    const ghostMatInv = new THREE.Matrix4().copy(ghostMat).invert();

    // Ghost-local AABB for quick prune
    const ghostLocalAABB = ghostGeom.boundingBox;

    const tNarrowStart = process.hrtime.bigint();
    for (const c of candidateData) {
        const otherToGhostLocal = _tmpMat4.multiplyMatrices(ghostMatInv, c.matrixWorld);
        // Prune using transformed candidate AABB vs ghost-local AABB
        const candidateBoxGhostLocal = _tmpBox3.copy(c.geometry.boundingBox).applyMatrix4(otherToGhostLocal);
        if (!candidateBoxGhostLocal.intersectsBox(ghostLocalAABB)) {
            continue;
        }
        prunedCount++;
        const hit = bvh.intersectsGeometry(c.geometry, otherToGhostLocal);
        if (hit) {
            tNarrowEnd = process.hrtime.bigint();
            const tEnd = tNarrowEnd;
            return { colliding: true, broadCount, prunedCount, timings: {
                aabbMs: Number(tAabbEnd - t0) / 1e6,
                broadMs: Number(tBroadEnd - tAabbEnd) / 1e6,
                buildMs: Number(tBuildEnd - tBroadEnd) / 1e6,
                narrowMs: Number(tNarrowEnd - tNarrowStart) / 1e6,
                totalMs: Number(tEnd - t0) / 1e6,
            } };
        }
    }
    tNarrowEnd = process.hrtime.bigint();
    const tEnd = tNarrowEnd;
    return { colliding: false, broadCount, prunedCount, timings: {
        aabbMs: Number(tAabbEnd - t0) / 1e6,
        broadMs: Number(tBroadEnd - tAabbEnd) / 1e6,
        buildMs: Number(tBuildEnd - tBroadEnd) / 1e6,
        narrowMs: Number(tNarrowEnd - tNarrowStart) / 1e6,
        totalMs: Number(tEnd - t0) / 1e6,
    } };
}

// -------------------- Player Capsule vs World AABB BVH --------------------

// Simple AABB BVH structure over brick bounding boxes
const worldCollision = {
    nodes: [], // array of { box: THREE.Box3, left: number, right: number, start: number, count: number }
    indices: [], // indices into boxes array
    boxes: [], // array of THREE.Box3 for each brick
    owners: [], // parallel to boxes; store brick ids
    root: -1,
    leafSize: 8,
};

function buildAABBForRange(indices, boxes) {
    const box = new THREE.Box3();
    if (indices.length === 0) return box;
    box.copy(boxes[indices[0]]);
    for (let i = 1; i < indices.length; i++) {
        box.union(boxes[indices[i]]);
    }
    return box;
}

function buildBVHRecursive(indices, boxes, nodes, leafSize) {
    if (indices.length === 0) return -1;

    const nodeBox = buildAABBForRange(indices, boxes);
    const nodeIndex = nodes.length;
    const node = { box: nodeBox, left: -1, right: -1, start: -1, count: -1 };
    nodes.push(node);

    if (indices.length <= leafSize) {
        node.start = worldCollision.indices.length;
        node.count = indices.length;
        for (const idx of indices) worldCollision.indices.push(idx);
        return nodeIndex;
    }

    // Split along the largest axis of the node box
    const extents = new THREE.Vector3().subVectors(nodeBox.max, nodeBox.min);
    let axis = 0; // 0=x,1=y,2=z
    if (extents.y > extents.x && extents.y >= extents.z) axis = 1;
    else if (extents.z > extents.x && extents.z >= extents.y) axis = 2;

    indices.sort((a, b) => {
        const ca = boxes[a].min[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] + boxes[a].max[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'];
        const cb = boxes[b].min[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] + boxes[b].max[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'];
        return ca - cb;
    });

    const mid = Math.floor(indices.length / 2);
    const leftIndices = indices.slice(0, mid);
    const rightIndices = indices.slice(mid);

    node.left = buildBVHRecursive(leftIndices, boxes, nodes, leafSize);
    node.right = buildBVHRecursive(rightIndices, boxes, nodes, leafSize);
    return nodeIndex;
}

function rebuildWorldBVH(gameState) {
    worldCollision.nodes = [];
    worldCollision.indices = [];
    worldCollision.boxes = [];
    worldCollision.owners = [];
    worldCollision.root = -1;

    const entries = Object.values(gameState.bricks || {});
    for (const brick of entries) {
        const box = getWorldAABBForPiece(brick.pieceId, brick.position, brick.rotation || 0);
        if (!box) continue;
        worldCollision.boxes.push(box.clone());
        worldCollision.owners.push(brick.id);
    }

    const allIndices = worldCollision.boxes.map((_, i) => i);
    worldCollision.root = buildBVHRecursive(allIndices, worldCollision.boxes, worldCollision.nodes, worldCollision.leafSize);
}

function queryBVHForAABB(aabb, callback) {
    if (worldCollision.root === -1) return;
    const stack = [worldCollision.root];
    while (stack.length) {
        const nodeIndex = stack.pop();
        const node = worldCollision.nodes[nodeIndex];
        if (!node) continue;
        if (!aabbIntersects(aabb, node.box)) continue;
        if (node.count >= 0) {
            for (let i = 0; i < node.count; i++) {
                const boxIndex = worldCollision.indices[node.start + i];
                const box = worldCollision.boxes[boxIndex];
                if (aabbIntersects(aabb, box)) {
                    callback(boxIndex, box);
                }
            }
        } else {
            if (node.left !== -1) stack.push(node.left);
            if (node.right !== -1) stack.push(node.right);
        }
    }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

const CAPSULE_RADIUS = 24; // tune to feel good with your scale
const CAPSULE_HALF_HEIGHT = 28; // distance from center to cap center (vertical)

// Narrow-phase helper: capsule (vertical segment) vs convex mesh using BVH shapecast
const _capsuleNarrowTmp = {
    p0Local: new THREE.Vector3(),
    p1Local: new THREE.Vector3(),
    segDir: new THREE.Vector3(),
    triA: new THREE.Vector3(),
    triB: new THREE.Vector3(),
    triC: new THREE.Vector3(),
    closestSeg: new THREE.Vector3(),
    closestTri: new THREE.Vector3(),
    matInv: new THREE.Matrix4(),
    normMat3: new THREE.Matrix3(),
    normalWorld: new THREE.Vector3(),
};

function segmentIntersectsAABBInflated(p0, p1, box, radius) {
    // Slab test against box expanded by radius
    const min = _tmpVec3a.copy(box.min).addScalar(-radius);
    const max = _tmpVec3b.copy(box.max).addScalar(radius);
    const dir = _tmpVec3c.subVectors(p1, p0);
    let tmin = 0;
    let tmax = 1;
    for (let i = 0; i < 3; i++) {
        const axis = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
        const p = p0[axis];
        const d = dir[axis];
        let t1, t2;
        if (Math.abs(d) < 1e-8) {
            if (p < min[axis] || p > max[axis]) return false;
            continue;
        }
        t1 = (min[axis] - p) / d;
        t2 = (max[axis] - p) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
    }
    return tmax >= 0 && tmin <= 1;
}

function closestPointsSegmentSegment(p1, q1, p2, q2, outP, outQ) {
    // Returns closest points on two segments and stores into outP/outQ
    const d1 = _tmpVec3a.subVectors(q1, p1); // direction of segment S1
    const d2 = _tmpVec3b.subVectors(q2, p2); // direction of segment S2
    const r = _tmpVec3c.subVectors(p1, p2);
    const a = d1.dot(d1); // squared length of segment S1
    const e = d2.dot(d2); // squared length of segment S2
    const f = d2.dot(r);
    let s, t;
    const EPS = 1e-8;
    if (a <= EPS && e <= EPS) {
        outP.copy(p1);
        outQ.copy(p2);
        return outP.distanceToSquared(outQ);
    }
    if (a <= EPS) {
        s = 0;
        t = clamp(f / e, 0, 1);
    } else {
        const c = d1.dot(r);
        if (e <= EPS) {
            t = 0;
            s = clamp(-c / a, 0, 1);
        } else {
            const b = d1.dot(d2);
            const denom = a * e - b * b;
            if (denom !== 0) s = clamp((b * f - c * e) / denom, 0, 1); else s = 0;
            const tnom = b * s + f;
            if (tnom < 0) {
                t = 0; s = clamp(-c / a, 0, 1);
            } else if (tnom > e) {
                t = 1; s = clamp((b - c) / a, 0, 1);
            } else {
                t = tnom / e;
            }
        }
    }
    outP.copy(d1).multiplyScalar(s).add(p1);
    outQ.copy(d2).multiplyScalar(t).add(p2);
    return outP.distanceToSquared(outQ);
}

function pointInTriangle(p, a, b, c) {
    const v0 = _tmpVec3a.subVectors(c, a);
    const v1 = _tmpVec3b.subVectors(b, a);
    const v2 = _tmpVec3c.subVectors(p, a);
    const dot00 = v0.dot(v0);
    const dot01 = v0.dot(v1);
    const dot02 = v0.dot(v2);
    const dot11 = v1.dot(v1);
    const dot12 = v1.dot(v2);
    const invDenom = 1 / Math.max(1e-12, (dot00 * dot11 - dot01 * dot01));
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return u >= 0 && v >= 0 && (u + v) <= 1;
}

function distSqSegmentTriangle(p0, p1, a, b, c, outClosestSeg, outClosestTri) {
    // Compute squared distance between segment [p0,p1] and triangle (a,b,c). Returns dist2 and fills closest points
    let bestDist2 = Infinity;
    // Edge tests: segment vs triangle edges
    const distAB = closestPointsSegmentSegment(p0, p1, a, b, outClosestSeg, outClosestTri);
    if (distAB < bestDist2) bestDist2 = distAB;
    const distBC = closestPointsSegmentSegment(p0, p1, b, c, outClosestSeg, outClosestTri);
    if (distBC < bestDist2) bestDist2 = distBC;
    const distCA = closestPointsSegmentSegment(p0, p1, c, a, outClosestSeg, outClosestTri);
    if (distCA < bestDist2) bestDist2 = distCA;
    // Interior test: segment projection onto triangle plane
    const n = _tmpVec3d.subVectors(b, a).cross(_tmpVec3e.subVectors(c, a));
    const nLen = n.length();
    if (nLen > 1e-8) {
        n.multiplyScalar(1 / nLen);
        const u = _tmpVec3f.subVectors(p1, p0);
        const w0 = _tmpVec3g.subVectors(p0, a);
        const denom = n.dot(u);
        // s that minimizes distance to plane along segment
        let s = -n.dot(w0) / (Math.abs(denom) > 1e-8 ? denom : 1e-8);
        s = clamp(s, 0, 1);
        const p = _tmpVec3h.copy(u).multiplyScalar(s).add(p0);
        const proj = _tmpVec3i.copy(p).addScaledVector(n, -n.dot(_tmpVec3j.subVectors(p, a)));
        if (pointInTriangle(proj, a, b, c)) {
            const d = Math.abs(n.dot(_tmpVec3j.subVectors(p, a)));
            const d2 = d * d;
            if (d2 < bestDist2) {
                bestDist2 = d2;
                outClosestSeg.copy(p);
                outClosestTri.copy(proj);
            }
        }
    }
    return bestDist2;
}

function narrowPhaseCapsuleVsConvex(geometry, matrixWorld, p0World, p1World, radius) {
    if (!geometry || !geometry.boundsTree) return null;
    const best = { penetration: -Infinity, nx: 0, ny: 0, nz: 0 };
    _capsuleNarrowTmp.matInv.copy(matrixWorld).invert();
    _capsuleNarrowTmp.normMat3.getNormalMatrix(matrixWorld);
    _capsuleNarrowTmp.p0Local.copy(p0World).applyMatrix4(_capsuleNarrowTmp.matInv);
    _capsuleNarrowTmp.p1Local.copy(p1World).applyMatrix4(_capsuleNarrowTmp.matInv);
    const r2 = radius * radius;
    geometry.boundsTree.shapecast({
        intersectsBounds: (box) => {
            return segmentIntersectsAABBInflated(_capsuleNarrowTmp.p0Local, _capsuleNarrowTmp.p1Local, box, radius);
        },
        intersectsTriangle: (tri) => {
            _capsuleNarrowTmp.triA.copy(tri.a);
            _capsuleNarrowTmp.triB.copy(tri.b);
            _capsuleNarrowTmp.triC.copy(tri.c);
            const dist2 = distSqSegmentTriangle(
                _capsuleNarrowTmp.p0Local,
                _capsuleNarrowTmp.p1Local,
                _capsuleNarrowTmp.triA,
                _capsuleNarrowTmp.triB,
                _capsuleNarrowTmp.triC,
                _capsuleNarrowTmp.closestSeg,
                _capsuleNarrowTmp.closestTri
            );
            if (dist2 <= r2) {
                // Normal from triangle closest point to segment closest point in WORLD space
                _capsuleNarrowTmp.normalWorld.copy(_capsuleNarrowTmp.closestSeg).sub(_capsuleNarrowTmp.closestTri);
                // Transform normal to world (triangle is local)
                _capsuleNarrowTmp.normalWorld.applyMatrix3(_capsuleNarrowTmp.normMat3).normalize();
                const penetration = radius - Math.sqrt(Math.max(0, dist2));
                if (penetration > best.penetration) {
                    best.penetration = penetration;
                    best.nx = _capsuleNarrowTmp.normalWorld.x;
                    best.ny = _capsuleNarrowTmp.normalWorld.y;
                    best.nz = _capsuleNarrowTmp.normalWorld.z;
                }
                return true; // we have a hit on this triangle; continue traversal
            }
            return false;
        },
    });
    return best.penetration > 0 ? best : null;
}

function resolvePlayerCapsuleCollision(gameState, player, iterations = 3) {
    // player: { position: {x,y,z}, velocity: {x,y,z} }
    if (worldCollision.root === -1) return; // nothing to collide with

    const pos = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
    const vel = new THREE.Vector3(player.velocity.x, player.velocity.y, player.velocity.z);
    let grounded = false;

    for (let iter = 0; iter < iterations; iter++) {
        // Capsule vertical segment [sy0, sy1] at (pos.x, pos.z)
        const sy0 = pos.y - CAPSULE_HALF_HEIGHT;
        const sy1 = pos.y + CAPSULE_HALF_HEIGHT;
        const capsuleAABB = new THREE.Box3(
            new THREE.Vector3(pos.x - CAPSULE_RADIUS, sy0 - CAPSULE_RADIUS, pos.z - CAPSULE_RADIUS),
            new THREE.Vector3(pos.x + CAPSULE_RADIUS, sy1 + CAPSULE_RADIUS, pos.z + CAPSULE_RADIUS)
        );

        const candidates = [];
        queryBVHForAABB(capsuleAABB, (idx, box) => {
            // Broad-phase: capsule line vs AABB quick overlap test
            const px = pos.x;
            const pz = pos.z;
            const qx = clamp(px, box.min.x, box.max.x);
            const qz = clamp(pz, box.min.z, box.max.z);
            const qyBox = clamp(pos.y, box.min.y, box.max.y);
            const qySeg = clamp(qyBox, sy0, sy1);
            const dx = px - qx;
            const dy = qySeg - qyBox;
            const dz = pz - qz;
            const distSq = dx*dx + dy*dy + dz*dz;
            const r = CAPSULE_RADIUS;
            if (distSq < r*r) {
                const dist = Math.sqrt(Math.max(1e-12, distSq));
                const nx = dist > 1e-6 ? dx / dist : 0;
                const ny = dist > 1e-6 ? dy / dist : 1;
                const nz = dist > 1e-6 ? dz / dist : 0;
                const penetration = r - dist;
                const brickId = worldCollision.owners[idx];
                const brick = gameState && gameState.bricks ? gameState.bricks[brickId] : null;
                candidates.push({ idx, box, brick, corr: { nx, ny, nz, penetration } });
            }
        });

        if (candidates.length === 0) break;

        // Narrow-phase: capsule vs convex mesh per candidate; reject false positives
        const p0 = new THREE.Vector3(pos.x, sy0, pos.z);
        const p1 = new THREE.Vector3(pos.x, sy1, pos.z);
        for (const c of candidates) {
            const cache = pieceCollisionCache.get(c.brick.pieceId);
            const convexGeom = cache.geomConvex; // assume convex always exists
            if (!convexGeom.boundsTree) convexGeom.computeBoundsTree();
            const bRot = c.brick.rotation || { x: 0, y: 0, z: 0 };
            const bQuat = getQuaternionFromRotation(bRot);
            const mat = new THREE.Matrix4().compose(
                new THREE.Vector3(c.brick.position.x, c.brick.position.y, c.brick.position.z),
                bQuat,
                new THREE.Vector3(1, 1, 1)
            );
            const narrow = narrowPhaseCapsuleVsConvex(convexGeom, mat, p0, p1, CAPSULE_RADIUS);
            if (narrow && narrow.penetration > 0) {
                c.corr = narrow;
            } else {
                c.reject = true;
            }
        }

        const corrections = candidates.filter(c => !c.reject).map(c => c.corr);
        if (corrections.length === 0) break;

        // Apply the largest penetration first
        corrections.sort((a, b) => b.penetration - a.penetration);
        const corr = corrections[0];
        pos.x += corr.nx * corr.penetration;
        pos.y += corr.ny * corr.penetration;
        pos.z += corr.nz * corr.penetration;

        // Slide velocity: remove component into the normal
        const vn = vel.x * corr.nx + vel.y * corr.ny + vel.z * corr.nz;
        if (vn < 0) {
            vel.x -= vn * corr.nx;
            vel.y -= vn * corr.ny;
            vel.z -= vn * corr.nz;
        }

        // Consider grounded if we were pushed out along a mostly-upward normal
        // and we were moving downwards or very slowly vertically
        if (corr.ny > 0.5 && player.velocity.y <= 0) {
            grounded = true;
        }
    }

    // Write back
    player.position.x = pos.x;
    player.position.y = pos.y;
    player.position.z = pos.z;
    player.velocity.x = vel.x;
    player.velocity.y = vel.y;
    player.velocity.z = vel.z;
    player.grounded = grounded;
}

module.exports = {
    PIECE_LIST,
    brickPiecesData,
    loadBrickStudData,
    testGhostCollision,
    testGhostCollisionWithDebug,
    getWorldAABBForPiece,
    rebuildWorldBVH,
    resolvePlayerCapsuleCollision,
};


