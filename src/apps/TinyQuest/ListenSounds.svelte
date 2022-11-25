<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "svelte-spa-router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../../animator";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    let currentSound;

    const maxStars = 1; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    // let imageCache=[];
    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    function tick() {
    }

    // https://pages.mtu.edu/~suits/NoteFreqCalcs.html
    let twelthRoot2 = 1.059463094359;
    let freq_c4 = -9;
    function freq(halfStepsFromA4) {
        return 440 * Math.pow(twelthRoot2, halfStepsFromA4);
    }

    //if you have another AudioContext class use that one, as some browsers have a limit
    var audioCtx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext || window.audioContext)();

    //All arguments are optional:
    //duration of the tone in milliseconds. Default is 500
    //frequency of the tone in hertz. default is 440
    //volume of the tone. Default is 1, off is 0.
    //type of tone. Possible values are sine, square, sawtooth, triangle, and custom. Default is sine.
    //callback to use on end of tone
    function beep(duration, frequency, volume, type, callback) {
        if (audioCtx.state !== "running") audioCtx.resume();
        var oscillator = audioCtx.createOscillator();
        var gainNode = audioCtx.createGain();

        // Not working... https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques
        let time = audioCtx.currentTime;
        let attackTime = 0.003;
        let releaseTime = 0.95;
        gainNode.gain.cancelScheduledValues(time);
        gainNode.gain.setValueAtTime(0, time);
        // set our attack
        gainNode.gain.linearRampToValueAtTime(volume, time + attackTime);
        // set our release
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + attackTime + releaseTime);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (volume) {
            // gainNode.gain.value = volume;
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

    function buttonA() {
        beep(1000, freq(freq_c4), 0.5);
    }

    function buttonB() {
        beep(1000, freq(freq_c4 + 7), 0.5);
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;
        animator.start();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    handleResize();
    // startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <!-- <div style="color:white">                        {clickSequence === 1}</div> -->
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                    <div class="text-white text-7xl">WORK IN PROGRESS MUSIC GAME</div>
                <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <div class="fit-full-space" style="">
                    <div class="absolute" style="left:-30rem;right:-30rem;top:0rem;bottom:-2rem;width:160rem;background-color:#080808;">
                        <!-- <img src="TinyQuest/gamedata/rocketlaunch/background.webp" class="absolute" alt="" style="bottom:0px;" /> -->
                    </div>
                    <div class="absolute rounded-full orb flex-center-all font-bold" style="width:20rem;height:20rem;left:16rem;top:30rem;" on:pointerdown|preventDefault|stopPropagation={buttonA}>
                        <div style="color:#e8c0ff;text-shadow: 0px 0px 22px #50307f;">1</div>
                    </div>
                    <button class="absolute rounded-full orb flex-center-all font-bold" style="width:20rem;height:20rem;left:56rem;top:30rem;" on:pointerdown|preventDefault|stopPropagation={buttonB}>
                        <div style="color:#e8c0ff;text-shadow: 0px 0px 22px #50307f;">5</div>
                    </button>
                </div>

                <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div>
                <WinScreen {maxStars} active={finalGraphic} bg="#00000010" on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;top:10rem;z-index:100;" />
            </div>
            <!-- <div class="absolute left-2 bottom-2" style="width:{60*5+16}px;height:{16.67*0.2}rem;background-color:#ffff00a0">
                {#each timingQueue as t, i}
                    <div class="bg-red-600 absolute bottom-0" style="width:4px;height:{Math.min(74,t*0.2)}rem;left:{i * 5}px"></div>
                {/each}
            </div> -->
        {/if}
    </div>
</div>

<style>
    .orb {
        font-size: 140px;
        background-color:#282828;
        box-shadow:
            inset 0 0 50px #111111,
            inset 0px 0 26px #50307f,
            inset 4px 4px 16px #af8777,
            inset -4px -4px 16px #3010b5,
            0px 0 60px #a060ff,
            0px 0 3px #ffffff;
    }
    .orb:active {
        box-shadow:
            inset 0 0 50px #111111,
            inset 0px 0 26px #50307f,
            /* inset -4px -4px 12px #555555,
            inset 4px 4px 12px #000000, */
            0px 0 80px #a060ff,
            0px 0 5px #ffffff;
        font-size: 136px;
    }
</style>
