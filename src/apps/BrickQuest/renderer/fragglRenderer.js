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
    CapsuleGeometry,
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
import { ClassicMaterial } from "./fraggl/materials/ClassicMaterial.js";
import { TextureLoader } from "./fraggl/index.js";
import { SphereGeometry } from "./fraggl/index.js";
import { Box3Helper } from "./fraggl/helpers/Box3Helper.js";
import { Ray } from "./fraggl/math/Ray.js";
import { GLTFLoader } from "./fraggl/loaders/GLTFLoader.js";
import { Color, SRGBColorSpace } from "./fraggl/math/Color.js";
import { PlayerLabelsManager } from "./labels.js";
import {
    chunkState,
    initializeChunkManager,
    ensureChunkGroup,
    getChunkOriginFromKey,
    setChunkConfig,
    setChunkDebugVisible,
    chunkMeshData,
    ensureRecordForChunk,
    disposeChunkMesh,
    getBricksArrayFromRecord,
    removeChunkGroupAndInstances,
    buildAabbPickDataForChunk,
    buildBakedGeometryForChunk,
    rebuildChunkMeshesLOD,
    reconcileChunksAndBricks,
    findAndMarkBrickForRemoval,
    removeBrickInChunk,
    createBrickInChunk,
    clearAllChunks,
    countChunkTriangles,
    updateChunkLODAndCulling,
    raycastAgainstChunks,
    findPickBoxForBrick,
} from "./chunkManager.js";
import { PreviewRenderer } from "./previewRenderer.js";

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
    const { colorPalette = [], onLoadingTextChange = () => {}, onError = () => {} } = options;

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

    // Initialize chunk manager with this scene
    initializeChunkManager(scene);

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
            far: 10000, // Use RENDER_DISTANCE or a large value
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
            const tex = await textureLoader.loadAsync("/apps/sky4.webp", {
                colorSpace: "srgb",
                minFilter: "linear",
                magFilter: "linear",
                generateMipmaps: true,
            });
            const farDistance = camera && typeof camera.far === "number" ? camera.far : 5000;
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
            console.error("Failed to load skybox texture", err);
        }
    }

    // Reusable temp color object to avoid allocations during conversions
    const _colorTemp = new Color();

    function hexToLinearRGBA(hex, alpha = 1) {
        if (typeof hex !== "number") return [1, 1, 1, alpha];
        _colorTemp.setHex(hex, SRGBColorSpace); // Automatically converts sRGB → linear
        return [_colorTemp.r, _colorTemp.g, _colorTemp.b, alpha];
    }

    const paletteLinear = Array.isArray(colorPalette)
        ? colorPalette.map((hex) => {
              _colorTemp.setHex(hex, SRGBColorSpace);
              return [_colorTemp.r, _colorTemp.g, _colorTemp.b];
          })
        : [];

    // Persistent hover Box3 helper for picked AABB visualization (disabled)
    const hoverBox = new Box3();
    // const hoverBoxHelper = new Box3Helper(hoverBox, 0xffd835);
    // hoverBoxHelper.visible = false;
    // scene.add(hoverBoxHelper);

    // Stud highlight helper using our new CylinderGeometry
    const studGeometry = new CylinderGeometry(
        6.5, // radiusTop
        6.5, // radiusBottom
        4, // height (from -2 to 2)
        32, // radialSegments (reduced for performance)
        1, // heightSegments
        false, // openEnded (capped cylinder)
        0, // thetaStart
        Math.PI * 2 // thetaLength
    );
    const studMaterial = new BasicMaterial({
        color: [0.87, 0.56, 0, 0.7], // #df8f00 in RGB
        transparent: true,
        depthTest: false,
        depthWrite: false,
        wireframe: false,
    });
    let studHighlightMesh = new Mesh(studGeometry, studMaterial);
    studHighlightMesh.visible = false;
    scene.add(studHighlightMesh);

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

    // Preview renderer (piece preview in bottom-right UI)
    const previewRenderer = new PreviewRenderer();

    function setupGhostMaterial() {
        if (ghostMaterial && ghostMaterialAdditive) return;
        ghostMaterial = new StandardMaterial({
            baseColor: hexToLinearRGBA(0x00ffc8, 0.95),
            roughness: 0.3,
            metallic: 0.0,
            transparent: true,
            depthWrite: false,
        });
        // Secondary very-dim additive layer to show through occluders
        ghostMaterialAdditive = new StandardMaterial({
            baseColor: hexToLinearRGBA(0x101010, 0.96),
            roughness: 0.3,
            metallic: 0.0,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
    }

    function getSelectedConnectorForPiece(pieceData) {
        const useStud = selectedAnchorMode === "stud";
        if (!pieceData) return null;
        if (useStud) {
            const studs = Array.isArray(pieceData.studs) ? pieceData.studs : [];
            if (studs.length === 0) return null;
            const idx = studs.length > 0 ? ((selectedStudIndex % studs.length) + studs.length) % studs.length : 0;
            return { connector: studs[idx] || studs[0], useStud: true };
        } else {
            const antis = Array.isArray(pieceData.antiStuds) ? pieceData.antiStuds : [];
            if (antis.length === 0) return null;
            const idx = antis.length > 0 ? ((selectedAntiStudIndex % antis.length) + antis.length) % antis.length : 0;
            return { connector: antis[idx] || antis[0], useStud: false };
        }
    }

    function computeGhostPoseFromConnector(connInfo, baseQuat, closestStudInfoLocal, closestAntiStudInfoLocal) {
        let finalQuat = baseQuat.clone();
        let targetPos = null;
        if (!connInfo || !connInfo.connector) return { finalQuat, targetPos, connInfo };
        const useStud = connInfo.useStud;
        const connector = connInfo.connector;
        const targetAxis =
            (useStud
                ? closestAntiStudInfoLocal && closestAntiStudInfoLocal.direction
                : closestStudInfoLocal && closestStudInfoLocal.direction) || new Vector3(0, 1, 0);
        const normTargetAxis = targetAxis.clone().normalize();
        const localDir = new Vector3(
            Number.isFinite(connector.dx) ? connector.dx : 0,
            Number.isFinite(connector.dy) ? connector.dy : 1,
            Number.isFinite(connector.dz) ? connector.dz : 0
        ).normalize();
        const dirWorld0 = localDir.clone().applyQuaternion(finalQuat).normalize();
        const alignQuat = new Quaternion().setFromUnitVectors(dirWorld0, normTargetAxis);
        finalQuat = alignQuat.clone().multiply(finalQuat);
        const localPos = new Vector3(
            Number.isFinite(connector.x) ? connector.x : 0,
            Number.isFinite(connector.y) ? connector.y : 0,
            Number.isFinite(connector.z) ? connector.z : 0
        );
        const worldOffset = localPos.clone().applyQuaternion(finalQuat);
        const snapPos = useStud
            ? closestAntiStudInfoLocal && closestAntiStudInfoLocal.position
            : closestStudInfoLocal && closestStudInfoLocal.position;
        if (snapPos) {
            targetPos = { x: snapPos.x - worldOffset.x, y: snapPos.y - worldOffset.y, z: snapPos.z - worldOffset.z };
        }
        return { finalQuat, targetPos, connInfo };
    }

    function setGhostCollisionVisual(colliding) {
        if (!ghostMaterial) return;
        const colorLinear = colliding
            ? hexToLinearRGBA(0xff0000, ghostMaterial.baseColor?.[3] ?? 0.95)
            : hexToLinearRGBA(0x00ffc8, ghostMaterial.baseColor?.[3] ?? 0.95);
        ghostMaterial.baseColor = colorLinear;
        if (ghostMaterialAdditive) {
            ghostMaterialAdditive.baseColor = colliding
                ? hexToLinearRGBA(0xa00000, ghostMaterialAdditive.baseColor?.[3] ?? 0.96)
                : hexToLinearRGBA(0x101010, ghostMaterialAdditive.baseColor?.[3] ?? 0.96);
        }
        if (ghostMesh) ghostMesh.material = ghostMaterial;
        if (ghostMeshAdditive) ghostMeshAdditive.material = ghostMaterialAdditive;
        // Sync arrow RGB with ghost piece color; keep arrow alpha as-is
        if (ghostArrowMaterial && ghostMaterial && Array.isArray(ghostMaterial.baseColor)) {
            const r = ghostMaterial.baseColor[0] ?? 0;
            const g = ghostMaterial.baseColor[1] ?? 1;
            const b = ghostMaterial.baseColor[2] ?? 0.8;
            const a =
                ghostArrowMaterial.color && ghostArrowMaterial.color[3] != null
                    ? ghostArrowMaterial.color[3]
                    : ghostArrowBaseAlpha;
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
            Number.isFinite(connector.z) ? connector.z : 0
        );
        const worldOffset = localPos.clone().applyQuaternion(finalQuat);
        const origin = new Vector3(targetPos.x + worldOffset.x, targetPos.y + worldOffset.y, targetPos.z + worldOffset.z);
        let localDir = new Vector3(
            Number.isFinite(connector.dx) ? connector.dx : 0,
            Number.isFinite(connector.dy) ? connector.dy : 1,
            Number.isFinite(connector.dz) ? connector.dz : 0
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
                const a =
                    ghostArrowMaterial.color && ghostArrowMaterial.color[3] != null
                        ? ghostArrowMaterial.color[3]
                        : ghostArrowBaseAlpha;
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
            const base = ghostMaterial && Array.isArray(ghostMaterial.baseColor) ? ghostMaterial.baseColor : [0.0, 1.0, 0.8, 1.0];
            ghostArrowMaterial = new BasicMaterial({
                color: [base[0] ?? 0, base[1] ?? 1, base[2] ?? 0.8, ghostArrowBaseAlpha],
                transparent: true,
                depthTest: false,
                depthWrite: false,
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
                const snapInfo = selectedAnchorMode === "stud" ? closestAntiStudInfo : closestStudInfo;
                const snapBrickId = snapInfo?.brickId ?? "none";
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

    function updatePreviewMesh() {
        const selectedPiece = pieceListRef[selectedPieceIndex];
        const selectedId = selectedPiece ? selectedPiece.id : null;
        previewRenderer.updatePreviewMesh({
            selectedPieceId: selectedId,
            brickGeometries,
            paletteLinear,
            selectedColorIndex,
        });
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
                renderer.info = {
                    render: { calls: 0 },
                    reset: () => {
                        renderer.info.render.calls = 0;
                    },
                };
            } else if (typeof renderer.info.reset !== "function") {
                renderer.info.reset = () => {
                    renderer.info.render.calls = 0;
                };
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
        // Clean up preview renderer
        previewRenderer.dispose();
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
        if (skyboxMesh && skyboxMesh.geometry && typeof camera.far === "number") {
            const farDistance = camera.far;
            const radius = Math.max(10, farDistance * 0.98);
            // Recreate geometry only if needed
            try {
                const sg = new SphereGeometry(radius, 64, 32);
                skyboxMesh.geometry = sg;
            } catch (_) {}
        }
        // Resize preview if present
        previewRenderer.onResize();
    }

    // Performance tracking for chunk rebuilds
    let lastChunkRebuildMs = 0;
    let totalChunkRebuildsThisFrame = 0;
    let lastTriangleCount = 0;

    function countSceneTriangles() {
        // Count chunk triangles using ChunkManager
        const chunkResult = countChunkTriangles();
        let total = chunkResult.total;
        let debugCounts = { ...chunkResult.debugCounts, players: 0, ghost: 0, skybox: 0 };

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
                const dir = new Vector3(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch)
                ).normalize();
                const desiredPos = target.clone().add(dir.multiplyScalar(-160));
                desiredPos.y += 30;
                camera.position.copy(desiredPos);
                camera.lookAt(target);
            } else {
                camera.position.copy(target);
                const lookDirection = new Vector3(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch)
                );
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
                    const targetRoll = isMoving ? Math.sin(tSec * (RUN_SWAY_HZ * Math.PI * 2)) * RUN_SWAY_MAX_RAD : 0;
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
            const lightPos = camera.position
                .clone()
                .sub(lightDir.clone().multiplyScalar(lightDistance))
                .add(new Vector3(0, 200, 0));
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

        // Chunk LOD selection and culling using ChunkManager
        const chunkUpdateResult = updateChunkLODAndCulling(camera, frustum, RENDER_DISTANCE, LOD_DISTANCE, {
            brickGeometries,
            convexGeometries,
            paletteLinear,
            bakedMaterial,
            pieceMeta,
            classicMaterial,
        });
        lastChunkRebuildMs = chunkUpdateResult.lastChunkRebuildMs;
        totalChunkRebuildsThisFrame = chunkUpdateResult.totalChunkRebuildsThisFrame;

        // Sync placement mode and connector indices from localPlayer each frame
        {
            let needsGhostUpdate = false;
            if (localPlayer && typeof localPlayer.anchorMode === "string") {
                const mode = localPlayer.anchorMode === "stud" ? "stud" : "anti";
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
            const minA = 0.1,
                maxA = 1.0;
            const opacity = (phase + 1) * 0.5 * (maxA - minA) + minA;
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
            const r = ghostMaterial?.baseColor?.[0] ?? ghostArrowMaterial.color?.[0] ?? 0;
            const g = ghostMaterial?.baseColor?.[1] ?? ghostArrowMaterial.color?.[1] ?? 1;
            const b = ghostMaterial?.baseColor?.[2] ?? ghostArrowMaterial.color?.[2] ?? 0.8;
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

        if (renderer && renderer.info && typeof renderer.info.reset === "function") renderer.info.reset();
        await renderer.render(scene, camera);
        // Get accurate GPU frame time from timestamp queries (WebGPU feature)
        {
            const measured = renderer.getGpuTimeMs ? renderer.getGpuTimeMs() : 0;
            if (measured > 0) {
                lastGpuMsRaw = measured;
                lastGpuMs = lastGpuMs > 0 ? lastGpuMs + (measured - lastGpuMs) * GPU_SMOOTH : measured;
            }
        }
        // Count triangles for stats
        lastTriangleCount = countSceneTriangles();
        // Render piece preview last so it appears responsive even when world work is heavy
        if (previewRenderer.enabled) previewRenderer.render();
    }

    // chunkMeshData moved to chunkManager
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
    let LOD_DISTANCE = 2000; // world units
    let RENDER_DISTANCE = 10000; // world units

    // Selection and ghost-related UI state
    let selectedPieceIndex = 0;
    let selectedColorIndex = 0;
    let selectedAnchorMode = "anti"; // 'anti' or 'stud'
    let selectedAntiStudIndex = 0;
    let selectedStudIndex = 0;

    // Picking results
    let lastRayHitValid = false;
    let lastHitBrickId = null;
    let lastMouseWorldPos = null; // { x, y, z }
    let closestStudInfo = null; // { position: Vector3, brickId, direction?: Vector3 }
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
    let ghostPieceId = null; // string | null
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

    const brickGeometries = new Map();
    const convexGeometries = new Map();
    const collisionGeometries = new Map();
    const pieceMeta = new Map(); // pieceId -> { classicInfo, partAABB }

    const loader = new GLTFLoader();
    loader.setPath("/apps/bricks/");

    let geometriesLoaded = false;
    const piecesLoadPromise = (async () => {
        try {
            const { scene: partsScene } = await loader.loadAsync("all_pieces.gltf");
            const library = partsScene.getObjectByName?.("LegoPartsLibrary") || null;
            if (!library) throw new Error("LegoPartsLibrary node missing in glTF");
            let classicDetectedCount = 0;
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
                        try {
                            geom.computeBoundingBox();
                        } catch (_) {}
                    }
                    brickGeometries.set(pieceId, geom);
                    // Capture extras for classic proxy rendering from piece root only (single source of truth)
                    const udPiece = child && child.userData ? child.userData : null;
                    const si = (udPiece && typeof udPiece.classicInfo === 'number') ? (udPiece.classicInfo | 0) : 0;
                    const aabb = (udPiece && udPiece.partAABB) ? udPiece.partAABB : null;
                    if (si || aabb) {
                        pieceMeta.set(pieceId, { classicInfo: si, partAABB: aabb });
                        if (si) {
                            classicDetectedCount++;
                        }
                    }
                }
                const convexNode = child.getObjectByName?.("convex");
                const convexMesh = convexNode ? findFirstMesh(convexNode) : null;
                if (convexMesh && convexMesh.geometry) {
                    // Use source geometry directly - no need to clone
                    const geom = convexMesh.geometry;
                    // Ensure bounding box is computed - critical for low LOD chunks
                    if (!geom.boundingBox) {
                        try {
                            geom.computeBoundingBox();
                        } catch (_) {}
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
                        try {
                            geom.computeBoundingBox();
                        } catch (_) {}
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

    function createMinifigureGroup(colors) {
        const geomLegs = brickGeometries.get("73200");
        const geomTorso = brickGeometries.get("76382");
        const geomHead = brickGeometries.get("3626");
        if (!geomLegs || !geomTorso || !geomHead) return null;

        const legsHex = colors && typeof colors.legs === "number" ? colors.legs : 0x0e78cf;
        const torsoHex = colors && typeof colors.torso === "number" ? colors.torso : 0x0e78cf;
        const headHex = colors && typeof colors.head === "number" ? colors.head : 0xffd804;

        const legsMat = new StandardMaterial({ baseColor: hexToLinearRGBA(legsHex, 1.0), roughness: 0.35, metallic: 0.0 });
        const torsoMat = new StandardMaterial({ baseColor: hexToLinearRGBA(torsoHex, 1.0), roughness: 0.35, metallic: 0.0 });
        const headMat = new StandardMaterial({ baseColor: hexToLinearRGBA(headHex, 1.0), roughness: 0.35, metallic: 0.0 });

        const group = new Group();
        const legs = new Mesh(geomLegs, legsMat);
        const torso = new Mesh(geomTorso, torsoMat);
        const head = new Mesh(geomHead, headMat);

        legs.castShadow = true;
        legs.receiveShadow = true;
        torso.castShadow = true;
        torso.receiveShadow = true;
        head.castShadow = true;
        head.receiveShadow = true;

        legs.position.set(0, -12, 0);
        torso.position.set(0, 20, 0);
        head.position.set(0, 44, 0);

        group.add(legs);
        group.add(torso);
        group.add(head);
        return group;
    }

    // disposeChunkMesh moved to chunkManager

    // Shared material used for all baked chunk meshes; vertex colors encode palette.
    const bakedMaterial = new StandardMaterial({ baseColor: [1, 1, 1], roughness: 0.35, metallic: 0.0 });
    // Classic proxies material
    const classicMaterial = new ClassicMaterial({});

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

    function updateClosestStudFromHit({ brickId, chunkKey, hitPoint }) {
        closestStudInfo = null;
        closestAntiStudInfo = null;
        if (!brickId || !chunkKey || !hitPoint) {
            studHighlightMesh.visible = false;
            return;
        }
        const gameState = typeof gameStateRef === "function" ? gameStateRef() : null;
        const chunk = gameState?.chunks?.[chunkKey];
        const brick = chunk?.bricks?.[brickId];
        if (!brick) {
            studHighlightMesh.visible = false;
            return;
        }
        // Build brick transform
        const brickPos = new Vector3(brick.position?.x ?? 0, brick.position?.y ?? 0, brick.position?.z ?? 0);
        const brickQuat = new Quaternion();
        if (brick.rotation) {
            tempEuler.set(brick.rotation.x ?? 0, brick.rotation.y ?? 0, brick.rotation.z ?? 0, brick.rotation.order || "XYZ");
            brickQuat.setFromEuler(tempEuler, false);
        } else {
            brickQuat.set(0, 0, 0, 1);
        }
        const brickMatrix = new Matrix4().compose(brickPos, brickQuat, new Vector3(1, 1, 1));

        // Lookup connectors
        const pieceData = piecesDataRef && brick.pieceId ? piecesDataRef[brick.pieceId] : null;
        const studsArr = Array.isArray(pieceData?.studs) ? pieceData.studs : [];
        const antiArr = Array.isArray(pieceData?.antiStuds) ? pieceData.antiStuds : [];

        let bestStudPos = null,
            bestStudDir = null,
            bestStudDist = Infinity;
        let bestAntiPos = null,
            bestAntiDir = null,
            bestAntiDist = Infinity;
        const hitV = new Vector3(hitPoint.x, hitPoint.y, hitPoint.z);
        const defaultUp = new Vector3(0, 1, 0);

        for (let i = 0; i < studsArr.length; i++) {
            const s = studsArr[i];
            const localPos = new Vector3(s.x ?? 0, s.y ?? 0, s.z ?? 0);
            const worldPos = localPos.applyMatrix4(brickMatrix);
            let dir =
                typeof s.dx === "number" && typeof s.dy === "number" && typeof s.dz === "number"
                    ? new Vector3(s.dx, s.dy, s.dz).normalize().applyQuaternion(brickQuat)
                    : defaultUp.clone().applyQuaternion(brickQuat);
            const d = worldPos.distanceTo(hitV);
            if (d < bestStudDist && d < 60) {
                bestStudDist = d;
                bestStudPos = worldPos;
                bestStudDir = dir.normalize();
            }
        }
        for (let i = 0; i < antiArr.length; i++) {
            const a = antiArr[i];
            const localPos = new Vector3(a.x ?? 0, a.y ?? 0, a.z ?? 0);
            const worldPos = localPos.applyMatrix4(brickMatrix);
            let dir =
                typeof a.dx === "number" && typeof a.dy === "number" && typeof a.dz === "number"
                    ? new Vector3(a.dx, a.dy, a.dz).normalize().applyQuaternion(brickQuat)
                    : defaultUp.clone().applyQuaternion(brickQuat);
            const d = worldPos.distanceTo(hitV);
            if (d < bestAntiDist && d < 80) {
                bestAntiDist = d;
                bestAntiPos = worldPos;
                bestAntiDir = dir.normalize();
            }
        }

        if (bestStudPos) closestStudInfo = { position: bestStudPos, brickId, direction: bestStudDir };
        if (bestAntiPos) closestAntiStudInfo = { position: bestAntiPos, brickId, direction: bestAntiDir };

        let chosenPos = null,
            chosenDir = null;
        if (selectedAnchorMode === "anti") {
            // Our piece uses anti-stud; snap to target STUDS (top) and highlight studs
            if (bestStudPos) {
                chosenPos = bestStudPos;
                chosenDir = bestStudDir;
            }
        } else {
            // Our piece uses stud; snap to target ANTI-STUDS (bottom) and highlight antistuds
            if (bestAntiPos) {
                chosenPos = bestAntiPos;
                chosenDir = bestAntiDir;
            }
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

    // Wrapper to provide dependencies to ChunkManager
    function reconcileChunksAndBricksLocal(chunks) {
        return reconcileChunksAndBricks(chunks, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
    }

    function removeBrickMesh(brickId) {
        if (!brickId) return;
        const chunkKey = findAndMarkBrickForRemoval(brickId);
        if (chunkKey) {
            // Trigger rebuild after marking for removal
            reconcileChunksAndBricksLocal({ [chunkKey]: { bricks: {} } });
        }
    }

    function resetAllMeshes() {
        // Clear all chunk data using ChunkManager
        clearAllChunks();

        // Clear player meshes
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
                for (const ch of existing.children) {
                    try {
                        ch.geometry = null;
                    } catch (_) {}
                }
            } else {
                try {
                    existing.geometry = null;
                } catch (_) {}
            }
            playerMeshes.delete(playerData.id);
        }
        // Build full minifigure (legs + torso + head) when parts are available; fallback to placeholder
        const group = createMinifigureGroup({
            legs: typeof playerData.colorLegs === "number" ? playerData.colorLegs : undefined,
            torso: typeof playerData.colorTorso === "number" ? playerData.colorTorso : undefined,
        });
        if (group) {
            group.position.set(playerData.position?.x ?? 0, playerData.position?.y ?? 0, playerData.position?.z ?? 0);
            if (playerData.rotation && typeof playerData.rotation.y === "number") {
                group.rotation.set(0, playerData.rotation.y, 0);
            }
            group.castShadow = true;
            group.receiveShadow = true;
            scene.add(group);
            playerMeshes.set(playerData.id, group);
        } else {
            // LDraw units: 1 brick = 24 high, minifig ~4 bricks tall = ~96 units
            const geom = new CapsuleGeometry(20, 64, 4, 8);
            const fallbackHex = typeof playerData.colorLegs === "number" ? playerData.colorLegs : 0x0e78cf;
            const mat = new StandardMaterial({ baseColor: hexToLinearRGBA(fallbackHex, 1.0), roughness: 0.35, metallic: 0.0 });
            const mesh = new Mesh(geom, mat);
            mesh.position.set(playerData.position?.x ?? 0, playerData.position?.y ?? 0, playerData.position?.z ?? 0);
            if (playerData.rotation && typeof playerData.rotation.y === "number") {
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
                z: playerData.position?.z ?? 0,
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
        if (playerData.rotation && typeof playerData.rotation.y === "number") {
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

    function createBrickMesh(brick) {
        if (!brick || !brick.chunkKey) return;
        createBrickInChunk(brick, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
    }

    function removeBrickInChunkLocal(chunkKey, brickId) {
        if (!chunkKey || !brickId) return;
        removeBrickInChunk(chunkKey, brickId, { brickGeometries, convexGeometries, paletteLinear, bakedMaterial, pieceMeta, classicMaterial });
    }

    return {
        init,
        dispose,
        onResize,
        renderTick,
        setGameStateProvider(fn) {
            gameStateRef = typeof fn === "function" ? fn : null;
        },
        setData(arg) {
            const obj = arg && typeof arg === "object" ? arg : {};
            const pl = obj.pieceList;
            const pd = obj.piecesData;
            pieceListRef = Array.isArray(pl) ? pl : [];
            piecesDataRef = pd && typeof pd === "object" ? pd : {};
        },
        setChunkConfig,
        setChunkDebugVisible,
        reconcileChunksAndBricks: reconcileChunksAndBricksLocal,
        removeChunkGroupAndInstances,
        setSelectedPieceIndex(i) {
            selectedPieceIndex = Math.max(0, Math.min(Math.max(0, pieceListRef.length - 1), i | 0));
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
        getGhostRotationEuler() {
            return { x: ghostRotationEuler.x, y: ghostRotationEuler.y, z: ghostRotationEuler.z };
        },
        getGhostTargetPos() {
            return ghostTargetPos ? { x: ghostTargetPos.x, y: ghostTargetPos.y, z: ghostTargetPos.z } : null;
        },
        getGhostPieceId() {
            return ghostPieceId;
        },
        setGhostCollisionVisual,
        applyAuthoritativeGhostPose(gp) {
            if (!gp) return;
            ghostTargetPos = gp.position ? { x: gp.position.x, y: gp.position.y, z: gp.position.z } : null;
            ghostRotationEuler = gp.rotation
                ? { x: gp.rotation.x || 0, y: gp.rotation.y || 0, z: gp.rotation.z || 0 }
                : { x: 0, y: 0, z: 0 };
        },
        setSelectedAntiStudIndex(i) {
            selectedAntiStudIndex = Math.max(0, i | 0);
            ensureGhostMesh(false);
        },
        setSelectedStudIndex(i) {
            selectedStudIndex = Math.max(0, i | 0);
            ensureGhostMesh(false);
        },
        setAnchorMode(m) {
            selectedAnchorMode = m === "stud" ? "stud" : "anti";
            ensureGhostMesh(false);
        },
        getRenderStats() {
            return {
                drawCalls: renderer.info.render.calls || 0,
                triangles: lastTriangleCount || 0,
                gpuMs: lastGpuMs || 0,
                gpuMsRaw: lastGpuMsRaw || 0,
                chunkRebuildMs: lastChunkRebuildMs || 0,
                chunkRebuilds: totalChunkRebuildsThisFrame || 0,
            };
        },
        getMouseWorldPosition() {
            // Build a world ray from camera through NDC center (0,0)
            const ndcX = 0,
                ndcY = 0;
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

            // Use ChunkManager to find brick candidates via raycast
            const candidates = raycastAgainstChunks(ray, PLACEMENT_MAX_DISTANCE);

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

                // Find the matching box to update helper bounds
                const foundBox = findPickBoxForBrick(best.chunkKey, best.brickId);
                if (foundBox) {
                    hoverBox.min.set(foundBox.min.x, foundBox.min.y, foundBox.min.z);
                    hoverBox.max.set(foundBox.max.x, foundBox.max.y, foundBox.max.z);
                    // hoverBoxHelper.visible = true;
                    // if (typeof hoverBoxHelper.updateMatrixWorld === "function") hoverBoxHelper.updateMatrixWorld(true);
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
                // hoverBoxHelper.visible = false;
                closestStudInfo = null;
                closestAntiStudInfo = null;
                // Hide ghost mesh when not hovering over valid placement
                if (ghostMesh) ghostMesh.visible = false;
                if (ghostMeshAdditive) ghostMeshAdditive.visible = false;
                return null;
            }
        },
        getPickedBrickId: () => (lastRayHitValid && lastHitBrickId ? lastHitBrickId : null),
        getClosestStudInfo: () =>
            lastRayHitValid && closestStudInfo
                ? {
                      position: { x: closestStudInfo.position.x, y: closestStudInfo.position.y, z: closestStudInfo.position.z },
                      brickId: closestStudInfo.brickId,
                      direction: closestStudInfo.direction
                          ? { x: closestStudInfo.direction.x, y: closestStudInfo.direction.y, z: closestStudInfo.direction.z }
                          : undefined,
                  }
                : null,
        getClosestAntiStudInfo: () =>
            lastRayHitValid && closestAntiStudInfo
                ? {
                      position: {
                          x: closestAntiStudInfo.position.x,
                          y: closestAntiStudInfo.position.y,
                          z: closestAntiStudInfo.position.z,
                      },
                      brickId: closestAntiStudInfo.brickId,
                      direction: closestAntiStudInfo.direction
                          ? {
                                x: closestAntiStudInfo.direction.x,
                                y: closestAntiStudInfo.direction.y,
                                z: closestAntiStudInfo.direction.z,
                            }
                          : undefined,
                  }
                : null,
        canPlaceNow: () => {
            if (!lastRayHitValid) return false;
            const selectedPieceLocal = pieceListRef[selectedPieceIndex];
            const selectedPieceIdLocal = selectedPieceLocal ? selectedPieceLocal.id : null;
            const pieceDataLocal = selectedPieceIdLocal ? piecesDataRef[selectedPieceIdLocal] : null;
            const hasStuds = !!(pieceDataLocal && Array.isArray(pieceDataLocal.studs) && pieceDataLocal.studs.length > 0);
            const hasAnti = !!(pieceDataLocal && Array.isArray(pieceDataLocal.antiStuds) && pieceDataLocal.antiStuds.length > 0);
            if (selectedAnchorMode === "anti" && hasAnti) return !!closestStudInfo;
            if (selectedAnchorMode === "stud" && hasStuds) return !!closestAntiStudInfo;
            return !!(ghostTargetPos || lastMouseWorldPos);
        },
        createBrickMesh,
        removeBrickMesh,
        removeBrickInChunk: removeBrickInChunkLocal,
        createPlayerMesh,
        updatePlayerMesh,
        removePlayerMesh,
        resetAllMeshes,
        setupPreview(previewContainerElement) {
            previewRenderer.setupPreview(previewContainerElement);
            updatePreviewMesh();
        },
        getPreviewRenderer: () => previewRenderer.getRenderer(),
        getGeometryForPieceId: (id) => (id != null ? brickGeometries.get(String(id)) || null : null),
        setPreviewEnabled(v) {
            previewRenderer.setEnabled(v);
        },
        __pickerShared: null,
    };
}
