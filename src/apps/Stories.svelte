<script>
    // import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import { pop } from "svelte-spa-router";
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
    } from "../screen";
    import { sleep, getRandomInt, preventZoom } from "../utils";
    import { tweened } from "svelte/motion";
    import { elasticOut, cubicInOut, cubicOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../animator";
    import { snd_phonemes } from "./TinyQuest/voiceSynth";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import Keyboard from "../components/Keyboard.svelte";
    import { speechPlay } from "../utils";
    import ImageRevealGrid from "../components/ImageRevealGrid.svelte";
    import CloseButton from "../components/CloseButton.svelte";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_blip = new Howl({ src: ["/TinyQuest/sfx/sfx_menu_move4.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    let started = false;
    let stage = 0; // which sentence are we reading?
    let storyIndex = 0; // which story are we reading?
    let state = 0; // 0 = reading / typing, 1 = extra reveal time, 2 = done paragraph + reveal, speak entire paragraph and waiting.

    let progressCharIndex = 0;
    let progressPhonemeIndex = 0;
    let nextChars = "";
    let enterEnabled = false;
    let wordAccumulator = "";
    let maxReveal = 16;
    let imageReveal = 0;
    let numStars = 0;
    let remainingReveals = 16;
    let completed = false;

    // WARNING. don't change this next line. It gets parsed by genSpeech.cjs.
    let allStorySentences = [
        [
            "Luna the unicorn\nhad a sparkly horn.",
            "Not too far away lived\na dragon named Spark.\nSpark had shiny red\nscales and could\nbreathe fire.",
            "Even though Luna and\nSpark were different,\nthey were best friends.\nThey liked to play\nby the waterfall together.",
            "One day, Spark was sad\nbecause the other\ndragons made fun of\nhim for being friends\nwith a unicorn.",
            "Luna and Spark had an\nidea. They planned\na picnic and invited\nall their unicorn\nand dragon friends.",
            "At first, their friends\ndidn't want to play\ntogether.",
            "Luna and Spark\nencouraged everyone\nto play games.",
            "By the end of the picnic,\nthe unicorns and dragons\nbecame friends. They\nrealized that despite\ntheir differences, they\ncould all be friends.",
            // "silly hat.",
        ],
    ];
    // WARNING. don't change this next line. It gets parsed by genSpeech.cjs.
    let allStoryImages = [
        [
            "stories/unicorn_dragon/A_white_unicorn_in_a_forest_filled_wit.webp",
            "stories/unicorn_dragon/Dragon_with_red_scales_in_a_forest.webp",
            "stories/unicorn_dragon/A_waterfall_in_a_forest.webp",
            "stories/unicorn_dragon/Bigger_dragons_laughing_and_mocking_a_s.webp",
            "stories/unicorn_dragon/Picnic_blankey_by_a_waterfall_in_a_fore.webp",
            "stories/unicorn_dragon/A_bored_unicorn.webp",
            "stories/unicorn_dragon/Dragon_running_and_jumping_and_havi.webp",
            "stories/unicorn_dragon/dragon_unicorn_party.webp",
        ],
    ];

    // Phonetic spelling of all the words in the story.
    // Grabbed some words from grade 1 here: https://www.readingrockets.org/article/basic-spelling-vocabulary-list
    // WARNING. don't change this next line. It gets parsed by genSpeech.cjs.
    var wordPhonemeAllParts = {
        a: "a@u0",
        all: "a@o0|l|l@silent",
        am: "a|m",
        an: "a|n",
        and: "a|n|d",
        andel: "a|n|d|e|l",
        at: "a|t",
        away: "a@u0|w|ay@a1",
        bag: "b|a|g",
        ball: "b|a@o0|l|l@silent",
        be: "b|e@e1",
        beautiful: "b|e@e1|a|u@oo1|t|i|f|u|l",
        became: "b|e@e1|c|a@a1|m|e@silent",
        because: "b|e@e1|c|au@u0|s@z3|e@silent",
        bed: "b|e|d",
        bee: "b|e@e1|e@e1",
        being: "b|e@e1|i|ng",
        best: "b|e|s|t",
        big: "b|i|g",
        book: "b|oo|k",
        box: "b|o|x",
        boy: "b|oy",
        breathe: "b|r|ea@e1|th|e@silent",
        bug: "b|u|g",
        but: "b|u@oo0|t",
        by: "b|y@i1",
        came: "c|a@a1|m|e@silent",
        can: "c|a|n",
        car: "c|ar",
        cat: "c|a|t",
        cheese: "ch|e@e1|e@e1|s@z3|e@silent",
        come: "c|o@u0|m|e@silent",
        could: "c|ou@oo0|l@silent|d",
        cow: "c|o@a0|w",
        cup: "c|u|p",
        cups: "c|u|p|s",
        dad: "d|a|d",
        day: "d|ay@a1",
        despite: "d|e@e1|s|p|i@i1|t|e@silent",
        did: "d|i|d",
        "didn't": "d|i|d|n|'@silent|t",
        differences: "d|i|f|f|er|e|n|c@s3|e|s@z3",
        different: "d|i|f|f|er|e|n|t",
        dig: "d|i|g",
        do: "d|o@oo1",
        dog: "d|o|g",
        dragon: "d@j3|r|a|g|o@u0|n",
        dragons: "d@j3|r|a|g|o@u0|n|s@z3",
        encouraged: "e|n|c|our@er2|a|g@j3|e@silent|d",
        end: "e|n|d",
        even: "e@e1|v|e|n",
        everyone: "e|v|er@er2|y@e1|o@u0|n|e@silent", // THIS ONE SUCKS!!! WHAT TO DO?
        far: "f|ar",
        fat: "f|a|t",
        fire: "f|i@i1|r@er2|e@silent",
        first: "f|ir@er2|s|t",
        fix: "f|i|x",
        for: "f|or",
        friends: "f|r|ie@e0|n|d|s",
        fun: "f|u|n",
        games: "g|a@a1|m|e@silent|s@z3",
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
        horn: "h|or@or2|n",
        hot: "h|o|t",
        i: "i@i1",
        idea: "i|d|e@e1|a@u0",
        if: "i|f",
        in: "i|n",
        into: "i|n|t|o@oo1",
        invited: "i|n|v|i@i1|t|e|d",
        is: "i|s@z3",
        it: "i|t",
        its: "i|t|s",
        let: "l|e|t",
        like: "l|i@i1|k|e@silent",
        liked: "l|i@i1|k|e@silent|d",
        lived: "l|i|v|e@silent|d",
        look: "l|oo|k",
        luna: "l|u@oo1|n|a@u0",
        made: "m|a@a1|d|e@silent",
        man: "m|a|n",
        many: "m|a@e0|n|y@e1",
        mat: "m|a|t",
        may: "m|ay@a1",
        me: "m|e@e1",
        meet: "m|e@e1|e@silent|t",
        met: "m|e|t",
        mom: "m|o|m",
        much: "m|u|ch",
        my: "m|y@i1",
        name: "n|a@a1|m|e@silent",
        named: "n|a@a1|m|e@silent|d",
        no: "n|o@o1",
        not: "n|o|t",
        of: "o@u0|f@v3",
        oh: "o@o1|h@silent",
        old: "ol@ul4|d",
        on: "o|n",
        one: "o@u0|n|e@silent", // THIS ONE SUCKS!!! WHAT TO DO?
        once: "o@u0|n|c@s3|e@silent", // THIS ONE SUCKS!!! WHAT TO DO?
        other: "o@u0|th|er",
        out: "ou@ow1|t",
        pan: "p|a|n",
        pet: "p|e|t",
        picnic: "p|i|c|n|i|c",
        pig: "p|i|g",
        pink: "p|i|n|k",
        planned: "p|l|a|n|n|e@silent|d",
        play: "p|l|ay@a1",
        poop: "p|oo@oo1|p",
        ran: "r|a|n",
        rat: "r|a|t",
        realized: "r|e@e1|a@u0|l|i@i1|z|e@silent|d",
        red: "r|e|d",
        ride: "r|i@i1|d|e@silent",
        rip: "r|i|p",
        rug: "r|u|g",
        run: "r|u|n",
        sad: "s|a|d",
        sam: "s|a|m",
        sat: "s|a|t",
        scales: "s|c|a@a1|l|e@silent|s",
        see: "s|e@e1|e@e1",
        she: "sh|e@e1",
        shiny: "sh|i@i1|n|y@e1",
        sit: "s|i|t",
        six: "s|i|x",
        so: "s|o@o1",
        soren: "s|or|e|n",
        spark: "s|p|ar|k",
        sparkly: "s|p|ar|k|l|y@e1",
        stop: "s|t|o|p",
        sun: "s|u|n",
        ten: "t|e|n",
        that: "th|a|t",
        the: "th|e@u0", // two options: th|e@e1
        their: "th|eir@air2",
        there: "th|ere@air2",
        they: "th|e|y@e1",
        this: "th|i|s",
        though: "th|ough@o1",
        time: "t|i@i1|m|e@silent",
        to: "t|o@oo1",
        together: "t|o@oo1|g|e|th|er",
        too: "t|oo@oo1",
        top: "t|o|p",
        toy: "t|oy",
        trash: "t@ch4|r|a|sh",
        two: "t|wo@oo1",
        unicorn: "u@u1|n|i|c|or@or2|n",
        unicorns: "u@u1|n|i|c|or@or2|n|s@z3",
        up: "u|p",
        upon: "u|p|o|n",
        us: "u|s",
        van: "v|a|n",
        want: "w|a@u0|n|t",
        was: "w|a@u0|s@z3",
        waterfall: "w|a@o0|t|er|f|a@o0|l|l",
        we: "w|e@e1",
        went: "w|e|n|t",
        were: "w|ere@er2",
        white: "w|h@silent|i@i1|t|e@silent",
        will: "w|i|l|l@silent",
        win: "w|i|n",
        with: "w|i|th@th40",
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
        silent: "#909090",
        long: "#402040", //"#2020a0",
        combo: "#000000",
        weird: "#002040", //"#904010",
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

    let linesOfPhonemes = formatSentence(allStorySentences[storyIndex][0]);
    // console.log("LOF1", linesOfPhonemes);

    // Takes a sentence and returns an array of arrays of phonemes.
    // Each array is a line of phonemes. A phoneme looks like this: 'n' or 'th' or 'e@u0'.
    function formatSentence(sent, newLines = true) {
        // let textSplit = sent.split(/(\s|[.,])/g);
        let textSplit = sent.split(/([\s.,])/g).filter((w) => w.length > 0);
        // console.log("SPLIT", textSplit);
        // If punctuation is last, it will insert an empty string. Not sure why, so delete it.
        if (textSplit[textSplit.length - 1] === "") textSplit.pop();
        let final = [];
        final.push([]);
        for (let i = 0; i < textSplit.length; i++) {
            let current = textSplit[i]; //.toLowerCase();
            if (current === "\n") {
                final[final.length - 1].push("\n");
                if (newLines) final.push([]);
                else final[final.length - 1].push(" ");
            } else {
                let lower = wordPhonemeAllParts[current.toLowerCase()];
                if (lower) final[final.length - 1] = final[final.length - 1].concat(lower.split("|"));
                // else push each character individually.
                else for (let j = 0; j < current.length; j++) final[final.length - 1].push(current[j]);
            }
            if (i === 0) {
                getNextChar();
                // nextChars = final[0][0];
                // if (nextChars.split("@").length > 1) nextChars = nextChars.split("@")[0];
                // if (nextChars.length > 1) nextChars = nextChars[0];
            }
        }
        // console.log("formatted", final, nextChars);
        return final;
    }

    function getCharVisual(c) {
        let split = c.split("@");
        if (split.length === 1) return c.replace(" ", "&nbsp;");
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
            if (["ch", "sh", "th", "qu", "ng", "ar", "ear", "er", "or", "oo", "oy", "wh", "ea", "ai", "ou"].includes(c))
                return true;
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
            // console.log(part, diff);
            maxDifficulty = Math.max(maxDifficulty, diff);
        }
        // console.log("maxDiff", maxDifficulty);
    }

    function playPhoneme(c) {
        let split = c.split("@");
        let ph;
        if (split.length === 1) {
            ph = phoneme_defaults[c.toLowerCase()];
        } else {
            ph = split[1];
        }
        // console.log("🗣️", ph);
        if (ph && ph !== "silent") snd_phonemes.play(ph);
        else snd_blip.play();
    }

    onMount(() => {
        return () => {
            animator.stop();
        };
    });

    function tick() {}

    async function getNextChar() {
        nextChars = allStorySentences[storyIndex][stage][progressCharIndex];
        nextChars = nextChars.toLowerCase();
        if (nextChars === "\n") {
            enterEnabled = true;
            snd_good.play();
        } else enterEnabled = false;
        if (!"abcdefghijklmnopqrstuvwxyz'".includes(nextChars)) {
            let temp = wordAccumulator;
            wordAccumulator = "";
            setTimeout(() => {
                speechPlay(temp);
            }, 400);
            // await sleep(500);
            // console.log(temp);
            // await speechPlay(temp);
            wordAccumulator = "";
            // snd_good.play();
        } else wordAccumulator += nextChars;
    }

    async function keyPressed(e) {
        let key = e.detail.key.toLowerCase();
        // console.log("key", "["+key+"]");
        if (key === "enter") key = "\n";
        if (key == "backspace") {
        } else {
            let current = allStorySentences[storyIndex][stage][progressCharIndex];
            current = current.toLowerCase();
            key = key.toLowerCase();
            // console.log("current", current, "key", "["+key+"]");
            if (current === key) {
                if (key === "\n") {
                    imageReveal++;
                    let numLines = allStorySentences[storyIndex][stage].split("\n").length;
                    numStars += Math.floor(maxReveal / numLines);
                }
                playPhoneme(getPhonemeAndIndexAndLine(progressCharIndex)[1]);
                progressCharIndex++;
                if (progressCharIndex >= allStorySentences[storyIndex][stage].length) {
                    numStars = remainingReveals;
                    imageReveal = maxReveal;
                    state = 1;

                    return;
                    // await sleep(15000);
                    // state = 0;
                    // // You win... next paragraph.
                    // stage++;
                    // if (stage > allStorySentences[storyIndex].length - 1) stage = 0;
                    // changeSentence(stage);
                }
                progressPhonemeIndex = getPhonemeAndIndexAndLine(progressCharIndex)[0];
                nextChars = nextChars.slice(1);
                if (nextChars.length === 0) getNextChar();
                // console.log("nextChars", nextChars);
                // playPhoneme(current);
                // snd_good.play();
            } else {
                // snd_bad.play();
            }
        }
    }

    function getPhonemeAndIndexAndLine(targetCharIndex) {
        let text = "";
        let phonemeIndex = 0;
        let charIndex = 0;
        for (let i = 0; i < linesOfPhonemes.length; i++) {
            // For each line
            for (let j = 0; j < linesOfPhonemes[i].length; j++) {
                // For each phoneme
                let current = linesOfPhonemes[i][j];
                if (current.split("@").length > 1) current = current.split("@")[0];
                for (let k = 0; k < current.length; k++) {
                    // For each letter in phoneme (th = 2 letters)
                    if (charIndex === targetCharIndex) return [phonemeIndex, linesOfPhonemes[i][j], i];
                    text += current[k];
                    charIndex++;
                }
                phonemeIndex++;
            }
        }
        return phonemeIndex;
    }

    function colorProgress(lineIndex, ch, progressPhonemeIndex) {
        let truePos = 0;
        let truePhonemeIndex = 0;
        let text = "";
        for (let i = 0; i < linesOfPhonemes.length; i++) {
            for (let j = 0; j < linesOfPhonemes[i].length; j++) {
                let current = linesOfPhonemes[i][j];
                if (current.split("@").length > 1) current = current.split("@")[0];
                for (let k = 0; k < current.length; k++) {
                    text += current[k];
                    if (i < lineIndex || (i === lineIndex && j + k < ch)) truePos++;
                }
                if (i < lineIndex || (i === lineIndex && j < ch)) truePhonemeIndex++;
            }
        }
        // console.log(text);
        if (truePhonemeIndex === progressPhonemeIndex) return "#00ff00";
        if (truePhonemeIndex <= progressPhonemeIndex) return "#c0c0c000";
        return "#2050a018";
    }

    async function startGame() {
        started = true;
        stage = 0;
        animator.start();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    function changeSentence(i) {
        state = 0;
        progressCharIndex = 0;
        progressPhonemeIndex = 0;
        stage = i;
        if (stage > allStorySentences[storyIndex].length - 1) {
            stage = 0;
            completed = true;
        }
        nextChars = "";
        getNextChar();
        linesOfPhonemes = formatSentence(allStorySentences[storyIndex][stage]);
        // maxReveal = linesOfPhonemes.length;
        imageReveal = 0;

        // console.log("LOF2", linesOfPhonemes);
        rateDifficulty(allStorySentences[storyIndex][stage]);
        linesOfPhonemes = linesOfPhonemes;
        allStorySentences = allStorySentences;

        if (completed) {
            snd_blip.play();
            let paragraph = allStorySentences[storyIndex][stage];
            paragraph = paragraph.replace(/[^a-zA-Z0-9]/g, "_");
            setTimeout(() => {
                speechPlay(paragraph);
            }, 200);
        }
    }

    function scalePulse(node, { delay, duration }) {
        return {
            delay,
            duration,
            css: (t) => {
                const eased = cubicOut(t);

                return `
                        transform: scale(${1.0 + Math.sin(eased * Math.PI) * 0.8});
                        will-change: transform;
                        `;
            },
        };
    }

    handleResize();
    startGame();
</script>

<FourByThreeScreen bg="white">
    {#if !started}
        <div class="flex-center-all h-full flex flex-col">
            <!-- <div class="text-white text-7xl">WORK IN PROGRESS ROCKET GAME</div> -->
            <!-- <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div> -->
            <button
                in:fade={{ duration: 2000 }}
                class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                on:pointerup|preventDefault|stopPropagation={startGame}>START</button
            >
        </div>
    {:else}
        {#key linesOfPhonemes}
            <div class="flex flex-col h-full w-full">
                <!-- <div class="bg-blue-200 abXXXsolute lXXXeft-0 XXXtop-0 flex flex-row" style="width:100rem;height:7rem;">
                    {#each allStorySentences[storyIndex] as _, i}
                        <div
                            class="{stage === i ? 'bg-green-600' : 'bg-blue-600'} flex-center-all rounded-full active:scale-125 transform transition-all duration-75 m-4"
                            style="width:5rem;height:5rem;font-size:4rem;color:#f0f0f0;"
                            on:pointerup|preventDefault|stopPropagation={() => changeSentence(i)}
                        >
                            {i + 1}
                        </div>
                    {/each}
                </div> -->
                <div class="flex-grow flex-col">
                    {#each linesOfPhonemes as line, li}
                        {@const lineOn = li == getPhonemeAndIndexAndLine(progressCharIndex)[2] || state !== 0 || completed}
                        {#if li <= getPhonemeAndIndexAndLine(progressCharIndex)[2] || state !== 0 || completed}
                            <div
                                class="flex flex-row bg-graXXy-100 rounded-xl m-6 px-4 w-max"
                                style="opacity:{lineOn ? '1.0' : '0.5'}"
                            >
                                {#each line as character, ci}
                                    {@const letterOn = colorProgress(li, ci, progressPhonemeIndex) === "#00ff00"}
                                    <span
                                        class="text-6xl flex flex-col justify-end items-center active:scale-125 transform transition-all duration-75"
                                        style="min-width:1.5rem;padding-right:0.1rem;color:{getCharColor(
                                            character
                                        )};text-decoration: {getCharUnderline(character) ? 'underline' : 'initial'};"
                                        on:pointerup|preventDefault|stopPropagation={() => playPhoneme(character)}
                                    >
                                        <pre
                                            class="p-0 m-0"
                                            style="background-color:{letterOn && !completed
                                                ? '#c0ffc0'
                                                : 'white'}">{getCharVisual(character).replaceAll("&nbsp;", " ")}</pre>
                                        <!-- <div class="bXXorder border-red-600 wXX-12">{@html getCharVisual(character)}</div> -->
                                        <div
                                            class="rounded-full"
                                            style="width:1rem;height:1rem;margXXin:0.2rem;margin-top:0.5rem;opacity:{' .,'.includes(
                                                getCharVisual(character)
                                            )
                                                ? '1.0'
                                                : '1'};background-color:{completed
                                                ? 'white'
                                                : colorProgress(li, ci, progressPhonemeIndex)}"
                                        />
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    {/each}
                </div>
                <div class="absolute right-0 top-0 m-4">
                    <ImageRevealGrid
                        src={allStoryImages[storyIndex][stage]}
                        stage={imageReveal}
                        maxStages={maxReveal}
                        active={numStars > 0}
                        {completed}
                        class="w-[42rem] h-[42rem] bXXorder-4 border-black"
                        bind:remainingReveals
                        on:pressed={() => {
                            snd_good.play();
                            numStars--;
                            if (numStars < 0) numStars = 0;
                            if (remainingReveals === 0) {
                                let paragraph = allStorySentences[storyIndex][stage];
                                paragraph = paragraph.replace(/[^a-zA-Z0-9]/g, "_");
                                setTimeout(() => {
                                    speechPlay(paragraph);
                                }, 200);
                                state = 2;
                                if (stage >= allStorySentences[storyIndex].length - 1) {
                                    completed = true;
                                }
                            }
                        }}
                    />
                </div>
                {#if !completed}
                    {#key numStars}
                        <div
                            in:scalePulse|local={{ delay: 0, duration: 1200 }}
                            class="absolute left-24 bottom-24 flex-center-all"
                        >
                            <i class="absolute fa-solid fa-star text-orange-400 text-[8.75rem]" />
                            <i class="absolute fa-solid fa-star text-yellow-200 text-9xl" />
                            <div class="absolute text-orange-500 font-bold text-7xl">{numStars}</div>
                        </div>
                    {/key}
                {/if}
                {#if state === 0 && !completed}
                    <Keyboard on:pressed={keyPressed} {enterEnabled} extraKeys={[",", ".", "'", "paint"]} audioOn={false} />
                {:else if state === 2 || completed}
                    {#if stage === allStorySentences[storyIndex].length - 1 || completed}
                        <div
                            class="flex-center-all flex-row mb-56 border-[0.5rem] border-gray-200 bg-gray-100 rounded-full w-max self-center"
                        >
                            {#each Array(allStorySentences[storyIndex].length) as _, i}
                                <div
                                    class="w-20 h-20 m-4 z-[1] flex-center-all text-4xl rounded-full {stage === i
                                        ? 'bg-orange-400'
                                        : 'bg-green-400'} active:scale-125 transform transition-all duration-75"
                                    style="left:{i * 6 + 5}rem;"
                                    on:pointerup={() => {
                                        changeSentence(i);
                                    }}
                                >
                                    {i}
                                </div>
                            {/each}
                        </div>
                        <div class="self-center absolute bottom-72 h-48 text-black rounded-full text-8xl">the end</div>
                        <!-- <button
                            class="self-center absolute bottom-64 z-10 w-[28rem] h-48 bg-green-400 rounded-full text-8xl"
                            on:pointerup={() => {
                                pop();
                            }}>the end</button
                        > -->
                    {:else}
                        <button
                            class="self-center mb-64 z-10 w-48 h-48 bg-green-400 rounded-full text-8xl"
                            on:pointerup={() => {
                                changeSentence(stage + 1);
                            }}>GO</button
                        >
                    {/if}
                {/if}
                <!-- <button class="self-cenXXter mb-64 z-10 w-48 h-48 bg-red-600 text-4xl" on:pointerup={() => {changeSentence(stage+1)}}>skip</button> -->
                <CloseButton confirm topRem={45} rightRem={1} />
            </div>
        {/key}
    {/if}
</FourByThreeScreen>

<!-- sdf

Once upon a time, there lived a beautiful white unicorn named Luna. Luna's horn sparkled like silver. Not too far away lived a dragon named Spark. Spark had shiny red scales and could breathe fire.
Even though unicorns and dragons were very different, Luna and Spark were the best of friends. They both lived in a magical forest and would often meet by their favorite waterfall to play.
One day, Spark was sad because the other dragons made fun of him for being friends with a unicorn. The other unicorns also teased Luna for being friends with a dragon. Luna and Spark were sad their friends did not understand.
Luna and Spark had an idea. They decided to organize a picnic by the waterfall and invite all their dragon and unicorn friends. At first, the dragons and unicorns kept to their own groups and eyed each other warily.
Luna and Spark encouraged everyone to join in games together. At first they were hesitant, but soon they were all laughing and playing with each other. By the end of the picnic, the dragons and unicorns were getting along wonderfully. They realized that despite their differences, they could all be good friends. Luna and Spark were happy their idea worked, and they continued to bond over many more picnics and adventures together.

---------- simplified ------------
Luna the unicorn had a sparkly horn. Her friend Spark the dragon had red scales and could breathe fire. Even though Luna and Spark were different, they were best friends.
Other unicorns and dragons did not understand Luna and Spark's friendship. They made fun of Luna and Spark. Luna and Spark were sad about this.
Luna and Spark had an idea. They planned a picnic and invited all their unicorn and dragon friends. At first, the unicorns and dragons stayed in their own groups.
Luna and Spark encouraged them to play together. Soon, they were all laughing and playing. By the end of the picnic, the unicorns and dragons became friends. They realized that despite their differences, they could all be friends.
Luna and Spark were happy their idea worked. They went on to have many more picnics and adventures together with their unicorn and dragon friends.


    sdf -->
<style>
</style>
