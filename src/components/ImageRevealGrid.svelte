<!-- An image component that will be covered by a canvas. The canvas will have an alpha channel that will reveal the image underneath. -->
<script>
    import { preventZoom } from "../utils";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Animator, frameCount, animateCount } from "../animator";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let style = "";
    let clazz = "";
    export { clazz as class };

    export let src;
    export let stage = 0;
    export let maxStages = 2;
    export let active = false;
    export let remainingReveals = 16;

    let animator = new Animator(60, tick);

    let gridSize = 4;
    let grid = [];
    for (let i = 0; i < gridSize*gridSize; i++) grid.push(1);
    grid = grid;

    function tick() {
    }

    function setGrid(x, y, i) {
        grid[x + y*gridSize] = i;
        grid = grid;
    }
    function getGrid(x, y) {
        return grid[x + y*gridSize];
    }

    function clearGrid(x, y) {
        setGrid(x, y, 0);
        remainingReveals--;
    }
    onMount(() => {
        remainingReveals = 16;
        animator.start();

        return () => {
            animator.stop();
        };
    });

    function onPointerUp(x, y) {
        if (!active) return;
        if (getGrid(x, y) == 0) return;
        clearGrid(x, y);
        dispatch('pressed', {
			x: x,
            y: y,
		})
    }

</script>

<div class="relative XXXborder border-black {clazz}" {style}>
    <!-- <div class="absolute bottom-0 right-0 bg-red-800 w-64 h-10 z-50 text-2xl" style="">{currentInterpolation}</div> -->
    <img {src} class="absolute top-0 left-0" style="width:100%;height:100%;" on:touchstart={preventZoom} alt="reveal"/>
    <!-- Make a grid of square divs on top of the img to cover it. -->
    {#key grid}
        {#each Array(gridSize) as _, y}
            {#each Array(gridSize) as _, x}
                {#if getGrid(x, y) == 1}
                    <div out:fade class="absolute top-0 left-0 flex-center-all {active ? 'bg-pink-200' : 'bg-pink-100'} border border-pink-300 text-red-400 rounded-3xl text-8xl font-bold active:scale-110 transform transition-all duration-75" style="width:calc(100%/{gridSize});height:calc(100%/{gridSize});top:{y*100/gridSize}%;left:{x*100/gridSize}%;" on:pointerup={() => (onPointerUp(x,y))}>
                        {#if active}
                            <div out:fade>?</div>
                        {/if}
                    </div>
                {/if}
            {/each}
        {/each}
    {/key}
</div>
