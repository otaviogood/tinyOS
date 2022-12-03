<script>
    import { createEventDispatcher } from "svelte";
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

    import ColorWheel from "./ColorWheel.svelte";
    // import Icons from "../../Icons.svelte";

    const dispatch = createEventDispatcher();

    export let scale = 2;
    export let colorStr;
    export let brushSize;

    function getPointerPos(ev) {
        let rect = ev.target.getBoundingClientRect();
        const border = 0;
        let x = ((ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2));// * size;
        let y = ((ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2));// * size;
        return [x, y];
    }

    let pressed = false;
    function setBrushSize(e, down) {
        if (down === -1) pressed = false;
        if (!pressed && down == 0) return;
        if (down === 1) pressed = down;
        if (!e) return;
        let xy = getPointerPos(e);
        let y = 1-xy[1];
        brushSize = y*100;
        brushSize = Math.max(brushSize, 1);
        dispatch("brushSize", brushSize);
    }
</script>

<div
    style="position:relative;background-color:#404040;border-radius:{1*scale}rem;padding:{.5*scale}rem;margin:0;border:{.25*scale}rem solid #606060;display:flex;align-items:center;">
    <!-- Range slider for brush size -->
    <div style="position:relative;height:{20*scale}rem;width:{3*scale}rem;margin:0 {.6*scale}rem 0 0;background-color:#80808080;border-radius:{.6*scale}rem;" on:pointerdown={(e) => setBrushSize(e, 1)} on:pointermove={(e) => setBrushSize(e, 0)} on:pointerup={(e) => setBrushSize(e, -1)} on:pointerout={(e) => setBrushSize(undefined, -1)}>
        <div class="size-icons pointer-events-none" style="top:{6.5*scale}rem;left:{0.3*scale}rem; width:{2.4*scale}rem;height:{2.4*scale}rem;"></div>
        <div class="size-icons pointer-events-none" style="top:{9.3*scale}rem;left:{0.6*scale}rem; width:{1.9*scale}rem;height:{1.9*scale}rem;"></div>
        <div class="size-icons pointer-events-none" style="top:{11.8*scale}rem;left:{0.9*scale}rem; width:{1.2*scale}rem;height:{1.2*scale}rem;"></div>
        <!-- <div style="pointer-events:none;position:absolute;top:{16.9*scale}rem;left:0; width:{3*scale}rem;height:{.2*scale}rem;background-color:#707070;display:inline-block;"></div> -->
        <div style="pointer-events:none;position:absolute;bottom:calc({brushSize*.2*scale}rem + {-.1*scale}rem);left:0; width:{3*scale}rem;height:{.2*scale}rem;background-color:#ffffff;display:inline-block;border-radius:10%"></div>
        <!-- <input type="range" min="1" max="32" bind:value={brushSize} class="vol-slider" style="width:{18*scale}rem;margin:0"/> -->
    </div>
    <!-- Brush size visualizer -->
    <div style="position:absolute;bottom:{.6*scale}rem;left:{4.25*scale}rem; background-color:#80808080;display:inline-block;width:{2.8*scale}rem;height:{2.8*scale}rem;border-radius:{.6*scale}rem">
        <div style="position:absolute;bottom:calc({-brushSize / 2}px + {1.4*scale}rem);left:calc({-brushSize / 2}px + {1.4*scale}rem); background-color:white;display:inline-block;width:{brushSize}px;height:{brushSize}px;border-radius:{brushSize}px"></div>
    </div>
    <!-- Current color example -->
    <div style="position:absolute;top:{.6*scale}rem;left:{4.25*scale}rem; background-color:{colorStr};display:inline-block;width:{2.8*scale}rem;height:{2.8*scale}rem;border-radius:{.6*scale}rem"></div>
    <ColorWheel size={($bigScale*.2*scale) | 0} bind:colorStr on:change on:close />
    <!-- Close button -->
    <span style="position:absolute;top:{.5*scale}rem;right:{.4*scale}rem;pointer-events:auto" on:click={() => dispatch('close', {})}>
        <!-- <Icons img="close" size="40" color="#e0e0e0" hover="true" background="#00000060" /> -->
        <div class="cursor-pointer select-none rounded-full text-gray-200" style="font-size:{3*scale}rem;line-height:1" ><i class="fas fa-times-circle"></i></div>
    </span>
    <span style="position:absolute;bottom:{.4*scale}rem;right:{.4*scale}rem;pointer-events:auto" on:click={() => dispatch('eyeDropper', {})}>
        <!-- <Icons img="eyeDropper" size="40" color="#e0e0e0" hover="true" background="#00000060" /> -->
        <div class="cursor-pointer select-none rounded-full text-gray-200" style="font-size:{3*scale}rem;line-height:1" ><i class="fas fa-eye-dropper"></i></div>
    </span>
</div>

<style>
    input[type="range"] {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(270deg);
    }

    .size-icons {
        position: absolute;
        background-color: #808080;
        border: .1rem solid #909090;
        display: inline-block;
        border-radius: 100%;
    }
</style>
