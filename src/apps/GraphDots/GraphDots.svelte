<script>
    import { onMount } from "svelte";
    import { 
        bigScale, 
        pxToRem, 
        remToPx,
        handleResize 
    } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import { Howl } from "howler";
    import { fade, slide, scale } from 'svelte/transition';
    import RandomFast from "../../random-fast";
    import CalcKeyboard from "./CalcKeyboard.svelte";
    import GraphDotsGraph from "./GraphDotsGraph.svelte";
    import { getDailyDateInfo, getDailySeed } from "../../daily-seed.js";
    import { getOS } from "../../utils";

    // Set up daily date (for seeding, score display, etc.)
    const { dailyDate, displayDate } = getDailyDateInfo();

    // Seed functions are now imported from daily-seed.js

    let randomFast; // seeded RNG

    // Define graph coordinate boundaries.
    // (We use a math‐style coordinate system from –10 to 10 in both directions.)
    const X_MIN = -10;
    const X_MAX = 10;
    const Y_MIN = -10;
    const Y_MAX = 10;
  
    // Dot settings
    const GOOD_DOT_COUNT = 20;
    const BLOCKER_DOT_COUNT = 10;
    const DOT_DIAMETER = 0.5;
    const DOT_RADIUS = DOT_DIAMETER / 2; // 0.25
  
    // Game state variables
    let equationInput = "";
    let gameInProgress = false;
    let goodHitCount = 0;
    let score = 0;
    let errorMessage = "";
    let polylineSegments = [];
  
    // Our arrays of dots (each dot has an x, y position and for good dots a flag if hit)
    let goodDots = [];
    let blockerDots = [];
  
    // Sound effects (reusing your TinyQuest sfx files)
    const snd_good = new Howl({
      src: ["/TinyQuest/sfx/sfx_coin_double1.wav"],
      volume: 0.25
    });
    const snd_blocker = new Howl({
      src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"],
      volume: 0.25
    });
  
    // Create arrays for tick positions (one per integer from X_MIN/Y_MIN to X_MAX/Y_MAX)
    let xTicks = [];
    for (let i = Math.ceil(X_MIN); i <= X_MAX; i++) {
      xTicks.push(i);
    }
    let yTicks = [];
    for (let i = Math.ceil(Y_MIN); i <= Y_MAX; i++) {
      yTicks.push(i);
    }
  
    // === NEW: Variables for multiple equation submission ===
    let equationList = [];
    let editingEquationId = null;
    let nextEquationId = 1;
  
    // Sort equations (here simply by ID) and compute the aggregate score.
    $: sortedEquations = [...equationList].sort((a, b) => a.id - b.id);
    $: totalScore = equationList.reduce((sum, eq) => sum + eq.score, 0);
  
    // Add this new variable to track hits during current equation's animation
    let currentEquationHits = [];
  
    // Add this new variable to track pop-up animations
    let hitPopEffects = [];
  
    // Add this variable at the top of your script section
    let inputElement;
    let graphComponent;
  
    // Add these variables to track cursor position
    let cursorPosition = 0;
    let selectionStart = 0;
    let selectionEnd = 0;
  
    // Reset (or start a new round) the game.
    function resetGame() {
      // Initialize the seeded RNG using the imported getDailySeed function
      randomFast = new RandomFast(getDailySeed());
  
      // Compute the valid integer range for dot placement (ensuring the full dot remains inside the viewBox).
      const minX = Math.ceil(X_MIN + DOT_RADIUS);
      const maxX = Math.floor(X_MAX - DOT_RADIUS);
      const minY = Math.ceil(Y_MIN + DOT_RADIUS);
      const maxY = Math.floor(Y_MAX - DOT_RADIUS);
  
      // Helper: returns a random integer between min and max using our seeded RNG.
      function getRandomInt(min, max) {
        const rand = randomFast ? randomFast.RandFloat() : Math.random();
        return Math.floor(rand * (max - min + 1)) + min;
      }
  
      // Create a set to track occupied grid positions.
      const occupiedPositions = new Set();
  
      // Generate GOOD dots at random integer positions, ensuring no dot overlaps.
      goodDots = [];
      while (goodDots.length < GOOD_DOT_COUNT) {
        const x = getRandomInt(minX, maxX);
        const y = getRandomInt(minY, maxY);
        const posKey = `${x},${y}`;
        if (!occupiedPositions.has(posKey)) {
          occupiedPositions.add(posKey);
          goodDots.push({ x, y, hit: false });
        }
      }
  
      // Generate BLOCKER dots at random integer positions, ensuring no dot overlaps.
      blockerDots = [];
      while (blockerDots.length < BLOCKER_DOT_COUNT) {
        const x = getRandomInt(minX, maxX);
        const y = getRandomInt(minY, maxY);
        const posKey = `${x},${y}`;
        if (!occupiedPositions.has(posKey)) {
          occupiedPositions.add(posKey);
          blockerDots.push({ x, y });
        }
      }
  
      // Reset game states
      gameInProgress = false;
      goodHitCount = 0;
      score = 0;
      equationInput = "";
      errorMessage = "";
      polylineSegments = [];
  
      // Clear our equation submissions as well.
      equationList = [];
      editingEquationId = null;
      hitPopEffects = [];
    }
  
    // Called when the user clicks the "Submit" button or hits Enter.
    function submitEquation() {
      if (gameInProgress) return; // ignore if an animation is already running
      errorMessage = "";
      goodHitCount = 0;
      
      // Use the GraphDotsGraph component to process and animate the equation
      gameInProgress = graphComponent.submitEquation();
    }
  
    // Called when an animation finishes, store (or update) the equation
    function finishEquation(hitDotIndices, segments) {
      // New scoring: 2^(n-1) for n>0 hits, 0 for n=0 hits
      const entry = {
        id: editingEquationId ? editingEquationId : nextEquationId++,
        equation: equationInput,
        polylineSegments: segments.map(segment => [...segment]),
        score: goodHitCount,
        goodHitCount,
        hitDotIndices
      };
      
      if (editingEquationId) {
        equationList = equationList.map(e => e.id === editingEquationId ? entry : e);
      } else {
        equationList = [...equationList, entry];
      }
      editingEquationId = null;
      updateDotIntersections();
    }
  
    // Add this helper function to calculate score based on new hits
    function calculateScore(hitIndices, previousEquations) {
      // Count how many dots this equation was first to hit
      const newHits = hitIndices.filter(index => 
        !previousEquations.some(eq => eq.hitDotIndices.includes(index))
      ).length;
      
      // Use the correct scoring formula: 2^n - 1 where n is new hits
      return newHits > 0 ? Math.pow(2, newHits) - 1 : 0;
    }
  
    // Modify updateDotIntersections to also update scores
    function updateDotIntersections() {
      // Reset all dots to not hit
      goodDots = goodDots.map(dot => ({ ...dot, hit: false }));
      
      // Create a map to store how many equations hit each dot
      const intersectionCounts = new Map();
      
      // Count intersections for each dot from all equations
      equationList.forEach(eq => {
        eq.hitDotIndices.forEach(dotIndex => {
          const count = intersectionCounts.get(dotIndex) || 0;
          intersectionCounts.set(dotIndex, count + 1);
        });
      });
      
      // Mark dots as hit if they have any intersections
      goodDots = goodDots.map((dot, index) => ({
        ...dot,
        hit: intersectionCounts.get(index) > 0
      }));

      // Recalculate scores for all equations
      equationList = equationList.map((eq, index) => ({
        ...eq,
        score: calculateScore(
          eq.hitDotIndices,
          equationList.slice(0, index) // only consider previous equations
        )
      }));
    }
  
    // === Allow deletion from the list (like WordHex's removeWord) ===
    function removeEquation(equationId) {
      equationList = equationList.filter(e => e.id !== equationId);
      updateDotIntersections();
    }
  
    // Handle events from the graph component
    function handleEquationError(event) {
      errorMessage = event.detail.message;
      snd_blocker.play(undefined, undefined);
    }
    
    function handleGoodDotHit(event) {
      const { dotIndex, dotX, dotY, scoreValue } = event.detail;
      goodHitCount++;
      snd_good.play(undefined, undefined);
      
      // Mark the dot as hit
      goodDots = [
        ...goodDots.slice(0, dotIndex),
        { ...goodDots[dotIndex], hit: true },
        ...goodDots.slice(dotIndex + 1)
      ];
      
      // Add hit pop effect
      hitPopEffects = [
        ...hitPopEffects, 
        { 
          id: Date.now() + Math.random(),
          x: dotX, 
          y: -dotY,
          value: scoreValue
        }
      ];
    }
    
    function handleBlockerHit() {
      snd_blocker.play(undefined, undefined);
    }
    
    function handleAnimationComplete(event) {
      gameInProgress = false;
      finishEquation(event.detail.hitDotIndices, event.detail.polylineSegments);
    }
  
    // Modify handleKeyDown to prevent duplicate input
    function handleKeyDown(event) {
      // Prevent default browser handling for these keys
      if (["ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete"].includes(event.key)) {
        event.preventDefault();
      }
      
      if (event.key === "Enter") {
        event.preventDefault();
        submitEquation();
      } else if (event.key === "ArrowLeft") {
        cursorPosition = Math.max(0, cursorPosition - 1);
      } else if (event.key === "ArrowRight") {
        cursorPosition = Math.min(equationInput.length, cursorPosition + 1);
      } else if (event.key === "Home") {
        cursorPosition = 0;
      } else if (event.key === "End") {
        cursorPosition = equationInput.length;
      } else if (event.key === "Backspace") {
        // if (cursorPosition > 0) {
        //   equationInput = 
        //     equationInput.substring(0, cursorPosition - 1) + 
        //     equationInput.substring(cursorPosition);
        //   cursorPosition--;
        // }
      } else if (event.key === "Delete") {
        if (cursorPosition < equationInput.length) {
          equationInput = 
            equationInput.substring(0, cursorPosition) + 
            equationInput.substring(cursorPosition + 1);
        }
      } 
      // Remove handling of regular key input in handleKeyDown
      // We'll let the binding handle that instead
    }
  
    // Add this function near the top of your script section
    function focusInput(node) {
      // Never focus inputs on iOS to prevent keyboard popup
      const os = getOS();
      if (os !== "iOS") {
        node.focus();
      }
      return {
        update() {
          if (os !== "iOS") {
            node.focus();
          }
        }
      };
    }

    function handleCalculatorInput(event) {
      // Get the key that was pressed from the event
      const key = event.detail.key;
      
      if (key === "Enter" || key === "=") {
        submitEquation();
      } else if (key === "Clear") {
        equationInput = "";
        cursorPosition = 0;
      } else if (key === "Delete" || key === "backspace") {
        if (cursorPosition > 0) {
          equationInput = 
            equationInput.substring(0, cursorPosition - 1) + 
            equationInput.substring(cursorPosition);
          cursorPosition--;
        }
      } else {
        // Map special keys to their mathematical representations
        const keyMap = {
          "÷": "/",
          "×": "*",
          "π": "PI",
          "√": "sqrt",
          "^2": "**2",
          "^": "**",
          "sin": "sin",
          "cos": "cos",
          "tan": "tan",
          "log": "log10",
          "ln": "log",
          "(": "(",
          ")": ")",
        };
        
        // Add the key to the input at cursor position (using the mapped value if available)
        const insertText = keyMap[key] || key;
        equationInput = 
          equationInput.substring(0, cursorPosition) + 
          insertText + 
          equationInput.substring(cursorPosition);
        cursorPosition += insertText.length;
      }
    }

    // Update the handleInputClick function to account for monospaced font
    function handleInputClick(event) {
      // Get input container dimensions
      const inputRect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - inputRect.left;

      // Convert Tailwind's p-2 (0.5rem) to pixels using the remToPx utility
      const paddingLeft = remToPx(0.0);

      // Get character width (for monospaced font)
      const charWidth = remToPx(1.25); // Approximate width for monospaced font (adjust as needed)

      // Calculate cursor position based on click position, accounting for padding
      let approxPos = Math.floor((clickX - paddingLeft) / charWidth);

      // Ensure cursor position is within bounds
      cursorPosition = Math.max(0, Math.min(approxPos, equationInput.length));

      focusInput(inputElement);
    }

    onMount(() => {
      resetGame();
    });

    handleResize();
  </script>

  <FourByThreeScreen bg="#181818">
    <div class="fit-full-space relative">

      <!-- Updated SVG container with fixed size and centered positioning -->
      <div class="absolute inset-0 flex m-4">
        <GraphDotsGraph
          {X_MIN}
          {X_MAX}
          {Y_MIN}
          {Y_MAX}
          {DOT_RADIUS}
          {xTicks}
          {yTicks}
          {goodDots}
          {blockerDots}
          {equationList}
          {gameInProgress}
          {polylineSegments}
          {hitPopEffects}
          {equationInput}
          bind:this={graphComponent}
          on:removeHitPop={e => {
            const id = e.detail.id;
            hitPopEffects = hitPopEffects.filter(effect => effect.id !== id);
          }}
          on:equationError={handleEquationError}
          on:goodDotHit={handleGoodDotHit}
          on:blockerHit={handleBlockerHit}
          on:animationComplete={handleAnimationComplete}
        />
      </div>


      <!-- Display aggregate score and daily date -->
      <div class="absolute left-[66rem] top-0 p-4">
        <div class="text-white text-5xl mb-4 p-3 border-[.5rem] bg-blue-950 border-gray-600 rounded-3xl w-max">
          Score: {totalScore}
        </div>
        <div class="text-white text-3xl">
          {displayDate}
        </div>
      </div>
  
      <!-- Equations List (styled similar to WordHex found words) -->
      <div class="absolute right-0 top-[10rem] w-[35rem] p-4 h-[30rem] overflow-y-auto overscroll-contain touch-pan-y">
        {#each sortedEquations as eq (eq.id)}
          <div
            class="flex items-center text-2xl overflow-hidden bg-gray-700 rounded-3xl rounded-br-lg rounded-tr-lg p-1 m-1 cursor-pointer"
            in:fade|local={{ duration: 800 }}
            out:slide|local={{ duration: 300 }}
          >
            <button
              on:click={(e) => {
                e.preventDefault();  // Prevent default button behavior
                e.stopPropagation();  // Stop event propagation
                removeEquation(eq.id);
              }}
              class="ml-0 text-white hover:text-red-400 bg-[#a43] rounded-full px-2"
            >
              <i class="fas fa-times"></i>
            </button>
            <div class="flex justify-end w-[4rem]">
              <span class="text-red-300">{eq.score}</span>
            </div>
            <div class="ml-6 flex items-center">
              <span>y = {eq.equation}</span>
            </div>
          </div>
        {/each}
      </div>

      <!-- Equation input area at the bottom center.
           The label "y =" is shown and the player only enters the remainder. -->
      <div class="absolute w-[60rem] bottom-8 left-[32rem] transform -translate-x-1/2 flex items-center bg-gray-800 p-4 rounded-xl">
        <span class="text-white text-3xl mr-2">y =</span>
        <pre 
          class="flex-1 text-3xl h-[3.75rem] p-2 rounded-md border border-gray-600 bg-gray-700 text-white overflow-hidden font-mono"
          on:click={handleInputClick}
          on:pointerdown={handleInputClick}
        >{equationInput.substring(0, cursorPosition)}<span class="cursor"></span>{equationInput.substring(cursorPosition)}</pre>
        <button
          on:click={submitEquation}
          class="ml-2 text-white text-3xl p-3 px-8 bg-blue-600 rounded-md hover:bg-blue-700"
        >
          GO
        </button>
      </div>
  
      <CalcKeyboard 
        scale={0.8} 
        position={{ bottom: "2rem", left: "66rem" }}
        on:pressed={handleCalculatorInput} 
      />

      <!-- Display an error message if the equation fails to parse -->
      {#if errorMessage}
        <div class="absolute bottom-28 left-[32rem] transform -translate-x-1/2 text-red-500 text-3xl">
          {errorMessage}
        </div>
      {/if}
  
      <!-- A Restart button is provided at the top right -->
      <!-- <div class="absolute top-4 right-24">
        <button
          on:click={resetGame}
          class="text-white bg-red-600 p-2 rounded-md hover:bg-red-700"
        >
          Restart
        </button>
      </div> -->
  
      <CloseButton />
    </div>
  </FourByThreeScreen>
  
  <style>
    :global(.hit-animation) {
        animation: hitPop 275ms ease;
    }

    @keyframes hitPop {
        50% {
            transform: scale(1.95);
        }
        100% {
            transform: scale(1);
        }
    }

    .cursor {
      display: inline-block;
      width: 2px;
      height: 1.2em;
      background-color: white;
      vertical-align: middle;
      margin: 0 -1px;
      animation: blink 1s step-end infinite;
    }
    
    @keyframes blink {
      50% { opacity: 0; }
    }

    /* Add these styles to prevent text selection */
    :global(.no-select) {
        -webkit-touch-callout: none; /* iOS Safari */
        -webkit-user-select: none;   /* Safari */
        -khtml-user-select: none;    /* Konqueror HTML */
        -moz-user-select: none;      /* Firefox */
        -ms-user-select: none;       /* Internet Explorer/Edge */
        user-select: none;           /* Non-prefixed version, currently supported by Chrome and Opera */
    }
</style>

  <!-- Update the hidden input -->
  <input
    type="text"
    value={equationInput}
    on:keydown={handleKeyDown}
    on:input={(e) => {
      // Only handle direct typing from keyboard
      if (e.inputType === "insertText") {
        const char = e.data;
        equationInput = 
          equationInput.substring(0, cursorPosition) + 
          char + 
          equationInput.substring(cursorPosition);
        cursorPosition++;
      }
    }}
    use:focusInput
    bind:this={inputElement}
    class="absolute opacity-0 pointer-events-none"
    readonly
  />