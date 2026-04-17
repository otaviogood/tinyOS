<script>
    import { pop } from "../router";
    import { handleResize } from "../screen";
    import RecPlayAudio from "../components/RecPlayAudio.svelte";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";

    handleResize();
</script>

<FourByThreeScreen bg="black">
    <div class="flex-center-all flex-col h-full w-full select-none">
        <RecPlayAudio />
        <RecPlayAudio />
        <RecPlayAudio />
        <RecPlayAudio />
        <!-- <pre class="text-2xl text-gray-500 absolute bottom-2">{debugStr}</pre> -->
    </div>
    <div class="absolute top-2 right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" on:pointerup={pop}>
        <i class="fas fa-times-circle" />
    </div>
</FourByThreeScreen>
