<script>
	// @ts-nocheck
    import { onMount, tick } from 'svelte';
	import * as THREE from 'three/src/Three.WebGPU.Nodes.js';
	import { Animator } from '../../animator';
	import ColorPalette from './ColorPalette.svelte';
	import { brickColorHexes } from './colors.js';
	import { getLegoPartsLibraryNode } from './renderer/legoPartsCache.js';

	let container;
	let scene, camera, renderer;
	let animator;
	let figure;
	let cachedLegsGeom = null;
	let cachedTorsoGeom = null;
	let cachedHeadGeom = null;
	let loadingText = 'Loading parts...';


	let serverUrl = localStorage.getItem('brickquest_server_url') || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');
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
		if (!s) return false;
		// Must be host[:port] with optional protocol; very lenient
		try { new URL(s); return true; } catch {}
		try { new URL('http://' + s); return true; } catch {}
		return false;
	}

	async function checkServerHealth(input) {
		const token = ++lastHealthCheckToken;
		serverReachable = null;
		const url = normalizeUrl(input);
		if (!url) { serverReachable = false; return; }
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 1500);
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
			clearTimeout(timeout);
		}
	}

	function onServerUrlInput() {
		serverValid = simpleValidateUrl(serverUrl);
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(() => { checkServerHealth(serverUrl); }, 250);
	}

	// Run initial validation on mount
	onMount(() => { serverValid = simpleValidateUrl(serverUrl); checkServerHealth(serverUrl); });

    function clampIndex(i) { return Number.isFinite(i) ? Math.max(0, Math.min(brickColorHexes.length - 1, i | 0)) : 0; }
    function genDefaultName() {
        const n = Math.floor(100 + Math.random() * 900);
        return `builder${n}`;
    }
	function setLegs(i) { legsIndex = clampIndex(i); rebuildFigure(); }
	function setTorso(i) { torsoIndex = clampIndex(i); rebuildFigure(); }

    onMount(async () => {
        if (!container) await tick();
        await initThree();
		await loadPartsAndBuildFigure();
		startAnimation();
		return () => {
			stopAnimation();
			try { window.removeEventListener('resize', onResize); } catch(_) {}
			try {
				if (figure) {
					scene && scene.remove && scene.remove(figure);
					disposeObject(figure);
					figure = null;
				}
			} catch(_) {}
			try { if (cachedLegsGeom && cachedLegsGeom.dispose) cachedLegsGeom.dispose(); } catch(_) {}
			try { if (cachedTorsoGeom && cachedTorsoGeom.dispose) cachedTorsoGeom.dispose(); } catch(_) {}
			try { if (cachedHeadGeom && cachedHeadGeom.dispose) cachedHeadGeom.dispose(); } catch(_) {}
			cachedLegsGeom = cachedTorsoGeom = cachedHeadGeom = null;
			if (renderer) renderer.dispose();
		};
	});

	async function initThree() {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x0cbeff);
		camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
		camera.position.set(0, 70, 160);
		camera.lookAt(0, 50, 0);
		renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.toneMappingExposure = 1.0;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		container.appendChild(renderer.domElement);
		try { await renderer.init(); } catch (_) {}
		const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3e5765, 0.9);
		hemi.position.set(0, 50, 0); scene.add(hemi);
		const dir = new THREE.DirectionalLight(0xffffff, 1.8);
		dir.position.set(120, 200, 80); dir.castShadow = true; scene.add(dir);
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
		const lib = await getLegoPartsLibraryNode();
		if (!lib) throw new Error('LegoPartsLibrary not found');
		function extractGeometry(root, typeName) {
			let mesh = null;
			const node = root.getObjectByName(typeName);
			if (node) { if (node.isMesh || node.isSkinnedMesh) mesh = node; else node.traverse((c)=>{ if (!mesh && (c.isMesh||c.isSkinnedMesh)) mesh = c; }); }
			else { root.traverse((c)=>{ if (!mesh && (c.isMesh||c.isSkinnedMesh)) mesh = c; }); }
			if (!mesh || !mesh.geometry) return null;
			root.updateWorldMatrix(true,false); mesh.updateWorldMatrix(true,false);
			const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
			const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
			const g = mesh.geometry.clone(); g.applyMatrix4(local); if (!g.attributes.normal) g.computeVertexNormals(); g.normalizeNormals();
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
		const group = new THREE.Group();
		const legsColor = new THREE.Color(brickColorHexes[legsIndex]);//.convertSRGBToLinear();
		const torsoColor = new THREE.Color(brickColorHexes[torsoIndex]);//.convertSRGBToLinear();
		const headColor = new THREE.Color(0xffd804);//.convertSRGBToLinear();
		const legsMat = new THREE.MeshStandardNodeMaterial({ color: legsColor, roughness: 0.35, metalness: 0.0 });
		const torsoMat = new THREE.MeshStandardNodeMaterial({ color: torsoColor, roughness: 0.35, metalness: 0.0 });
		const headMat = new THREE.MeshStandardNodeMaterial({ color: headColor, roughness: 0.35, metalness: 0.0 });
		const legs = new THREE.Mesh(legsGeom.clone(), legsMat);
		const torso = new THREE.Mesh(torsoGeom.clone(), torsoMat);
		const head = new THREE.Mesh(headGeom.clone(), headMat);
		legs.position.set(0, -12, 0);
		torso.position.set(0, 20, 0);
		head.position.set(0, 44, 0);
		group.add(legs); group.add(torso); group.add(head);
		group.position.set(0, 40, 0);
		figure = group; scene.add(group);
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
            <div class="mb-2 font-semibold">Torso color</div>
            <div class="mb-4 w-fit">
                <ColorPalette
                    colors={brickColorHexes}
                    selectedIndex={torsoIndex}
                    ariaLabelPrefix="Torso color"
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
    <div class="absolute top-6 right-6 bg-black bg-opacity-60 p-3 rounded-xl z-20" style="contain: paint;">
        <div class="text-sm opacity-80 mb-1">Server address</div>
		<input
			class="w-80 px-3 py-2 rounded bg-white text-black outline-none"
			bind:value={serverUrl}
			placeholder="http://localhost:3001"
			autocomplete="off"
			on:input={onServerUrlInput}
			style="{serverValid && serverReachable === true ? 'outline: 3px solid #22c55e; outline-offset: 2px;' : serverValid && serverReachable === false ? 'outline: 3px solid #ef4444; outline-offset: 2px;' : !serverValid ? 'outline: 3px solid #ef4444; outline-offset: 2px;' : ''}"
		/>
    </div>
	{#if loadingText}
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<div class="text-white text-xl bg-black bg-opacity-50 px-4 py-2 rounded">{loadingText}</div>
		</div>
	{/if}
</div>

<style>
	:global(canvas) { display: block; }
</style>


