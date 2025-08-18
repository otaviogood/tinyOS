const path = require('path');
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const THREE = require('three');
const { MeshBVH } = require('three-mesh-bvh');

// Brick stud data from GLTF - will store data for all pieces
const brickPiecesData = new Map(); // pieceId -> { studs: [], antiStuds: [] }
const pieceCollisionCache = new Map(); // pieceId -> { geomNoStuds, geomNoStudsShrunk, bboxNoStuds }

// Small inward offset to treat perfect contact as non-collision (units match your geometry scale)
const CONTACT_TOLERANCE = 0.08;

function computeAveragedVertexNormals(geometry, quantization = 1e-4) {
    const positionAttr = geometry.getAttribute('position');
    const indexAttr = geometry.getIndex();
    const vertexCount = positionAttr.count;

    // Accumulators per-vertex index
    const normalAccum = new Float32Array(vertexCount * 3);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();

    const addFace = (i0, i1, i2) => {
        a.fromBufferAttribute(positionAttr, i0);
        b.fromBufferAttribute(positionAttr, i1);
        c.fromBufferAttribute(positionAttr, i2);
        cb.subVectors(c, b);
        ab.subVectors(a, b);
        cb.cross(ab);
        // Accumulate face normal to each vertex
        normalAccum[i0 * 3 + 0] += cb.x;
        normalAccum[i0 * 3 + 1] += cb.y;
        normalAccum[i0 * 3 + 2] += cb.z;
        normalAccum[i1 * 3 + 0] += cb.x;
        normalAccum[i1 * 3 + 1] += cb.y;
        normalAccum[i1 * 3 + 2] += cb.z;
        normalAccum[i2 * 3 + 0] += cb.x;
        normalAccum[i2 * 3 + 1] += cb.y;
        normalAccum[i2 * 3 + 2] += cb.z;
    };

    if (indexAttr) {
        const indices = indexAttr.array;
        for (let i = 0; i < indices.length; i += 3) {
            addFace(indices[i], indices[i + 1], indices[i + 2]);
        }
    } else {
        for (let i = 0; i < vertexCount; i += 3) {
            addFace(i, i + 1, i + 2);
        }
    }

    // Group vertices by quantized position to smooth across duplicated vertices at hard edges
    const groups = new Map();
    const makeKey = (vx, vy, vz) => `${Math.round(vx / quantization)},${Math.round(vy / quantization)},${Math.round(vz / quantization)}`;
    const pos = positionAttr.array;
    for (let i = 0; i < vertexCount; i++) {
        const key = makeKey(pos[i * 3 + 0], pos[i * 3 + 1], pos[i * 3 + 2]);
        let list = groups.get(key);
        if (!list) { list = []; groups.set(key, list); }
        list.push(i);
    }

    const averaged = new Float32Array(vertexCount * 3);
    for (const indices of groups.values()) {
        let sx = 0, sy = 0, sz = 0;
        for (const vi of indices) {
            sx += normalAccum[vi * 3 + 0];
            sy += normalAccum[vi * 3 + 1];
            sz += normalAccum[vi * 3 + 2];
        }
        const len = Math.hypot(sx, sy, sz) || 1;
        const nx = sx / len, ny = sy / len, nz = sz / len;
        for (const vi of indices) {
            averaged[vi * 3 + 0] = nx;
            averaged[vi * 3 + 1] = ny;
            averaged[vi * 3 + 2] = nz;
        }
    }

    return averaged;
}

function buildShrunkGeometry(sourceGeometry, epsilon = CONTACT_TOLERANCE) {
    // Create a slightly eroded copy of the geometry by moving vertices inward along averaged normals
    const geom = sourceGeometry.clone();
    const posAttr = geom.getAttribute('position');
    const pos = posAttr.array;

    // Always compute averaged vertex normals (ignoring any pre-existing normals)
    const averagedNormals = computeAveragedVertexNormals(geom);
    for (let i = 0; i < pos.length; i += 3) {
        const nx = averagedNormals[i];
        const ny = averagedNormals[i + 1];
        const nz = averagedNormals[i + 2];
        pos[i]     -= nx * epsilon;
        pos[i + 1] -= ny * epsilon;
        pos[i + 2] -= nz * epsilon;
    }
    posAttr.needsUpdate = true;
    // Recompute bounds and BVH for collision queries
    geom.computeBoundingBox();
    geom.computeBoundsTree();
    // Update normals on the shrunk geometry for completeness
    geom.setAttribute('normal', new THREE.BufferAttribute(averagedNormals, 3));
    return geom;
}

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
        // Ensure ground piece used in world init is present to keep rendering/collision stable
        if (!seen.has('41539')) {
            result.push({ id: '41539', color: 'blue', name: 'plate 8x8' });
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

            // Extract 'partnostuds' geometry for collision
            const partNoStudsNode = piece.listChildren().find((child) => child.getName() === 'partnostuds');
            if (!partNoStudsNode) {
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
                        // POSITION
                        const posAcc = prim.getAttribute('POSITION');
                        const idxAcc = prim.getIndices();
                        if (!posAcc) {
                            console.warn(`partnostuds primitive missing POSITION for piece ${pieceInfo.id}`);
                        } else {
                            const positionArray = posAcc.getArray();
                            const indexArray = idxAcc ? idxAcc.getArray() : null;

                            const geometry = new THREE.BufferGeometry();
                            // Ensure we pass a view onto the same underlying buffer
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
                            // Bake partnostuds node's local transform into geometry so it's in piece-local space
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

                            // Build and cache a slightly-shrunk variant for tolerant contact testing
                            const shrunkGeometry = buildShrunkGeometry(geometry);

                            pieceCollisionCache.set(pieceInfo.id, {
                                geomNoStuds: geometry,
                                geomNoStudsShrunk: shrunkGeometry,
                                bboxNoStuds: geometry.boundingBox.clone(),
                            });
                        }
                    }
                }
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
    for (const brick of Object.values(gameState.bricks)) {
        const otherCache = pieceCollisionCache.get(brick.pieceId);
        if (!otherCache) continue;
        const otherAABB = getWorldAABBForPiece(
            brick.pieceId,
            brick.position,
            brick.rotation || 0
        );
        if (otherAABB && ghostAABB && aabbIntersects(ghostAABB, otherAABB)) {
            candidates.push(brick);
        }
    }

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

    const nudges = [
        new THREE.Vector3(0.1, 0.0, 0.0),
        new THREE.Vector3(-0.1, 0.0, 0.0),
        new THREE.Vector3(0.0, 0.1, 0.0),
        new THREE.Vector3(0.0, -0.1, 0.0),
        new THREE.Vector3(0.0, 0.0, 0.1),
        new THREE.Vector3(0.0, 0.0, -0.1),
    ];

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
        // Use regular geometry for existing bricks; ghost is shrunk, so as long as there is no overlap into existing solids it's fine
        const geom = cache.geomNoStuds;
        if (!geom.boundsTree) geom.computeBoundsTree();
        if (!geom.boundingBox) geom.computeBoundingBox();
        return { geometry: geom, matrixWorld: mat };
    });

    for (const c of candidateData) {
        let candidateAlwaysCollides = true;
        for (const n of nudges) {
            const gQuat = getQuaternionFromRotation(payload.rotation ?? payload.rotationY ?? 0);
            const ghostMat = new THREE.Matrix4().compose(
                new THREE.Vector3(position.x + n.x, position.y + n.y, position.z + n.z),
                gQuat,
                new THREE.Vector3(1, 1, 1)
            );
            const ghostMatInv = new THREE.Matrix4().copy(ghostMat).invert();
            const otherToGhostLocal = new THREE.Matrix4().multiplyMatrices(ghostMatInv, c.matrixWorld);
            const hit = bvh.intersectsGeometry(c.geometry, otherToGhostLocal);
            if (!hit) {
                candidateAlwaysCollides = false;
                break;
            }
        }
        if (candidateAlwaysCollides) {
            return true; // colliding with this candidate despite nudges
        }
    }

    return false;
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
                callback(boxIndex, worldCollision.boxes[boxIndex]);
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

function resolvePlayerCapsuleCollision(player, iterations = 3) {
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

        const corrections = [];
        queryBVHForAABB(capsuleAABB, (idx, box) => {
            // Compute closest point on box to the infinite vertical line through capsule center
            const px = pos.x;
            const pz = pos.z;
            const qx = clamp(px, box.min.x, box.max.x);
            const qz = clamp(pz, box.min.z, box.max.z);
            // y on line that is nearest to the box range (clamp to box Y)
            const qyBox = clamp(pos.y, box.min.y, box.max.y);
            // clamp to the capsule segment endpoints
            const qySeg = clamp(qyBox, sy0, sy1);

            const dx = px - qx;
            const dy = qySeg - qyBox;
            const dz = pz - qz;
            const distSq = dx*dx + dy*dy + dz*dz;
            const r = CAPSULE_RADIUS;

            if (distSq < r*r) {
                const dist = Math.sqrt(Math.max(1e-12, distSq));
                const nx = dist > 1e-6 ? dx / dist : 0;
                const ny = dist > 1e-6 ? dy / dist : 1; // default up if degenerate
                const nz = dist > 1e-6 ? dz / dist : 0;
                const penetration = r - dist;
                corrections.push({ nx, ny, nz, penetration });
            }
        });

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
    getWorldAABBForPiece,
    rebuildWorldBVH,
    resolvePlayerCapsuleCollision,
};


