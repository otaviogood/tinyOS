const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } = require('three-mesh-bvh');

// three-mesh-bvh hooks
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
const { createDeltaState } = require('./shared-delta');
const {
    PIECE_LIST,
    brickPiecesData,
    loadBrickStudData,
    testGhostCollision,
    testGhostCollisionWithDebug,
    rebuildWorldBVH,
    resolvePlayerCapsuleCollision,
    addBrickToCollision,
    addBricksToCollisionChunk,
    removeBrickFromCollision,
    CHUNK_SIZE_XZ,
    CHUNK_SIZE_Y,
} = require('./collision');
const { generateChunk } = require('./worldgen/generateChunk');

const app = express();
const server = http.createServer(app);

// Enable CORS for all origins
app.use(cors());

// Lightweight health endpoint for clients to verify server availability
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

// Socket.io with CORS configuration
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Game configuration
const TICK_RATE = 60; // Server tick rate in Hz
const SEND_RATE = 60; // How often to send updates to clients in Hz
// Color configuration
const NUM_COLORS = 16; // Total number of brick colors supported by the client palette
const MAX_COLOR_INDEX = NUM_COLORS - 1;

// Persistence configuration
const SAVE_FILE = process.env.BRICKQUEST_SAVE || path.join(__dirname, 'world-state.json');
const AUTOSAVE_INTERVAL_MS = 10_000; // 10 seconds

// Inactivity/keepalive configuration
const INACTIVE_PLAYER_TIMEOUT_MS = 2000; // Drop players if no input/keepalive received within this window
const INACTIVE_SWEEP_INTERVAL_MS = 500; // How often to scan for inactive players

// Latency simulation configuration
// Try these presets by copying and pasting:
//
// No latency (ideal conditions):
// enabled: false
//
// Low latency (good connection):
// enabled: true, minLatency: 10, maxLatency: 50, packetLoss: 0.01, jitter: true, burstMode: false
//
// High latency (poor connection):
// enabled: true, minLatency: 200, maxLatency: 500, packetLoss: 0.05, jitter: true, burstMode: false
//
// Unstable connection with bursts:
// enabled: true, minLatency: 50, maxLatency: 150, packetLoss: 0.02, jitter: true, burstMode: true, burstChance: 0.1, burstMultiplier: 5
//
const LATENCY_SIMULATION = {
    enabled: false, // Set to false to disable latency simulation entirely
    minLatency: 8, // Minimum latency in milliseconds
    maxLatency: 150, // Maximum latency in milliseconds
    packetLoss: 0.02, // 2% packet loss (0.0 to 1.0)
    jitter: true, // Add random jitter to latency
    burstMode: false, // Simulate burst latency spikes
    burstChance: 0.05, // 5% chance of burst latency
    burstMultiplier: 3 // Multiply latency by this during bursts
};

// Latency simulation helpers
function getSimulatedLatency() {
    if (!LATENCY_SIMULATION.enabled) return 0;
    
    let baseLatency = LATENCY_SIMULATION.minLatency + 
        Math.random() * (LATENCY_SIMULATION.maxLatency - LATENCY_SIMULATION.minLatency);
    
    // Add jitter if enabled
    if (LATENCY_SIMULATION.jitter) {
        const jitterAmount = baseLatency * 0.2; // 20% jitter
        baseLatency += (Math.random() - 0.5) * jitterAmount;
    }
    
    // Apply burst latency if enabled
    if (LATENCY_SIMULATION.burstMode && Math.random() < LATENCY_SIMULATION.burstChance) {
        baseLatency *= LATENCY_SIMULATION.burstMultiplier;
        console.log(`🔥 Burst latency spike: ${Math.round(baseLatency)}ms`);
    }
    
    return Math.max(0, Math.round(baseLatency));
}

function shouldDropPacket() {
    return LATENCY_SIMULATION.enabled && Math.random() < LATENCY_SIMULATION.packetLoss;
}

function simulateLatency(callback, eventName = 'unknown') {
    if (!LATENCY_SIMULATION.enabled) {
        callback();
        return;
    }
    
    // Simulate packet loss
    if (shouldDropPacket()) {
        console.log(`📦 Dropped packet: ${eventName}`);
        return; // Don't execute callback - packet is "lost"
    }
    
    const latency = getSimulatedLatency();
    
    if (latency > 0) {
        setTimeout(callback, latency);
    } else {
        callback();
    }
}

// Game state using delta tracking
const gameState = createDeltaState();
// Initialize structure (chunk-nested bricks)
gameState.players = {};
gameState.chunks = {};
gameState.brickIndex = {};
gameState.nextBrickId = 1;
let worldDirtySinceSave = false;

// -------------------- Persistence Helpers --------------------
function serializeWorldState() {
    const raw = gameState._state || {};
    const chunks = raw.chunks || {};
    const nextBrickId = raw.nextBrickId || 1;
    return {
        version: 2,
        savedAt: Date.now(),
        chunks,
        nextBrickId,
    };
}

async function saveWorldStateAtomic() {
    try {
        const data = serializeWorldState();
        const payload = JSON.stringify(data);
        const tmpPath = SAVE_FILE + '.tmp';
        await fs.promises.mkdir(path.dirname(SAVE_FILE), { recursive: true });
        await fs.promises.writeFile(tmpPath, payload, 'utf8');
        await fs.promises.rename(tmpPath, SAVE_FILE);
    } catch (err) {
        console.error('Failed to save world state:', err);
    }
}

function tryLoadWorldFromDisk() {
    try {
        if (!fs.existsSync(SAVE_FILE)) return false;
        const text = fs.readFileSync(SAVE_FILE, 'utf8');
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') return false;
        const chunks = (data.chunks && typeof data.chunks === 'object') ? data.chunks : {};
        const nextBrickId = Number.isFinite(data.nextBrickId) ? data.nextBrickId : 1;
        gameState.chunks = {};
        gameState.brickIndex = {};
        for (const [key, chunk] of Object.entries(chunks)) {
            const cx = Number.isFinite(chunk.cx) ? (chunk.cx | 0) : 0;
            const cy = Number.isFinite(chunk.cy) ? (chunk.cy | 0) : 0;
            const cz = Number.isFinite(chunk.cz) ? (chunk.cz | 0) : 0;
            const bricks = (chunk && chunk.bricks && typeof chunk.bricks === 'object') ? chunk.bricks : {};
            gameState.chunks[key] = { cx, cy, cz, bricks };
            for (const bid of Object.keys(bricks)) {
                gameState.brickIndex[bid] = key;
            }
        }
        gameState.nextBrickId = nextBrickId;
        const count = Object.values(gameState.chunks).reduce((n, c) => n + Object.keys((c && c.bricks) || {}).length, 0);
        console.log(`[${new Date().toLocaleTimeString()}] Loaded world from disk: ${count} bricks across ${Object.keys(gameState.chunks).length} chunks, next id ${gameState.nextBrickId}`);
        return true;
    } catch (err) {
        console.error('Failed to load world state, starting fresh:', err);
        return false;
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {


    // Create new player directly in delta state
    const authLegs = (socket.handshake && socket.handshake.auth && Number.isFinite(socket.handshake.auth.colorLegs)) ? (socket.handshake.auth.colorLegs | 0) : null;
    const authTorso = (socket.handshake && socket.handshake.auth && Number.isFinite(socket.handshake.auth.colorTorso)) ? (socket.handshake.auth.colorTorso | 0) : null;
    let authName = (socket.handshake && socket.handshake.auth && typeof socket.handshake.auth.name === 'string') ? socket.handshake.auth.name : '';
    if (typeof authName !== 'string') authName = '';
    authName = authName.replace(/[\r\n\t]/g, ' ').trim();
    if (authName.length > 10) authName = authName.slice(0, 10);
    const defaultName = `builder${Math.floor(100 + Math.random() * 900)}`;
    const playerName = authName || defaultName;

    gameState.players[socket.id] = {
        id: socket.id,
        position: { x: 0, y: 50, z: 0 },
        rotation: { y: 0, pitch: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        keys: { w: false, a: false, s: false, d: false, space: false },
        prevKeys: { space: false },
        // Initialize with client-provided colors if present, else defaults
        colorLegs: authLegs !== null ? authLegs : 0x0e78cf,
        colorTorso: authTorso !== null ? authTorso : 0x0e78cf,
        name: playerName,
        selectedPieceIndex: 0,
        selectedColorIndex: 0,
        selectedAntiStudIndex: 0,
        selectedStudIndex: 0,
        anchorMode: 'anti',
        lastFrameCounter: null,
        lastHeardAt: Date.now()
    };

    console.log(`[${new Date().getSeconds()}.${new Date().getMilliseconds()}] Player connected: ${socket.id} (${playerName})`);

    // Send initial game state to the new player (full state)
    const initData = {
        playerId: socket.id,
        state: JSON.parse(JSON.stringify(gameState._state)), // Send raw state (chunk-nested)
        pieceList: PIECE_LIST,
        piecesData: Object.fromEntries(brickPiecesData),
        // Runtime chunk config for client
        chunkConfig: { size: CHUNK_SIZE_XZ, height: CHUNK_SIZE_Y }
    };
    console.log(`[${new Date().getSeconds()}.${new Date().getMilliseconds()}] Done init data`);

    simulateLatency(() => {
        socket.emit('init', initData);
    }, 'init');

    // Handle player input
    socket.on('inputDiff', (inputDiff) => {
        simulateLatency(() => {
            const player = gameState.players[socket.id];
            if (!player) return;

            // Update last-heard timestamp on any message from this client (including keepalives)
            player.lastHeardAt = Date.now();

            // Apply the input diff
            if (inputDiff) {
                // Handle movement keys
                if (inputDiff.keys) {
                    // Ensure persistent key state exists
                    if (!player.keys) {
                        player.keys = { w: false, a: false, s: false, d: false, space: false };
                    }
                    if (!player.prevKeys) {
                        player.prevKeys = { space: false };
                    }
                    // Merge partial key updates into persistent state
                    for (const [k, v] of Object.entries(inputDiff.keys)) {
                        if (k in player.keys) {
                            player.keys[k] = !!v;
                        }
                    }
                    // Jump on server-side detected rising edge of space and only if grounded
                    const justPressedSpace = player.keys.space === true && player.prevKeys.space !== true;
                    if (justPressedSpace && (player.grounded === true)) {
                        player.velocity.y = 150;
                        player.grounded = false; // consume until we land
                    }
                    // Update prev key state for next frame
                    player.prevKeys.space = player.keys.space;
                }

                // Handle camera rotation
                if (inputDiff.camera) {
                    player.rotation.y = inputDiff.camera.yaw;
                    player.rotation.pitch = inputDiff.camera.pitch;
                }


                // Handle events (clicks, piece changes)
                if (inputDiff.events) {
                    for (const event of inputDiff.events) {
                        if (event.type === 'click') {
                            // Pass the event data in the format handleBrickInteraction expects
                            handleBrickInteraction(player, {
                                button: event.button,
                                closestStud: event.closestStud,
                                closestAntiStud: event.closestAntiStud || null,
                                brickId: (typeof event.brickId === 'string') ? event.brickId : null,
                                rotation: (event.rotation && typeof event.rotation.x === 'number') ? event.rotation : undefined,
                                rotationY: typeof event.rotationY === 'number' ? event.rotationY : 0
                            }, inputDiff.mouse);
                        } else if (event.type === 'pieceChange') {
                            const n = PIECE_LIST.length | 0;
                            const cur = Number.isFinite(player.selectedPieceIndex) ? (player.selectedPieceIndex | 0) : 0;
                            const d = Number.isFinite(event.delta) ? (event.delta | 0) : 0;
                            player.selectedPieceIndex = n > 0 ? (((cur + d) % n + n) % n) : 0;
                            console.log(`Player ${socket.id} selected piece: ${PIECE_LIST[player.selectedPieceIndex].id}`);
                            // Reset anchor state when switching pieces to keep authoritative behavior consistent
                            const newPieceId = (PIECE_LIST[player.selectedPieceIndex] && PIECE_LIST[player.selectedPieceIndex].id) || null;
                            const pdata = newPieceId ? brickPiecesData.get(newPieceId) : null;
                            const antiCount = (pdata && Array.isArray(pdata.antiStuds)) ? pdata.antiStuds.length : 0;
                            const studCount = (pdata && Array.isArray(pdata.studs)) ? pdata.studs.length : 0;
                            if (antiCount > 0) {
                                player.anchorMode = 'anti';
                            } else if (studCount > 0) {
                                player.anchorMode = 'stud';
                            } else {
                                player.anchorMode = 'anti';
                            }
                            player.selectedStudIndex = 0;
                            player.selectedAntiStudIndex = 0;
                        } else if (event.type === 'colorChange') {
                            const n = (MAX_COLOR_INDEX + 1) | 0;
                            const cur = Number.isFinite(player.selectedColorIndex) ? (player.selectedColorIndex | 0) : 0;
                            const d = Number.isFinite(event.delta) ? (event.delta | 0) : 0;
                            player.selectedColorIndex = n > 0 ? (((cur + d) % n + n) % n) : 0;
                        } else if (event.type === 'setColor') {
                            const idx = typeof event.index === 'number' ? event.index : 0;
                            player.selectedColorIndex = Math.max(0, Math.min(MAX_COLOR_INDEX, idx));
                        } else if (event.type === 'setPlayerColors') {
                            // Allow client to request player color customization
                            if (typeof event.legs === 'number' && Number.isFinite(event.legs)) {
                                player.colorLegs = event.legs | 0;
                            }
                            if (typeof event.torso === 'number' && Number.isFinite(event.torso)) {
                                player.colorTorso = event.torso | 0;
                            }
                        } else if (event.type === 'cycleAnchor') {
                            // Cycle through anti-studs then studs; supports delta = +1 forward, -1 backward
                            const pieceId = (PIECE_LIST[player.selectedPieceIndex] && PIECE_LIST[player.selectedPieceIndex].id) || null;
                            const pdata = pieceId ? brickPiecesData.get(pieceId) : null;
                            const antiCount = (pdata && Array.isArray(pdata.antiStuds)) ? pdata.antiStuds.length : 0;
                            const studCount = (pdata && Array.isArray(pdata.studs)) ? pdata.studs.length : 0;
                            const delta = (Number.isFinite(event.delta) ? (event.delta | 0) : 1);
                            // const before = { mode: player.anchorMode, anti: player.selectedAntiStudIndex|0, stud: player.selectedStudIndex|0, antiCount, studCount, delta };
                            if (delta >= 0) {
                                if (player.anchorMode !== 'stud') {
                                    const cur = Number.isFinite(player.selectedAntiStudIndex) ? player.selectedAntiStudIndex : 0;
                                    if (antiCount <= 0) {
                                        if (studCount > 0) {
                                            player.anchorMode = 'stud';
                                            player.selectedStudIndex = 0;
                                        }
                                    } else if ((cur + 1) < antiCount) {
                                        player.selectedAntiStudIndex = (cur + 1) | 0;
                                    } else {
                                        // reached end of anti list
                                        if (studCount > 0) {
                                            player.anchorMode = 'stud';
                                            player.selectedStudIndex = 0;
                                        } else {
                                            // wrap within anti list
                                            player.selectedAntiStudIndex = 0;
                                        }
                                    }
                                } else {
                                    const curS = Number.isFinite(player.selectedStudIndex) ? player.selectedStudIndex : 0;
                                    if (studCount <= 0) {
                                        if (antiCount > 0) {
                                            player.anchorMode = 'anti';
                                            player.selectedAntiStudIndex = 0;
                                        }
                                    } else if ((curS + 1) < studCount) {
                                        player.selectedStudIndex = (curS + 1) | 0;
                                    } else {
                                        // reached end of stud list
                                        if (antiCount > 0) {
                                            player.anchorMode = 'anti';
                                            player.selectedAntiStudIndex = 0;
                                        } else {
                                            // wrap within stud list
                                            player.selectedStudIndex = 0;
                                        }
                                    }
                                }
                            } else {
                                // Reverse
                                if (player.anchorMode === 'stud') {
                                    const curS = Number.isFinite(player.selectedStudIndex) ? player.selectedStudIndex : 0;
                                    if (studCount <= 0) {
                                        if (antiCount > 0) {
                                            player.anchorMode = 'anti';
                                            player.selectedAntiStudIndex = Math.max(0, antiCount - 1);
                                        }
                                    } else if ((curS - 1) >= 0) {
                                        player.selectedStudIndex = (curS - 1) | 0;
                                    } else {
                                        // at start of stud list
                                        if (antiCount > 0) {
                                            player.anchorMode = 'anti';
                                            player.selectedAntiStudIndex = Math.max(0, antiCount - 1);
                                        } else {
                                            // wrap within stud list
                                            player.selectedStudIndex = Math.max(0, studCount - 1);
                                        }
                                    }
                                } else {
                                    const cur = Number.isFinite(player.selectedAntiStudIndex) ? player.selectedAntiStudIndex : 0;
                                    if (antiCount <= 0) {
                                        if (studCount > 0) {
                                            player.anchorMode = 'stud';
                                            player.selectedStudIndex = Math.max(0, studCount - 1);
                                        }
                                    } else if ((cur - 1) >= 0) {
                                        player.selectedAntiStudIndex = (cur - 1) | 0;
                                    } else {
                                        // at start of anti list
                                        if (studCount > 0) {
                                            player.anchorMode = 'stud';
                                            player.selectedStudIndex = Math.max(0, studCount - 1);
                                        } else {
                                            // wrap within anti list
                                            player.selectedAntiStudIndex = Math.max(0, antiCount - 1);
                                        }
                                    }
                                }
                            }
                            // const after = { mode: player.anchorMode, anti: player.selectedAntiStudIndex|0, stud: player.selectedStudIndex|0 };
                            // console.log(`[cycleAnchor] ${socket.id} piece=${pieceId} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
                        }
                    }
                }

                // Recompute movement based on persistent key state when keys or camera change
                if (inputDiff.keys || inputDiff.camera) {
                    computeMovementFromKeys(player);
                }

                // Handle frame counter
                if (inputDiff.frame !== undefined) {
                    player.lastFrameCounter = inputDiff.frame;
                }
            }

            // Authoritative ghost placement + collision from inputs
            if (inputDiff && inputDiff.ghost) {
                const ghostInputs = {
                    pieceId: inputDiff.ghost.pieceId,
                    yaw: (typeof inputDiff.ghost.yaw === 'number') ? inputDiff.ghost.yaw : undefined,
                    rotation: (inputDiff.ghost.rotation && typeof inputDiff.ghost.rotation.x === 'number') ? inputDiff.ghost.rotation : undefined,
                    closestStud: inputDiff.ghost.closestStud || null,
                    closestAntiStud: inputDiff.ghost.closestAntiStud || null,
                };

                let placement = computeGhostPlacement(player, ghostInputs, inputDiff.mouse);
                if (!placement && inputDiff.ghost.position && (ghostInputs.rotation || typeof inputDiff.ghost.rotationY === 'number')) {
                    placement = {
                        pieceId: inputDiff.ghost.pieceId,
                        position: inputDiff.ghost.position,
                        rotation: ghostInputs.rotation || { x: 0, y: inputDiff.ghost.rotationY || 0, z: 0 },
                    };
                }

                if (placement) {
                    const debug = testGhostCollisionWithDebug({ 
                        pieceId: placement.pieceId, 
                        position: placement.position,
                        rotation: placement.rotation
                    }, gameState);
                    // Publish authoritative ghost pose on player's state so client can render it
                    player.ghostPose = placement;
                    player.ghostColliding = !!debug.colliding;
                    player.ghostBroadCount = debug.broadCount | 0;
                    player.ghostPrunedCount = debug.prunedCount | 0;
                    if (debug.timings) {
                        player.ghostTimingAabbMs = Math.round(debug.timings.aabbMs * 100) / 100;
                        player.ghostTimingBroadMs = Math.round(debug.timings.broadMs * 100) / 100;
                        player.ghostTimingBuildMs = Math.round(debug.timings.buildMs * 100) / 100;
                        player.ghostTimingNarrowMs = Math.round(debug.timings.narrowMs * 100) / 100;
                        player.ghostTimingTotalMs = Math.round(debug.timings.totalMs * 100) / 100;
                    } else {
                        player.ghostTimingAabbMs = 0;
                        player.ghostTimingBroadMs = 0;
                        player.ghostTimingBuildMs = 0;
                        player.ghostTimingNarrowMs = 0;
                        player.ghostTimingTotalMs = 0;
                    }
                } else {
                    player.ghostPose = null;
                    player.ghostColliding = false;
                    player.ghostBroadCount = 0;
                    player.ghostPrunedCount = 0;
                    player.ghostTimingAabbMs = 0;
                    player.ghostTimingBroadMs = 0;
                    player.ghostTimingBuildMs = 0;
                    player.ghostTimingNarrowMs = 0;
                    player.ghostTimingTotalMs = 0;
                }
            }

            // Apply gravity
            player.velocity.y -= 300 * (1/60);
        }, 'inputDiff');
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];
        const playerName = player ? player.name : 'unknown';
        console.log(`[${new Date().toLocaleTimeString()}] Player disconnected: ${socket.id} (${playerName})`);
        delete gameState.players[socket.id];
    });
});

// Periodically remove inactive players that have not sent input/keepalive recently
setInterval(() => {
    const now = Date.now();
    for (const [playerId, player] of Object.entries(gameState.players)) {
        const lastHeard = player.lastHeardAt || 0;
        if (now - lastHeard > INACTIVE_PLAYER_TIMEOUT_MS) {
            const playerName = player.name || 'unknown';
            console.log(`[${new Date().toLocaleTimeString()}] Removing inactive player ${playerId} (${playerName}) (last heard ${now - lastHeard}ms ago)`);
            delete gameState.players[playerId];
            // Attempt to sever the socket if it still exists
            const s = io.sockets.sockets.get(playerId);
            if (s) {
                try { s.disconnect(true); } catch (_) { /* noop */ }
            }
        }
    }
}, INACTIVE_SWEEP_INTERVAL_MS);

// Compute velocity from a player's persistent key state and current yaw
function computeMovementFromKeys(player) {
    const moveSpeed = 130;
    const yaw = player.rotation.y || 0;
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };

    let vx = 0;
    let vz = 0;

    if (player.keys?.w) {
        vx += forward.x * moveSpeed;
        vz += forward.z * moveSpeed;
    }
    if (player.keys?.s) {
        vx -= forward.x * moveSpeed;
        vz -= forward.z * moveSpeed;
    }
    if (player.keys?.a) {
        vx -= right.x * moveSpeed;
        vz -= right.z * moveSpeed;
    }
    if (player.keys?.d) {
        vx += right.x * moveSpeed;
        vz += right.z * moveSpeed;
    }

    player.velocity.x = vx;
    player.velocity.z = vz;
}


// Compute an authoritative ghost placement (position + rotation) from inputs
// Inputs can include:
// - pieceId (optional; falls back to player's selected piece)
// - yaw (preferred) or rotation {x,y,z} for base orientation
// - closestStud: { position: {x,y,z}, direction?: {x,y,z} }
// - mouseRay: {x,y,z} for grid snapping fallback
function computeGhostPlacement(player, inputs, mouseRay) {
    const selectedPiece = PIECE_LIST[player.selectedPieceIndex];
    const pieceId = (inputs && inputs.pieceId) || (selectedPiece && selectedPiece.id);
    if (!pieceId) return null;
    const pieceData = brickPiecesData.get(pieceId);

    // Base orientation from yaw or full rotation
    let baseEuler;
    if (inputs && inputs.rotation && typeof inputs.rotation.x === 'number') {
        baseEuler = new THREE.Euler(inputs.rotation.x, inputs.rotation.y || 0, inputs.rotation.z || 0);
    } else {
        const yaw = (inputs && typeof inputs.yaw === 'number') ? inputs.yaw : 0;
        baseEuler = new THREE.Euler(0, yaw, 0);
    }
    const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);

    let finalQuat = baseQuat.clone();
    let position = null;

    // Two anchor modes: 'anti' (piece anti-stud -> hovered stud), 'stud' (piece stud -> hovered anti-stud)
    const mode = (player && typeof player.anchorMode === 'string') ? player.anchorMode : 'anti';
    const studInfoLocal = inputs && inputs.closestStud;
    const antiInfoLocal = inputs && inputs.closestAntiStud;
    if (mode === 'anti' && studInfoLocal && studInfoLocal.position && pieceData && Array.isArray(pieceData.antiStuds) && pieceData.antiStuds.length > 0) {
        // Align using the FIRST anti-stud only (legacy server behavior)
        const studDirWorld = (studInfoLocal.direction)
            ? new THREE.Vector3(studInfoLocal.direction.x, studInfoLocal.direction.y, studInfoLocal.direction.z).normalize()
            : new THREE.Vector3(0, 1, 0);
        const targetAxis = studDirWorld.clone();

        // Choose anti-stud based on player's selected index with wrap-around
        const antiList = pieceData.antiStuds;
        let antiIndex = Number.isFinite(player && player.selectedAntiStudIndex) ? (player.selectedAntiStudIndex | 0) : 0;
        if (antiList.length > 0) {
            antiIndex = ((antiIndex % antiList.length) + antiList.length) % antiList.length;
        } else {
            antiIndex = 0;
        }
        const usedAnti = antiList[antiIndex] || antiList[0];
        const antiDirLocal = new THREE.Vector3(
            Number.isFinite(usedAnti.dx) ? usedAnti.dx : 0,
            Number.isFinite(usedAnti.dy) ? usedAnti.dy : 1,
            Number.isFinite(usedAnti.dz) ? usedAnti.dz : 0,
        ).normalize();
        const antiDirWorld0 = antiDirLocal.clone().applyQuaternion(finalQuat).normalize();
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(antiDirWorld0, targetAxis);
        finalQuat = alignQuat.multiply(finalQuat);

        // Compute world-space offset of anti stud position and align to target stud center
        const antiPosLocal = new THREE.Vector3(usedAnti.x || 0, usedAnti.y || 0, usedAnti.z || 0);
        const antiPosWorld = antiPosLocal.clone().applyQuaternion(finalQuat);
        const targetStudPos = studInfoLocal.position;
        position = {
            x: targetStudPos.x - antiPosWorld.x,
            y: targetStudPos.y - antiPosWorld.y,
            z: targetStudPos.z - antiPosWorld.z,
        };
    } else if (mode === 'stud' && antiInfoLocal && antiInfoLocal.position && pieceData && Array.isArray(pieceData.studs) && pieceData.studs.length > 0) {
        const antiDirWorld = (antiInfoLocal.direction)
            ? new THREE.Vector3(antiInfoLocal.direction.x, antiInfoLocal.direction.y, antiInfoLocal.direction.z).normalize()
            : new THREE.Vector3(0, 1, 0);
        const targetAxis = antiDirWorld.clone();
        const studList = pieceData.studs;
        let studIndex = Number.isFinite(player && player.selectedStudIndex) ? (player.selectedStudIndex | 0) : 0;
        if (studList.length > 0) {
            studIndex = ((studIndex % studList.length) + studList.length) % studList.length;
        } else {
            studIndex = 0;
        }
        const usedStud = studList[studIndex] || studList[0];
        const studDirLocal = new THREE.Vector3(
            Number.isFinite(usedStud.dx) ? usedStud.dx : 0,
            Number.isFinite(usedStud.dy) ? usedStud.dy : 1,
            Number.isFinite(usedStud.dz) ? usedStud.dz : 0,
        ).normalize();
        const studDirWorld0 = studDirLocal.clone().applyQuaternion(finalQuat).normalize();
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(studDirWorld0, targetAxis);
        finalQuat = alignQuat.multiply(finalQuat);
        const studPosLocal = new THREE.Vector3(usedStud.x || 0, usedStud.y || 0, usedStud.z || 0);
        const studPosWorld = studPosLocal.clone().applyQuaternion(finalQuat);
        const targetAntiPos = antiInfoLocal.position;
        position = {
            x: targetAntiPos.x - studPosWorld.x,
            y: targetAntiPos.y - studPosWorld.y,
            z: targetAntiPos.z - studPosWorld.z,
        };
    } else if (mouseRay) {
        // Grid snap fallback when not snapping to a stud
        const snapSize = 20;
        position = {
            x: Math.round(mouseRay.x / snapSize) * snapSize,
            y: Math.round(mouseRay.y / snapSize) * snapSize + 8,
            z: Math.round(mouseRay.z / snapSize) * snapSize,
        };
    }

    if (!position) return null;

    let rotation = { x: 0, y: 0, z: 0 };
    try {
        const e = new THREE.Euler().setFromQuaternion(finalQuat, 'XYZ');
        rotation = { x: e.x, y: e.y, z: e.z };
    } catch (_) {}

    return { pieceId, position, rotation };
}

// Handle brick placement/removal
function handleBrickInteraction(player, click, mouseRay) {
    if (click.button === 0) { // Left click - place brick
        let placement = computeGhostPlacement(player, {
            pieceId: (PIECE_LIST[player.selectedPieceIndex] && PIECE_LIST[player.selectedPieceIndex].id),
            yaw: (typeof click.rotationY === 'number' ? click.rotationY : 0),
            rotation: (click.rotation && typeof click.rotation.x === 'number') ? click.rotation : undefined,
            closestStud: click.closestStud || null,
            closestAntiStud: click.closestAntiStud || null,
        }, mouseRay);
        // Fallback to last authoritative ghost pose if immediate recompute fails
        if (!placement && player && player.ghostPose && player.ghostPose.position && player.ghostPose.rotation) {
            placement = {
                pieceId: player.ghostPose.pieceId || ((PIECE_LIST[player.selectedPieceIndex] && PIECE_LIST[player.selectedPieceIndex].id) || null),
                position: player.ghostPose.position,
                rotation: player.ghostPose.rotation,
            };
        }
        if (!placement) return;
        const { pieceId, position, rotation } = placement;
        
        // Authoritative collision check before placing (include rotation)
        const colliding = testGhostCollision({ pieceId, position, rotation }, gameState);
        if (colliding) return;

        const newBrickId = String(gameState.nextBrickId++);
        const newBrick = {
            id: newBrickId,
            position: position,
            rotation: rotation,
            colorIndex: Math.max(0, Math.min(MAX_COLOR_INDEX, player.selectedColorIndex ?? 0)),
            pieceId: pieceId, // Store the piece type
            type: 'basic'
        };
        // Compute chunk and stamp chunkKey BEFORE inserting into delta state
        addBrickToCollision(gameState, newBrick);
        // Insert under authoritative chunk
        const key = newBrick.chunkKey;
        const parts = (key && typeof key === 'string') ? key.split(',') : ['0','0','0'];
        const cx = parseInt(parts[0] || '0', 10) | 0;
        const cy = parseInt(parts[1] || '0', 10) | 0;
        const cz = parseInt(parts[2] || '0', 10) | 0;
        if (!gameState.chunks[key]) gameState.chunks[key] = { cx, cy, cz, bricks: {} };
        if (!gameState.chunks[key].bricks) gameState.chunks[key].bricks = {};
        gameState.chunks[key].bricks[newBrickId] = newBrick;
        if (!gameState.brickIndex) gameState.brickIndex = {};
        gameState.brickIndex[newBrickId] = key;
        worldDirtySinceSave = true;
        
    } else if (click.button === 2) { // Right click - remove brick
        // Delete only when the client provided a direct raycast brick id
        const targetBrickId = (typeof click.brickId === 'string') ? click.brickId : null;
        if (targetBrickId) {
            const key = gameState.brickIndex[targetBrickId];
            const chunk = key ? gameState.chunks[key] : null;
            const brickToRemove = (chunk && chunk.bricks) ? chunk.bricks[targetBrickId] : null;
            if (brickToRemove && brickToRemove.type !== 'ground') { // Don't remove ground layer
                // Remove from collision before deleting so we still have chunkKey
                removeBrickFromCollision(gameState, brickToRemove);
                if (chunk && chunk.bricks) {
                    delete chunk.bricks[targetBrickId];
                    // If chunk is now empty, remove it from authoritative map
                    if (Object.keys(chunk.bricks).length === 0) {
                        delete gameState.chunks[key];
                    }
                }
                if (gameState.brickIndex) delete gameState.brickIndex[targetBrickId];
                worldDirtySinceSave = true;
            }
        }
    }
}

// Game update loop
let lastUpdateTime = Date.now();
setInterval(() => {
    const currentTime = Date.now();
    const deltaTime = (currentTime - lastUpdateTime) / 1000;
    lastUpdateTime = currentTime;

    // Update all players
    for (const [playerId, player] of Object.entries(gameState.players)) {
        // Simple physics update
        player.position.x += player.velocity.x * deltaTime;
        player.position.y += player.velocity.y * deltaTime;
        player.position.z += player.velocity.z * deltaTime;

        // Resolve collisions against bricks using capsule vs convex meshes (narrow-phase) after AABB BVH
        resolvePlayerCapsuleCollision(gameState, player, 3);

        // Keep player above a minimum ground plane as a fallback
        if (player.position.y < 0) {
            player.position.y = 0;
            player.velocity.y = Math.max(0, player.velocity.y);
        }
    }
}, 1000 / TICK_RATE);

// Send state updates to clients
setInterval(() => {
    // If there are no connected clients, skip generating diffs and clear any pending dirties
    const connectedCount = (io && io.sockets && io.sockets.sockets) ? io.sockets.sockets.size : 0;
    if (!connectedCount) return;

    // Generate diff of all changes
    const diff = gameState._diff();
    if (diff) {
        simulateLatency(() => {
            io.emit('stateDiff', {
                diff: diff,
                timestamp: Date.now()
            });
        }, 'stateDiff');
        // Clear dirty tracking for next frame
        gameState._clear();
    }
}, 1000 / SEND_RATE);

// Startup moved below to a single async block that awaits brick load first

// Start periodic autosave
const autosaveInterval = setInterval(() => {
    if (!worldDirtySinceSave) return;
    saveWorldStateAtomic()
        .then(() => { worldDirtySinceSave = false; })
        .catch(() => {});
}, AUTOSAVE_INTERVAL_MS);

async function gracefulShutdown(signal) {
    try {
        console.log(`\n[${new Date().toLocaleTimeString()}] Received ${signal}. Saving world state...`);
        await saveWorldStateAtomic();
    } catch (e) {
        console.error('Error during shutdown save:', e);
    } finally {
        try { clearInterval(autosaveInterval); } catch (_) {}
        process.exit(0);
    }
}

['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig, () => gracefulShutdown(sig));
});
process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    try { await saveWorldStateAtomic(); } catch (_) {}
    process.exit(1);
});

// Synchronous startup flow: await brick data, then load/generate world, then start server
(async () => {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Loading brick data (GLTF + collision)`);
        await loadBrickStudData();
        console.log(`[${new Date().toLocaleTimeString()}] Brick data loaded`);

        const loaded = tryLoadWorldFromDisk();
        if (!loaded) {
            console.log(`[${new Date().getSeconds()}.${new Date().getMilliseconds()}] Creating new world via worldgen (chunks -2..1,-2..1 around origin)`);
            for (let cx = -2; cx <= 1; cx++) {
                for (let cz = -2; cz <= 1; cz++) {
                    addBricksToCollisionChunk(gameState, generateChunk(cx, 0, cz, gameState));
                }
            }
            console.log(`[${new Date().getSeconds()}.${new Date().getMilliseconds()}] Worldgen complete`);
            worldDirtySinceSave = true;
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] Using persisted world from disk`);
            // Build per-chunk BVHs from authoritative bricks loaded from disk
            rebuildWorldBVH(gameState);
        }

        // Clear any startup dirty flags; clients receive a full snapshot via 'init'
        gameState._clear();

        const PORT = process.env.PORT || 3001;
        const HOST = process.env.HOST || '0.0.0.0';
        server.listen(PORT, HOST, () => {
            console.log(`BrickQuest server running on ${HOST}:${PORT}`);
            console.log(`Local network access: http://${HOST}:${PORT}`);
            const brickCount = Object.values(gameState.chunks || {}).reduce((n, c) => n + Object.keys((c && c.bricks) || {}).length, 0);
            console.log(`World ready with ${brickCount} bricks across ${Object.keys(gameState.chunks||{}).length} chunks`);
            if (LATENCY_SIMULATION.enabled) {
                console.log(`🌐 Latency simulation ENABLED:`);
                console.log(`   - Latency: ${LATENCY_SIMULATION.minLatency}-${LATENCY_SIMULATION.maxLatency}ms`);
                console.log(`   - Packet loss: ${(LATENCY_SIMULATION.packetLoss * 100).toFixed(1)}%`);
                console.log(`   - Jitter: ${LATENCY_SIMULATION.jitter ? 'ON' : 'OFF'}`);
                console.log(`   - Burst mode: ${LATENCY_SIMULATION.burstMode ? 'ON' : 'OFF'}`);
            } else {
                console.log(`🌐 Latency simulation DISABLED`);
            }
        });
    } catch (e) {
        console.error('Fatal startup error:', e);
        process.exit(1);
    }
})();