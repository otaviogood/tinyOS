<script>
    import { pop } from "svelte-spa-router";
    import SVGArcDeg from "../components/SVGArcDeg.svelte";
    import { slide, fade } from "svelte/transition";

    // export let delay = 2;
    export let confirm = false;
    export let topRem;
    export let rightRem;

    let mousePressed = false;
    let pressedTime = 0;
    let pressedOnce = false;

    function handlePointerdown(e) {
        mousePressed = true;
        pressedTime = Date.now();
        // setTimeout(() => {
        //     if (mousePressed) {
        //         pop();
        //     }
        // }, delay * 1000);
    }
    function handlePointermove(e) {}
    function handlePointerup(e) {
        if (!confirm) pop();
        else {
            if (pressedOnce) {
                pressedOnce = false;
                pop();
                return;
            }
            pressedOnce = true;
            mousePressed = false;
            // if (Date.now() - pressedTime > delay * 1000) {
            //     pop();
            // }
        }
    }
    function handlePointerleave(e) {
        mousePressed = false;
    }
</script>

<!-- <div
    class="absolute top-1 right-1 cursor-pointer select-none text-gray-500 overflow-visible bg-pinXXk-600 w-48 h-48"
>
    <SVGArcDeg class="absolute top-0 right-0" color="#ff0000" startAngle={0} endAngle={359.7} radius={37} thick={14} />
</div> -->
{#if pressedOnce}
    <div in:fade={{ duration: 500 }}
        class="fit-full-space bg-black/80 overflow-visible z-[1]"
        on:pointerup|preventDefault|stopPropagation={() => {
            pressedOnce = false;
        }}
    />
{/if}
<div
    class="absolute top-1 right-1 cursor-pointer select-none rounded-full text-gray-500 z-[1]"
    style="font-size:4.5rem;line-height:1;{topRem && `top:${topRem}rem;`}{rightRem && `right:${rightRem}rem;`}"
    on:pointerdown|preventDefault|stopPropagation={handlePointerdown}
    on:pointerup={handlePointerup}
    on:pointermove|preventDefault|stopPropagation={handlePointermove}
    on:pointerleave={handlePointerleave}
    on:touchend={handlePointerup}
    on:touchcancel={handlePointerup}
>
    {#if pressedOnce}
        <!-- <i class="fas fa-times-circle" /> -->
        <i class="fas fa-times bg-red-500 text-white rounded-full w-16 h-16 p-9 flex-center-all text-5xl" />
    {:else}
        <!-- <i class="fas fa-times-circle" /> -->
        <i class="fas fa-times bg-gray-300 text-gray-700 rounded-full w-16 h-16 p-9 flex-center-all text-5xl" />
        <!-- <div class="bg-red-500 text-white rounded-full w-16 h-16 p-9 flex-center-all" >X</div> -->
    {/if}
</div>

<style>
    .rotate {
        animation: rotate 1.5s linear infinite;
    }
    @keyframes rotate {
        to {
            transform: rotate(360deg);
        }
    }
</style>
