<script>
    import KeyboardKey from "./KeyboardKey.svelte";
    import { preventZoom } from "../utils";
    import { snd_phonemes } from "../apps/TinyQuest/voiceSynth";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let enterEnabled = false;

    let audioOn = true;

    let keyLetters = [
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
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
        let i = key.detail.key.toLowerCase();
        if (i === "🔊" || i === "🔇" || i === "🔉" || i === "🔈") {
            audioOn = !audioOn;
            return;
        }
        let side = key.detail.side;
        let phoneme = phoneme_defaults[i];
        if (phoneme) {
            if (Array.isArray(phoneme)) {
                phoneme = phoneme[side];
            }
            snd_phonemes.play(phoneme);
        }
        dispatch('pressed', {
			key: key.detail.key,
            side: key.detail.side,
            xy: key.detail.xy
		})
    }
</script>

<div class="flex flex-col hXXX-full w-full absolute" style="bottom:1rem;left:0rem">
    {#each keyLetters as keyRow, i}
        <div class="flex flex-row text-red-500" style="margin-left:{i * 4.25}rem">
            {#each keyRow as keyLetter}
                <KeyboardKey {keyLetter} split={Array.isArray(phoneme_defaults?.[keyLetter.toLowerCase()])} on:pressed={pressed} />
            {/each}
            {#if i == 0}
                <KeyboardKey keyLetter="&larr;" width="14.8rem" on:pressed={pressed} />
            {/if}
            {#if i == 1}
                <KeyboardKey keyLetter={audioOn ? "🔊" : "🔈"} width="10.5rem" on:pressed={pressed} />
            {/if}
            {#if i == 2}
                <KeyboardKey keyLetter="▶️" width="13.5rem" active={enterEnabled} on:pressed={pressed} />
            {/if}
        </div>
    {/each}
    <KeyboardKey keyLetter=" " width="50rem" marginLeft="17rem" on:pressed={pressed} />
</div>
