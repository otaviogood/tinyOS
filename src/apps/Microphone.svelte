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
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../utils";
    import RecPlayAudio from "../components/RecPlayAudio.svelte";

    let debugStr = "";

    async function getDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        let allAudio = devices.filter((device) => device.kind === 'audiooutput');
        console.log(allAudio);
        const audioDevice = devices.find((device) => device.kind === 'audiooutput');
        for (let i = 0; i < allAudio.length; i++) {
            debugStr += allAudio[i].label + "\n";
            // console.log(allAudio[i].label);
        }
        // const audio = document.createElement('audio');
        // await audio.setSinkId(audioDevice.deviceId);
        // console.log(`Audio is being played on ${audio.sinkId}`);
    }

    getDevices();

    handleResize();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div
        class="relative overflow-hidden select-none"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)"
    >
        <div class="flex-center-all flex-col h-full w-full">
            <RecPlayAudio />
            <RecPlayAudio />
            <RecPlayAudio />
            <RecPlayAudio />
            <pre class="text-2xl text-gray-500 absolute bottom-2">{debugStr}</pre>
        </div>
        <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
            <i class="fas fa-times-circle" />
        </div>
    </div>
</div>
