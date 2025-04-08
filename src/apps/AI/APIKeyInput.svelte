<script>
    import { onMount, createEventDispatcher } from 'svelte';

    let apiKeyInput = '';
    let keyExists = false;
    let editMode = false;
    const dispatch = createEventDispatcher();
    const localStorageKey = 'openai_api_key';

    onMount(() => {
        const storedKey = localStorage.getItem(localStorageKey);
        if (storedKey) {
            apiKeyInput = storedKey;
            keyExists = true;
        }
    });

    function saveKey() {
        if (apiKeyInput.trim()) {
            localStorage.setItem(localStorageKey, apiKeyInput.trim());
            keyExists = true;
            editMode = false;
            dispatch('keySaved');
        }
    }

    function continueWithKey() {
        dispatch('keySaved'); // Dispatch same event as saving
    }

    function handleKeyPress(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (keyExists && !editMode) {
                continueWithKey();
            } else {
                saveKey();
            }
        }
    }

    function enableEditMode() {
        editMode = true;
    }

    function clearKey() {
        localStorage.removeItem(localStorageKey);
        apiKeyInput = '';
        keyExists = false;
    }
</script>

<div class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
    <div class="bg-gray-900 p-8 rounded-lg shadow-xl max-w-md w-full text-white border border-gray-700">
        <h2 class="text-3xl font-bold mb-6 text-center text-blue-300">
            {keyExists ? (editMode ? 'Edit OpenAI API Key' : 'OpenAI API Key Found') : 'Enter OpenAI API Key'}
        </h2>

        <p class="mb-4 text-gray-400 text-center text-lg">
            {#if keyExists && !editMode}
                Using the key stored in your browser.
            {:else}
                Please enter your OpenAI API key. It will be stored locally in your browser.
            {/if}
        </p>

        <input
            type="password" 
            bind:value={apiKeyInput}
            on:keypress={handleKeyPress}
            placeholder="Enter your OpenAI API key..."
            class="w-full p-3 mb-6 text-lg bg-gray-800 border-2 border-gray-600 rounded-lg focus:outline-none focus:border-blue-400"
            disabled={keyExists && !editMode}
        />

        {#if keyExists && !editMode}
            <div class="flex space-x-4">
                <button
                    on:click={enableEditMode}
                    class="flex-1 px-6 py-3 text-xl bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-lg transition-colors"
                >
                    Edit Key
                </button>
                <button
                    on:click={continueWithKey}
                    class="flex-1 px-6 py-3 text-xl bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors"
                >
                    Continue
                </button>
            </div>
            <button
                on:click={clearKey}
                class="w-full mt-4 px-6 py-2 text-md bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg transition-colors"
            >
                Clear Key
            </button>
        {:else}
            <button
                on:click={saveKey}
                disabled={!apiKeyInput.trim()}
                class="w-full px-6 py-3 text-xl bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Save and Continue
            </button>
        {/if}
         <p class="mt-4 text-xs text-gray-500 text-center">
             Your key is stored only in your browser's local storage and is not sent anywhere else except directly to OpenAI.
         </p>
    </div>
</div> 