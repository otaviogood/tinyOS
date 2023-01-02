<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "svelte-spa-router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
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
    } from "../../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "./util";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../../animator";
    import AirplaneCrashSprites from "./AirplaneCrashSprites.svelte";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    const maxStars = 6; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0; // pumpkin pie or chocolate cake

    let currentShapes = [];
    let extras = [];
    let maxShapes = 6;
    let touches = {};

    function genPos() {
        // Spawn eggs in random position
        let sx = 0.63;
        let sy = 0.55;
        let ox = 0.1;
        let oy = 0.1;
        let x = Math.random() * sx + ox;
        let y = Math.random() * sy + oy;
        // Make sure they don't overlap.
        for (let reps = 0; reps < 100; reps++) {
            let collision = false;
            for (let i = 0; i < currentShapes.length; i++) {
                let dx = x - currentShapes[i].x0;
                let dy = y - currentShapes[i].y0;
                if (Math.sqrt(dx * dx + dy * dy) < 0.13) {
                    collision = true;
                    x = Math.random() * sx + ox;
                    y = Math.random() * sy + oy;
                }
            }
            if (!collision) break;
        }
        return [x, y];
    }

    function resetShapes() {
        currentShapes = [];
        for (let i = 0; i < maxShapes; i++) {
            let xy = genPos();
            xy = [i * 0.1115 + 0.083, 0.222];
            currentShapes.push({
                type: "plane",
                sprite: "plane" + i,
                x0: xy[0],
                y0: xy[1],
                rad: Math.PI * 0.5,
                scale: 0.5,
                doneAnim: 0.0,
                state: "starting",
                index: i,
                touch: true,
            });
        }
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    const turnSpeed = Math.PI / 32;
    function tick() {
        for (let i = 0; i < currentShapes.length; i++) {
            let shape = currentShapes[i];
            if (shape.type === "plane") {
                if (shape.state === "flying") {
                    for (let j = 0; j < currentShapes.length; j++) {
                        if (i === j) continue;
                        let other = currentShapes[j];
                        if (other.type !== "plane") continue;
                        if (other.state !== "flying") continue;
                        let dx = shape.x0 - other.x0;
                        let dy = shape.y0 - other.y0;
                        let dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 0.08 && shape.doneAnim === 0.0) {
                            console.log("CRASHED");
                            let xy = [(shape.x0 + other.x0) / 2, (shape.y0 + other.y0) / 2];
                            currentShapes.push({
                                type: "explosion",
                                sprite: "explosion",
                                x0: xy[0],
                                y0: xy[1],
                                rad: 0,
                                doneAnim: 0.01,
                            });
                            shape.doneAnim = 0.01;
                            other.doneAnim = 0.01;
                            shape.state = "landing";
                            other.state = "landing";
                            shape.scale = 0.5;
                            other.scale = 0.5;
                        }
                    }
                    if (touches[i]) {
                        shape.rad += turnSpeed;
                        shape.velX = 0;
                        shape.velY = 0;
                    } else {
                        let headX = Math.cos(shape.rad);
                        let headY = Math.sin(shape.rad);
                        shape.velX = headX * 0.001;
                        shape.velY = headY * 0.001;
                        if (shape.x0 < 0.0 && headX < 0.98) shape.rad += turnSpeed;
                        if (shape.x0 > 0.8 && headX > -0.98) shape.rad += turnSpeed;
                        if (shape.y0 < 0.0 && headY < 0.98) shape.rad += turnSpeed;
                        if (shape.y0 > 0.65 && headY > -0.98) shape.rad += turnSpeed;
                        // shape.rad += Math.PI / 512;
                    }
                } else if (shape.state === "starting") {
                    if (!shape.progress && touches[shape.index]) {
                        shape.progress = 0.01;
                    }
                    if (shape.progress > 0.0 && shape.progress < 1.0) {
                        shape.velY = 0.002;
                        if (shape.y0 > 0.3) shape.progress = 1.0;
                    } else if (shape.progress >= 1.0 && shape.progress < 2.0) {
                        shape.rad = Math.PI * 2;
                        shape.velX = 0.002;
                        shape.velY = 0.0;
                        if (shape.x0 > 0.735) shape.progress = 2.0;
                    } else if (shape.progress >= 2.0 && shape.progress < 3.0) {
                        shape.rad = -Math.PI * 0.5;
                        shape.velX = 0.0;
                        shape.velY = -0.002;
                        if (shape.y0 < 0.13) shape.progress = 3.0;
                    } else if (shape.progress >= 3.0 && shape.progress < 4.0) {
                        shape.rad = Math.PI;
                        shape.velX -= 0.00002;
                        if (shape.velX < -0.002) shape.velX = -0.002;
                        shape.velY = 0.0;
                        if (shape.x0 < 0.6) shape.progress = 4.0;
                    } else if (shape.progress >= 4.0 && shape.progress < 5.0) {
                        shape.scale += 0.003;
                        if (shape.scale >= 1.0) shape.progress = 5.0;
                    } else if (shape.progress >= 5.0 && shape.progress < 6.0) {
                        shape.rad = Math.random() * Math.PI * 2;
                        shape.scale = 1.0;
                        shape.state = "flying";
                    }
                } else if (shape.state === "landing") {
                    let headX = 0.75 - shape.x0;
                    let headY = -0.01 - shape.y0;
                    shape.rad = Math.atan2(headY, headX);
                    let len = Math.sqrt(headX * headX + headY * headY);
                    if (len < 0.01) {
                        shape.state = "runway";
                        shape.doneAnim = 0.01;
                        shape.x0 = 0.75;
                        shape.y0 = -0.01;
                        shape.velX = 0;
                        shape.velY = 0;
                        shape.rad = Math.PI;
                    } else {
                        shape.velX = (headX / len) * 0.001;
                        shape.velY = (headY / len) * 0.001;
                    }
                }
            } else if (shape.type === "explosion") {
                shape.doneAnim += 0.01;
                shape.scale = Math.sqrt(shape.doneAnim) * 2.5 + 0.5;
                if (shape.doneAnim >= 1.0) {
                    currentShapes.dead = true;
                }
            }
        }
        currentShapes = currentShapes.filter((s) => !s.dead);
        for (let i = 0; i < currentShapes.length; i++) {
            let shape = currentShapes[i];
            if (shape.velX) shape.x0 += shape.velX;
            if (shape.velY) shape.y0 += shape.velY;
        }
        currentShapes = currentShapes;
        extras = extras;
    }

    function resetGameVars() {
        globalAlpha = 1.0;
        carAnim = 0.0;
        carSpeed = 1.0 / 400;
        insideClick = false;
        showShapes = 1.0;
        resetShapes();
    }

    let globalAlpha = 1.0;
    let carAnim = 0.0;

    let vsizes = {
        CarGreen: 512,
        CarBlue: 512,
        CarRed: 512,
        BusGreen: 1024,
        BusBlue: 1280,
        BusRed: 1280,
        BikeGreen: 256,
        BikeBlue: 256,
        BikeRed: 160,
    };

    let insideClick = false;
    let carSpeed = 1.0 / 400;
    let showShapes = 1.0;
    async function clickedShape(i, s) {
        currentShapes[i].rad += turnSpeed;
        // if (insideClick) {
        //     carSpeed *= 2;
        //     return;
        // }
        // insideClick = true;
        // if (s === pickShape) {
        //     currentShapes[i].doneAnim = 0.01;
        //     snd_good.play();
        //     starCount++;
        //     showShapes = 0.0;
        //     for (let i = 0; i < 60; i++) {
        //         s.doneAnim += 0.01;
        //         globalAlpha *= 0.95;
        //         currentShapes = currentShapes;
        //         await sleep(16);
        //     }
        //     globalAlpha = 0;
        //     for (let i = 0; i < 400; i++) {
        //         carAnim += carSpeed;
        //         if (carAnim >= 1.0) break;
        //         await sleep(16);
        //     }
        //     if (starCount >= maxStars) {
        //         // Finished game. Yay!
        //         await sleep(500);
        //         finalGraphic = true;
        //         snd_fanfare.play();
        //         $earnedStar = true;
        //         insideClick = false;
        //         return;
        //     } else {
        //         for (let i = 0; i < 60; i++) {
        //             globalAlpha += 1.0 / 60;
        //             await sleep(16);
        //         }
        //         showShapes = 1.0;
        //         resetGameVars();
        //     }
        // } else {
        //     snd_error.play();
        // }
        // insideClick = false;
    }

    function touchStart(e, i, s) {
        touches[e.identifier] = { i, s };
    }

    function pointerDown(i, s) {
        touches[i] = true;
        console.log("touch", i);
    }

    function pointerUp(i, s) {
        touches[i] = false;
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
    startGame();
</script>

<FourByThreeScreen>
    {#if !started}
        <div class="flex-center-all h-full flex flex-col">
            <img src="TinyQuest/gamedata/busstop/intro.webp" class="absolute top-0" alt="skyscraper" style="height:64rem" />
            <div
                in:fade={{ duration: 2000 }}
                class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1"
                style="margin-top:44rem;background-color:#40101080"
            >
                {town?.name}
            </div>
            <button
                in:fade={{ duration: 2000 }}
                class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                on:pointerup|preventDefault|stopPropagation={startGame}>START</button
            >
        </div>
    {:else}
        <div class="flex flex-row h-full w-full">
            <div class="fit-full-space" style="">
                <img
                    src="TinyQuest/gamedata/airplanecrash/Airport.png"
                    class="absolute top-0 left-0 w-full h-full"
                    alt="bus stop background"
                    style="opacity:0.66"
                />

                <!-- <div class="absolute" style="left:-50rem;right:-50rem;top:0rem;bottom:0rem">
                        <img
                            src="TinyQuest/gamedata/busstop/{vehicle}.png"
                            class="absolute"
                            alt="car"
                            style="width:{vsizes[vehicle] / 8.0}rem;left:{carAnim * (vsizes[vehicle] / 8 + 100) - vsizes[vehicle] / 8.0 + 50}rem;bottom:2rem;"
                        />
                    </div> -->
                <!-- <div class="bg-red-600 absolute bottom-4" style="width:4rem;height:4rem;left:16rem;transform: translate({Math.sin(animateCount*0.1)*16}rem, 0rem);"></div> -->
            </div>
            {#each currentShapes as s, i}
                <div
                    class="absolute boXXXrder border-red-500 rounded-full {s.touch ? '' : 'pointer-events-none'}"
                    style="left:{s.x0 * 100}rem;top:{s.y0 * 100}rem;transform-origin:50% 50%; transform:rotate({s.rad +
                        0.7854}rad) scale({s.scale ?? 1.0}); opacity:{s.doneAnim >= 1.0 ? 0.0 : 1.0};will-change:transform;"
                    on:pointerdown|preventDefault|stopPropagation={() => pointerDown(i, s)}
                    on:pointerup|preventDefault|stopPropagation={() => pointerUp(i, s)}
                    on:pointerleave|preventDefault|stopPropagation={() => pointerUp(i, s)}
                    on:touchstart|preventDefault|stopPropagation={(e) => touchStart(e, i, s)}
                >
                    <AirplaneCrashSprites icon={s.sprite} size="8rem" style="margin:0;" />
                </div>
            {/each}
            {#each extras as s, i}
                <div
                    class="absolute border border-red-500 rounded-full pointer-events-none"
                    style="left:{s.x0 * 100}rem;top:{s.y0 * 100}rem;traXXnsform-origin:50% 50%; transform:rotate({s.rad +
                        0.7854}rad); opaXXXcity:{s.doneAnim > 0.0 ? 0.0 : 1.0};will-change:transform;"
                >
                    <AirplaneCrashSprites icon={s.sprite} size="8rem" style="margin:0;" />
                </div>
            {/each}

            <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
            </div>
            <WinScreen
                {maxStars}
                active={finalGraphic}
                bg="#00000010"
                on:startGame={startGame}
                on:resetToSplashScreen={resetToSplashScreen}
                style="position:absolute;top:10rem;z-index:100;"
            />
        </div>
    {/if}
</FourByThreeScreen>

<style>
</style>
