<script>
    export let a = 0;
    export let b = 0;
    export let c = 0;
    export let size = 10;
    export let outlineColor = "#909090";
    export let rotate = 0;

    const fgColors = ["#109010", "#1010f0", "#f01010"];
    const bgColors = ["#ffff90", "#90f0ff", "#ffc0ff"];
</script>

<span
    class="flex flex-col justify-center items-center rounded-full active:scale-105 transform transition-all duration-75"
    style="border:{size * 0.04}rem solid {outlineColor};width:{size}rem;height:{size}rem;font-size:{size * 0.66666}rem;color:{fgColors[b | 0]};background-color:{bgColors[c | 0]}; transform:rotate({rotate}deg)"
>
    {#if a === 0}
        <i class="fas fa-car-side" />
    {:else if a === 1}
        <i class="fas fa-bus" />
    {:else if a === 2}
        <i class="fas fa-bicycle" />
    {:else}
        <i class="fas fa-fw fa-hat-cowboy" />
    {/if}
</span>
