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
    import { sleep, getRandomInt, shuffleArray, preventZoom, HSVToRGB } from "./util";
    import { Animator, frameCount, animateCount } from "../../animator";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_explode = new Howl({ src: ["/TinyQuest/gamedata/mathgrid/sfx_exp_short_soft9.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    const maxStars = 1;
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    let gridOpacity = 1.0;
    let sourceA = -1,
        sourceB = -1;
    let valA = null,
        valB = null,
        valC = null;
    let gridCells = [];
    let numSuccess = 0;
    let fireworks = [];
    let secondsToAnswer = 0;
    let heatmap = false;
    let averageSecondsToAnswer = 0;
    let addition = false;
    let gridSize = 4;

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        addition = gameType === "addition";
        return () => {
            animator.stop();
        };
    });

    function makeFirework() {
        fireworks.push({
            t: 1.0,
            px: 0.0,
            py: 0.0,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25 - 0.4,
            colA: "#fff0c060",
            colB: "#fff0c010",
            friction: 1.0,
            rocket: true,
            dead: false,
        });
    }
    function tick() {
        if (numSuccess >= gridSize * gridSize) {
            if (Math.random() < 0.03) makeFirework();
        }
        for (let i = 0; i < fireworks.length; i++) {
            const f = fireworks[i];
            f.t -= 0.016;
            f.px += f.vx;
            f.py += f.vy;
            f.vx *= f.friction;
            f.vy *= f.friction;
            if (f.opacity) f.opacity -= 0.02;
            if (f.t <= 0.0) {
                f.dead = true;
                if (f.rocket) {
                    snd_explode.play();
                    // explode
                    let r = Math.random() < 0.5 ? 0 : 255;
                    let g = Math.random() < 0.5 ? 0 : 255;
                    let b = Math.random() < 0.5 ? 0 : 255;
                    if (r === 0 && g === 0 && b === 0) g = 255;
                    r = Math.max(r, 60);
                    g = Math.max(g, 60);
                    b = Math.max(b, 60);
                    for (let j = 0; j < 30; j++) {
                        let colA = "rgb(" + r.toString() + "," + g.toString() + "," + b.toString() + ")";
                        let colB = "rgb(" + r.toString() + "," + g.toString() + "," + b.toString() + ", 0.01)";
                        fireworks.push({
                            t: 0.75 + Math.random() * 0.5,
                            px: f.px,
                            py: f.py,
                            vx: (Math.random() - 0.5) * 0.5,
                            vy: (Math.random() - 0.5) * 0.5,
                            colA: colA,
                            colB: colB,
                            friction: 0.95 + Math.random() * 0.05,
                            opacity: 1.0,
                            rocket: false,
                            dead: false,
                        });
                    }
                }
            }
        }
        fireworks = fireworks.filter((item) => item.dead === false);
    }

    function resetGameVars() {
        numSuccess = 0;
        gridSize = gameType === "addition" ? 4 : 10;
        gridCells = [];
        for (let j = 0; j < gridSize; j++) {
            gridCells.push([]);
            for (let i = 0; i < gridSize; i++) {
                gridCells[j].push(0);
            }
        }
        // gridCells[0][0] = 0;
        // gridCells[1][0] = 0;
    }

    async function clickedCell(i, j) {
        if (numSuccess === gridSize * gridSize) return;
        sourceA = i;
        sourceB = j;
        valA = null;
        valB = null;
        valC = null;
        for (let i = 0; i < 15; i++) {
            gridOpacity -= 1.0 / 15;
            await sleep(16);
        }
        gridOpacity = 0;
        secondsToAnswer = Date.now();
    }

    function val() {
        if (valA != null && valB != null && valC != null) return valA * 100 + valB * 10 + valC;
        if (valA != null && valB != null) return valA * 10 + valB;
        if (valA != null) return valA;
        if (valB != null) return valB;
        return -1;
    }

    async function goButton() {
        let gridVal = gridCells[sourceA - 1][sourceB - 1];
        let alreadySolved = gridVal > 0;
        let gotIt = sourceA * sourceB === val();
        if (addition) gotIt = sourceA + sourceB === val();
        if (gotIt) {
            let seconds = Math.max(1, Date.now() - secondsToAnswer) | 0;
            console.log(seconds);
            snd_good.play();
            gridCells[sourceA - 1][sourceB - 1] = seconds;
            if (!alreadySolved) numSuccess++;
            averageSecondsToAnswer = 0.0;
            for (let j = 0; j < gridSize; j++) {
                for (let i = 0; i < gridSize; i++) {
                    console.log(gridCells[i][j]);
                    averageSecondsToAnswer += gridCells[i][j];
                }
            }
            averageSecondsToAnswer /= 100.0;

            await fadeToGrid();
            makeFirework();
            if (numSuccess >= gridSize * gridSize) {
                starCount++;
                // Finished game. Yay!
                await sleep(500);
                finalGraphic = true;
                snd_fanfare.play();
                $earnedStar = true;
            }
        } else {
            snd_error.play();
            valA = null;
            valB = null;
            valC = null;
        }
    }

    async function fadeToGrid() {
        for (let i = 0; i < 15; i++) {
            gridOpacity += 1.0 / 15;
            await sleep(16);
        }
        gridOpacity = 1.0;
    }

    function getHeatMap(i, j) {
        let millis = gridCells[i][j];
        if (millis === 0) return "#00000000";
        millis /= 1000; // millis -> seconds
        millis /= 20; // [0..1] range from [0..20] seconds
        millis = Math.sqrt(millis);
        millis = Math.max(0.25, millis);
        millis = Math.min(1.0, millis);
        const [r, g, b] = HSVToRGB(millis, 1, 1);
        return `rgba(${r},${g},${b}, 0.8)`;
    }

    function setVals(i) {
        if (i === 0 && valA === null) {
            snd_error.play();
            return;
        }
        valA === null ? (valA = i) : valB === null ? (valB = i) : (valC = i);
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;

        animator.start();
        resetGameVars();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    handleResize();
    // startGame();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgroXXXund-color:darkgreen" on:touchstart={preventZoom}>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px;tranXXXsform:scale(0.4)">
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <img src="TinyQuest/gamedata/mathgrid/intro.webp" class="absolute" alt="intro" style="" />
                <div in:fade={{ duration: 2000 }} class="text-7xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1" style="margin-top:44rem;background-color:#40101080">{town?.name}</div>
                <button in:fade={{ duration: 2000 }} class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div class="h-full w-full">
                <div class="fit-full-space" style="">
                    <img src="TinyQuest/gamedata/mathgrid/beach_bg.webp" class="absolute top-0 left-0 w-full h-full" alt="bus stop background" style="" />
                </div>

                {#if gridOpacity !== 1.0}
                    <span
                        class="absolute text-7xl text-white inline-block rounded-full p-12 flex-center-all active:scale-110 transform transition-all duration-75"
                        style="left:1rem;top:1rem;width:6rem;height:6rem;background-color:#80404040;border:0.2rem solid white;opacity:{1.0 - gridOpacity};"
                        on:pointerup|preventDefault|stopPropagation={fadeToGrid}><i class="fas fa-border-all" /></span
                    >

                    {#if addition}
                        {#each Array(sourceA) as _, i}
                            <div class="absolute bg-blue-400 w-14 h-14 rounded-full text-4xl text-white flex-center-all" style="left:{42 - i * 3.75}rem;top:{(i&1)*1 + 2}rem"><i class="fas fa-anchor"></i></div>
                        {/each}
                        {#each Array(sourceB) as _, i}
                            <div class="absolute bg-purple-400 w-14 h-14 rounded-full text-4xl text-white flex-center-all" style="left:{48 + i * 3.75}rem;top:{(i&1)*1 + 2}rem"><i class="fas fa-fish"></i></div>
                        {/each}
                    {/if}

                    <div
                        class="absolute text-8xl text-white rounded-full p-8 px-12 flex-center-all"
                        style="left:23rem;top:8rem;border:2px solid white;opacity:{1.0 - gridOpacity};background-color:#201040"
                    >
                        {sourceA}
                        {#if addition}
                            <span class="text-7xl mx-4">+</span>
                        {:else}
                            <i class="fas fa-times text-6xl mx-4" />
                        {/if}
                        {sourceB} =
                        <span class="inline-block rounded ml-4 flex-center-all" style="width:6rem;height:6rem;background-color:#502060">{valA !== null ? valA : ""}</span>
                        <span class="inline-block rounded ml-1 flex-center-all" style="width:6rem;height:6rem;background-color:#482868">{valB !== null ? valB : ""}</span>
                        <span class="inline-block rounded ml-1 flex-center-all mr-4" style="width:6rem;height:6rem;background-color:#402070">{valC !== null ? valC : ""}</span>
                    </div>

                    <div class="absolute" style="opacity:{1.0 - gridOpacity}">
                        <span
                            class="absolute text-8xl text-white inline-block rounded-full p-20 ml-10 flex-center-all active:scale-110 transform transition-all duration-75"
                            style="left:38.5rem;top:39rem;width:6rem;height:6rem;background-color:#10a010;border:0.2rem solid white;"
                            on:pointerup|preventDefault|stopPropagation={goButton}>GO</span
                        >
                        {#each Array(10) as _, i}
                            <div
                                class="absolute rounded-full flex-center-all text-8xl text-white active:scale-110 transform transition-all duration-75"
                                style="left:{Math.sin(i * 0.628318) * 16 + 42}rem;top:{-Math.cos(i * 0.628318) * 16 +
                                    40}rem;width:8rem;height:8rem;background-color:#502060;border:0.2rem solid #ffffff"
                                on:pointerup|preventDefault|stopPropagation={() => {
                                    setVals(i);
                                }}
                            >
                                {i + 0}
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if gridOpacity !== 0.0}
                    <div class="{gridSize === 4 ? 'wrapper4' : 'wrapper10'} absolute text-7xl text-gray-300" style="width:{gridSize === 4 ? '65' : '60'}rem;left:{gridSize === 4 ? '10' : '14'}rem;top:{gridSize === 4 ? '5' : '10'}rem;opacity:{gridOpacity};pointer-events:{gridOpacity === 1.0 ? 'auto' : 'none'}">
                        {#if numSuccess < gridSize * gridSize || heatmap}
                            <div class="cell flex-center-all" style="border-right:0.2rem solid #a0a0f0;border-bottom:0.2rem solid #a0a0f0">
                                {#if addition}
                                    <span class="text-5xl">+</span>
                                {:else}
                                    <i class="fas fa-times text-5xl" />
                                {/if}
                            </div>
                            {#each Array(gridSize) as _, i}
                                <div class="cell flex-center-all" style="border-bottom:0.2rem solid #a0a0f0;{gridSize === 4 ? 'aspect-ratio: 2;':''}">{i + 1}</div>
                            {/each}
                        {:else}
                            <div class="cell flex-center-all" style="background-color: #00000000;">
                            </div>
                            {#each Array(gridSize) as _, i}
                                <div class="cell flex-center-all" style="background-color: #00000000;{gridSize === 4 ? 'aspect-ratio: 2;':''}"></div>
                            {/each}
                        {/if}
                        {#each Array(gridSize) as _, j}
                            {#if numSuccess < gridSize * gridSize || heatmap}
                                <div class="cell flex-center-all" style="border-right:0.2rem solid #a0a0f0;{gridSize === 4 ? 'aspect-ratio: 0.5;':''}">{j + 1}</div>
                            {:else}
                                <div />
                            {/if}
                            {#each Array(gridSize) as _, i}
                                <div
                                    class="cell {gridCells[i][j] !== 0 && !heatmap ? (addition ? 'reveal2' : 'reveal') : ''} flex-center-all text-2xl text-white"
                                    style="{heatmap ? 'background-color:' + getHeatMap(i, j) : ''};"
                                    on:pointerup|preventDefault|stopPropagation={() => clickedCell(i + 1, j + 1)}
                                >
                                    {#if (gridCells[i][j] !== 0 && (numSuccess < gridSize * gridSize || heatmap))}
                                        {addition ? (i + 1) + (j + 1) : (i + 1) * (j + 1)}
                                    {/if}
                                </div>
                            {/each}
                        {/each}
                    </div>
                {/if}

                <!-- {#if numSuccess === gridSize * gridSize}
                    <div class="text-white text-2xl absolute top-8 left-8">Average seconds to answer: {(averageSecondsToAnswer * 0.001).toFixed(1)}</div>
                {/if} -->

                {#each fireworks as f, i}
                    <div
                        class="absolute top-0 left-0 rounded-full pointer-events-none"
                        style="background: linear-gradient({f.colA}, {f.colB});width:0.4rem;height:{Math.sqrt(f.vx * f.vx + f.vy * f.vy) * 9}rem;transform: translate({f.px + 41}rem, {f.py +
                            42}rem) rotate({Math.atan2(f.vx, -f.vy)}rad);opacity:{f.opacity ? f.opacity : 1.0}"
                    />
                {/each}

                <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen}>
                        <button
                            class="text-5xl text-white {heatmap ? 'bg-red-400' : 'bg-yellow-400'} active:scale-105 transform transition-all duration-75"
                            style="border-radius:1rem;margin:auto;margin-top:auto;margin-bottom:5rem;padding:1rem 0.5rem"
                            on:pointerup|preventDefault|stopPropagation={() => {
                                heatmap = !heatmap;
                            }}>{heatmap ? "Color" : "Color"}</button
                        >
                    </StarBar>
                </div>
                <WinScreen
                    {maxStars}
                    active={finalGraphic}
                    compact
                    bg="#00000000"
                    on:startGame={startGame}
                    on:resetToSplashScreen={resetToSplashScreen}
                    style="position:absolute;top:0rem;height:14rem;z-index:100;"
                />
            </div>
        {/if}
    </div>
</div>

<style>
    .wrapper10 {
        display: grid;
        grid-template-columns: 1fr repeat(10, 1fr);
    }
    .wrapper4 {
        display: grid;
        grid-template-columns: .5fr repeat(4, 1fr);
    }
    .cell {
        border: 0.2rem solid #00000018;
        background-color: #00000020;
        aspect-ratio: 1 / 1;
    }
    .reveal {
        background-image: url("TinyQuest/gamedata/mathgrid/beach_reveal.webp");
        background-attachment: fixed;
        background-position: var(--bigpadx) var(--bigpady);
        background-size: 100rem 75rem;
    }
    .reveal2 {
        background-image: url("TinyQuest/gamedata/mathgrid/beach_reveal2.webp");
        background-attachment: fixed;
        background-position: var(--bigpadx) var(--bigpady);
        background-size: 100rem 75rem;
    }
</style>
