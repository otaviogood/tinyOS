<script>
    // @ts-nocheck
    import { createEventDispatcher } from 'svelte';
    export let colors = [];
    export let selectedIndex = 0;
    export let ariaLabelPrefix = 'color';
    const dispatch = createEventDispatcher();
    function onSelect(i) {
        if (!Number.isFinite(i)) return;
        const clamped = Math.max(0, Math.min(colors.length - 1, i | 0));
        if (clamped === selectedIndex) return;
        selectedIndex = clamped;
        dispatch('change', clamped);
    }
</script>

<div class="flex items-center gap-2 bg-black bg-opacity-50 p-2 rounded">
    {#each colors as hex, i}
        <button
            type="button"
            class="w-7 h-7 rounded-sm"
            aria-label={`${ariaLabelPrefix} ${i}`}
            style="background-color: {`#${hex.toString(16).padStart(6,'0')}`}; {i === selectedIndex ? 'outline: 3px solid white; outline-offset: 2px;' : 'outline: 1px solid rgba(255,255,255,0.3); outline-offset: 2px;'}"
            on:click={() => onSelect(i)}
        />
    {/each}
    <slot />
    <!-- optional right-side content -->
    
</div>

<style>
</style>


