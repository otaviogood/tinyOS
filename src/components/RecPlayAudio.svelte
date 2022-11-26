<script>
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../utils";

    let recorder;
    let audio;
    let debugStr = "";

    const recordAudio = () =>
        new Promise(async (resolve) => {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            const audioChunks = [];

            mediaRecorder.addEventListener("dataavailable", (event) => {
                audioChunks.push(event.data);
            });

            const start = () => mediaRecorder.start();

            const stop = () =>
                new Promise((resolve) => {
                    mediaRecorder.addEventListener("stop", async () => {
        // const devices = await navigator.mediaDevices.enumerateDevices();
        // let allAudio = devices.filter((device) => device.kind === 'audiooutput');
        // // console.log(allAudio);
        // // const audioDevice = devices.find((device) => device.kind === 'audiooutput');

                        const audioBlob = new Blob(audioChunks);
                        const audioUrl = URL.createObjectURL(audioBlob);
                        const audio2 = new Audio(audioUrl);
        // await audio2.setSinkId(allAudio[allAudio.length - 1].deviceId);
        // debugStr = allAudio[allAudio.length - 1].label;
                        const play = () => {
                            audio2.currentTime = 0;
                            audio2.play();
                        };
                        resolve({ audioBlob, audioUrl, play });
                    });

                    mediaRecorder.stop();
                });

            resolve({ start, stop });
        });
</script>

<div class="flex">
    <div>
        <button
            class="{recorder ? 'bg-indigo-600' : 'bg-red-600'} text-white text-8xl m-2 p-8 {audio
                ? 'rounded-l-full'
                : 'rounded-full'}"
            style={recorder ? "box-shadow: 0px 0px 2rem 2rem #38f;" : ""}
            on:pointerdown={async () => {
                recorder = await recordAudio();
                recorder.start();
            }}
            on:pointerup={async () => {
                audio = await recorder.stop();
                recorder = null;
            }}>REC</button
        >
    </div>
    {#if audio}
        <div>
            <button class="bg-green-600 text-white text-8xl m-2 p-8 rounded-r-full w-96" on:pointerdown={() => audio.play()}
                >PLAY</button
            >
        </div>
    {:else}
        <div>
            <button class="text-white text-8xl m-2 p-8 rounded-r-full w-96" style="background-color:#90909020">&nbsp;</button>
        </div>
    {/if}
    <div class="text-3xl">{debugStr}</div>
</div>
