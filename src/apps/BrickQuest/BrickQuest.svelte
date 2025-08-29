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

    let showStart = true; // DEBUG: Skip start screen

	// Performance HUD (per-frame timing)
	let lastFrameMs = 0;
	let drawCalls = 0;
	let triangles = 0;
	let ssaoEnabled = true;
	let ssaoDebug = false;
	let showStats = false; // HUD stats collapsed by default
	let chunkDebugVisible = false; // toggled with backtick

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
        
        // Initialize SSAO indicator state
        if (renderer3d && renderer3d.getSSAOEnabled) {
            ssaoEnabled = !!renderer3d.getSSAOEnabled();
        }
        if (renderer3d && renderer3d.getSSAODebugView) {
            ssaoDebug = !!renderer3d.getSSAODebugView();
        }
        
        // Setup preview after a small delay to ensure DOM is ready
        await nextTick();
        if (previewContainer) {
            renderer3d.setupPreview(previewContainer);
            // Sync the initial color selection
            renderer3d.setSelectedColorIndex(selectedColorIndex);
        }
    }

    // Shared color palette (must stay in sync with server indices)
    // const brickColorHexes = [
    //     0xfd301b, // Red
    //     0x0e78cf, // Blue
    //     0x02b510, // Green
    //     0xffd804, // Yellow
    //     0x8b5cf6, // Purple
    //     0xff9801, // Orange
    //     0xffffff, // White
    //     0xc0c0d0,  // Light Gray
    //     0x707080,  // Dark Gray
    //     0x303038,  // Black
    // ];

    // Shared color palette (must stay in sync with server indices)
    const brickColorHexes = [
        0xc82008, // Bright Red
        0x91501c, // Dark Orange
        0xff7000, // Bright Orange
        0x372100, // Dark Brown
        0x897d62, // Sand Yellow
        0xccb98d, // Brick Yellow
        0xffd804, // Bright Yellow
        0x008010, // Dark Green
        0x00451a, // Earth Green
        0x36abd3, // Dark Azur
        0x1b2a34, // Black
        0x0e78cf, // Earth Blue
        0x720012, // New Dark Red
        0xf0f0f0, // White
        0xc0c0d0, // Medium Stone Grey
        0x707080, // Dark Stone Grey
    ];


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
            }
            // Sync selected color index
            if (localPlayer && localPlayer.selectedColorIndex !== undefined) {
                selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, localPlayer.selectedColorIndex));
                renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
            }
            // Ensure ghost is created/updated after we know piece list and geometries
            renderer3d.setSelectedPieceIndex(selectedPieceIndex);
        });


        // Handle state diff updates
        socket.on('stateDiff', (data) => {
            const { diff, timestamp } = data;
            
            // Apply diff to game state
            applyDiff(gameState, diff);
            
            // Trigger Svelte reactivity by reassigning gameState to itself
            gameState = gameState;
            
            // Process changes
            if (diff.players) {
                for (const [pid, playerDiff] of Object.entries(diff.players)) {
                    if (playerDiff._deleted) {
                        renderer3d.removePlayerMesh(pid);
                    } else if (playerDiff._new) {
                        renderer3d.createPlayerMesh({ id: pid, ...gameState.players[pid] });
                    } else {
                        // If color fields changed, rebuild the player mesh so materials update
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
                            // Update selected piece if changed
                            if (player.selectedPieceIndex !== undefined && player.selectedPieceIndex !== selectedPieceIndex) {
                                selectedPieceIndex = player.selectedPieceIndex;
                                // Renderer will use piecesData directly
                                // Reset rotation when piece changes
                                ghostYaw = 0;
                                // Keep ghost in sync when server changes our selected piece
                                renderer3d.setSelectedPieceIndex(selectedPieceIndex);
                                renderer3d.setGhostYaw(ghostYaw);
                            }
                            // Update selected color if changed on server
                            if (player.selectedColorIndex !== undefined && player.selectedColorIndex !== selectedColorIndex) {
                                selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, player.selectedColorIndex));
                                renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
                            }
                            // Sync indices and mode from server if changed
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
                            
                            // RTT calculation
                            if (player.lastFrameCounter !== undefined) {
                                const sentTime = sentFrames.get(player.lastFrameCounter);
                                if (sentTime) {
                                    currentRTT = Date.now() - sentTime;
                                    smoothedRTT = smoothedRTT === 0 ? currentRTT : smoothedRTT * 0.99 + currentRTT * 0.01;
                                    sentFrames.delete(player.lastFrameCounter);
                                }
                            }
                            // Apply authoritative ghost pose and collision
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
            
            // Process brick changes
            if (diff.chunks) {
                // Reconcile groups for any added chunks, but do NOT prune here
                renderer3d.reconcileChunksAndBricks(gameState.chunks, {});
                if (chunkDebugVisible && renderer3d && renderer3d.setChunkDebugVisible) {
                    // Ensure helpers exist for any newly created groups
                    renderer3d.setChunkDebugVisible(true);
                }
                for (const [ckey, cDiff] of Object.entries(diff.chunks)) {
                    const chunk = gameState.chunks && gameState.chunks[ckey];
                    // If chunk is deleted, remove its visual group and all instances
                    if (cDiff && cDiff._deleted) {
                        if (renderer3d && renderer3d.removeChunkGroupAndInstances) {
                            renderer3d.removeChunkGroupAndInstances(ckey);
                        }
                        continue;
                    }
                    if (!chunk) continue;
                    // If the entire chunk is new, create all of its bricks
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
                                renderer3d.removeBrickMesh(bid);
                            } else if (bDiff && bDiff._new) {
                                const brick = chunk && chunk.bricks ? chunk.bricks[bid] : null;
                                if (brick) renderer3d.createBrickMesh({ id: bid, chunkKey: ckey, ...brick });
                            }
                        }
                    }
                }
            }
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
            
            // ESC key exits pointer lock
            if (e.key === 'Escape') {
                document.exitPointerLock();
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
            } else if (key === 'q' && !e.shiftKey) {
                // Toggle SSAO
                if (renderer3d && renderer3d.toggleSSAO) {
                    renderer3d.toggleSSAO();
                    if (renderer3d.getSSAOEnabled) {
                        ssaoEnabled = !!renderer3d.getSSAOEnabled();
                    }
                }
            } else if (key === 'q' && e.shiftKey) {
                // Toggle SSAO debug output
                if (renderer3d && renderer3d.toggleSSAODebugView) {
                    renderer3d.toggleSSAODebugView();
                    if (renderer3d.getSSAODebugView) {
                        ssaoDebug = !!renderer3d.getSSAODebugView();
                    }
                }
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



    function onWindowResize() { renderer3d && renderer3d.onResize(); }

	function tick() {
		if (!renderer3d || !renderer3d.renderTick) return;
		// Measure CPU time for this frame's update + render
		const t0 = performance.now();
		// Send input to server
		sendInput();
		const localPlayer = gameState.players[playerId];
		const localWithId = localPlayer ? { id: playerId, ...localPlayer } : null;
		const isMoving = !!(inputState.keys.w || inputState.keys.a || inputState.keys.s || inputState.keys.d);
		renderer3d.renderTick(localWithId, yaw, pitch, isThirdPerson, isMoving);
		const dt = performance.now() - t0;

		// Update last frame time only
		lastFrameMs = dt;
		const rs = renderer3d.getRenderStats && renderer3d.getRenderStats();
		if (rs) { drawCalls = rs.drawCalls | 0; triangles = rs.triangles | 0; }
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
					<div>frame ms: {lastFrameMs.toFixed(2)}</div>
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
				<div>' : Cycle anti-stud</div>
				<!-- <div>Q: Toggle SSAO</div> -->
				<!-- <div>Shift+Q: SSAO Debug Output</div> -->
			</div>
		</div>

        <!-- Color palette (bottom-left) -->
        <div class="absolute bottom-4 left-4 z-20" style="contain: paint;">
            <div class="flex items-center gap-2 bg-black bg-opacity-50 p-2 rounded">
                {#each brickColorHexes as hex, i}
                    <button
                        class="w-7 h-7 rounded-sm"
                        aria-label={`Select color ${i}`}
                        style="background-color: {`#${hex.toString(16).padStart(6,'0')}`}; {i === selectedColorIndex ? 'outline: 3px solid white; outline-offset: 2px;' : 'outline: 1px solid rgba(255,255,255,0.3); outline-offset: 2px;'}"
                        on:click={() => setColor(i)}
                    />
                {/each}
            </div>
        </div>

        <!-- Piece preview (bottom-right) -->
        <div class="absolute bottom-4 right-4 z-20" style="contain: paint;">
                <div 
                    bind:this={previewContainer}
                    class="w-[13rem] h-[13rem] rounded-xl bg-gray-800 bg-opacity-30"
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

        <CloseButton />
            {/if}
    </div>
</FourByThreeScreen>

<style>
    :global(canvas) {
        display: block;
    }
</style>
