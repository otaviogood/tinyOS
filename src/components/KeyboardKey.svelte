<script>
    import { preventZoom } from "../utils";
    import { createEventDispatcher } from "svelte";
    import { caseMe } from "../utils";

    const dispatch = createEventDispatcher();

    export let keyLetter = "";
    export let width = "7rem";
    export let height = "7rem";
    export let marginLeft = "0rem";
    export let split = false;
    export let active = true;

    let myElement;
    // Returns pointer pos as an [x, y] array in [0..1] range.
    // Also sets mouseScreen to be in [0..width, 0..height] range.
    function getPointerPos(ev) {
        var rect = myElement.getBoundingClientRect();
        let border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2); // * width;
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2); // * height;
        // mouseScreen = [x * rect.width, y * rect.height];
        let pointerXY = [x, y]; // [Math.floor(x), Math.floor(y)];
        return pointerXY;
    }

    function onPointerUp(event) {
        // calculate mouse position in normalized device coordinates
        let xy = getPointerPos(event);
        let side = 0;
        if (split) {
            if (xy[0] < 0.5) side = 0;
            else side = 1;
        }
        dispatch('pressed', {
			key: keyLetter,
            side: side,
            xy: xy
		})
    }

</script>

<div bind:this={myElement}
    class="m-1 bg-pink-200 text-pink-700 flex-center-all text-6xl font-bold rounded-xl relative active:scale-110 transform transition-all duration-75"
    style="width:{width};height:{height};margin-left:{marginLeft};opacity:{active?1:0.4}"
    on:pointerdown|preventDefault|stopPropagation={onPointerUp}
>
    {#if split}
        <div class="w-1 h-4 top-0 bg-pink-400 absolute"></div>
        <div class="w-1 h-4 bottom-0 bg-pink-400 absolute"></div>
    {/if}
    <slot>{caseMe(keyLetter)}</slot>
</div>
