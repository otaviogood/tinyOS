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
    import { openDB, deleteDB, wrap, unwrap } from "idb";

    let hold = false;

    function openFullscreen() {
        let elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            /* Safari */
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
            /* IE11 */
            elem.msRequestFullscreen();
        }
    }

    /* Close fullscreen */
    function closeFullscreen() {
        let elem = document.documentElement;
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            /* IE11 */
            document.msExitFullscreen();
        }
    }
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div
        class="relative overflow-hidden select-none"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)"
    >
        <div class="text-4xl m-4">
            <button
                class="bg-gray-600 text-white text-3xl rounded p-4 m-2"
                on:pointerdown={() => {
                    hold = true;
                    setTimeout(() => {
                        if (hold) window.location.reload();
                    }, 2000);
                }}
                on:pointerup={() => {
                    hold = false;
                }}>reload (hold for 2 seconds)</button
            ><br />
            <button
                class="bg-gray-600 text-white text-3xl rounded p-4 m-2"
                on:pointerdown={() => {
                    hold = true;
                    setTimeout(async () => {
                        if (hold) {
                            // TODO: make these share DBs. hacky to have to put another one in for each app
                            await deleteDB("keyval-store-tinyos-paint", {
                                blocked() {
                                },
                            });
                            await deleteDB("keyval-store-tinyos-camera", {
                                blocked() {
                                },
                            });
                            window.location.reload();
                        }
                    }, 4000);
                }}
                on:pointerup={() => {
                    hold = false;
                }}>clear all local storage (paintings, photos) (hold for 4 seconds)</button
            ><br />
            <button
                class="bg-gray-600 text-white text-3xl rounded p-4 m-2"
                on:pointerdown={() => {
                    hold = true;
                    setTimeout(() => {
                        if (hold) openFullscreen();
                    }, 2000);
                }}
                on:pointerup={() => {
                    hold = false;
                }}>Fullscreen (hold for 2 seconds)</button
            ><br />
            <button
                class="bg-gray-600 text-white text-3xl rounded p-4 m-2"
                on:pointerdown={() => {
                    hold = true;
                    setTimeout(() => {
                        if (hold) closeFullscreen();
                    }, 2000);
                }}
                on:pointerup={() => {
                    hold = false;
                }}>Not Fullscreen (hold for 2 seconds)</button
            >
        </div>
        <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
            <i class="fas fa-times-circle" />
        </div>
    </div>
</div>
