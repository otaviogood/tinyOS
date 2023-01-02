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
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { tweened } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import { Animator, frameCount, animateCount } from "../../animator";
    import { pulseShadow, scaleDown, scalePulse } from "./Transitions";
    import IconsMisc from "./IconsMisc.svelte";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_button = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double7.wav"], volume: 0.25 });

    let animator = new Animator(60, tick);

    const maxStars = 1; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;

    // all pieces are 4x4
    const pieces = [
        // I
        [
            [0, 0, 0, 0],
            [1, 1, 1, 1],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        // J
        [
            [0, 0, 0, 0],
            [1, 1, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 0],
        ],
        // L
        [
            [0, 0, 0, 0],
            [1, 1, 1, 0],
            [1, 0, 0, 0],
            [0, 0, 0, 0],
        ],
        // O
        [
            [0, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0],
        ],
        // S
        [
            [0, 0, 0, 0],
            [0, 1, 1, 0],
            [1, 1, 0, 0],
            [0, 0, 0, 0],
        ],
        // T
        [
            [0, 0, 0, 0],
            [1, 1, 1, 0],
            [0, 1, 0, 0],
            [0, 0, 0, 0],
        ],
        // Z
        [
            [0, 0, 0, 0],
            [1, 1, 0, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0],
        ],
    ];

    let pieceX = 0.0;
    let pieceY = 0.0;
    let currentPiece = 0;
    let currentRotation = 0;
    let currentPieceColor = 1;

    let linesGot = 0;
    let score = 0;
    let dropping = false;
    let pieceQueue = [];
    let pieceQueueSize = 4;
    let colorMask = 3; // 1 for Red, 3 for red/green, 7 for red/green/blue
    let baseColors = [1, 2]; //, 4];

    // 2d tetris board placed pieces
    const solid = 0xff;
    let boardWidth = 10; // doesn't include left/right border
    let boardHeight = 24; // doesn't include bottom border
    let board = Array.from(Array(boardHeight), () => new Array(boardWidth));
    for (let i = 0; i < boardHeight; i++) {
        for (let j = 0; j < boardWidth; j++) {
            board[i][j] = 0;
        }
    }
    touchBoard();

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    function genPiece() {
        return {
            piece: getRandomInt(pieces.length),
            rotation: getRandomInt(4),
            color: baseColors[getRandomInt(baseColors.length)],
        };
    }

    function resetPiece() {
        pieceX = 3;
        pieceY = 0;
        // Get a piece from the piece queue and put a new one at the end.
        currentPiece = pieceQueue[0].piece;
        currentRotation = pieceQueue[0].rotation;
        currentPieceColor = pieceQueue[0].color;
        pieceQueue.shift();
        pieceQueue.push(genPiece());
        pieceQueue = pieceQueue;
    }
    function touchBoard() {
        for (let i = 0; i < boardHeight; i++) {
            board[i] = board[i];
        }
        board = board;
    }
    function resetGame() {
        linesGot = 0;
        score = 0;
        for (let i = 0; i < boardHeight; i++) {
            for (let j = 0; j < boardWidth; j++) {
                board[i][j] = 0;
            }
        }
        console.log("reset game");
        touchBoard();
        pieceQueue = [];
        for (let i = 0; i < pieceQueueSize; i++) {
            pieceQueue.push(genPiece());
        }
        resetPiece();
    }

    function rotatedPiece(piece, rotation) {
        let newPiece = [];
        for (let i = 0; i < 4; i++) {
            newPiece[i] = [];
            for (let j = 0; j < 4; j++) {
                newPiece[i][j] = 0;
            }
        }
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (rotation == 1) {
                    newPiece[i][j] = piece[3 - j][i];
                } else if (rotation == 2) {
                    newPiece[i][j] = piece[3 - i][3 - j];
                } else if (rotation == 3) {
                    newPiece[i][j] = piece[j][3 - i];
                } else {
                    newPiece[i][j] = piece[i][j];
                }
            }
        }
        return newPiece;
    }
    function safeGetBoard(x, y) {
        x = x | 0;
        y = y | 0;
        if (x < 0 || x >= boardWidth || y < 0 || y >= boardHeight) {
            return solid;
        }
        //         console.log("reset game", board);
        // debugger;
        // if (board[y] === undefined || board[y] === null || board[y].length == 0) return solid;
        // if (board[y][x] === undefined) return solid;
        return board[y][x];
    }
    function pieceFits(x, y, rotation) {
        let piece = rotatedPiece(pieces[currentPiece], rotation);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if ((piece[i][j] * currentPieceColor) & safeGetBoard(Math.round(x + j), Math.round(y + i))) {
                    return false;
                }
            }
        }
        return true;
    }

    function sideMove(dir) {
        if (pieceFits(pieceX + dir, pieceY, currentRotation)) {
            pieceX += dir;
        }
    }
    function rotate(dir) {
        let temp = (currentRotation + dir) & 3;
        if (pieceFits(pieceX, pieceY, temp)) {
            currentRotation = temp;
        }
    }
    function checkForFullRow() {
        let total = 0;
        for (let i = 0; i < boardHeight; i++) {
            let full = true;
            for (let j = 0; j < boardWidth; j++) {
                if ((board[i][j] & colorMask) != colorMask) {
                    full = false;
                    break;
                }
            }
            if (full) {
                linesGot++;
                total++;
                for (let k = i; k > 0; k--) {
                    board[k] = board[k - 1];
                }
                board[0] = Array.from(Array(boardWidth), () => 0);
                touchBoard();
            }
        }
        console.log("total, got, pow", total, linesGot, Math.pow(2, total) - 1);
        if (total > 0) score += Math.pow(2, total) - 1;
    }
    function checkLose() {
        for (let i = 0; i < boardWidth; i++) {
            if (board[0][i]) {
                return true;
            }
        }
        return false;
    }
    // This is a crazy generator function that lets us do the game loop without ever really returning.
    async function* gameplay() {
        console.log("gameplay");
        while (true) {
            resetPiece();
            do {
                let speed = 0.125 * 0.25;
                if (dropping) speed *= 8;
                dropping = false;
                if (pieceFits(pieceX, pieceY + speed, currentRotation)) {
                    pieceY += speed;
                } else {
                    let piece = pieces[currentPiece];
                    if (currentRotation) {
                        piece = rotatedPiece(pieces[currentPiece], currentRotation);
                    }
                    for (let i = 0; i < 4; i++) {
                        for (let j = 0; j < 4; j++) {
                            if (piece[i][j]) {
                                board[Math.round(pieceY + i)][Math.round(pieceX + j)] |= currentPieceColor;
                            }
                        }
                    }
                    checkForFullRow();
                    touchBoard();
                    if (checkLose()) {
                        // await sleep(2000);
                        resetGame();
                    }
                    yield 1;
                    break;
                }
                yield 1;
                // console.log("pieceY", pieceY);
            } while (true);
        }
    }

    function tick() {
        gameplayGenerator.next();
    }

    function keyDown(e) {
        // console.log("keyDown", e.key);
        if (e.key === "ArrowLeft") {
            sideMove(-1);
        } else if (e.key === "ArrowRight") {
            sideMove(1);
        } else if (e.key === "ArrowUp") {
            // rotate(1);
        } else if (e.key === "ArrowDown") {
            dropping = true;
        } else if (e.key === " ") {
            rotate(-1);
        }
    }

    function pieceColor(c) {
        let colors = ["#e03030", "#20c020", "#e0e030"];
        if (colorMask === 7) colors = ["#e03030", "#20c020", "#e0e030", "#2020e0", "#e020e0", "#20c0e0", "#e0e0e0"];
        if (c > colors.length) return "#b0b0b0";
        return colors[c - 1];
    }

    function setColorsMode(mask) {
        colorMask = mask; // 1 for Red, 3 for red/green, 7 for red/green/blue
        baseColors = [1, 2, 4];
        if (mask === 3) baseColors = [1, 2];
        if (mask === 1) baseColors = [1];
        baseColors = baseColors;
        resetGame();
    }

    async function startGame() {
        snd_button.play();
        finalGraphic = false;
        started = true;
        await sleep(500);
        starCount = 0;
        resetGame();
        animator.start();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    const gameplayGenerator = gameplay();
    handleResize();
    startGame();
</script>

<svelte:window on:keydown={keyDown} />

<FourByThreeScreen>
    {#if !started}
        <div class="flex-center-all h-full w-full flex flex-col bg-black">
            <!-- <img
                src="TinyQuest/gamedata/listensounds/otavio_beats_and_dj_and_speakers_and_lights_vector_art_25a81f5b-ef79-412c-ae84-6a30e5c42481.webp"
                class="absolute"
                alt="skyscraper"
                style="height:74rem"
            /> -->
            <div
                in:fade={{ duration: 2000 }}
                class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1"
                style="margin-top:26rem;background-color:#40101080"
            >
                {town?.name}
            </div>
            <button
                in:fade={{ duration: 2000 }}
                class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                style="margin-top:24rem"
                on:pointerup|preventDefault|stopPropagation={startGame}>START</button
            >
        </div>
    {:else}
        <div class="flex flex-row h-full w-full">
            <div class="ml-[38rem] relative" style="">
                {#key board}
                    {#each Array(boardHeight + 1) as _, y}
                        <div class="flex flex-row">
                            {#each Array(boardWidth + 2) as _, x}
                                <div class="flex-center-all" style="width:2rem;height:2rem;backgrXXound-color:#30405080">
                                    {#if safeGetBoard(x - 1, y) > 0}
                                        <div
                                            class="flex-center-all"
                                            style="width:1.85rem;height:1.85rem;background-color:{pieceColor(
                                                safeGetBoard(x - 1, y)
                                            )}"
                                        >
                                            <!-- {safeGetBoard(x - 1, y)} -->
                                        </div>
                                        <!-- {:else}
                                        <div
                                            class="flex-center-all border-l border-gray-900"
                                            style="width:1.85rem;height:1.85rem;backgrounXXd-color:#ffffff80"
                                        /> -->
                                    {/if}
                                    <!-- <div class="flex-center-all" style="width:1.75rem;height:1.75rem;background-color:#ffffff80">
                                    {safeGetBoard(x - 1, y)}
                                </div> -->
                                </div>
                            {/each}
                        </div>
                    {/each}
                {/key}
                <div
                    class="absolute left-0 top-0"
                    style="width:8rem;height:8rem;background-coXXlor:#30405080;transform:translate({(pieceX + 1) *
                        2}rem, {pieceY * 2}rem) rotate({currentRotation * 90}deg)"
                >
                    {#key currentPiece}
                        {#each Array(4) as _, y}
                            <div class="flex flex-row w-32 h-8">
                                {#each Array(4) as _, x}
                                    {#if pieces[currentPiece][y][x]}
                                        <div
                                            class=""
                                            style="width:2rem;height:2rem;background-color:{pieceColor(currentPieceColor)}"
                                        />
                                    {:else}
                                        <div class="" style="width:2rem;height:2rem;backXXground-color:#70401020" />
                                    {/if}
                                {/each}
                            </div>
                        {/each}
                    {/key}
                </div>

                <!-- <div
                    class="absolute left-0 top-0 border border-pink-500"
                    style="width:8rem;height:8rem;bacXXkground-color:#30405080;transform:translate({(pieceX + 1) *
                        2}rem, {Math.round(pieceY) * 2}rem)"
                >
                    {#each Array(4) as _, y}
                        <div class="flex flex-row w-32 h-8">
                            {#each Array(4) as _, x}
                                {#if rotatedPiece(pieces[currentPiece], currentRotation)[y][x]}
                                    <div
                                        class=" border border-pink-300"
                                        style="width:2rem;height:2rem;baXXckground-color:#ffff0080"
                                    />
                                {:else}
                                    <div class="" style="width:2rem;height:2rem;bacXXXkground-color:#70401020" />
                                {/if}
                            {/each}
                        </div>
                    {/each}
                </div> -->
            </div>

            <div class="absolute left-[64rem] top-0 h-[50rem] border border-gray-800 bg-gray-900" style="">
                {#each pieceQueue as piece, i}
                    <div class="m-16">
                        {#each Array(4) as _, y}
                            <div class="flex flex-row w-32 h-8">
                                {#each Array(4) as _, x}
                                    {#if rotatedPiece(pieces[piece.piece], piece.rotation)[y][x]}
                                        <div
                                            class=" border border-gray-300"
                                            style="width:2rem;height:2rem;background-color:{pieceColor(piece.color)}"
                                        />
                                    {:else}
                                        <div class="" style="width:2rem;height:2rem;bacXXXkground-color:#70401020" />
                                    {/if}
                                {/each}
                            </div>
                        {/each}
                    </div>
                {/each}
            </div>

            <div
                class="flex-center-all text-8xl absolute left-10 bottom-10 cursor-pointer select-none rounded-full bg-blue-900 text-gray-200 w-48 h-48"
                on:pointerdown|preventDefault|stopPropagation={() => sideMove(-1)}
            >
                L
            </div>
            <div
                class="flex-center-all text-8xl absolute right-10 bottom-10 cursor-pointer select-none rounded-full bg-blue-900 text-gray-200 w-48 h-48"
                on:pointerdown|preventDefault|stopPropagation={() => sideMove(1)}
            >
                R
            </div>
            <div
                class="flex-center-all text-8xl absolute left-72 bottom-10 cursor-pointer select-none rounded-full bg-blue-900 text-gray-200 w-48 h-48"
                on:pointerdown|preventDefault|stopPropagation={() => rotate(1)}
            >
                <i class="fa-solid fa-rotate-right" />
            </div>
            <div
                class="flex-center-all text-8xl absolute right-72 bottom-10 cursor-pointer select-none rounded-full bg-blue-900 text-gray-200 w-48 h-48"
                on:pointerdown|preventDefault|stopPropagation={() => rotate(-1)}
            >
                <i class="fa-solid fa-rotate-left" />
            </div>
            <div
                class="flex-center-all text-8xl absolute left-[43.5rem] bottom-10 cursor-pointer select-none rounded-full bg-blue-900 text-gray-200 w-48 h-48"
                on:pointerdown|preventDefault|stopPropagation={() => (dropping = true)}
            >
                <i class="fa-solid fa-arrow-down" />
            </div>

            {#if colorMask === 1}
                <div
                    class="flex-center-all text-4xl absolute left-[2rem] top-[10rem] cursor-pointer select-none rounded bg-red-900 text-gray-200 h-12 p-2"
                    on:pointerdown|preventDefault|stopPropagation={() => setColorsMode(3)}
                >
                    RED
                </div>
            {:else if colorMask === 3}
                <div
                    class="flex-center-all text-4xl absolute left-[2rem] top-[10rem] cursor-pointer select-none rounded bg-green-900 text-gray-200 h-12 p-2"
                    on:pointerdown|preventDefault|stopPropagation={() => setColorsMode(7)}
                >
                    RED/GREEN
                </div>
            {:else if colorMask === 7}
                <div
                    class="flex-center-all text-4xl absolute left-[2rem] top-[10rem] cursor-pointer select-none rounded bg-red-900 text-gray-200 h-12 p-2"
                    on:pointerdown|preventDefault|stopPropagation={() => setColorsMode(1)}
                >
                    RED/GREEN/BLUE
                </div>
            {/if}

            <div class="text-4xl absolute left-2 top-2 select-none p-4">
                LINES&nbsp;&nbsp;&nbsp;&nbsp;{linesGot}
            </div>
            <div class="text-4xl absolute left-2 top-16 select-none p-4">
                SCORE&nbsp;&nbsp;&nbsp;{score}
            </div>
            <div
                class="absolute right-0 top-0 cursor-pointer select-none m-4"
                style="padding:0 0.75rem;border-radius:0.75rem;"
                on:pointerup|preventDefault|stopPropagation={resetToSplashScreen}
                on:touchstart={preventZoom}
            >
                <IconsMisc icon="treasure-map" size="7.5rem" style="" />
            </div>

            <!-- <div class="absolute right-0 top-0 bottom-0 flex flex-row">
                    <StarBar {maxStars} {starCount} bg="#00000080" on:pointerup={resetToSplashScreen} />
                </div> -->
            <WinScreen
                {maxStars}
                active={finalGraphic}
                bg="#00000010"
                on:startGame={startGame}
                on:resetToSplashScreen={resetToSplashScreen}
                style="position:absolute;top:10rem;z-index:100;"
            />
        </div>
        <!-- <div class="absolute left-2 bottom-2" style="width:{60*5+16}px;height:{16.67*0.2}rem;background-color:#ffff00a0">
                {#each timingQueue as t, i}
                    <div class="bg-red-600 absolute bottom-0" style="width:4px;height:{Math.min(74,t*0.2)}rem;left:{i * 5}px"></div>
                {/each}
            </div> -->
    {/if}
</FourByThreeScreen>
