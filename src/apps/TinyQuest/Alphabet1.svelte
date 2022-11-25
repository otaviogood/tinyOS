<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import AlphabetSprites from "./AlphabetSprites.svelte";
    import IconsMisc from "./IconsMisc.svelte";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "svelte-spa-router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { spin } from "./Transitions";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";

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

    // Debugging function that speaks text through audio out. Also logs it.
    let speaking = false;
    function speak(text, verbose = true) {
        speaking = true;
        speechSynthesis.cancel();
        let utter = new SpeechSynthesisUtterance(text.toLowerCase());
        //utter.rate = 2.0;
        speechSynthesis.speak(utter);
        if (verbose) console.log("🔊 " + text);
        utter.onend = function (event) {
            speaking = false;
            // console.log("Utterance has finished being spoken after " + event.elapsedTime + " milliseconds.");
        };
    }

    function removeLetter(l) {
        letters = letters.replace(l, "");
    }

    function randomizeLetters() {
        currentLetters = [letters[getRandomInt(letters.length)]];
        removeLetter(currentLetters[0]);
        currentLetters.push(letters[getRandomInt(letters.length)]);
        removeLetter(currentLetters[1]);
        currentLetters.push(letters[getRandomInt(letters.length)]);
        removeLetter(currentLetters[2]);
        currentLetters.push(letters[getRandomInt(letters.length)]);
        removeLetter(currentLetters[3]);
        correct = getRandomInt(4);
        console.log(letters);
        onLetters = [true, true, true, true];
        speak(currentLetters[correct]);
        gonnaTalk = true;
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            speechSynthesis.cancel();
        };
    });

    async function clickedLetter(index, l) {
        if (!onLetters[index]) return;
        if (!canIClick) return;
        canIClick = false;
        speechSynthesis.cancel();
        gonnaTalk = false;
        if (index === correct) {
            onLetters = [false, false, false, false];
            onLetters[index] = true;
            setTimeout(() => {
                onLetters[index] = false;
            }, 1700);
            snd_good.play();
            starCount++;
            speak(l + ". is for " + getIcon(l)[2]);
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
            if (!speaking) {
                speaking = true;
                await sleep(180);
                speak("That is letter " + currentLetters[index]);
            }
        }
    }

    async function startGame() {
        snd_button.play();
        canIClick = true;
        finalGraphic = false;
        started = true;
        starCount = 0;
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        if (gameType === "lower") letters = "abcdefghijklmnopqrstuvwxyz";
        onLetters = [false, false, false, false];
        await sleep(200);
        randomizeLetters();
    }

    function resetToSplashScreen() {
        started = false;
        speechSynthesis.cancel();
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
                {#if gameType === "lower"}
                    <AlphabetSprites icon="cave" size="44rem" style="" />
                {:else}
                    <AlphabetSprites icon="village" size="44rem" style="" />
                    <AlphabetSprites icon="abc" size="24rem" style="margin:-24rem 0 0 0" />
                {/if}
                <div class="text-9xl font-bold m-8 text-black">{town?.name}</div>
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
                                    <div class="w-1/2 h-3 -mt-5 mb-10" style="border: 0rem dashed #ffffff40;border-width:0.75rem 0 0 0" />
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
                        on:pointerup|preventDefault|stopPropagation={() => speak(currentLetters[correct])}
                        class="absolute flex-center-all active:scale-125 transform transition-all duration-75 rounded-full cursor-pointer select-none"
                        style="left:38.5rem;top:31.5rem;width:12rem;height:12rem;background-color:#dd4444;"
                    >
                        <i class="fas fa-play text-white text-7xl" />
                    </div>
                {/if}
                <StarBar {maxStars} {starCount} on:pointerup={resetToSplashScreen} />
                <WinScreen {maxStars} active={finalGraphic} on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;z-index:100;background-color:#00000080" />
            </div>
        {/if}
    </div>
</div>

<style>
</style>
