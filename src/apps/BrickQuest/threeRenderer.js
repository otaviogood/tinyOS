// @ts-nocheck
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";

export function createBrickQuestRenderer(container, options = {}) {
	const { colorPalette = [], onLoadingTextChange = () => {}, onError = () => {} } = options;

	// Core three.js objects
	let scene = null;
	let camera = null;
	let renderer = null;
	let composer = null;
	let gltfLoader = null;

	// Post-processing feature flags
	let ssaoEnabled = false;
	let ssaoDebugView = false;
	let ssaoDebugForcedEnable = false;
	let ssaoPassRef = null;
	let smaaPassRef = null;
	let gammaPassRef = null;
	let outputPassRef = null;

	// Preview scene objects
	let previewScene = null;
	let previewCamera = null;
	let previewRenderer = null;
	let previewContainer = null;
	let previewComposer = null;

	// Last render stats (aggregated across composer passes per frame)
	let lastDrawCalls = 0;
	let lastTriangles = 0;

	// Resources
	let brickMaterials = null; // array of MeshStandardMaterial
	const brickGeometries = new Map(); // pieceId -> BufferGeometry
	const collisionGeometries = new Map(); // pieceId -> BufferGeometry (nostuds)

	// Instance maps
	const playerMeshes = new Map(); // playerId -> Mesh
	const brickMeshes = new Map(); // brickId -> Mesh
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

	// Helper to dispose any Mesh(es) contained in an Object3D
	function disposeObject(object3d) {
		if (!object3d) return;
		object3d.traverse((child) => {
			if (child && child.isMesh) {
				if (child.geometry && child.geometry.dispose) try { child.geometry.dispose(); } catch (_) {}
				if (child.material) {
					const mat = child.material;
					if (Array.isArray(mat)) {
						for (const m of mat) { if (m && m.dispose) try { m.dispose(); } catch (_) {} }
					} else if (mat.dispose) {
						try { mat.dispose(); } catch (_) {}
					}
				}
			}
		});
	}

	function setLoading(text) {
		onLoadingTextChange(text || "");
	}

	function setupPBRLighting() {
		const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3e5765, 0.6);
		hemiLight.position.set(0, 50, 0);
		scene.add(hemiLight);

		const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
		sunLight.position.set(200, 300, 100);
		sunLight.castShadow = true;
		sunLight.shadow.mapSize.width = 2048;
		sunLight.shadow.mapSize.height = 2048;
		sunLight.shadow.camera.near = 1;
		sunLight.shadow.camera.far = 1500;
		sunLight.shadow.camera.left = -800;
		sunLight.shadow.camera.right = 800;
		sunLight.shadow.camera.top = 800;
		sunLight.shadow.camera.bottom = -800;
		sunLight.shadow.bias = -0.0001;
		scene.add(sunLight);
		scene.add(sunLight.target);

		const fillLight = new THREE.DirectionalLight(0x4a90e2, 0.8);
		fillLight.position.set(-100, 100, -100);
		scene.add(fillLight);

		const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
		rimLight.position.set(0, 0, -200);
		scene.add(rimLight);
	}

	function setupEquirectangularSkybox() {
		const textureLoader = new THREE.TextureLoader();
		textureLoader.load(
			'/apps/lego_sky2.png',
			function(texture) {
				// Create sphere geometry for the skybox sized near the far clip plane
				const farDistance = (camera && typeof camera.far === 'number') ? camera.far : 5000;
				const radius = Math.max(10, farDistance * 0.98);
				const skyboxGeometry = new THREE.SphereGeometry(radius, 64, 32);
				
				// Create material with the equirectangular texture
				const skyboxMaterial = new THREE.MeshBasicMaterial({
					map: texture,
					side: THREE.BackSide, // Render inside of sphere
					fog: false
				});
				
				// Create skybox mesh
				skyboxMesh = new THREE.Mesh(skyboxGeometry, skyboxMaterial);
				skyboxMesh.renderOrder = -1; // Render behind everything else
				
				// Add to scene
				scene.add(skyboxMesh);
				
				// Remove the solid background color since we now have a skybox
				scene.background = null;
			},
			function(progress) {
				// Optional: handle loading progress
				console.log('Skybox loading progress:', (progress.loaded / progress.total * 100) + '%');
			},
			function(error) {
				console.error('Error loading skybox texture:', error);
				// Fallback to original background color
				scene.background = new THREE.Color(0x0cbeff);
			}
		);
	}

	function getSSAOPass() { return ssaoPassRef; }

	function setupPostProcessing() {
		composer = new EffectComposer(renderer);
		const renderPass = new RenderPass(scene, camera);
		composer.addPass(renderPass);
		ssaoPassRef = new SSAOPass(scene, camera, container.clientWidth, container.clientHeight);
		// Tune for BrickQuest world scale (stud spacing ~20 units)
		ssaoPassRef.kernelRadius = 14;
		ssaoPassRef.minDistance = 2.0;
		ssaoPassRef.maxDistance = 80.0;
		ssaoPassRef.output = ssaoDebugView ? SSAOPass.OUTPUT.SSAO : SSAOPass.OUTPUT.Default;
		ssaoPassRef.enabled = !!ssaoEnabled;
		composer.addPass(ssaoPassRef);
		smaaPassRef = new SMAAPass(container.clientWidth, container.clientHeight);
		composer.addPass(smaaPassRef);
		gammaPassRef = new ShaderPass(GammaCorrectionShader);
		composer.addPass(gammaPassRef);
		outputPassRef = new OutputPass();
		composer.addPass(outputPassRef);
	}

	function setSSAOEnabled(enabled) {
		ssaoEnabled = !!enabled;
		if (!composer) return;
		const ssaoPass = getSSAOPass();
		if (ssaoPass) ssaoPass.enabled = ssaoEnabled;
		// Move SSAO pass to the end (before output) when enabled to maximize visual impact
		if (ssaoPass && outputPassRef && gammaPassRef) {
			const passes = composer.passes;
			// Remove existing references
			passes.splice(passes.indexOf(ssaoPass), 1);
			// Insert before gamma and output
			const gammaIdx = passes.indexOf(gammaPassRef);
			const insertIdx = gammaIdx >= 0 ? gammaIdx : passes.length - 1;
			passes.splice(insertIdx, 0, ssaoPass);
		}
	}

	function toggleSSAO() {
		setSSAOEnabled(!ssaoEnabled);
	}

	function getSSAOEnabled() {
		return !!ssaoEnabled;
	}

	function setSSAODebugView(enabled) {
		ssaoDebugView = !!enabled;
		const ssaoPass = getSSAOPass();
		if (!ssaoPass) return;
		ssaoPass.output = ssaoDebugView ? SSAOPass.OUTPUT.SSAO : SSAOPass.OUTPUT.Default;
		if (ssaoDebugView) {
			// Ensure SSAO is enabled while in debug view
			if (!ssaoEnabled) {
				ssaoDebugForcedEnable = true;
				setSSAOEnabled(true);
			}
			// Disable downstream passes that could hide the raw output
			if (gammaPassRef) gammaPassRef.enabled = false;
		} else {
			if (ssaoDebugForcedEnable) {
				// Restore previous disabled state when leaving debug if we forced it on
				ssaoDebugForcedEnable = false;
				setSSAOEnabled(false);
			}
			if (gammaPassRef) gammaPassRef.enabled = true;
		}
	}

	function toggleSSAODebugView() {
		setSSAODebugView(!ssaoDebugView);
	}

	function getSSAODebugView() {
		return !!ssaoDebugView;
	}

	async function fetchPieceIdsFromCSV() {
		try {
			const res = await fetch('/apps/bricks/exported_pieces.csv', { cache: 'no-cache' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const text = await res.text();
			const lines = text.split(/\r?\n/);
			const ids = [];
			const seen = new Set();
			for (const raw of lines) {
				if (!raw) continue;
				const line = raw.trim();
				if (!line) continue;
				const parts = line.split(',');
				if (!parts.length) continue;
				const id = (parts[0] || '').trim();
				if (!id || seen.has(id)) continue;
				ids.push(id);
				seen.add(id);
			}
			return ids;
		} catch (e) {
			console.warn('Failed to load exported_pieces.csv, falling back to minimal piece set', e);
			return [
				'3001','3002','3003','3004','3005','3008','3009','3010',
				'3020','3021','3022','3023','3024','3029','3030','3031',
				'3032','3034','3035','3460','3623','3666','3710','3795',
				'3832','4070','41539'
			];
		}
	}

	function setupBrickMaterials() {
		const colors = colorPalette.map((hex) => new THREE.Color(hex).convertSRGBToLinear());
		brickMaterials = colors.map((color) => new THREE.MeshStandardMaterial({
			color,
			roughness: 0.2,
			envMapIntensity: 0.8,
		}));
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
		if (ghostMaterial) return;
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
		ghostMaterial.color.setHex(target).convertSRGBToLinear();
		// Keep arrow color in sync with ghost piece
		if (ghostArrow) {
			if (ghostArrow.material && ghostArrow.material.color) {
				ghostArrow.material.color.copy(ghostMaterial.color);
			}
		}
		// Opacity is animated per-frame; do not override here
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
		}

		const pieceData = piecesData[selectedPieceId];
		let targetPos = null;
		let finalQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ghostYaw, 0));
		if (selectedAnchorMode === 'anti' && closestStudInfo && pieceData && Array.isArray(pieceData.antiStuds) && pieceData.antiStuds.length > 0) {
			const studDirWorld = (closestStudInfo.direction && closestStudInfo.direction.clone()) || new THREE.Vector3(0, 1, 0);
			studDirWorld.normalize();
			const targetAxis = studDirWorld.clone();
			// Choose anti-stud strictly by selectedAntiStudIndex to match server
			const antiList = pieceData.antiStuds;
			let idx = antiList.length > 0 ? ((selectedAntiStudIndex % antiList.length) + antiList.length) % antiList.length : 0;
			const usedAnti = antiList[idx] || antiList[0];
			const antiDirLocal = new THREE.Vector3(
				Number.isFinite(usedAnti.dx) ? usedAnti.dx : 0,
				Number.isFinite(usedAnti.dy) ? usedAnti.dy : 1,
				Number.isFinite(usedAnti.dz) ? usedAnti.dz : 0,
			).normalize();
			const antiDirWorld0 = antiDirLocal.clone().applyQuaternion(finalQuat).normalize();
			const alignQuat = new THREE.Quaternion().setFromUnitVectors(antiDirWorld0, targetAxis);
			finalQuat = alignQuat.clone().multiply(finalQuat);
			const antiPosLocal = new THREE.Vector3(usedAnti.x, usedAnti.y, usedAnti.z);
			const antiPosWorldOffset = antiPosLocal.clone().applyQuaternion(finalQuat);
			targetPos = {
				x: closestStudInfo.position.x - antiPosWorldOffset.x,
				y: closestStudInfo.position.y - antiPosWorldOffset.y,
				z: closestStudInfo.position.z - antiPosWorldOffset.z,
			};
		} else if (selectedAnchorMode === 'stud' && closestAntiStudInfo && pieceData && Array.isArray(pieceData.studs) && pieceData.studs.length > 0) {
			const antiDirWorld = (closestAntiStudInfo.direction && closestAntiStudInfo.direction.clone()) || new THREE.Vector3(0, 1, 0);
			antiDirWorld.normalize();
			const targetAxis = antiDirWorld.clone();
			const studList = pieceData.studs;
			let idx2 = studList.length > 0 ? ((selectedStudIndex % studList.length) + studList.length) % studList.length : 0;
			const usedStud = studList[idx2] || studList[0];
			const studDirLocal = new THREE.Vector3(
				Number.isFinite(usedStud.dx) ? usedStud.dx : 0,
				Number.isFinite(usedStud.dy) ? usedStud.dy : 1,
				Number.isFinite(usedStud.dz) ? usedStud.dz : 0,
			).normalize();
			const studDirWorld0 = studDirLocal.clone().applyQuaternion(finalQuat).normalize();
			const alignQuat2 = new THREE.Quaternion().setFromUnitVectors(studDirWorld0, targetAxis);
			finalQuat = alignQuat2.clone().multiply(finalQuat);
			const studPosLocal = new THREE.Vector3(
				Number.isFinite(usedStud.x) ? usedStud.x : 0,
				Number.isFinite(usedStud.y) ? usedStud.y : 0,
				Number.isFinite(usedStud.z) ? usedStud.z : 0,
			);
			const studPosWorldOffset = studPosLocal.clone().applyQuaternion(finalQuat);
			targetPos = {
				x: closestAntiStudInfo.position.x - studPosWorldOffset.x,
				y: closestAntiStudInfo.position.y - studPosWorldOffset.y,
				z: closestAntiStudInfo.position.z - studPosWorldOffset.z,
			};
		}
		if (targetPos) {
			// Compute arrow direction to use for drop animation and arrow helper
			let animArrowDir = null;
			let animConnectorOrigin = null;
			const pieceDataAnim = (function() {
				const selectedPieceLocal = pieceList[selectedPieceIndex];
				const selectedPieceIdLocal = selectedPieceLocal ? selectedPieceLocal.id : null;
				return selectedPieceIdLocal ? piecesData[selectedPieceIdLocal] : null;
			})();
			let useStudAnim = (selectedAnchorMode === 'stud');
			let connectorAnim = null;
			if (useStudAnim && pieceDataAnim && Array.isArray(pieceDataAnim.studs) && pieceDataAnim.studs.length > 0) {
				let idx = pieceDataAnim.studs.length > 0 ? ((selectedStudIndex % pieceDataAnim.studs.length) + pieceDataAnim.studs.length) % pieceDataAnim.studs.length : 0;
				connectorAnim = pieceDataAnim.studs[idx] || pieceDataAnim.studs[0];
			} else if (!useStudAnim && pieceDataAnim && Array.isArray(pieceDataAnim.antiStuds) && pieceDataAnim.antiStuds.length > 0) {
				let idx = pieceDataAnim.antiStuds.length > 0 ? ((selectedAntiStudIndex % pieceDataAnim.antiStuds.length) + pieceDataAnim.antiStuds.length) % pieceDataAnim.antiStuds.length : 0;
				connectorAnim = pieceDataAnim.antiStuds[idx] || pieceDataAnim.antiStuds[0];
			}
			if (connectorAnim) {
				const localPos = new THREE.Vector3(
					Number.isFinite(connectorAnim.x) ? connectorAnim.x : 0,
					Number.isFinite(connectorAnim.y) ? connectorAnim.y : 0,
					Number.isFinite(connectorAnim.z) ? connectorAnim.z : 0,
				);
				const worldOffset = localPos.clone().applyQuaternion(finalQuat);
				animConnectorOrigin = new THREE.Vector3(targetPos.x + worldOffset.x, targetPos.y + worldOffset.y, targetPos.z + worldOffset.z);
				let localDir = new THREE.Vector3(
					Number.isFinite(connectorAnim.dx) ? connectorAnim.dx : 0,
					Number.isFinite(connectorAnim.dy) ? connectorAnim.dy : 1,
					Number.isFinite(connectorAnim.dz) ? connectorAnim.dz : 0,
				).normalize();
				let worldDir = localDir.applyQuaternion(finalQuat).normalize();
				if (!useStudAnim) worldDir.multiplyScalar(-1);
				animArrowDir = worldDir.clone().normalize();
			}

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
			ghostMesh.visible = true;
			ghostTargetPos = { ...targetPos };
			const selectedPiece = pieceList[selectedPieceIndex];
			ghostPieceId = selectedPiece ? selectedPiece.id : null;
			const e = new THREE.Euler().setFromQuaternion(finalQuat, "XYZ");
			ghostRotationEuler = { x: e.x, y: e.y, z: e.z };
			// Update ghost connector arrow (origin and direction)
			if (ghostArrow) {
				const pieceData = ghostPieceId ? piecesData[ghostPieceId] : null;
				let useStud = (selectedAnchorMode === 'stud');
				let connector = null;
				if (useStud && pieceData && Array.isArray(pieceData.studs) && pieceData.studs.length > 0) {
					let idx = pieceData.studs.length > 0 ? ((selectedStudIndex % pieceData.studs.length) + pieceData.studs.length) % pieceData.studs.length : 0;
					connector = pieceData.studs[idx] || pieceData.studs[0];
				} else if (!useStud && pieceData && Array.isArray(pieceData.antiStuds) && pieceData.antiStuds.length > 0) {
					let idx = pieceData.antiStuds.length > 0 ? ((selectedAntiStudIndex % pieceData.antiStuds.length) + pieceData.antiStuds.length) % pieceData.antiStuds.length : 0;
					connector = pieceData.antiStuds[idx] || pieceData.antiStuds[0];
				}
				if (connector) {
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
					let worldDir = localDir.applyQuaternion(finalQuat).normalize();
					// If anti-stud selected, arrow goes opposite direction
					if (!useStud) worldDir.multiplyScalar(-1);
					// Reverse arrow direction globally for consistency with ghost animation
					worldDir.multiplyScalar(-1);
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
			ghostTargetPos = null;
			ghostPieceId = null;
			if (ghostArrow) ghostArrow.visible = false;
		}
	}

	function updateClosestStud(raycaster, intersects) {
		if (!studHighlightMesh) return;
		let closestStud = null;
		let closestAnti = null;
		let closestDistanceStud = Infinity;
		let closestDistanceAnti = Infinity;
		let closestStudBrickId = null;
		let closestAntiBrickId = null;
		let closestStudDir = null;
		let closestAntiDir = null;

		for (const intersect of intersects) {
			// Prefer brickId from mesh userData to avoid O(n) map scans per hit
			let brickId = (intersect && intersect.object && intersect.object.userData) ? intersect.object.userData.brickId : null;
			if (!brickId) continue;
			const gameState = getGameStateRef ? getGameStateRef() : null;
			const brick = gameState && gameState.bricks ? gameState.bricks[brickId] : null;
			if (!brick) continue;
			const brickQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(brick.rotation.x, brick.rotation.y, brick.rotation.z));
			const brickMatrix = new THREE.Matrix4();
			brickMatrix.compose(new THREE.Vector3(brick.position.x, brick.position.y, brick.position.z), brickQuat, new THREE.Vector3(1, 1, 1));
			const pieceData = piecesData[brick.pieceId] || {};
			const thisBrickStuds = Array.isArray(pieceData.studs) ? pieceData.studs : [];
			for (const stud of thisBrickStuds) {
				const studWorldPos = new THREE.Vector3(stud.x, stud.y, stud.z);
				studWorldPos.applyMatrix4(brickMatrix);
				let studWorldDir = new THREE.Vector3(0, 1, 0);
				if (typeof stud.dx === "number" && typeof stud.dy === "number" && typeof stud.dz === "number") {
					studWorldDir = new THREE.Vector3(stud.dx, stud.dy, stud.dz).normalize().applyQuaternion(brickQuat);
				} else {
					studWorldDir.applyQuaternion(brickQuat);
				}
				// Use distance to the actual intersection point
				const distanceS = intersect.point.distanceTo(studWorldPos);
				if (distanceS < closestDistanceStud && distanceS < 60) {
					closestDistanceStud = distanceS;
					closestStud = studWorldPos;
					closestStudBrickId = brickId;
					closestStudDir = studWorldDir.clone().normalize();
				}
			}
			const thisBrickAntiStuds = Array.isArray(pieceData.antiStuds) ? pieceData.antiStuds : [];
			for (const anti of thisBrickAntiStuds) {
				const antiWorldPos = new THREE.Vector3(anti.x, anti.y, anti.z);
				antiWorldPos.applyMatrix4(brickMatrix);
				let antiWorldDir = new THREE.Vector3(0, 1, 0);
				if (typeof anti.dx === "number" && typeof anti.dy === "number" && typeof anti.dz === "number") {
					antiWorldDir = new THREE.Vector3(anti.dx, anti.dy, anti.dz).normalize().applyQuaternion(brickQuat);
				} else {
					antiWorldDir.applyQuaternion(brickQuat);
				}
				const distanceA = intersect.point.distanceTo(antiWorldPos);
				if (distanceA < closestDistanceAnti && distanceA < 80) {
					closestDistanceAnti = distanceA;
					closestAnti = antiWorldPos;
					closestAntiBrickId = brickId;
					closestAntiDir = antiWorldDir.clone().normalize();
				}
			}
		}

		// Only highlight connectors that match the current anchor mode.
		let chosenPos = null;
		let chosenDir = null;
		if (selectedAnchorMode === 'anti') {
			if (closestStud) { chosenPos = closestStud; chosenDir = closestStudDir; }
		} else { // selectedAnchorMode === 'stud'
			if (closestAnti) { chosenPos = closestAnti; chosenDir = closestAntiDir; }
		}

		if (chosenPos) {
			studHighlightMesh.position.copy(chosenPos);
			studHighlightMesh.position.y += 2;
			const up = new THREE.Vector3(0, 1, 0);
			const dir = (chosenDir && chosenDir.length() > 0.0001) ? chosenDir.clone().normalize() : up;
			const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
			studHighlightMesh.setRotationFromQuaternion(q);
			studHighlightMesh.visible = true;
			// Preserve both infos for downstream logic, but only one will be used based on mode during placement
			closestStudInfo = closestStud ? { position: closestStud, brickId: closestStudBrickId, direction: closestStudDir ? closestStudDir.clone().normalize() : undefined } : null;
			closestAntiStudInfo = closestAnti ? { position: closestAnti, brickId: closestAntiBrickId, direction: closestAntiDir ? closestAntiDir.clone().normalize() : undefined } : null;
		} else {
			studHighlightMesh.visible = false;
			// Still store the raw closest infos for potential UI/readout, but avoid implying a valid snap target
			closestStudInfo = closestStud ? { position: closestStud, brickId: closestStudBrickId, direction: closestStudDir ? closestStudDir.clone().normalize() : undefined } : null;
			closestAntiStudInfo = closestAnti ? { position: closestAnti, brickId: closestAntiBrickId, direction: closestAntiDir ? closestAntiDir.clone().normalize() : undefined } : null;
		}
	}

	async function loadBrickModel() {
		const pieceIds = await fetchPieceIdsFromCSV();
		return new Promise((resolve, reject) => {
			setLoading("Loading LEGO parts library...");
			gltfLoader.load(
				"/apps/bricks/all_pieces.gltf",
				function (gltf) {
					const legoPartsLibrary = gltf.scene.getObjectByName("LegoPartsLibrary");
					if (!legoPartsLibrary) {
						reject(new Error("LegoPartsLibrary not found in GLTF"));
						return;
					}
					setupBrickMaterials();
					let loadedCount = 0;
					for (const pieceId of pieceIds) {
						const piece = legoPartsLibrary.getObjectByName(pieceId);
						if (!piece) {
							console.warn(`Piece ${pieceId} not found in GLTF`);
							continue;
						}
						let partMesh = null;
						const partNode = piece.getObjectByName("part");
						if (partNode) {
							if (partNode.isMesh || partNode.isSkinnedMesh) partMesh = partNode; else {
								partNode.traverse((child) => { if (!partMesh && (child.isMesh || child.isSkinnedMesh)) partMesh = child; });
							}
						} else {
							piece.traverse((child) => {
								if (!partMesh && (child.isMesh || child.isSkinnedMesh)) {
									const ud = child.userData || {};
									const typeTag = ud.type || (ud.extras && ud.extras.type);
									if (typeTag === "part") partMesh = child;
								}
							});
						}
						if (!partMesh) {
							console.warn(`Piece ${pieceId}: 'part' node not found; using first mesh as fallback`);
							piece.traverse((child) => { if (!partMesh && (child.isMesh || child.isSkinnedMesh)) partMesh = child; });
						}
						if (partMesh && partMesh.geometry) {
							const geometry = partMesh.geometry.clone();
							try {
								piece.updateWorldMatrix(true, false);
								partMesh.updateWorldMatrix(true, false);
								const pieceWorld = piece.matrixWorld;
								const partWorld = partMesh.matrixWorld;
								const pieceWorldInv = new THREE.Matrix4().copy(pieceWorld).invert();
								const localToPiece = new THREE.Matrix4().multiplyMatrices(pieceWorldInv, partWorld);
								geometry.applyMatrix4(localToPiece);
							} catch (e) {
								console.warn(`Failed to bake transform for piece ${pieceId}:`, e);
							}
							if (!geometry.attributes.normal) geometry.computeVertexNormals();
							geometry.normalizeNormals();
							// Build BVH once per unique piece geometry to accelerate raycasting
							try { geometry.computeBoundsTree(); } catch (_) {}
							brickGeometries.set(pieceId, geometry);
							loadedCount++;
						}
						let partNoStudsMesh = null;
						const pnsNode = piece.getObjectByName("partnostuds");
						if (pnsNode) {
							if (pnsNode.isMesh || pnsNode.isSkinnedMesh) partNoStudsMesh = pnsNode; else {
								pnsNode.traverse((child) => { if (!partNoStudsMesh && (child.isMesh || child.isSkinnedMesh)) partNoStudsMesh = child; });
							}
						}
						if (!partNoStudsMesh) {
							piece.traverse((child) => {
								if (!partNoStudsMesh && (child.isMesh || child.isSkinnedMesh)) {
									const ud = child.userData || {};
									const typeTag = ud.type || (ud.extras && ud.extras.type);
									if (typeTag === "partnostuds") partNoStudsMesh = child;
								}
							});
						}
						if (partNoStudsMesh && partNoStudsMesh.geometry) {
							const colGeom = partNoStudsMesh.geometry.clone();
							try {
								piece.updateWorldMatrix(true, false);
								partNoStudsMesh.updateWorldMatrix(true, false);
								const pieceWorld = piece.matrixWorld;
								const pnsWorld = partNoStudsMesh.matrixWorld;
								const pieceWorldInv = new THREE.Matrix4().copy(pieceWorld).invert();
								const localToPiece = new THREE.Matrix4().multiplyMatrices(pieceWorldInv, pnsWorld);
								colGeom.applyMatrix4(localToPiece);
							} catch (e) {
								console.warn(`Failed to bake transform for partnostuds ${pieceId}:`, e);
							}
							if (!colGeom.attributes.normal) colGeom.computeVertexNormals();
							colGeom.normalizeNormals();
							// Optional: BVH for potential collision/picking with nostuds if used for picking later
							try { colGeom.computeBoundsTree(); } catch (_) {}
							collisionGeometries.set(pieceId, colGeom);
						}
					}
					setLoading("");
					resolve();
				},
				function (progress) {
					if (progress.lengthComputable) {
						const percentComplete = (progress.loaded / progress.total) * 100;
						setLoading(`Loading: ${Math.round(percentComplete)}%`);
					}
				},
				function (error) {
					console.error("Error loading GLTF model:", error);
					setLoading("Error loading model");
					reject(error);
				}
			);
		});
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

	function setChunkConfig(cfg) {
		CHUNK_SIZE = (cfg && typeof cfg.size === 'number') ? cfg.size : null;
		CHUNK_HEIGHT = (cfg && typeof cfg.height === 'number') ? cfg.height : null;
	}

	function getChunkOriginFromKey(key) {
		if (!key || CHUNK_SIZE == null || CHUNK_HEIGHT == null) return { x: 0, y: 0, z: 0 };
		const parts = String(key).split(',');
		const cx = parseInt(parts[0] || '0', 10) | 0;
		const cy = parseInt(parts[1] || '0', 10) | 0;
		const cz = parseInt(parts[2] || '0', 10) | 0;
		return { x: cx * CHUNK_SIZE, y: cy * CHUNK_HEIGHT, z: cz * CHUNK_SIZE };
	}

	function ensureChunkGroup(cx, cy, cz) {
		const key = `${cx},${cy},${cz}`;
		let group = chunkGroups.get(key);
		if (group) return group;
		const origin = getChunkOriginFromKey(key);
		group = new THREE.Group();
		group.position.set(origin.x, origin.y, origin.z);
		group.userData.chunkKey = key;
		if (chunkDebugVisible) {
			const min = new THREE.Vector3(0, 0, 0);
			const max = new THREE.Vector3(CHUNK_SIZE || 1, CHUNK_HEIGHT || 1, CHUNK_SIZE || 1);
			const box = new THREE.Box3(min, max);
			const helper = new THREE.Box3Helper(box, 0x00ff00);
			helper.material.depthTest = false;
			helper.renderOrder = 1;
			group.add(helper);
		}
		scene.add(group);
		chunkGroups.set(key, group);
		return group;
	}

	function setChunkDebugVisible(visible) {
		chunkDebugVisible = !!visible;
		for (const group of chunkGroups.values()) {
			// Find existing helper
			let helper = null;
			for (const child of group.children) {
				if (child.isBox3Helper) { helper = child; break; }
			}
			if (chunkDebugVisible) {
				// Create helper on demand if missing
				if (!helper && CHUNK_SIZE != null && CHUNK_HEIGHT != null) {
					const min = new THREE.Vector3(0, 0, 0);
					const max = new THREE.Vector3(CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_SIZE);
					const box = new THREE.Box3(min, max);
					helper = new THREE.Box3Helper(box, 0x0f000f);
					helper.material.depthTest = false;
					helper.renderOrder = 1;
					group.add(helper);
				}
				if (helper) helper.visible = true;
			} else {
				if (helper) helper.visible = false;
			}
		}
	}

	function getMouseWorldPosition() {
		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
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
				// Capture the brickId from the intersected mesh if available
				lastHitBrickId = (intersection && intersection.object && intersection.object.userData) ? (intersection.object.userData.brickId || null) : null;
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
			const vector = new THREE.Vector3(0, 0, 0.5);
			vector.unproject(camera);
			const dir = vector.sub(camera.position).normalize();
			const distance = -camera.position.y / dir.y;
			const pos = camera.position.clone().add(dir.multiplyScalar(distance));
			result = { x: pos.x, y: pos.y, z: pos.z };
			lastMouseWorldPos = null;
		}
		ensureGhostMesh(false);
		return result;
	}

	function createBrickMesh(brick) {
		if (!brickMaterials) return;
		const pieceId = brick.pieceId || "3022";
		let geometry = brickGeometries.get(pieceId);
		if (!geometry) {
			if (brickGeometries.size > 0) geometry = brickGeometries.values().next().value; else return;
		}
		const material = brickMaterials[brick.colorIndex] || brickMaterials[0];
		const mesh = new THREE.Mesh(geometry, material);
		// Attach brickId to mesh for fast picking lookup
		if (!mesh.userData) mesh.userData = {};
		mesh.userData.brickId = brick.id;
		// Require authoritative chunk assignment; skip otherwise
		if (!brick.chunkKey || CHUNK_SIZE == null) {
			return; // bricks must belong to a chunk
		}
		const parts = String(brick.chunkKey).split(',');
		const cx = parseInt(parts[0] || '0', 10) | 0;
		const cy = parseInt(parts[1] || '0', 10) | 0;
		const cz = parseInt(parts[2] || '0', 10) | 0;
		const parent = ensureChunkGroup(cx, cy, cz);
		const origin = getChunkOriginFromKey(brick.chunkKey);
		mesh.position.set(brick.position.x - origin.x, brick.position.y - origin.y, brick.position.z - origin.z);
		
		// Add tiny random rotation (±1 degree) on all axes
		const randomRotationRange = (Math.PI / 180) * 0.125; // 1 degree in radians
		const randomX = (Math.random() - 0.5) * 2 * randomRotationRange;
		const randomY = (Math.random() - 0.5) * 2 * randomRotationRange;
		const randomZ = (Math.random() - 0.5) * 2 * randomRotationRange;
		
		mesh.rotation.set(
			brick.rotation.x + randomX, 
			brick.rotation.y + randomY, 
			brick.rotation.z + randomZ
		);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		parent.add(mesh);
		brickMeshes.set(brick.id, mesh);
		// Maintain cached raycast array
		raycastTargets.push(mesh);
	}

	function removeBrickMesh(brickId) {
		const mesh = brickMeshes.get(brickId);
		if (mesh) {
			if (mesh.parent) mesh.parent.remove(mesh);
			// Clear identifier to avoid stale picks
			if (mesh.userData) delete mesh.userData.brickId;
			brickMeshes.delete(brickId);
			// Remove from raycast cache
			const idx = raycastTargets.indexOf(mesh);
			if (idx !== -1) raycastTargets.splice(idx, 1);
			// If parent chunk group is empty, prune it
			const parent = mesh.parent;
			if (parent && parent.userData && parent.userData.chunkKey) {
				let hasMesh = false;
				for (const child of parent.children) {
					if (child.isMesh) { hasMesh = true; break; }
				}
				if (!hasMesh) {
					scene.remove(parent);
					chunkGroups.delete(parent.userData.chunkKey);
				}
			}
		}
	}

	function reconcileChunksAndBricks(stateChunks, stateBricks) {
		if (stateChunks && typeof stateChunks === 'object') {
			for (const [key, c] of Object.entries(stateChunks)) {
				const cx = Number.isFinite(c.cx) ? (c.cx | 0) : 0;
				const cy = Number.isFinite(c.cy) ? (c.cy | 0) : 0;
				const cz = Number.isFinite(c.cz) ? (c.cz | 0) : 0;
				ensureChunkGroup(cx, cy, cz);
			}
		}
		for (const [bid, b] of Object.entries(stateBricks || {})) {
			if (!brickMeshes.has(bid)) {
				createBrickMesh({ id: bid, ...b });
			}
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
		brickMeshes.forEach((mesh) => {
			scene.remove(mesh);
		});
		brickMeshes.clear();
	}

	function onWindowResize() {
		if (!camera || !renderer || !container || !composer) return;
		const width = container.clientWidth;
		const height = container.clientHeight;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
		composer.setSize(width, height);
		if (ssaoPassRef) ssaoPassRef.setSize(width, height);
	}

	function applyAuthoritativeGhostPose(gp) {
		if (!gp || !ghostMesh) return;
		ghostMesh.visible = true;
		ghostMesh.position.set(gp.position.x, gp.position.y, gp.position.z);
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(gp.rotation.x || 0, gp.rotation.y || 0, gp.rotation.z || 0));
		ghostMesh.setRotationFromQuaternion(q);
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
		renderPreview();
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
		// Capture all composer passes by disabling autoReset and resetting once before render
		if (renderer && renderer.info) {
			renderer.info.autoReset = false;
			if (typeof renderer.info.reset === 'function') renderer.info.reset();
		}
		composer.render();
		// Update per-frame stats for HUD
		if (renderer && renderer.info) {
			lastDrawCalls = renderer.info.render.calls | 0;
			lastTriangles = renderer.info.render.triangles | 0;
		}
	}

	// -------- Name label helpers --------
	function createTextSprite(text) {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 128;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		// Background (transparent) and text
		ctx.font = 'bold 64px Inter, system-ui, Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const x = canvas.width / 2;
		const y = canvas.height / 2;
		ctx.lineWidth = 10;
		ctx.strokeStyle = 'rgba(0,0,0,0.7)';
		ctx.strokeText(text, x, y);
		ctx.fillStyle = 'white';
		ctx.fillText(text, x, y);
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.needsUpdate = true;
		const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
		const sprite = new THREE.Sprite(material);
		// World size for readability
		const worldHeight = 28; // tune as needed
		const aspect = canvas.width / canvas.height;
		sprite.scale.set(worldHeight * aspect, worldHeight, 1);
		sprite.renderOrder = 1000;
		sprite.userData.labelText = text;
		return sprite;
	}

	function createOrUpdateNameSprite(playerData) {
		const id = playerData.id;
		const nameText = (typeof playerData.name === 'string' && playerData.name.trim()) ? playerData.name.trim() : '';
		let sprite = playerNameSprites.get(id);
		// If we have no sprite yet, create one
		if (!sprite) {
			const s = createTextSprite(nameText || '');
			if (!s) return;
			playerNameSprites.set(id, s);
			s.position.set(playerData.position.x, playerData.position.y + 90, playerData.position.z);
			scene.add(s);
			return;
		}
		// If text changed, rebuild texture
		if ((sprite.userData.labelText || '') !== nameText) {
			scene.remove(sprite);
			if (sprite.material && sprite.material.map && sprite.material.map.dispose) try { sprite.material.map.dispose(); } catch (_) {}
			if (sprite.material && sprite.material.dispose) try { sprite.material.dispose(); } catch (_) {}
			const s2 = createTextSprite(nameText || '');
			if (!s2) return;
			s2.position.copy(sprite.position);
			playerNameSprites.set(id, s2);
			scene.add(s2);
			sprite = s2;
		}
		// Always keep sprite above current position
		sprite.position.set(playerData.position.x, playerData.position.y + 90, playerData.position.z);
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
                
				camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.5, 10000);
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
				// Hint to the browser compositor for stable fps
				if (renderer.domElement && renderer.domElement.style) {
					renderer.domElement.style.contain = 'layout paint';
					renderer.domElement.style.touchAction = 'none';
				}
				setupPBRLighting();
				setupEquirectangularSkybox();
				setupPostProcessing();
				gltfLoader = new GLTFLoader();
				ensureStudHighlight();
				await loadBrickModel();
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
			if (ghostArrow) {
				scene.remove(ghostArrow);
				disposeObject(ghostArrow);
				ghostArrow = null;
			}
			// Clean up brick meshes
			brickMeshes.forEach((mesh) => {
				scene.remove(mesh);
			});
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
		getRenderStats() { return { drawCalls: lastDrawCalls | 0, triangles: lastTriangles | 0 }; },
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
		canPlaceNow() { return !!(lastRayHitValid && ghostTargetPos); },
		// Mesh management
		createBrickMesh,
		removeBrickMesh,
		createPlayerMesh,
		updatePlayerMesh,
		removePlayerMesh,
		resetAllMeshes,
		// Render
		renderTick,
		// Post-processing toggles
		setSSAOEnabled,
		toggleSSAO,
		getSSAOEnabled,
		setSSAODebugView,
		toggleSSAODebugView,
		getSSAODebugView,
		// Preview
		setupPreview,
	};
}


