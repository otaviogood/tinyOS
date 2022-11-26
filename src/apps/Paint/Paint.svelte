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

    // Add the Firebase products that you want to use
    // import "firebase/auth";
    import "firebase/firestore";

    import { onMount, onDestroy } from "svelte";
    import { afterUpdate } from "svelte";
    // import ConfirmButton from "../ConfirmButton.svelte";
    import ColorWheel from "./ColorWheel.svelte";
    import BrushPicker from "./BrushPicker.svelte";


    handleResize();





    let db = null;
    let canvasTop;
    let canvasBottom;
    let topCtx;
    let bottomCtx;
    let width = 800;
    let height = 600;
    let border = 8;
    let layersRef;
    let userRef;
    let usersRef;
    let selectedColor = "#000000";
    let user_pos = {};
    // let activityEntity;
    let gameState;
    // let subs;
    let colorWheelVisible = false;
    let pickerX = 0;
    let pickerY = 0;
    let brushSize = 3;
    let pointerXY;
    let pointerMode = 0; // 0 = normal drawing, 1 = eye dropper
    
    onMount(() => {
        // bottomCtx = canvasBottom.getContext("2d");
        topCtx = canvasTop.getContext("2d");
        topCtx.fillStyle = "white";
        topCtx.fillRect(0, 0, width, height);

        redraw();

        // This is the same as onDestroy, but it's easier because these vars are in scope.
        return () => {
        };
    });

    onDestroy(() => {
        console.log("Pictionary destroy");
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

    function clear(ctx) {
        ctx.clearRect(0, 0, width, height);
    }

    function drawLayer(ctx, layer) {
        // console.log("drawLayer n_points=", layer.points.length);
        if (layer.points.length == 1) {
            let half = layer.thickness / 2.0;
            ctx.fillStyle = layer.color;
            ctx.fillRect(layer.points[0].x - half, layer.points[0].y - half, layer.thickness, layer.thickness);
        } else {
            ctx.beginPath();
            ctx.lineWidth = layer.thickness;
            ctx.strokeStyle = layer.color;
            ctx.moveTo(layer.points[0].x, layer.points[0].y);

            for (let i = 1; i < layer.points.length; i++) {
                let point = layer.points[i];
                ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
        }
    }

    function redraw() {
        // bottomCtx.fillStyle = "white";
        // bottomCtx.fillRect(0, 0, width, height);

        // var layers = activityEntity.state["layers"];
        // for (var k in layers) {
        //     try {
        //         drawLayer(bottomCtx, JSON.parse(layers[k]));
        //     } catch (e) {
        //         console.log("Error drawing", e);
        //     }
        // }
    }

    function now() {
        return new Date().getTime();
    }

    let last = 0;
    let lastMoveSent = 0;
    let newLayer = null;

    function getPointerPos(ev) {
        var rect = document.getElementById("canvasholder").getBoundingClientRect();
        let x = ((ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2)) * width;
        let y = ((ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2)) * height;
        pointerXY = [Math.floor(x), Math.floor(y)];
        return pointerXY;
    }

    function handlePointerdown(ev) {
        colorWheelVisible = false;
        let xy = getPointerPos(ev);
        if (pointerMode === 0) {
            newLayer = {
                points: [{ x: xy[0], y: xy[1] }],
                color: selectedColor,
                thickness: brushSize,
            };
            // capture event so we always get pointer-up event.
            document.getElementById("canvasholder").setPointerCapture(ev.pointerId);
        }
    }

    function handlePointermove(ev) {
        let xy = getPointerPos(ev);

        if (pointerMode === 0) {
            if (lastMoveSent < now() - 100) {
                lastMoveSent = now();
            }
            if (newLayer === null) return;

            if (last < now() - 8) {
                newLayer.points.push({ x: xy[0], y: xy[1] });
                showNewLayer();
                last = now();
            }
        }
    }

    function handlePointerup(ev) {
        let xy = getPointerPos(ev);

        if (pointerMode === 0) {
            if (newLayer === null) return;

            newLayer = null;
            // clear(topCtx);
        } else {
            pointerMode = 0;
            let colArray = topCtx.getImageData(pointerXY[0], pointerXY[1], 1, 1).data;
            selectedColor = "rgb(" + colArray[0] + "," + colArray[1] + "," + colArray[2] + ")";
        }
    }

    function handlePointerleave(ev) {
        let xy = getPointerPos(ev);
    }

    function showNewLayer() {
        // clear(topCtx);
        drawLayer(topCtx, newLayer);
    }

    function selectColor(color) {
        selectedColor = color;
    }

    function clearAll() {
    }
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div
        class="relative overflow-hidden select-none"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)"
    >
        <div class="flex-center-all flex-col h-full w-full">


<!-- on:pointerdown|preventDefault|stopPropagation={() => console.log("colorWheelVisible = false")} -->
<div id="whiteboardrootdiv" class="fit-full-space" style="background-color:#404040;margin:0px;overflow-y:auto;overflow-x:hidden" >
    {#if colorWheelVisible}
        <div style="position:absolute;left:{pickerX - 128 - 56 + 24}px;top:{Math.max(pickerY - 128 + 24, 0)}px; display:inline-block;z-index:2;"
            on:mouseleave|preventDefault|stopPropagation={() => colorWheelVisible = false}>
            <BrushPicker bind:colorStr={selectedColor} bind:brushSize on:close={() => colorWheelVisible = false} on:eyeDropper={() => {pointerMode = 1; colorWheelVisible = false;}}></BrushPicker>
        </div>
    {/if}

    <div style="text-align:center">
        <div
            style="display:inline-block;text-align:left;position: relative;background-color:#606060;padding:.5rem {border}px 8px {border}px;border-radius:{border}px {border}px
        0 0;width:max-content">
            <span class="colorcircle" on:click={() => selectColor('#000000')} style="background-color:#000000;" />
            <span class="colorcircle" on:click={() => selectColor('#ff4040')} style="background-color:#ff4040;" />
            <span class="colorcircle" on:click={() => selectColor('#40ff40')} style="background-color:#40ff40;" />
            <!-- {#if $mobileScreen} -->
                <!-- <div style="margin-top:2px" /> -->
            <!-- {/if} -->
            <span class="colorcircle" on:click={() => selectColor('#4040ff')} style="background-color:#4040ff;" />
            <span class="colorcircle" on:click={() => selectColor('#ffffff')} style="background-color:#ffffff;" />
            <span id="pickHolder" class="colorcircle" on:click={() => colorWheelVisible = true} style="border:0;">
                <ColorWheel size={$bigScale*.042} thumb colorStr={selectedColor} on:change={(e) => colorWheelVisible = true}></ColorWheel>
            </span>
            <!-- <ConfirmButton style="vertical-align: middle;margin-left:32px" on:confirmed={clearAll}>Clear</ConfirmButton> -->
        </div>
        <div />
        <div
            id="canvasholder"
            style="display:inline-block;text-align:left;touch-action:none;position:relative;height:68rem;width:96rem;wiXXdth:min(100%, {width}px);--aspect-ratio:{width / height};border:{border}px solid #606060;border-radius: {border}px;cursor:{pointerMode === 0 ? 'auto' : 'crosshair'};"
            on:pointerdown|preventDefault|stopPropagation={handlePointerdown}
            on:pointerup|preventDefault|stopPropagation={handlePointerup}
            on:pointermove|preventDefault|stopPropagation={handlePointermove}
            on:pointerleave|preventDefault|stopPropagation={handlePointerleave}
            on:touchend|preventDefault|stopPropagation={handlePointerup}
            on:touchcancel|preventDefault|stopPropagation={handlePointerup}>
            <!-- <canvas id="bottom" style="width:100%;height:100%" bind:this={canvasBottom} {width} {height} class="bottomcanvas" /> -->
            <canvas id="top" style="width:100%;height:100%" bind:this={canvasTop} {width} {height} class="topcanvas" />
        </div>
    </div>
</div>


        </div>
        <div class="absolute top-0 right-0 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
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
        border: .2rem solid white;
        margin: 0rem 1rem 0rem 1rem;
        padding: 0;
        vertical-align: middle;
    }
    .colorcircle:active {
        border: .2rem solid black;
    }
</style>
