// Classic piece raytrace shader (AABB proxy + analytic studs)
// - Uses oriented bounding box per-instance
// - Decodes classicInfo (N, M, height code, flat tile)
// - Analytic intersections for box and studs (capped cylinders)
// - Smooth normal blending near edges
// - Hard self-shadow by re-tracing inside local scene

struct Frame { 
    viewProj: mat4x4f, 
    cameraPos: vec3f, 
    exposure: f32, 
    lightViewProj: mat4x4f,
    lightDirWS: vec3f, // world-space directional light direction (from light → scene)
    _padLight: f32
};

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) vWorldPos: vec3f,
    @location(1) @interpolate(flat) vClassicInfo: u32,
    @location(2) @interpolate(flat) vCenterWorld: vec3f,
    @location(3) @interpolate(flat) vAxisXWorld: vec3f,
    @location(4) @interpolate(flat) vAxisYWorld: vec3f,
    @location(5) @interpolate(flat) vRGBA8: u32,
};

@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(1) @binding(0) var<uniform> u_model: mat4x4f;
@group(1) @binding(1) var<uniform> u_normal: mat3x3f;

// Bind Group 2: Lighting + Shadow resources (match ClassicMaterial BGL)
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

@vertex fn vs_main(
    @location(0) pos: vec3f,
    @location(1) classicInfoAttr: u32,
    @location(5) rgba8Attr: u32,
    @location(2) centerAttr: vec3f,
    @location(3) axisXAttr: vec3f,
    @location(4) axisYAttr: vec3f
) -> VSOut {
    var o: VSOut;
    let worldPos = (u_model * vec4f(pos, 1.0)).xyz;
    o.position = u_frame.viewProj * vec4f(worldPos, 1.0);
    o.vWorldPos = worldPos;
    o.vClassicInfo = classicInfoAttr; // pass-through (uint32)
    o.vRGBA8 = rgba8Attr;
    // Center provided in chunk space; lift to world via u_model
    o.vCenterWorld = (u_model * vec4f(centerAttr, 1.0)).xyz;
    // Axes provided in chunk space as directions; lift to world via normal matrix (rotation-only)
    o.vAxisXWorld = normalize(u_normal * axisXAttr);
    o.vAxisYWorld = normalize(u_normal * axisYAttr);
    return o;
}

fn unpackClassicInfo(ci: u32) -> vec4u {
    // bits 0-5: N, bits 6-11: M, bits 12-13: height code, bit 14: flat
    let M = (ci & 0x3Fu);                // 6 bits
    let N = ((ci >> 6u) & 0x3Fu);        // 6 bits
    let H = ((ci >> 12u) & 0x3u);        // 2 bits (1=plate/tile, 3=brick)
    let F = ((ci >> 14u) & 0x1u);        // 1 bit flatness
    return vec4u(N, M, H, F);
}

// ---- Ray/Hit types and helpers (local brick space) ----
struct RayHit {
    tMin: f32,
    tMax: f32,
    hitMin: vec3f,
    hitMax: vec3f,
    normMin: vec3f,
    normMax: vec3f,
};

fn newRayHit() -> RayHit {
    return RayHit(1e30, 1e30, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
}

fn elementwiseEqual3(a: vec3f, b: f32) -> vec3f {
    // matches GLSL abs(sign(a - b)) behavior for face normal detection
    return abs(sign(a - vec3f(b)));
}

fn unionClosest(a: RayHit, b: RayHit) -> RayHit {
    if (a.tMin <= b.tMin) { return a; }
    return b;
}

fn boxIntersect(pos: vec3f, dirN: vec3f, boxPos: vec3f, halfSize: vec3f) -> RayHit {
    let bmin = boxPos - halfSize;
    let bmax = boxPos + halfSize;
    let invD = 1.0 / dirN;
    let t1 = (bmin - pos) * invD;
    let t2 = (bmax - pos) * invD;
    let vmin = min(t1, t2);
    let vmax = max(t1, t2);
    let tmin = max(vmin.z, max(vmin.x, vmin.y));
    let tmax = min(vmax.z, min(vmax.x, vmax.y));
    var rh = newRayHit();
    if (tmax <= tmin || tmin <= 0.0) { return rh; }
    rh.tMin = tmin;
    rh.tMax = tmax;
    rh.hitMin = pos + dirN * rh.tMin;
    rh.hitMax = pos + dirN * rh.tMax;
    rh.normMin = elementwiseEqual3(t1, tmin) - elementwiseEqual3(t2, tmin);
    rh.normMax = elementwiseEqual3(t1, tmax) - elementwiseEqual3(t2, tmax);
    return rh;
}

fn aabbClip(pos: vec3f, dirN: vec3f, boxPos: vec3f, halfSize: vec3f) -> vec2f {
    let bmin = boxPos - halfSize;
    let bmax = boxPos + halfSize;
    let invD = 1.0 / dirN;
    let t1 = (bmin - pos) * invD;
    let t2 = (bmax - pos) * invD;
    let vmin = min(t1, t2);
    let vmax = max(t1, t2);
    let tEnter = max(vmin.z, max(vmin.x, vmin.y));
    let tExit  = min(vmax.z, min(vmax.x, vmax.y));
    return vec2f(tEnter, tExit);
}

fn cappedCylinderYIntersect(pos: vec3f, dirN: vec3f, centerXZ: vec2f, yBase: f32, yTop: f32, r: f32) -> RayHit {
    var rh = newRayHit();
    let p = pos.xz - centerXZ;
    let d = dirN.xz;
    let A = dot(d, d);
    let B = 2.0 * dot(p, d);
    let C = dot(p, p) - r * r;
    var tSide = 1e30;
    if (A != 0.0) {
        let disc = B * B - 4.0 * A * C;
        if (disc >= 0.0) {
            let s = sqrt(disc);
            let inv2A = 0.5 / A;
            var t0 = (-B - s) * inv2A;
            var t1v = (-B + s) * inv2A;
            if (t0 > t1v) { let tmp = t0; t0 = t1v; t1v = tmp; }
            if (t0 > 0.0) {
                let y0 = pos.y + dirN.y * t0;
                if (y0 >= yBase && y0 <= yTop) { tSide = t0; }
            }
            if (tSide == 1e30 && t1v > 0.0) {
                let y1 = pos.y + dirN.y * t1v;
                if (y1 >= yBase && y1 <= yTop) { tSide = t1v; }
            }
        }
    }
    var tCap = 1e30;
    if (dirN.y != 0.0) {
        let t = (yTop - pos.y) / dirN.y;
        if (t > 0.0) {
            let hit = pos + dirN * t;
            let q = hit.xz - centerXZ;
            if (dot(q, q) <= r * r) { tCap = t; }
        }
    }
    let tHit = min(tSide, tCap);
    if (tHit == 1e30) { return rh; }
    rh.tMin = tHit;
    rh.hitMin = pos + dirN * rh.tMin;
    if (tCap < tSide) {
        rh.normMin = vec3f(0.0, 1.0, 0.0);
    } else {
        let nXZ = normalize(rh.hitMin.xz - centerXZ);
        rh.normMin = vec3f(nXZ.x, 0.0, nXZ.y);
    }
    return rh;
}

// ---- Smooth normal blending helpers ----
fn saturate(a: f32) -> f32 { return clamp(a, 0.0, 1.0); }

fn smoothBoxNormal(p: vec3f, n: vec3f, boxPos: vec3f, halfSize: vec3f, roundWidth: f32) -> vec3f {
    let lp = p - boxPos;
    let d = halfSize - abs(lp);
    let w = select(
        vec3f(0.0),
        clamp((roundWidth - d) / max(roundWidth, 1e-6), vec3f(0.0), vec3f(1.0)),
        roundWidth > 1e-6
    );
    let s = sign(lp);
    var bendDir = vec3f(0.0);
    var k = 0.0;
    if (abs(n.x) > 0.5) {
        let t = vec3f(0.0, s.y * w.y, s.z * w.z);
        let m = length(t);
        bendDir = select(vec3f(0.0), t / max(m, 1e-6), m > 0.0);
        k = max(w.y, w.z);
    } else if (abs(n.y) > 0.5) {
        let t = vec3f(s.x * w.x, 0.0, s.z * w.z);
        let m = length(t);
        bendDir = select(vec3f(0.0), t / max(m, 1e-6), m > 0.0);
        k = max(w.x, w.z);
    } else if (abs(n.z) > 0.5) {
        let t = vec3f(s.x * w.x, s.y * w.y, 0.0);
        let m = length(t);
        bendDir = select(vec3f(0.0), t / max(m, 1e-6), m > 0.0);
        k = max(w.x, w.y);
    }
    let blendTarget = normalize(n + bendDir);
    return normalize(mix(n, blendTarget, saturate(k)));
}

fn smoothCylSide(p: vec3f, n: vec3f, yTop: f32, roundWidth: f32) -> vec3f {
    let dy = max(0.0, yTop - p.y);
    let wTop = saturate((roundWidth - dy) / max(roundWidth, 1e-6));
    let blendTarget = normalize(n + vec3f(0.0, 1.0, 0.0));
    return normalize(mix(n, blendTarget, wTop));
}

fn smoothCylCap(p: vec3f, n: vec3f, centerXZ: vec2f, radius: f32, roundWidth: f32) -> vec3f {
    let d = p.xz - centerXZ;
    let dr = radius - length(d);
    let w = saturate((roundWidth - dr) / max(roundWidth, 1e-6));
    let radial = vec3f(normalize(d).x, 0.0, normalize(d).y);
    let blendTarget = normalize(n + radial);
    return normalize(mix(n, blendTarget, w));
}

fn smoothCylSideBase(p: vec3f, n: vec3f, yBase: f32, roundWidth: f32) -> vec3f {
    let dy = p.y - yBase;
    let w = saturate((roundWidth - max(dy, 0.0)) / max(roundWidth, 1e-6));
    let blendTarget = normalize(n + vec3f(0.0, 1.0, 0.0));
    return normalize(mix(n, blendTarget, w));
}

fn smoothBoxTopAroundCyl(p: vec3f, n: vec3f, centerXZ: vec2f, radius: f32, roundWidth: f32) -> vec3f {
    let d = p.xz - centerXZ;
    let r = length(d);
    let dr = r - radius;
    let w = saturate((roundWidth - dr) / max(roundWidth, 1e-6));
    if (w <= 0.0) { return n; }
    let dir = select(d / max(r, 1e-6), vec2f(1.0, 0.0), r <= 0.0);
    let radial = vec3f(dir.x, 0.0, dir.y);
    let blendTarget = normalize(n + radial);
    return normalize(mix(n, blendTarget, w));
}

// ---- Lighting helpers inspired by StandardMaterial ----
fn disneyDiffuse(baseColor: vec3f, n: vec3f, v: vec3f, l: vec3f, roughness: f32) -> vec3f {
    let nl = max(dot(n, l), 0.0);
    let skyColor = vec3f(0.15, 0.8, 0.99) * (n.y * 0.5 + 0.5) * 0.3;
    let groundColor = vec3f(0.12, 0.09, 0.06) * ((-n.y) * 0.5 + 0.5);
    return baseColor * (nl + skyColor + groundColor);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
    return F0 + (vec3f(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

fn specularBRDF(n: vec3f, v: vec3f, l: vec3f, roughness: f32, F0: vec3f) -> vec3f {
    let h = normalize(v + l);
    let nh = max(dot(n, h), 0.0);
    let vh = max(dot(v, h), 0.0);
    let gloss = clamp(1.0 - roughness, 0.0, 1.0);
    let shininess = mix(8.0, 256.0, gloss * gloss);
    let specPow = pow(nh, shininess);
    let F = fresnelSchlick(vh, F0);
    return F * specPow;
}

// Shared multi-directional lighting accumulator (no shadows inside)
fn computeStandardLighting(n: vec3f, v: vec3f, baseColor: vec3f, metallic: f32, roughness: f32, shadow0: f32) -> vec3f {
    let ambient = 0.001 * baseColor;
    var color = ambient;
    for (var idx: u32 = 0u; idx < 3u; idx = idx + 1u) {
        if (idx >= u_lights.count) { break; }
        let L = u_lights.lights[idx];
        let l = normalize(-L.direction);
        let base = disneyDiffuse(baseColor, n, v, l, roughness);
        var sh = 1.0;
        if (idx == 0u) { sh = shadow0; }
        let s = sh * 0.95 + 0.05;
        let nl = max(dot(n, l), 0.0);
        let dielectricF0 = vec3f(0.04, 0.04, 0.04);
        let F0 = mix(dielectricF0, baseColor, metallic);
        let spec = specularBRDF(n, v, l, roughness, F0) * nl;
        color = color + (base + spec * 10.0) * (L.intensity * L.color) * s;
    }
    return color;
}

struct FSOut {
    @location(0) color: vec4f,
    @builtin(frag_depth) depth: f32,
};
// PCF shadow sampling (same as StandardMaterial)
fn pcfShadow(shadowCoord: vec4f) -> f32 {
    let proj = shadowCoord / shadowCoord.w;
    let uv = vec2f(proj.x, -proj.y) * 0.5 + vec2f(0.5, 0.5);
    let depth = proj.z;
    let texDim = textureDimensions(shadowMap);
    let texel = 1.0 / vec2<f32>(f32(texDim.x), f32(texDim.y));
    let radius = 1.0; // use light radius if passed later via material
    var sum = 0.0;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let o = vec2f(f32(x), f32(y)) * texel * radius;
            sum = sum + textureSampleCompare(shadowMap, shadowSampler, uv + o, depth + 0.0);
        }
    }
    let avg = sum / 9.0;
    let inside = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0);
    return select(1.0, avg, inside);
}


@fragment fn fs_main(i: VSOut) -> FSOut {
    // Decode classicInfo → N, M, H, F
    let info = unpackClassicInfo(i.vClassicInfo);
    let studsX = max(1u, info.x);
    let studsZ = max(1u, info.y);
    let Hcode = info.z; // 1=plate/tile, 3=brick
    let isFlat = (info.w == 1u);

    // Brick dimensions in local space (LDU)
    let studPitch = 20.0;
    let studRadius = 6.0;
    let studHeight = 4.0;
    let gBoxHeight = select(24.0, 8.0, Hcode == 1u);
    let halfX = f32(studsX) * studPitch * 0.5;
    let halfZ = f32(studsZ) * studPitch * 0.5;
    let kBoxHalf = vec3f(halfX, gBoxHeight * 0.5, halfZ);
    let kBoxPos = vec3f(0.0, gBoxHeight * 0.5, 0.0);
    let kEdgeRound = 0.5;

    // Build orthonormal basis for oriented box in world space
    let U = normalize(i.vAxisXWorld);
    var V = normalize(i.vAxisYWorld);
    let W = normalize(cross(U, V));
    V = normalize(cross(W, U));

    // Primary ray from camera through this pixel (world space)
    let roW = u_frame.cameraPos;
    let rdW = normalize(i.vWorldPos - u_frame.cameraPos);
	// Transform ray to local OBB space with origin at world bottom of the FULL part AABB (box + studs for non-flat)
	let extraStud = select(4.0, 0.0, isFlat);
	let fullHeight = gBoxHeight + extraStud;
	let bottomWorld = i.vCenterWorld - V * (fullHeight * 0.5);
    let pW = roW - bottomWorld;
    let ro = vec3f(dot(pW, U), dot(pW, V), dot(pW, W));
    let rd = vec3f(dot(rdW, U), dot(rdW, V), dot(rdW, W));

    // Scene intersection in local space: box + optional studs
    // Start with the box (without stud cap). Place the box so that it occupies [0, gBoxHeight] in Y.
    var best = boxIntersect(ro, rd, vec3f(0.0, gBoxHeight * 0.5, 0.0), vec3f(kBoxHalf.x, gBoxHeight * 0.5, kBoxHalf.z));
    if (!isFlat) {
        // Compute stud slab [yBase, yTop]
        let yBase = gBoxHeight;
        let yTop = yBase + studHeight;

        // Early clip against stud volume AABB in XZ and Y
        let gridMin = vec2f(0.0, 0.0) - vec2f(f32(studsX), f32(studsZ)) * 0.5 * studPitch;
        let gridMax = gridMin + vec2f(f32(studsX), f32(studsZ)) * studPitch;

        // Ray-rectangle slab intersection in XZ
        let r0 = ro.xz;
        let rv = rd.xz;
        let tx1 = (gridMin.x - r0.x) / select(1e-9, rv.x, rv.x != 0.0);
        let tx2 = (gridMax.x - r0.x) / select(1e-9, rv.x, rv.x != 0.0);
        let tz1 = (gridMin.y - r0.y) / select(1e-9, rv.y, rv.y != 0.0);
        let tz2 = (gridMax.y - r0.y) / select(1e-9, rv.y, rv.y != 0.0);
        let tminxz = max(min(tx1, tx2), min(tz1, tz2));
        let tmaxxz = min(max(tx1, tx2), max(tz1, tz2));

        // Y slab for stud height
        let ty1 = (yBase - ro.y) / select(1e-9, rd.y, rd.y != 0.0);
        let ty2 = (yTop  - ro.y) / select(1e-9, rd.y, rd.y != 0.0);
        let tminy = min(ty1, ty2);
        let tmaxy = max(ty1, ty2);

        // Compute scene entry from either box AABB or stud volume, whichever later than 0
        let tStartScene = max(0.0, aabbClip(ro, rd, vec3f(0.0, (yTop) * 0.5, 0.0), vec3f(kBoxHalf.x, max(gBoxHeight * 0.5, yTop * 0.5), kBoxHalf.z)).x);
        let tStart = max(tStartScene, max(tminxz, tminy));
        let tEnd   = min(tmaxxz, tmaxy);

        if (tStart < tEnd) {
            var p = ro + rd * max(tStart, 0.0);
            // Starting cell indices
            let rel = (p.xz - gridMin) / studPitch;
            var ix: i32 = clamp(i32(floor(rel.x)), 0, i32(studsX) - 1);
            var iz: i32 = clamp(i32(floor(rel.y)), 0, i32(studsZ) - 1);
            let stepx: i32 = select(-1, 1, rv.x > 0.0);
            let stepz: i32 = select(-1, 1, rv.y > 0.0);

            // Distances to next grid boundary in t
            let nextBx = select(gridMin.x + (f32(ix)) * studPitch, gridMin.x + f32(ix + 1) * studPitch, rv.x > 0.0);
            let nextBz = select(gridMin.y + (f32(iz)) * studPitch, gridMin.y + f32(iz + 1) * studPitch, rv.y > 0.0);
            var txMax = select(1e30, (nextBx - p.x) / rv.x, rv.x != 0.0);
            var tzMax = select(1e30, (nextBz - p.z) / rv.y, rv.y != 0.0);
            let txDelta = select(1e30, studPitch / abs(rv.x), rv.x != 0.0);
            let tzDelta = select(1e30, studPitch / abs(rv.y), rv.y != 0.0);

            var tCurr = tStart;
            // March across cells with a small fixed cap
            for (var iter: i32 = 0; iter < 5; iter = iter + 1) {
                if (tCurr > tEnd) { break; }
                if (ix < 0 || ix >= i32(studsX) || iz < 0 || iz >= i32(studsZ)) { break; }
                if (best.tMin < 1e30 && tCurr >= best.tMin) { break; }

                let center = gridMin + (vec2f(f32(ix), f32(iz)) + vec2f(0.5)) * studPitch;
                let studHit = cappedCylinderYIntersect(ro, rd, center, yBase, yTop, studRadius);
                best = unionClosest(best, studHit);

                let tCellExit = min(txMax, tzMax);
                if (best.tMin < 1e30 && best.tMin <= tCellExit) { break; }

                if (txMax < tzMax) {
                    tCurr = txMax;
                    txMax = txMax + txDelta;
                    ix = ix + stepx;
                } else {
                    tCurr = tzMax;
                    tzMax = tzMax + tzDelta;
                    iz = iz + stepz;
                }
            }
        }
    }

    // If no hit at all, discard proxy quad
    if (best.tMin >= 1e30) { discard; }

    // Local hit point and normal
    let hitPosL = best.hitMin;
    var nL = normalize(best.normMin);

    // Smooth round edges and stud transitions
    let yBase = gBoxHeight;
    let yTop = yBase + studHeight;
    let start = vec2f(0.0, 0.0) - (vec2f(f32(studsX), f32(studsZ)) * 0.5 - vec2f(0.5)) * studPitch;
    let rel = (hitPosL.xz - start) / studPitch;
    let idxX = clamp(i32(floor(rel.x + 0.5)), 0, i32(studsX) - 1);
    let idxZ = clamp(i32(floor(rel.y + 0.5)), 0, i32(studsZ) - 1);
    let center = start + vec2f(f32(idxX) * studPitch, f32(idxZ) * studPitch);
    let rStud = length(hitPosL.xz - center);
    let inStudSlab = (hitPosL.y >= yBase - 1e-3) && (hitPosL.y <= yTop + 1e-3);
    let isStud = (!isFlat) && inStudSlab && (rStud <= studRadius + kEdgeRound + 1e-3);

    var nShadeL = nL;
    if (!isStud) {
        nShadeL = smoothBoxNormal(hitPosL, nShadeL, kBoxPos, kBoxHalf, kEdgeRound);
        if (!isFlat && abs(hitPosL.y - yBase) <= 1e-2) {
            nShadeL = smoothBoxTopAroundCyl(hitPosL, nShadeL, center, studRadius, kEdgeRound);
        }
    } else {
        if (abs(nL.y) > 0.5) {
            nShadeL = smoothCylCap(hitPosL, nL, center, studRadius, kEdgeRound);
        } else {
            nShadeL = smoothCylSide(hitPosL, nL, yTop, kEdgeRound);
            nShadeL = smoothCylSideBase(hitPosL, nShadeL, yBase, kEdgeRound);
        }
    }

    // Transform shading normal back to world space
    let normalW = normalize(vec3f(
        U.x * nShadeL.x + V.x * nShadeL.y + W.x * nShadeL.z,
        U.y * nShadeL.x + V.y * nShadeL.y + W.y * nShadeL.z,
        U.z * nShadeL.x + V.z * nShadeL.y + W.z * nShadeL.z
    ));

    // World-space hit position for lighting and shadow mapping
    let worldHit = bottomWorld + U * hitPosL.x + V * hitPosL.y + W * hitPosL.z;

    // Directional light and shadow map sampling like StandardMaterial
    let lightDirW = normalize(-u_frame.lightDirWS);
    let ndl = clamp(dot(normalW, lightDirW), 0.0, 1.0);
    // Shadow from shadow map (apply world-space bias toward the light to reduce self-shadow)
    let SHADOW_WORLD_BIAS: f32 = 4.5;
    let biasedWorld = worldHit + lightDirW * SHADOW_WORLD_BIAS;
    let shadowCoord = u_frame.lightViewProj * vec4f(biasedWorld, 1.0);
    let shadowMapFactor = pcfShadow(shadowCoord);
    // Analytic traced self-shadow in local space (box + nearest stud)
    var shadowTrace = 1.0;
    if (ndl > 0.0) {
        let lightDirL = normalize(vec3f(dot(lightDirW, U), dot(lightDirW, V), dot(lightDirW, W)));
        let shOriginL = hitPosL + lightDirL * 0.05; // bias in LDU
        var shBest = newRayHit();
        shBest = unionClosest(shBest, boxIntersect(shOriginL, lightDirL, kBoxPos, kBoxHalf));
        if (!isFlat) {
            let yB = yBase;
            let yT = yTop;
            let c = center;
            let shStud = cappedCylinderYIntersect(shOriginL, lightDirL, c, yB, yT, studRadius);
            shBest = unionClosest(shBest, shStud);
        }
        if (shBest.tMin > 1e-3 && shBest.tMin < 1e30) { shadowTrace = 0.0; }
    }
    var shadow = shadowMapFactor * shadowTrace;

    // Base color and bottom pattern
    // Decode packed RGBA8 (R in LSB, A in MSB), convert to linear space is assumed done at bake; here treat as linear
    let r8 = f32(i.vRGBA8 & 0xFFu) / 255.0;
    let g8 = f32((i.vRGBA8 >> 8u) & 0xFFu) / 255.0;
    let b8 = f32((i.vRGBA8 >> 16u) & 0xFFu) / 255.0;
    var base = vec3f(r8, g8, b8);
    var bri = 1.0;
    if (abs(nL.y + 1.0) < 1e-3) {
        // Bottom tubes per 2x2 stud quad
        let dx = kBoxHalf.x - abs(hitPosL.x - kBoxPos.x);
        let dz = kBoxHalf.z - abs(hitPosL.z - kBoxPos.z);
        let distToEdge = min(dx, dz);
        let nearEdge = (distToEdge <= 3.0 + 1e-3);
        if (studsX >= 2u && studsZ >= 2u) {
            let qMin = kBoxPos.xz - (vec2f(f32(studsX), f32(studsZ)) * 0.5 - vec2f(1.0)) * studPitch;
            let qRel = (hitPosL.xz - qMin) / studPitch;
            var qIdxX: i32 = clamp(i32(floor(qRel.x + 0.5)), 0, i32(studsX) - 2);
            var qIdxZ: i32 = clamp(i32(floor(qRel.y + 0.5)), 0, i32(studsZ) - 2);
            let qCenter = qMin + vec2f(f32(qIdxX), f32(qIdxZ)) * studPitch;
            let d = length(hitPosL.xz - qCenter);
            let rInner = 6.0;
            let rOuter = 8.125;
            bri = select(0.0, 1.0, d >= rInner) * select(0.0, 1.0, d <= rOuter);
        }
        bri = bri + clamp(1.0 - (distToEdge - 3.0) * 3.0, 0.0, 1.0);
        bri = bri * 0.8 + 0.2;
        if (gBoxHeight == 8.0) { bri = bri * 0.7 + 0.3; }
    }

    // Final shading using shared Standard-style multi-light function
    let nW = normalW;
    let vW = normalize(u_frame.cameraPos - worldHit);
    let roughness = 0.35;
    let shadow0 = shadow; // use combined analytic + shadowmap for first light only
    var col = computeStandardLighting(nW, vW, base, 0.0, roughness, shadow0) * bri;
    col = pow(max(col * u_frame.exposure, vec3f(0.0)), vec3f(1.0 / 2.2));

    // Compute depth from world-space hit
    let clip = u_frame.viewProj * vec4f(worldHit, 1.0);
    let depth = clamp(clip.z / clip.w, 0.0, 1.0);
    return FSOut(vec4f(col, 1.0), depth);
}


