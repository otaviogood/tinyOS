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
    } from "../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom, GetVideoThumb } from "../utils";

    let hold = false;
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div
        class="relative overflow-hidden select-none"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)"
    >
        <div class="text-4xl m-4">
            <button
                class="bg-gray-600 text-white text-3xl rounded p-4"
                on:pointerdown={() => {
                    hold = true;
                    setTimeout(() => {
                        if (hold) window.location.reload();
                    }, 2000);
                }}
                on:pointerup={() => {
                    hold = false;
                }}>reload (hold for 2 seconds)</button
            >
        </div>
        <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
            <i class="fas fa-times-circle" />
        </div>
    </div>
</div>
