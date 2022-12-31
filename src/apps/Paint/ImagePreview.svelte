<script>
    import { BitmapABGR } from "./BitmapABGR";
    import { onMount } from "svelte";

    export let key;
    export let dbPromise;
    export let dbStr = "keyval_paint";

    let bmpBottom;
    let bottomCtx;
    let canvasBottom;

    export async function get(key) {
        return (await dbPromise).get(dbStr, key);
    }

    async function load() {
        // Load from indexedDB using idb
        let id = key;
        let file = await get(id);
        let url = URL.createObjectURL(file);
        let img = new Image();
        img.src = url;
        img.onload = function () {
            if (!canvasBottom) return; // Hacky. what's this about?
            let w = img.width;
            let h = img.height;
            // console.log("cnavasBottom", canvasBottom);
            bottomCtx = canvasBottom.getContext("2d");
            bmpBottom = new BitmapABGR(w, h, bottomCtx);

            // let ctx = document.createElement("canvas").getContext("2d");
            let ctx = canvasBottom.getContext("2d");
            ctx.canvas.width = w;
            ctx.canvas.height = h;
            ctx.drawImage(img, 0, 0);
        };
    }

    onMount(() => {
        load();
    });
</script>

<canvas class="object-contain w-full h-full" bind:this={canvasBottom} />
