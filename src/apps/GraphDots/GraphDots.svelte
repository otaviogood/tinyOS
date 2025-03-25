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
    let computedPoints = []; // All points computed from the equation
    let drawnPoints = []; // Points that have been drawn so far (animated)
    let animationInterval = null;
    let gameInProgress = false;
    let goodHitCount = 0;
    let score = 0;
    let errorMessage = "";
  
    // Add these variables for constant speed animation
    let currentX = X_MIN;
    let lastProcessedIndex = 0;
  
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
  
    // Add this new variable to store polyline segments
    let polylineSegments = [];
  
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
  
      // Reset drawing and game states
      drawnPoints = [];
      computedPoints = [];
      currentX = X_MIN;
      lastProcessedIndex = 0;
      gameInProgress = false;
      goodHitCount = 0;
      score = 0;
      equationInput = "";
      errorMessage = "";
  
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
      // Clear our equation submissions as well.
      equationList = [];
      editingEquationId = null;
    }
  
    // Helper: Euclidean distance between two points.
    function distance(p1, p2) {
      return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    }
  
    // Helper: Euclidean distance squared between two points
    function distanceSq(p1, p2) {
      return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
    }
  
    // New helper: Minimum distance squared from point to line segment
    function distanceToSegmentSq(a, b, p) {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const apx = p.x - a.x;
      const apy = p.y - a.y;
      const dot = apx * abx + apy * aby;
      const lenSq = abx * abx + aby * aby;
      let t = 0;
      
      if (lenSq !== 0) {
        t = Math.max(0, Math.min(1, dot / lenSq));
      }
      
      const closestX = a.x + t * abx;
      const closestY = a.y + t * aby;
      const dx = p.x - closestX;
      const dy = p.y - closestY;
      return dx * dx + dy * dy;
    }
  
    // Called when the user clicks the "Submit" button or hits Enter.
    function submitEquation() {
      if (gameInProgress) return; // ignore if an animation is already running
  
      // Reset animation tracking variables
      currentX = X_MIN;
      lastProcessedIndex = 0;
      // Reset current drawing state (but NOT the previously submitted equations)
      drawnPoints = [];
      computedPoints = [];
      polylineSegments = [];
      goodHitCount = 0;
      errorMessage = "";
      currentEquationHits = [];  // Reset hits for new equation
  
      // Parse and compile the player's equation.
      let f;
      try {
        // The player types just the math expression.
        // We prepend "with(Math) { return ... }" so that common functions (sin, cos, etc.) work.
        f = new Function("x", "with (Math) { return " + equationInput + " }");
        // Test the function with a sample value
        const testVal = f(0.1234567);
        if (isNaN(testVal)) throw new Error("Function returned NaN");
      } catch (e) {
        errorMessage = "Invalid equation!";
        snd_blocker.play();
        return;
      }
  
      // Compute a list of points along the curve.
      const step = (X_MAX - X_MIN) / 6000;
      let lastValidY = null;
      let clipDirection = null; // 'top', 'bottom', or null
      for (let x = X_MIN; x <= X_MAX; x += step) {
        let y;
        try {
          y = f(x);
        } catch (err) {
          y = null;
        }
  
        // Handle clipping at boundaries
        if (y !== null) {
          // Track if we're coming from out-of-bounds
          const wasClipped = clipDirection !== null;
          
          if (y > Y_MAX) {
            if (clipDirection === 'top') {
              y = null; // Already clipped top, continue null
            } else {
              y = Y_MAX; // First top out-of-bounds - clip to edge
              clipDirection = 'top';
            }
          } else if (y < Y_MIN) {
            if (clipDirection === 'bottom') {
              y = null; // Already clipped bottom, continue null
            } else {
              y = Y_MIN; // First bottom out-of-bounds - clip to edge
              clipDirection = 'bottom';
            }
          } else {
            // Coming back in bounds from clip
            if (wasClipped) {
              // Insert boundary point before valid point
              const boundaryY = clipDirection === 'top' ? Y_MAX : Y_MIN;
              computedPoints.push({ x, y: boundaryY });
            }
            clipDirection = null;
          }
        }
  
        // New: Boundary intersection detection between samples
        if (lastValidY !== null && y !== null) {
          const prev = computedPoints[computedPoints.length - 1];
          
          // Check for boundary crossings between previous and current point
          const crossings = [];
          if ((prev.y > Y_MAX && y < Y_MAX) || (prev.y < Y_MAX && y > Y_MAX)) {
            const t = (Y_MAX - prev.y) / (y - prev.y);
            const crossX = prev.x + t * (x - prev.x);
            crossings.push({ x: crossX, y: Y_MAX });
          }
          if ((prev.y > Y_MIN && y < Y_MIN) || (prev.y < Y_MIN && y > Y_MIN)) {
            const t = (Y_MIN - prev.y) / (y - prev.y);
            const crossX = prev.x + t * (x - prev.x);
            crossings.push({ x: crossX, y: Y_MIN });
          }
  
          // Add boundary crossings in X order
          crossings.sort((a, b) => a.x - b.x);
          for (const cross of crossings) {
            computedPoints.push(cross);
          }
        }
  
        if (isNaN(y) || !isFinite(y) || (y === null)) {
          y = null;
          clipDirection = null;
          if (computedPoints.length > 0 && computedPoints[computedPoints.length - 1].y !== null) {
            computedPoints.push({ x, y }); // Break line with null
          }
          lastValidY = null;
          continue;
        }
  
        const currentPoint = { x, y };
        if (
          computedPoints.length === 0 ||
          computedPoints[computedPoints.length - 1].y === null ||
          distance(computedPoints[computedPoints.length - 1], currentPoint) > .05
        ) {
          computedPoints.push(currentPoint);
          lastValidY = y;
        }
      }
  
      // Always add the final point to ensure the curve reaches the end
      const finalX = X_MAX;
      try {
        const finalY = f(finalX);
        if (!isNaN(finalY) && isFinite(finalY)) {
          computedPoints.push({ x: finalX, y: finalY });
        }
      } catch (err) {}
  
      gameInProgress = true;
      // Begin drawing the curve gradually (changed from 4ms to 16ms for smoother animation)
      animationInterval = setInterval(animateDrawing, 16);
    }
  
    // Modified animateDrawing function with segment-based collision
    function animateDrawing() {
      const SPEED = 0.2;
      currentX += SPEED;
      
      // Find all points that fall within the new X range
      const newPoints = [];
      while (lastProcessedIndex < computedPoints.length && 
             computedPoints[lastProcessedIndex].x <= currentX) {
        newPoints.push(computedPoints[lastProcessedIndex]);
        lastProcessedIndex++;
      }

      // If we passed the end of the graph
      if (currentX >= X_MAX || lastProcessedIndex >= computedPoints.length) {
        clearInterval(animationInterval);
        animationInterval = null;
        gameInProgress = false;
        finishEquation();
        return;
      }

      // Process all new points in this frame
      let previousPoint = drawnPoints.length > 0 ? drawnPoints[drawnPoints.length - 1] : null;
      for (const point of newPoints) {
        drawnPoints = [...drawnPoints, point];
        
        // Update polyline segments
        if (point.y === null) {
          // Do nothing - wait for next valid point
        } else {
          // If we have no segments or the previous point was null,
          // start a new segment
          if (polylineSegments.length === 0 || 
              drawnPoints[drawnPoints.length - 2]?.y === null) {
            polylineSegments = [...polylineSegments, [point]];
          } else {
            // Add to the current segment
            const lastSegment = polylineSegments[polylineSegments.length - 1];
            const currentSegment = [...lastSegment, point];
            polylineSegments = [...polylineSegments.slice(0, -1), currentSegment];
          }
        }

        if (previousPoint && previousPoint.y !== null && point.y !== null) {
          // Check blocker dots using line segment
          for (const blocker of blockerDots) {
            if (distanceToSegmentSq(previousPoint, point, blocker) <= DOT_RADIUS * DOT_RADIUS) {
              snd_blocker.play();
              clearInterval(animationInterval);
              animationInterval = null;
              gameInProgress = false;
              finishEquation();
              return;
            }
          }

          // Check good dots using line segment
          for (let i = 0; i < goodDots.length; i++) {
            const dot = goodDots[i];
            if (distanceToSegmentSq(previousPoint, point, dot) <= DOT_RADIUS * DOT_RADIUS) {
              if (!currentEquationHits.includes(i)) {
                currentEquationHits.push(i);
              }
              
              if (!dot.hit) {
                goodDots = [
                  ...goodDots.slice(0, i),
                  { ...dot, hit: true },
                  ...goodDots.slice(i + 1)
                ];
                goodHitCount++;
                snd_good.play();
                
                const scoreValue = currentEquationHits.length > 0 
                  ? Math.pow(2, currentEquationHits.length - 1)
                  : 0;

                hitPopEffects = [
                  ...hitPopEffects, 
                  { 
                    id: Date.now() + Math.random(),
                    x: dot.x, 
                    y: -dot.y,
                    value: scoreValue
                  }
                ];
              }
            }
          }
        }
        
        previousPoint = point;
      }
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
  
    // Called when an animation finishes, store (or update) the equation
    function finishEquation() {
      // New scoring: 2^(n-1) for n>0 hits, 0 for n=0 hits
      const eqScore = goodHitCount;
      
      const entry = {
        id: editingEquationId ? editingEquationId : nextEquationId++,
        equation: equationInput,
        polylineSegments: polylineSegments.map(segment => [...segment]),
        score: eqScore,
        goodHitCount,
        hitDotIndices: currentEquationHits  // Store all hits for this equation
      };
      
      if (editingEquationId) {
        equationList = equationList.map(e => e.id === editingEquationId ? entry : e);
      } else {
        equationList = [...equationList, entry];
      }
      editingEquationId = null;
      updateDotIntersections();
    }
  
    // === Allow deletion from the list (like WordHex's removeWord) ===
    function removeEquation(equationId) {
      equationList = equationList.filter(e => e.id !== equationId);
      updateDotIntersections();
      if (inputElement) inputElement.focus();
    }
  
    // Submit if Enter is pressed.
    function handleKeyDown(event) {
      if (event.key === "Enter") {
        submitEquation();
      }
    }
  
    // Add this function near the top of your script section
    function focusInput(node) {
      node.focus();
      return {
        update() {
          node.focus();
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
      } else if (key === "Delete" || key === "backspace") {
        equationInput = equationInput.slice(0, -1);
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
        
        // Add the key to the input (using the mapped value if available)
        equationInput += keyMap[key] || key;
      }
      
      // Only focus the input on non-iOS devices to prevent iPad keyboard
      const os = getOS();
      if (inputElement && os !== "iOS") {
        inputElement.focus();
      }
    }
  
    onMount(() => {
      resetGame();
    });

    handleResize();
  </script>
  
  <FourByThreeScreen bg="#181818">
    <div class="fit-full-space relative no-select">

      <!-- Updated SVG container with fixed size and centered positioning -->
      <div class="absolute inset-0 flex m-4">
        <svg 
          class="w-[64rem] h-[64rem]" 
          viewBox="-10 -10 20 20"
        >
          <g transform="scale(1,-1)">
            <!-- Grid Lines -->
            <g id="grid-lines">
              {#each xTicks as x}
                <line x1="{x}" y1="{Y_MIN}" x2="{x}" y2="{Y_MAX}" stroke="gray" stroke-width="0.05" opacity="0.1" />
              {/each}
              {#each yTicks as y}
                <line x1="{X_MIN}" y1="{y}" x2="{X_MAX}" y2="{y}" stroke="gray" stroke-width="0.05" opacity="0.1" />
              {/each}
            </g>
  
            <!-- Tick Marks -->
            <g id="x-ticks">
              {#each xTicks as x}
                <line x1="{x}" y1="-0.2" x2="{x}" y2="0.2" stroke="#333" stroke-width="0.1" />
              {/each}
            </g>
            <g id="y-ticks">
              {#each yTicks as y}
                <line x1="-0.2" y1="{y}" x2="0.2" y2="{y}" stroke="#333" stroke-width="0.1" />
              {/each}
            </g>
  
            <!-- Axis Lines -->
            <line x1="{X_MIN}" y1="0" x2="{X_MAX}" y2="0" stroke="#444" stroke-width="0.1" />
            <line x1="0" y1="{Y_MIN}" x2="0" y2="{Y_MAX}" stroke="#444" stroke-width="0.1" />
  
            <!-- X-axis labels -->
            {#each xTicks as x}
              {#if x !== 0} <!-- Skip 0 to avoid cluttering the origin -->
                <text
                  x="{x}"
                  y=".5"
                  text-anchor="middle"
                  fill="#888"
                  font-size="0.3"
                  transform="scale(1,-1)"
                >
                  {x}
                </text>
              {/if}
            {/each}

            <!-- Y-axis labels -->
            {#each yTicks as y}
              {#if y !== 0} <!-- Skip 0 to avoid cluttering the origin -->
                <text
                  x="-.5"
                  y="{-y}"
                  text-anchor="end"
                  alignment-baseline="middle"
                  fill="#888"
                  font-size="0.3"
                  transform="scale(1,-1)"
                >
                  {y}
                </text>
              {/if}
            {/each}

            <!-- Draw good dots; if hit, display in gold -->
            {#each goodDots as dot}
              {#if dot.hit}
                <circle 
                  cx="{dot.x}" 
                  cy="{dot.y}" 
                  r="{DOT_RADIUS}" 
                  fill="#FFD700"
                  class="hit-animation"
                  transform-origin="{dot.x} {dot.y}"
                />
              {:else}
                <circle 
                  cx="{dot.x}" 
                  cy="{dot.y}" 
                  r="{DOT_RADIUS}" 
                  fill="#20b010" 
                />
              {/if}
            {/each}
  
            <!-- Draw blocker dots in red -->
            {#each blockerDots as dot}
              <circle cx="{dot.x}" cy="{dot.y}" r="{DOT_RADIUS}" fill="#d03020" />
            {/each}
  
            <!-- Render stored curves from submitted equations -->
            {#each equationList as eq (eq.id)}
              {#each eq.polylineSegments as segment}
                {#if segment.length > 0}
                  <polyline
                    points={segment.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#20c0ff"
                    stroke-width="0.05"
                  />
                {/if}
              {/each}
            {/each}
  
            <!-- Render current animated curve (if any) -->
            {#if gameInProgress && polylineSegments.length > 0}
              {#each polylineSegments as segment}
                {#if segment.length > 0}
                  <polyline
                    points={segment.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#20c0ff"
                    stroke-width="0.05"
                  />
                {/if}
              {/each}
            {/if}

            <!-- Add this new group for score pop-ups -->
            <g id="score-popups">
                {#each hitPopEffects as effect (effect.id)}
                    <text
                        x={effect.x}
                        y={effect.y + 0.95}
                        text-anchor="middle"
                        fill="#ffb010"
                        font-size="0.95"
                        transform="scale(1,-1)"
                        in:scale={{ start: 0.5, duration: 600 }}
                        out:fade={{ duration: 600 }}
                        on:introend={() => {
                            setTimeout(() => {
                                hitPopEffects = hitPopEffects.filter(e => e.id !== effect.id);
                            }, 3000);
                        }}
                    >
                        +{effect.value}
                    </text>
                {/each}
            </g>
          </g>
        </svg>
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
        <input
          type="text"
          bind:value={equationInput}
          on:keydown={handleKeyDown}
          use:focusInput
          bind:this={inputElement}
          class="flex-1 text-3xl p-2 rounded-md border border-gray-600 bg-gray-700 text-white"
          placeholder="Enter equation"
        />
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