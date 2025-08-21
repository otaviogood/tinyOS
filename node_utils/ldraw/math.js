// Shared math helpers for LDraw parsing and GLTF generation

function transformPosition(pos, matrix) {
    const x = pos.x * matrix.a + pos.y * matrix.b + pos.z * matrix.c + matrix.x;
    const y = pos.x * matrix.d + pos.y * matrix.e + pos.z * matrix.f + matrix.y;
    const z = pos.x * matrix.g + pos.y * matrix.h + pos.z * matrix.i + matrix.z;
    return { x, y, z };
}

function transformDirection(dir, matrix) {
    const x = dir.x * matrix.a + dir.y * matrix.b + dir.z * matrix.c;
    const y = dir.x * matrix.d + dir.y * matrix.e + dir.z * matrix.f;
    const z = dir.x * matrix.g + dir.y * matrix.h + dir.z * matrix.i;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len };
}

function transformVertices(vertices, matrix) {
    for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i];
        const y = vertices[i + 1];
        const z = vertices[i + 2];
        vertices[i] = matrix.a * x + matrix.b * y + matrix.c * z + matrix.x;
        vertices[i + 1] = matrix.d * x + matrix.e * y + matrix.f * z + matrix.y;
        vertices[i + 2] = matrix.g * x + matrix.h * y + matrix.i * z + matrix.z;
    }
}

function applyThreeJSCoordinateTransform(vertices) {
    for (let i = 0; i < vertices.length; i += 3) {
        vertices[i + 1] = -vertices[i + 1];
        vertices[i + 2] = -vertices[i + 2];
    }
}

function multiplyMatrices(m1, m2) {
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

function getMatrixDeterminant(matrix) {
    if (!matrix) return 1;
    const { a, b, c, d, e, f, g, h, i } = matrix;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

module.exports = {
    transformPosition,
    transformDirection,
    transformVertices,
    applyThreeJSCoordinateTransform,
    multiplyMatrices,
    getMatrixDeterminant,
};


