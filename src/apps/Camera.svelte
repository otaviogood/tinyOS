<script>
    
    function handleImage(e) {
        document.getElementById("upload-camera-file").click();
    }
</script>
This is the camera
    <input id="upload-image-file" type="file" multiple style="display:none" accept="image/*" on:change={(e) => handleImage(e)} />
<input
    id="upload-camera-file"
    type="file"
    style="display:none"
    accept="image/*"
    capture="environment"
    on:change={(e) => handleImage(e)}
/>

            <button
                on:click={(e) => {
                    document.getElementById("upload-camera-file").click();
                }}
            >
                <i class="fas fa-camera m-2 text-2xl text-gray-400 hover:text-gray-500" />
            </button>
