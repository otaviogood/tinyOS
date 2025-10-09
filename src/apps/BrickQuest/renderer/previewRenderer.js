// @ts-nocheck
import {
    Scene,
    PerspectiveCamera,
    WebGPURenderer,
    DirectionalLight,
    Mesh,
    BufferGeometry,
    BufferAttribute,
    Vector3,
} from "./fraggl/index.js";
import { StandardMaterial } from "./fraggl/index.js";

/**
 * PreviewRenderer - Manages the piece preview UI renderer
 * Separated from main game renderer for clarity and performance
 */
export class PreviewRenderer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.containerEl = null;
        this.mesh = null;
        this.rotationSpeed = 0.01;
        this.enabled = true;
        this.initialized = false;
        this.initializing = false;
    }

    /**
     * Set up the preview renderer with a container element
     */
    setupPreview(previewContainerElement) {
        if (!previewContainerElement) return;
        this.containerEl = previewContainerElement;
        
        // Create preview scene
        this.scene = new Scene();
        
        // Camera sized to container
        const pcw = (this.containerEl && this.containerEl.clientWidth) || 150;
        const pch = (this.containerEl && this.containerEl.clientHeight) || 150;
        this.camera = new PerspectiveCamera(30, Math.max(1e-3, pcw / Math.max(1, pch)), 0.1, 2000);
        this.camera.position.set(100, 80, 100);
        this.camera.lookAt(0, 0, 0);
        
        // Create dedicated canvas + renderer
        let canvas = null;
        if (typeof document !== 'undefined') {
            canvas = this.containerEl.querySelector('canvas[data-fraggl-preview]');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.dataset.fragglPreview = '';
                canvas.style.display = 'block';
                this.containerEl.appendChild(canvas);
            }
        }
        
        this.renderer = new WebGPURenderer({ 
            canvas, 
            clearColor: { r: 0, g: 0, b: 0, a: 0 }, 
            exposure: 1.0 
        });
        this.renderer.setSize(pcw, pch, true);
        this.renderer.setClearAlpha(0.0);
        
        // Disable shadows for preview rendering and pre-clear the shadow map to fully lit
        this.renderer.disableShadows = true;
        
        // Kick off async initialization (will complete before first render attempt)
        void this.ensureInitialized();
        
        // Lighting for preview
        const key = new DirectionalLight(0xffffff, 1.0);
        key.castShadow = false;
        key.direction.set(-0.6, -1.0, -0.4).normalize();
        this.scene.add(key);
    }

    /**
     * Initialize WebGPU on the preview renderer
     */
    async ensureInitialized() {
        if (!this.renderer || this.initialized === true || this.initializing) return;
        this.initializing = true;
        try {
            // Initialize WebGPU on the preview renderer and configure for transparent background
            await this.renderer.init(this.renderer.canvas);
            const dpr = typeof window !== "undefined" && window.devicePixelRatio 
                ? Math.min(window.devicePixelRatio, 2) 
                : 1;
            this.renderer.setPixelRatio(dpr);
            this.renderer.setClearAlpha(0.0);
            this.initialized = true;
        } catch (err) {
            console.warn('Failed to initialize preview renderer:', err);
        } finally {
            this.initializing = false;
        }
    }

    /**
     * Update the preview mesh based on selected piece and color
     * @param {Object} params - Configuration
     * @param {string} params.selectedPieceId - ID of the selected piece
     * @param {Map} params.brickGeometries - Map of piece ID to geometry
     * @param {Array} params.paletteLinear - Array of linear RGB colors
     * @param {number} params.selectedColorIndex - Index of selected color
     */
    updatePreviewMesh({ selectedPieceId, brickGeometries, paletteLinear, selectedColorIndex }) {
        if (!this.scene) return;
        
        // Remove existing
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry = null;
            this.mesh = null;
        }
        
        // Get source geometry
        let srcGeom = selectedPieceId ? brickGeometries.get(selectedPieceId) : null;
        if (!srcGeom && brickGeometries.size > 0) {
            srcGeom = brickGeometries.values().next().value;
        }
        if (!srcGeom) return;
        
        // Clone minimal geometry (share arrays but keep object distinct)
        const geom = new BufferGeometry();
        const pos = srcGeom.getAttribute?.('position') 
            || srcGeom.attributes?.get?.('position') 
            || srcGeom.attributes?.position;
        if (!pos || !pos.array) return;
        
        geom.setAttribute('position', new BufferAttribute(
            new Float32Array(pos.array), 
            pos.itemSize || 3
        ));
        
        const nrm = srcGeom.getAttribute?.('normal') 
            || srcGeom.attributes?.get?.('normal') 
            || srcGeom.attributes?.normal;
        if (nrm && nrm.array) {
            geom.setAttribute('normal', new BufferAttribute(
                new Float32Array(nrm.array), 
                nrm.itemSize || 3
            ));
        }
        
        const idx = srcGeom.getIndex?.() || srcGeom.index;
        if (idx && idx.array) {
            const ctor = idx.array instanceof Uint32Array ? Uint32Array : Uint16Array;
            geom.setIndex(new BufferAttribute(new ctor(idx.array), 1));
        }
        
        try { 
            geom.computeBoundingBox(); 
            geom.computeBoundingSphere(); 
        } catch (_) {}
        
        // Material color from palette (linear)
        const lin = paletteLinear[selectedColorIndex] || [0.9, 0.9, 0.9];
        const mat = new StandardMaterial({ 
            baseColor: [lin[0], lin[1], lin[2], 1.0], 
            roughness: 0.35, 
            metallic: 0.0 
        });
        
        this.mesh = new Mesh(geom);
        this.mesh.material = mat;
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        
        // Center mesh at origin and frame camera
        if (geom.boundingBox) {
            const c = geom.boundingBox.getCenter(new Vector3());
            this.mesh.position.set(-c.x, -c.y, -c.z);
            const size = geom.boundingBox.getSize(new Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const dist = maxDim * 1.8;
            this.camera.position.set(dist, dist * 0.8, dist);
            this.camera.lookAt(0, 0, 0);
        }
        
        this.scene.add(this.mesh);
    }

    /**
     * Render the preview scene
     */
    render() {
        if (!this.renderer || !this.scene || !this.camera) return;
        
        // Only render if initialization is complete
        if (!this.initialized) {
            // Kick off initialization if not already started
            if (!this.initializing) void this.ensureInitialized();
            return;
        }
        
        if (this.mesh) {
            this.mesh.rotation.y += this.rotationSpeed;
        }
        
        try { 
            this.renderer.render(this.scene, this.camera); 
        } catch (_) { 
            /* ignore */ 
        }
    }

    /**
     * Resize the preview renderer
     */
    onResize() {
        if (!this.renderer || !this.containerEl || !this.camera) return;
        
        const pcw = this.containerEl.clientWidth || 150;
        const pch = this.containerEl.clientHeight || 150;
        this.renderer.setSize(pcw, pch, true);
        this.camera.aspect = Math.max(1e-3, pcw / Math.max(1, pch));
        this.camera.updateProjectionMatrix?.();
    }

    /**
     * Set whether preview is enabled
     */
    setEnabled(enabled) {
        this.enabled = !!enabled;
    }

    /**
     * Get the underlying WebGPU renderer
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Dispose of preview resources
     */
    dispose() {
        if (this.mesh) {
            this.scene?.remove(this.mesh);
            this.mesh.geometry = null;
            this.mesh = null;
        }
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.containerEl = null;
    }
}

