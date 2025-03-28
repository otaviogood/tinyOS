<script>
    import { onMount, onDestroy } from "svelte";
    import { writable } from "svelte/store";
    import { tweened } from "svelte/motion";
    import { cubicOut } from "svelte/easing";
    import { slide, fade } from "svelte/transition";
    import Slider from "../../components/Slider.svelte";
    import FrequencyVisualizer from "./FrequencyVisualizer.svelte";
    import OctaveKeys from "./OctaveKeys.svelte";
    import * as Tone from "tone";
    import { AnalyserNode, OfflineAudioContext } from "standardized-audio-context";
    import { pxToRem, remToPx, handleResize } from "../../screen";
    import { createEventDispatcher } from "svelte";
    const dispatch = createEventDispatcher();

    export let editingSample = null; // Add this line

    // Add this near the top of your script
    const BPM = 80; // Placeholder BPM variable

    let canvas;
    let canvasCtx;
    let mic;
    let recorder;
    let recording = false;
    let player;
    let playing = false;
    let audioBuffer;
    let baseNote = "C4";
    let currentPlayingNote = null;
    let playbackPosition = 0;
    let analyser;
    let animationId;
    let volume = 100; // Initial volume value
    let volumeNode;
    let dominantFrequency = { frequency: 220, note: "A3" };
    let dominantFrequencyIndex = 0;
    let frequencyData = [];

    // Buffer to store waveform data over time
    const bufferDuration = 8; // 8 seconds of data to display
    const sampleRate = Tone.context.sampleRate;
    const bufferSize = bufferDuration * sampleRate;
    let currentBufferPosition = 0;

    $: indicatorPosition = audioBuffer
        ? (playbackPosition / (audioBuffer?.duration ?? bufferDuration) + $startPosition) * 100
        : 0;

    // Replace the regular variables with tweened stores
    let startPosition = tweened(0, {
        duration: 100,
        easing: cubicOut,
    });
    let stopPosition = tweened(1, {
        duration: 100,
        easing: cubicOut,
    });

    let isDragging = false;
    let draggedMarker = null;
    let canvasWidth;
    let canvasHeight;

    $: if (canvas) {
        canvasCtx = canvas.getContext("2d");
        // Set canvas dimensions to match its displayed size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
        // Redraw waveform when canvas size changes
        drawWaveform();
    }

    onMount(() => {
        // Any other initialization logic can go here
        canvasCtx = canvas.getContext("2d");
        // Set canvas dimensions to match its displayed size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;

        if (editingSample) loadExistingSample();

        drawWaveform();
    });

    // Add this function
    async function loadExistingSample() {
        audioBuffer = editingSample.buffer;
        startPosition.set(editingSample.start / audioBuffer.duration);
        stopPosition.set((editingSample.start + editingSample.duration) / audioBuffer.duration);
        volume = editingSample.volume;
    }

    // Clean up on component destroy
    onDestroy(() => {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (mic) {
            mic.close();
            mic.dispose();
            mic = null;
        }
        if (volumeNode) {
            volumeNode.dispose();
            volumeNode = null;
        }
        if (player) {
            player.stop();
            player.dispose();
            player = null;
        }
        if (recorder) recorder.dispose();
        if (analyser) analyser.dispose();
    });

    function drawWaveform() {
        if (!canvasCtx) return;

        // Only clear the canvas when not recording
        if (!recording) {
            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
            canvasCtx.fillStyle = "#0b1318"; // Dark background
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw beat tick marks
            const secondsPerBeat = 60 / BPM;
            const pixelsPerBeat = (canvas.width / bufferDuration) * secondsPerBeat;

            canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
            canvasCtx.lineWidth = 1;

            for (let i = 0; i < canvas.width; i += pixelsPerBeat) {
                canvasCtx.beginPath();
                canvasCtx.moveTo(i, 0);
                canvasCtx.lineTo(i, canvas.height);
                canvasCtx.stroke();
            }

            // Draw the 0 line
            canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.5)"; // Slightly brighter than beat marks
            canvasCtx.lineWidth = 1;
            canvasCtx.beginPath();
            canvasCtx.moveTo(0, canvas.height / 2);
            canvasCtx.lineTo(canvas.width, canvas.height / 2);
            canvasCtx.stroke();
        }

        // Draw accumulated waveform during recording
        if (recording && analyser) {
            // Get new data from analyser
            const waveform = analyser.getValue(); // Returns a Float32Array

            // Calculate how many samples we can draw in this frame
            const samplesToAdd = Math.min(waveform.length, bufferSize - currentBufferPosition);

            if (samplesToAdd > 0) {
                const sliceWidth = canvas.width / bufferSize;
                let x = (currentBufferPosition / bufferSize) * canvas.width;

                canvasCtx.lineWidth = 2;
                canvasCtx.strokeStyle = "#007aff"; // Blue for the waveform
                canvasCtx.beginPath();

                // Change: Draw one sample per pixel
                for (let i = 0; i < samplesToAdd; i++) {
                    const pixelIndex = Math.floor(x);
                    if (pixelIndex >= canvas.width) break;

                    const v = waveform[i]; // Value between -1 and 1
                    const y = ((v + 1) / 2) * canvas.height;

                    if (i === 0 && currentBufferPosition === 0) canvasCtx.moveTo(pixelIndex, y);
                    else canvasCtx.lineTo(pixelIndex, y);

                    x += sliceWidth;
                }

                canvasCtx.stroke();

                currentBufferPosition += samplesToAdd;

                // If we've filled the buffer, stop recording
                if (currentBufferPosition >= bufferSize) {
                    stopRecording();
                    return;
                }
            }
        }
        // Draw static waveform during playback or when idle
        else if (audioBuffer) {
            const channelData = audioBuffer.getChannelData(0);
            const audioBufferLength = audioBuffer.length;
            const samplesPerPixel = audioBufferLength / canvas.width;

            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = "#007aff"; // Blue for the waveform
            canvasCtx.beginPath();

            for (let i = 0; i < canvas.width; i++) {
                const startSample = Math.floor(i * samplesPerPixel);
                // Ok to sparse sample the audio data for visualization. Also faster.
                const y = ((1 - channelData[startSample]) / 2) * canvas.height;
                if (i === 0) canvasCtx.moveTo(i, y);
                else canvasCtx.lineTo(i, y);
            }

            canvasCtx.stroke();
        }

        // Only continue the animation if we're recording or playing
        if (recording || playing) {
            animationId = requestAnimationFrame(drawWaveform);
        }
    }

    function scheduleRecordingStop() {
        Tone.Transport.scheduleOnce(() => {
            if (recording) {
                // Auto-stopping recording after 8 seconds
                stopRecording();
            }
        }, `+${bufferDuration}`);
    }

    async function recordButton() {
        if (recording) return;

        try {
            recording = true;
            startPosition.set(0);
            stopPosition.set(1);
            await Tone.start();
            Tone.Transport.start();

            mic = new Tone.UserMedia();
            await mic.open();

            recorder = new Tone.Recorder();
            analyser = new Tone.Analyser("waveform", 1024);

            mic.connect(analyser);
            mic.connect(recorder);

            // Reset buffer position, clear audioBuffer
            audioBuffer = null;
            currentBufferPosition = 0;

            // Clear the canvas and start the drawing loop
            canvasCtx?.clearRect(0, 0, canvas.width, canvas.height);

            // Ensure any existing animation is stopped before starting a new one
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
            animationId = requestAnimationFrame(drawWaveform);

            recorder.start();

            // Schedule the recording to stop after 8 seconds
            scheduleRecordingStop();
        } catch (e) {
            console.error("Error starting recording:", e);
        }
    }

    let playbackStartTime = 0;

    async function playButton(note = "C4") {
        if (audioBuffer) {
            try {
                await Tone.start();
                console.log("note", note);

                const baseFreq = Tone.Frequency(baseNote).toFrequency();
                const noteFreq = Tone.Frequency(note).toFrequency();
                console.log(`Base Frequency: ${baseFreq}`);
                console.log(`Note Frequency: ${noteFreq}`);
                if (!baseFreq || !noteFreq) {
                    console.warn(`Frequency not found for note: ${note}`);
                    return;
                }
                currentPlayingNote = note;

                const playbackRate = noteFreq / baseFreq;

                // Stop and dispose of the current player if it exists
                if (player) {
                    player.stop();
                    player.dispose();
                    player = null;
                }

                // Create a new player instance
                player = new Tone.Player(audioBuffer);

                // Create a new volume node and connect it
                if (volumeNode) {
                    volumeNode.dispose();
                }
                volumeNode = new Tone.Volume().toDestination();
                player.connect(volumeNode);

                player.playbackRate = playbackRate;

                // Set initial volume
                updateVolume();

                playing = true;

                player.onstop = () => {
                    playing = false;
                    playbackPosition = 0;
                    currentPlayingNote = null;
                };

                // Start the animation for playback
                if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
                animationId = requestAnimationFrame(drawWaveform);

                // Modify the player start and duration
                const startTime = $startPosition * audioBuffer.duration;
                const duration = ($stopPosition - $startPosition) * audioBuffer.duration;
                player.start(undefined, startTime, duration);
                playbackStartTime = Tone.now();
                updatePlaybackPosition();
            } catch (error) {
                console.error("Error playing audio:", error);
            }
        }
    }

    function updatePlaybackPosition() {
        if (playing && player) {
            playbackPosition = Tone.now() - playbackStartTime;

            if (playbackPosition > audioBuffer.duration) {
                playbackPosition = audioBuffer.duration;
                playing = false;
                player.stop();
                playbackPosition = 0; // Reset position here
                currentPlayingNote = null;
                return;
            }
            // Update playback indicator
            requestAnimationFrame(updatePlaybackPosition);
        } else {
            playbackPosition = 0;
        }
    }

    async function stopButton() {
        // Stop recording
        if (recording) {
            await stopRecording();
        }

        // Stop playback
        if (playing && player) {
            playing = false;
            player.stop();
            playbackPosition = 0;
            currentPlayingNote = null;
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        }
        if (volumeNode) {
            volumeNode.dispose();
            volumeNode = null;
        }
    }

    function normalizeAudio(buffer, targetAmplitude) {
        let maxAmplitude = 0;
        const channelData = buffer.getChannelData(0);

        // Find the maximum amplitude
        for (let i = 0; i < channelData.length; i++) {
            const absValue = Math.abs(channelData[i]);
            if (absValue > maxAmplitude) {
                maxAmplitude = absValue;
            }
        }

        const scaleFactor = targetAmplitude / maxAmplitude;

        const normalizedBuffer = Tone.context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            const normalizedData = normalizedBuffer.getChannelData(channel);
            for (let i = 0; i < buffer.length; i++) {
                normalizedData[i] = channelData[i] * scaleFactor;
            }
        }

        return normalizedBuffer;
    }

    async function stopRecording() {
        if (recording) {
            try {
                recording = false;
                const recordedAudio = await recorder.stop();

                const recordingBlob = new Blob([recordedAudio], { type: "audio/wav" });

                // Create AudioBuffer from the recorded Blob
                const arrayBuffer = await recordingBlob.arrayBuffer();
                const tempAudioBuffer = await Tone.context.decodeAudioData(arrayBuffer);

                // Normalize the audio to 70% loudness
                const normalizedBuffer = normalizeAudio(tempAudioBuffer, 0.7);
                audioBuffer = normalizedBuffer;

                // Perform frequency analysis
                dominantFrequency = await findDominantFrequency();
                // if (dominantFrequency) {
                //     console.log(`Dominant Frequency: ${dominantFrequency.frequency.toFixed(2)} Hz`);
                // }

                // Clean up
                if (mic) {
                    await mic.close();
                    mic.dispose();
                    mic = null;
                }
                recorder.dispose();
                recorder = null;

                analyser.dispose();
                analyser = null;

                // Reset currentBufferPosition
                currentBufferPosition = 0;

                // Stop drawing waveform
                if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }

                // Draw the static waveform
                drawWaveform();

                // Make sure to stop the Tone.Transport
                Tone.Transport.stop();
                Tone.Transport.cancel(); // Clear any scheduled events
            } catch (e) {
                console.error("Error stopping recording:", e);
            }
        }
    }

    function findNearestZeroCrossing(position) {
        if (!audioBuffer) return position;

        const channelData = audioBuffer.getChannelData(0);
        const samplePosition = Math.floor(position * channelData.length);
        const searchRange = 1000; // Halved from 2000 as we search in both directions

        for (let i = 0; i < searchRange; i++) {
            const leftIndex = Math.max(0, samplePosition - i);
            const rightIndex = Math.min(channelData.length - 2, samplePosition + i);

            // Check left side
            if (channelData[leftIndex] * channelData[leftIndex + 1] <= 0) {
                return leftIndex / channelData.length;
            }

            // Check right side
            if (channelData[rightIndex] * channelData[rightIndex + 1] <= 0) {
                return rightIndex / channelData.length;
            }
        }

        return position;
    }

    function getPointerPos(ev) {
        let rect = canvas.getBoundingClientRect();
        const border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2); // * size;
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2); // * size;
        return [x, y];
    }

    function setDragPos(which, x) {
        if (!audioBuffer) return;
        const minSeparationSamples = 1024;
        const minSeparation = minSeparationSamples / audioBuffer.length;

        if (which === "start") {
            const maxStart = Math.min(x, $stopPosition - minSeparation);
            startPosition.set(Math.max(0, maxStart));
        } else {
            const minStop = Math.max(x, $startPosition + minSeparation);
            stopPosition.set(Math.min(1, minStop));
        }
        // console.log("start", $startPosition, "stop", $stopPosition);
    }

    function handleStart(event) {
        let xy = getPointerPos(event);
        let x = xy[0];

        const startDist = Math.abs(x - $startPosition);
        const stopDist = Math.abs(x - $stopPosition);

        isDragging = true;
        draggedMarker = startDist < stopDist ? "start" : "stop";
        setDragPos(draggedMarker, x);
    }

    async function handleMove(event) {
        if (!isDragging) return;

        let xy = getPointerPos(event);
        let x = Math.max(0, Math.min(1, xy[0]));

        setDragPos(draggedMarker, x);
        dominantFrequency = await findDominantFrequency();
        // if (dominantFrequency) console.log(`Dominant Frequency: ${dominantFrequency.frequency.toFixed(2)} Hz`);
    }

    async function handleEnd() {
        if (!isDragging) return;

        isDragging = false;
        if (draggedMarker === "start") {
            setDragPos("start", findNearestZeroCrossing($startPosition));
        } else {
            setDragPos("stop", findNearestZeroCrossing($stopPosition));
        }
        draggedMarker = null;
        dominantFrequency = await findDominantFrequency();
        // if (dominantFrequency) console.log(`Dominant Frequency: ${dominantFrequency.frequency.toFixed(2)} Hz`);
    }

    function handlePointerLeave(event) {
        if (isDragging) {
            handleMove(event);
        }
    }

    function closeAndReturnSample() {
        if (audioBuffer) {
            dispatch("close", {
                recordedBuffer: audioBuffer,
                startPosition: $startPosition,
                stopPosition: $stopPosition,
                volume: volume,
            });
        } else {
            dispatch("close", { recordedBuffer: null });
        }
    }

    // Add this function to handle volume changes
    function handleVolumeChange(event) {
        volume = event.detail.v;
        updateVolume();
    }

    // Add this function to update the volume using an exponential curve
    function updateVolume() {
        if (volumeNode) {
            // Use an exponential curve for volume mapping
            const exponent = 2.0; // You can experiment with this value
            const normalizedVolume = Math.pow(volume / 100, exponent) + 0.0001;

            // Convert the normalized volume to decibels
            const volumeInDecibels = Tone.gainToDb(normalizedVolume);

            // Set the volume immediately without ramping
            volumeNode.volume.value = volumeInDecibels;
        }
    }

    async function findDominantFrequency() {
        if (!audioBuffer) return null;

        const targetSampleRate = 8192; // Target sample rate to capture frequencies up to 8192 Hz

        let startTime = $startPosition * audioBuffer.duration;
        let duration = ($stopPosition - $startPosition) * audioBuffer.duration;

        if (duration <= 0) {
            console.warn("Invalid selection for frequency analysis: duration is zero or negative.");
            return null;
        }

        // Calculate the number of samples in the selected region
        const originalSampleStart = Math.floor(startTime * audioBuffer.sampleRate);
        const originalNumSamples = Math.floor(duration * audioBuffer.sampleRate);

        // Determine the appropriate fftSize (must be power of two between 32 and 8192)
        function getFftSize(n) {
            const minFftSize = 32;
            const maxFftSize = 8192; // Smaller fftSize since we have fewer samples
            let fftSize = minFftSize;
            while (fftSize * 2 <= n && fftSize < maxFftSize) {
                fftSize *= 2;
            }
            return fftSize;
        }

        const fftSize = getFftSize(originalNumSamples);

        // If the selected region is larger than fftSize, take the middle fftSize samples
        let analysisStartSample = originalSampleStart;
        if (originalNumSamples > fftSize) {
            analysisStartSample = originalSampleStart + Math.floor((originalNumSamples - fftSize) / 2);
        }

        // Downsample the audio buffer to the target sample rate
        const resampledBuffer = await resampleBuffer(
            audioBuffer,
            audioBuffer.sampleRate,
            targetSampleRate,
            analysisStartSample,
            Math.min(fftSize, originalNumSamples) // Ensure we don't exceed the selected region
        );

        // Create an OfflineAudioContext with the resampled buffer's sample rate
        const offlineContext = new OfflineAudioContext(resampledBuffer.numberOfChannels, fftSize, targetSampleRate);

        // Create a buffer with the appropriate size (fftSize)
        const extractedBuffer = offlineContext.createBuffer(resampledBuffer.numberOfChannels, fftSize, targetSampleRate);

        // Copy data from the resampled buffer to the new buffer
        for (let channel = 0; channel < resampledBuffer.numberOfChannels; channel++) {
            const sourceData = resampledBuffer.getChannelData(channel);
            const destData = extractedBuffer.getChannelData(channel);

            // Ensure we don't exceed the source data length
            const len = Math.min(fftSize, sourceData.length);
            destData.set(sourceData.subarray(0, len));

            // Zero-pad if necessary
            if (len < destData.length) {
                destData.fill(0, len);
            }
        }

        // Set up the audio processing chain
        const source = offlineContext.createBufferSource();
        source.buffer = extractedBuffer;

        const analyser = offlineContext.createAnalyser();
        analyser.fftSize = fftSize;

        source.connect(analyser);
        analyser.connect(offlineContext.destination);

        source.start(0);

        // Render the audio
        await offlineContext.startRendering();

        // Get the frequency data from the analyser
        const dataArray = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(dataArray);

        // Store the frequency data for visualization (up to 8192 Hz)
        frequencyData = Array.from(dataArray);

        // Find the peak frequency bin within the entire range (up to 8192 Hz)
        let maxIndex = 0;
        let maxValue = -Infinity;
        for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxValue) {
                maxValue = dataArray[i];
                maxIndex = i;
            }
        }
        dominantFrequencyIndex = maxIndex;

        // Calculate the dominant frequency
        const nyquist = targetSampleRate / 2;
        const freqBinWidth = nyquist / analyser.frequencyBinCount;
        const bestFreq = maxIndex * freqBinWidth;

        // console.log(`Dominant Frequency: ${bestFreq.toFixed(2)} Hz`);

        // Use Tone.js to get the closest note
        const closestNote = Tone.Frequency(bestFreq).toNote();
        baseNote = closestNote;

        // console.log(`Closest note: ${closestNote}`);
        return { frequency: bestFreq, note: closestNote };
    }

    async function resampleBuffer(buffer, originalSampleRate, targetSampleRate, startSample, numSamples) {
        const resampleContext = new OfflineAudioContext(
            buffer.numberOfChannels,
            Math.ceil((numSamples * targetSampleRate) / originalSampleRate),
            targetSampleRate
        );

        const resampleSource = resampleContext.createBufferSource();

        // Extract the portion of the buffer we want to resample
        const segmentBuffer = resampleContext.createBuffer(buffer.numberOfChannels, numSamples, originalSampleRate);

        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const sourceData = buffer.getChannelData(channel);
            const segmentData = segmentBuffer.getChannelData(channel);
            segmentData.set(sourceData.subarray(startSample, startSample + numSamples));
        }

        resampleSource.buffer = segmentBuffer;

        resampleSource.connect(resampleContext.destination);
        resampleSource.start();

        const resampledBuffer = await resampleContext.startRendering();
        return resampledBuffer;
    }

    function handlePlayNoteEvent(event) {
        const note = event.detail.note;
        console.log("nOtE", note);
        playButton(note);
    }

    handleResize();
</script>

<svelte:window on:pointermove={handleMove} on:pointerup={handleEnd} />

<div class="container flex-center-all flex-col">
    <div class="h-4" />
    <div
        class="waveform-container relative w-[95rem] h-[32rem] mb-36"
        on:pointerdown={handleStart}
        on:pointerleave={handlePointerLeave}
    >
        <canvas id="waveform" width="800" height="400" style="width:100%;height:100%" bind:this={canvas} />
        {#if playing}
            <div id="playback-indicator" style="left: {indicatorPosition}%;" />
        {/if}
        <div class="bg-black/50 absolute top-0 left-0 h-full" style="width:{$startPosition * 100}%" />
        <div class="bg-black/50 absolute top-0 h-full" style="width:{(1 - $stopPosition) * 100}%;right:0px" />
        <div class="marker start-marker" style="left: {$startPosition * 100}%;" />
        <div class="marker stop-marker" style="left: {$stopPosition * 100}%;" />
    </div>
    <div class="button-container">
        <div class="button-row">
            <button on:pointerdown={recordButton} class="btn" disabled={recording || playing}>
                {#if recording}
                    <i class="fa-solid fa-circle-dot text-red-600 btn-text" />
                {:else}
                    <i class="fa-solid fa-circle text-red-600 btn-text" />
                {/if}
            </button>
            <button on:pointerdown={stopButton} class="btn" disabled={!recording && !playing}>
                <i class="fa-solid fa-stop text-[#60b0ff] btn-text" />
            </button>
            <button on:pointerdown={() => playButton(baseNote)} class="btn" disabled={!audioBuffer}>
                <i class="fa-solid fa-play text-[#60b0ff] btn-text" />
            </button>
        </div>
        <button
            on:pointerup={closeAndReturnSample}
            class="btn absolute top-[46.3rem] right-12 text-5xl ml-auto"
            style="border-radius:3.75rem"
        >
            <i class="fa-solid fa-check text-[#60b0ff] btn-text" style="font-size:4rem" />
        </button>
        <div class="absolute top-[46.5rem] left-9 w-[30rem]">
            <Slider
                size={7.5 * 2}
                label=""
                units=""
                val={volume}
                min={0}
                max={100}
                selected={true}
                color="#2a8acf"
                colorBgOuter=""
                colorBgInner="#181820"
                colorIndicator="#c0e0f0"
                minimal
                styleInner="outline: .3rem solid #80afe0;box-shadow: 0 0 1rem rgba(137, 229, 255, 0.6);"
                on:change={handleVolumeChange}
            />
        </div>

        {#if frequencyData.length > 0}
            <div in:fade={{ duration: 1000 }} class="absolute top-[35rem] left-[2.5rem] w-[95rem] h-[8rem]">
                <FrequencyVisualizer
                    data={frequencyData}
                    width={remToPx(95)}
                    height={remToPx(8)}
                    dominantFrequency={dominantFrequencyIndex}
                    dominantNote={dominantFrequency.note}
                    currentPlayingNote={currentPlayingNote}
                />
            </div>
        {/if}
        {#if audioBuffer}
            <div in:fade={{ duration: 1000 }}>
                <OctaveKeys rotation={0} highlightNote={dominantFrequency.note} on:playnote={handlePlayNoteEvent} />
            </div>
        {/if}
    </div>
</div>

<style>
    :global(body) {
        background-color: #1e1e1e;
        color: #ffffff;
    }

    .btn-text {
        filter: drop-shadow(0 0 0.4rem rgba(255, 255, 255, 0.3));
        font-size: 3rem;
    }

    .container {
        /* max-width: 800px; */
        margin: 0 auto;
    }

    .waveform-container {
        background-color: #2c2c2e;
        /* border-radius: 8px; */
        overflow: hidden;
        /* box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 0 10px rgba(0, 122, 255, 0.3); */
        /* border: 20px solid #007aff; */
    }

    #playback-indicator {
        position: absolute;
        top: 0;
        height: 100%;
        width: 2px;
        background: #ff7aff;
        pointer-events: none;
        transform: translateX(-1px);
    }

    .button-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        /* max-width: 400px; */
        margin-top: 2rem;
    }

    .button-row {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 32rem;
        height: 12rem;
        gap: 2rem;
        margin-bottom: 4rem;
        border: 0.5rem solid #080f18;
        border-radius: 6rem;
    }

    .btn {
        /* transition: all 0.2s ease; */
        border: 0.4rem solid transparent;
        width: 7.5rem;
        height: 7.5rem;
        border-radius: 100%;
        cursor: pointer;
        background-color: #1a1a1a;
        border-color: #80afe0;
        box-shadow: 0 0 1rem rgba(137, 229, 255, 0.6);
        @apply active:scale-110 transform transition-all duration-75;
    }

    .btn:hover:not(:disabled) {
        background-color: #3a3a3c;
    }

    .btn:active:not(:disabled) {
        /* transform: scale(0.98); */
    }

    .btn:disabled {
        /* border-color: #203040;
        box-shadow: 0 0 1rem rgba(137, 229, 255, 0.13); */
        opacity: 0.25;
        cursor: not-allowed;
    }

    .btn-primary {
        background-color: #1a1a1a;
        border-color: #007aff;
        box-shadow: 0 0 1remx rgba(0, 122, 255, 0.3);
    }

    .btn-primary:hover:not(:disabled) {
        background-color: #2a2a2a;
        box-shadow: 0 0 1.5rem rgba(0, 122, 255, 0.5);
    }

    .btn-done {
        width: 100%;
        background-color: #1a1a1a;
        border-color: #006faa;
        box-shadow: 0 0 1rem rgba(0, 255, 170, 0.3);
    }

    .btn-done:hover:not(:disabled) {
        background-color: #2a2a2a;
        box-shadow: 0 0 1.5rem rgba(0, 255, 170, 0.5);
    }

    .marker {
        position: absolute;
        top: 0;
        width: 2px;
        height: 100%;
        background: linear-gradient(to bottom, #ff7aff 0%, transparent 50%, #ff7aff 100%);
        cursor: move;
        margin-left: -1px;
    }

    .marker::before {
        content: "";
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 0.6rem solid transparent;
        border-right: 0.6rem solid transparent;
    }

    .start-marker::before {
        border-top: 1rem solid #ff7aff;
    }

    .stop-marker::before {
        border-top: 1rem solid #ff7aff;
    }
</style>
