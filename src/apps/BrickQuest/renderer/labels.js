// @ts-nocheck
import * as THREE from "three";

export function createTextSprite(text) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
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
	const worldHeight = 28;
	const aspect = canvas.width / canvas.height;
	sprite.scale.set(worldHeight * aspect, worldHeight, 1);
	sprite.renderOrder = 1000;
	sprite.userData.labelText = text;
	return sprite;
}

export function createOrUpdateNameSprite(playerData, playerNameSprites, scene) {
	const id = playerData.id;
	const nameText = (typeof playerData.name === 'string' && playerData.name.trim()) ? playerData.name.trim() : '';
	let sprite = playerNameSprites.get(id);
	if (!sprite) {
		const s = createTextSprite(nameText || '');
		if (!s) return;
		playerNameSprites.set(id, s);
		s.position.set(playerData.position.x, playerData.position.y + 90, playerData.position.z);
		scene.add(s);
		return;
	}
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
	sprite.position.set(playerData.position.x, playerData.position.y + 90, playerData.position.z);
}


