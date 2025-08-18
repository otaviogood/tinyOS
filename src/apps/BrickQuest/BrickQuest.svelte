<script>
    // @ts-nocheck
    import { onMount, tick as nextTick } from "svelte";
    import { pop } from "../../router";
    import { handleResize } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import { Animator, frameCount, animateCount } from "../../animator";
    import { createBrickQuestRenderer } from "./threeRenderer.js";
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
    gameState.bricks = {};
    
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
    // Ghost (preview) brick state routed via renderer3d
    let ghostYaw = 0; // Yaw rotation for current ghost/piece placement (radians)
    // Default stud positions for 2x2 brick (piece 3022)
    let brickStudData = { 
        studs: [
            { x: 10, y: 0, z: -10 },
            { x: -10, y: 0, z: -10 },
            { x: 10, y: 0, z: 10 },
            { x: -10, y: 0, z: 10 }
        ],
        antiStuds: [] 
    }; // Current piece's stud positions
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

    // Three.js scene setup moved to threeRenderer.js

    // Post-processing moved to threeRenderer.js

    // Model loading moved to threeRenderer.js

    // Stud highlight creation handled in threeRenderer.js

    // Shared color palette (must stay in sync with server indices)
    const brickColorHexes = [
        0xfd301b, // Red
        0x0e78cf, // Blue
        0x02b510, // Green
        0xffd804, // Yellow
        0x8b5cf6, // Purple
        0xff9801, // Orange
        0xffffff, // White
        0xc0c0d0,  // Light Gray
        0x707080,  // Dark Gray
        0x303038,  // Black
    ];

    // Brick materials are created in threeRenderer.js

    // Ghost material handled in threeRenderer.js

    function setGhostCollisionVisual(colliding) {
        renderer3d && renderer3d.setGhostCollisionVisual(colliding);
    }

    // Ghost collision request is embedded into the regular inputDiff emit in sendInput
    // Ghost mesh and placement handled in threeRenderer.js

    function initNetworking() {
        // Stud highlight handled by renderer on init
        
        // Resolve server URL from StartScreen or fallback
        const savedUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('brickquest_server_url')) || 'http://localhost:3001';
        const name = (typeof localStorage !== 'undefined' && localStorage.getItem('brickquest_player_name')) || `builder${Math.floor(100 + Math.random()*900)}`;

        // Desired local player colors from StartScreen (indices into brickColorHexes)
        const legsIdx = Math.max(0, Math.min(brickColorHexes.length - 1, parseInt(localStorage.getItem('brickquest_color_legs_idx') || '1', 10)));
        const torsoIdx = Math.max(0, Math.min(brickColorHexes.length - 1, parseInt(localStorage.getItem('brickquest_color_torso_idx') || '1', 10)));
        const desiredLegsColor = brickColorHexes[isFinite(legsIdx) ? legsIdx : 1] | 0;
        const desiredTorsoColor = brickColorHexes[isFinite(torsoIdx) ? torsoIdx : 1] | 0;

        // Connect to the server and send preferred colors up-front in auth payload
        socket = io(savedUrl, {
            transports: ['websocket'],
            upgrade: false,
            auth: { colorLegs: desiredLegsColor, colorTorso: desiredTorsoColor, name }
        });

        // Connection state handlers (after socket is created)
        socket.on('connect', () => { isConnected = true; });
        socket.on('disconnect', () => { isConnected = false; });
        socket.on('connect_error', () => { isConnected = false; });
        socket.on('reconnect', () => { isConnected = true; });

        // Handle initial connection
		socket.on('init', (data) => {
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
                // Update stud data for the default selected piece
                if (pieceList.length > 0 && piecesData[pieceList[0].id]) {
                    brickStudData = piecesData[pieceList[0].id];
                }
            }
            // Inform renderer of data
            renderer3d.setData({ pieceList, piecesData });
            
            // Apply full state
            gameState._pause();
            gameState.players = data.state.players || {};
            gameState.bricks = data.state.bricks || {};
            gameState._resume();
            
            // Create meshes for all entities
            for (const [pid, player] of Object.entries(gameState.players)) {
                renderer3d.createPlayerMesh({ id: pid, ...player });
            }
            
            for (const [bid, brick] of Object.entries(gameState.bricks)) {
                renderer3d.createBrickMesh({ id: bid, ...brick });
            }
            
            // Update selected piece index
            const localPlayer = gameState.players[playerId];
            if (localPlayer && localPlayer.selectedPieceIndex !== undefined) {
                selectedPieceIndex = localPlayer.selectedPieceIndex;
                if (pieceList[selectedPieceIndex] && piecesData[pieceList[selectedPieceIndex].id]) {
                    brickStudData = piecesData[pieceList[selectedPieceIndex].id];
                }
                // Reset rotation on init to a known state
                ghostYaw = 0;
                renderer3d.setSelectedPieceIndex(selectedPieceIndex);
                renderer3d.setGhostYaw(ghostYaw);
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
                                if (pieceList[selectedPieceIndex] && piecesData[pieceList[selectedPieceIndex].id]) {
                                    brickStudData = piecesData[pieceList[selectedPieceIndex].id];
                                }
                                // Reset rotation when piece changes
                                ghostYaw = 0;
                                // Keep ghost in sync when server changes our selected piece
                                renderer3d.setSelectedPieceIndex(selectedPieceIndex);
                            }
                            // Update selected color if changed on server
                            if (player.selectedColorIndex !== undefined && player.selectedColorIndex !== selectedColorIndex) {
                                selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, player.selectedColorIndex));
                                renderer3d && renderer3d.setSelectedColorIndex(selectedColorIndex);
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
            if (diff.bricks) {
                for (const [bid, brickDiff] of Object.entries(diff.bricks)) {
                    if (brickDiff._deleted) {
                        renderer3d.removeBrickMesh(bid);
                    } else if (brickDiff._new) {
                        renderer3d.createBrickMesh({ id: bid, ...gameState.bricks[bid] });
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
            if (inputState.keys.hasOwnProperty(key)) {
                inputState.keys[key] = false;
            }
        });
    }
    
    function changePiece(direction) {
        selectedPieceIndex = Math.max(0, Math.min(pieceList.length - 1, selectedPieceIndex + direction));
        // Reset rotation when switching piece
        ghostYaw = 0;
        renderer3d.setSelectedPieceIndex(selectedPieceIndex);
        renderer3d.setGhostYaw(ghostYaw);
        
        // Update current stud data
        if (pieceList.length > 0) {
            const selectedPiece = pieceList[selectedPieceIndex];
            const pieceData = piecesData[selectedPiece.id];
            if (pieceData) {
                brickStudData = pieceData;
            }
        }
        
        // Add event for server
        inputState.events.push({ type: 'pieceChange', delta: direction });
        // Update local ghost immediately
        renderer3d.setSelectedPieceIndex(selectedPieceIndex);
    }

    function changeColor(direction) {
        selectedColorIndex = Math.max(0, Math.min(brickColorHexes.length - 1, selectedColorIndex + direction));
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
                    pieceId: pieceList[selectedPieceIndex].id,
                    yaw: ghostYaw,
                    closestStud: (renderer3d.getClosestStudInfo && renderer3d.getClosestStudInfo()) || null,
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
		renderer3d.renderTick(localWithId, yaw, pitch, isThirdPerson);
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
        
        // Add click event
        if (renderer3d.canPlaceNow && !renderer3d.canPlaceNow()) {
            return; // Out of range: ignore placement/removal clicks
        }
        inputState.events.push({
            type: 'click',
            button: event.button, // 0 = left, 2 = right
            closestStud: (renderer3d.getClosestStudInfo && renderer3d.getClosestStudInfo()) || null,
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
			<div>frame ms: {lastFrameMs.toFixed(2)}</div>
			<div>draw calls: {drawCalls}</div>
			<div>triangles: {triangles}</div>
			<div>Bricks: {Object.keys(gameState.bricks).length}</div>
			<div>Players: {Object.keys(gameState.players).length}</div>
			<div>RTT: {Math.round(smoothedRTT)}ms Current: {currentRTT}</div>
			<!-- <div>SSAO: {ssaoEnabled ? 'On' : 'Off'}{ssaoDebug ? ' (Debug)' : ''}</div> -->
			<div class="text-sm mt-4">
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
                    <div class="text-white text-xl text-center -mt-8 max-w-[13rem] truncate">
                        {pieceList[selectedPieceIndex].name}
                    </div>
                    <div class="absolute text-gray-500 text-xs text-center  max-w-[13rem] truncate">
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
