// @ts-nocheck
/**
 * Player label system for Fraggl renderer
 * Creates camera-facing text billboards for player names
 */

import { Mesh } from './fraggl/core/Mesh.js';
import { BufferGeometry } from './fraggl/core/BufferGeometry.js';
import { BufferAttribute } from './fraggl/core/BufferAttribute.js';
import { Texture } from './fraggl/textures/Texture.js';
import { TextBillboardMaterial } from './fraggl/materials/TextBillboardMaterial.js';

/**
 * Creates a canvas-based texture with rendered text
 * @param {string} text - Text to render
 * @param {object} options - Rendering options
 * @returns {Texture} - Fraggl texture
 */
function createTextTexture(text, options = {}) {
    const {
        fontSize = 48,
        fontFamily = 'Arial, sans-serif',
        textColor = '#ffffff',
        padding = 16,
    } = options;

    // Create canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set font for measurement
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;
    
    // Size canvas with padding (use power-of-two dimensions for better GPU compatibility)
    const width = Math.pow(2, Math.ceil(Math.log2(textWidth + padding * 2)));
    const height = Math.pow(2, Math.ceil(Math.log2(textHeight + padding * 2)));
    canvas.width = width;
    canvas.height = height;
    
    // Set font again after resize
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Enable better text rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw text with slight shadow for better visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = textColor;
    ctx.fillText(text, width / 2, height / 2);
    
    // Draw again without shadow for crispness
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = textColor;
    ctx.fillText(text, width / 2, height / 2);
    
    // Create Fraggl texture from canvas
    const texture = new Texture({
        image: canvas,
        colorSpace: 'srgb',
        flipY: false,
        wrapS: 'clamp-to-edge',
        wrapT: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
        generateMipmaps: false
    });
    texture.needsUpload = true;
    
    return texture;
}

/**
 * Creates a billboard geometry (quad that will face the camera)
 * @param {number} width - Width of the billboard
 * @param {number} height - Height of the billboard
 * @returns {BufferGeometry}
 */
function createBillboardGeometry(width, height) {
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    
    const positions = new Float32Array([
        -halfW, -halfH, 0,
        halfW, -halfH, 0,
        halfW, halfH, 0,
        -halfW, halfH, 0,
    ]);
    
    const uvs = new Float32Array([
        0, 1,
        1, 1,
        1, 0,
        0, 0,
    ]);
    
    const indices = new Uint16Array([
        0, 1, 2,
        0, 2, 3,
    ]);
    
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    
    return geometry;
}

/**
 * Player labels manager
 */
export class PlayerLabelsManager {
    constructor(scene) {
        this.scene = scene;
        this.labels = new Map(); // playerId -> { mesh, texture, playerName }
    }
    
    /**
     * Creates or updates a label for a player
     * @param {string} playerId - Player ID
     * @param {string} playerName - Player name to display
     * @param {object} position - Initial position {x, y, z}
     */
    createOrUpdateLabel(playerId, playerName, position = { x: 0, y: 0, z: 0 }) {
        // Skip if name is empty or invalid
        if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
            return;
        }
        
        const existing = this.labels.get(playerId);
        
        // If label exists with same name, just update position
        if (existing && existing.playerName === playerName) {
            existing.mesh.position.set(position.x, position.y, position.z);
            return;
        }
        
        // Remove old label if it exists
        if (existing) {
            this.removeLabel(playerId);
        }
        
        // Create new label
        const texture = createTextTexture(playerName, {
            fontSize: 48,
            fontFamily: 'Arial, sans-serif',
            textColor: '#ffffff',
            padding: 16,
        });
        
        // Create material with transparency
        const material = new TextBillboardMaterial({
            map: texture,
            color: [1, 1, 1, 1],
            transparent: true,
            depthWrite: false,
            depthTest: true,
        });
        
        // Create billboard geometry (size based on text length) - doubled size
        const labelWidth = Math.min(120, playerName.length * 16);
        const labelHeight = 30;
        const geometry = createBillboardGeometry(labelWidth, labelHeight);
        
        // Create mesh
        const mesh = new Mesh(geometry, material);
        mesh.position.set(position.x, position.y, position.z);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        
        // Add to scene
        this.scene.add(mesh);
        
        // Store reference
        this.labels.set(playerId, {
            mesh,
            texture,
            playerName,
        });
    }
    
    /**
     * Updates label position to follow player
     * @param {string} playerId - Player ID
     * @param {object} playerMesh - Player mesh with position
     * @param {number} heightOffset - Height above player (default 45)
     */
    updateLabelPosition(playerId, playerMesh, heightOffset = 55) {
        const label = this.labels.get(playerId);
        if (!label || !playerMesh || !playerMesh.position) return;
        
        const baseY = playerMesh.position.y || 0;
        label.mesh.position.set(
            playerMesh.position.x,
            baseY + heightOffset,
            playerMesh.position.z
        );
    }
    
    /**
     * Updates label to face the camera (billboard effect)
     * @param {string} playerId - Player ID
     * @param {object} camera - Camera object with quaternion
     */
    updateLabelRotation(playerId, camera) {
        const label = this.labels.get(playerId);
        if (!label || !camera || !camera.quaternion) return;
        
        // Copy camera rotation to make billboard face camera
        if (label.mesh.rotation) {
            // Convert quaternion to euler for the billboard
            label.mesh.rotation.setFromQuaternion(camera.quaternion);
        }
    }
    
    /**
     * Sets label visibility
     * @param {string} playerId - Player ID
     * @param {boolean} visible - Visibility state
     */
    setLabelVisibility(playerId, visible) {
        const label = this.labels.get(playerId);
        if (!label) return;
        
        label.mesh.visible = visible;
    }
    
    /**
     * Removes a label for a player
     * @param {string} playerId - Player ID
     */
    removeLabel(playerId) {
        const label = this.labels.get(playerId);
        if (!label) return;
        
        // Remove from scene
        this.scene.remove(label.mesh);
        
        // Cleanup resources
        if (label.texture && label.texture.dispose) {
            try {
                label.texture.dispose();
            } catch (_) {}
        }
        
        if (label.mesh.material && label.mesh.material.dispose) {
            try {
                label.mesh.material.dispose();
            } catch (_) {}
        }
        
        if (label.mesh.geometry) {
            try {
                label.mesh.geometry = null;
            } catch (_) {}
        }
        
        this.labels.delete(playerId);
    }
    
    /**
     * Updates all labels (position and rotation)
     * @param {Map} playerMeshes - Map of playerId -> playerMesh
     * @param {object} camera - Camera object
     * @param {string} localPlayerId - Local player ID (to hide their label in first person)
     * @param {boolean} isThirdPerson - Whether camera is in third person
     */
    updateAll(playerMeshes, camera, localPlayerId = null, isThirdPerson = false) {
        for (const [playerId, label] of this.labels) {
            const playerMesh = playerMeshes.get(playerId);
            
            if (playerMesh) {
                // Update position
                this.updateLabelPosition(playerId, playerMesh);
                
                // Update rotation to face camera
                this.updateLabelRotation(playerId, camera);
                
                // Hide local player's label in first-person view
                const shouldBeVisible = !(localPlayerId && playerId === localPlayerId && !isThirdPerson);
                this.setLabelVisibility(playerId, shouldBeVisible);
            }
        }
    }
    
    /**
     * Removes all labels
     */
    clear() {
        for (const playerId of this.labels.keys()) {
            this.removeLabel(playerId);
        }
        this.labels.clear();
    }
    
    /**
     * Gets label mesh for a player
     * @param {string} playerId - Player ID
     * @returns {Mesh|null}
     */
    getLabel(playerId) {
        const label = this.labels.get(playerId);
        return label ? label.mesh : null;
    }
}

