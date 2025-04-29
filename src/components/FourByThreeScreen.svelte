<script>
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
    } from "../screen";
    import { sleep, getRandomInt, preventZoom } from "../utils";
    // https://svelte.dev/repl/1d0b80898137445da24cf565830ce3f7?version=3.4.2
    let clazz = "";
    export { clazz as class };

    export let bg = "#000000";
</script>

<div class="fit-full-space select-none overflow-hidden text-3xl prevent-overscroll" style={bg ? "background-color:" + bg : ""} on:touchstart|preventDefault={preventZoom}>
    <div
        class="relative overflow-hidden select-none {clazz}"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px"
    >
        <slot />
    </div>
</div>

<style>
    :global(.prevent-overscroll) {
        overscroll-behavior: none;
        -webkit-overflow-scrolling: auto;
    }
</style>
