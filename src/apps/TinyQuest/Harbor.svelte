<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import StarBar from "./StarBar.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "../../router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { spin } from "./Transitions";
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
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { pulseShadow, scaleDown, scalePulse } from "./Transitions";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../../animator";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });
    var snd_horn = new Howl({ src: ["/TinyQuest/gamedata/harbor/horn1.mp3"], volume: 0.35 });

    let animator = new Animator(60, tick);

    const scrollY = tweened(0.0, { duration: 2000, easing: cubicInOut });
    const scaleAnim = tweened(1.0, { duration: 2000, easing: cubicInOut });

    const maxStars = 6;
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;
    let stage = 0;
    let seed = 0;

    const scale = 19.8;
    const spaceX = scale * 0.5;
    const spaceY = spaceX * 0.57726;
    const offsetX = 34;
    const offsetY = 4;
    const waterDepth = 0.25;

    let winSpot;
    let ships = [];
    let grid = [];
    let gridWidth;
    let gridHeight;
    function setGrid(x, y, a) {
        grid[x + y * gridWidth] = a;
    }
    function getGrid(x, y) {
        return grid[x + y * gridWidth];
    }
    function calcGrid() {
        for (let i = 0; i < grid.length; i++) {
            if (grid[i] > 0) grid[i] = 0;
        }
        for (let i = 0; i < ships.length; i++) {
            let ship = ships[i];
            for (let dy = 0; dy < ship.h; dy++) {
                for (let dx = 0; dx < ship.w; dx++) {
                    setGrid(ship.x + dx, ship.y + dy, i + 1);
                }
            }
        }
        grid = grid;
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    async function tick() {
        calcGrid();
        let myShip = ships[0];
        if (findShipAt(winSpot[0], winSpot[1]) === ships[0]) {
            winSpot[0] = -1000;
            starCount++;
            snd_horn.play();
            if (starCount >= maxStars) {
                // Finished game. Yay!
                await sleep(2000);
                finalGraphic = true;
                snd_fanfare.play();
                $earnedStar = true;
                return;
            } else {
                await sleep(3000);
                stage++;
                setStage(stage, seed);
            }
        } else if (winSpot[0] === -1000) {
            myShip.x += 0.01;
            ships = ships;
        }
    }

    function findShipAt(x, y, exclude) {
        for (let i = 0; i < ships.length; i++) {
            let ship = ships[i];
            if (ship === exclude) continue;
            for (let dy = 0; dy < ship.h; dy++) {
                for (let dx = 0; dx < ship.w; dx++) {
                    if (ship.x + dx === x && ship.y + dy === y) return ship;
                }
            }
        }
        return null;
    }

    function clearGridWithBorders(w, h, winx, winy) {
        winSpot = [winx, winy];
        gridWidth = w;
        gridHeight = h;
        for (let i = 0; i < gridWidth * gridHeight; i++) grid[i] = 0;
        for (let i = 0; i < gridWidth; i++) {
            setGrid(i, 0, -2);
            setGrid(i, gridHeight - 1, -2);
        }
        for (let i = 0; i < gridHeight; i++) {
            setGrid(0, i, -2 - 16);
            setGrid(gridWidth - 1, i, -2 - 16);
        }
        setGrid(0, 0, -1);
        setGrid(w - 1, h - 1, -1);
        for (let i = 0; i < gridWidth * gridHeight; i++) {
            if (grid[i] < 0) {
                if (Math.random() < 0.1) grid[i] += -256 * 1;
                else if (Math.random() < 0.1) grid[i] += -256 * 2;
                else if (Math.random() < 0.1) grid[i] += -256 * 3;
                else if (Math.random() < 0.2) grid[i] += -256 * 4;
            }
        }
        setGrid(winSpot[0], winSpot[1], 0);
        console.log(grid);
    }

    function setStage(stage, seed) {
        if (!seed) {
            if (stage === 0) {
                ships = [
                    { img: "sailboat1", x: 2, y: 4, w: 1, h: 1 },
                    { img: "tanker2", x: 1, y: 2, w: 2, h: 1 },
                ];
            } else if (stage === 1) {
                ships = [
                    { img: "yacht1", x: 1, y: 2, w: 1, h: 1 },
                    { img: "container2", x: 4, y: 2, w: 1, h: 2 },
                ];
            } else if (stage === 2) {
                ships = [
                    { img: "tanker2", x: 1, y: 1, w: 2, h: 1 },
                    { img: "tugboat1", x: 2, y: 2, w: 1, h: 1 },
                    { img: "cruise2", x: 3, y: 1, w: 1, h: 2 },
                    { img: "container2", x: 2, y: 3, w: 2, h: 1 },
                ];
            } else if (stage === 3) {
                ships = [
                    { img: "tugboat1", x: 2, y: 2, w: 1, h: 1 },
                    { img: "tanker2", x: 1, y: 1, w: 2, h: 1 },
                    { img: "container2", x: 4, y: 1, w: 1, h: 2 },
                    { img: "cruise2", x: 3, y: 2, w: 1, h: 2 },
                    { img: "sailboat1", x: 2, y: 4, w: 1, h: 1 },
                    { img: "yacht1", x: 3, y: 4, w: 1, h: 1 },
                ];
            } else if (stage === 4) {
                ships = [
                    { img: "fishing1", x: 1, y: 1, w: 1, h: 1 },
                    { img: "container2", x: 1, y: 3, w: 2, h: 1 },
                    { img: "tanker2", x: 2, y: 1, w: 1, h: 2 },
                    { img: "tugboat1", x: 3, y: 1, w: 1, h: 1 },
                    { img: "research2", x: 4, y: 2, w: 1, h: 2 },
                    { img: "cruise2", x: 3, y: 2, w: 1, h: 2 },
                    { img: "yacht1", x: 3, y: 4, w: 1, h: 1 },
                ];
            } else if (stage === 5) {
                ships = [
                    { img: "research2", x: 1, y: 3, w: 2, h: 1 },
                    { img: "tanker2", x: 2, y: 1, w: 1, h: 2 },
                    { img: "tugboat1", x: 3, y: 1, w: 1, h: 1 },
                    { img: "container2", x: 4, y: 2, w: 1, h: 2 },
                    { img: "cruise2", x: 3, y: 2, w: 1, h: 2 },
                    { img: "fishing1", x: 2, y: 4, w: 1, h: 1 },
                    { img: "sailboat1", x: 1, y: 4, w: 1, h: 1 },
                    { img: "yacht1", x: 3, y: 4, w: 1, h: 1 },
                ];
            }
            clearGridWithBorders(6, 6, 5, 2);
        } else if (seed === 1) {
            // stage = 4;
            if (stage === 0) {
                ships = [
                    { img: "fishing1", x: 2, y: 3, w: 1, h: 1 },
                    { img: "cruise2", x: 3, y: 2, w: 2, h: 1 },
                ];
            } else if (stage === 1) {
                ships = [
                    { img: "tugboat1", x: 1, y: 3, w: 1, h: 1 },
                    { img: "container2", x: 3, y: 4, w: 2, h: 1 },
                ];
            } else if (stage === 2) {
                ships = [
                    { img: "tugboat1", x: 1, y: 3, w: 1, h: 1 },
                    { img: "container2", x: 1, y: 4, w: 2, h: 1 },
                    { img: "tanker2", x: 3, y: 4, w: 2, h: 1 },
                ];
            } else if (stage === 3) {
                ships = [
                    { img: "tugboat1", x: 1, y: 3, w: 1, h: 1 },
                    { img: "container2", x: 1, y: 4, w: 2, h: 1 },
                    { img: "tanker2", x: 3, y: 4, w: 2, h: 1 },
                    { img: "research2", x: 2, y: 2, w: 1, h: 2 },
                    { img: "cruise2", x: 4, y: 2, w: 1, h: 2 },
                ];
            } else if (stage === 4) {
                ships = [
                    { img: "research2", x: 3, y: 1, w: 2, h: 1 },
                    { img: "tugboat1", x: 1, y: 3, w: 1, h: 1 },
                    { img: "container2", x: 1, y: 4, w: 2, h: 1 },
                    { img: "tanker2", x: 3, y: 4, w: 2, h: 1 },
                    { img: "cruise2", x: 4, y: 2, w: 1, h: 2 },
                ];
            } else if (stage === 5) {
                ships = [
                    { img: "research2", x: 1, y: 1, w: 2, h: 1 },
                    { img: "tugboat1", x: 1, y: 3, w: 1, h: 1 },
                    { img: "sailboat1", x: 2, y: 4, w: 1, h: 1 },
                    { img: "yacht1", x: 1, y: 4, w: 1, h: 1 },
                    { img: "tanker2", x: 3, y: 4, w: 2, h: 1 },
                    { img: "container2", x: 2, y: 2, w: 1, h: 2 },
                    { img: "cruise2", x: 4, y: 2, w: 1, h: 2 },
                    { img: "tanker2", x: 3, y: 1, w: 2, h: 1 },
                ];
            }
            clearGridWithBorders(6, 6, 5, 4);
        }
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        starCount = 0;
        stage = 0;
        scrollY.set(0.0, { duration: 0 });
        scaleAnim.set(1.0, { duration: 0 });
        clickedShip = null;
        if (gameType === "2") seed = 1;

        setStage(0, seed);
        animator.start();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    function getPointerPos(ev) {
        var rect = document.getElementById("mainScreen").getBoundingClientRect();
        let x = (ev.clientX - rect.left) / rect.width;
        let y = (ev.clientY - rect.top) / rect.height;
        y *= invAspectRatio;
        return [x, y];
    }
    function reverseIsometric(xy) {
        // Just hacky nonsense because I didn't do the math right.
        let xrem = xy[0] * 100;
        let yrem = xy[1] * 100;
        xrem -= offsetX;
        yrem -= offsetY;
        xrem /= scale;
        yrem /= scale;
        yrem *= 2.45;
        xrem *= 1.415;
        iso = rotate([xrem, yrem], Math.PI / 4);
        return iso;
    }
    function isometricX(x, y) {
        return offsetX + x * spaceX - y * spaceX;
    }
    function isometricY(x, y) {
        return offsetY + x * spaceY + y * spaceY;
    }

    let dragging = 0;
    let mouseDownX = -1;
    let mouseDownY = -1;
    let mouseX = -1;
    let mouseY = -1;
    let clickedShip = null;
    let shipDragX = 0;
    let shipDragY = 0;
    let clickedIso = [0, 0];
    function handleDragStart(e) {
        // In case we missed a pointer up event, let's reset all ships to integer coords so things don't freak out.
        for (let i = 0; i < ships.length; i++) {
            let ship = ships[i];
            ship.x = Math.round(ship.x);
            ship.y = Math.round(ship.y);
        }
        ships = ships;

        dragging = 1;
        let xy = getPointerPos(e);
        iso = reverseIsometric(xy);
        clickedShip = findShipAt(Math.trunc(iso[0] - 1 - waterDepth), Math.trunc(iso[1] - waterDepth));
        if (clickedShip) {
            shipDragX = clickedShip.x;
            shipDragY = clickedShip.y;
            clickedIso = iso;
        }
        mouseDownX = xy[0];
        mouseDownY = xy[1];
        mouseX = xy[0];
        mouseY = xy[1];
    }

    function rotate(v, rad) {
        let cos = Math.cos(rad);
        let sin = Math.sin(rad);
        return [cos * v[0] + sin * v[1], -sin * v[0] + cos * v[1]];
    }

    let iso = [0, 0];
    let dirx = 0,
        diry = 0;
    function handleDragMove(e) {
        if (!dragging) return;
        let xy = getPointerPos(e);
        iso = reverseIsometric(xy);
        const dx = xy[0] - mouseX;
        const dy = xy[1] - mouseY;
        dirx = iso[0] - clickedIso[0];
        diry = iso[1] - clickedIso[1];
        mouseX = xy[0];
        mouseY = xy[1];
        calcGrid();
        if (clickedShip) {
            if (Math.abs(dirx) > Math.abs(diry)) diry = 0;
            else dirx = 0;
            for (let i = 0; i <= Math.max(Math.abs(dirx), Math.abs(diry)); i++) {
                let hitShip;

                for (let dy = 0; dy < clickedShip.h; dy++) {
                    for (let dx = 0; dx < clickedShip.w; dx++) {
                        let testPos = [shipDragX + dx, shipDragY + dy];
                        if (dirx > 0) testPos[0] = Math.ceil(shipDragX + dx + i * Math.sign(dirx) + 1 - waterDepth);
                        else if (dirx < 0) testPos[0] = Math.trunc(shipDragX + dx + i * Math.sign(dirx) + 0 - waterDepth);
                        if (diry > 0) testPos[1] = Math.ceil(shipDragY + dy + i * Math.sign(diry) + 1 - waterDepth);
                        else if (diry < 0) testPos[1] = Math.trunc(shipDragY + dy + i * Math.sign(diry) + 0 - waterDepth);

                        let tempHitShip = findShipAt(testPos[0], testPos[1], clickedShip);
                        if (tempHitShip) hitShip = tempHitShip;
                        if (testPos[0] < 0 || testPos[0] >= gridWidth || testPos[1] < 0 || testPos[1] >= gridHeight)
                            hitShip = "outerWall";
                        else if (getGrid(testPos[0], testPos[1]) < 0) hitShip = "wall";
                    }
                }

                if (hitShip) {
                    dirx = i * Math.sign(dirx);
                    diry = i * Math.sign(diry);
                    break;
                }
            }
            clickedShip.x = shipDragX + dirx;
            clickedShip.y = shipDragY + diry;
        }
        ships = ships;
    }

    function handleDragEnd(e) {
        if (!dragging) return;
        dragging = 0;
        if (clickedShip) {
            clickedShip.x = Math.round(clickedShip.x);
            clickedShip.y = Math.round(clickedShip.y);
        }
        ships = ships;
    }

    handleResize();
    // startGame();
    // loop();
</script>

<div class="fit-full-space select-none overflow-hidden" style="backgXXXround-color:black" on:touchstart={preventZoom}>
    <div
        id="mainScreen"
        class="relative overflow-hidden select-none"
        style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px"
        on:pointermove|preventDefault|stopPropagation={(e) => handleDragMove(e)}
        on:pointerdown|preventDefault|stopPropagation={(e) => handleDragStart(e)}
        on:pointerleave|preventDefault|stopPropagation={(e) => handleDragEnd(e)}
        on:pointerup|preventDefault|stopPropagation={(e) => handleDragEnd(e)}
    >
        {#if !started}
            <div class="flex-center-all h-full flex flex-col">
                <img src="TinyQuest/gamedata/harbor/splash_screen.webp" class="absolute" alt="skyscraper" style="height:72rem" />
                <div
                    in:fade={{ duration: 2000 }}
                    class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1"
                    style="margin-top:44rem;background-color:#40101080"
                >
                    {town?.name}<br/>
                    {(gameType === "2") ? "GAME 2" : "GAME 1"}
                </div>
                <button
                    in:fade={{ duration: 2000 }}
                    class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                    on:pointerup|preventDefault|stopPropagation={startGame}>START</button
                >
            </div>
            <div class="absolute top-6 left-0 bg-[#00000080] rounded-br-3xl z-30 text-4xl p-4">
                <p>Find the flashing ship and get it out of the harbor.</p>
                <p>You can move on only one axis at a time.</p>
            </div>
        {:else}
            <div class="flex flex-row h-full w-full">
                <div class="fit-full-space" style="transform: scale({$scaleAnim}) translate(0rem, {$scrollY}rem)">
                    <div class="absolute" style="left:0rem;right:0rem;top:0rem;bottom:-2rem;background-color:#57b2d8" />
                    <div class="absolute" style="left:-50rem;right:-50rem;top:0rem;bottom:-2rem;">
                        <img
                            class="absolute"
                            style="left:-38rem;top:-21.75rem;width:160rem;transform:scale(-1,1);"
                            src="TinyQuest/gamedata/harbor/parking_lot.webp"
                            alt=""
                        />
                        <img
                            class="absolute"
                            style="left:45rem;top:-34rem;width:160rem;"
                            src="TinyQuest/gamedata/harbor/parking_lot.webp"
                            alt=""
                        />
                    </div>
                    {#each Array(gridHeight) as _, y}
                        {#each Array(gridWidth) as _, x}
                            {#if getGrid(x, y) < 0}
                                <img
                                    src="TinyQuest/gamedata/harbor/{[
                                        'concrete_slab.png',
                                        'simple_border.png',
                                        'container_loader.png',
                                        'rolling_gantry.png',
                                    ][(Math.abs(getGrid(x, y)) - 1) & 0xf]}"
                                    class="absolute"
                                    alt=""
                                    style="left:{isometricX(x, y)}rem;top:{isometricY(x, y)}rem;width:{scale}rem;z-index:{x +
                                        y};transform:scale({(Math.abs(getGrid(x, y)) - 1) & 0x10 ? -1 : 1},1);"
                                />
                                {#if Math.abs(getGrid(x, y)) - 1 >= 256}
                                    <img
                                        src="TinyQuest/gamedata/harbor/{[
                                            '',
                                            'container_loader.png',
                                            'rolling_gantry.png',
                                            'big_crane.png',
                                            'container_pile.png',
                                        ][(Math.abs(getGrid(x, y)) - 1) >>> 8]}"
                                        class="absolute"
                                        alt=""
                                        style="left:{isometricX(x, y)}rem;top:{isometricY(x, y)}rem;width:{scale}rem;z-index:{x +
                                            y};transform:scale({(Math.abs(getGrid(x, y)) - 1) & 0x10 ? -1 : 1},1);"
                                    />
                                {/if}
                            {:else if findShipAt(x, y) === ships[0]}
                                {#key $frameCount}
                                    <img
                                        src="TinyQuest/gamedata/harbor/water_empty_grid.png"
                                        class="absolute"
                                        alt=""
                                        style="left:{isometricX(x, y)}rem;top:{isometricY(
                                            x,
                                            y
                                        )}rem;width:{scale}rem;filter: brightness({1.0 +
                                            Math.sin($frameCount * 0.05) * 0.15 +
                                            0.15});"
                                    />
                                {/key}
                            {:else}
                                <img
                                    src="TinyQuest/gamedata/harbor/water_empty_grid.png"
                                    class="absolute"
                                    alt=""
                                    style="left:{isometricX(x, y)}rem;top:{isometricY(x, y)}rem;width:{scale}rem"
                                />
                            {/if}
                        {/each}
                    {/each}
                    <!-- Show movement axis when dragging. -->
                    {#if clickedShip && dragging}
                        {#if diry !== 0}
                            {#each Array(gridHeight) as _, y}
                                {#each Array(clickedShip.w) as _, x}
                                    <img
                                        src="TinyQuest/gamedata/harbor/water_empty_grid.png"
                                        class="absolute"
                                        alt=""
                                        style="left:{isometricX(clickedShip.x + x, y)}rem;top:{isometricY(
                                            clickedShip.x + x,
                                            y
                                        )}rem;width:{scale}rem;filter: brightness(1.1);"
                                    />
                                {/each}
                            {/each}
                        {:else}
                            {#each Array(clickedShip.h) as _, y}
                                {#each Array(gridWidth) as _, x}
                                    <img
                                        src="TinyQuest/gamedata/harbor/water_empty_grid.png"
                                        class="absolute"
                                        alt=""
                                        style="left:{isometricX(x, clickedShip.y + y)}rem;top:{isometricY(
                                            x,
                                            clickedShip.y + y
                                        )}rem;width:{scale}rem;filter: brightness(1.1);"
                                    />
                                {/each}
                            {/each}
                        {/if}
                    {/if}
                    {#each ships as s, i}
                        <img
                            src="TinyQuest/gamedata/harbor/{s.img}.png"
                            class="absolute"
                            alt=""
                            style="left:{isometricX(s.x, s.y) - (s.h > s.w ? scale * 0.5 : 0)}rem;top:{isometricY(
                                s.x,
                                s.y
                            )}rem;width:{scale + scale * 0.5 * ((s.h > s.w ? s.h : s.w) - 1)}rem;z-index:{s.x +
                                s.y};transform:scale({s.h > s.w ? -1 : 1},1);"
                        />
                    {/each}
                    <!-- {#each grid as c, i}
                        <div
                            class="absolute flex-center-all text-2xl text-white"
                            alt=""
                            style="left:{isometricX(i%gridWidth, Math.trunc(i/gridWidth))+spaceX-2.5}rem;top:{isometricY(i%gridWidth, Math.trunc(i/gridWidth))+spaceX}rem;width:5rem;height:5rem;z-index:{1000};background-color:#ff404080;border-radius:100%"
                        >{i.toString() + " " + (i%gridWidth).toString() + " " + Math.trunc(i/gridWidth).toString()}<br/>{grid[i]}</div>
                    {/each} -->
                    <!-- <div
                        class="absolute flex-center-all text-2xl text-white"
                        alt=""
                        style="left:{isometricX(ships[0].x, ships[0].y)+spaceX-8}rem;top:{isometricY(ships[0].x, ships[0].y)+spaceX+0}rem;width:16rem;height:8rem;z-index:{1000};background-color:#ff404080;border-radius:100%"
                    >ME</div> -->

                    <!-- <div
                        style="color:white;position:absolute;left:{offsetX + iso[0] * spaceX - iso[1] * spaceX}rem;top:{offsetY +
                            iso[0] * spaceY +
                            iso[1] * spaceY}rem;z-index:1000;background-color:#883366;margin-left:16px"
                    >
                        {iso[0].toFixed(1) + "  " + iso[1].toFixed(1)}
                    </div>
                    <div
                        style="color:white;position:absolute;left:{offsetX + iso[0] * spaceX - iso[1] * spaceX}rem;top:{offsetY +
                            iso[0] * spaceY +
                            iso[1] * spaceY}rem;z-index:1000;background-color:#ff3366;width:0.3rem;height:0.3rem"
                    /> -->
                </div>

                <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div>
                <WinScreen
                    {maxStars}
                    active={finalGraphic}
                    on:startGame={startGame}
                    on:resetToSplashScreen={resetToSplashScreen}
                    style="position:absolute;top:10rem;z-index:100;"
                />
            </div>
        {/if}
    </div>
</div>

<style>
</style>
