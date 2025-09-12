<script>
    // @ts-nocheck
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import * as THREE from "three/src/Three.WebGPU.Nodes.js";

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
    const BATCH_COLS = 10;
    const BATCH_ROWS = 7;

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
        // Push to the back to preserve order and avoid many identical first frames
        renderQueue.push({ pieceId, index });
        if (!isProcessing) {
            isProcessing = true;
            // Process immediately to avoid even one frame of latency
            requestAnimationFrame(processQueueStep);
        }
    }

    async function processQueueStep() {
        try {
            const maxBatch = Math.min(BATCH_COLS * BATCH_ROWS, renderQueue.length);
            if (maxBatch <= 0) return;
            const work = [];
            for (let i = 0; i < maxBatch; i++) {
                const item = renderQueue.shift();
                if (!item) continue;
                const { pieceId, index } = item;
                queuedIds.delete(pieceId);
                if (thumbnails.has(pieceId)) continue;
                work.push({ pieceId, index });
            }
            if (work.length === 0) return;
            await renderBatch(work);
        } finally {
            if (renderQueue.length > 0) {
                requestAnimationFrame(processQueueStep);
            } else {
                isProcessing = false;
            }
        }
    }

    async function renderBatch(items) {
        await ensureSharedResources();
        const shared = renderer3d.__pickerShared;
        const renderer = shared.thumbRenderer;
        const viewW = THUMB_SIZE;
        const viewH = THUMB_SIZE;
        const cols = BATCH_COLS;
        renderer.setScissorTest(true);
        for (let i = 0; i < items.length; i++) {
            const { pieceId } = items[i];
            const geometry = renderer3d.getGeometryForPieceId && renderer3d.getGeometryForPieceId(pieceId);
            if (!geometry) continue;
            // Build a fresh scene per tile
            const scene = new THREE.Scene();
            scene.background = null;
            const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
            const mesh = new THREE.Mesh(geometry, shared.material);
            scene.add(mesh);
            const hemi = new THREE.HemisphereLight(0xffffff, 0x4444a4, 0.9);
            scene.add(hemi);
            const dir = new THREE.DirectionalLight(0xffffff, 2.5);
            dir.position.set(80, 120, 60);
            scene.add(dir);
            try {
                geometry.computeBoundingBox();
                const center = geometry.boundingBox.getCenter(new THREE.Vector3());
                mesh.position.set(-center.x, -center.y, -center.z);
                const size = geometry.boundingBox.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.6);
                camera.lookAt(0, 0, 0);
            } catch(_) {}
            const col = i % cols;
            const row = Math.floor(i / cols);
            const vx = col * viewW;
            const vy = row * viewH;
            renderer.setViewport(vx, vy, viewW, viewH);
            renderer.setScissor(vx, vy, viewW, viewH);
            if (renderer.backend && renderer.backend.device) renderer.render(scene, camera);
            else await renderer.renderAsync(scene, camera);
        }
        // Present once for the entire batch, then copy tiles
        await new Promise((r) => requestAnimationFrame(() => r()));
        for (let i = 0; i < items.length; i++) {
            const { pieceId } = items[i];
            if (!pieceId) continue;
            const col = i % BATCH_COLS;
            const row = Math.floor(i / BATCH_COLS);
            const sx = col * viewW;
            const sy = row * viewH;
            try {
                thumbCtx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
                thumbCtx.drawImage(renderer.domElement, sx, sy, viewW, viewH, 0, 0, THUMB_SIZE, THUMB_SIZE);
                const dataURL = thumbCanvas.toDataURL('image/png');
                thumbnails.set(pieceId, dataURL);
                thumbnails = thumbnails;
            } catch(_) {}
        }
        renderer.setScissorTest(false);
    }

    // Reusable canvas for encoding thumbnails
    let thumbCanvas = null;
    let thumbCtx = null;

    async function ensureSharedResources() {
        if (!renderer3d.__pickerShared) {
            // Reusable white material for thumbnails
            const material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.0, envMapIntensity: 0.8 });
            // Dedicated offscreen WebGPU renderer for thumbnails
            const thumbRenderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
            thumbRenderer.setSize(THUMB_SIZE * BATCH_COLS, THUMB_SIZE * BATCH_ROWS);
            try { await thumbRenderer.init(); } catch(_) {}
            // Encode canvas
            if (!thumbCanvas) {
                thumbCanvas = document.createElement('canvas');
                thumbCtx = thumbCanvas.getContext('2d');
            }
            if (thumbCanvas.width !== THUMB_SIZE || thumbCanvas.height !== THUMB_SIZE) {
                thumbCanvas.width = THUMB_SIZE;
                thumbCanvas.height = THUMB_SIZE;
            }
            renderer3d.__pickerShared = { material, thumbRenderer };
        } else {
            // Ensure canvas is sized
            const shared = renderer3d.__pickerShared;
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
        const geometry = renderer3d.getGeometryForPieceId && renderer3d.getGeometryForPieceId(pieceId);
        if (!geometry) return;

        // Use a dedicated thumbnail WebGPU renderer (separate from preview)
        await ensureSharedResources();
        const shared = renderer3d.__pickerShared;
        const renderer = shared.thumbRenderer;
        // Build a fresh scene per thumbnail to avoid races between jobs
        const scene = new THREE.Scene();
        scene.background = null;
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
        // Mesh
        const mesh = new THREE.Mesh(geometry, shared.material);
        scene.add(mesh);
        // Lights
        const hemi = new THREE.HemisphereLight(0xffffff, 0x4444a4, 0.9);
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 2.5);
        dir.position.set(80, 120, 60);
        scene.add(dir);
        // Frame the object
        try {
            geometry.computeBoundingBox();
            const center = geometry.boundingBox.getCenter(new THREE.Vector3());
            mesh.position.set(-center.x, -center.y, -center.z);
            const size = geometry.boundingBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.6);
            camera.lookAt(0, 0, 0);
        } catch(_) {}

        try {
            // Render to the offscreen WebGPU canvas and copy to 2D canvas
            await renderer.renderAsync(scene, camera);
            thumbCtx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
            thumbCtx.drawImage(renderer.domElement, 0, 0, THUMB_SIZE, THUMB_SIZE);
            const dataURL = thumbCanvas.toDataURL('image/png');
            thumbnails.set(pieceId, dataURL);
            // Trigger Svelte reactivity for Map mutation so the <img> replaces the placeholder
            thumbnails = thumbnails;
        } catch(_) {
            // ignore rendering errors per-item
        }
    }

    onMount(() => {
        ensureObserver();
    });
    onDestroy(() => {
        if (observer) { observer.disconnect(); observer = null; }
        // Reset shared thumb renderer so we don't carry stale frames across openings
        if (renderer3d && renderer3d.__pickerShared) {
            try { renderer3d.__pickerShared.thumbRenderer.dispose(); } catch(_) {}
            renderer3d.__pickerShared = null;
        }
        thumbnails = new Map();
        renderQueue = [];
        queuedIds = new Set();
        isProcessing = false;
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


