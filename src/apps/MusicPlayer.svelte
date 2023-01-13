<script>
    // import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import { pop } from "svelte-spa-router";
    // import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../utils";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../animator";
    import Keyboard from "../components/Keyboard.svelte";
    import VideoCard from "../components/VideoCard.svelte";
    import SVGArcDeg from "../components/SVGArcDeg.svelte";
    // import IconsMisc from "./IconsMisc.svelte";
    import { speechPlay } from "../utils";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import { allMediaAll } from "./mediaGenerated";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_current = null;

    let animator = new Animator(60, tick);

    let started = false;
    let finalGraphic = false;

    let minimal = {
        "hat": ["8_UnANdDqJc", "Franzl Lang Yodeling", "webm"],
        "auto": ["rfoKnb-Tj1M", "Franzl Lang - Auto Jodler", "webm"],
        "komm mit": ["SmGUmVPRMCA", "Franzl Lang - Komm mit in die Berge - 1976", "webm"],
    }

    let allMedia;
    if (!localStorage.getItem("unlockmusic")) allMedia = minimal;
    else allMedia = allMediaAll;
    let typed = "";
    let playing = null;
    let playbackElement = null;

    let duration = 0;
    let percentComplete = 0;
    let startTime = null;
    let sinTime = 0.0;

    onMount(() => {
        return () => {
            animator.stop();
        };
    });

    function tick() {
        sinTime = Math.sin(Date.now() / 1000.0 * 3.14159 * 2) * 0.5 + 0.5;
        if (startTime) {
            let now = Date.now();
            let elapsed = (now - startTime) / 1000;
            percentComplete = snd_current.seek() / duration;
            // percentComplete = Math.max(percentComplete, 0.01);
            // if (percentComplete > 1) {
            //     percentComplete = 1;
            //     playing = null;
            //     playbackElement = null;
            // }
        }
    }

    function matchedMedia(typed) {
        let media = Object.keys(allMedia).find((m) => m.toLowerCase() == typed.toLowerCase());
        // console.log("matched", media);
        if (media) {
            return allMedia[media];
        }
        return null;
    }

    async function keyPressed(e) {
        let key = e.detail.key;
        if (key == "backspace") {
            typed = typed.slice(0, -1);
        } else if (key == "music") {
            let media = matchedMedia(typed);
            console.log("media", media, typed);
            if (media) {
                playing = media;
                await speechPlay(Object.keys(allMedia).find((m) => m.toLowerCase() == typed.toLowerCase()))
                typed = "";
                // getYoutubeAudio(media, playbackElement);

                snd_current = new Howl({
                    src: ["youtube/_" + playing[0] + "." + playing[2]],
                    html5: true
                });
                snd_current.once('load', function(){
                    duration = snd_current.duration();
                    snd_current.play();
                    startTime = Date.now();
                });
                snd_current.on('end', function(){
                    console.log('Finished!');
                    playing = null;
                    startTime = null;
                });
            } else {
                if (typed.toLowerCase() === 'unlock') {
                    localStorage.setItem("unlockmusic", "hurray");
                    allMedia = allMediaAll;
                }
            }
            return;
        } else {
            if (typed.length < 28) typed += key;
        }
        let media = matchedMedia(typed);
        // console.log("typed", typed);
        if (media) {
            console.log("matched", media);
            snd_good.play();
        }
    }

    async function startGame() {
        snd_button.play();
        if (snd_current) snd_current.stop();
        finalGraphic = false;
        started = true;

        typed = "";
        playing = null;
        playbackElement = null;
        duration = 0;
        percentComplete = 0;
        startTime = null;

        animator.start();
    }

    function resetToSplashScreen() {
        if (snd_current) snd_current.stop();
        started = false;
        pop();
    }

    function getPointerPos(ev) {
        let x = ev.clientX / $bigScale;
        let y = ev.clientY / $bigScale;
        // hack to return angle and whether or not you are in the rainbow.
        x -= 0.5;
        y -= 0.4;
        let angle = Math.atan2(y, x);
        let len = Math.sqrt(x * x + y * y);
        x = angle;
        y = (len < 0.35) && (len > 0.2) ? 1 : 0;
        return [x, y];
    }

    let startX = -1;
    function handleUp() {
        startX = -1;
    }

    function handleDown(e) {
        let xy = getPointerPos(e);
        let alpha = xy[0];
        if (xy[1] === 0) return;
        startX = alpha;
    }

    function handleMove(e) {
        if (startX == -1) return;
        if (snd_current == null) return;
        if (duration == 0) return;
        if (startTime == null) return;
        // let xy = getPointerPos(e);
        // if (xy[1] == 0) {
        //     startX = xy[0];
        //     return;
        // }
        // let alpha = (xy[0] - startX);
        // startX = xy[0];
        // let newPos = snd_current.seek() + alpha * duration;
        // if (newPos < 0) newPos = 0;
        // if (newPos > duration) newPos = duration;
        // percentComplete = snd_current.seek(newPos) / duration;
        // // console.log("seek", alpha, percentComplete);
    }

    handleResize();
    startGame();
</script>

<FourByThreeScreen>
    {#if !started}
        <div class="flex-center-all h-full flex flex-col">
            <!-- <img src="gamedata/busstop/intro.webp" class="absolute top-0" alt="skyscraper" style="height:64rem" />
            <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
            <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button> -->
        </div>
    {:else}
        <div class="flex flex-row h-full w-full" style="{playing?"background-color:#ACEAFF":""}">
            {#if !playing}
                <div class="flex flex-col w-full">
                    <div class="flex flex-row flex-wrap w-full overflow-hidden overflow-y-scroll scroll" style="height:30rem;touch-action:auto;scroll-behavior:auto;" on:touchmove={(e) => {window.letMeScroll = true; e.currentTarget.dataset.lastTouch = 0;
                    }}>
                        {#each Object.entries(allMedia) as media, i}
                            <div class="w-1/3 border-white active:scale-110 transform transition-all duration-75" on:pointerup={() => {speechPlay(media[0])}}>
                                <VideoCard label={media[0]} id={media[1][0]} highlight={media[0].toLowerCase() === typed.toLowerCase()} {typed} />
                            </div>
                        {/each}
                    </div>
                    <pre class="border border-pink-500 bg-pink-900 text-white text-7xl p-2 my-2 rounded-2xl">{typed}{sinTime > 0.5 ? '_' : ''}&nbsp;</pre>
                    <Keyboard on:pressed={keyPressed} enterEnabled={matchedMedia(typed)?.length > 0} />
                </div>
                <div class="cursor-pointer select-none absolute right-4" style="bottom:31rem; padding:0 0.75rem;border-radius:0.75rem;backXXXground-color:#486870" on:pointerup|preventDefault|stopPropagation={resetToSplashScreen} on:touchstart={preventZoom}>
                    <!-- <IconsMisc icon="treasure-map" size="7.5rem" style="" /> -->
                </div>
    <div class="absolute right-2 cursor-pointer select-none rounded-full text-gray-500 text-8xl" style="bottom:32rem" on:pointerup={pop}><i class="fas fa-times-circle"></i></div>
            {:else}
                <div class="flex-center-all flex-col w-full" on:pointermove|preventDefault|stopPropagation={(e) => handleMove(e)} on:pointerdown|preventDefault|stopPropagation={(e) => handleDown(e)} on:pointerup|preventDefault|stopPropagation={() => handleUp()}>
                    <!-- clouds at end of rainbow -->
                    <div class="absolute bg-white rounded-full w-32 h-32 z-10" style="background-color:#ffffffd0;left:19.5rem; bottom:34rem;"></div>
                    <div class="absolute bg-white rounded-full w-32 h-32 z-10" style="background-color:#ffffff80;left:17rem; bottom:33rem;"></div>
                    <div class="absolute bg-white rounded-full w-32 h-32 z-10" style="background-color:#ffffff80;left:22rem; bottom:32rem;"></div>

                    <div class="absolute bg-white rounded-full w-32 h-32 z-10" style="background-color:#ffffffd0;right:19.5rem; bottom:34rem;"></div>
                    <div class="absolute bg-white rounded-full w-32 h-32 z-10" style="background-color:#ffffff80;right:18rem; bottom:33.5rem;"></div>
                    <div class="absolute bg-white rounded-full w-32 h-32 z-10" style="background-color:#ffffff80;right:22rem; bottom:33rem;"></div>
                    <!-- rainbow -->
                    <SVGArcDeg class="absolute" color="#ff0000" startAngle={-90} endAngle={-90 + percentComplete*180} />
                    {#if startX === -1}
                    <SVGArcDeg class="absolute" color="#ff8000" startAngle={-90} endAngle={-90 + percentComplete*180} radius={77} />
                    <SVGArcDeg class="absolute" color="#ffff00" startAngle={-90} endAngle={-90 + percentComplete*180} radius={74} />
                    <SVGArcDeg class="absolute" color="#00ff00" startAngle={-90} endAngle={-90 + percentComplete*180} radius={71} />
                    <SVGArcDeg class="absolute" color="#00ffff" startAngle={-90} endAngle={-90 + percentComplete*180} radius={68} />
                    <SVGArcDeg class="absolute" color="#0000ff" startAngle={-90} endAngle={-90 + percentComplete*180} radius={65} />
                    <SVGArcDeg class="absolute" color="#8000ff" startAngle={-90} endAngle={-90 + percentComplete*180} radius={62} />
                    {/if}
                    <img src={"youtube/_" + playing[0] + "_thumb.jpg"} alt="" class="flex-center-all max-h-96 w-96 hXXX-96 mt-32 text-center rounded-xl bg-transparent"/>
                    <div class="text-6xl m-2 p-2 w-full flex-center-all text-white" style="filter: drop-shadow(0 0 0.75rem #105080);">{playing[1]}</div>
                    <button class="bg-red-500 text-white text-9xl rounded-3xl px-8 mt-4 z-10 h-32" on:pointerup|preventDefault|stopPropagation={() => {snd_current.stop(); startGame()}}>STOP</button>
                </div>
            {/if}

        </div>
    {/if}
</FourByThreeScreen>

<style>
    /* Nice scrollbars */
    /* width */
    .scroll::-webkit-scrollbar {
        width: 10px;
        height: 10px;
    }

    /* bottom-right corner rectangle */
    .scroll::-webkit-scrollbar-corner {
        @apply bg-gray-300;
        /* @apply dark:bg-gray-900; */
    }

    /* Track */
    .scroll::-webkit-scrollbar-track {
        @apply bg-pink-900;
        /* background-color: #f000f0; */
        /* @apply dark:bg-gray-800; */
    }

    /* Handle */
    .scroll::-webkit-scrollbar-thumb {
        @apply bg-pink-500;
        /* @apply dark:bg-gray-500; */
        @apply rounded;
    }

    /* Handle on hover */
    .scroll::-webkit-scrollbar-thumb:hover {
        @apply bg-pink-400;
    }

</style>
