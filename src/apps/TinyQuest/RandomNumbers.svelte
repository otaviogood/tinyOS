<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    // import PieSprites from "./PieSprites.svelte";
    import IconsMisc from "./IconsMisc.svelte";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "svelte-spa-router";
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

    const maxStars = 6;
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;

    let numberOptions;
    let clickedNumbers = [];
    let correctOrder = [];
    let numOptions = 3; // Increased by 1 to include the target number
    let difficulty = 1; // Number of digits in the numbers
    let gameStartTimer = 0;
    let gameCurrentTimer = 0;

    function genPos() {
        let sx = 0.71;
        let sy = 0.55;
        let ox = 0.02;
        let oy = 0.02;
        let x = Math.random() * sx + ox;
        let y = Math.random() * sy + oy;
        
        for (let reps = 0; reps < 100; reps++) {
            let collision = false;
            if ((x < 0.2 && y < 0.2) || (x < 0.2 && y > 0.4) || (Math.abs(x - 0.5) < 0.2 && Math.abs(y - 0.5) < 0.2)) {
                collision = true;
                x = Math.random() * sx + ox;
                y = Math.random() * sy + oy;
            }
            for (let i = 0; i < numberOptions?.length || 0; i++) {
                let dx = x - numberOptions[i].x;
                let dy = y - numberOptions[i].y;
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

    function generateNumbers() {
        if (numOptions === 3) {
            // get time for start of gameStartTimer
            gameStartTimer = Date.now();
            gameCurrentTimer = gameStartTimer;
        }
        numberOptions = [];
        let targetNumber = getRandomInt(Math.pow(10, difficulty) - 1);
        let [x, y] = [.36, .3];
        numberOptions.push({ number: targetNumber, x, y, clicked: false, isTarget: true });

        for (let i = 1; i < numOptions; i++) {
            let num = getRandomInt(Math.pow(10, difficulty) - 1);
            let [x, y] = genPos();
            numberOptions.push({ number: num, x, y, clicked: false, isTarget: false });
        }
        correctOrder = [...numberOptions]
            .filter(option => !option.isTarget)
            .sort((a, b) => Math.abs(a.number - targetNumber) - Math.abs(b.number - targetNumber))
            .map(option => option.number);
        clickedNumbers = [];
    }

    async function clickNumber(clickedNumber) {
        if (clickedNumber.isTarget || clickedNumbers.includes(clickedNumber.number)) return;

        if (clickedNumber.number === correctOrder[clickedNumbers.length]) {
            snd_good.play();
            clickedNumber.clicked = true;
            clickedNumbers.push(clickedNumber.number);
            clickedNumbers = clickedNumbers;
            numberOptions = numberOptions;
            
            if (clickedNumbers.length === numOptions - 1) { // Adjusted for the extra target number
                starCount++;
                if (starCount >= maxStars) {
                    await sleep(2000);
                    finalGraphic = true;
                    snd_fanfare.play();
                    $earnedStar = true;
                } else {
                    await sleep(2000);
                    numOptions++;
                    generateNumbers();
                }
            }
        } else {
            snd_error.play();
            generateNumbers();
        }
    }
    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        numOptions = 3; // Increased by 1 to include the target number
        generateNumbers();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
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
        if ((frameCount % 60 === 0) && (!finalGraphic)) {
            gameCurrentTimer = Date.now();
        }
    }

    handleResize();
    loop();
</script>

<div class="fit-full-space select-none overflow-hidden" style="background-color:#6fd0c0" on:touchstart={preventZoom}>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <!-- <img src="TinyQuest/gamedata/numberpies/wood.webp" class="fit-full-space" alt="wood background" style="" /> -->
                <div class="absolute top-0 left-0 w-full h-full" style="background-color:#6fd0c0b0" ></div>
                <div class="text-9xl font-bold m-8 z-10">{town?.name}</div>
                <!-- Difficulty buttons 1-4 -->
                <div class="text-9xl font-bold m-8 z-10 rounded-2xl border-2 border-gray-500 bg-green-200 text-black">Difficulty<br/>
                {#each Array(4) as _, i}
                    <button
                        class="bg-blue-500 text-white text-9xl rounded-3xl px-8 z-10"
                        style="margin:1rem"
                        on:pointerup={() => {difficulty = i + 1; numOptions = 3; startGame()}}
                    >
                        {i + 1}
                    </button>
                {/each}
            </div>
                <!-- <button class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button> -->
            </div>
        {:else}
        <div class="flex flex-row h-full w-full">
            <!-- <img src="TinyQuest/gamedata/numberpies/wood.webp" class="absolute top-0 left-0 w-full h-full" alt="wood background" style="" /> -->
            <div class="absolute top-0 left-0 w-full h-full" style="background-color:#6fd0c0b0" ></div>
            <div id="playBoard" class="h-full w-full font-bold relative">
                {#if numberOptions}
                    {#each numberOptions as option, i}
                        <div
                            class="absolute text-4xl flex-center-all rounded-full active:scale-105 transform transition-all duration-75"
                            style="width:15rem;height:15rem;left:{option.x * 100}rem;top:{option.y * 100}rem;font-size:6rem;color:#ffffff;line-height:3rem;background-color:{option.isTarget ? '#bf3434' : option.clicked ? '#4299e1' : '#707e90'};"
                            on:pointerup|preventDefault|stopPropagation={() => clickNumber(option)}
                        >
                            {option.number}
                        </div>
                    {/each}
                {/if}
            </div>
            {#if finalGraphic}
                <div class="text-black text-9xl z-20">{Math.round((gameCurrentTimer - gameStartTimer) / 1000.0)}</div>
            {:else}
                <div class="text-black text-3xl z-20">{Math.round((gameCurrentTimer - gameStartTimer) / 1000.0)}</div>
            {/if}
            <StarBar {maxStars} {starCount} bg="#ffffff" on:pointerup={resetToSplashScreen} />
            <WinScreen {maxStars} active={finalGraphic} on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;z-index:100;background-color:#00000080" />
        </div>
    {/if}
    </div>
</div>

<style>
    .flex-center-all {
        display: flex;
        align-items: center;
        justify-content: center;
    }
</style>