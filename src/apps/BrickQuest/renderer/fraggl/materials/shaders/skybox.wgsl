// Skybox shader for Fraggl
// Renders environment sphere from inside

struct Frame { 
    viewProj: mat4x4f, 
    cameraPos: vec3f, 
    exposure: f32, 
    lightViewProj: mat4x4f 
};

struct VSOut { 
    @builtin(position) position: vec4f, 
    @location(0) vUV: vec2f 
};

@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;
@group(1) @binding(1) var<uniform> u_normal: mat3x3f;
@group(2) @binding(0) var baseSampler: sampler;
@group(2) @binding(1) var baseMap: texture_2d<f32>;

@vertex fn vs_main(@location(0) pos: vec3f, @location(1) uv: vec2f) -> VSOut {
    var o: VSOut;
    o.position = u_frame.viewProj * (u_model * vec4f(pos, 1.0));
    o.vUV = uv;
    return o;
}

@fragment fn fs_main(i: VSOut) -> @location(0) vec4f {
    var c = textureSample(baseMap, baseSampler, vec2f(i.vUV.x, 1.0 - i.vUV.y)).rgb;
    c = c * u_frame.exposure;
    c = pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2));
    return vec4f(c, 1.0);
}

