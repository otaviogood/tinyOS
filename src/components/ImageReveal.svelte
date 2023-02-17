<!-- An image component that will be covered by a canvas. The canvas will have an alpha channel that will reveal the image underneath. -->
<script>
    import { preventZoom } from "../utils";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Animator, frameCount, animateCount } from "../animator";

    export let style = "";
    let clazz = "";
    export { clazz as class };

    export let src;
    export let stage = 0;
    export let maxStages = 2;

    let animator = new Animator(60, tick);

    let canvas;
    let cwidth, cheight;
    let randPoints = [];
    let currentInterpolation = 1;
    let currentIndex = 0;
    let brushX = 0;
    let brushY = 0;

    $: if (stage > 0) {
        reset();
        animator.start();
    }

    function reset() {
        currentInterpolation = 1;
        currentIndex = 0;
        brushX = 0;
        brushY = 0;
        randPoints = [];
        // Make random points inside the canvas bounds.
        for (let i = 0; i < 4; i++) {
            randPoints.push({
                x: Math.random() * cwidth,
                y: Math.random() * cheight,
            });
        }
    }

    function tick() {
        // console.log("tick", currentInterpolation);
        // Interpolate between the random points by currentInterpolation value.
        const ctx = canvas.getContext("2d");
        ctx.globalCompositeOperation = "destination-out";
        const p0 = randPoints[currentIndex];
        const p1 = randPoints[currentIndex + 1];
        let x0 = p0.x + (p1.x - p0.x) * currentInterpolation;
        let y0 = p0.y + (p1.y - p0.y) * currentInterpolation;
        let x1 = p1.x + (p0.x - p1.x) * currentInterpolation;
        let y1 = p1.y + (p0.y - p1.y) * currentInterpolation;
        // console.log("tick", currentIndex);
        // roundedLine(ctx, x0, y0, x1, y1, 10, "#ffffffff");
        x1 += Math.sin(currentInterpolation * Math.PI * 2) * 30;
        y1 += Math.cos(currentInterpolation * Math.PI * 2) * 30;
        circle(ctx, x1, y1, 34, "#ffffffff");
        brushX = x1;
        brushY = y1;
        currentInterpolation -= 0.03;
        if (currentInterpolation <= 0.0) {
            // animator.stop();
            currentInterpolation = 0.9999;
            currentIndex++;
            if (currentIndex >= randPoints.length - 1) {
                if (stage === maxStages) {
                    ctx.fillStyle = "#ffffffff";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                animator.stop();
                reset();
            }
        }
    }

    function circle(ctx, x, y, radius, color) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.closePath();
    }

    function roundedLine(ctx, x0, y0, x1, y1, thickness, color) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineWidth = thickness;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.closePath();
        // Draw a circle at each end of the line in the same color and thickness.
        ctx.beginPath();
        ctx.arc(x0, y0, thickness * 0.5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.closePath();
        ctx.beginPath();
        ctx.arc(x1, y1, thickness * 0.5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.closePath();
    }

    onMount(() => {
        // Set the canvas size to the size of the image.
        cwidth = canvas.offsetWidth;
        cheight = canvas.offsetHeight;
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        // Fill canvas with white.
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Set composite for masking effect.
        ctx.globalCompositeOperation = "destination-out";
        // roundedLine(ctx, 100, 0, 293, 493, 40, "rgba(255, 255, 2555)");

        // randPoints[0].x = 100;
        // randPoints[0].y = 100;
        // randPoints[1].x = 300;
        // randPoints[1].y = 300;
        // // Draw a line between each point.
        // for (let i = 0; i < randPoints.length; i++) {
        //     const p0 = randPoints[i];
        //     const p1 = randPoints[(i + 1) % randPoints.length];
        //     roundedLine(ctx, p0.x, p0.y, p1.x, p1.y, 40, "rgba(255, 255, 255, 1)");
        // }

        reset();
        animator.start();

        return () => {
            animator.stop();
        };
    });
</script>

<div class="relative XXXborder border-black {clazz}" {style}>
    <!-- <div class="absolute bottom-0 right-0 bg-red-800 w-64 h-10 z-50 text-2xl" style="">{currentInterpolation}</div> -->
    <img {src} class="absolute top-0 left-0" style="width:100%;height:100%;" on:touchstart={preventZoom} alt="reveal"/>
    <canvas class="absolute top-0 left-0" style="width:100%;height:100%;" bind:this={canvas} />
    {#if currentInterpolation < 1}
        <div
            class="absolute w-2 h-2 text-[12rem] text-black"
            style="margin-top:-13rem;margin-left:-4rem; left:{brushX}px;top:{brushY}px"
        >
            <i class="fa-solid fa-paintbrush" />
        </div>
    {/if}
</div>
