<script>
    export let keyPromise;
</script>

<div class="fit-full-space bg-gray-900 z-10 text-4xl">
    {#await keyPromise}
        <p>...waiting</p>
    {:then keys}
        {#each keys as key, i}
            <div>asd {key}</div>
        {/each}
        <p>The keys is {keys}</p>
    {:catch error}
        <p style="color: red">{error.message}</p>
    {/await}
</div>
