// Wireframe shader using barycentric coordinates
// Shows edges of triangles for debugging geometry

struct Frame { 
    viewProj: mat4x4f, 
    cameraPos: vec3f, 
    exposure: f32, 
    lightViewProj: mat4x4f 
};

struct VSOut { 
    @builtin(position) position: vec4f,
    @location(0) vBarycentric: vec3f,
    @location(1) vColor: vec4f
};

@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;

struct WireMaterial {
    color: vec4f,
    thickness: f32,
    _pad: vec3f
};
@group(2) @binding(0) var<uniform> u_mat: WireMaterial;

@vertex fn vs_main(
    @location(0) pos: vec3f,
    @builtin(vertex_index) vertexIndex: u32
) -> VSOut {
    var o: VSOut;
    o.position = u_frame.viewProj * (u_model * vec4f(pos, 1.0));
    
    // Generate barycentric coordinates based on vertex index within triangle
    let baryIndex = vertexIndex % 3u;
    if (baryIndex == 0u) {
        o.vBarycentric = vec3f(1.0, 0.0, 0.0);
    } else if (baryIndex == 1u) {
        o.vBarycentric = vec3f(0.0, 1.0, 0.0);
    } else {
        o.vBarycentric = vec3f(0.0, 0.0, 1.0);
    }
    
    o.vColor = u_mat.color;
    return o;
}

@fragment fn fs_main(i: VSOut) -> @location(0) vec4f {
    // Calculate edge distance using barycentric coordinates
    let bary = i.vBarycentric;
    
    // Use screen-space derivatives to get pixel-based distance
    // fwidth gives us the rate of change per pixel in screen space
    let deltas = fwidth(bary);
    
    // Convert thickness from pixels to barycentric space
    // u_mat.thickness is now in pixels (e.g., 2.0 = 2 pixels wide)
    let smoothing = deltas * u_mat.thickness;
    
    // Smoothstep to create anti-aliased edges
    let edges = smoothstep(vec3f(0.0), smoothing, bary);
    let edgeFactor = min(min(edges.x, edges.y), edges.z);
    
    // Mix between wire color and transparent based on edge distance
    let alpha = (1.0 - edgeFactor) * i.vColor.a;
    
    if (alpha < 0.01) {
        discard;
    }
    
    var color = i.vColor.rgb * u_frame.exposure;
    color = pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2));
    return vec4f(color, alpha);
}

