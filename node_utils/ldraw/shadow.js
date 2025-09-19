const fs = require('fs');
const path = require('path');

function appendShadowLibraryContent(mainFilePath, mainContent) {
    const relativePath = path.relative(this.partsLibraryPath, mainFilePath);
    const shadowPath = path.join(this.shadowLibraryPath, relativePath);
    try {
        if (fs.existsSync(shadowPath)) {
            const shadowContent = fs.readFileSync(shadowPath, 'utf8');
            let result = mainContent + '\n' + shadowContent;
            const inclMatches = [...shadowContent.matchAll(/^\s*0\s+!LDCAD\s+SNAP_INCL\s+\[ref=([^\]]+)\]/gmi)];
            const includeSet = new Set();
            for (const m of inclMatches) {
                const refRel = m[1].trim().replace(/\\/g, '/');
                const inclPath = path.join(this.shadowLibraryPath, path.dirname(relativePath), refRel);
                const inclKey = path.resolve(inclPath);
                if (fs.existsSync(inclPath) && !includeSet.has(inclKey)) {
                    const inclContent = fs.readFileSync(inclPath, 'utf8');
                    result += '\n' + inclContent;
                    includeSet.add(inclKey);
                }
            }
            return result;
        }
    } catch (_) {}
    return mainContent;
}

function parseSnapCyl(line) {
    const params = {};
    const paramMatches = line.matchAll(/\[([^=]+)=([^\]]+)\]/g);
    for (const match of paramMatches) {
        const key = match[1].trim();
        const value = match[2].trim();
        params[key] = value;
    }
    let basePos = { x: 0, y: 0, z: 0 };
    if (params.pos) {
        const posValues = params.pos.split(/\s+/).map(Number);
        basePos = {
            x: Number.isFinite(posValues[0]) ? posValues[0] : 0,
            y: Number.isFinite(posValues[1]) ? posValues[1] : 0,
            z: Number.isFinite(posValues[2]) ? posValues[2] : 0
        };
    }
    const positions = [];
    if (params.grid) {
        let cols, rows, spacingX, spacingZ;
        let centerX = false;
        let centerZ = false;
        const tokens = params.grid.trim().split(/\s+/);
        let idx = 0;
        if (tokens[idx] && tokens[idx].toUpperCase() === 'C') { centerX = true; idx++; }
        if (tokens.length >= idx + 1) { cols = parseInt(tokens[idx++]); }
        if (tokens[idx] && tokens[idx].toUpperCase() === 'C') { centerZ = true; idx++; }
        if (tokens.length >= idx + 3) {
            rows = parseInt(tokens[idx++]);
            spacingX = parseFloat(tokens[idx++]);
            spacingZ = parseFloat(tokens[idx++]);
        }
        if (Number.isFinite(cols) && Number.isFinite(rows) && Number.isFinite(spacingX) && Number.isFinite(spacingZ)) {
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const offsetX = centerX ? (col - (cols - 1) / 2) * spacingX : col * spacingX;
                    const offsetZ = centerZ ? (row - (rows - 1) / 2) * spacingZ : row * spacingZ;
                    const x = basePos.x + offsetX;
                    const y = basePos.y;
                    const z = basePos.z + offsetZ;
                    positions.push({ x, y, z });
                }
            }
        } else {
            positions.push(basePos);
        }
    } else {
        positions.push(basePos);
    }
    let oriMatrix = null;
    if (params.ori) {
        const nums = params.ori.split(/\s+/).map(Number).filter(n => Number.isFinite(n));
        if (nums.length === 9) {
            oriMatrix = { a: nums[0], b: nums[1], c: nums[2], d: nums[3], e: nums[4], f: nums[5], g: nums[6], h: nums[7], i: nums[8] };
        }
    }
    let totalLength = 0;
    let maxRadius = null;
    let hasAxleSection = false;
    // Track whether we have a substantial stud-radius round section (R ~6 with length)
    const STUD_RADIUS = 6;
    const R_TOL = 0.6;
    let studRadiusLen = 0;
    if (params.length) {
        const lenVal = parseFloat(params.length);
        if (Number.isFinite(lenVal)) totalLength = Math.abs(lenVal);
    }
    if (params.secs) {
        const tokens = params.secs.trim().split(/\s+/);
        for (let i = 0; i < tokens.length;) {
            const code = tokens[i++];
            if (/^[A-Za-z]$/.test(code) && i + 1 < tokens.length) {
                const r = parseFloat(tokens[i++]);
                const len = parseFloat(tokens[i++]);
                if (Number.isFinite(len)) totalLength += Math.abs(len);
                if (Number.isFinite(r)) {
                    const ar = Math.abs(r);
                    maxRadius = (maxRadius == null) ? ar : Math.max(maxRadius, ar);
                    if (code.toUpperCase() === 'R' && Math.abs(ar - STUD_RADIUS) <= R_TOL && Number.isFinite(len) && Math.abs(len) >= 3) {
                        studRadiusLen += Math.abs(len);
                    }
                }
                if (code.toUpperCase() === 'A') { hasAxleSection = true; }
            } else {
                const maybeR = parseFloat(tokens[i - 1]);
                const maybeL = (i < tokens.length) ? parseFloat(tokens[i]) : NaN;
                if (Number.isFinite(maybeL)) { totalLength += Math.abs(maybeL); i += 1; }
                if (Number.isFinite(maybeR)) {
                    const ar = Math.abs(maybeR);
                    maxRadius = (maxRadius == null) ? ar : Math.max(maxRadius, ar);
                }
            }
        }
    }
    const center = String(params.center).toLowerCase() === 'true';
    const hasStudRadiusSection = studRadiusLen >= 3;
    return { gender: params.gender || 'M', positions, ori: oriMatrix, center, length: totalLength, maxRadius, group: params.group || null, id: (params.ID || params.id || null), hasAxleSection, hasStudRadiusSection };
}

function correctAntiStudAgainstStuds(worldPos) {
    const posThree = { x: worldPos.x, y: -worldPos.y, z: -worldPos.z };
    const tol = 0.25;
    const match = (this.studData || []).find(s => Math.abs(s.x - posThree.x) < tol && Math.abs(s.y - posThree.y) < tol);
    if (!match) return worldPos;
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
    return { x: corrected.x, y: -corrected.y, z: -corrected.z };
}

function handleLDCadMetaLine(line, transformMatrix) {
    const trimmed = line.trim();
    if (!/^0\s+!LDCAD\b/.test(trimmed)) return false;
    if (/^0\s+\/\/\s*!LDCAD\b/.test(trimmed)) return false;
    if (/!LDCAD\s+SNAP_CYL\b/.test(trimmed)) {
        const snapInfo = parseSnapCyl(trimmed);
        if (snapInfo) {
            snapInfo.positions.forEach(pos => {
                let axisLocal = { x: 0, y: 1, z: 0 };
                if (snapInfo.ori) {
                    axisLocal = { x: snapInfo.ori.b, y: snapInfo.ori.e, z: snapInfo.ori.h };
                }
                const worldAxis = transformMatrix ? this.transformDirection(axisLocal, transformMatrix) : axisLocal;
                const posAdj = pos;
                if (snapInfo.gender === 'F') {
                    const STUD_RADIUS = 6;
                    const R_TOL = 0.6;
                    const isTopStudCavity = (snapInfo.id && String(snapInfo.id).toLowerCase() === 'astud') || /stud4od\.dat$/i.test(this.currentShadowRef || '');
                    let radiusOk = !isTopStudCavity && !snapInfo.hasAxleSection && ((snapInfo.maxRadius == null) || (Math.abs(snapInfo.maxRadius - STUD_RADIUS) <= R_TOL));
                    // Whitelist: relax axle exclusion for specific top-level parts (e.g., 59900),
                    // but only if a substantial stud-radius section exists to avoid axle-only holes
                    if (!radiusOk && !isTopStudCavity && ((snapInfo.maxRadius == null) || (Math.abs(snapInfo.maxRadius - STUD_RADIUS) <= R_TOL)) && snapInfo.hasStudRadiusSection === true) {
                        const topId = this.currentTopPartId;
                        if (topId && this.relaxFemaleAxleAntistudForParts && this.relaxFemaleAxleAntistudForParts.has(topId)) {
                            radiusOk = true;
                        }
                    }
                    if (transformMatrix) {
                        let worldPos = this.transformPosition(posAdj, transformMatrix);
                        if (snapInfo.center && Number.isFinite(snapInfo.length) && snapInfo.length > 0) {
                            const half = snapInfo.length * 0.5;
                            worldPos = { x: worldPos.x - worldAxis.x * half, y: worldPos.y - worldAxis.y * half, z: worldPos.z - worldAxis.z * half };
                        }
                        if (radiusOk) {
                            worldPos = correctAntiStudAgainstStuds.call(this, worldPos);
                            this.addStudPosition(worldPos.x, worldPos.y, worldPos.z, 'antiStud', worldAxis);
                            this.addStudMarkerCube(worldPos.x, worldPos.y, worldPos.z, worldAxis, 0xff0000);
                        } else {
                            const transformedY = -worldPos.y;
                            const transformedZ = -worldPos.z;
                            this.miniAntiStudData.push({ x: worldPos.x, y: transformedY, z: transformedZ, dx: worldAxis.x, dy: -worldAxis.y, dz: -worldAxis.z });
                        }
                    } else {
                        let p = posAdj;
                        if (snapInfo.center && Number.isFinite(snapInfo.length) && snapInfo.length > 0) {
                            const half = snapInfo.length * 0.5;
                            p = { x: p.x - worldAxis.x * half, y: p.y - worldAxis.y * half, z: p.z - worldAxis.z * half };
                        }
                        if (radiusOk) {
                            this.addStudPosition(p.x, p.y, p.z, 'antiStud', worldAxis);
                            this.addStudMarkerCube(p.x, p.y, p.z, worldAxis, 0xff0000);
                        } else {
                            const transformedY = -p.y;
                            const transformedZ = -p.z;
                            this.miniAntiStudData.push({ x: p.x, y: transformedY, z: transformedZ, dx: worldAxis.x, dy: -worldAxis.y, dz: -worldAxis.z });
                        }
                    }
                } else {
                    const STUD_RADIUS = 6;
                    const R_TOL = 0.6;
                    const radiusOk = (snapInfo.maxRadius == null) || (Math.abs(snapInfo.maxRadius - STUD_RADIUS) <= R_TOL);
                    if (radiusOk) {
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
                }
            });
        }
        return true;
    }
    if (/!LDCAD\s+SNAP_INCL\b/.test(trimmed)) {
        const m = trimmed.match(/\[ref=([^\]]+)\]/i);
        if (m) this.currentShadowRef = m[1].trim();
        return true;
    }
    return false;
}

module.exports = { appendShadowLibraryContent, handleLDCadMetaLine, parseSnapCyl, correctAntiStudAgainstStuds };


