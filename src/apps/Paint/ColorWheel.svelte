<script>
    import { onMount } from "svelte";
    import { createEventDispatcher } from "svelte";

    import { BitmapABGR } from "./BitmapABGR";
    import { ColorABGR } from "./ColorABGR";
    // import Icons from "../../Icons.svelte";

    import Color from "color"; // https://github.com/Qix-/color#readme

    const dispatch = createEventDispatcher();

    export let size = 256;
    export let thumb = false;
    export let colorStr = Color.rgb(0, 0, 0);

    let canvas;
    let bmp;

    let innerRad = 0.75;
    let outerRad = 1.0;
    let boxExt = 0.5;
    let hslTemp = ColorABGR.RGBToHSV(ColorABGR.fromRGBInt(Color(colorStr).rgbNumber()));
    let selectedHue = hslTemp[0];
    let selectedSat = hslTemp[1];
    let selectedLum = hslTemp[2];
    let selectedColor = ColorABGR.HSVToRGB(selectedHue, selectedSat, selectedLum);
    let lastSelectedColor = selectedColor;
    let lastHue = selectedHue; // This is to send a change event if hue changes even if color is black and color doesn't change.

    let mousePressed = false;
    let selectMode = 0;

    onMount(() => {
        let ctx = canvas.getContext("2d");
        bmp = new BitmapABGR(canvas.width, canvas.height, ctx);
        draw();
    });

    $: if (size) {
        if (canvas) {
            console.log("size changed");
            let ctx = canvas.getContext("2d");
            bmp = new BitmapABGR(canvas.width, canvas.height, ctx);
            draw();
        }
    }

    $: if (colorStr) {
        if (thumb && bmp) {
            hslTemp = ColorABGR.RGBToHSV(ColorABGR.fromRGBInt(Color(colorStr).rgbNumber()));
            selectedHue = hslTemp[0];
            selectedSat = hslTemp[1];
            selectedLum = hslTemp[2];
            selectedColor = ColorABGR.HSVToRGB(selectedHue, selectedSat, selectedLum);
            lastSelectedColor = selectedColor;
            lastHue = selectedHue;
            draw();
        }
    }

    function draw() {
        const notchSize = thumb ? 0.01 : 0.0025;
        const magic = bmp.width * 0.25;
        const margin = 1 / 64.0;
        for (let y = 0, count1 = bmp.height; y < count1; y = (y + 1) | 0) {
            let pixIndex = Math.imul(y, bmp.width) | 0;
            for (let x = 0, count = bmp.width; x < count; x = (x + 1) | 0) {
                let pix = 0;
                let alphaX = x / bmp.width;
                let alphaY = y / bmp.height;
                alphaX = alphaX * 2 - 1;
                alphaY = alphaY * 2 - 1;
                let radSquared = alphaX * alphaX + alphaY * alphaY;

                if (radSquared > innerRad * innerRad && radSquared < outerRad * outerRad) {
                    let fade = Math.max(0, Math.min(1, (radSquared - innerRad * innerRad - margin) * magic));
                    fade *= Math.max(0, Math.min(1, (outerRad * outerRad - radSquared - margin) * magic));
                    let at = (Math.atan2(alphaY, alphaX) / 3.141592653589793) * 0.5 + 0.5;
                    let col = ColorABGR.HSVToRGB(at, 1, 1);

                    let dist = at - selectedHue;

                    if (dist > 0.5) {
                        dist -= 1;
                    }

                    if (dist < -0.5) {
                        dist += 1;
                    }

                    dist = Math.abs(dist);

                    // if (Math.abs(dist) < notchSize) {
                    //     let intensity = Math.max(0, Math.min(1, (notchSize - dist) * 512));
                    //     col = ColorABGR.lerp(col, ColorABGR.WHITE, (intensity * 255) | 0);
                    //     fade = Math.max(fade, intensity);
                    // }

                    pix = ColorABGR.withAlpha(col, (fade * 255) | 0);
                }

                if (alphaX >= -boxExt && alphaX <= boxExt && alphaY >= -boxExt && alphaY <= boxExt) {
                    let sat = (alphaX + boxExt) / (boxExt * 2);
                    let lum = (-alphaY + boxExt) / (boxExt * 2);
                    pix = ColorABGR.HSVToRGB(selectedHue, sat, lum);
                }

                // bmp.SetPixelAlpha(x, y, pix);
                // this.dirty = true;
                bmp.data2[pixIndex++] = pix;
            }
        }
        bmp.dirty = true;

        // Selection circle
        // let xp = selectedSat * boxExt * 2 - boxExt;
        // let yp = selectedLum * boxExt * 2 - boxExt;
        // xp = (xp * 0.5 + 0.5) * bmp.width;
        // yp = (-yp * 0.5 + 0.5) * bmp.height;
        // bmp.DrawCircle(xp | 0, yp | 0, thumb ? 6 : 16, ColorABGR.WHITE);
        //   this.dirty = true;
        bmp.DrawImage(0, 0);
    }

    function getPointerPos(ev) {
        let rect = canvas.getBoundingClientRect();
        const border = 0;
        let x = ((ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2)) * size;
        let y = ((ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2)) * size;
        return [x, y];
    }

    function handlePointerdown(e) {
        if (thumb) return;
        mousePressed = true;
        let mXY = getPointerPos(e);
        let alphaX = mXY[0] / bmp.width;
        let alphaY = mXY[1] / bmp.height;
        alphaX = alphaX * 2 - 1;
        alphaY = alphaY * 2 - 1;

        if (alphaX >= -boxExt && alphaX <= boxExt && alphaY >= -boxExt && alphaY <= boxExt) {
            selectMode = 0;
        }

        let radSquared = alphaX * alphaX + alphaY * alphaY;

        if (radSquared > innerRad * innerRad) {
            selectMode = 1;
        }

        pickColor(mXY[0], mXY[1]);
    }
    function handlePointermove(e) {
        if (thumb) return;
        let mXY = getPointerPos(e);

        if (mousePressed) {
            pickColor(mXY[0], mXY[1]);
        }
    }
    function handlePointerup(e) {
        if (thumb) return;
        if (mousePressed) {
            mousePressed = false;
            let mXY = getPointerPos(e);
            pickColor(mXY[0], mXY[1]);
        }
    }
    function handlePointerleave(e) {
        if (thumb) return;
        mousePressed = false;
    }

    function finalizeColor() {
        selectedColor = ColorABGR.HSVToRGB(selectedHue, selectedSat, selectedLum);
        // draw();
        //   document.getElementById('currentColor').style.background = ColorABGR.toRGBString(selectedColor);
        if (lastSelectedColor != selectedColor || lastHue != selectedHue) {
            colorStr = ColorABGR.toRGBString(selectedColor);
            dispatch("change", {
                color: selectedColor,
                colorStr: ColorABGR.toRGBString(selectedColor),
            });
            lastSelectedColor = selectedColor;
            lastHue = selectedHue;
        }
    }

    function pickColor(x, y) {
        let alphaX = x / bmp.width;
        let alphaY = y / bmp.height;
        alphaX = alphaX * 2 - 1;
        alphaY = alphaY * 2 - 1;

        if (selectMode == 0) {
            selectedSat = Math.max(0, Math.min(1, (alphaX + boxExt) / (boxExt * 2)));
            selectedLum = Math.max(0, Math.min(1, (-alphaY + boxExt) / (boxExt * 2)));
        } else {
            let at = Math.atan2(y - bmp.width * 0.5, x - bmp.height * 0.5);
            selectedHue = (at / Math.PI) * 0.5 + 0.5;
        }

        finalizeColor();
    }

    function setColor(col) {
        let hsv = ColorABGR.RGBToHSV(col);
        selectedHue = hsv[0];
        selectedSat = hsv[1];
        selectedLum = hsv[2];
        finalizeColor();
    }
</script>

<div class="relative" style="width: {size}px; height: {size}px;">
    <canvas
        id="colorWheelCanvas"
        bind:this={canvas}
        width={size}
        height={size}
        style="width: {size}px; height: {size}px;display:block"
        on:pointerdown|preventDefault|stopPropagation={handlePointerdown}
        on:pointerup={handlePointerup}
        on:pointermove|preventDefault|stopPropagation={handlePointermove}
        on:pointerleave={handlePointerleave}
        on:touchend={handlePointerup}
        on:touchcancel={handlePointerup}
    />
    <div class="absolute top-[25%] left-[25%] w-[50%] h-[50%] pointer-events-none">
        <div
            class="absolute rounded-full border-2 border-white"
            style="left:calc({selectedSat * 100}% - {thumb ? 3 : 8}px);bottom:calc({selectedLum * 100}% - {thumb
                ? 3
                : 8}px);width:{thumb ? 6 : 16}px; height:{thumb ? 6 : 16}px"
        />
    </div>
    <div class="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div class="absolute top-[50%] left-[50%]">
            <div class="relative" style="transform:rotate({selectedHue * 360}deg);transform-origin:0px 0px;">
                <div
                    class="absolute bg-white"
                    style="right:{size * 0.37}px;top:{-size * 0.005}px;width:{size * 0.135}px; height:{size * 0.01}px"
                />
            </div>
        </div>
    </div>
</div>
