<script>
    import KeyboardKey from "../../components/KeyboardKey.svelte";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let scale = 1; // For scaling the keyboard
    export let extraKeys = []; // For adding additional functionality
    export let position = { bottom: "1rem", left: "1rem" }; // Default positioning

    // Define the calculator keyboard layout with a more consistent grid
    let keyRows = [
        ["sin", "cos", "sqrt", "^", "backspace"],
        ["7", "8", "9", "/", "abs"],
        ["4", "5", "6", "*", "("],
        ["1", "2", "3", "-", ")"],
        ["0", ".", "x", "+", "="],
    ];
    
    // Optionally replace = with x if variable mode is needed
    if (extraKeys.includes("variable")) {
        const equalsIndex = keyRows[4].indexOf("=");
        if (equalsIndex !== -1) {
            // We already have x in row 3, so we don't need to replace = with x
            // But we can add another variable if needed
        }
        // Add equals to the first row if needed
        if (!keyRows[0].includes("=")) {
            keyRows[0].push("=");
        }
    }
    
    // We don't need these blocks anymore since we've added the keys by default
    // // Add backspace if specified
    // if (extraKeys.includes("backspace")) {
    //     keyRows[0].push("backspace");
    // }
    // 
    // // Add parentheses if specified
    // if (extraKeys.includes("parentheses")) {
    //     // Add parentheses to the first row to keep the grid consistent
    //     keyRows[1].push("(");
    //     keyRows[2].push(")");
    // }

    function pressed(key) {
        dispatch('pressed', {
            key: key.detail.key,
            side: key.detail.side,
            xy: key.detail.xy
        });
    }

    function keyDown(e) {
        if (!e || !e.key) return;
        
        // Don't intercept arrow keys - let them work for cursor movement
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            return;
        }
        
        // Map keyboard input to calculator keys
        let keyToPress = e.key;
        
        // // Handle Enter key as equals
        // if (e.key === "Enter") keyToPress = "=";
        // else return;
        
        // let key = {
        //     detail: {
        //         key: keyToPress,
        //         side: 0,
        //         xy: [0, 0]
        //     }
        // };
        
        // pressed(key);
    }
</script>

<svelte:window on:keydown={keyDown} />

<div class="flex flex-col absolute" 
     style="bottom: {position.bottom}; left: {position.left}; transform: scale({scale}); transform-origin: bottom left;">
    {#each keyRows as keyRow, i}
        <div class="flex flex-row" style="margin-bottom: 0.5rem;">
            {#each keyRow as keyLetter}
                <KeyboardKey 
                    {keyLetter} 
                    width="7.5rem"
                    marginLeft="0.5rem"
                    bgColor="{keyLetter === "="?'bg-blue-700':'bg-gray-700'} "
                    fgColor="text-white"
                    borderColor="bg-gray-600"
                    on:pressed={pressed}
                >
                    {#if keyLetter === "backspace"}
                        <i class="fas fa-arrow-left"></i>
                    {:else if keyLetter === "sqrt"}
                        √
                    {:else if keyLetter === "^"}
                        x<sup>y</sup>
                    {:else if keyLetter === "="}
                        GO
                    {:else}
                        {keyLetter}
                    {/if}
                </KeyboardKey>
            {/each}
        </div>
    {/each}
</div>

<style>
    :global(.calc-key) {
        background-color: #2a4365 !important; /* Dark blue background */
        color: #fff !important;
        border: 0.1rem solid #3a5375 !important; /* Slightly lighter blue border */
        border-radius: 0.8rem !important;
        margin-right: 0.5rem !important;
    }
    
    :global(.calc-key:hover) {
        background-color: #3a5375 !important; /* Lighter blue on hover */
    }
    
    :global(.calc-key:active) {
        background-color: #20c0ff !important; /* Bright blue when active - matching the graph lines */
    }
</style>
