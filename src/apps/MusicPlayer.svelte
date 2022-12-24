<script>
    // import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import { pop } from "svelte-spa-router";
    // import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom, GetVideoThumb } from "../utils";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../animator";
    import Keyboard from "../components/Keyboard.svelte";
    import VideoCard from "../components/VideoCard.svelte";
    import SVGArcDeg from "../components/SVGArcDeg.svelte";
    // import IconsMisc from "./IconsMisc.svelte";
    import { speechPlay } from "../utils";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_current = null;

    let animator = new Animator(60, tick);

    let started = false;
    let finalGraphic = false;

    let minimal = {
        hat: ["8_UnANdDqJc", "Y2Mate.is - Franzl Lang Yodeling-8_UnANdDqJc-160k-1657994398559.mp3"],
        auto: ["rfoKnb-Tj1M", "Y2Mate.is - Franzl Lang - Auto Jodler-rfoKnb-Tj1M-160k-1657996660769.mp3"],
        "komm mit": ["SmGUmVPRMCA", "Y2Mate.is - Franzl Lang - Komm mit in die Berge - 1976-SmGUmVPRMCA-96k-1657994281589.mp3"],
    }

    let allMediaAll = {
        "thomas": ["GnrwM7vFn_U", "Y2Mate.is - Thomas The Tank Engine Theme Song-GnrwM7vFn_U-128k-1659599526795.mp3"],
        "Elmo": ["vSYadh2xmcI", "Y2Mate.is - Sesame Street Elmo's Song-vSYadh2xmcI-128k-1659600205610.mp3"],
        hat: ["8_UnANdDqJc", "Y2Mate.is - Franzl Lang Yodeling-8_UnANdDqJc-160k-1657994398559.mp3"],
        "let it go": ["NH15p2dqvJk", "Y2Mate.is - 5. Let it Go - Frozen (OST)-NH15p2dqvJk-160k-1657994331936.mp3"],
        "mama yoho": ["tgbNymZ7vqY", "Y2Mate.is - Bohemian Rhapsody  Muppet Music Video  The Muppets-tgbNymZ7vqY-160k-1658035224036.mp3"],
        "dancer": ["65CNtap6bow", "Y2Mate.is - Tiny Dancer (Remastered)-65CNtap6bow-160k-1658043302961.mp3"],
        "dollars": ["DT1NJwEi6nw", "Y2Mate.is - For A Few Dollars More  The Danish National Symphony Orchestra (Live)-DT1NJwEi6nw-160k-1658034815623.mp3"],
        manatee: ["pd1WGa4JNfE", "Y2Mate.is - I'm A Manatee-pd1WGa4JNfE-160k-1658036569307.mp3"],
        pig: ["4n7bUYBYZPE", "Y2Mate.is - Pig Calling Contest goes METAL!-4n7bUYBYZPE-160k-1657995491716.mp3"],
        "good bad": ["enuOArEfqGo", "Y2Mate.is - The Good, the Bad and the Ugly - The Danish National Symphony Orchestra (Live)-enuOArEfqGo-160k-1658034844096.mp3"],
        "muffin man": ["fXFg5QsTcLQ", "Y2Mate.is - The Muffin Man  Kids Songs  Super Simple Songs-fXFg5QsTcLQ-160k-1658042334177.mp3"],
        "yodel metal": ["_xpb0_GXkV8", "Y2Mate.is - YODEL METAL-_xpb0_GXkV8-160k-1657995368274.mp3"],
        "stand up": ["t9WAGkQUUL0", "Y2Mate.is - Stand Up, Sit Down Children's song by Miss Patty  Popular Nursery rhymes for Kids and Toddlers-t9WAGkQUUL0-128k-1655458342386.mp3"],
        "fish": ["uCF3vBuxXS8", "Y2Mate.is - The Laurie Berkner Band - The Goldfish (Official Video)-uCF3vBuxXS8-128k-1659599530489.mp3"],
        auto: ["rfoKnb-Tj1M", "Y2Mate.is - Franzl Lang - Auto Jodler-rfoKnb-Tj1M-160k-1657996660769.mp3"],
        "despacito": ["kJQP7kiw5Fk", "Y2Mate.is - Luis Fonsi - Despacito ft. Daddy Yankee-kJQP7kiw5Fk-128k-1655369706896.mp3"],
        "apples": ["r5WLXZspD1M", "Y2Mate.is - Apples & Bananas  Super Simple Songs-r5WLXZspD1M-128k-1655458984556.mp3"],
        "roses": ["m2AuVIjy5po", "Y2Mate.is - Roses Are Red (Original Version)-m2AuVIjy5po-128k-1655458782075.mp3"],
        "candyman": ["k-ykJHUIyEw", "Y2Mate.is - Lollipop (Candyman)-k-ykJHUIyEw-128k-1659598978850.mp3"],
        "komm mit": ["SmGUmVPRMCA", "Y2Mate.is - Franzl Lang - Komm mit in die Berge - 1976-SmGUmVPRMCA-96k-1657994281589.mp3"],
        "particle": ["vOLivyykLqk", "Y2Mate.is - Particle Man-vOLivyykLqk-128k-1660212809922.mp3"],
        "hakuna": ["BAoCYwefq1A", "Y2Mate.is - The Lion King - Hakuna Matata  1080p  HD  English-BAoCYwefq1A-128k-1659857295283.mp3"],
        "sun": ["hlzvrEfyL2Y", "Y2Mate.is - Mr. Sun, Sun, Mr. Golden Sun  Kids Songs  Super Simple Songs-hlzvrEfyL2Y-128k-1654599067217.mp3"],
        "chicken": ["DQU70FFFw6Y", "Y2Mate.is - The Laurie Berkner Band - I Know A Chicken (Official Video)-DQU70FFFw6Y-128k-1656876900448.mp3"],
        "sillies": ["03zqJQJRLN0", "Y2Mate.is - Shake your sillies out!!!-03zqJQJRLN0-128k-1654598849061.mp3"],
        "witch doctor": ["cmjrTcYMqBM", "Y2Mate.is - WITCH DOCTOR (David Seville)  1958 original version-cmjrTcYMqBM-128k-1655757018233.mp3"],
        "trick or treat": ["veZlIX6d63Y", "Y2Mate.is - Who Took The Candy  Halloween Song  Super Simple Songs-veZlIX6d63Y-128k-1657225626911.mp3"],
        "count": ["ZIniljT5lJI", "Y2Mate.is - Sesame Street Song of the Count-ZIniljT5lJI-128k-1657741419872.mp3"],
        "count bones": ["LP2rVGbZXrw", "Y2Mate.is - Sesame Street The Count's Bones Song-LP2rVGbZXrw-128k-1656273325777.mp3"],
        "batty bat": ["N7yAe2MBIpE", "Y2Mate.is - Sesame Street Batty Bat-N7yAe2MBIpE-128k-1656273051319.mp3"],
    };
    /*!speech
[
        "thomas",
        "Elmo",
        "hat",
        "let it go",
        "mama yoho",
        "dancer",
        "dollars",
        "manatee",
        "pig",
        "good bad",
        "muffin man",
        "yodel metal",
        "stand up",
        "fish",
        "auto",
        "despacito",
        "apples",
        "roses",
        "candyman",
        "komm mit",
        "particle",
        "hakuna",
        "sun",
        "chicken",
        "sillies",
        "witch doctor",
        "trick or treat",
        "count",
        "count bones",
        "batty bat",
]
    */
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

    function keyPressed(e) {
        let key = e.detail.key;
        if (key == "backspace") {
            typed = typed.slice(0, -1);
        } else if (key == "music") {
            let media = matchedMedia(typed);
            console.log("media", media, typed);
            if (media) {
                speechPlay(Object.keys(allMedia).find((m) => m.toLowerCase() == typed.toLowerCase()))
                typed = "";
                playing = media;
                // getYoutubeAudio(media, playbackElement);

                snd_current = new Howl({
                    src: ["youtube/" + media[1]],
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

    function cleanFilename(filename) {
        let i = playing[1].lastIndexOf("-");
        i = playing[1].lastIndexOf("-", i - 1);
        i -= 12;
        let s = playing[1].substring(0, i).replace("Y2Mate.is - ","")
        return s;
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
        let xy = getPointerPos(e);
        if (xy[1] == 0) {
            startX = xy[0];
            return;
        }
        let alpha = (xy[0] - startX);
        startX = xy[0];
        let newPos = snd_current.seek() + alpha * duration;
        if (newPos < 0) newPos = 0;
        if (newPos > duration) newPos = duration;
        percentComplete = snd_current.seek(newPos) / duration;
        // console.log("seek", alpha, percentComplete);
    }

    handleResize();
    startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <!-- <img src="gamedata/busstop/intro.webp" class="absolute top-0" alt="skyscraper" style="height:64rem" />
                <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button> -->
            </div>
        {:else}
            <div class="flex flex-row h-full w-full" style="{playing?"background-color:#ACEAFF":""}">
                <!-- <div class="fit-full-space" style=""> -->
                <!-- <img src="gamedata/airplanecrash/Airport.png" class="absolute top-0 left-0 w-full h-full" alt="bus stop background" style="opacity:0.66" /> -->
                <!-- </div> -->

                <!-- <div class="w-full"><audio bind:this={playbackElement} id="youtube" autoplay controls loop></audio></div> -->
                <!-- <div id="player"></div> -->
                <!-- <iframe bind:this={player} id="player" type="text/html" width="640" height="390" title="player" src="http://www.youtube.com/embed/M7lc1UVf-VE?enablejsapi=1&origin=http://example.com" frameborder="0"></iframe> -->
                <!-- <div id="YouTube" style="width:0px;height:0px"></div>
                <div class="player" on:click={toggle_player}>
                <div class="player-button" on:click={start_player}>
                    Listen to "Deep House Mix"
                    <span class="duration">0:00</span></div>
                </div> -->

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
                    <div class="flex-center-all flex-col w-full" on:pointermove={(e) => handleMove(e)} on:pointerdown={(e) => handleDown(e)} on:pointerup={() => handleUp()}>
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
                        <img src={GetVideoThumb(playing[0])} alt="" class="flex-center-all max-h-96 w-96 h-96 mt-32 text-center rounded-xl bg-transparent"/>
                        <div class="text-6xl m-2 p-2 w-full flex-center-all text-white" style="filter: drop-shadow(0 0 0.75rem #105080);">{cleanFilename(playing[1])}</div>
                        <button class="bg-red-500 text-white text-9xl rounded-3xl px-8 mt-4 z-10 h-32" on:pointerup|preventDefault|stopPropagation={() => {snd_current.stop(); startGame()}}>STOP</button>
                    </div>
                {/if}

            </div>
        {/if}
    </div>
</div>

<style>
      .player {
    display: inline-block;
    text-align: center;
    font-family: sans-serif;
    box-sizing: border-box;
    background: royalblue;
    color: white;
    cursor: pointer;
    position: relative;
    border-radius: 25px; 
    height: 50px;
    line-height: 1;
    padding: 18px 20px;
  }
  .player-button::before,
  .player-button.playing::before{
    content: '';
    display: inline-block;
    border: 0;
    background: transparent;
    box-sizing: border-box;
    width: 0;
    height: 12px;
    margin-right: 10px;
    border-color: transparent transparent transparent #FFF;
    transition: 100ms all ease;
    cursor: pointer;
    border-style: solid;
    border-width: 6px 0 6px 8px;
  }
  .player-button.playing::before {
    border-style: double;
    border-width: 0px 0 0px 8px;
  }

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
