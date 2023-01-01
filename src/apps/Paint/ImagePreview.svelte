<script>
    import { onMount } from "svelte";

    export let key;
    export let dbPromise;
    export let dbStr = "keyval_paint";

    let previewImage = null;

    export async function get(key) {
        return (await dbPromise).get(dbStr, key);
    }

    async function load(key) {
        // Load from indexedDB using idb
        let file = await get(key);
        previewImage = URL.createObjectURL(file);
    }

    onMount(() => {
        load(key);
    });
</script>

{#if previewImage}
    <img src={previewImage} class="w-full h-full object-contain" alt="thumbnail" />
{/if}
