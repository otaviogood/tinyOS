<script>
	// @ts-nocheck
    import { onMount, tick } from 'svelte';
	import { Scene, PerspectiveCamera, WebGPURenderer, Group, Mesh, DirectionalLight, StandardMaterial, Matrix4 } from './renderer/fraggl/index.js';
	import { Animator } from '../../animator';
	import ColorPalette from './ColorPalette.svelte';
	import { brickColorHexes } from './colors.js';
	import { GLTFLoader } from './renderer/fraggl/index.js';

	let container;
	let scene, camera, renderer, canvas;
	let animator;
	let figure;
	let cachedLegsGeom = null;
	let cachedTorsoGeom = null;
	let cachedHeadGeom = null;
	let loadingText = 'Loading parts...';
	let webGPUSupported = null; // null = checking, true = supported, false = not supported

	let showServerSettings = false; // collapsed by default
	$: serverStatusStyle = (serverValid && serverReachable === true)
		? 'outline: 3px solid #22c55e; outline-offset: 2px;'
		: (serverValid && serverReachable === false)
			? 'outline: 3px solid #ef4444; outline-offset: 2px;'
			: (!serverValid)
				? 'outline: 3px solid #ef4444; outline-offset: 2px;'
				: '';


	function computeDefaultServerUrl() {
		if (typeof window === 'undefined') return 'http://localhost:3001';
		const host = window.location && window.location.hostname ? window.location.hostname : 'localhost';
		// Bracket IPv6 literals for URL compatibility
		const bracketedHost = host.includes(':') && !(host.startsWith('[') && host.endsWith(']')) ? `[${host}]` : host;
		return `http://${bracketedHost}:3001`;
	}

	let defaultServerUrl = computeDefaultServerUrl();
	// Default to blank to use same-origin proxy; user can override with explicit URL
	let serverUrl = (localStorage.getItem('brickquest_server_url') || '').trim();
    let playerName = (localStorage.getItem('brickquest_player_name')) || genDefaultName();
	let legsIndex = clampIndex(parseInt(localStorage.getItem('brickquest_color_legs_idx') || '1', 10));
	let torsoIndex = clampIndex(parseInt(localStorage.getItem('brickquest_color_torso_idx') || '1', 10));

	// Realtime server URL validation + health check
	let serverValid = false;
	let serverReachable = null; // null = unknown, true/false after check
	let debounceId = null;
	let lastHealthCheckToken = 0;

	function normalizeUrl(input) {
		const s = (input || '').trim();
		if (!s) return '';
		try { new URL(s); return s; } catch {}
		// Try adding http:// if protocol omitted
		try { new URL('http://' + s); return 'http://' + s; } catch {}
		return '';
	}

	function simpleValidateUrl(input) {
		const s = (input || '').trim();
		if (!s) return true; // blank means use same-origin via proxy
		// Must be host[:port] with optional protocol; very lenient
		try { new URL(s); return true; } catch {}
		try { new URL('http://' + s); return true; } catch {}
		return false;
	}

	async function checkServerHealth(input) {
		const token = ++lastHealthCheckToken;
		serverReachable = null;
		const url = normalizeUrl(input);
		if (!url) {
			// When blank, check same-origin via dev proxy
			try {
				const res = await fetch('/health', { method: 'GET', mode: 'cors' });
				if (token !== lastHealthCheckToken) return; // stale
				if (!res.ok) { serverReachable = false; return; }
				const data = await res.json().catch(()=>({}));
				serverReachable = data && data.ok === true;
			} catch (_) {
				if (token !== lastHealthCheckToken) return;
				serverReachable = false;
			}
			return;
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			try { controller.abort(); } catch(_) {}
		}, 1500);
		try {
			const res = await fetch(url.replace(/\/$/, '') + '/health', { method: 'GET', mode: 'cors', signal: controller.signal });
			if (token !== lastHealthCheckToken) return; // stale
			if (!res.ok) { serverReachable = false; return; }
			const data = await res.json().catch(()=>({}));
			serverReachable = data && data.ok === true;
		} catch (e) {
			if (token !== lastHealthCheckToken) return;
			serverReachable = false;
		} finally {
			try { clearTimeout(timeout); } catch(_) {}
		}
	}

	function onServerUrlInput() {
		serverValid = simpleValidateUrl(serverUrl);
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(() => { checkServerHealth(serverUrl); }, 250);
	}

	// Run initial validation on mount
	onMount(() => {
		serverValid = simpleValidateUrl(serverUrl);
		checkServerHealth(serverUrl);
	});

	async function checkWebGPUSupport() {
		try {
			if (!navigator.gpu) {
				webGPUSupported = false;
				return false;
			}
			
			const adapter = await navigator.gpu.requestAdapter();
			if (!adapter) {
				webGPUSupported = false;
				return false;
			}
			
			webGPUSupported = true;
			return true;
		} catch (error) {
			console.warn('WebGPU support check failed:', error);
			webGPUSupported = false;
			return false;
		}
	}

    function clampIndex(i) { return Number.isFinite(i) ? Math.max(0, Math.min(brickColorHexes.length - 1, i | 0)) : 0; }
    function genDefaultName() {
        const n = Math.floor(100 + Math.random() * 900);
        return `builder${n}`;
    }
	function setLegs(i) { legsIndex = clampIndex(i); rebuildFigure(); }
	function setTorso(i) { torsoIndex = clampIndex(i); rebuildFigure(); }

	onMount(async () => {
        if (!container) await tick();
		
		// Check WebGPU support first
		const isSupported = await checkWebGPUSupport();
		if (!isSupported) {
			return () => {
				// Cleanup for unsupported case
				try { if (debounceId) clearTimeout(debounceId); } catch(_) {}
				debounceId = null;
				lastHealthCheckToken++;
			};
		}
		
		await initFraggl();
		await loadPartsAndBuildFigure();
		startAnimation();
		return () => {
			stopAnimation();
			
			// Clear any pending timeouts
			try { if (debounceId) clearTimeout(debounceId); } catch(_) {}
			debounceId = null;
			
			// Cancel any ongoing health checks
			lastHealthCheckToken++;
			
			try { window.removeEventListener('resize', onResize); } catch(_) {}
			
			try {
				if (figure) {
					scene && scene.remove && scene.remove(figure);
					disposeObject(figure);
					figure = null;
				}
			} catch(_) {}
			
			// Clean up cached geometries
			try { if (cachedLegsGeom && cachedLegsGeom.dispose) cachedLegsGeom.dispose(); } catch(_) {}
			try { if (cachedTorsoGeom && cachedTorsoGeom.dispose) cachedTorsoGeom.dispose(); } catch(_) {}
			try { if (cachedHeadGeom && cachedHeadGeom.dispose) cachedHeadGeom.dispose(); } catch(_) {}
			cachedLegsGeom = cachedTorsoGeom = cachedHeadGeom = null;
			
			// Clean up scene and renderer
			try {
				if (scene) {
					scene.traverse((child) => {
						if (child && child !== scene) {
							disposeObject(child);
						}
					});
					scene.clear && scene.clear();
				}
			} catch(_) {}
			
			try {
				if (renderer && renderer.dispose) {
					renderer.dispose();
				}
			} catch(_) {}
			
			try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch(_) {}
			
			// Clear references
			scene = camera = renderer = canvas = null;
		};
	});

	async function initFraggl() {
		scene = new Scene();
		camera = new PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
		camera.position.set(0, 70, 160);
		camera.lookAt(0, 50, 0);

		canvas = document.createElement('canvas');
		canvas.style.display = 'block';
		container.appendChild(canvas);

		renderer = new WebGPURenderer({ canvas, clearColor: { r: 0x0c / 255, g: 0xbe / 255, b: 0xff / 255, a: 1 } });
		try { await renderer.init(); } catch (_) {}
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setExposure(1.0);

		const dir = new DirectionalLight(0xffffff, 1.0);
		dir.castShadow = true;
		scene.add(dir);

		window.addEventListener('resize', onResize);
	}

	function onResize() {
		if (!camera || !renderer || !container) return;
		camera.aspect = container.clientWidth / container.clientHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(container.clientWidth, container.clientHeight);
	}

	async function loadPartsAndBuildFigure() {
		loadingText = 'Loading LEGO parts...';
		const loader = new GLTFLoader();
		const { scene: partsScene } = await loader.loadAsync('/apps/bricks/all_pieces.gltf');
		const lib = partsScene && partsScene.getObjectByName('LegoPartsLibrary');
		if (!lib) throw new Error('LegoPartsLibrary not found');
		function extractGeometry(root, typeName) {
			let mesh = null;
			const node = root.getObjectByName(typeName);
			if (node) { if (node.isMesh || node.isSkinnedMesh) mesh = node; else node.traverse((c)=>{ if (!mesh && (c.isMesh||c.isSkinnedMesh)) mesh = c; }); }
			else { root.traverse((c)=>{ if (!mesh && (c.isMesh||c.isSkinnedMesh)) mesh = c; }); }
			if (!mesh || !mesh.geometry) return null;
			root.updateMatrixWorld?.(true);
			mesh.updateMatrixWorld?.(true);
			const inv = new Matrix4().copy(root.matrixWorld).invert();
			const local = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
			const g = mesh.geometry.clone();
			g.applyMatrix4(local);
			// Assume normals are present from glTF; StandardMaterial relies on them
			return g;
		}
		const legsRoot = lib.getObjectByName('73200');
		const torsoRoot = lib.getObjectByName('76382');
		const headRoot = lib.getObjectByName('3626');
		cachedLegsGeom = legsRoot ? extractGeometry(legsRoot, 'part') : null;
		cachedTorsoGeom = torsoRoot ? extractGeometry(torsoRoot, 'part') : null;
		cachedHeadGeom = headRoot ? extractGeometry(headRoot, 'part') : null;
		buildFigure(cachedLegsGeom, cachedTorsoGeom, cachedHeadGeom);
		loadingText = '';
	}

	function buildFigure(legsGeom, torsoGeom, headGeom) {
		if (figure) { scene.remove(figure); disposeObject(figure); figure = null; }
		if (!legsGeom || !torsoGeom || !headGeom) return;
		const group = new Group();
		const legsColor = hexToLinearRGBA(brickColorHexes[legsIndex]);
		const torsoColor = hexToLinearRGBA(brickColorHexes[torsoIndex]);
		const headColor = hexToLinearRGBA(0xffd804);
		const legsMat = new StandardMaterial({ baseColor: [legsColor[0], legsColor[1], legsColor[2]], roughness: 0.35, metallic: 0.0 });
		const torsoMat = new StandardMaterial({ baseColor: [torsoColor[0], torsoColor[1], torsoColor[2]], roughness: 0.35, metallic: 0.0 });
		const headMat = new StandardMaterial({ baseColor: [headColor[0], headColor[1], headColor[2]], roughness: 0.35, metallic: 0.0 });
		const legs = new Mesh(legsGeom.clone(), legsMat);
		const torso = new Mesh(torsoGeom.clone(), torsoMat);
		const head = new Mesh(headGeom.clone(), headMat);
		legs.position.set(0, -12, 0);
		torso.position.set(0, 20, 0);
		head.position.set(0, 44, 0);
		group.add(legs); group.add(torso); group.add(head);
		group.position.set(0, 40, 0);
		figure = group; scene.add(group);
	}

	function srgbToLinear(c) {
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	}

	function hexToLinearRGBA(hex) {
		const r = ((hex >> 16) & 255) / 255;
		const g = ((hex >> 8) & 255) / 255;
		const b = (hex & 255) / 255;
		return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1];
	}

	function disposeObject(object3d) {
		if (!object3d) return;
		object3d.traverse((child) => {
			if (child && child.isMesh) {
				if (child.geometry && child.geometry.dispose) try { child.geometry.dispose(); } catch {}
				if (child.material) {
					const mat = child.material;
					if (Array.isArray(mat)) { for (const m of mat) { if (m && m.dispose) try { m.dispose(); } catch {} } }
					else if (mat.dispose) try { mat.dispose(); } catch {}
				}
			}
		});
	}

	function startAnimation() {
		if (animator) animator.stop();
		animator = new Animator(60, () => {
			if (figure) figure.rotation.y += 0.01;
			if (renderer) renderer.render(scene, camera);
		});
		animator.start();
	}
	function stopAnimation() {
		if (animator) {
			animator.stop();
			animator = null;
		}
	}
	function rebuildFigure() { if (cachedLegsGeom && cachedTorsoGeom && cachedHeadGeom) buildFigure(cachedLegsGeom, cachedTorsoGeom, cachedHeadGeom); else loadPartsAndBuildFigure(); }

    function confirmAndStart() {
		localStorage.setItem('brickquest_server_url', serverUrl.trim());
		localStorage.setItem('brickquest_color_legs_idx', String(legsIndex));
		localStorage.setItem('brickquest_color_torso_idx', String(torsoIndex));
        const trimmed = (playerName || '').trim();
        localStorage.setItem('brickquest_player_name', trimmed.length ? trimmed : genDefaultName());
		// Inform parent via dispatch? Simpler: set a global flag the BrickQuest app can read immediately
		document.dispatchEvent(new CustomEvent('brickquest-start')); // parent listens to hide screen
	}
</script>

<div class="w-full h-full relative text-white z-10">
    <div class="absolute inset-0" bind:this={container} style="contain: layout paint; touch-action: none;" />
    <div class="absolute top-6 left-6 bg-black bg-opacity-60 p-4 rounded-xl z-20" style="contain: paint;">
        <form autocomplete="off" on:submit|preventDefault={confirmAndStart}>
            <div class="text-3xl font-bold mb-2">BrickQuest</div>
            <div class="opacity-80 mb-3">Choose your name and colors</div>
            <div class="mb-3">
                <label class="block text-sm opacity-80 mb-1" for="nameInput">Your name</label>
                <!-- Safari AutoFill suppression helper -->
                <input aria-hidden="true" tabindex="-1" style="position:absolute; left:-9999px; width:1px; height:1px; opacity:0;" type="text" name="no_autofill" autocomplete="username" />
                <input id="nameInput" name="brickquest_nickname" class="w-96 px-3 py-2 rounded bg-white text-black outline-none" bind:value={playerName} placeholder={genDefaultName()} maxlength="10" autocomplete="new-password" aria-autocomplete="none" spellcheck="false" autocorrect="off" autocapitalize="off" inputmode="text" />
            </div>
            <div class="mb-2 font-semibold">Body color</div>
            <div class="mb-4 w-fit">
                <ColorPalette
                    colors={brickColorHexes}
                    selectedIndex={torsoIndex}
                    ariaLabelPrefix="Body color"
                    on:change={(e) => setTorso(e.detail)}
                />
            </div>
            <div class="mb-2 font-semibold">Legs color</div>
            <div class="mb-4 w-fit">
                <ColorPalette
                    colors={brickColorHexes}
                    selectedIndex={legsIndex}
                    ariaLabelPrefix="Legs color"
                    on:change={(e) => setLegs(e.detail)}
                />
            </div>
            <button type="submit" class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 rounded text-white font-bold">Start</button>
        </form>
    </div>
    <div class="absolute top-6 right-6 bg-black bg-opacity-60 p-3 rounded-xl z-20" style="contain: paint; {serverStatusStyle}">
		<button class="flex items-center gap-2 text-sm opacity-90 hover:opacity-100 select-none" on:click|preventDefault={() => showServerSettings = !showServerSettings}>
			<span class="font-semibold">Server</span>
		</button>
		{#if showServerSettings}
			<div class="mt-2">
				<div class="text-sm opacity-80 mb-1">Server address</div>
				<input
					class="w-80 px-3 py-2 rounded bg-white text-black outline-none"
					bind:value={serverUrl}
					placeholder={defaultServerUrl}
					autocomplete="off"
					on:input={onServerUrlInput}
				/>
				<div class="text-xs mt-1 opacity-75">Leave blank to use same-origin proxy</div>
			</div>
		{/if}
	</div>
	{#if loadingText}
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<div class="text-white text-xl bg-black bg-opacity-50 px-4 py-2 rounded">{loadingText}</div>
		</div>
	{/if}
	
	{#if webGPUSupported === false}
		<div class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80 z-30">
			<div class="bg-red-600 text-white p-8 rounded-2xl max-w-2xl mx-4 text-center shadow-2xl">
				<div class="text-4xl font-bold mb-4">⚠️ WebGPU Not Supported</div>
				<div class="text-xl mb-6">
					Your browser doesn't support WebGPU, which is required for BrickQuest.
				</div>
				<div class="text-lg mb-4">
					Please try one of these modern browsers:
				</div>
				<div class="grid grid-cols-2 gap-4 mb-6 text-lg">
					<div class="bg-red-700 p-3 rounded">
						<div class="font-semibold">Chrome/Edge</div>
						<div class="text-sm opacity-90">Version 113+</div>
					</div>
					<div class="bg-red-700 p-3 rounded">
						<div class="font-semibold">Safari</div>
						<div class="text-sm opacity-90">MacOS 26+</div>
					</div>
				</div>
				<div class="text-base opacity-90">
					Make sure WebGPU is enabled in your browser settings or flags.
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(canvas) { display: block; }
</style>


