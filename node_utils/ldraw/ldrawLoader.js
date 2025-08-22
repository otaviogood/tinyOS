const fs = require('fs');
const path = require('path');

function findPartFile(filename) {
    filename = filename.toLowerCase().replace(/\\/g, '/');
    if (this.partsCache.has(filename)) return this.partsCache.get(filename);
    if (this.partsLibraryPath) {
        for (const searchPath of this.searchPaths) {
            const fullPath = path.join(this.partsLibraryPath, searchPath, filename);
            if (fs.existsSync(fullPath)) {
                this.partsCache.set(filename, fullPath);
                return fullPath;
            }
        }
    }
    return null;
}

function parseLine(line) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length === 0) return null;
    const lineType = parseInt(tokens[0]);
    if (isNaN(lineType)) return null;
    switch (lineType) {
        case 0: {
            const comment = tokens.slice(1).join(' ');
            if (comment.startsWith('BFC ')) {
                const bfcTokens = comment.split(/\s+/);
                const bfcCommands = [];
                for (let i = 1; i < bfcTokens.length; i++) {
                    const cmd = bfcTokens[i].toUpperCase();
                    switch (cmd) {
                        case 'CERTIFY':
                        case 'NOCERTIFY':
                        case 'CLIP':
                        case 'NOCLIP':
                        case 'CCW':
                        case 'CW':
                        case 'INVERTNEXT':
                            bfcCommands.push(cmd);
                            break;
                    }
                }
                if (bfcCommands.length > 0) {
                    return { type: 0, comment: comment, bfc: bfcCommands };
                }
            }
            return { type: 0, comment: comment };
        }
        case 1:
            if (tokens.length >= 15) {
                return {
                    type: 1,
                    color: parseInt(tokens[1]),
                    x: parseFloat(tokens[2]),
                    y: parseFloat(tokens[3]),
                    z: parseFloat(tokens[4]),
                    a: parseFloat(tokens[5]),
                    b: parseFloat(tokens[6]),
                    c: parseFloat(tokens[7]),
                    d: parseFloat(tokens[8]),
                    e: parseFloat(tokens[9]),
                    f: parseFloat(tokens[10]),
                    g: parseFloat(tokens[11]),
                    h: parseFloat(tokens[12]),
                    i: parseFloat(tokens[13]),
                    file: tokens.slice(14).join(' ').trim()
                };
            }
            break;
        case 3:
            if (tokens.length >= 11) {
                return {
                    type: 3,
                    color: parseInt(tokens[1]),
                    x1: parseFloat(tokens[2]),
                    y1: parseFloat(tokens[3]),
                    z1: parseFloat(tokens[4]),
                    x2: parseFloat(tokens[5]),
                    y2: parseFloat(tokens[6]),
                    z2: parseFloat(tokens[7]),
                    x3: parseFloat(tokens[8]),
                    y3: parseFloat(tokens[9]),
                    z3: parseFloat(tokens[10])
                };
            }
            break;
        case 4:
            if (tokens.length >= 14) {
                return {
                    type: 4,
                    color: parseInt(tokens[1]),
                    x1: parseFloat(tokens[2]),
                    y1: parseFloat(tokens[3]),
                    z1: parseFloat(tokens[4]),
                    x2: parseFloat(tokens[5]),
                    y2: parseFloat(tokens[6]),
                    z2: parseFloat(tokens[7]),
                    x3: parseFloat(tokens[8]),
                    y3: parseFloat(tokens[9]),
                    z3: parseFloat(tokens[10]),
                    x4: parseFloat(tokens[11]),
                    y4: parseFloat(tokens[12]),
                    z4: parseFloat(tokens[13])
                };
            }
            break;
    }
    return null;
}

async function handleSubfile(cmd, parentTransform, depth, accumCull, accumInvert, parentWithinStudContext = false) {
    // Skip parts on the caller-defined skip list
    if (this.shouldSkipPart && this.shouldSkipPart(cmd.file)) {
        return;
    }
    const localMatrix = { a: cmd.a, b: cmd.b, c: cmd.c, x: cmd.x, d: cmd.d, e: cmd.e, f: cmd.f, y: cmd.y, g: cmd.g, h: cmd.h, i: cmd.i, z: cmd.z };
    const combinedMatrix = parentTransform ? this.multiplyMatrices(parentTransform, localMatrix) : localMatrix;
    const studInfo = this.checkStudPrimitive ? this.checkStudPrimitive(cmd.file) : null;
    if (studInfo) {
        const worldX = combinedMatrix.x;
        const worldY = combinedMatrix.y;
        const worldZ = combinedMatrix.z;
        const worldAxis = this.transformDirection({ x: 0, y: 1, z: 0 }, combinedMatrix);
        // Only add stud position if the detector indicates it should; allow context-only marking
        if (studInfo.addPosition !== false) {
            this.addStudPosition(worldX, worldY, worldZ, studInfo.type, worldAxis);
        }
        this.addStudMarkerCube(worldX, worldY, worldZ, worldAxis, studInfo.color);
    }
    const matrixDet = this.getMatrixDeterminant(localMatrix);
    const matrixReversed = matrixDet < 0;
    const newAccumInvert = Boolean(accumInvert ^ this.bfcState.invertNext ^ matrixReversed);
    const partPath = this.findPartFile(cmd.file);
    if (partPath && depth < 10) {
        try {
            const newAccumCullState = (this.bfcState.certified === 'TRUE') ? (accumCull && this.bfcState.localCull) : false;
            const invertState = newAccumInvert;
            const withinStudContext = parentWithinStudContext || Boolean(studInfo);
            await this.processFile(partPath, combinedMatrix, depth + 1, newAccumCullState, invertState, withinStudContext);
        } catch (error) {
            console.warn(`Failed to load part ${cmd.file}:`, error.message);
        }
    }
}

async function processFile(filePath, transformMatrix = null, depth = 0, accumCull = true, accumInvert = false, withinStudContext = false) {
    if (depth > 10) { console.warn('Maximum recursion depth reached'); return; }
    let content = fs.readFileSync(filePath, 'utf8');
    content = this.appendShadowLibraryContent(filePath, content);
    const lines = content.split(/\r?\n/);
    const savedBfcState = { ...this.bfcState };
    this.bfcState = { certified: 'UNKNOWN', localCull: true, winding: 'CCW', invertNext: false };
    for (const line of lines) {
        if (this.handleLDCadMetaLine(line, transformMatrix)) continue;
        const cmd = this.parseLine(line);
        if (!cmd) continue;
        switch (cmd.type) {
            case 0:
                if (cmd.bfc) {
                    if (this.bfcState.certified === 'UNKNOWN' && !cmd.bfc.includes('NOCERTIFY')) {
                        this.bfcState.certified = 'TRUE';
                    }
                    this.processBfcCommands(cmd.bfc, accumInvert);
                }
                break;
            case 1:
                await this.handleSubfile(cmd, transformMatrix, depth, accumCull, accumInvert, withinStudContext);
                break;
            case 3:
                this.addTriangle(cmd, transformMatrix, accumCull, accumInvert, withinStudContext);
                break;
            case 4:
                this.addQuad(cmd, transformMatrix, accumCull, accumInvert, withinStudContext);
                break;
        }
        if (cmd.type !== 0 || !cmd.bfc || !cmd.bfc.includes('INVERTNEXT')) {
            this.bfcState.invertNext = false;
        }
    }
    this.bfcState = savedBfcState;
}

function addStudPosition(x, y, z, type, dir) {
    const transformedY = -y;
    const transformedZ = -z;
    const data = type === 'stud' ? this.studData : this.antiStudData;
    const tol = 0.1;
    const exists = data.some(e => Math.abs(e.x - x) < tol && Math.abs(e.y - transformedY) < tol && Math.abs(e.z - transformedZ) < tol);
    if (exists) return;
    if (dir && typeof dir.x === 'number' && typeof dir.y === 'number' && typeof dir.z === 'number') {
        data.push({ x, y: transformedY, z: transformedZ, dx: dir.x, dy: -dir.y, dz: -dir.z });
    } else {
        data.push({ x, y: transformedY, z: transformedZ });
    }
}

function getColorValue(colorCode) {
    const colorMap = {
        0: 0x000000,
        1: 0x0000ff,
        2: 0x00ff00,
        4: 0xff0000,
        5: 0xff00ff,
        14: 0xffff00,
        15: 0xffffff,
        16: 0x7f7f7f,
        24: 0x7f7f7f
    };
    return colorMap[colorCode] || 0x7f7f7f;
}

function addTriangle(cmd, transform, accumCull = false, accumInvert = false, withinStudContext = false) {
    const vertices = [cmd.x1, cmd.y1, cmd.z1, cmd.x2, cmd.y2, cmd.z2, cmd.x3, cmd.y3, cmd.z3];
    if (transform) this.transformVertices(vertices, transform);
    this.applyThreeJSCoordinateTransform(vertices);
    const shouldApplyBfc = accumCull && this.bfcState.localCull && (this.bfcState.certified === 'TRUE');
    let indices = [0, 1, 2];
    const effectiveWinding = this.getEffectiveWinding(accumInvert);
    if (effectiveWinding === 'CW') indices = [0, 2, 1];
    this.geometries.push({ vertices, indices, color: this.getColorValue(cmd.color), bfcEnabled: shouldApplyBfc, sourceType: 'part', fromStudPrimitive: Boolean(withinStudContext) });
}

function addQuad(cmd, transform, accumCull = false, accumInvert = false, withinStudContext = false) {
    const vertices = [cmd.x1, cmd.y1, cmd.z1, cmd.x2, cmd.y2, cmd.z2, cmd.x3, cmd.y3, cmd.z3, cmd.x4, cmd.y4, cmd.z4];
    if (transform) this.transformVertices(vertices, transform);
    this.applyThreeJSCoordinateTransform(vertices);
    const shouldApplyBfc = accumCull && this.bfcState.localCull && (this.bfcState.certified === 'TRUE');
    let indices = [0, 1, 2, 0, 2, 3];
    const effectiveWinding = this.getEffectiveWinding(accumInvert);
    if (effectiveWinding === 'CW') indices = [0, 2, 1, 0, 3, 2];
    this.geometries.push({ vertices, indices, color: this.getColorValue(cmd.color), bfcEnabled: shouldApplyBfc, sourceType: 'part', fromStudPrimitive: Boolean(withinStudContext) });
}

// Consolidated from node_utils/ldraw/bfc.js
function processBfcCommands(bfcCommands, accumInvert = false) {
	for (const cmd of bfcCommands) {
		switch (cmd) {
			case 'CERTIFY':
				this.bfcState.certified = 'TRUE';
				break;
			case 'NOCERTIFY':
				this.bfcState.certified = 'FALSE';
				break;
			case 'CLIP':
				this.bfcState.localCull = true;
				break;
			case 'NOCLIP':
				this.bfcState.localCull = false;
				break;
			case 'CCW':
				this.bfcState.winding = 'CCW';
				break;
			case 'CW':
				this.bfcState.winding = 'CW';
				break;
			case 'INVERTNEXT':
				this.bfcState.invertNext = true;
				break;
		}
	}
}

function getEffectiveWinding(accumInvert) {
	let effectiveWinding = this.bfcState.winding;
	if (accumInvert) {
		effectiveWinding = effectiveWinding === 'CCW' ? 'CW' : 'CCW';
	}
	return effectiveWinding;
}

// Consolidated from node_utils/ldraw/geometry.js
function addStudMarkerGeometry(x, y, z, color) {
	this.addStudMarkerCube(x, y, z, { x: 0, y: 1, z: 0 }, color);
}

function addStudMarkerCube(x, y, z, axis, color) {
	const ax = axis || { x: 0, y: 1, z: 0 };
	const len = Math.hypot(ax.x, ax.y, ax.z) || 1;
	const nAxis = { x: ax.x / len, y: ax.y / len, z: ax.z / len };
	const helper = Math.abs(nAxis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
	const sx = nAxis.y * helper.z - nAxis.z * helper.y;
	const sy = nAxis.z * helper.x - nAxis.x * helper.z;
	const sz = nAxis.x * helper.y - nAxis.y * helper.x;
	const slen = Math.hypot(sx, sy, sz) || 1;
	const side1 = { x: sx / slen, y: sy / slen, z: sz / slen };
	const side2 = {
		x: nAxis.y * side1.z - nAxis.z * side1.y,
		y: nAxis.z * side1.x - nAxis.x * side1.z,
		z: nAxis.x * side1.y - nAxis.y * side1.x
	};
	const hx = 2, hy = 2, hz = 4;
	const corners = [
		{ u: -hx*2, v: -hy*2, w: -hz },
		{ u:  hx*2, v: -hy*2, w: -hz },
		{ u:  hx*2, v:  hy*2, w: -hz },
		{ u: -hx*2, v:  hy*2, w: -hz },
		{ u: -hx, v: -hy, w:  hz },
		{ u:  hx, v: -hy, w:  hz },
		{ u:  hx, v:  hy, w:  hz },
		{ u: -hx, v:  hy, w:  hz }
	];
	const vertices = [];
	corners.forEach(c => {
		const vx = x + c.u * side1.x + c.v * side2.x + c.w * nAxis.x;
		const vy = y + c.u * side1.y + c.v * side2.y + c.w * nAxis.y;
		const vz = z + c.u * side1.z + c.v * side2.z + c.w * nAxis.z;
		vertices.push(vx, vy, vz);
	});
	this.applyThreeJSCoordinateTransform(vertices);
	const indices = [
		0,1,2, 0,2,3,
		4,6,5, 4,7,6,
		0,4,5, 0,5,1,
		2,6,7, 2,7,3,
		0,3,7, 0,7,4,
		1,5,6, 1,6,2
	];
	const sourceType = (color === 0x00ff00) ? 'stud' : (color === 0xff0000 ? 'antistud' : 'part');
	const markerCenterThree = { x: x, y: -y, z: -z };
	this.geometries.push({
		vertices, indices, color,
		sourceType,
		isMarker: (sourceType === 'stud' || sourceType === 'antistud'),
		markerCenterThree
	});
}

module.exports = {
    findPartFile,
    parseLine,
    processFile,
    handleSubfile,
    addStudPosition,
    getColorValue,
    addTriangle,
    addQuad,
    // Consolidated from ../ldraw/bfc.js
    processBfcCommands,
    getEffectiveWinding,
    // Consolidated from ../ldraw/geometry.js
    addStudMarkerGeometry,
    addStudMarkerCube,
};



