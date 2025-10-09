<script>
    // @ts-nocheck
    import { onMount, tick as nextTick } from "svelte";
    import { pop } from "../../router";
    import { handleResize } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import { Animator, frameCount, animateCount } from "../../animator";
    import { createBrickQuestFragglRenderer } from "./renderer/fragglRenderer.js";
    import Fast2dBQ from "./overlay/Fast2dBQ.svelte";
    import GraphRTBQ from "./overlay/GraphRTBQ.svelte";
    import FastLineBQ from "./overlay/FastLineBQ.svelte";
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
    
    // RTT + server time sync
    let sentFrames = new Map(); // frame -> client send timestamp
    let currentRTT = 0;
    let smoothedRTT = 0;
    let serverTimeOffsetMs = 0; // clientNow - serverNow ≈ oneWay + offset; we use EMA
    const PLAYOUT_DELAY_MS = 17; // target ~1 frame on LAN/metro
    // Server-time-ordered buffer
    const MAX_BUFFER_SIZE = 120;
    let pendingByServerTime = []; // [{ tServer: number, diff }], sorted by tServer ascending
    // Track frame time for pacing
    const SERVER_RATE_HZ = 60;
    let lastFrameNow = 0;
    let consumeAcc = 0; // expected diffs to consume based on server rate
    // Adaptive playout + backlog catch-up controls (conservative)
    const BASE_DELAY_MS = PLAYOUT_DELAY_MS; // baseline target delay
    const MAX_DELAY_MS = 100; // upper bound to avoid noticeable lag
    const TARGET_BACKLOG_MS = 34; // aim for ~2 frames of buffered diffs
    const MAX_EXTRA_PER_FRAME = 3; // conservative catch-up cap
    const MS_PER_TICK = 1000 / SERVER_RATE_HZ;
    let dynamicDelayMs = BASE_DELAY_MS; // slowly adjusted delay
    let backlogMsSmoothed = 0; // EMA of backlog to tail
    let underrunEMA = 0; // EMA of underruns (eligible==0)

    let showStart = true; // DEBUG: Skip start screen
    let showPicker = false;
    let recaptureOnNextEscUp = false; // when picker closed via ESC, recapture on keyup

	// Performance HUD (per-frame timing)
	let cpuMs = 0;
	let gpuMs = 0;
	let drawCalls = 0;
	let triangles = 0;
	let diffsPerFrame = 0;
	let showStats = false; // HUD stats collapsed by default
	let chunkDebugVisible = false; // toggled with backtick
	// Preserve yaw across server-selected piece echo after eyedrop
	let preserveYawOnNextPieceChange = false;
	let pendingSampledYaw = 0;

	// Time To First Playable (TTFP) minimal tracking
	let ttfpStartTs = 0;
	let ttfpLogged = false;

	// Realtime graph series for CPU ms
	const cpuSeries = { key: 'cpu', color: [0.2, 0.8, 1.0], values: [] };
	const gpuSeries = { key: 'gpu', color: [1.0, 0.3, 0.3], values: [] };
	const diffsSeries = { key: 'diffs', color: [0.7, 1.0, 0.3], values: [] };

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
            
            // Clean up event listeners
            window.removeEventListener("resize", onWindowResize);
            
            // Clean up animator
            animator.stop();
            
            // Clean up socket and its event handlers
            if (socket) {
                socket.off('connect');
                socket.off('disconnect');
                socket.off('connect_error');
                socket.off('reconnect');
                socket.off('init');
                socket.off('stateDiff');
                socket.disconnect();
                socket = null;
            }
            
            // Clean up intervals
            if (heartbeatIntervalId) { 
                clearInterval(heartbeatIntervalId); 
                heartbeatIntervalId = null; 
            }
            
            // Clean up renderer
            if (renderer3d) {
                renderer3d.dispose();
                renderer3d = null;
            }
            
			// Clean up data structures
            sentFrames.clear();
            pendingByArrival.length = 0;
            cpuSeries.values.length = 0;
            gpuSeries.values.length = 0;
			diffsSeries.values.length = 0;
        };
    });

    async function safeStartGame() {
        if (!ttfpStartTs) { ttfpStartTs = performance.now(); }
        ttfpLogged = false;
        if (!renderer3d) {
            await initThree();
        }
        initNetworking();
    }

    async function initThree() {
        renderer3d = createBrickQuestFragglRenderer(container, {
            colorPalette: brickColorHexes,
            onLoadingTextChange: (t) => (loadingText = t),
            onError: (e) => {
                console.error("Renderer error:", e);
                loadingText = "Error loading model";
            },
        });
        renderer3d.setGameStateProvider(() => gameState);
        renderer3d.setData({ pieceList, piecesData });
        renderer3d.setChunkConfig(null);
        renderer3d.setChunkDebugVisible(chunkDebugVisible);
        await renderer3d.init();
        window.addEventListener("resize", onWindowResize);
        await nextTick();
        if (previewContainer && renderer3d.setupPreview) {
            renderer3d.setupPreview(previewContainer);
            if (renderer3d.setSelectedColorIndex) {
                renderer3d.setSelectedColorIndex(selectedColorIndex);
            }
        }
    }



    function setGhostCollisionVisual(colliding) {
        renderer3d && renderer3d.setGhostCollisionVisual(colliding);
    }

    function initNetworking() {
        // Resolve server URL from StartScreen; if blank/missing, use same-origin via Vite proxy
        const savedUrlRaw = (typeof localStorage !== 'undefined' && localStorage.getItem('brickquest_server_url')) || '';
        let serverUrl = (typeof savedUrlRaw === 'string' ? savedUrlRaw.trim() : '');
        // Prevent mixed content: if page is https and stored URL is http, fall back to same-origin proxy
        try {
            if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && /^http:\/\//i.test(serverUrl)) {
                console.warn('[BrickQuest] Insecure server URL on HTTPS page; using same-origin proxy instead');
                serverUrl = '';
            }
        } catch (_) {}
        const name = (typeof localStorage !== 'undefined' && localStorage.getItem('brickquest_player_name')) || `builder${Math.floor(100 + Math.random()*900)}`;

        // Desired local player colors from StartScreen (indices into brickColorHexes)
        const legsIdx = Math.max(0, Math.min(brickColorHexes.length - 1, parseInt(localStorage.getItem('brickquest_color_legs_idx') || '1', 10)));
        const torsoIdx = Math.max(0, Math.min(brickColorHexes.length - 1, parseInt(localStorage.getItem('brickquest_color_torso_idx') || '1', 10)));
        const desiredLegsColor = brickColorHexes[isFinite(legsIdx) ? legsIdx : 1] | 0;
        const desiredTorsoColor = brickColorHexes[isFinite(torsoIdx) ? torsoIdx : 1] | 0;

        // Connect to the server and send preferred colors up-front in auth payload
        console.time('[BrickQuest] socket to init');
        console.time('[BrickQuest] socket connect');
        const sockOpts = {
            path: '/socket.io',
            transports: ['websocket'],
            upgrade: false,
            auth: { colorLegs: desiredLegsColor, colorTorso: desiredTorsoColor, name }
        };
        // If a server URL is provided, connect directly; otherwise use same-origin (Vite proxy)
        socket = serverUrl ? io(serverUrl, sockOpts) : io(sockOpts);

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
                if (renderer3d.setSelectedStudIndex) {
                    renderer3d.setSelectedStudIndex(selectedStudIndex);
                }
                if (renderer3d.setAnchorMode) {
                    renderer3d.setAnchorMode(anchorMode);
                }
                console.timeEnd('[BrickQuest] init');
            }
            // Sync selected color index
            if (localPlayer && localPlayer.selectedColorIndex !== undefined) {
                selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, localPlayer.selectedColorIndex));
                renderer3d.setSelectedColorIndex(selectedColorIndex);
            }
            // Ensure ghost is created/updated after we know piece list and geometries
            renderer3d.setSelectedPieceIndex(selectedPieceIndex);

            // Initialize server time sync
            if (typeof data.serverNowMs === 'number') {
                const receiveNow = performance.now();
                // Assume symmetric latency: estimate server offset using RTT if available later; seed with raw
                serverTimeOffsetMs = receiveNow - data.serverNowMs - (smoothedRTT > 0 ? smoothedRTT * 0.5 : 0);
            }
            pendingByServerTime = [];
        });


        // Handle state diff updates: enqueue by server time for server-time playback
        socket.on('stateDiff', (data) => {
            const sNow = (data && typeof data.serverNowMs === 'number') ? data.serverNowMs : null;
            const diffPayload = data && data.diff;
            if (sNow == null || !diffPayload) return;
            // Compute RTT immediately on receipt (not delayed by playback)
            try {
                if (diffPayload.players && playerId && diffPayload.players[playerId]) {
                    const pDiff = diffPayload.players[playerId];
                    if (pDiff && typeof pDiff.lastFrameCounter === 'number') {
                        const sentTime = sentFrames.get(pDiff.lastFrameCounter);
                        if (sentTime) {
                            const nowD = Date.now();
                            currentRTT = nowD - sentTime;
                            smoothedRTT = smoothedRTT === 0 ? currentRTT : (smoothedRTT * 0.9 + currentRTT * 0.1);
                            sentFrames.delete(pDiff.lastFrameCounter);
                        }
                    }
                }
            } catch (_) {}
            // Update time sync offset using EMA with RTT/2 when available
            const receiveNow = performance.now();
            const estimatedOneWay = smoothedRTT > 0 ? smoothedRTT * 0.5 : 0;
            const estimateOffset = receiveNow - sNow - estimatedOneWay;
            serverTimeOffsetMs = (serverTimeOffsetMs === 0) ? estimateOffset : (serverTimeOffsetMs * 0.5 + estimateOffset * 0.5);
            // Insert while keeping array ordered by server time
            const item = { tServer: sNow, diff: diffPayload };
            let i = pendingByServerTime.length;
            if (i === 0 || pendingByServerTime[i - 1].tServer <= sNow) {
                pendingByServerTime.push(item);
            } else {
                // binary insert (simple linear due to small list)
                for (let k = 0; k < pendingByServerTime.length; k++) {
                    if (sNow < pendingByServerTime[k].tServer) { pendingByServerTime.splice(k, 0, item); break; }
                }
            }
            if (pendingByServerTime.length > MAX_BUFFER_SIZE) {
                pendingByServerTime = pendingByServerTime.slice(-MAX_BUFFER_SIZE);
            }
        });

        // Start lightweight keepalive to ensure server hears from us even when idle
        if (heartbeatIntervalId) {
            clearInterval(heartbeatIntervalId);
        }
        heartbeatIntervalId = setInterval(() => {
            if (socket && socket.connected) {
                // Record RTT sample for keepalive frames too
                sentFrames.set(inputState.frame, Date.now());
                socket.emit('inputDiff', { frame: inputState.frame, keepalive: true });
            }
        }, 100);
    }

    function handleKeyDown(e) {
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
    }

    function handleKeyUp(e) {
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
        renderer3d.setSelectedColorIndex(selectedColorIndex);
        inputState.events.push({ type: 'colorChange', delta: direction });
    }

    function setColor(index) {
        const clamped = Math.max(0, Math.min(brickColorHexes.length - 1, index));
        if (clamped === selectedColorIndex) return;
        selectedColorIndex = clamped;
        renderer3d.setSelectedColorIndex(selectedColorIndex);
        inputState.events.push({ type: 'setColor', index: clamped });
    }

    function sendInput() {
        if (!socket || !socket.connected) return;

        // Update mouse ray and currently picked brick id (if any)
        const mouseRay = renderer3d.getMouseWorldPosition();
        inputState.mouse.x = mouseRay?.x ?? 0;
        inputState.mouse.y = mouseRay?.y ?? 0;
        inputState.mouse.z = mouseRay?.z ?? 0;
        const pickedBrickId = renderer3d.getPickedBrickId();
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
                    closestStud: renderer3d.getClosestStudInfo() || null,
                    closestAntiStud: renderer3d.getClosestAntiStudInfo() || null,
                };
                const gr = renderer3d.getGhostRotationEuler();
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
                            renderer3d.setSelectedColorIndex(selectedColorIndex);
                            renderer3d.setSelectedAntiStudIndex(selectedAntiStudIndex);
                            if (renderer3d.setSelectedStudIndex) {
                                renderer3d.setSelectedStudIndex(selectedStudIndex);
                            }
                            if (renderer3d.setAnchorMode) {
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




    function onWindowResize() {
        renderer3d && renderer3d.onResize && renderer3d.onResize();
    }

	function tick() {
		if (!renderer3d || !renderer3d.renderTick) return;
		
		const now = performance.now();
		const dt = lastFrameNow ? (now - lastFrameNow) / 1000 : (1 / SERVER_RATE_HZ);
		lastFrameNow = now;
		consumeAcc += SERVER_RATE_HZ * dt;
		
		// Guard buffer size to prevent unbounded growth
		if (pendingByServerTime.length > MAX_BUFFER_SIZE) {
			const toDrop = pendingByServerTime.length - MAX_BUFFER_SIZE;
			pendingByServerTime = pendingByServerTime.slice(toDrop);
		}
		
		// Server-time playback with fractional consumption to avoid 0/2 bursts
		const serverNowEstimate = now - serverTimeOffsetMs;
		const basePlayback = serverNowEstimate - dynamicDelayMs;
		let cutoff = basePlayback;
		if (pendingByServerTime.length) {
			const nextTs = pendingByServerTime[0].tServer;
			const ahead = nextTs - basePlayback;
			if (ahead > 0 && ahead <= 6) cutoff = nextTs; // small snap-ahead window
		}
		// Count eligible diffs up to cutoff
		let eligible = 0;
		for (let i = 0; i < pendingByServerTime.length; i++) {
			if (pendingByServerTime[i].tServer <= cutoff) eligible++; else break;
		}
		// Backlog-aware catch-up (based on smoothed backlog-to-tail in ms)
		let backlogMs = 0;
		if (pendingByServerTime.length) {
			const tailTs = pendingByServerTime[pendingByServerTime.length - 1].tServer;
			backlogMs = Math.max(0, tailTs - cutoff);
		}
		backlogMsSmoothed = backlogMsSmoothed === 0 ? backlogMs : (backlogMsSmoothed * 0.9 + backlogMs * 0.1);
		const extra = Math.min(
			MAX_EXTRA_PER_FRAME,
			Math.max(0, Math.round((backlogMsSmoothed - TARGET_BACKLOG_MS) / MS_PER_TICK))
		);
		let diffsApplied = 0;
		let desired = Math.floor(consumeAcc) + extra;
		if (desired > 5) desired = 5; // overall cap
		const toApply = Math.min(desired, eligible);
		for (let i = 0; i < toApply; i++) {
			const evt = pendingByServerTime.shift();
			applySingleStateDiff(evt.diff);
			diffsApplied++;
		}
		consumeAcc -= diffsApplied;
		if (consumeAcc < 0) consumeAcc = 0;
		diffsPerFrame = diffsApplied;
		// Adaptive delay tuning to avoid oscillation (slow, conservative)
		underrunEMA = underrunEMA * 0.95 + (eligible === 0 ? 1 : 0) * 0.05;
		if (underrunEMA > 0.3) {
			// Frequently starving: increase delay slowly
			dynamicDelayMs = Math.min(MAX_DELAY_MS, dynamicDelayMs + 1);
		} else if (eligible >= 2 && backlogMsSmoothed < TARGET_BACKLOG_MS * 0.5) {
			// Plenty of headroom and small backlog: decrease delay slowly toward base
			dynamicDelayMs = Math.max(BASE_DELAY_MS, dynamicDelayMs - 1);
		}
		
        // No dynamic delay: fixed playout; just track how many we applied for HUD
		// Measure CPU time for this frame's update + render
		const t0 = performance.now();
		// Send input to server
		sendInput();
		const localPlayer = gameState.players[playerId];
		const localWithId = localPlayer ? { id: playerId, ...localPlayer } : null;
		const isMoving = !!(inputState.keys.w || inputState.keys.a || inputState.keys.s || inputState.keys.d);
		renderer3d.renderTick(localWithId, yaw, pitch, isThirdPerson, isMoving);
		cpuMs = performance.now() - t0;
		const rs = renderer3d.getRenderStats();
		if (rs) {
			drawCalls = rs.drawCalls | 0; triangles = rs.triangles | 0;
			// Use smoothed value for text display
			if (Number.isFinite(rs.gpuMs)) gpuMs = rs.gpuMs;
		}
		// Update realtime CPU/GPU/DIFFS graph series (cap length)
		if (Number.isFinite(cpuMs)) {
			cpuSeries.values.push(cpuMs);
			if (cpuSeries.values.length > 250) cpuSeries.values.shift();
		}
		// Graph uses raw unsmoothed values for more responsiveness
		if (rs && Number.isFinite(rs.gpuMsRaw)) {
			gpuSeries.values.push(rs.gpuMsRaw);
			if (gpuSeries.values.length > 250) gpuSeries.values.shift();
		}
		// Diffs per frame as a small integer series
		diffsSeries.values.push(diffsPerFrame);
		if (diffsSeries.values.length > 250) diffsSeries.values.shift();

		// One-time TTFP log: first frame when game is actually ready to play
		if (!ttfpLogged && ttfpStartTs && !loadingText && isConnected && playerId && gameState && gameState.players && gameState.players[playerId]) {
			const ms = performance.now() - ttfpStartTs;
			try { console.log(`[BrickQuest] Time to first playable: ${Math.round(ms)} ms`); } catch {}
			ttfpLogged = true;
			ttfpStartTs = 0;
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
            const picked = renderer3d.getPickedBrickId();
            if (!picked) {
                return; // No hovered brick to delete
            }
        }
        
        // Enqueue click event
        inputState.events.push({
            type: 'click',
            button: event.button, // 0 = left, 2 = right
            closestStud: renderer3d.getClosestStudInfo() || null,
            closestAntiStud: renderer3d.getClosestAntiStudInfo() || null,
            rotation: (() => { const r = renderer3d.getGhostRotationEuler(); return r ? { x: r.x, y: r.y, z: r.z } : { x: 0, y: 0, z: 0 }; })(),
            rotationY: ghostYaw,
            brickId: renderer3d.getPickedBrickId() || null,
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

<!-- Svelte-style window event handlers -->
<svelte:window on:keydown={handleKeyDown} on:keyup={handleKeyUp} />

    <FourByThreeScreen bg="black">
        <div class="flex-center-all h-full w-full relative">
            {#if showStart}
                <StartScreen />
            {:else}
        <!-- Fraggl renderer container -->
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
				<div>R : Pick Hovered Piece</div>
				<div>; / ' : Choose connector</div>
                <div>P : Piece menu</div>
			</div>
			<div class="mt-2 h-32">
				<GraphRTBQ series={[cpuSeries, gpuSeries, diffsSeries]} xScale={1} yRange={[0, 16]} bgColor={0x001018} />
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
