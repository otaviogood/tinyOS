#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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
        this.geometries = [];
        this.nextNodeIndex = 0;
        
        // LDCad Shadow Library integration
        this.shadowLibraryPath = path.join(__dirname, '../public/apps/LDCadShadowLibrary-main');
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
    }

    // Find a part file in the library
    findPartFile(filename) {
        // Clean filename
        filename = filename.toLowerCase().replace(/\\/g, '/');
        
        // Check cache first
        if (this.partsCache.has(filename)) {
            return this.partsCache.get(filename);
        }

        // If we have a parts library path, search there
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

    // Parse an LDraw line
    parseLine(line) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length === 0) return null;

        const lineType = parseInt(tokens[0]);
        if (isNaN(lineType)) return null;

        switch (lineType) {
            case 0: // Comment
                const comment = tokens.slice(1).join(' ');
                
                // Parse BFC meta-statements
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
                
            case 1: // Sub-file reference
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
                
            case 3: // Triangle
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
                
            case 4: // Quad
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

    // Process an LDraw file and extract geometry and stud positions
    async processFile(filePath, transformMatrix = null, depth = 0, accumCull = true, accumInvert = false, withinStudContext = false) {
        // Prevent infinite recursion
        if (depth > 10) {
            console.warn('Maximum recursion depth reached');
            return;
        }

        let content = fs.readFileSync(filePath, 'utf8');
        
        // Append shadow library content if it exists (like LDCad does)
        content = this.appendShadowLibraryContent(filePath, content);
        
        const lines = content.split(/\r?\n/);
        
        // Save current BFC state to restore later
        const savedBfcState = { ...this.bfcState };
        
        // Reset BFC state for this file
        this.bfcState = {
            certified: 'UNKNOWN',
            localCull: true,
            winding: 'CCW',
            invertNext: false
        };

        for (const line of lines) {
            // Check for LDCad shadow library meta lines
            if (this.handleLDCadMetaLine(line, transformMatrix)) {
                continue;
            }
            
            const cmd = this.parseLine(line);
            if (!cmd) continue;

            switch (cmd.type) {
                case 0: // Comment/BFC command
                    if (cmd.bfc) {
                        // If this is the first BFC command and it's not NOCERTIFY, mark as certified
                        if (this.bfcState.certified === 'UNKNOWN' && !cmd.bfc.includes('NOCERTIFY')) {
                            this.bfcState.certified = 'TRUE';
                        }
                        this.processBfcCommands(cmd.bfc, accumInvert);
                    }
                    break;
                    
                case 1: // Sub-file reference
                    await this.handleSubfile(cmd, transformMatrix, depth, accumCull, accumInvert, withinStudContext);
                    break;
                    
                case 3: // Triangle
                    this.addTriangle(cmd, transformMatrix, accumCull, accumInvert, withinStudContext);
                    break;
                    
                case 4: // Quad
                    this.addQuad(cmd, transformMatrix, accumCull, accumInvert, withinStudContext);
                    break;
            }
            
            // Reset INVERTNEXT flag after non-BFC commands
            if (cmd.type !== 0 || !cmd.bfc || !cmd.bfc.includes('INVERTNEXT')) {
                this.bfcState.invertNext = false;
            }
        }
        
        // Restore previous BFC state
        this.bfcState = savedBfcState;
    }

    // Handle sub-file loading
    async handleSubfile(cmd, parentTransform, depth, accumCull, accumInvert, parentWithinStudContext = false) {
        // Create local transformation matrix
        const localMatrix = {
            a: cmd.a, b: cmd.b, c: cmd.c, x: cmd.x,
            d: cmd.d, e: cmd.e, f: cmd.f, y: cmd.y,
            g: cmd.g, h: cmd.h, i: cmd.i, z: cmd.z
        };

        // Combine with parent transform if exists
        const combinedMatrix = parentTransform ? 
            this.multiplyMatrices(parentTransform, localMatrix) : 
            localMatrix;

        // Check if this is a stud primitive
        const studInfo = this.checkStudPrimitive(cmd.file);
        if (studInfo) {
            // Extract world position from combined matrix
            const worldX = combinedMatrix.x;
            const worldY = combinedMatrix.y;
            const worldZ = combinedMatrix.z;

            // Derive stud axis from combined transform (local +Y)
            const worldAxis = this.transformDirection({ x: 0, y: 1, z: 0 }, combinedMatrix);

            this.addStudPosition(worldX, worldY, worldZ, studInfo.type, worldAxis);

            // Add visual marker geometry (cube) oriented along world axis
            this.addStudMarkerCube(worldX, worldY, worldZ, worldAxis, studInfo.color);
            
            // Continue processing to include the actual stud geometry as well
        }

        // Shadow library data is now automatically appended to files during loading
        // No need for separate processing here

        // Check for matrix inversion
        const matrixDet = this.getMatrixDeterminant(localMatrix);
        const matrixReversed = matrixDet < 0;
        
        // Determine new accumulation state
        // Accumulate inversion: parent invert XOR INVERTNEXT XOR matrix reversal
        const newAccumInvert = Boolean(accumInvert ^ this.bfcState.invertNext ^ matrixReversed);
        
        // Try to load the actual part file if it exists
        const partPath = this.findPartFile(cmd.file);
        if (partPath && depth < 10) {
            try {
                // Follow spec pseudo-code: only propagate culling if current file is certified
                const newAccumCullState = (this.bfcState.certified === 'TRUE')
                    ? (accumCull && this.bfcState.localCull)
                    : false;
                // Propagate inversion to all subfiles, including main parts.
                // This ensures mirrored references (negative determinant) flip winding/normals per BFC.
                const invertState = newAccumInvert;
                const withinStudContext = parentWithinStudContext || Boolean(studInfo);
                
                await this.processFile(partPath, combinedMatrix, depth + 1, newAccumCullState, invertState, withinStudContext);
            } catch (error) {
                console.warn(`Failed to load part ${cmd.file}:`, error.message);
            }
        } else if (!partPath) {
            // For parts we can't find, add a simple box, except if it's a known stud primitive
            // In that case, skip adding fallback geometry so it doesn't leak into 'partnostuds'
            if (!studInfo) {
                this.addFallbackBox(combinedMatrix, cmd.color);
            }
        }
    }

    // Check if a filename is a stud primitive (only for top studs - anti-studs come from shadow library)
    checkStudPrimitive(filename) {
        const normalizedName = filename.toLowerCase().replace(/\\/g, '/');
        const basename = path.basename(normalizedName);
        
        if (this.studPrimitives.includes(basename)) {
            return { type: 'stud', color: 0x00ff00 };
        }
        
        // Anti-stud detection now handled by LDCad Shadow Library integration
        return null;
    }

    // Add stud position to the data (optionally with direction vector)
    addStudPosition(x, y, z, type, dir) {
        // Apply coordinate transformation to match Three.js coordinate system
        const transformedY = -y;
        const transformedZ = -z;
        
        const data = type === 'stud' ? this.studData : this.antiStudData;
        if (dir && typeof dir.x === 'number' && typeof dir.y === 'number' && typeof dir.z === 'number') {
            // Flatten direction fields at top-level as dx, dy, dz; apply Y/Z flip to match Three.js
            data.push({ x, y: transformedY, z: transformedZ, dx: dir.x, dy: -dir.y, dz: -dir.z });
        } else {
            data.push({ x, y: transformedY, z: transformedZ });
        }
    }



    // Parse SNAP_CYL metadata line
    parseSnapCyl(line) {
        const params = {};
        const paramMatches = line.matchAll(/\[([^=]+)=([^\]]+)\]/g);
        
        for (const match of paramMatches) {
            const key = match[1].trim();
            const value = match[2].trim();
            params[key] = value;
        }

        if (!params.pos) return null;

        // Parse position
        const posValues = params.pos.split(/\s+/).map(Number);
        const basePos = { x: posValues[0], y: posValues[1], z: posValues[2] };

        const positions = [];

        // Handle grid specification
        if (params.grid) {
            let cols, rows, spacingX, spacingZ;
            let centerX = false;
            let centerZ = false;

            // Support LDCad syntax: [C] <cols> [C] <rows> <dx> <dz>
            const tokens = params.grid.trim().split(/\s+/);
            let idx = 0;
            if (tokens[idx] && tokens[idx].toUpperCase() === 'C') {
                centerX = true; idx++;
            }
            if (tokens.length >= idx + 1) {
                cols = parseInt(tokens[idx++]);
            }
            if (tokens[idx] && tokens[idx].toUpperCase() === 'C') {
                centerZ = true; idx++;
            }
            if (tokens.length >= idx + 3) {
                rows = parseInt(tokens[idx++]);
                spacingX = parseFloat(tokens[idx++]);
                spacingZ = parseFloat(tokens[idx++]);
            }

            if (Number.isFinite(cols) && Number.isFinite(rows) &&
                Number.isFinite(spacingX) && Number.isFinite(spacingZ)) {
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const offsetX = centerX
                            ? (col - (cols - 1) / 2) * spacingX
                            : col * spacingX;
                        const offsetZ = centerZ
                            ? (row - (rows - 1) / 2) * spacingZ
                            : row * spacingZ;
                        const x = basePos.x + offsetX;
                        const y = basePos.y;
                        const z = basePos.z + offsetZ;
                        positions.push({ x, y, z });
                    }
                }
            } else {
                // Fallback to single position if grid parsing failed
                positions.push(basePos);
            }
        } else {
            // Single position
            positions.push(basePos);
        }

        // Orientation (3x3) if provided
        let oriMatrix = null;
        if (params.ori) {
            const nums = params.ori.split(/\s+/).map(Number).filter(n => Number.isFinite(n));
            if (nums.length === 9) {
                oriMatrix = {
                    a: nums[0], b: nums[1], c: nums[2],
                    d: nums[3], e: nums[4], f: nums[5],
                    g: nums[6], h: nums[7], i: nums[8]
                };
            }
        }

        // Determine approximate total length from secs or length param
        let totalLength = 0;
        if (params.length) {
            const lenVal = parseFloat(params.length);
            if (Number.isFinite(lenVal)) totalLength = Math.abs(lenVal);
        } else if (params.secs) {
            const tokens = params.secs.trim().split(/\s+/);
            const nums = tokens.map(t => parseFloat(t)).filter(n => Number.isFinite(n));
            // Assume pairs of (radius, length) after each code; sum the second of each pair
            for (let i = 1; i < nums.length; i += 2) {
                totalLength += Math.abs(nums[i]);
            }
        }

        const center = String(params.center).toLowerCase() === 'true';

        return {
            gender: params.gender || 'M',
            positions: positions,
            ori: oriMatrix,
            center,
            length: totalLength
        };
    }

    // Append shadow library content to main file content (like LDCad does)
    appendShadowLibraryContent(mainFilePath, mainContent) {
        // Get the relative path from the parts library root
        const relativePath = path.relative(this.partsLibraryPath, mainFilePath);
        const shadowPath = path.join(this.shadowLibraryPath, relativePath);
        
        try {
            if (fs.existsSync(shadowPath)) {
                const shadowContent = fs.readFileSync(shadowPath, 'utf8');
                console.log(`✅ Appending shadow library data for ${path.basename(mainFilePath)}`);
                return mainContent + '\n' + shadowContent;
            }
        } catch (error) {
            // Silently ignore missing shadow files - this is normal
        }
        
        return mainContent;
    }

    // Handle LDCad meta lines in the content
    handleLDCadMetaLine(line, transformMatrix) {
        const trimmed = line.trim();
        
        // Handle SNAP_CYL metadata
        if (trimmed.includes('!LDCAD SNAP_CYL')) {
            const snapInfo = this.parseSnapCyl(trimmed);
            if (snapInfo) {
                snapInfo.positions.forEach(pos => {
                    // Compute world orientation axis (cylinder axis is ori * (0,1,0)) if ori given
                    let axisLocal = { x: 0, y: 1, z: 0 };
                    if (snapInfo.ori) {
                        axisLocal = {
                            x: snapInfo.ori.b, // second column corresponds to local +Y
                            y: snapInfo.ori.e,
                            z: snapInfo.ori.h
                        };
                    }
                    // Apply parent transform to axis
                    const worldAxis = transformMatrix ? this.transformDirection(axisLocal, transformMatrix) : axisLocal;
                    // Use LDCad provided pos as the snap center
                    const posAdj = pos;
                    if (snapInfo.gender === 'F') {
                        // Female snaps are anti-studs (holes)
                        if (transformMatrix) {
                            let worldPos = this.transformPosition(posAdj, transformMatrix);
                            // If length and center are provided, move to end-face center (flush)
                            if (snapInfo.center && Number.isFinite(snapInfo.length) && snapInfo.length > 0) {
                                const half = snapInfo.length * 0.5;
                                worldPos = {
                                    x: worldPos.x - worldAxis.x * half,
                                    y: worldPos.y - worldAxis.y * half,
                                    z: worldPos.z - worldAxis.z * half
                                };
                            }
                            worldPos = this.correctAntiStudAgainstStuds(worldPos);
                            this.addStudPosition(worldPos.x, worldPos.y, worldPos.z, 'antiStud', worldAxis);
                            this.addStudMarkerCube(worldPos.x, worldPos.y, worldPos.z, worldAxis, 0xff0000);
                        } else {
                            // No transform: adjust along axis if center/length known
                            let p = posAdj;
                            if (snapInfo.center && Number.isFinite(snapInfo.length) && snapInfo.length > 0) {
                                const half = snapInfo.length * 0.5;
                                p = { x: p.x - worldAxis.x * half, y: p.y - worldAxis.y * half, z: p.z - worldAxis.z * half };
                            }
                            this.addStudPosition(p.x, p.y, p.z, 'antiStud', worldAxis);
                            this.addStudMarkerCube(p.x, p.y, p.z, worldAxis, 0xff0000);
                        }
                    } else {
                        // Male snaps are studs
                        if (transformMatrix) {
                            const worldPos = this.transformPosition(posAdj, transformMatrix);
                            this.addStudPosition(worldPos.x, worldPos.y, worldPos.z, 'stud', worldAxis);
                            this.addStudMarkerCube(worldPos.x, worldPos.y, worldPos.z, worldAxis, 0x00ff00);
                        } else {
                            const p = posAdj;
                            this.addStudPosition(p.x, p.y, p.z, 'stud', worldAxis);
                            this.addStudMarkerCube(p.x, p.y, p.z, worldAxis, 0x00ff00);
                        }
                    }
                });
            }
            return true;
        }
        
        return false;
    }



    // Transform a position using the transformation matrix
    transformPosition(pos, matrix) {
        // Apply transformation matrix to position
        const x = pos.x * matrix.a + pos.y * matrix.b + pos.z * matrix.c + matrix.x;
        const y = pos.x * matrix.d + pos.y * matrix.e + pos.z * matrix.f + matrix.y;
        const z = pos.x * matrix.g + pos.y * matrix.h + pos.z * matrix.i + matrix.z;
        
        return { x, y, z };
    }

    // Transform a direction vector using the rotation part of the matrix
    transformDirection(dir, matrix) {
        const x = dir.x * matrix.a + dir.y * matrix.b + dir.z * matrix.c;
        const y = dir.x * matrix.d + dir.y * matrix.e + dir.z * matrix.f;
        const z = dir.x * matrix.g + dir.y * matrix.h + dir.z * matrix.i;
        const len = Math.hypot(x, y, z) || 1;
        return { x: x / len, y: y / len, z: z / len };
    }

    // Heuristic correction for anti-stud SNAP positions against existing stud positions
    correctAntiStudAgainstStuds(worldPos) {
        // Convert to Three.js-style coords used in studData (Y,Z flipped)
        const posThree = { x: worldPos.x, y: -worldPos.y, z: -worldPos.z };
        const tol = 0.25; // LDU tolerance for matching x/y stacks
        const match = this.studData.find(s => Math.abs(s.x - posThree.x) < tol && Math.abs(s.y - posThree.y) < tol);
        if (!match) return worldPos;
        // Mirror across dominant lateral axis so anti-stud sits opposite the stud
        const corrected = { ...posThree };
        const absX = Math.abs(match.x);
        const absZ = Math.abs(match.z);
        if (absZ > absX && absZ > tol) {
            corrected.z = -match.z;
        } else if (absX > tol) {
            corrected.x = -match.x;
        } else {
            return worldPos;
        }
        // Convert back to LDraw space (invert Y and Z)
        return { x: corrected.x, y: -corrected.y, z: -corrected.z };
    }

    // Add visual marker geometry for stud
    addStudMarkerGeometry(x, y, z, color) {
        // Fallback: build a small cube without orientation axis
        this.addStudMarkerCube(x, y, z, { x: 0, y: 1, z: 0 }, color);
    }

    // Add visual marker geometry as a small cube oriented along given axis
    addStudMarkerCube(x, y, z, axis, color) {
        // Build an orthonormal basis from axis
        const ax = axis || { x: 0, y: 1, z: 0 };
        const len = Math.hypot(ax.x, ax.y, ax.z) || 1;
        const nAxis = { x: ax.x / len, y: ax.y / len, z: ax.z / len };
        // Choose a helper vector not parallel to axis
        const helper = Math.abs(nAxis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
        // side1 = normalize(cross(axis, helper))
        const sx = nAxis.y * helper.z - nAxis.z * helper.y;
        const sy = nAxis.z * helper.x - nAxis.x * helper.z;
        const sz = nAxis.x * helper.y - nAxis.y * helper.x;
        const slen = Math.hypot(sx, sy, sz) || 1;
        const side1 = { x: sx / slen, y: sy / slen, z: sz / slen };
        // side2 = cross(axis, side1)
        const side2 = {
            x: nAxis.y * side1.z - nAxis.z * side1.y,
            y: nAxis.z * side1.x - nAxis.x * side1.z,
            z: nAxis.x * side1.y - nAxis.y * side1.x
        };
        // Half sizes (elongated box so orientation is visible)
        const hx = 2, hy = 2, hz = 4; // main axis = w -> elongated along axis
        // 8 corners in local basis coords
        const corners = [
            { u: -hx, v: -hy, w: -hz },
            { u:  hx, v: -hy, w: -hz },
            { u:  hx, v:  hy, w: -hz },
            { u: -hx, v:  hy, w: -hz },
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
        // Flip to Three.js coords
        this.applyThreeJSCoordinateTransform(vertices);
        // Cube indices (12 triangles)
        const indices = [
            0,1,2, 0,2,3, // front
            4,6,5, 4,7,6, // back
            0,4,5, 0,5,1, // bottom
            2,6,7, 2,7,3, // top
            0,3,7, 0,7,4, // left
            1,5,6, 1,6,2  // right
        ];
        const sourceType = (color === 0x00ff00) ? 'stud' : (color === 0xff0000 ? 'antistud' : 'part');
        // Track center in Three.js space for potential post-corrections
        const markerCenterThree = { x: x, y: -y, z: -z };
        this.geometries.push({
            vertices, indices, color,
            sourceType,
            isMarker: (sourceType === 'stud' || sourceType === 'antistud'),
            markerCenterThree
        });
    }

    // Add triangle
    addTriangle(cmd, transform, accumCull = false, accumInvert = false, withinStudContext = false) {
        const vertices = [
            cmd.x1, cmd.y1, cmd.z1,
            cmd.x2, cmd.y2, cmd.z2,
            cmd.x3, cmd.y3, cmd.z3
        ];
        
        if (transform) {
            this.transformVertices(vertices, transform);
        }
        
        // Apply coordinate transformation to match Three.js coordinate system
        this.applyThreeJSCoordinateTransform(vertices);
        
        // Determine if we should cull based on BFC state
        const shouldApplyBfc = accumCull && this.bfcState.localCull && 
                              (this.bfcState.certified === 'TRUE');
        
        let indices = [0, 1, 2];
        
        // Always correct triangle orientation for accumulated inversion/sign so GLTF faces outward consistently
        {
            const effectiveWinding = this.getEffectiveWinding(accumInvert);
            if (this.debugBFC) {
                console.log(`Triangle orient: localWinding=${this.bfcState.winding}, accumInvert=${accumInvert}, effective=${effectiveWinding}`);
            }
            if (effectiveWinding === 'CW') {
                indices = [0, 2, 1];
            }
        }
        
        this.geometries.push({
            vertices: vertices,
            indices: indices,
            color: this.getColorValue(cmd.color),
            bfcEnabled: shouldApplyBfc,
            sourceType: 'part',
            fromStudPrimitive: Boolean(withinStudContext)
        });
    }

    // Add quad
    addQuad(cmd, transform, accumCull = false, accumInvert = false, withinStudContext = false) {
        const vertices = [
            cmd.x1, cmd.y1, cmd.z1,
            cmd.x2, cmd.y2, cmd.z2,
            cmd.x3, cmd.y3, cmd.z3,
            cmd.x4, cmd.y4, cmd.z4
        ];
        
        if (transform) {
            this.transformVertices(vertices, transform);
        }
        
        // Apply coordinate transformation to match Three.js coordinate system
        this.applyThreeJSCoordinateTransform(vertices);
        
        // Determine if we should cull based on BFC state
        const shouldApplyBfc = accumCull && this.bfcState.localCull && 
                              (this.bfcState.certified === 'TRUE');
        
        let indices = [0, 1, 2, 0, 2, 3]; // Default CCW quad (split into two triangles)
        
        // Always correct orientation for accumulated inversion/sign
        {
            const effectiveWinding = this.getEffectiveWinding(accumInvert);
            if (effectiveWinding === 'CW') {
                indices = [0, 2, 1, 0, 3, 2];
            }
        }
        
        this.geometries.push({
            vertices: vertices,
            indices: indices,
            color: this.getColorValue(cmd.color),
            bfcEnabled: shouldApplyBfc,
            sourceType: 'part',
            fromStudPrimitive: Boolean(withinStudContext)
        });
    }

    // Add fallback box
    addFallbackBox(transform, color) {
        const w = 10, h = 12, d = 10;
        const vertices = [
            -w, -h, -d,  w, -h, -d,  w, h, -d,  -w, h, -d, // front
            -w, -h,  d,  w, -h,  d,  w, h,  d,  -w, h,  d  // back
        ];
        
        if (transform) {
            this.transformVertices(vertices, transform);
        }
        
        // Apply coordinate transformation to match Three.js coordinate system
        this.applyThreeJSCoordinateTransform(vertices);
        
        const indices = [
            0,1,2, 0,2,3, // front
            4,6,5, 4,7,6, // back
            0,4,5, 0,5,1, // bottom
            2,6,7, 2,7,3, // top
            0,3,7, 0,7,4, // left
            1,5,6, 1,6,2  // right
        ];
        
        this.geometries.push({
            vertices: vertices,
            indices: indices,
            color: this.getColorValue(color),
            sourceType: 'part'
        });
    }

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

    // Process BFC commands and update state
    processBfcCommands(bfcCommands, accumInvert = false) {
        for (const cmd of bfcCommands) {
            switch (cmd) {
                case 'CERTIFY':
                    if (this.bfcState.certified !== 'FALSE') {
                        this.bfcState.certified = 'TRUE';
                    }
                    break;
                    
                case 'NOCERTIFY':
                    if (this.bfcState.certified !== 'TRUE') {
                        this.bfcState.certified = 'FALSE';
                    }
                    break;
                    
                case 'CLIP':
                    this.bfcState.localCull = true;
                    break;
                    
                case 'NOCLIP':
                    this.bfcState.localCull = false;
                    break;
                    
                case 'CCW':
                    // Record requested winding; combine with inversion later during emission
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

    // Get effective winding order considering accumulated inversion only.
    // Matrix reversal effects must be accumulated into accumInvert at subfile boundaries per spec.
    getEffectiveWinding(accumInvert) {
        let effectiveWinding = this.bfcState.winding;
        if (accumInvert) {
            effectiveWinding = effectiveWinding === 'CCW' ? 'CW' : 'CCW';
        }
        return effectiveWinding;
    }

    // Apply 180-degree rotation around X-axis to match Three.js coordinate system
    applyThreeJSCoordinateTransform(vertices) {
        for (let i = 0; i < vertices.length; i += 3) {
            // X stays the same
            // Y becomes -Y (flip)
            // Z becomes -Z (flip)
            vertices[i + 1] = -vertices[i + 1]; // Y
            vertices[i + 2] = -vertices[i + 2]; // Z
        }
    }

    // Transform vertices
    transformVertices(vertices, matrix) {
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];
            const z = vertices[i + 2];
            
            vertices[i] = matrix.a * x + matrix.b * y + matrix.c * z + matrix.x;
            vertices[i + 1] = matrix.d * x + matrix.e * y + matrix.f * z + matrix.y;
            vertices[i + 2] = matrix.g * x + matrix.h * y + matrix.i * z + matrix.z;
        }
    }

    // Multiply transformation matrices
    multiplyMatrices(m1, m2) {
        return {
            a: m1.a * m2.a + m1.b * m2.d + m1.c * m2.g,
            b: m1.a * m2.b + m1.b * m2.e + m1.c * m2.h,
            c: m1.a * m2.c + m1.b * m2.f + m1.c * m2.i,
            x: m1.a * m2.x + m1.b * m2.y + m1.c * m2.z + m1.x,
            
            d: m1.d * m2.a + m1.e * m2.d + m1.f * m2.g,
            e: m1.d * m2.b + m1.e * m2.e + m1.f * m2.h,
            f: m1.d * m2.c + m1.e * m2.f + m1.f * m2.i,
            y: m1.d * m2.x + m1.e * m2.y + m1.f * m2.z + m1.y,
            
            g: m1.g * m2.a + m1.h * m2.d + m1.i * m2.g,
            h: m1.g * m2.b + m1.h * m2.e + m1.i * m2.h,
            i: m1.g * m2.c + m1.h * m2.f + m1.i * m2.i,
            z: m1.g * m2.x + m1.h * m2.y + m1.i * m2.z + m1.z
        };
    }

    // Get color value
    getColorValue(colorCode) {
        // Basic LDraw color mapping
        const colorMap = {
            0: 0x000000,  // Black
            1: 0x0000ff,  // Blue
            2: 0x00ff00,  // Green
            4: 0xff0000,  // Red
            5: 0xff00ff,  // Magenta
            14: 0xffff00, // Yellow
            15: 0xffffff, // White
            16: 0x7f7f7f, // Main color (gray)
            24: 0x7f7f7f  // Edge color (gray)
        };
        
        return colorMap[colorCode] || 0x7f7f7f;
    }

    // Export to GLTF
    async exportToGLTF(outputPath) {
        // Post-process: correct anti-studs that ended up on the center plane due to SNAP ordering
        this.postProcessStuds();

        // Rebuild markers from final extras so visuals always match data
        this.rebuildMarkersFromExtras();
        console.log(`Found ${this.studData.length} studs and ${this.antiStudData.length} anti-studs`);
        
        // Merge all geometries into buffers
        const { bufferData, accessors, bufferViews, meshes, colorValues, meshTypes } = this.createGLTFData();
        
        // Create nodes with stud metadata
        const nodes = [];
        const rootNode = {
            name: "LDrawModel",
            children: [],
            extras: {
                studs: this.studData,
                antiStuds: this.antiStudData
            }
        };
        nodes.push(rootNode);
        
        // Add mesh nodes
        // IMPORTANT: Child node ordering requirement
        // We must ensure that for any given piece, the GLTF hierarchy lists children
        // in this strict order to avoid consumer bugs:
        // 1) "part"  2) "stud"  3) "antistud"  4) "partnostuds"
        // Do not change without updating all consumers that rely on this ordering.
        const partChildIndices = [];
        const studChildIndices = [];
        const antiStudChildIndices = [];
        const partNoStudsChildIndices = [];

        meshes.forEach((mesh, index) => {
            // Determine mesh type based on recorded source type (authoritative)
            const sourceType = meshTypes[index] || 'part';
            const meshName = sourceType;

            const nodeIndex = nodes.length; // index the node will have after push
            nodes.push({
                name: meshName,
                mesh: index
            });

            // Collect child indices by type so we can enforce the final order
            if (meshName === "stud") {
                studChildIndices.push(nodeIndex);
            } else if (meshName === "antistud") {
                antiStudChildIndices.push(nodeIndex);
            } else if (meshName === "partnostuds") {
                partNoStudsChildIndices.push(nodeIndex);
            } else {
                partChildIndices.push(nodeIndex);
            }
        });

        // Enforce required child order: part -> stud -> antistud -> partnostuds
        rootNode.children = [
            ...partChildIndices,
            ...studChildIndices,
            ...antiStudChildIndices,
            ...partNoStudsChildIndices
        ];
        
        // Convert binary data to base64 data URI
        const base64Data = Buffer.from(bufferData).toString('base64');
        const dataUri = `data:application/octet-stream;base64,${base64Data}`;
        
        // Create GLTF structure with embedded binary data
        const gltf = {
            asset: {
                version: "2.0",
                generator: "LDraw to GLTF Advanced Converter"
            },
            scene: 0,
            scenes: [{
                nodes: [0]
            }],
            nodes: nodes,
            meshes: meshes,
            materials: this.createMaterials(),
            accessors: accessors,
            bufferViews: bufferViews,
            buffers: [{
                uri: dataUri,
                byteLength: bufferData.byteLength
            }]
        };
        
        // Write only the GLTF file with embedded binary data
        const gltfJson = JSON.stringify(gltf, null, 2);
        fs.writeFileSync(outputPath, gltfJson);
        
        console.log(`GLTF file saved to: ${outputPath}`);
        console.log(`Binary data embedded as data URI in GLTF file`);
    }

    // Rebuild marker geometries from extras so positions/orientations never drift
    rebuildMarkersFromExtras() {
        if (!Array.isArray(this.geometries)) return;
        // Remove existing marker geoms
        this.geometries = this.geometries.filter(g => !g || !g.isMarker);
        // Helper: add marker from an entry
        const addFrom = (entry, color) => {
            if (!entry) return;
            const x = entry.x, y = entry.y, z = entry.z;
            // Convert back from Three.js flips to LDraw for marker creation input
            const lx = x, ly = -y, lz = -z;
            let axis = { x: 0, y: 1, z: 0 };
            if (typeof entry.dx === 'number' && typeof entry.dy === 'number' && typeof entry.dz === 'number') {
                // Convert dir back to LDraw (invert flips)
                axis = { x: entry.dx, y: -entry.dy, z: -entry.dz };
            }
            this.addStudMarkerCube(lx, ly, lz, axis, color);
        };
        // Add studs (green) and anti-studs (red)
        (this.studData || []).forEach(e => addFrom(e, 0x00ff00));
        (this.antiStudData || []).forEach(e => addFrom(e, 0xff0000));
    }

    // Adjust anti-studs using final stud list to handle sideways parts (e.g., 4070 headlight)
    postProcessStuds() {
      if (!this.studData || !this.antiStudData) return;
      const tol = 0.25; // LDU tolerance
      // Build quick lookup of studs by (x,y) with tolerance
      const studs = this.studData;
      // Correct extras data (preserve dir if present)
      this.antiStudData = this.antiStudData.map(a => {
        // Find matching stud with same x/y within tol
        const s = studs.find(s => Math.abs(s.x - a.x) < tol && Math.abs(s.y - a.y) < tol);
        if (!s) return a;
        // If anti-stud is near center on lateral axes, mirror across stud's dominant lateral axis
        const nearCenterX = Math.abs(a.x) < tol;
        const nearCenterZ = Math.abs(a.z) < tol;
        const absSX = Math.abs(s.x);
        const absSZ = Math.abs(s.z);
        const corrected = { ...a }; // keep dir
        if (absSZ > absSX && absSZ > tol && nearCenterZ) {
          corrected.z = -s.z;
          return corrected;
        }
        if (absSX > tol && nearCenterX) {
          corrected.x = -s.x;
          return corrected;
        }
        return a;
      });

      // Also adjust marker meshes so viewer spheres match corrected extras
      if (Array.isArray(this.geometries)) {
        this.geometries.forEach(geom => {
          if (!geom || !geom.isMarker || geom.sourceType !== 'antistud' || !Array.isArray(geom.vertices)) return;
          const center = geom.markerCenterThree;
          if (!center) return;
          // Find matching stud by x/y
          const s = studs.find(s => Math.abs(s.x - center.x) < tol && Math.abs(s.y - center.y) < tol);
          if (!s) return;
          const absSX2 = Math.abs(s.x);
          const absSZ2 = Math.abs(s.z);
          let targetCenter = { ...center };
          if (absSZ2 > absSX2 && absSZ2 > tol) {
            targetCenter.z = -s.z;
          } else if (absSX2 > tol) {
            targetCenter.x = -s.x;
          } else {
            return;
          }
          // Compute delta in Three.js space
          const dx = targetCenter.x - center.x;
          const dy = targetCenter.y - center.y;
          const dz = targetCenter.z - center.z;
          if (Math.abs(dx) < tol && Math.abs(dy) < tol && Math.abs(dz) < tol) return;
          // Apply translation to all marker vertices (already in Three.js coords). This also moves cubes.
          for (let i = 0; i < geom.vertices.length; i += 3) {
            geom.vertices[i] += dx;
            geom.vertices[i + 1] += dy;
            geom.vertices[i + 2] += dz;
          }
          // Update recorded center
          geom.markerCenterThree = targetCenter;
        });
      }
    }

    // Create GLTF data structures
    createGLTFData() {
        const buffers = [];
        const accessors = [];
        const bufferViews = [];
        const meshes = [];
        
        let byteOffset = 0;
        
        // Group geometries by (sourceType, color) so naming never depends on color alone
        const typeColorGroups = new Map(); // key: `${sourceType}|${color}` => geoms[]
        const groupTypes = []; // parallel to meshes: 'part' | 'stud' | 'antistud' | 'partnostuds'
        const groupColors = []; // parallel color values
        this.geometries.forEach(geom => {
            const sourceType = geom.sourceType || 'part';
            const key = `${sourceType}|${geom.color}`;
            if (!typeColorGroups.has(key)) {
                typeColorGroups.set(key, []);
            }
            typeColorGroups.get(key).push(geom);
        });
        
        // Create mesh for each (sourceType,color) group
        typeColorGroups.forEach((geoms, key) => {
            const [sourceType, colorStr] = key.split('|');
            const color = Number(colorStr);
            // Helper to append a merged mesh from a list of geoms with the given logical type
            const appendMergedMesh = (geomList, logicalType) => {
                if (!geomList || geomList.length === 0) return;
                const vertices = [];
                const indices = [];
                let indexOffset = 0;
                geomList.forEach(geom => {
                    vertices.push(...geom.vertices);
                    geom.indices.forEach(idx => indices.push(idx + indexOffset));
                    indexOffset += geom.vertices.length / 3;
                });
                
                // Calculate smooth normals and merge vertices
                const merged = this.calculateSmoothNormalsAndMerge(vertices, indices);
                
                const vertexBuffer = new Float32Array(merged.vertices);
                const normalBuffer = new Float32Array(merged.normals);
                const indexBuffer = new Uint16Array(merged.indices);
                
                // Position buffer view
                const posBufferView = {
                    buffer: 0,
                    byteOffset: byteOffset,
                    byteLength: vertexBuffer.byteLength,
                    target: 34962
                };
                bufferViews.push(posBufferView);
                buffers.push(vertexBuffer);
                byteOffset += vertexBuffer.byteLength;
                
                const posAccessor = {
                    bufferView: bufferViews.length - 1,
                    componentType: 5126,
                    count: merged.vertices.length / 3,
                    type: "VEC3",
                    min: this.getMin(merged.vertices, 3),
                    max: this.getMax(merged.vertices, 3)
                };
                accessors.push(posAccessor);
                
                // Normal buffer view
                const normalBufferView = {
                    buffer: 0,
                    byteOffset: byteOffset,
                    byteLength: normalBuffer.byteLength,
                    target: 34962
                };
                bufferViews.push(normalBufferView);
                buffers.push(normalBuffer);
                byteOffset += normalBuffer.byteLength;
                
                const normalAccessor = {
                    bufferView: bufferViews.length - 1,
                    componentType: 5126,
                    count: merged.normals.length / 3,
                    type: "VEC3"
                };
                accessors.push(normalAccessor);
                
                // Index buffer view
                const idxBufferView = {
                    buffer: 0,
                    byteOffset: byteOffset,
                    byteLength: indexBuffer.byteLength,
                    target: 34963
                };
                bufferViews.push(idxBufferView);
                buffers.push(indexBuffer);
                byteOffset += indexBuffer.byteLength;
                
                const idxAccessor = {
                    bufferView: bufferViews.length - 1,
                    componentType: 5123,
                    count: merged.indices.length,
                    type: "SCALAR"
                };
                accessors.push(idxAccessor);
                
                const materialIndex = this.getMaterialIndex(color);
                const positionAccessorIndex = accessors.length - 3;  // Just added position accessor
                const normalAccessorIndex = accessors.length - 2;    // Just added normal accessor  
                const indicesAccessorIndex = accessors.length - 1;   // Just added indices accessor
                
                meshes.push({
                    primitives: [{
                        attributes: { 
                            POSITION: positionAccessorIndex,
                            NORMAL: normalAccessorIndex
                        },
                        indices: indicesAccessorIndex,
                        material: materialIndex
                    }]
                });
                groupTypes.push(logicalType);
                groupColors.push(color);
            };

            // Always add the original group mesh
            appendMergedMesh(geoms, sourceType);

            // For 'part' groups, also add a filtered mesh excluding stud primitive geometry
            if (sourceType === 'part') {
                const filtered = geoms.filter(g => !g.fromStudPrimitive);
                // Only add if it would not be empty; we still add even if identical to original
                if (filtered.length > 0) {
                    appendMergedMesh(filtered, 'partnostuds');
                }
            }
        });
        
        // Combine all buffers
        const totalSize = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
        const bufferData = new ArrayBuffer(totalSize);
        const view = new Uint8Array(bufferData);
        
        let offset = 0;
        buffers.forEach(buf => {
            view.set(new Uint8Array(buf.buffer), offset);
            offset += buf.byteLength;
        });
        
        return { bufferData, accessors, bufferViews, meshes, colorValues: groupColors, meshTypes: groupTypes };
    }

    // Create materials
    createMaterials() {
        const materials = [];
        const addedColors = new Set();
        
        this.geometries.forEach(geom => {
            if (!addedColors.has(geom.color)) {
                addedColors.add(geom.color);
                const r = ((geom.color >> 16) & 0xff) / 255;
                const g = ((geom.color >> 8) & 0xff) / 255;
                const b = (geom.color & 0xff) / 255;
                
                materials.push({
                    pbrMetallicRoughness: {
                        baseColorFactor: [r, g, b, 1.0],
                        metallicFactor: 0.0,
                        roughnessFactor: 0.7
                    }
                });
            }
        });
        
        return materials;
    }

    // Get material index for color
    getMaterialIndex(color) {
        const addedColors = [];
        const seenColors = new Set();
        
        this.geometries.forEach(geom => {
            if (!seenColors.has(geom.color)) {
                seenColors.add(geom.color);
                addedColors.push(geom.color);
            }
        });
        
        return addedColors.indexOf(color);
    }

    // Get min values
    getMin(arr, stride) {
        const min = [];
        for (let i = 0; i < stride; i++) {
            min[i] = Infinity;
            for (let j = i; j < arr.length; j += stride) {
                min[i] = Math.min(min[i], arr[j]);
            }
        }
        return min;
    }

    // Get max values
    getMax(arr, stride) {
        const max = [];
        for (let i = 0; i < stride; i++) {
            max[i] = -Infinity;
            for (let j = i; j < arr.length; j += stride) {
                max[i] = Math.max(max[i], arr[j]);
            }
        }
        return max;
    }

    // Calculate smooth vertex normals with angle threshold and vertex merging for efficiency
    calculateSmoothNormalsAndMerge(vertices, indices, smoothAngleDegrees = 35) {
        const vertexCount = vertices.length / 3;
        const smoothAngleRad = smoothAngleDegrees * Math.PI / 180;
        const positionTolerance = 1e-6;
        const normalTolerance = 1e-3; // Tolerance for normal comparison
        
        // First pass: calculate face normals
        const faceNormals = [];
        const faceCount = indices.length / 3;
        
        for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
            const i0 = indices[faceIdx * 3];
            const i1 = indices[faceIdx * 3 + 1];
            const i2 = indices[faceIdx * 3 + 2];
            
            const v0 = [vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]];
            const v1 = [vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]];
            const v2 = [vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]];
            
            const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
            const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
            
            const faceNormal = [
                edge1[1] * edge2[2] - edge1[2] * edge2[1],
                edge1[2] * edge2[0] - edge1[0] * edge2[2],
                edge1[0] * edge2[1] - edge1[1] * edge2[0]
            ];
            
            const length = Math.sqrt(faceNormal[0] * faceNormal[0] + 
                                   faceNormal[1] * faceNormal[1] + 
                                   faceNormal[2] * faceNormal[2]);
            
            if (length > 0) {
                faceNormals.push([
                    faceNormal[0] / length,
                    faceNormal[1] / length,
                    faceNormal[2] / length
                ]);
            } else {
                faceNormals.push([0, 1, 0]); // fallback
            }
        }
        
        // Build vertex to face mapping
        const vertexToFaces = new Array(vertexCount).fill(null).map(() => []);
        for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
            const i0 = indices[faceIdx * 3];
            const i1 = indices[faceIdx * 3 + 1];
            const i2 = indices[faceIdx * 3 + 2];
            
            vertexToFaces[i0].push(faceIdx);
            vertexToFaces[i1].push(faceIdx);
            vertexToFaces[i2].push(faceIdx);
        }
        
        // Build position-based vertex groups for shared vertices
        const positionToVertices = new Map();
        for (let i = 0; i < vertexCount; i++) {
            const x = vertices[i * 3];
            const y = vertices[i * 3 + 1];
            const z = vertices[i * 3 + 2];
            const key = `${Math.round(x / positionTolerance) * positionTolerance},${Math.round(y / positionTolerance) * positionTolerance},${Math.round(z / positionTolerance) * positionTolerance}`;
            
            if (!positionToVertices.has(key)) {
                positionToVertices.set(key, []);
            }
            positionToVertices.get(key).push(i);
        }
        
        // Calculate unique normals for each vertex considering angle threshold
        const vertexNormals = new Array(vertexCount);
        for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
            const x = vertices[vertexIdx * 3];
            const y = vertices[vertexIdx * 3 + 1];
            const z = vertices[vertexIdx * 3 + 2];
            const key = `${Math.round(x / positionTolerance) * positionTolerance},${Math.round(y / positionTolerance) * positionTolerance},${Math.round(z / positionTolerance) * positionTolerance}`;
            
            // Get all faces touching any vertex at this position
            const sharedVertices = positionToVertices.get(key) || [vertexIdx];
            const allFaces = new Set();
            sharedVertices.forEach(vi => {
                vertexToFaces[vi].forEach(faceIdx => allFaces.add(faceIdx));
            });
            
            // Get the primary face this vertex belongs to
            const primaryFaces = vertexToFaces[vertexIdx];
            if (primaryFaces.length === 0) {
                vertexNormals[vertexIdx] = [0, 1, 0];
                continue;
            }
            
            // Average normals from faces that are within the smooth angle threshold
            let normalSum = [0, 0, 0];
            let count = 0;
            
            for (const primaryFaceIdx of primaryFaces) {
                const primaryNormal = faceNormals[primaryFaceIdx];
                
                for (const faceIdx of allFaces) {
                    const faceNormal = faceNormals[faceIdx];
                    
                    // Calculate angle between normals using dot product
                    const dot = primaryNormal[0] * faceNormal[0] + 
                               primaryNormal[1] * faceNormal[1] + 
                               primaryNormal[2] * faceNormal[2];
                    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                    
                    // If within smooth angle threshold, include in average
                    if (angle <= smoothAngleRad) {
                        normalSum[0] += faceNormal[0];
                        normalSum[1] += faceNormal[1];
                        normalSum[2] += faceNormal[2];
                        count++;
                    }
                }
            }
            
            // If no faces were within threshold, just use the primary face normal
            if (count === 0 && primaryFaces.length > 0) {
                const primaryNormal = faceNormals[primaryFaces[0]];
                normalSum = [primaryNormal[0], primaryNormal[1], primaryNormal[2]];
                count = 1;
            }
            
            // Normalize the averaged normal
            const length = Math.sqrt(normalSum[0] * normalSum[0] + 
                                   normalSum[1] * normalSum[1] + 
                                   normalSum[2] * normalSum[2]);
            
            if (length > 0) {
                vertexNormals[vertexIdx] = [
                    normalSum[0] / length,
                    normalSum[1] / length,
                    normalSum[2] / length
                ];
            } else {
                vertexNormals[vertexIdx] = [0, 1, 0];
            }
        }
        
        // Now merge vertices with same position and normal
        const mergedVertices = [];
        const mergedNormals = [];
        const vertexRemapping = new Array(vertexCount);
        const uniqueVertexMap = new Map(); // key: "x,y,z,nx,ny,nz" -> merged index
        
        for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
            const x = vertices[vertexIdx * 3];
            const y = vertices[vertexIdx * 3 + 1];
            const z = vertices[vertexIdx * 3 + 2];
            const normal = vertexNormals[vertexIdx];
            
            // Create unique key for position + normal
            const posKey = `${Math.round(x / positionTolerance) * positionTolerance},${Math.round(y / positionTolerance) * positionTolerance},${Math.round(z / positionTolerance) * positionTolerance}`;
            const normalKey = `${Math.round(normal[0] / normalTolerance) * normalTolerance},${Math.round(normal[1] / normalTolerance) * normalTolerance},${Math.round(normal[2] / normalTolerance) * normalTolerance}`;
            const uniqueKey = `${posKey}|${normalKey}`;
            
            if (uniqueVertexMap.has(uniqueKey)) {
                // Reuse existing merged vertex
                vertexRemapping[vertexIdx] = uniqueVertexMap.get(uniqueKey);
            } else {
                // Create new merged vertex
                const newIndex = mergedVertices.length / 3;
                mergedVertices.push(x, y, z);
                mergedNormals.push(normal[0], normal[1], normal[2]);
                uniqueVertexMap.set(uniqueKey, newIndex);
                vertexRemapping[vertexIdx] = newIndex;
            }
        }
        
        // Remap indices to use merged vertices
        const mergedIndices = [];
        for (let i = 0; i < indices.length; i++) {
            mergedIndices.push(vertexRemapping[indices[i]]);
        }
        
        console.log(`Vertex merging: ${vertexCount} -> ${mergedVertices.length / 3} vertices (${((1 - mergedVertices.length / vertices.length) * 100).toFixed(1)}% reduction)`);
        
        return {
            vertices: mergedVertices,
            normals: mergedNormals,
            indices: mergedIndices
        };
    }
    
    // Legacy method for backward compatibility  
    calculateSmoothNormals(vertices, indices, smoothAngleDegrees = 30) {
        const result = this.calculateSmoothNormalsAndMerge(vertices, indices, smoothAngleDegrees);
        return result.normals;
    }
}

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

module.exports = { LDrawParserAdvanced }; 