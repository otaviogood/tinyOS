<script>
    import { onMount } from "svelte";
    import { handleResize, bigScale, bigWidth, bigHeight } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import Line from "../../components/Line.svelte";
    import SVGArcDeg from "../../components/SVGArcDeg.svelte";
    import Slider from "../../components/Slider.svelte";
    import Keyboard from "../../components/Keyboard.svelte";
    import * as THREE from "three";
    import { OrbitControls } from "three/addons/controls/OrbitControls.js";
    import { regenPlane, saveToSTL, freeMemory } from "./meshGen";
    import CloseButton from "../../components/CloseButton.svelte";

    handleResize();

    let elem;
    let scene, camera, renderer, controls, clock;
    let roomGroup;

    let planeGroup;
    let dirty = false;
    let designMode = 0; // 0: ?, 1: main wing, 2: rear wing, 3: tail fin, 4: fuselage, 5: fuselage-wing, 6: engine
    let playMode = 0; // 0: design, 1: fly
    let areYouAParentModal = 0;
    let typed = "";

    let planeFlying = false;
    let planePos = new THREE.Vector3(0, 0, 0);
    let planeRot = new THREE.Quaternion(0, 0, 0, 1);
    let planeVel = new THREE.Vector3(0, 0, 0);
    let planeRotVel = new THREE.Vector3(0, 0, 0);
    let massInGrams = 40;

    let simWorld;

    let planeDef = {
        mainWingSpan: {v:25.0, min:0.0, max:32.0, label:"span", units:"cm"},
        mainWingMiddleLen: {v:8.0, min:2.0, max:22.0, label:"length"},
        mainWingTipRatio: {v:0.5, min:0.0, max:1.0, label:"squeeze"},
        mainWingThickness: {v:0.2, min:0.1, max:0.7, label:"thickness"},
        mainWingSweep: {v:6.0, min:-10.0, max:15.0, label:"sweep"},
        mainWingVSweep: {v:3.0, min:-5.0, max:8.0, label:"dihedral"},
        mainWingAngle: {v:1.5, min:-2.0, max:5.0, label:"angle"},
        mainWingForward: {v:0.0, min:-0.5, max:0.5, label:"forward"},
        mainWingUp: {v:0.4, min:-1.0, max:1.0, label:"up"},

        backWingSpan: {v:12.0, min:0.0, max:32.0, label:"span"},
        backWingMiddleLen: {v:4.0, min:2.0, max:20.0, label:"length"},
        backWingTipRatio: {v:0.3, min:0.0, max:1.0, label:"squeeze"},
        backWingThickness: {v:0.2, min:0.1, max:0.7, label:"thickness"},
        backWingSweep: {v:2.6, min:-6.0, max:10.0, label:"sweep"},
        backWingVSweep: {v:1.0, min:-5.0, max:8.0, label:"dihedral"},
        backWingAngle: {v:0.0, min:-12.0, max:12.0, label:"angle"},
        backWingForward: {v:0.0, min:-0.1, max:0.1, label:"forward"},
        backWingUp: {v:0.4, min:-1.0, max:1.0, label:"up"},

        tailFinSpan: {v:12.0, min:0.0, max:16.0, label:"span"},
        tailFinMiddleLen: {v:4.0, min:2.0, max:20.0, label:"length"},
        tailFinTipRatio: {v:0.3, min:0.1, max:1.0, label:"squeeze"},
        tailFinThickness: {v:0.2, min:0.1, max:0.7, label:"thickness"},
        tailFinSweep: {v:3.0, min:-2.0, max:16.0, label:"sweep"},
        tailFinForward: {v:0.0, min:-0.1, max:0.1, label:"forward"},

        fuselageLength: {v:22.0, min:10.0, max:25.0, label:"length", units:"cm"},
        fuselageRad: {v:0.35, min:0.2, max:4.0, label:"thickness"},
    };

    // Function to update renderer and camera size
    function updateSize() {
        if (!elem || !renderer || !camera) return;
        
        const width = elem.clientWidth;
        const height = elem.clientHeight;
        
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function init() {
        scene = new THREE.Scene();
        // scene.background = new THREE.Color( 0xffffff );
        
        // Get container dimensions
        const width = elem?.clientWidth || 800;
        const height = elem?.clientHeight || 600;
        
        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
        // let camScale = 0.025;
        // let zoff = 5;
        // camera = new THREE.OrthographicCamera( window.innerWidth * camScale / - 2, window.innerWidth * camScale / 2, window.innerHeight * camScale / 2 + zoff, window.innerHeight * camScale / - 2 + zoff, 1, 1000 );

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);

        camera.position.x = 4;
        camera.position.y = 8;
        camera.position.z = 25;
        // set camera lookat
        // camera.lookAt(new THREE.Vector3(0, 10, 0));
        // recalc
        camera.updateProjectionMatrix();

        // White directional light at half intensity shining from the top.
        const directionalLight = new THREE.DirectionalLight(0xffefdf, 0.95);
        directionalLight.position.set(0.5, 1, 0.25);
        scene.add(directionalLight);
        const directionalLight2 = new THREE.DirectionalLight(0x7fbfff, 0.95);
        directionalLight2.position.set(-0.25, -0.2, -0.5);
        scene.add(directionalLight2);
        // hemisphere light
        const hemiLight = new THREE.HemisphereLight(0x406080, 0x500840);
        scene.add(hemiLight);

        const gridSize = 24;
        const divisions = gridSize;

        const gridHelper = new THREE.GridHelper(gridSize, divisions, 0x702040, 0x402040);
        const gridTop = new THREE.GridHelper(gridSize, divisions, 0x481038, 0x481038);
        gridTop.position.set(0, gridSize, 0);
        const gridBack = new THREE.GridHelper(gridSize, divisions, 0x481038, 0x481038);
        gridBack.geometry.rotateX(Math.PI / 2);
        gridBack.position.set(0, gridSize / 2, -gridSize / 2);
        // scene.add( gridHelper );

        {
            const geometry = new THREE.PlaneGeometry(gridSize, gridSize);
            const material = new THREE.MeshBasicMaterial({
                color: 0x402040,
                side: THREE.DoubleSide,
                // Make it additive blended transparency
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false,
            });
            const plane = new THREE.Mesh(geometry, material);
            plane.rotation.setFromVector3(new THREE.Vector3(Math.PI / 2, 0, 0));
            plane.position.set(0, 0.003, 0);

            roomGroup = new THREE.Group();
            roomGroup.add(gridHelper);
            roomGroup.add(gridTop);
            roomGroup.add(gridBack);
            roomGroup.add(plane);
            // roomGroup.visible = false;
            scene.add(roomGroup);
        }

        const axisSmall = new THREE.AxesHelper(1.0);
        scene.add(axisSmall);

        const [tempPlaneGroup, tempMassInGrams] = regenPlane(planeDef, planeGroup, scene);
        planeGroup = tempPlaneGroup;
        massInGrams = tempMassInGrams;

        // {
        //     const geometry = new THREE.SphereGeometry(planeGroup.boundingSphere.radius, 32, 32);
        //     const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        //     const sphere = new THREE.Mesh(geometry, material);
        //     sphere.position.copy(planeGroup.boundingSphere.center);
        //     scene.add(sphere);
        // }

        {
            simWorld = new THREE.Group();
            const geometry = generateWorldGeometry();
            const material = new THREE.MeshLambertMaterial({ color: 0x30b050, flatShading: true });
            // @ts-ignore - Three.js runtime compatibility
            const ground = new THREE.Mesh(geometry, material);
            // ground.position.copy(planeGroup.position);
            simWorld.add(ground);
            simWorld.name = "simWorld";
            simWorld.visible = false;
            scene.add(simWorld);
        }

        clock = new THREE.Clock();
    }

    // Generate a flat height field for the plane to fly over
    function generateWorldGeometry() {
        const worldWidth = 64, worldDepth = 64;
        const worldHalfWidth = worldWidth / 2, worldHalfDepth = worldDepth / 2;

        const data = new Uint8Array(worldWidth * worldDepth);

        const geometry = new THREE.PlaneGeometry(worldWidth * 50, worldDepth * 50, worldWidth - 1, worldDepth - 1);
        geometry.rotateX(-Math.PI / 2);

        const vertices = geometry.attributes.position.array;

        for (let i = 0, j = 0, l = vertices.length; i < l; i++, j += 3) {
            vertices[j + 1] = (data[i] + Math.random()) * 10;
        }

        geometry.computeVertexNormals();
        return geometry;
    }

    function debugSphere(pos, suffix = "", rad = 0.5, color = 0x00ff00) {
        let old = scene.getObjectByName("debugSphere" + suffix);
        if (old) {
            old.geometry.dispose();
            old.material.dispose();
            scene.remove(old);
        }
        const geometry = new THREE.SphereGeometry(rad, 32, 32);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.name = "debugSphere" + suffix;
        sphere.position.copy(pos);
        scene.add(sphere);
    }

    function debugArrow(pos, dir, suffix = "", color = 0x00ff00) {
        let old = scene.getObjectByName("debugArrow" + suffix);
        if (old) {
            old.geometry.dispose();
            old.material.dispose();
            scene.remove(old);
        }
        const arrowHelper = new THREE.ArrowHelper(dir.clone().normalize(), pos, dir.length(), color);
        arrowHelper.name = "debugArrow" + suffix;
        scene.add(arrowHelper);
    }

    function flyPlane(deltaTime) {
        // First multiply planeVel by delta time
        let deltaVel = planeVel.clone().multiplyScalar(deltaTime);
        // Add planeVel to planePos
        // planePos.add(deltaVel);
        // console.log("planePos", planePos);
        // Get normalized velocity vector
        let velNorm = planeVel.clone().normalize();
        let inFront = planePos.clone().add(velNorm.clone().multiplyScalar(50));
        debugSphere(inFront);
        // Get 2 normalized perpendicular vectors to the velocity vector
        let perp1 = new THREE.Vector3(velNorm.y, -velNorm.x, 0).normalize();
        // cross product of 2 vectors is perpendicular to both
        let perp2 = velNorm.clone().cross(perp1).normalize();
        // debugSphere(perp1, "perp1");
        // debugSphere(perp2, "perp2");

        // Make a list of random points that are in a circle in front of the plane perpendicular to the velocity vector
        let numPoints = 200;
        let points = [];
        for (let i = 0; i < numPoints; i++) {
            // Start by making an unbiased random point in a circle
            let R = planeDef.mainWingSpan.v * 0.5; // ************** HACKY! GET THE BOUNDING SPHERE!!!!!!!!!! **************
            let r = R * Math.sqrt(Math.random())
            let theta = Math.random() * 2 * Math.PI
            let x = r * Math.cos(theta)
            let y = r * Math.sin(theta)
            // Now tranform these points so they are in a plane in front of the plane
            let point = new THREE.Vector3(x, y, 0);
            let px = point.x * velNorm.x + point.y * velNorm.y + point.z * velNorm.z;
            let py = point.x * perp1.x + point.y * perp1.y + point.z * perp1.z;
            let pz = point.x * perp2.x + point.y * perp2.y + point.z * perp2.z;
            point.set(pz, py, px);
            // Now add inFront to the point
            point.add(inFront);
            // Now add the point to the list
            points.push(point);

            // debugSphere(point, "point" + i, 0.5, 0xff00ff);

        }

        // Now we have a list of points in front of the plane. Let's raycast from all those points to the plane
        let raycaster = new THREE.Raycaster();
        let intersects = [];
        let totalForceVector = new THREE.Vector3();
        for (let i = 0; i < numPoints; i++) {
            let point = points[i];
            // dir should be negative of plane velocity
            let dir = velNorm.clone().multiplyScalar(-1);
            raycaster.set(point, dir);
            let intersect = raycaster.intersectObject(planeGroup, true);
            if (intersect.length > 0) {
                intersects.push(intersect[0]);
                console.log(intersect[0]);
                let normal = intersect[0].face.normal.clone();
                // Transform the normal to world space
                // normal.applyQuaternion(intersect[0].object.quaternion);

                // debugSphere(intersect[0].point, "point" + i, 0.2, 0xff0000);
                debugArrow(intersect[0].point, normal, "normal" + i, 0xff0000);
                // subtract 'velNorm' from 'intersect[0].point' to get the incident vector
                let incident = intersect[0].point.clone().add(velNorm);
                debugArrow(incident, velNorm.clone().negate(), "incident" + i, 0xffff00);
                // Find the force magnitude by doing a dot product between the incident vector and the normal
                let forceMag = velNorm.dot(normal);
                // Multiply the force magnitude by the normal to get the force vector
                let force = normal.clone().multiplyScalar(forceMag).negate();
                debugArrow(intersect[0].point, force, "force" + i, 0x00ff00);

                // Add the force vector to the total force vector
                totalForceVector.add(force);
            }
        }
        debugSphere(planePos, "planePos", 0.5, 0x0000ff);
        debugArrow(planePos, totalForceVector, "forceVec", 0x00ffff);

        // F=MA on the airplane. We have F as totalForceVector. M is massInGrams. Get A.
        let acceleration = totalForceVector.clone().divideScalar(massInGrams);
        // Multiply A by delta time to get delta velocity
        let deltaVel2 = acceleration.clone().multiplyScalar(deltaTime);
        // Add delta velocity to plane velocity
        // planeVel.add(deltaVel2.clone().multiplyScalar(10000.0));
        // console.log("planeVel", planeVel);
    }

    function animate() {
        if (!renderer) return;
        requestAnimationFrame(animate);
        // let info = renderer.info;
        // if (Math.random() < 0.01) console.log("info", info.memory.geometries, info.memory.textures, info.programs);
        // let time = clock.getElapsedTime();
        let delta = clock.getDelta();
        // console.log("time", delta);

        if (dirty) {
            freeMemory(planeGroup);
            dirty = false;
            const [tempPlaneGroup, massInGrams] = regenPlane(planeDef, planeGroup, scene);
            planeGroup = tempPlaneGroup;
        }
        // planeGroup.rotation.y = time * 7.93;
        camera.updateProjectionMatrix(); // Not needed?

        if (planeFlying) {
            flyPlane(delta);
            planeGroup.position.copy(planePos);
            planeFlying = false;
            camera.lookAt( planeGroup.position );
        } else {
            // planeGroup.position.set(0, 0, 0);
        }

        controls?.update();
        renderer.render(scene, camera);
    }

    onMount(() => {
        // Initialize Three.js after the element is mounted
        init();
        animate();
        
        elem.appendChild(renderer.domElement);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.03;
        // controls.zoomSpeed = 0.125;
        controls.rotateSpeed = 0.5;
        // autorotate
        // controls.autoRotate = true;
        // controls.autoRotateSpeed = -2.0;
        

        // controls.screenSpacePanning = false;

        // Add resize listener
        const resizeHandler = () => {
            updateSize();
        };
        window.addEventListener('resize', resizeHandler);

        // Initial size update
        updateSize();

        return () => {
            window.removeEventListener('resize', resizeHandler);
            renderer?.renderLists.dispose();
            renderer?.dispose();
            renderer = null;
        };
    });

    function keyDown(e) {
        // console.log("keyDown", e.key);
        if (e.key === "ArrowLeft") {
        } else if (e.key === "ArrowRight") {
        } else if (e.key === "ArrowUp") {
        } else if (e.key === "ArrowDown") {
        } else if (e.key === " ") {
        }
    }

    function getPointerPos(ev) {
        let rect = elem.getBoundingClientRect();
        const border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2); // * size;
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2); // * size;
        return [x, y];
    }

    // Implement dragging of the number for each of the 3 boxes representing normalX, normalY, and bias.
    let startY = 0;
    let startValue = 0;
    let dragging = false;
    let draggingIndex = -1;

    function pointerDown(e, index) {
        controls.autoRotate = false;
        // console.log("pointerDown", index);
        startY = e.clientY;
        // console.log("startValue", startValue);
        dragging = true;
        draggingIndex = index;
    }
    function pointerMove(e, index) {
        // console.log("pointerMove", index);
        if (dragging) {
            let diff = e.clientY - startY;
            if (draggingIndex === 0) {
            } else if (draggingIndex === 1) {
            } else if (draggingIndex === 2) {
            } else if (draggingIndex === 3) {
            }
        }
    }
    function pointerUp(index) {
        // console.log("pointerUp", index);
        dragging = false;
        draggingIndex = -1;
    }

    function resetPlanePhysics(flying = false) {
        planePos = new THREE.Vector3(0, 0, 0);
        planeGroup.position.copy(planePos);
        planeRot = new THREE.Quaternion(0, 0, 0, 1);
        planeVel = new THREE.Vector3(0, 0, 0);
        planeRotVel = new THREE.Vector3(0, 0, 0);
        planeFlying = flying;
    }
    function throwPlane() {
        resetPlanePhysics(true);
        planeVel.x = 1*100; // 1m/s
    }

    function aerodynamics() {
        
    }

    function setPlayMode(mode) {
        playMode = mode;
        resetPlanePhysics(false);
        if (mode === 0) {
            scene.background = new THREE.Color( 0x000000 );
            camera.position.set(4, 8, 25);
            simWorld.visible = false;
            dirty = true;
        } else if (mode === 1) {
            scene.background = new THREE.Color( 0x50e0ff ); // 0x50d0ff
            camera.position.set(-40, 38, 35);
            simWorld.visible = true;
            planeGroup.position.copy(new THREE.Vector3(0, 28, 0));
        }
    }

    async function keyPressed(e) {
        let key = e.detail.key;
        if (key == "backspace") {
            typed = typed.slice(0, -1);
        } else if (key == "enter") {
            if (typed == "256") saveToSTL(planeGroup, planeDef)
            areYouAParentModal = 0;
            typed = "";
            return;
        } else {
            if (typed.length < 28) typed += key;
        }
    }

    function genRandomPlane() {
        // loop through each key in planeDef and set its 'v' value to a random number between its min and max
        for (let key in planeDef) {
            let def = planeDef[key];
            if (def.min !== undefined && def.max !== undefined) {
                let r = (Math.random() + Math.random()) * 0.5;
                planeDef[key].v = r * (def.max - def.min) + def.min;
            }
        }
        dirty = true;
    }
</script>

<svelte:window on:keydown={keyDown} />

<FourByThreeScreen bg="#000000">
    <div
        class="w-full h-full"
        bind:this={elem}
        on:pointerdown={(e) => pointerDown(e, -1)}
        on:pointermove={(e) => pointerMove(e, -1)}
        on:pointerup={(e) => pointerUp(-1)}
        on:pointerleave={(e) => pointerUp(-1)}
    />
    {#if areYouAParentModal != 0}
        <div class="absolute fit-full-space bg-pink-800 z-20 p-4 flex-col text-4xl">
            <div class="w-full" on:pointerdown={() => {areYouAParentModal = 0; typed=""}}>
                This will download an stl file so you can 3d print the airplane. The download operation escapes the app's sandbox, so I will ask you this silly question to see if you are a parent.
                <div class="text-7xl pt-8">What is 2 to the 8th power?</div>
            </div>
            <pre class="border border-pink-500 bg-pink-900 text-white text-7xl p-2 my-2 rounded-2xl">{typed}{'_'}&nbsp;</pre>
            <Keyboard on:pressed={keyPressed} enterEnabled={true} extraKeys={["numbers", "backspace", "music"]} />
        </div>
    {/if}

    <!-- <button class="absolute top-[2rem] left-[2rem] coolbutton" style="background-color:{playMode === 1?'#ff2080b0':''}" on:pointerup={() => (setPlayMode(1-playMode))} ><i class="fas fa-plane-departure"/></button> -->
    <button class="absolute top-[2rem] left-[10rem] coolbutton" on:pointerup={genRandomPlane} ><i class="fas fa-wand-magic-sparkles"/></button>
    <button class="absolute top-[2rem] left-[18rem] coolbutton" on:pointerup={() => (areYouAParentModal = 1)} ><i class="fas fa-download"/></button>
    {#if playMode === 0}
        <div class="absolute top-4 right-4 w-96 h-96 bg-pink-500/40">
            <Line x0={2} y0={11} x1={22} y1={11} thick={3} rounded color="#b0b0b0" />
            <Line x0={7} y0={20} x1={17} y1={20} thick={2} rounded color="#b0b0b0" />
            <Line x0={12} y0={4} x1={12} y1={20} thick={4} rounded color="#d0d0d0" />
            <SVGArcDeg class="absolute top-[-8rem]" color={"#4060af"} startAngle={-80} endAngle={80} radius={10} thick={5} />
            <button class="absolute top-[8.5rem] left-[18.5rem] coolbutton" style="background-color:{designMode === 1?'#ff2080b0':''}" on:pointerup={() => (designMode = 1)} />
            <button class="absolute top-[17.5rem] left-[15rem] coolbutton" style="background-color:{designMode === 2?'#ff2080b0':''}" on:pointerup={() => (designMode = 2)} />
            <button class="absolute top-[17.5rem] left-[9.5rem] coolbutton" style="background-color:{designMode === 3?'#ff2080b0':''}" on:pointerup={() => (designMode = 3)} />
            <button class="absolute top-[4rem] left-[9.5rem] coolbutton" style="background-color:{designMode === 4?'#ff2080b0':''}" on:pointerup={() => (designMode = 4)} />
            <!-- <button class="absolute top-[8.5rem] left-[12rem] coolbutton" style="background-color:{designMode === 5?'#ff2080b0':''}" on:pointerup={() => (designMode = 5)} /> -->
        </div>
        {#if designMode === 1}
            <div class="absolute bottom-4 right-4 w-96 h-[40rem] bg-pink-500/40">
                {#each [planeDef.mainWingSpan, planeDef.mainWingMiddleLen, planeDef.mainWingTipRatio, planeDef.mainWingThickness, planeDef.mainWingSweep, planeDef.mainWingVSweep, planeDef.mainWingAngle, planeDef.mainWingForward, planeDef.mainWingUp] as part, i}
                    <Slider label={part.label} units={part.units || ""} val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
        {#if designMode === 2}
            <div class="absolute bottom-4 right-4 w-96 h-[40rem] bg-pink-500/40">
                {#each [planeDef.backWingSpan, planeDef.backWingMiddleLen, planeDef.backWingTipRatio, planeDef.backWingThickness, planeDef.backWingSweep, planeDef.backWingVSweep, planeDef.backWingAngle, planeDef.backWingForward, planeDef.backWingUp] as part, i}
                    <Slider label={part.label} units={part.units || ""} val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
        {#if designMode === 3}
            <div class="absolute bottom-4 right-4 w-96 h-[32rem] bg-pink-500/40">
                {#each [planeDef.tailFinSpan, planeDef.tailFinMiddleLen, planeDef.tailFinTipRatio, planeDef.tailFinThickness, planeDef.tailFinSweep, planeDef.tailFinForward] as part, i}
                    <Slider label={part.label} units={part.units || ""} val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
        {#if designMode === 4}
            <div class="absolute bottom-4 right-4 w-96 h-[32rem] bg-pink-500/40">
                {#each [planeDef.fuselageLength, planeDef.fuselageRad] as part, i}
                    <Slider label={part.label} units={part.units || ""} val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
    {:else if playMode === 1}
        <button class="absolute top-[16rem] left-[2rem] coolbutton" style="background-color:#20a060b0" on:pointerup={throwPlane} >GO</button>
        <button class="absolute top-[16rem] left-[10rem] coolbutton" style="background-color:#20a060b0" on:pointerup={() => (planeFlying = true)} >+</button>
    {/if}
    <CloseButton confirm></CloseButton>
</FourByThreeScreen>

<style>
    .coolbutton {
        @apply bg-blue-400/50 border-blue-400 border-4 w-20 h-20 rounded-full p-2 text-white text-4xl;
        @apply active:scale-150 transform transition-all duration-75;
        @apply flex items-center justify-center;
    }
</style>
