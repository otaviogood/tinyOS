<script>
    import { onMount } from "svelte";
    import { 
        bigScale, 
        pxToRem, 
        remToPx,
        handleResize 
    } from "../screen";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import { getDailySeed, getDailyDateInfo } from "../daily-seed";
    import { Howl } from "howler";
    import Line from "../components/Line.svelte";
    import CloseButton from "../components/CloseButton.svelte";
    import { fade, slide } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import RandomFast from "../random-fast";

    const { displayDate } = getDailyDateInfo();

    const scrabbleScores = {
            A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
            D: 2, G: 2,
            B: 3, C: 3, M: 3, P: 3,
            F: 4, H: 4, V: 4, W: 4, Y: 4,
            K: 5,
            J: 8, X: 8,
            Q: 10, Z: 10
        };

    // Global variables for the seeded random generator.
    let randomFast;

    let dictionary = new Set();
    // Our grid is now a flat array of hexagon cells.
    // Each cell will have axial coordinates {q, r}, a letter, and a grayed flag.
    let grid = [];
    let foundWords = [];
    let currentWord = "";
    let currentPath = [];   // Each element is a string key of the form "q,r"
    let gameOver = false;
    let score = 0;
    let elem;
    let errorShake = false;
    let isDragging = false;
    let lastCell = null;    // Will store { q, r } of the last hex.
    let pointerX = 0;
    let pointerY = 0;
    let mostRecentWord = null;
    let nextId = 1;
    let lastWordBreakdown = null;
    let nextCellId = 1;

    // Board/display constants
    const GRID_OFFSET_X = 62; // offset from left in rem
    const GRID_OFFSET_Y = 38; // offset from top in rem

    // Hexagon definitions (using pointy-topped hexagons)
    // HEX_SIZE is the circumradius (in rem).
    const HEX_SIZE = 4; // the hexagon circumradius in rem
    // For a regular pointy-topped hexagon inscribed in a circle of radius HEX_SIZE:
    // The container's width should be √3*HEX_SIZE and height 2*HEX_SIZE.
    const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;  // ≈6.93 rem for HEX_SIZE=4
    const HEX_HEIGHT = 2 * HEX_SIZE;            // 8 rem for HEX_SIZE=4

    // Define a margin (in rem) to create a gap between hexagon cells.
    const HEX_MARGIN = 0.4; // you can adjust this value for more or less space

    // Compute effective dimensions for the hexagon cell container after accounting for the margin.
    const EFFECTIVE_HEX_WIDTH = HEX_WIDTH - HEX_MARGIN;
    const EFFECTIVE_HEX_HEIGHT = HEX_HEIGHT - HEX_MARGIN;

    // A board with "5 hexes along each side" corresponds to a hexagon board with radius = 4.
    const BOARD_RADIUS = 4;

    // Add volume state
    let isMuted = false;
    const VOLUME_LEVEL = 0.25;

    // Modified sound effects to use the volume state
    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: VOLUME_LEVEL });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: VOLUME_LEVEL });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: VOLUME_LEVEL });

    // Add volume toggle function
    function toggleVolume() {
        isMuted = !isMuted;
        const newVolume = isMuted ? 0 : VOLUME_LEVEL;
        snd_good.volume(newVolume);
        snd_fanfare.volume(newVolume);
        snd_error.volume(newVolume);
    }

    // Return the center (in rem) for a hex cell with axial coordinates (q, r).
    // Using a pointy-topped layout:
    //   x = HEX_SIZE * sqrt(3) * (q + r/2)
    //   y = HEX_SIZE * 3/2 * r
    function getHexCenter(q, r) {
        return {
            x: GRID_OFFSET_X + HEX_SIZE * Math.sqrt(3) * (q + r / 2),
            y: GRID_OFFSET_Y + HEX_SIZE * 3/2 * r
        };
    }

    // For axial coordinates (q, r) the six neighbors are:
    // (q+1, r), (q+1, r-1), (q, r-1), (q-1, r), (q-1, r+1), (q, r+1)
    function isAdjacent(q1, r1, q2, r2) {
        const dq = q2 - q1;
        const dr = r2 - r1;
        const validDiffs = [
            [1, 0], [1, -1], [0, -1],
            [-1, 0], [-1, 1], [0, 1]
        ];
        return validDiffs.some(([dvq, dvr]) => dvq === dq && dvr === dr);
    }

    // Helper to look up a cell in the grid by its axial coordinates.
    function getCell(q, r) {
        return grid.find(cell => cell.q === q && cell.r === r);
    }

    // Add this function after getCell()
    function rotateGridClockwise() {
        // Correct 60-degree clockwise rotation for axial coordinates:
        // Convert (q, r) into cube (x=q, y=-q-r, z=r),
        // then rotate: (x, y, z) -> (-z, -x, -y),
        // finally convert back: q' = -r, r' = q + r.
        grid = grid.map(cell => ({
            ...cell,
            q: -cell.r,
            r: cell.q + cell.r,
            grayed: cell.grayed,
            letter: cell.letter
        }));

        // Update found word paths accordingly.
        foundWords = foundWords.map(word => ({
            ...word,
            path: word.path.map(cellKey => {
                const [q, r] = cellKey.split(',').map(Number);
                return `${-r},${q + r}`;
            })
        }));

        // ALSO update the current drag path so that the active connectivity lines rotate.
        if (currentPath && currentPath.length > 0) {
            currentPath = currentPath.map(cellKey => {
                const [q, r] = cellKey.split(',').map(Number);
                return `${-r},${q + r}`;
            });
        }

        // Optionally, update lastCell if you are mid-drag.
        if (lastCell) {
            lastCell = {
                q: -lastCell.r,
                r: lastCell.q + lastCell.r
            };
        }
    }

    // Modified startNewGameRandomPaths() adding an id for each cell.
    function startNewGameRandomPaths() {
        // Seed the generator as usual.
        randomFast = new RandomFast(getDailySeed(8));
        
        // Generate the list of valid hex coordinates.
        let cells = [];
        for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
            for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
                if (Math.abs(q + r) <= BOARD_RADIUS) {
                    cells.push({ q, r });
                }
            }
        }
        // Copy the full cell list to freeCells.
        let freeCells = cells.slice();
        grid = [];
        
        // Helper: remove a cell from freeCells by its axial coordinates.
        function removeFreeCell(q, r) {
            const index = freeCells.findIndex(cell => cell.q === q && cell.r === r);
            if (index !== -1) {
                freeCells.splice(index, 1);
            }
        }
        
        // Define the six axial directions (pointy-topped hexagon).
        const directions = [
            { dq: 1, dr: 0 },
            { dq: 1, dr: -1 },
            { dq: 0, dr: -1 },
            { dq: -1, dr: 0 },
            { dq: -1, dr: 1 },
            { dq: 0, dr: 1 }
        ];
        
        // Convert the dictionary set into an array of words.
        let wordArray = Array.from(dictionary).filter(word => word.length > 0);
        if (wordArray.length === 0) {
            // Fallback words in case dictionary failed to load.
            wordArray = ["SVELTE", "HEXAGON", "WORD", "GAME"];
        }
        
        // Helper: get the free neighbors for a given cell.
        function getFreeNeighbors(q, r) {
            return directions
                .map(({ dq, dr }) => ({ q: q + dq, r: r + dr }))
                .filter(({ q, r }) => Math.abs(q + r) <= BOARD_RADIUS && freeCells.some(cell => cell.q === q && cell.r === r));
        }
        
        // Continue placing letters until every free cell is filled.
        while (freeCells.length > 0) {
            // Randomly choose a free starting cell.
            const startIndex = Math.floor(randomFast.RandFloat() * freeCells.length);
            const startCell = freeCells[startIndex];
            removeFreeCell(startCell.q, startCell.r);
            
            // Pick a random dictionary word and convert it to uppercase.
            const randomWord = wordArray[Math.floor(randomFast.RandFloat() * wordArray.length)].toUpperCase();
            // Limit the word length to the number of cells we can possibly fill (including the one just chosen).
            const maxWordLength = freeCells.length + 1;
            const word = randomWord.slice(0, maxWordLength);
            
            // Place the first letter with a unique id.
            grid.push({ id: nextCellId++, q: startCell.q, r: startCell.r, letter: word[0], grayed: 0 });
            let current = startCell;
            
            // For subsequent letters, place them in adjacent free cells.
            for (let i = 1; i < word.length; i++) {
                const freeNeighbors = getFreeNeighbors(current.q, current.r);
                if (freeNeighbors.length === 0) {
                    break; // Cannot continue the word, so stop.
                }
                const nextIndex = Math.floor(randomFast.RandFloat() * freeNeighbors.length);
                const nextCell = freeNeighbors[nextIndex];
                removeFreeCell(nextCell.q, nextCell.r);
                grid.push({ id: nextCellId++, q: nextCell.q, r: nextCell.r, letter: word[i], grayed: 0 });
                current = nextCell;
            }
        }
    }

    // Modified startNewGame() to use a stable id for each cell.
    function startNewGame() {
        randomFast = new RandomFast(getDailySeed());
        
        foundWords = [];
        currentWord = "";
        currentPath = [];
        gameOver = false;
        score = 0;

        // No need to create a grid here since startNewGameRandomPaths() will do it
        startNewGameRandomPaths();
    }

    function getPointerPos(ev) {
        let rect = elem.getBoundingClientRect();
        const border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2);
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2);
        return [x, y];
    }

    function handlePointerDown(q, r, event) {
        if (gameOver) return;
        if (errorShake) return;
        const cell = getCell(q, r);
        // Do not allow starting on a grayed-out cell.
        if (cell.grayed > 0) return;
        event.preventDefault();
        
        const rect = elem.getBoundingClientRect();
        pointerX = pxToRem(event.clientX - rect.left);
        pointerY = pxToRem(event.clientY - rect.top);
        
        isDragging = true;
        currentWord = cell.letter;
        currentPath = [`${q},${r}`];
        lastCell = { q, r };
    }

    function handlePointerMove(event) {
        if (!isDragging || gameOver) return;
        event.preventDefault();

        const rect = elem.getBoundingClientRect();
        pointerX = pxToRem(event.clientX - rect.left);
        pointerY = pxToRem(event.clientY - rect.top);

        // Check each hex cell's center
        for (const cell of grid) {
            if (cell.grayed > 0) continue;
            const center = getHexCenter(cell.q, cell.r);
            const dx = pointerX - center.x;
            const dy = pointerY - center.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const cellKey = `${cell.q},${cell.r}`;
            // Allow selection if pointer is within HEX_SIZE (i.e. roughly the inscribed radius)
            if (distance < HEX_SIZE && 
                !currentPath.includes(cellKey) && 
                (!lastCell || isAdjacent(lastCell.q, lastCell.r, cell.q, cell.r))) {
                currentPath = [...currentPath, cellKey];
                currentWord += cell.letter;
                lastCell = { q: cell.q, r: cell.r };
                break;
            }
        }
    }

    function handlePointerUp(event) {
        if (!isDragging) return;
        isDragging = false;

        if (currentWord.length >= 2) {
            checkWord(currentWord.toLowerCase());
        }
        
        currentWord = "";
        currentPath = [];
        lastCell = null;
    }

    // Returns an object with details about the scoring breakdown.
    function getScoreBreakdown(word) {
        const uppercaseWord = word.toUpperCase();
        // Calculate each letter's score.
        const letterScores = uppercaseWord.split('').map(letter => ({
            letter,
            score: scrabbleScores[letter] || 0
        }));
        // Sum the letter scores.
        const baseScore = letterScores.reduce((sum, { score }) => sum + score, 0);
        // For word lengths 3 or greater, use length-1 as multiplier; otherwise multiplier is 1
        const multiplier = word.length >= 3 ? word.length - 1 : 1;
        return { word: uppercaseWord, letterScores, baseScore, multiplier, finalScore: baseScore * multiplier };
    }

    function checkWord(word) {
        if (dictionary.has(word) && !foundWords.some(item => 
            // Only consider it a duplicate if it uses the exact same path
            JSON.stringify(item.path.sort()) === JSON.stringify([...currentPath].sort())
        )) {
            const wordScore = getWordScore(word);
            mostRecentWord = word;
            score += wordScore;
            
            // Calculate the grayed value based on the log2 of the score
            const grayedValue = Math.round(Math.log2(wordScore));
            
            // Mark each cell in the word's path with the grayed value
            for (const cellKey of currentPath) {
                const [q, r] = cellKey.split(",").map(Number);
                const cell = getCell(q, r);
                if (cell) {
                    cell.grayed = grayedValue;
                }
            }
            // Store a copy of the path and assign a unique id.
            foundWords = [
                ...foundWords,
                { id: nextId++, word, path: [...currentPath], score: wordScore }
            ];
            // Save the score breakdown for the last valid word.
            lastWordBreakdown = getScoreBreakdown(word);
            snd_good.play();
        } else {
            errorShake = true;
            snd_error.play();
            setTimeout(() => {
                errorShake = false;
            }, 500);
        }
    }

    function getWordScore(word) {
        const baseScore = word
            .toUpperCase()
            .split('')
            .reduce((score, letter) => score + (scrabbleScores[letter] || 0), 0);
        
        // Apply multiplier for words length 3 or greater
        const multiplier = word.length >= 3 ? word.length - 1 : 1;
        return baseScore * multiplier;
    }

    // Remove a found word: un-gray its cells, remove it from the list, and adjust the score.
    function removeWord(foundWordItem) {
        for (const cellKey of foundWordItem.path) {
            const [q, r] = cellKey.split(",").map(Number);
            const cell = getCell(q, r);
            if (cell) {
                cell.grayed = 0;
            }
        }
        // Force Svelte to notice the change in the grid by reassigning it.
        grid = grid;

        foundWords = foundWords.filter(item => item.id !== foundWordItem.id);
        score -= foundWordItem.score;
    }

    // Instead of sorting inline in the markup, we sort here reactively.
    $: sortedFoundWords = [...foundWords].sort((a, b) =>
        // Sort by score descending (highest first), then alphabetically if scores are equal
        b.score - a.score || a.word.localeCompare(b.word)
    );

    // Add this function to generate a color from a word
    function getWordColor(word) {
        // Use RandomFast's HashString instead of custom implementation
        const hash = RandomFast.HashString(word);
        // Convert to hue (0-360)
        const hue = Math.abs(hash % 360);
        // Return HSL color with consistent saturation and lightness
        return `hsl(${hue}, 95%, 60%)`;
    }

    onMount(async () => {
        const response = await fetch("apps/dictionary.txt");
        const text = await response.text();
        dictionary = new Set(text.split("\n").map(w => w.trim().toLowerCase()));
        startNewGame();
        return () => {
        };
    });

    handleResize();
</script>

<FourByThreeScreen bg="black">
    <div class="fit-full-space relative" 
         bind:this={elem}
         on:pointermove|preventDefault={handlePointerMove}
         on:pointerup|preventDefault={handlePointerUp}
         on:pointerleave|preventDefault={handlePointerUp}>
        
        <!-- Left side - scores and words -->
        <div class="absolute left-0 top-0 w-[70rem] h-full p-4">
            <div class="text-white text-5xl mb-4 p-3 border-[.5rem] bg-blue-950 border-gray-600 rounded-3xl w-max">
                Score: {score}
            </div>
            <div class="text-white text-3xl mb-4">
                {displayDate}
            </div>
            <div class="text-white text-3xl">
                <div class="flex flex-col flex-wrap h-[60rem] gap-x-8" style="width: 30rem;">
                    {#each sortedFoundWords as item (item.id)}
                        <div class="flex items-center w-[23rem] bg-gray-700 rounded-3xl p-1 m-1" in:fade|local={{ duration: 800 }} out:slide|local={{ duration: 300 }}>
                            <button on:click={() => removeWord(item)} class="ml-0 text-white hover:text-red-400 bg-[#a43] rounded-full px-2">
                                <i class="fas fa-times"></i>
                            </button>
                            <div class="flex justify-end w-[6rem]">
                                <span class="text-red-300">{item.score}</span>
                            </div>
                            <div class="ml-4 flex items-center">
                                <span class:text-red-300={item.word === mostRecentWord}>
                                    {item.word.toUpperCase()}
                                </span>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
        <div class="flex-center-all absolute top-4 w-[58rem] h-[7rem] p-4 bg-blue-950 rounded-3xl" style="left: 33rem;">
            <div class="text-white text-6xl h-16 bg-pinXXk-500 w-min">
                {currentWord}
            </div>
        </div>

        <!-- Hexagon cells -->
        {#each grid as cell (cell.id)}
            {@const center = getHexCenter(cell.q, cell.r)}
            <div
                animate:flip
                class="hexagon absolute flex-center-all text-7xl text-white select-none transition-opacity duration-500
                      {errorShake ? 'opacity-70' : 'opacity-100'}"
                style="
                    width: {EFFECTIVE_HEX_WIDTH}rem;
                    height: {EFFECTIVE_HEX_HEIGHT}rem;
                    left: {center.x - EFFECTIVE_HEX_WIDTH / 2}rem;
                    top: {center.y - EFFECTIVE_HEX_HEIGHT / 2}rem;
                    background-color: {cell.grayed > 0 
                        ? `rgba(120, 120, 120, ${Math.min(0.6 - cell.grayed * 0.018, 0.9)})` 
                        : (currentPath.includes(`${cell.q},${cell.r}`) ? '#3b82f6' : '#1e3a8a')};
                "
                on:pointerdown|preventDefault={(e) => handlePointerDown(cell.q, cell.r, e)}
            >
                <!-- Debug info -->
                <!-- {#if cell.grayed > 0}
                    <span class="absolute top-2 text-2xl text-center text-white">g:{cell.grayed}</span>
                {/if} -->
                
                <!-- Scrabble score displayed at the bottom-right corner of the hexagon cell -->
                <span class="absolute bottom-0 text-center text-2xl text-gray-500">
                    {scrabbleScores[cell.letter]}
                </span>
                <span>{cell.letter}</span>
            </div>
        {/each}

        <!-- Persistent connectivity lines drawn for found words -->
        <div class="opacity-40">
            {#each foundWords as foundWord (foundWord.id)}
                {@const wordColor = getWordColor(foundWord.word)}
                {#each foundWord.path as cellKey, index (index)}
                    {#if index < foundWord.path.length - 1}
                        {@const [q1, r1] = cellKey.split(',').map(Number)}
                        {@const [q2, r2] = foundWord.path[index + 1].split(',').map(Number)}
                        {@const start = getHexCenter(q1, r1)}
                        {@const end = getHexCenter(q2, r2)}
                        {@const lineKey = `${q1},${r1}-${q2},${r2}`}
                        {#key lineKey}
                            <Line 
                                x0={start.x}
                                y0={start.y}
                                x1={end.x}
                                y1={end.y}
                                color={wordColor}
                                thick={1}
                                rounded
                            />
                        {/key}
                    {/if}
                {/each}

                <!-- Draw a circle at the starting point of the found word -->
                {@const [q_start, r_start] = foundWord.path[0].split(',').map(Number)}
                {@const center = getHexCenter(q_start, r_start)}
                <div 
                    class="absolute pointer-events-none" 
                    style="
                        width: 4rem; 
                        height: 4rem; 
                        border-radius: 50%; 
                        background-color: {wordColor};
                        left: {center.x - 2}rem;
                        top: {center.y - 2}rem;
                    ">
                </div>
            {/each}
        </div>

        <!-- Dragging connectivity lines -->
        {#if isDragging}
            <div class="opacity-70">
                {#if currentPath.length > 0}
                    {@const [q0, r0] = currentPath[0].split(',').map(Number)}
                    {@const center = getHexCenter(q0, r0)}
                    <div
                        class="absolute pointer-events-none" 
                        style="
                            width: 4rem; 
                            height: 4rem; 
                            border-radius: 50%; 
                            background-color: rgba(255,105,180);
                            left: {center.x - 2}rem;
                            top: {center.y - 2}rem;
                        ">
                    </div>
                {/if}
                {#each currentPath as cellKey, index}
                    {#if index < currentPath.length - 1}
                        {@const [q1, r1] = cellKey.split(',').map(Number)}
                        {@const [q2, r2] = currentPath[index + 1].split(',').map(Number)}
                        {@const start = getHexCenter(q1, r1)}
                        {@const end = getHexCenter(q2, r2)}
                        <Line 
                            x0={start.x}
                            y0={start.y}
                            x1={end.x}
                            y1={end.y}
                            color="#ff69b4"
                            thick={1}
                            rounded
                        />
                    {/if}
                {/each}
            </div>
        {/if}

        <!-- Score breakdown display: -->
        {#if lastWordBreakdown}
            <div class="absolute flex-center-all bottom-10 left-[61rem] w-[60rem] bg-gray-700 transform -translate-x-1/2 bg-opacity-75 text-white px-4 py-2 rounded-full text-4xl">
                {lastWordBreakdown.word} = {lastWordBreakdown.baseScore} points
                {#if lastWordBreakdown.multiplier > 1}
                    {` x ${lastWordBreakdown.multiplier} length bonus`}
                {/if}
            </div>
        {/if}

        <CloseButton />
        
        <!-- Volume toggle button -->
        <button
            class="absolute top-9 left-[26rem] text-white text-4xl hover:text-gray-300 transition-colors
                   w-[4rem] h-[4rem] rounded-full bg-blue-950 hover:bg-blue-800 
                   flex items-center pl-2"
            on:click={toggleVolume}
        >
            <i class="fas {isMuted ? 'fa-volume-mute' : 'fa-volume-up'}"></i>
        </button>

        <button
            class="absolute top-[11rem] left-[26rem] text-white text-4xl hover:text-gray-300 transition-colors
                   w-[4rem] h-[4rem] rounded-full bg-blue-950 hover:bg-blue-800 
                   flex items-center justify-center"
            on:click={rotateGridClockwise}
        >
            <i class="fas fa-redo"></i>
        </button>
    </div>
</FourByThreeScreen>

<style>
    /* Optional: You can factor out the hexagon shape into its own class */
    .hexagon {
        clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
        /* This transition will animate changes to left and top */
        transition: left 0.5s ease, top 0.5s ease;
    }
</style>