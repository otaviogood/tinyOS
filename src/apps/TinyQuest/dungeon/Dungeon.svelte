<script>
    import "../TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
	import { tweened } from 'svelte/motion';
    import { elasticOut, cubicInOut, cubicOut, linear } from "svelte/easing";
    import { shake, slideHit, scalePulse, scalePulse2, shakeIce } from "./AnimSvelte.js";

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
    let recentlyCollectedMonster = null; // Track the most recently collected monster
    let dyingCharacter = null; // Single dying character instead of array

    // Tweened animation values
    const monsterAlive = tweened(1, {
        delay: 100,
		duration: 1500,
		easing: cubicOut
	});
    
    const deathAnim = tweened(1, {
        delay: 0,
        duration: 1500,
        easing: cubicOut
    });

    // NEW: timer tween to show freeze countdown around the monster
    const freezeTurnDuration = 3000; // milliseconds per auto-turn while frozen
    const freezeTimerProgress = tweened(0, {
        delay: 0,
        duration: freezeTurnDuration,
        easing: linear
    });

    // Hold reference to outstanding timeout so we never double-schedule
    let freezeTimerId = null;

    // NEW: reactive value for calculating the stroke-dashoffset (full circumference * current progress)
    const freezeRingCircumference = Math.PI * 2 * 46;
    $: freezeRingOffset = freezeRingCircumference * $freezeTimerProgress;

    // Helper to schedule the next automatic turn while the hero is frozen
    function maybeScheduleAutoAttack() {
        const playerCharacter = characters[0];
        // If battle finished or hero dead, cancel timer
        if (!opponent || playerCharacter.isDead) {
            if (freezeTimerId) {
                clearTimeout(freezeTimerId);
                freezeTimerId = null;
            }
            freezeTimerProgress.set(0, { duration: 0 });
            return;
        }

        if (playerCharacter.isFrozen()) {
            // Already scheduled? then do nothing
            if (freezeTimerId !== null) return;

            // Restart visual progress ring
            freezeTimerProgress.set(1, { duration: 0 });
            freezeTimerProgress.set(0, { duration: freezeTurnDuration });

            freezeTimerId = setTimeout(() => {
                console.log("freezeTimerId", freezeTimerId);
                freezeTimerId = null;
                // One frozen turn has elapsed
                playerCharacter.decreaseFrozen();
                attack(opponent);
            }, freezeTurnDuration);
        } else {
            // Not frozen any more – ensure timer cancelled
            if (freezeTimerId) {
                clearTimeout(freezeTimerId);
                freezeTimerId = null;
            }
            freezeTimerProgress.set(0, { duration: 0 });
        }
    }

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
                } else if (character.actorMode === 1) {
                    // pick up artifact
                    if (!collectedMonsters.has(character.monsterType)) {
                        showMonsterCollectionPopup(character.monsterType);
                    }
                    collectedMonsters.add(character.monsterType);
                    collectedMonsters = collectedMonsters;
                    playerCharacter.pickup(character);
                    removeDeadCharacters();
                    return;
                } else if (character.actorMode === 2) {
                    // pick up mana potion
                    playerCharacter.pickup(character);
                    removeDeadCharacters();
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

    // Function to show monster collection popup
    function showMonsterCollectionPopup(monsterType, first = true) {
        recentlyCollectedMonster = first ? monsterType : null;
        prompt = { 
            isMonsterCollection: true,
            monsterType: monsterType,
            msg: first ? `Collected ${Actor.statsLookup[monsterType]?.readableName || monsterType}!` : 
                         `${Actor.statsLookup[monsterType]?.readableName || monsterType}`, 
            btn: first ? "Yay!" : "OK", 
            fn: () => {
                prompt = null;
                recentlyCollectedMonster = null;
            }
        };
    }

    // Function to remove dead characters from the characters array
    function removeDeadCharacters() {
        let keep = [];
        let foundDyingCharacter = false;
        
        for (const character of characters) {
            if (character.isActorDead() && character.monsterType !== 'hero') {
                // Always animate the first dead character we find
                if (!foundDyingCharacter) {
                    foundDyingCharacter = true;
                    dyingCharacter = character;

                    if (character.drop) {
                        const npc = new Actor(character.x, character.y, character.drop);
                        characters.push(npc);
                        characters = characters;
                    }

                    // Cancel any in-progress animation and start a new one
                    deathAnim.set(1, {duration: 0}); // Instant reset
                    deathAnim.set(0, {delay: character.actorMode === 0 ? 2300 : 0}).then(() => {
                        // After animation completes, clear dying character reference
                        // to allow next animation to start
                        dyingCharacter = null;
                        
                        // Check for more dead characters after this animation
                        removeDeadCharacters();
                    });
                }
            } else {
                keep.push(character);
            }
        }
        characters = keep;
    }

    function startFightScreen(opp) {
        opponent = opp;
        $monsterAlive = 1.0;
    }

    function attack(attacker) {
        const playerCharacter = characters[0];
        const opponentCharacter = opponent;
        if (playerCharacter.isDead) return;
        if (opponentCharacter.isDead) return;

        if (attacker === playerCharacter && playerCharacter.isFrozen()) return;

        // Do spells first
        if ((!opponentCharacter.isFrozen()) && (opponentCharacter.monsterType === "iceMonster") && (opponentCharacter.mana > 0)) {
            freezeAttack(opponentCharacter, playerCharacter);
        }

        // Player only attacks if not frozen
        if (!playerCharacter.isFrozen()) {
            playerCharacter.attack(opponentCharacter);
            playerCharacter.attackingTrigger++;
        }

        // Opponent only attacks if not frozen
        if (!opponentCharacter.isFrozen()) {
            opponentCharacter.attack(playerCharacter);
            opponentCharacter.attackingTrigger++;
        } else {
            // Decrease frozen counter after opponent's turn
            opponentCharacter.decreaseFrozen();
        }
        
        if (opponentCharacter.health <= 0) {
            opponentCharacter.health = 0;
            opponentCharacter.isDead = true;
            $monsterAlive = 0.0;
            playerCharacter.addXP(opponentCharacter.experience);
            setTimeout(() => {
                if (!collectedMonsters.has(opponentCharacter.monsterType)) {
                    showMonsterCollectionPopup(opponentCharacter.monsterType);
                }
                collectedMonsters.add(opponentCharacter.monsterType);
                collectedMonsters = collectedMonsters;
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
        characters = characters;

        // NEW: after resolving turn, maybe set up auto attack if hero still frozen
        maybeScheduleAutoAttack();
    }

    // Add a freeze attack function
    function freezeAttack(attacker, target) {
        if (attacker.isDead || target.isDead) return;
        if (attacker.mana < 1) return; // Not enough mana
        
        // Use mana to freeze the target
        attacker.addMana(-1);

        // Freeze the target for 2 turns
        target.freeze(2);
        
        // Visual feedback
        attacker.attackingTrigger++;

        // Update UI
        opponent = opponent;
        // Explicitly tell Svelte the characters array has changed to update player UI
        characters = characters; 

        // If the target is the hero, start the auto-turn schedule
        if (target === characters[0]) {
            maybeScheduleAutoAttack();
        }
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
            while (monster.level === undefined || monster.level > dungeonLevel || monster.actorMode > 0) {
                monsterType = k[mazeGen.random.RandIntApprox(0, k.length)];
                monster = Actor.statsLookup[monsterType];
            }
            // console.log("Adding monster", monsterType, monster.level);
            const npc = new Actor(xy[0], xy[1], monsterType);
            // map.SetPixel(npc.x, npc.y, 0);
            if ((monsterType === "tweeger" || monsterType === "iceMonster") && (mazeGen.random.RandFloat() < npc.dropChance)) {
                npc.drop = "manaPotion";
            }
            if ((monsterType === "hairMonster" || monsterType === "pumpkin") && (mazeGen.random.RandFloat() < npc.dropChance)) {
                npc.drop = "healthPotion";
            }
            if ((i === 0) && (npc['actorMode'] === 0) && (!collectedMonsters.has("artifactFreeze"))) {
                npc.drop = "artifactFreeze";
                npc.dropChance = 1.0;
            }
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

        // opponent = characters[1];
        map = map;
    }

    function keyDown(e) {
        if (!e || !e.key) return;
        // console.log(e.key);
        
        // Handle prompt buttons with keyboard
        if (prompt) {
            if (e.key === "Enter" || e.key === " ") {
                // Primary button (button1)
                if (prompt.fn) prompt.fn();
                return;
            } else if (e.key === "Escape") {
                // Secondary button (button2) if it exists
                if (prompt.fn2) prompt.fn2();
                return;
            }
            return; // Block other keys when prompt is active
        }

        // Directional movement
        if (e.key === "ArrowUp") {
            moveTo(characters[0].x, characters[0].y - 1);
        } else if (e.key === "ArrowDown") {
            moveTo(characters[0].x, characters[0].y + 1);
        } else if (e.key === "ArrowLeft") {
            moveTo(characters[0].x - 1, characters[0].y);
        } else if (e.key === "ArrowRight") {
            moveTo(characters[0].x + 1, characters[0].y);
        } else if (e.key === " ") {
            if (opponent) attack(characters[0]);
        } else if (e.key === "f" || e.key === "F") {
            if (opponent) freezeAttack(characters[0], opponent);
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
                    <img 
                        in:slideHit|local={{ delay: 0, duration: 1000, dir:-1 }} 
                        draggable="false" 
                        class="absolute w-[16rem]" 
                        style="right:20rem;bottom:8rem;{characters[0].frozen ? 'filter: drop-shadow(0 0 1rem #1090ff) drop-shadow(0 0 2rem #10c0ff);' : ''}" 
                        src="TinyQuest/gamedata/dungeon/{characters[0].img}" 
                    />
                    {#if characters[0].frozen}
                    <div class="absolute" style="right:20rem;bottom:8rem;">
                        <div class="absolute top-[-5rem] left-1/2 transform -translate-x-1/2 text-8xl text-sky-100 whitespace-nowrap" style="filter: drop-shadow(0 0 1rem #1090ff) drop-shadow(0 0 2rem #10c0ff);">
                            <i class="fa-solid fa-snowflake"></i>{characters[0].frozen}
                        </div>
                    </div>
                    {/if}
                {/key}
                {#if !opponent.frozen}
                    {#key opponent.attackingTrigger}
                        <img in:slideHit|local={{ delay: 0, duration: 1000 }} draggable="false" class="absolute w-[16rem] transform -scale-x-100" style="left:20rem;bottom:8rem;opacity:{$monsterAlive}" src="TinyQuest/gamedata/dungeon/{opponent.img}" on:pointerup|preventDefault|stopPropagation={() => attack(characters[0])} />
                    {/key}
                {:else}
                    <div class="absolute" style="left:20rem;bottom:8rem;opacity:{$monsterAlive};">
                        <img in:shakeIce|local={{ delay: 0, duration: 400, flip:-1 }} draggable="false" class="w-[16rem] transform -scale-x-100"
                            style="filter: drop-shadow(0 0 1rem #1090ff) drop-shadow(0 0 2rem #10c0ff);"
                            src="TinyQuest/gamedata/dungeon/{opponent.img}" on:pointerup|preventDefault|stopPropagation={() => attack(characters[0])} />
                        <div class="absolute top-[-5rem] left-1/2 transform -translate-x-1/2 text-8xl text-sky-100 whitespace-nowrap" style="filter: drop-shadow(0 0 1rem #1090ff) drop-shadow(0 0 2rem #10c0ff);">
                            <i class="fa-solid fa-snowflake"></i>{opponent.frozen}
                        </div>
                    </div>
                {/if}
                <div class="absolute bottom-12 left-1/2 transform -translate-x-1/2 flex flex-row gap-4">
                    <!-- Attack Button: Adjusted positioning -->
                    <button
                        class="w-20 h-20 flex items-center justify-center
                               bg-gray-900/80 border border-gray-600 text-white text-4xl rounded-full hover:bg-gray-800"
                        on:pointerup|preventDefault|stopPropagation={() => attack(characters[0])}>
                        <i class="fa-solid fa-hand-fist"></i>
                    </button>
                    
                    <!-- Freeze Button: Only show if player has the freeze artifact -->
                    {#if collectedMonsters.has("artifactFreeze")}
                    <button
                        class="w-20 h-20 flex items-center justify-center
                               bg-blue-900/80 border border-blue-400 text-white text-4xl rounded-full hover:bg-blue-800
                               {characters[0].mana < 1 ? 'opacity-50 cursor-not-allowed' : ''}"
                        disabled={characters[0].mana < 1}
                        on:pointerup|preventDefault|stopPropagation={() => freezeAttack(characters[0], opponent)}>
                        <i class="fa-solid fa-snowflake"></i>
                    </button>
                    {/if}
                </div>
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

                <!-- NEW: countdown ring when player frozen - moved to center of screen -->
                {#if characters[0].frozen}
                    <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                        <svg width="22.5rem" height="22.5rem" viewBox="0 0 360 360" class="filter drop-shadow(0 0 1rem #1090ff)">
                            <!-- Black semi-transparent background -->
                            <circle 
                                cx="180" 
                                cy="180" 
                                r="138" 
                                fill="rgba(0, 0, 0, 0.5)" 
                            />
                            <!-- Background circle -->
                            <circle 
                                cx="180" 
                                cy="180" 
                                r="138" 
                                fill="none" 
                                stroke="#1043a080" 
                                stroke-width="24"
                            />
                            <!-- Progress circle -->
                            <circle 
                                cx="180" 
                                cy="180" 
                                r="138" 
                                fill="none" 
                                stroke="#10a0ff" 
                                stroke-width="24"
                                stroke-linecap="round"
                                stroke-dasharray="{freezeRingCircumference * 3}"
                                stroke-dashoffset="{freezeRingOffset * 3}"
                                transform="rotate(-90 180 180)"
                            />
                            <!-- Freeze icon and turns remaining -->
                            <text x="180" y="160" text-anchor="middle" dominant-baseline="middle" 
                                  fill="white" font-size="72" font-weight="bold" class="filter drop-shadow(0 0 0.5rem #000)">
                                <tspan dy="0">{characters[0].frozen}</tspan>
                            </text>
                            <text x="180" y="240" text-anchor="middle" dominant-baseline="middle" 
                                  fill="white" font-size="48" class="filter drop-shadow(0 0 0.5rem #000)">
                                FROZEN
                            </text>
                        </svg>
                    </div>
                {/if}
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
                                <!-- <img src="TinyQuest/gamedata/dungeon/stairs01.jpg" draggable="false" class="w-full h-full" /> -->
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
                                <img src="TinyQuest/gamedata/dungeon/{character.img}" draggable="false" class="w-full h-full" />
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
                        <div class="w-[4.5rem] h-[4.5rem] m-1 border-4 bg-gray-700 rounded-full overflow-hidden cursor-pointer"
                        style="border-color:{['#d03030', '#4060ff', '#a09020', '#20b040', '#90c0e0'][['e_fire', 'e_water', 'e_wood', 'e_earth', 'e_air'].indexOf(Actor.statsLookup[monsterType]?.element)]}"
                        on:pointerup|preventDefault|stopPropagation={() => showMonsterCollectionPopup(monsterType, false)}>
                            <img draggable="false" class="w-[4.5rem] h-[4.5rem]" src="TinyQuest/gamedata/dungeon/{Actor.statsLookup[monsterType].img}" />
                        </div>
                    {/each}
                </div>
            </div>
            
            <!-- Render single dying character with tweened animation -->
            {#if dyingCharacter}
                <div
                    class="absolute pointer-events-none"
                    style="left:{dyingCharacter.x * 4.4}rem;top:{dyingCharacter.y * 4.4}rem;width:4.4rem;height:4.4rem;opacity:{$deathAnim};transform: scale({dyingCharacter.actorMode > 0 ? 8 - $deathAnim*7 : $deathAnim});"
                >
                    <img src="TinyQuest/gamedata/dungeon/{dyingCharacter.img}" draggable="false" class="w-full h-full" />
                </div>
            {/if}
            
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
                {#if prompt.isMonsterCollection}
                    <div class="relative flex flex-col bg-indigo-900 border-[0.5rem] border-white rounded-2xl p-6 items-center">
                        <div class="w-80 h-80 border-4 bg-gray-700 rounded-full overflow-hidden mb-4"
                            style="border-color:{['#d03030', '#4060ff', '#a09020', '#20b040', '#90c0e0'][['e_fire', 'e_water', 'e_wood', 'e_earth', 'e_air'].indexOf(Actor.statsLookup[prompt.monsterType]?.element)]}">
                            <img draggable="false" class="w-full h-full" src="TinyQuest/gamedata/dungeon/{Actor.statsLookup[prompt.monsterType].img}" />
                        </div>
                        <div class="text-5xl mb-4 text-yellow-200 font-bold">{prompt.msg}</div>
                        <div class="w-full">
                            <div class="relative flex flex-row justify-center text-4xl text-right h-16 my-1">
                                <div class="flex-center-all w-28 border border-gray-400 bg-red-700 rounded-2xl px-3 h-16 mx-1">
                                    {Actor.statsLookup[prompt.monsterType].maxHealth || 0}
                                </div>
                                <div class="flex-center-all w-28 border border-gray-400 bg-blue-800 rounded-2xl px-3 h-16 mx-1">
                                    {Actor.statsLookup[prompt.monsterType].maxMana || 0}
                                </div>
                                <div class="flex-center-all w-min border border-gray-400 bg-black/10 rounded-2xl px-3 h-16 mx-1">
                                    <i class="fa-solid fa-burst"></i>&nbsp;&nbsp;{Actor.statsLookup[prompt.monsterType].attackPower || 0}
                                </div>
                                <div class="flex-center-all w-min border border-gray-400 bg-black/10 rounded-2xl px-3 h-16 mx-1">
                                    <i class="fa-solid fa-arrow-up-right-dots"></i>&nbsp;&nbsp;{Actor.statsLookup[prompt.monsterType].experience || 0}
                                </div>
                            </div>
                        </div>
                        {#if Actor.statsLookup[prompt.monsterType].about}
                            <div class="text-3xl text-yellow-200 font-bold my-8">{Actor.statsLookup[prompt.monsterType].about}</div>
                        {/if}
                        <button
                            class="absolute top-2 right-2"
                            on:pointerup|preventDefault|stopPropagation={prompt.fn}>
                            <i class="fas fa-times bg-gray-300 text-gray-700 rounded-full w-16 h-16 p-9 flex-center-all text-5xl" />
                            <!-- {prompt.btn} -->
                        </button>

                    </div>
                {:else}
                    <div class="flex flex-col bg-blue-800 border-[0.5rem] border-white rounded-2xl p-2">
                        <div class="text-5xl m-2">{prompt.msg}</div>
                        <button
                            class="bg-black/30 border border-gray-300 text-white text-9xl rounded-3xl p-8 m-2 z-20"
                            style="maXXrgin-top:25rem"
                            on:pointerup|preventDefault|stopPropagation={prompt.fn}>{prompt.btn}</button>
                        {#if prompt.btn2}
                            <button
                                class="bg-black/30 border border-gray-500 text-gray-300 text-9xl rounded-3xl p-8 m-2 z-20"
                                style="maXXrgin-top:25rem"
                                on:pointerup|preventDefault|stopPropagation={prompt.fn2}>{prompt.btn2}</button>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}

    {/if}
</FourByThreeScreen>

<style>
</style>
