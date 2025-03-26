<script>
    import { slide, fade } from "svelte/transition";
    import { frequencies } from "./frequencies.js";

    export let data = [];
    export let width = 800;
    export let height = 200;
    export let dominantFrequency = 0; // index into data.
    export let dominantNote = ''; // Add dominantNote prop
    export let sampleRate = 8192;    // Add sampleRate prop
    export let fftSize = data.length; // Add fftSize prop, default to data length
    export let currentPlayingNote = null; // Add this new prop

    // Add this line near the top of the script
    let gradientId = `highlight-gradient-${Math.random().toString(36).substr(2, 9)}`;

    // Calculate the maximum frequency represented in the data
    const maxFrequency = sampleRate / 2; // Nyquist frequency

    $: points = data.length > 0
        ? data
            .map((value, index) => {
                const x = (index / data.length) * width;
                const y = Math.max(0, Math.min(height, ((value + 140) / 140) * height)); // Clamp values
                return `${x},${height - y}`;
            })
            .join(" ")
        : "";

    $: dominantFrequencyX = data.length > 0 ? (dominantFrequency / data.length) * width : 0;

    // Function to map frequency to x position (linear scale)
    function frequencyToX(freq) {
        return (freq / maxFrequency) * width;
    }

    // Create tick marks for each frequency note, including sharps
    function generateTickMarks() {
        const octaves = [1, 2, 3, 4, 5, 6, 7];
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const tickMarks = [];

        for (const octave of octaves) {
            for (const note of notes) {
                const fullNote = `${note}${octave}`;
                if (frequencies[fullNote]) {
                    const x = frequencyToX(frequencies[fullNote]);
                    if (x >= 0 && x <= width) {
                        tickMarks.push({
                            x,
                            note: fullNote,
                            freq: frequencies[fullNote],
                            isC: note === 'C',
                            isSharp: note.includes('#')
                        });
                    }
                }
            }
        }

        return tickMarks;
    }

    $: tickMarks = generateTickMarks();
    $: dominantNoteX = frequencyToX(frequencies[dominantNote] || 0);

    // Function to calculate the width of the highlight rectangle
    function calculateHighlightWidth(note) {
        if (!note || !frequencies[note]) return 0;
        return frequencies[note]*.015;
    }

    $: currentPlayingNoteX = frequencyToX(frequencies[currentPlayingNote] || 0);
    $: currentPlayingNoteWidth = calculateHighlightWidth(currentPlayingNote);
</script>

{#if data.length > 0}
    <svg {width} {height}>
        <!-- Add this gradient definition -->
        <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#4b008200" />
                <stop offset="50%" stop-color="#6fcfff" />
                <stop offset="100%" stop-color="#8a2be200" />
            </linearGradient>
        </defs>

        <polyline {points} fill="none" stroke="#70e080" stroke-width="2" />
        <line
            x1={dominantFrequencyX}
            y1="0"
            x2={dominantFrequencyX}
            y2={height}
            stroke="#20a0ff"
            stroke-width="3"
            stroke-opacity="0.5"
        />
        <line
            x1={dominantNoteX}
            y1="0"
            x2={dominantNoteX}
            y2={height}
            stroke="#ff60ff"
            stroke-width="2"
            stroke-opacity="0.3"
        />
        <!-- Add tick marks -->
        {#each tickMarks as mark}
            <line
                x1={mark.x}
                y1="0"
                x2={mark.x}
                y2={mark.isC ? 15 : mark.isSharp ? 5 : 10}
                stroke={mark.isC ? "#70e0ff" : mark.isSharp ? "#205020" : "#50a060"}
                stroke-width={mark.isC ? 2 : 1}
            />
            <!-- Optionally, add text labels for the notes, Just the C's, but not the C#'s, not including C0 and C1 -->
            {#if mark.isC}
                <text x={mark.x} y="25" text-anchor="middle" font-size="10" fill="#70e0e0">
                    {mark.note}
                </text>
            {/if}
        {/each}
        {#if dominantNote}
            <text x={dominantNoteX} y={height - 10} text-anchor="middle" font-size="12" fill="#e0e0e0">
                {dominantNote}
            </text>
        {/if}

        <!-- Update the highlight rectangle -->
        {#if currentPlayingNote && frequencies[currentPlayingNote]}
            <rect
                x={currentPlayingNoteX - currentPlayingNoteWidth / 2}
                y="0"
                width={currentPlayingNoteWidth}
                height={height}
                fill={`url(#${gradientId})`}
                opacity="0.82"
            />
        {/if}
    </svg>
{:else}
    <svg {width} {height}>
        <text x={width / 2} y={height / 2} text-anchor="middle" fill="#60b0ff">No data available</text>
    </svg>
{/if}

<style>
    svg {
        background-color: #0b1318;
        border-radius: 4px;
    }
    text {
        user-select: none;
    }
</style>