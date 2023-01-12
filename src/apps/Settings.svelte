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
    import { openDB, deleteDB, wrap, unwrap } from "idb";
    import { Howl, Howler } from "howler";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";

    handleResize();

    let hold = false;
    let volume = -1;

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

<FourByThreeScreen>
    <br />
    <br />
    <br />
    <br />
    <p>
        This is a series of games and apps I made for a 3 year old and some other kids too. Some were designed partially by kids,
        some were experiments by me. There's more info at otaviogood.com and github.com/otaviogood/tinyOS.
    </p>
    <hr />

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
                            blocked() {},
                        });
                        await deleteDB("keyval-store-tinyos-camera", {
                            blocked() {},
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
        ><br />
        {#key volume}
            <div class="flex flex-row items-center">
                {#each Array(11).fill(0) as _, i}
                    <button
                        class="bg-gray-600 text-white text-3xl rounded p-4 m-2"
                        on:pointerdown={() => {
                            Howler.volume(i / 10);
                            volume = i / 10;
                        }}>{(i / 10).toFixed(1)}</button
                    >
                {/each}
                <div class="ml-8">Volume: {Howler.volume().toFixed(1)}</div>
            </div>
        {/key}
    </div>

    <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
        <i class="fas fa-times-circle" />
    </div>
</FourByThreeScreen>

<style>
    p {
        font-size: 20px;
        margin: 20px;
        text-indent: 3ch;
        display: block;
    }
</style>
