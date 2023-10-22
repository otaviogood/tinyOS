<script>
    import ImagePreview from "./ImagePreview.svelte";
    import { createEventDispatcher } from "svelte";
    const dispatch = createEventDispatcher();

    export let keyPromise;
    export let dbPromise;
    export let dbStr = "keyval_paint";

    let deleteMode = 0;
    let chosen = -1;

    function reset() {
        deleteMode = 0;
        chosen = -1;
    }

    export async function del(key) {
        return (await dbPromise).delete(dbStr, key);
    }
    export async function keys() {
        return (await dbPromise).getAllKeys(dbStr);
    }

    function selectImage(key) {
        if (deleteMode === 1) {
            chosen = key;
            deleteMode = 2;
        } else {
            dispatch("loadimg", key);
        }
    }

    function deletePainting() {
        del(chosen);
        // console.log("deleted", chosen);
        reset();
        keyPromise = keys();
    }
</script>

{#if keyPromise}
    <div class="fit-full-space {deleteMode ? 'bg-red-900' : 'bg-gray-900'} z-10 text-4xl">
        {#await keyPromise}
            <p>...loading</p>
        {:then keys}
            <div
                class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-7xl"
                on:pointerup={() => {
                    keyPromise = null;
                    reset();
                }}
            >
                <i class="fas fa-times-circle" />
            </div>
            <button
                class="absolute top-2 left-2 bg-red-600 text-white text-5xl rounded-full h-20 w-20"
                on:pointerup|preventDefault|stopPropagation={() => (deleteMode = 1)}
            >
                <i class="fas fa-trash-can" />
            </button>
            {#if deleteMode === 2}
                <div class="fit-full-space z-20 bg-red-900 flex-center-all">
                    <button
                        class="bg-red-600 text-white text-9xl rounded-full p-8 m-8 z-20"
                        on:pointerup|preventDefault|stopPropagation={() => deletePainting()}
                    >
                        <i class="fas fa-trash-can" />
                    </button>
                    <button
                        class="bg-green-600 text-white text-9xl rounded-full p-8 m-8 z-20"
                        on:pointerup|preventDefault|stopPropagation={() => {
                            reset();
                        }}
                    >
                        NO
                    </button>
                </div>
            {/if}

            <div class="absolute top-24 left-0 right-0 bottom-0">
                <div class="flex flex-row flex-wrap overflow-y-auto h-full w-full pb-4">
                    {#each keys as key, i}
                        {#if key.includes("thumb")}
                            <div
                                class="border-[.2rem] border-gray-900 p-6 bg-black rounded-3xl h-48 w-64"
                                on:touchmove={(e) => {window.letMeScroll = true; e.currentTarget.dataset.lastTouch = 0;}}
                                on:pointerup={() => selectImage(key)}
                            >
                                <ImagePreview {key} {dbPromise} {dbStr} />
                            </div>
                        {/if}
                    {:else}
                        <div class="flex-center-all w-full h-full text-7xl">NO PICTURES SAVED YET</div>
                    {/each}
                </div>
            </div>
        {:catch error}
            <p style="color: red">{error.message}</p>
        {/await}
    </div>
{/if}
