const fs = require('fs');

function buildGLTF(processed, options = {}) {
    const materials = [];
    const materialMap = new Map();
    let materialIndex = 0;

    (processed.meshes || []).forEach((mesh, meshIdx) => {
        const primitive = mesh.primitives && mesh.primitives[0];
        if (!primitive) return;
        const color = primitive.material;
        if (!materialMap.has(color)) {
            const r = ((color >> 16) & 0xff) / 255;
            const g = ((color >> 8) & 0xff) / 255;
            const b = (color & 0xff) / 255;
            materials.push({
                pbrMetallicRoughness: {
                    baseColorFactor: [r, g, b, 1.0],
                    metallicFactor: 0.0,
                    roughnessFactor: 0.7
                },
                name: `color_${color.toString(16).padStart(6, '0')}`
            });
            materialMap.set(color, materialIndex++);
        }
        primitive.material = materialMap.get(color);
    });

    const nodes = [];
    const rootExtras = { studs: processed.studs || [], antiStuds: processed.antiStuds || [], miniAntiStuds: processed.miniAntiStuds || [] };
    if (processed.convexHull) {
        // Export convex hull metadata: bbox and up to 4 cut planes
        rootExtras.convexHull = {
            bboxMin: processed.convexHull.bboxMin || null,
            bboxMax: processed.convexHull.bboxMax || null,
            planes: (processed.convexHull.planes || []).map(p => ({ n: p.n, d: p.d }))
        };
    }
    const rootNode = { name: 'LDrawModel', children: [], extras: rootExtras };
    nodes.push(rootNode);

    const childOrder = [];
    (processed.meshes || []).forEach((mesh, index) => {
        const type = (processed.meshTypes && processed.meshTypes[index]) || 'part';
        const nodeIndex = nodes.length;
        nodes.push({ name: type, mesh: index });
        childOrder.push({ type, nodeIndex });
    });
    const typePriority = { part: 0, stud: 1, antistud: 2, partnostuds: 3, shrunk: 4, convex: 5 };
    childOrder.sort((a, b) => (typePriority[a.type] || 9) - (typePriority[b.type] || 9));
    rootNode.children = childOrder.map(x => x.nodeIndex);

    const gltf = {
        asset: { version: '2.0', generator: 'LDraw to GLTF (modular)' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes,
        meshes: processed.meshes || [],
        materials,
        accessors: processed.accessors || [],
        bufferViews: processed.bufferViews || [],
        buffers: []
    };

    const totalSize = (processed.buffers || []).reduce((sum, buf) => sum + buf.byteLength, 0);
    const bufferData = new ArrayBuffer(totalSize);
    const view = new Uint8Array(bufferData);
    let offset = 0;
    (processed.buffers || []).forEach(buf => { view.set(new Uint8Array(buf.buffer), offset); offset += buf.byteLength; });
    const base64Data = Buffer.from(bufferData).toString('base64');
    const dataUri = `data:application/octet-stream;base64,${base64Data}`;
    gltf.buffers.push({ uri: dataUri, byteLength: bufferData.byteLength });

    return gltf;
}

function writeGLTF(processed, outputPath, options = {}) {
    const gltf = buildGLTF(processed, options);
    const json = JSON.stringify(gltf, null, 2);
    fs.writeFileSync(outputPath, json);
}

module.exports = { buildGLTF, writeGLTF };


