<script>
    import { onMount } from "svelte";
    import { handleResize } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import Line from "../../components/Line.svelte";
    import SVGArcDeg from "../../components/SVGArcDeg.svelte";
    import Slider from "../../components/Slider.svelte";
    import * as THREE from "three";
    import { OrbitControls } from "three/addons/controls/OrbitControls.js";
    import { regenPlane, saveToSTL } from "./meshGen";
    import CloseButton from "../../components/CloseButton.svelte";

    handleResize();

    let elem;
    let scene, camera, renderer, controls, clock;
    let roomGroup;

    let planeGroup;
    let dirty = false;
    let designMode = 0; // 0: ?, 1: main wing, 2: rear wing, 3: tail fin, 4: fuselage, 5: fuselage-wing, 6: engine
    let playMode = 0; // 0: design, 1: fly

    let planeFlying = false;
    let planePos = new THREE.Vector3(0, 0, 0);
    let planeRot = new THREE.Quaternion(0, 0, 0, 1);
    let planeVel = new THREE.Vector3(0, 0, 0);
    let planeRotVel = new THREE.Vector3(0, 0, 0);


    let planeDef = {
        mainWingSpan: {v:30.0, min:0.0, max:50.0, label:"span"},
        mainWingMiddleLen: {v:8.0, min:2.0, max:30.0, label:"length"},
        mainWingTipRatio: {v:0.5, min:0.0, max:1.0, label:"squeeze"},
        mainWingThickness: {v:0.7, min:0.1, max:2.0, label:"thickness"},
        mainWingSweep: {v:6.0, min:-20.0, max:20.0, label:"sweep"},
        mainWingVSweep: {v:3.0, min:-10.0, max:10.0, label:"dihedral"},
        mainWingAngle: {v:0.0, min:-2.0, max:15.0, label:"angle"},
        mainWingForward: {v:-2.0, min:-10.0, max:10.0, label:"forward"},
        mainWingUp: {v:0.0, min:-1.0, max:1.0, label:"up"},

        backWingSpan: {v:12.0, min:0.0, max:50.0, label:"span"},
        backWingMiddleLen: {v:6.0, min:2.0, max:20.0, label:"length"},
        backWingTipRatio: {v:0.3, min:0.0, max:1.0, label:"squeeze"},
        backWingThickness: {v:0.4, min:0.1, max:2.0, label:"thickness"},
        backWingSweep: {v:8.0, min:-10.0, max:10.0, label:"sweep"},
        backWingVSweep: {v:1.0, min:-10.0, max:10.0, label:"dihedral"},
        backWingAngle: {v:0.0, min:-12.0, max:12.0, label:"angle"},
        backWingForward: {v:0.0, min:-5.0, max:10.0, label:"forward"},
        backWingUp: {v:0.0, min:-1.0, max:1.0, label:"up"},

        tailFinSpan: {v:12.0, min:0.0, max:30.0, label:"span"},
        tailFinMiddleLen: {v:6.0, min:2.0, max:20.0, label:"length"},
        tailFinTipRatio: {v:0.3, min:0.1, max:1.0, label:"squeeze"},
        tailFinThickness: {v:0.3, min:0.1, max:1.5, label:"thickness"},
        tailFinSweep: {v:3.0, min:-2.0, max:16.0, label:"sweep"},
        tailFinForward: {v:0.0, min:-5.0, max:10.0, label:"forward"},

        fuselageLength: {v:25.0, min:10.0, max:30.0, label:"length"},
        fuselageRad: {v:1.5, min:0.2, max:4.0, label:"thickness"},
    };


    function init() {
        scene = new THREE.Scene();
        // scene.background = new THREE.Color( 0xffffff );
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        // let camScale = 0.025;
        // let zoff = 5;
        // camera = new THREE.OrthographicCamera( window.innerWidth * camScale / - 2, window.innerWidth * camScale / 2, window.innerHeight * camScale / 2 + zoff, window.innerHeight * camScale / - 2 + zoff, 1, 1000 );

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);

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
        const gridTop = new THREE.GridHelper(gridSize, divisions, 0x300828, 0x300828);
        gridTop.position.set(0, gridSize, 0);
        const gridBack = new THREE.GridHelper(gridSize, divisions, 0x300828, 0x300828);
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

        planeGroup = regenPlane(planeDef, planeGroup, scene);

        // {
        //     const geometry = new THREE.SphereGeometry(planeGroup.boundingSphere.radius, 32, 32);
        //     const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        //     const sphere = new THREE.Mesh(geometry, material);
        //     sphere.position.copy(planeGroup.boundingSphere.center);
        //     scene.add(sphere);
        // }

        clock = new THREE.Clock();
    }

    function debugSphere(pos, rad = 0.5, color = 0x00ff00) {
        let old = scene.getObjectByName("debugSphere");
        if (old) scene.remove(old);
        const geometry = new THREE.SphereGeometry(rad, 32, 32);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.name = "debugSphere";
        sphere.position.copy(pos);
        scene.add(sphere);
    }

    function flyPlane(deltaTime) {
            // First multiply planeVel by delta time
            let deltaVel = planeVel.clone().multiplyScalar(deltaTime);
            // Add planeVel to planePos
            planePos.add(deltaVel);
            // console.log("planePos", planePos);
            // Get normalized velocity vector
            let velNorm = planeVel.clone().normalize();
            velNorm.multiplyScalar(50);
            let inFront = planePos.clone().add(velNorm);
            debugSphere(inFront);
    }

    function animate() {
        if (!renderer) return;
        requestAnimationFrame(animate);
        // let time = clock.getElapsedTime();
        let delta = clock.getDelta();
        // console.log("time", delta);

        if (dirty) {
            dirty = false;
            planeGroup = regenPlane(planeDef, planeGroup, scene);
        }
        // planeGroup.rotation.y = time * 7.93;
        camera.updateProjectionMatrix(); // Not needed?

        if (planeFlying) {
            flyPlane(delta);
            planeGroup.position.copy(planePos);
        } else {
            // planeGroup.position.set(0, 0, 0);
        }

        controls?.update();
        renderer.render(scene, camera);
    }
    init();
    animate();

    onMount(() => {
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

        return () => {
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
        planeRot = new THREE.Quaternion(0, 0, 0, 1);
        planeVel = new THREE.Vector3(0, 0, 0);
        planeRotVel = new THREE.Vector3(0, 0, 0);
        planeFlying = flying;
    }
    function throwPlane() {
        resetPlanePhysics(true);
        planeVel.x = 1*100; // 1m/s
    }
    function setPlayMode(mode) {
        playMode = mode;
        resetPlanePhysics(false);
        if (mode === 0) {
            camera.position.set(4, 8, 25);
            dirty = true;
        } else if (mode === 1) {
            camera.position.set(-40, 38, 35);
        }
    }
</script>

<svelte:window on:keydown={keyDown} />

<FourByThreeScreen bg="#ffffff">
    <div
        class="w-full h-full"
        bind:this={elem}
        on:pointerdown={(e) => pointerDown(e, -1)}
        on:pointermove={(e) => pointerMove(e, -1)}
        on:pointerup={(e) => pointerUp(-1)}
        on:pointerleave={(e) => pointerUp(-1)}
    />
    <button class="absolute top-[2rem] left-[2rem] coolbutton" style="background-color:{playMode === 1?'#ff2080b0':''}" on:pointerup={() => (setPlayMode(1-playMode))} ><i class="fas fa-plane-departure"/></button>
    <button class="absolute top-[2rem] left-[8rem] coolbutton" on:pointerup={() => (saveToSTL(planeGroup, planeDef))} ><i class="fas fa-download"/></button>
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
                    <Slider label={part.label} units="cm" val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
        {#if designMode === 2}
            <div class="absolute bottom-4 right-4 w-96 h-[40rem] bg-pink-500/40">
                {#each [planeDef.backWingSpan, planeDef.backWingMiddleLen, planeDef.backWingTipRatio, planeDef.backWingThickness, planeDef.backWingSweep, planeDef.backWingVSweep, planeDef.backWingAngle, planeDef.backWingForward, planeDef.backWingUp] as part, i}
                    <Slider label={part.label} units="cm" val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
        {#if designMode === 3}
            <div class="absolute bottom-4 right-4 w-96 h-[32rem] bg-pink-500/40">
                {#each [planeDef.tailFinSpan, planeDef.tailFinMiddleLen, planeDef.tailFinTipRatio, planeDef.tailFinThickness, planeDef.tailFinSweep, planeDef.tailFinForward] as part, i}
                    <Slider label={part.label} units="cm" val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
        {#if designMode === 4}
            <div class="absolute bottom-4 right-4 w-96 h-[32rem] bg-pink-500/40">
                {#each [planeDef.fuselageLength, planeDef.fuselageRad] as part, i}
                    <Slider label={part.label} units="cm" val={part.v} min={part.min} max={part.max} selected={true} color="#2aaa82" on:change={(a) => {part.v = a.detail.v; dirty = true;}} />
                {/each}
            </div>
        {/if}
    {:else if playMode === 1}
        <button class="absolute top-[16rem] left-[2rem] coolbutton" style="background-color:#20a060b0" on:pointerup={throwPlane} >GO</button>
    {/if}
    <CloseButton confirm></CloseButton>
</FourByThreeScreen>

<style>
    .coolbutton {
        @apply bg-blue-400/50 border-blue-400 border-4 w-20 h-20 rounded-full p-2 text-white text-4xl;
        @apply active:scale-150 transform transition-all duration-75;
        @apply flex-center-all;
    }
</style>
