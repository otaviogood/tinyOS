<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { fade, scale } from 'svelte/transition';
  
  // Props for graph data and configuration
  export let X_MIN;
  export let X_MAX;
  export let Y_MIN;
  export let Y_MAX;
  export let DOT_RADIUS;
  export let xTicks;
  export let yTicks;
  export let goodDots;
  export let blockerDots;
  export let equationList;
  export let gameInProgress;
  export let polylineSegments = [];
  export let hitPopEffects;
  
  // New props for equation processing
  export let equationInput = "";
  
  // Internal state for animation
  let computedPoints = [];
  let drawnPoints = [];
  let currentX = X_MIN;
  let lastProcessedIndex = 0;
  let animationInterval = null;
  let currentEquationHits = [];
  
  // Create a dispatcher to communicate with the parent component
  const dispatch = createEventDispatcher();
  
  // Function to handle hit pop effect completion
  function handleHitPopComplete(effectId) {
    setTimeout(() => {
      dispatch('removeHitPop', { id: effectId });
    }, 3000);
  }
  
  // Helper: Euclidean distance between two points.
  function distance(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
  }

  // Helper: Euclidean distance squared between two points
  function distanceSq(p1, p2) {
    return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
  }

  // Helper: Minimum distance squared from point to line segment
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
  
  // Submit and process equation
  export function submitEquation() {
    // Reset animation tracking variables
    currentX = X_MIN;
    lastProcessedIndex = 0;
    // Reset current drawing state
    drawnPoints = [];
    computedPoints = [];
    polylineSegments = [];
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
      dispatch('equationError', { message: "Invalid equation!" });
      return false;
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

    // Start animation
    dispatch('animationStart');
    gameInProgress = true;
    animationInterval = setInterval(animateDrawing, 16);
    return true;
  }
  
  // Animation function
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
      dispatch('animationComplete', { 
        hitDotIndices: currentEquationHits,
        polylineSegments
      });
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
            dispatch('blockerHit');
            clearInterval(animationInterval);
            animationInterval = null;
            gameInProgress = false;
            dispatch('animationComplete', { 
              hitDotIndices: currentEquationHits,
              polylineSegments
            });
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
              // Note: we dispatch an event instead of modifying goodDots directly
              dispatch('goodDotHit', { 
                dotIndex: i, 
                dotX: dot.x, 
                dotY: dot.y,
                scoreValue: currentEquationHits.length > 0 
                  ? Math.pow(2, currentEquationHits.length - 1)
                  : 0
              });
            }
          }
        }
      }
      
      previousPoint = point;
    }
  }
  
  // Stop animation if component is destroyed
  onMount(() => {
    return () => {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
    };
  });
</script>

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
          on:introend={() => handleHitPopComplete(effect.id)}
        >
          +{effect.value}
        </text>
      {/each}
    </g>
  </g>
</svg>

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
</style> 