#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { LDrawParserAdvanced } = require('./ldraw-to-gltf-advanced.js');

// Extended parser for batch processing
class LDrawBatchParser extends LDrawParserAdvanced {
    constructor(partsLibraryPath) {
        super(partsLibraryPath);
        this.pieces = []; // Store all pieces data
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
                    const merged = this.calculateSmoothNormalsAndMerge(vertices, indices);
                    
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
                        min: this.getMin(merged.vertices, 3),
                        max: this.getMax(merged.vertices, 3)
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

            // Create nodes in strict order: part -> stud -> antistud -> partnostuds
            const partNodeIdx = addTypeMeshNode('part', typeToColorGroups.get('part'));
            const studNodeIdx = addTypeMeshNode('stud', typeToColorGroups.get('stud'));
            const antiStudNodeIdx = addTypeMeshNode('antistud', typeToColorGroups.get('antistud'));
            const partNoStudNodeIdx = addTypeMeshNode('partnostuds', typeToColorGroups.get('part'), g => !g.fromStudPrimitive);

            const orderedChildren = [];
            if (partNodeIdx !== undefined) orderedChildren.push(partNodeIdx);
            if (studNodeIdx !== undefined) orderedChildren.push(studNodeIdx);
            if (antiStudNodeIdx !== undefined) orderedChildren.push(antiStudNodeIdx);
            if (partNoStudNodeIdx !== undefined) orderedChildren.push(partNoStudNodeIdx);
            pieceNode.children = orderedChildren;
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