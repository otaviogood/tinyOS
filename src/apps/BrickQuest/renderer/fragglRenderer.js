// @ts-nocheck
import {
    Scene,
    PerspectiveCamera,
    WebGPURenderer,
    DirectionalLight,
    Mesh,
    BufferGeometry,
    BufferAttribute,
    CylinderGeometry,
    ConeGeometry,
    BasicMaterial,
    StandardMaterial,
    SkyboxMaterial,
    Group,
    Box3,
    Vector3,
    Matrix4,
    Matrix3,
    Quaternion,
    Euler,
    Frustum,
} from "./fraggl/index.js";
import { TextureLoader } from "./fraggl/index.js";
import { SphereGeometry } from "./fraggl/index.js";
import { Box3Helper } from "./fraggl/helpers/Box3Helper.js";
import { Ray } from "./fraggl/math/Ray.js";
import { GLTFLoader } from "./fraggl/loaders/GLTFLoader.js";
import { Color, SRGBColorSpace } from "./fraggl/math/Color.js";
import { PlayerLabelsManager } from "./labels.js";

function createCanvasContainer(element) {
    if (element) {
        return element;
    }
    if (typeof document !== "undefined") {
        return document.body;
    }
    throw new Error("No valid DOM target to attach the Fraggl renderer canvas");
}

// Shadow configuration constants
const SHADOW_ORTHO_SIZE = 900; // Orthographic bounds for shadow camera (matches Three.js)
const SHADOW_MAP_SIZE = 2048; // Shadow map resolution
// Running sway parameters (approx. 10 degrees side-to-side)
const RUN_SWAY_MAX_RAD = Math.PI / 60;
const RUN_SWAY_HZ = 2.2; // sway frequency while moving
const RUN_SWAY_DAMP = 0.15; // how fast tilt eases back when stopping

export function createBrickQuestFragglRenderer(container, options = {}) {
    const {
        colorPalette = [],
        onLoadingTextChange = () => {},
        onError = () => {},
    } = options;

    const { el, width, height } = (() => {
        try {
            const target = createCanvasContainer(container);
            return {
                el: target,
                width: target.clientWidth || 800,
                height: target.clientHeight || 600,
            };
        } catch (err) {
            onError(err);
            throw err;
        }
    })();

    const canvas = (() => {
        if (typeof document === "undefined") return null;
        const existing = el.querySelector("canvas[data-fraggl-main]");
        if (existing) return existing;
        const node = document.createElement("canvas");
        node.dataset.fragglMain = "";
        el.appendChild(node);
        return node;
    })();

    // Core renderer objects
    const scene = new Scene();
    const camera = new PerspectiveCamera(75, width / Math.max(1, height), 0.5, 10000);
    camera.position.set(0, 50, 120);
    camera.lookAt(0, 45, 0);

    const renderer = new WebGPURenderer({
        canvas,
        clearColor: { r: 0.15, g: 0.8, b: 0.99, a: 1 },
        exposure: 1.0,
    });

    const directionalLight = new DirectionalLight(0xffffff, 2.2);
    directionalLight.direction.set(-0.4, -1.5, -0.25).normalize();
    directionalLight.castShadow = true;

    // Configure shadow mapping like Three.js renderer
    if (directionalLight.shadow) {
        // Set shadow map resolution
        directionalLight.shadow.mapSize = { width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE };

        // Configure shadow camera bounds to cover the scene
        // These bounds should encompass the typical scene extents
        directionalLight.shadow.camera = {
            left: -SHADOW_ORTHO_SIZE,
            right: SHADOW_ORTHO_SIZE,
            top: SHADOW_ORTHO_SIZE,
            bottom: -SHADOW_ORTHO_SIZE,
            // Push near plane out a bit to improve shadow precision and reduce peter-panning
            near: -1000,
            far: 10000 // Use RENDER_DISTANCE or a large value
        };
    }

    scene.add(directionalLight);

    const fillLight = new DirectionalLight(0x4a90e2, 0.8);
    fillLight.direction.set(100, -100, 100).normalize();
    scene.add(fillLight);

    const rimLight = new DirectionalLight(0xffffff, 0.5);
    rimLight.direction.set(0, 0, 200).normalize();
    scene.add(rimLight);

    // Skybox state
    let skyboxMesh = null;
    const textureLoader = new TextureLoader();

    async function setupSkybox() {
        try {
            const tex = await textureLoader.loadAsync('/apps/sky4.webp', {
                colorSpace: 'srgb',
                minFilter: 'linear',
                magFilter: 'linear',
                generateMipmaps: true
            });
            const farDistance = (camera && typeof camera.far === 'number') ? camera.far : 5000;
            const radius = Math.max(10, farDistance * 0.98);
            const skyGeo = new SphereGeometry(radius, 64, 32);
            const skyMat = new SkyboxMaterial({ map: tex });
            skyMat.depthTest = true;
            skyMat.depthWrite = false;
            skyboxMesh = new Mesh(skyGeo, skyMat);
            // Draw first by being found and rendered first in renderer
            skyboxMesh.castShadow = false;
            skyboxMesh.receiveShadow = false;
            scene.add(skyboxMesh);
        } catch (err) {
            console.error('Failed to load skybox texture', err);
        }
    }

    // Reusable temp color object to avoid allocations during conversions
    const _colorTemp = new Color();

    function fillColorAttribute(vertexCount, color = [1.0, 1.0, 1.0, 1.0]) {
        const arr = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
            const o = i * 4;
            arr[o + 0] = color[0];
            arr[o + 1] = color[1];
            arr[o + 2] = color[2];
            arr[o + 3] = color[3];
        }
        return arr;
    }

    function hexToLinearRGBA(hex, alpha = 1) {
        if (typeof hex !== 'number') return [1, 1, 1, alpha];
        _colorTemp.setHex(hex, SRGBColorSpace); // Automatically converts sRGB → linear
        return [_colorTemp.r, _colorTemp.g, _colorTemp.b, alpha];
    }

    const paletteLinear = Array.isArray(colorPalette) 
        ? colorPalette.map(hex => {
            _colorTemp.setHex(hex, SRGBColorSpace);
            return [_colorTemp.r, _colorTemp.g, _colorTemp.b];
        })
        : [];

    const debugGeometry = new BufferGeometry();
    debugGeometry.setAttribute("position", new BufferAttribute(new Float32Array([
        -10, 0, -10,
        10, 0, -10,
        10, 0, 10,
        -10, 0, 10,
    ]), 3));
    debugGeometry.setAttribute("color", new BufferAttribute(fillColorAttribute(4), 4));
    debugGeometry.setIndex(new BufferAttribute(new Uint16Array([
        0, 1, 2,
        0, 2, 3,
    ]), 1));
    const debugMaterial = new BasicMaterial({ color: [1.0, 1.0, 1.0, 1.0], wireframe: false });
    const debugMesh = new Mesh(debugGeometry, debugMaterial);
    debugMesh.receiveShadow = true;
    scene.add(debugMesh);

    // Persistent hover Box3 helper for picked AABB visualization
    const hoverBox = new Box3();
    const hoverBoxHelper = new Box3Helper(hoverBox, 0xffd835);
    hoverBoxHelper.visible = false;
    scene.add(hoverBoxHelper);

    // Stud highlight helper using our new CylinderGeometry
    const studGeometry = new CylinderGeometry(
        6.5,    // radiusTop
        6.5,    // radiusBottom
        4,      // height (from -2 to 2)
        32,      // radialSegments (reduced for performance)
        1,      // heightSegments
        false,  // openEnded (capped cylinder)
        0,      // thetaStart
        Math.PI * 2  // thetaLength
    );
	const studMaterial = new BasicMaterial({
		color: [0.87, 0.56, 0, 0.7], // #df8f00 in RGB
		transparent: true,
		depthTest: false,
		depthWrite: false,
		wireframe: false
	});
	let studHighlightMesh = new Mesh(studGeometry, studMaterial);
	studHighlightMesh.visible = false;
	scene.add(studHighlightMesh);

    // Keep the box helper as backup for debugging
    let studBox = new Box3();
    let studHelper = new Box3Helper(studBox, 0xdf8f00);
    studHelper.visible = false;
    if (studHelper.material) {
        studHelper.material.depthTest = false;
        studHelper.material.depthWrite = false;
    }
    scene.add(studHelper);

	// Ghost piece meshes for placement preview
let ghostMesh = null;
let ghostMeshAdditive = null;
let ghostMaterial = null;
let ghostMaterialAdditive = null;
let ghostArrowMaterial = null;
let ghostArrow = null;
let ghostArrowBaseOrigin = null;
let ghostArrowFadeStartTime = 0;
const ghostArrowFadeDurationMs = 3000;
let ghostDropAnimActive = false;
let ghostDropStartTime = 0;
const ghostDropDurationMs = 300;
const ghostDropStartDistance = 40;
let ghostDropDir = new Vector3(0, 1, 0);
let lastSnapKey = null;
let isPlayerMoving = false;
const ghostArrowBaseAlpha = 0.7;

	// Preview state (piece preview in bottom-right UI)
	let previewScene = null;
	let previewCamera = null;
	let previewRenderer = null;
	let previewContainerEl = null;
	let previewMesh = null;
	let previewRotationSpeed = 0.01;
	let previewEnabled = true;
	let previewInitialized = false;
	let previewInitializing = false;

	function setupGhostMaterial() {
		if (ghostMaterial && ghostMaterialAdditive) return;
        ghostMaterial = new StandardMaterial({
            baseColor: hexToLinearRGBA(0x00ffc8, 0.95),
            roughness: 0.3,
            metallic: 0.0,
            transparent: true,
            depthWrite: false
        });
	// Secondary very-dim additive layer to show through occluders
		ghostMaterialAdditive = new StandardMaterial({
            baseColor: hexToLinearRGBA(0x101010, 0.96),
			roughness: 0.3,
			metallic: 0.0,
			transparent: true,
			depthTest: false,
			depthWrite: false
		});
	}

	function getSelectedConnectorForPiece(pieceData) {
		const useStud = (selectedAnchorMode === 'stud');
		if (!pieceData) return null;
		if (useStud) {
			const studs = Array.isArray(pieceData.studs) ? pieceData.studs : [];
			if (studs.length === 0) return null;
			const idx = studs.length > 0 ? ((selectedStudIndex % studs.length) + studs.length) % studs.length : 0;
			return { connector: (studs[idx] || studs[0]), useStud: true };
		} else {
			const antis = Array.isArray(pieceData.antiStuds) ? pieceData.antiStuds : [];
			if (antis.length === 0) return null;
			const idx = antis.length > 0 ? ((selectedAntiStudIndex % antis.length) + antis.length) % antis.length : 0;
			return { connector: (antis[idx] || antis[0]), useStud: false };
		}
	}

	function computeGhostPoseFromConnector(connInfo, baseQuat, closestStudInfoLocal, closestAntiStudInfoLocal) {
		let finalQuat = baseQuat.clone();
		let targetPos = null;
		if (!connInfo || !connInfo.connector) return { finalQuat, targetPos, connInfo };
		const useStud = connInfo.useStud;
		const connector = connInfo.connector;
		const targetAxis = (useStud ? (closestAntiStudInfoLocal && closestAntiStudInfoLocal.direction) : (closestStudInfoLocal && closestStudInfoLocal.direction)) || new Vector3(0, 1, 0);
		const normTargetAxis = targetAxis.clone().normalize();
		const localDir = new Vector3(
			Number.isFinite(connector.dx) ? connector.dx : 0,
			Number.isFinite(connector.dy) ? connector.dy : 1,
			Number.isFinite(connector.dz) ? connector.dz : 0,
		).normalize();
		const dirWorld0 = localDir.clone().applyQuaternion(finalQuat).normalize();
		const alignQuat = new Quaternion().setFromUnitVectors(dirWorld0, normTargetAxis);
		finalQuat = alignQuat.clone().multiply(finalQuat);
		const localPos = new Vector3(
			Number.isFinite(connector.x) ? connector.x : 0,
			Number.isFinite(connector.y) ? connector.y : 0,
			Number.isFinite(connector.z) ? connector.z : 0,
		);
		const worldOffset = localPos.clone().applyQuaternion(finalQuat);
		const snapPos = useStud ? (closestAntiStudInfoLocal && closestAntiStudInfoLocal.position) : (closestStudInfoLocal && closestStudInfoLocal.position);
		if (snapPos) {
			targetPos = { x: snapPos.x - worldOffset.x, y: snapPos.y - worldOffset.y, z: snapPos.z - worldOffset.z };
		}
		return { finalQuat, targetPos, connInfo };
	}

	function setGhostCollisionVisual(colliding) {
        if (!ghostMaterial) return;
        const colorLinear = colliding ? hexToLinearRGBA(0xff0000, ghostMaterial.baseColor?.[3] ?? 0.95) : hexToLinearRGBA(0x00ffc8, ghostMaterial.baseColor?.[3] ?? 0.95);
        ghostMaterial.baseColor = colorLinear;
        if (ghostMaterialAdditive) {
            ghostMaterialAdditive.baseColor = colliding ? hexToLinearRGBA(0xa00000, ghostMaterialAdditive.baseColor?.[3] ?? 0.96) : hexToLinearRGBA(0x101010, ghostMaterialAdditive.baseColor?.[3] ?? 0.96);
        }
        if (ghostMesh) ghostMesh.material = ghostMaterial;
        if (ghostMeshAdditive) ghostMeshAdditive.material = ghostMaterialAdditive;
        // Sync arrow RGB with ghost piece color; keep arrow alpha as-is
        if (ghostArrowMaterial && ghostMaterial && Array.isArray(ghostMaterial.baseColor)) {
            const r = ghostMaterial.baseColor[0] ?? 0;
            const g = ghostMaterial.baseColor[1] ?? 1;
            const b = ghostMaterial.baseColor[2] ?? 0.8;
            const a = (ghostArrowMaterial.color && ghostArrowMaterial.color[3] != null) ? ghostArrowMaterial.color[3] : ghostArrowBaseAlpha;
            ghostArrowMaterial.color = [r, g, b, a];
        }
	}

	function hideGhostMeshes() {
		if (ghostMesh) ghostMesh.visible = false;
		if (ghostMeshAdditive) ghostMeshAdditive.visible = false;
        if (ghostArrow) ghostArrow.visible = false;
		ghostTargetPos = null;
		ghostPieceId = null;
		ghostDropAnimActive = false;
		ghostDropStartTime = 0;
		ghostDropDir.set(0, 1, 0);
		lastSnapKey = null;
	}

	function computeConnectorAnimationVectors(connInfo, finalQuat, targetPos) {
		if (!connInfo || !connInfo.connector || !finalQuat || !targetPos) return null;
		const { connector, useStud } = connInfo;
		const localPos = new Vector3(
			Number.isFinite(connector.x) ? connector.x : 0,
			Number.isFinite(connector.y) ? connector.y : 0,
			Number.isFinite(connector.z) ? connector.z : 0,
		);
		const worldOffset = localPos.clone().applyQuaternion(finalQuat);
		const origin = new Vector3(
			targetPos.x + worldOffset.x,
			targetPos.y + worldOffset.y,
			targetPos.z + worldOffset.z
		);
		let localDir = new Vector3(
			Number.isFinite(connector.dx) ? connector.dx : 0,
			Number.isFinite(connector.dy) ? connector.dy : 1,
			Number.isFinite(connector.dz) ? connector.dz : 0,
		).normalize();
		const worldDir = localDir.applyQuaternion(finalQuat).normalize();
		// Match original renderer: move along connector for studs, opposite for anti; arrow points opposite anim
		const animDir = useStud ? worldDir.clone().normalize() : worldDir.clone().multiplyScalar(-1).normalize();
		const arrowDir = animDir.clone().multiplyScalar(-1).normalize();
		return { origin, animDir, arrowDir };
	}

	function ensureGhostArrow(connVectors) {
		if (!scene) return;
		if (!ghostArrow && ghostArrowMaterial) {
			const cone = new ConeGeometry(6, 16, 16);
			ghostArrow = new Mesh(cone, ghostArrowMaterial);
			ghostArrow.visible = false;
			scene.add(ghostArrow);
		}
		if (!ghostArrow) return;
		if (connVectors && connVectors.origin && connVectors.arrowDir) {
			ghostArrow.position.copy(connVectors.origin);
			ghostArrowBaseOrigin = connVectors.origin.clone();
			const up = new Vector3(0, 1, 0);
			const n = connVectors.arrowDir.clone().normalize();
			const q = new Quaternion().setFromUnitVectors(up, n);
			ghostArrow.setRotationFromQuaternion(q);
			ghostArrow.visible = !isPlayerMoving;
            // Ensure arrow RGB matches ghost piece when showing
            if (ghostArrowMaterial && ghostMaterial && Array.isArray(ghostMaterial.baseColor)) {
                const r = ghostMaterial.baseColor[0] ?? 0;
                const g = ghostMaterial.baseColor[1] ?? 1;
                const b = ghostMaterial.baseColor[2] ?? 0.8;
                const a = (ghostArrowMaterial.color && ghostArrowMaterial.color[3] != null) ? ghostArrowMaterial.color[3] : ghostArrowBaseAlpha;
                ghostArrowMaterial.color = [r, g, b, a];
            }
		} else {
			ghostArrow.visible = false;
		}
	}

	function applyGhostPlacement({ finalQuat, targetPos }) {
		if (!ghostMesh || !targetPos) return;
		const now = Date.now();
		let posX = targetPos.x;
		let posY = targetPos.y;
		let posZ = targetPos.z;
		if (ghostDropAnimActive && ghostDropDir) {
			const t = Math.max(0, Math.min(1, (now - ghostDropStartTime) / ghostDropDurationMs));
			const easeOut = 1 - Math.pow(1 - t, 3);
			const remaining = (1 - easeOut) * ghostDropStartDistance;
			posX = targetPos.x + ghostDropDir.x * remaining;
			posY = targetPos.y + ghostDropDir.y * remaining;
			posZ = targetPos.z + ghostDropDir.z * remaining;
			if (t >= 1) ghostDropAnimActive = false;
		}
		ghostMesh.position.set(posX, posY, posZ);
		ghostMesh.setRotationFromQuaternion(finalQuat);
	const visible = !isPlayerMoving;
	ghostMesh.visible = visible;
		if (ghostMeshAdditive) {
			ghostMeshAdditive.position.set(posX, posY, posZ);
			ghostMeshAdditive.setRotationFromQuaternion(finalQuat);
			ghostMeshAdditive.visible = visible;
		}
	}

	function ensureGhostMesh(forceGeometryUpdate = false) {
		if (!scene) return;
		setupGhostMaterial();
	if (!ghostArrowMaterial) {
        // Initialize arrow color from current ghost color if available
        const base = (ghostMaterial && Array.isArray(ghostMaterial.baseColor)) ? ghostMaterial.baseColor : [0.0, 1.0, 0.8, 1.0];
        ghostArrowMaterial = new BasicMaterial({
            color: [base[0] ?? 0, base[1] ?? 1, base[2] ?? 0.8, ghostArrowBaseAlpha],
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
	}

		// Select geometry for current piece
		const selectedPiece = pieceListRef[selectedPieceIndex];
		const selectedPieceId = selectedPiece ? selectedPiece.id : null;
		if (!selectedPieceId) {
			hideGhostMeshes();
			return;
		}
		let geometry = brickGeometries.get(selectedPieceId);
		if (!geometry && brickGeometries.size > 0) {
			geometry = brickGeometries.values().next().value;
		}
		if (!geometry) {
			hideGhostMeshes();
			return;
		}
		if (!ghostMesh) {
			ghostMesh = new Mesh(geometry, ghostMaterial);
			ghostMesh.castShadow = false;
			ghostMesh.receiveShadow = false;
			scene.add(ghostMesh);
			ghostMeshAdditive = new Mesh(geometry, ghostMaterialAdditive);
			ghostMeshAdditive.castShadow = false;
			ghostMeshAdditive.receiveShadow = false;
			scene.add(ghostMeshAdditive);
		} else if (forceGeometryUpdate || ghostMesh.geometry !== geometry) {
			ghostMesh.geometry = geometry;
			if (ghostMeshAdditive) ghostMeshAdditive.geometry = geometry;
		}

		// Compute orientation and target position via connector snapping
		const pieceData = piecesDataRef[selectedPieceId];
		const baseQuat = new Quaternion().setFromEuler(new Euler(0, ghostYaw, 0));
		const connInfo = getSelectedConnectorForPiece(pieceData);
		const pose = computeGhostPoseFromConnector(connInfo, baseQuat, closestStudInfo, closestAntiStudInfo);
		const finalQuat = pose.finalQuat;
		const targetPos = pose.targetPos;
		ghostTargetPos = targetPos;
		ghostPieceId = selectedPieceId;
		const e = new Euler().setFromQuaternion(finalQuat, "XYZ");
		ghostRotationEuler = { x: e.x, y: e.y, z: e.z };

		if (targetPos) {
			const connVectors = computeConnectorAnimationVectors(connInfo, finalQuat, targetPos);
			if (connVectors) {
				const snapInfo = (selectedAnchorMode === 'stud') ? closestAntiStudInfo : closestStudInfo;
				const snapBrickId = snapInfo?.brickId ?? 'none';
				const sx = snapInfo?.position?.x ?? targetPos.x;
				const sy = snapInfo?.position?.y ?? targetPos.y;
				const sz = snapInfo?.position?.z ?? targetPos.z;
				const newSnapKey = `${selectedAnchorMode}|${snapBrickId}|${sx.toFixed(1)},${sy.toFixed(1)},${sz.toFixed(1)}`;
				if (newSnapKey !== lastSnapKey) {
					lastSnapKey = newSnapKey;
					ghostDropAnimActive = !isPlayerMoving;
					ghostDropStartTime = Date.now();
					ghostDropDir.copy(connVectors.animDir);
					ghostArrowFadeStartTime = Date.now();
				}
			}
			ensureGhostArrow(connVectors);
		} else {
			lastSnapKey = null;
		}
		applyGhostPlacement({ finalQuat, targetPos });
	}

	async function ensurePreviewInitialized() {
		if (!previewRenderer || previewInitialized === true || previewInitializing) return;
		previewInitializing = true;
		try {
			// Initialize WebGPU on the preview renderer and configure for transparent background
			await previewRenderer.init(previewRenderer.canvas);
			const dpr = typeof window !== "undefined" && window.devicePixelRatio ? Math.min(window.devicePixelRatio, 2) : 1;
			previewRenderer.setPixelRatio(dpr);
			previewRenderer.setClearAlpha(0.0);
			previewInitialized = true;
		} catch (err) {
			console.warn('Failed to initialize preview renderer:', err);
		} finally {
			previewInitializing = false;
		}
	}

	function setupPreview(previewContainerElement) {
		if (!previewContainerElement) return;
		previewContainerEl = previewContainerElement;
		// Create preview scene
		previewScene = new Scene();
		// Camera sized to container
		const pcw = (previewContainerEl && previewContainerEl.clientWidth) || 150;
		const pch = (previewContainerEl && previewContainerEl.clientHeight) || 150;
		previewCamera = new PerspectiveCamera(30, Math.max(1e-3, pcw / Math.max(1, pch)), 0.1, 2000);
		previewCamera.position.set(100, 80, 100);
		previewCamera.lookAt(0, 0, 0);
		// Create dedicated canvas + renderer
		let canvas = null;
		if (typeof document !== 'undefined') {
			canvas = previewContainerEl.querySelector('canvas[data-fraggl-preview]');
			if (!canvas) {
				canvas = document.createElement('canvas');
				canvas.dataset.fragglPreview = '';
				canvas.style.display = 'block';
				previewContainerEl.appendChild(canvas);
			}
		}
		previewRenderer = new WebGPURenderer({ canvas, clearColor: { r: 0, g: 0, b: 0, a: 0 }, exposure: 1.0 });
		previewRenderer.setSize(pcw, pch, true);
		previewRenderer.setClearAlpha(0.0);
		// Disable shadows for preview rendering and pre-clear the shadow map to fully lit
		previewRenderer.disableShadows = true;
		// Kick off async initialization (will complete before first render attempt)
		void ensurePreviewInitialized();
		// Lighting for preview
		const key = new DirectionalLight(0xffffff, 1.0);
		key.castShadow = false;
		key.direction.set(-0.6, -1.0, -0.4).normalize();
		previewScene.add(key);
		// const fill = new DirectionalLight(0x4a90e2, 0.9);
		// fill.castShadow = false;
		// fill.direction.set(0.6, -0.4, 0.6).normalize();
		// previewScene.add(fill);
		// Initial mesh
		updatePreviewMesh();
	}

	function updatePreviewMesh() {
		if (!previewScene) return;
		// Remove existing
		if (previewMesh) {
			previewScene.remove(previewMesh);
			previewMesh.geometry = null;
			previewMesh = null;
		}
		// Selected piece geometry
		const selectedPiece = pieceListRef[selectedPieceIndex];
		const selectedId = selectedPiece ? selectedPiece.id : null;
		let srcGeom = selectedId ? brickGeometries.get(selectedId) : null;
		if (!srcGeom && brickGeometries.size > 0) {
			srcGeom = brickGeometries.values().next().value;
		}
		if (!srcGeom) return;
		// Clone minimal geometry (share arrays but keep object distinct)
		const geom = new BufferGeometry();
		const pos = srcGeom.getAttribute?.('position') || srcGeom.attributes?.get?.('position') || srcGeom.attributes?.position;
		if (!pos || !pos.array) return;
		geom.setAttribute('position', new BufferAttribute(new Float32Array(pos.array), pos.itemSize || 3));
		const nrm = srcGeom.getAttribute?.('normal') || srcGeom.attributes?.get?.('normal') || srcGeom.attributes?.normal;
		if (nrm && nrm.array) geom.setAttribute('normal', new BufferAttribute(new Float32Array(nrm.array), nrm.itemSize || 3));
		const idx = srcGeom.getIndex?.() || srcGeom.index;
		if (idx && idx.array) {
			const ctor = idx.array instanceof Uint32Array ? Uint32Array : Uint16Array;
			geom.setIndex(new BufferAttribute(new ctor(idx.array), 1));
		}
		try { geom.computeBoundingBox(); geom.computeBoundingSphere(); } catch (_) {}
		// Material color from palette (linear)
		const lin = paletteLinear[selectedColorIndex] || [0.9, 0.9, 0.9];
		const mat = new StandardMaterial({ baseColor: [lin[0], lin[1], lin[2], 1.0], roughness: 0.35, metallic: 0.0 });
		previewMesh = new Mesh(geom);
		previewMesh.material = mat;
		previewMesh.castShadow = false;
		previewMesh.receiveShadow = false;
		// Center mesh at origin and frame camera
		if (geom.boundingBox) {
			const c = geom.boundingBox.getCenter(new Vector3());
			previewMesh.position.set(-c.x, -c.y, -c.z);
			const size = geom.boundingBox.getSize(new Vector3());
			const maxDim = Math.max(size.x, size.y, size.z) || 1;
			const dist = maxDim * 1.8;
			previewCamera.position.set(dist, dist * 0.8, dist);
			previewCamera.lookAt(0, 0, 0);
		}
		previewScene.add(previewMesh);
	}

	function renderPreview() {
		if (!previewRenderer || !previewScene || !previewCamera) return;
		// Only render if initialization is complete
		if (!previewInitialized) {
			// Kick off initialization if not already started
			if (!previewInitializing) void ensurePreviewInitialized();
			return;
		}
		if (previewMesh) previewMesh.rotation.y += previewRotationSpeed;
		try { previewRenderer.render(previewScene, previewCamera); } catch (_) { /* ignore */ }
	}


    let initialized = false;
    let initializing = false;
    let debugAngle = 0;
    let lastGpuMs = 0;
    let lastGpuMsRaw = 0;
    const GPU_SMOOTH = 0.02;

    async function ensureInitialized() {
        if (initialized) return;
        if (initializing) return; // Prevent multiple simultaneous initialization attempts
        initializing = true;
        try {
            await renderer.init(canvas);
            if (!renderer.info) {
                renderer.info = { render: { calls: 0 }, reset: () => { renderer.info.render.calls = 0; } };
            } else if (typeof renderer.info.reset !== 'function') {
                renderer.info.reset = () => { renderer.info.render.calls = 0; };
            }
            const dpr = typeof window !== "undefined" && window.devicePixelRatio ? Math.min(window.devicePixelRatio, 2) : 1;
            renderer.setPixelRatio(dpr);
            renderer.setSize(width, height, true);
            renderer.setClearAlpha(1.0);
            initialized = true;
            // Kick off skybox loading after renderer init
            void setupSkybox();
        } catch (err) {
            initializing = false; // Reset on error so it can be retried
            onError(err);
            throw err;
        }
    }

    async function init() {
        await ensureInitialized();
        // Wait for geometries to load once during initialization
        await piecesLoadPromise;
        onLoadingTextChange("");
    }

    function dispose() {
        try {
            renderer?.depthTexture?.destroy?.();
        } catch (_) {}
        // Clean up ghost meshes
        if (ghostMesh) {
            scene.remove(ghostMesh);
            ghostMesh.geometry = null;
            ghostMesh = null;
        }
        if (ghostMeshAdditive) {
            scene.remove(ghostMeshAdditive);
            ghostMeshAdditive.geometry = null;
            ghostMeshAdditive = null;
        }
        if (ghostArrow) {
            scene.remove(ghostArrow);
            ghostArrow = null;
        }
        ghostMaterial = null;
        ghostMaterialAdditive = null;
        // Clean up stud highlight mesh
        if (studHighlightMesh) {
            scene.remove(studHighlightMesh);
            studHighlightMesh.geometry = null;
            studHighlightMesh = null;
        }
        if (studHelper) {
            scene.remove(studHelper);
            studHelper = null;
        }
    }

    async function onResize() {
        await ensureInitialized();
        const target = createCanvasContainer(container);
        const nextWidth = target.clientWidth || width;
        const nextHeight = target.clientHeight || height;
        renderer.setSize(nextWidth, nextHeight, true);
        camera.aspect = nextWidth / Math.max(1, nextHeight);
        camera.updateProjectionMatrix();
        // Adjust skybox radius to near far plane
        if (skyboxMesh && skyboxMesh.geometry && typeof camera.far === 'number') {
            const farDistance = camera.far;
            const radius = Math.max(10, farDistance * 0.98);
            // Recreate geometry only if needed
            try {
                const sg = new SphereGeometry(radius, 64, 32);
                skyboxMesh.geometry = sg;
            } catch (_) {}
        }
		// Resize preview if present
		if (previewRenderer && previewContainerEl && previewCamera) {
			const pcw = previewContainerEl.clientWidth || 150;
			const pch = previewContainerEl.clientHeight || 150;
			previewRenderer.setSize(pcw, pch, true);
			previewCamera.aspect = Math.max(1e-3, pcw / Math.max(1, pch));
			previewCamera.updateProjectionMatrix?.();
		}
    }

    // Performance tracking for chunk rebuilds
    let lastChunkRebuildMs = 0;
    let totalChunkRebuildsThisFrame = 0;
    let lastTriangleCount = 0;

    function countSceneTriangles() {
        let total = 0;
        let debugCounts = { chunks: 0, highLOD: 0, lowLOD: 0, players: 0, ghost: 0, skybox: 0, culledDist: 0, culledFrustum: 0 };
        
        // Count chunk mesh triangles (respecting LOD and culling visibility)
        for (const record of chunkMeshData.values()) {
            if (!record) continue;
            
            const group = record.group;
            // Skip chunks that are culled (beyond render distance or outside frustum)
            if (group && !group.visible) {
                // Check if it was frustum culled or distance culled
                const ud = group.userData || {};
                if (ud.frustumCulled) {
                    debugCounts.culledFrustum++;
                } else {
                    debugCounts.culledDist++;
                }
                continue;
            }
            
            debugCounts.chunks++;
            
            // Count high LOD if visible (nearby chunks)
            if (record.high?.mesh?.visible && record.high.geometry) {
                const geom = record.high.geometry;
                const idx = geom.index;
                if (idx && idx.count) {
                    const tris = (idx.count / 3) | 0;
                    total += tris;
                    debugCounts.highLOD += tris;
                }
            }
            
            // Count low LOD if visible (far chunks)
            if (record.low?.mesh?.visible && record.low.geometry) {
                const geom = record.low.geometry;
                const idx = geom.index;
                if (idx && idx.count) {
                    const tris = (idx.count / 3) | 0;
                    total += tris;
                    debugCounts.lowLOD += tris;
                }
            }
        }
        
        // Count player meshes (including local player minifigure groups)
        for (const mesh of playerMeshes.values()) {
            if (!mesh || !mesh.visible) continue;
            
            // Handle Group objects (minifigures have legs, torso, head)
            if (mesh.children && mesh.children.length > 0) {
                for (const child of mesh.children) {
                    if (!child || !child.visible || !child.geometry) continue;
                    const geom = child.geometry;
                    const idx = geom.index;
                    if (idx && idx.count) {
                        const tris = (idx.count / 3) | 0;
                        total += tris;
                        debugCounts.players += tris;
                    }
                }
            } else if (mesh.geometry) {
                // Single mesh (fallback player geometry)
                const geom = mesh.geometry;
                const idx = geom.index;
                if (idx && idx.count) {
                    const tris = (idx.count / 3) | 0;
                    total += tris;
                    debugCounts.players += tris;
                }
            }
        }
        
        // Count ghost mesh if visible
        if (ghostMesh?.visible && ghostMesh.geometry) {
            const geom = ghostMesh.geometry;
            const idx = geom.index;
            if (idx && idx.count) {
                const tris = (idx.count / 3) | 0;
                total += tris;
                debugCounts.ghost += tris;
            }
        }
        
        // Count skybox if visible
        if (skyboxMesh?.visible && skyboxMesh.geometry) {
            const geom = skyboxMesh.geometry;
            const idx = geom.index;
            if (idx && idx.count) {
                const tris = (idx.count / 3) | 0;
                total += tris;
                debugCounts.skybox += tris;
            }
        }
        
        // Debug output every 60 frames (~1 second at 60fps)
        // if (typeof lastTriangleDebugFrame === 'undefined') window.lastTriangleDebugFrame = 0;
        // if (++window.lastTriangleDebugFrame >= 60) {
        //     window.lastTriangleDebugFrame = 0;
        //     const totalCulled = debugCounts.culledDist + debugCounts.culledFrustum;
        //     console.log(`[Triangle Count] Total: ${total.toLocaleString()} | Chunks: ${debugCounts.chunks} visible (${totalCulled} culled: ${debugCounts.culledDist} dist, ${debugCounts.culledFrustum} frustum) | High LOD: ${debugCounts.highLOD.toLocaleString()} | Low LOD: ${debugCounts.lowLOD.toLocaleString()} | Players: ${debugCounts.players.toLocaleString()} | Ghost: ${debugCounts.ghost} | Skybox: ${debugCounts.skybox.toLocaleString()}`);
        // }
        
        return total;
    }

    async function renderTick(localPlayer, yaw, pitch, isThirdPerson, isMoving) {
        // Early return if not yet initialized (init() must be called explicitly first)
        if (!initialized) return;
        // Early return if geometries haven't loaded yet
        if (!geometriesLoaded) return;
        // Track player movement to gate ghost visibility/animations
        isPlayerMoving = !!isMoving;
        // Reset per-frame chunk rebuild tracking
        lastChunkRebuildMs = 0;
        totalChunkRebuildsThisFrame = 0;
        debugAngle += 0.01;
        const eyeHeight = 30;
        if (localPlayer && localPlayer.position) {
            const target = new Vector3(localPlayer.position.x, localPlayer.position.y + eyeHeight, localPlayer.position.z);
            if (isThirdPerson) {
                const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
                const desiredPos = target.clone().add(dir.multiplyScalar(-160));
                desiredPos.y += 30;
                camera.position.copy(desiredPos);
                camera.lookAt(target);
            } else {
                camera.position.copy(target);
                const lookDirection = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
                const lookTarget = camera.position.clone().add(lookDirection);
                camera.lookAt(lookTarget);
            }
            // Sync local player's mesh immediately to avoid one-frame lag
            if (localPlayer.id) {
                const mesh = playerMeshes.get(localPlayer.id);
                if (mesh) {
                    mesh.visible = !!isThirdPerson;
                    mesh.position.set(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z);
                    // Apply yaw plus a left/right roll when running
                    const tSec = Date.now() * 0.001;
                    const targetRoll = isMoving
                        ? Math.sin(tSec * (RUN_SWAY_HZ * Math.PI * 2)) * RUN_SWAY_MAX_RAD
                        : 0;
                    // Smoothly ease current roll toward target
                    const currentRoll = mesh.rotation.z || 0;
                    const easedRoll = currentRoll + (targetRoll - currentRoll) * (isMoving ? 0.35 : RUN_SWAY_DAMP);
                    mesh.rotation.y = yaw || 0;
                    mesh.rotation.z = easedRoll;
                }
            }
        } else {
            camera.position.x = Math.cos(debugAngle) * 120;
            camera.position.z = Math.sin(debugAngle) * 120;
            camera.lookAt(0, 0, 0);
        }

        if (directionalLight) {
            const lightDir = new Vector3(-0.6, -1.0, -0.4).normalize();
            const lightDistance = 600;

            // Calculate light position relative to camera (like Three.js)
            const lightPos = camera.position.clone().sub(lightDir.clone().multiplyScalar(lightDistance)).add(new Vector3(0, 200, 0));
            directionalLight.position.copy(lightPos);

            // Update shadow camera target to follow camera position for consistent shadows
            if (directionalLight.shadow && directionalLight.shadow.camera) {
                // The shadow camera should look at the camera/player position, not the scene center
                // This ensures the shadow matrix is computed correctly relative to the light position
                const shadowTarget = camera.position.clone();

                // Store the shadow target on the light so the WebGPU renderer can use it
                // @ts-ignore - target property added to LightShadow class
                directionalLight.shadow.target = shadowTarget;

                // Ensure shadow camera far plane covers the render distance
                const renderDist = RENDER_DISTANCE || 10000;
                if (directionalLight.shadow.camera.far !== renderDist) {
                    directionalLight.shadow.camera.far = renderDist;
                }

                // Update shadow camera bounds to use consistent size (matching Three.js)
                if (directionalLight.shadow.camera.left !== -SHADOW_ORTHO_SIZE) {
                    directionalLight.shadow.camera.left = -SHADOW_ORTHO_SIZE;
                    directionalLight.shadow.camera.right = SHADOW_ORTHO_SIZE;
                    directionalLight.shadow.camera.top = SHADOW_ORTHO_SIZE;
                    directionalLight.shadow.camera.bottom = -SHADOW_ORTHO_SIZE;
                }
            }
        }

        // Keep all skyboxes centered on camera (by material flag)
        centerSkyboxesOnCamera();

        // Build frustum for chunk culling
        camera.updateMatrices();
        const viewProjMatrix = new Matrix4();
        viewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.viewMatrix);
        const frustum = new Frustum();
        frustum.setFromProjectionMatrix(viewProjMatrix, null, camera.reversedDepth);

        // Chunk LOD selection, frustum culling (for stats), and far-distance culling
        if (chunkState.chunkGroups && chunkState.chunkGroups.size > 0) {
            for (const [chunkKey, group] of chunkState.chunkGroups.entries()) {
                if (!group) continue;
                const ud = group.userData || (group.userData = {});
                // Distance-based chunk culling using chunk centroid vs render distance
                let centroidX, centroidY, centroidZ;
                if (chunkState.CHUNK_SIZE != null && chunkState.CHUNK_HEIGHT != null) {
                    centroidX = group.position.x + (chunkState.CHUNK_SIZE * 0.5);
                    centroidY = group.position.y + (chunkState.CHUNK_HEIGHT * 0.5);
                    centroidZ = group.position.z + (chunkState.CHUNK_SIZE * 0.5);
                } else if (ud.chunkBounds) {
                    const c = ud.chunkBounds.getCenter(new Vector3());
                    centroidX = c.x; centroidY = c.y; centroidZ = c.z;
                } else {
                    centroidX = group.position.x; centroidY = group.position.y; centroidZ = group.position.z;
                }
                tempVec.set(centroidX, centroidY, centroidZ);
                const distToCentroid = tempVec.distanceTo(camera.position);
                const beyondFar = Number.isFinite(RENDER_DISTANCE) && distToCentroid > RENDER_DISTANCE;
                
                // Frustum culling: check if chunk bounds are outside view frustum
                // Note: keep group.visible independent of camera frustum so shadow pass can still traverse
                let outsideFrustum = false;
                if (!beyondFar && ud.chunkBounds) {
                    // ud.chunkBounds is stored in world space; test directly
                    outsideFrustum = !frustum.intersectsBox(ud.chunkBounds);
                }

                // Mark frustum status for stats/logic; only distance affects group visibility here
                ud.frustumCulled = outsideFrustum;
                group.visible = !beyondFar;
                
                const record = chunkMeshData.get(chunkKey);
                if (!group.visible) {
                    // No further work when culled
                    continue;
                }
                // Ensure bounds exist
                if (!ud.chunkBounds && record) {
                    const bounds = new Box3();
                    let any = false;
                    if (record.low && record.low.geometry && record.low.geometry.boundingBox) {
                        const bb = record.low.geometry.boundingBox;
                        const min = bb.min.clone().add(group.position);
                        const max = bb.max.clone().add(group.position);
                        bounds.min.min(min); bounds.max.max(max); any = true;
                    }
                    if (record.high && record.high.geometry && record.high.geometry.boundingBox) {
                        const bb = record.high.geometry.boundingBox;
                        const min = bb.min.clone().add(group.position);
                        const max = bb.max.clone().add(group.position);
                        if (!any) { bounds.min.copy(min); bounds.max.copy(max); any = true; } else { bounds.min.min(min); bounds.max.max(max); }
                    }
                    if (any) ud.chunkBounds = bounds;
                }
                // LOD selection per chunk (distance-based)
                const desiredLod = (distToCentroid > LOD_DISTANCE) ? 1 : 0; // 0=high,1=low
                const changed = ud.lod !== desiredLod;
                ud.lod = desiredLod;
                if (record) {
                    if (desiredLod === 0) {
                        // Need high detail nearby
                        if (!record.high || !record.high.mesh) {
                            rebuildChunkMeshesLOD(chunkKey, record);
                        }
                    } else {
                        // Ensure low exists
                        if (!record.low || !record.low.mesh) {
                            rebuildChunkMeshesLOD(chunkKey, record);
                        }
                    }
                    // Toggle visibility according to desired LOD
                    if (record.low && record.low.mesh) record.low.mesh.visible = (desiredLod !== 0);
                    if (record.high && record.high.mesh) record.high.mesh.visible = (desiredLod === 0);
                }
            }
        }

        // Sync placement mode and connector indices from localPlayer each frame
        {
            let needsGhostUpdate = false;
            if (localPlayer && typeof localPlayer.anchorMode === 'string') {
                const mode = (localPlayer.anchorMode === 'stud') ? 'stud' : 'anti';
                if (mode !== selectedAnchorMode) {
                    selectedAnchorMode = mode;
                    needsGhostUpdate = true;
                }
            }
            if (localPlayer && Number.isFinite(localPlayer.selectedStudIndex)) {
                const idx = Math.max(0, localPlayer.selectedStudIndex | 0);
                if (idx !== selectedStudIndex) {
                    selectedStudIndex = idx;
                    needsGhostUpdate = true;
                }
            }
            if (localPlayer && Number.isFinite(localPlayer.selectedAntiStudIndex)) {
                const idx = Math.max(0, localPlayer.selectedAntiStudIndex | 0);
                if (idx !== selectedAntiStudIndex) {
                    selectedAntiStudIndex = idx;
                    needsGhostUpdate = true;
                }
            }
            if (needsGhostUpdate) {
                ensureGhostMesh(false);
            }
        }

        // Animate ghost opacity with a 1 Hz sine wave between 0.1 and 1.0 (preserve RGB)
        if (ghostMaterial && ghostMesh && ghostMesh.visible) {
            const tSec = Date.now() * 0.001;
            const phase = Math.sin(2 * Math.PI * 1.0 * tSec); // 1 Hz
            const minA = 0.1, maxA = 1.0;
            const opacity = ((phase + 1) * 0.5) * (maxA - minA) + minA;
            const r = ghostMaterial.baseColor?.[0] ?? 0;
            const g = ghostMaterial.baseColor?.[1] ?? 1;
            const b = ghostMaterial.baseColor?.[2] ?? 0.8;
            ghostMaterial.baseColor = [r, g, b, opacity];
            if (ghostMeshAdditive && ghostMeshAdditive.material) {
                const ar = ghostMaterialAdditive?.baseColor?.[0] ?? 0.06;
                const ag = ghostMaterialAdditive?.baseColor?.[1] ?? 0.06;
                const ab = ghostMaterialAdditive?.baseColor?.[2] ?? 0.06;
                ghostMeshAdditive.material.baseColor = [ar, ag, ab, Math.max(0.02, opacity * 0.4)];
            }
        }

        // Animate ghostArrow sliding along its axis and fade over time
        if (ghostArrow && ghostArrow.visible && ghostArrowMaterial) {
            const tSec = Date.now() * 0.001;
            const phase = Math.sin(2 * Math.PI * 1.0 * tSec);
            const up = new Vector3(0, 1, 0);
            const dir = up.applyQuaternion(ghostArrow.quaternion).normalize();
            const base = ghostArrowBaseOrigin;
            ghostArrow.position.set(
                base.x + dir.x * (phase - 0.2) * 30,
                base.y + dir.y * (phase - 0.2) * 30,
                base.z + dir.z * (phase - 0.2) * 30
            );
            const t = Math.max(0, Math.min(1, (Date.now() - ghostArrowFadeStartTime) / ghostArrowFadeDurationMs));
            const alpha = (1 - t) * ghostArrowBaseAlpha;
            const r = ghostMaterial?.baseColor?.[0] ?? (ghostArrowMaterial.color?.[0] ?? 0);
            const g = ghostMaterial?.baseColor?.[1] ?? (ghostArrowMaterial.color?.[1] ?? 1);
            const b = ghostMaterial?.baseColor?.[2] ?? (ghostArrowMaterial.color?.[2] ?? 0.8);
            ghostArrowMaterial.color = [r, g, b, alpha];
        }

        // Animate stud highlight mesh like Three.js
        if (studHighlightMesh && studHighlightMesh.visible) {
            const time = Date.now() * 0.003;
            const scale = 1 + Math.sin(time) * 0.07;
            studHighlightMesh.scale.set(scale, scale, scale);
            studHighlightMesh.rotation.y = time * 0.5;
        }

        // Update player labels to follow players and face camera
        const localPlayerId = localPlayer?.id;
        playerLabels.updateAll(playerMeshes, camera, localPlayerId, isThirdPerson);

		if (renderer && renderer.info && typeof renderer.info.reset === 'function') renderer.info.reset();
		await renderer.render(scene, camera);
		// Get accurate GPU frame time from timestamp queries (WebGPU feature)
		{
			const measured = renderer.getGpuTimeMs ? renderer.getGpuTimeMs() : 0;
			if (measured > 0) {
				lastGpuMsRaw = measured;
				lastGpuMs = lastGpuMs > 0 ? (lastGpuMs + (measured - lastGpuMs) * GPU_SMOOTH) : measured;
			}
		}
		// Count triangles for stats
		lastTriangleCount = countSceneTriangles();
		// Render piece preview last so it appears responsive even when world work is heavy
		if (previewEnabled) renderPreview();
    }

    function stubbedRaycast() {
        // For step 1, keep this as a no-op that clears pick state.
        lastRayHitValid = false;
        lastHitBrickId = null;
        lastMouseWorldPos = null;
        closestStudInfo = null;
        closestAntiStudInfo = null;
        // Also hide hover helper if visible
        hoverBoxHelper.visible = false;
        return null;
    }

    const chunkState = {
        CHUNK_SIZE: null,
        CHUNK_HEIGHT: null,
        chunkGroups: new Map(),
        chunkDebugVisible: false,
        chunkDebugWireframes: new Map(), // chunkKey -> wireframe mesh
    };

    const chunkMeshData = new Map(); // chunkKey -> { group, low?:{ mesh, geometry, brickMap }, high?:{ mesh, geometry, brickMap }, pick?:{ boxes, bounds }, version, signature, cachedBricks: {} }
    const playerMeshes = new Map();
    const playerLabels = new PlayerLabelsManager(scene);

    let gameStateRef = null;
    let pieceListRef = [];
    let piecesDataRef = {};

    // -----------------------------
    // Step 1: Establish picking/ghost state (no behavior yet)
    // -----------------------------
    // Config relevant to picking and visibility
    let PLACEMENT_MAX_DISTANCE = 1400; // world units
    let LOD_DISTANCE = 2000;           // world units
    let RENDER_DISTANCE = 10000;       // world units

    // Selection and ghost-related UI state
    let selectedPieceIndex = 0;
    let selectedColorIndex = 0;
    let selectedAnchorMode = 'anti'; // 'anti' or 'stud'
    let selectedAntiStudIndex = 0;
    let selectedStudIndex = 0;

    // Picking results
    let lastRayHitValid = false;
    let lastHitBrickId = null;
    let lastMouseWorldPos = null; // { x, y, z }
    let closestStudInfo = null;   // { position: Vector3, brickId, direction?: Vector3 }
    let closestAntiStudInfo = null;

    // Reusable scratch for picking refinement
    const _refineMatrix = new Matrix4();
    const _refineMesh = new Mesh();
    _refineMesh.matrixAutoUpdate = false;

    function refineWithTriangleRaycast(worldRay, candidates, maxTests = 3) {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;

        const tests = Math.min(maxTests | 0, candidates.length);
        let bestHit = null;

        for (let i = 0; i < tests; i++) {
            const cand = candidates[i];
            const geom = cand?.pieceId ? brickGeometries.get(cand.pieceId) : null;
            if (!geom) continue;

            const rot = cand.rot || { x: 0, y: 0, z: 0 };
            _refineMatrix.compose(
                new Vector3(cand.pos?.x ?? 0, cand.pos?.y ?? 0, cand.pos?.z ?? 0),
                new Quaternion().setFromEuler(new Euler(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0)),
                new Vector3(1, 1, 1)
            );

            _refineMesh.geometry = geom;
                _refineMesh.matrixWorld.copy(_refineMatrix);
                _refineMesh.matrixWorldNeedsUpdate = false;
                _refineMesh.visible = true;

            const hits = [];
            _refineMesh.raycast({ ray: worldRay, near: 0, far: PLACEMENT_MAX_DISTANCE }, hits);
            if (!hits || !hits.length) continue;

            const hit = hits[0];
            if (!hit) continue;

            const distance = hit.distance ?? hit.point.distanceTo(worldRay.origin);
            const candidateHit = {
                distance,
                point: hit.point.clone(),
                brickId: cand.brickId,
                chunkKey: cand.chunkKey,
            };

            if (!bestHit || distance < bestHit.distance) {
                bestHit = candidateHit;
            }
        }

        return bestHit;
    }

    // Minimal ghost state placeholders
let ghostTargetPos = null; // { x, y, z }
let ghostPieceId = null;   // string | null
let ghostRotationEuler = { x: 0, y: 0, z: 0 };
let ghostYaw = 0;

    const tempVec = new Vector3();
    // Scratch for skybox centering calculations
    const _tmpInvParent = new Matrix4();
    const _tmpLocalPos = new Vector3();

    function centerSkyboxesOnCamera() {
        if (!scene || !camera) return;
        const stack = [scene];
        while (stack.length) {
            const obj = stack.pop();
            if (obj && obj.children && obj.children.length) {
                for (let i = 0; i < obj.children.length; i++) stack.push(obj.children[i]);
            }
            if (obj && obj.material && obj.material.isSkybox === true) {
                if (obj.parent && obj.parent.matrixWorld) {
                    _tmpInvParent.copy(obj.parent.matrixWorld).invert();
                    _tmpLocalPos.copy(camera.position).applyMatrix4(_tmpInvParent);
                    obj.position.copy(_tmpLocalPos);
                } else {
                    obj.position.copy(camera.position);
                }
            }
        }
    }

    function ensureChunkGroup(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        let group = chunkState.chunkGroups.get(key);
        if (group) return group;
        group = new Group();
        const origin = getChunkOriginFromKey(chunkState, key);
        group.position.set(origin.x, origin.y, origin.z);
        group.userData.chunkKey = key;
        scene.add(group);
        chunkState.chunkGroups.set(key, group);
        
        // Create wireframe box for this chunk if debug mode is enabled
        if (chunkState.chunkDebugVisible && chunkState.CHUNK_SIZE != null && chunkState.CHUNK_HEIGHT != null) {
            const chunkBox = new Box3(
                new Vector3(0, 0, 0),
                new Vector3(chunkState.CHUNK_SIZE, chunkState.CHUNK_HEIGHT, chunkState.CHUNK_SIZE)
            );
            const boxHelper = new Box3Helper(chunkBox, 0x00ff00); // Green
            boxHelper.visible = chunkState.chunkDebugVisible;
            
            // Add helper to the chunk group
            group.add(boxHelper);
            chunkState.chunkDebugWireframes.set(key, boxHelper);
        }
        
        return group;
    }

    function getChunkOriginFromKey(state, key) {
        if (!key || state.CHUNK_SIZE == null || state.CHUNK_HEIGHT == null) return { x: 0, y: 0, z: 0 };
        const parts = String(key).split(',');
        const cx = parseInt(parts[0] || '0', 10) | 0;
        const cy = parseInt(parts[1] || '0', 10) | 0;
        const cz = parseInt(parts[2] || '0', 10) | 0;
        return { x: cx * state.CHUNK_SIZE, y: cy * state.CHUNK_HEIGHT, z: cz * state.CHUNK_SIZE };
    }

    function setChunkConfig(cfg) {
        chunkState.CHUNK_SIZE = (cfg && typeof cfg.size === 'number') ? cfg.size : null;
        chunkState.CHUNK_HEIGHT = (cfg && typeof cfg.height === 'number') ? cfg.height : null;
        for (const group of chunkState.chunkGroups.values()) {
            if (!group) continue;
            group.visible = chunkState.CHUNK_SIZE != null;
        }
    }

    function setChunkDebugVisible(visible) {
        chunkState.chunkDebugVisible = !!visible;
        
        // Update visibility of existing wireframes
        for (const wireframe of chunkState.chunkDebugWireframes.values()) {
            if (wireframe) wireframe.visible = chunkState.chunkDebugVisible;
        }
        
        // Create wireframes for chunks that don't have them yet
        if (chunkState.chunkDebugVisible && chunkState.CHUNK_SIZE != null && chunkState.CHUNK_HEIGHT != null) {
            for (const [chunkKey, group] of chunkState.chunkGroups.entries()) {
                if (!group) continue;
                
                // Skip if this chunk already has a wireframe
                if (chunkState.chunkDebugWireframes.has(chunkKey)) continue;
                
                // Create wireframe box for this chunk
                const chunkBox = new Box3(
                    new Vector3(0, 0, 0),
                    new Vector3(chunkState.CHUNK_SIZE, chunkState.CHUNK_HEIGHT, chunkState.CHUNK_SIZE)
                );
                const boxHelper = new Box3Helper(chunkBox, 0x00ff00); // Green
                
                // Add helper to the chunk group
                group.add(boxHelper);
                chunkState.chunkDebugWireframes.set(chunkKey, boxHelper);
            }
        }
    }

    const brickGeometries = new Map();
    const convexGeometries = new Map();
    const collisionGeometries = new Map();

    const loader = new GLTFLoader();
    loader.setPath("/apps/bricks/");

    let geometriesLoaded = false;
    const piecesLoadPromise = (async () => {
        try {
            const { scene: partsScene } = await loader.loadAsync("all_pieces.gltf");
            const library = partsScene.getObjectByName?.("LegoPartsLibrary") || null;
            if (!library) throw new Error("LegoPartsLibrary node missing in glTF");
            for (const child of library.children) {
                if (!child || !child.name) continue;
                const pieceId = child.name;
                const part = child.getObjectByName?.("part") || child;
                const geomNode = findFirstMesh(part);
                if (geomNode && geomNode.geometry) {
                    // Use the source geometry directly instead of cloning
                    // This allows all pieces to share the same BVH structure
                    const geom = geomNode.geometry;
                    // Ensure bounding box is computed for culling and bounds calculations
                    if (!geom.boundingBox) {
                        try { geom.computeBoundingBox(); } catch (_) {}
                    }
                    brickGeometries.set(pieceId, geom);
                }
                const convexNode = child.getObjectByName?.("convex");
                const convexMesh = convexNode ? findFirstMesh(convexNode) : null;
                if (convexMesh && convexMesh.geometry) {
                    // Use source geometry directly - no need to clone
                    const geom = convexMesh.geometry;
                    // Ensure bounding box is computed - critical for low LOD chunks
                    if (!geom.boundingBox) {
                        try { geom.computeBoundingBox(); } catch (_) {}
                    }
                    convexGeometries.set(pieceId, geom);
                }
                const collisionNode = child.getObjectByName?.("partnostuds");
                const collisionMesh = collisionNode ? findFirstMesh(collisionNode) : null;
                if (collisionMesh && collisionMesh.geometry) {
                    // Use source geometry directly - no need to clone
                    const geom = collisionMesh.geometry;
                    // Ensure bounding box is computed
                    if (!geom.boundingBox) {
                        try { geom.computeBoundingBox(); } catch (_) {}
                    }
                    collisionGeometries.set(pieceId, geom);
                }
            }
            geometriesLoaded = true;
        } catch (err) {
            console.error("Failed to load brick geometries:", err);
            geometriesLoaded = false;
        }
    })();

    function findFirstMesh(object) {
        if (!object) return null;
        if (object.isMesh) return object;
        const stack = [...(object.children || [])];
        while (stack.length) {
            const node = stack.shift();
            if (!node) continue;
            if (node.isMesh) return node;
            if (node.children && node.children.length) stack.push(...node.children);
        }
        return null;
    }

    function cloneGeometry(src) {
        const geometry = new BufferGeometry();
        const position = src.getAttribute?.("position");
        if (position) {
            // Use .slice() for faster array cloning instead of new TypedArray(array)
            geometry.setAttribute("position", new BufferAttribute(position.array.slice(), position.itemSize));
        }
        const normal = src.getAttribute?.("normal");
        if (normal) {
            geometry.setAttribute("normal", new BufferAttribute(normal.array.slice(), normal.itemSize));
        }
        const colorAttr = src.getAttribute?.("color");
        if (colorAttr) {
            geometry.setAttribute("color", new BufferAttribute(colorAttr.array.slice(), colorAttr.itemSize, colorAttr.normalized));
        }
        const uvAttr = src.getAttribute?.("uv");
        if (uvAttr) {
            geometry.setAttribute("uv", new BufferAttribute(uvAttr.array.slice(), uvAttr.itemSize));
        }
        if (src.index) {
            geometry.setIndex(new BufferAttribute(src.index.array.slice(), 1));
        }
        // Copy bounding box/sphere directly instead of recomputing
        if (src.boundingBox) {
            geometry.boundingBox = src.boundingBox.clone();
        }
        if (src.boundingSphere) {
            geometry.boundingSphere = src.boundingSphere.clone();
        }
        return geometry;
    }

    function createMinifigureGroup(colors) {
        const geomLegs = brickGeometries.get("73200");
        const geomTorso = brickGeometries.get("76382");
        const geomHead = brickGeometries.get("3626");
        if (!geomLegs || !geomTorso || !geomHead) return null;

        const legsHex = (colors && typeof colors.legs === 'number') ? colors.legs : 0x0e78cf;
        const torsoHex = (colors && typeof colors.torso === 'number') ? colors.torso : 0x0e78cf;
        const headHex = (colors && typeof colors.head === 'number') ? colors.head : 0xffd804;

        const legsMat = new StandardMaterial({ baseColor: hexToLinearRGBA(legsHex, 1.0), roughness: 0.35, metallic: 0.0 });
        const torsoMat = new StandardMaterial({ baseColor: hexToLinearRGBA(torsoHex, 1.0), roughness: 0.35, metallic: 0.0 });
        const headMat = new StandardMaterial({ baseColor: hexToLinearRGBA(headHex, 1.0), roughness: 0.35, metallic: 0.0 });

        const group = new Group();
        const legs = new Mesh(geomLegs, legsMat);
        const torso = new Mesh(geomTorso, torsoMat);
        const head = new Mesh(geomHead, headMat);

        legs.castShadow = true; legs.receiveShadow = true;
        torso.castShadow = true; torso.receiveShadow = true;
        head.castShadow = true; head.receiveShadow = true;

        legs.position.set(0, -12, 0);
        torso.position.set(0, 20, 0);
        head.position.set(0, 44, 0);

        group.add(legs);
        group.add(torso);
        group.add(head);
        return group;
    }

    function disposeChunkMesh(record) {
        if (!record) return;
        for (const kind of ['low','high']) {
            const entry = record[kind];
            if (!entry) continue;
            if (entry.mesh && record.group) record.group.remove(entry.mesh);
            if (entry.mesh) entry.mesh.geometry = null;
            if (entry.geometry && typeof entry.geometry.dispose === 'function') {
                try { entry.geometry.dispose(); } catch (_) {}
            }
            record[kind] = null;
        }
        record.version = null;
        record.signature = null;
    }

    function buildBakedGeometryForChunk({ chunkKey, bricks, useConvex = false }) {
        if (!Array.isArray(bricks) || !bricks.length) return null;
        const origin = getChunkOriginFromKey(chunkState, chunkKey);

        let totalVertices = 0;
        let totalIndices = 0;
        const sourceGeometries = new Array(bricks.length);
        
        // Pre-fetch all geometries and cache the source map lookup
        const geomSource = useConvex ? convexGeometries : brickGeometries;
        const fallbackSource = useConvex ? brickGeometries : null;

        for (let i = 0; i < bricks.length; i++) {
            const b = bricks[i];
            const geom = geomSource.get(b.pieceId) || (fallbackSource ? fallbackSource.get(b.pieceId) : null);
            if (!geom || !geom.attributes || !geom.attributes.get('position')) {
                sourceGeometries[i] = null;
                continue;
            }
            sourceGeometries[i] = geom;
            totalVertices += geom.attributes.get('position').count | 0;
            const idAttr = geom.index;
            totalIndices += idAttr ? (idAttr.count | 0) : ((geom.attributes.get('position').count / 3) | 0) * 3;
        }
        
        if (totalVertices === 0 || totalIndices === 0) {
            return null;
        }

        const useUint32 = totalVertices > 65535;
        const positions = new Float32Array(totalVertices * 3);
        const normals = new Float32Array(totalVertices * 3);
        const colors = new Uint8Array(totalVertices * 4);
        const indices = useUint32 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

        const boundsMin = new Vector3(Infinity, Infinity, Infinity);
        const boundsMax = new Vector3(-Infinity, -Infinity, -Infinity);

        let vertexOffset = 0;
        let indexOffset = 0;

        for (let brickIdx = 0; brickIdx < bricks.length; brickIdx++) {
            const brick = bricks[brickIdx];
            const geom = sourceGeometries[brickIdx];
            if (!geom) continue;

            // Direct attribute access like Three.js
            const posAttr = geom.attributes.get('position');
            const normalAttr = geom.attributes.get('normal');
            const indexAttr = geom.index;
            const vertCount = posAttr.count | 0;
            if (!vertCount) continue;

            const paletteIndex = brick.colorIndex | 0;
            const rgb = paletteLinear[paletteIndex] || [0.9, 0.9, 0.9];

            tempPosition.set(
                (brick.position?.x ?? 0) - origin.x,
                (brick.position?.y ?? 0) - origin.y,
                (brick.position?.z ?? 0) - origin.z
            );

            if (brick.rotation) {
                tempEuler.set(brick.rotation.x ?? 0, brick.rotation.y ?? 0, brick.rotation.z ?? 0, brick.rotation.order || 'XYZ');
                tempQuaternion.setFromEuler(tempEuler, false);
            } else {
                tempQuaternion.set(0, 0, 0, 1);
            }

            tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
            tempMatrixNormal.getNormalMatrixFromMatrix4(tempMatrix);
            
            // Update chunk bounds by transforming piece bounding box corners (much faster than per-vertex)
            if (geom.boundingBox) {
                const bb = geom.boundingBox;
                const m = tempMatrix.elements;
                // Transform 8 corners of the piece's bounding box
                for (let cornerIdx = 0; cornerIdx < 8; cornerIdx++) {
                    const x = (cornerIdx & 1) ? bb.max.x : bb.min.x;
                    const y = (cornerIdx & 2) ? bb.max.y : bb.min.y;
                    const z = (cornerIdx & 4) ? bb.max.z : bb.min.z;
                    const tx = m[0]*x + m[4]*y + m[8]*z + m[12];
                    const ty = m[1]*x + m[5]*y + m[9]*z + m[13];
                    const tz = m[2]*x + m[6]*y + m[10]*z + m[14];
                    if (tx < boundsMin.x) boundsMin.x = tx; if (ty < boundsMin.y) boundsMin.y = ty; if (tz < boundsMin.z) boundsMin.z = tz;
                    if (tx > boundsMax.x) boundsMax.x = tx; if (ty > boundsMax.y) boundsMax.y = ty; if (tz > boundsMax.z) boundsMax.z = tz;
                }
            }

            // Cache matrix elements in local variables for faster access
            const m = tempMatrix.elements;
            const m0 = m[0], m1 = m[1], m2 = m[2];
            const m4 = m[4], m5 = m[5], m6 = m[6];
            const m8 = m[8], m9 = m[9], m10 = m[10];
            const m12 = m[12], m13 = m[13], m14 = m[14];
            
            const nm = tempMatrixNormal.elements;
            const nm0 = nm[0], nm1 = nm[1], nm2 = nm[2];
            const nm3 = nm[3], nm4 = nm[4], nm5 = nm[5];
            const nm6 = nm[6], nm7 = nm[7], nm8 = nm[8];

            // Pre-compute color multipliers (avoid repeated multiplication)
            const colorR = rgb[0] * 255;
            const colorG = rgb[1] * 255;
            const colorB = rgb[2] * 255;

            // Cache source arrays
            const posArray = posAttr.array;
            const norArray = normalAttr.array;
            
            // Precompute bases and use running offsets to avoid per-iteration multiplies  
            const base3 = vertexOffset * 3;
            // Fast color path: pack RGBA into 32-bit and write once per vertex
            const colors32 = new Uint32Array(colors.buffer, colors.byteOffset, colors.length >>> 2);
            const packedRGBA = (255 << 24) | (Math.round(colorB) << 16) | (Math.round(colorG) << 8) | Math.round(colorR);
            let pOff = 0;
            let vOut = base3;
            let c32Out = vertexOffset;
            
            for (let i = 0; i < vertCount; i++, pOff += 3, vOut += 3) {
                const px = posArray[pOff + 0];
                const py = posArray[pOff + 1];
                const pz = posArray[pOff + 2];
                const tx = m0 * px + m4 * py + m8  * pz + m12;
                const ty = m1 * px + m5 * py + m9  * pz + m13;
                const tz = m2 * px + m6 * py + m10 * pz + m14;
                positions[vOut + 0] = tx;
                positions[vOut + 1] = ty;
                positions[vOut + 2] = tz;
                const nx = norArray[pOff + 0];
                const ny = norArray[pOff + 1];
                const nz = norArray[pOff + 2];
                const ntx = nm0 * nx + nm3 * ny + nm6 * nz;
                const nty = nm1 * nx + nm4 * ny + nm7 * nz;
                const ntz = nm2 * nx + nm5 * ny + nm8 * nz;
                normals[vOut + 0] = ntx;
                normals[vOut + 1] = nty;
                normals[vOut + 2] = ntz;
                colors32[c32Out++] = packedRGBA;
            }

            if (indexAttr) {
                const idxArray = indexAttr.array;
                let outOff = indexOffset;
                const base = vertexOffset;
                for (let i = 0, c = indexAttr.count | 0; i < c; i++) {
                    indices[outOff++] = (base + (idxArray[i] | 0)) | 0;
                }
                indexOffset += indexAttr.count | 0;
            } else {
                // Non-indexed geometry
                for (let i = 0; i < vertCount; i++) {
                    indices[indexOffset + i] = (vertexOffset + i) | 0;
                }
                indexOffset += vertCount | 0;
            }

            vertexOffset += vertCount;
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new BufferAttribute(normals, 3));
        geometry.setAttribute('color', new BufferAttribute(colors, 4, true));
        geometry.setIndex(new BufferAttribute(indices, 1));

        const bounds = new Box3();
        bounds.min.copy(boundsMin);
        bounds.max.copy(boundsMax);
        geometry.boundingBox = bounds;
        // Skip computeBoundingSphere - not needed for chunk meshes (only raycast uses it, we use AABB picking)

        const brickIndexToBrickId = bricks.map((b) => b.id);

        return { geometry, brickIndexToBrickId, bounds };
    }

    // Shared material used for all baked chunk meshes; vertex colors encode palette.
    const bakedMaterial = new StandardMaterial({ baseColor: [1, 1, 1], roughness: 0.35, metallic: 0.0 });

    const tempMatrix = new Matrix4();
    const tempMatrixNormal = new Matrix3();
    const tempQuaternion = new Quaternion();
    const tempEuler = new Euler();
    const tempScale = new Vector3(1, 1, 1);
    const tempPosition = new Vector3();
    const tempOrigin = new Vector3();
    const tempBoundsMin = new Vector3();
    const tempBoundsMax = new Vector3();
    const tempMinWorld = new Vector3();
    const tempMaxWorld = new Vector3();

    function ensureRecordForChunk(chunkKey) {
        let record = chunkMeshData.get(chunkKey);
        if (!record) {
            record = { group: null, low: null, high: null, pick: null, version: null, signature: null, cachedBricks: {} };
            chunkMeshData.set(chunkKey, record);
        }
        if (!record.group) {
            const parts = chunkKey.split(',').map((v) => parseInt(v || '0', 10) | 0);
            record.group = ensureChunkGroup(parts[0], parts[1], parts[2]);
        }
        return record;
    }

    function getBricksArrayFromRecord(record) {
        const entries = Object.entries(record.cachedBricks || {});
        const out = [];
        for (const [id, b] of entries) {
            if (!b || typeof b !== 'object' || typeof b.pieceId !== 'string') continue;
            out.push({ id, ...b });
        }
        return out;
    }

    function rebuildChunkMeshesLOD(chunkKey, record) {
        const rebuildStart = performance.now();
        const bricksForBuild = getBricksArrayFromRecord(record);
        if (!bricksForBuild.length) { disposeChunkMesh(record); return; }
        
        // Always (re)build low LOD from convex
        {
            const bakedLow = buildBakedGeometryForChunk({ chunkKey, bricks: bricksForBuild, useConvex: true });
            if (bakedLow) {
                if (!record.low || !record.low.mesh) {
                    // Default: no BVH for baked chunk meshes (uses AABB picking instead)
                    const mesh = new Mesh(bakedLow.geometry, bakedMaterial);
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    record.group.add(mesh);
                    record.low = { mesh, geometry: bakedLow.geometry, brickMap: bakedLow.brickIndexToBrickId };
                } else {
                    record.low.mesh.geometry = bakedLow.geometry;
                    record.low.geometry = bakedLow.geometry;
                    record.low.brickMap = bakedLow.brickIndexToBrickId;
                }
                if (bakedLow.bounds) {
                    record.group.userData = record.group.userData || {};
                    record.group.userData.chunkBounds = bakedLow.bounds;
                }
            }
        }
        // Conditionally build high LOD when near
        const ud = record.group.userData || {};
        const wantHigh = ud.lod === 0; // 0=high, 1=low
        if (wantHigh) {
            const bakedHigh = buildBakedGeometryForChunk({ chunkKey, bricks: bricksForBuild, useConvex: false });
            if (bakedHigh) {
                if (!record.high || !record.high.mesh) {
                    // Default: no BVH for baked chunk meshes (uses AABB picking instead)
                    const mesh = new Mesh(bakedHigh.geometry, bakedMaterial);
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    record.group.add(mesh);
                    record.high = { mesh, geometry: bakedHigh.geometry, brickMap: bakedHigh.brickIndexToBrickId };
                } else {
                    record.high.mesh.geometry = bakedHigh.geometry;
                    record.high.geometry = bakedHigh.geometry;
                    record.high.brickMap = bakedHigh.brickIndexToBrickId;
                }
            }
        }
        // Update picking data
        const pick = buildAabbPickDataForChunk(chunkKey, bricksForBuild);
        if (pick) {
            record.pick = { boxes: pick.boxes, bounds: pick.bounds };
        }
        // Toggle visibility according to current LOD
        if (record.low && record.low.mesh) record.low.mesh.visible = !(ud.lod === 0);
        if (record.high && record.high.mesh) record.high.mesh.visible = (ud.lod === 0);
        
        // Track rebuild timing
        const rebuildDuration = performance.now() - rebuildStart;
        lastChunkRebuildMs += rebuildDuration;
        totalChunkRebuildsThisFrame++;
    }

	function updateClosestStudFromHit({ brickId, chunkKey, hitPoint }) {
		closestStudInfo = null;
		closestAntiStudInfo = null;
		if (!brickId || !chunkKey || !hitPoint) {
			studHighlightMesh.visible = false;
			studHelper.visible = false;
			return;
		}
        const gameState = typeof gameStateRef === 'function' ? gameStateRef() : null;
        const chunk = gameState?.chunks?.[chunkKey];
        const brick = chunk?.bricks?.[brickId];
        if (!brick) {
            studHighlightMesh.visible = false;
            studHelper.visible = false;
            return;
        }
        // Build brick transform
        const brickPos = new Vector3(brick.position?.x ?? 0, brick.position?.y ?? 0, brick.position?.z ?? 0);
        const brickQuat = new Quaternion();
        if (brick.rotation) {
            tempEuler.set(brick.rotation.x ?? 0, brick.rotation.y ?? 0, brick.rotation.z ?? 0, brick.rotation.order || 'XYZ');
            brickQuat.setFromEuler(tempEuler, false);
        } else {
            brickQuat.set(0, 0, 0, 1);
        }
        const brickMatrix = new Matrix4().compose(brickPos, brickQuat, new Vector3(1, 1, 1));

        // Lookup connectors
        const pieceData = piecesDataRef && brick.pieceId ? piecesDataRef[brick.pieceId] : null;
        const studsArr = Array.isArray(pieceData?.studs) ? pieceData.studs : [];
        const antiArr = Array.isArray(pieceData?.antiStuds) ? pieceData.antiStuds : [];

        let bestStudPos = null, bestStudDir = null, bestStudDist = Infinity;
        let bestAntiPos = null, bestAntiDir = null, bestAntiDist = Infinity;
        const hitV = new Vector3(hitPoint.x, hitPoint.y, hitPoint.z);
        const defaultUp = new Vector3(0, 1, 0);

        for (let i = 0; i < studsArr.length; i++) {
            const s = studsArr[i];
            const localPos = new Vector3(s.x ?? 0, s.y ?? 0, s.z ?? 0);
            const worldPos = localPos.applyMatrix4(brickMatrix);
            let dir = (typeof s.dx === 'number' && typeof s.dy === 'number' && typeof s.dz === 'number')
                ? new Vector3(s.dx, s.dy, s.dz).normalize().applyQuaternion(brickQuat)
                : defaultUp.clone().applyQuaternion(brickQuat);
            const d = worldPos.distanceTo(hitV);
            if (d < bestStudDist && d < 60) { bestStudDist = d; bestStudPos = worldPos; bestStudDir = dir.normalize(); }
        }
        for (let i = 0; i < antiArr.length; i++) {
            const a = antiArr[i];
            const localPos = new Vector3(a.x ?? 0, a.y ?? 0, a.z ?? 0);
            const worldPos = localPos.applyMatrix4(brickMatrix);
            let dir = (typeof a.dx === 'number' && typeof a.dy === 'number' && typeof a.dz === 'number')
                ? new Vector3(a.dx, a.dy, a.dz).normalize().applyQuaternion(brickQuat)
                : defaultUp.clone().applyQuaternion(brickQuat);
            const d = worldPos.distanceTo(hitV);
            if (d < bestAntiDist && d < 80) { bestAntiDist = d; bestAntiPos = worldPos; bestAntiDir = dir.normalize(); }
        }

        if (bestStudPos) closestStudInfo = { position: bestStudPos, brickId, direction: bestStudDir };
        if (bestAntiPos) closestAntiStudInfo = { position: bestAntiPos, brickId, direction: bestAntiDir };

		let chosenPos = null, chosenDir = null;
		if (selectedAnchorMode === 'anti') {
			// Our piece uses anti-stud; snap to target STUDS (top) and highlight studs
			if (bestStudPos) { chosenPos = bestStudPos; chosenDir = bestStudDir; }
		} else {
			// Our piece uses stud; snap to target ANTI-STUDS (bottom) and highlight antistuds
			if (bestAntiPos) { chosenPos = bestAntiPos; chosenDir = bestAntiDir; }
		}
		if (chosenPos && chosenDir) {
            // Position and orient the cylinder highlight
            studHighlightMesh.position.copy(chosenPos);
            studHighlightMesh.position.y += 2; // Offset like Three.js

            // Create rotation quaternion to align cylinder with connector direction
            const up = new Vector3(0, 1, 0);
            const dir = chosenDir && chosenDir.length() > 0.0001 ? chosenDir.clone().normalize() : up;
            const q = new Quaternion().setFromUnitVectors(up, dir);
            studHighlightMesh.setRotationFromQuaternion(q);

            studHighlightMesh.visible = true;
        } else {
            studHighlightMesh.visible = false;
        }
    }

    // Build a lightweight picking dataset: world-space AABB per brick plus chunk bounds
    function buildAabbPickDataForChunk(chunkKey, bricks) {
        if (!Array.isArray(bricks) || bricks.length === 0) return null;
        const boxes = [];
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        const tempPos = new Vector3();
        const tempQuat = new Quaternion();
        const tempMat = new Matrix4();
        const tempScale1 = new Vector3(1, 1, 1);
        const bbMin = new Vector3();
        const bbMax = new Vector3();
        
        // Reuse corner Vector3s to avoid 8 allocations per brick
        const corner = new Vector3();

        function transformPieceAabbToWorld(pieceGeom, matrix, outMin, outMax) {
            if (!pieceGeom.boundingBox) {
                try { pieceGeom.computeBoundingBox(); } catch (_) {}
            }
            const bb = pieceGeom.boundingBox;
            if (!bb) { outMin.set(0,0,0); outMax.set(0,0,0); return; }
            const min = bb.min, max = bb.max;
            outMin.set(Infinity, Infinity, Infinity);
            outMax.set(-Infinity, -Infinity, -Infinity);
            
            // Manually transform 8 corners without allocating new Vector3s
            const m = matrix.elements;
            for (let i = 0; i < 8; i++) {
                const x = (i & 1) ? max.x : min.x;
                const y = (i & 2) ? max.y : min.y;
                const z = (i & 4) ? max.z : min.z;
                const tx = m[0]*x + m[4]*y + m[8]*z + m[12];
                const ty = m[1]*x + m[5]*y + m[9]*z + m[13];
                const tz = m[2]*x + m[6]*y + m[10]*z + m[14];
                if (tx < outMin.x) outMin.x = tx; if (ty < outMin.y) outMin.y = ty; if (tz < outMin.z) outMin.z = tz;
                if (tx > outMax.x) outMax.x = tx; if (ty > outMax.y) outMax.y = ty; if (tz > outMax.z) outMax.z = tz;
            }
        }

        for (let bi = 0; bi < bricks.length; bi++) {
            const b = bricks[bi];
            const pieceGeom = brickGeometries.get(b.pieceId);
            if (!pieceGeom) continue;
            
            // Build transform matrix directly instead of using compose (avoid overhead)
            tempPos.set(b.position?.x ?? 0, b.position?.y ?? 0, b.position?.z ?? 0);
            if (b.rotation) {
                tempEuler.set(b.rotation.x ?? 0, b.rotation.y ?? 0, b.rotation.z ?? 0, b.rotation.order || 'XYZ');
                tempQuat.setFromEuler(tempEuler, false);
            } else {
                tempQuat.set(0, 0, 0, 1);
            }
            tempMat.compose(tempPos, tempQuat, tempScale1);
            transformPieceAabbToWorld(pieceGeom, tempMat, bbMin, bbMax);
            boxes.push({
                min: { x: bbMin.x, y: bbMin.y, z: bbMin.z },
                max: { x: bbMax.x, y: bbMax.y, z: bbMax.z },
                brickId: b.id,
                pieceId: b.pieceId,
                pos: { x: b.position?.x ?? 0, y: b.position?.y ?? 0, z: b.position?.z ?? 0 },
                rot: { x: b.rotation?.x || 0, y: b.rotation?.y || 0, z: b.rotation?.z || 0 }
            });
            if (bbMin.x < minX) minX = bbMin.x; if (bbMin.y < minY) minY = bbMin.y; if (bbMin.z < minZ) minZ = bbMin.z;
            if (bbMax.x > maxX) maxX = bbMax.x; if (bbMax.y > maxY) maxY = bbMax.y; if (bbMax.z > maxZ) maxZ = bbMax.z;
        }
        const bounds = new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
        return { boxes, bounds };
    }

    function reconcileChunksAndBricks(chunks) {
        if (!chunks || typeof chunks !== 'object') return;

        // Only remove explicitly provided keys (optional partial removal)
        const removeKeys = Array.isArray(chunks.__removeKeys) ? chunks.__removeKeys : null;
        if (removeKeys) {
            for (const key of removeKeys) {
                removeChunkGroupAndInstances(key);
            }
        }

        for (const [chunkKey, chunk] of Object.entries(chunks)) {
            const bricksObj = chunk?.bricks || {};
            const record = ensureRecordForChunk(chunkKey);

            // Merge bricks into a cached snapshot so partial updates don't clear previous bricks
            if (chunk && chunk.__full === true) {
                record.cachedBricks = {};
            }
            if (!record.cachedBricks) record.cachedBricks = {};
            // Apply updates: set or delete
            for (const [id, brick] of Object.entries(bricksObj)) {
                if (brick == null || (typeof brick === 'object' && brick.__delete)) {
                    delete record.cachedBricks[id];
                } else if (brick && typeof brick === 'object') {
                    record.cachedBricks[id] = brick;
                }
            }

            const cachedEntries = Object.entries(record.cachedBricks);
            const needsClear = cachedEntries.length === 0;
            if (needsClear) {
                disposeChunkMesh(record);
                continue;
            }

            const chunkVersion = chunk?.version ?? 0;
            const filtered = [];
            for (const [id, brick] of cachedEntries) {
                if (!brick || typeof brick !== 'object' || typeof brick.pieceId !== 'string') continue;
                filtered.push({ id, brick });
            }

            if (!filtered.length) {
                disposeChunkMesh(record);
                continue;
            }

            const signature = chunkVersion
                ? `${chunkVersion}:${filtered.length}`
                : `${filtered.length}:${filtered.map(({ id, brick }) => `${id}:${brick.pieceId}:${brick.colorIndex | 0}:${(brick.rotation?.x ?? 0).toFixed(3)}:${(brick.rotation?.y ?? 0).toFixed(3)}:${(brick.rotation?.z ?? 0).toFixed(3)}`).join(',')}`;
            if (record.signature !== signature) {
                record.version = chunkVersion;
                record.signature = signature;
                // Rebuild both low/high as needed; visibility toggled per current LOD
                rebuildChunkMeshesLOD(chunkKey, record);
            }
        }
    }

    function removeBrickMesh(brickId) {
        if (!brickId) return;
        for (const [chunkKey, record] of chunkMeshData.entries()) {
            const maps = [];
            if (record?.low?.brickMap) maps.push(record.low.brickMap);
            if (record?.high?.brickMap) maps.push(record.high.brickMap);
            const includes = maps.some((m) => Array.isArray(m) && m.includes(brickId));
            if (!includes) continue;
            // Send explicit deletion marker so cachedBricks is updated
            reconcileChunksAndBricks({ [chunkKey]: { bricks: { [brickId]: { __delete: true } } } });
        }
    }

    function removeChunkGroupAndInstances(chunkKey) {
        const record = chunkMeshData.get(chunkKey);
        if (!record) return;
        if (record.group) {
            scene.remove(record.group);
        }
        chunkMeshData.delete(chunkKey);
        chunkState.chunkGroups.delete(chunkKey);
        
        // Remove wireframe for this chunk
        const wireframe = chunkState.chunkDebugWireframes.get(chunkKey);
        if (wireframe && record.group) {
            record.group.remove(wireframe);
            wireframe.geometry = null;
        }
        chunkState.chunkDebugWireframes.delete(chunkKey);
    }

    function resetAllMeshes() {
        for (const record of chunkMeshData.values()) {
            disposeChunkMesh(record);
            if (record.group) {
                scene.remove(record.group);
            }
        }
        chunkMeshData.clear();
        chunkState.chunkGroups.clear();
        
        // Clean up all wireframes
        for (const wireframe of chunkState.chunkDebugWireframes.values()) {
            if (wireframe && wireframe.geometry) {
                wireframe.geometry = null;
            }
        }
        chunkState.chunkDebugWireframes.clear();
        
        for (const mesh of playerMeshes.values()) {
            scene.remove(mesh);
        }
        playerMeshes.clear();
        
        // Clear all player labels
        playerLabels.clear();
    }

    function createPlayerMesh(playerData) {
        // Remove any existing player mesh for this id to avoid duplicates (color changes or re-spawns)
        const existing = playerMeshes.get(playerData.id);
        if (existing) {
            scene.remove(existing);
            // Best-effort cleanup of child geometries
            if (existing.children && existing.children.length) {
                for (const ch of existing.children) { try { ch.geometry = null; } catch (_) {} }
            } else {
                try { existing.geometry = null; } catch (_) {}
            }
            playerMeshes.delete(playerData.id);
        }
        // Build full minifigure (legs + torso + head) when parts are available; fallback to placeholder
        const group = createMinifigureGroup({
            legs: (typeof playerData.colorLegs === 'number') ? playerData.colorLegs : undefined,
            torso: (typeof playerData.colorTorso === 'number') ? playerData.colorTorso : undefined,
        });
        if (group) {
            group.position.set(playerData.position?.x ?? 0, playerData.position?.y ?? 0, playerData.position?.z ?? 0);
            if (playerData.rotation && typeof playerData.rotation.y === 'number') {
                group.rotation.set(0, playerData.rotation.y, 0);
            }
            group.castShadow = true;
            group.receiveShadow = true;
            scene.add(group);
            playerMeshes.set(playerData.id, group);
        } else {
            const playerGeom = brickGeometries.get("73200");
            const geom = playerGeom || createPlaceholderPlayerGeometry();
            const fallbackHex = (typeof playerData.colorLegs === 'number') ? playerData.colorLegs : 0x0e78cf;
            const mat = new StandardMaterial({ baseColor: hexToLinearRGBA(fallbackHex, 1.0), roughness: 0.35, metallic: 0.0 });
            const mesh = new Mesh(geom, mat);
            mesh.position.set(playerData.position?.x ?? 0, playerData.position?.y ?? 0, playerData.position?.z ?? 0);
            if (playerData.rotation && typeof playerData.rotation.y === 'number') {
                mesh.rotation.set(0, playerData.rotation.y, 0);
            }
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            playerMeshes.set(playerData.id, mesh);
        }
        
        // Create or update player label
        if (playerData.name) {
            const position = {
                x: playerData.position?.x ?? 0,
                y: playerData.position?.y ?? 0,
                z: playerData.position?.z ?? 0
            };
            playerLabels.createOrUpdateLabel(playerData.id, playerData.name, position);
        }
    }

    function updatePlayerMesh(playerData) {
        const mesh = playerMeshes.get(playerData.id);
        if (!mesh) return;
        if (playerData.position) {
            mesh.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
        }
        // Preserve existing x/z rotation (e.g., local run sway). Only update yaw from server.
        if (playerData.rotation && typeof playerData.rotation.y === 'number') {
            mesh.rotation.y = playerData.rotation.y;
        }
    }

    function removePlayerMesh(playerId) {
        const mesh = playerMeshes.get(playerId);
        if (!mesh) return;
        scene.remove(mesh);
        playerMeshes.delete(playerId);
        
        // Remove player label
        playerLabels.removeLabel(playerId);
    }

    function createPlaceholderBrickGeometry() {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array([
            -16, 0, -16,
            16, 0, -16,
            16, 0, 16,
            -16, 0, 16,
            -16, 12, -16,
            16, 12, -16,
            16, 12, 16,
            -16, 12, 16,
        ]), 3));
        geometry.setAttribute("color", new BufferAttribute(fillColorAttribute(8, [0.8, 0.3, 0.3, 1.0]), 4));
        geometry.setIndex(new BufferAttribute(new Uint16Array([
            0, 1, 2, 0, 2, 3,
            4, 6, 5, 4, 7, 6,
            0, 4, 5, 0, 5, 1,
            1, 5, 6, 1, 6, 2,
            2, 6, 7, 2, 7, 3,
            3, 7, 4, 3, 4, 0,
        ]), 1));
        return geometry;
    }

    function createPlaceholderPlayerGeometry() {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array([
            -10, 0, -10,
            10, 0, -10,
            10, 0, 10,
            -10, 0, 10,
            -10, 40, -10,
            10, 40, -10,
            10, 40, 10,
            -10, 40, 10,
        ]), 3));
        geometry.setAttribute("color", new BufferAttribute(fillColorAttribute(8, [0.2, 0.8, 0.4, 1.0]), 4));
        geometry.setIndex(new BufferAttribute(new Uint16Array([
            0, 1, 2, 0, 2, 3,
            4, 6, 5, 4, 7, 6,
            0, 4, 5, 0, 5, 1,
            1, 5, 6, 1, 6, 2,
            2, 6, 7, 2, 7, 3,
            3, 7, 4, 3, 4, 0,
        ]), 1));
        return geometry;
    }

    function createBrickMesh(brick) {
        if (!brick || !brick.chunkKey) return;
        reconcileChunksAndBricks({ [brick.chunkKey]: { bricks: { [brick.id]: brick } } });
    }

    function removeBrickInChunk(chunkKey, brickId) {
        if (!chunkKey || !brickId) return;
        // Send explicit deletion marker so cachedBricks is updated
        reconcileChunksAndBricks({ [chunkKey]: { bricks: { [brickId]: { __delete: true } } } });
    }

    return {
        init,
        dispose,
        onResize,
        renderTick,
        setGameStateProvider(fn) { gameStateRef = typeof fn === 'function' ? fn : null; },
        setData(arg) {
            const obj = arg && typeof arg === 'object' ? arg : {};
            const pl = obj.pieceList;
            const pd = obj.piecesData;
            pieceListRef = Array.isArray(pl) ? pl : [];
            piecesDataRef = pd && typeof pd === 'object' ? pd : {};
        },
        setChunkConfig,
        setChunkDebugVisible,
        reconcileChunksAndBricks,
        removeChunkGroupAndInstances,
		setSelectedPieceIndex(i) {
			selectedPieceIndex = Math.max(0, Math.min(Math.max(0, pieceListRef.length - 1), (i | 0)));
			const sel = pieceListRef[selectedPieceIndex];
			ghostPieceId = sel ? sel.id : null;
			ensureGhostMesh(true);
			updatePreviewMesh();
		},
		setSelectedColorIndex(i) {
			selectedColorIndex = Math.max(0, i | 0);
			updatePreviewMesh();
		},
		setGhostYaw(y) {
			ghostYaw = y || 0;
			ensureGhostMesh(false);
		},
        getGhostRotationEuler() { return { x: ghostRotationEuler.x, y: ghostRotationEuler.y, z: ghostRotationEuler.z }; },
        getGhostTargetPos() { return ghostTargetPos ? { x: ghostTargetPos.x, y: ghostTargetPos.y, z: ghostTargetPos.z } : null; },
        getGhostPieceId() { return ghostPieceId; },
        setGhostCollisionVisual,
        applyAuthoritativeGhostPose(gp) {
            if (!gp) return;
            ghostTargetPos = gp.position ? { x: gp.position.x, y: gp.position.y, z: gp.position.z } : null;
            ghostRotationEuler = gp.rotation ? { x: gp.rotation.x || 0, y: gp.rotation.y || 0, z: gp.rotation.z || 0 } : { x: 0, y: 0, z: 0 };
        },
		setSelectedAntiStudIndex(i) { selectedAntiStudIndex = Math.max(0, i | 0); ensureGhostMesh(false); },
		setSelectedStudIndex(i) { selectedStudIndex = Math.max(0, i | 0); ensureGhostMesh(false); },
		setAnchorMode(m) { selectedAnchorMode = (m === 'stud') ? 'stud' : 'anti'; ensureGhostMesh(false); },
        getRenderStats() { 
            return { 
                drawCalls: renderer.info.render.calls || 0, 
                triangles: lastTriangleCount || 0, 
                gpuMs: lastGpuMs || 0, 
                gpuMsRaw: lastGpuMsRaw || 0,
                chunkRebuildMs: lastChunkRebuildMs || 0,
                chunkRebuilds: totalChunkRebuildsThisFrame || 0
            }; 
        },
		getMouseWorldPosition() {
			// Build a world ray from camera through NDC center (0,0)
			const ndcX = 0, ndcY = 0;
            // Unproject two points zNear=0, zFar=1 from NDC to world
            const p0 = new Vector3(ndcX, ndcY, 0);
            const p1 = new Vector3(ndcX, ndcY, 1);
            // Transform by inverse view-projection
            if (!this.__invViewProj) this.__invViewProj = new Matrix4();
            this.__invViewProj.copy(camera.projectionMatrix).multiply(camera.viewMatrix).invert();
            p0.applyMatrix4(this.__invViewProj);
            p1.applyMatrix4(this.__invViewProj);
            const dir = p1.sub(p0).normalize();
            const ray = new Ray(p0, dir);

            let best = null; // { distance, point, brickId, chunkKey }
            const candidates = [];
            for (const [chunkKey, record] of chunkMeshData.entries()) {
                const pick = record && record.pick;
                if (!pick || !pick.boxes || pick.boxes.length === 0) continue;
                const cb = pick.bounds;
                if (cb && !ray.intersectsBox(cb)) continue;
                for (let i = 0; i < pick.boxes.length; i++) {
                    const b = pick.boxes[i];
                    const box = new Box3(new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z));
                    const hitPoint = new Vector3();
                    if (!ray.intersectBox(box, hitPoint)) continue;
                    const dist = hitPoint.distanceTo(ray.origin);
                    if (dist > PLACEMENT_MAX_DISTANCE) continue;
                    candidates.push({
                        distance: dist,
                        point: hitPoint.clone(),
                        brickId: b.brickId,
                        chunkKey,
                        pieceId: b.pieceId,
                        pos: b.pos,
                        rot: b.rot,
                    });
                }
            }
            if (candidates.length) {
                // Sort so closest AABB checks are refined first
                candidates.sort((a, b) => a.distance - b.distance);

                const refined = refineWithTriangleRaycast(ray, candidates, 5);
                best = refined || candidates[candidates.length - 1];
            }

            if (best) {
                lastRayHitValid = true;
                lastHitBrickId = best.brickId || null;
                lastMouseWorldPos = { x: best.point.x, y: best.point.y, z: best.point.z };
                // Find the matching box again to update helper bounds
                let foundBox = null;
                const record = chunkMeshData.get(best.chunkKey);
                if (record && record.pick && record.pick.boxes) {
                    for (const b of record.pick.boxes) {
                        if (b.brickId === best.brickId) { foundBox = b; break; }
                    }
                }
                if (foundBox) {
                    hoverBox.min.set(foundBox.min.x, foundBox.min.y, foundBox.min.z);
                    hoverBox.max.set(foundBox.max.x, foundBox.max.y, foundBox.max.z);
                    hoverBoxHelper.visible = true;
                    if (typeof hoverBoxHelper.updateMatrixWorld === 'function') hoverBoxHelper.updateMatrixWorld(true);
                }
				// Update closest connector highlighting
				updateClosestStudFromHit({ brickId: best.brickId, chunkKey: best.chunkKey, hitPoint: best.point });
				// Update ghost mesh position based on connector snapping
				ensureGhostMesh(false);
                return lastMouseWorldPos;
            } else {
                lastRayHitValid = false;
                lastHitBrickId = null;
                lastMouseWorldPos = null;
                hoverBoxHelper.visible = false;
                closestStudInfo = null;
                closestAntiStudInfo = null;
                studHelper.visible = false;
                // Hide ghost mesh when not hovering over valid placement
                if (ghostMesh) ghostMesh.visible = false;
                if (ghostMeshAdditive) ghostMeshAdditive.visible = false;
                return null;
            }
        },
        getPickedBrickId: () => (lastRayHitValid && lastHitBrickId) ? lastHitBrickId : null,
        getClosestStudInfo: () => (lastRayHitValid && closestStudInfo) ? {
            position: { x: closestStudInfo.position.x, y: closestStudInfo.position.y, z: closestStudInfo.position.z },
            brickId: closestStudInfo.brickId,
            direction: closestStudInfo.direction ? { x: closestStudInfo.direction.x, y: closestStudInfo.direction.y, z: closestStudInfo.direction.z } : undefined,
        } : null,
        getClosestAntiStudInfo: () => (lastRayHitValid && closestAntiStudInfo) ? {
            position: { x: closestAntiStudInfo.position.x, y: closestAntiStudInfo.position.y, z: closestAntiStudInfo.position.z },
            brickId: closestAntiStudInfo.brickId,
            direction: closestAntiStudInfo.direction ? { x: closestAntiStudInfo.direction.x, y: closestAntiStudInfo.direction.y, z: closestAntiStudInfo.direction.z } : undefined,
        } : null,
        canPlaceNow: () => {
            if (!lastRayHitValid) return false;
            const selectedPieceLocal = pieceListRef[selectedPieceIndex];
            const selectedPieceIdLocal = selectedPieceLocal ? selectedPieceLocal.id : null;
            const pieceDataLocal = selectedPieceIdLocal ? piecesDataRef[selectedPieceIdLocal] : null;
            const hasStuds = !!(pieceDataLocal && Array.isArray(pieceDataLocal.studs) && pieceDataLocal.studs.length > 0);
            const hasAnti = !!(pieceDataLocal && Array.isArray(pieceDataLocal.antiStuds) && pieceDataLocal.antiStuds.length > 0);
            if (selectedAnchorMode === 'anti' && hasAnti) return !!closestStudInfo;
            if (selectedAnchorMode === 'stud' && hasStuds) return !!closestAntiStudInfo;
            return !!(ghostTargetPos || lastMouseWorldPos);
        },
        createBrickMesh,
        removeBrickMesh,
        removeBrickInChunk,
        createPlayerMesh,
        updatePlayerMesh,
        removePlayerMesh,
		resetAllMeshes,
		setupPreview,
		getPreviewRenderer: () => previewRenderer,
		getGeometryForPieceId: (id) => (id != null ? (brickGeometries.get(String(id)) || null) : null),
		getBrickMaterials: () => [],
		setPreviewEnabled(v) { previewEnabled = !!v; },
        __pickerShared: null,
    };
}
