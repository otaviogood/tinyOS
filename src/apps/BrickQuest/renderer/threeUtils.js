// @ts-nocheck

export function disposeObject(object3d) {
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


