<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import AlphabetSprites from "./AlphabetSprites.svelte";
    import IconsMisc from "./IconsMisc.svelte";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "../../router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { spin } from "./Transitions";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { speechPlay } from "../../utils";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    const maxStars = 6; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let letters;
    let currentLetters;
    let onLetters = [false, false, false, false];
    let onLettersSvelte = [false, false, false, false]; // Svelte takes time to fade in / out letters, so this reflects what the DOM really has.
    let correct;
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let gonnaTalk = false;
    let canIClick = true;
    let town;
    let gameType;

    const morseCode = {
        a: ".-",
        b: "-...",
        c: "-.-.",
        d: "-..",
        e: ".",
        f: "..-.",
        g: "--.",
        h: "....",
        i: "..",
        j: ".---",
        k: "-.-",
        l: ".-..",
        m: "--",
        n: "-.",
        o: "---",
        p: ".--.",
        q: "--.-",
        r: ".-.",
        s: "...",
        t: "-",
        u: "..-",
        v: "...-",
        w: ".--",
        x: "-..-",
        y: "-.--",
        z: "--..",
    };
    const convertToMorse = (str) => {
        return str
            .toUpperCase()
            .split("")
            .map((el) => {
                return morseCode[el] ? morseCode[el] : el;
            })
            .join("");
    };

    //if you have another AudioContext class use that one, as some browsers have a limit
    var audioCtx = Howler.ctx;// new (window.AudioContext || window.webkitAudioContext || window.audioContext)();

    //All arguments are optional:
    //duration of the tone in milliseconds. Default is 500
    //frequency of the tone in hertz. default is 440
    //volume of the tone. Default is 1, off is 0.
    //type of tone. Possible values are sine, square, sawtooth, triangle, and custom. Default is sine.
    //callback to use on end of tone
    function beep(duration, frequency, volume, type, callback) {
        var oscillator = audioCtx.createOscillator();
        var gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (volume) {
            gainNode.gain.value = volume;
        }
        if (frequency) {
            oscillator.frequency.value = frequency;
        }
        if (type) {
            oscillator.type = type;
        }
        if (callback) {
            oscillator.onended = callback;
        }

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + (duration || 500) / 1000);
    }

    const iconMap = [
        ["a", "plane", "Airplane"],
        ["b", "bus", "Bus"],
        ["c", "sport-car", "Car"],
        ["d", "truck", "Dump Truck"],
        ["e", "earth-globe", "Earth"],
        ["f", "firetruck", "Fire Truck"],
        ["g", "grape", "Grapes"],
        ["h", "helicopter", "Helicopter"],
        ["i", "ice-cream", "Ice Cream"],
        ["j", "orange-juice", "Juice"],
        ["k", "kite", "Kite"],
        ["l", "leaf", "Leaf"],
        ["m", "monster-truck", "Monster Truck"],
        ["n", "nuts", "Nuts"],
        ["o", "orange", "Orange"],
        ["p", "police-car", "Police Car"],
        ["q", "queen", "Queen"],
        ["r", "shuttle", "Rocket"],
        ["s", "snake", "Snake"],
        ["t", "turtle", "Turtle"],
        ["u", "umbrella", "Umbrella"],
        ["v", "volcano", "Volcano"],
        ["w", "watermelon", "Watermelon"],
        ["x", "xylophone", "Xylophone"],
        ["y", "yogurt", "Yogurt"],
        ["z", "zebra", "Zebra"],
    ];
    function getIcon(l) {
        l = l.toLowerCase();
        return iconMap.find((a) => a[0] === l);
    }

    function getNonDupLetter() {
        let result = letters[getRandomInt(letters.length)];
        if (!currentLetters) return result;
        let failCount = 100;
        while (currentLetters.indexOf(result) > -1 && failCount-- > 0) result = letters[getRandomInt(letters.length)];
        return result;
    }

    function removeLetter(l) {
        letters = letters.replace(l, "");
    }

    let playingMorse = 0;
    async function playMorse() {
        if (playingMorse > 0) return;
        playingMorse++;
        let fullCode = morseCode[currentLetters[correct].toLowerCase()];
        for (let i = 0; i < fullCode.length; i++) {
            // console.log(fullCode[i]);
            if (fullCode[i] === ".") {
                beep(timeUnit, 783.99, 0.3);
                await sleep(timeUnit * 2);
            } else {
                beep(timeUnit * 3, 783.99, 0.3);
                await sleep(timeUnit * 4);
            }
        }
        playingMorse--;
    }

    let timeUnit = 200;
    async function randomizeLetters() {
        currentLetters = [getNonDupLetter()];
        removeLetter(currentLetters[0]);
        currentLetters.push(getNonDupLetter());
        removeLetter(currentLetters[1]);
        currentLetters.push(getNonDupLetter());
        removeLetter(currentLetters[2]);
        currentLetters.push(getNonDupLetter());
        removeLetter(currentLetters[3]);
        correct = getRandomInt(4);
        // console.log(letters);
        onLetters = [true, true, true, true];

        playMorse();
        // speak(currentLetters[correct]);
        gonnaTalk = true;
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
        };
    });

    async function clickedLetter(index, l) {
        if (!onLetters[index]) return;
        if (!canIClick) return;
        canIClick = false;
        gonnaTalk = false;
        if (index === correct) {
            onLetters = [false, false, false, false];
            onLetters[index] = true;
            setTimeout(() => {
                onLetters[index] = false;
            }, 1700);
            snd_good.play();
            starCount++;
            speechPlay(l, "is for ", getIcon(l)[2]);
            if (starCount >= maxStars) {
                // Finished game. Yay!
                await sleep(2000);
                finalGraphic = true;
                snd_fanfare.play();
                $earnedStar = true;
                canIClick = true;
                return;
            }
            await sleep(2000);
            randomizeLetters();
            canIClick = true;
        } else {
            canIClick = true;
            snd_error.play();
            speechPlay("That is letter ", currentLetters[index]);
        }
    }

    let range = 0;
    let sourceLetters = "ABCDABCDABCDABCDABCDABCD";
    async function changeRange() {
        range = (range + 1) % 8;
        if (range === 0) sourceLetters = "ABCDABCDABCDABCDABCDABCD";
        else if (range === 1) sourceLetters = "EFGHEFGHEFGHEFGHEFGHEFGH";
        else if (range === 2) sourceLetters = "IJKLIJKLIJKLIJKLIJKLIJKL";
        else if (range === 3) sourceLetters = "MNOPMNOPMNOPMNOPMNOPMNOP";
        else if (range === 4) sourceLetters = "QRSTQRSTQRSTQRSTQRSTQRST";
        else if (range === 5) sourceLetters = "UVWXUVWXUVWXUVWXUVWXUVWX";
        else if (range === 6) sourceLetters = "WXYZWXYZWXYZWXYZWXYZWXYZ";
        else if (range === 7) sourceLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        await startGame();
    }

    async function startGame() {
        snd_button.play();
        canIClick = true;
        finalGraphic = false;
        started = true;
        starCount = 0;
        // letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        letters = (" " + sourceLetters).slice(1);
        onLetters = [false, false, false, false];
        await sleep(300);
        randomizeLetters();
    }

    function resetToSplashScreen() {
        started = false;
        gonnaTalk = false;
        canIClick = true;
        pop();
    }

    handleResize();
</script>

<div class="fit-full-space bg-white select-none overflow-hidden" on:touchstart={preventZoom}>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <!-- Crazy spinning morse code logo -->
                <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 500 500" width="768" style="margin:-8rem">
                    <defs>
                        <path d="M50,250c0-110.5,89.5-200,200-200s200,89.5,200,200s-89.5,200-200,200S50,360.5,50,250" id="textcircle">
                            <animateTransform attributeName="transform" begin="0s" dur="2s" type="rotate" from="0 250 250" to="360 250 250" repeatCount="1" />
                            <!-- SMIL animation: deprecated in Chrome, so eventually will have to be replaced with Web Animation API or alternative -->
                        </path>
                    </defs>
                    <text dy="74" textLength="1220" style="fill:#52df50">
                        <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                        <textPath xlink:href="#textcircle"> | -- --- &bull;-&bull; &bull;&bull;&bull; &bull; / -&bull;-&bull; --- -&bull;&bull; &bull;</textPath>
                    </text>
                    <text dy="120" textLength="1220" style="fill:#efa090">
                        <!-- textLength (essentially the circumference of the circle) is used as an alternative to letter-spacing for Firefox, which currently doesn't support letter-spacing for SVG -->
                        <textPath xlink:href="#textcircle"
                            >&nbsp;&nbsp;M&nbsp;&nbsp;O&nbsp;&nbsp;&nbsp;R&nbsp;&nbsp;&nbsp;S&nbsp;&nbsp;E&nbsp;&nbsp;&nbsp;&nbsp;C&nbsp;&nbsp;&nbsp;&nbsp;O&nbsp;&nbsp;&nbsp;D&nbsp;&nbsp;E</textPath
                        >
                    </text>
                    <circle cx="250" cy="250" r="158" stroke="#ff60b0" stroke-width="6" fill="transparent" />
                    <circle cx="250" cy="250" r="121" stroke="#ef80a0" stroke-width="6" fill="transparent" />
                </svg>

                <div class="text-9xl font-bold m-8">{town?.name}</div>
                <button class="bg-red-500 text-white text-9xl rounded-3xl px-8" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <div class="grid grid-flow-row grid-rows-2 grid-cols-2 h-full w-full font-bold">
                    {#if currentLetters}
                        {#each currentLetters as l, i}
                            {#if onLetters[i]}
                                <div
                                    in:fade
                                    out:fade={{ duration: 450 }}
                                    on:introstart={() => (onLettersSvelte[i] = true)}
                                    on:outroend={() => (onLettersSvelte[i] = false)}
                                    class="{['bg-red-400', 'bg-blue-400', 'bg-green-400', 'bg-yellow-400'][i]} flex-center-all flex-col text-white cursor-pointer overflow-hidden select-none active:{[
                                        'bg-red-200',
                                        'bg-blue-200',
                                        'bg-green-200',
                                        'bg-yellow-200',
                                    ][i]} {i == correct ? 'active:scale-125' : 'active:scale-105'} transform transition-all duration-75 m-auto"
                                    style="border-radius:12rem; width:95%;height:95%;touch-action: none;"
                                    on:touchstart={preventZoom}
                                    on:pointerup|preventDefault|stopPropagation={() => clickedLetter(i, l)}
                                >
                                    <div style="font-size:21rem;line-height: 90%;margin-top:-.75rem;">{l}</div>
                                    <div class="w-1/2 h-3 -mt-5 mb-10" style="border: 0rem solid #ffffff30;border-width:0.75rem 0 0 0" />
                                    <div class="text-5xl" style="font-family: monospace;line-height:30%;margin-top:-2rem;margin-bottom:1rem">{morseCode[l.toLowerCase()]}</div>
                                    <AlphabetSprites icon={getIcon(l)?.[1]} size="9rem" />
                                    <span style="font-size:3rem;display:inline-block">{gameType === "lower" ? getIcon(l)?.[2].toLowerCase() : getIcon(l)?.[2]}</span>
                                </div>
                            {/if}
                            {#if !onLettersSvelte[i]}
                                <div />
                            {/if}
                        {/each}
                    {/if}
                </div>
                {#if onLetters[0] && onLetters[1] && onLetters[2] && onLetters[3]}
                    <div
                        in:fade
                        out:fade={{ duration: 450 }}
                        on:pointerup|preventDefault|stopPropagation={() => {
                            if (!playingMorse) playMorse();
                        }}
                        class="absolute flex-center-all {playingMorse ? 'active:scale-100' : 'active:scale-125'} transform transition-all duration-75 rounded-full cursor-pointer select-none"
                        style="left:38.5rem;top:31.5rem;width:12rem;height:12rem;background-color:{playingMorse ? '#dd8888' : '#dd4444'};"
                    >
                        <i class="fas fa-play text-white text-7xl" />
                    </div>
                {/if}
                <StarBar {maxStars} {starCount} on:pointerup={resetToSplashScreen}>
                    <button
                        class="text-5xl text-white {timeUnit === 100 ? 'bg-red-400' : 'bg-yellow-400'} active:scale-105 transform transition-all duration-75"
                        style="border-radius:1rem;margin:auto;margin-top:0.75rem;margin-bottom:0.75rem;padding:1rem 0.5rem"
                        on:pointerup|preventDefault|stopPropagation={() => {
                            timeUnit = timeUnit === 100 ? 200 : 100;
                        }}>{timeUnit === 100 ? "Fast" : "Slow"}</button
                    >
                    <button
                        class="text-white active:scale-105 transform transition-all duration-75"
                        style="background-color:rgba(251, {191 - (range & 1) * 64}, {36 +
                            31 * range});font-size:2.5rem;border-radius:1rem;margin:auto;margin-top:0.75rem;margin-bottom:0.75rem;padding:1rem 0.5rem"
                        on:pointerup|preventDefault|stopPropagation={() => changeRange()}>{range === 7 ? "A..Z" : sourceLetters.substring(0, 4)}</button
                    >
                </StarBar>
                <WinScreen {maxStars} active={finalGraphic} on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;z-index:100;background-color:#00000080" />
            </div>
        {/if}
    </div>
</div>

<style>
    text {
        font-size: 40px;
        font-weight: 1000;
        letter-spacing: 21.5px;
    }
</style>
