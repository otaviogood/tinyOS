<!-- Svelte / Tailwind component to take a picture from the camera with a preview, and save them as PNGs -->
<script>
    import { onMount } from "svelte";
    import { pop } from "svelte-spa-router";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import ImageBrowser from "./Paint/ImageBrowser.svelte";
    import { openDB, deleteDB, wrap, unwrap } from "idb";

    let video;
    let canvas, canvasThumb;
    let photos = [];
    let stream;
    let facingMode = "environment"; // default to rear facing camera (user, environment)
    let previewImage = null;
    let camWidth = 640;
    let camHeight = 480;
    let saving = false;

    onMount(() => {
        startCamera();

        return () => {
            stopCamera();
        };
    });

    function startCamera() {
        navigator.mediaDevices
            .getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1280 }, facingMode }, audio: false })
            .then((s) => {
                stream = s;
                video.srcObject = stream;
                video.play();
                let settings = s.getVideoTracks()[0].getSettings();
                camWidth = settings.width;
                camHeight = settings.height;
            })
            .catch((err) => {
                console.error("Unable to access camera:", err);
            });
    }

    function stopCamera() {
        video.srcObject = null;
        stream?.getTracks()?.forEach((track) => track?.stop());
        stream = null;
    }

    async function takeSnapshot() {
        saving = true;
        canvasThumb.getContext("2d").drawImage(video, 0, 0, canvasThumb.width, canvasThumb.height);
        let timestamp = Date.now().toString(); // Use current time as id since kids won't be able to type a name.
        await save(canvasThumb, timestamp + "_thumb", "jpg");
        canvas.width = camWidth;
        canvas.height = camHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = canvasThumb.toDataURL("image/jpg");
        // make a circular buffer of 3 images
        if (photos.length >= 3) photos.shift();
        photos.push(img);
        photos = photos;
        await save(canvas, timestamp + "_camera", "jpg");
        saving = false;
    }

    const dbPromise = openDB("keyval-store-tinyos-camera", 1, {
        upgrade(db) {
            console.log("upgrade");
            db.createObjectStore("keyval_camera");
            console.log("upgrade done");
        },
    });

    export async function get(key) {
        return (await dbPromise).get("keyval_camera", key);
    }
    export async function set(key, val) {
        return (await dbPromise).put("keyval_camera", val, key);
    }
    export async function del(key) {
        return (await dbPromise).delete("keyval_camera", key);
    }
    export async function clear() {
        return (await dbPromise).clear("keyval_camera");
    }
    export async function keys() {
        return (await dbPromise).getAllKeys("keyval_camera");
    }

    function dataURItoBlob(dataURI) {
        // convert base64/URLEncoded data component to raw binary data held in a string
        var byteString;
        if (dataURI.split(",")[0].indexOf("base64") >= 0) byteString = atob(dataURI.split(",")[1]);
        else byteString = unescape(dataURI.split(",")[1]);

        // separate out the mime component
        var mimeString = dataURI.split(",")[0].split(":")[1].split(";")[0];

        // write the bytes of the string to a typed array
        var ia = new Uint8Array(byteString.length);
        for (var i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }

        return new Blob([ia], { type: mimeString });
    }

    async function save(canvas, str = "camera", ext = "png") {
        // Save to indexedDB using idb
        let data = canvas.toDataURL("image/" + ext);
        let blob = dataURItoBlob(data);
        let name = str + "." + ext;
        let file = new File([blob], name, { type: "image/" + ext });
        // let store = db.transaction("files", "readwrite").objectStore("files");
        // store.put(file, id);
        await set(str, file);
        console.log("Saved to indexedDB", name);
    }

    async function load(key) {
        // Load from indexedDB using idb
        let file = await get(key);
        previewImage = URL.createObjectURL(file);
    }

    let allKeys = null;
    async function browse() {
        allKeys = keys();
    }

    function toggleFacing() {
        facingMode = facingMode === "user" ? "environment" : "user";
        stopCamera();
        startCamera();
    }
</script>

<FourByThreeScreen>
    <ImageBrowser
        keyPromise={allKeys}
        {dbPromise}
        dbStr={"keyval_camera"}
        on:loadimg={(k) => {
            load(k.detail.replace("thumb", "camera"));
        }}
    />
    <!-- Make a fullscreen image preview of the key that was returned from the ImageBrowser. -->
    {#if previewImage}
        <div class="fit-full-space p-2 bg-black z-10">
            <img src={previewImage} class="fit-full-space max-w-full max-h-full m-auto overflow-auto object-contain" alt="camera" on:pointerup={() => (previewImage = null)} />
            <!-- <div
                class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl"
                on:pointerup={() => (previewImage = null)}
            >
                <i class="fas fa-times-circle" />
            </div> -->
        </div>
    {/if}
    <div class="flex flex-col overflow-auto">
        <!-- svelte-ignore a11y-media-has-caption -->
        <video
            bind:this={video}
            class="block"
            style="wiXXdth:512px;heXXight:480px;max-height:62rem;{false ? '' : 'border:2px solid #404040;'}"
        />
        <canvas bind:this={canvas} width="640" height="480" style="display:none;" />
        <canvas bind:this={canvasThumb} width="320" height="200" style="display:none;" />

        <div class="flex flex-row overflow-hidden">
            {#each photos as photo}
                <img src={photo} class="max-h-32 m-2 mt-8" alt="thumbnail" on:pointerup={browse} />
            {/each}
        </div>
    </div>
    <button class="absolute right-[5rem] bottom-10 cursor-pointer select-none text-9xl w-32 h-32" on:pointerup={browse}>
        <i class="fa-solid fa-images" />
    </button>
    <button class="absolute right-[20rem] bottom-10 cursor-pointer select-none text-9xl w-32 h-32" on:pointerup={toggleFacing}>
        <i class="fa-solid fa-camera-rotate" />
    </button>
    {#if !saving}
        <button
            class="absolute left-[43.5rem] bottom-10 cursor-pointer select-none rounded-full bg-gray-600 w-32 h-32 border-[.5rem] border-white"
            on:pointerdown={takeSnapshot}
        />
    {:else}
        <button class="absolute left-[43.5rem] bottom-10 cursor-pointer select-none rounded-full bg-red-800 w-32 h-32" />
    {/if}
    <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
        <i class="fas fa-times-circle" />
    </div>
</FourByThreeScreen>

<style>
</style>
