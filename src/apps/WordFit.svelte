<script>
    import { onMount } from "svelte";
    import { 
        bigScale, 
        pxToRem, 
        remToPx,
        handleResize 
    } from "../screen";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import { Howl } from "howler";
    import { sleep } from "../utils";
    import Line from "../components/Line.svelte";
    import CloseButton from "../components/CloseButton.svelte";
    import { fade, slide } from 'svelte/transition';
    import RandomFast from "../random-fast";

    const scrabbleScores = {
            A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
            D: 2, G: 2,
            B: 3, C: 3, M: 3, P: 3,
            F: 4, H: 4, V: 4, W: 4, Y: 4,
            K: 5,
            J: 8, X: 8,
            Q: 10, Z: 10
        };

    // Compute daily date at UTC midnight for display purposes.
    const now = new Date();
    const dailyDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Global variables for the seeded random generator.
    let randomFast;

    // Compute a daily seed based on UTC midnight.
    function getDailySeed() {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const d = now.getUTCDate();
        // Use UTC midnight as the seed and mod to keep within 32-bit.
        return Date.UTC(y, m, d) % 0xffffffff;
    }

    // englishLetterProbabilities represents the relative frequency of each letter in English,
    // where index 0 is 'A', index 1 is 'B', ..., index 25 is 'Z'.
    // These values are approximate and based on common frequency statistics.
    export const englishLetterProbabilities = [
        0.08167, // A
        0.01492, // B
        0.02782, // C
        0.04253, // D
        0.12702, // E
        0.02228, // F
        0.02015, // G
        0.06094, // H
        0.06966, // I
        0.00153, // J
        0.00772, // K
        0.04025, // L
        0.02406, // M
        0.06749, // N
        0.07507, // O
        0.01929, // P
        0.00095, // Q
        0.05987, // R
        0.06327, // S
        0.09056, // T
        0.02758, // U
        0.00978, // V
        0.02360, // W
        0.00150, // X
        0.01974, // Y
        0.00074  // Z
    ];
    // Calculate cumulative probabilities
    const cumulative = englishLetterProbabilities.reduce((acc, p, i) => {
        acc.push((acc[i - 1] || 0) + p);
        return acc;
    }, []);

    let dictionary = new Set();
    let grid = [];
    let foundWords = [];
    let currentWord = "";
    let currentPath = [];
    let gameOver = false;
    let score = 0;
    let elem;
    let errorShake = false;
    let isDragging = false;
    let lastCell = null;
    let pointerX = 0;
    let pointerY = 0;
    let mostRecentWord = null;
    let nextId = 1;
    let lastWordBreakdown = null;

    // GRID_SIZE = 7, CELL_SIZE =
    // GRID_SIZE = 6, CELL_SIZE = 8
    // GRID_SIZE = 5, CELL_SIZE = 10
    const GRID_SIZE = 7;
    const CELL_SIZE = 46 / 7; // new cell size in rem
    const GRID_OFFSET_X = 32; // offset from left in rem
    const GRID_OFFSET_Y = 10; // offset from top in rem
    const GAP = 2; // gap between cells in rem

    // Sound effects
    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });

    // Use the seeded random generator instead of Math.random.
    function getRandomLetter() {
        const totalProbability = cumulative[cumulative.length - 1];
        const randomValue = randomFast.RandFloat() * totalProbability;
        const index = cumulative.findIndex(total => randomValue < total);
        return String.fromCharCode(65 + index);  // 65 is the char code for 'A'
    }

    // Modified startNewGame() to use the seeded random numbers.
    function startNewGame() {
        // Initialize the seeded RNG to generate the same grid each day.
        randomFast = new RandomFast(getDailySeed());
        
        // Initialize grid with random letters as objects { letter, grayed }
        grid = Array(GRID_SIZE).fill().map(() => 
            Array(GRID_SIZE).fill().map(() => {
                // Weight vowels higher
                const vowels = 'AEIOU';
                const consonants = 'BCDFGHJKLMNPQRSTVWXYZ';
                var letter = Math.random() < 0.3 ? 
                    vowels[Math.floor(Math.random() * vowels.length)] :
                    consonants[Math.floor(Math.random() * consonants.length)];
                letter = getRandomLetter();
                return { letter, grayed: false };
            })
        );
        foundWords = [];
        currentWord = "";
        currentPath = [];
        gameOver = false;
        score = 0;
    }

    function getPointerPos(ev) {
        let rect = elem.getBoundingClientRect();
        const border = 0;
        let x = (ev.clientX - border - rect.left) / (rect.right - rect.left - border * 2);
        let y = (ev.clientY - border - rect.top) / (rect.bottom - rect.top - border * 2);
        return [x, y];
    }

    function isAdjacent(i1, j1, i2, j2) {
        return Math.abs(i1 - i2) <= 1 && Math.abs(j1 - j2) <= 1;
    }

    function getCellCenter(x, y) {
        return {
            x: GRID_OFFSET_X + x * (CELL_SIZE + GAP) + CELL_SIZE/2,
            y: GRID_OFFSET_Y + y * (CELL_SIZE + GAP) + CELL_SIZE/2
        };
    }

    function handlePointerDown(x, y, event) {
        if (gameOver) return;
        if (errorShake) return;
        // Do not allow starting on a grayed-out cell.
        if (grid[y][x].grayed) return;
        event.preventDefault();
        
        const rect = elem.getBoundingClientRect();
        pointerX = pxToRem(event.clientX - rect.left);
        pointerY = pxToRem(event.clientY - rect.top);
        
        isDragging = true;
        currentWord = grid[y][x].letter;
        currentPath = [`${x},${y}`];
        lastCell = {x, y};
    }

    function handlePointerMove(event) {
        if (!isDragging || gameOver) return;
        event.preventDefault();

        const rect = elem.getBoundingClientRect();
        pointerX = pxToRem(event.clientX - rect.left);
        pointerY = pxToRem(event.clientY - rect.top);

        // Check each cell's center
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                // Skip if cell is already grayed out (already used in a found word)
                if (grid[y][x].grayed) continue;
                const center = getCellCenter(x, y);
                
                // Calculate distance from pointer to cell center
                const distance = Math.sqrt(
                    Math.pow(pointerX - center.x, 2) + 
                    Math.pow(pointerY - center.y, 2)
                );

                // If within hit region and not already in path and adjacent to last cell
                const cellKey = `${x},${y}`;
                if (distance < CELL_SIZE/2 && 
                    !currentPath.includes(cellKey) && 
                    (!lastCell || isAdjacent(lastCell.x, lastCell.y, x, y))) {
                    currentPath = [...currentPath, cellKey];
                    currentWord += grid[y][x].letter;
                    lastCell = {x, y};
                    break;
                }
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
        // For word lengths 4 or greater, use length-2 as multiplier; otherwise multiplier is 1.
        const multiplier = word.length >= 4 ? word.length - 2 : 1;
        return { word: uppercaseWord, letterScores, baseScore, multiplier, finalScore: baseScore * multiplier };
    }

    function checkWord(word) {
        if (dictionary.has(word) && !foundWords.some(item => item.word === word)) {
            const wordScore = getWordScore(word);
            mostRecentWord = word;
            score += wordScore;
            // Mark each cell in the word's path as grayed
            for (const cellKey of currentPath) {
                const [x, y] = cellKey.split(",").map(Number);
                grid[y][x].grayed = true;
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
        
        // Apply multiplier for words length 4 or greater
        const multiplier = word.length >= 4 ? word.length - 2 : 1;
        return baseScore * multiplier;
    }

    // Function to remove a found word:
    // Un-gray its cells, remove it from the list, and adjust the score.
    function removeWord(foundWordItem) {
        for (const cellKey of foundWordItem.path) {
            const [x, y] = cellKey.split(",").map(Number);
            grid[y][x].grayed = false;
        }
        foundWords = foundWords.filter(item => item.id !== foundWordItem.id);
        score -= foundWordItem.score;
    }

    // Instead of sorting inline in the markup, we sort here reactively.
    $: sortedFoundWords = [...foundWords].sort((a, b) =>
        a.word.localeCompare(b.word)
    );

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
                {dailyDate.toLocaleDateString()}
            </div>
            <div class="text-white text-3xl">
                Found Words:<br/><br/>
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
        <div class="flex-center-all absolute top-4 w-[58rem] h-[7rem] p-4 bg-blue-950 rounded-3xl" style="left: {GRID_OFFSET_X}rem;">
            <div class="text-white text-6xl h-16 bg-pinXXk-500 w-min">
                {currentWord}
            </div>
        </div>

        <!-- Grid cells -->
        {#each grid as row, i}
            {#each row as cell, j}
                <div
                    class="absolute flex-center-all text-7xl text-white select-none transition-opacity duration-500
                          {cell.grayed 
                            ? 'bg-gray-700' 
                            : (currentPath.includes(`${j},${i}`) ? 'bg-blue-500' : 'bg-blue-900')}
                          {errorShake ? 'opacity-70' : 'opacity-100'}"
                    style="
                        width: {CELL_SIZE}rem;
                        height: {CELL_SIZE}rem;
                        left: {GRID_OFFSET_X + j * (CELL_SIZE + GAP)}rem;
                        top: {GRID_OFFSET_Y + i * (CELL_SIZE + GAP)}rem;
                        border-radius: 2rem;
                    "
                    on:pointerdown|preventDefault={(e) => handlePointerDown(j, i, e)}
                >
                    <!-- Scrabble score displayed at the top-left corner of the cell -->
                    <span class="absolute bottom-3 right-2 text-2xl text-gray-500">
                        {scrabbleScores[cell.letter]}
                    </span>
                    <span>{cell.letter}</span>
                </div>
            {/each}
        {/each}

        <!-- Persistent connectivity lines drawn for found words -->
        <div class="opacity-40">
            {#each foundWords as foundWord (foundWord.id)}
                {#each foundWord.path as cellKey, index}
                    {#if index < foundWord.path.length - 1}
                        {@const [x1, y1] = cellKey.split(',').map(Number)}
                        {@const [x2, y2] = foundWord.path[index + 1].split(',').map(Number)}
                        {@const start = getCellCenter(x1, y1)}
                        {@const end = getCellCenter(x2, y2)}
                        <Line 
                            x0={start.x}
                            y0={start.y}
                            x1={end.x}
                            y1={end.y}
                            color="rgba(255,105,180)"
                            thick={1}
                            rounded
                        />
                    {/if}
                {/each}

                <!-- Draw a circle at the starting point of the found word -->
                {@const [startX, startY] = foundWord.path[0].split(',').map(Number)}
                {@const center = getCellCenter(startX, startY)}
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
            {/each}
        </div>

        <!-- Dragging connectivity lines -->
        {#if isDragging}
            <div class="opacity-70">
                {#if currentPath.length > 0}
                    <!-- Circle at the starting cell center -->
                    {@const [startX, startY] = currentPath[0].split(',').map(Number)}
                    {@const center = getCellCenter(startX, startY)}
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
                        {@const [x1, y1] = cellKey.split(',').map(Number)}
                        {@const [x2, y2] = currentPath[index + 1].split(',').map(Number)}
                        {@const start = getCellCenter(x1, y1)}
                        {@const end = getCellCenter(x2, y2)}
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
    </div>
</FourByThreeScreen>

<style>
</style>