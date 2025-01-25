<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "../../router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "./util";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../../animator";
    import ShapeMatrix from "../../components/ShapeMatrix.svelte";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    const maxStars = 6; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    let currentShapes = [];
    let pickShape = {};
    let maxShapes = 10;
    let vehicle = "CarBlue";

    function genPos() {
        // Spawn eggs in random position
        let sx = 0.43;
        let sy = 0.55;
        let ox = 0.3;
        let oy = 0.02;
        let x = Math.random() * sx + ox;
        let y = Math.random() * sy + oy;
        // Make sure they don't overlap.
        for (let reps = 0; reps < 100; reps++) {
            let collision = false;
            for (let i = 0; i < currentShapes.length; i++) {
                let dx = x - currentShapes[i].x0;
                let dy = y - currentShapes[i].y0;
                if (Math.sqrt(dx * dx + dy * dy) < 0.13) {
                    collision = true;
                    x = Math.random() * sx + ox;
                    y = Math.random() * sy + oy;
                }
            }
            if (!collision) break;
        }
        return [x, y];
    }

    function randomizeShapes() {
        let allValid = [];
        for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) allValid.push([i, j, k]);
        shuffleArray(allValid);

        currentShapes = [];
        for (let i = 0; i < maxShapes; i++) {
            let xy = genPos();
            currentShapes.push({ a: allValid[i][0], b: allValid[i][1], c: allValid[i][2], x0: xy[0], y0: xy[1], doneAnim: 0.0 });
        }
        pickShape = currentShapes[0];
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    function tick() {}

    function resetGameVars() {
        globalAlpha = 1.0;
        carAnim = 0.0;
        carSpeed = 1.0 / 400;
        insideClick = false;
        showShapes = 1.0;
        randomizeShapes();
        let s = pickShape;
        if (s.a === 0 && s.b === 0) vehicle = "CarGreen";
        else if (s.a === 0 && s.b === 1) vehicle = "CarBlue";
        else if (s.a === 0 && s.b === 2) vehicle = "CarRed";
        else if (s.a === 1 && s.b === 0) vehicle = "BusGreen";
        else if (s.a === 1 && s.b === 1) vehicle = "BusBlue";
        else if (s.a === 1 && s.b === 2) vehicle = "BusRed";
        else if (s.a === 2 && s.b === 0) vehicle = "BikeGreen";
        else if (s.a === 2 && s.b === 1) vehicle = "BikeBlue";
        else if (s.a === 2 && s.b === 2) vehicle = "BikeRed";
    }

    let globalAlpha = 1.0;
    let carAnim = 0.0;

    let vsizes = {
        CarGreen: 512,
        CarBlue: 512,
        CarRed: 512,
        BusGreen: 1024,
        BusBlue: 1280,
        BusRed: 1280,
        BikeGreen: 256,
        BikeBlue: 256,
        BikeRed: 160,
    };

    let insideClick = false;
    let carSpeed = 1.0 / 400;
    let showShapes = 1.0;
    async function clickedShape(i, s) {
        if (insideClick) {
            carSpeed *= 2;
            return;
        }
        insideClick = true;
        if (s === pickShape) {
            currentShapes[i].doneAnim = 0.01;
            snd_good.play();
            starCount++;
            showShapes = 0.0;
            for (let i = 0; i < 60; i++) {
                s.doneAnim += 0.01;
                globalAlpha *= 0.95;
                currentShapes = currentShapes;
                await sleep(16);
            }
            globalAlpha = 0;
            for (let i = 0; i < 400; i++) {
                carAnim += carSpeed;
                if (carAnim >= 1.0) break;
                await sleep(16);
            }
            if (starCount >= maxStars) {
                // Finished game. Yay!
                await sleep(500);
                finalGraphic = true;
                snd_fanfare.play();
                $earnedStar = true;
                insideClick = false;
                return;
            } else {
                for (let i = 0; i < 60; i++) {
                    globalAlpha += 1.0 / 60;
                    await sleep(16);
                }
                showShapes = 1.0;
                resetGameVars();
            }
        } else {
            snd_error.play();
        }
        insideClick = false;
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;

        animator.start();
        resetGameVars();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    handleResize();
    // startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)">
        {#if !started}
            <div class="flex-center-all h-full w-full flex flex-col bg-black">
                <img src="TinyQuest/gamedata/busstop/intro.webp" class="absolute top-0" alt="skyscraper" style="height:64rem" />
                <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <div class="fit-full-space" style="">
                    <img src="TinyQuest/gamedata/busstop/background.png" class="absolute top-0 left-0 w-full h-full" alt="bus stop background" style="" />

                    <div class="absolute" style="left:-50rem;right:-50rem;top:0rem;bottom:0rem">
                        <img
                            src="TinyQuest/gamedata/busstop/{vehicle}.png"
                            class="absolute"
                            alt="car"
                            style="width:{vsizes[vehicle] / 8.0}rem;left:{carAnim * (vsizes[vehicle] / 8 + 100) - vsizes[vehicle] / 8.0 + 50}rem;bottom:2rem;"
                        />
                    </div>
                    <!-- <div class="bg-red-600 absolute bottom-4" style="width:4rem;height:4rem;left:16rem;transform: translate({Math.sin(animateCount*0.1)*16}rem, 0rem);"></div> -->
                </div>
                <div
                    class="absolute"
                    style="top:{31 - globalAlpha * 30}rem;bottom:{32 - globalAlpha * 31}rem;left:{28 * globalAlpha + (1.0 - globalAlpha) * 67}rem;right:{12 * globalAlpha +
                        (1.0 - globalAlpha) * 22}rem;background-color:#ffffffd0;border-radius:2rem;opacity:{globalAlpha}"
                />
                <div class="absolute" style="top:20rem;left:12.6rem;"><ShapeMatrix a={pickShape.a} b={pickShape.b} c={pickShape.c} size={12} outlineColor="#4068a0" /></div>

                {#each currentShapes as s, i}
                    <div
                        class="absolute rounded-full"
                        style="left:{s.x0 * 100 + Math.sin(s.doneAnim * 32) * 2}rem;top:{s.y0 * 100 + Math.cos(s.doneAnim * 32) * 2}rem;opacity:{s.doneAnim > 0.0 ? 1.0 : showShapes}"
                        on:pointerup|preventDefault|stopPropagation={() => clickedShape(i, s)}
                    >
                        <ShapeMatrix a={s.a} b={s.b} c={s.c} size={11} outlineColor="#808080" rotate={((((s.a + s.b * 3 + s.c * 9) * 12345.6789) | 0) % 4) * 90} />
                    </div>
                {/each}

                <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div>
                <WinScreen {maxStars} active={finalGraphic} bg="#00000010" on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;top:10rem;z-index:100;" />
            </div>
        {/if}
    </div>
</div>

<style>
</style>
