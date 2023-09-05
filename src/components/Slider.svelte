<script>
    import { createEventDispatcher } from "svelte";
    const dispatch = createEventDispatcher();

    export let label = "POSITION";
    export let units = "";
    export let min = 0;
    export let max = 100;
    export let digits = 1; // Digits after decimal point that are displayed
    export let color = "#2aaa82";
    export let selected = false;
    export let readonly = false;
    export let size = 10;
    export let style = "";
    let clazz = "";
    export { clazz as class };
    export let val = 0.0;// Number.NaN;//Math.random() * (max-min) + min;
    export let setVal = null;

    let clickable;

    $: fractionSet = setVal ? Math.max(0.0, Math.min(1.0, (setVal[0] - min) / (max - min))) : 0;
    $: sliderPos = val >= 0 ? val / max : -val / min;


    // Returns pointer pos as an [x, y] array in [0..1] range.
    // Also sets mouseScreen to be in [0..width, 0..height] range.
    function getPointerPos(ev) {
        var rect = clickable.getBoundingClientRect();
        let border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2); // * width;
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2); // * height;
        // mouseScreen = [x * rect.width, y * rect.height];
        return [x, y]; // [Math.floor(x), Math.floor(y)];
    }

    let pointerXY = [-1, -1];
    let lastXY = [-1, -1];
    let pointerDownXY = [-1, -1];
    let pointerPressed = false;
    function pointerDown(e) {
        // console.log("pointerDown", readonly, selected);
        if (readonly || !selected) return;
        pointerPressed = true;
        pointerXY = getPointerPos(e);
        pointerDownXY = [...pointerXY];
        lastXY = [...pointerXY];
    }
    function pointerMove(e) {
        if (readonly || !selected) return;
        // console.log("pointerMove", readonly, selected);
        if (!pointerPressed) return;
        myLatestTap = null;
        pointerXY = getPointerPos(e);
        let dx = pointerXY[0] - lastXY[0];
        if (dx === 0) return;
        if (!setVal) setVal = [val];
        // let startVal = setVal?.[0] ?? val;
        setVal[0] = Math.max(min, Math.min(max, setVal[0] + dx * (max - min)));
        lastXY = [...pointerXY];
        dispatch("change", {v:setVal[0]});
    }
    let myLatestTap;
    function pointerUp(e) {
        if (readonly || !selected) return;
        pointerPressed = false;

        // Manually implement double-click because it doesn't work on ipad.
        var now = new Date().getTime();
        var timesince = now - myLatestTap;
        if (timesince < 600 && timesince > 0) dblclick(e);
        myLatestTap = new Date().getTime();
    }
    // Double click resets to 0.
    function dblclick(e) {
        if (readonly || !selected) return;
        // setVal[0] = 0.0;
        // dispatch("change", {v:setVal[0]});
    }
</script>

<div
    class="flex flex-col w-full bg-gray-800 overflow-hidden {clazz}"
    style="widXXXth:{size * 15}rem;height:{size * .45}rem;font-size:{size * 0.16}rem;line-height:{size*0.2}rem;{style}"
    on:pointermove|preventDefault|stopPropagation={pointerMove}
    on:pointerup|preventDefault|stopPropagation={pointerUp}
    on:pointercancel={() => {pointerPressed = false}}
    on:pointerleave={() => {pointerPressed = false}}
>
    <div
        bind:this={clickable}
        class="{pointerPressed ? 'bg-gray-800' : 'bg-gray-700'} w-fXull h-full relative flex-center-all overflow-hidden"
        style="margin:{size*0.032}rem;margin-left:{size * 0.193}rem;margin-right:{size * 0.193}rem;border-radius:{size * 0.032}rem;{selected ? 'outline: .15rem solid #ff1060;' : ''}{pointerPressed ? 'outline: .3rem solid #b0b0b0;' : ''}"
        on:pointerdown|preventDefault|stopPropagation={pointerDown}
        on:pointermove|preventDefault|stopPropagation={pointerMove}
        on:pointerup|preventDefault|stopPropagation={pointerUp}
    >
        <div class="absolute w-full pointer-events-none" style="height:12%;background-color:{color[0] === "#" ? color + "40" : color}" />
        <!-- <div class="absolute h-full pointer-events-none" style="width:{fractionA * 100}%;left:0%;background-color:{color}" /> -->
        {#if sliderPos >= 0}
            <div class="absolute h-full pointer-events-none" style="width:{sliderPos * max * 100 / (max - min) }%;left:{100*(-min) / (max - min)}%;background-color:{color}" />
        {:else}
            <div class="absolute h-full pointer-events-none" style="width:{sliderPos * min * 100 / (max - min) }%;right:{100*(max) / (max - min)}%;background-color:{color}" />
        {/if}
        <!-- <div class="absolute h-full pointer-events-none" style="width:{Math.abs(sliderPos * 0.5)}%;{sliderPos < 0 ? 'right:50%;' : 'left:50%;'}background-color:{color}" /> -->
        {#if setVal}
            <div class="absolute pointer-events-none top-0 arrow-down {!selected ? 'invisible' : ''}" style="left:{fractionSet * 100}%;" />
            <div class="absolute h-full w-full pointer-events-none text-base {!selected ? 'invisible' : ''}" style="font-size:{size * 0.096}rem;padding-left:{size*0.032}rem;top:{size*0.225}rem;color:#ff1060;text-align:left;" >{setVal?.[0].toFixed(digits) ?? ""}</div>
        {/if}
        {#if (min < 0) && (max > 0)}
            <div class="absolute bottom-0 h-1/2 pointer-events-none" style="width:{size * 0.1}%;left:{100*(0 - min) / (max - min)}%;background-color:#d0d0d0b0" />
        {/if}
        <div class="absolute h-full w-full pointer-events-none" style="padding-right:{size*0.032}rem;color:{pointerPressed ? '#ffffffa0' : '#ffffffd0'};text-align:right;" >{label}<br/>{val.toFixed(digits)} {units}</div>
        <div class="absolute h-full w-full pointer-events-none text-base" style="font-size:{size * 0.096}rem;padding-left:{size*0.032}rem;color:{pointerPressed ? '#ffffffa0' : '#ffffff80'};text-align:left;" >[{min.toFixed(digits)}..{max.toFixed(digits)}]</div>
    </div>
</div>

<style>
    .arrow-down {
        width: 0; 
        height: 0; 
        border-left: .7em solid transparent;
        border-right: .7em solid transparent;
        
        border-top: .7em solid #ff1060;
        margin-left:-.7em;
    }
</style>
