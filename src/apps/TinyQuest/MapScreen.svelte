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
    import { pulseShadow, scaleDown } from "./Transitions";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    // import WebGL from "./WebGL.svelte";
    // import Three from "./Three.svelte";

    import Router from "svelte-spa-router";
    import { push, location, replace } from "svelte-spa-router";

    // let webgl;

    let showHelpScreen = false;
    let allRoads = [];

    function resetGame() {
        frameCount = 0;
        $allTowns = [];
        $allTowns.push(new Town(0.135, 0.16, "ALPHABET TOWN", "/TinyQuest/alphabet1"));
        $allTowns.push(new Town(0.17, 0.25, "LOWER CASE CAVE", "/TinyQuest/alphabet1", { game: "lower" }));
        // $allTowns.push(new Town(0.12, 0.58, "ALPHABET MESS", "/TinyQuest/alphabet1"));
        // $allTowns.push(new Town(0.46, 0.18, "COUNTING CASTLE", "/TinyQuest/alphabet1"));
        // $allTowns.push(new Town(0.77, 0.24, "MONKEY COUNTING ISLAND", "/TinyQuest/alphabet1"));
        // $allTowns.push(new Town(0.23, 0.44, "SYLLABLE HILLS", "/TinyQuest/eggmatch"));
        $allTowns.push(new Town(0.68, 0.44, "BABY LETTERS", "/TinyQuest/eggmatch"));
        $allTowns.push(new Town(0.46, 0.16, "PIE AND CAKE", "/TinyQuest/numberpies"));
        $allTowns.push(new Town(0.47, 0.26, "SKYSCRAPER", "/TinyQuest/skyscraper"));
        $allTowns.push(new Town(0.16, 0.52, "HARBOR", "/TinyQuest/harbor"));
        $allTowns.push(new Town(0.29, 0.75, "MORSE CODE", "/TinyQuest/morsecode"));
        $allTowns.push(new Town(0.66, 0.84, "ROCKET LAUNCH", "/TinyQuest/rocketlaunch"));
        // $allTowns.push(new Town(0.95, 0.89, "TONES", "/TinyQuest/listensounds"));
        $allTowns.push(new Town(0.85, 0.72, "READING", "/TinyQuest/reading1"));
        $allTowns.push(new Town(0.94, 0.88, "BUS STOP", "/TinyQuest/busstop"));
        $allTowns.push(new Town(0.14, 0.80, "MERMADD", "/TinyQuest/mathgrid", { game: "addition" }));
        $allTowns.push(new Town(0.14, 0.90, "MERMA-MULTIPLICAZZOOFLIZACKS", "/TinyQuest/mathgrid"));
        $allTowns.push(new Town(0.40, 0.68, "AIRPLANE CRASH", "/TinyQuest/airplanecrash"));
        // $allTowns.push(new Town(0.30, 0.30, "MUSIC PLAYER", "/TinyQuest/musicplayer"));
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
    $: midway = Math.sqrt(0.5 * 0.5 - Math.pow($animInterp - Math.floor($animInterp) - 0.5, 2.0)) * 2.0;
</script>

<div class="fit-full-space select-none relative overflow-hidden" style="background-color:#486870">
    <div class="relative text-white font-bold" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        <img src="TinyQuest/firstmap.jpg" class="absolute top-0 left-0 w-full h-full" alt="world map" style="" />
        <div class="absolute top-6 text-center w-full text-5xl" style="left:-2.5rem;color:#704020">{$allTowns[$currentTownIndex]?.name}</div>
        <!-- <div class="absolute bottom-4 left-4 text-white w-full text-4xl">{$earnedStar}<br/>{$currentTownIndex}<br/>{$allTowns[$currentTownIndex]}</div> -->
        {#each allRoads as r, i}
            <div
                class="absolute opacity-30"
                style="background-color:red; transform-origin: 0% 0%;transform: rotate({r.angle}rad) translate(-50%, -50%);width:{r.dist * $bigScale}px;height:0.7rem;left:{r.midX * 100}%;top:{r.midY *
                    100}%;"
            />
        {/each}
        {#each $allTowns as t, i}
            {#key t.unique}
                <div
                    in:pulseShadow={{ duration: 800 }}
                    class="absolute rounded-full opacity-50 hover:opacity-90 cursor-pointer select-none box-content"
                    style="{$currentTownIndex === i
                        ? 'border:0.75rem solid #e0a040;background-color:#ff6050'
                        : 'border:0.25rem solid #ffcf40;background-color:#e0202080'};transform-origin: 0% 0%;transform: translate(-50%, -50%);width:{0.05 * $bigScale}px;height:{0.05 *
                        $bigScale}px;left:{t.x * 100}%;top:{t.y * 100}%;"
                    on:pointerup|preventDefault|stopPropagation={() => moveTowns(i)}
                >
                    <i class="absolute {t.activated ? 'fas fa-star text-yellow-200' : 'far fa-star text-yellow-800'} text-6xl" style="top:0.4rem;left:0.4rem;" />
                </div>
            {/key}
            {#if t.activated}
                <div
                    class="absolute pointer-events-none"
                    style="transform-origin: 0% 0%;transform: translate(-50%, -50%);width:{0.05 * $bigScale}px;height:{0.05 * $bigScale}px;left:{t.x * 100}%;top:{t.y * 100}%;"
                >
                    <i in:scaleDown={{ duration: 4000 }} class="absolute fas fa-star opacity-40 text-yellow-400 text-6xl" style="top:0.4rem;left:0.4rem;" />
                </div>
            {/if}
        {/each}
        {#key $currentTownIndex}
        <div in:fade|local={{delay:600}} out:fade|local class="absolute right-0 shadow-2xl" style="top:0rem;width:32.4rem;height:24.4rem;border:4px solid black;" on:pointerup|preventDefault|stopPropagation={() => push($allTowns[$currentTownIndex]?.path)}>
            <img src="TinyQuest/images/screens/{$allTowns[$currentTownIndex]?.path.substring($allTowns[$currentTownIndex]?.path.lastIndexOf('/') + 1) + ($allTowns[$currentTownIndex]?.options?.game || "")}.webp" alt="&nbsp;This is a work in progress game with no preview."/>
        </div>
        {/key}
        <div
            class="absolute pointer-events-none select-none rounded-full"
            style="background: radial-gradient(closest-side, #00145070, #9198e500);left:{$currentX * 100}%;top:{$currentY * 100}%;width:{3 + midway * 4}rem;height:{3 +
                midway * 4}rem;transform-origin: 0% 0%;transform: translate(-50%, -50%);"
        />
        <div
            class="absolute pointer-events-none select-none"
            style="transform-origin: 0% 0%;transform: translate(-50%, -95%);left:{$currentX * 100}%;top:{$currentY * 100 - midway * 10}%;"
            on:pointerup|preventDefault|stopPropagation={() => null}
        >
            <IconsMisc icon="hot-air-balloon" size="{10 + midway * 4}rem" canvasSize={(10 + midway * 4) * 0.01 * $bigScale} />
        </div>
        <button
            class="absolute bottom-16 text-white font-semibold text-8xl rounded-2big"
            style="padding: 1rem 1rem;left:36.5rem;background-color:#c0a880;border:0.4rem solid #704020;color:#704020"
            on:pointerup|preventDefault|stopPropagation={() => push($allTowns[$currentTownIndex]?.path)}>START</button
        >
    </div>
    <!-- <WebGL bind:this={webgl}></WebGL> -->
    <!-- <Three>WTF</Three>ABC -->
    {#if showHelpScreen}
        <div on:pointerup|preventDefault|stopPropagation={(e) => {if (e.target.localName !== 'a') showHelpScreen = !showHelpScreen}}>
            <HelpScreen></HelpScreen>
        </div>
    {:else}
        <div class="absolute top-2 left-2 cursor-pointer select-none rounded-full text-gray-300 text-8xl" on:pointerup={pop}><i class="fas fa-times-circle"></i></div>
        <div class="text-gray-400 absolute bottom-2 left-2 m-2 text-5xl" on:pointerup|preventDefault|stopPropagation={() => showHelpScreen = !showHelpScreen}>
            <i class="fas fa-cog"></i>
        </div>
    {/if}
</div>

<style>
    img {
        font-size:3rem;
        background-color:#00000080;
    }
</style>
