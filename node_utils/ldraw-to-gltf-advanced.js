#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const math = require('./ldraw/math');
const processing = require('./processing');
const gltfExporter = require('./exporter');
const shadow = require('./ldraw/shadow');
const ldrawLoader = require('./ldraw/ldrawLoader');

// Extended parser that can load actual part files and extract stud positions
class LDrawParserAdvanced {
    constructor(partsLibraryPath) {
        this.partsLibraryPath = partsLibraryPath || '';
        this.partsCache = new Map();
        this.searchPaths = [
            'parts',
            'p', 
            'models',
            'parts/s',
            'p/48'
        ];
        
        // Known stud primitives
        this.studPrimitives = [
            'stud.dat',
            'studa.dat',
            'stud26.dat',
            'studp01.dat',
            'studel.dat',
            'stud10.dat',
            'stud15.dat',
            'stud13.dat',
            'stud2.dat',
            'stud2a.dat',
            'stud17.dat',
            'stud17a.dat',
            'stud9.dat',
            'studh.dat',
            'studhr.dat',
            'studhl.dat',
            'stud6.dat',
            'stud6a.dat',

            'stud-logo.dat',
            'stud-logo2.dat',
            'stud-logo3.dat',
            'stud-logo4.dat',
            'stud-logo5.dat',
            'stud2-logo.dat',
            'stud2-logo2.dat',
            'stud2-logo3.dat',
            'stud2-logo4.dat',
            'stud2-logo5.dat',
        ];
        
        this.materials = {};
        this.studData = [];
        this.antiStudData = [];
        this.miniAntiStudData = [];
        this.geometries = [];
        this.nextNodeIndex = 0;
        
        // LDCad Shadow Library integration
        this.shadowLibraryPath = path.join(__dirname, '../public/apps/LDCadShadowLibrary');
        this.shadowCache = new Map();
        
        // BFC (Back Face Culling) state tracking
        this.bfcState = {
            certified: 'UNKNOWN',  // 'TRUE', 'FALSE', 'UNKNOWN'
            localCull: true,       // Local culling state
            winding: 'CCW',        // 'CCW' or 'CW'
            invertNext: false      // INVERTNEXT flag
        };
        
        // Debug flag
        this.debugBFC = false;

        // Parts to skip entirely during export (by numeric part ID prefix)
        // Example: '92438' will skip files like '92438.dat' or '92438p01.dat'
        this.skipPartIds = new Set(['92438']);
    }

    // Find a part file in the library (delegated)
    findPartFile(filename) { return ldrawLoader.findPartFile.call(this, filename); }

    // Parse an LDraw line (delegated)
    parseLine(line) { return ldrawLoader.parseLine.call(this, line); }

    // Process an LDraw file (delegated)
    async processFile(filePath, transformMatrix = null, depth = 0, accumCull = true, accumInvert = false, withinStudContext = false) {
        return ldrawLoader.processFile.call(this, filePath, transformMatrix, depth, accumCull, accumInvert, withinStudContext);
    }

    // Handle sub-file loading (delegated)
    async handleSubfile(cmd, parentTransform, depth, accumCull, accumInvert, parentWithinStudContext = false) {
        return ldrawLoader.handleSubfile.call(this, cmd, parentTransform, depth, accumCull, accumInvert, parentWithinStudContext);
    }

    // Check if a filename is a stud primitive. We use this ONLY to mark geometry context
    // so it can be excluded from 'partnostuds'. We do NOT add stud positions from these
    // primitives to avoid double counting (SNAP_CYL already provides positions).
    checkStudPrimitive(filename) {
        const normalizedName = filename.toLowerCase().replace(/\\/g, '/');
        const basename = path.basename(normalizedName);
        if (this.studPrimitives && this.studPrimitives.includes(basename)) {
            return { type: 'stud', color: 0x00ff00, addPosition: false };
        }
        return null;
    }

    // Add stud position (delegated)
    addStudPosition(x, y, z, type, dir) { return ldrawLoader.addStudPosition.call(this, x, y, z, type, dir); }



    // Parse SNAP_CYL delegated to shadow module
    parseSnapCyl(line) { return shadow.parseSnapCyl.call(this, line); }

    // Delegated to shadow module
    appendShadowLibraryContent(mainFilePath, mainContent) { return shadow.appendShadowLibraryContent.call(this, mainFilePath, mainContent); }

    // Delegated to shadow module
    handleLDCadMetaLine(line, transformMatrix) { return shadow.handleLDCadMetaLine.call(this, line, transformMatrix); }



    // Anti-stud correction delegated to shadow module logic
    correctAntiStudAgainstStuds(worldPos) { return shadow.correctAntiStudAgainstStuds.call(this, worldPos); }

    // Marker cube generation delegated to loader helpers
    addStudMarkerGeometry(x, y, z, color) { return ldrawLoader.addStudMarkerGeometry.call(this, x, y, z, color); }
    addStudMarkerCube(x, y, z, axis, color) { return ldrawLoader.addStudMarkerCube.call(this, x, y, z, axis, color); }

    // Add triangle (delegated)
    addTriangle(cmd, transform, accumCull = false, accumInvert = false, withinStudContext = false) { return require('./ldraw/ldrawLoader').addTriangle.call(this, cmd, transform, accumCull, accumInvert, withinStudContext); }

    // Add quad (delegated)
    addQuad(cmd, transform, accumCull = false, accumInvert = false, withinStudContext = false) { return require('./ldraw/ldrawLoader').addQuad.call(this, cmd, transform, accumCull, accumInvert, withinStudContext); }

    // Removed fallback geometry box to ensure strict correctness

    // Calculate matrix determinant to detect reversals
    getMatrixDeterminant(matrix) {
        if (!matrix) return 1;
        
        // For LDraw transformation matrix [a b c d e f g h i x y z]
        // Calculate determinant of the 3x3 rotation/scale part
        const det = matrix.a * (matrix.e * matrix.i - matrix.f * matrix.h) -
                   matrix.b * (matrix.d * matrix.i - matrix.f * matrix.g) +
                   matrix.c * (matrix.d * matrix.h - matrix.e * matrix.g);
        
        return det;
    }

    // Delegated to loader (consolidated BFC helpers)
    processBfcCommands(bfcCommands, accumInvert = false) { return ldrawLoader.processBfcCommands.call(this, bfcCommands, accumInvert); }
    getEffectiveWinding(accumInvert) { return ldrawLoader.getEffectiveWinding.call(this, accumInvert); }

    

    // Get color value (delegated)
    getColorValue(colorCode) { return ldrawLoader.getColorValue.call(this, colorCode); }

    // Determine whether a referenced subfile/part should be skipped based on part ID list
    shouldSkipPart(filename) {
        if (!filename) return false;
        const normalizedName = filename.toLowerCase().replace(/\\/g, '/');
        const basename = path.basename(normalizedName);
        const match = basename.match(/^(\d+)/);
        if (!match) return false;
        const partId = match[1];
        return this.skipPartIds && this.skipPartIds.has(partId);
    }

    // Export to GLTF
    async exportToGLTF(outputPath) {
        const ir = {
            geometries: this.geometries,
                studs: this.studData,
                antiStuds: this.antiStudData,
            miniAntiStuds: this.miniAntiStudData,
        };
        const processed = processing.processIR(ir, { smoothAngle: 35 });
        gltfExporter.writeGLTF(processed, outputPath);
        console.log(`GLTF file saved to: ${outputPath}`);
    }

    // Rebuild markers and stud post-processing moved to processing module

    
}

// Attach shared math helpers to the class prototype so existing calls to this.* keep working
Object.assign(LDrawParserAdvanced.prototype, {
    transformPosition: math.transformPosition,
    transformDirection: math.transformDirection,
    transformVertices: math.transformVertices,
    applyThreeJSCoordinateTransform: math.applyThreeJSCoordinateTransform,
    multiplyMatrices: math.multiplyMatrices,
    getMatrixDeterminant: math.getMatrixDeterminant,
    addStudMarkerGeometry: ldrawLoader.addStudMarkerGeometry,
    addStudMarkerCube: ldrawLoader.addStudMarkerCube,
});

// Command-line interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node ldraw-to-gltf-advanced.js <input.ldr> [output.gltf] [parts-library-path]');
        console.log('Example: node ldraw-to-gltf-advanced.js model.ldr model.gltf /path/to/ldraw/library');
        process.exit(1);
    }

    const inputFile = args[0];
    const outputFile = args[1] || inputFile.replace(/\.[^.]+$/, '.gltf');
    const partsPath = args[2] || process.env.LDRAW_LIBRARY_PATH || '';

    if (!fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`);
        process.exit(1);
    }

    if (partsPath && !fs.existsSync(partsPath)) {
        console.warn(`Parts library not found at: ${partsPath}`);
        console.warn('Will only extract studs from parts directly referenced in the model');
    }

    console.log(`Parsing LDraw file: ${inputFile}`);
    if (partsPath) {
        console.log(`Using parts library: ${partsPath}`);
    }
    
    const parser = new LDrawParserAdvanced(partsPath);
    
    try {
        await parser.processFile(inputFile);
        
        console.log('Converting to GLTF...');
        await parser.exportToGLTF(outputFile);
        
        console.log('Conversion complete!');
        console.log(`- Found ${parser.studData.length} stud positions`);
        console.log(`- Found ${parser.antiStudData.length} anti-stud positions`);
        console.log(`- Stud positions are stored in the root node's extras.studs`);
        console.log(`- Anti-stud positions are stored in the root node's extras.antiStuds`);
        
    } catch (error) {
        console.error('Error during conversion:', error);
        process.exit(1);
    }
}

// Run the program if called directly
if (require.main === module) {
    main();
}

// Convenience loader to get IR directly (moved from loader/index.js)
async function loadLDrawToIR(inputFilePath, options = {}) {
    const parser = new LDrawParserAdvanced(options.partsLibraryPath || '');
    await parser.processFile(inputFilePath);
    return {
        geometries: parser.geometries,
        studs: parser.studData,
        antiStuds: parser.antiStudData,
        miniAntiStuds: parser.miniAntiStudData,
    };
}

module.exports = { LDrawParserAdvanced, loadLDrawToIR }; 