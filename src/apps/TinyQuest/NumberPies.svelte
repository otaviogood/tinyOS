<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import PieSprites from "./PieSprites.svelte";
    import IconsMisc from "./IconsMisc.svelte";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "../../router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { spin } from "./Transitions";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { pulseShadow, scaleDown, scalePulse } from "./Transitions";
    import { speechPlay } from "../../utils";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    const maxStars = 2; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    let currentNumbers;
    let clearedNumbers;
    let maxNumbers = 9;
    let clickSequence = 0;

    const slices = [
        ["pumpkin-pie", "pie-1", "pie-2"],
        ["chocolate", "cake-1", "cake-2"],
    ];

    function genPos() {
        // Spawn eggs in random position
        let sx = 0.71;
        let sy = 0.55;
        let ox = 0.02;
        let oy = 0.02;
        let x = Math.random() * sx + ox;
        let y = Math.random() * sy + oy;
        // Make sure they don't overlap.
        for (let reps = 0; reps < 100; reps++) {
            let collision = false;
            while ((x < 0.2 && y < 0.2) || (x < 0.2 && y > 0.4)) {
                // Save space for a pie in the upper left and a kid in the lower left.
                collision = true;
                x = Math.random() * sx + ox;
                y = Math.random() * sy + oy;
            }
            for (let i = 0; i < currentNumbers.length; i++) {
                let dx = x - currentNumbers[i].x0;
                let dy = y - currentNumbers[i].y0;
                if (Math.sqrt(dx * dx + dy * dy) < 0.16) {
                    collision = true;
                    x = Math.random() * sx + ox;
                    y = Math.random() * sy + oy;
                }
            }
            if (!collision) break;
        }
        return [x, y];
    }

    function randomizeNumbers() {
        clickSequence = 0;
        currentNumbers = [];
        clearedNumbers = [];
        for (let i = 0; i < maxNumbers; i++) {
            let xy = genPos();
            currentNumbers.push({ number: i + 1, x0: xy[0], y0: xy[1], doneAnim: 0.0 });
            clearedNumbers.push(false);
        }
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
                    currentNumbers[i].x0 *= 0.9;
                    currentNumbers[i].y0 = currentNumbers[i].y0 * 0.9 + 0.6 * 0.1;
                }
            }
        }
    }

    async function clickedNumber(index, l) {
        if (clickSequence === l.number - 1) {
            speechPlay(l.number.toString());
            clearedNumbers[clickSequence] = true;
            currentNumbers[clickSequence].doneAnim = 0.01;
            clickSequence++;
            snd_good.play();
            if (clickSequence === maxNumbers) {
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
            snd_error.play();
        }
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;
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

<div class="fit-full-space select-none overflow-hidden" style="background-color:#f4dac4" on:touchstart={preventZoom}>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <img src="TinyQuest/gamedata/numberpies/wood.webp" class="fit-full-space" alt="wood background" style="" />
                <div class="absolute top-0 left-0 w-full h-full" style="background-color:#fff0e0b0" ></div>
                {#each Array(3) as _, i}
                    <PieSprites icon={slices[0][i]} size="12rem" style="position:absolute;left:{Math.cos((i+frameCount*0.01) * Math.PI / 3.0) * 40 + 44}rem;top:{Math.sin((i+frameCount*0.01) * Math.PI / 3.0) * 30 + 30}rem" />
                    <PieSprites icon={slices[1][i]} size="12rem" style="position:absolute;left:{Math.cos((i+frameCount*0.01+3) * Math.PI / 3.0) * 40 + 44}rem;top:{Math.sin((i+frameCount*0.01+3) * Math.PI / 3.0) * 30 + 30}rem" />
                {/each}
                <div class="text-9xl font-bold m-8 z-10">{town?.name}</div>
                <button class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <img src="TinyQuest/gamedata/numberpies/wood.webp" class="absolute top-0 left-0 w-full h-full" alt="wood background" style="" />
                <div class="absolute top-0 left-0 w-full h-full" style="background-color:#fff0e0b0" ></div>
                <div id="playBoard" class="h-full w-full font-bold relative">
                    <div class="absolute top-0 left-0" style="width:19rem;height:19rem;background-color:#e0c0b0; border-radius:0 0 4rem 4rem" />
                    {#if clickSequence < maxNumbers}
                        <div class="absolute bottom-0 left-0" style="width:16rem;height:17rem;background-color:#e0c0f0; border-radius:4rem 4rem 0 0" />
                    {/if}
                    {#if currentNumbers}
                        {#each currentNumbers as l, i}
                            {#if !clearedNumbers[i]}
                                <div
                                    class="absolute text-4xl flex-center-all rounded-full active:scale-105 transform transition-all duration-75"
                                    style="width:14rem;height:14rem;left:{l.x0 * 100}rem;top:{l.y0 * 100}rem;font-size:8rem;color:#202020;line-height:3rem;background-color:{stage === 0
                                        ? '#f0a040'
                                        : '#c08060'};"
                                    on:pointerup|preventDefault|stopPropagation={() => clickedNumber(i, l)}
                                >
                                    {l.number}
                                </div>
                            {:else if l.doneAnim < 0.4}
                                <div
                                    in:scalePulse={{ delay: 0, duration: 200 }}
                                    class="absolute text-4xl flex-center-all rounded-full active:scale-105 transform transition-all duration-75 z-10"
                                    style="width:14rem;height:14rem;left:{l.x0 * 100}rem;top:{l.y0 * 100}rem;font-size:8rem;color:#202020;line-height:3rem;pointer-events:none"
                                >
                                    <PieSprites icon={slices[stage][i % 3]} size="12rem" style="" />
                                </div>
                            {/if}
                        {/each}
                    {/if}
                    {#key clickSequence}
                        <div in:scalePulse={{ delay: 500, duration: 400 }} class="absolute top-6 left-6" style="width:16rem;height:16rem;">
                            {#if stage === 0}
                                <PieSprites icon="pie" size="16rem" class="absolute top-0 left-0" />
                            {:else}
                                <img src="TinyQuest/gamedata/numberpies/cake.webp" alt="cake" style="width:16rem;height:16rem;" class="absolute top-0 left-0" />
                            {/if}
                            <div class="absolute top-0 left-0">
                                <!-- https://sparkbox.com/foundry/how_to_code_an_SVG_pie_chart -->
                                <svg height="16rem" width="16rem" viewBox="0 0 20 20">
                                    <!-- <circle r="10" cx="10" cy="10" fill="white" /> -->
                                    <circle
                                        r="5"
                                        cx="10"
                                        cy="10"
                                        fill="transparent"
                                        stroke="#e0c0b0f0"
                                        stroke-width="10"
                                        stroke-dasharray="{(clickSequence * 31.4159) / maxNumbers} 31.4159"
                                        transform="rotate(-90) translate(-20)"
                                    />
                                </svg>
                            </div>
                        </div>
                    {/key}
                    {#if clickSequence < maxNumbers}
                        {#key clickSequence}
                            <div in:slide={{ delay: clickSequence === 0 ? 0 : 700 }} out:slide={{ delay: 600 }} class="absolute bottom-4 left-4 pointer-events-none z-20">
                                <PieSprites icon={["boy", "girl", "boy-1", "boy-2", "girl-2", "boy-3", "girl-3", "boy-4", "girl-4", "boy-5", "girl-5"][clickSequence]} size="14rem" style="" />
                            </div>
                        {/key}
                    {/if}
                </div>
                <StarBar {maxStars} {starCount} bg="#ffffff" on:pointerup={resetToSplashScreen} />
                <WinScreen {maxStars} active={finalGraphic} on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;z-index:100;background-color:#00000080" />
            </div>
        {/if}
    </div>
</div>

<style>
</style>
