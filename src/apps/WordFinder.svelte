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

    const GRID_SIZE = 5;
    let dictionary = new Set();
    let grid = [];
    let foundWords = new Set();
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

    const CELL_SIZE = 10; // size in rem
    const GRID_OFFSET_X = 32; // offset from left in rem
    const GRID_OFFSET_Y = 10; // offset from top in rem
    const GAP = 2; // gap between cells in rem

    // Sound effects
    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });

    // Load dictionary
    onMount(async () => {
        const response = await fetch("apps/dictionary.txt");
        const text = await response.text();
        dictionary = new Set(text.split("\n").map(w => w.trim().toLowerCase()));
        startNewGame();
        return () => {
        };
    });

    function startNewGame() {
        // Initialize grid with random letters
        grid = Array(GRID_SIZE).fill().map(() => 
            Array(GRID_SIZE).fill().map(() => {
                // Weight vowels higher
                const vowels = 'AEIOU';
                const consonants = 'BCDFGHJKLMNPQRSTVWXYZ';
                return Math.random() < 0.3 ? 
                    vowels[Math.floor(Math.random() * vowels.length)] :
                    consonants[Math.floor(Math.random() * consonants.length)];
            })
        );
        foundWords.clear();
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
        event.preventDefault();
        
        const rect = elem.getBoundingClientRect();
        pointerX = pxToRem(event.clientX - rect.left);
        pointerY = pxToRem(event.clientY - rect.top);
        
        isDragging = true;
        currentWord = grid[y][x];
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
                    currentWord += grid[y][x];
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

    function checkWord(word) {
        if (dictionary.has(word) && !foundWords.has(word)) {
            const wordScore = getWordScore(word);
            mostRecentWord = word;
            score += wordScore;
            foundWords.add(word);
            foundWords = foundWords; // Trigger Svelte reactivity
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
        if (word.length === 2) return 1;
        if (word.length === 3) return 2;
        if (word.length === 4) return 3;
        if (word.length === 5) return 5;
        if (word.length === 6) return 8;
        if (word.length === 7) return 11;
        if (word.length === 8) return 16;
        return 16 + ((word.length - 8) * 6);
    }

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
            <div class="text-white text-3xl">
                Found Words:<br/><br/>
                <div class="flex flex-col flex-wrap h-[60rem] gap-x-8 XXborder borXXder-pink-950" style="width: 30rem;">
                    {#each Array.from(foundWords).sort() as word (word)}
                        <div class="flex items-center w-[13rem]" in:fade|local={{ duration: 800 }} out:slide|local={{ duration: 300 }}>
                            <div class="flex justify-end gap-[.125rem] w-[6rem]">
                                {#each Array(getWordScore(word)) as _, i}
                                    <div class="w-2 h-2 bg-red-300 rounded-full"></div>
                                {/each}
                            </div>
                            <div class="ml-1" class:text-red-300={word === mostRecentWord}>
                                {word.toUpperCase()}
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
            {#each row as letter, j}
                <div
                    class="absolute flex-center-all text-7xl text-white select-none transition-opacity duration-500
                          {currentPath.includes(`${j},${i}`) ? 'bg-blue-500' : 'bg-blue-900'}
                          {errorShake ? 'opacity-70' : 'opacity-100'}"
                    style="
                        width: {CELL_SIZE}rem;
                        height: {CELL_SIZE}rem;
                        left: {GRID_OFFSET_X + j * (CELL_SIZE + GAP)}rem;
                        top: {GRID_OFFSET_Y + i * (CELL_SIZE + GAP)}rem;
                        border-radius: 4rem;
                    "
                    on:pointerdown|preventDefault={(e) => handlePointerDown(j, i, e)}
                >
                    {letter}
                </div>
            {/each}
        {/each}

        <!-- Path lines -->
        {#if isDragging}
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
                        color="#ff69b450"
                        thick={1}
                    />
                {/if}
            {/each}
            
            {#if currentPath.length > 0}
                {@const [lastX, lastY] = currentPath[currentPath.length - 1].split(',').map(Number)}
                {@const start = getCellCenter(lastX, lastY)}
                <Line 
                    x0={start.x}
                    y0={start.y}
                    x1={pointerX}
                    y1={pointerY}
                    color="#ff69b450"
                    thick={1}
                />
            {/if}
        {/if}

        <CloseButton />
    </div>
</FourByThreeScreen>

<style>
</style>