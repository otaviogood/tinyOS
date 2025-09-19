<svelte:options accessors />

<script>
    import { onMount, setContext } from "svelte";
    import * as THREE from "three/src/Three.WebGPU.Nodes.js";

    export let bg_color = null;
    export let id = "";

    let root2d;
    let renderer = null;
    let scene = null;
    let camera = null;
    let resizeOb = null;
    let rafId = 0;
    let dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
    let widthCss = 0;
    let heightCss = 0;

    // Expose size helpers (device pixels to match camera coordinate space)
    export function getWidth() {
        return widthCss;
    }
    export function getHeight() {
        return heightCss;
    }

    // Shared state for children (layered)
    const currentChildrenFront = new Map();
    const currentChildrenBack = new Map();
    const uniqueIndexes = { i: 1 };
    const linesDirty = [true];

    // Expose front map for default children (FastLineBQ)
    setContext("currentChildren", currentChildrenFront);
    setContext("uniqueIndexes", uniqueIndexes);
    setContext("linesDirty", linesDirty);

    // Public API for one-off drawing and reset
    export function lineOneOff(x0, y0, x1, y1, diameter, color) {
        const myId = uniqueIndexes.i;
        uniqueIndexes.i = uniqueIndexes.i + 1;
        const dataArr = new Float32Array(12);
        dataArr[0] = x0;
        dataArr[1] = y0;
        dataArr[2] = 0.0;
        dataArr[3] = 2.0;
        dataArr[4] = color[0];
        dataArr[5] = color[1];
        dataArr[6] = color[2];
        dataArr[7] = uniqueIndexes.i & 0x7fffff;
        dataArr[8] = x1;
        dataArr[9] = y1;
        dataArr[10] = diameter;
        dataArr[11] = 1.0;
        currentChildrenFront.set(myId, dataArr);
        linesDirty[0] = true;
        // remove after rebuild
        _oneOffsFront.push(myId);
    }

    // Back-layer line (renders behind front layer)
    export function lineOneOffBack(x0, y0, x1, y1, diameter, color) {
        const myId = uniqueIndexes.i;
        uniqueIndexes.i = uniqueIndexes.i + 1;
        const dataArr = new Float32Array(12);
        dataArr[0] = x0;
        dataArr[1] = y0;
        dataArr[2] = 0.0;
        dataArr[3] = 2.0;
        dataArr[4] = color[0];
        dataArr[5] = color[1];
        dataArr[6] = color[2];
        dataArr[7] = uniqueIndexes.i & 0x7fffff;
        dataArr[8] = x1;
        dataArr[9] = y1;
        dataArr[10] = diameter;
        dataArr[11] = 1.0;
        currentChildrenBack.set(myId, dataArr);
        linesDirty[0] = true;
        _oneOffsBack.push(myId);
    }

    export function reset() {
        currentChildrenFront.clear();
        currentChildrenBack.clear();
        linesDirty[0] = true;
    }

    // Instanced meshes for lines (oriented quads)
    let lineMeshFront = null; // THREE.InstancedMesh
    let lineMeshBack = null; // THREE.InstancedMesh
    let lineMaterial = null;
    let basePlane = null;
    let lastCountFront = 0;
    let lastCountBack = 0;
    let _oneOffsFront = [];
    let _oneOffsBack = [];

    function disposeGeometry() {
        if (basePlane) {
            try {
                basePlane.dispose();
            } catch (_) {}
            basePlane = null;
        }
    }

    function ensureMaterial() {
        if (lineMaterial) return lineMaterial;
        lineMaterial = new THREE.MeshBasicNodeMaterial({
            color: 0xffffff,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide,
            vertexColors: true,
        });
        return lineMaterial;
    }

    function rebuildGeometry() {
        // Count lines per layer
        let countFront = 0,
            countBack = 0;
        for (const _ of currentChildrenFront.values()) {
            void _;
            countFront++;
        }
        for (const _ of currentChildrenBack.values()) {
            void _;
            countBack++;
        }
        const hasAny = countFront + countBack > 0;
        if (!hasAny) {
            if (lineMeshFront) lineMeshFront.visible = false;
            if (lineMeshBack) lineMeshBack.visible = false;
            for (let i = 0; i < _oneOffsFront.length; i++) currentChildrenFront.delete(_oneOffsFront[i]);
            for (let i = 0; i < _oneOffsBack.length; i++) currentChildrenBack.delete(_oneOffsBack[i]);
            _oneOffsFront = [];
            _oneOffsBack = [];
            return;
        }
        // Ensure base plane
        if (!basePlane) basePlane = new THREE.PlaneGeometry(1, 1);
        // Recreate instanced mesh if counts changed or missing
        if (!lineMeshBack || lastCountBack !== countBack) {
            if (lineMeshBack) {
                try {
                    scene.remove(lineMeshBack);
                    lineMeshBack.geometry && lineMeshBack.geometry.dispose && lineMeshBack.geometry.dispose();
                } catch (_) {}
                lineMeshBack = null;
            }
            if (countBack > 0) {
                lineMeshBack = new THREE.InstancedMesh(basePlane, ensureMaterial(), countBack);
                lineMeshBack.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                lineMeshBack.renderOrder = 999;
                scene.add(lineMeshBack);
            }
            lastCountBack = countBack;
        }
        if (!lineMeshFront || lastCountFront !== countFront) {
            if (lineMeshFront) {
                try {
                    scene.remove(lineMeshFront);
                    lineMeshFront.geometry && lineMeshFront.geometry.dispose && lineMeshFront.geometry.dispose();
                } catch (_) {}
                lineMeshFront = null;
            }
            if (countFront > 0) {
                lineMeshFront = new THREE.InstancedMesh(basePlane, ensureMaterial(), countFront);
                lineMeshFront.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                lineMeshFront.renderOrder = 1000;
                scene.add(lineMeshFront);
            }
            lastCountFront = countFront;
        }
        // Write matrices and instance colors BACK
        const mat = new THREE.Matrix4();
        const quat = new THREE.Quaternion();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        const color = new THREE.Color();
        let i = 0;
        if (lineMeshBack) {
            for (const dataArr of currentChildrenBack.values()) {
                const x0 = dataArr[0];
                const y0 = dataArr[1];
                const x1 = dataArr[8];
                const y1 = dataArr[9];
                const diameter = Math.max(1, dataArr[10] || 1);
                const r = dataArr[4];
                const g = dataArr[5];
                const b = dataArr[6];

                const dx = x1 - x0;
                const dy = y1 - y0;
                const len = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);
                // Midpoint
                pos.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0);
                // Rotate around Z (screen space)
                quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
                // Exact 1px when diameter=1, no feather
                scl.set(Math.max(1e-3, len), Math.max(1, diameter), 1);
                mat.compose(pos, quat, scl);
                lineMeshBack.setMatrixAt(i, mat);
                color.setRGB(r, g, b);
                lineMeshBack.setColorAt(i, color);
                i++;
            }
            lineMeshBack.instanceMatrix.needsUpdate = true;
            if (lineMeshBack.instanceColor) lineMeshBack.instanceColor.needsUpdate = true;
            lineMeshBack.visible = countBack > 0;
        }
        // Write matrices and instance colors FRONT
        i = 0;
        if (lineMeshFront) {
            for (const dataArr of currentChildrenFront.values()) {
                const x0 = dataArr[0];
                const y0 = dataArr[1];
                const x1 = dataArr[8];
                const y1 = dataArr[9];
                const diameter = Math.max(1, dataArr[10] || 1);
                const r = dataArr[4];
                const g = dataArr[5];
                const b = dataArr[6];

                const dx = x1 - x0;
                const dy = y1 - y0;
                const len = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);
                pos.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0);
                quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
                scl.set(Math.max(1e-3, len), Math.max(1, diameter), 1);
                mat.compose(pos, quat, scl);
                lineMeshFront.setMatrixAt(i, mat);
                color.setRGB(r, g, b);
                lineMeshFront.setColorAt(i, color);
                i++;
            }
            lineMeshFront.instanceMatrix.needsUpdate = true;
            if (lineMeshFront.instanceColor) lineMeshFront.instanceColor.needsUpdate = true;
            lineMeshFront.visible = countFront > 0;
        }
        // clear one-offs both layers
        for (let j = 0; j < _oneOffsFront.length; j++) currentChildrenFront.delete(_oneOffsFront[j]);
        for (let j = 0; j < _oneOffsBack.length; j++) currentChildrenBack.delete(_oneOffsBack[j]);
        _oneOffsFront = [];
        _oneOffsBack = [];
    }

    function renderLoop() {
        if (!renderer || !scene || !camera) {
            rafId = requestAnimationFrame(renderLoop);
            return;
        }
        if (linesDirty[0]) {
            rebuildGeometry();
            linesDirty[0] = false;
        }
        if (renderer.backend && renderer.backend.device) {
            renderer.render(scene, camera);
        } else {
            void renderer.renderAsync(scene, camera);
        }
        rafId = requestAnimationFrame(renderLoop);
    }

    function resize() {
        if (!root2d) return;
        const rect = root2d.getBoundingClientRect();
        widthCss = Math.max(1, Math.floor(rect.width));
        heightCss = Math.max(1, Math.floor(rect.height));
        // Ortho camera with origin at top-left, y+ down
        // Scale camera by dpr to match renderer's pixel ratio
        const effectiveDpr = Math.min(dpr, 2);
        camera = new THREE.OrthographicCamera(-0.5, widthCss * effectiveDpr - 0.5, 0.5, -heightCss * effectiveDpr + 0.5, -1, 1);
        camera.rotation.x = Math.PI;
        camera.updateProjectionMatrix();
        if (renderer) {
            renderer.setPixelRatio(Math.min(dpr, 2));
            renderer.setSize(widthCss, heightCss, false);
        }
        linesDirty[0] = true;
    }

    onMount(() => {
        scene = new THREE.Scene();
        scene.background = bg_color ? new THREE.Color(bg_color) : null;
        renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        try {
            renderer.setClearColor(new THREE.Color(0x000000), 0);
        } catch (_) {}
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1.0;
        root2d.appendChild(renderer.domElement);
        try {
            void renderer.init();
        } catch (_) {}

        resizeOb = new ResizeObserver(resize);
        resizeOb.observe(root2d);
        resize();
        renderLoop();

        return () => {
            if (resizeOb) {
                try {
                    resizeOb.unobserve(root2d);
                } catch (_) {}
            }
            if (rafId) cancelAnimationFrame(rafId);
            if (renderer) {
                try {
                    renderer.dispose();
                } catch (_) {}
            }
            if (lineMaterial) {
                try {
                    lineMaterial.dispose();
                } catch (_) {}
            }
            disposeGeometry();
            if (renderer && renderer.domElement && renderer.domElement.parentNode === root2d) {
                try {
                    root2d.removeChild(renderer.domElement);
                } catch (_) {}
            }
            renderer = null;
            scene = null;
            camera = null;
        };
    });
</script>

<div bind:this={root2d} class="absolute inset-0 pointer-events-none" aria-hidden="true" />

<slot />
