<script>
    // @ts-nocheck
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import * as THREE from "three";

    export let pieceList = [];
    export let renderer3d = null; // pass createBrickQuestRenderer instance
    export let selectedPieceIndex = 0; // initial selection highlight
    export let onSelect = (index) => {}; // callback with selected index (optional)
    // Removed Esc cancel; use 'P' in parent to close

    let container;

    // Thumbnail cache: id -> dataURL
    let thumbnails = new Map();
    let observer;
    // Render throttling
    let renderQueue = [];
    let queuedIds = new Set();
    let isProcessing = false;

    let gridEl;
    const dispatch = createEventDispatcher();

    const THUMB_SIZE = 256;

    function ensureObserver() {
        if (observer) return;
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const pid = el.getAttribute('data-piece-id');
                    const idx = parseInt(el.getAttribute('data-index') || '0', 10) | 0;
                    if (pid) {
                        queueThumbnail(pid, idx);
                    }
                    if (observer) observer.unobserve(el);
                }
            }
        }, { root: gridEl, rootMargin: '100px' });
    }

    // Svelte action to register each item with IntersectionObserver lazily
    function observeItem(node) {
        ensureObserver();
        if (observer) observer.observe(node);
        return {
            destroy() {
                if (observer) observer.unobserve(node);
            }
        };
    }

    function queueThumbnail(pieceId, index) {
        if (!pieceId || thumbnails.has(pieceId) || queuedIds.has(pieceId)) return;
        queuedIds.add(pieceId);
        // Prioritize newly visible items by adding to the front
        renderQueue.unshift({ pieceId, index });
        if (!isProcessing) {
            isProcessing = true;
            // Process immediately to avoid even one frame of latency
            processQueueStep();
            if (renderQueue.length > 0) {
                requestAnimationFrame(processQueueStep);
            } else {
                isProcessing = false;
            }
        }
    }

    function processQueueStep() {
        try {
            const batch = Math.min(50, renderQueue.length);
            for (let i = 0; i < batch; i++) {
                const item = renderQueue.shift();
                if (!item) continue;
                const { pieceId, index } = item;
                queuedIds.delete(pieceId);
                if (thumbnails.has(pieceId)) continue;
                try { renderThumbnailIfNeeded(pieceId, index); } catch (_) {}
            }
        } finally {
            if (renderQueue.length > 0) {
                requestAnimationFrame(processQueueStep);
            } else {
                isProcessing = false;
            }
        }
    }

    // Reusable canvas for encoding thumbnails
    let thumbCanvas = null;
    let thumbCtx = null;

    function ensureSharedResources(renderer) {
        if (!renderer3d.__pickerShared) {
            const scene = new THREE.Scene();
            scene.background = null;
            const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
            camera.position.set(120, 100, 120);
            camera.lookAt(0, 0, 0);
            // Lighting for proper shading
            const hemi = new THREE.HemisphereLight(0xffffff, 0x4444a4, 0.9);
            scene.add(hemi);
            const dir = new THREE.DirectionalLight(0xffffff, 2.5);
            dir.position.set(80, 120, 60);
            scene.add(dir);
            // White material with shading; compile once and reuse
            const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.0, envMapIntensity: 0.8 });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
            scene.add(mesh);
            // Render target
            const rt = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, { depthBuffer: true, stencilBuffer: false });
            // Encode canvas
            if (!thumbCanvas) {
                thumbCanvas = document.createElement('canvas');
                thumbCtx = thumbCanvas.getContext('2d');
            }
            if (thumbCanvas.width !== THUMB_SIZE || thumbCanvas.height !== THUMB_SIZE) {
                thumbCanvas.width = THUMB_SIZE;
                thumbCanvas.height = THUMB_SIZE;
            }
            // Precompile once to avoid first-thumbnail stall
            try { if (renderer && renderer.compile) renderer.compile(scene, camera); } catch(_) {}
            renderer3d.__pickerShared = { scene, camera, material, mesh, rt };
        } else {
            // Ensure RT and canvas are sized
            const shared = renderer3d.__pickerShared;
            if (!shared.rt || shared.rt.width !== THUMB_SIZE || shared.rt.height !== THUMB_SIZE) {
                shared.rt = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, { depthBuffer: true, stencilBuffer: false });
            }
            if (!thumbCanvas) {
                thumbCanvas = document.createElement('canvas');
                thumbCtx = thumbCanvas.getContext('2d');
            }
            if (thumbCanvas.width !== THUMB_SIZE || thumbCanvas.height !== THUMB_SIZE) {
                thumbCanvas.width = THUMB_SIZE;
                thumbCanvas.height = THUMB_SIZE;
            }
        }
    }

    async function renderThumbnailIfNeeded(pieceId, index) {
        if (thumbnails.has(pieceId)) return;
        if (!renderer3d) return;
        const glRenderer = renderer3d.getPreviewRenderer && renderer3d.getPreviewRenderer();
        const geometry = renderer3d.getGeometryForPieceId && renderer3d.getGeometryForPieceId(pieceId);
        if (!glRenderer || !geometry) return;

        // Use the existing preview renderer (preview is disabled while picker is open)
        const renderer = glRenderer;
        ensureSharedResources(renderer);
        const shared = renderer3d.__pickerShared;
        // Swap geometry and center
        shared.mesh.geometry = geometry;
        try {
            geometry.computeBoundingBox();
            const center = geometry.boundingBox.getCenter(new THREE.Vector3());
            shared.mesh.position.set(-center.x, -center.y, -center.z);
            const size = geometry.boundingBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            shared.camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.6);
            shared.camera.lookAt(0, 0, 0);
        } catch(_) {}

        try {
            // Render into an offscreen render target (avoid resizing or reading main canvas)
            const targetSize = THUMB_SIZE;
            const prevTarget = renderer.getRenderTarget && renderer.getRenderTarget();
            const prevAutoClear = renderer.autoClear;
            renderer.autoClear = true;
            renderer.setRenderTarget(shared.rt);
            renderer.clear(true, true, true);
            renderer.render(shared.scene, shared.camera);

            // Read pixels and convert to a canvas for data URL (flip Y)
            const buffer = new Uint8Array(targetSize * targetSize * 4);
            renderer.readRenderTargetPixels(shared.rt, 0, 0, targetSize, targetSize, buffer);
            const flipped = new Uint8ClampedArray(buffer.length);
            const rowSize = targetSize * 4;
            for (let y = 0; y < targetSize; y++) {
                const srcStart = (targetSize - 1 - y) * rowSize;
                const dstStart = y * rowSize;
                flipped.set(buffer.subarray(srcStart, srcStart + rowSize), dstStart);
            }
            // ensureSharedResources guarantees thumbCanvas sizing
            const imgData = new ImageData(flipped, targetSize, targetSize);
            thumbCtx.putImageData(imgData, 0, 0);
            const dataURL = thumbCanvas.toDataURL('image/png');
            thumbnails.set(pieceId, dataURL);
            // Trigger Svelte reactivity for Map mutation so the <img> replaces the placeholder
            thumbnails = thumbnails;

            // Restore renderer state and dispose target
            renderer.setRenderTarget(prevTarget || null);
            renderer.autoClear = prevAutoClear;
            // keep sharedRT allocated for reuse
        } catch(_) {
            // ignore rendering errors per-item
        }
    }

    onMount(() => {
        ensureObserver();
    });
    onDestroy(() => {
        if (observer) { observer.disconnect(); observer = null; }
    });
</script>

<div bind:this={container} class="absolute inset-0 z-40 bg-black bg-opacity-70 flex items-center justify-center" role="button" tabindex="0" aria-label="Close picker" on:click={(e) => { if (e.target === container) { dispatch('close'); } }} on:keydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === container) { e.preventDefault(); dispatch('close'); } }}>
    <div class="w-[90%] h-[90%] bg-[#111827] rounded-lg shadow-xl overflow-hidden flex flex-col" role="dialog" aria-modal="true">
        <div class="p-3 text-white flex items-center justify-between bg-black/40">
            <div class="font-semibold">Pick a piece</div>
            <div class="opacity-70">Press P to close</div>
        </div>
        <div bind:this={gridEl} class="flex-1 overflow-auto p-3 scroll">
            <div class="grid grid-cols-10 gap-3">
                {#each pieceList as p, i}
                    <button
                        class="group relative bg-black/30 rounded-md overflow-hidden border border-white/10 hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
                        aria-label={`Select piece ${p.name || p.id}`}
                        on:click={() => { onSelect && onSelect(i); dispatch('select', i); }}
                        data-observe
                        data-piece-id={p.id}
                        data-index={i}
                        use:observeItem
                    >
                        <div class="w-full aspect-square text-gray-800 text-lg flex items-center justify-center bg-gradient-to-b from-black/20 to-black/40">
                            {#if thumbnails.get(p.id)}
                                <img alt={p.name || p.id}
                                     class="w-full h-full object-contain select-none pointer-events-none"
                                     draggable="false"
                                     data-piece-id={p.id}
                                     src={thumbnails.get(p.id)}
                                />
                            {:else}
                                <div class="w-full h-full flex items-center justify-center">
                                    <i class="fa-solid fa-image text-gray-500 text-3xl" aria-hidden="true"></i>
                                </div>
                            {/if}
                        </div>
                        <div class="absolute bottom-0 left-0 right-0 text-xs text-white/90 bg-black/50 px-2 py-1 truncate">
                            {p.name || p.id}
                        </div>
                        {#if i === selectedPieceIndex}
                            <div class="absolute inset-0 ring-2 ring-white/80 pointer-events-none" />
                        {/if}
                    </button>
                {/each}
            </div>
        </div>
    </div>
</div>

<style>
    .aspect-square { position: relative; }
    .aspect-square::before { content: ""; display: block; padding-top: 100%; }
    .aspect-square > *:first-child { position: absolute; inset: 0; }

    /* Nice scrollbars */
    /* width */
    .scroll::-webkit-scrollbar {
        width: 10px;
        height: 10px;
    }

    /* bottom-right corner rectangle */
    .scroll::-webkit-scrollbar-corner {
        background-color: #d1d5db; /* gray-300 */
    }

    /* Track */
    .scroll::-webkit-scrollbar-track {
        background-color: #131843; /* pink-900 */
    }

    /* Handle */
    .scroll::-webkit-scrollbar-thumb {
        background-color: #2c4889; /* pink-500 */
        border-radius: 0.25rem; /* rounded */
    }

    /* Handle on hover */
    .scroll::-webkit-scrollbar-thumb:hover {
        background-color: #3472b6; /* pink-400 */
    }
</style>


