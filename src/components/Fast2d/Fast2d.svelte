<svelte:options accessors />

<script>
    import { onMount, getContext, setContext } from "svelte";
    import { timer } from "../../stores";

    import * as THREE from "three";

    export let bg_color = null;
    export let id = "";

	const glob_renderer = getContext("glob_renderer");
	const glob_addScene = getContext("glob_addScene");
	const glob_removeScene = getContext("glob_removeScene");

    let dpr = window.devicePixelRatio || 1; // Get the device pixel ratio (for high res screens), falling back to 1.
    let debugStrs = [];
    let resizeOb;
    let wrapperW;
    let wrapperH;
    export function getWidth() {
        return wrapperW * dpr; // TODO(Otavio):I don't understand why I need this multiply here. :/ -Otavio
    }
    export function getHeight() {
        return wrapperH * dpr; // TODO(Otavio):I don't understand why I need this multiply here. :/ -Otavio
    }

    let vertexShader = `#version 300 es
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float time;
in vec3 position;
in vec2 uv;
in vec4 pos0sx_in;
in vec4 color;
in vec4 pos1diametersy_in;
out vec2 vUv;
out vec2 vScaleXY;
out vec4 colorV;
out float atomIndex;
out vec2 pos0;
out vec2 pos1;
out float diameter;

vec2 Rotate(vec2 v, float rad)
{
  float cos = cos(rad);
  float sin = sin(rad);
  return vec2(cos * v.x + sin * v.y, -sin * v.x + cos * v.y);
}

void main() {
    diameter = pos1diametersy_in.z;
    pos0 = (modelViewMatrix * vec4( pos0sx_in.xy, 0.0, 1.0 )).xy;
    pos1 = (modelViewMatrix * vec4( pos1diametersy_in.xy, 0.0, 1.0 )).xy;
    float at = atan(pos1.y - pos0.y, pos1.x - pos0.x);
    vec2 midA = (pos0.xy + pos1.xy) * 0.5;
    vec2 rp0 = Rotate(pos0sx_in.xy - midA, -at) + midA;
    vec2 rp1 = Rotate(pos1diametersy_in.xy - midA, -at) + midA;

    vec2 mid = (pos0.xy + pos1.xy) * 0.5;
    vec4 mvPosition = vec4( mid, 0.0, 1.0 );
    vec2 d0 = abs(pos0.xy - mid.xy);
    vec2 d1 = abs(pos1.xy - mid.xy);
    vec2 scaleXY = max(d0, d1)*2.0;
    scaleXY.y = 0.0;
    scaleXY.x = length(d0)*2.0;
    vScaleXY = scaleXY + diameter + 2.0; // extra 2 for antialiasing space
    mvPosition.xy += Rotate(position.xy * vScaleXY, -at);
    mvPosition.z = 0.0;
    vUv = uv;
    gl_Position = projectionMatrix * mvPosition;
    colorV = vec4(color.xyz, gl_Position.z);
    atomIndex = color.w;
    pos0 = (modelViewMatrix * vec4( rp0, 0.0, 1.0 )).xy;
    pos1 = (modelViewMatrix * vec4( rp1, 0.0, 1.0 )).xy;
}
`;

    let pixelShaderIndexRender = `#version 300 es
#define saturate(a) clamp(a, 0.0, 1.0)
precision highp float;
// uniform sampler2D map;
uniform mat4 viewMatrix;
uniform float doIndex;
uniform vec3 cameraPosition;
uniform float radiusMax;
in vec2 vUv;
in vec2 vScaleXY;
in vec4 colorV;
in float atomIndex;
in vec2 pos0;
in vec2 pos1;
in float diameter;

out vec4 fragColor;

// Basically a triangle wave
float repeat(float x) { return abs(fract(x*0.5+0.5)-0.5)*2.0; }

// This is it... what you have been waiting for... _The_ Glorious Line Algorithm.
// This function will make a signed distance field that says how far you are from the edge
// of the line at any point U,V.
// Pass it UVs, line end points, line thickness (x is along the line and y is perpendicular),
// How rounded the end points should be (0.0 is rectangular, setting rounded to thick.y will be circular),
// dashOn is just 1.0 or 0.0 to turn on the dashed lines.
float LineDistField(vec2 uv, vec2 pA, vec2 pB, vec2 thick, float rounded) {
    // Don't let it get more round than circular.
    rounded = min(thick.y, rounded);
    // midpoint
    vec2 mid = (pB + pA) * 0.5;
    // vector from point A to B
    vec2 delta = pB - pA;
    // Distance between endpoints
    float lenD = length(delta);
    // unit vector pointing in the line's direction
    vec2 unit = delta / lenD;
    // Check for when line endpoints are the same
    if (lenD < 0.0001) unit = vec2(1.0, 0.0);	// if pA and pB are same
    // Perpendicular vector to unit - also length 1.0
    vec2 perp = unit.yx * vec2(-1.0, 1.0);
    // position along line from midpoint
    float dpx = dot(unit, uv - mid);
    // distance away from line at a right angle
    float dpy = dot(perp, uv - mid);
    // Make a distance function that is 0 at the transition from black to white
    float disty = abs(dpy) - thick.y + rounded;
    float distx = abs(dpx) - lenD * 0.5 - thick.x + rounded;

    // Too tired to remember what this does. Something like rounded endpoints for distance function.
    float dist = length(vec2(max(0.0, distx), max(0.0,disty))) - rounded;
    dist = min(dist, max(distx, disty));

    // // This is for animated dashed lines. Delete if you don't like dashes.
    // float dashScale = 2.0*thick.y;
    // // Make a distance function for the dashes
    // float dash = (repeat(dpx/dashScale + iTime)-0.5)*dashScale;
    // // Combine this distance function with the line's.
    // dist = max(dist, dash-(1.0-dashOn*1.0)*10000.0);

    return dist;
}

// This makes a filled line in pixel units. A 1.0 thick line will be 1 pixel thick.
float FillLinePix(vec2 uv, vec2 pA, vec2 pB, vec2 thick, float rounded) {
    // float scale = abs(dFdy(uv).y);
    // float scale = abs(1.0);
    thick = (thick * 0.5 - 0.5);// * scale;
    float df = LineDistField(uv, pA, pB, vec2(thick), rounded);
    return saturate(df);// / scale);
}

void main() {
    vec2 uvPixel = (vUv - 0.5) * vScaleXY; // [-1..1] range, then scaled by scaleXY to [-scaleXY..scaleXY]
    vec2 mid = (pos0.xy + pos1.xy) * 0.5;
    vec2 d0 = (pos0.xy - mid.xy);
    vec2 d1 = (pos1.xy - mid.xy);
    vec2 p0 = d0;
    vec2 p1 = d1;
    vec2 l01 = p1 - p0;
    vec2 l01N = normalize(l01);
    vec2 perp = vec2(-l01.y, l01.x);
    vec2 perpN = normalize(perp);

    // float h = clamp( dot(uvPixel,l01)/dot(l01,l01), 0.0, 1.0 );
    // float dist = length( uvPixel - l01*h ) - diameter*0.5;
    float dist = LineDistField(uvPixel, p0, p1, vec2(3.0, 3.0), 0.0);
    float line = FillLinePix(uvPixel, p0, p1, vec2(diameter, diameter), diameter);

    vec3 finalColor = colorV.xyz;

    // // float dist = dot(uvPixel, perpN);
    // finalColor = vec3(0,1,0) * (sin(dist*3.14159*2.0 * 0.1)*0.5+0.5) + vec3(0,0,1);
    // if (dist < 0.0) finalColor = finalColor.yxz;

    float finalAlpha = 1.0 - line;
    // finalColor += finalAlpha;
    // float rad0 = distance(p0, uvPixel) - 5.0;
    // if ( rad0 < 0.0 ) finalColor = vec3(1.0,0.3,0);
    // float rad1 = distance(p1, uvPixel) - 5.0;
    // if ( rad1 < 0.0 ) finalColor = vec3(0.0,0.3,1.0);

    // fragColor = vec4(sqrt(finalColor),1.0);// diffuseColor.w );
    fragColor = vec4(sqrt(finalColor),sqrt(finalAlpha)+0.0);// diffuseColor.w );
    if (doIndex > 0.5) fragColor.xyz = vec3(1.0) * atomIndex + 0.5; // render indexes - round it up????
    // if ( rad > 0.9825 ) discard;
    // if (fract(uvPixel.x*0.5) > 0.5) discard;
}
`;
    let startTime = performance.now();
    let endTime = 0;
    let root2d;
    let camera;
    let currentChildren = new Map();
    let uniqueIndexes = { i: 1 };
    let linesDirty = [true];

    setContext("linesDirty", linesDirty);
    setContext("currentChildren", currentChildren);
    setContext("uniqueIndexes", uniqueIndexes);
    const scene = new THREE.Scene();
    setContext("scene", scene);

    var mainMesh;
    let material;
    let oneOffs = [];

    export function lineOneOff(x0, y0, x1, y1, diameter, color) {
        const myId = uniqueIndexes.i;
        uniqueIndexes.i = uniqueIndexes.i + 1;

        let dataArr = new Float32Array(4 * 3);
        dataArr[0] = x0;
        dataArr[1] = y0;
        dataArr[2] = 0.0;
        dataArr[3] = 2.0;

        dataArr[4] = color[0];
        dataArr[5] = color[1];
        dataArr[6] = color[2];
        dataArr[7] = uniqueIndexes.i & 0x7fffff; // 23 bits that will fit in float32 mantissa???

        dataArr[8] = x1;
        dataArr[9] = y1;
        dataArr[10] = diameter;
        dataArr[11] = 1.0;

        currentChildren.set(myId, dataArr);
        linesDirty[0] = true;
        oneOffs.push(myId);
    }

    var mainGeometry;
    let planeGeometry;
    // let planeGeometry = new THREE.CircleBufferGeometry(0.5, 16);
    // let planeGeometry = new THREE.SphereBufferGeometry(1, 16, 16);
    let pos0Array;
    let colorAndIndexArray;
    let pos1Array;
    function createGeometry() {
        let totalThings = 0;
        for (const [key, value] of currentChildren.entries()) totalThings += value.length;
        totalThings /= 4 * 3;
        // console.log("num things: ", totalThings);
        if (pos0Array.length != totalThings * 4) {
            pos0Array = new Float32Array(totalThings * 4);
            colorAndIndexArray = new Float32Array(totalThings * 4);
            pos1Array = new Float32Array(totalThings * 4);
        }
        let destIndex = 0;
        for (const [key, value] of currentChildren.entries()) {
            const dataArr = value;
            const elementCount = value.length / 3;
            for (let i = 0; i < elementCount; i++) {
                let di = destIndex * 4 + i;
                pos0Array[di] = dataArr[i];
                colorAndIndexArray[di] = dataArr[i + 4];
                pos1Array[di] = dataArr[i + 8];
            }
            destIndex += 1;
        }

        let a = new THREE.InstancedBufferAttribute(pos0Array, 4);
        let b = new THREE.InstancedBufferAttribute(colorAndIndexArray, 4);
        let c = new THREE.InstancedBufferAttribute(pos1Array, 4);
        // a.count = Math.max(2, totalThings);
        // b.count = Math.max(2, totalThings);
        // c.count = Math.max(2, totalThings);
        mainGeometry.setAttribute("pos0sx_in", a);
        mainGeometry.setAttribute("color", b);
        mainGeometry.setAttribute("pos1diametersy_in", c);

        for (let i = 0; i < oneOffs.length; i++) {
            currentChildren.delete(oneOffs[i]);
        }
        oneOffs = [];
    }

    export function reset() {
        // Github copilot wrote this. It works, so I'll keep it.
        currentChildren.clear();
        linesDirty[0] = true;
    }

    function tick() {
        if (!camera) return;
        if (!linesDirty[0]) {
            $timer.set(id, 0);
            return;
        }

        debugStrs = [];
        debugStrs.push("oneOffs.length " + oneOffs.length + " " + currentChildren.size);
        let t0 = performance.now();
        if (scene) {
            // Maybe only do this if lines are created or deleted? But if only movement or color changes, don't reallocate.
            // This has to be done because attributes of geometry can't grow in size once they are made.
            for (const key in mainGeometry.attributes) {
                mainGeometry.deleteAttribute(key);
            }
            mainGeometry?.dispose();
            planeGeometry?.dispose();
            planeGeometry = new THREE.PlaneGeometry(1, 1);
            mainGeometry = new THREE.InstancedBufferGeometry();
            mainGeometry.index = planeGeometry.index;
            mainGeometry.attributes = planeGeometry.attributes;

            createGeometry();
            if (mainMesh) scene?.remove(mainMesh);
            // if (!mainMesh) {
            mainMesh = new THREE.Mesh(mainGeometry, material);
            scene.add(mainMesh);
            // }
            // mainMesh.rotation.z += 0.0005 * Date.now();
        }
        linesDirty[0] = false;
        $timer.set(id, performance.now() - t0);
        // console.log("render time: ", $timer.get(id));

        if (endTime === 0) {
            endTime = performance.now();
            // console.log("Fast2d init time (ms): ", endTime - startTime);
        }

        // debugStrs.push("renderer.info.memory.geometries " + renderer.info.memory.geometries);
        // if (renderer.info.memory.textures) debugStrs.push("renderer.info.memory.textures " + renderer.info.memory.textures);
        // // debugStrs.push("renderer.info.render.calls " + renderer.info.render.calls);
        // debugStrs.push("renderer.info.render.triangles " + renderer.info.render.triangles);
        // if (renderer.info.render.points) debugStrs.push("renderer.info.render.points " + renderer.info.render.points);
        // if (renderer.info.render.lines) debugStrs.push("renderer.info.render.lines " + renderer.info.render.lines);
        // debugStrs.push("renderer.info.render.frame " + renderer.info.render.frame);
        // // debugStrs.push("renderer.info.programs " + renderer.info.programs);
        // // debugStrs.push("renderer.capabilities.isWebGL2 " + renderer.capabilities.isWebGL2);
        // debugStrs.push("mainGeometry.instanceCount " + mainGeometry.instanceCount);
        // // debugStrs.push("MAX_ELEMENTS_VERTICES " + renderer.getContext().getParameter(0x80E8));
        // // debugStrs.push("MAX_ELEMENTS_INDICES " + renderer.getContext().getParameter(0x80E9));
        // // debugStrs.push("MAX_ELEMENT_INDEX " + renderer.getContext().getParameter(0x8D6B));
    }

    function resizeCanvas(e) {
        // Force even number. This mask is for high dpi displays - my 1.5x display on windows. Mysterious. :/ Maybe cause (odd * 1.5) is fractional.
        let rect = root2d.getBoundingClientRect();
        wrapperW = Math.floor(rect.width * dpr); // TODO: make this ceil??? So it doesn't leave a 1 pixel empty space? Should be ok if parent has overflow: hidden
        wrapperH = Math.floor(rect.height * dpr);
        if (dpr !== Math.floor(dpr)) {
            wrapperW &= 0xfffffffe;
            wrapperH &= 0xfffffffe;
        }
        // console.log("resize", wrapperW, wrapperH, e);

        // camera = new THREE.OrthographicCamera( -dpr*wrapperW / 2, dpr*wrapperW / 2, dpr*wrapperH / 2, -dpr*wrapperH / 2, -100, 100 );
        // make 0,0 upper left
        camera = new THREE.OrthographicCamera(-0.5, dpr * wrapperW - 0.5, 0.5, -dpr * wrapperH + 0.5, 0, 1);
        // Flip camera so x+ is right and y+ is down. Weird to do it as a rotation, but couldn't figure out how to do left-handed / right-handed swap.
        camera.rotation.x = (180 * Math.PI) / 180;

        camera.updateProjectionMatrix();
        linesDirty[0] = true;
    }

    onMount(() => {
        scene.background = bg_color ? new THREE.Color(bg_color) : null;

        resizeOb = new ResizeObserver(resizeCanvas);
        resizeOb.observe(root2d);

        mainGeometry = new THREE.InstancedBufferGeometry();
        planeGeometry = new THREE.PlaneGeometry(1, 1);
        // let planeGeometry = new THREE.CircleBufferGeometry(0.5, 16);
        // let planeGeometry = new THREE.SphereBufferGeometry(1, 16, 16);
        mainGeometry.index = planeGeometry.index;
        mainGeometry.attributes = planeGeometry.attributes;
        pos0Array = new Float32Array(4);
        colorAndIndexArray = new Float32Array(4);
        pos1Array = new Float32Array(4);

        material = new THREE.RawShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                doIndex: { value: 0.0 },
            },
            vertexShader: vertexShader,
            fragmentShader: pixelShaderIndexRender,
            depthTest: true,
            depthWrite: true,
            transparent: true,
        });

        glob_addScene(root2d, (time, rect) => {
            if (!camera) return;
            tick();
            glob_renderer.render(scene, camera);
        });

        return () => {
            // Unmount - cleanup.
            glob_removeScene(root2d);
            if (resizeOb) resizeOb.unobserve(root2d);
            material?.dispose();
            material = null;
            planeGeometry?.dispose();
            planeGeometry = null;
            for (const key in mainGeometry.attributes) {
                mainGeometry.deleteAttribute(key);
            }
            mainGeometry?.dispose();
            mainGeometry = null;
        };
    });
</script>

<div bind:this={root2d} id="root2d" class="fit-full-space overflow-hidden" style="pointer-events:none;">
    <!-- <canvas id="glCanvas" width="640" height="480" /> -->
    {#if scene}
        <slot />
    {/if}
</div>
<!-- <div class="absolute text-xs p-2" style="left:{wrapperW*0.01}px;top:{wrapperH*0.2}px;background-color:#30303060">
    {#each debugStrs as str, i}
        <div>{str}</div>
    {/each}
</div> -->

<!-- <div class="absolute w-1 h-1 bg-green-full text-white" style="left:466px;top:466px;width:2px;height:2px;">
    {($timer.get(id)).toFixed(2)}
</div>
<div class="absolute w-1 h-1 bg-green-full" style="left:566px;top:366px;width:2px;height:2px;" /> -->
