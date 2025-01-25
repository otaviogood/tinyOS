<script>
    import "../TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
	import { tweened } from 'svelte/motion';
    import { elasticOut, cubicInOut, cubicOut } from "svelte/easing";
    import { shake, slideHit, scalePulse2 } from "./AnimSvelte.js";

    import { Howl, Howler } from "howler";
    import WinScreen from "../WinScreen.svelte";
    import { pop } from "../../../router";
    import { allTowns, currentTownIndex, earnedStar } from "../stores";
    import { handleResize } from "../../../screen";
    import { sleep, getRandomInt, preventZoom } from "../util";
    import { Animator, frameCount, animateCount } from "../../../animator";
    import IconsMisc from "../IconsMisc.svelte";
    import FourByThreeScreen from "../../../components/FourByThreeScreen.svelte";
    import { BitmapInt32, MazeGenerator } from "./BitmapInt32";
    import { Actor } from "./Actor";
    import HealthBar from "./HealthBar.svelte";
    import CharacterStats from "./CharacterStats.svelte";
    import RandomFast from "../../../random-fast";

    let animator = new Animator(60, tick);

    let started = false;
    let town;
    let gameType;

    let mapW = 17;
    let mapH = 17;
    let map = new BitmapInt32(mapW, mapH);
    let fogOfWar = new BitmapInt32(mapW, mapH);
    let characters = [];
    let opponent = null;
    let dungeonLevel = 0;
    let prompt = null;
    let collectedMonsters = new Set();

    // let imageCache=[];
    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {
            animator.stop();
        };
    });

    function tick() {}

    function updateFog() {
        let xy = characters[0].getPosition();
        // Update the fog of war
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx=-1; dx <= 1; dx++) {
                let unexplored = fogOfWar.GetPixelSafeEdge(xy.x + dx, xy.y + dy, 1);
                if (unexplored === 0) characters[0].addXP(1);
                fogOfWar.SetPixelSafe(xy.x + dx, xy.y + dy, 1);

            }
        }
        fogOfWar = fogOfWar;
    }

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
        // Check for collision with all the bad guys in characters array, skipping the first one because that's the player character
        opponent = null;
        for (let i = 1; i < characters.length; i++) {
            const character = characters[i];
            if (character.isActorDead()) continue;
            // console.log("Checking collision with bad guy", character, xy.x + unitVector.x, xy.y + unitVector.y);
            if (character.x === xy.x + unitVector.x && character.y === xy.y + unitVector.y) {
                // console.log("Collision with bad guy");
                if (character.stairs) {
                    prompt = { msg:"You got to level " + (dungeonLevel + 2), btn:"Go", fn:()=>{prompt=null; resetGame(dungeonLevel + 1)}, btn2:"No", fn2:()=>{prompt=null}};
                    return;
                } else {
                    startFightScreen(character);
                    return;
                }
            }
        }
        // Check collision with walls
        if (map.GetPixelSafeEdge(xy.x + unitVector.x, xy.y + unitVector.y, 1) !== 0) return;

        playerCharacter.setPosition(xy.x + unitVector.x, xy.y + unitVector.y);
        characters = characters;

        updateFog();

        // removeDeadCharacters();
    }

    // Function to remove dead characters from the characters array
    function removeDeadCharacters() {
        // Don't remove hero though.
        characters = characters.filter((character) => !character.isActorDead() || character.monsterType==='hero' );
    }

    function startFightScreen(opp) {
        opponent = opp;
        $monsterAlive = 1.0;
    }

    function attack() {
        const playerCharacter = characters[0];
        const opponentCharacter = opponent;
        if (playerCharacter.isDead) return;
        if (opponentCharacter.isDead) return;
        playerCharacter.health -= opponentCharacter.attackPower;
        opponentCharacter.health -= playerCharacter.attackPower;
        playerCharacter.attackingTrigger++;
        if (opponentCharacter.health <= 0) {
            opponentCharacter.health = 0;
            opponentCharacter.isDead = true;
            $monsterAlive = 0.0;
            playerCharacter.addXP(opponentCharacter.experience);
            collectedMonsters.add(opponentCharacter.monsterType);
            setTimeout(() => {
                opponent = null;
            }, 2000);
        }
        if (playerCharacter.health <= 0) {
            playerCharacter.health = 0;
            playerCharacter.isDead = true;
            prompt = { msg:"Fail at level " + (dungeonLevel + 1), btn:"Try again", fn:()=>{prompt=null; resetGame(0)}};
            setTimeout(() => {
                opponent = null;
            }, 2000);
        }
        removeDeadCharacters();
        opponent = opponent;
    }

    function getRandomOpenPosition(mazeGen) {
        let xy = mazeGen.getRandomOpenPosition();
        // Check for collision with all characters in characters array. Use while loop, not recursion.
        while (characters.some((character) => character.x === xy[0] && character.y === xy[1])) {
            xy = mazeGen.getRandomOpenPosition();
        }
        return xy;
    }

    function resetGame(lvl = 0) {
        dungeonLevel = lvl;
        map = new BitmapInt32(mapW, mapH);
        fogOfWar = new BitmapInt32(mapW, mapH);
        // fogOfWar.Clear(1);  // HACK DELETEME
        let mazeGen = new MazeGenerator(map, dungeonLevel).generate();
        // map.SetPixel(15, 15, 2);
        let xy = mazeGen.getRandomOpenPosition();
        if (lvl === 0) {
            characters = []; //MAKE THIS KEEP THE PLAYER CHARACTER1
            // Create the player character
            const playerCharacter = new Actor(xy[0], xy[1], "hero");
            characters.push(playerCharacter);
        }
        // keep only the first in the array
        else {
            characters = characters.slice(0,1);
            characters[0].x = xy[0];
            characters[0].y = xy[1];
        }
        moveTo(characters[0].x, characters[0].y);
        updateFog();
        if (lvl === 0) characters[0].experience = 0; // Reset because fog gave us XP.

        // Create some NPCs
        for (let i = 0; i < 4 + dungeonLevel * 4; i++) {
            let xy = getRandomOpenPosition(mazeGen);
            // Get random monster from the stats lookup dictionary.
            let k = Object.keys(Actor.statsLookup);
            let monsterType = k[mazeGen.random.RandIntApprox(0, k.length)];
            let monster = Actor.statsLookup[monsterType];
            while (monster.level === undefined || monster.level > dungeonLevel) {
                monsterType = k[mazeGen.random.RandIntApprox(0, k.length)];
                monster = Actor.statsLookup[monsterType];
            }
            // console.log("Adding monster", monsterType, monster.level);
            const npc = new Actor(xy[0], xy[1], monsterType);
            // map.SetPixel(npc.x, npc.y, 0);
            characters.push(npc);
        }
        // const npc2 = new Actor(9, 9, "greenSlime");
        // map.SetPixel(npc2.x, npc2.y, 0);
        // characters.push(npc1, npc2);

        // make exit stairs as an actor
        let stairsPos = mazeGen.getRandomOpenPosition(1);
        map.SetPixel(stairsPos[0], stairsPos[1], 0);
        const npc1 = new Actor(stairsPos[0], stairsPos[1], "stairs");
        characters.push(npc1);

        // collectedMonsters.add("greenSlime");
        // collectedMonsters.add("tweeger");
        // collectedMonsters.add("hairMonster");
        // collectedMonsters.add("grouch");
        // collectedMonsters.add("pumpkin");

        // opponent = characters[1];
        map = map;
    }

    function keyDown(e) {
        if (!e || !e.key) return;
        // console.log(e.key);
        // Directional movement
        if (prompt) return;
        if (e.key === "ArrowUp") {
            moveTo(characters[0].x, characters[0].y - 1);
        } else if (e.key === "ArrowDown") {
            moveTo(characters[0].x, characters[0].y + 1);
        } else if (e.key === "ArrowLeft") {
            moveTo(characters[0].x - 1, characters[0].y);
        } else if (e.key === "ArrowRight") {
            moveTo(characters[0].x + 1, characters[0].y);
        } else if (e.key === " ") {
            if (opponent) attack();
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

    const monsterAlive = tweened(1, {
        delay: 100,
		duration: 1500,
		easing: cubicOut
	});

    handleResize();
    startGame();
</script>

<svelte:window on:keydown={keyDown} />

<FourByThreeScreen bg="#0a0a14" class="{characters[0].isDead ? 'filter sepia':''}">
    {#if !started}
        <div class="flex-center-all h-full w-full flex flex-col bg-black">
            <img draggable="false"
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
        {#if opponent}
            <div in:fade={{ duration: 500 }} class="flex-center-all h-full w-full flex flex-col bg-black z-20">
                <img draggable="false"
                    src="TinyQuest/gamedata/dungeon/arena.webp"
                    class="absolute"
                    alt="skyscraper"
                    style="height:74rem"
                />
                <button
                    class="absolute top-4 bg-gray-900/80 border border-gray-600 text-white text-6xl rounded-3xl px-8 py-1"
                    on:pointerup|preventDefault|stopPropagation={()=>(opponent=null)}><i class="fa-solid fa-person-running"></i></button
                >
                {#key characters[0].attackingTrigger}
                    <img in:slideHit|local={{ delay: 0, duration: 1000, dir:-1 }} draggable="false" class="absolute w-[16rem]" style="right:20rem;bottom:8rem;" src="TinyQuest/gamedata/dungeon/{characters[0].img}" />
                {/key}
                {#key characters[0].attackingTrigger}
                    <img in:slideHit|local={{ delay: 0, duration: 1000 }} draggable="false" class="absolute w-[16rem] transform -scale-x-100" style="left:20rem;bottom:8rem;opacity:{$monsterAlive}" src="TinyQuest/gamedata/dungeon/{opponent.img}" on:pointerup|preventDefault|stopPropagation={attack} />
                {/key}
                <div class="absolute w-[25rem] h-[32rem] top-0 right-0 bg-gray-900/80">
                    {#key characters[0].health}
                        <img in:shake|local={{ delay: 250, duration: 700 }} draggable="false" class="w-3/4 mr-0 ml-auto" src="TinyQuest/gamedata/dungeon/{characters[0].img}" />
                    {/key}
                    <CharacterStats character={characters[0]} {dungeonLevel} />
                    <HealthBar health={characters[0].mana} maxHealth={characters[0].maxMana} r={29} g={78} b={216} left={false} />
                    <HealthBar health={characters[0].health} maxHealth={characters[0].maxHealth} left={false} />
                </div>
                <div class="absolute w-[25rem] h-[32rem] top-0 left-0 bg-gray-900/80">
                    {#key opponent.health}
                        <img in:shake|local={{ delay: 250, duration: 700, flip:-1 }} draggable="false" class="w-3/4 transform -scale-x-100" src="TinyQuest/gamedata/dungeon/{opponent.img}" />
                    {/key}
                    <div class="relative flex flex-row text-4xl text-right h-16 my-1">
                        <div class="flex-center-all w-min border border-gray-600 bg-black/10 rounded-2xl px-3 h-16 mx-1"><i class="fa-solid fa-burst"></i>&nbsp;&nbsp;{opponent?.attackPower}</div>
                        <div class="flex-center-all w-min border border-gray-600 bg-black/10 rounded-2xl px-3 h-16 mx-1"><i class="fa-solid fa-arrow-up-right-dots"></i>&nbsp;&nbsp;{opponent?.experience}</div>
                    </div>
                    <HealthBar health={opponent.mana} maxHealth={opponent.maxMana} r={29} g={78} b={216} />
                    <HealthBar health={opponent.health} maxHealth={opponent.maxHealth} />
                </div>
            </div>
        {:else}
        <div class="flex flex-row h-full w-full">
            <div class="fit-full-space" style="">
                <div class="absolute" style="left:0rem;right:0rem;top:0rem;bottom:0rem;width:160rem;">
                    {#each Array(mapH) as _, y}
                        {#each Array(mapW) as _, x}
                            <div
                                class="absolute overflow-hidden"
                                style="left:{x * 4.4}rem;top:{y *
                                    4.4}rem;width:4.4rem;height:4.4rem;" on:pointerup={() => {
                                        moveTo(x, y);
                                    }}
                            >
                            {#if fogOfWar.GetPixel(x, y) === 0}
                                <div class="absolute w-full h-full bg-black"></div>
                            {:else}
                                {#if map.GetPixel(x, y) === 1}
                                <img src="TinyQuest/gamedata/dungeon/wall01.jpg" draggable="false" class="w-full h-full"/>
                                <!-- <div style="background: url(TinyQuest/gamedata/dungeon/tiles.webp) 64 0;width:64px;height:64px;"></div> -->
                                <!-- <div style="background-image: url(TinyQuest/gamedata/dungeon/tiles.webp);background-size: 512px 512px;widXth:4.4rem;heigXht:4.4rem;background-position:-128px 0px;tranXXsform: scale(0.5);tranXXsform-origin: top left;"></div> -->
                                <!-- <img src="TinyQuest/gamedata/dungeon/tiles.webp" style="width:400%;height:400%; clip-path: inset(63px 1px);"/> -->
                                <!-- <img src="TinyQuest/gamedata/dungeon/tiles.webp" style="objeXXct-fit: none;margin-left:-20px; oXXbject-position: -128px 0;object-sXXize:0.5; width:512px;height:512px;transfXXorm: scale(0.85,0.5);tranXXsform-origin: top left;"/> -->
                                {:else if map.GetPixel(x, y) === 2}
                                <img src="TinyQuest/gamedata/dungeon/stairs01.jpg" draggable="false" class="w-full h-full" />
                                {:else}
                                <img src="TinyQuest/gamedata/dungeon/floor01.jpg" draggable="false" class="w-full h-full" />
                                {/if}
                            {/if}
                            </div>
                        {/each}
                    {/each}
                    {#each characters as character, i}
                        {#if fogOfWar.GetPixel(character.x, character.y) !== 0}
                            <div
                                class="absolute pointer-events-none"
                                style="left:{character.x * 4.4}rem;top:{character.y *
                                    4.4}rem;width:4.4rem;height:4.4rem;background-color:{character.isActorDead()
                                    ? '#ff0000'
                                    : ''};"
                            >
                                <img src="TinyQuest/gamedata/dungeon/{character.img}" draggable="false" />
                            </div>
                        {/if}
                    {/each}
                </div>
            </div>

            <div
                class="absolute w-[25rem] h-[32rem] top-0 right-0 bg-gray-900/80 select-none"
                style=""
                on:touchstart={preventZoom}
            >
                <img draggable="false" class="w-3/4 mr-0 ml-auto pointer-events-none" src="TinyQuest/gamedata/dungeon/{characters[0].img}" />
                <CharacterStats character={characters[0]} {dungeonLevel} />
                <HealthBar health={characters[0].mana} maxHealth={characters[0].maxMana} left={false} r={29} g={78} b={216} />
                <HealthBar health={characters[0].health} maxHealth={characters[0].maxHealth} left={false} />
                <div class="flex flex-wrap w-[25rem] h-40 bg-gray-900">
                    {#each Array.from(collectedMonsters) as monsterType}
                        <div class="w-[4.5rem] h-[4.5rem] m-1 border-4 bg-gray-700 rounded-full overflow-hidden"
                        style="border-color:{['#d03030', '#4060ff', '#a09020', '#20b040', '#90c0e0'][['e_fire', 'e_water', 'e_wood', 'e_earth', 'e_air'].indexOf(Actor.statsLookup[monsterType]?.element)]}">
                            <img draggable="false" class="w-[4.5rem] h-[4.5rem]" src="TinyQuest/gamedata/dungeon/{Actor.statsLookup[monsterType].img}" />
                        </div>
                    {/each}
                </div>
            </div>
            <div
                class="absolute right-0 top-0 cursor-pointer select-none m-1 opacity-80"
                on:pointerup|preventDefault|stopPropagation={resetToSplashScreen}
                on:touchstart={preventZoom}
            >
                <IconsMisc icon="treasure-map" size="5rem" style="" />
            </div>
        </div>
        {/if}
        {#if prompt}
            <div in:fade={{ duration: 200 }} class="absolute top-0 left-0 w-[75rem] h-full flex-center-all bg-black/30">
                <div class="flex flex-col bg-blue-800 border-[0.5rem] border-white rounded-2xl p-2">
                    <div class="text-5xl m-2">{prompt.msg}</div>
                    <button
                        
                        class="bg-black/30 border border-gray-300 text-white text-9xl rounded-3xl p-8 m-2 z-20"
                        style="maXXrgin-top:25rem"
                        on:pointerup|preventDefault|stopPropagation={prompt.fn}>{prompt.btn}</button
                    >
                    {#if prompt.btn2}
                        <button
                            
                            class="bg-black/30 border border-gray-500 text-gray-300 text-9xl rounded-3xl p-8 m-2 z-20"
                            style="maXXrgin-top:25rem"
                            on:pointerup|preventDefault|stopPropagation={prompt.fn2}>{prompt.btn2}</button
                        >
                    {/if}
                </div>
            </div>
        {/if}

    {/if}
</FourByThreeScreen>

<style>
</style>
