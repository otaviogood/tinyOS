import { Texture } from './Texture.js';

function isImageSource(source) {
    return source instanceof ImageBitmap || (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement);
}

async function loadImage(url, options = {}) {
    if (options.imageBitmapOptions && typeof createImageBitmap === 'function') {
        const response = await fetch(url, options.fetchOptions);
        if (!response.ok) throw new Error(`Failed to fetch texture: ${url}`);
        const blob = await response.blob();
        return await createImageBitmap(blob, options.imageBitmapOptions);
    }
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = options.crossOrigin ?? 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = (err) => reject(err instanceof Error ? err : new Error('Image load error'));
        image.src = url;
    });
}

export class TextureLoader {
    constructor() {
        this.path = '';
    }

    setPath(path) {
        this.path = path || '';
        return this;
    }

    async loadAsync(url, options = {}) {
        const base = this.path ? this.path.replace(/\/?$/, '/') : '';
        const fullUrl = base ? base + url : url;
        const image = options.source && isImageSource(options.source)
            ? options.source
            : await loadImage(fullUrl, options);
        const texture = new Texture({ ...options, image });
        texture.needsUpload = true;
        return texture;
    }
}


