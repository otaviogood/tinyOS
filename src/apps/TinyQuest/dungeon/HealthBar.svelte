<script>
    import { elasticOut, cubicInOut, cubicOut } from "svelte/easing";
    import { scalePulse } from "./AnimSvelte.js";

    export let health = 1;
    export let maxHealth = 2;
    export let left = true;
    export let r = 185;
    export let g = 28;
    export let b = 28;

</script>

<div class="relative w-full h-16 my-1 select-none">
    <div class="absolute w-full h-16" style="background-color:rgb({~~(r *0.6)},{~~(g *0.6)},{~~(b *0.6)});border-radius:{left?'0px 1rem 1rem 0px':'1rem 0px 0px 1rem'}"></div>
    {#key health}
        <div in:scalePulse|local={{ delay: 0, duration: 1200 }} class="absolute h-16" style="background-color:rgb({r},{g},{b}); border-radius:{left?'0px 1rem 1rem 0px':'1rem 0px 0px 1rem'};width:{100*health/maxHealth}%;{left?'':'right:0px'}"></div>
    {/key}
    {#each Array(maxHealth) as _, i}
        <div class="absolute w-1 h-6 mt-5 -ml-1 rounded-full" style="left:{100*(i + (left?0:1))/maxHealth}%;border-left:.5rem solid #00000030"></div>
    {/each}
    <div class="absolute text-6xl w-full h-16 px-4 {left?'':'text-right'}">{health}/{maxHealth}</div>
</div>
