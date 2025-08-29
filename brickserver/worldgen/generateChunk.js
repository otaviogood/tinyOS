// @ts-nocheck
// Simple placeholder worldgen: builds a small flat platform centered in the given chunk
// Returns an array of brick descriptors. If gameState is provided, ids will be assigned
// by incrementing gameState.nextBrickId. Otherwise you suck.

const { CHUNK_SIZE_XZ } = require('../collision');
const { Noise2DFBMWithNormal } = require('./noise');

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
    const spacing = 20; // grid spacing that matches common LEGO plate spacing
    const size = CHUNK_SIZE_XZ / 20 / 1;     // size x size tiles, ldraw units, 2x2 plates
    const baseY = 0;      // base height
    const colorIndex = 4; // default color
    let pieceId = '3024'; // 2x2 plate=3022 1x1plate=3024

    // Center the platform within the chunk so every brick's AABB center lives in this chunk
    const originX = cx * CHUNK_SIZE_XZ + (CHUNK_SIZE_XZ * 0.5);
    const originZ = cz * CHUNK_SIZE_XZ + (CHUNK_SIZE_XZ * 0.5);

    const half = (size - 1) * spacing * 0.5;

    const bricks = [];
    for (let ix = 0; ix < size; ix++) {
        for (let iz = 0; iz < size; iz++) {
            const px = originX + (ix * spacing - half);
            const pz = originZ + (iz * spacing - half);
    
            // Deterministic height using smooth FBM noise + normal
            const hxz = Noise2DFBMWithNormal(px * 0.00125, pz * 0.00125);
            let height = ((hxz.value * 32) | 0) * 8; // quantize to plate multiples
            let color = (hxz.nx > 0.2) ? 4 : 8;
            if (hxz.nx > 0.5) color = 5;
            if (hxz.nz > 0.3) color = 3;
            if (height < 10*8) {
                height = (10-1)*8;
                color = 11;
                pieceId = '3070';
            } else pieceId = '3024';
            const brick = {
                position: { x: px, y: baseY + height - 8 *12, z: pz },
                rotation: { x: 0, y: 0, z: 0 },
                colorIndex: color,
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


