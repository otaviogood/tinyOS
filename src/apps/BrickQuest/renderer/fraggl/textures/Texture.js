let _textureId = 0;

const ADDRESS_MODE = {
    repeat: 'repeat',
    'clamp-to-edge': 'clamp-to-edge',
    'mirror-repeat': 'mirror-repeat'
};

const FILTER_MODE = {
    nearest: 'nearest',
    linear: 'linear'
};

export class Texture {
    constructor(params = {}) {
        this.id = _textureId++;
        this.isTexture = true;
        this.source = params.source || null;
        this.image = params.image || null; // ImageBitmap/Canvas/Video
        this.colorSpace = (params.colorSpace || 'srgb').toLowerCase();
        this.flipY = params.flipY ?? false;
        this.wrapS = ADDRESS_MODE[params.wrapS] || 'repeat';
        this.wrapT = ADDRESS_MODE[params.wrapT] || 'repeat';
        this.minFilter = FILTER_MODE[params.minFilter] || 'linear';
        this.magFilter = FILTER_MODE[params.magFilter] || 'linear';
        this.generateMipmaps = params.generateMipmaps ?? false;
        this.anisotropy = params.anisotropy ?? 1;
        this.needsUpload = true;
        this.version = 0;
        this.userData = params.userData ? { ...params.userData } : {};
        this.offset = params.offset ? params.offset.slice(0, 2) : [0, 0];
        this.repeat = params.repeat ? params.repeat.slice(0, 2) : [1, 1];
    }

    setImage(image) {
        if (!image) return;
        this.image = image;
        this.needsUpload = true;
        this.version++;
    }

    setColorSpace(colorSpace) {
        const normalized = (colorSpace || '').toLowerCase();
        if (normalized !== 'srgb' && normalized !== 'linear') {
            throw new Error(`Unsupported texture colorSpace: ${colorSpace}`);
        }
        if (this.colorSpace !== normalized) {
            this.colorSpace = normalized;
            this.version++;
        }
        return this;
    }

    setWrap(wrapS, wrapT = wrapS) {
        const nextS = ADDRESS_MODE[wrapS] || this.wrapS;
        const nextT = ADDRESS_MODE[wrapT] || this.wrapT;
        if (nextS !== this.wrapS || nextT !== this.wrapT) {
            this.wrapS = nextS;
            this.wrapT = nextT;
            this.version++;
        }
        return this;
    }

    setFilters(minFilter, magFilter = minFilter) {
        const nextMin = FILTER_MODE[minFilter] || this.minFilter;
        const nextMag = FILTER_MODE[magFilter] || this.magFilter;
        if (nextMin !== this.minFilter || nextMag !== this.magFilter) {
            this.minFilter = nextMin;
            this.magFilter = nextMag;
            this.version++;
        }
        return this;
    }

    markNeedsUpload() {
        this.needsUpload = true;
        this.version++;
    }

    dispose() {
        this.image = null;
        this.source = null;
        this.userData = {};
        this._gpu = undefined;
    }
}


