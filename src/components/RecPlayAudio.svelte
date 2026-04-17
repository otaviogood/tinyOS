<script>
    import { onMount } from "svelte";
    import * as Tone from "tone";

    let recorder = null;
    let mic = null;
    let recording;
    let player;
    let level = 0;
    let playing = false;
    let isOpeningMic = false;
    let isRecording = false;
    let isStopping = false;
    let isLoading = false;
    let meterInterval = null;
    let meter = null;
    let recordingUrl = null;

    onMount(() => {
        return () => {
            try {
                if (meterInterval) clearInterval(meterInterval);
            } catch (e) {
                // ignore
            }
            meterInterval = null;
            meter?.dispose?.();
            meter = null;

            try {
                player?.stop?.();
            } catch (e) {
                // ignore
            }
            player?.dispose?.();

            try {
                recorder?.stop?.();
            } catch (e) {
                // ignore
            }
            recorder?.dispose?.();

            try {
                mic?.close?.();
            } catch (e) {
                // ignore
            }
            mic?.dispose?.();

            if (recordingUrl) URL.revokeObjectURL(recordingUrl);
            recordingUrl = null;
        };
    });

    async function recordButton() {
        if (isOpeningMic || isRecording || isStopping || isLoading) return;
        isOpeningMic = true;
        level = 0;

        try {
            // Ensure AudioContext is unlocked on a user gesture
            await Tone.start();

            try {
                player?.stop?.();
            } catch (e) {
                // ignore
            }
            playing = false;

            // Reset old meter/interval
            if (meterInterval) clearInterval(meterInterval);
            meterInterval = null;
            meter?.dispose?.();
            meter = null;

            meter = new Tone.Meter();
            mic?.dispose?.();
            recorder?.dispose?.();
            mic = new Tone.UserMedia();
            recorder = new Tone.Recorder();
            mic.connect(meter);
            mic.connect(recorder);

            await mic.open();

            meterInterval = setInterval(() => {
                // meter is in dB, usually negative
                level = (meter?.getValue?.() ?? -80) + 80;
                level = level < 0 ? 0 : level;
                level = level > 100 ? 100 : level;
            }, 16);

            recorder.start();
            isRecording = true;
        } catch (e) {
            // User denied mic, or audio context/mic open failed
            console.error(e);
            isRecording = false;
            try {
                if (meterInterval) clearInterval(meterInterval);
            } catch (err) {
                // ignore
            }
            meterInterval = null;
            meter?.dispose?.();
            meter = null;

            try {
                recorder?.dispose?.();
            } catch (err) {
                // ignore
            }
            recorder = null;

            try {
                mic?.close?.();
            } catch (err) {
                // ignore
            }
            mic?.dispose?.();
            mic = null;
        } finally {
            isOpeningMic = false;
        }
    }

    async function playButton() {
        if (isOpeningMic || isStopping || isLoading) return;
        if (!player || !recording) return;

        if (playing) {
            try {
                player.stop();
            } catch (e) {
                console.error(e);
            }
            playing = false;
            return;
        }

        try {
            await Tone.start();
            player.start();
            playing = true;
        } catch (e) {
            // Can happen if buffer isn't decoded/loaded yet
            console.error(e);
            playing = false;
        }
    }
    async function stopRecordingButton() {
        if (isStopping || isLoading) return;
        if (!recorder || !isRecording) {
            // Prevent "'start' must be called before 'stop'"
            return;
        }

        isStopping = true;
        playing = false;

        try {
            // Stop meter updates ASAP
            if (meterInterval) clearInterval(meterInterval);
            meterInterval = null;
            meter?.dispose?.();
            meter = null;
            level = 0;

            // the recorded audio is returned as a blob
            const blob = await recorder.stop();
            isRecording = false;

            recorder?.dispose?.();
            mic?.close?.();
            mic?.dispose?.();
            recorder = null;
            mic = null;

            if (!blob || !blob.size) {
                // Avoid "Decoding failed" from trying to decode empty audio
                recording = null;
                return;
            }

            recording = blob;

            try {
                player?.stop?.();
            } catch (e) {
                // ignore
            }
            player?.dispose?.();

            // create a player and load the recorded blob
            player = new Tone.Player().toDestination();
            player.onstop = () => {
                playing = false;
            };

            if (recordingUrl) URL.revokeObjectURL(recordingUrl);
            recordingUrl = URL.createObjectURL(recording);

            isLoading = true;
            await player.load(recordingUrl);
        } catch (e) {
            console.error(e);
        } finally {
            isLoading = false;
            isStopping = false;
        }

    }
</script>

<div class="flex select-none">
    <div>
        {#if !recorder}
            <button
                class="{recorder ? 'bg-indigo-600' : 'bg-red-600'} text-white text-9xl m-2 p-10 {recording
                    ? 'rounded-l-full'
                    : 'rounded-full'}"
                style={recorder ? "box-shadow: 0px 0px 2rem 2rem #38f;" : ""}
                disabled={isOpeningMic || isStopping || isLoading}
                on:pointerdown={recordButton}>REC</button
            >
        {:else}
            <button
                class="fit-full-space bg-purple-600 text-white text-9xl"
                disabled={isOpeningMic || isStopping || isLoading || !isRecording}
                on:pointerdown={stopRecordingButton}>STOP</button
            >
        {/if}
    </div>
    {#if recording}
        <div>
            <button
                class="{playing ? 'bg-green-950 text-gray-500' : 'bg-green-600 text-white'} active:bg-green-800 text-9xl m-2 p-10 rounded-r-full select-none"
                style="width:26rem"
                disabled={isOpeningMic || isStopping || isLoading || !player}
                on:pointerdown={playButton}>{playing ? 'STOP' : 'PLAY'}</button
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
