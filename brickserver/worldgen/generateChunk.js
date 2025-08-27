// @ts-nocheck
// Simple placeholder worldgen: builds a small flat platform centered in the given chunk
// Returns an array of brick descriptors. If gameState is provided, ids will be assigned
// by incrementing gameState.nextBrickId. Otherwise you suck.

const { CHUNK_SIZE_XZ } = require('../collision');

/**
 * Generate base bricks for a chunk.
 * @param {number} cx - chunk x index
 * @param {number} cy - chunk y index
 * @param {number} cz - chunk z index
 * @param {object} [gameState]
 * @returns {Array<{id?:string, position:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number}, colorIndex:number, pieceId:string, type:string}>}
 */
function generateChunk(cx, cy, cz, gameState) {
    // Platform params (in world units)
    const spacing = 40; // grid spacing that matches common LEGO plate spacing
    const size = CHUNK_SIZE_XZ / 20 / 2;     // size x size tiles, ldraw units, 2x2 plates
    const y = -32;      // slightly below 0 so player stands above
    const colorIndex = 0; // default color
    const pieceId = '3022'; // 2x2 plate (safe fallback)

    // Center the platform within the chunk so every brick's AABB center lives in this chunk
    const originX = cx * CHUNK_SIZE_XZ + (CHUNK_SIZE_XZ * 0.5);
    const originZ = cz * CHUNK_SIZE_XZ + (CHUNK_SIZE_XZ * 0.5);

    const half = (size - 1) * spacing * 0.5;

    const bricks = [];
    for (let ix = 0; ix < size; ix++) {
        for (let iz = 0; iz < size; iz++) {
            const px = originX + (ix * spacing - half);
            const pz = originZ + (iz * spacing - half);
            const brick = {
                position: { x: px, y, z: pz },
                rotation: { x: 0, y: 0, z: 0 },
                colorIndex,
                pieceId,
                type: 'ground',
                id: String(gameState.nextBrickId++),
            };
            bricks.push(brick);
        }
    }
    return bricks;
}

module.exports = { generateChunk };


