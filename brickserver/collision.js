const path = require('path');
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const THREE = require('three');
const { MeshBVH } = require('three-mesh-bvh');

// Brick stud data from GLTF - will store data for all pieces
const brickPiecesData = new Map(); // pieceId -> { studs: [], antiStuds: [] }
const pieceCollisionCache = new Map(); // pieceId -> { geomNoStuds, geomNoStudsShrunk, bboxNoStuds }

// Load piece list from exported_pieces.csv
function loadPieceListFromCSV() {
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
}

const PIECE_LIST = loadPieceListFromCSV();

// Helper to load geometry from a GLTF node
function loadGeometryFromNode(node) {
    if (!node) return null;
    
    const mesh = node.getMesh();
    if (!mesh) return null;
    
    const prim = mesh.listPrimitives()[0];
    if (!prim) return null;
    
    const posAcc = prim.getAttribute('POSITION');
    if (!posAcc) return null;
    
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
    
    // Bake node's local transform into geometry
    const t = node.getTranslation() || [0, 0, 0];
    const r = node.getRotation() || [0, 0, 0, 1];
    const s = node.getScale() || [1, 1, 1];
    const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(t[0], t[1], t[2]),
        new THREE.Quaternion(r[0], r[1], r[2], r[3]),
        new THREE.Vector3(s[0], s[1], s[2])
    );
    geometry.applyMatrix4(mat);
    
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundsTree();
    
    return geometry;
}

// Load brick stud data AND partnostuds geometry from GLTF file for all pieces
async function loadBrickStudData() {
    const gltfPath = path.join(__dirname, '..', 'public', 'apps', 'bricks', 'all_pieces.gltf');
    const io = new NodeIO();
    const document = await io.read(gltfPath);

    // Find the root node that contains the LEGO parts library
    const rootNode = document.getRoot().listNodes().find((node) => node.getName() === 'LegoPartsLibrary');
    if (!rootNode) {
        throw new Error('LegoPartsLibrary not found in GLTF');
    }

    let loadedCount = 0;
    for (const pieceInfo of PIECE_LIST) {
        const piece = rootNode.listChildren().find((child) => child.getName() === pieceInfo.id);
        if (!piece) {
            console.warn(`Piece ${pieceInfo.id} not found in GLTF`);
            continue;
        }

        // Extract stud data from extras
        const extras = piece.getExtras() || {};
        brickPiecesData.set(pieceInfo.id, {
            studs: extras.studs || [],
            antiStuds: extras.antiStuds || [],
        });

        // Extract geometries for collision
        const partNoStudsNode = piece.listChildren().find((child) => child.getName() === 'partnostuds');
        const shrunkNode = piece.listChildren().find((child) => child.getName() === 'shrunk');
        const convexNode = piece.listChildren().find((child) => child.getName() === 'convex');

        // Load geometries - skip piece if partnostuds is missing
        const geomPartNoStuds = loadGeometryFromNode(partNoStudsNode);
        if (!geomPartNoStuds) {
            console.warn(`partnostuds missing for piece ${pieceInfo.id}, skipping`);
            continue;
        }
        
        const geomShrunk = loadGeometryFromNode(shrunkNode); // Optional
        const geomConvex = loadGeometryFromNode(convexNode);
        if (!geomConvex) {
            console.warn(`convex missing for piece ${pieceInfo.id}, skipping`);
            continue;
        }

        // Store in cache
        pieceCollisionCache.set(pieceInfo.id, {
            geomNoStuds: geomPartNoStuds,
            geomNoStudsShrunk: geomShrunk, // May be null
            bboxNoStuds: geomPartNoStuds.boundingBox.clone(),
            geomConvex: geomConvex,
        });
        
        loadedCount++;
    }

    console.log(`Successfully loaded ${loadedCount} pieces out of ${PIECE_LIST.length}`);
}

function getQuaternionFromRotation(rotation) {
    if (!rotation) {
        return new THREE.Quaternion();
    }
    if (typeof rotation === 'number') {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, 0));
    }
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
        rotation.x || 0,
        rotation.y || 0, 
        rotation.z || 0
    ));
}

function getWorldAABBForPiece(pieceId, position, rotation) {
    const cache = pieceCollisionCache.get(pieceId);
    if (!cache || !position) return null;
    
    const box = cache.bboxNoStuds.clone();
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

// Removed: testGhostCollision (use testGhostCollisionWithDebug instead)

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
    
    if (!pieceId || !position) {
        return { colliding: false, broadCount, prunedCount };
    }

    const ghostCache = pieceCollisionCache.get(pieceId);
    if (!ghostCache) return { colliding: true, broadCount, prunedCount };
    const ghostGeom = ghostCache.geomNoStudsShrunk || ghostCache.geomNoStuds;
    if (!ghostGeom.boundingBox) ghostGeom.computeBoundingBox();

    const ghostAABB = getWorldAABBForPiece(pieceId, position, payload.rotation ?? payload.rotationY ?? 0);
    tAabbEnd = process.hrtime.bigint();
    if (!ghostAABB) return { colliding: false, broadCount, prunedCount };
    const candidates = [];
    queryBVHForAABB(ghostAABB, (boxIndex, _box, brickId, chunkKey) => {
        // Try to get brick from the chunk indicated by BVH
        let brick = gameState?.chunks?.[chunkKey]?.bricks?.[brickId];
        
        // Fallback: use brickIndex if chunk lookup fails (shouldn't happen normally)
        if (!brick && gameState?.brickIndex?.[brickId]) {
            const key = gameState.brickIndex[brickId];
            brick = gameState?.chunks?.[key]?.bricks?.[brickId];
        }
        
        if (!brick || !pieceCollisionCache.get(brick.pieceId)) return;
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
        // Check if we are testing 2 pieces that are the same in the same place.
        // That can miss the triangle intersection test.
        // Heuristic fallback: sizes ~equal (<=1%) and centers ~equal (<=0.1)
        try {
            const candWorldBox = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld);
            const gSize = new THREE.Vector3().subVectors(ghostAABB.max, ghostAABB.min);
            const cSize = new THREE.Vector3().subVectors(candWorldBox.max, candWorldBox.min);
            const gCenter = new THREE.Vector3().addVectors(ghostAABB.min, ghostAABB.max).multiplyScalar(0.5);
            const cCenter = new THREE.Vector3().addVectors(candWorldBox.min, candWorldBox.max).multiplyScalar(0.5);
            const rel = (a, b) => Math.abs(a - b) / Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)));
            const dimsClose = (rel(gSize.x, cSize.x) < 0.01) && (rel(gSize.y, cSize.y) < 0.01) && (rel(gSize.z, cSize.z) < 0.01);
            const centerClose = (Math.abs(gCenter.x - cCenter.x) < 0.1) && (Math.abs(gCenter.y - cCenter.y) < 0.1) && (Math.abs(gCenter.z - cCenter.z) < 0.1);
            if (dimsClose && centerClose) {
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
        } catch (_) {}
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

// -------------------- Player Capsule vs Chunked World AABB BVH --------------------

// Chunked broadphase: each brick is inserted into exactly one chunk (by AABB center).
// Neighboring chunks are considered automatically during queries.

const CHUNK_SIZE_XZ = 640; // world units along X and Z
const CHUNK_SIZE_Y = 768;  // world units along Y

function getChunkCoordForPoint(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE_XZ);
    const cy = Math.floor(y / CHUNK_SIZE_Y);
    const cz = Math.floor(z / CHUNK_SIZE_XZ);
    return { cx, cy, cz };
}

function getChunkKey(cx, cy, cz) {
    return cx + ',' + cy + ',' + cz;
}

function getChunkAABB(cx, cy, cz) {
    const min = new THREE.Vector3(
        cx * CHUNK_SIZE_XZ,
        cy * CHUNK_SIZE_Y,
        cz * CHUNK_SIZE_XZ
    );
    const max = new THREE.Vector3(
        (cx + 1) * CHUNK_SIZE_XZ,
        (cy + 1) * CHUNK_SIZE_Y,
        (cz + 1) * CHUNK_SIZE_XZ
    );
    return new THREE.Box3(min, max);
}

function createEmptyChunk(cx, cy, cz) {
    return {
        key: getChunkKey(cx, cy, cz),
        cx, cy, cz,
        bounds: getChunkAABB(cx, cy, cz),
        nodes: [],
        indices: [],
        boxes: [],
        owners: [], // brick ids parallel to boxes
        root: -1,
        leafSize: 8,
    };
}

const chunkCollision = {
    chunks: new Map(), // key -> chunk
    totalBoxes: 0,
};

function ensureChunk(cx, cy, cz) {
    const key = getChunkKey(cx, cy, cz);
    let chunk = chunkCollision.chunks.get(key);
    if (!chunk) {
        chunk = createEmptyChunk(cx, cy, cz);
        chunkCollision.chunks.set(key, chunk);
    }
    return chunk;
}

function rebuildChunkBVH(chunk) {
    chunk.nodes = [];
    chunk.indices = [];
    chunk.root = -1;
    if (chunk.boxes.length > 0) {
        const all = chunk.boxes.map((_, i) => i);
        chunk.root = buildBVHRecursive(all, chunk.boxes, chunk.nodes, chunk.indices, chunk.leafSize);
    }
}

function buildAABBForRange(indices, boxes) {
    const box = new THREE.Box3();
    if (indices.length === 0) return box;
    box.copy(boxes[indices[0]]);
    for (let i = 1; i < indices.length; i++) {
        box.union(boxes[indices[i]]);
    }
    return box;
}

// Generic BVH builder for an arbitrary set of arrays (no globals)
function buildBVHRecursive(indices, boxes, nodes, indicesOut, leafSize) {
    if (indices.length === 0) return -1;

    const nodeBox = buildAABBForRange(indices, boxes);
    const nodeIndex = nodes.length;
    const node = { box: nodeBox, left: -1, right: -1, start: -1, count: -1 };
    nodes.push(node);

    if (indices.length <= leafSize) {
        node.start = indicesOut.length;
        node.count = indices.length;
        for (const idx of indices) indicesOut.push(idx);
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

    node.left = buildBVHRecursive(leftIndices, boxes, nodes, indicesOut, leafSize);
    node.right = buildBVHRecursive(rightIndices, boxes, nodes, indicesOut, leafSize);
    return nodeIndex;
}

function rebuildWorldBVH(gameState) {
    // Reset chunk store
    chunkCollision.chunks.clear();
    chunkCollision.totalBoxes = 0;
    if (!gameState.chunks || typeof gameState.chunks !== 'object') gameState.chunks = {};
    // Walk existing chunk-nested bricks and rebuild BVHs
    for (const [key, c] of Object.entries(gameState.chunks)) {
        const cx = Number.isFinite(c.cx) ? (c.cx|0) : 0;
        const cy = Number.isFinite(c.cy) ? (c.cy|0) : 0;
        const cz = Number.isFinite(c.cz) ? (c.cz|0) : 0;
        const chunk = ensureChunk(cx, cy, cz);
        const bricksMap = (c && c.bricks && typeof c.bricks === 'object') ? c.bricks : {};
        for (const brick of Object.values(bricksMap)) {
            const box = getWorldAABBForPiece(brick.pieceId, brick.position, brick.rotation || 0);
            if (!box) continue;
            chunk.boxes.push(box.clone());
            chunk.owners.push(brick.id);
            if (!brick.chunkKey) brick.chunkKey = key;
        }
    }
    for (const chunk of chunkCollision.chunks.values()) {
        rebuildChunkBVH(chunk);
        chunkCollision.totalBoxes += chunk.boxes.length;
        // Ensure presence map in gameState
        const key = chunk.key;
        const existing = gameState.chunks[key] || { cx: chunk.cx|0, cy: chunk.cy|0, cz: chunk.cz|0, bricks: {} };
        if (existing.cx !== (chunk.cx|0) || existing.cy !== (chunk.cy|0) || existing.cz !== (chunk.cz|0)) {
            gameState.chunks[key] = { ...existing, cx: chunk.cx|0, cy: chunk.cy|0, cz: chunk.cz|0 };
        }
    }
}

function queryBVHForAABB(aabb, callback) {
    if (chunkCollision.totalBoxes === 0) return;
    // Determine overlapped chunk coords
    let minCX = Math.floor(aabb.min.x / CHUNK_SIZE_XZ);
    let maxCX = Math.floor((aabb.max.x - 1e-6) / CHUNK_SIZE_XZ);
    let minCY = Math.floor(aabb.min.y / CHUNK_SIZE_Y);
    let maxCY = Math.floor((aabb.max.y - 1e-6) / CHUNK_SIZE_Y);
    let minCZ = Math.floor(aabb.min.z / CHUNK_SIZE_XZ);
    let maxCZ = Math.floor((aabb.max.z - 1e-6) / CHUNK_SIZE_XZ);

    // Expand per-axis only if the query AABB comes within the global max half-extent
    // of a chunk boundary, to capture single-home bricks overhanging borders.
    // Expand using half of X chunk size as overhang threshold for all axes.
    const halfX = CHUNK_SIZE_XZ * 0.5;
    // Left distances to current cell boundaries
    const leftBoundaryX = minCX * CHUNK_SIZE_XZ;
    const leftBoundaryY = minCY * CHUNK_SIZE_Y;
    const leftBoundaryZ = minCZ * CHUNK_SIZE_XZ;
    if ((aabb.min.x - leftBoundaryX) < halfX) minCX -= 1;
    if ((aabb.min.y - leftBoundaryY) < halfX) minCY -= 1;
    if ((aabb.min.z - leftBoundaryZ) < halfX) minCZ -= 1;
    // Right distances to next cell boundaries
    const rightBoundaryX = (maxCX + 1) * CHUNK_SIZE_XZ;
    const rightBoundaryY = (maxCY + 1) * CHUNK_SIZE_Y;
    const rightBoundaryZ = (maxCZ + 1) * CHUNK_SIZE_XZ;
    if ((rightBoundaryX - aabb.max.x) < halfX) maxCX += 1;
    if ((rightBoundaryY - aabb.max.y) < halfX) maxCY += 1;
    if ((rightBoundaryZ - aabb.max.z) < halfX) maxCZ += 1;

    for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const key = getChunkKey(cx, cy, cz);
                const chunk = chunkCollision.chunks.get(key);
                if (!chunk || chunk.root === -1) continue;

                const stack = [chunk.root];
                while (stack.length) {
                    const nodeIndex = stack.pop();
                    const node = chunk.nodes[nodeIndex];
                    if (!node) continue;
                    if (!aabbIntersects(aabb, node.box)) continue;
                    if (node.count >= 0) {
                        for (let i = 0; i < node.count; i++) {
                            const boxIndex = chunk.indices[node.start + i];
                            const box = chunk.boxes[boxIndex];
                            if (aabbIntersects(aabb, box)) {
                                callback(boxIndex, box, chunk.owners[boxIndex], chunk.key);
                            }
                        }
                    } else {
                        if (node.left !== -1) stack.push(node.left);
                        if (node.right !== -1) stack.push(node.right);
                    }
                }
            }
        }
    }
}

function addBrickToCollision(gameState, brick) {
    if (!brick || !brick.id || !brick.position || !brick.pieceId) return;
    const box = getWorldAABBForPiece(brick.pieceId, brick.position, brick.rotation || 0);
    if (!box) return;
    const center = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
    const { cx, cy, cz } = getChunkCoordForPoint(center.x, center.y, center.z);
    const chunk = ensureChunk(cx, cy, cz);
    const key = chunk.key;
    chunk.boxes.push(box.clone());
    chunk.owners.push(brick.id);
    rebuildChunkBVH(chunk);
    chunkCollision.totalBoxes++;
    // Update authoritative maps
    brick.chunkKey = key;
    if (!gameState.chunks) gameState.chunks = {};
    if (!gameState.chunks[key]) {
        gameState.chunks[key] = { cx, cy, cz };
    }
}

function addBricksToCollisionChunk(gameState, bricks) {
    if (!Array.isArray(bricks) || bricks.length === 0) return;

    // Bucket bricks by authoritative chunk key derived from each brick's AABB center
    const buckets = new Map(); // key -> { cx, cy, cz, boxes: [], owners: [], bricks: [] }

    for (const brick of bricks) {
        const box = getWorldAABBForPiece(brick.pieceId, brick.position, brick.rotation);
        if (!box) continue;
        const center = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
        const coords = getChunkCoordForPoint(center.x, center.y, center.z);
        const key = getChunkKey(coords.cx, coords.cy, coords.cz);
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { cx: coords.cx|0, cy: coords.cy|0, cz: coords.cz|0, boxes: [], owners: [], bricks: [] };
            buckets.set(key, bucket);
        }
        bucket.boxes.push(box.clone());
        bucket.owners.push(brick.id);
        bucket.bricks.push(brick);
    }

    if (buckets.size === 0) return;

    if (!gameState.chunks) gameState.chunks = {};
    if (!gameState.brickIndex) gameState.brickIndex = {};

    for (const [key, bucket] of buckets.entries()) {
        const { cx, cy, cz } = bucket;
        const chunk = ensureChunk(cx, cy, cz);
        for (let i = 0; i < bucket.boxes.length; i++) {
            chunk.boxes.push(bucket.boxes[i]);
            chunk.owners.push(bucket.owners[i]);
        }
        rebuildChunkBVH(chunk);
        chunkCollision.totalBoxes += bucket.boxes.length;

        if (!gameState.chunks[key]) gameState.chunks[key] = { cx, cy, cz, bricks: {} };
        const bricksMap = gameState.chunks[key].bricks || (gameState.chunks[key].bricks = {});
        for (const brick of bucket.bricks) {
            brick.chunkKey = key;
            bricksMap[brick.id] = brick;
            gameState.brickIndex[brick.id] = key;
        }
    }
}

function removeBrickFromCollision(gameState, brick) {
    if (!brick || !brick.id) return;
    const key = brick.chunkKey;
    if (!key) return;
    const chunk = chunkCollision.chunks.get(key);
    if (!chunk) return;
    const idx = chunk.owners.indexOf(brick.id);
    if (idx === -1) return;
    chunk.owners.splice(idx, 1);
    chunk.boxes.splice(idx, 1);
    chunkCollision.totalBoxes = Math.max(0, chunkCollision.totalBoxes - 1);
    if (chunk.boxes.length === 0) {
        chunkCollision.chunks.delete(key);
    } else {
        rebuildChunkBVH(chunk);
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
                return false; // record hit but continue traversal to find deepest contact
            }
            return false;
        },
    });
    return best.penetration > 0 ? best : null;
}

function resolvePlayerCapsuleCollision(gameState, player, iterations = 3) {
    // player: { position: {x,y,z}, velocity: {x,y,z} }
    if (chunkCollision.totalBoxes === 0) return; // nothing to collide with

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
        queryBVHForAABB(capsuleAABB, (idx, box, brickId, chunkKey) => {
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
                let nx, ny, nz, penetration;
                if (dist > 1e-6) {
                    // Use gradient direction when meaningful
                    nx = dx / dist;
                    ny = dy / dist;
                    nz = dz / dist;
                    penetration = r - dist;
                } else {
                    // Degenerate case: center is essentially on the expanded box. Choose axis-aligned MTV.
                    const minX = box.min.x - r, maxX = box.max.x + r;
                    const minY = box.min.y - r, maxY = box.max.y + r;
                    const minZ = box.min.z - r, maxZ = box.max.z + r;
                    const dMinX = Math.abs(px - minX), dMaxX = Math.abs(maxX - px);
                    const dMinY = Math.abs(pos.y - minY), dMaxY = Math.abs(maxY - pos.y);
                    const dMinZ = Math.abs(pz - minZ), dMaxZ = Math.abs(maxZ - pz);
                    // Find smallest move to exit the expanded box
                    let best = dMinX; nx = -1; ny = 0; nz = 0; penetration = dMinX;
                    if (dMaxX < best) { best = dMaxX; nx = 1; ny = 0; nz = 0; penetration = dMaxX; }
                    if (dMinY < best) { best = dMinY; nx = 0; ny = -1; nz = 0; penetration = dMinY; }
                    if (dMaxY < best) { best = dMaxY; nx = 0; ny = 1; nz = 0; penetration = dMaxY; }
                    if (dMinZ < best) { best = dMinZ; nx = 0; ny = 0; nz = -1; penetration = dMinZ; }
                    if (dMaxZ < best) { best = dMaxZ; nx = 0; ny = 0; nz = 1; penetration = dMaxZ; }
                }
                // Try to get brick from the chunk indicated by BVH
                let brick = gameState?.chunks?.[chunkKey]?.bricks?.[brickId];
                
                // Fallback: use brickIndex if chunk lookup fails (shouldn't happen normally)
                if (!brick && gameState?.brickIndex?.[brickId]) {
                    const key = gameState.brickIndex[brickId];
                    brick = gameState?.chunks?.[key]?.bricks?.[brickId];
                }
                
                if (!brick) return;
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
    CHUNK_SIZE_XZ,
    CHUNK_SIZE_Y,
    PIECE_LIST,
    brickPiecesData,
    loadBrickStudData,
    testGhostCollisionWithDebug,
    getWorldAABBForPiece,
    rebuildWorldBVH,
    resolvePlayerCapsuleCollision,
    addBrickToCollision,
    addBricksToCollisionChunk,
    removeBrickFromCollision,
};


