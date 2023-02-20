<script>
    import { onMount } from "svelte";
    import { pop } from "svelte-spa-router";
    import { Howl, Howler } from "howler";
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
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../utils";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import SVGArcDeg from "../components/SVGArcDeg.svelte";
    import Line from "../components/Line.svelte";
    import { Animator, frameCount, animateCount } from "../animator";

    var snd_coin = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.75 });

    let animator = new Animator(60, tick);

    let debugStr = "";
    let startHours = 0;
    let startMinutes = 0;
    let startSeconds = 15;
    let currentHours = startHours;
    let currentMinutes = startMinutes;
    let currentSeconds = startSeconds;
    let state = 0; // 0 = stopped, 1 = running, 2 = alarm
    let alarmCountdown = 0;

    let mousePressed = false;
    let elem;
    let rect;
    let mouseX = 0,
        mouseY = 0;
    let whichRing = -1;
    let ring0alpha = 0.19;
    let ring1alpha = 0.19;
    let ring2alpha = 0.19;
    let ring0thick = 16.0;

    onMount(() => {
        return () => {
            animator.stop();
        };
    });

    function getPointerPos(ev) {
        rect = elem.getBoundingClientRect();
        const border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2); // * size;
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2); // * size;
        return [x, y];
    }

    function getPolar(mXY) {
        let alphaX = mXY[0]; // / rect.width;
        let alphaY = mXY[1]; // / rect.height;
        alphaX = alphaX * 2 - 1;
        alphaY = ((alphaY * 2 - 1) * 3) / 4;
        mouseX = alphaX * 50;
        mouseY = alphaY * 50;
        // console.log("mouseX", mouseX, "mouseY", mouseY, rect.width, rect.height);

        let rad = Math.sqrt(alphaX * alphaX + alphaY * alphaY);
        let angle = Math.atan2(alphaX, -alphaY);
        if (alphaX === 0 && alphaY === 0) angle = 0;
        if (angle < 0) angle += 2 * Math.PI;
        return [rad, angle];
    }

    function handlePointerdown(e) {
        if (state !== 0) return;
        mousePressed = true;
        let mXY = getPointerPos(e);
        let radAngle = getPolar(mXY);
        let rad = radAngle[0];
        if (rad > 0.513 && rad <= 0.64) {
            whichRing = 0;
        } else if (rad > 0.385 && rad <= 0.513) {
            whichRing = 1;
        } else if (rad > 0.256 && rad <= 0.385) {
            whichRing = 2;
        } else {
            whichRing = -1;
        }
        setFromAngle(radAngle[1]);
    }
    function setFromAngle(angle) {
        if (whichRing === 0) {
            currentSeconds = Math.round((angle / (Math.PI * 2)) * 60);
            startSeconds = currentSeconds;
        } else if (whichRing === 1) {
            currentMinutes = Math.round((angle / (Math.PI * 2)) * 60);
            startMinutes = currentMinutes;
        } else if (whichRing === 2) {
            currentHours = Math.round((angle / (Math.PI * 2)) * 24);
            startHours = currentHours;
        }
    }
    function handlePointermove(e) {
        if (mousePressed) {
            let mXY = getPointerPos(e);
            let radAngle = getPolar(mXY);
            setFromAngle(radAngle[1]);
        }
    }
    function handlePointerup(e) {
        if (mousePressed) {
            mousePressed = false;
            let mXY = getPointerPos(e);
        }
        whichRing = -1;
    }
    function handlePointerleave(e) {
        mousePressed = false;
        whichRing = -1;
    }

    function lerp(a, b, t) {
        return a * (1 - t) + b * t;
    }

    let lastTickTime = 0;
    function tick() {
        debugStr = state.toString();
        if (mousePressed && whichRing === 0) {
            ring0alpha = lerp(ring0alpha, 0.5, 0.1);
        } else {
            ring0alpha = lerp(ring0alpha, 0.19, 0.1);
        }
        if (mousePressed && whichRing === 1) {
            ring1alpha = lerp(ring1alpha, 0.5, 0.1);
        } else {
            ring1alpha = lerp(ring1alpha, 0.19, 0.1);
        }
        if (mousePressed && whichRing === 2) {
            ring2alpha = lerp(ring2alpha, 0.5, 0.1);
        } else {
            ring2alpha = lerp(ring2alpha, 0.19, 0.1);
        }
        ring0thick = lerp(ring0thick, 16.0, Math.min(1.0, 0.002 + ring0thick * 0.002));
        // ring0alpha = Math.sin(Date.now()*0.001) * 0.5 + 0.5;
        if (state === 0) return;
        if (lastTickTime == 0) lastTickTime = Date.now();
        // Get the delta between the last tick and the current time
        let now = Date.now();
        let intSecs = Math.floor(lastTickTime / 160);
        let delta = now - lastTickTime;
        lastTickTime = now;
        if (state === 2) {
            alarmCountdown -= delta / 1000;
            let intSecs2 = Math.floor(now / 160);
            if (intSecs2 !== intSecs) {
                snd_coin.play();
            }
            if (alarmCountdown <= 0) {
                reset();
            }
            return;
        }
        // Update the current time variables
        currentSeconds -= delta / 1000;
        if (currentSeconds < 0) {
            ring0thick = 0.0;
            currentSeconds += 60;
            currentMinutes -= 1;
        }
        if (currentMinutes < 0) {
            currentMinutes += 60;
            currentHours -= 1;
        }
        if (currentHours < 0) {
            currentHours = 0;
            currentMinutes = 0;
            currentSeconds = 0;
        }
        if (currentHours <= 0 && currentMinutes <= 0 && currentSeconds <= 0) {
            alarm();
        }
        // debugStr = `${currentHours}:${currentMinutes}:${currentSeconds}`;
    }

    function start() {
        state = 1;
        lastTickTime = 0;
        // animator.start();
    }

    function stop() {
        state = 0;
        // animator.stop();
    }

    function reset() {
        state = 0;
        currentHours = startHours;
        currentMinutes = startMinutes;
        currentSeconds = startSeconds;
        // animator.stop();
    }

    function alarm() {
        state = 2;
        alarmCountdown = 6;
    }

    handleResize();
    animator.start();
</script>

<FourByThreeScreen bg="black">
    <div
        class="flex-center-all flex-col h-full w-full"
        bind:this={elem}
        on:pointerdown|preventDefault|stopPropagation={handlePointerdown}
        on:pointerup={handlePointerup}
        on:pointermove|preventDefault|stopPropagation={handlePointermove}
        on:pointerleave={handlePointerleave}
        on:touchend={handlePointerup}
        on:touchcancel={handlePointerup}
    >
        <SVGArcDeg class="absolute" color={"#ff5030" + Math.trunc(ring0alpha*255).toString(16).padStart(2, '0')} startAngle={0} endAngle={359.7} radius={77} thick={-3 + ring0alpha * 24} />
        <SVGArcDeg class="absolute" color={"#ff60c0" + Math.trunc(ring1alpha*255).toString(16).padStart(2, '0')} startAngle={0} endAngle={359.7} radius={77 - 17} thick={-1 + ring1alpha * 24} />
        <SVGArcDeg class="absolute" color={"#2fb0e0" + Math.trunc(ring2alpha*255).toString(16).padStart(2, '0')} startAngle={0} endAngle={359.7} radius={77 - 17 - 17} thick={1 + ring2alpha * 24} />

        <SVGArcDeg
            class="absolute"
            color={whichRing === 0 ? "#ff5030b0" : "#ff5030"}
            startAngle={0}
            endAngle={(currentSeconds / 60.0) * 359.999}
            radius={77}
            thick={ring0thick}
        />
        <SVGArcDeg
            class="absolute"
            color={whichRing === 1 ? "#ff60c0b0" : "#ff60c0"}
            startAngle={0}
            endAngle={(currentMinutes / 60.0) * 359.999}
            radius={77 - 17}
            thick={16}
        />
        <SVGArcDeg
            class="absolute"
            color={whichRing === 2 ? "#2fb0e0b0" : "#2fb0e0"}
            startAngle={0}
            endAngle={(currentHours / 24.0) * 359.999}
            radius={77 - 17 - 17}
            thick={16}
        />
        {#each Array(60) as _, i}
            <Line
                class="flex-center-all w-full h-full"
                color="#000000"
                x0={50 + Math.cos((i * Math.PI * 2) / 60) * 25.5}
                y0={37.5 + Math.sin((i * Math.PI * 2) / 60) * 25.5}
                x1={50 + Math.cos((i * Math.PI * 2) / 60) * 26}
                y1={37.5 + Math.sin((i * Math.PI * 2) / 60) * 26}
                thick={0.25}
            />
        {/each}
        {#each Array(24) as _, i}
            <Line
                class="flex-center-all w-full h-full"
                color="#000000"
                x0={50 + Math.cos((i * Math.PI * 2) / 24) * 13}
                y0={37.5 + Math.sin((i * Math.PI * 2) / 24) * 13}
                x1={50 + Math.cos((i * Math.PI * 2) / 24) * 13.3}
                y1={37.5 + Math.sin((i * Math.PI * 2) / 24) * 13.3}
                thick={0.25}
            />
        {/each}
        <!-- <Line
            class="flex-center-all w-full h-full z-20"
            color="#00ff00"
            x0={50}
            y0={37.5}
            x1={50 + mouseX}
            y1={37.5 + mouseY}
            thick={0.125}
        /> -->

        <div class="flex-center-all h-full w-full z-10">
            <!-- Crazy spinning morse code logo -->
            <svg
                xmlns="http://www.w3.org/2000/svg"
                xmlns:xlink="http://www.w3.org/1999/xlink"
                viewBox="0 0 500 500"
                style="margin:-8rem"
                width="2160"
                height="2160"
            >
                <defs>
                    <path d="M50,250c0-110.5,89.5-200,200-200s200,89.5,200,200s-89.5,200-200,200S50,360.5,50,250" id="textcircle">
                        <!-- <animateTransform attributeName="transform" begin="0s" dur="2s" type="rotate" from="0 250 250" to="360 250 250" repeatCount="1" /> -->
                        <!-- SMIL animation: deprecated in Chrome, so eventually will have to be replaced with Web Animation API or alternative -->
                    </path>
                </defs>
                <text dy="139" textLength="220" style="fill:#feffff;font-size:22px" class="">
                    <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                    <textPath textLength="220" xlink:href="#textcircle">HOURS</textPath>
                </text>
                <text dy="111" textLength="220" style="fill:#feffff;font-size:22px" class="">
                    <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                    <textPath textLength="220" xlink:href="#textcircle">MINUTES</textPath>
                </text>
                <text dy="84" textLength="220" style="fill:#feffff;font-size:22px" class="">
                    <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                    <textPath textLength="220" xlink:href="#textcircle">SECONDS</textPath>
                </text>

                <text dy="136" dx="326" textLength="52" style="fill:#feffff;font-size:22px" class="">
                    <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                    <textPath textLength="52" xlink:href="#textcircle">{Math.trunc(currentHours)}</textPath>
                </text>
                <text dy="110" dx="326" textLength="44" style="fill:#feffff;font-size:22px" class="">
                    <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                    <textPath textLength="44" xlink:href="#textcircle">{Math.trunc(currentMinutes)}</textPath>
                </text>
                <text dy="84" dx="326" textLength="36" style="fill:#feffff;font-size:22px" class="">
                    <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                    <textPath textLength="36" xlink:href="#textcircle">{Math.trunc(currentSeconds)}</textPath>
                </text>
            </svg>
            {#if state === 0}
                <div
                    class="absolute flex-center-all w-72 h-72 text-7xl rounded-full bg-gray-900 border-[.25rem] border-cyan-400 active:bg-cyan-900"
                    on:pointerup={start}
                >
                    START
                </div>
            {:else if state === 1}
                <div
                    class="absolute flex-center-all w-72 h-72 text-7xl rounded-full bg-gray-900 border-[.25rem] border-cyan-400"
                    on:pointerup={reset}
                >
                    STOP
                </div>
            {:else if state === 2}
                <div
                    class="absolute flex-center-all w-[23rem] h-[23rem] text-7xl rounded-full bg-red-600 border-[.25rem]"
                    style="transform-origin:50% 50%;transform: translate({Math.sin(alarmCountdown * 10)*2}rem, {Math.cos(
                        alarmCountdown * 10
                    )*2}rem)"
                    on:pointerup={reset}
                >
                    STOP
                </div>
            {/if}
            <!-- <div class="absolute flex-center-all w-72 h-72 text-7xl rounded-full bg-gray-900 border-[.25rem] border-cyan-400" on:pointerup={start}>
                START
            </div> -->
        </div>
        <!-- <pre class="text-2xl text-gray-100 absolute left-0 top-0 z-50">{debugStr}</pre> -->
    </div>
    <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl z-40" on:pointerup={pop}>
        <i class="fas fa-times-circle" />
    </div>
</FourByThreeScreen>
