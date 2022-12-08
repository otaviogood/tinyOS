<script>
    // This code is based on https://threejs.org/manual/#en/multiple-scenes
    // Also good reference: https://threejs.org/examples/webgl_multiple_elements.html
    import { onMount } from "svelte";
    import { getContext, setContext } from "svelte";
    import * as THREE from "three";
    import { Animator } from "../../animator";

    export let fps = 60;
    export let disable = false;

    let div2d;
    let animator = new Animator(fps, null);
    let resizeOb;

    let renderer = disable ? null : new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
        // preserveDrawingBuffer: true,
        powerPreference: "high-performance",
    });

    setContext("glob_renderer", renderer);
    setContext("glob_animator", animator);
    setContext("glob_addScene", addScene);
    setContext("glob_removeScene", removeScene);

    let sceneElements = [];
    function addScene(elem, fn) {
        if (!elem) return;
        sceneElements.push({ elem, fn });
    }
    function removeScene(elem) {
        let temp = [];
        for (let i = 0; i < sceneElements.length; i++) {
            if (sceneElements[i].elem != elem) temp.push(sceneElements[i]);
        }
        sceneElements = temp;
    }

    function resizeCanvas(e) {
        // Force even number. This mask is for high dpi displays - my 1.5x display on windows. Mysterious. :/ Maybe cause (odd * 1.5) is fractional.
        let dpr = window.devicePixelRatio || 1; // Get the device pixel ratio (for high res screens), falling back to 1.
        let rect = div2d.getBoundingClientRect();
        let wrapperW = Math.ceil(rect.width * dpr); // TODO: make this ceil??? So it doesn't leave a 1 pixel empty space? Should be ok if parent has overflow: hidden
        let wrapperH = Math.ceil(rect.height * dpr);
        if (dpr !== Math.floor(dpr)) {
            wrapperW &= 0xfffffffe;
            wrapperH &= 0xfffffffe;
        }
        // console.log("resize", wrapperW, wrapperH, e);
        renderer.setPixelRatio(dpr);
        renderer.setSize(wrapperW, wrapperH);
    }

    let lastTimeAbsolute = Date.now();
    let measuredDelta = 0;
    function render(time) {
        if (!renderer) return;
        measuredDelta = Date.now() - lastTimeAbsolute;
        lastTimeAbsolute = Date.now();


        // Not sure this block is needed. I think renderer will clear color to scene.background.???
        renderer.setScissorTest(false);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true);
        renderer.setScissorTest(true);

        // renderer.domElement.style.pointerEvents = "auto";

        // Support scrolling without lag.
        // const transform = `translateY(${window.scrollY}px)`;
        // renderer.domElement.style.transform = transform;

        for (const { elem, fn } of sceneElements) {
            // get the viewport relative position of this element
            const rect = elem.getBoundingClientRect(); // TODO: performace sucks... causes reflow???
            const { left, right, top, bottom, width, height } = rect;

            const isOffscreen =
                bottom < 0 || top > renderer.domElement.clientHeight || right < 0 || left > renderer.domElement.clientWidth;

            if (!isOffscreen) {
                const positiveYUpBottom = renderer.domElement.clientHeight - bottom;
                renderer.setScissor(left, positiveYUpBottom, width, height);
                renderer.setViewport(left, positiveYUpBottom, width, height);

                fn(time, rect);
            }
        }
    }

    let glIsSupported;
    onMount(() => {
        animator.subscribe(render, "GlobalRenderContext");
        animator.start();

        if (disable) return;
        // // Detect if webGL2 is supported
        // let tempCanvas = document.createElement('canvas');
        // glIsSupported = tempCanvas.getContext('webgl2') !== null;
        // tempCanvas.width = 1;  // Hopefully free up resources. Unclear how to do this.
        // tempCanvas.height = 1;

        var rect = div2d.getBoundingClientRect();
        renderer.setSize(rect.width, rect.height);
        // Get the device pixel ratio (for high res screens), falling back to 1.
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.autoClear = false;
        renderer.gammaFactor = 2;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.physicallyCorrectLights = true;
        renderer.domElement.style.position = "absolute";
        renderer.domElement.style.top = "0px";
        renderer.domElement.style.left = "0px";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.pointerEvents = "none";
        resizeCanvas();
        // renderer.domElement.style.zIndex = "-1";
        div2d.appendChild(renderer.domElement);

        resizeOb = new ResizeObserver(resizeCanvas);
        resizeOb.observe(div2d);

        return () => {
            if (animator) {
                animator.unsubscribe(render);
                animator.stop();
            }
            if (disable) return;
            if (resizeOb) resizeOb.unobserve(div2d);
            // Unmount - cleanup.
            // TODO: Why can't it let go of the WebGL context?
            div2d.removeChild(renderer.domElement);
            renderer.renderLists.dispose();
            renderer?.dispose();
            renderer = null;
        };
    });
</script>

{#if disable}
    <slot />
{:else}
    <div bind:this={div2d} class="overflow-hidden fixed left-0 top-0 w-full h-full">
        <slot />
    </div>
    {#if animator}
        <div class="absolute text-3xl text-green-200">{measuredDelta}</div>
    {/if}
{/if}
