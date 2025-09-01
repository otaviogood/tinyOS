// Processing stage: post-process IR (stud corrections, marker rebuilds, grouping)
const { calculateSmoothNormalsAndMerge } = require('./normals');

// Helper: solve 3x3 linear system A x = b, where rows of A are plane normals
function solve3x3(a1, a2, a3, b) {
    const ax = a1[0], ay = a1[1], az = a1[2];
    const bx = a2[0], by = a2[1], bz = a2[2];
    const cx = a3[0], cy = a3[1], cz = a3[2];
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    if (Math.abs(det) < 1e-9) return null;
    // Inverse via adjugate / det
    const invDet = 1.0 / det;
    const m00 =  (by * cz - bz * cy) * invDet;
    const m01 = -(ay * cz - az * cy) * invDet;
    const m02 =  (ay * bz - az * by) * invDet;
    const m10 = -(bx * cz - bz * cx) * invDet;
    const m11 =  (ax * cz - az * cx) * invDet;
    const m12 = -(ax * bz - az * bx) * invDet;
    const m20 =  (bx * cy - by * cx) * invDet;
    const m21 = -(ax * cy - ay * cx) * invDet;
    const m22 =  (ax * by - ay * bx) * invDet;
    const x = m00 * b[0] + m01 * b[1] + m02 * b[2];
    const y = m10 * b[0] + m11 * b[1] + m12 * b[2];
    const z = m20 * b[0] + m21 * b[1] + m22 * b[2];
    return [x, y, z];
}

// Build a simple convex prism starting with the AABB of part-no-stud geometry and
// cutting by up to two 45° planes aligned around single axes
function computeConvexHullFromGeoms(geoms) {
    const EPS = 1e-5;
    if (!Array.isArray(geoms) || geoms.length === 0) return null;
    // Gather all positions and pick a representative color
    const points = [];
    let baseColor = null;
    geoms.forEach(g => {
        if (!Array.isArray(g.vertices)) return;
        if (baseColor === null) baseColor = g.color;
        const v = g.vertices;
        for (let i = 0; i < v.length; i += 3) {
            points.push([v[i], v[i + 1], v[i + 2]]);
        }
    });
    if (points.length < 3) return null;
    if (baseColor === null) baseColor = 0x808080;

    // AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    points.forEach(p => {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
        minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    });
    if (!isFinite(minX) || !isFinite(maxX)) return null;
    const planes = [];
    const addPlane = (n, d) => { // ensure normalized
        const len = Math.hypot(n[0], n[1], n[2]);
        if (len < EPS) return;
        planes.push({ n: [n[0] / len, n[1] / len, n[2] / len], d: d / len });
    };
    // 6 AABB planes: n·x <= d
    addPlane([1, 0, 0], maxX);
    addPlane([-1, 0, 0], -minX);
    addPlane([0, 1, 0], maxY);
    addPlane([0, -1, 0], -minY);
    addPlane([0, 0, 1], maxZ);
    addPlane([0, 0, -1], -minZ);

    // Initial hull vertices from AABB corners
    const hullVerticesFromPlanes = (planesList) => {
        const verts = [];
        for (let i = 0; i < planesList.length; i++) {
            for (let j = i + 1; j < planesList.length; j++) {
                for (let k = j + 1; k < planesList.length; k++) {
                    const p1 = planesList[i], p2 = planesList[j], p3 = planesList[k];
                    const p = solve3x3(p1.n, p2.n, p3.n, [p1.d, p2.d, p3.d]);
                    if (!p) continue;
                    // Check point satisfies all planes
                    let ok = true;
                    for (let t = 0; t < planesList.length; t++) {
                        const pl = planesList[t];
                        const s = pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2];
                        if (s > pl.d + 1e-4) { ok = false; break; }
                    }
                    if (!ok) continue;
                    verts.push(p);
                }
            }
        }
        // Deduplicate
        const out = [];
        const keySet = new Set();
        verts.forEach(p => {
            const key = `${Math.round(p[0] / 1e-4) * 1e-4},${Math.round(p[1] / 1e-4) * 1e-4},${Math.round(p[2] / 1e-4) * 1e-4}`;
            if (!keySet.has(key)) { keySet.add(key); out.push(p); }
        });
        return out;
    };

    let currentHullVerts = [
        [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, minZ], [minX, maxY, maxZ],
        [maxX, minY, minZ], [maxX, minY, maxZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]
    ];

    // Candidate normals: all single-axis tilts at multiples of 11.25° (i.e., m*pi/16 for m=1..7) in XY, XZ, YZ
    const cand = [];
    const candSet = new Set();
    const pushNUnique = (x, y, z) => {
        const l = Math.hypot(x, y, z);
        if (l <= EPS) return;
        const nx = x / l, ny = y / l, nz = z / l;
        const key = `${Math.round(nx / 1e-6) * 1e-6},${Math.round(ny / 1e-6) * 1e-6},${Math.round(nz / 1e-6) * 1e-6}`;
        if (!candSet.has(key)) { candSet.add(key); cand.push([nx, ny, nz]); }
    };
    for (let m = 1; m <= 7; m++) {
        const t = Math.tan((Math.PI / 16) * m);
        // XY plane variants (z=0)
        [[1, t, 0], [1, -t, 0], [-1, t, 0], [-1, -t, 0], [t, 1, 0], [t, -1, 0], [-t, 1, 0], [-t, -1, 0]].forEach(v => pushNUnique(v[0], v[1], v[2]));
        // XZ plane variants (y=0)
        [[1, 0, t], [1, 0, -t], [-1, 0, t], [-1, 0, -t], [t, 0, 1], [t, 0, -1], [-t, 0, 1], [-t, 0, -1]].forEach(v => pushNUnique(v[0], v[1], v[2]));
        // YZ plane variants (x=0)
        [[0, 1, t], [0, 1, -t], [0, -1, t], [0, -1, -t], [0, t, 1], [0, t, -1], [0, -t, 1], [0, -t, -1]].forEach(v => pushNUnique(v[0], v[1], v[2]));
    }

    const maxDot = (n, pts) => {
        let m = -Infinity; for (const p of pts) { const s = n[0]*p[0] + n[1]*p[1] + n[2]*p[2]; if (s > m) m = s; } return m;
    };

    // Add up to four best cutting planes
    for (let iter = 0; iter < 4; iter++) {
        let best = null;
        for (const n of cand) {
            const dGeom = maxDot(n, points); // support plane touching geometry
            const dHull = maxDot(n, currentHullVerts);
            const cut = dHull - dGeom;
            if (cut > (best ? best.cut : 0)) {
                best = { n, d: dGeom, cut };
            }
        }
        if (!best || best.cut < 1e-3) break;
        addPlane(best.n, best.d);
        currentHullVerts = hullVerticesFromPlanes(planes);
        if (currentHullVerts.length === 0) break;
    }

    // Build mesh from final planes by collecting face polygons per plane
    const verts = hullVerticesFromPlanes(planes);
    if (verts.length < 4) return null;

    // Build faces for each plane
    const triangles = [];
    const positions = [];
    const normals = [];
    const addFace = (plane) => {
        const faceVerts = [];
        for (let i = 0; i < verts.length; i++) {
            const p = verts[i];
            const s = plane.n[0]*p[0] + plane.n[1]*p[1] + plane.n[2]*p[2];
            if (Math.abs(s - plane.d) < 1e-3) faceVerts.push(p);
        }
        if (faceVerts.length < 3) return;
        // Build local basis on the plane
        const n = plane.n;
        // Pick arbitrary vector not parallel to n
        const ref = Math.abs(n[0]) < 0.9 ? [1,0,0] : [0,1,0];
        // u = normalize(cross(ref, n)), v = cross(n, u)
        const ux = ref[1]*n[2] - ref[2]*n[1];
        const uy = ref[2]*n[0] - ref[0]*n[2];
        const uz = ref[0]*n[1] - ref[1]*n[0];
        const ul = Math.hypot(ux, uy, uz) || 1;
        const u = [ux/ul, uy/ul, uz/ul];
        const vx = n[1]*u[2] - n[2]*u[1];
        const vy = n[2]*u[0] - n[0]*u[2];
        const vz = n[0]*u[1] - n[1]*u[0];
        const v = [vx, vy, vz];
        // Sort around centroid
        let cx = 0, cy = 0, cz = 0;
        faceVerts.forEach(p => { cx += p[0]; cy += p[1]; cz += p[2]; });
        cx /= faceVerts.length; cy /= faceVerts.length; cz /= faceVerts.length;
        const pts2d = faceVerts.map(p => {
            const rx = p[0]-cx, ry = p[1]-cy, rz = p[2]-cz;
            return { p, x: u[0]*rx + u[1]*ry + u[2]*rz, y: v[0]*rx + v[1]*ry + v[2]*rz };
        });
        pts2d.sort((a,b)=> Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
        // Triangulate fan with consistent winding so that normal points outward (n)
        for (let i = 1; i + 1 < pts2d.length; i++) {
            const tri = [pts2d[0].p, pts2d[i].p, pts2d[i+1].p];
            triangles.push({ tri, n });
        }
    };
    planes.forEach(addFace);
    if (triangles.length === 0) return null;

    triangles.forEach(({ tri, n }) => {
        for (let i = 0; i < 3; i++) {
            const p = tri[i];
            positions.push(p[0], p[1], p[2]);
            normals.push(n[0], n[1], n[2]);
        }
    });

    const verticesArr = new Float32Array(positions);
    const normalsArr = new Float32Array(normals);
    const idxArr = new Uint16Array(verticesArr.length / 3);
    for (let i = 0; i < idxArr.length; i++) idxArr[i] = i;

    return { vertices: verticesArr, normals: normalsArr, indices: idxArr, color: baseColor };
}

function postProcessStudsIR(ir) {
    if (!ir || !Array.isArray(ir.studs) || !Array.isArray(ir.antiStuds)) return;
    const studs = ir.studs;
    const tol = 0.25;
    ir.antiStuds.forEach(a => {
        const s = studs.find(s => Math.abs(s.x - a.x) < tol && Math.abs(s.y - a.y) < tol);
        if (!s) return;
        const absSX = Math.abs(s.x);
        const absSZ = Math.abs(s.z);
        if (absSZ > absSX && absSZ > tol) {
            a.z = -s.z;
        } else if (absSX > tol) {
            a.x = -s.x;
        }
    });
}

function rebuildMarkersFromExtrasIR(ir) {
    if (!ir || !Array.isArray(ir.geometries)) return;
    const studs = Array.isArray(ir.studs) ? ir.studs : [];
    const tol = 0.25;
    ir.geometries.forEach(geom => {
        if (!geom || !geom.isMarker || geom.sourceType !== 'antistud' || !Array.isArray(geom.vertices)) return;
        const center = geom.markerCenterThree;
        if (!center) return;
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
        const dx = targetCenter.x - center.x;
        const dy = targetCenter.y - center.y;
        const dz = targetCenter.z - center.z;
        if (Math.abs(dx) < tol && Math.abs(dy) < tol && Math.abs(dz) < tol) return;
        for (let i = 0; i < geom.vertices.length; i += 3) {
            geom.vertices[i] += dx;
            geom.vertices[i + 1] += dy;
            geom.vertices[i + 2] += dz;
        }
        geom.markerCenterThree = targetCenter;
    });
}

function groupGeometriesByTypeAndColorIR(ir) {
    const groups = new Map();
    (ir.geometries || []).forEach(geom => {
        const sourceType = geom.sourceType || 'part';
        const key = `${sourceType}|${geom.color}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(geom);
    });
    return groups;
}

function processIR(ir, options = {}) {
    const smoothAngle = typeof options.smoothAngle === 'number' ? options.smoothAngle : 35;
    const shrunkSmoothAngle = typeof options.shrunkSmoothAngle === 'number' ? options.shrunkSmoothAngle : 179.9;
    const shrinkDistance = typeof options.shrinkDistance === 'number' ? options.shrinkDistance : 0.4;

    postProcessStudsIR(ir);
    rebuildMarkersFromExtrasIR(ir);

    const groups = groupGeometriesByTypeAndColorIR(ir);
    const processed = { ...ir, meshes: [], meshTypes: [], materials: new Map(), buffers: [], accessors: [], bufferViews: [] };

    let byteOffset = 0;
    groups.forEach((geoms, key) => {
        const [sourceType, colorStr] = key.split('|');
        const color = Number(colorStr);
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
        const vertexBuffer = new Float32Array(merged.vertices);
        const normalBuffer = new Float32Array(merged.normals);
        const indexBuffer = new Uint16Array(merged.indices);
        processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: vertexBuffer.byteLength, target: 34962 });
        processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5126, count: merged.vertices.length / 3, type: 'VEC3' });
        processed.buffers.push(vertexBuffer);
        byteOffset += vertexBuffer.byteLength;
        processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: normalBuffer.byteLength, target: 34962 });
        processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5126, count: merged.normals.length / 3, type: 'VEC3' });
        processed.buffers.push(normalBuffer);
        byteOffset += normalBuffer.byteLength;
        processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: indexBuffer.byteLength, target: 34963 });
        processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5123, count: merged.indices.length, type: 'SCALAR' });
        processed.buffers.push(indexBuffer);
        byteOffset += indexBuffer.byteLength;
        processed.meshes.push({ primitives: [{ attributes: { POSITION: processed.accessors.length - 3, NORMAL: processed.accessors.length - 2 }, indices: processed.accessors.length - 1, material: color }] });
        processed.meshTypes.push(sourceType);

        // Also add a fully smooth, shrunk variant derived from 'part' geometry (includes studs)
        if (sourceType === 'part') {
            // Compute original bounding box from 'part' (pre-shrink)
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let i = 0; i < merged.vertices.length; i += 3) {
                const x = merged.vertices[i], y = merged.vertices[i + 1], z = merged.vertices[i + 2];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
            // Shrink that bbox by 1/16 in LDraw units (same magnitudes here)
            const bboxMargin = 1 / 16; // 0.0625
            let sMinX = minX + bboxMargin, sMaxX = maxX - bboxMargin;
            let sMinY = minY + bboxMargin, sMaxY = maxY - bboxMargin;
            let sMinZ = minZ + bboxMargin, sMaxZ = maxZ - bboxMargin;
            // Handle degenerate small extents
            if (sMinX > sMaxX) { const cx = (minX + maxX) * 0.5; sMinX = cx; sMaxX = cx; }
            if (sMinY > sMaxY) { const cy = (minY + maxY) * 0.5; sMinY = cy; sMaxY = cy; }
            if (sMinZ > sMaxZ) { const cz = (minZ + maxZ) * 0.5; sMinZ = cz; sMaxZ = cz; }

            const mergedSmooth = calculateSmoothNormalsAndMerge(vertices, indices, shrunkSmoothAngle);
            // Shrink positions along their smooth normals
            const shrunkVertices = new Float32Array(mergedSmooth.vertices.length);
            for (let i = 0; i < mergedSmooth.vertices.length; i += 3) {
                const nx = mergedSmooth.normals[i];
                const ny = mergedSmooth.normals[i + 1];
                const nz = mergedSmooth.normals[i + 2];
                const px = mergedSmooth.vertices[i];
                const py = mergedSmooth.vertices[i + 1];
                const pz = mergedSmooth.vertices[i + 2];
                let qx = px - nx * shrinkDistance;
                let qy = py - ny * shrinkDistance;
                let qz = pz - nz * shrinkDistance;
                // Clamp to shrunk bbox: if outside, nudge to the plane
                if (qx < sMinX) qx = sMinX; else if (qx > sMaxX) qx = sMaxX;
                if (qy < sMinY) qy = sMinY; else if (qy > sMaxY) qy = sMaxY;
                if (qz < sMinZ) qz = sMinZ; else if (qz > sMaxZ) qz = sMaxZ;
                shrunkVertices[i] = qx;
                shrunkVertices[i + 1] = qy;
                shrunkVertices[i + 2] = qz;
            }
            const shrunkNormals = new Float32Array(mergedSmooth.normals);
            const shrunkIndices = new Uint16Array(mergedSmooth.indices);
            processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: shrunkVertices.byteLength, target: 34962 });
            processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5126, count: shrunkVertices.length / 3, type: 'VEC3' });
            processed.buffers.push(shrunkVertices);
            byteOffset += shrunkVertices.byteLength;
            processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: shrunkNormals.byteLength, target: 34962 });
            processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5126, count: shrunkNormals.length / 3, type: 'VEC3' });
            processed.buffers.push(shrunkNormals);
            byteOffset += shrunkNormals.byteLength;
            processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: shrunkIndices.byteLength, target: 34963 });
            processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5123, count: shrunkIndices.length, type: 'SCALAR' });
            processed.buffers.push(shrunkIndices);
            byteOffset += shrunkIndices.byteLength;
            processed.meshes.push({ primitives: [{ attributes: { POSITION: processed.accessors.length - 3, NORMAL: processed.accessors.length - 2 }, indices: processed.accessors.length - 1, material: color }] });
            processed.meshTypes.push('shrunk');
        }
    });

    // Build and append convex mesh from part-no-studs geometry
    try {
        const partNoStudGeoms = (ir.geometries || []).filter(g => (g.sourceType || 'part') === 'part' && !g.fromStudPrimitive);
        const convex = computeConvexHullFromGeoms(partNoStudGeoms);
        if (convex && convex.vertices.length >= 9) {
            // Positions
            processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: convex.vertices.byteLength, target: 34962 });
            processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5126, count: convex.vertices.length / 3, type: 'VEC3' });
            processed.buffers.push(convex.vertices);
            byteOffset += convex.vertices.byteLength;
            // Normals
            processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: convex.normals.byteLength, target: 34962 });
            processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5126, count: convex.normals.length / 3, type: 'VEC3' });
            processed.buffers.push(convex.normals);
            byteOffset += convex.normals.byteLength;
            // Indices
            processed.bufferViews.push({ buffer: 0, byteOffset, byteLength: convex.indices.byteLength, target: 34963 });
            processed.accessors.push({ bufferView: processed.bufferViews.length - 1, componentType: 5123, count: convex.indices.length, type: 'SCALAR' });
            processed.buffers.push(convex.indices);
            byteOffset += convex.indices.byteLength;
            processed.meshes.push({ primitives: [{ attributes: { POSITION: processed.accessors.length - 3, NORMAL: processed.accessors.length - 2 }, indices: processed.accessors.length - 1, material: convex.color }] });
            processed.meshTypes.push('convex');
        }
    } catch (e) {
        // non-fatal
    }

    return processed;
}

module.exports = {
    processIR,
    postProcessStudsIR,
    rebuildMarkersFromExtrasIR,
    computeConvexHullFromGeoms,
};


