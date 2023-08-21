<script>
    import { onMount } from "svelte";
    import { pop } from "svelte-spa-router";
    import { slide, fade } from "svelte/transition";
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
    } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import * as Tone from "tone";
    import Sampler from "./Sampler.svelte";

    let bpm = 80;
    let started = false;
    let samplerOn = false;
    let height = 6;
    let width = 16;
    let grid = [];
    for (let y = 0; y < height; y++) {
            grid[y] = [];
            for (let x = 0; x < width; x++) {
                grid[y][x] = false;
            }
        }
        console.log("MusicSequencer onMount2");

    onMount(() => {
        console.log("MusicSequencer onMount");
        height = 6;
        width = 16;
        grid = [];
        for (let y = 0; y < height; y++) {
            grid[y] = [];
            for (let x = 0; x < width; x++) {
                grid[y][x] = false;
            }
        }
        grid = grid;

        return () => {
            Tone.Transport.stop();
            players?.stopAll();
        };
    });

    function tick() {}

    handleResize();

    // // create two monophonic synths
    // const synthA = new Tone.FMSynth().toDestination();
    // const synthB = new Tone.AMSynth().toDestination();
    // //play a note every quarter-note
    // const loopA = new Tone.Loop((time) => {
    //     synthA.triggerAttackRelease("C2", "8n", time);
    // }, "4n").start(0);
    // //play another note every off quarter-note, by starting it "8n"
    // const loopB = new Tone.Loop((time) => {
    //     synthB.triggerAttackRelease("C4", "8n", time);
    // }, "4n").start("8n");
    // // the loops start when the Transport is started
    // Tone.Transport.start();
    // ramp up to 800 bpm over 10 seconds
    // Tone.Transport.bpm.rampTo(800, 10);

    // const player = new Tone.Player("https://tonejs.github.io/audio/berklee/gong_1.mp3").toDestination();
    // Tone.loaded().then(() => {
    //     player.start();
    // });
    let current16thNote = 0;
    const players = new Tone.Players({
        "kick": "samples/CYCdh_ElecK04-Kick02.wav",
        "snare": "samples/CYCdh_ElecK04-Snr02.wav",
        "clap": "samples/CYCdh_ElecK04-Clap.wav",
        "closedhat": "samples/CYCdh_ElecK04-ClHat02.wav",
        "hihat": "samples/CYCdh_ElecK04-HfHat.wav",
        "cymbal": "samples/CYCdh_ElecK04-Cymbal02.wav",
    }).toDestination();
    Tone.loaded().then(() => {
        // players.player("kick").start();

        const loop = new Tone.Loop(
            (time) => {
                // triggered every sixteenth note.
                // console.log(time);
                for (let y = 0; y < height; y++) {
                    // if (grid[y][current16thNote]) synthA.triggerAttackRelease(["C3", "D3", "E3", "F3", "G3", "A4", "B4", "C4"][y], "16n", time);
                    // if (grid[y][current16thNote]) players.player("kick").start();
                }
                if (grid[0][current16thNote]) players.player("kick").start();
                if (grid[1][current16thNote]) players.player("snare").start();
                if (grid[2][current16thNote]) players.player("clap").start();
                if (grid[3][current16thNote]) players.player("closedhat").start();
                if (grid[4][current16thNote]) players.player("hihat").start();
                if (grid[5][current16thNote]) players.player("cymbal").start();

                // if (grid[0][current16thNote]) synthA.triggerAttackRelease("C4", "16n", time);
                current16thNote = (current16thNote + 1) % width;
            },
            width === 32 ? "32n" : "16n"
        ).start(0);
        Tone.Transport.bpm.value = bpm;
        Tone.Transport.timeSignature = 4;
        Tone.Transport.start();
        // Tone.Transport.schedule((time) => {
        //     // use the time argument to schedule a callback with Draw
        //     Tone.Draw.schedule(() => {
        //         // do drawing or DOM manipulation here
        //         console.log(time);
        //     }, time);
        // }, "+0.5");
    });

    function pressGrid(x, y) {
        grid[y][x] = !grid[y][x];
        grid = grid;
    }

    function pause() {
        Tone.Transport.pause();
    }
    function resume() {
        Tone.Transport.start();
    }
    async function toggle() {
        await Tone.start();
        Tone.Transport.toggle();
    }

    function colorizeCell(grid, x, y) {
        let scale = width / 16;
        let highlight = x % (8 * scale) === 0 ? 1 : 0;
        // if (x % 4 === 0) highlight = 1;
        if (grid[y][x]) return "rgb(20,184,166)";
        if (y === 0) return `rgb(${17 + highlight * 34},${24},39)`;
        highlight = (x + 4 * scale) % (8 * scale) === 0 ? 1 : 0;
        if (y === 1 || y === 2) return `rgb(${17 + highlight * 34},${24},39)`;
        highlight = (x + 2 * scale) % (4 * scale) === 0 ? 1 : 0;
        if (y === 3) return `rgb(${17 + highlight * 34},${24},39)`;
        return `rgb(${17},${24},39)`;
    }

    started = true;
</script>

<FourByThreeScreen bg="black">
    {#if !started}
        <div class="flex-center-all h-full w-full flex flex-col bg-black">
            <img
                src="TinyQuest/gamedata/listensounds/otavio_beats_and_dj_and_speakers_and_lights_vector_art_25a81f5b-ef79-412c-ae84-6a30e5c42481.webp"
                class="absolute"
                alt="skyscraper"
                style="height:74rem"
            />
            <!-- <div
                in:fade={{ duration: 2000 }}
                class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1 w-[70rem] text-center"
                style="margin-top:25rem;background:linear-gradient(.25turn, #40101000, #f01080f0, #40101000);"
            >
                {town?.name}
            </div> -->
            <button
                in:fade={{ duration: 2000 }}
                class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                style="margin-top:25rem"
                on:pointerup|preventDefault|stopPropagation={async () => {
                    await Tone.start();
                    started = true;
                }}>START</button
            >
        </div>
    {:else if samplerOn}
        <Sampler />
    {:else}
        <div class="flex flex-col-reverse mt-48">
            {#each Array(height) as _, y}
                <div class="flex flex-row">
                    <div
                        class="w-10 h-20 m-2 flex-center-all text-3xl bg-red-900 rounded cursor-pointer"
                        on:pointerup={() => {
                            void 0;
                        }}
                    >
                        {["KI", "SN", "CL", "CH", "HH", "CY"][y]}
                    </div>
                    {#each Array(width) as _, x}
                        <div
                            class="flex-center-all {width === 32
                                ? 'w-10 h-20 m-1'
                                : 'w-20 h-20 m-2'} rounded-lg border-[0.2rem] border-gray-800 {grid[y][x]
                                ? 'bg-teal-500'
                                : 'bg-gray-900'}"
                            style="background-color: {colorizeCell(grid, x, y)};"
                            on:pointerup={() => {
                                pressGrid(x, y);
                            }}
                        >
                            <!-- <div class="text-4xl text-gray-500">{x},{y}</div> -->
                            <div
                                class="w-4 h-4 rounded-full {(current16thNote - 1) % width === x ? 'bg-teal-400' : 'bg-black'}"
                            />
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
        <br />
        <!-- <button
            class="text-4xl bg-gray-800 p-4 rounded-lg mx-4"
            on:pointerup={() => {
                samplerOn = true;
            }}>+</button
        > -->
        <button class="text-4xl bg-gray-800 p-4 rounded-lg mx-4" on:pointerup={toggle}>Play / Pause</button>
        <button class="text-4xl bg-gray-800 p-4 rounded-lg ml-4 w-16" on:pointerup={() => {bpm--;Tone.Transport.bpm.value = bpm;}}>-</button>
        <span class="text-4xl bg-gray-900 p-4 rounded-lg">{bpm}</span>
        <button class="text-4xl bg-gray-800 p-4 rounded-lg mr-4 w-16" on:pointerup={() => {bpm++;Tone.Transport.bpm.value = bpm;}}>+</button>
        <!-- <button class="text-4xl bg-gray-800 p-4 rounded-lg mx-4" on:pointerup={() => Tone.start()}>START</button> -->
        <!-- <button class="text-4xl bg-gray-800 p-4 rounded-lg mx-4" on:pointerup={pause}>Pause</button>
            <button class="text-4xl bg-gray-800 p-4 rounded-lg mx-4" on:pointerup={resume}>Resume</button> -->
        <div
            class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl z-40"
            on:pointerup={pop}
        >
            <i class="fas fa-times-circle" />
        </div>
    {/if}
</FourByThreeScreen>
