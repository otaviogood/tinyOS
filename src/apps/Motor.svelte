<script>
    import { onMount } from "svelte";
    import { pop } from "svelte-spa-router";
    import {
        invAspectRatio,
        fullWidth,
        fullHeight,
        landscape,
        bigWidth,
        bigHeight,
        bigScale,
        bigPadX,
        bigPadY,
        handleResize,
    } from "../screen";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import Line from "../components/Line.svelte";
    import { Animator, frameCount, animateCount } from "../animator";

    let animator = new Animator(60, tick);

    let elem;
    let magnetAngleRad = 0;
    let magnetAngularVelRad = 0;
    let magnetStates = [0, 0, 0];

    onMount(() => {
        return () => {
            animator.stop();
        };
    });

    let lastTickTime = 0;
    function tick() {
        if (lastTickTime == 0) lastTickTime = Date.now();
        // Get the delta between the last tick and the current time
        let now = Date.now();
        let intSecs = Math.floor(lastTickTime / 160);
        let delta = now - lastTickTime;
        lastTickTime = now;
        // debugStr = `${currentHours}:${currentMinutes}:${currentSeconds}`;

        // Loop through the magnets and calculate the force on the center magnet
        let force = 0;
        for (let i = 0; i < 3; i++) {
            // Calc angle difference between magnet and center magnet
            let diff = magnetAngleRad - i * 3.14159 * 2 / 3;
            // if (Math.random() < .05 && i == 0) console.log(i, diff * 180 / 3.14159);
            force += magnetStates[i] * (-Math.sin(diff));
        }
        magnetAngularVelRad += force * delta * 0.001;
        // Friction
        magnetAngularVelRad *= 0.9;

        magnetAngleRad += magnetAngularVelRad * delta * 0.001 * Math.PI * 2;
    }

    function press(dir, i) {
        magnetStates[i] = dir;
        magnetStates = magnetStates;
        // console.log(dir, i);
    }

    handleResize();
    animator.start();
</script>

<FourByThreeScreen bg="black">
    <div
        class="flex-center-all flex-col h-full w-full"
        bind:this={elem}
    >
    <div class="flex-center-all absolute top-4 bottom-4 left-4 right-4 bg-gray-600 rounded-3xl">
        <div class="flex-center-all absolute flex-col overflow-clip text-7xl w-96 h-96 bg-red-500 rounded-full" style="transform:rotate({magnetAngleRad}rad)">
            <div class="flex-center-all bg-blue-500 w-full p-16">N</div>
            <div class="p-16">S</div>
        </div>
        <div class="flex-center-all absolute w-[70rem] h-[70rem] rounded-full border-8 border-gray-400" style=""></div>
        {#each Array(3) as _, i}
            <div class="relative w-1 h-1 text-7xl bg-purple-500" style="transform: translate(-24rem, 0) rotate({i*3.14159*2/3+3.14159*9/6}rad);transform-origin: 24rem 0rem;">
                <!-- <div class="bg-red-700 w-64 h-64">B</div> -->
                <Line x0={0} y0={0} color="#af305f" thick={18}>
                    <div class="w-full h-full bg-gray-700 flex flex-row">
                        <div class="flex-center-all bg-blue-500 w-24 select-none cursor-pointer" on:pointerup={()=>press(1,i)} style="color:{magnetStates[i]==1?'white':'black'}; bXackground-color:{magnetStates[i]+1}">N</div>
                        <div class="flex-center-all bg-gray-500 w-24 select-none cursor-pointer" on:pointerup={()=>press(0,i)} style="color:{magnetStates[i]==0?'white':'black'};bXackground-color:{magnetStates[i]+1}">{i}</div>
                        <div class="flex-center-all bg-red-500 w-24 select-none cursor-pointer" on:pointerup={()=>press(-1,i)} style="color:{magnetStates[i]==-1?'white':'black'};bXackground-color:{magnetStates[i]+1}">S</div>
                    </div>
                </Line>
            </div>
        {/each}
    </div>
    <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl z-40" on:pointerup={pop}>
        <i class="fas fa-times-circle" />
    </div>
</FourByThreeScreen>
