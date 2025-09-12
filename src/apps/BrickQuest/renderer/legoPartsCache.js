// @ts-nocheck
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let gltfPromise = null;

export function getLegoPartsGLTF() {
	if (!gltfPromise) {
		const loader = new GLTFLoader();
		gltfPromise = new Promise((resolve, reject) => {
			loader.load(
				'/apps/bricks/all_pieces.gltf',
				(gltf) => resolve(gltf),
				undefined,
				(err) => reject(err)
			);
		});
	}
	return gltfPromise;
}

export async function getLegoPartsLibraryNode() {
	const gltf = await getLegoPartsGLTF();
	return gltf && gltf.scene ? gltf.scene.getObjectByName('LegoPartsLibrary') : null;
}


