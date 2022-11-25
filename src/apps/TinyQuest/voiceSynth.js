import { sleep } from "./util";

// All the sounds from https://en.wikipedia.org/wiki/Phonics
export const snd_phonemes = new Howl({
    src: ["ShortVowelsNoisedLoudness_01.mp3"],
    sprite: {
        // Short vowels
        a0: [2638, 439],
        e0: [4393, 306],
        i0: [6222, 284],
        o0: [8109, 350],
        u0: [10168, 260],
        oo0: [11998, 272],
        // Long vowels
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
        th40: [118138 - 40000, 427],
        th41: [119662 - 40000, 437],
        gz4: [121744 - 40000, 479],
        zh4: [123620 - 40000, 430],
    },
});

export const words = {
    cat: ["ck3", "a0", "t3"],
    hello: ["h3", "e0", "l3", "o1"],
    there: ["th41", "air2"],
    zina: ["z3", "e1", "n3", "u0"],
};

export async function sayWord(word) {
    for (let i = 0; i < word.length; i++) {
        snd_phonemes.play(word[i]);
        // console.log(len)
        let len = snd_phonemes._sprite[word[i]][1];
        await sleep(len * 0.6);
    }
}

export async function saySentence(wordList) {
    for (let j = 0; j < wordList.length; j++) {
        let wordString = wordList[j];
        let word = words[wordString];
        for (let i = 0; i < word.length; i++) {
            snd_phonemes.play(word[i]);
            // console.log(len)
            let len = snd_phonemes._sprite[word[i]][1];
            await sleep(len * 0.6);
        }
        await sleep(300);
    }
}

// snd_sprite.play("a");
// snd_phonemes.play("ck3");
// let len = snd_phonemes._sprite["ck3"][1];
// console.log(len)
// await sleep(len * 0.7);
// snd_phonemes.play("a0");
// len = snd_phonemes._sprite["a0"][1];
// await sleep(len * 0.7);
// snd_phonemes.play("t3");
// sayWord(["ck3", "a0", "t3"]);
// sayWord(["h3", "e0", "l3", "o1"]);
// await sleep(1300);
// sayWord(["th41", "air2"]);
// saySentence(["hello", "there", "zina"]);
