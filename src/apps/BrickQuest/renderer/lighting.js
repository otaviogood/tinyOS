// @ts-nocheck
import * as THREE from "three/src/Three.WebGPU.Nodes.js";

export function setupPBRLighting(scene) {
	const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3e5765, 3.0);
	hemiLight.position.set(0, 50, 0);
	scene.add(hemiLight);

	const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
	sunLight.name = 'SunLight';
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

	// Ensure node-based lighting is registered in the renderer's node system
	try { NodeLighting; } catch (_) {}

	const fillLight = new THREE.DirectionalLight(0x4a90e2, 0.8);
	fillLight.position.set(-100, 100, -100);
	scene.add(fillLight);

	const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
	rimLight.position.set(0, 0, -200);
	scene.add(rimLight);

	// Return references for downstream control (optional to use)
	return { sunLight, hemiLight, fillLight, rimLight };
}

export function setupEquirectangularSkybox(scene, camera, onLoaded, onError) {
	const textureLoader = new THREE.TextureLoader();
	textureLoader.load(
		'/apps/sky4.webp',
		function(texture) {
			texture.colorSpace = THREE.SRGBColorSpace;
			const farDistance = (camera && typeof camera.far === 'number') ? camera.far : 5000;
			const radius = Math.max(10, farDistance * 0.98);
			const skyboxGeometry = new THREE.SphereGeometry(radius, 64, 32);
			const skyboxMaterial = new THREE.MeshBasicNodeMaterial({ map: texture, side: THREE.BackSide, fog: false });
			const skyboxMesh = new THREE.Mesh(skyboxGeometry, skyboxMaterial);
			skyboxMesh.renderOrder = -1;
			scene.add(skyboxMesh);
			scene.background = null;
			if (onLoaded) try { onLoaded(skyboxMesh); } catch (_) {}
		},
		function(_) {},
		function(error) {
			console.error('Error loading skybox texture:', error);
			if (onError) try { onError(error); } catch (_) {}
			scene.background = new THREE.Color(0x0cbeff);
		}
	);
}


