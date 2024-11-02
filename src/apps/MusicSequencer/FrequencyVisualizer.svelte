<script>
    export let data = [];
    export let width = 800;
    export let height = 200;
    export let dominantFrequency = 0; // index into data.

    $: points = data.length > 0
        ? data
            .map((value, index) => {
                const x = (index / data.length) * width;
                const y = Math.max(0, Math.min(height, ((value + 140) / 140) * height)); // Clamp values
                return `${x},${height - y}`;
            })
            .join(" ")
        : "";

    $: dominantFrequencyX = data.length > 0 ? (dominantFrequency / data.length) * width : 0;
</script>

{#if data.length > 0}
    <svg {width} {height}>
        <polyline {points} fill="none" stroke="#60b0ff" stroke-width="2" />
        <line
            x1={dominantFrequencyX}
            y1="0"
            x2={dominantFrequencyX}
            y2={height}
            stroke="#ff6060"
            stroke-width="2"
            stroke-opacity="0.3"
        />
    </svg>
{:else}
    <svg {width} {height}>
        <text x={width / 2} y={height / 2} text-anchor="middle" fill="#60b0ff">No data available</text>
    </svg>
{/if}

<style>
    svg {
        background-color: #0b1318;
        border-radius: 4px;
    }
</style>
