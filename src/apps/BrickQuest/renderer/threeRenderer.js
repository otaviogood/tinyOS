// @ts-nocheck
import * as THREE from "three/src/Three.WebGPU.Nodes.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { disposeObject } from "./threeUtils.js";
import { setupPBRLighting, setupEquirectangularSkybox as setupSkyboxExternal } from "./lighting.js";
import { createTextSprite, createOrUpdateNameSprite as updateNameSpriteExternal } from "./labels.js";
import { loadBrickModel } from "./piecesLoader.js";
import { setChunkConfig as setChunkConfigExternal, getChunkOriginFromKey as getChunkOriginFromKeyExternal, ensureChunkGroup as ensureChunkGroupExternal, setChunkDebugVisible as setChunkDebugVisibleExternal } from "./chunks.js";

export function createBrickQuestRenderer(container, options = {}) {
	const { colorPalette = [], onLoadingTextChange = () => {}, onError = () => {} } = options;

	// Core three.js objects
	let scene = null;
	let camera = null;
	let renderer = null;
	let gltfLoader = null;


	// Lighting references
	let sunLightRef = null;

	// Preview scene objects
	let previewScene = null;
	let previewCamera = null;
	let previewRenderer = null;
	let previewContainer = null;

	// Helpers
	function getContainerSize() {
		const el = container || (typeof document !== 'undefined' ? document.body : null);
		const width = (el && el.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 800);
		const height = (el && el.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 600);
		return { el, width, height };
	}

	// Last render stats
	let lastDrawCalls = 0;
	let lastTriangles = 0;
	let lastGpuMs = 0;

	// Resources
	let brickMaterials = null; // array of MeshStandardMaterial
	const brickGeometries = new Map(); // pieceId -> BufferGeometry
	const collisionGeometries = new Map(); // pieceId -> BufferGeometry (nostuds)
	const convexGeometries = new Map(); // pieceId -> BufferGeometry (convex LOD)

	// Baked static mesh resources (one Mesh per chunk)
	const chunkMeshData = new Map(); // chunkKey -> { low: { mesh, geom, map }, high?: { mesh, geom, map } }

	// Batching flags/collections (kept for bounds recompute scheduling)
	let bulkReconcileActive = false;
	const _groupsNeedingBounds = new Set();
	let bakedBrickMaterial = null;

	// Instancing path removed

	// Instancing grow helpers removed

	const _tempMatrix4 = new THREE.Matrix4();
	const _tempQuaternion = new THREE.Quaternion();
	const _tempPosition = new THREE.Vector3();
	const _tempScale = new THREE.Vector3(1,1,1);
	const _tempColor = new THREE.Color();
	const _tempBox3 = new THREE.Box3();
	const _tempVec3 = new THREE.Vector3();
	const _tempVec3b = new THREE.Vector3();
	const _projScreenMatrix = new THREE.Matrix4();
	const _mainFrustum = new THREE.Frustum();
	const _sharedRaycaster = new THREE.Raycaster();
	const _ndcCenter = new THREE.Vector2(0, 0);

	// No per-mesh culling hooks needed for baked meshes; group visibility is handled in renderTick

	function initGroupBounds(group) {
		group.userData = group.userData || {};
		if (!group.userData.chunkBounds) {
			group.userData.chunkBounds = new THREE.Box3(
				new THREE.Vector3(Infinity, Infinity, Infinity),
				new THREE.Vector3(-Infinity, -Infinity, -Infinity)
			);
			group.userData.boundsDirty = false;
		}
	}

	function expandGroupBoundsForGeometry(group, geometry) {
		if (!geometry) return;
		if (!geometry.boundingBox) geometry.computeBoundingBox();
		if (!geometry.boundingBox) return;
		initGroupBounds(group);
		// Geometry is authored in local chunk space; shift by group.origin (its position)
		_tempBox3.copy(geometry.boundingBox);
		_tempVec3.set(group.position.x || 0, group.position.y || 0, group.position.z || 0);
		_tempBox3.min.add(_tempVec3);
		_tempBox3.max.add(_tempVec3);
		group.userData.chunkBounds.union(_tempBox3);
	}

	function recomputeGroupBounds(group) {
		initGroupBounds(group);
		const bounds = group.userData.chunkBounds;
		bounds.min.set(Infinity, Infinity, Infinity);
		bounds.max.set(-Infinity, -Infinity, -Infinity);
		for (const child of group.children) {
			const geom = child && child.geometry;
				if (!geom) continue;
				if (!geom.boundingBox) {
					try { geom.computeBoundingBox(); } catch (_) {}
				}
				if (!geom.boundingBox) continue;
					_tempBox3.copy(geom.boundingBox);
			_tempVec3.set(group.position.x || 0, group.position.y || 0, group.position.z || 0);
			_tempBox3.min.add(_tempVec3);
			_tempBox3.max.add(_tempVec3);
					bounds.union(_tempBox3);
				}
		group.userData.boundsDirty = false;
	}

	function ensureBakedMaterial() {
		if (bakedBrickMaterial) return bakedBrickMaterial;
		bakedBrickMaterial = new THREE.MeshStandardNodeMaterial({
			vertexColors: true,
			color: 0xffffff,
			roughness: 0.2,
			metalness: 0.0,
			envMapIntensity: 0.8
		});
		return bakedBrickMaterial;
	}

	function quantizeColorToUint8(c) {
		// Input THREE.Color linear [0,1]; convert to sRGB then output [r,g,b] Uint8
		// Vertex colors stored as Uint8 are assumed to be in sRGB space
		const srgbColor = c.clone().convertLinearToSRGB();
		const r = Math.max(0, Math.min(255, Math.round(srgbColor.r * 255)));
		const g = Math.max(0, Math.min(255, Math.round(srgbColor.g * 255)));
		const b = Math.max(0, Math.min(255, Math.round(srgbColor.b * 255)));
		return [r, g, b];
	}

	function buildBakedGeometryForChunk(chunkKey, bricks, { useConvex = false } = {}) {
		// bricks: array of { id, pieceId, colorIndex, position:{x,y,z}, rotation:{x,y,z} }
		if (!Array.isArray(bricks) || bricks.length === 0) return null;
		const origin = getChunkOriginFromKey(chunkKey);
		// First pass: counts
		let totalVertices = 0;
		let totalIndices = 0;
		const pieceGeoms = [];
		for (const b of bricks) {
			const geom = useConvex ? (convexGeometries.get(b.pieceId) || brickGeometries.get(b.pieceId)) : brickGeometries.get(b.pieceId);
			if (!geom || !geom.attributes || !geom.attributes.position) { pieceGeoms.push(null); continue; }
			pieceGeoms.push(geom);
			totalVertices += geom.attributes.position.count | 0;
			const idAttr = geom.index;
			totalIndices += idAttr ? (idAttr.count | 0) : ((geom.attributes.position.count / 3) | 0) * 3;
		}
		if (totalVertices <= 0 || totalIndices <= 0) return null;
		const useUint32Index = totalVertices > 65535;
		const positions = new Float32Array(totalVertices * 3);
		const normals = new Float32Array(totalVertices * 3);
		const colors = new Uint8Array(totalVertices * 4);
		const brickIndexAttr = new Float32Array(totalVertices);
		const indices = useUint32Index ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);
		// Track bounding box as we write transformed vertices (cache-friendly)
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		let vtxBase = 0;
		let idxBase = 0;
		const brickIndexToBrickId = [];
		const normalMatrix = new THREE.Matrix3();
		const rotMatrix = new THREE.Matrix4();
		for (let bi = 0; bi < bricks.length; bi++) {
			const b = bricks[bi];
			const geom = pieceGeoms[bi];
			if (!geom) continue;
			// Compose transform (random micro rotation like before)
		_tempPosition.set(
					b.position.x - origin.x,
					b.position.y - origin.y,
					b.position.z - origin.z
			);
		_tempQuaternion.setFromEuler(new THREE.Euler(
					(b.rotation && b.rotation.x || 0),
					(b.rotation && b.rotation.y || 0),
					(b.rotation && b.rotation.z || 0)
		));
		_tempMatrix4.compose(_tempPosition, _tempQuaternion, _tempScale);
			rotMatrix.makeRotationFromQuaternion(_tempQuaternion);
			normalMatrix.setFromMatrix4(rotMatrix);
			// Color
			const matColor = brickMaterials && brickMaterials[b.colorIndex] ? brickMaterials[b.colorIndex].color : (brickMaterials && brickMaterials[0] ? brickMaterials[0].color : null);
			const [cr, cg, cb] = quantizeColorToUint8(matColor || new THREE.Color(1,1,1));
			// Copy/transform vertices (fast path using direct arrays and matrix elements)
			const posAttr = geom.attributes.position;
			const norAttr = geom.attributes.normal;
			const idxAttr = geom.index;
			const vertCount = posAttr.count | 0;
			const posArray = posAttr.array;
			const norArray = norAttr.array;
			// Set brick index in one go for this brick's vertex range
			brickIndexAttr.fill(bi, vtxBase, vtxBase + vertCount);
			const m = _tempMatrix4.elements;
			const n = normalMatrix.elements;
			for (let i = 0; i < vertCount; i++) {
				const pOff = i * 3;
				const px = posArray[pOff + 0];
				const py = posArray[pOff + 1];
				const pz = posArray[pOff + 2];
				const tx = m[0] * px + m[4] * py + m[8]  * pz + m[12];
				const ty = m[1] * px + m[5] * py + m[9]  * pz + m[13];
				const tz = m[2] * px + m[6] * py + m[10] * pz + m[14];
				const vOut = (vtxBase + i) * 3;
				positions[vOut + 0] = tx;
				positions[vOut + 1] = ty;
				positions[vOut + 2] = tz;
				if (tx < minX) minX = tx; if (ty < minY) minY = ty; if (tz < minZ) minZ = tz;
				if (tx > maxX) maxX = tx; if (ty > maxY) maxY = ty; if (tz > maxZ) maxZ = tz;
				const nx = norArray[pOff + 0];
				const ny = norArray[pOff + 1];
				const nz = norArray[pOff + 2];
				const ntx = n[0] * nx + n[3] * ny + n[6] * nz;
				const nty = n[1] * nx + n[4] * ny + n[7] * nz;
				const ntz = n[2] * nx + n[5] * ny + n[8] * nz;
				normals[vOut + 0] = ntx;
				normals[vOut + 1] = nty;
				normals[vOut + 2] = ntz;
				const cOut = (vtxBase + i) * 4;
				colors[cOut + 0] = cr;
				colors[cOut + 1] = cg;
				colors[cOut + 2] = cb;
				colors[cOut + 3] = 255;
			}
			if (idxAttr) {
				const idxArray = idxAttr.array;
				let outOff = idxBase;
				const base = vtxBase;
				for (let i = 0, c = idxAttr.count | 0; i < c; i++) {
					indices[outOff++] = (base + (idxArray[i] | 0)) | 0;
				}
				idxBase += idxAttr.count | 0;
		} else {
				// Assume non-indexed triangles
				for (let i = 0; i < vertCount; i++) {
					indices[idxBase + i] = (vtxBase + i) | 0;
				}
				idxBase += vertCount | 0;
			}
			brickIndexToBrickId[bi] = b.id;
			vtxBase += vertCount | 0;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
		geometry.setAttribute('brickIndex', new THREE.BufferAttribute(brickIndexAttr, 1));
		geometry.setIndex(new THREE.BufferAttribute(indices, 1));
		// Assign bounding box directly from tracked min/max
		geometry.boundingBox = new THREE.Box3(
			new THREE.Vector3(minX, minY, minZ),
			new THREE.Vector3(maxX, maxY, maxZ)
		);
		// geometry.computeBoundingSphere();
		try { geometry.computeBoundsTree(); } catch (_) {}
		return { geometry, brickIndexToBrickId };
	}

	function replaceChunkMesh(chunkKey, mesh, kind) {
		const group = chunkGroups.get(chunkKey);
		if (!group) return;
		// Remove existing mesh for the specified kind (low/high)
		const tag = kind === 'high' ? 'isChunkHighMesh' : 'isChunkLowMesh';
		for (let i = group.children.length - 1; i >= 0; i--) {
			const child = group.children[i];
			if (!child || (child.userData && child.userData.isChunkHelper)) continue;
			if (child.userData && child.userData[tag]) {
				group.remove(child);
				const idx = raycastTargets.indexOf(child);
				if (idx !== -1) raycastTargets.splice(idx, 1);
				try { disposeObject(child); } catch (_) {}
			}
		}
		if (mesh) {
			mesh.userData = mesh.userData || {};
			mesh.userData[tag] = true;
			group.add(mesh);
			raycastTargets.push(mesh);
			group.userData.boundsDirty = true;
			expandGroupBoundsForGeometry(group, mesh.geometry);
		}
	}

	function rebuildChunkMeshForKey(chunkKey) {
		if (!chunkKey) return;
		const gameState = getGameStateRef ? getGameStateRef() : null;
		const chunk = gameState && gameState.chunks ? gameState.chunks[chunkKey] : null;
		const bricksObj = chunk && chunk.bricks ? chunk.bricks : null;
		const bricks = [];
		if (bricksObj) {
			for (const [bid, b] of Object.entries(bricksObj)) {
				if (!b || !b.pieceId) continue;
				bricks.push({ id: bid, pieceId: b.pieceId, colorIndex: b.colorIndex | 0, position: b.position, rotation: b.rotation });
			}
		}
		if (bricks.length === 0) {
			// Remove both LOD meshes
			replaceChunkMesh(chunkKey, null, 'low');
			replaceChunkMesh(chunkKey, null, 'high');
			chunkMeshData.delete(chunkKey);
			return;
		}
		// Always (re)build low LOD from convex
		const lowBuilt = buildBakedGeometryForChunk(chunkKey, bricks, { useConvex: true });
		if (lowBuilt) {
			const material = ensureBakedMaterial();
			const lowMesh = new THREE.Mesh(lowBuilt.geometry, material);
			lowMesh.castShadow = true;
			lowMesh.receiveShadow = true;
			lowMesh.userData = lowMesh.userData || {};
			lowMesh.userData.chunkKey = chunkKey;
			lowMesh.userData.brickIndexToBrickId = lowBuilt.brickIndexToBrickId;
			replaceChunkMesh(chunkKey, lowMesh, 'low');
			const rec = chunkMeshData.get(chunkKey) || {};
			rec.low = { mesh: lowMesh, geom: lowBuilt.geometry, map: lowBuilt.brickIndexToBrickId };
			chunkMeshData.set(chunkKey, rec);
		}
		// Build/update high detail immediately if this chunk is currently near (lod === 0)
		const group = chunkGroups.get(chunkKey);
		const ud = group && group.userData ? group.userData : null;
		const isNear = !!(ud && ud.lod === 0);
		const recNow = chunkMeshData.get(chunkKey) || {};
		if (isNear) {
			const builtHigh = buildBakedGeometryForChunk(chunkKey, bricks, { useConvex: false });
			if (builtHigh) {
				const material = ensureBakedMaterial();
				const highMesh = new THREE.Mesh(builtHigh.geometry, material);
				highMesh.castShadow = true;
				highMesh.receiveShadow = true;
				highMesh.userData = highMesh.userData || {};
				highMesh.userData.chunkKey = chunkKey;
				highMesh.userData.brickIndexToBrickId = builtHigh.brickIndexToBrickId;
				replaceChunkMesh(chunkKey, highMesh, 'high');
				recNow.high = { mesh: highMesh, geom: builtHigh.geometry, map: builtHigh.brickIndexToBrickId };
				chunkMeshData.set(chunkKey, recNow);
			}
		}
		// Ensure visibility matches current LOD immediately
		const recVis = chunkMeshData.get(chunkKey);
		if (recVis && group && group.userData) {
			if (recVis.low && recVis.low.mesh) recVis.low.mesh.visible = !(group.userData.lod === 0);
			if (recVis.high && recVis.high.mesh) recVis.high.mesh.visible = (group.userData.lod === 0);
		}
	}

	function addBrickInstance(brick) {
		if (!brick || !brick.chunkKey || CHUNK_SIZE == null) return;
		const parts = String(brick.chunkKey).split(',');
		const cx = parseInt(parts[0] || '0', 10) | 0;
		const cy = parseInt(parts[1] || '0', 10) | 0;
		const cz = parseInt(parts[2] || '0', 10) | 0;
		ensureChunkGroup(cx, cy, cz);
		rebuildChunkMeshForKey(brick.chunkKey);
	}

	// Fast path for bulk adds when parent group and origin are already known
	function addBrickInstanceFast(_parent, _origin, chunkKey, brick) {
		if (!chunkKey || !brick || CHUNK_SIZE == null) return;
		rebuildChunkMeshForKey(chunkKey);
	}

	function removeBrickInstance(brickId) {
		const gameState = getGameStateRef ? getGameStateRef() : null;
		let targetChunkKey = null;
		if (gameState && gameState.brickIndex && brickId != null) {
			targetChunkKey = gameState.brickIndex[brickId] || null;
		}
		if (!targetChunkKey && gameState && gameState.chunks) {
			for (const [ckey, c] of Object.entries(gameState.chunks)) {
				if (c && c.bricks && c.bricks[brickId]) { targetChunkKey = ckey; break; }
			}
		}
		if (targetChunkKey) {
			rebuildChunkMeshForKey(targetChunkKey);
		return true;
		}
		return false;
	}

	function removeBrickInChunk(chunkKey, _brickId) {
		if (!chunkKey) return;
		rebuildChunkMeshForKey(chunkKey);
	}

	function disposeAllInstancedMeshes() {
		for (const [chunkKey, rec] of chunkMeshData.entries()) {
			const group = chunkGroups.get(chunkKey);
			if (group) {
				for (const kind of ['low','high']) {
					const entry = rec && rec[kind];
					const mesh = entry && entry.mesh;
					if (!mesh) continue;
					group.remove(mesh);
					const idx = raycastTargets.indexOf(mesh);
				if (idx !== -1) raycastTargets.splice(idx, 1);
					try { disposeObject(mesh); } catch (_) {}
			}
		}
		}
		chunkMeshData.clear();
	}

	// Instance maps
	const playerMeshes = new Map(); // playerId -> Mesh
	const chunkGroups = new Map(); // chunkKey -> Group
	const playerNameSprites = new Map(); // playerId -> Sprite
	// Cached raycast targets to avoid per-frame allocations
	const raycastTargets = [];

	// UI helpers
	let studHighlightMesh = null;
	let skyboxMesh = null;
	let ghostArrow = null; // Arrow showing selected connector direction on ghost piece
	let ghostArrowBaseOrigin = null; // Base origin for arrow animation along its axis

	// Data refs provided by host
	let pieceList = [];
	let piecesData = {};
	let selectedPieceIndex = 0;
	let selectedColorIndex = 0;
	let getGameStateRef = null; // function returning latest gameState

	// Ghost placement state
	let ghostMesh = null;
	let ghostMaterial = null;
	let ghostMeshAdditive = null;
	let ghostMaterialAdditive = null;
	let ghostIsColliding = false;
	let ghostTargetPos = null;
	let ghostPieceId = null;
	let ghostYaw = 0;
	let ghostRotationEuler = { x: 0, y: 0, z: 0 };
	let selectedAntiStudIndex = 0;
	let selectedStudIndex = 0;
	let selectedAnchorMode = 'anti'; // 'anti' to snap anti-stud to hovered stud; 'stud' to snap stud to hovered anti-stud
	let lastMouseWorldPos = { x: 0, y: 0, z: 0 };
	let closestStudInfo = null; // { position: Vector3, brickId: string, direction?: Vector3 }
	let closestAntiStudInfo = null; // { position: Vector3, brickId: string, direction?: Vector3 }
	const PLACEMENT_MAX_DISTANCE = 1400;
	let lastRayHitValid = false;
	let lastHitBrickId = null; // brickId from most recent successful raycast hit

	// Ghost drop-in animation state
	let ghostDropAnimActive = false;
	let ghostDropStartTime = 0;
	let ghostDropDurationMs = 300; // ease-out duration
	let ghostDropStartDistance = 40; // how far back from target to start (world units)
	let ghostDropDir = new THREE.Vector3(0, 1, 0);
	let lastSnapKey = null; // signature of last highlighted snap target
	let isPlayerMoving = false; // updated each frame by host render call
	let ghostArrowFadeStartTime = 0;
	const ghostArrowFadeDurationMs = 3000;

	// Preview state
	let previewMesh = null;
	let previewMaterial = null;
	let previewRotationSpeed = 0.01;
	let previewEnabled = true;

    // disposed via threeUtils

	function setLoading(text) {
		onLoadingTextChange(text || "");
	}

    // moved to lighting.js

    function setupEquirectangularSkybox() {
        setupSkyboxExternal(scene, camera, (mesh) => { skyboxMesh = mesh; }, onError);
    }


	function setupBrickMaterials() {
		const colors = colorPalette.map((hex) => new THREE.Color(hex).convertSRGBToLinear());
		brickMaterials = colors.map((color) => new THREE.MeshStandardNodeMaterial({
			color,
			roughness: 0.2,
			envMapIntensity: 0.8,
		}));
		ensureBakedMaterial();
	}

	function ensureStudHighlight() {
		if (studHighlightMesh) return;
		const geometry = new THREE.CylinderGeometry(6.5, 6.5, 4, 16);
		const material = new THREE.MeshBasicNodeMaterial({
			color: 0xdf8f00,
			transparent: true,
			opacity: 0.7,
			depthTest: false,
		});
		studHighlightMesh = new THREE.Mesh(geometry, material);
		studHighlightMesh.renderOrder = 999;
		studHighlightMesh.visible = false;
		scene.add(studHighlightMesh);
	}

	function setupGhostMaterial() {
		if (ghostMaterial && ghostMaterialAdditive) return;
		ghostMaterial = new THREE.MeshStandardNodeMaterial({
			color: 0x00ffc8,
			transparent: true,
			blending: THREE.NormalBlending,
			opacity: 0.95,
			depthWrite: true,
			roughness: 0.3,
			metalness: 0.0,
		});
		ghostMaterial.shadowSide = null;
		// Secondary very-dim additive layer to show through occluders
		if (!ghostMaterialAdditive) {
			ghostMaterialAdditive = new THREE.MeshStandardNodeMaterial({
				color: 0x101010,
				transparent: true,
				blending: THREE.NormalBlending,
				opacity: 0.96,
				depthTest: false,
				depthWrite: false,
				roughness: 0.3,
				metalness: 0.0,
			});
			ghostMaterialAdditive.shadowSide = null;
		}
	}

	function setupPreview(previewContainerElement) {
		if (!previewContainerElement) return;
		
		previewContainer = previewContainerElement;
		
		// Create preview scene
		previewScene = new THREE.Scene();
		previewScene.background = null; // Transparent background
		
		// Create preview camera
		const pcw = (previewContainer && previewContainer.clientWidth) || 150;
		const pch = (previewContainer && previewContainer.clientHeight) || 150;
		previewCamera = new THREE.PerspectiveCamera(45, Math.max(1e-3, pcw / pch), 0.1, 1000);
		previewCamera.position.set(100, 80, 100);
		previewCamera.lookAt(0, 0, 0);
		
		// Create preview renderer (WebGPU)
		previewRenderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
		previewRenderer.setSize(pcw, pch);
		previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
		previewRenderer.toneMapping = THREE.NoToneMapping;
		previewRenderer.toneMappingExposure = 1.0;
		previewRenderer.shadowMap.enabled = true;
		previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
		previewRenderer.setClearColor(0x000000, 0);
		
		previewContainer.appendChild(previewRenderer.domElement);
		// WebGPU requires async init; fire-and-forget for preview
		try { void previewRenderer.init(); } catch (_) {}
		

		// Add lighting to preview scene (nodes-enabled lights)
		const ambientLight = new THREE.HemisphereLight(0xafdfff, 0x444444, 1.0);
		previewScene.add(ambientLight);
		
		const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2);
		directionalLight.position.set(50, 100, 50);
		directionalLight.castShadow = false;
		directionalLight.shadow.mapSize.width = 512;
		directionalLight.shadow.mapSize.height = 512;
		previewScene.add(directionalLight);
		
		// Preview material uses the same baked material as main bricks via ensureBakedMaterial()
		
		// Create initial preview mesh
		updatePreviewMesh();
	}

	function updatePreviewMesh() {
		if (!previewScene || !brickMaterials) return;
		
		// Remove existing preview mesh
		if (previewMesh) {
			previewScene.remove(previewMesh);
			previewMesh = null;
		}
		
		// Get current selected piece
		const selectedPiece = pieceList[selectedPieceIndex];
		if (!selectedPiece) return;
		
		// Get geometry for selected piece
		let geometry = brickGeometries.get(selectedPiece.id);
		if (!geometry) {
			if (brickGeometries.size > 0) {
				geometry = brickGeometries.values().next().value;
			}
		}
		if (!geometry) return;
		
		// Build sRGB vertex colors and use baked material to match main pipeline
		const bakedMat = ensureBakedMaterial();
		if (!bakedMat) return;
		const vtxCount = (geometry.attributes && geometry.attributes.position && geometry.attributes.position.count) || 0;
		if (vtxCount <= 0) return;
		const geom = geometry.clone();
		const matColor = (brickMaterials && brickMaterials[selectedColorIndex] ? brickMaterials[selectedColorIndex].color : (brickMaterials && brickMaterials[0] ? brickMaterials[0].color : new THREE.Color(1,1,1)));
		const [cr, cg, cb] = quantizeColorToUint8(matColor || new THREE.Color(1,1,1));
		const colors = new Uint8Array(vtxCount * 4);
		for (let i = 0; i < vtxCount; i++) {
			const o = i * 4;
			colors[o + 0] = cr;
			colors[o + 1] = cg;
			colors[o + 2] = cb;
			colors[o + 3] = 255;
		}
		geom.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
		
		// Create new preview mesh
		previewMesh = new THREE.Mesh(geom, bakedMat);
		previewMesh.castShadow = true;
		previewMesh.receiveShadow = true;
		
		// Center the piece (optional - adjust based on piece dimensions)
		geom.computeBoundingBox();
		if (geom.boundingBox) {
			const center = geom.boundingBox.getCenter(new THREE.Vector3());
			previewMesh.position.set(-center.x, -center.y, -center.z);
		}
		
		previewScene.add(previewMesh);
	}

	function renderPreview() {
		if (!previewRenderer || !previewScene || !previewCamera) return;
		
		// Rotate the preview mesh if present
		if (previewMesh) previewMesh.rotation.y += previewRotationSpeed;
		
		// Use async path in case backend still initializing
		if (previewRenderer.backend && previewRenderer.backend.device) {
			previewRenderer.render(previewScene, previewCamera);
		} else {
			void previewRenderer.renderAsync(previewScene, previewCamera);
		}
	}

	function setGhostCollisionVisual(colliding) {
		ghostIsColliding = !!colliding;
		if (!ghostMaterial) return;
		const target = colliding ? 0xff0000 : 0x00ffc8;
		const targetAdditive = colliding ? 0xa00000 : 0x101010;
		ghostMaterial.color.setHex(target).convertSRGBToLinear();
		if (ghostMaterialAdditive) ghostMaterialAdditive.color.setHex(targetAdditive).convertSRGBToLinear();
		// Keep arrow color in sync with ghost piece
		if (ghostArrow) {
			if (ghostArrow.material && ghostArrow.material.color) {
				ghostArrow.material.color.copy(ghostMaterial.color);
			}
		}
		// Opacity is animated per-frame; do not override here
	}

	// Helper: choose the currently selected connector (stud or anti) once
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

	// Helper: from the chosen connector, compute finalQuat and targetPos
	function computeGhostPoseFromConnector(connInfo, baseQuat, closestStudInfoLocal, closestAntiStudInfoLocal) {
		let finalQuat = baseQuat.clone ? baseQuat.clone() : new THREE.Quaternion().copy(baseQuat);
		let targetPos = null;
		if (!connInfo || !connInfo.connector) return { finalQuat, targetPos, connInfo };
		const useStud = connInfo.useStud;
		const connector = connInfo.connector;
		const targetAxis = (useStud ? (closestAntiStudInfoLocal && closestAntiStudInfoLocal.direction) : (closestStudInfoLocal && closestStudInfoLocal.direction)) || new THREE.Vector3(0, 1, 0);
		const normTargetAxis = targetAxis.clone().normalize();
		const localDir = new THREE.Vector3(
			Number.isFinite(connector.dx) ? connector.dx : 0,
			Number.isFinite(connector.dy) ? connector.dy : 1,
			Number.isFinite(connector.dz) ? connector.dz : 0,
		).normalize();
		const dirWorld0 = localDir.clone().applyQuaternion(finalQuat).normalize();
		const alignQuat = new THREE.Quaternion().setFromUnitVectors(dirWorld0, normTargetAxis);
		finalQuat = alignQuat.clone().multiply(finalQuat);
		const localPos = new THREE.Vector3(
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

	// Helper: world-space connector origin and directions for animation and arrow
	function computeConnectorWorldVectors(connInfo, finalQuat, targetPos) {
		if (!connInfo || !connInfo.connector || !finalQuat || !targetPos) return null;
		const { connector, useStud } = connInfo;
		const localPos = new THREE.Vector3(
			Number.isFinite(connector.x) ? connector.x : 0,
			Number.isFinite(connector.y) ? connector.y : 0,
			Number.isFinite(connector.z) ? connector.z : 0,
		);
		const worldOffset = localPos.clone().applyQuaternion(finalQuat);
		const origin = new THREE.Vector3(targetPos.x + worldOffset.x, targetPos.y + worldOffset.y, targetPos.z + worldOffset.z);
		let localDir = new THREE.Vector3(
			Number.isFinite(connector.dx) ? connector.dx : 0,
			Number.isFinite(connector.dy) ? connector.dy : 1,
			Number.isFinite(connector.dz) ? connector.dz : 0,
		).normalize();
		let worldDirBase = localDir.applyQuaternion(finalQuat).normalize();
		const animDir = useStud ? worldDirBase.clone().normalize() : worldDirBase.clone().multiplyScalar(-1).normalize();
		const arrowDir = animDir.clone().multiplyScalar(-1).normalize();
		return { origin, animDir, arrowDir };
	}

	function ensureGhostMesh(forceGeometryUpdate = false) {
		if (!scene) return;
		setupGhostMaterial();
		const selectedPiece = pieceList[selectedPieceIndex];
		const selectedPieceId = selectedPiece ? selectedPiece.id : null;
		if (!selectedPieceId) {
			if (ghostMesh) ghostMesh.visible = false;
			return;
		}
		let geometry = brickGeometries.get(selectedPieceId);
		if (!geometry) {
			if (brickGeometries.size > 0) geometry = brickGeometries.values().next().value;
		}
		if (!geometry) {
			if (ghostMesh) ghostMesh.visible = false;
			return;
		}
		if (!ghostMesh) {
			ghostMesh = new THREE.Mesh(geometry, ghostMaterial);
			ghostMesh.castShadow = false;
			ghostMesh.receiveShadow = false;
			ghostMesh.renderOrder = 998;
			scene.add(ghostMesh);
			// Add the additive ghost mesh
			ghostMeshAdditive = new THREE.Mesh(geometry, ghostMaterialAdditive);
			ghostMeshAdditive.castShadow = false;
			ghostMeshAdditive.receiveShadow = false;
			ghostMeshAdditive.renderOrder = 997;
			scene.add(ghostMeshAdditive);
			// Create arrow helper once
			if (!ghostArrow) {
				// Fixed-size cone (head only): radius=12, height=16
				const coneGeom = new THREE.ConeGeometry(6, 16, 16);
				const coneMat = new THREE.MeshBasicNodeMaterial({ color: 0xffaa00 });
				ghostArrow = new THREE.Mesh(coneGeom, coneMat);
				ghostArrow.visible = false;
				ghostArrow.renderOrder = 999;
				// Match arrow color to ghost piece color on creation
				if (ghostMaterial && ghostArrow.material && ghostArrow.material.color) {
					ghostArrow.material.color.copy(ghostMaterial.color);
				}
				scene.add(ghostArrow);
			}
		} else if (forceGeometryUpdate || ghostMesh.geometry !== geometry) {
			ghostMesh.geometry = geometry;
			if (ghostMeshAdditive) ghostMeshAdditive.geometry = geometry;
		}

		const pieceData = piecesData[selectedPieceId];
		let targetPos = null;
		let finalQuatBase = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ghostYaw, 0));
		const connInfo = getSelectedConnectorForPiece(pieceData);
		const pose = computeGhostPoseFromConnector(connInfo, finalQuatBase, closestStudInfo, closestAntiStudInfo);
		let finalQuat = pose.finalQuat;
		targetPos = pose.targetPos;
		if (targetPos) {
			// Compute connector vectors (for drop animation and arrow) once
			const connVectors = computeConnectorWorldVectors(connInfo, finalQuat, targetPos);
			let animArrowDir = connVectors ? connVectors.animDir : null;

			// Detect highlighted snap target change and start one-shot drop animation
			const snapInfo = (selectedAnchorMode === 'stud') ? closestAntiStudInfo : closestStudInfo;
			const snapBrickId = snapInfo && snapInfo.brickId ? snapInfo.brickId : 'none';
			const sx = snapInfo && snapInfo.position ? snapInfo.position.x : targetPos.x;
			const sy = snapInfo && snapInfo.position ? snapInfo.position.y : targetPos.y;
			const sz = snapInfo && snapInfo.position ? snapInfo.position.z : targetPos.z;
			const newSnapKey = `${selectedAnchorMode}|${snapBrickId}|${sx.toFixed(1)},${sy.toFixed(1)},${sz.toFixed(1)}`;
			if (newSnapKey !== lastSnapKey) {
				lastSnapKey = newSnapKey;
				ghostDropAnimActive = !isPlayerMoving;
				ghostDropStartTime = Date.now();
				ghostDropDir = (animArrowDir && animArrowDir.length() > 0.0001) ? animArrowDir.clone().normalize() : new THREE.Vector3(0, 1, 0);
				ghostArrowFadeStartTime = Date.now();
			}

			// Position ghost, possibly offset by active drop animation along the arrow direction
			let posX = targetPos.x, posY = targetPos.y, posZ = targetPos.z;
			if (ghostDropAnimActive && ghostDropDir) {
				const t = Math.max(0, Math.min(1, (Date.now() - ghostDropStartTime) / ghostDropDurationMs));
				const easeOut = 1 - Math.pow(1 - t, 3); // cubic ease-out
				const remaining = (1 - easeOut) * ghostDropStartDistance;
				posX = targetPos.x + ghostDropDir.x * remaining;
				posY = targetPos.y + ghostDropDir.y * remaining;
				posZ = targetPos.z + ghostDropDir.z * remaining;
				if (t >= 1) ghostDropAnimActive = false;
			}
			ghostMesh.position.set(posX, posY, posZ);
			ghostMesh.setRotationFromQuaternion(finalQuat);
			ghostMesh.visible = !isPlayerMoving;
			if (ghostMeshAdditive) {
				ghostMeshAdditive.position.set(posX, posY, posZ);
				ghostMeshAdditive.setRotationFromQuaternion(finalQuat);
				ghostMeshAdditive.visible = !isPlayerMoving;
			}
			ghostTargetPos = { ...targetPos };
			const selectedPiece = pieceList[selectedPieceIndex];
			ghostPieceId = selectedPiece ? selectedPiece.id : null;
			const e = new THREE.Euler().setFromQuaternion(finalQuat, "XYZ");
			ghostRotationEuler = { x: e.x, y: e.y, z: e.z };
			// Update ghost connector arrow (origin and direction)
			if (ghostArrow) {
				const connVectorsForArrow = computeConnectorWorldVectors(connInfo, finalQuat, targetPos);
				if (connVectorsForArrow) {
					const origin = connVectorsForArrow.origin;
					const worldDir = connVectorsForArrow.arrowDir;
					ghostArrow.position.copy(origin);
					ghostArrowBaseOrigin = origin.clone();
					{
						const up = new THREE.Vector3(0, 1, 0);
						const n = worldDir.clone().normalize();
						ghostArrow.quaternion.setFromUnitVectors(up, n);
					}
					ghostArrow.visible = !isPlayerMoving;
					if (ghostArrow.material) {
						const t = Math.max(0, Math.min(1, (Date.now() - ghostArrowFadeStartTime) / ghostArrowFadeDurationMs));
						const alpha = 1 - t;
						ghostArrow.material.transparent = true;
						ghostArrow.material.opacity = alpha;
					}
					// line part is disabled by user preference
				} else {
					ghostArrow.visible = false;
				}
			}
		} else {
			ghostMesh.visible = false;
			if (ghostMeshAdditive) ghostMeshAdditive.visible = false;
			ghostTargetPos = null;
			ghostPieceId = null;
			if (ghostArrow) ghostArrow.visible = false;
		}
	}

	function updateClosestStud(raycaster, intersects) {
		if (!studHighlightMesh) return;
		// Only consider the closest-hit piece under the cursor
		const firstIntersection = (intersects && intersects.length > 0) ? intersects[0] : null;
		let targetBrickId = null;
		let targetChunkKey = null;
		if (firstIntersection && firstIntersection.object && firstIntersection.object.geometry) {
			// Resolve from baked mesh
			const obj = firstIntersection.object;
			const geom = obj.geometry;
			const brickIndexAttr = geom.getAttribute && geom.getAttribute('brickIndex');
			if (brickIndexAttr) {
				let vIndex = 0;
				if (Number.isFinite(firstIntersection.faceIndex)) {
					const tri = firstIntersection.faceIndex | 0;
					if (geom.index) {
						const ia = geom.index;
						vIndex = ia.getX ? (ia.getX(tri * 3) | 0) : (ia.array[tri * 3] | 0);
					} else {
						vIndex = (tri * 3) | 0;
					}
				} else if (firstIntersection.face && Number.isFinite(firstIntersection.face.a)) {
					vIndex = firstIntersection.face.a | 0;
				}
				const bi = brickIndexAttr.getX ? (brickIndexAttr.getX(vIndex) | 0) : (brickIndexAttr.array[vIndex] | 0);
				const map = obj.userData && obj.userData.brickIndexToBrickId;
				targetBrickId = (map && map[bi] != null) ? map[bi] : null;
				targetChunkKey = obj.userData && obj.userData.chunkKey || null;
		} else {
			targetBrickId = (firstIntersection && firstIntersection.object && firstIntersection.object.userData) ? firstIntersection.object.userData.brickId : null;
			targetChunkKey = (firstIntersection && firstIntersection.object && firstIntersection.object.userData) ? (firstIntersection.object.userData.chunkKey || null) : null;
			}
		}
		if (!targetBrickId) {
			studHighlightMesh.visible = false;
			closestStudInfo = null;
			closestAntiStudInfo = null;
			return;
		}
		const gameState = getGameStateRef ? getGameStateRef() : null;
		let brick = null;
		if (gameState && gameState.chunks) {
			if (targetChunkKey && gameState.chunks[targetChunkKey] && gameState.chunks[targetChunkKey].bricks) {
				brick = gameState.chunks[targetChunkKey].bricks[targetBrickId] || null;
			}
			if (!brick && gameState.brickIndex) {
				const key = gameState.brickIndex[targetBrickId];
				if (key && gameState.chunks[key] && gameState.chunks[key].bricks) {
					brick = gameState.chunks[key].bricks[targetBrickId] || null;
				}
			}
		}
		if (!brick) {
			studHighlightMesh.visible = false;
			closestStudInfo = null;
			closestAntiStudInfo = null;
			return;
		}
		const hitPoint = firstIntersection.point;
		let bestStudPos = null;
		let bestStudDir = null;
		let bestAntiPos = null;
		let bestAntiDir = null;
		let bestStudDist = Infinity;
		let bestAntiDist = Infinity;
		const brickQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(brick.rotation.x, brick.rotation.y, brick.rotation.z));
		const brickMatrix = new THREE.Matrix4();
		brickMatrix.compose(new THREE.Vector3(brick.position.x, brick.position.y, brick.position.z), brickQuat, new THREE.Vector3(1, 1, 1));
		const pieceData = piecesData[brick.pieceId] || {};
		const studsArr = Array.isArray(pieceData.studs) ? pieceData.studs : [];
		for (const stud of studsArr) {
			const studWorldPos = new THREE.Vector3(stud.x, stud.y, stud.z).applyMatrix4(brickMatrix);
			let studWorldDir = new THREE.Vector3(0, 1, 0);
			if (typeof stud.dx === "number" && typeof stud.dy === "number" && typeof stud.dz === "number") {
				studWorldDir = new THREE.Vector3(stud.dx, stud.dy, stud.dz).normalize().applyQuaternion(brickQuat);
			} else {
				studWorldDir.applyQuaternion(brickQuat);
			}
			const d = hitPoint.distanceTo(studWorldPos);
			if (d < bestStudDist && d < 60) {
				bestStudDist = d;
				bestStudPos = studWorldPos;
				bestStudDir = studWorldDir.clone().normalize();
			}
		}
		const antisArr = Array.isArray(pieceData.antiStuds) ? pieceData.antiStuds : [];
		for (const anti of antisArr) {
			const antiWorldPos = new THREE.Vector3(anti.x, anti.y, anti.z).applyMatrix4(brickMatrix);
			let antiWorldDir = new THREE.Vector3(0, 1, 0);
			if (typeof anti.dx === "number" && typeof anti.dy === "number" && typeof anti.dz === "number") {
				antiWorldDir = new THREE.Vector3(anti.dx, anti.dy, anti.dz).normalize().applyQuaternion(brickQuat);
			} else {
				antiWorldDir.applyQuaternion(brickQuat);
			}
			const d = hitPoint.distanceTo(antiWorldPos);
			if (d < bestAntiDist && d < 80) {
				bestAntiDist = d;
				bestAntiPos = antiWorldPos;
				bestAntiDir = antiWorldDir.clone().normalize();
			}
		}

		let chosenPos = null;
		let chosenDir = null;
		if (selectedAnchorMode === 'anti') {
			if (bestStudPos) { chosenPos = bestStudPos; chosenDir = bestStudDir; }
		} else {
			if (bestAntiPos) { chosenPos = bestAntiPos; chosenDir = bestAntiDir; }
		}

		if (chosenPos) {
			studHighlightMesh.position.copy(chosenPos);
			studHighlightMesh.position.y += 2;
			const up = new THREE.Vector3(0, 1, 0);
			const dir = (chosenDir && chosenDir.length() > 0.0001) ? chosenDir.clone().normalize() : up;
			const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
			studHighlightMesh.setRotationFromQuaternion(q);
			studHighlightMesh.visible = true;
			closestStudInfo = bestStudPos ? { position: bestStudPos, brickId: targetBrickId, direction: bestStudDir ? bestStudDir.clone().normalize() : undefined } : null;
			closestAntiStudInfo = bestAntiPos ? { position: bestAntiPos, brickId: targetBrickId, direction: bestAntiDir ? bestAntiDir.clone().normalize() : undefined } : null;
		} else {
			studHighlightMesh.visible = false;
			closestStudInfo = bestStudPos ? { position: bestStudPos, brickId: targetBrickId, direction: bestStudDir ? bestStudDir.clone().normalize() : undefined } : null;
			closestAntiStudInfo = bestAntiPos ? { position: bestAntiPos, brickId: targetBrickId, direction: bestAntiDir ? bestAntiDir.clone().normalize() : undefined } : null;
		}
	}


	async function loadBrickModelInternal() {
		await loadBrickModel({ gltfLoader, setLoading, setupBrickMaterials, brickGeometries, collisionGeometries, convexGeometries });
	}

	function createMinifigureGroup(colors) {
		// Require the three part geometries
		const geomLegs = brickGeometries.get("73200");
		const geomTorso = brickGeometries.get("76382");
		const geomHead = brickGeometries.get("3626");
		if (!geomLegs || !geomTorso || !geomHead) return null;

		// Expect per-part colors object { legs, torso }
		const legsColor = (colors && typeof colors.legs === 'number') ? colors.legs : 0x0e78cf;
		const torsoColor = (colors && typeof colors.torso === 'number') ? colors.torso : 0x0e78cf;

		const legsLinear = new THREE.Color(legsColor);//.convertSRGBToLinear();
		const torsoLinear = new THREE.Color(torsoColor);//.convertSRGBToLinear();
		const headLinear = new THREE.Color(0xffd804);//.convertSRGBToLinear();
		const legsMaterial = new THREE.MeshStandardNodeMaterial({ color: legsLinear, roughness: 0.35, metalness: 0.0 });
		const torsoMaterial = new THREE.MeshStandardNodeMaterial({ color: torsoLinear, roughness: 0.35, metalness: 0.0 });
		const headMaterial = new THREE.MeshStandardNodeMaterial({ color: headLinear, roughness: 0.35, metalness: 0.0 });
		const group = new THREE.Group();

		// Clone geometries to avoid bounding box mutation side-effects across instances
		const legsGeom = geomLegs.clone();
		const torsoGeom = geomTorso.clone();
		const headGeom = geomHead.clone();

		const legs = new THREE.Mesh(legsGeom, legsMaterial);
		const torso = new THREE.Mesh(torsoGeom, torsoMaterial);
		const head = new THREE.Mesh(headGeom, headMaterial);

		legs.castShadow = legs.receiveShadow = true;
		torso.castShadow = torso.receiveShadow = true;
		head.castShadow = head.receiveShadow = true;


		// Hardcoded placement: legs at y=0, torso +48, head +32 above torso
		legs.position.set(0, -12, 0);
		torso.position.set(0, 20, 0);
		head.position.set(0, 20 + 24, 0);

		group.add(legs);
		group.add(torso);
		group.add(head);

		return group;
	}

	// Chunk config (authoritative from server)
	let CHUNK_SIZE = null;
	let CHUNK_HEIGHT = null;
	let chunkDebugVisible = false;
	// Simple chunk LOD settings
	let LOD_DISTANCE = 1000; // world units from camera to chunk AABB center to switch to convex
	// Centralized far render distance (used for camera.far and chunk culling)
	let RENDER_DISTANCE = 10000; // world units

	function setChunkConfig(cfg) { setChunkConfigExternal({ CHUNK_SIZE, CHUNK_HEIGHT }, cfg); CHUNK_SIZE = (cfg && typeof cfg.size === 'number') ? cfg.size : null; CHUNK_HEIGHT = (cfg && typeof cfg.height === 'number') ? cfg.height : null; }

	function getChunkOriginFromKey(key) { return getChunkOriginFromKeyExternal({ CHUNK_SIZE, CHUNK_HEIGHT }, key); }

	function ensureChunkGroup(cx, cy, cz) { return ensureChunkGroupExternal({ CHUNK_SIZE, CHUNK_HEIGHT, chunkGroups, chunkDebugVisible }, scene, cx, cy, cz); }

	function setChunkDebugVisible(visible) { chunkDebugVisible = !!visible; setChunkDebugVisibleExternal({ CHUNK_SIZE, CHUNK_HEIGHT, chunkGroups, chunkDebugVisible }, scene, chunkDebugVisible); }

	function getMouseWorldPosition() {
		const raycaster = _sharedRaycaster;
		raycaster.setFromCamera(_ndcCenter, camera);
		// Only raycast against bricks (exclude players) using cached list
		// Limit effective ray length for picking to reduce broad-phase work
		raycaster.far = PLACEMENT_MAX_DISTANCE;
		// With BVH, return only the closest hit for speed
		raycaster.firstHitOnly = true;
		const intersects = raycaster.intersectObjects(raycastTargets, true);
		let result;
		if (intersects.length > 0) {
			const intersection = intersects[0];
			lastRayHitValid = (typeof intersection.distance === 'number') ? (intersection.distance <= PLACEMENT_MAX_DISTANCE) : true;
			if (lastRayHitValid) {
				// Resolve brickId from baked mesh vertex attribute `brickIndex`
				(function(){
					const obj = intersection.object;
					const geom = obj && obj.geometry;
					const brickIndexAttr = geom && geom.getAttribute ? geom.getAttribute('brickIndex') : null;
					if (brickIndexAttr) {
						let vIndex = 0;
						if (Number.isFinite(intersection.faceIndex)) {
							const tri = intersection.faceIndex | 0;
							if (geom.index) {
								const ia = geom.index;
								vIndex = ia.getX ? (ia.getX(tri * 3) | 0) : (ia.array[tri * 3] | 0);
							} else {
								vIndex = (tri * 3) | 0;
							}
						} else if (intersection.face && Number.isFinite(intersection.face.a)) {
							vIndex = intersection.face.a | 0;
						}
						const bi = brickIndexAttr.getX ? (brickIndexAttr.getX(vIndex) | 0) : (brickIndexAttr.array[vIndex] | 0);
						const map = obj && obj.userData && obj.userData.brickIndexToBrickId;
						lastHitBrickId = (map && map[bi] != null) ? map[bi] : null;
				} else {
					lastHitBrickId = (intersection && intersection.object && intersection.object.userData) ? (intersection.object.userData.brickId || null) : null;
				}
				})();
				updateClosestStud(raycaster, intersects);
				result = { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z };
				lastMouseWorldPos = result;
			} else {
				// Out of range - clear stud highlight and invalidate placement
				if (studHighlightMesh) studHighlightMesh.visible = false;
				closestStudInfo = null;
				lastMouseWorldPos = null;
				lastHitBrickId = null;
				result = { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z };
			}
		} else {
			lastRayHitValid = false;
			// No hit - clear stud highlight and keep a ground-plane projection for cursor, but disable placement
			if (studHighlightMesh) studHighlightMesh.visible = false;
			closestStudInfo = null;
			lastHitBrickId = null;
			const vector = _tempVec3b.set(0, 0, 0.5);
			vector.unproject(camera);
			const dir = vector.sub(camera.position).normalize();
			const distance = -camera.position.y / dir.y;
			const pos = _tempVec3.copy(camera.position).add(dir.multiplyScalar(distance));
			result = { x: pos.x, y: pos.y, z: pos.z };
			lastMouseWorldPos = null;
		}
		ensureGhostMesh(false);
		return result;
	}

	function createBrickMesh(brick) {
		if (!brickMaterials) return;
		if (!brick || !brick.chunkKey || CHUNK_SIZE == null) return;
		rebuildChunkMeshForKey(brick.chunkKey);
	}

	function removeBrickMesh(brickId) {
		removeBrickInstance(brickId);
	}

	function reconcileChunksAndBricks(stateChunks, stateBricks) {
		bulkReconcileActive = true;
		try {
			// Ensure groups exist for all chunks (derive coords from key to keep keys consistent)
			if (stateChunks && typeof stateChunks === 'object') {
				for (const [key, _c] of Object.entries(stateChunks)) {
					const parts = String(key).split(',');
					const cx = parseInt(parts[0] || '0', 10) | 0;
					const cy = parseInt(parts[1] || '0', 10) | 0;
					const cz = parseInt(parts[2] || '0', 10) | 0;
					ensureChunkGroup(cx, cy, cz);
				}
			}
			// Build/rebuild baked meshes per chunk
			if (stateBricks && typeof stateBricks === 'object') {
				// For flat map, collect per chunk
				const byChunk = new Map();
				for (const [bid, b] of Object.entries(stateBricks)) {
					if (!b || !b.chunkKey || !b.pieceId) continue;
					let arr = byChunk.get(b.chunkKey);
					if (!arr) { arr = []; byChunk.set(b.chunkKey, arr); }
					arr.push({ id: bid, pieceId: b.pieceId, colorIndex: b.colorIndex | 0, position: b.position, rotation: b.rotation });
				}
				for (const [ckey, arr] of byChunk.entries()) {
					rebuildChunkMeshForKey(ckey);
				}
			} else if (stateChunks && typeof stateChunks === 'object') {
				for (const [ckey, c] of Object.entries(stateChunks)) {
					void ckey; void c;
					rebuildChunkMeshForKey(ckey);
				}
			}
		} finally {
			for (const group of _groupsNeedingBounds) {
				try { if (group) recomputeGroupBounds(group); } catch (_) {}
			}
			_groupsNeedingBounds.clear();
			bulkReconcileActive = false;
		}
	}

	function removeChunkGroupAndInstances(chunkKey) {
		// Remove baked mesh for this chunk
		const rec = chunkMeshData.get(chunkKey);
		if (rec) {
			const group = chunkGroups.get(chunkKey);
			if (group) {
				for (const kind of ['low','high']) {
					const entry = rec[kind];
					if (entry && entry.mesh) {
						group.remove(entry.mesh);
						const idx = raycastTargets.indexOf(entry.mesh);
					if (idx !== -1) raycastTargets.splice(idx, 1);
						try { disposeObject(entry.mesh); } catch (_) {}
					}
				}
			}
			chunkMeshData.delete(chunkKey);
		}
		// Remove the chunk group
		const group = chunkGroups.get(chunkKey);
		if (group) {
			scene.remove(group);
			chunkGroups.delete(chunkKey);
		}
	}

	function createPlayerMesh(playerData) {
		const existing = playerMeshes.get(playerData.id);
		if (existing) {
			scene.remove(existing);
			disposeObject(existing);
			playerMeshes.delete(playerData.id);
		}
		// Try to build a minifigure group from parts; fall back to capsule if unavailable
		let figure = createMinifigureGroup({
			legs: playerData.colorLegs,
			torso: playerData.colorTorso,
		});
		if (!figure) {
			const radius = 24; // keep in sync with server capsule for collisions
			const length = 28 * 2;
			const geometry = new THREE.CapsuleGeometry(radius, length, 6, 12);
			const material = new THREE.MeshStandardNodeMaterial({ color: playerData.colorLegs || 0x0e78cf, roughness: 0.7, metalness: 0.1 });
			figure = new THREE.Mesh(geometry, material);
		}
		figure.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
		// Initialize facing to server-provided yaw so remote players look correct immediately
		if (playerData.rotation && typeof playerData.rotation.y === 'number') {
			figure.rotation.set(0, playerData.rotation.y, 0);
		}
		figure.castShadow = true;
		figure.receiveShadow = true;
		scene.add(figure);
		playerMeshes.set(playerData.id, figure);

		// Create or update name sprite
		createOrUpdateNameSprite(playerData);
	}

	function updatePlayerMesh(playerData) {
		const mesh = playerMeshes.get(playerData.id);
		if (mesh) {
			mesh.position.x += (playerData.position.x - mesh.position.x) * 0.2;
			mesh.position.y += (playerData.position.y - mesh.position.y) * 0.2;
			mesh.position.z += (playerData.position.z - mesh.position.z) * 0.2;
			// Apply yaw from server for remote players; local player is handled in renderTick
			if (playerData.rotation && typeof playerData.rotation.y === 'number') {
				mesh.rotation.y = playerData.rotation.y;
			}
		}
		// Update name sprite position and text if changed
		createOrUpdateNameSprite(playerData);
	}

	function removePlayerMesh(playerId) {
		const mesh = playerMeshes.get(playerId);
		if (mesh) {
			scene.remove(mesh);
			disposeObject(mesh);
			playerMeshes.delete(playerId);
		}
		const sprite = playerNameSprites.get(playerId);
		if (sprite) {
			scene.remove(sprite);
			if (sprite.material && sprite.material.map && sprite.material.map.dispose) try { sprite.material.map.dispose(); } catch (_) {}
			if (sprite.material && sprite.material.dispose) try { sprite.material.dispose(); } catch (_) {}
			playerNameSprites.delete(playerId);
		}
	}

	function resetAllMeshes() {
		playerMeshes.forEach((mesh) => {
			scene.remove(mesh);
			disposeObject(mesh);
		});
		playerMeshes.clear();
		playerNameSprites.forEach((sprite) => {
			scene.remove(sprite);
			if (sprite.material && sprite.material.map && sprite.material.map.dispose) try { sprite.material.map.dispose(); } catch (_) {}
			if (sprite.material && sprite.material.dispose) try { sprite.material.dispose(); } catch (_) {}
		});
		playerNameSprites.clear();
		// Dispose instanced meshes and clear maps
		disposeAllInstancedMeshes();
	}

	function onWindowResize() {
		if (!camera || !renderer) return;
		const { width, height } = getContainerSize();
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
	}

	function applyAuthoritativeGhostPose(gp) {
		if (!gp || !ghostMesh) return;
		ghostMesh.visible = !isPlayerMoving;
		ghostMesh.position.set(gp.position.x, gp.position.y, gp.position.z);
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(gp.rotation.x || 0, gp.rotation.y || 0, gp.rotation.z || 0));
		ghostMesh.setRotationFromQuaternion(q);
		if (ghostMeshAdditive) {
			ghostMeshAdditive.visible = !isPlayerMoving;
			ghostMeshAdditive.position.set(gp.position.x, gp.position.y, gp.position.z);
			ghostMeshAdditive.setRotationFromQuaternion(q);
		}
		ghostTargetPos = { ...gp.position };
		ghostRotationEuler = { ...gp.rotation };
	}

	function renderTick(localPlayer, yaw, pitch, isThirdPerson, isMoving) {
		isPlayerMoving = !!isMoving;
		if (!renderer || !scene || !camera) return;
		
		// Update skybox position to follow camera (makes it appear infinitely far away)
		if (skyboxMesh) {
			skyboxMesh.position.copy(camera.position);
		}
		
		// Animate ghost opacity with a 1 Hz sine wave between 0.1 and 1.0
		if (ghostMaterial) {
			const tSec = Date.now() * 0.001;
			const phase = Math.sin(2 * Math.PI * 1.0 * tSec); // 1 Hz
			const minA = 0.1, maxA = 1.0;
			ghostMaterial.opacity = ((phase + 1) * 0.5) * (maxA - minA) + minA;
			if (ghostMaterialAdditive) {
				ghostMaterialAdditive.opacity = Math.max(0.02, ghostMaterial.opacity * 0.4);
			}
			// Animate ghostArrow sliding along its axis at 1 Hz and fade over time
			if (ghostArrow && ghostArrow.visible) {
				const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(ghostArrow.quaternion).normalize();
				const base = ghostArrowBaseOrigin;
				ghostArrow.position.set(
					base.x + dir.x * (phase-0.2) * 30,
					base.y + dir.y * (phase-0.2) * 30,
					base.z + dir.z * (phase-0.2) * 30
				);
				// Apply fade over 3 seconds since last snap
				const t = Math.max(0, Math.min(1, (Date.now() - ghostArrowFadeStartTime) / ghostArrowFadeDurationMs));
				const alpha = 1 - t;
				if (ghostArrow.material) {
					ghostArrow.material.transparent = true;
					ghostArrow.material.opacity = alpha;
				}
			}
		}
		
		if (studHighlightMesh && studHighlightMesh.visible) {
			const time = Date.now() * 0.003;
			const scale = 1 + Math.sin(time) * 0.07;
			studHighlightMesh.scale.set(scale, scale, scale);
			studHighlightMesh.rotation.y = time * 0.5;
		}
		
		// Render preview
		if (previewEnabled) renderPreview();
		if (localPlayer && localPlayer.position) {
			const eyeHeight = 30;
			const playerEye = new THREE.Vector3(localPlayer.position.x, localPlayer.position.y + eyeHeight, localPlayer.position.z);
			if (isThirdPerson) {
				const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
				const desiredPos = playerEye.clone().add(dir.multiplyScalar(-160));
				desiredPos.y += 30;
				camera.position.copy(desiredPos);
				camera.lookAt(playerEye);
			} else {
				camera.position.copy(playerEye);
				const lookDirection = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
				const lookTarget = camera.position.clone().add(lookDirection);
				camera.lookAt(lookTarget);
			}
			// Local player mesh visibility in third-person
			for (const [pid, mesh] of playerMeshes) {
				if (localPlayer.id && pid === localPlayer.id) {
					mesh.visible = !!isThirdPerson;
					mesh.position.set(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z);
					mesh.rotation.set(0, yaw, 0);
				}
			}
			// Keep name sprites above the player heads and facing the camera
			for (const [pid, sprite] of playerNameSprites) {
				const playerMesh = playerMeshes.get(pid);
				if (playerMesh) {
					const baseY = (playerMesh.position.y || 0);
					sprite.position.set(playerMesh.position.x, baseY + 65, playerMesh.position.z);
					if (camera && sprite.quaternion) sprite.quaternion.copy(camera.quaternion);
					// Hide local player's label in first-person view
					sprite.visible = !(localPlayer && localPlayer.id === pid && !isThirdPerson);
				}
			}
		}
		// Keep the sun light following the camera so shadow coverage tracks the player
		if (sunLightRef && camera) {
			// Position the sun relative to camera to maintain coverage
			const lightDir = new THREE.Vector3(-0.6, -1.0, -0.4).normalize();
			const lightDistance = 600; // move light back along direction
			// Place light some distance opposite the lightDir from the camera
			const lightPos = camera.position.clone().sub(lightDir.clone().multiplyScalar(lightDistance)).add(new THREE.Vector3(0, 200, 0));
			sunLightRef.position.copy(lightPos);
			// Aim toward camera position (or slightly ahead) to ensure target in view
			const targetPos = camera.position.clone();
			if (sunLightRef.target) {
				sunLightRef.target.position.copy(targetPos);
				sunLightRef.target.updateMatrixWorld();
			}
			// Optionally, expand shadow camera frustum a bit if render distance increased
			if (sunLightRef.shadow && sunLightRef.shadow.camera) {
				const cam = sunLightRef.shadow.camera;
				// Keep orthographic bounds large enough to cover chunks around the player
				const orthoSize = 900; // matches/extends lighting.js defaults
				if (cam.left !== -orthoSize) {
					cam.left = -orthoSize;
					cam.right = orthoSize;
					cam.top = orthoSize;
					cam.bottom = -orthoSize;
					cam.near = 1;
					cam.far = Math.max(1500, (RENDER_DISTANCE | 0));
					cam.updateProjectionMatrix();
				}
			}
		}
		// Per-chunk frustum culling (main camera + shadow cameras) and LOD
		if (camera && chunkGroups && chunkGroups.size > 0) {
			_projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			_mainFrustum.setFromProjectionMatrix(_projScreenMatrix);
			// Compute per-chunk visibility; main view culling happens via mesh onBeforeRender
			for (const group of chunkGroups.values()) {
				if (!group) continue;
				// Ensure groups remain visible so shadow rendering can traverse them
				group.visible = true;
				const ud = group.userData || {};
				// Distance-based chunk culling using chunk centroid vs render distance
				if (CHUNK_SIZE != null && CHUNK_HEIGHT != null && Number.isFinite(RENDER_DISTANCE)) {
					const centroidX = group.position.x + (CHUNK_SIZE * 0.5);
					const centroidY = group.position.y + (CHUNK_HEIGHT * 0.5);
					const centroidZ = group.position.z + (CHUNK_SIZE * 0.5);
					_tempVec3.set(centroidX, centroidY, centroidZ);
					const distToCentroid = _tempVec3.distanceTo(camera.position);
					if (distToCentroid > RENDER_DISTANCE) {
						group.visible = false; // fully cull when beyond far render distance
						ud.inMainFrustum = false;
						continue;
					}
				}
				if (!ud.chunkBounds || ud.boundsDirty) {
					recomputeGroupBounds(group);
				}
				const box = ud.chunkBounds;
				if (!box || !isFinite(box.min.x) || !isFinite(box.max.x)) { continue; }
				const inMain = _mainFrustum.intersectsBox(box);
				ud.inMainFrustum = !!inMain;
				// LOD selection per chunk (distance-based)
				const center = box.getCenter(_tempVec3);
				const camPos = camera.position;
				const dist = center.distanceTo(camPos);
				const desiredLod = (dist > LOD_DISTANCE) ? 1 : 0; // 0=high,1=low
				if (ud.lod !== desiredLod) {
					ud.lod = desiredLod;
					// LOD selection for baked meshes: ensure low exists; build high on demand
					const rec = chunkMeshData.get(group.userData && group.userData.chunkKey);
					if (rec) {
						if (ud.lod === 0) {
							// Need high detail nearby
							if (!rec.high || !rec.high.mesh) {
								// Build high now from full-detail geoms
								const gameState = getGameStateRef ? getGameStateRef() : null;
								const chunkKey = group.userData && group.userData.chunkKey;
								const chunk = gameState && gameState.chunks ? gameState.chunks[chunkKey] : null;
								const bricksObj = chunk && chunk.bricks ? chunk.bricks : null;
								const bricks = [];
								if (bricksObj) {
									for (const [bid, b] of Object.entries(bricksObj)) {
										if (!b || !b.pieceId) continue;
										bricks.push({ id: bid, pieceId: b.pieceId, colorIndex: b.colorIndex | 0, position: b.position, rotation: b.rotation });
									}
								}
								const builtHigh = buildBakedGeometryForChunk(chunkKey, bricks, { useConvex: false });
								if (builtHigh) {
									const material = ensureBakedMaterial();
									const highMesh = new THREE.Mesh(builtHigh.geometry, material);
									highMesh.castShadow = true;
									highMesh.receiveShadow = true;
									highMesh.userData = highMesh.userData || {};
									highMesh.userData.chunkKey = chunkKey;
									highMesh.userData.brickIndexToBrickId = builtHigh.brickIndexToBrickId;
									replaceChunkMesh(chunkKey, highMesh, 'high');
									rec.high = { mesh: highMesh, geom: builtHigh.geometry, map: builtHigh.brickIndexToBrickId };
								}
							}
						}
						// Toggle visibility by desired LOD
						if (rec.low && rec.low.mesh) rec.low.mesh.visible = (ud.lod !== 0);
						if (rec.high && rec.high.mesh) rec.high.mesh.visible = (ud.lod === 0);
					}
				}
				// Layers are not toggled per-frame; onBeforeRender of meshes handles main-view culling only
			}
		}

		// Render
		if (renderer && renderer.backend && renderer.backend.device) {
			renderer.render(scene, camera);
		} else if (renderer) {
			void renderer.renderAsync(scene, camera);
		}
		// Update stats
		if (renderer && renderer.info) {
			lastDrawCalls = renderer.info.render.calls | 0;
			lastTriangles = renderer.info.render.triangles | 0;
		}
	}

    // moved to labels.js
    function createOrUpdateNameSprite(playerData) {
        updateNameSpriteExternal(playerData, playerNameSprites, scene);
    }

	return {
		async init() {
			try {
				// Enable BVH accelerated raycasting globally
				THREE.Mesh.prototype.raycast = acceleratedRaycast;
				THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
				THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
				scene = new THREE.Scene();
				scene.background = new THREE.Color(0x0cbeff);
                
				const { el, width, height } = getContainerSize();
				camera = new THREE.PerspectiveCamera(75, width / height, 0.5, RENDER_DISTANCE);
				camera.position.set(0, 50, 0);
				camera.lookAt(0, 50, -1);
				renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: "high-performance" });
				renderer.setSize(width, height);
				renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
				renderer.outputColorSpace = THREE.SRGBColorSpace;
				renderer.toneMapping = THREE.NoToneMapping;
				renderer.toneMappingExposure = 1.0;
				renderer.shadowMap.enabled = true;
				renderer.shadowMap.type = THREE.PCFSoftShadowMap;
				if (renderer.info) {
					renderer.info.autoReset = true;
				}
				(el || document.body).appendChild(renderer.domElement);
				// WebGPU requires async init
				await renderer.init();
				if (renderer.domElement && renderer.domElement.style) {
					renderer.domElement.style.contain = 'layout paint';
					renderer.domElement.style.touchAction = 'none';
				}
				// Lighting
				const lights = setupPBRLighting(scene) || {};
				sunLightRef = lights.sunLight || scene.getObjectByName('SunLight') || null;
				setupEquirectangularSkybox();
				gltfLoader = new GLTFLoader();
				ensureStudHighlight();
				console.time('[BrickQuest] loadBrickModelInternal');
				await loadBrickModelInternal();
				console.timeEnd('[BrickQuest] loadBrickModelInternal');
				setLoading("");
			} catch (e) {
				onError(e);
				throw e;
			}
		},
		dispose() {
			if (renderer) renderer.dispose();
			if (previewRenderer) previewRenderer.dispose();
			if (ghostMeshAdditive) {
				scene.remove(ghostMeshAdditive);
				disposeObject(ghostMeshAdditive);
				ghostMeshAdditive = null;
			}
			if (ghostArrow) {
				scene.remove(ghostArrow);
				disposeObject(ghostArrow);
				ghostArrow = null;
			}
			// Clean up instanced meshes
			disposeAllInstancedMeshes();
			playerMeshes.forEach((mesh) => {
				scene.remove(mesh);
				if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
				if (mesh.material && mesh.material.dispose) mesh.material.dispose();
			});
			// Dispose skybox
			if (skyboxMesh) {
				scene.remove(skyboxMesh);
				try {
					if (skyboxMesh.material) {
						if (skyboxMesh.material.map && skyboxMesh.material.map.dispose) skyboxMesh.material.map.dispose();
						skyboxMesh.material.dispose && skyboxMesh.material.dispose();
					}
					if (skyboxMesh.geometry && skyboxMesh.geometry.dispose) skyboxMesh.geometry.dispose();
				} catch (_) {}
				skyboxMesh = null;
			}
		},
		onResize: onWindowResize,
		// Data/config
		setGameStateProvider(fn) { getGameStateRef = fn; },
		setData({ pieceList: pl, piecesData: pd }) { pieceList = pl || []; piecesData = pd || {}; },
		setChunkConfig,
		setChunkDebugVisible,
		reconcileChunksAndBricks,
		removeChunkGroupAndInstances,
		setSelectedPieceIndex(i) { selectedPieceIndex = Math.max(0, Math.min(pieceList.length - 1, i | 0)); ensureGhostMesh(true); updatePreviewMesh(); },
		setSelectedColorIndex(i) { selectedColorIndex = Math.max(0, Math.min((colorPalette.length || 1) - 1, i | 0)); updatePreviewMesh(); },
		setGhostYaw(y) { ghostYaw = y || 0; ensureGhostMesh(false); },
		getGhostRotationEuler() { return { ...ghostRotationEuler }; },
		getGhostTargetPos() { return ghostTargetPos ? { ...ghostTargetPos } : null; },
		getGhostPieceId() { return ghostPieceId; },
		setGhostCollisionVisual,
		applyAuthoritativeGhostPose,
		setSelectedAntiStudIndex(i) { selectedAntiStudIndex = Math.max(0, i | 0); ensureGhostMesh(false); },
		setSelectedStudIndex(i) { selectedStudIndex = Math.max(0, i | 0); ensureGhostMesh(false); },
		setAnchorMode(m) { selectedAnchorMode = (m === 'stud') ? 'stud' : 'anti'; ensureGhostMesh(false); },
		// Simple render stats for HUD
		getRenderStats() { return { drawCalls: lastDrawCalls | 0, triangles: lastTriangles | 0, gpuMs: lastGpuMs || 0 }; },
		// Picking
		getMouseWorldPosition,
		getPickedBrickId() { return (lastRayHitValid && lastHitBrickId) ? lastHitBrickId : null; },
		getClosestStudInfo() { return (lastRayHitValid && closestStudInfo) ? {
			position: { x: closestStudInfo.position.x, y: closestStudInfo.position.y, z: closestStudInfo.position.z },
			brickId: closestStudInfo.brickId,
			direction: closestStudInfo.direction ? { x: closestStudInfo.direction.x, y: closestStudInfo.direction.y, z: closestStudInfo.direction.z } : undefined,
		} : null; },
		getClosestAntiStudInfo() { return (lastRayHitValid && closestAntiStudInfo) ? {
			position: { x: closestAntiStudInfo.position.x, y: closestAntiStudInfo.position.y, z: closestAntiStudInfo.position.z },
			brickId: closestAntiStudInfo.brickId,
			direction: closestAntiStudInfo.direction ? { x: closestAntiStudInfo.direction.x, y: closestAntiStudInfo.direction.y, z: closestAntiStudInfo.direction.z } : undefined,
		} : null; },
		canPlaceNow() {
			if (!lastRayHitValid) return false;
			const selectedPieceLocal = pieceList[selectedPieceIndex];
			const selectedPieceIdLocal = selectedPieceLocal ? selectedPieceLocal.id : null;
			const pieceDataLocal = selectedPieceIdLocal ? piecesData[selectedPieceIdLocal] : null;
			const hasStuds = !!(pieceDataLocal && Array.isArray(pieceDataLocal.studs) && pieceDataLocal.studs.length > 0);
			const hasAnti = !!(pieceDataLocal && Array.isArray(pieceDataLocal.antiStuds) && pieceDataLocal.antiStuds.length > 0);
			if (selectedAnchorMode === 'anti' && hasAnti) {
				return !!closestStudInfo;
			}
			if (selectedAnchorMode === 'stud' && hasStuds) {
				return !!closestAntiStudInfo;
			}
			// Fallback for parts with no connectors: allow server grid-snap
			return !!(ghostTargetPos || lastMouseWorldPos);
		},
		// Mesh management
		createBrickMesh,
		removeBrickMesh,
		removeBrickInChunk,
		createPlayerMesh,
		updatePlayerMesh,
		removePlayerMesh,
		resetAllMeshes,
		// Render
		renderTick,
		// Preview
		setupPreview,
		// Preview sharing and helpers for external thumbnail rendering
		getPreviewRenderer() { return previewRenderer; },
		getGeometryForPieceId(id) { return id != null ? brickGeometries.get(String(id)) || null : null; },
		getBrickMaterials() { return brickMaterials || []; },
		setPreviewEnabled(v) { previewEnabled = !!v; },
	};
}


