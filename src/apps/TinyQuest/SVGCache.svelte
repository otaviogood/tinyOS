<script>
    import { bigScale } from "../../screen";

    export let icon = "_"; // Don't let this be "falsey"
    export let size = "256px";
    export let canvasSize = "";
    export let sprite = false; // For SVG sprites vs single SVG
    export let style = "";
    export let id = Math.random().toString();
    // https://svelte.dev/repl/1d0b80898137445da24cf565830ce3f7?version=3.4.2
    let clazz = "";
    export { clazz as class };

    export let xml = "";

    let canvas;
    let meId = icon + id;

    export function renderSVGToCanvas(xml, canvas, canvasSize) {
        //     xml = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        //   <circle cx="50" cy="50" r="50" fill="red"/>
        // </svg>`;
        let svg64 = btoa(xml);
        let b64Start = "data:image/svg+xml;base64,";
        let image64 = b64Start + svg64;
        var imgTemp = new Image();
        let bigger = window.devicePixelRatio;
        imgTemp.width = canvasSize * bigger;
        imgTemp.height = canvasSize * bigger;
        imgTemp.src = image64;

        imgTemp.onload = function () {
            // console.log("load", canvasSize);//, img?.src?.substring(0, 40));
            // Render the image to a canvas so we can make a raster image instead of SVG.
            // canvas = document.createElement("canvas");
            canvas.width = imgTemp.width;
            canvas.height = imgTemp.height;
            let ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear to transparent
            // draw the image onto the canvas
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(imgTemp, 0, 0, imgTemp.width, imgTemp.height);
        };
    }
    export function parseSVGSprite(xml, icon, canvasSize) {
        // console.log("parse", icon)
        let idIndex = xml.indexOf('id="' + icon + '"');
        let start = xml.lastIndexOf("<symbol", idIndex);
        let end = xml.indexOf("</symbol>", idIndex);
        let goodStuff = xml.substring(start, end);
        let sizeTemp = parseInt(canvasSize);
        if (canvasSize) goodStuff = goodStuff.replace("<symbol", '<svg xmlns="http://www.w3.org/2000/svg" height="' + sizeTemp + '" width="' + sizeTemp + '" ') + "</svg>";
        else goodStuff = goodStuff.replace("<symbol", '<svg xmlns="http://www.w3.org/2000/svg" ') + "</svg>";
        return goodStuff;
    }

    $: if (icon && canvas) {
        meId = icon + id;
        if (!window.svgCache) window.svgCache = new Map();
        // console.log("UPDATE", icon, canvas != undefined, window.svgCache);
        if (!window.svgCache.get(meId)) {
            let lower = size.toLowerCase();
            if (lower.endsWith("rem")) {
                let num = lower.substring(0, lower.indexOf("rem"));
                canvasSize = (parseFloat(num) * $bigScale) / 100;
            } else if (lower.endsWith("px")) {
                let num = lower.substring(0, lower.indexOf("px"));
                canvasSize = parseFloat(num);
            }

            let xmlTemp = xml;
            if (sprite) xmlTemp = parseSVGSprite(xmlTemp, icon, canvasSize);
            renderSVGToCanvas(xmlTemp, canvas, canvasSize);
            window.svgCache.set(meId, true);
        }
    }
</script>

<canvas bind:this={canvas} class={clazz} style="width:{size};height:{size};{style}" alt={icon} />
