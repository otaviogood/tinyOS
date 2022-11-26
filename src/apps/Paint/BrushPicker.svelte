<script>
    import { createEventDispatcher } from "svelte";

    import ColorWheel from "./ColorWheel.svelte";
    // import Icons from "../../Icons.svelte";

    const dispatch = createEventDispatcher();

    export let colorStr;
    export let brushSize;
</script>

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
        border: 1px solid #909090;
        display: inline-block;
        border-radius: 80px;
    }
</style>

<div
    style="position:relative;background-color:#404040e0;border-radius:8px;padding:8px;margin:0;border:2px solid #808080;display:flex;align-items:center;">
    <!-- Range slider for brush size -->
    <div style="position:relative;height:256px;width:40px;margin:0px 8px 0 0;background-color:#80808080;border-radius:8px;">
        <div class="size-icons" style="top:84px;left:4px; width:32px;height:32px;"></div>
        <div class="size-icons" style="top:120px;left:8px; width:24px;height:24px;"></div>
        <div class="size-icons" style="top:148px;left:12px; width:16px;height:16px;"></div>
        <div style="position:absolute;top:214px;left:0px; width:40px;height:2px;background-color:#808080;display:inline-block;"></div>
        <input type="range" min="1" max="32" bind:value={brushSize} class="vol-slider" style="width:224px;margin:0"/>
    </div>
    <!-- Brush size visualizer -->
    <div style="position:absolute;bottom:8px;left:56px; background-color:#80808080;display:inline-block;width:36px;height:36px;border-radius:8px">
        <div style="position:absolute;bottom:{18 - brushSize / 2}px;left:{18 - brushSize / 2}px; background-color:white;display:inline-block;width:{brushSize}px;height:{brushSize}px;border-radius:{brushSize}px"></div>
    </div>
    <!-- Current color example -->
    <div style="position:absolute;top:8px;left:56px; background-color:{colorStr};display:inline-block;width:36px;height:36px;border-radius:8px"></div>
    <ColorWheel size={256} bind:colorStr on:change on:close />
    <!-- Close button -->
    <span style="position:absolute;top:6px;right:6px;pointer-events:auto" on:click={() => dispatch('close', {})}>
        <!-- <Icons img="close" size="40" color="#e0e0e0" hover="true" background="#00000060" /> -->
        <div class="cursor-pointer select-none rounded-full text-gray-200 text-5xl" ><i class="fas fa-times-circle"></i></div>
    </span>
    <span style="position:absolute;bottom:0px;right:6px;pointer-events:auto" on:click={() => dispatch('eyeDropper', {})}>
        <!-- <Icons img="eyeDropper" size="40" color="#e0e0e0" hover="true" background="#00000060" /> -->
        <div class="cursor-pointer select-none rounded-full text-gray-200 text-5xl" ><i class="fas fa-eye-dropper"></i></div>
    </span>
</div>
