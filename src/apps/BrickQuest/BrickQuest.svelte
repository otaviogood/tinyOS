<script>
    // @ts-nocheck
    import { onMount, tick as nextTick } from "svelte";
    import { pop } from "../../router";
    import { handleResize } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import { Animator, frameCount, animateCount } from "../../animator";
    import { createBrickQuestRenderer } from "./renderer/threeRenderer.js";
    import StartScreen from "./StartScreen.svelte";
    import ColorPalette from "./ColorPalette.svelte";
    import { brickColorHexes } from "./colors.js";
    import Picker from "./Picker.svelte";
    import io from "socket.io-client";
    import { createDeltaState, applyDiff } from "./client-delta.js";

    let animator = new Animator(60, tick);
    let container;
    let previewContainer;
    let renderer3d;
    let socket;
    let heartbeatIntervalId = null;
    let playerId;
	let isConnected = false;
    
    // Game state with delta tracking
    let gameState = createDeltaState();
    gameState.players = {};
    gameState.chunks = {};
    
    // Input state with delta tracking
    const inputState = createDeltaState();
    inputState.keys = { w: false, a: false, s: false, d: false, space: false };
    inputState.mouse = { x: 0, y: 0, z: 0 };
    inputState.camera = { yaw: 0, pitch: 0 };
    inputState.events = [];
    inputState.frame = 0;
    
    // Three.js internals moved to renderer3d
    let pieceList = []; // List of available pieces from server
    let piecesData = {}; // pieceId -> { studs: [], antiStuds: [] }
    let selectedPieceIndex = 0; // Currently selected piece for placement
    let selectedColorIndex = 0; // Currently selected color for placement
    let selectedAntiStudIndex = 0; // Which anti-stud to align to when snapping
    let selectedStudIndex = 0; // Which stud to align when anchoring to anti-stud
    let anchorMode = 'anti'; // 'anti' or 'stud'
    // Ghost (preview) brick state routed via renderer3d
    let ghostYaw = 0; // Yaw rotation for current ghost/piece placement (radians)
    // Stud metadata is provided to the renderer in piecesData; no local copy needed
    let yaw = 0, pitch = 0; // Camera rotation in radians
    // Debug camera: simple third-person follow toggle
    let isThirdPerson = false;
    // Player capsule dimensions (match server collision in brickserver/collision.js)
    // (now handled inside renderer)
    let mouseSensitivity = 0.002; // Mouse sensitivity multiplier
    let loadingText = "Loading brick model...";
    
    // RTT tracking
    let sentFrames = new Map(); // frame -> timestamp
    let currentRTT = 0; // Current round-trip time in milliseconds
    let smoothedRTT = 0; // Exponentially smoothed RTT

    // Network diff backlog (fast-forward queue)
    let pendingStateDiffs = [];
    // Simple client-side delay buffer (arrival-time based)
    const MIN_DELAY_MS = 17; // ~1 frame at 60 fps
    let renderDelayMs = MIN_DELAY_MS; // initial delay; tune between 100-150ms
    const MAX_DELAY_MS = 400;
    const MAX_BUFFER_MS = 300; // if buffered span exceeds this, catch up
    const UNDERFLOW_BUMP_MS = 10; // add when starving
    const OVERFLOW_TRIM_MS = 20; // remove when too full
    let pendingByArrival = []; // [{ t: performance.now(), diff }]
    let lastAppliedArrivalTs = 0;
    let bufferEmptySinceTs = 0; // track continuous empty-buffer duration
    // Ensure we render at least periodically even under backlog
    let framesSinceLastFullLoop = 0;
    // Backlog handling constants
    const BACKLOG_SKIP_THRESHOLD = 1; // queued > this means we're behind
    const BACKLOG_LIMIT = 15; // max diffs per skip-frame AND max consecutive skip frames

    let showStart = true; // DEBUG: Skip start screen
    let showPicker = false;
    let recaptureOnNextEscUp = false; // when picker closed via ESC, recapture on keyup

	// Performance HUD (per-frame timing)
	let cpuMs = 0;
	let gpuMs = 0;
	let drawCalls = 0;
	let triangles = 0;
	let showStats = false; // HUD stats collapsed by default
	let chunkDebugVisible = false; // toggled with backtick
	// Preserve yaw across server-selected piece echo after eyedrop
	let preserveYawOnNextPieceChange = false;
	let pendingSampledYaw = 0;

	// Time To First Playable (TTFP) minimal tracking
	let ttfpStartTs = 0;

    onMount(async () => {
        const onStart = async () => { showStart = false; await nextTick(); await safeStartGame(); };
        document.addEventListener('brickquest-start', onStart);
        // Force showing start screen on hard refresh
        // showStart = true; // DEBUG: Commented out to skip start screen
        
        // DEBUG: Start the game immediately since we're skipping the start screen
        if (!showStart) {
            await nextTick();
            await safeStartGame();
        }
        return () => {
            document.removeEventListener('brickquest-start', onStart);
            animator.stop();
            if (socket) socket.disconnect();
            if (heartbeatIntervalId) { clearInterval(heartbeatIntervalId); heartbeatIntervalId = null; }
            if (renderer3d) renderer3d.dispose();
        };
    });

    async function safeStartGame() {
        if (!renderer3d) {
            await initThree();
        }
        if (!ttfpStartTs) { ttfpStartTs = performance.now(); }
        initNetworking();
        setupKeyboardControls();
    }

    async function initThree() {
        renderer3d = createBrickQuestRenderer(container, {
            colorPalette: brickColorHexes,
            onLoadingTextChange: (t) => (loadingText = t),
            onError: (e) => {
                console.error("Renderer error:", e);
                loadingText = "Error loading model";
            },
        });
        renderer3d.setGameStateProvider(() => gameState);
        await renderer3d.init();
        window.addEventListener("resize", onWindowResize);
        
        // Setup preview after a small delay to ensure DOM is ready
        await nextTick();
        if (previewContainer) {
            renderer3d.setupPreview(previewContainer);
            // Sync the initial color selection
            renderer3d.setSelectedColorIndex(selectedColorIndex);
        }
    }



    function setGhostCollisionVisual(colliding) {
        renderer3d && renderer3d.setGhostCollisionVisual(colliding);
    }

    function initNetworking() {
        // Resolve server URL from StartScreen or fallback
        const savedUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('brickquest_server_url')) || 'http://localhost:3001';
        const name = (typeof localStorage !== 'undefined' && localStorage.getItem('brickquest_player_name')) || `builder${Math.floor(100 + Math.random()*900)}`;

        // Desired local player colors from StartScreen (indices into brickColorHexes)
        const legsIdx = Math.max(0, Math.min(brickColorHexes.length - 1, parseInt(localStorage.getItem('brickquest_color_legs_idx') || '1', 10)));
        const torsoIdx = Math.max(0, Math.min(brickColorHexes.length - 1, parseInt(localStorage.getItem('brickquest_color_torso_idx') || '1', 10)));
        const desiredLegsColor = brickColorHexes[isFinite(legsIdx) ? legsIdx : 1] | 0;
        const desiredTorsoColor = brickColorHexes[isFinite(torsoIdx) ? torsoIdx : 1] | 0;

        // Connect to the server and send preferred colors up-front in auth payload
        console.time('[BrickQuest] socket to init');
        console.time('[BrickQuest] socket connect');
        socket = io(savedUrl, {
            transports: ['websocket'],
            upgrade: false,
            auth: { colorLegs: desiredLegsColor, colorTorso: desiredTorsoColor, name }
        });

        // Connection state handlers (after socket is created)
        socket.on('connect', () => { isConnected = true; console.timeEnd('[BrickQuest] socket connect'); });
        socket.on('disconnect', () => { isConnected = false; });
        socket.on('connect_error', () => { isConnected = false; });
        socket.on('reconnect', () => { isConnected = true; });

        // Handle initial connection
		socket.on('init', (data) => {
			console.timeEnd('[BrickQuest] socket to init');
            console.time('[BrickQuest] init');
			isConnected = true;
            playerId = data.playerId;
            
            // Clear existing meshes in renderer
            renderer3d.resetAllMeshes();
            
            // Store piece list and data
            if (data.pieceList) {
                pieceList = data.pieceList;
            }
            if (data.piecesData) {
                piecesData = data.piecesData;
            }
            // Inform renderer of data
            renderer3d.setData({ pieceList, piecesData });
            // Apply runtime chunk config from server
            if (data.chunkConfig) {
                renderer3d.setChunkConfig(data.chunkConfig);
            }
            
            // Apply full state
            gameState._pause();
            gameState.players = data.state.players || {};
            gameState.chunks = data.state.chunks || {};
            gameState._resume();
            
            // Create meshes for all entities
            for (const [pid, player] of Object.entries(gameState.players)) {
                renderer3d.createPlayerMesh({ id: pid, ...player });
            }
            
            // Ensure chunk groups and bricks reconcile; pass chunks only to use renderer nested fast-path
            renderer3d.reconcileChunksAndBricks(gameState.chunks, null);
            // If debug was toggled previously, re-apply to ensure helpers get added to all groups
            if (chunkDebugVisible && renderer3d && renderer3d.setChunkDebugVisible) {
                renderer3d.setChunkDebugVisible(true);
            }
            
            // Update selected piece index
            const localPlayer = gameState.players[playerId];
            if (localPlayer && localPlayer.selectedPieceIndex !== undefined) {
                selectedPieceIndex = localPlayer.selectedPieceIndex;
                // Reset rotation on init to a known state
                ghostYaw = 0;
                renderer3d.setSelectedPieceIndex(selectedPieceIndex);
                renderer3d.setGhostYaw(ghostYaw);
                // Sync anti-stud index if present
                if (Number.isFinite(localPlayer.selectedAntiStudIndex)) {
                    selectedAntiStudIndex = Math.max(0, localPlayer.selectedAntiStudIndex | 0);
                    renderer3d.setSelectedAntiStudIndex(selectedAntiStudIndex);
                } else {
                    selectedAntiStudIndex = 0;
                    renderer3d.setSelectedAntiStudIndex(0);
                }
                // Sync stud index and anchor mode if present
                if (Number.isFinite(localPlayer.selectedStudIndex)) {
                    selectedStudIndex = Math.max(0, localPlayer.selectedStudIndex | 0);
                } else {
                    selectedStudIndex = 0;
                }
                if (typeof localPlayer.anchorMode === 'string') {
                    anchorMode = localPlayer.anchorMode;
                } else {
                    anchorMode = 'anti';
                }
                // Apply renderer sync for stud index and anchor mode
                if (renderer3d && renderer3d.setSelectedStudIndex) {
                    renderer3d.setSelectedStudIndex(selectedStudIndex);
                }
                if (renderer3d && renderer3d.setAnchorMode) {
                    renderer3d.setAnchorMode(anchorMode);
                }
                console.timeEnd('[BrickQuest] init');
				if (ttfpStartTs) { const ms = performance.now() - ttfpStartTs; try { console.log(`[BrickQuest] Time to first playable: ${Math.round(ms)} ms`); } catch {} ttfpStartTs = 0; }
            }
            // Sync selected color index
            if (localPlayer && localPlayer.selectedColorIndex !== undefined) {
                selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, localPlayer.selectedColorIndex));
                renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
            }
            // Ensure ghost is created/updated after we know piece list and geometries
            renderer3d.setSelectedPieceIndex(selectedPieceIndex);

            // Reset delay buffer on fresh init
            try {
                pendingByArrival = [];
                lastAppliedArrivalTs = performance.now();
                renderDelayMs = MIN_DELAY_MS;
            } catch(_) {}
        });


        // Handle state diff updates: enqueue with arrival timestamp for delay buffer playback
        socket.on('stateDiff', (data) => {
            const t = performance.now();
            pendingByArrival.push({ t, diff: data && data.diff });
        });

        // Start lightweight keepalive to ensure server hears from us even when idle
        if (heartbeatIntervalId) {
            clearInterval(heartbeatIntervalId);
        }
        heartbeatIntervalId = setInterval(() => {
			if (socket && socket.connected) {
                socket.emit('inputDiff', { frame: inputState.frame, keepalive: true });
            }
        }, 500);
    }

    function setupKeyboardControls() {
        window.addEventListener('keydown', (e) => {
            let key = e.key.toLowerCase();
            // Normalize spacebar across browsers (e.key can be ' ', 'Spacebar'; e.code is 'Space')
            if (e.code === 'Space' || key === ' ' || key === 'spacebar') {
                key = 'space';
                // Prevent page scroll on space
                e.preventDefault();
            }
            // Map arrow keys to WASD for left-handed players
            if (key === 'arrowup') key = 'w';
            else if (key === 'arrowdown') key = 's';
            else if (key === 'arrowleft') key = 'a';
            else if (key === 'arrowright') key = 'd';
            if (inputState.keys.hasOwnProperty(key)) {
                inputState.keys[key] = true;
            }
            
            // ESC key exits pointer lock (unless picker is open)
            if (e.key === 'Escape') {
                if (showPicker) {
                    // handled by picker
                } else {
                    document.exitPointerLock();
                }
            }
            
            // Piece selection with - and = keys
            if (e.key === '-' || e.key === '_') {
                changePiece(-1);
            } else if (e.key === '=' || e.key === '+') {
                changePiece(1);
            } else if (e.key === ',') {
                changeColor(-1);
            } else if (e.key === '.') {
                changeColor(1);
            } else if (key === 'z') {
                // Rotate counter-clockwise by 90 degrees
                ghostYaw -= Math.PI / 2;
                // Normalize to [-PI, PI] range to keep numbers small
                if (ghostYaw <= -Math.PI) ghostYaw += Math.PI * 2;
                renderer3d.setGhostYaw(ghostYaw);
            } else if (key === 'x') {
                // Rotate clockwise by 90 degrees
                ghostYaw += Math.PI / 2;
                if (ghostYaw > Math.PI) ghostYaw -= Math.PI * 2;
                renderer3d.setGhostYaw(ghostYaw);
            } else if (e.key === "'" || e.code === 'Quote') {
                // Delegate cycling to server; keep client thin
                inputState.events.push({ type: 'cycleAnchor', delta: 1 });
            } else if (e.key === ';' || e.code === 'Semicolon') {
                // Delegate reverse cycling to server; keep client thin
                inputState.events.push({ type: 'cycleAnchor', delta: -1 });
            } else if (e.key === '`' || e.code === 'Backquote') {
                // Toggle chunk debug helpers
                if (renderer3d && renderer3d.setChunkDebugVisible) {
                    // Flip the renderer-side state by reading from a local flag we keep in sync
                    chunkDebugVisible = !chunkDebugVisible;
                    renderer3d.setChunkDebugVisible(chunkDebugVisible);
                }
            } else if (key === 'c') {
                // Toggle simple third-person follow camera (debug)
                isThirdPerson = !isThirdPerson;
            } else if (key === 'p') {
                if (!showPicker) {
                    // Open picker overlay
                    showPicker = true;
                    recaptureOnNextEscUp = false;
                    // Disable preview rotation render while picker open
                    if (renderer3d && renderer3d.setPreviewEnabled) renderer3d.setPreviewEnabled(false);
                    // Release pointer lock so mouse can be used
                    if (document.pointerLockElement === container) {
                        document.exitPointerLock();
                    }
                } else {
                    // Close picker and resume gameplay
                    showPicker = false;
                    recaptureOnNextEscUp = false;
                    if (renderer3d && renderer3d.setPreviewEnabled) renderer3d.setPreviewEnabled(true);
                    if (container && container.requestPointerLock) {
                        try { container.requestPointerLock(); } catch(_) {}
                    }
                }
            } else if (key === 'r') {
                // Eyedropper: pick hovered piece, color, and rotation (yaw)
                if (showPicker) return; // ignore while picker open
                const hoveredBrickId = renderer3d && renderer3d.getPickedBrickId && renderer3d.getPickedBrickId();
                if (!hoveredBrickId) return;
                // Resolve pieceId and colorIndex from game state (prefer brickIndex if present)
                let pieceId = null;
                let brickColorIndex = null;
                let sampledBrick = null;
                if (gameState && gameState.brickIndex && gameState.brickIndex[hoveredBrickId]) {
                    const ck = gameState.brickIndex[hoveredBrickId];
                    const chunk = gameState.chunks && gameState.chunks[ck];
                    const b = chunk && chunk.bricks && chunk.bricks[hoveredBrickId];
                    sampledBrick = b || null;
                    pieceId = b && b.pieceId;
                    if (b && b.colorIndex != null) brickColorIndex = b.colorIndex | 0;
                } else if (gameState && gameState.chunks) {
                    for (const [ck, chunk] of Object.entries(gameState.chunks)) {
                        const b = chunk && chunk.bricks && chunk.bricks[hoveredBrickId];
                        if (b && b.pieceId) { sampledBrick = b; pieceId = b.pieceId; if (b.colorIndex != null) brickColorIndex = b.colorIndex | 0; break; }
                    }
                }
                if (!pieceId || !Array.isArray(pieceList) || pieceList.length === 0) return;
                // Sample yaw rotation from the brick if available
                let sampledYaw = 0;
                if (sampledBrick && sampledBrick.rotation && typeof sampledBrick.rotation.y === 'number') {
                    sampledYaw = sampledBrick.rotation.y;
                }
                const targetIndex = pieceList.findIndex((p) => p && String(p.id) === String(pieceId));
                if (targetIndex < 0) return;
                // Compute shortest wrap delta and request change via server
                const n = pieceList.length | 0;
                const cur = selectedPieceIndex | 0;
                let d = ((targetIndex - cur) % n + n) % n;
                let dBack = d - n;
                const delta = (Math.abs(dBack) < d) ? dBack : d;
                // If the piece is already selected, avoid sending a pieceChange event
                if (delta !== 0) {
                    // Mark that we want to preserve sampled yaw when the server echoes the piece change
                    preserveYawOnNextPieceChange = true;
                    pendingSampledYaw = 0; // will set below if available
                    changePiece(delta);
                }
                // Also pick the color if available
                if (Number.isFinite(brickColorIndex)) {
                    const clamped = Math.max(0, Math.min(brickColorHexes.length - 1, brickColorIndex | 0));
                    setColor(clamped);
                }
                // Apply sampled yaw after piece change (since changePiece resets yaw)
                if (typeof sampledYaw === 'number') {
                    if (delta === 0) {
                        // No piece change; apply immediately
                        ghostYaw = sampledYaw;
                        renderer3d.setGhostYaw(ghostYaw);
                    } else {
                        // Defer until server echo of selectedPieceIndex so our local reset doesn't override
                        pendingSampledYaw = sampledYaw;
                    }
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            let key = e.key.toLowerCase();
            if (e.code === 'Space' || key === ' ' || key === 'spacebar') {
                key = 'space';
                e.preventDefault();
            }
            // Map arrow keys to WASD for left-handed players
            if (key === 'arrowup') key = 'w';
            else if (key === 'arrowdown') key = 's';
            else if (key === 'arrowleft') key = 'a';
            else if (key === 'arrowright') key = 'd';
            if (inputState.keys.hasOwnProperty(key)) {
                inputState.keys[key] = false;
            }
            // If we just closed picker due to ESC, recapture on ESC keyup
            if ((e.key === 'Escape' || key === 'escape') && recaptureOnNextEscUp) {
                recaptureOnNextEscUp = false;
                if (container && container.requestPointerLock) {
                    try { container.requestPointerLock(); } catch(_) {}
                }
            }
        });
    }
    
    function changePiece(direction) {
        // Reset rotation when switching piece locally for UX
        ghostYaw = 0;
        renderer3d.setGhostYaw(ghostYaw);
        // Let server change the selected piece authoritatively
        inputState.events.push({ type: 'pieceChange', delta: direction });
    }

    function changeColor(direction) {
        const n = brickColorHexes.length;
        selectedColorIndex = n > 0 ? (((selectedColorIndex + direction) % n + n) % n) : 0;
        renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
        inputState.events.push({ type: 'colorChange', delta: direction });
    }

    function setColor(index) {
        const clamped = Math.max(0, Math.min(brickColorHexes.length - 1, index));
        if (clamped === selectedColorIndex) return;
        selectedColorIndex = clamped;
        renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
        inputState.events.push({ type: 'setColor', index: clamped });
    }

    function sendInput() {
        if (!socket || !socket.connected) return;

        // Update mouse ray and currently picked brick id (if any)
        const mouseRay = renderer3d.getMouseWorldPosition();
        inputState.mouse.x = mouseRay.x;
        inputState.mouse.y = mouseRay.y;
        inputState.mouse.z = mouseRay.z;
        const pickedBrickId = renderer3d.getPickedBrickId && renderer3d.getPickedBrickId();
        inputState.mouse.brickId = pickedBrickId || null;

        // Update camera rotation
        inputState.camera.yaw = yaw;
        inputState.camera.pitch = pitch;

        // Generate diff
        const diff = inputState._diff();
        
        if (diff) {
            // Request server-computed ghost pose each frame using minimal inputs
            if (pieceList[selectedPieceIndex] && renderer3d.canPlaceNow && renderer3d.canPlaceNow()) {
                const ghost = {
                    // Do not send pieceId/anchor selection; server uses authoritative player state
                    yaw: ghostYaw,
                    closestStud: (renderer3d.getClosestStudInfo && renderer3d.getClosestStudInfo()) || null,
                    closestAntiStud: (renderer3d.getClosestAntiStudInfo && renderer3d.getClosestAntiStudInfo()) || null,
                };
                const gr = renderer3d.getGhostRotationEuler && renderer3d.getGhostRotationEuler();
                if (gr && typeof gr.x === 'number') {
                    ghost.rotation = { x: gr.x, y: gr.y, z: gr.z };
                }
                diff.ghost = ghost;
            }
            // Add frame counter for RTT
            diff.frame = inputState.frame;
            
            // Track frame for RTT measurement
            sentFrames.set(inputState.frame, Date.now());
            
            // Clean up old frames
            if (sentFrames.size > 100) {
                const oldestFrame = inputState.frame - 100;
                for (const [frame, _] of sentFrames) {
                    if (frame < oldestFrame) {
                        sentFrames.delete(frame);
                    }
                }
            }
            
            socket.emit('inputDiff', diff);
            
            // Clear dirty state and events
            inputState._clear();
            inputState.events = [];
        }
        
        // Increment frame counter
        inputState.frame++;
    }

    function updateClosestStud() { /* handled in renderer */ }

    function getMouseWorldPosition() { return renderer3d.getMouseWorldPosition(); }

    function createBrickMesh(brick) { renderer3d.createBrickMesh(brick); }

    function removeBrickMesh(brickId) { renderer3d.removeBrickMesh(brickId); }

    function createPlayerMesh(playerData) { renderer3d.createPlayerMesh(playerData); }

    function updatePlayerMesh(playerData) { renderer3d.updatePlayerMesh(playerData); }

    function removePlayerMesh(playerId) { renderer3d.removePlayerMesh(playerId); }

    // Apply a single state diff (used both live and when draining backlog)
    function applySingleStateDiff(diff) {
        // Apply diff to game state
        applyDiff(gameState, diff);
        // Trigger Svelte reactivity by reassigning gameState to itself
        gameState = gameState;
        // Players
        if (diff.players) {
            for (const [pid, playerDiff] of Object.entries(diff.players)) {
                if (playerDiff._deleted) {
                    renderer3d.removePlayerMesh(pid);
                } else if (playerDiff._new) {
                    renderer3d.createPlayerMesh({ id: pid, ...gameState.players[pid] });
                } else {
                    if (playerDiff.colorLegs !== undefined || playerDiff.colorTorso !== undefined) {
                        renderer3d.createPlayerMesh({ id: pid, ...gameState.players[pid] });
                    } else {
                        renderer3d.updatePlayerMesh({ id: pid, ...gameState.players[pid] });
                    }
                }
                // Local player-specific updates
                if (pid === playerId) {
                    const player = gameState.players[playerId];
                    if (player) {
                        if (player.selectedPieceIndex !== undefined && player.selectedPieceIndex !== selectedPieceIndex) {
                            selectedPieceIndex = player.selectedPieceIndex;
                            if (preserveYawOnNextPieceChange && typeof pendingSampledYaw === 'number') {
                                ghostYaw = pendingSampledYaw;
                                preserveYawOnNextPieceChange = false;
                                pendingSampledYaw = 0;
                            } else {
                                ghostYaw = 0;
                            }
                            renderer3d.setSelectedPieceIndex(selectedPieceIndex);
                            renderer3d.setGhostYaw(ghostYaw);
                        }
                        if (player.selectedColorIndex !== undefined && player.selectedColorIndex !== selectedColorIndex) {
                            selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, player.selectedColorIndex));
                            renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
                        }
                        if (Number.isFinite(player.selectedAntiStudIndex) && player.selectedAntiStudIndex !== selectedAntiStudIndex) {
                            selectedAntiStudIndex = Math.max(0, player.selectedAntiStudIndex | 0);
                            renderer3d.setSelectedAntiStudIndex(selectedAntiStudIndex);
                        }
                        if (Number.isFinite(player.selectedStudIndex) && player.selectedStudIndex !== selectedStudIndex) {
                            selectedStudIndex = Math.max(0, player.selectedStudIndex | 0);
                            if (renderer3d && renderer3d.setSelectedStudIndex) {
                                renderer3d.setSelectedStudIndex(selectedStudIndex);
                            }
                        }
                        if (typeof player.anchorMode === 'string' && player.anchorMode !== anchorMode) {
                            anchorMode = player.anchorMode;
                            if (renderer3d && renderer3d.setAnchorMode) {
                                renderer3d.setAnchorMode(anchorMode);
                            }
                        }
                        // RTT calculation (latest encountered wins)
                        if (player.lastFrameCounter !== undefined) {
                            const sentTime = sentFrames.get(player.lastFrameCounter);
                            if (sentTime) {
                                currentRTT = Date.now() - sentTime;
                                smoothedRTT = smoothedRTT === 0 ? currentRTT : smoothedRTT * 0.99 + currentRTT * 0.01;
                                sentFrames.delete(player.lastFrameCounter);
                            }
                        }
                        if (player.ghostPose) {
                            renderer3d.applyAuthoritativeGhostPose(player.ghostPose);
                        }
                        if (typeof player.ghostColliding === 'boolean') {
                            renderer3d.setGhostCollisionVisual(player.ghostColliding);
                        }
                    }
                }
            }
        }
        // Bricks/chunks
        if (diff.chunks) {
            renderer3d.reconcileChunksAndBricks(gameState.chunks, {});
            if (chunkDebugVisible && renderer3d && renderer3d.setChunkDebugVisible) {
                renderer3d.setChunkDebugVisible(true);
            }
            for (const [ckey, cDiff] of Object.entries(diff.chunks)) {
                const chunk = gameState.chunks && gameState.chunks[ckey];
                if (cDiff && cDiff._deleted) {
                    if (renderer3d && renderer3d.removeChunkGroupAndInstances) {
                        renderer3d.removeChunkGroupAndInstances(ckey);
                    }
                    continue;
                }
                if (!chunk) continue;
                if (cDiff && cDiff._new) {
                    const bricksMap = (chunk && chunk.bricks) || {};
                    for (const [bid, b] of Object.entries(bricksMap)) {
                        renderer3d.createBrickMesh({ id: bid, chunkKey: ckey, ...b });
                    }
                    continue;
                }
                if (cDiff && cDiff.bricks) {
                    for (const [bid, bDiff] of Object.entries(cDiff.bricks)) {
                        if (bDiff && bDiff._deleted) {
                            if (renderer3d && renderer3d.removeBrickInChunk) renderer3d.removeBrickInChunk(ckey, bid);
                        } else if (bDiff && bDiff._new) {
                            const brick = chunk && chunk.bricks ? chunk.bricks[bid] : null;
                            if (brick) renderer3d.createBrickMesh({ id: bid, chunkKey: ckey, ...brick });
                        }
                    }
                }
            }
        }
    }

    function drainPendingDiffs(maxToProcess = Infinity) {
        if (!pendingStateDiffs.length) return 0;
        let processed = 0;
        while (pendingStateDiffs.length && processed < maxToProcess) {
            const evt = pendingStateDiffs.shift();
            if (evt && evt.diff) {
                applySingleStateDiff(evt.diff);
            }
            processed++;
        }
        return processed;
    }

    function processBacklogAndMaybeSkip() {
        if (pendingStateDiffs.length <= 0) return false;
        const maxToProcess = (pendingStateDiffs.length > BACKLOG_SKIP_THRESHOLD && framesSinceLastFullLoop < BACKLOG_LIMIT)
            ? BACKLOG_LIMIT
            : Infinity;
        drainPendingDiffs(maxToProcess);
        if (pendingStateDiffs.length > 0 && framesSinceLastFullLoop < BACKLOG_LIMIT) {
            framesSinceLastFullLoop++;
            return true;
        }
        return false;
    }



    function onWindowResize() { renderer3d && renderer3d.onResize(); }

	function tick() {
		// Apply diffs using simple delay buffer based on arrival time
		const now = performance.now();
		const cutoff = now - renderDelayMs;
		while (pendingByArrival.length && pendingByArrival[0].t <= cutoff) {
			const evt = pendingByArrival.shift();
			lastAppliedArrivalTs = evt.t;
			if (evt && evt.diff) {
				applySingleStateDiff(evt.diff);
			}
		}
		// Adjust delay to avoid underflow/overflow
		if (pendingByArrival.length === 0) {
			// Buffer empty: reduce delay slowly to lower latency after sustained emptiness
			if (!bufferEmptySinceTs) bufferEmptySinceTs = now;
			else if (now - bufferEmptySinceTs >= 1000) {
				renderDelayMs = Math.max(MIN_DELAY_MS, renderDelayMs - 5);
				bufferEmptySinceTs = now;
			}
		} else {
			bufferEmptySinceTs = 0;
			const spanMs = pendingByArrival[pendingByArrival.length - 1].t - pendingByArrival[0].t;
			const margin = 8; // hysteresis to avoid twitchy adjustments
			if (spanMs > renderDelayMs + margin) {
				// Buffer is larger than current delay can cover: bump delay upward proportionally
				const err = spanMs - renderDelayMs;
				const step = Math.min(OVERFLOW_TRIM_MS, Math.max(5, Math.round(err * 0.5)));
				renderDelayMs = Math.min(MAX_DELAY_MS, renderDelayMs + step);
			} else if (spanMs < renderDelayMs - 2 * margin) {
				// We are delaying more than needed: slowly bring delay down
				renderDelayMs = Math.max(MIN_DELAY_MS, renderDelayMs - 1);
			}
			// Safety: if span explodes far beyond cap, nudge more aggressively
			if (spanMs > MAX_BUFFER_MS) {
				renderDelayMs = Math.min(MAX_DELAY_MS, Math.max(renderDelayMs, spanMs - margin));
			}
		}

		// Apply any queued diffs first. Only skip the frame if there is a real backlog,
		// but force a full loop at least every 10 frames to keep visuals responsive.
		if (processBacklogAndMaybeSkip()) return;
		if (!renderer3d || !renderer3d.renderTick) return;
		// Measure CPU time for this frame's update + render
		const t0 = performance.now();
		// Send input to server
		sendInput();
		const localPlayer = gameState.players[playerId];
		const localWithId = localPlayer ? { id: playerId, ...localPlayer } : null;
		const isMoving = !!(inputState.keys.w || inputState.keys.a || inputState.keys.s || inputState.keys.d);
		renderer3d.renderTick(localWithId, yaw, pitch, isThirdPerson, isMoving);
		cpuMs = performance.now() - t0;
		framesSinceLastFullLoop = 0; // reset after a full loop
		const rs = renderer3d.getRenderStats && renderer3d.getRenderStats();
		if (rs) {
			drawCalls = rs.drawCalls | 0; triangles = rs.triangles | 0;
			if (Number.isFinite(rs.gpuMs)) gpuMs = rs.gpuMs;
		}
	}

    function handlePointerMove(event) {
        // Only handle mouse look if pointer is locked
        if (document.pointerLockElement === container) {
            // Use movementX/Y for proper FPS mouse look
            const deltaX = event.movementX || 0;
            const deltaY = event.movementY || 0;
            
            // Update yaw (left/right rotation) - positive yaw = looking right
            yaw -= deltaX * mouseSensitivity;
            
            // Update pitch (up/down rotation) - negative pitch = looking up
            pitch -= deltaY * mouseSensitivity;
            
            // Clamp pitch to prevent over-rotation (looking too far up/down)
            const maxPitch = Math.PI / 2 - 0.1; // Just shy of 90 degrees
            pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        }
    }

    function handlePointerDown(event) {
        // If picker is open, ignore game clicks
        if (showPicker) return;
        // Request pointer lock for FPS-style mouse controls
        if (document.pointerLockElement !== container) {
            container.requestPointerLock();
            return; // Don't send click event when just capturing the mouse
        }
        
        // For left-click placement, require canPlaceNow(); for right-click deletion, require a picked brick
        if (event.button === 0) {
            if (renderer3d.canPlaceNow && !renderer3d.canPlaceNow()) {
                return; // Not placeable at this moment
            }
        } else if (event.button === 2) {
            const picked = renderer3d.getPickedBrickId && renderer3d.getPickedBrickId();
            if (!picked) {
                return; // No hovered brick to delete
            }
        }
        
        // Enqueue click event
        inputState.events.push({
            type: 'click',
            button: event.button, // 0 = left, 2 = right
            closestStud: (renderer3d.getClosestStudInfo && renderer3d.getClosestStudInfo()) || null,
            closestAntiStud: (renderer3d.getClosestAntiStudInfo && renderer3d.getClosestAntiStudInfo()) || null,
            rotation: (() => { const r = renderer3d.getGhostRotationEuler && renderer3d.getGhostRotationEuler(); return r ? { x: r.x, y: r.y, z: r.z } : { x: 0, y: 0, z: 0 }; })(),
            rotationY: ghostYaw,
            brickId: (renderer3d.getPickedBrickId && renderer3d.getPickedBrickId()) || null,
        });
    }

    function handleWheel(event) {
        event.preventDefault();
        // Wheel events can be used for other first-person game features like switching tools
        // For now, we'll just prevent the default behavior
    }
    
    // Keep global resize setup and begin animator immediately; tick() is guarded until renderer is ready
    handleResize();
    animator.start();
</script>

    <FourByThreeScreen bg="black">
        <div class="flex-center-all h-full w-full relative">
            {#if showStart}
                <StartScreen />
            {:else}
        <!-- Three.js container -->
            <div
            bind:this={container}
            class="w-full h-full cursor-crosshair"
            style="contain: layout paint; touch-action: none;"
            role="application"
            aria-label="BrickQuest 3D game view"
            on:pointermove={handlePointerMove}
            on:pointerdown={handlePointerDown}
            on:wheel={handleWheel}
            on:contextmenu|preventDefault
        />

        <!-- Loading indicator -->
        {#if loadingText}
            <div class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-20">
                <div class="text-white text-2xl text-center">
                    <div class="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4" style="will-change: transform;" />
                    {loadingText}
                </div>
            </div>
        {/if}

		<!-- Connection lost overlay -->
		{#if !isConnected}
			<div class="absolute inset-0 flex items-center justify-center z-30">
				<div class="px-6 py-4 rounded-xl bg-black bg-opacity-70 text-white text-2xl">
					NOT CONNECTED TO SERVER
				</div>
			</div>
		{/if}

        <!-- Crosshair -->
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
            <div class="w-1 h-1 bg-white rounded-full opacity-80"></div>
        </div>

		<!-- UI Overlay -->
		<div class="absolute top-4 left-4 w-64 text-white text-sm bg-black bg-opacity-50 p-2 rounded pointer-events-none" style="contain: paint;">
			<div class="pointer-events-auto">
				<button
					class="w-full flex items-center justify-between gap-2 px-2 py-1 bg-black/40 rounded hover:bg-black/60 transition-colors"
					on:click={() => (showStats = !showStats)}
				>
					<span class="font-medium">Stats</span>
					<span class="transform transition-transform" class:rotate-180={showStats}>▼</span>
				</button>
				<div
					class="mt-2 overflow-hidden transition-all duration-200"
					class:max-h-0={!showStats}
					class:opacity-0={!showStats}
					class:max-h-[24rem]={showStats}
					class:opacity-100={showStats}
				>
					<div>CPU ms: {cpuMs.toFixed(1)}</div>
					<div>GPU ms: {gpuMs.toFixed(1)}</div>
					<div>draw calls: {drawCalls}</div>
					<div>triangles: {triangles}</div>
					<div>Render delay ms: {Math.round(renderDelayMs)}</div>
					<div>Delay buffer span ms: {pendingByArrival.length > 1 ? Math.round(pendingByArrival[pendingByArrival.length - 1].t - pendingByArrival[0].t) : 0}</div>
					<div>Delay buffer items: {pendingByArrival.length}</div>
					<div>Bricks: {Object.values(gameState.chunks||{}).reduce((n,c)=>n+Object.keys((c&&c.bricks)||{}).length,0)}</div>
					<div>Players: {Object.keys(gameState.players).length}</div>
					<div>RTT: {Math.round(smoothedRTT)}ms Current: {currentRTT}</div>
					{#if gameState.players && playerId && gameState.players[playerId]}
						<div>Ghost broad: {gameState.players[playerId].ghostBroadCount || 0}</div>
						<div>Ghost post-prune: {gameState.players[playerId].ghostPrunedCount || 0}</div>
						<div class="mt-1">Ghost timings (ms):</div>
						<div>&nbsp;&nbsp;aabb: {Number(gameState.players[playerId].ghostTimingAabbMs || 0).toFixed(2)}</div>
						<div>&nbsp;&nbsp;broad: {Number(gameState.players[playerId].ghostTimingBroadMs || 0).toFixed(2)}</div>
						<div>&nbsp;&nbsp;build: {Number(gameState.players[playerId].ghostTimingBuildMs || 0).toFixed(2)}</div>
						<div>&nbsp;&nbsp;narrow: {Number(gameState.players[playerId].ghostTimingNarrowMs || 0).toFixed(2)}</div>
						<div>&nbsp;&nbsp;total: {Number(gameState.players[playerId].ghostTimingTotalMs || 0).toFixed(2)}</div>
					{/if}
				</div>
			</div>
			<div class="text-sm mt-4 pointer-events-auto">
				<div>Click to capture mouse</div>
				<div>ESC to release mouse</div>
				<div>Left Click: Place Brick</div>
				<div>Right Click: Remove Brick</div>
				<div>WASD: Move</div>
				<div>Space: Jump</div>
				<div>Mouse: Look Around</div>
				<div>- / = : Switch Piece</div>
				<div>Z / X : Rotate Piece</div>
				<div>, / . : Switch Color</div>
				<div>R : Pick Hovered Piece + Color + Rotation</div>
				<div>' : Cycle anti-stud</div>
			</div>
		</div>

        <!-- Color palette (bottom-left) -->
        <div class="absolute bottom-4 left-4 z-20" style="contain: paint;">
            <ColorPalette
                colors={brickColorHexes}
                selectedIndex={selectedColorIndex}
                ariaLabelPrefix="Select color"
                on:change={(e) => setColor(e.detail)}
            />
        </div>

        <!-- Piece preview (bottom-right) -->
        <div class="absolute bottom-4 right-4 z-20" style="contain: paint;">
                <div 
                    bind:this={previewContainer}
                    class="w-[13rem] h-[13rem] rounded-xl bg-gray-900 bg-opacity-50"
                    style="contain: layout paint;"
                />
                {#if pieceList.length > 0 && pieceList[selectedPieceIndex]}
                    <div class="text-white text-lg text-center -mt-8 max-w-[13rem] truncate">
                        {pieceList[selectedPieceIndex].name}
                    </div>
                    <div class="absolute text-gray-500 text-sm text-center -mt-12 max-w-[13rem] truncate">
                        {pieceList[selectedPieceIndex].id}
                    </div>
                {/if}
        </div>

        {#if showPicker}
            <Picker
                {pieceList}
                {renderer3d}
                {selectedPieceIndex}
                on:select={(e) => {
                    const i = e.detail;
                    // Send delta to server based on current index to target index
                    const n = pieceList.length | 0;
                    if (n > 0 && Number.isFinite(i)) {
                        const cur = selectedPieceIndex | 0;
                        // compute shortest wrap delta
                        let d = ((i - cur) % n + n) % n; // forward distance
                        let dBack = d - n; // backward distance (negative)
                        const delta = (Math.abs(dBack) < d) ? dBack : d;
                        changePiece(delta);
                    }
                    showPicker = false;
                    if (renderer3d && renderer3d.setPreviewEnabled) renderer3d.setPreviewEnabled(true);
                    // Recapture pointer lock for gameplay
                    if (container && container.requestPointerLock) {
                        try { container.requestPointerLock(); } catch(_) {}
                    }
                }}
                on:close={() => {
                    showPicker = false;
                    if (renderer3d && renderer3d.setPreviewEnabled) renderer3d.setPreviewEnabled(true);
                    if (container && container.requestPointerLock) {
                        try { container.requestPointerLock(); } catch(_) {}
                    }
                }}
            />
        {/if}

        <CloseButton />
            {/if}
    </div>
</FourByThreeScreen>

<style>
    :global(canvas) {
        display: block;
    }
</style>
