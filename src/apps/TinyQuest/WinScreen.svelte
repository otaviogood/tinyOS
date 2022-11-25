<script>
    import { slide, fade } from "svelte/transition";
    import { spin } from "./Transitions";
    import IconsMisc from "./IconsMisc.svelte";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let style = "";
    export let maxStars = 6;
    export let active = false;
    export let bg = "rgba(253, 230, 138)";
    export let compact = false;
</script>

{#if active}
    <div in:fade class="flex-center-all h-full w-full" {style}>
        <div in:fade class="flex-center-all flex-col p-4" style="min-width:66rem;min-height:50rem;border-radius:8rem;background-color:{bg}">
            {#if !compact}
                <div in:spin={{ duration: 4000 }} class="text-red-400 text-9xl font-bold select-none">WIN</div>
                <div in:spin={{ duration: 4000 }} class="flex flex-row">
                    {#each Array(maxStars) as _}
                        <!-- <IconsMisc icon="coin-1" size="6rem" style="margin:0.5rem"></IconsMisc> -->
                        <span>
                            <i class="fas text-yellow-400 fa-star text-9xl select-none" style="margin:2.5rem 1rem 3.5rem 1rem" />
                        </span>
                    {/each}
                </div>
            {/if}
            <div class="flex flex-row" style="transform:scale({compact?0.5:1.0})">
                <button
                    in:fade={{ duration: 4000 }}
                    class="bg-red-500 text-white px-6 mx-8"
                    style="width:20rem;height:20rem;border-radius:5rem;font-size:12rem"
                    on:pointerup|preventDefault|stopPropagation={() => dispatch("startGame")}><i class="fa fa-refresh" aria-hidden="true" /></button
                >
                <div
                    in:fade={{ duration: 4000 }}
                    class="cursor-pointer select-none mx-8"
                    style="background-color:#486870;padding:1rem;border-radius:5rem;width:20rem;height:20rem;"
                    on:pointerup|preventDefault|stopPropagation={() => dispatch("resetToSplashScreen")}
                >
                    <IconsMisc icon="treasure-map" size="18rem" style="" />
                </div>
            </div>
        </div>
    </div>
{/if}
