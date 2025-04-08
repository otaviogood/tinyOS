<script>
    import { pop } from "../router";
    import { onMount } from "svelte";
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
    import { casing, age } from "../stores";
    import APIKeyInput from "./AI/APIKeyInput.svelte";

    handleResize();

    let hold = false;
    let showApiKeyInput = false;

    function openFullscreen() {
        let elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem["webkitRequestFullscreen"]) {
            /* Safari */
            elem["webkitRequestFullscreen"]();
        } else if (elem["msRequestFullscreen"]) {
            /* IE11 */
            elem["msRequestFullscreen"]();
        }
    }

    /* Close fullscreen */
    function closeFullscreen() {
        let elem = document.documentElement;
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document["webkitExitFullscreen"]) {
            /* Safari */
            document["webkitExitFullscreen"]();
        } else if (document["msExitFullscreen"]) {
            /* IE11 */
            document["msExitFullscreen"]();
        }
    }
</script>

<FourByThreeScreen class="bg-[#001838]">
    <br />
    <br />
    <br />
    <br />
    <p>
        This is a series of games and apps I made for small kids less than 5 years old. There's more info at otaviogood.com and github.com/otaviogood/tinyOS.
    </p><br/>
    <p>
        This works best if you "install" it by (for iOS) clicking the share button and then "Add to Home Screen".
    </p><br/>
    <hr />

    <div class="text-4xl m-4">
        <button
            class="bg-green-600 text-white text-3xl rounded p-4 m-2"
            on:pointerup={() => {
                window.location.reload();
            }}><i class="fa-solid fa-rotate-right"></i> Reload browser</button
        ><br /><br />
        <button
            class="bg-blue-500 text-white text-3xl rounded p-4 m-2"
            on:pointerup={() => {
                $casing = ($casing + 1) % 2;
            }}>Upper / Lower Case</button
        > {["lower", "UPPER", "Mixed", "Strict Mixed"][$casing]}<br /><br />
        
        <div class="flex items-center my-4">
            <span class="text-3xl mr-4">Age:</span>
            <input 
                type="number" 
                min="0" 
                max="99" 
                class="bg-white text-black text-3xl rounded p-4 w-32"
                bind:value={$age}
            />
        </div><br />
        
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
                }, 5000);
            }}
            on:pointerup={() => {
                hold = false;
            }}>clear all local storage (paintings, photos, etc) (hold for 5 seconds)</button
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
        >
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
        <button
            class="bg-gray-600 text-white text-3xl rounded p-4 m-2"
            on:pointerdown={() => {
                hold = true;
                setTimeout(() => {
                    if (hold) showApiKeyInput = true;
                }, 2000);
            }}
            on:pointerup={() => {
                hold = false;
            }}><i class="fa-solid fa-key"></i> Change OpenAI API Key (hold for 2 seconds)</button>
    </div>

    <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
        <i class="fas fa-times-circle" />
    </div>
</FourByThreeScreen>

{#if showApiKeyInput}
    <APIKeyInput on:keySaved={() => showApiKeyInput = false} />
{/if}

<style>
</style>
