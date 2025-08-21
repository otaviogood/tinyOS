// Normals and vertex merge utilities used by processing and exporters

function calculateSmoothNormalsAndMerge(vertices, indices, smoothAngleDegrees = 35) {
    const vertexCount = vertices.length / 3;
    const smoothAngleRad = smoothAngleDegrees * Math.PI / 180;
    const positionTolerance = .02;
    const normalTolerance = 1e-3;

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
        const length = Math.sqrt(faceNormal[0] * faceNormal[0] + faceNormal[1] * faceNormal[1] + faceNormal[2] * faceNormal[2]);
        if (length > 0) {
            faceNormals.push([faceNormal[0] / length, faceNormal[1] / length, faceNormal[2] / length]);
        } else {
            faceNormals.push([0, 1, 0]);
        }
    }

    const vertexToFaces = new Array(vertexCount).fill(null).map(() => []);
    for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        const i0 = indices[faceIdx * 3];
        const i1 = indices[faceIdx * 3 + 1];
        const i2 = indices[faceIdx * 3 + 2];
        vertexToFaces[i0].push(faceIdx);
        vertexToFaces[i1].push(faceIdx);
        vertexToFaces[i2].push(faceIdx);
    }

    const positionToVertices = new Map();
    for (let i = 0; i < vertexCount; i++) {
        const x = vertices[i * 3];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];
        const key = `${Math.round(x / positionTolerance) * positionTolerance},${Math.round(y / positionTolerance) * positionTolerance},${Math.round(z / positionTolerance) * positionTolerance}`;
        if (!positionToVertices.has(key)) positionToVertices.set(key, []);
        positionToVertices.get(key).push(i);
    }

    const vertexNormals = new Array(vertexCount);
    for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
        const x = vertices[vertexIdx * 3];
        const y = vertices[vertexIdx * 3 + 1];
        const z = vertices[vertexIdx * 3 + 2];
        const key = `${Math.round(x / positionTolerance) * positionTolerance},${Math.round(y / positionTolerance) * positionTolerance},${Math.round(z / positionTolerance) * positionTolerance}`;
        const sharedVertices = positionToVertices.get(key) || [vertexIdx];
        const allFaces = new Set();
        sharedVertices.forEach(vi => { vertexToFaces[vi].forEach(faceIdx => allFaces.add(faceIdx)); });
        const primaryFaces = vertexToFaces[vertexIdx];
        if (primaryFaces.length === 0) { vertexNormals[vertexIdx] = [0, 1, 0]; continue; }
        let normalSum = [0, 0, 0];
        let count = 0;
        for (const primaryFaceIdx of primaryFaces) {
            const primaryNormal = faceNormals[primaryFaceIdx];
            for (const faceIdx of allFaces) {
                const faceNormal = faceNormals[faceIdx];
                const dot = primaryNormal[0] * faceNormal[0] + primaryNormal[1] * faceNormal[1] + primaryNormal[2] * faceNormal[2];
                const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                if (angle <= smoothAngleRad) {
                    normalSum[0] += faceNormal[0];
                    normalSum[1] += faceNormal[1];
                    normalSum[2] += faceNormal[2];
                    count++;
                }
            }
        }
        if (count === 0 && primaryFaces.length > 0) {
            const primaryNormal = faceNormals[primaryFaces[0]];
            normalSum = [primaryNormal[0], primaryNormal[1], primaryNormal[2]];
            count = 1;
        }
        const length = Math.sqrt(normalSum[0] * normalSum[0] + normalSum[1] * normalSum[1] + normalSum[2] * normalSum[2]);
        if (length > 0) {
            vertexNormals[vertexIdx] = [normalSum[0] / length, normalSum[1] / length, normalSum[2] / length];
        } else {
            vertexNormals[vertexIdx] = [0, 1, 0];
        }
    }

    const mergedVertices = [];
    const mergedNormals = [];
    const vertexRemapping = new Array(vertexCount);
    const uniqueVertexMap = new Map();
    for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
        const x = vertices[vertexIdx * 3];
        const y = vertices[vertexIdx * 3 + 1];
        const z = vertices[vertexIdx * 3 + 2];
        const normal = vertexNormals[vertexIdx];
        const posKey = `${Math.round(x / positionTolerance) * positionTolerance},${Math.round(y / positionTolerance) * positionTolerance},${Math.round(z / positionTolerance) * positionTolerance}`;
        const normalKey = `${Math.round(normal[0] / normalTolerance) * normalTolerance},${Math.round(normal[1] / normalTolerance) * normalTolerance},${Math.round(normal[2] / normalTolerance) * normalTolerance}`;
        const uniqueKey = `${posKey}|${normalKey}`;
        if (uniqueVertexMap.has(uniqueKey)) {
            vertexRemapping[vertexIdx] = uniqueVertexMap.get(uniqueKey);
        } else {
            const newIndex = mergedVertices.length / 3;
            mergedVertices.push(x, y, z);
            mergedNormals.push(normal[0], normal[1], normal[2]);
            uniqueVertexMap.set(uniqueKey, newIndex);
            vertexRemapping[vertexIdx] = newIndex;
        }
    }

    const mergedIndices = [];
    for (let i = 0; i < indices.length; i++) {
        mergedIndices.push(vertexRemapping[indices[i]]);
    }

    return { vertices: mergedVertices, normals: mergedNormals, indices: mergedIndices };
}

function calculateSmoothNormals(vertices, indices, smoothAngleDegrees = 30) {
    const result = calculateSmoothNormalsAndMerge(vertices, indices, smoothAngleDegrees);
    return result.normals;
}

module.exports = { calculateSmoothNormalsAndMerge, calculateSmoothNormals };


