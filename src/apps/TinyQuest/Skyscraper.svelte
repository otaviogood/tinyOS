<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import SkyscraperSprites from "./SkyscraperSprites.svelte";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "../../router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { spin } from "./Transitions";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { pulseShadow, scaleDown, scalePulse } from "./Transitions";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { speechPlay } from "../../utils";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_break = new Howl({ src: ["/TinyQuest/sfx/sfx_exp_various3.wav"], volume: 0.25 });
    /*!speech
        ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30"]
    */

    const scrollY = tweened(0.0, { duration: 2000, easing: cubicInOut });
    const scaleAnim = tweened(1.0, { duration: 2000, easing: cubicInOut });

    const maxStars = 1; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    let currentNumbers;
    let clearedNumbers;
    let maxNumbers = 7;
    const winNumber = 30; // 30
    let clickSequence = 0;
    let craneAnim = 0.0;
    let explodeY = 0.0;
    let explodeAnim = 0.0;

    const buildingSegmentSize = 6;

    function genPos() {
        // Spawn eggs in random position
        let sx = 0.71;
        let sy = 0.55;
        let ox = 0.02;
        let oy = 0.02;
        let x = Math.random() * sx + ox;
        let y = Math.random() * sy + oy;
        // Make sure they don't overlap.
        for (let reps = 0; reps < 200; reps++) {
            let collision = false;
            while (x < 0.38) {
                // Save space for a pie in the upper left and a kid in the lower left.
                collision = true;
                x = Math.random() * sx + ox;
                y = Math.random() * sy + oy;
            }
            for (let i = clickSequence; i < currentNumbers.length; i++) {
                let dx = x - currentNumbers[i].x0;
                let dy = y - currentNumbers[i].y0;
                if (Math.sqrt(dx * dx + dy * dy) < 0.15) {
                    collision = true;
                    x = Math.random() * sx + ox;
                    y = Math.random() * sy + oy;
                }
            }
            if (!collision) break;
        }
        return [x, y];
    }

    function makeNewNumber() {
        let xy = genPos();
        currentNumbers.push({ number: currentNumbers.length + 1, x0: xy[0], y0: xy[1], doneAnim: 0.0 });
        clearedNumbers.push(false);
    }

    function randomizeNumbers() {
        clickSequence = 0;
        currentNumbers = [];
        clearedNumbers = [];
        for (let i = 0; i < maxNumbers; i++) makeNewNumber();
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
        };
    });

    let frameCount = 0;
    let frame;
    function loop(msSinceStart) {
        frame = requestAnimationFrame(loop);
        frameCount += 1;
        // randomizeNumbers();
        if (currentNumbers) {
            for (let i = 0; i < maxNumbers; i++) {
                if (currentNumbers[i].doneAnim > 0.0 && currentNumbers[i].doneAnim < 1.0) {
                    currentNumbers[i].doneAnim += 0.01;
                    currentNumbers[i].doneAnim = Math.min(currentNumbers[i].doneAnim, 1.0);
                    currentNumbers[i] = currentNumbers[i];
                }
            }
        }
        if (craneAnim > 0.0 && craneAnim < 1.0) {
            craneAnim += 0.01;
            craneAnim = Math.min(craneAnim, 1.0);
        }
        if (explodeAnim > 0.0 && explodeAnim < 1.0) {
            explodeAnim += 0.02;
            explodeAnim = Math.min(explodeAnim, 1.0);
        }
    }

    async function clickedNumber(index, l) {
        if (clickSequence === l.number - 1) {
            speechPlay(l.number.toString());
            clearedNumbers[clickSequence] = true;
            currentNumbers[clickSequence].doneAnim = 0.01;
            clickSequence++;
            craneAnim = 0.01;
            if (maxNumbers < winNumber) {
                maxNumbers++;
                makeNewNumber();
            }
            if (clickSequence > 4) {
                let seq = clickSequence - 4;
                $scrollY = seq * buildingSegmentSize;
                if ($scaleAnim > 0.5) $scaleAnim = 1.0 - seq * 0.08;
                if ($scaleAnim < 0.5) $scaleAnim = 0.5;
            }
            snd_good.play();
            if (clickSequence === winNumber) {
                starCount++;
                // snd_good.play();
                if (starCount >= maxStars) {
                    // Finished game. Yay!
                    await sleep(2000);
                    finalGraphic = true;
                    snd_fanfare.play();
                    $earnedStar = true;
                    return;
                } else {
                    await sleep(2000);
                    randomizeNumbers();
                    stage++;
                }
            }
        } else {
            snd_break.play();
            if (clickSequence > 0) {
                clickSequence--;
                clearedNumbers[clickSequence] = false;
                currentNumbers.pop();
                clearedNumbers.pop();
                maxNumbers--;
                explodeY = clickSequence * buildingSegmentSize;
                explodeAnim = 0.01;
            }

        }
    }

    function driveOut(node, { delay, duration }) {
        return {
            delay,
            duration,
            css: (t) => {
                return `left: ${26 + (1.0 - t) * 80}rem;transform: scaleX(1);`;
            },
        };
    }

    function driveAcross(node, { delay, duration, a = 90, b = -50 }) {
        return {
            delay,
            duration,
            css: (t) => {
                return `left: ${t * b + (1.0 - t) * a}rem;`;
            },
        };
    }

    $: craneY = clickSequence ? Math.max(0, clickSequence - 2) * 6 + 40 - (currentNumbers[clickSequence - 1]?.doneAnim || 0) * (26 + (clickSequence === 1 ? 6 : 0)) : 0;

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;
        maxNumbers = 7;
        clickSequence = 0;
        craneAnim = 0.0;
        scrollY.set(0.0, { duration: 0 });
        scaleAnim.set(1.0, { duration: 0 });
        randomizeNumbers();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    handleResize();
    loop();
    // startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <!-- <div style="color:white">                        {clickSequence === 1}</div> -->
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full w-full flex flex-col bg-black">
                <img src="TinyQuest/gamedata/skyscraper/skyscraper_splash.webp" class="absolute" alt="skyscraper" style="height:72rem" />
                <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <div class="fit-full-space" style="transform: scale({$scaleAnim}) translate(0rem, {$scrollY}rem)">
                    <div class="absolute" style="left:-50rem;right:-50rem;top:0rem;bottom:-2rem">
                        <img src="TinyQuest/gamedata/skyscraper/scene.jpg" class="absolute" alt="" style="bottom:0px;" />
                    </div>
                    <div class="absolute" style="left:-50rem;right:-50rem;bottom:170rem;height:4000rem;background-image: url('TinyQuest/gamedata/skyscraper/star_field.webp');" />
                    <img src="TinyQuest/gamedata/skyscraper/foundation.png" class="absolute left-12" alt="" style="height:{buildingSegmentSize}rem;bottom:8rem" />

                    {#if clickSequence >= 20}
                        <div class="absolute" style="bottom:215rem;left:78rem;">
                            <SkyscraperSprites icon="full-moon" size="48rem" />
                        </div>
                    {/if}

                    {#if clickSequence >= 6}
                        <div in:driveAcross={{ delay: 0, duration: 25000, a: 110, b: -62 }} class="absolute" style="bottom:60rem;left:-62rem">
                            <SkyscraperSprites icon="hot-air-balloon" size="12rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 8}
                        <div in:driveAcross={{ delay: 0, duration: 10000, a: -30, b: 150 }} class="absolute" style="bottom:95rem;left:150rem">
                            <SkyscraperSprites icon="airplane" size="12rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 12}
                        <div in:driveAcross={{ delay: 0, duration: 6000, a: -82, b: 150 }} class="absolute" style="bottom:130rem;left:150rem">
                            <SkyscraperSprites icon="plane" size="32rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 17}
                        <div in:driveAcross={{ delay: 0, duration: 40000, a: -62, b: 150 }} class="absolute" style="bottom:175rem;left:150rem;transform: rotate({-frameCount * 0.5}deg);">
                            <SkyscraperSprites icon="satellite" size="12rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 19}
                        <div in:driveAcross={{ delay: 0, duration: 42000, a: -82, b: 150 }} class="absolute" style="bottom:190rem;left:150rem;transform: rotate({-frameCount * 0.25}deg);">
                            <SkyscraperSprites icon="space-station" size="32rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 23}
                        <div in:driveAcross={{ delay: 0, duration: 44000, a: -72, b: 150 }} class="absolute" style="bottom:210rem;left:150rem;transform: rotate({frameCount * 0.25}deg);">
                            <SkyscraperSprites icon="space-shuttle" size="22rem" />
                        </div>
                    {/if}

                    <div class="absolute -left-24 overflow-hidden border-red-400" style="width:100%; height:48rem;margin-bottom:9rem;bottom:{Math.max(0, clickSequence - 2) * 6}rem">
                        <img src="TinyQuest/gamedata/skyscraper/tower_crane.png" class="absolute" alt="" style="height:60rem;" />
                    </div>
                    {#key clickSequence}
                        {#if currentNumbers[clickSequence - 1]?.doneAnim < 1.0}
                            <img src="TinyQuest/gamedata/skyscraper/{clickSequence === 1 ? 'base' : 'mid'}.png" class="absolute left-12" alt="" style="height:{buildingSegmentSize}rem;bottom:{craneY}rem" />
                            <div
                                class="absolute"
                                style="background-color:#888888;width:0.5rem;height:{(currentNumbers[clickSequence - 1]?.doneAnim || 0) * (26 + (clickSequence === 1 ? 6 : 0)) +
                                    8}rem;left:15rem;bottom:{craneY}rem"
                            />
                            <div
                                class="absolute"
                                style="background-color:#888888;width:0.5rem;height:{(currentNumbers[clickSequence - 1]?.doneAnim || 0) * (26 + (clickSequence === 1 ? 6 : 0)) +
                                    8}rem;left:18.3rem;bottom:{craneY}rem"
                            />
                        {/if}
                    {/key}

                    {#if clickSequence > 0}
                        {#if currentNumbers[0]?.doneAnim > 0.99}
                            <img src="TinyQuest/gamedata/skyscraper/base.png" class="absolute left-12" alt="" style="height:{buildingSegmentSize}rem;bottom:8rem" />
                            <div class="absolute text-4xl text-white" style="left:1rem;bottom:{3.8 + 1 * buildingSegmentSize}rem">{1}</div>
                        {/if}
                        {#each Array(clickSequence - 1) as _, i}
                            {#if currentNumbers[i + 1]?.doneAnim > 0.99}
                                <img src="TinyQuest/gamedata/skyscraper/mid.png" class="absolute left-12" alt="" style="height:{buildingSegmentSize}rem;bottom:{8 + (i + 1) * buildingSegmentSize}rem" />
                                <div class="absolute text-4xl text-white" style="left:1rem;bottom:{3.8 + (i + 2) * buildingSegmentSize}rem">{i + 2}</div>
                            {/if}
                        {/each}
                        {#if currentNumbers[clickSequence - 1]?.doneAnim > 0.99}
                            <img src="TinyQuest/gamedata/skyscraper/top.png" class="absolute left-12" alt="" style="height:{buildingSegmentSize}rem;bottom:{8 + clickSequence * buildingSegmentSize}rem" />
                        {/if}
                    {/if}

                    {#if explodeAnim > 0.0 && explodeAnim < 1.0}
                        <div class="absolute left-20 bg-gray-200" style="border-radius:100%;transform:scale({Math.sqrt(explodeAnim)*3}); opacity:{1.0-Math.sqrt(explodeAnim)};width:18rem;height:8rem;bottom:{8 + clickSequence * buildingSegmentSize}rem" ></div>
                        <div class="absolute left-56 bg-gray-200" style="border-radius:100%;transform:scale({Math.sqrt(explodeAnim)*3}); opacity:{1.0-Math.sqrt(explodeAnim)};width:18rem;height:8rem;bottom:{8 + clickSequence * buildingSegmentSize}rem" ></div>
                        <div class="absolute left-12 bg-gray-200" style="border-radius:100%;transform:scale({Math.sqrt(explodeAnim)*3}); opacity:{1.0-Math.sqrt(explodeAnim)};width:18rem;height:6rem;bottom:{6 + clickSequence * buildingSegmentSize}rem" ></div>
                    {/if}

                    {#if clickSequence === 0}
                        <div out:driveOut={{ delay: 0, duration: 7000 }} class="absolute" style="bottom:9rem;left:26rem;transform: scaleX(-1);">
                            <SkyscraperSprites icon="excavator" size="12rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 2}
                        <div in:driveAcross={{ delay: 0, duration: 8000, b: -13 }} class="absolute" style="bottom:2rem;left:-13rem;">
                            <SkyscraperSprites icon="bulldozer" size="12rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 3}
                        <div in:driveAcross={{ delay: 0, duration: 7000, b: 10 }} class="absolute" style="bottom:0rem;left:10rem;transform: scaleX(-1);">
                            <SkyscraperSprites icon="truck" size="12rem" />
                        </div>
                    {/if}
                    {#if clickSequence >= 4}
                        <div in:driveAcross={{ delay: 0, duration: 9000, b: 30 }} class="absolute" style="bottom:1rem;left:30rem;">
                            <SkyscraperSprites icon="truck-2" size="12rem" />
                        </div>
                    {/if}
                </div>

                <div id="playBoard" class="h-full w-full font-bold relative">
                    {#if currentNumbers}
                        {#each currentNumbers as l, i}
                            {#if !clearedNumbers[i]}
                                <div
                                    class="absolute text-4xl flex-center-all active:scale-105 transform transition-all duration-75"
                                    style="width:10rem;height:10rem;left:{l.x0 * 100}rem;top:{l.y0 * 100}rem;font-size:8rem;color:white;line-height:3rem;background-color:{stage === 0
                                        ? '#c08060'
                                        : '#c08060'};"
                                    on:pointerup|preventDefault|stopPropagation={() => clickedNumber(i, l)}
                                >
                                    {l.number}
                                </div>
                            {/if}
                        {/each}
                    {/if}
                </div>
                <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div>
                <WinScreen {maxStars} active={finalGraphic} bg="#00000000" on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;top:10rem;z-index:100;" />
            </div>
        {/if}
    </div>
</div>

<svelte:head>
    <style>
        body {
            background-image: url("TinyQuest/gamedata/skyscraper/star_field.webp");
            /* background-color: #cccccc; */
        }
    </style>
</svelte:head>

<style>
</style>
