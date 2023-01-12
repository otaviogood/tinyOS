<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "svelte-spa-router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../../animator";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_countdown = new Howl({
        src: ['/TinyQuest/gamedata/rocketlaunch/Rocket_sounds_mixdown_v01.mp3'],
        sprite: {
            // 10. Clear pad of all personnel
            // 9. Begin loading cryogenic propellants
            // 8. Crew begin entry into the orbiter
            // 7. Crew, how do you read? Uh, loud and clear
            // 6. Retract launch umbilical tower
            // 5. Retract orbiter access arm
            // 4. We are go for launch
            // 3. Activate main engine hydrogen burnoff system
            // 2. Main engine start
            // 1. ignition and liftoff. We have liftoff on Apollo 11.
            // Tower cleared
            cd10: [0, 2046],
            cd9: [2789, 2998],
            cd8: [6344, 2743],
            cd7: [10301, 5138],
            cd6: [16355, 3129],
            cd5: [20191, 2635],
            cd4: [23720, 2523],
            cd3: [27064, 4068],
            cd2: [32027, 2324],
            cd1: [35350, 9296],
        }
    });
    var snd_launch = new Howl({ src: ["/TinyQuest/gamedata/rocketlaunch/launch.mp3"], volume: 0.8 });
    // var snd_engines = new Howl({ src: ["/TinyQuest/gamedata/rocketlaunch/engines.mp3"], volume: 0.5, sprite: { a: [0, 1528] }, loop: true });
    let looper;
    var snd_engines = new Howl({ src: ["/TinyQuest/gamedata/rocketlaunch/engines.mp3"], volume: 0.4, onplay: ()=>{
        looper = setTimeout(()=>{
        snd_engines.play();
        },1450);
    }
    , onstop: ()=>{
        clearTimeout(looper);
    } });

    let animator = new Animator(60, tick);

    let currentSound;

    const scrollX = tweened(0.0, { duration: 100, easing: cubicInOut });
    const scrollY = tweened(0.0, { duration: 100, easing: cubicInOut });
    const slowScrollX = tweened(0.0, { duration: 2000, easing: cubicInOut });
    const slowScrollY = tweened(0.0, { duration: 2000, easing: cubicInOut });
    const scaleAnim = tweened(1.0, { duration: 2000, easing: cubicInOut });

    const maxStars = 1; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    let currentNumbers;
    let clearedNumbers;
    const maxNumbers = 10;
    const winNumber = 1;
    let clickSequence = maxNumbers;
    let liftoffAnim = 0.0;

    function genPos() {
        // Spawn eggs in random position
        let sx = 0.77;
        let sy = 0.56;
        let ox = 0.01;
        let oy = 0.01;
        let x = Math.random() * sx + ox;
        let y = Math.random() * sy + oy;
        // Make sure they don't overlap.
        for (let reps = 0; reps < 200; reps++) {
            let collision = false;
            while ((x > 0.25) && (x < 0.67)) {
                // Save space for a rocket in the middle of the screen
                collision = true;
                x = Math.random() * sx + ox;
                y = Math.random() * sy + oy;
            }
            for (let i = 0; i < currentNumbers.length; i++) {
                let dx = x - currentNumbers[i].x0;
                let dy = y - currentNumbers[i].y0;
                if (Math.sqrt(dx * dx + dy * dy) < 0.12) {
                    collision = true;
                    x = Math.random() * sx + ox;
                    y = Math.random() * sy + oy;
                }
            }
            if (!collision) break;
        }
        return [x, y];
    }

    function makeNewNumber() {
        let xy = genPos();
        currentNumbers.push({ number: currentNumbers.length + 1, x0: xy[0], y0: xy[1], doneAnim: 0.0, animInc: 0.01 });
        clearedNumbers.push(false);
    }

    function randomizeNumbers() {
        clickSequence = maxNumbers;
        currentNumbers = [];
        clearedNumbers = [];
        for (let i = 0; i < maxNumbers; i++) makeNewNumber();
    }

    // let imageCache=[];
    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        // let imageList = ["TinyQuest/gamedata/rocketlaunch/explosion_ground.png", "TinyQuest/gamedata/rocketlaunch/smoke_ground.png", "TinyQuest/gamedata/rocketlaunch/jet_flame.png", "TinyQuest/gamedata/rocketlaunch/smoke_ground_r.png", "TinyQuest/gamedata/rocketlaunch/smoke_ground_l.png"];
        // imageList.forEach( function(path) { let temp = new Image(); temp.src=path; imageCache.push(temp); } );
        return () => {
            snd_engines.stop();
            animator.stop();
        };
    });

    function tick() {
        // if (Math.random() < 0.03) randomizeNumbers();
        if (currentNumbers) {
            for (let i = 0; i < maxNumbers; i++) {
                if (currentNumbers[i].doneAnim > 0.0 && currentNumbers[i].doneAnim < 1.0) {
                    currentNumbers[i].doneAnim += currentNumbers[i].animInc;
                    currentNumbers[i].doneAnim = Math.min(currentNumbers[i].doneAnim, 1.0);
                    currentNumbers[i].x0 *= 0.9;
                    currentNumbers[i].y0 = currentNumbers[i].y0 * 0.9 + 0.6 * 0.1;
                    currentNumbers[i] = currentNumbers[i];
                }
            }
        }
        if ((liftoffAnim > 0.0) && (liftoffAnim < 100)) {
            liftoffAnim += liftoffAnim*0.0095 + 0.005;
            $scrollX = (Math.random()*2 - 1.0)* Math.min(2.0, 1.0/Math.log(liftoffAnim+1));
            $scrollY = (Math.random()*2 - 1.0)* Math.min(2.0, 1.0/Math.log(liftoffAnim+1));
        }
    }

    async function clickedNumber(index, l) {
        // console.log(clickSequence, l.number, winNumber);
        if (clickSequence === l.number) {
            if (currentSound) {
                snd_countdown.stop(currentSound);
                currentSound = null;
            }
            currentSound = snd_countdown.play("cd" + l.number.toString());
            clearedNumbers[clickSequence - 1] = true;
            currentNumbers[clickSequence - 1].doneAnim = currentNumbers[clickSequence - 1].animInc;
            snd_good.play();
            currentNumbers[9].animInc = 0.003;
            if (clickSequence === 3) snd_engines.play();
            if (clickSequence === 8) {
                currentNumbers[7].animInc = 0.003;
                $scaleAnim = 3.0;
                $slowScrollX = -3;
                $slowScrollY = 20;
            } else if (clickSequence === 7) {
                $scaleAnim = 1.0;
                $slowScrollX = 0;
                $slowScrollY = 0;
            }
            if (clickSequence === winNumber) {
                starCount++;
                liftoffAnim = 0.01;
                snd_launch.play();
                snd_engines.stop();
                await sleep(8000);
                // snd_good.play();
                if (starCount >= maxStars) {
                    // Finished game. Yay!
                    await sleep(2000);
                    finalGraphic = true;
                    snd_fanfare.play();
                    $earnedStar = true;
                    return;
                } else {
                    await sleep(2000);
                    randomizeNumbers();
                    stage++;
                }
            }
            clickSequence--;
        } else {
            snd_error.play();
        }
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;
        clickSequence = 10;
        liftoffAnim = 0.0;
        scrollY.set(0.0, { duration: 0 });
        scaleAnim.set(1.0, { duration: 0 });
        randomizeNumbers();
        animator.start();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    handleResize();
    // startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <!-- <div style="color:white">                        {clickSequence === 1}</div> -->
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">

                <svg class="fit-full-space"
                    xmlns:dc="http://purl.org/dc/elements/1.1/"
                    xmlns:cc="http://creativecommons.org/ns#"
                    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
                    xmlns:svg="http://www.w3.org/2000/svg"
                    xmlns="http://www.w3.org/2000/svg"
                    xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
                    xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
                    viewBox="0 0 879.10669 879.12"
                    xml:space="preserve"
                    id="svg2"
                    version="1.1"
                    sodipodi:docname="rocket-launch-publicdomainvectors.org.svg"
                    inkscape:version="0.92.3 (2405546, 2018-03-11)"><defs
                        id="defs6" /><path
                        id="path14"
                        style="fill:#425e78;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="M 0,879.12 H 879.11198 V 0.00668864 H 0 V 879.12"
                        inkscape:connector-curvature="0" /><path
                        id="path16"
                        style="fill:#5f7d95;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 439.55599,39.002688 c 176.56933,0 334.45599,79.888002 439.55599,205.467992 V 879.12 H 0 V 244.47068 C 105.10213,118.89069 262.99199,39.002688 439.55599,39.002688"
                        inkscape:connector-curvature="0" /><path
                        id="path18"
                        style="fill:#7492a8;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 439.55599,146.67202 c 203.41199,0 376.30799,130.54 439.55599,312.40399 v 305.76533 c -14.26,41.0052 -34.08667,79.39999 -58.59067,114.27866 H 58.592132 C 34.088532,844.244 14.2656,805.844 0,764.84134 V 459.07601 C 63.249998,277.21202 236.14533,146.67202 439.55599,146.67202"
                        inkscape:connector-curvature="0" /><path
                        id="path20"
                        style="fill:#8aa6b8;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 439.55599,254.34135 c 197.51066,0 357.62132,160.11066 357.62132,357.61999 0,106.24933 -46.35466,201.65706 -119.91999,267.15866 H 201.85599 C 128.28746,813.6184 81.937465,718.21067 81.937465,611.96134 c 0,-197.50933 160.113195,-357.61999 357.618525,-357.61999"
                        inkscape:connector-curvature="0" /><path
                        id="path22"
                        style="fill:#a0bbce;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 439.55599,362.00801 c 138.04533,0 249.95199,111.90933 249.95199,249.95333 0,138.04253 -111.90666,249.94773 -249.95199,249.94773 -138.04133,0 -249.94933,-111.9052 -249.94933,-249.94773 0,-138.044 111.908,-249.95333 249.94933,-249.95333"
                        inkscape:connector-curvature="0" /><path
                        id="path24"
                        style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 429.21466,178.53735 -9.89867,199.69466 -9.91733,199.692 h 39.636 l -9.92134,-199.692 -9.89866,-199.69466"
                        inkscape:connector-curvature="0" /><path
                        id="path26"
                        style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 449.89599,178.53735 -9.896,199.69466 -9.92133,199.692 h 39.63733 l -9.92133,-199.692 -9.89867,-199.69466"
                        inkscape:connector-curvature="0" /><path
                        id="path28"
                        style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 439.55599,46.806687 c 7.628,19.373333 11.2,36.308 11.2,57.192003 v 78.95333 h -22.40133 v -78.95333 c 0,-20.881337 3.57333,-37.821336 11.20133,-57.192003"
                        inkscape:connector-curvature="0" /><path
                        id="path30"
                        style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 429.21466,152.68802 v 0 c 5.68933,0 10.34133,4.65066 10.34133,10.33866 0,-5.688 4.65067,-10.33866 10.34,-10.33866 v 0 c 5.688,0 10.34267,4.65066 10.34267,10.33866 v 48.25334 h -20.68267 -20.68267 v -48.25334 c 0,-5.688 4.656,-10.33866 10.34134,-10.33866"
                        inkscape:connector-curvature="0" /><path
                        id="path32"
                        style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="M 0,689.408 V 572.15467 l 0.31718799,-0.228 L 0,571.79201 v -74.55867 c 4.8666665,-2.068 10.2224,-3.22 15.8464,-3.22 17.809866,0 32.934265,11.49734 38.357199,27.476 13.524533,5.29067 23.101599,18.448 23.101599,33.84667 0,6.536 -1.7276,12.672 -4.751066,17.97066 16.231866,3.55467 29.981868,13.736 38.270398,27.568 4.45933,-2.74133 9.702,-4.32 15.31507,-4.32 1.40773,0 2.7932,0.104 4.14586,0.29334 6.1612,-18.20667 23.3892,-31.31334 43.67854,-31.31334 25.46,0 46.10133,20.63867 46.10133,46.10134 0,25.45866 -20.64133,46.096 -46.10133,46.096 -10.76,0 -20.656,-3.684 -28.49867,-9.86134 -5.16133,4.52934 -11.92133,7.276 -19.32573,7.276 -3.87134,0 -7.56827,-0.75066 -10.95054,-2.11466 -8.6568,22.14133 -30.201062,37.82933 -55.408795,37.82933 -8.489066,0 -16.560533,-1.78134 -23.866266,-4.98934 C 29.767733,689.87467 22.432266,692.2 14.553066,692.2 9.4109331,692.2 4.5005199,691.20934 0,689.408 Z M 879.11198,442.44934 v 269.30133 c -15.65067,-1.36933 -29.81867,-7.90533 -40.79467,-17.89067 -7.9,4.42534 -17.012,6.956 -26.71466,6.956 -16.576,0 -31.43067,-7.37066 -41.464,-19.01733 -7.172,2.82133 -14.98534,4.37067 -23.16134,4.37067 -29.91999,0 -54.99333,-20.75467 -61.61599,-48.64933 -1.972,1.072 -4.03067,2.00266 -6.16,2.78 -2.328,17.62 -17.404,31.22133 -35.66134,31.22133 -19.86666,0 -35.97333,-16.10533 -35.97333,-35.976 0,-5.17733 1.09733,-10.10267 3.06933,-14.55067 -2.696,0.80667 -5.54933,1.23867 -8.50533,1.23867 -16.36933,0 -29.64266,-13.27067 -29.64266,-29.64267 0,-16.36933 13.27333,-29.64133 29.64266,-29.64133 8.748,0 16.612,3.79067 22.036,9.816 8.12267,-13.12933 22.652,-21.87733 39.22667,-21.87733 7.5,0 14.58,1.788 20.83866,4.96933 4.732,-17.26933 20.53734,-29.96133 39.30667,-29.96133 12.94266,0 24.47733,6.03867 31.94,15.448 9.05466,-16.88533 26.872,-28.37467 47.37066,-28.37467 1.9,0 3.776,0.10134 5.62134,0.296 8.07466,-11.96933 20.024,-21.108 34.04933,-25.61866 2.32533,-21.19867 16.95467,-38.696 36.592,-45.19734 v 0"
                        inkscape:connector-curvature="0" /><path
                        id="path34"
                        style="fill:#314251;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="M 879.11198,691.336 V 879.12 H 0 V 684.868 l 180.968,-95.85999 73.35066,51.70133 197.108,-111.80133 228.21466,129.29333 52.908,-39.68133 146.56266,72.81599"
                        inkscape:connector-curvature="0" /><path
                        id="path36"
                        style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 0,684.868 180.968,-95.85999 73.35066,51.70133 197.108,-111.80133 228.21466,129.29333 52.908,-39.68133 146.56266,72.81599 -145.364,-83.92933 -56.30533,32.50934 L 451.83066,509.65468 255.89199,622.78401 181.716,579.95734 0,684.868"
                        inkscape:connector-curvature="0" /><path
                        id="path38"
                        style="fill:#17191b;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:0.13333333"
                        d="m 458.01332,593.43334 105.98667,126.664 -6.89334,66.35186 73.24533,92.6708 H 451.12132 l 27.57467,-90.94693 37.912,-62.9024 z m 421.09866,191.796 -113.47867,-110.79867 37.91467,90.47573 -37.05333,40.5 21.54133,73.7136 h 91.076 z M 0,820.05493 187.528,711.78667 l 14.32799,53.476 36.024,20.80107 L 206.40533,879.12 H 0 v -59.06507 0"
                        inkscape:connector-curvature="0" />
                    </svg>

                    <!-- <div class="text-white text-7xl">WORK IN PROGRESS ROCKET GAME</div> -->
                <div in:fade={{ duration: 2000 }} class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <div class="fit-full-space" style="transform: scale({$scaleAnim}) translate({$scrollX + $slowScrollX}rem, {$scrollY + $slowScrollY}rem);will-change:transform;">
                    <div class="absolute" style="left:-30rem;right:-30rem;top:0rem;bottom:-2rem;width:160rem">
                        <img src="TinyQuest/gamedata/rocketlaunch/background.webp" class="absolute" alt="" style="bottom:0px;" />
                    </div>
                    {#if clickSequence <= 2}
                        <img src="TinyQuest/gamedata/rocketlaunch/explosion_ground.png" class="absolute" alt="" style="width:12rem;left:52.5rem;bottom:-1rem;transform: rotate({$frameCount*32}deg);transform-origin:50% 50%;will-change:transform;" />
                        <img src="TinyQuest/gamedata/rocketlaunch/explosion_ground.png" class="absolute" alt="" style="width:12rem;left:52.5rem;bottom:-1rem;transform: rotate({-$frameCount*23}deg);transform-origin:50% 50%;opacity:0.5;will-change:transform;" />
                    {/if}
                    {#if clickSequence === 7}
                        <img src="TinyQuest/gamedata/rocketlaunch/astronaut.png" class="absolute" alt="" style="width:1.1rem;left:47rem;top:15.7rem;transform: translate({currentNumbers[7].doneAnim*11}rem, 0rem) rotate({Math.sin(currentNumbers[7].doneAnim*128)*8}deg);transform-origin:50% 50%;will-change:transform;" />
                    {/if}
                    {#if liftoffAnim > 0.0}
                        <img src="TinyQuest/gamedata/rocketlaunch/explosion_ground.png" class="absolute" alt="" style="width:20rem;left:48rem;bottom:2.5rem;transform: scale({(4 - 1.0/(liftoffAnim+0.3))*0.4});transform-origin:50% 100%;opacity:{Math.max(0.0,1.0-liftoffAnim*0.3)};will-change:transform, opacity;" />
                        <img src="TinyQuest/gamedata/rocketlaunch/smoke_ground.png" class="absolute" alt="" style="width:20rem;left:48rem;bottom:2.5rem;transform: scale({(1 - 1.0/(liftoffAnim+1))*1.6});transform-origin:50% 100%;will-change:transform;" />
                        <img src="TinyQuest/gamedata/rocketlaunch/jet_flame.png" class="absolute" alt="" style="height:25rem;left:{54.9 + liftoffAnim*0.001 + Math.random() - 0.5}rem;top:{62 - liftoffAnim + (Math.random()*2 - 1.0)*1}rem;will-change:left, top" />
                        <img src="TinyQuest/gamedata/rocketlaunch/jet_flame.png" class="absolute" alt="" style="height:27rem;left:{57.4 + liftoffAnim*0.001 + Math.random() - 0.5}rem;top:{62 - liftoffAnim + (Math.random()*2 - 1.0)*1}rem;will-change:left, top" />
                        <img src="TinyQuest/gamedata/rocketlaunch/jet_flame.png" class="absolute" alt="" style="height:25rem;left:{59.8 + liftoffAnim*0.001 + Math.random() - 0.5}rem;top:{62 - liftoffAnim + (Math.random()*2 - 1.0)*1}rem;will-change:left, top" />
                    {/if}
                    <img src="TinyQuest/gamedata/rocketlaunch/launch_pad.png" class="absolute" alt="" style="height:80rem;left:0rem;top:0rem" />
                    <img src="TinyQuest/gamedata/rocketlaunch/saturnv.png" class="absolute" alt="" style="height:54.6rem;left:54rem;top:{10 - liftoffAnim}rem" />
                    <img src="TinyQuest/gamedata/rocketlaunch/top_arm.png" class="absolute" alt="" style="width:19.5rem;left:39.5rem;top:1.8rem;transform: translate({-currentNumbers[5].doneAnim*3.7}rem, 0rem) scale({1.0 - currentNumbers[5].doneAnim*0.1}, 1);transform-origin:20% 0%" />
                    <img src="TinyQuest/gamedata/rocketlaunch/arm1.png" class="absolute" alt="" style="width:9.5rem;left:48.2rem;top:15rem;transform: scale({1.0 - currentNumbers[4].doneAnim*0.35}, 1);transform-origin:0% 0%" />
                    <img src="TinyQuest/gamedata/rocketlaunch/arm1.png" class="absolute" alt="" style="width:8.7rem;left:48.2rem;top:22rem;transform: scale({1.0 - currentNumbers[4].doneAnim*0.35}, 1);transform-origin:0% 0%" />
                    <img src="TinyQuest/gamedata/rocketlaunch/arm1.png" class="absolute" alt="" style="width:8rem;left:48.2rem;top:31rem;transform: scale({1.0 - currentNumbers[4].doneAnim*0.3}, 1);transform-origin:0% 0%" />
                    <img src="TinyQuest/gamedata/rocketlaunch/arm1.png" class="absolute" alt="" style="width:8rem;left:48.2rem;top:39rem;transform: scale({1.0 - currentNumbers[4].doneAnim*0.3}, 1);transform-origin:0% 0%" />
                    <img src="TinyQuest/gamedata/rocketlaunch/arm1.png" class="absolute" alt="" style="width:8rem;left:48.2rem;top:44rem;transform: scale({1.0 - currentNumbers[4].doneAnim*0.3}, 1);transform-origin:0% 0%" />
                    <img src="TinyQuest/gamedata/rocketlaunch/arm1.png" class="absolute" alt="" style="width:8rem;left:48.2rem;top:51rem;transform: scale({1.0 - currentNumbers[4].doneAnim*0.3}, 1);transform-origin:0% 0%" />
                    {#if liftoffAnim >= 0.0}
                        <img src="TinyQuest/gamedata/rocketlaunch/smoke_ground_r.png" class="absolute" alt="" style="transform: scale({(2 - 1.0/(liftoffAnim+0.5))*0.25});transform-origin:0% 100%;left:57rem;bottom:2.5rem;will-change:transform;" />
                        <img src="TinyQuest/gamedata/rocketlaunch/smoke_ground_l.png" class="absolute" alt="" style="transform: scale({(2 - 1.0/(liftoffAnim+0.5))*0.25});transform-origin:100% 100%;right:42rem;bottom:2.5rem;will-change:transform;" />
                    {/if}
                    <!-- People on the launchpad -->
                    {#if currentNumbers[9].doneAnim < 1.0}
                        <div class="absolute" style="width:1.2rem;left:36rem;bottom:10.4rem;transform: translate({currentNumbers[9].doneAnim*9}rem, 0rem) rotate({Math.sin(currentNumbers[9].doneAnim*128)*8}deg);">
                            <svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 471.381 471.381" fill="black" xml:space="preserve">
                                <circle cx="226.117" cy="68.267" r="68.267" />
                                <path d="M397.138,200.67c-0.387-0.128-0.778-0.242-1.173-0.341l-50.381-12.595l-63.71-47.787
                                c-2.954-2.216-6.547-3.413-10.24-3.413h-89.651c-4.526,0.001-8.866,1.8-12.066,5l-102.4,102.4c-6.663,6.665-6.663,17.468,0,24.132
                                l11.264,11.264c6.149,6.152,15.941,6.696,22.733,1.263l73.404-58.726v68.267l-17.067,85.333l-41.301,41.301
                                c-5.755,5.753-6.648,14.768-2.133,21.538l16.043,24.064c5.222,7.847,15.817,9.975,23.663,4.753
                                c0.414-0.275,0.815-0.568,1.203-0.879l66.287-53.043c2.921-2.332,4.995-5.557,5.905-9.182l15.667-62.686l34.133,51.2
                                l27.307,68.113c3.5,8.752,13.432,13.01,22.183,9.51c0.441-0.176,0.875-0.371,1.3-0.584l37.291-18.637
                                c8.089-4.041,11.622-13.69,8.055-21.999l-44.937-104.67l-34.133-51.2l-2.731-51.2l36.864,17.067l52.907,13.227
                                c8.651,2.161,17.507-2.703,20.326-11.162l6.246-18.773C410.951,213.274,406.089,203.624,397.138,200.67z" />
                            </svg>
                        </div>
                        <div class="absolute" style="width:1.2rem;left:64rem;bottom:10.4rem;transform: translate({-currentNumbers[9].doneAnim*19}rem, 0rem) rotate({Math.sin(currentNumbers[9].doneAnim*128)*8}deg) scale(-1, 1);">
                            <svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 471.381 471.381" fill="black" xml:space="preserve">
                                <circle cx="226.117" cy="68.267" r="68.267" />
                                <path d="M397.138,200.67c-0.387-0.128-0.778-0.242-1.173-0.341l-50.381-12.595l-63.71-47.787
                                c-2.954-2.216-6.547-3.413-10.24-3.413h-89.651c-4.526,0.001-8.866,1.8-12.066,5l-102.4,102.4c-6.663,6.665-6.663,17.468,0,24.132
                                l11.264,11.264c6.149,6.152,15.941,6.696,22.733,1.263l73.404-58.726v68.267l-17.067,85.333l-41.301,41.301
                                c-5.755,5.753-6.648,14.768-2.133,21.538l16.043,24.064c5.222,7.847,15.817,9.975,23.663,4.753
                                c0.414-0.275,0.815-0.568,1.203-0.879l66.287-53.043c2.921-2.332,4.995-5.557,5.905-9.182l15.667-62.686l34.133,51.2
                                l27.307,68.113c3.5,8.752,13.432,13.01,22.183,9.51c0.441-0.176,0.875-0.371,1.3-0.584l37.291-18.637
                                c8.089-4.041,11.622-13.69,8.055-21.999l-44.937-104.67l-34.133-51.2l-2.731-51.2l36.864,17.067l52.907,13.227
                                c8.651,2.161,17.507-2.703,20.326-11.162l6.246-18.773C410.951,213.274,406.089,203.624,397.138,200.67z" />
                            </svg>
                        </div>
                        <div class="absolute" style="width:1.2rem;left:54rem;bottom:10.4rem;transform: translate({-currentNumbers[9].doneAnim*9}rem, 0rem) rotate({Math.sin(currentNumbers[9].doneAnim*128)*8}deg) scale(-1, 1);">
                            <svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 471.381 471.381" fill="black" xml:space="preserve">
                                <circle cx="226.117" cy="68.267" r="68.267" />
                                <path d="M397.138,200.67c-0.387-0.128-0.778-0.242-1.173-0.341l-50.381-12.595l-63.71-47.787
                                c-2.954-2.216-6.547-3.413-10.24-3.413h-89.651c-4.526,0.001-8.866,1.8-12.066,5l-102.4,102.4c-6.663,6.665-6.663,17.468,0,24.132
                                l11.264,11.264c6.149,6.152,15.941,6.696,22.733,1.263l73.404-58.726v68.267l-17.067,85.333l-41.301,41.301
                                c-5.755,5.753-6.648,14.768-2.133,21.538l16.043,24.064c5.222,7.847,15.817,9.975,23.663,4.753
                                c0.414-0.275,0.815-0.568,1.203-0.879l66.287-53.043c2.921-2.332,4.995-5.557,5.905-9.182l15.667-62.686l34.133,51.2
                                l27.307,68.113c3.5,8.752,13.432,13.01,22.183,9.51c0.441-0.176,0.875-0.371,1.3-0.584l37.291-18.637
                                c8.089-4.041,11.622-13.69,8.055-21.999l-44.937-104.67l-34.133-51.2l-2.731-51.2l36.864,17.067l52.907,13.227
                                c8.651,2.161,17.507-2.703,20.326-11.162l6.246-18.773C410.951,213.274,406.089,203.624,397.138,200.67z" />
                            </svg>
                        </div>
                    {/if}

            <!-- <div class="bg-red-600 absolute bottom-4" style="width:4rem;height:4rem;left:16rem;transform: translate({Math.sin(animateCount*0.1)*16}rem, 0rem);"></div> -->
                </div>

                <div id="playBoard" class="h-full w-full font-bold relative">
                    {#if currentNumbers}
                        {#each currentNumbers as l, i}
                            {#if !clearedNumbers[i]}
                                <div
                                    class="absolute text-4xl flex-center-all active:scale-105 transform transition-all duration-75 rounded-full"
                                    style="border:2px solid #ffeea2;width:11rem;height:11rem;left:{l.x0 * 100}rem;top:{l.y0 * 100}rem;font-size:8rem;color:white;line-height:3rem;background-color:{stage === 0
                                        ? '#2030af90'
                                        : '#9e3514'};"
                                    on:pointerup|preventDefault|stopPropagation={() => clickedNumber(i, l)}
                                >
                                    {l.number}
                                </div>
                            {/if}
                        {/each}
                    {/if}
                </div>
                <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div>
                <WinScreen {maxStars} active={finalGraphic} bg="#00000010" on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;top:10rem;z-index:100;" />
            </div>
            <!-- <div class="absolute left-2 bottom-2" style="width:{60*5+16}px;height:{16.67*0.2}rem;background-color:#ffff00a0">
                {#each timingQueue as t, i}
                    <div class="bg-red-600 absolute bottom-0" style="width:4px;height:{Math.min(74,t*0.2)}rem;left:{i * 5}px"></div>
                {/each}
            </div> -->
        {/if}
    </div>
</div>

<style>
</style>
