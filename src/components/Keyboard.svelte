<script>
    import KeyboardKey from "./KeyboardKey.svelte";
    import { preventZoom } from "../utils";
    import { snd_phonemes } from "../apps/TinyQuest/voiceSynth";
    import { createEventDispatcher } from "svelte";
    import { speechPlay } from "../utils";

    const dispatch = createEventDispatcher();

    export let enterEnabled = false;
    export let extraKeys = [];
    export let audioOn = true;

    /*!speech
[
        "space",
        "back",
        "comma",
        "period",
        "apostrophe",
]
    */

    let keyLetters = [
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
        ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
        ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
        ["Z", "X", "C", "V", "B", "N", "M"],
    ];
    if (!extraKeys.includes("numbers")) keyLetters = [
        [],
        ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
        ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
        ["Z", "X", "C", "V", "B", "N", "M"],
    ];

    var phoneme_defaults = {
        a: ["a0","a1"],
        b: "b3",
        c: ["ck3","s3"],
        d: "d3",
        e: ["e0","e1"],
        f: "f3",
        g: ["g3","j3"],
        h: "h3",
        i: ["i0","i1"],
        j: "j3",
        k: "ck3",
        l: "l3",
        m: "m3",
        n: "n3",
        o: ["o0","o1"],
        p: "p3",
        q: "kw4",
        r: "r3",
        s: "s3",
        t: "t3",
        u: ["u0","u1"],
        v: "v3",
        w: "w3",
        x: "ks4",
        y: ["y3","e1"],
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

    function pressed(key) {
        // console.log("pressed", key);
        let i = key.detail.key.toLowerCase();
        if (i === "audioon" || i === "audiooff") {
            audioOn = !audioOn;
            return;
        }
        let side = key.detail.side;
        if (audioOn) {
            let phoneme = phoneme_defaults[i];
            if (phoneme) {
                if (Array.isArray(phoneme)) {
                    phoneme = phoneme[side];
                }
                snd_phonemes.play(phoneme);
            } else if (i >= '0' && i <= '9') {
                speechPlay(i);
            } else if (i === "backspace") {
                speechPlay("back");
            } else if (i === " ") {
                speechPlay("space");
            } else if (i === ",") {
                speechPlay("comma");
            } else if (i === ".") {
                speechPlay("period");
            } else if (i === "'") {
                speechPlay("apostrophe");
            }
        }
        dispatch('pressed', {
			key: key.detail.key,
            side: key.detail.side,
            xy: key.detail.xy
		})
    }

    function keyDown(e) {
        if (!e) return;
        if (!e.key) return;
        // console.log(e.key);
        let key = {
            detail: {key:e.key,
            side:0,
            xy: [0,0]}}
        pressed(key);
    }
</script>

<svelte:window on:keydown={keyDown} />

<div class="flex flex-col hXXX-full w-full absolute" style="bottom:1rem;left:4rem">
    {#each keyLetters as keyRow, i}
        <div class="flex flex-row text-red-500" style="margin-left:{i * 4.25}rem">
            {#each keyRow as keyLetter}
                <KeyboardKey {keyLetter} split={Array.isArray(phoneme_defaults?.[keyLetter.toLowerCase()]) && audioOn} on:pressed={pressed} />
            {/each}
            {#if i == 0}
                {#if extraKeys.includes("backspace")}
                    <KeyboardKey keyLetter="backspace" width="14.8rem" on:pressed={pressed}><i class="fas fa-arrow-left"></i></KeyboardKey>
                {/if}
            {/if}
            {#if i == 1}
                {#if extraKeys.includes("audio")}
                    <KeyboardKey keyLetter={audioOn ? "audioOn" : "audioOff"} width="10.5rem" on:pressed={pressed} >
                        {#if audioOn}
                            <i class="fas fa-volume-up"></i>
                        {:else}
                            <i class="fas fa-volume-mute"></i>
                        {/if}
                    </KeyboardKey>
                {/if}
            {/if}
            {#if i == 2}
                {#if extraKeys.includes("'")}
                    <KeyboardKey keyLetter="'" on:pressed={pressed} >'</KeyboardKey>
                {/if}
                {#if extraKeys.includes("music")}
                    <KeyboardKey keyLetter="enter" width="13.5rem" active={enterEnabled} on:pressed={pressed} ><i class="fas fa-music text-green-500"></i></KeyboardKey>
                {/if}
                {#if extraKeys.includes("paint")}
                    <KeyboardKey keyLetter="enter" width="13.5rem" active={enterEnabled} on:pressed={pressed} ><i class="fas fa-book-open text-green-500"></i></KeyboardKey>
                {/if}
            {/if}
            {#if i == 3}
                {#if extraKeys.includes(",")}
                    <KeyboardKey keyLetter="," on:pressed={pressed} >,</KeyboardKey>
                {/if}
                {#if extraKeys.includes(".")}
                    <KeyboardKey keyLetter="." on:pressed={pressed} >.</KeyboardKey>
                {/if}
            {/if}
        </div>
    {/each}
    <KeyboardKey keyLetter=" " width="50rem" marginLeft="17rem" on:pressed={pressed} />
</div>
