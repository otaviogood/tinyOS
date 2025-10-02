<script>
    // @ts-nocheck
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import { Scene, PerspectiveCamera, WebGPURenderer, Mesh, StandardMaterial, DirectionalLight, Vector3 } from "./renderer/fraggl/index.js";

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
        const scene = shared.thumbScene;
        const camera = shared.thumbCamera;
        const mesh = shared.thumbMesh;
        const atlasCtx = shared.atlasCtx;
        const atlasCanvas = shared.atlasCanvas;
        const viewW = THUMB_SIZE;
        const viewH = THUMB_SIZE;
        const cols = BATCH_COLS;
        const rows = Math.ceil(items.length / cols);
        const atlasW = cols * viewW;
        const atlasH = rows * viewH;
        if (atlasCanvas.width !== atlasW || atlasCanvas.height !== atlasH) {
            atlasCanvas.width = atlasW;
            atlasCanvas.height = atlasH;
        }
        atlasCtx.clearRect(0, 0, atlasW, atlasH);

        renderer.setSize(viewW, viewH, false);
        for (let i = 0; i < items.length; i++) {
            const { pieceId } = items[i];
            const geometry = renderer3d.getGeometryForPieceId && renderer3d.getGeometryForPieceId(pieceId);
            if (!geometry) continue;
            mesh.geometry = geometry;
            try {
                if (!geometry.boundingBox) geometry.computeBoundingBox();
                const center = geometry.boundingBox.getCenter(new Vector3());
                mesh.position.set(-center.x, -center.y, -center.z);
                const size = geometry.boundingBox.getSize(new Vector3());
                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.6);
                camera.lookAt(0, 0, 0);
            } catch(_) {}
            try {
                await renderer.render(scene, camera);
                const col = i % cols;
                const row = Math.floor(i / cols);
                const dx = col * viewW;
                const dy = row * viewH;
                atlasCtx.drawImage(renderer.canvas, 0, 0, viewW, viewH, dx, dy, viewW, viewH);
            } catch(_) {}
        }
        for (let i = 0; i < items.length; i++) {
            const { pieceId } = items[i];
            if (!pieceId) continue;
            const col = i % cols;
            const row = Math.floor(i / cols);
            const sx = col * viewW;
            const sy = row * viewH;
            try {
                thumbCtx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
                thumbCtx.drawImage(atlasCanvas, sx, sy, viewW, viewH, 0, 0, THUMB_SIZE, THUMB_SIZE);
                const dataURL = thumbCanvas.toDataURL('image/png');
                thumbnails.set(pieceId, dataURL);
                thumbnails = thumbnails;
            } catch(_) {}
        }
    }

    // Reusable canvas for encoding thumbnails
    let thumbCanvas = null;
    let thumbCtx = null;

    async function ensureSharedResources() {
        if (!renderer3d.__pickerShared) {
            const material = new StandardMaterial({ baseColor: [1,1,1,1], roughness: 0.3, metallic: 0.0 });
            // Dedicated offscreen Fraggl WebGPU renderer for thumbnails
            let canvas = null;
            if (typeof document !== 'undefined') {
                canvas = document.createElement('canvas');
                canvas.style.display = 'none';
            }
            const thumbRenderer = new WebGPURenderer({ canvas, clearColor: { r: 0, g: 0, b: 0, a: 0 }, exposure: 1.0 });
            try { await thumbRenderer.init(canvas); } catch(_) {}
            thumbRenderer.disableShadows = true;
            thumbRenderer.setClearAlpha(0.0);
            thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE, false);

            // Persistent scene/camera/mesh and lights for fast per-item updates
            const thumbScene = new Scene();
            const thumbCamera = new PerspectiveCamera(35, 1, 0.1, 2000);
            const thumbMesh = new Mesh(null, material);
            thumbScene.add(thumbMesh);
            const d1 = new DirectionalLight(0xffffff, 1.0); d1.direction.set(-0.6, -1.0, -0.4).normalize(); thumbScene.add(d1);
            // const d2 = new DirectionalLight(0x8fbfff, 0.6); d2.direction.set(0.6, -0.3, 0.6).normalize(); thumbScene.add(d2);

            // Atlas canvas to assemble batches in a single frame
            const atlasCanvas = document.createElement('canvas');
            atlasCanvas.width = THUMB_SIZE * BATCH_COLS;
            atlasCanvas.height = THUMB_SIZE * BATCH_ROWS;
            const atlasCtx = atlasCanvas.getContext('2d');

            // Encode canvas for individual data URLs
            if (!thumbCanvas) {
                thumbCanvas = document.createElement('canvas');
                thumbCtx = thumbCanvas.getContext('2d');
            }
            if (thumbCanvas.width !== THUMB_SIZE || thumbCanvas.height !== THUMB_SIZE) {
                thumbCanvas.width = THUMB_SIZE;
                thumbCanvas.height = THUMB_SIZE;
            }
            renderer3d.__pickerShared = { material, thumbRenderer, thumbScene, thumbCamera, thumbMesh, atlasCanvas, atlasCtx };
        } else {
            if (!thumbCanvas) {
                thumbCanvas = document.createElement('canvas');
                thumbCtx = thumbCanvas.getContext('2d');
            }
            if (thumbCanvas.width !== THUMB_SIZE || thumbCanvas.height !== THUMB_SIZE) {
                thumbCanvas.width = THUMB_SIZE;
                thumbCanvas.height = THUMB_SIZE;
            }
            // Ensure atlas exists and sized
            const shared = renderer3d.__pickerShared;
            if (!shared.atlasCanvas) {
                shared.atlasCanvas = document.createElement('canvas');
                shared.atlasCtx = shared.atlasCanvas.getContext('2d');
            }
            const atlasW = THUMB_SIZE * BATCH_COLS;
            const atlasH = THUMB_SIZE * BATCH_ROWS;
            if (shared.atlasCanvas.width !== atlasW || shared.atlasCanvas.height !== atlasH) {
                shared.atlasCanvas.width = atlasW;
                shared.atlasCanvas.height = atlasH;
            }
        }
    }

    async function renderThumbnailIfNeeded(pieceId, index) {
        if (thumbnails.has(pieceId)) return;
        if (!renderer3d) return;
        const geometry = renderer3d.getGeometryForPieceId && renderer3d.getGeometryForPieceId(pieceId);
        if (!geometry) return;

        await ensureSharedResources();
        const shared = renderer3d.__pickerShared;
        const renderer = shared.thumbRenderer;
        const scene = new Scene();
        const camera = new PerspectiveCamera(35, 1, 0.1, 2000);
        const mesh = new Mesh(geometry, shared.material);
        scene.add(mesh);
        const dir1 = new DirectionalLight(0xffffff, 2.0);
        dir1.direction.set(-0.6, -1.0, -0.4).normalize();
        scene.add(dir1);
        const dir2 = new DirectionalLight(0x8fbfff, 0.6);
        dir2.direction.set(0.6, -0.3, 0.6).normalize();
        scene.add(dir2);
        try {
            if (!geometry.boundingBox) geometry.computeBoundingBox();
            const center = geometry.boundingBox.getCenter(new Vector3());
            mesh.position.set(-center.x, -center.y, -center.z);
            const size = geometry.boundingBox.getSize(new Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.6);
            camera.lookAt(0, 0, 0);
        } catch(_) {}

        try {
            await renderer.render(scene, camera);
            await new Promise((r)=>requestAnimationFrame(r));
            thumbCtx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
            thumbCtx.drawImage(renderer.canvas, 0, 0, THUMB_SIZE, THUMB_SIZE);
            const dataURL = thumbCanvas.toDataURL('image/png');
            thumbnails.set(pieceId, dataURL);
            thumbnails = thumbnails;
        } catch(_) {}
    }

    onMount(() => {
        ensureObserver();
    });
    onDestroy(() => {
        if (observer) { observer.disconnect(); observer = null; }
        // Reset shared thumb renderer so we don't carry stale frames across openings
        if (renderer3d && renderer3d.__pickerShared) {
            // Fraggl renderer has no dispose API; drop the reference to allow GC
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


