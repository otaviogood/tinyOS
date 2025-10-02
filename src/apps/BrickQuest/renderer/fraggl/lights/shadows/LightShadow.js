export class LightShadow {
    constructor() {
        this.mapSize = { width: 1024, height: 1024 };
        this.bias = -0.0005;          // constant compare bias
        this.normalBias = 0.0;        // receiver offset along normal (future)
        this.radius = 1.0;            // PCF radius in texels
        // orthographic bounds for directional; perspective params for spot/point later
        this.camera = { left: -20, right: 20, top: 20, bottom: -20, near: 0.5, far: 200.0 };
        // Target position for shadow camera (used when light position is explicitly set)
        this.target = null;
    }

    copy(source) {
        if (!source) return this;
        if (source.mapSize) {
            this.mapSize = { width: source.mapSize.width, height: source.mapSize.height };
        }
        if (source.camera) {
            this.camera = {
                left: source.camera.left,
                right: source.camera.right,
                top: source.camera.top,
                bottom: source.camera.bottom,
                near: source.camera.near,
                far: source.camera.far,
            };
        }
        if (source.bias !== undefined) this.bias = source.bias;
        if (source.normalBias !== undefined) this.normalBias = source.normalBias;
        if (source.radius !== undefined) this.radius = source.radius;
        if (source.target !== undefined) this.target = source.target;
        return this;
    }
}


