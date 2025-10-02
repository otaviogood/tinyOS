// Text Billboard shader - simple unlit texture with alpha blending

struct Frame {
    viewProj: mat4x4f,
    cameraPos: vec3f,
    exposure: f32,
    lightViewProj: mat4x4f,
};

@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;
@group(1) @binding(1) var<uniform> u_normal: mat3x3f;

@group(2) @binding(0) var<uniform> u_color: vec4f;
@group(2) @binding(1) var u_sampler: sampler;
@group(2) @binding(2) var u_texture: texture_2d<f32>;

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Transform position to world space
    let worldPos = u_model * vec4f(in.position, 1.0);
    
    // Transform to clip space
    out.position = u_frame.viewProj * worldPos;
    out.uv = in.uv;
    
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Sample texture
    let texColor = textureSample(u_texture, u_sampler, in.uv);
    
    // Apply tint color
    var color = texColor * u_color;
    
    // Discard fully transparent pixels
    if (color.a < 0.01) {
        discard;
    }
    
    // Apply gamma correction (sRGB encoding)
    color.r = pow(max(color.r, 0.0), 1.0 / 2.2);
    color.g = pow(max(color.g, 0.0), 1.0 / 2.2);
    color.b = pow(max(color.b, 0.0), 1.0 / 2.2);
    
    return color;
}

