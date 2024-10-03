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
    let started = true;
    let samplerOn = false;
    let height = 6;
    let width = 16;
    let grid = Array(height).fill().map(() => Array(width).fill(false));
    let current16thNote = 0;
    let loop;

    const sampleNames = ["kick", "snare", "clap", "closedhat", "hihat", "cymbal"];
    const players = new Tone.Players({
        kick: "samples/CYCdh_ElecK04-Kick02.wav",
        snare: "samples/CYCdh_ElecK04-Snr02.wav",
        clap: "samples/CYCdh_ElecK04-Clap.wav",
        closedhat: "samples/CYCdh_ElecK04-ClHat02.wav",
        hihat: "samples/CYCdh_ElecK04-HfHat.wav",
        cymbal: "samples/CYCdh_ElecK04-Cymbal02.wav",
    }).toDestination();
    const originalCount = sampleNames.length;

    let currentSampleIndex = -1;
    let recordedSamples = [];
    let editingSample = null; // Add this line

    onMount(() => {
        initializeGrid();
        initializeTone();

        return () => {
            const transport = Tone.getTransport();
            transport.stop();
            transport.cancel();
            loop?.dispose();
            players?.stopAll();
        };
    });

    function initializeGrid() {
        grid = Array(height).fill().map(() => Array(width).fill(false));
    }

    function initializeTone() {
        Tone.loaded().then(() => {
            loop = new Tone.Loop(playStep, width === 32 ? "32n" : "16n").start(0);
            const transport = Tone.getTransport();
            transport.bpm.value = bpm;
            transport.timeSignature = 4;
            transport.start();
        });
    }

    function playStep(time) {
        for (let y = 0; y < height; y++) {
            if (grid[y][current16thNote]) {
                const sampleName = sampleNames[y];
                if (!sampleName.startsWith('recorded_')) {
                    // Play built-in samples
                    players.player(sampleName).start(time);
                } else {
                    // Play recorded samples
                    const sampleIndex = parseInt(sampleName.split('_')[1]);
                    const sample = recordedSamples[sampleIndex];
                    if (sample) {
                        const player = players.player(sampleName);
                        player.start(time, sample.start, sample.duration);
                    }
                }
            }
        }
        current16thNote = (current16thNote + 1) % width;
    }

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
        if (grid[y][x]) return "rgb(20,184,166)";
        if (y === 0) return `rgb(${17 + highlight * 34},${24},39)`;
        highlight = (x + 4 * scale) % (8 * scale) === 0 ? 1 : 0;
        if (y === 1 || y === 2) return `rgb(${17 + highlight * 34},${24},39)`;
        highlight = (x + 2 * scale) % (4 * scale) === 0 ? 1 : 0;
        if (y === 3) return `rgb(${17 + highlight * 34},${24},39)`;
        return `rgb(${17},${24},39)`;
    }

    function updateBPM(delta) {
        bpm += delta;
        if (bpm < 20) bpm = 20;
        if (bpm > 200) bpm = 200;
        Tone.Transport.bpm.value = bpm;
    }

    function switchToSampler(index) {
        // Stop current playback
        const transport = Tone.getTransport();
        transport.stop();
        transport.cancel();

        // Reset the current16thNote
        current16thNote = 0;

        // Stop all players
        players.stopAll();

        // Switch to sampler mode
        samplerOn = true;
        currentSampleIndex = index;
        
        if (index === height) {
            // Creating a new sample
            editingSample = null;
        } else if (sampleNames[index].startsWith('recorded_')) {
            // Editing an existing recorded sample
            const sampleIndex = parseInt(sampleNames[index].split('_')[1]);
            editingSample = recordedSamples[sampleIndex];
        } else {
            // Replacing a built-in sample
            editingSample = null;
        }
    }

    function handleSamplerClose(event) {
        samplerOn = false;
        if (event.detail && event.detail.recordedBuffer) {
            const newSample = {
                buffer: event.detail.recordedBuffer,
                start: event.detail.startPosition * event.detail.recordedBuffer.duration,
                duration: (event.detail.stopPosition - event.detail.startPosition) * event.detail.recordedBuffer.duration,
            };
            
            if (currentSampleIndex === height) {
                // Adding a new recorded sample
                height += 1;
                grid = [...grid, Array(width).fill(false)];
                sampleNames.push(`recorded_${recordedSamples.length}`);
                recordedSamples.push(newSample);
                players.add(`recorded_${recordedSamples.length - 1}`, newSample.buffer);
            } else if (sampleNames[currentSampleIndex].startsWith('recorded_')) {
                // Replacing an existing recorded sample
                const sampleIndex = parseInt(sampleNames[currentSampleIndex].split('_')[1]);
                recordedSamples[sampleIndex] = newSample;
                players.player(`recorded_${sampleIndex}`).buffer.set(newSample.buffer);
            } else {
                // Replacing a built-in sample with a recorded one
                sampleNames[currentSampleIndex] = `recorded_${recordedSamples.length}`;
                recordedSamples.push(newSample);
                players.add(`recorded_${recordedSamples.length - 1}`, newSample.buffer);
            }
            
            // Force a re-render of the grid
            grid = [...grid];
        }
        currentSampleIndex = -1;

        // Reinitialize Tone.js
        initializeTone();
    }

    handleResize();
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
        <Sampler on:close={handleSamplerClose} editingSample={editingSample} />
    {:else}
        <div class="flex flex-col-reverse mt-48">
            {#each Array(height) as _, y}
                <div class="flex flex-row">
                    <div
                        class="w-20 h-20 m-2 flex-center-all text-3xl bg-cyan-950 rounded cursor-pointer"
                        on:pointerup={() => switchToSampler(y)}
                    >
                        {y < originalCount ? sampleNames[y].slice(0, 2).toUpperCase() : 'RC'}
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
                            <div
                                class="w-4 h-4 rounded-full {(current16thNote - 1) % width === x ? 'bg-teal-400' : 'bg-gray-950'}"
                            />
                        </div>
                    {/each}
                </div>
            {/each}
                    <div
                        class="w-20 h-20 m-2 flex-center-all text-3xl bg-cyan-950 rounded cursor-pointer"
                        on:pointerup={() => switchToSampler(height)}
                    >
                        +
                    </div>
        </div>
        <br />
        <!-- <button
            class="text-4xl bg-gray-800 p-4 rounded-lg mx-4"
            on:pointerup={() => {
                samplerOn = true;
            }}>+</button
        > -->
        <button class="text-4xl bg-gray-800 p-4 rounded-lg mx-4" on:pointerup={toggle}>Play / Pause</button>
        <button
            class="text-4xl bg-gray-800 p-4 rounded-lg ml-4 w-16"
            on:pointerup={() => updateBPM(-1)}>-</button
        >
        <span class="text-4xl bg-gray-900 p-4 rounded-lg">{bpm}</span>
        <button
            class="text-4xl bg-gray-800 p-4 rounded-lg mr-4 w-16"
            on:pointerup={() => updateBPM(1)}>+</button
        >
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