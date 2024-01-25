<script>
    import { elasticOut, cubicInOut, cubicOut } from "svelte/easing";
    import { shake, slideHit, scalePulse2 } from "./AnimSvelte.js";
    import { slide, fade } from "svelte/transition";

    export let character = null;
    export let dungeonLevel = 0;

    let currentHXP = 3;
    let maxHXP = 10;
</script>
<div class="relative flex flex-row-reverse text-4xl h-16 my-1">
    <div class="flex-center-all w-min border border-gray-600 bg-black/10 rounded-2xl px-3 h-16 mx-1"><i class="fa-solid fa-burst"></i>&nbsp;&nbsp;{character?.attackPower}</div>
    {#key character?.experience}
        <div in:scalePulse2|local={{ delay: 0, duration: 200 }} class="flex-center-all relative w-min border border-gray-600 bg-black/10 rounded-2xl px-3 h-16 mx-1">
            <i class="fa-solid fa-arrow-up-right-dots"></i>&nbsp;&nbsp;{character?.experience.toString().padStart(4, "0")}
            {#each Array(character.XPHealthDelta) as _, i}
                <div class="absolute -top-1 w-2 h-2 {i >= (character.experience - character.lastXPHealth) ? 'bg-gray-600':'bg-red-500'} rounded-full" style="left:{i*0.64 + 0.5}rem"></div>
            {/each}
        </div>
    {/key}
    <div class="flex-center-all w-min border border-gray-600 bg-black/10 rounded-2xl px-3 h-16 mx-1"><i class="fa-solid fa-stairs"></i>&nbsp;&nbsp;{dungeonLevel + 1}</div>
</div>
