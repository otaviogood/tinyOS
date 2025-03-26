<script>
    import { createEventDispatcher } from 'svelte';
    import { onMount } from "svelte";
    import { scale } from 'svelte/transition';
    import * as Tone from "tone";
    import { frequencies } from "./frequencies.js"; // Ensure this path is correct

    export let highlightNote = "C4"; // The note to highlight
    export let rotation = 0; // Rotation angle in degrees (0, 90, 180, 270)

    const dispatch = createEventDispatcher();

    const notesInOctave = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let octave = 4;
    
    // Define x-positions for all keys (both white and black)
    const keyPositions = [
        0,    // C
        1, // C#
        1,    // D
        2, // D#
        2,    // E
        3,    // F
        4, // F#
        4,    // G
        5, // G#
        5,    // A
        6, // A#
        6,    // B
        7     // C (next octave)
    ];

    let keys = [];
    let activeKey = null;

    // Generate the keys for the octave based on the highlightNote's octave
    $: {
        octave = parseInt(highlightNote.slice(-1), 10);
        keys = [...notesInOctave, "C"].map((note, index) => {
            const fullNote = `${note}${index === notesInOctave.length ? octave + 1 : octave}`;
            return {
                note: fullNote,
                isSharp: note.includes("#"),
                isHighlighted: fullNote === highlightNote,
                xPosition: keyPositions[index] / 7, // Normalize to 0-1 range
            };
        });
    }

    onMount(() => {
    });

    function handlePointerDown(event, key) {
        activeKey = key.note;
        dispatch('playnote', { note: key.note, octave: octave });
    }

    function handlePointerUp() {
        activeKey = null;
    }
</script>

<div class="piano-keyboard absolute bottom-16 right-8" 
     style="transform: rotate({rotation}deg);"
     on:pointerup={handlePointerUp}>
    {#each keys as key}
        <div
            class="key {key.isSharp ? 'black-key' : 'white-key'} {key.isHighlighted ? 'highlight' : ''} transition-transform duration-100 origin-top"
            class:scale-95={activeKey === key.note}
            style="left: {key.xPosition * 100}%;"
            on:pointerdown|preventDefault={(e) => handlePointerDown(e, key)}
        >
            <div class="{key.isSharp ? 'black-key-highlight' : 'white-key-highlight'}" />
        </div>
    {/each}
</div>

<style>
    .piano-keyboard {
        position: relative;
        height: 17rem;
        user-select: none;
        touch-action: none;
        width: 45rem;
    }

    .key {
        position: absolute;
        box-sizing: border-box;
        cursor: pointer;
        user-select: none;
        transform-origin: top; /* Fallback for browsers that don't support Tailwind's origin-top */
    }

    .white-key {
        width: 14.28%; /* 100% / 7 */
        border: 1px solid #000;
        background: #abc;
        height: 100%;
        z-index: 1;
        border-radius: 0.5rem;
    }

    .black-key {
        width: 8%;
        height: 60%;
        background: #000;
        z-index: 2;
        margin-left: -4%;
        border-radius: 0.5rem;
    }

    .white-key-highlight {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 99%;
        background: linear-gradient(to bottom, rgba(55,205,255,0.6) 0%, rgba(255,55,255,0.1) 100%);
        border-radius: 0.5rem 0.5rem 0 0;
        pointer-events: none;
    }

    .black-key-highlight {
        position: absolute;
        top: 0;
        left: 0;
        width: 80%;
        height: 92%;
        background: linear-gradient(135deg, rgba(55,205,255,0.532) 0%, rgba(255,55,255,0.1) 50%, rgba(255,155,255,0.3) 100%);
        border-radius: 0.4rem;
        pointer-events: none;
    }

    .highlight {
        background: #ffffff;
        box-shadow: inset 0 0 15px 5px #0acaff;
        border: .25rem solid #37b;
    }
</style>