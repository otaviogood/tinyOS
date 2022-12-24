<script>
    import { pop } from "svelte-spa-router";
    import {
        invAspectRatio,
        fullWidth,
        fullHeight,
        landscape,
        bigWidth,
        bigHeight,
        bigScale,
        bigPadX,
        bigPadY,
        handleResize,
    } from "../../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../../utils";
    import { BitmapABGR } from "./BitmapABGR";
    import { ColorABGR } from "./ColorABGR";

    import { onMount, onDestroy } from "svelte";
    import { afterUpdate } from "svelte";
    // import ConfirmButton from "../ConfirmButton.svelte";
    import ColorWheel from "./ColorWheel.svelte";
    import BrushPicker from "./BrushPicker.svelte";
    import ImageBrowser from "./ImageBrowser.svelte";
    import { openDB, deleteDB, wrap, unwrap } from "idb";

    handleResize();

    let canvasTop;
    let canvasBottom;
    let bmpTop;
    let bmpBottom;
    let topCtx;
    let bottomCtx;
    let width = 800;
    let height = 600;
    let border = 2; // rem units
    let selectedColor = "#000000";
    let colorWheelVisible = false;
    let pickerX = 0;
    let pickerY = 0;
    let brushSize = 3;
    let pointerXY;
    let pointerMode = 0; // 0 = normal drawing, 1 = eye dropper
    let pointerDown = false;
    let pointerLastPos = [0, 0];
    let colorSampler;

    onMount(() => {
        topCtx = canvasTop.getContext("2d");
        bottomCtx = canvasBottom.getContext("2d");
        bmpTop = new BitmapABGR(canvasTop.width, canvasTop.height, topCtx);
        // bmpTop.DrawCircle(200, 100, 50, 0xffa0ffff);
        bmpBottom = new BitmapABGR(canvasBottom.width, canvasBottom.height, bottomCtx);
        bmpBottom.Clear(0xff707070);
        // bmpBottom.DrawCircle(200, 200, 50, 0xffa0a0ff);
        bmpBottom.DrawImage(0, 0);
        bmpTop.DrawImage(0, 0);

        // This is the same as onDestroy, but it's easier because these vars are in scope.
        return () => {};
    });

    onDestroy(() => {
        console.log("Paint destroy");
    });

    afterUpdate(() => {
        // After calculating DOM positions, save off where the color picker is so we can pop it up there.
        let picker = document.getElementById("pickHolder");
        let root = document.getElementById("whiteboardrootdiv");
        let pRect = picker.getBoundingClientRect();
        let rRect = root.getBoundingClientRect();
        pickerX = pRect.left - rRect.left;
        pickerY = pRect.top - rRect.top;
    });

    function now() {
        return new Date().getTime();
    }

    let last = 0;
    let lastMoveSent = 0;
    let newLayer = null;

    function getPointerPos(ev) {
        var rect = document.getElementById("canvasholder").getBoundingClientRect();
        // convert rem to px units
        let border2 = $bigScale * 0.01 * border;
        let x = ((ev.clientX - border2 - rect.left) / (rect.right - rect.left - border2 * 2)) * width;
        let y = ((ev.clientY - border2 - rect.top) / (rect.bottom - rect.top - border2 * 2)) * height;
        pointerXY = [Math.floor(x), Math.floor(y)];
        return pointerXY;
    }

    function handlePointerdown(ev) {
        pointerDown = true;
        colorWheelVisible = false;
        let xy = getPointerPos(ev);
        pointerLastPos = xy;
        if (pointerMode === 0) {
            bmpTop.DrawSmear(
                xy[0],
                xy[1],
                xy[0],
                xy[1],
                brushSize | 0,
                ColorABGR.fromHashTagColor(selectedColor) | (255 << 24),
                ColorABGR.fromHashTagColor(selectedColor) | (255 << 24),
                1
            );

            newLayer = {
                points: [{ x: xy[0], y: xy[1] }],
                color: selectedColor,
                thickness: brushSize,
            };
            // capture event so we always get pointer-up event.
            document.getElementById("canvasholder").setPointerCapture(ev.pointerId);
        }
        bmpTop.DrawImage(0, 0);
    }

    function handlePointermove(ev) {
        let xy = getPointerPos(ev);

        colorSampler = null;
        if (pointerMode === 0 && pointerDown) {
            bmpTop.DrawSmear(
                pointerLastPos[0],
                pointerLastPos[1],
                xy[0],
                xy[1],
                brushSize | 0,
                ColorABGR.fromHashTagColor(selectedColor) | (255 << 24),
                ColorABGR.fromHashTagColor(selectedColor) | (255 << 24),
                1
            );

            if (lastMoveSent < now() - 100) {
                lastMoveSent = now();
            }
            if (newLayer === null) return;

            if (last < now() - 8) {
                // newLayer.points.push({ x: xy[0], y: xy[1] });
                // showNewLayer();
                last = now();
            }
        } else if (pointerMode === 1) {
            colorSampler = sampleColor();
        }
        pointerLastPos = xy;
        bmpTop.DrawImage(0, 0);
    }

    function sampleColor() {
        let colArray = bottomCtx.getImageData(pointerXY[0], pointerXY[1], 1, 1).data;
        return "rgb(" + colArray[0] + "," + colArray[1] + "," + colArray[2] + ")";
    }

    function handlePointerup(ev) {
        pointerDown = false;
        let xy = getPointerPos(ev);

        if (pointerMode === 0) {
            if (newLayer === null) return;

            newLayer = null;
            // clear(topCtx);
        } else {
            pointerMode = 0;
            selectedColor = sampleColor();
        }
        bmpBottom.OverlayBox(bmpTop);
        bmpTop.Clear(0);
        bmpBottom.DrawImage(0, 0);
        bmpTop.DrawImage(0, 0);
    }

    function handlePointerleave(ev) {
        let xy = getPointerPos(ev);
    }

    function selectColor(color) {
        selectedColor = color;
    }

    const dbPromise = openDB("keyval-store-tinyos", 1, {
        upgrade(db) {
            db.createObjectStore("keyval_paint");
        },
    });

    export async function get(key) {
        return (await dbPromise).get("keyval_paint", key);
    }
    export async function set(key, val) {
        return (await dbPromise).put("keyval_paint", val, key);
    }
    export async function del(key) {
        return (await dbPromise).delete("keyval_paint", key);
    }
    export async function clear() {
        return (await dbPromise).clear("keyval_paint");
    }
    export async function keys() {
        return (await dbPromise).getAllKeys("keyval_paint");
    }

    console.log("keys", keys());
    function dataURItoBlob(dataURI) {
        // convert base64/URLEncoded data component to raw binary data held in a string
        var byteString;
        if (dataURI.split(",")[0].indexOf("base64") >= 0) byteString = atob(dataURI.split(",")[1]);
        else byteString = unescape(dataURI.split(",")[1]);

        // separate out the mime component
        var mimeString = dataURI.split(",")[0].split(":")[1].split(";")[0];

        // write the bytes of the string to a typed array
        var ia = new Uint8Array(byteString.length);
        for (var i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }

        return new Blob([ia], { type: mimeString });
    }

    async function save() {
        // Save to indexedDB using idb
        let data = canvasBottom.toDataURL("image/png");
        let blob = dataURItoBlob(data);
        let id = Date.now(); // Use current time as id since kids won't be able to type a name.
        let name = "paint_" + id + ".png";
        let file = new File([blob], name, { type: "image/png" });
        // let store = db.transaction("files", "readwrite").objectStore("files");
        // store.put(file, id);
        await set(id, file);
        console.log("Saved to indexedDB");
    }

    async function load() {
        // Load from indexedDB using idb
        let allKeys = await keys();
        let id = allKeys[0];
        let file = await get(id);
        let url = URL.createObjectURL(file);
        let img = new Image();
        img.src = url;
        img.onload = function () {
            // copy img into Int32Array in bmpBottom.data2
            let w = img.width;
            let h = img.height;
            let data = bmpBottom.data2; //new Int32Array(w * h);
            let ctx = document.createElement("canvas").getContext("2d");
            ctx.canvas.width = w;
            ctx.canvas.height = h;
            ctx.drawImage(img, 0, 0);
            let imgData = ctx.getImageData(0, 0, w, h);
            for (let i = 0; i < w * h; i++) {
                data[i] =
                    (imgData.data[i * 4 + 3] << 24) |
                    (imgData.data[i * 4 + 2] << 16) |
                    (imgData.data[i * 4 + 1] << 8) |
                    imgData.data[i * 4];
            }
            bmpBottom.data2 = data;
            bmpBottom.DrawImage(0, 0);

            bmpTop.Clear(0);
        };
        console.log("Loaded from indexedDB");
    }

    let allKeys = null;
    async function browse() {
        allKeys = keys();
    }
    browse();
</script>

<div class="fit-full-space select-none overflow-hidden" style="background-color:#404040;" on:touchstart={preventZoom}>
    <div
        class="relative overflow-hidden select-none"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;"
    >
        <!-- <ImageBrowser keyPromise={allKeys}></ImageBrowser> -->
        <div class="flex-center-all flex-col h-full w-full">
            <!-- on:pointerdown|preventDefault|stopPropagation={() => console.log("colorWheelVisible = false")} -->
            <div
                id="whiteboardrootdiv"
                class="fit-full-space"
                style="background-color:#404040;margin:0px;overflow-y:auto;overflow-x:hidden"
            >
                {#if colorWheelVisible}
                    <!-- <div style="position:absolute;left:{pickerX - 128 - 56 + 24}px;top:{Math.max(pickerY - 128 + 24, 0)}px; display:inline-block;z-index:2;" -->
                    <div
                        style="position:absolute;left:25rem;top:17rem; display:inline-block;z-index:2;"
                        on:mouseleave|preventDefault|stopPropagation={() => (colorWheelVisible = true)}
                    >
                        <BrushPicker
                            bind:colorStr={selectedColor}
                            bind:brushSize
                            on:close={() => (colorWheelVisible = false)}
                            on:eyeDropper={() => {
                                pointerMode = 1;
                                colorWheelVisible = false;
                            }}
                        />
                    </div>
                {/if}

                <div style="text-align:center">
                    <div
                        style="display:inline-block;text-align:left;position: relative;padding:.5rem {border}rem .5rem {border}rem;width:max-content;"
                    >
                        <!-- <span class="w-24 h-24 p-6 align-middle" on:click={() => browse()} style="background-color:#000000;" >browse</span> -->
                        <span class="w-24 h-24 p-6 align-middle" on:click={() => load()} style="background-color:#000000;"
                            >load</span
                        >
                        <span class="w-24 h-24 mr-48 p-6 align-middle" on:click={() => save()} style="background-color:#000000;"
                            >save</span
                        >
                        <span class="colorcircle" on:click={() => selectColor("#000000")} style="background-color:#000000;" />
                        <span class="colorcircle" on:click={() => selectColor("#ff4040")} style="background-color:#ff4040;" />
                        <span class="colorcircle" on:click={() => selectColor("#40ff40")} style="background-color:#40ff40;" />
                        <!-- {#if $mobileScreen} -->
                        <!-- <div style="margin-top:2px" /> -->
                        <!-- {/if} -->
                        <span class="colorcircle" on:click={() => selectColor("#4040ff")} style="background-color:#4040ff;" />
                        <span class="colorcircle" on:click={() => selectColor("#ffffff")} style="background-color:#ffffff;" />
                        <span id="pickHolder" class="colorcircle" on:click={() => (colorWheelVisible = true)} style="border:0;">
                            <ColorWheel
                                size={$bigScale * 0.042}
                                thumb
                                colorStr={selectedColor}
                                on:change={(e) => (colorWheelVisible = true)}
                            />
                        </span>
                        <span
                            class="text-6xl align-middle pl-48"
                            style="color:{selectedColor}"
                            on:pointerup={() => {
                                pointerMode = 1;
                                colorWheelVisible = false;
                            }}
                            ><i
                                class="fas fa-eye-dropper rounded-full"
                                style="background-color:{colorSampler || (pointerMode === 1 ? '#b0b0b0' : '')}"
                            /></span
                        >
                        <!-- <ConfirmButton style="vertical-align: middle;margin-left:32px" on:confirmed={clearAll}>Clear</ConfirmButton> -->
                    </div>
                    <div />
                    <div
                        id="canvasholder"
                        style="display:inline-block;text-align:left;touch-action:none;position:relative;height:69rem;width:99rem;--aspect-ratio:{width /
                            height};border:{border}rem solid #202020;border-radius: {border}rem;cursor:{pointerMode === 0
                            ? 'auto'
                            : 'crosshair'};"
                        on:pointerdown|preventDefault|stopPropagation={handlePointerdown}
                        on:pointerup|preventDefault|stopPropagation={handlePointerup}
                        on:pointermove|preventDefault|stopPropagation={handlePointermove}
                        on:pointerleave|preventDefault|stopPropagation={handlePointerleave}
                        on:touchend|preventDefault|stopPropagation={handlePointerup}
                        on:touchcancel|preventDefault|stopPropagation={handlePointerup}
                    >
                        <canvas
                            id="bottom"
                            style="width:100%;height:100%"
                            bind:this={canvasBottom}
                            {width}
                            {height}
                            class="bottomcanvas"
                        />
                        <canvas
                            id="top"
                            style="width:100%;height:100%"
                            bind:this={canvasTop}
                            {width}
                            {height}
                            class="topcanvas"
                        />
                    </div>
                </div>
            </div>
        </div>
        <div
            class="absolute top-1 right-1 cursor-pointer select-none rounded-full text-gray-500"
            style="font-size:4.5rem;line-height:1"
            on:pointerup={pop}
        >
            <i class="fas fa-times-circle" />
        </div>
    </div>
</div>

<style>
    .topcanvas {
        position: absolute;
        left: 0px;
        top: 0px;
        z-index: 1;
        display: block;
    }
    .bottomcanvas {
        position: absolute;
        left: 0px;
        top: 0px;
        display: block;
    }
    .colorcircle {
        display: inline-block;
        width: 4.2rem;
        height: 4.2rem;
        border-radius: 3rem;
        /* border: .2rem solid white; */
        margin: 0rem 1rem 0rem 1rem;
        padding: 0;
        vertical-align: middle;
    }
    .colorcircle:active {
        border: 0.2rem solid black;
    }
</style>
