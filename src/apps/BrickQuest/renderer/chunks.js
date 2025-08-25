// @ts-nocheck
import * as THREE from "three";

export function setChunkConfig(state, cfg) {
	state.CHUNK_SIZE = (cfg && typeof cfg.size === 'number') ? cfg.size : null;
	state.CHUNK_HEIGHT = (cfg && typeof cfg.height === 'number') ? cfg.height : null;
}

export function getChunkOriginFromKey(state, key) {
	if (!key || state.CHUNK_SIZE == null || state.CHUNK_HEIGHT == null) return { x: 0, y: 0, z: 0 };
	const parts = String(key).split(',');
	const cx = parseInt(parts[0] || '0', 10) | 0;
	const cy = parseInt(parts[1] || '0', 10) | 0;
	const cz = parseInt(parts[2] || '0', 10) | 0;
	return { x: cx * state.CHUNK_SIZE, y: cy * state.CHUNK_HEIGHT, z: cz * state.CHUNK_SIZE };
}

export function ensureChunkGroup(state, scene, cx, cy, cz) {
	const key = `${cx},${cy},${cz}`;
	let group = state.chunkGroups.get(key);
	if (group) return group;
	const origin = getChunkOriginFromKey(state, key);
	group = new THREE.Group();
	group.position.set(origin.x, origin.y, origin.z);
	group.userData.chunkKey = key;
	if (state.chunkDebugVisible) {
		const min = new THREE.Vector3(0, 0, 0);
		const max = new THREE.Vector3(state.CHUNK_SIZE || 1, state.CHUNK_HEIGHT || 1, state.CHUNK_SIZE || 1);
		const box = new THREE.Box3(min, max);
		const helper = new THREE.Box3Helper(box, 0x4b00f6);
		helper.userData = helper.userData || {};
		helper.userData.isChunkHelper = true;
		helper.material.depthTest = false;
		helper.renderOrder = 1;
		group.add(helper);
	}
	scene.add(group);
	state.chunkGroups.set(key, group);
	return group;
}

export function setChunkDebugVisible(state, scene, visible) {
	state.chunkDebugVisible = !!visible;
	for (const group of state.chunkGroups.values()) {
		let foundAny = false;
		for (const child of group.children) {
			const isHelper = !!(child && ((child.userData && child.userData.isChunkHelper) || child.type === 'Box3Helper'));
			if (isHelper) {
				foundAny = true;
				child.visible = !!state.chunkDebugVisible;
				if (state.chunkDebugVisible) {
					if (child.material) child.material.depthTest = false;
					child.renderOrder = 1;
				}
			}
		}
		if (state.chunkDebugVisible && !foundAny && state.CHUNK_SIZE != null && state.CHUNK_HEIGHT != null) {
			const min = new THREE.Vector3(0, 0, 0);
			const max = new THREE.Vector3(state.CHUNK_SIZE, state.CHUNK_HEIGHT, state.CHUNK_SIZE);
			const box = new THREE.Box3(min, max);
			const helper = new THREE.Box3Helper(box, 0x4b00f6);
			helper.userData = helper.userData || {};
			helper.userData.isChunkHelper = true;
			helper.material.depthTest = false;
			helper.renderOrder = 1;
			group.add(helper);
		}
	}
}


