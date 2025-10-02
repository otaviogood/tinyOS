// Standard PBR-like shader for Fraggl
// Features: base color, textures, lighting, shadows

struct Frame { 
    viewProj: mat4x4f, 
    cameraPos: vec3f, 
    exposure: f32, 
    lightViewProj: mat4x4f 
};

struct VSOut { 
    @builtin(position) position: vec4f, 
    @location(0) vNormal: vec3f, 
    @location(1) vWorldPos: vec3f, 
    @location(2) vShadowCoord: vec4f, 
    @location(3) vUV: vec2f, 
    @location(4) vColor: vec4f 
};

// Bind Group 0: Frame (shared across all materials)
@group(0) @binding(0) var<uniform> u_frame: Frame;

// Bind Group 1: Model transforms (per-object)
@group(1) @binding(0) var<uniform> u_model: mat4x4f;
@group(1) @binding(1) var<uniform> u_normal: mat3x3f;

// Bind Group 2: Material properties
struct Material { 
    baseColor: vec4f, 
    metallic: f32, 
    roughness: f32, 
    hasMap: f32, 
    opacity: f32, 
    uvOffset: vec2f, 
    uvScale: vec2f 
};
@group(2) @binding(0) var<uniform> u_mat: Material;

struct Light { 
    direction: vec3f, 
    intensity: f32, 
    color: vec3f, 
    radiusOrPad: f32 
};

struct LightBlock { 
    lights: array<Light, 3>, 
    count: u32, 
    flags: u32, 
    _pad0: vec2u 
};

@group(2) @binding(1) var<uniform> u_lights: LightBlock;
@group(2) @binding(2) var shadowSampler: sampler_comparison;
@group(2) @binding(3) var shadowMap: texture_depth_2d;
@group(2) @binding(4) var baseSampler: sampler;
@group(2) @binding(5) var baseMap: texture_2d<f32>;

// Vertex Shader
@vertex fn vs_main(
    @location(0) pos: vec3f, 
    @location(1) normal: vec3f, 
    @location(2) uv: vec2f, 
    @location(3) color: vec4f
) -> VSOut {
    var o: VSOut;
    let worldPos = (u_model * vec4f(pos, 1.0)).xyz;
    let n = normalize(u_normal * normal);
    o.position = u_frame.viewProj * vec4f(worldPos, 1.0);
    o.vNormal = n;
    o.vWorldPos = worldPos;
    let sc = u_frame.lightViewProj * vec4f(worldPos, 1.0);
    o.vShadowCoord = sc;
    o.vUV = uv * u_mat.uvScale + u_mat.uvOffset;
    o.vColor = color;
    return o;
}

// Disney-inspired diffuse shading with hemisphere lighting
fn disneyDiffuse(baseColor: vec3f, n: vec3f, v: vec3f, l: vec3f, roughness: f32) -> vec3f {
    let nl = max(dot(n, l), 0.0);
    let skyColor = vec3f(0.15, 0.8, 0.99) * (n.y * 0.5 + 0.5) * 0.3;
    let groundColor = vec3f(0.12, 0.09, 0.06) * ((-n.y) * 0.5 + 0.5);
    return baseColor * (nl + skyColor + groundColor);
}

// PCF shadow sampling with configurable kernel size
fn pcfShadow(shadowCoord: vec4f) -> f32 {
    // Transform to texture space
    let proj = shadowCoord / shadowCoord.w;
    // Map from NDC to texture space; flip Y for texture coords (origin at top-left)
    let uv = vec2f(proj.x, -proj.y) * 0.5 + vec2f(0.5, 0.5);
    let depth = proj.z;
    let texDim = textureDimensions(shadowMap);
    let texel = 1.0 / vec2<f32>(f32(texDim.x), f32(texDim.y));
    let radius = max(u_lights.lights[0].radiusOrPad, 1.0);
    var sum = 0.0;
    
    // Uniform sampling footprint (no divergent control flow)
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let o = vec2f(f32(x), f32(y)) * texel * radius;
            sum = sum + textureSampleCompare(shadowMap, shadowSampler, uv + o, depth + 0.0);
        }
    }
    let avg = sum / 9.0;
    
    // Branchless in-bounds mask
    let inside = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0);
    return select(1.0, avg, inside);
}

// Fragment Shader
@fragment fn fs_main(i: VSOut) -> @location(0) vec4f {
    let n = normalize(i.vNormal);
    let v = normalize(u_frame.cameraPos - i.vWorldPos);
    var baseColor = i.vColor.rgb * u_mat.baseColor.rgb;
    var alpha = u_mat.baseColor.a * u_mat.opacity * i.vColor.a;
    
    if (u_mat.hasMap > 0.5) {
        let sampled = textureSample(baseMap, baseSampler, i.vUV);
        baseColor = baseColor * sampled.rgb;
        alpha = alpha * sampled.a;
    }
    
    // Simple ambient to avoid fully black surfaces
    let ambient = 0.001 * baseColor;
    var color = ambient;
    
    // Compute shadow factor once for light index 0 only
    var shadow0 = 1.0;
    if ((u_lights.flags & 1u) == 1u) {
        shadow0 = pcfShadow(i.vShadowCoord);
    }
    
    // Accumulate up to 3 directional lights; apply shadow only for the first
    for (var idx: u32 = 0u; idx < 3u; idx = idx + 1u) {
        if (idx >= u_lights.count) { break; }
        let L = u_lights.lights[idx];
        let l = normalize(-L.direction);
        let base = disneyDiffuse(baseColor, n, v, l, u_mat.roughness);
        var sh = 1.0;
        if (idx == 0u) { sh = shadow0; }
        let s = sh * 0.95 + 0.05;
        color = color + base * (L.intensity * L.color) * s;
    }
    
    color = color * u_frame.exposure;
    
    // Gamma encode to sRGB
    color = pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2));
    
    return vec4f(color, alpha);
}

