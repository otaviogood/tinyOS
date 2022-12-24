<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { pop } from "svelte-spa-router";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import { Road, Town } from "./places";
    import IconsMisc from "./IconsMisc.svelte";
    import HelpScreen from "./HelpScreen.svelte";
    import { animInterp, currentX, currentY, earnedStar, currentTownIndex, allTowns } from "./stores.js";
    import { slideLeft, pulseShadow, scaleDown } from "./Transitions";
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
    } from "../../screen";
    // import WebGL from "./WebGL.svelte";
    // import Three from "./Three.svelte";
    import Fast2d from "../../components/Fast2d/Fast2d.svelte";
    import FastLine from "../../components/Fast2d/FastLine.svelte";

    import Router from "svelte-spa-router";
    import { push, location, replace } from "svelte-spa-router";

    // let webgl;

    let showHelpScreen = false;
    let allRoads = [];

    let fast2d;

    function resetGame() {
        frameCount = 0;
        $allTowns = [];
        $allTowns.push(new Town(0.2, 0.17, "ALPHABET TOWN", "/TinyQuest/alphabet1"));
        $allTowns.push(new Town(0.25, 0.27, "LOWER CASE CAVE", "/TinyQuest/alphabet1", { game: "lower" }));
        // $allTowns.push(new Town(0.12, 0.58, "ALPHABET MESS", "/TinyQuest/alphabet1"));
        // $allTowns.push(new Town(0.46, 0.18, "COUNTING CASTLE", "/TinyQuest/alphabet1"));
        // $allTowns.push(new Town(0.77, 0.24, "MONKEY COUNTING ISLAND", "/TinyQuest/alphabet1"));
        // $allTowns.push(new Town(0.23, 0.44, "SYLLABLE HILLS", "/TinyQuest/eggmatch"));
        $allTowns.push(new Town(0.62, 0.78, "BABY LETTERS", "/TinyQuest/eggmatch"));
        $allTowns.push(new Town(0.46, 0.14, "PIE AND CAKE", "/TinyQuest/numberpies"));
        $allTowns.push(new Town(0.45, 0.26, "SKYSCRAPER", "/TinyQuest/skyscraper"));
        $allTowns.push(new Town(0.42, 0.4, "HARBOR", "/TinyQuest/harbor"));
        $allTowns.push(new Town(0.8, 0.13, "MORSE CODE", "/TinyQuest/morsecode"));
        $allTowns.push(new Town(0.685, 0.5, "ROCKET LAUNCH", "/TinyQuest/rocketlaunch"));
        $allTowns.push(new Town(0.68, 0.68, "BUS STOP", "/TinyQuest/busstop"));
        $allTowns.push(new Town(0.48, 0.63, "MERMADD", "/TinyQuest/mathgrid", { game: "addition" }));
        $allTowns.push(new Town(0.4, 0.7, "MERMA-MULTIPLICAZZOOFLIZACKS", "/TinyQuest/mathgrid"));
        $allTowns.push(new Town(0.94, 0.62, "AIRPLANE CRASH", "/TinyQuest/airplanecrash"));
        $allTowns.push(new Town(0.94, 0.72, "READING", "/TinyQuest/reading1"));
        $allTowns.push(new Town(0.94, 0.82, "TONES", "/TinyQuest/listensounds"));
        $allTowns = $allTowns;
        allRoads = [];
        // allRoads.push(new Road("ALPHABET TOWN", "LOWER CASE CAVE", $allTowns));
        // allRoads.push(new Road("ALPHABET TOWN", "COUNTING CASTLE", $allTowns));
        $currentTownIndex = 0;
        $currentX = $allTowns[$currentTownIndex].x;
        $currentY = $allTowns[$currentTownIndex].y;
    }

    onMount(() => {
        return () => {
            if (frame) cancelAnimationFrame(frame);
        };
    });

    let frameCount = 0;
    let frame;
    function loop(msSinceStart) {
        frame = requestAnimationFrame(loop);
        frameCount += 1;

        if ($earnedStar && $currentTownIndex !== null && $allTowns[$currentTownIndex]) {
            if (!$allTowns[$currentTownIndex].activated) {
                console.log("EARNED", $currentTownIndex, $allTowns[$currentTownIndex].name);
                $allTowns[$currentTownIndex].activated = true;
                $earnedStar = false;
            } else {
                $earnedStar = false;
            }
        }
    }

    function moveTowns(i) {
        $currentTownIndex = i;
        $currentX = $allTowns[i].x;
        $currentY = $allTowns[i].y;
        $animInterp = Math.round($animInterp) + 1;
        $allTowns[i].unique++;
    }

    handleResize();
    if ($currentTownIndex === null) resetGame();
    loop(0);

    // Svelte computed properties / reactive declarations: https://svelte.dev/tutorial/reactive-declarations
    // This goes to 1 as the current position animates, and goes to 0 at the ends.
    // https://graphtoy.com/?f1(x,t)=floor(x)-x&v1=true&f2(x,t)=sqrt(0.5%5E2-(x-floor(x)-0.5)%5E2)*2.0&v2=true&f3(x,t)=&v3=false&f4(x,t)=&v4=false&f5(x,t)=&v5=false&f6(x,t)=&v6=false&grid=true&coords=0,0,12
    $: midway = Math.sqrt(0.5 * 0.5 - Math.pow($animInterp - Math.floor($animInterp) - 0.5, 2.0)) * 6.0;
</script>

<div class="fit-full-space select-none relative overflow-hidden" style="background-color:#104058">
    <div
        class="relative text-white font-bold"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px"
    >
        <img
            src="TinyQuest/otavio_a_video_game_map_of_islands_with_10_points_to_stop_and_p_286c6dc2-3915-43c4-a04e-68d7e6f90c29.webp"
            class="absolute top-0 left-0 w-full h-full"
            alt="world map"
            style=""
        />
        <!-- <div class="absolute bottom-4 left-4 text-white w-full text-4xl">{$earnedStar}<br/>{$currentTownIndex}<br/>{$allTowns[$currentTownIndex]}</div> -->
        {#each allRoads as r, i}
            <div
                class="absolute opacity-30"
                style="background-color:red; transform-origin: 0% 0%;transform: rotate({r.angle}rad) translate(-50%, -50%);width:{r.dist *
                    $bigScale}px;height:0.7rem;left:{r.midX * 100}%;top:{r.midY * 100}%;"
            />
        {/each}
        {#each $allTowns as t, i}
            {#key t.unique}
                <div
                    in:pulseShadow|local={{ duration: 800 }}
                    class="absolute rounded-full opacity-70 hover:opacity-100 cursor-pointer select-none box-content"
                    style="{$currentTownIndex === i
                        ? 'border:0.75rem solid #ffff00;background-color:#ff6050'
                        : 'border:0.5rem solid #ef00af;background-color:#e0208070'};transform-origin: 50% 50%;transform: translate(-50%, -50%) scale(1, .8);width:{0.05 *
                        $bigScale}px;height:{0.05 * $bigScale}px;left:{t.x * 100}%;top:{t.y * 100}%;"
                    on:pointerup|preventDefault|stopPropagation={() => moveTowns(i)}
                >
                    <!-- <i
                        class="absolute {t.activated ? 'fas fa-star text-yellow-200' : 'far fa-star text-yellow-800'} text-6xl"
                        style="top:0.4rem;left:0.4rem;"
                    /> -->
                </div>
            {/key}
            {#if t.activated}
                <div
                    class="absolute pointer-events-none"
                    style="transform-origin: 0% 0%;transform: translate(-50%, -50%);width:{0.05 * $bigScale}px;height:{0.05 *
                        $bigScale}px;left:{t.x * 100}%;top:{t.y * 100}%;"
                >
                    <i
                        in:scaleDown|local={{ duration: 4000 }}
                        class="absolute fas fa-star opacity-80 text-yellow-400 text-6xl"
                        style="top:0.4rem;left:0.4rem;"
                    />
                </div>
            {/if}
        {/each}
        <div
            in:fade|local={{ delay: 0, duration: 1200 }}
            out:fade|local={{ delay: 600, duration: 1200 }}
            class="absolute tXXext-center text-5xl bg-teal-500 p-4 text-black whitespace-nowrap"
            style="bottom:0rem;left:0rem;width:32.4rem;border-radius:0 0 2rem 0"
            on:pointerup|preventDefault|stopPropagation={() => push($allTowns[$currentTownIndex]?.path)}
        >
            {$allTowns[$currentTownIndex]?.name}
        </div>
        {#key $currentTownIndex}
            <div in:slide|local out:slide|local class="absolute left-1 bottom-[29.5rem] text-3xl text-teal-600 h-12">PUSH TO PLAY <i class="fa-solid fa-turn-down"></i></div>
            <img
                in:fade|local={{ delay: 0, duration: 1200 }}
                out:fade|local={{ delay: 600, duration: 1200 }}
                src="TinyQuest/images/screens/{$allTowns[$currentTownIndex]?.path.substring(
                    $allTowns[$currentTownIndex]?.path.lastIndexOf('/') + 1
                ) + ($allTowns[$currentTownIndex]?.options?.game || '')}.webp"
                class="absolute left-0 shadow-2xl"
                style="bottom:5rem;width:32.4rem;height:24.4rem;border:0px solid black;border-radius: 0 1.7rem 0 0"
                on:pointerup|preventDefault|stopPropagation={() => push($allTowns[$currentTownIndex]?.path)}
                alt="&nbsp;This is a work in progress game with no preview."
            />
        {/key}
        <div
            class="absolute pointer-events-none select-none rounded-full"
            style="background: radial-gradient(closest-side, #00145070, #9198e500);left:{$currentX * 100}%;top:{$currentY *
                100}%;width:{3 + midway * 6}rem;height:{3 +
                midway * 6}rem;transform-origin: 0% 0%;transform: translate(-50%, -50%);"
        />
        <div
            class="absolute pointer-events-none select-none"
            style="transform-origin: 0% 0%;transform: translate(-50%, -95%);left:{$currentX * 100}%;top:{$currentY * 100 -
                midway * 10 +
                3}%;width:{16 + midway * 6}rem;height:{16 + midway * 6}rem"
            on:pointerup|preventDefault|stopPropagation={() => null}
        >
            <!-- <IconsMisc icon="hot-air-balloon" size="{10 + midway * 6}rem" canvasSize={(10 + midway * 6) * 0.01 * $bigScale} /> -->
            <img
                src="TinyQuest/otavio_steampunk_hot_air_ballon_vector_art_macrovector_isometri_e6f5dac4-e1d6-469c-b85c-dd4fbf525d55.webp"
                class=""
                style="width:{16 + midway * 6}rem;height:{16 + midway * 6}rem"
                alt="world map"
            />
        </div>
        <!-- <button
            class="absolute bottom-16 text-white font-semibold text-8xl rounded-2big"
            style="padding: 1rem 1rem;left:36.5rem;background-color:#c0a880;border:0.4rem solid #704020;color:#704020"
            on:pointerup|preventDefault|stopPropagation={() => push($allTowns[$currentTownIndex]?.path)}>START</button
        > -->
    </div>
    <!-- <WebGL bind:this={webgl}></WebGL> -->
    <!-- <Three>WTF</Three>ABC -->
    {#if showHelpScreen}
        <div
            on:pointerup|preventDefault|stopPropagation={(e) => {
                if (e.target.localName !== "a") showHelpScreen = !showHelpScreen;
            }}
        >
            <HelpScreen />
        </div>
    {:else}
        <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-300 text-8xl" on:pointerup={pop}>
            <i class="fas fa-times-circle" />
        </div>
        <div
            class="text-gray-500 absolute top-2 left-2 m-2 text-5xl"
            on:pointerup|preventDefault|stopPropagation={() => (showHelpScreen = !showHelpScreen)}
        >
            <i class="fas fa-cog" />
        </div>
    {/if}
    <!-- {#if glIsSupported} -->
    <!-- <Fast2d bind:this={fast2d} id="graphRT">
        {#each Array(2400) as _, i}
            <FastLine
                x0={Math.sin(i * 0.1) * (40 + i * 0.1) + 650}
                y0={Math.cos(i * 0.1) * (40 + i * 0.1) + 450}
                x1={Math.sin(i * 0.1) * (40 + i * 0.1) + 650}
                y1={Math.cos(i * 0.1) * (40 + i * 0.1) + 450}
                diameter={6.0}
                color={[1, 0.6, 1]}
            />
        {/each}
    </Fast2d> -->
    <!-- {:else}
            WebGL not supported.
            {/if} -->
</div>

<style>
    img {
        font-size: 3rem;
        /* background-color:#00000080; */
    }
</style>
