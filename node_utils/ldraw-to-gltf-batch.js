#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { LDrawParserAdvanced } = require('./ldraw-to-gltf-advanced.js');
const { calculateSmoothNormalsAndMerge } = require('./processing/normals');
const { computeConvexHullFromGeoms } = require('./processing');
// Inlined from former ./gltf/build.js
function getMin(arr, stride) {
    const min = [];
    for (let i = 0; i < stride; i++) {
        min[i] = Infinity;
        for (let j = i; j < arr.length; j += stride) {
            min[i] = Math.min(min[i], arr[j]);
        }
    }
    return min;
}
function getMax(arr, stride) {
    const max = [];
    for (let i = 0; i < stride; i++) {
        max[i] = -Infinity;
        for (let j = i; j < arr.length; j += stride) {
            max[i] = Math.max(max[i], arr[j]);
        }
    }
    return max;
}

// Extended parser for batch processing
class LDrawBatchParser extends LDrawParserAdvanced {
    constructor(partsLibraryPath) {
        super(partsLibraryPath);
        this.pieces = []; // Store all pieces data
    }

    // Create a FILE-SAFE uppercase description, non-alphanumeric -> underscore, collapse repeats
    makeFileSafeDescription(desc) {
        if (!desc) return '';
        let safe = String(desc).toUpperCase();
        safe = safe.replace(/[^A-Z0-9]+/g, '_'); // non-alnum to _
        safe = safe.replace(/^_+|_+$/g, '');     // trim leading/trailing _
        safe = safe.replace(/__+/g, '_');        // collapse multiple _
        return safe;
    }

    // Parse piece list file
    parsePieceList(pieceListPath) {
        const content = fs.readFileSync(pieceListPath, 'utf8');
        const lines = content.split('\n');
        const pieces = [];

        lines.forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                // Parse format: 3001, white, brick 2x4
                const parts = line.split(',').map(p => p.trim());
                if (parts.length >= 3) {
                    pieces.push({
                        partNumber: parts[0],
                        color: parts[1],
                        description: parts[2]
                    });
                }
            }
        });

        return pieces;
    }

    // Process a single piece and store its data
    async processPiece(pieceInfo) {
        // Reset per-piece data
        this.geometries = [];
        this.studData = [];
        this.antiStudData = [];
        
        // Create .dat filename from part number
        const filename = `${pieceInfo.partNumber}.dat`;
        const partPath = this.findPartFile(filename);
        
        if (!partPath) {
            console.warn(`Part file not found: ${filename}`);
            return null;
        }

        console.log(`Processing ${pieceInfo.partNumber}: ${pieceInfo.description}`);
        
        // Process the file
        await this.processFile(partPath);
        
        // Store the piece data
        return {
            partNumber: pieceInfo.partNumber,
            description: pieceInfo.description,
            color: pieceInfo.color,
            geometries: [...this.geometries],
            studData: [...this.studData],
            antiStudData: [...this.antiStudData]
        };
    }

    // Process all pieces from the list
    async processAllPieces(pieceListPath, maxPieces) {
        const pieceList = this.parsePieceList(pieceListPath);
        const selectedList = (typeof maxPieces === 'number' && maxPieces > 0)
            ? pieceList.slice(0, maxPieces)
            : pieceList;
        console.log(`Found ${pieceList.length} pieces. ${selectedList.length !== pieceList.length ? `Limiting to first ${selectedList.length}.` : 'Processing all.'}`);

        for (const pieceInfo of selectedList) {
            const pieceData = await this.processPiece(pieceInfo);
            if (pieceData) {
                this.pieces.push(pieceData);
            }
        }

        console.log(`Successfully processed ${this.pieces.length} pieces`);
    }

    // Export all pieces to a single GLTF
    async exportBatchToGLTF(outputPath) {
        console.log(`Exporting ${this.pieces.length} pieces to GLTF...`);

        const nodes = [];
        const meshes = [];
        const accessors = [];
        const bufferViews = [];
        const buffers = [];
        const materials = [];
        
        let byteOffset = 0;
        let totalBufferData = [];
        
        // Create root node
        const rootNode = {
            name: "LegoPartsLibrary",
            children: []
        };
        nodes.push(rootNode);

        // Create materials map
        const materialMap = new Map();
        let materialIndex = 0;
        const exportedPieces = [];

        // Process each piece
        this.pieces.forEach(piece => {
            // Create a parent node for this piece
            const pieceNodeIndex = nodes.length;
            const pieceNode = {
                name: piece.partNumber,
                children: [],
                extras: {
                    partNumber: piece.partNumber,
                    description: piece.description,
                    color: piece.color,
                    studs: piece.studData,
                    antiStuds: piece.antiStudData
                }
            };
            nodes.push(pieceNode);
            rootNode.children.push(pieceNodeIndex);

            // Regroup: type => (color => geoms[])
            const typeToColorGroups = new Map();
            piece.geometries.forEach(geom => {
                const sourceType = geom.sourceType || 'part';
                if (!typeToColorGroups.has(sourceType)) {
                    typeToColorGroups.set(sourceType, new Map());
                }
                const colorMap = typeToColorGroups.get(sourceType);
                if (!colorMap.has(geom.color)) {
                    colorMap.set(geom.color, []);
                }
                colorMap.get(geom.color).push(geom);
            });

            // Build a single mesh per logical type with one primitive per color to avoid name suffixes
            const addTypeMeshNode = (logicalType, colorMap, filterFn = null) => {
                if (!colorMap || colorMap.size === 0) return undefined;
                const primitives = [];
                colorMap.forEach((geoms, color) => {
                    const useGeoms = filterFn ? geoms.filter(filterFn) : geoms;
                    if (!useGeoms || useGeoms.length === 0) return;
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
                    const vertices = [];
                    const indices = [];
                    let indexOffset = 0;
                    useGeoms.forEach(geom => {
                        vertices.push(...geom.vertices);
                        geom.indices.forEach(idx => indices.push(idx + indexOffset));
                        indexOffset += geom.vertices.length / 3;
                    });
                    if (vertices.length === 0 || indices.length === 0) return;
                    
                    // Calculate smooth normals and merge vertices
                    const merged = calculateSmoothNormalsAndMerge(vertices, indices);
                    
                    const vertexBuffer = new Float32Array(merged.vertices);
                    const normalBuffer = new Float32Array(merged.normals);
                    const indexBuffer = new Uint16Array(merged.indices);
                    
                    // Position buffer view
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: vertexBuffer.byteLength });
                    accessors.push({
                        bufferView: bufferViews.length - 1,
                        componentType: 5126,
                        count: merged.vertices.length / 3,
                        type: "VEC3",
                        min: getMin(merged.vertices, 3),
                        max: getMax(merged.vertices, 3)
                    });
                    totalBufferData.push(vertexBuffer);
                    byteOffset += vertexBuffer.byteLength;
                    
                    // Normal buffer view
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: normalBuffer.byteLength });
                    accessors.push({
                        bufferView: bufferViews.length - 1,
                        componentType: 5126,
                        count: merged.normals.length / 3,
                        type: "VEC3"
                    });
                    totalBufferData.push(normalBuffer);
                    byteOffset += normalBuffer.byteLength;
                    
                    // Index buffer view
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: indexBuffer.byteLength });
                    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: merged.indices.length, type: "SCALAR" });
                    totalBufferData.push(indexBuffer);
                    byteOffset += indexBuffer.byteLength;
                    
                    primitives.push({
                        attributes: { 
                            POSITION: accessors.length - 3,  // Position accessor
                            NORMAL: accessors.length - 2     // Normal accessor
                        },
                        indices: accessors.length - 1,
                        material: materialMap.get(color)
                    });
                });
                if (primitives.length === 0) return undefined;
                const meshIndex = meshes.length;
                meshes.push({ primitives });
                const nodeIndex = nodes.length;
                nodes.push({ name: logicalType, mesh: meshIndex, extras: { type: logicalType } });
                return nodeIndex;
            };

            // Special shrunk node: fully smooth normals shared by position, then offset along normals
            const addShrunkMeshNode = (colorMap, shrinkDistance = 0.4, smoothAngle = 179.9) => {
                if (!colorMap || colorMap.size === 0) return undefined;
                const primitives = [];
                colorMap.forEach((geoms, color) => {
                    if (!geoms || geoms.length === 0) return;
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
                    const vertices = [];
                    const indices = [];
                    let indexOffset = 0;
                    geoms.forEach(geom => {
                        vertices.push(...geom.vertices);
                        geom.indices.forEach(idx => indices.push(idx + indexOffset));
                        indexOffset += geom.vertices.length / 3;
                    });
                    if (vertices.length === 0 || indices.length === 0) return;
                    const merged = calculateSmoothNormalsAndMerge(vertices, indices, smoothAngle);
                    const shrunkVertices = new Float32Array(merged.vertices.length);
                    for (let i = 0; i < merged.vertices.length; i += 3) {
                        const nx = merged.normals[i];
                        const ny = merged.normals[i + 1];
                        const nz = merged.normals[i + 2];
                        const px = merged.vertices[i];
                        const py = merged.vertices[i + 1];
                        const pz = merged.vertices[i + 2];
                        shrunkVertices[i] = px - nx * shrinkDistance;
                        shrunkVertices[i + 1] = py - ny * shrinkDistance;
                        shrunkVertices[i + 2] = pz - nz * shrinkDistance;
                    }
                    const normalBuffer = new Float32Array(merged.normals);
                    const indexBuffer = new Uint16Array(merged.indices);
                    // Position
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: shrunkVertices.byteLength });
                    accessors.push({
                        bufferView: bufferViews.length - 1,
                        componentType: 5126,
                        count: shrunkVertices.length / 3,
                        type: "VEC3",
                        min: getMin(Array.from(shrunkVertices), 3),
                        max: getMax(Array.from(shrunkVertices), 3)
                    });
                    totalBufferData.push(shrunkVertices);
                    byteOffset += shrunkVertices.byteLength;
                    // Normal
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: normalBuffer.byteLength });
                    accessors.push({
                        bufferView: bufferViews.length - 1,
                        componentType: 5126,
                        count: normalBuffer.length / 3,
                        type: "VEC3"
                    });
                    totalBufferData.push(normalBuffer);
                    byteOffset += normalBuffer.byteLength;
                    // Indices
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: indexBuffer.byteLength });
                    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: indexBuffer.length, type: "SCALAR" });
                    totalBufferData.push(indexBuffer);
                    byteOffset += indexBuffer.byteLength;
                    primitives.push({
                        attributes: {
                            POSITION: accessors.length - 3,
                            NORMAL: accessors.length - 2
                        },
                        indices: accessors.length - 1,
                        material: materialMap.get(color)
                    });
                });
                if (primitives.length === 0) return undefined;
                const meshIndex = meshes.length;
                meshes.push({ primitives });
                const nodeIndex = nodes.length;
                nodes.push({ name: 'shrunk', mesh: meshIndex, extras: { type: 'shrunk' } });
                return nodeIndex;
            };

            // Convex node from part-no-studs geometry using 45° plane cuts
            const addConvexMeshNode = (geoms) => {
                const convex = computeConvexHullFromGeoms(geoms);
                if (!convex) return undefined;
                const color = convex.color;
                if (!materialMap.has(color)) {
                    const r = ((color >> 16) & 0xff) / 255;
                    const g = ((color >> 8) & 0xff) / 255;
                    const b = (color & 0xff) / 255;
                    materials.push({
                        pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1.0], metallicFactor: 0.0, roughnessFactor: 0.7 },
                        name: `color_${color.toString(16).padStart(6, '0')}`
                    });
                    materialMap.set(color, materialIndex++);
                }
                const vertexBuffer = new Float32Array(convex.vertices);
                const normalBuffer = new Float32Array(convex.normals);
                const indexBuffer = new Uint16Array(convex.indices);
                // Position
                bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: vertexBuffer.byteLength });
                accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: vertexBuffer.length / 3, type: 'VEC3', min: getMin(Array.from(vertexBuffer), 3), max: getMax(Array.from(vertexBuffer), 3) });
                totalBufferData.push(vertexBuffer);
                byteOffset += vertexBuffer.byteLength;
                // Normal
                bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: normalBuffer.byteLength });
                accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: normalBuffer.length / 3, type: 'VEC3' });
                totalBufferData.push(normalBuffer);
                byteOffset += normalBuffer.byteLength;
                // Indices
                bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: indexBuffer.byteLength });
                accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: indexBuffer.length, type: 'SCALAR' });
                totalBufferData.push(indexBuffer);
                byteOffset += indexBuffer.byteLength;
                const primitives = [{ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: materialMap.get(color) }];
                const meshIndex = meshes.length;
                meshes.push({ primitives });
                const nodeIndex = nodes.length;
                nodes.push({ name: 'convex', mesh: meshIndex, extras: { type: 'convex' } });
                return nodeIndex;
            };

            // Create nodes in strict order: part -> stud -> antistud -> partnostuds -> shrunk -> convex
            const partNodeIdx = addTypeMeshNode('part', typeToColorGroups.get('part'));
            const studNodeIdx = addTypeMeshNode('stud', typeToColorGroups.get('stud'));
            const antiStudNodeIdx = addTypeMeshNode('antistud', typeToColorGroups.get('antistud'));
            const partNoStudNodeIdx = addTypeMeshNode('partnostuds', typeToColorGroups.get('part'), g => !g.fromStudPrimitive);
            const shrunkNodeIdx = addShrunkMeshNode(typeToColorGroups.get('part'));
            let partNoStudGeomsArr = [];
            const partColorMapForConvex = typeToColorGroups.get('part');
            if (partColorMapForConvex && partColorMapForConvex.size > 0) {
                partColorMapForConvex.forEach(geoms => {
                    geoms.forEach(g => { if (!g.fromStudPrimitive) partNoStudGeomsArr.push(g); });
                });
            }
            const convexNodeIdx = addConvexMeshNode(partNoStudGeomsArr);

            const orderedChildren = [];
            if (partNodeIdx !== undefined) orderedChildren.push(partNodeIdx);
            if (studNodeIdx !== undefined) orderedChildren.push(studNodeIdx);
            if (antiStudNodeIdx !== undefined) orderedChildren.push(antiStudNodeIdx);
            if (partNoStudNodeIdx !== undefined) orderedChildren.push(partNoStudNodeIdx);
            if (shrunkNodeIdx !== undefined) orderedChildren.push(shrunkNodeIdx);
            if (convexNodeIdx !== undefined) orderedChildren.push(convexNodeIdx);
            pieceNode.children = orderedChildren;

            // Record as exported if it produced any geometry nodes
            if (orderedChildren.length > 0) {
                exportedPieces.push({
                    partNumber: piece.partNumber,
                    color: piece.color,
                    description: piece.description
                });
            }
        });

        // Combine all buffers
        const totalSize = totalBufferData.reduce((sum, buf) => sum + buf.byteLength, 0);
        const bufferData = new ArrayBuffer(totalSize);
        const view = new Uint8Array(bufferData);
        
        let offset = 0;
        totalBufferData.forEach(buf => {
            view.set(new Uint8Array(buf.buffer), offset);
            offset += buf.byteLength;
        });

        // Convert to base64 data URI
        const base64Data = Buffer.from(bufferData).toString('base64');
        const dataUri = `data:application/octet-stream;base64,${base64Data}`;

        // Create GLTF structure
        const gltf = {
            asset: {
                version: "2.0",
                generator: "LDraw Batch to GLTF Converter"
            },
            scene: 0,
            scenes: [{
                nodes: [0]
            }],
            nodes: nodes,
            meshes: meshes,
            materials: materials,
            accessors: accessors,
            bufferViews: bufferViews,
            buffers: [{
                uri: dataUri,
                byteLength: bufferData.byteLength
            }]
        };

        // Write GLTF file
        const gltfJson = JSON.stringify(gltf, null, 2);
        fs.writeFileSync(outputPath, gltfJson);
        
        console.log(`GLTF file saved to: ${outputPath}`);
        console.log(`Total pieces: ${this.pieces.length}`);
        console.log(`Total meshes: ${meshes.length}`);
        console.log(`Total materials: ${materials.length}`);

        // Write exported pieces CSV next to the GLTF, preserving GLTF order
        try {
            const exportedCsvPath = path.join(path.dirname(outputPath), 'exported_pieces.csv');
            const csvLines = exportedPieces.map(p => `${p.partNumber}, ${p.color}, ${p.description}`);
            fs.writeFileSync(exportedCsvPath, csvLines.join('\n'));
            console.log(`Exported pieces list saved to: ${exportedCsvPath} (${exportedPieces.length} pieces)`);
        } catch (e) {
            console.warn('Failed to write exported_pieces.csv:', e);
        }
    }

    // Export each processed piece as an individual GLTF into the given directory
    async exportIndividualPieces(outputDirectory) {
        try {
            fs.mkdirSync(outputDirectory, { recursive: true });
        } catch (e) {
            console.warn(`Failed to create individual output directory: ${outputDirectory}`, e);
            return;
        }

        let writtenCount = 0;
        for (const piece of this.pieces) {
            try {
                const nodes = [];
                const meshes = [];
                const accessors = [];
                const bufferViews = [];
                const materials = [];
                const materialMap = new Map();
                let materialIndex = 0;
                let byteOffset = 0;
                const totalBufferData = [];

                // Root node for this piece with metadata
                const rootNode = {
                    name: piece.partNumber,
                    children: [],
                    extras: {
                        partNumber: piece.partNumber,
                        description: piece.description,
                        color: piece.color,
                        studs: piece.studData,
                        antiStuds: piece.antiStudData
                    }
                };
                nodes.push(rootNode);

                // Group by sourceType then by color
                const typeToColorGroups = new Map();
                piece.geometries.forEach(geom => {
                    const sourceType = geom.sourceType || 'part';
                    if (!typeToColorGroups.has(sourceType)) {
                        typeToColorGroups.set(sourceType, new Map());
                    }
                    const colorMap = typeToColorGroups.get(sourceType);
                    if (!colorMap.has(geom.color)) {
                        colorMap.set(geom.color, []);
                    }
                    colorMap.get(geom.color).push(geom);
                });

                const addTypeMeshNode = (logicalType, colorMap, filterFn = null) => {
                    if (!colorMap || colorMap.size === 0) return undefined;
                    const primitives = [];
                    colorMap.forEach((geoms, color) => {
                        const useGeoms = filterFn ? geoms.filter(filterFn) : geoms;
                        if (!useGeoms || useGeoms.length === 0) return;

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

                        const vertices = [];
                        const indices = [];
                        let indexOffset = 0;
                        useGeoms.forEach(geom => {
                            vertices.push(...geom.vertices);
                            geom.indices.forEach(idx => indices.push(idx + indexOffset));
                            indexOffset += geom.vertices.length / 3;
                        });
                        if (vertices.length === 0 || indices.length === 0) return;

                        const merged = calculateSmoothNormalsAndMerge(vertices, indices);
                        const vertexBuffer = new Float32Array(merged.vertices);
                        const normalBuffer = new Float32Array(merged.normals);
                        const indexBuffer = new Uint16Array(merged.indices);

                        // Position
                        bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: vertexBuffer.byteLength });
                        accessors.push({
                            bufferView: bufferViews.length - 1,
                            componentType: 5126,
                            count: merged.vertices.length / 3,
                            type: "VEC3",
                            min: getMin(merged.vertices, 3),
                            max: getMax(merged.vertices, 3)
                        });
                        totalBufferData.push(vertexBuffer);
                        byteOffset += vertexBuffer.byteLength;

                        // Normal
                        bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: normalBuffer.byteLength });
                        accessors.push({
                            bufferView: bufferViews.length - 1,
                            componentType: 5126,
                            count: merged.normals.length / 3,
                            type: "VEC3"
                        });
                        totalBufferData.push(normalBuffer);
                        byteOffset += normalBuffer.byteLength;

                        // Indices
                        bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: indexBuffer.byteLength });
                        accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: merged.indices.length, type: "SCALAR" });
                        totalBufferData.push(indexBuffer);
                        byteOffset += indexBuffer.byteLength;

                        primitives.push({
                            attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 },
                            indices: accessors.length - 1,
                            material: materialMap.get(color)
                        });
                    });
                    if (primitives.length === 0) return undefined;
                    const meshIndex = meshes.length;
                    meshes.push({ primitives });
                    const nodeIndex = nodes.length;
                    nodes.push({ name: logicalType, mesh: meshIndex, extras: { type: logicalType } });
                    return nodeIndex;
                };

                // Special shrunk node for individual export as well
                const addShrunkMeshNode = (colorMap, shrinkDistance = 0.4, smoothAngle = 179.9) => {
                    if (!colorMap || colorMap.size === 0) return undefined;
                    const primitives = [];
                    colorMap.forEach((geoms, color) => {
                        if (!geoms || geoms.length === 0) return;
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
                        const vertices = [];
                        const indices = [];
                        let indexOffset = 0;
                        geoms.forEach(geom => {
                            vertices.push(...geom.vertices);
                            geom.indices.forEach(idx => indices.push(idx + indexOffset));
                            indexOffset += geom.vertices.length / 3;
                        });
                        if (vertices.length === 0 || indices.length === 0) return;
                        const merged = calculateSmoothNormalsAndMerge(vertices, indices, smoothAngle);
                        const shrunkVertices = new Float32Array(merged.vertices.length);
                        for (let i = 0; i < merged.vertices.length; i += 3) {
                            const nx = merged.normals[i];
                            const ny = merged.normals[i + 1];
                            const nz = merged.normals[i + 2];
                            const px = merged.vertices[i];
                            const py = merged.vertices[i + 1];
                            const pz = merged.vertices[i + 2];
                            shrunkVertices[i] = px - nx * shrinkDistance;
                            shrunkVertices[i + 1] = py - ny * shrinkDistance;
                            shrunkVertices[i + 2] = pz - nz * shrinkDistance;
                        }
                        const normalBuffer = new Float32Array(merged.normals);
                        const indexBuffer = new Uint16Array(merged.indices);
                        // Position
                        bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: shrunkVertices.byteLength });
                        accessors.push({
                            bufferView: bufferViews.length - 1,
                            componentType: 5126,
                            count: shrunkVertices.length / 3,
                            type: "VEC3",
                            min: getMin(Array.from(shrunkVertices), 3),
                            max: getMax(Array.from(shrunkVertices), 3)
                        });
                        totalBufferData.push(shrunkVertices);
                        byteOffset += shrunkVertices.byteLength;
                        // Normal
                        bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: normalBuffer.byteLength });
                        accessors.push({
                            bufferView: bufferViews.length - 1,
                            componentType: 5126,
                            count: normalBuffer.length / 3,
                            type: "VEC3"
                        });
                        totalBufferData.push(normalBuffer);
                        byteOffset += normalBuffer.byteLength;
                        // Indices
                        bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: indexBuffer.byteLength });
                        accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: indexBuffer.length, type: "SCALAR" });
                        totalBufferData.push(indexBuffer);
                        byteOffset += indexBuffer.byteLength;
                        primitives.push({
                            attributes: {
                                POSITION: accessors.length - 3,
                                NORMAL: accessors.length - 2
                            },
                            indices: accessors.length - 1,
                            material: materialMap.get(color)
                        });
                    });
                    if (primitives.length === 0) return undefined;
                    const meshIndex = meshes.length;
                    meshes.push({ primitives });
                    const nodeIndex = nodes.length;
                    nodes.push({ name: 'shrunk', mesh: meshIndex, extras: { type: 'shrunk' } });
                    return nodeIndex;
                };

                // Add nodes in strict order
                const partNodeIdx = addTypeMeshNode('part', typeToColorGroups.get('part'));
                const studNodeIdx = addTypeMeshNode('stud', typeToColorGroups.get('stud'));
                const antiStudNodeIdx = addTypeMeshNode('antistud', typeToColorGroups.get('antistud'));
                const partNoStudNodeIdx = addTypeMeshNode('partnostuds', typeToColorGroups.get('part'), g => !g.fromStudPrimitive);
                const shrunkNodeIdx = addShrunkMeshNode(typeToColorGroups.get('part'));
                // Convex from part-no-studs
                const addConvexMeshNode = (geoms) => {
                    const convex = computeConvexHullFromGeoms(geoms);
                    if (!convex) return undefined;
                    const color = convex.color;
                    if (!materialMap.has(color)) {
                        const r = ((color >> 16) & 0xff) / 255;
                        const g = ((color >> 8) & 0xff) / 255;
                        const b = (color & 0xff) / 255;
                        materials.push({
                            pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1.0], metallicFactor: 0.0, roughnessFactor: 0.7 },
                            name: `color_${color.toString(16).padStart(6, '0')}`
                        });
                        materialMap.set(color, materialIndex++);
                    }
                    const vertexBuffer = new Float32Array(convex.vertices);
                    const normalBuffer = new Float32Array(convex.normals);
                    const indexBuffer = new Uint16Array(convex.indices);
                    // Position
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: vertexBuffer.byteLength });
                    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: vertexBuffer.length / 3, type: 'VEC3', min: getMin(Array.from(vertexBuffer), 3), max: getMax(Array.from(vertexBuffer), 3) });
                    totalBufferData.push(vertexBuffer);
                    byteOffset += vertexBuffer.byteLength;
                    // Normal
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: normalBuffer.byteLength });
                    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: normalBuffer.length / 3, type: 'VEC3' });
                    totalBufferData.push(normalBuffer);
                    byteOffset += normalBuffer.byteLength;
                    // Indices
                    bufferViews.push({ buffer: 0, byteOffset: byteOffset, byteLength: indexBuffer.byteLength });
                    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: indexBuffer.length, type: 'SCALAR' });
                    totalBufferData.push(indexBuffer);
                    byteOffset += indexBuffer.byteLength;
                    const primitives = [{ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: materialMap.get(color) }];
                    const meshIndex = meshes.length;
                    meshes.push({ primitives });
                    const nodeIndex = nodes.length;
                    nodes.push({ name: 'convex', mesh: meshIndex, extras: { type: 'convex' } });
                    return nodeIndex;
                };
                let partNoStudGeomsArr = [];
                const partColorMapForConvex = typeToColorGroups.get('part');
                if (partColorMapForConvex && partColorMapForConvex.size > 0) {
                    partColorMapForConvex.forEach(geoms => {
                        geoms.forEach(g => { if (!g.fromStudPrimitive) partNoStudGeomsArr.push(g); });
                    });
                }
                const convexNodeIdx = addConvexMeshNode(partNoStudGeomsArr);

                const orderedChildren = [];
                if (partNodeIdx !== undefined) orderedChildren.push(partNodeIdx);
                if (studNodeIdx !== undefined) orderedChildren.push(studNodeIdx);
                if (antiStudNodeIdx !== undefined) orderedChildren.push(antiStudNodeIdx);
                if (partNoStudNodeIdx !== undefined) orderedChildren.push(partNoStudNodeIdx);
                if (shrunkNodeIdx !== undefined) orderedChildren.push(shrunkNodeIdx);
                if (convexNodeIdx !== undefined) orderedChildren.push(convexNodeIdx);
                rootNode.children = orderedChildren;

                // Combine buffers
                const totalSize = totalBufferData.reduce((sum, buf) => sum + buf.byteLength, 0);
                const bufferData = new ArrayBuffer(totalSize);
                const view = new Uint8Array(bufferData);
                let offset = 0;
                totalBufferData.forEach(buf => {
                    view.set(new Uint8Array(buf.buffer), offset);
                    offset += buf.byteLength;
                });

                const base64Data = Buffer.from(bufferData).toString('base64');
                const dataUri = `data:application/octet-stream;base64,${base64Data}`;

                const gltf = {
                    asset: { version: "2.0", generator: "LDraw Batch to GLTF Converter (individual)" },
                    scene: 0,
                    scenes: [{ nodes: [0] }],
                    nodes: nodes,
                    meshes: meshes,
                    materials: materials,
                    accessors: accessors,
                    bufferViews: bufferViews,
                    buffers: [{ uri: dataUri, byteLength: bufferData.byteLength }]
                };

                // Safe filename per part
                const safeDesc = this.makeFileSafeDescription(piece.description);
                const baseName = safeDesc ? `${piece.partNumber}_${safeDesc}.gltf` : `${piece.partNumber}.gltf`;
                let outPath = path.join(outputDirectory, baseName);
                fs.writeFileSync(outPath, JSON.stringify(gltf, null, 2));
                writtenCount++;
            } catch (e) {
                console.warn(`Failed to export individual GLTF for ${piece.partNumber}:`, e);
            }
        }

        console.log(`Saved ${writtenCount} individual GLTF files to: ${outputDirectory}`);
    }
}

// Command-line interface
async function main() {
    const args = process.argv.slice(2);

    // Parse only one flag syntax: --max N
    let maxPieces = null;
    const positionals = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--max') {
            const next = args[i + 1];
            if (!next || next.startsWith('-')) {
                console.error('Missing value for --max');
                process.exit(1);
            }
            maxPieces = parseInt(next, 10);
            if (Number.isNaN(maxPieces) || maxPieces <= 0) {
                console.error('Invalid value for --max. It must be a positive integer.');
                process.exit(1);
            }
            i++; // consume value
        } else {
            positionals.push(arg);
        }
    }

    if (positionals.length < 1) {
        console.log('Usage: node ldraw-to-gltf-batch.js <piece_list_auto.csv> [output.gltf] [parts-library-path] [--max N]');
        console.log('Example: node ldraw-to-gltf-batch.js piece_list_auto.csv all_pieces.gltf /path/to/ldraw/library --max 100');
        process.exit(1);
    }

    const pieceListFile = positionals[0];
    const outputFile = positionals[1] || 'all_pieces.gltf';
    const partsPath = positionals[2] || process.env.LDRAW_LIBRARY_PATH || path.join(__dirname, '../public/apps/ldraw');

    if (!fs.existsSync(pieceListFile)) {
        console.error(`Piece list file not found: ${pieceListFile}`);
        process.exit(1);
    }

    if (partsPath && !fs.existsSync(partsPath)) {
        console.warn(`Parts library not found at: ${partsPath}`);
        console.warn('Will try to find parts in default locations');
    }

    console.log(`Reading piece list from: ${pieceListFile}`);
    if (partsPath) {
        console.log(`Using parts library: ${partsPath}`);
    }
    
    const parser = new LDrawBatchParser(partsPath);
    
    try {
        await parser.processAllPieces(pieceListFile, maxPieces);
        await parser.exportBatchToGLTF(outputFile);
        // Also export each piece individually to an 'individual' subfolder next to the output
        const individualDir = path.join(path.dirname(outputFile), 'individual');
        await parser.exportIndividualPieces(individualDir);
        
        console.log('Batch conversion complete!');
        
    } catch (error) {
        console.error('Error during batch conversion:', error);
        process.exit(1);
    }
}

// Run the program if called directly
if (require.main === module) {
    main();
}

module.exports = { LDrawBatchParser };