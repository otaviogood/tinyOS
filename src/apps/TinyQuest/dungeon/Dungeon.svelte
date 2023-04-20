<script>
    import "../TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import WinScreen from "../WinScreen.svelte";
    import { pop } from "svelte-spa-router";
    import { allTowns, currentTownIndex, earnedStar } from "../stores";
    import { handleResize } from "../../../screen";
    import { sleep, getRandomInt, preventZoom } from "../util";
    import { Animator, frameCount, animateCount } from "../../../animator";
    import IconsMisc from "../IconsMisc.svelte";
    import FourByThreeScreen from "../../../components/FourByThreeScreen.svelte";
    import { BitmapInt32, MazeGenerator } from "./BitmapInt32";
    import { Actor } from "./Actor";

    let animator = new Animator(60, tick);

    let started = false;
    let town;
    let gameType;

    let mapW = 17;
    let mapH = 17;
    let map = new BitmapInt32(mapW, mapH);
    let characters = [];

    // let imageCache=[];
    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    function tick() {}

    function moveTo(x, y) {
        const playerCharacter = characters[0];
        let xy = playerCharacter.getPosition();
        // Figure axis-aligned out movement direction vector
        const dx = x - xy.x;
        const dy = y - xy.y;
        // Figure out dominant axis and then get a unit vector in that direction
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const dominantAxis = absDx > absDy ? "x" : "y";
        const unitVector = dominantAxis === "x" ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
        // Move the player character in the direction of the dominant axis
        if (map.GetPixel(xy.x + unitVector.x, xy.y + unitVector.y) !== 0) return;
        playerCharacter.setPosition(xy.x + unitVector.x, xy.y + unitVector.y);
        characters = characters;
        // removeDeadCharacters();
    }

    // Function to remove dead characters from the characters array
    function removeDeadCharacters() {
        characters = characters.filter((character) => !character.isActorDead());
    }

    function resetGame() {
        new MazeGenerator(map).generate();
        characters = [];
        // Create the player character
        const playerCharacter = new Actor(1, 1);
        characters.push(playerCharacter);

        // Create some NPCs
        const npc1 = new Actor(5, 5);
        const npc2 = new Actor(9, 9);
        characters.push(npc1, npc2);
    }

    function keyDown(e) {
        if (!e || !e.key) return;
        // console.log(e.key);
        // Directional movement
        if (e.key === "ArrowUp") {
            moveTo(characters[0].x, characters[0].y - 1);
        } else if (e.key === "ArrowDown") {
            moveTo(characters[0].x, characters[0].y + 1);
        } else if (e.key === "ArrowLeft") {
            moveTo(characters[0].x - 1, characters[0].y);
        } else if (e.key === "ArrowRight") {
            moveTo(characters[0].x + 1, characters[0].y);
        }
    }

    async function startGame() {
        started = true;
        animator.start();

        resetGame();
    }

    function resetToSplashScreen() {
        started = false;
        pop();
    }

    handleResize();
    startGame();
</script>

<svelte:window on:keydown={keyDown} />

<FourByThreeScreen>
    {#if !started}
        <div class="flex-center-all h-full w-full flex flex-col bg-black">
            <img
                src="TinyQuest/gamedata/dungeon/otaviogood_cute_dungeon_adventure_with_monster_with_magic_staff_757b74db-26ff-4c1e-9924-55c245d07e1a.png"
                class="absolute"
                alt="skyscraper"
                style="height:74rem"
            />
            <div
                in:fade={{ duration: 2000 }}
                class="text-9xl font-bold text-white m-8 z-10 rounded-3xl px-8 py-1 w-[70rem] text-center"
                style="margin-top:5rem;background:linear-gradient(.25turn, #40101000, #f01080f0, #40101000);"
            >
                {town?.name}
            </div>
            <button
                in:fade={{ duration: 2000 }}
                class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10"
                style="margin-top:25rem"
                on:pointerup|preventDefault|stopPropagation={startGame}>START</button
            >
        </div>
    {:else}
        <div class="flex flex-row h-full w-full">
            <div class="fit-full-space" style="">
                <div class="absolute" style="left:0rem;right:0rem;top:0rem;bottom:0rem;width:160rem;;">
                    {#each Array(mapH) as _, y}
                        {#each Array(mapW) as _, x}
                            <div
                                class="absolute"
                                style="left:{x * 4.4}rem;top:{y *
                                    4.4}rem;width:4.4rem;height:4.4rem;background-color:{map.GetPixel(x, y) === 1
                                    ? '#303038'
                                    : '#6f6060'}; bordXXer:1px solid #000000" on:pointerup={() => {
                                        moveTo(x, y);
                                    }}
                            >
                            {#if map.GetPixel(x, y) === 1}
                            <img src="TinyQuest/gamedata/dungeon/wall01.jpg" />
                            {:else}
                            <img src="TinyQuest/gamedata/dungeon/floor01.jpg" />
                            {/if}
                            </div>
                        {/each}
                    {/each}
                    {#each characters as character, i}
                        <div
                            class="absolute"
                            style="left:{character.x * 4.4}rem;top:{character.y *
                                4.4}rem;width:4.4rem;height:4.4rem;background-color:{character.isActorDead()
                                ? '#ff0000'
                                : '#00ff00'}; border:1px solid #000000"
                        >
                        {#if i === 0}
                            <img src="TinyQuest/gamedata/dungeon/otaviogood_cute_video_game_character._A_heroic_knight_with_a_sw_0c3b4b09-fe0b-4b05-9c40-bcdfe839dd23.png" />
                        {:else}
                            <img src="TinyQuest/gamedata/dungeon/otaviogood_cute_video_game_character._A_green_slime_monster._is_dd4ba597-2f75-48c2-b120-95a2a7447ab5.png" />
                        {/if}
                        <!-- <img src="TinyQuest/gamedata/dungeon/otaviogood_cute_video_game_character._A_heroic_knight_with_a_sw_0c3b4b09-fe0b-4b05-9c40-bcdfe839dd23.png" /> -->
                        </div>
                    {/each}
                </div>
            </div>

            <div
                class="absolute right-0 top-32 bottom-0 left-[75rem] select-none border border-green-700"
                style=""
                on:touchstart={preventZoom}
            >
                <img class="w-3/4" src="TinyQuest/gamedata/dungeon/otaviogood_cute_video_game_character._A_heroic_knight_with_a_sw_0c3b4b09-fe0b-4b05-9c40-bcdfe839dd23.png" />
                <div class="relative w-full h-16">
                    <div class="absolute text-6xl w-1/2 h-16">H: 5</div>
                </div>
                <div class="relative w-full h-16">
                    <div class="absolute bg-red-900 w-full h-16"></div>
                    <div class="absolute bg-red-700 w-1/2 h-16"></div>
                    <div class="absolute text-6xl w-1/2 h-16">4/8</div>
                </div>
                <div class="relative w-full h-16">
                    <div class="absolute bg-blue-900 w-full h-16"></div>
                    <div class="absolute bg-blue-700 w-5/12 h-16"></div>
                    <div class="absolute text-6xl w-5/12 h-16">3/8</div>
                </div>
                <div class="absolute w-full h-16 bottom-[19rem]">
                    <div class="absolute bg-red-900 w-full h-16"></div>
                    <div class="absolute bg-red-700 w-3/4 h-16"></div>
                    <div class="absolute text-6xl w-3/4 h-16">3/4</div>
                </div>
                <img class="absolute bottom-0 w-3/4" src="TinyQuest/gamedata/dungeon/otaviogood_cute_video_game_character._A_green_slime_monster._is_dd4ba597-2f75-48c2-b120-95a2a7447ab5.png" />
            </div>
            <div
                class="absolute right-0 top-0 cursor-pointer select-none m-1"
                style="padding:0 0.75rem;border-radius:0.75rem;"
                on:pointerup|preventDefault|stopPropagation={resetToSplashScreen}
                on:touchstart={preventZoom}
            >
                <IconsMisc icon="treasure-map" size="7.5rem" style="" />
            </div>
        </div>
    {/if}
</FourByThreeScreen>

<style>
</style>
