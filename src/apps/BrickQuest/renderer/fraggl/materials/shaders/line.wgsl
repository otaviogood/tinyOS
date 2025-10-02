// Line rendering shader for Fraggl
// Simple unlit line rendering with vertex colors

struct Frame { 
    viewProj: mat4x4f, 
    cameraPos: vec3f, 
    exposure: f32, 
    lightViewProj: mat4x4f 
};

struct VSOut { 
    @builtin(position) position: vec4f, 
    @location(0) color: vec4f 
};

@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;

@vertex fn vs_main(@location(0) pos: vec3f, @location(1) color: vec4f) -> VSOut {
    var o: VSOut;
    o.position = u_frame.viewProj * (u_model * vec4f(pos, 1.0));
    o.color = color;
    return o;
}

@fragment fn fs_main(i: VSOut) -> @location(0) vec4f {
    var c = i.color.rgb * u_frame.exposure;
    c = pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2));
    return vec4f(c, i.color.a);
}

