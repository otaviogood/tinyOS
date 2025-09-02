// @ts-nocheck
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";
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
	let composer = null;
	let gltfLoader = null;

	// Post-processing feature flags
	let smaaPassRef = null;
	let gammaPassRef = null;
	let outputPassRef = null;

	// Lighting references
	let sunLightRef = null;

	// Preview scene objects
	let previewScene = null;
	let previewCamera = null;
	let previewRenderer = null;
	let previewContainer = null;
	let previewComposer = null;

	// Last render stats (aggregated across composer passes per frame)
	let lastDrawCalls = 0;
	let lastTriangles = 0;
	let lastGpuMs = 0;
	let glCtx = null;
	let gpuTimerExt = null;
	const gpuQueries = [];

	// Resources
	let brickMaterials = null; // array of MeshStandardMaterial
	const brickGeometries = new Map(); // pieceId -> BufferGeometry
	const collisionGeometries = new Map(); // pieceId -> BufferGeometry (nostuds)
	const convexGeometries = new Map(); // pieceId -> BufferGeometry (convex LOD)

	// Instancing resources
	const instancedChunkData = new Map(); // chunkKey -> { pieceId -> InstancedMeshData }
	const brickIdToInstanceRef = new Map(); // brickId -> { mesh, index, chunkKey, pieceId }
	let instancedBrickMaterial = null;

	// Bulk reconcile batching flags/collections
	let bulkReconcileActive = false;
	const _meshesNeedingUpdate = new Set();
	const _groupsNeedingBounds = new Set();

	/**
	 * Ensure an InstancedMesh exists for the given chunkKey and pieceId.
	 * Returns an InstancedMeshData record { mesh, capacity, count, instanceIdToBrickId: [], chunkKey, pieceId }.
	 */
	function ensureInstancedMesh(chunkKey, pieceId, parentGroup, initialCapacityHint) {
		let chunkMap = instancedChunkData.get(chunkKey);
		if (!chunkMap) { chunkMap = new Map(); instancedChunkData.set(chunkKey, chunkMap); }
		let data = chunkMap.get(pieceId);
		if (data && data.mesh) {
			if (Number.isFinite(initialCapacityHint) && (initialCapacityHint | 0) > (data.capacity | 0)) {
				// Grow to at least the hinted capacity
				data = growInstancedMeshToAtLeast(data, parentGroup, initialCapacityHint | 0);
			}
			return data;
		}
		let geometry = brickGeometries.get(pieceId) || (brickGeometries.size > 0 ? brickGeometries.values().next().value : null);
		// Choose LOD geometry based on parent group's LOD hint (0=high, 1=low)
		const useLow = !!(parentGroup && parentGroup.userData && parentGroup.userData.lod === 1);
		if (useLow) {
			const lowGeom = convexGeometries.get(pieceId);
			if (lowGeom) geometry = lowGeom;
		}
		if (!geometry) return null;
		const initialCapacity = Number.isFinite(initialCapacityHint) ? Math.max(4, (initialCapacityHint | 0)) : 64;
		const mesh = new THREE.InstancedMesh(geometry, instancedBrickMaterial || new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.0, envMapIntensity: 0.8 }), initialCapacity);
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		// Disable frustum culling because instance transforms extend beyond geometry bounds
		mesh.frustumCulled = false;
		// Preallocate per-instance color attribute as Float32Array to match three 0.169 expectations
		try { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(initialCapacity * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); } catch (_) {}
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		applyViewCullingHooks(mesh);
		mesh.userData = mesh.userData || {};
		mesh.userData.chunkKey = chunkKey;
		mesh.userData.pieceId = pieceId;
		mesh.userData.highGeom = brickGeometries.get(pieceId) || geometry;
		mesh.userData.lowGeom = convexGeometries.get(pieceId) || null;
		mesh.userData.instanceIdToBrickId = [];
		mesh.count = 0;
		parentGroup.add(mesh);
		// Add to raycast list once
		raycastTargets.push(mesh);
		data = { mesh, capacity: initialCapacity, count: 0, chunkKey, pieceId };
		chunkMap.set(pieceId, data);
		return data;
	}

	function growInstancedMeshToAtLeast(data, parentGroup, minCapacity) {
		let d = data;
		while (d && (d.capacity | 0) < (minCapacity | 0)) {
			d = growInstancedMesh(d, parentGroup);
		}
		return d;
	}

	function growInstancedMesh(data, parentGroup) {
		const oldMesh = data.mesh;
		const newCapacity = Math.max(4, (data.capacity * 2) | 0);
		const geometry = oldMesh.geometry;
		const material = oldMesh.material;
		const newMesh = new THREE.InstancedMesh(geometry, material, newCapacity);
		newMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		newMesh.frustumCulled = false;
		try { newMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(newCapacity * 3), 3); newMesh.instanceColor.setUsage(THREE.DynamicDrawUsage); } catch (_) {}
		newMesh.castShadow = true;
		newMesh.receiveShadow = true;
		applyViewCullingHooks(newMesh);
		newMesh.userData = newMesh.userData || {};
		newMesh.userData.chunkKey = data.chunkKey;
		newMesh.userData.pieceId = data.pieceId;
		newMesh.userData.instanceIdToBrickId = [];
		// Copy existing instances
		for (let i = 0; i < data.count; i++) {
			oldMesh.getMatrixAt(i, _tempMatrix4);
			newMesh.setMatrixAt(i, _tempMatrix4);
			{
				const src = oldMesh.instanceColor;
				const dst = newMesh.instanceColor;
				if (src && dst) {
					dst.setXYZ(i, src.getX(i), src.getY(i), src.getZ(i));
				}
			}
			newMesh.userData.instanceIdToBrickId[i] = oldMesh.userData.instanceIdToBrickId[i];
		}
		newMesh.count = data.count;
		if (newMesh.instanceColor) newMesh.instanceColor.needsUpdate = true;
		// Replace in scene
		if (oldMesh.parent) oldMesh.parent.add(newMesh);
		if (oldMesh.parent) oldMesh.parent.remove(oldMesh);
		// Update raycastTargets array
		const idx = raycastTargets.indexOf(oldMesh);
		if (idx !== -1) raycastTargets[idx] = newMesh;
		// Update instance refs pointing at old mesh
		for (const [brickId, ref] of brickIdToInstanceRef.entries()) {
			if (ref.mesh === oldMesh) {
				ref.mesh = newMesh;
			}
		}
		// Dispose old mesh
		try { oldMesh.dispose(); } catch (_) {}
		data.mesh = newMesh;
		data.capacity = newCapacity;
		return data;
	}

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

	function applyViewCullingHooks(instancedMesh) {
		// Per-camera skip draw: for main view, skip when parent chunk is outside view frustum
		instancedMesh.onBeforeRender = function(_renderer, _scene, _cam) {
			try {
				const parent = instancedMesh.parent;
				if (_cam === camera && parent && parent.userData && parent.userData.inMainFrustum === false) {
					if (instancedMesh.userData._savedCount == null) instancedMesh.userData._savedCount = instancedMesh.count;
					instancedMesh.count = 0;
				}
			} catch (_) {}
		};
		instancedMesh.onAfterRender = function(_renderer, _scene, _cam) {
			try {
				if (_cam === camera && instancedMesh.userData && instancedMesh.userData._savedCount != null) {
					instancedMesh.count = instancedMesh.userData._savedCount;
					instancedMesh.userData._savedCount = null;
				}
			} catch (_) {}
		};
	}

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

	function expandGroupBoundsForInstance(group, geometry, instanceMatrixLocal, origin) {
		if (!geometry) return;
		if (!geometry.boundingBox) geometry.computeBoundingBox();
		if (!geometry.boundingBox) return;
		initGroupBounds(group);
		_tempBox3.copy(geometry.boundingBox);
		_tempBox3.applyMatrix4(instanceMatrixLocal);
		_tempVec3.set(origin.x || 0, origin.y || 0, origin.z || 0);
		_tempBox3.min.add(_tempVec3);
		_tempBox3.max.add(_tempVec3);
		group.userData.chunkBounds.union(_tempBox3);
	}

	function recomputeGroupBounds(group) {
		initGroupBounds(group);
		const bounds = group.userData.chunkBounds;
		bounds.min.set(Infinity, Infinity, Infinity);
		bounds.max.set(-Infinity, -Infinity, -Infinity);
		const origin = group.position || new THREE.Vector3();
		for (const child of group.children) {
			if (child.isInstancedMesh) {
				const geom = child.geometry;
				if (!geom) continue;
				if (!geom.boundingBox) {
					try { geom.computeBoundingBox(); } catch (_) {}
				}
				if (!geom.boundingBox) continue;
				for (let i = 0; i < child.count; i++) {
					child.getMatrixAt(i, _tempMatrix4);
					_tempBox3.copy(geom.boundingBox);
					_tempBox3.applyMatrix4(_tempMatrix4);
					_tempBox3.min.add(origin);
					_tempBox3.max.add(origin);
					bounds.union(_tempBox3);
				}
			}
		}
		group.userData.boundsDirty = false;
	}

	function addBrickInstance(brick) {
		if (!brick.chunkKey || CHUNK_SIZE == null) return;
		const parts = String(brick.chunkKey).split(',');
		const cx = parseInt(parts[0] || '0', 10) | 0;
		const cy = parseInt(parts[1] || '0', 10) | 0;
		const cz = parseInt(parts[2] || '0', 10) | 0;
		const parent = ensureChunkGroup(cx, cy, cz);
		const origin = getChunkOriginFromKey(brick.chunkKey);
		const pieceId = brick.pieceId || "3022";
		let data = ensureInstancedMesh(brick.chunkKey, pieceId, parent);
		if (!data) return;
		if (data.count >= data.capacity) data = growInstancedMesh(data, parent);
		const mesh = data.mesh;
		const index = data.count;
		// Compose matrix with slight random rotation
		_tempPosition.set(
			brick.position.x - origin.x,
			brick.position.y - origin.y,
			brick.position.z - origin.z
		);
		const randomRotationRange = (Math.PI / 180) * 0.125;
		const randomX = (Math.random() - 0.5) * 2 * randomRotationRange;
		const randomY = (Math.random() - 0.5) * 2 * randomRotationRange;
		const randomZ = (Math.random() - 0.5) * 2 * randomRotationRange;
		_tempQuaternion.setFromEuler(new THREE.Euler(
			(brick.rotation.x || 0) + randomX,
			(brick.rotation.y || 0) + randomY,
			(brick.rotation.z || 0) + randomZ
		));
		_tempMatrix4.compose(_tempPosition, _tempQuaternion, _tempScale);
		mesh.setMatrixAt(index, _tempMatrix4);
		// Expand this chunk group's world-space bounds
		if (bulkReconcileActive) {
			if (parent && parent.userData) parent.userData.boundsDirty = true;
			_groupsNeedingBounds.add(parent);
		} else {
			expandGroupBoundsForInstance(parent, (mesh.userData && mesh.userData.highGeom) ? mesh.userData.highGeom : mesh.geometry, _tempMatrix4, origin);
		}
		// Per-instance color
		const matColor = brickMaterials && brickMaterials[brick.colorIndex] ? brickMaterials[brick.colorIndex].color : (brickMaterials && brickMaterials[0] ? brickMaterials[0].color : null);
		if (matColor) {
			_tempColor.copy(matColor);
			if (mesh.instanceColor) {
				mesh.instanceColor.setXYZ(index,
					THREE.MathUtils.clamp(_tempColor.r, 0, 1),
					THREE.MathUtils.clamp(_tempColor.g, 0, 1),
					THREE.MathUtils.clamp(_tempColor.b, 0, 1)
				);
			}
		}
		data.count = index + 1;
		mesh.count = data.count;
		if (bulkReconcileActive) {
			_meshesNeedingUpdate.add(mesh);
		} else {
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
			// Also update the geometry's bounding sphere if missing
			if (mesh.geometry && (!mesh.geometry.boundingSphere || mesh.geometry.boundingSphere.radius === 0)) {
				mesh.geometry.computeBoundingSphere();
			}
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		}
		mesh.userData.instanceIdToBrickId[index] = brick.id;
		brickIdToInstanceRef.set(brick.id, { mesh, index, chunkKey: brick.chunkKey, pieceId });
	}

	// Fast path for bulk adds when parent group and origin are already known
	function addBrickInstanceFast(parent, origin, chunkKey, brick) {
		if (!parent || !origin || !chunkKey || CHUNK_SIZE == null) return;
		const pieceId = brick.pieceId || "3022";
		let data = ensureInstancedMesh(chunkKey, pieceId, parent);
		if (!data) return;
		if (data.count >= data.capacity) data = growInstancedMesh(data, parent);
		const mesh = data.mesh;
		const index = data.count;
		_tempPosition.set(
			brick.position.x - origin.x,
			brick.position.y - origin.y,
			brick.position.z - origin.z
		);
		const randomRotationRange = (Math.PI / 180) * 0.125;
		const randomX = (Math.random() - 0.5) * 2 * randomRotationRange;
		const randomY = (Math.random() - 0.5) * 2 * randomRotationRange;
		const randomZ = (Math.random() - 0.5) * 2 * randomRotationRange;
		_tempQuaternion.setFromEuler(new THREE.Euler(
			(brick.rotation && brick.rotation.x || 0) + randomX,
			(brick.rotation && brick.rotation.y || 0) + randomY,
			(brick.rotation && brick.rotation.z || 0) + randomZ
		));
		_tempMatrix4.compose(_tempPosition, _tempQuaternion, _tempScale);
		mesh.setMatrixAt(index, _tempMatrix4);
		if (bulkReconcileActive) {
			if (parent && parent.userData) parent.userData.boundsDirty = true;
			_groupsNeedingBounds.add(parent);
		} else {
			expandGroupBoundsForInstance(parent, (mesh.userData && mesh.userData.highGeom) ? mesh.userData.highGeom : mesh.geometry, _tempMatrix4, origin);
		}
		const matColor = brickMaterials && brickMaterials[brick.colorIndex] ? brickMaterials[brick.colorIndex].color : (brickMaterials && brickMaterials[0] ? brickMaterials[0].color : null);
		if (matColor) {
			_tempColor.copy(matColor);
			if (mesh.instanceColor) {
				mesh.instanceColor.setXYZ(index,
					THREE.MathUtils.clamp(_tempColor.r, 0, 1),
					THREE.MathUtils.clamp(_tempColor.g, 0, 1),
					THREE.MathUtils.clamp(_tempColor.b, 0, 1)
				);
			}
		}
		data.count = index + 1;
		mesh.count = data.count;
		if (bulkReconcileActive) {
			_meshesNeedingUpdate.add(mesh);
		} else {
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
			if (mesh.geometry && (!mesh.geometry.boundingSphere || mesh.geometry.boundingSphere.radius === 0)) {
				mesh.geometry.computeBoundingSphere();
			}
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		}
		mesh.userData.instanceIdToBrickId[index] = brick.id;
		brickIdToInstanceRef.set(brick.id, { mesh, index, chunkKey, pieceId });
	}

	function removeBrickInstance(brickId) {
		const ref = brickIdToInstanceRef.get(brickId);
		if (!ref) return false;
		const mesh = ref.mesh;
		const lastIndex = mesh.count - 1;
		const removeIndex = ref.index;
		if (removeIndex < 0 || lastIndex < 0) {
			brickIdToInstanceRef.delete(brickId);
			return true;
		}
		if (removeIndex !== lastIndex) {
			// Move last into removed slot
			mesh.getMatrixAt(lastIndex, _tempMatrix4);
			mesh.setMatrixAt(removeIndex, _tempMatrix4);
			if (mesh.instanceColor) {
				mesh.instanceColor.setXYZ(removeIndex, mesh.instanceColor.getX(lastIndex), mesh.instanceColor.getY(lastIndex), mesh.instanceColor.getZ(lastIndex));
			}
			const movedBrickId = mesh.userData.instanceIdToBrickId[lastIndex];
			mesh.userData.instanceIdToBrickId[removeIndex] = movedBrickId;
			const movedRef = brickIdToInstanceRef.get(movedBrickId);
			if (movedRef) movedRef.index = removeIndex;
		}
		// Clear last
		const data = (function(){
			const chunkKey = mesh && mesh.userData && mesh.userData.chunkKey;
			const pieceId = mesh && mesh.userData && mesh.userData.pieceId;
			if (!chunkKey || !pieceId) return null;
			const chunkMap = instancedChunkData.get(chunkKey);
			return chunkMap ? chunkMap.get(pieceId) : null;
		})();
		if (data) data.count = lastIndex;
		mesh.count = lastIndex;
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
		if (mesh.geometry && (!mesh.geometry.boundingSphere || mesh.geometry.boundingSphere.radius === 0)) {
			mesh.geometry.computeBoundingSphere();
		}
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.userData.instanceIdToBrickId[lastIndex] = undefined;
		brickIdToInstanceRef.delete(brickId);
		// Mark parent group bounds as dirty (safe but infrequent path)
		if (mesh.parent && mesh.parent.userData) {
			mesh.parent.userData.boundsDirty = true;
		}
		// If this InstancedMesh is now empty, remove and prune
		if (mesh.count <= 0) {
			const parent = mesh.parent;
			if (parent) parent.remove(mesh);
			const idx = raycastTargets.indexOf(mesh);
			if (idx !== -1) raycastTargets.splice(idx, 1);
			try { mesh.dispose(); } catch (_) {}
			// Remove from instancedChunkData map
			const chunkKey = mesh.userData && mesh.userData.chunkKey;
			const pieceId = mesh.userData && mesh.userData.pieceId;
			if (chunkKey && instancedChunkData.has(chunkKey)) {
				const chunkMap = instancedChunkData.get(chunkKey);
				if (chunkMap) {
					chunkMap.delete(pieceId);
					if (chunkMap.size === 0) instancedChunkData.delete(chunkKey);
				}
			}
			// If parent chunk group is empty, prune it
			if (parent && parent.userData && parent.userData.chunkKey) {
				let hasAnyMesh = false;
				for (const child of parent.children) {
					if (child.isMesh) { hasAnyMesh = true; break; }
				}
				if (!hasAnyMesh) {
					scene.remove(parent);
					chunkGroups.delete(parent.userData.chunkKey);
				}
			}
		}
		return true;
	}

	function disposeAllInstancedMeshes() {
		for (const [chunkKey, chunkMap] of instancedChunkData.entries()) {
			for (const [pieceId, data] of chunkMap.entries()) {
				if (data && data.mesh && data.mesh.parent) {
					data.mesh.parent.remove(data.mesh);
				}
				const idx = raycastTargets.indexOf(data.mesh);
				if (idx !== -1) raycastTargets.splice(idx, 1);
				try { data.mesh.dispose(); } catch (_) {}
			}
		}
		instancedChunkData.clear();
		brickIdToInstanceRef.clear();
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

	function setupPostProcessing() {
		composer = new EffectComposer(renderer);
		const renderPass = new RenderPass(scene, camera);
		composer.addPass(renderPass);
		smaaPassRef = new SMAAPass(container.clientWidth, container.clientHeight);
		// composer.addPass(smaaPassRef);
		gammaPassRef = new ShaderPass(GammaCorrectionShader);
		composer.addPass(gammaPassRef);
		outputPassRef = new OutputPass();
		composer.addPass(outputPassRef);
	}

	function setupBrickMaterials() {
		const colors = colorPalette.map((hex) => new THREE.Color(hex).convertSRGBToLinear());
		brickMaterials = colors.map((color) => new THREE.MeshStandardMaterial({
			color,
			roughness: 0.2,
			envMapIntensity: 0.8,
		}));
		// Create a single instanced material that supports per-instance colors
		if (!instancedBrickMaterial) {
			instancedBrickMaterial = new THREE.MeshStandardMaterial({
				roughness: 0.2,
				envMapIntensity: 0.8,
				color: 0xffffff,
			});
		}
	}

	function ensureStudHighlight() {
		if (studHighlightMesh) return;
		const geometry = new THREE.CylinderGeometry(6.5, 6.5, 4, 16);
		const material = new THREE.MeshBasicMaterial({
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
		ghostMaterial = new THREE.MeshStandardMaterial({
			color: 0x00ffc8,
			transparent: true,
			blending: THREE.NormalBlending,
			opacity: 0.95,
			depthWrite: true,
			roughness: 0.3,
			metalness: 0.0,
		});
		ghostMaterial.shadowSide = null;
		// Secondary very-dim additive pass to show through occluders
		if (!ghostMaterialAdditive) {
			ghostMaterialAdditive = new THREE.MeshStandardMaterial({
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
		previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
		previewCamera.position.set(100, 80, 100);
		previewCamera.lookAt(0, 0, 0);
		
		// Create preview renderer
		previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		previewRenderer.setSize(150, 150);
		previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
		previewRenderer.shadowMap.enabled = true;
		previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
		previewRenderer.setClearColor(0x000000, 0); // Transparent clear color
		
		previewContainer.appendChild(previewRenderer.domElement);
		
		// Setup preview post-processing with gamma correction
		previewComposer = new EffectComposer(previewRenderer);
		const previewRenderPass = new RenderPass(previewScene, previewCamera);
		previewComposer.addPass(previewRenderPass);
		const previewGammaCorrectionPass = new ShaderPass(GammaCorrectionShader);
		previewComposer.addPass(previewGammaCorrectionPass);
		const previewOutputPass = new OutputPass();
		previewComposer.addPass(previewOutputPass);
		
		// Add lighting to preview scene
		const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
		previewScene.add(ambientLight);
		
		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(50, 100, 50);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.width = 512;
		directionalLight.shadow.mapSize.height = 512;
		previewScene.add(directionalLight);
		
		// Create preview material
		previewMaterial = new THREE.MeshStandardMaterial({
			roughness: 0.2,
			envMapIntensity: 0.8,
		});
		
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
		
		// Get material for selected color
		const material = brickMaterials[selectedColorIndex] || brickMaterials[0];
		if (!material) return;
		
		// Create new preview mesh
		previewMesh = new THREE.Mesh(geometry, material);
		previewMesh.castShadow = true;
		previewMesh.receiveShadow = true;
		
		// Center the piece (optional - adjust based on piece dimensions)
		geometry.computeBoundingBox();
		if (geometry.boundingBox) {
			const center = geometry.boundingBox.getCenter(new THREE.Vector3());
			previewMesh.position.set(-center.x, -center.y, -center.z);
		}
		
		previewScene.add(previewMesh);
	}

	function renderPreview() {
		if (!previewComposer || !previewMesh) return;
		
		// Rotate the preview mesh
		previewMesh.rotation.y += previewRotationSpeed;
		
		// Render the preview with gamma correction
		previewComposer.render();
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
				const coneMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
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
		if (firstIntersection && firstIntersection.instanceId != null && firstIntersection.object && firstIntersection.object.userData && Array.isArray(firstIntersection.object.userData.instanceIdToBrickId)) {
			targetBrickId = firstIntersection.object.userData.instanceIdToBrickId[firstIntersection.instanceId] || null;
			targetChunkKey = firstIntersection.object.userData.chunkKey || null;
		} else {
			targetBrickId = (firstIntersection && firstIntersection.object && firstIntersection.object.userData) ? firstIntersection.object.userData.brickId : null;
			targetChunkKey = (firstIntersection && firstIntersection.object && firstIntersection.object.userData) ? (firstIntersection.object.userData.chunkKey || null) : null;
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

		const legsLinear = new THREE.Color(legsColor).convertSRGBToLinear();
		const torsoLinear = new THREE.Color(torsoColor).convertSRGBToLinear();
		const headLinear = new THREE.Color(0xffd804).convertSRGBToLinear();
		const legsMaterial = new THREE.MeshStandardMaterial({ color: legsLinear, roughness: 0.35, metalness: 0.0 });
		const torsoMaterial = new THREE.MeshStandardMaterial({ color: torsoLinear, roughness: 0.35, metalness: 0.0 });
		const headMaterial = new THREE.MeshStandardMaterial({ color: headLinear, roughness: 0.35, metalness: 0.0 });
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
				// Resolve brickId for both regular meshes and instanced meshes
				if (intersection && intersection.instanceId != null && intersection.object && intersection.object.userData && Array.isArray(intersection.object.userData.instanceIdToBrickId)) {
					lastHitBrickId = intersection.object.userData.instanceIdToBrickId[intersection.instanceId] || null;
				} else {
					lastHitBrickId = (intersection && intersection.object && intersection.object.userData) ? (intersection.object.userData.brickId || null) : null;
				}
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
		// Require authoritative chunk assignment; skip otherwise
		if (!brick.chunkKey || CHUNK_SIZE == null) { return; }
		// Add to instanced mesh
		addBrickInstance(brick);
	}

	function removeBrickMesh(brickId) {
		// Try remove from instancing
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
			const hasFlat = stateBricks && typeof stateBricks === 'object' && Object.keys(stateBricks).length > 0;
			if (hasFlat) {
				// Pre-count missing bricks per (chunkKey, pieceId)
				const neededByMesh = new Map(); // key: `${chunkKey}|${pieceId}` -> count
				const chunkFastCache = new Map(); // chunkKey -> { parent, origin }
				for (const [bid, b] of Object.entries(stateBricks)) {
					if (!b || !b.chunkKey) continue;
					if (brickIdToInstanceRef.has(bid)) continue;
					const pid = b.pieceId || "3022";
					const mkey = `${b.chunkKey}|${pid}`;
					neededByMesh.set(mkey, (neededByMesh.get(mkey) || 0) + 1);
				}
				// Pre-size meshes once
				for (const [mkey, need] of neededByMesh.entries()) {
					const sep = mkey.lastIndexOf('|');
					const chunkKey = mkey.substring(0, sep);
					const pieceId = mkey.substring(sep + 1);
					const parts = String(chunkKey).split(',');
					const cx = parseInt(parts[0] || '0', 10) | 0;
					const cy = parseInt(parts[1] || '0', 10) | 0;
					const cz = parseInt(parts[2] || '0', 10) | 0;
					const parent = ensureChunkGroup(cx, cy, cz);
					if (!chunkFastCache.has(chunkKey)) {
						chunkFastCache.set(chunkKey, { parent, origin: getChunkOriginFromKey(chunkKey) });
					}
					const existing = (function(){ const cm = instancedChunkData.get(chunkKey); const d = cm ? cm.get(pieceId) : null; return d ? (d.count | 0) : 0; })();
					ensureInstancedMesh(chunkKey, pieceId, parent, existing + (need | 0));
				}
				// Add all missing bricks
				for (const [bid, b] of Object.entries(stateBricks)) {
					if (!b || !b.chunkKey) continue;
					if (brickIdToInstanceRef.has(bid)) continue;
					const cache = chunkFastCache.get(b.chunkKey);
					if (cache) {
						addBrickInstanceFast(cache.parent, cache.origin, b.chunkKey, { id: bid, ...b });
					} else {
						// Fallback if not cached (should be rare)
						createBrickMesh({ id: bid, ...b });
					}
				}
			} else if (stateBricks == null) {
				// Nested iteration path over chunks and their bricks (init only)
				for (const [ckey, c] of Object.entries(stateChunks || {})) {
					const br = (c && c.bricks) || {};
					// Count missing per pieceId
					const pieceCounts = new Map();
					for (const [bid, b] of Object.entries(br)) {
						if (brickIdToInstanceRef.has(bid)) continue;
						const pid = (b && b.pieceId) || "3022";
						pieceCounts.set(pid, (pieceCounts.get(pid) || 0) + 1);
					}
					if (pieceCounts.size > 0) {
						const parts = String(ckey).split(',');
						const cx = parseInt(parts[0] || '0', 10) | 0;
						const cy = parseInt(parts[1] || '0', 10) | 0;
						const cz = parseInt(parts[2] || '0', 10) | 0;
						const parent = ensureChunkGroup(cx, cy, cz);
						for (const [pid, count] of pieceCounts.entries()) {
							const existing = (function(){ const cm = instancedChunkData.get(ckey); const d = cm ? cm.get(pid) : null; return d ? (d.count | 0) : 0; })();
							ensureInstancedMesh(ckey, pid, parent, existing + (count | 0));
						}
						// Add bricks
						const origin = getChunkOriginFromKey(ckey);
						for (const [bid, b] of Object.entries(br)) {
							if (brickIdToInstanceRef.has(bid)) continue;
							addBrickInstanceFast(parent, origin, ckey, { id: bid, chunkKey: ckey, ...b });
						}
					}
				}
			} else {
				// Explicit empty object passed: ensure groups only (no brick creation)
			}
		} finally {
			// Flush batched GPU updates and bounds recomputation
			for (const mesh of _meshesNeedingUpdate) {
				try { mesh.instanceMatrix.needsUpdate = true; } catch (_) {}
				try { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; } catch (_) {}
				try { if (mesh.computeBoundingSphere) mesh.computeBoundingSphere(); } catch (_) {}
				try { if (mesh.geometry && (!mesh.geometry.boundingSphere || mesh.geometry.boundingSphere.radius === 0)) mesh.geometry.computeBoundingSphere(); } catch (_) {}
			}
			_meshesNeedingUpdate.clear();
			for (const group of _groupsNeedingBounds) {
				try { if (group) recomputeGroupBounds(group); } catch (_) {}
			}
			_groupsNeedingBounds.clear();
			bulkReconcileActive = false;
		}
	}

	function removeChunkGroupAndInstances(chunkKey) {
		// Remove all instanced meshes for this chunk
		const chunkMap = instancedChunkData.get(chunkKey);
		if (chunkMap) {
			for (const [pieceId, data] of chunkMap.entries()) {
				if (data && data.mesh && data.mesh.parent) {
					data.mesh.parent.remove(data.mesh);
					const idx = raycastTargets.indexOf(data.mesh);
					if (idx !== -1) raycastTargets.splice(idx, 1);
					try { data.mesh.dispose(); } catch (_) {}
				}
			}
			instancedChunkData.delete(chunkKey);
		}
		// Remove instance refs pointing to this chunk
		for (const [brickId, ref] of Array.from(brickIdToInstanceRef.entries())) {
			if (ref && ref.chunkKey === chunkKey) {
				brickIdToInstanceRef.delete(brickId);
			}
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
			const material = new THREE.MeshStandardMaterial({ color: playerData.colorLegs || 0x0e78cf, roughness: 0.7, metalness: 0.1 });
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
		if (!camera || !renderer || !container || !composer) return;
		const width = container.clientWidth;
		const height = container.clientHeight;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
		composer.setSize(width, height);
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
		if (!composer || !scene || !camera) return;
		
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
			// Keep name sprites above the player heads
			for (const [pid, sprite] of playerNameSprites) {
				const playerMesh = playerMeshes.get(pid);
				if (playerMesh) {
					const baseY = (playerMesh.position.y || 0);
					sprite.position.set(playerMesh.position.x, baseY + 65, playerMesh.position.z);
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
				// Ensure groups remain visible so shadow pass can traverse them
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
					// Swap geometries for instanced meshes under this chunk
					for (const child of group.children) {
						if (child.isInstancedMesh) {
							const pieceId = child.userData && child.userData.pieceId;
							if (!pieceId) continue;
							let targetGeom = null;
							if (desiredLod === 1) {
								targetGeom = (child.userData && child.userData.lowGeom) ? child.userData.lowGeom : (convexGeometries.get(pieceId) || brickGeometries.get(pieceId));
							} else {
								targetGeom = (child.userData && child.userData.highGeom) ? child.userData.highGeom : brickGeometries.get(pieceId);
							}
							if (targetGeom && child.geometry !== targetGeom) {
								child.geometry = targetGeom;
								// Keep bounds up to date for better culling and correctness
								if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
								if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
							}
						}
					}
				}
				// Layers are not toggled per-frame; onBeforeRender of meshes handles main-view culling only
			}
		}

		// Capture all composer passes by disabling autoReset and resetting once before render
		if (renderer && renderer.info) {
			renderer.info.autoReset = false;
			if (typeof renderer.info.reset === 'function') renderer.info.reset();
		}
		// Begin GPU timer for this frame's submitted work
		if (gpuTimerExt && glCtx) {
			const q = glCtx.createQuery();
			glCtx.beginQuery(gpuTimerExt.TIME_ELAPSED_EXT, q);
			gpuQueries.push(q);
		}
		composer.render();
		// End GPU timer query
		if (gpuTimerExt && glCtx) {
			glCtx.endQuery(gpuTimerExt.TIME_ELAPSED_EXT);
			// Poll oldest pending query (results are ready 1-3 frames later)
			if (gpuQueries.length > 0) {
				const q = gpuQueries[0];
				const available = glCtx.getQueryParameter(q, glCtx.QUERY_RESULT_AVAILABLE);
				const disjoint = glCtx.getParameter(gpuTimerExt.GPU_DISJOINT_EXT);
				if (available) {
					if (!disjoint) {
						const ns = glCtx.getQueryParameter(q, glCtx.QUERY_RESULT);
						lastGpuMs = ns / 1e6;
					}
					glCtx.deleteQuery(q);
					gpuQueries.shift();
				}
			}
		}
		// Update per-frame stats for HUD
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
                
				camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.5, RENDER_DISTANCE);
				camera.position.set(0, 50, 0);
				camera.lookAt(0, 50, -1);
				renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
				renderer.setSize(container.clientWidth, container.clientHeight);
				renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
				renderer.outputColorSpace = THREE.SRGBColorSpace;
				renderer.toneMapping = THREE.NoToneMapping;
				renderer.toneMappingExposure = 1.0;
				renderer.shadowMap.enabled = true;
				renderer.shadowMap.type = THREE.PCFSoftShadowMap;
				// Prevent per-pass auto reset so we can accumulate draw calls across EffectComposer passes
				if (renderer.info && typeof renderer.info.autoReset === 'boolean') {
					renderer.info.autoReset = false;
				}
				container.appendChild(renderer.domElement);
				// Setup GPU timing (WebGL2 timer queries)
				glCtx = renderer.getContext();
				gpuTimerExt = glCtx.getExtension('EXT_disjoint_timer_query_webgl2');
				// Hint to the browser compositor for stable fps
				if (renderer.domElement && renderer.domElement.style) {
					renderer.domElement.style.contain = 'layout paint';
					renderer.domElement.style.touchAction = 'none';
				}
				// Lighting
				const lights = setupPBRLighting(scene) || {};
				sunLightRef = lights.sunLight || scene.getObjectByName('SunLight') || null;
				setupEquirectangularSkybox();
				setupPostProcessing();
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
			if (composer) composer.dispose();
			if (previewRenderer) previewRenderer.dispose();
			if (previewComposer) previewComposer.dispose();
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
			playerNameSprites.forEach((sprite) => {
				scene.remove(sprite);
				if (sprite.material && sprite.material.map && sprite.material.map.dispose) try { sprite.material.map.dispose(); } catch (_) {}
				if (sprite.material && sprite.material.dispose) try { sprite.material.dispose(); } catch (_) {}
			});
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


