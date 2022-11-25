<script>
    import IconsMisc from "./IconsMisc.svelte";
    import { preventZoom } from "./util";
    import { spin } from "./Transitions";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let maxStars = 6;
    export let starCount = 0;
    export let bg = "#ffffff";
</script>

<div class="border-yellow-300 flex flex-none flex-col text-center w-44 z-10" style="border-width:0.75rem;border-radius:6rem;background-color:{bg}" on:touchstart={preventZoom}>
    <div class="p-4" on:touchstart={preventZoom} />
    <div class="w-full h-44 flex-center-all" style="padding:0.75rem;" on:touchstart={preventZoom}>
        <div class="cursor-pointer select-none" style="padding:0 0.75rem;border-radius:0.75rem;backXXXground-color:#486870" on:pointerup|preventDefault|stopPropagation on:touchstart={preventZoom}>
            <IconsMisc icon="treasure-map" size="7.5rem" style="" />
        </div>
    </div>
    <div class="flex-center-all flex-col" on:touchstart={preventZoom}>
        {#each Array(starCount) as _, i}
            <div in:spin={{ duration: 8000 }} class="relative" style="margin:0.5rem" on:touchstart={preventZoom}>
                <i class="fas text-yellow-400 fa-star text-8xl p-1" on:touchstart={preventZoom} />
                <div class="absolute inset-1/2 text-7xl text-white" style="margin: -2.0rem -1.4rem" on:touchstart={preventZoom}>{i + 1}</div>
            </div>
        {/each}
        {#each Array(maxStars - starCount) as _, i}
            <div class="relative" style="margin:0.5rem" on:touchstart={preventZoom}>
                <!-- <IconsMisc icon="coin" size="6rem" style="opacity:0.25"></IconsMisc> -->
                <!-- <i class="fas text-yellow-400 fa-star text-8xl p-1" /> -->
                <i class="far text-yellow-200 fa-star text-8xl p-1" on:touchstart={preventZoom} />
            </div>
        {/each}
    </div>
    <slot></slot>
</div>
