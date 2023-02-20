<script>
    import { onMount } from "svelte";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../utils";
    import * as Tone from "tone";

    let recorder = null;
    let mic = null;
    let recording;
    let player;
    let debugStr = "";
    let level = 0;
    let playing = false;

    onMount(() => {
        return () => {
            player?.stop();
            player?.dispose();
            recorder?.stop();
            recorder?.dispose();
            mic?.close();
            mic?.dispose();
        };
    });

    async function recordButton() {
        player?.stop();
        playing = false;
        const meter = new Tone.Meter();
        mic = new Tone.UserMedia();
        recorder = new Tone.Recorder();
        mic.connect(meter);
        mic.connect(recorder);

        mic.open()
            .then(() => {
                // promise resolves when input is available
                // console.log("mic open");
                // print the incoming mic levels in decibels
                setInterval(() => {
                    level = meter.getValue() + 80;
                    level = level < 0 ? 0 : level;
                    level = level > 100 ? 100 : level;
                    // console.log(level);
                }, 16.6);
                recorder.start();
            })
            .catch((e) => {
                // promise is rejected when the user doesn't have or allow mic access
                console.log("mic not open");
            });
    }

    async function playButton() {
        player?.stop();
        playing = false;

        // start playing the recorded audio
        player.start();
        playing = true;
    }
    async function stopButton() {
        // the recorded audio is returned as a blob
        recording = await recorder.stop();
        // console.log("recording stopped", recording);
        recorder?.dispose();
        mic?.close();
        mic?.dispose();
        recorder = null;

        player?.stop();
        player?.dispose();
        // create a player and load the recorded blob
        player = new Tone.Player().toDestination();
        player.onstop = () => {
            playing = false;
        };
        const url = URL.createObjectURL(recording);
        await player.load(url);

    }
</script>

<div class="flex">
    <div>
        {#if !recorder}
            <button
                class="{recorder ? 'bg-indigo-600' : 'bg-red-600'} text-white text-9xl m-2 p-10 {recording
                    ? 'rounded-l-full'
                    : 'rounded-full'}"
                style={recorder ? "box-shadow: 0px 0px 2rem 2rem #38f;" : ""}
                on:pointerdown={recordButton}>REC</button
            >
        {:else}
            <button
                class="fit-full-space bg-purple-600 text-white text-9xl"
                on:pointerdown={stopButton}>STOP</button
            >
        {/if}
    </div>
    {#if recording}
        <div>
            <button
                class="{playing ? 'bg-emerald-400' : 'bg-green-600'} active:bg-green-800 text-white text-9xl m-2 p-10 rounded-r-full"
                style="width:26rem"
                on:pointerdown={playButton}>PLAY</button
            >
        </div>
    {:else}
        <div>
            <button class="text-white text-9xl m-2 p-10 rounded-r-full" style="width:26rem;background-color:#90909020"
                >&nbsp;</button
            >
        </div>
    {/if}
    <!-- <div class="text-3xl">{debugStr}</div> -->
    <div class="flex flex-row absolute top-1 left-1">
        {#if level}
            {#each Array(Math.abs(Math.trunc(level)) + 1) as _, i}
                <div class="text-3xl w-2 h-8 bg-pink-500 m-1" />
            {/each}
        {/if}
    </div>
</div>
