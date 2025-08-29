const RandomFast = require('../random-fast');

function Noise2DFBM(x, y) {
    let total = 0.0;
    let amplitude = 0.5;
    let frequency = 1;
    let amplitudeSum = 0.0;
    for (let i = 0; i < 6; i++) {
        const xf = x * frequency;
        const yf = y * frequency;
        const xi = Math.floor(xf);
        const yi = Math.floor(yf);
        const tx = xf - xi;
        const ty = yf - yi;

        const h00 = RandomFast.HashI2(xi, yi);
        const h10 = RandomFast.HashI2(xi + 1, yi);
        const h01 = RandomFast.HashI2(xi, yi + 1);
        const h11 = RandomFast.HashI2(xi + 1, yi + 1);

        const v00 = Number((h00 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;
        const v10 = Number((h10 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;
        const v01 = Number((h01 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;
        const v11 = Number((h11 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;

        const v0 = v00 + (v10 - v00) * tx;
        const v1 = v01 + (v11 - v01) * tx;
        const value = v0 + (v1 - v0) * ty;

        total += value * amplitude;
        amplitudeSum += amplitude;
        amplitude *= 0.5;
        frequency <<= 1;
    }
    return total / amplitudeSum;
}

function Noise2DFBMWithNormal(x, y) {
    let total = 0.0;
    let ddx = 0.0;
    let ddy = 0.0;
    let amplitude = 0.5;
    let frequency = 1;
    let amplitudeSum = 0.0;
    for (let i = 0; i < 6; i++) {
        const xf = x * frequency;
        const yf = y * frequency;
        const xi = Math.floor(xf);
        const yi = Math.floor(yf);
        const tx = xf - xi;
        const ty = yf - yi;

        const h00 = RandomFast.HashI2(xi, yi);
        const h10 = RandomFast.HashI2(xi + 1, yi);
        const h01 = RandomFast.HashI2(xi, yi + 1);
        const h11 = RandomFast.HashI2(xi + 1, yi + 1);

        const v00 = Number((h00 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;
        const v10 = Number((h10 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;
        const v01 = Number((h01 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;
        const v11 = Number((h11 >>> 8) & 0xffffff) * RandomFast.invMax24Bit;

        const v0 = v00 + (v10 - v00) * tx;
        const v1 = v01 + (v11 - v01) * tx;
        const value = v0 + (v1 - v0) * ty;

        const dv_dtx = (1 - ty) * (v10 - v00) + ty * (v11 - v01);
        const dv_dty = (1 - tx) * (v01 - v00) + tx * (v11 - v10);

        total += value * amplitude;
        ddx += (dv_dtx * frequency) * amplitude;
        ddy += (dv_dty * frequency) * amplitude;
        amplitudeSum += amplitude;
        amplitude *= 0.5;
        frequency <<= 1;
    }
    const height = total / amplitudeSum;
    const dhdx = ddx / amplitudeSum;
    const dhdy = ddy / amplitudeSum;
    const invLen = 1.0 / Math.sqrt(1.0 + dhdx * dhdx + dhdy * dhdy);
    const nx = -dhdx * invLen;
    const nz = -dhdy * invLen;
    return { value: height, nx, nz };
}

module.exports = { Noise2DFBM, Noise2DFBMWithNormal };


