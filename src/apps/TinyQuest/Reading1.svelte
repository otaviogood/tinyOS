<script>
    import IconsMisc from "./IconsMisc.svelte";
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
    import { snd_phonemes } from "./voiceSynth";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    const maxStars = 1; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // which sentence are we reading?

    let text3 = "Hi there cheese car.";
    // let text3 = "we will\nyes you";
    // let allSentences = ["andel", "big poop", "dad is old", "i like mom", "Hi there cheese car."];
    // let allSentences = ["dad sat", "mom can see", "i like mom", "rat rat rat\nso much", "andel", "mom is in bed", "hi poop", "the cat has a hat.", "dad is old"];
    let allSentences = ["cat\nsat\nhat", "mom can see", "i like mom", "rat rat rat\nso much", "andel", "mom is in bed", "hi poop", "the cat has a hat.", "dad is old"];

    // Grabbed some words from grade 1 here: https://www.readingrockets.org/article/basic-spelling-vocabulary-list
    var words = {
        a: "a@u0",
        am: "a|m",
        and: "a|n|d",
        andel: "a|n|d|e|l",
        at: "a|t",
        bag: "b|a|g",
        ball: "b|a@o0|l|l@silent",
        be: "b|e@e1",
        bed: "b|e|d",
        bee: "b|e@e1|e@e1",
        big: "b|i|g",
        book: "b|oo|k",
        box: "b|o|x",
        boy: "b|oy",
        bug: "b|u|g",
        but: "b|u@oo0|t",
        came: "c|a@a1|m|e@silent",
        can: "c|a|n",
        car: "c|ar",
        cat: "c|a|t",
        cheese: "ch|e@e1|e@e1|s@z3|e@silent",
        come: "c|o@u0|m|e@silent",
        cow: "c|o@a0|w",
        cup: "c|u|p",
        cups: "c|u|p|s",
        dad: "d|a|d",
        day: "d|a@a1|y@silent",
        did: "d|i|d",
        dig: "d|i|g",
        do: "d|o@oo1",
        dog: "d|o|g",
        fat: "f|a|t",
        fix: "f|i|x",
        for: "f|or",
        fun: "f|u|n",
        get: "g|e|t",
        go: "g|o@o1",
        good: "g|oo|d",
        got: "g|o|t",
        had: "h|a|d",
        has: "h|a|s@z3",
        hat: "h|a|t",
        hats: "h|a|t|s",
        he: "h|e@e1",
        hen: "h|e|n",
        hear: "h|ear",
        here: "h|ere@ear2",
        hi: "h|i@i1",
        hid: "h|i|d",
        him: "h|i|m",
        his: "h|i|s@z3",
        home: "h|o@o1|m|e@silent",
        hot: "h|o|t",
        i: "i@i1",
        if: "i|f",
        in: "i|n",
        into: "i|n|t|o@oo1",
        is: "i|s@z3",
        it: "i|t",
        its: "i|t|s",
        let: "l|e|t",
        like: "l|i@i1|k|e@silent",
        look: "l|oo|k",
        man: "m|a|n",
        many: "m|a@e0|n|y@e1",
        mat: "m|a|t",
        may: "m|a@a1|y@silent",
        me: "m|e@e1",
        meet: "m|e@e1|e@silent|t",
        met: "m|e|t",
        mom: "m|o|m",
        much: "m|u|ch",
        my: "m|y@i1",
        no: "n|o@o1",
        not: "n|o|t",
        of: "o@u0|f@v3",
        oh: "o@o1|h@silent",
        old: "ol@ul4|d",
        on: "o|n",
        one: "o@w3|n@u0|e@n3", // THIS ONE SUCKS!!! WHAT TO DO?
        out: "ou@ow1|t",
        pan: "p|a|n",
        pet: "p|e|t",
        pig: "p|i|g",
        pink: "p|i|n|k",
        play: "p|l|a@a1|y@silent",
        poop: "p|oo@oo1|p",
        ran: "r|a|n",
        rat: "r|a|t",
        red: "r|e|d",
        ride: "r|i@i1|d|e@silent",
        rip: "r|i|p",
        rug: "r|u|g",
        run: "r|u|n",
        sad: "s|a|d",
        sam: "s|a|m",
        sat: "s|a|t",
        see: "s|e@e1|e@e1",
        she: "sh|e@e1",
        sit: "s|i|t",
        six: "s|i|x",
        so: "s|o@o1",
        soren: "s|or|e|n",
        stop: "s|t|o|p",
        sun: "s|u|n",
        ten: "t|e|n",
        the: "th|e@u0", // two options: th|e@e1
        there: "th|ere@air2",
        this: "th|i|s",
        to: "t|o@oo1",
        top: "t|o|p",
        toy: "t|oy",
        trash: "t@ch4|r|a|sh",
        two: "t|wo@oo1",
        up: "u|p",
        us: "u|s",
        van: "v|a|n",
        was: "w|a@u0|s@z3",
        we: "w|e@e1",
        went: "w|e|n|t",
        will: "w|i|l|l@silent",
        win: "w|i|n",
        yes: "y|e|s",
        you: "y|ou@oo1",
        zoo: "z|oo@oo1",
    };

    let difficultyOrder = [
        "m",
        "s",
        "a",
        "e@e1",
        "t",
        "r",
        "e@silent",
        "d",
        "i",
        "s@z3",
        "th",
        "e@u0",
        "c",
        "o",
        "n",
        "f",
        "u",
        "l",
        "w",
        "g",
        "i@i1",
        "sh",
        "a@a1",
        "h",
        "k",
        "o@o1",
        "v",
        "p",
        "ar",
        "ch",
        "e",
        "b",
        "ng",
        "y",
        "er",
        "oo@oo1",
        "j",
        "wh",
        "u@u1",
        "qu",
        "x",
        "z",
        "ea",
        "ai",
        "ou",
    ];

    // All the sounds from https://en.wikipedia.org/wiki/Phonics
    var snd_phonemes_info = {
        // Short vowels
        a0: [2638, 439],
        e0: [4393, 306],
        i0: [6222, 284],
        o0: [8109, 350],
        u0: [10168, 260],
        oo0: [11998, 272],
        // Long vowels (sounds like the vowel names)
        a1: [15473, 276],
        e1: [16757, 293],
        i1: [18186, 318],
        o1: [19498, 315],
        u1: [20835, 308],
        oo1: [22466, 303],
        ow1: [23899, 383],
        oy1: [25376, 350],
        // R-controlled vowels
        air2: [29125, 325],
        ar2: [30654, 357],
        ear2: [32247, 347],
        er2: [33913, 348],
        or2: [35549, 339],
        ure2: [37248, 302],
        // Simple consonants
        b3: [42209, 110],
        ck3: [43372, 156],
        d3: [44576, 160],
        f3: [45709, 306],
        g3: [47221, 222],
        h3: [48572, 296],
        j3: [49911, 238],
        l3: [51287, 337],
        m3: [52604, 243],
        n3: [53849, 272],
        p3: [55302, 158],
        r3: [56792, 257],
        s3: [57987, 327],
        t3: [59368, 223],
        v3: [100606 - 40000, 363],
        w3: [102054 - 40000, 225],
        y3: [103354 - 40000, 272],
        z3: [104648 - 40000, 382],
        // Complex consonants and digraphs
        ch4: [108371 - 40000, 243],
        ks4: [110778 - 40000, 347],
        kw4: [112116 - 40000, 243],
        ul4: [113749 - 40000, 323],
        ng4: [115342 - 40000, 382],
        sh4: [116780 - 40000, 442],
        th40: [118138 - 40000, 427], // think
        th41: [119662 - 40000, 437], // this
        gz4: [121744 - 40000, 479],
        zh4: [123620 - 40000, 430],
        // Silent
        silent: [0, 0],
    };

    var phoneme_colors = {
        default: "#000000",
        silent: "#c0c0c0",
        long: "#2020a0",
        combo: "#000000",
        weird: "#904010",
    };

    var phoneme_defaults = {
        a: "a0",
        b: "b3",
        c: "ck3",
        d: "d3",
        e: "e0",
        f: "f3",
        g: "g3",
        h: "h3",
        i: "i0",
        j: "j3",
        k: "ck3",
        l: "l3",
        m: "m3",
        n: "n3",
        o: "o0",
        p: "p3",
        q: "kw4",
        r: "r3",
        s: "s3",
        t: "t3",
        u: "u0",
        v: "v3",
        w: "w3",
        x: "ks4",
        y: "y3",
        z: "z3",
        oo: "oo0",
        oy: "oy1",
        ar: "ar2",
        ear: "ear2",
        er: "er2",
        or: "or2",
        qu: "kw4",
        ng: "ng4",
        ch: "ch4",
        sh: "sh4",
        th: "th41",

        wh: "w3",
        ea: "e1",
        ai: "a1",
        ou: "ow1",
    };

    let text3Split = formatSentence(allSentences[0]);
    // console.log(text3Split);

    function formatSentence(sent, newLines = true) {
        let text3Split = sent.split(/([ .:;?!~,`"&|()<>{}\[\]\r\n/\\]+)/g);
        // If punctuation is last, it will insert and empty string. Not sure why, so delete it.
        if (text3Split[text3Split.length - 1] === "") text3Split.pop();
        // console.log(text3Split);
        let final = [];
        final.push([]);
        for (let i = 0; i < text3Split.length; i++) {
            let current = text3Split[i].toLowerCase();
            if (current === "\n") {
                if (newLines) final.push([]);
                else final[final.length - 1].push(" ");
            } else {
                if (words[current]) final[final.length - 1] = final[final.length - 1].concat(words[current].split("|"));
                else final[final.length - 1].push(current);
            }
        }
        return final;
    }

    function getCharVisual(c) {
        let split = c.split("@");
        if (split.length === 1) return c;
        return split[0];
    }
    function getCharColor(c) {
        if (c === "s@z3" || c === "o@oo1") return phoneme_colors.weird;
        let split = c.split("@");
        if (split.length === 1) {
            if (["ch", "sh", "th", "qu", "ng", "wh", "ea", "ai", "ou"].includes(c)) return phoneme_colors.combo;
            return phoneme_colors.default;
        }
        // console.log(split[1]);
        if (split[1] === "silent") return phoneme_colors.silent;
        if (["a1", "e1", "i1", "o1", "u1", "oo1", "ow1", "oy1"].includes(split[1])) return phoneme_colors.long;

        return phoneme_colors.weird;
    }
    function getCharUnderline(c) {
        let split = c.split("@");
        if (split.length === 1) {
            if (["ch", "sh", "th", "qu", "ng", "ar", "ear", "er", "or", "oo", "oy", "wh", "ea", "ai", "ou"].includes(c)) return true;
            return false;
        }
        if (split[0].length > 1) return true;
        // console.log(split[1]);
        return false;
    }

    function isLetter(c) {
        return c.toLowerCase() != c.toUpperCase();
    }
    function rateDifficulty(s) {
        let parts = formatSentence(s, false)[0];
        let maxDifficulty = 0;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            let diff = difficultyOrder.findIndex((p) => p === part);
            if (diff === -1) diff = 1000000;
            let punctuation = !!part.match(/^[ .:;?!~,`"&|()<>{}\[\]\r\n/\\]/);
            if (punctuation) diff = 0;
            console.log(part, diff);
            maxDifficulty = Math.max(maxDifficulty, diff);
        }
        console.log("maxDiff", maxDifficulty);
    }

    function playPhoneme(c) {
        let split = c.split("@");
        let ph;
        if (split.length === 1) {
            ph = phoneme_defaults[c.toLowerCase()];
        } else {
            ph = split[1];
        }
        console.log("🗣️", ph);
        if (ph && ph !== "silent") snd_phonemes.play(ph);
    }

    var utter;
    var synth = window.speechSynthesis;
    function speak(text, verbose = true) {
        synth.cancel();
        utter = new SpeechSynthesisUtterance(text.toLowerCase());
        synth.speak(utter);
        if (verbose) console.log("🔊 " + text);
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            speechSynthesis.cancel();
            animator.stop();
        };
    });

    function tick() {}

    async function startGame() {
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;
        animator.start();
    }

    function resetToSplashScreen() {
        started = false;
        speechSynthesis.cancel();
        pop();
    }

    function changeSentence(i) {
        stage = i;
        text3Split = formatSentence(allSentences[stage]);
        // console.log(text3Split);
        rateDifficulty(allSentences[stage]);
    }

    handleResize();
    startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="background-color:white" on:touchstart={preventZoom}>
    <!-- <div style="color:white">                        {clickSequence === 1}</div> -->
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <!-- <div class="text-white text-7xl">WORK IN PROGRESS ROCKET GAME</div> -->
                <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-col h-full w-full">
                <div class="bg-blue-200 abXXXsolute lXXXeft-0 XXXtop-0 flex flex-row" style="width:100rem;height:10rem;">
                    {#each allSentences as _, i}
                        <div
                            class="{stage === i ? 'bg-green-600' : 'bg-blue-600'} text-4xl flex-center-all rounded-full active:scale-125 transform transition-all duration-75 m-4"
                            style="width:8rem;height:8rem;font-size:6rem;color:#f0f0f0;"
                            on:pointerup|preventDefault|stopPropagation={() => changeSentence(i)}
                        >
                            {i + 1}
                        </div>
                    {/each}
                    <div
                        class="cursor-pointer select-none m-4"
                        style="padding:0 0.75rem;border-radius:0.75rem;margin-left:auto"
                        on:pointerup|preventDefault|stopPropagation={resetToSplashScreen}
                        on:touchstart={preventZoom}
                    >
                        <IconsMisc icon="treasure-map" size="7.5rem" style="" />
                    </div>
                </div>
                <div class="flex-grow flex-center-all flex-col">
                    {#each text3Split as line, i}
                        <div class="flex flex-row bg-gray-100 rounded-xl m-6 px-4" style="">
                            {#each line as character, i}
                                <span
                                    class="text-9xl bordXXXer-2 flex flex-col justify-end items-center p-1 active:scale-125 transform transition-all duration-75"
                                    style="min-width:5rem;color:{getCharColor(character)};text-decoration: {getCharUnderline(character) ? 'underline' : 'initial'};"
                                    on:pointerup|preventDefault|stopPropagation={() => playPhoneme(character)}
                                >
                                    {getCharVisual(character)}
                                    <div class="bg-gray-300 rounded-full" style="width:2rem;height:2rem;margin:1rem;margin-top:2rem;opacity:{' .'.includes(character) ? '0' : '1'}" />
                                </span>
                            {/each}
                        </div>
                    {/each}
                </div>
                <!-- <div class="bg-red-600 absolute bottom-4" style="width:2rem;height:2rem;left:20rem;transform: translate({Math.sin($animateCount * 0.1) * 16}rem, 0rem);" /> -->
                <!-- <div class="flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div>
                <WinScreen {maxStars} active={finalGraphic} bg="#00000010" on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;top:10rem;z-index:100;" /> -->
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
</style>
