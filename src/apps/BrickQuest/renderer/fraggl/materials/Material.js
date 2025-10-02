import { generateUUID } from '../math/MathUtils.js';

let _materialId = 0;

export class Material {
    constructor(params = {}) {
        Object.defineProperty(this, 'id', { value: _materialId++ });
        this.uuid = generateUUID();
        this.name = '';
        this.type = 'Material';
        this.isMaterial = true;

        this.blending = 'normal';
        this.side = 'front';
        this.opacity = 1;
        this.transparent = false;
        this.vertexColors = false;
        this.depthTest = true;
        this.depthWrite = true;
        this.visible = true;
        this.userData = {};
        this.version = 0;

        this._listeners = undefined;

        this.setValues(params);
    }

    set needsUpdate(value) {
        if (value === true) {
            this.version++;
        }
    }

    get needsUpdate() {
        return false;
    }

    setValues(values) {
        if (!values) return this;
        for (const key of Object.keys(values)) {
            if (key === 'id' || key === 'uuid' || key === 'isMaterial' || key === 'type') continue;
            if (!(key in this)) continue;
            const value = values[key];
            if (value === undefined) continue;
            const current = this[key];
            if (Array.isArray(current) && Array.isArray(value)) {
                this[key] = value.slice();
            } else if (current && typeof current === 'object' && current.constructor === Object && typeof value === 'object' && value !== null) {
                this[key] = { ...current, ...value };
            } else {
                this[key] = value;
            }
        }
        return this;
    }

    clone() { return new Material().copy(this); }

    copy(source) {
        this.name = source.name;
        this.type = source.type;
        this.blending = source.blending;
        this.side = source.side;
        this.opacity = source.opacity;
        this.transparent = source.transparent;
        this.vertexColors = source.vertexColors;
        this.depthTest = source.depthTest;
        this.depthWrite = source.depthWrite;
        this.visible = source.visible;
        this.userData = { ...source.userData };
        this.version = source.version;
        return this;
    }

    dispose() {
        this.dispatchEvent({ type: 'dispose' });
    }

    addEventListener(type, listener) {
        if (!type || typeof listener !== 'function') return this;
        if (!this._listeners) this._listeners = new Map();
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(listener);
        return this;
    }

    hasEventListener(type, listener) {
        if (!this._listeners) return false;
        const set = this._listeners.get(type);
        return !!(set && set.has(listener));
    }

    removeEventListener(type, listener) {
        if (!this._listeners) return this;
        const set = this._listeners.get(type);
        if (!set) return this;
        set.delete(listener);
        if (set.size === 0) this._listeners.delete(type);
        return this;
    }

    dispatchEvent(event) {
        if (!event || typeof event.type !== 'string') return this;
        if (!this._listeners) return this;
        const set = this._listeners.get(event.type);
        if (!set || set.size === 0) return this;
        event.target = this;
        for (const listener of Array.from(set)) {
            try {
                listener.call(this, event);
            } catch (err) {
                console.error('Material listener error', err);
            }
        }
        return this;
    }

    // Optional extensibility hooks for custom materials
    // Renderer will call these when present and fall back to defaults otherwise.
    getWGSL() { return null; }
    getBindGroupLayout(/* device */) { return null; }
    getVertexBufferLayouts() { return null; }
    getPipelineState() { return null; }
    setVertexBuffers(/* pass, renderer, gpu, geo */) { /* optional */ }
    getBindGroupEntries(/* renderer */) { return null; }
}

export const FrontSide = 'front';
export const BackSide = 'back';
export const DoubleSide = 'double';
export const NoBlending = 'none';
export const NormalBlending = 'normal';

