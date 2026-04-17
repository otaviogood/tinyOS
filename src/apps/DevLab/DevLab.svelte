<script>
    import { pop } from "../../router";
    import { handleResize, bigScale } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import CodeMirrorEditor from "../../components/CodeMirrorEditor.svelte";
    import { onMount, onDestroy } from "svelte";
    import { fade } from "svelte/transition";
    import { helpSections } from "./helpContent.js";

    handleResize();

    let codeEditor;
    let outputIframe;
    let worker = null;
    let running = false; // kept for compatibility, not used to toggle UI
    let looping = false;
    let error = null;
    let executionTimeout = null;
    let workerUrlRef = null;
    let showHelp = false;
    let executing = false; // true while a worker is active before loop starts or during one-shot
    const MAX_EXECUTION_TIME = 5000; // 5 seconds max

    // Debugging state
    let debugMode = false;
    let debugging = false;
    let isPaused = false;
    let currentDebugLine = null;
    let breakpoints = new Set();
    let executableLines = new Set();
    let debugVariables = {};
    let debugWorkerCode = '';

    // Automatically enable debug mode when there are breakpoints or an active debug session
    $: debugMode = debugging || (breakpoints && breakpoints.size > 0);

    // Bottom-left panel tabs: 'console' | 'files'
    let activeBottomTab = 'console';

    // Debug/print console state (shown in bottom-left Console tab)
    let consoleLines = [];

    function clearConsole() {
        consoleLines = [];
    }

    function appendConsole(text) {
        consoleLines = [...consoleLines, String(text)];
    }

    // Project structure
    let currentFileId = 'main.js';
    let project = {
        files: {
            'main.js': {
                name: 'main.js',
                content: '' // Will be loaded from defaultProject.js
            }
        }
    };

    // Get current file content
    $: currentFile = project.files[currentFileId] || { content: '' };

    // Worker code will be loaded from workerCode.js
    let workerCode = '';

    // iframe template will be loaded from outputTemplate.html
    let iframeTemplate = '';

    onMount(() => {
        // Load external files async
        async function loadResources() {
            try {
                // Load default project code
                const defaultProjectCode = await import('./defaultProject.js?raw');
                project.files['main.js'].content = defaultProjectCode.default;
                
                // Load worker code
                const workerCodeModule = await import('./workerCode.js?raw');
                workerCode = workerCodeModule.default;
                
                // Load debug worker code
                const debugWorkerModule = await import('./debugWorkerCode.js?raw');
                debugWorkerCode = debugWorkerModule.default;
                
                // Load iframe template
                const templateModule = await import('./outputTemplate.html?raw');
                iframeTemplate = templateModule.default;
                
                // Initialize the output iframe
                setTimeout(() => {
                    if (outputIframe) {
                        outputIframe.srcdoc = iframeTemplate;
                    }
                }, 100);
            } catch (error) {
                console.error('Failed to load DevLab resources:', error);
                // Fallback to minimal setup
                project.files['main.js'].content = '// DevLab failed to load resources\nprint("Hello, DevLab!");';
            }
        }
        
        loadResources();
        
        return () => {
            if (worker) {
                worker.terminate();
            }
        };
    });

    function runCode() {
        if (executing || debugging) return;
        
        executing = true;
        error = null;
        currentDebugLine = null;
        isPaused = false;
        debugVariables = {};
        
        // Clear output
        clearConsole();
        if (outputIframe && outputIframe.contentWindow) {
            outputIframe.contentWindow.postMessage({ type: 'clear' }, '*');
        }
        
        // Terminate existing worker if any
        if (worker) {
            worker.terminate();
        }
        
        // Create new worker with appropriate code
        const code = debugMode ? debugWorkerCode : workerCode;
        const blob = new Blob([code], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        workerUrlRef = workerUrl;
        worker = new Worker(workerUrl);
        
        // Set execution timeout for non-debug mode
        if (!debugMode) {
            executionTimeout = setTimeout(() => {
                if (worker) {
                    worker.terminate();
                    worker = null;
                }
                executing = false;
                error = "Code execution timed out! (Maximum 5 seconds)";
                if (outputIframe && outputIframe.contentWindow) {
                    outputIframe.contentWindow.postMessage({ 
                        type: 'error', 
                        text: error 
                    }, '*');
                }
            }, MAX_EXECUTION_TIME);
        }
        
        // Listen for worker messages
        worker.onmessage = (e) => {
            if (!debugMode) {
                // Normal execution handling
                if (e.data.type !== 'frame' && e.data.type !== 'loop_started') {
                    clearTimeout(executionTimeout);
                }
                
                if (e.data.type === 'loop_started') {
                    // Switch to streaming mode
                    looping = true;
                    executing = false;
                    if (executionTimeout) {
                        clearTimeout(executionTimeout);
                        executionTimeout = null;
                    }
                } else if (e.data.type === 'frame') {
                    // Streaming frame: append any outputs and draw commands
                    if (e.data.output) {
                        e.data.output.forEach(item => {
                            appendConsole(item.data);
                        });
                    }
                    // IMPORTANT: send draw commands as a batch to avoid flicker
                    // (posting clear + subsequent draws as separate messages can allow the browser to paint between them)
                    if (e.data.drawCommands && outputIframe && outputIframe.contentWindow) {
                        outputIframe.contentWindow.postMessage({
                            type: 'draw_batch',
                            commands: e.data.drawCommands
                        }, '*');
                    }
                } else if (e.data.type === 'loop_stopped') {
                    looping = false;
                    executing = false;
                    if (worker) {
                        worker.terminate();
                        worker = null;
                    }
                } else if (e.data.type === 'success') {
                    executing = false;
                    // Display output in bottom-left console
                    e.data.output.forEach(item => {
                        appendConsole(item.data);
                    });
                    
                    // Execute draw commands (batched to avoid flicker)
                    if (e.data.drawCommands && outputIframe && outputIframe.contentWindow) {
                        outputIframe.contentWindow.postMessage({
                            type: 'draw_batch',
                            commands: e.data.drawCommands
                        }, '*');
                    }
                } else if (e.data.type === 'error') {
                    // Log full error data for debugging
                    console.log('DevLab Error Data:', e.data);
                    
                    // Handle multiple errors if available
                    let errorMessage = e.data.error;
                    if (e.data.errors && e.data.errors.length > 1) {
                        // Multiple errors - show count and formatted list
                        errorMessage = `${e.data.errors.length} errors found:\n${errorMessage}`;
                    } else if (e.data.lineNumber) {
                        // Single error with line number (and optional column)
                        if (e.data.columnNumber != null) {
                            errorMessage = `Line ${e.data.lineNumber}, Col ${e.data.columnNumber}: ${errorMessage}`;
                        } else {
                            errorMessage = `Line ${e.data.lineNumber}: ${errorMessage}`;
                        }
                    } else if (e.data.line) {
                        errorMessage = `Line ${e.data.line}: ${errorMessage}`;
                    }
                    
                    error = errorMessage;
                    // Ensure we are not left in running state on errors
                    executing = false;
                    looping = false;
                    appendConsole(`Error: ${error}`);
                }
                
                // Clean up for one-shot runs only
                if (!looping) {
                    if (worker) {
                        worker.terminate();
                        worker = null;
                    }
                    if (workerUrlRef) {
                        URL.revokeObjectURL(workerUrlRef);
                        workerUrlRef = null;
                    }
                }
            } else {
                // Debug mode message handling
                handleDebugMessage(e.data);
            }
        };
        
        // Execute code
        if (!debugMode) {
            // Normal execution - simple format
            worker.postMessage({ 
                type: 'execute', 
                code: currentFile.content
            });
        } else {
            // Debug mode execution
            worker.postMessage({ 
                type: 'execute', 
                data: { 
                    code: currentFile.content,
                    debugMode: true,
                    breakpoints: Array.from(breakpoints)
                }
            });
            
            debugging = true;
            executing = false;
        }
    }

    function handleDebugMessage(data) {
        switch (data.type) {
            case 'debug_info':
                executableLines = new Set(data.executableLines);
                break;
                
            case 'debug_started':
                debugging = true;
                isPaused = false;
                break;
                
            case 'debug_paused':
                isPaused = true;
                currentDebugLine = data.line;
                debugVariables = data.variables || {};
                break;
                
            case 'debug_variables':
                debugVariables = data.variables || {};
                break;
                
            case 'debug_output':
                // Display immediate output during debugging
                if (data.output) {
                    data.output.forEach(item => {
                        appendConsole(item.data);
                    });
                }
                break;
                
            case 'debug_draw':
                // Execute immediate draw commands during debugging
                if (data.commands) {
                    if (outputIframe && outputIframe.contentWindow) {
                        outputIframe.contentWindow.postMessage({
                            type: 'draw_batch',
                            commands: data.commands
                        }, '*');
                    }
                }
                break;
                
            case 'debug_completed':
                debugging = false;
                isPaused = false;
                currentDebugLine = null;
                
                // Note: Output and draw commands have already been sent during debugging
                // This is just for completeness/fallback
                break;
                
            case 'error':
                // Log full error data for debugging
                console.log('DevLab Debug Error Data:', data);
                
                // Handle multiple errors if available
                let errorMessage = data.error;
                if (data.errors && data.errors.length > 1) {
                    // Multiple errors - show count and formatted list
                    errorMessage = `${data.errors.length} errors found:\n${errorMessage}`;
                } else if (data.lineNumber) {
                    // Single error with line number (and optional column)
                    if (data.columnNumber != null) {
                        errorMessage = `Line ${data.lineNumber}, Col ${data.columnNumber}: ${errorMessage}`;
                    } else {
                        errorMessage = `Line ${data.lineNumber}: ${errorMessage}`;
                    }
                } else if (data.line) {
                    errorMessage = `Line ${data.line}: ${errorMessage}`;
                }
                
                error = errorMessage;
                debugging = false;
                isPaused = false;
                appendConsole(`Error: ${error}`);
                break;
                
            case 'breakpoint_toggled':
                if (data.hasBreakpoint) {
                    breakpoints.add(data.line);
                } else {
                    breakpoints.delete(data.line);
                }
                // Force Svelte reactivity by creating new Set
                breakpoints = new Set(breakpoints);
                break;
        }
    }

    function debugStep() {
        if (worker && isPaused) {
            worker.postMessage({ type: 'debug_step' });
        }
    }

    function debugContinue() {
        if (worker && isPaused) {
            worker.postMessage({ type: 'debug_continue' });
        }
    }

    function debugStop() {
        if (worker) {
            worker.postMessage({ type: 'debug_stop' });
            worker.terminate();
            worker = null;
        }
        if (workerUrlRef) {
            URL.revokeObjectURL(workerUrlRef);
            workerUrlRef = null;
        }
        debugging = false;
        isPaused = false;
        currentDebugLine = null;
        debugVariables = {};
    }

    function stopRun() {
        if (worker) {
            try {
                worker.postMessage({ type: 'stop' });
            } catch (e) {}
            worker.terminate();
            worker = null;
        }
        if (workerUrlRef) {
            URL.revokeObjectURL(workerUrlRef);
            workerUrlRef = null;
        }
        looping = false;
        executing = false;
        if (executionTimeout) {
            clearTimeout(executionTimeout);
            executionTimeout = null;
        }
    }

    function handleRunShortcut() {
        if (executing || looping) {
            stopRun();
        } else if (!debugging) {
            runCode();
        }
    }

    function toggleBreakpoint(lineNum) {
        if (worker && debugging) {
            worker.postMessage({ 
                type: 'debug_toggle_breakpoint',
                data: { line: lineNum }
            });
        } else {
            // Toggle locally for display
            if (breakpoints.has(lineNum)) {
                breakpoints.delete(lineNum);
            } else {
                breakpoints.add(lineNum);
            }
            // Force Svelte reactivity by creating new Set
            breakpoints = new Set(breakpoints);
        }
    }

    function selectFile(fileId) {
        // No need to save current file content - it's already synced
        currentFileId = fileId;
    }

    function createNewFile() {
        const name = prompt("Enter file name:");
        if (name && !project.files[name]) {
            project.files[name] = {
                name: name,
                content: `// New file: ${name}\n\n`
            };
            currentFileId = name;
        }
    }

    function deleteFile(fileId) {
        if (fileId === 'main.js') {
            alert("Cannot delete main.js");
            return;
        }
        if (confirm(`Delete ${fileId}?`)) {
            delete project.files[fileId];
            if (currentFileId === fileId) {
                currentFileId = 'main.js';
            }
        }
    }

    function insertCode(code) {
        if (codeEditor) {
            codeEditor.insertText(code);
        }
        showHelp = false;
    }


</script>

<FourByThreeScreen>
    <div class="flex h-full bg-gray-900">
        <!-- Left Side - Output (top) and Project (bottom) -->
        <div class="w-1/2 flex flex-col border-r-2 border-gray-700">
            <!-- Output Panel (Upper Left) -->
            <div class="h-1/2 flex flex-col border-b-2 border-gray-700">
                <div class="flex-1 relative">
                    <iframe
                        bind:this={outputIframe}
                        class="w-full h-full"
                        title="Code Output"
                        sandbox="allow-scripts"
                    ></iframe>
                </div>
            </div>

            <!-- Project/Console Panel (Lower Left) -->
            <div class="h-1/2 flex flex-col bg-gray-800">
                <!-- Tabs header -->
                <div class="bg-gray-900 px-3 pt-3 border-b border-gray-700">
                    <div class="flex items-center gap-2">
                        <button
                            class="px-3 py-1 rounded-t text-sm font-bold transition-colors {activeBottomTab === 'console' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}"
                            on:click={() => activeBottomTab = 'console'}
                            aria-selected={activeBottomTab === 'console'}
                            role="tab"
                        >
                            <i class="fas fa-terminal mr-1"></i> Console
                        </button>
                        <button
                            class="px-3 py-1 rounded-t text-sm font-bold transition-colors {activeBottomTab === 'files' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}"
                            on:click={() => activeBottomTab = 'files'}
                            aria-selected={activeBottomTab === 'files'}
                            role="tab"
                        >
                            <i class="fas fa-folder mr-1"></i> Files
                        </button>
                        {#if activeBottomTab === 'files'}
                            <button
                                class="ml-auto bg-blue-600 hover:bg-blue-700 text-white w-8 h-8 rounded flex items-center justify-center transition-colors"
                                on:click={createNewFile}
                                title="New File"
                            >
                                <i class="fas fa-plus"></i>
                            </button>
                        {/if}
                    </div>
                </div>

                <!-- Tab content area -->
                <div class="flex-1 overflow-y-auto">
                    {#if activeBottomTab === 'console'}
                        <div class="p-3">
                            <div class="bg-black/60 border border-gray-700 rounded p-3 font-mono text-sm text-gray-200 whitespace-pre-wrap min-h-[8rem]">
                                {#if consoleLines.length === 0}
                                    <div class="text-gray-500">No output yet. Use print() to log messages.</div>
                                {/if}
                                {#each consoleLines as line, i}
                                    <div>{line}</div>
                                {/each}
                            </div>
                            <div class="mt-2 flex gap-2">
                                <button
                                    class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
                                    on:click={clearConsole}
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    {:else}
                        {#each Object.entries(project.files) as [fileId, file]}
                            <div 
                                class="flex items-center justify-between p-3 hover:bg-gray-700 cursor-pointer transition-colors {currentFileId === fileId ? 'bg-gray-700 border-l-4 border-blue-500' : ''}"
                                on:click={() => selectFile(fileId)}
                                role="button"
                                tabindex="0"
                                on:keydown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        selectFile(fileId);
                                    }
                                }}
                            >
                                <div class="flex items-center gap-2 text-white">
                                    <i class="fas fa-file-code text-yellow-400"></i>
                                    <span class="text-sm">{file.name}</span>
                                </div>
                                {#if fileId !== 'main.js'}
                                    <button
                                        class="text-red-400 hover:text-red-300 opacity-0 hover:opacity-100 transition-opacity"
                                        on:click|stopPropagation={() => deleteFile(fileId)}
                                    >
                                        <i class="fas fa-trash text-xs"></i>
                                    </button>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                </div>
                
                <!-- Debug Controls -->
                <div class="p-3 border-t border-gray-700 space-y-2">
                    <div class="flex items-center justify-between">
                        {#if debugging}
                            <span class="text-xs text-yellow-400">
                                {isPaused ? 'Paused' : 'Running'}
                            </span>
                        {/if}
                    </div>
                    
                    {#if debugging}
                        <div class="flex gap-2">
                            <button
                                class="flex-1 bg-green-600 hover:bg-green-700 text-white py-1 px-2 rounded text-sm font-bold transition-colors disabled:opacity-50"
                                on:click={debugStep}
                                disabled={!isPaused}
                                title="Step"
                            >
                                <i class="fas fa-step-forward"></i>
                            </button>
                            <button
                                class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1 px-2 rounded text-sm font-bold transition-colors disabled:opacity-50"
                                on:click={debugContinue}
                                disabled={!isPaused}
                                title="Continue"
                            >
                                <i class="fas fa-play"></i>
                            </button>
                            <button
                                class="flex-1 bg-red-600 hover:bg-red-700 text-white py-1 px-2 rounded text-sm font-bold transition-colors"
                                on:click={debugStop}
                                title="Stop"
                            >
                                <i class="fas fa-stop"></i>
                            </button>
                        </div>
                    {/if}
                    
                    
                </div>
                
                <!-- Variables Panel (during debug) -->
                {#if debugging && Object.keys(debugVariables).length > 0}
                    <div class="p-3 border-t border-gray-700 bg-gray-900">
                        <h3 class="text-white text-sm font-bold mb-2">Variables</h3>
                        <div class="text-xs font-mono space-y-1 max-h-24 overflow-y-auto">
                            {#each Object.entries(debugVariables) as [name, value]}
                                <div class="text-gray-300">
                                    <span class="text-yellow-400">{name}:</span>
                                    <span class="text-green-400">{JSON.stringify(value)}</span>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Code Editor Panel (Right) -->
        <div class="w-1/2 flex flex-col">
            <div class="bg-gray-800 p-3 border-b border-gray-700 flex items-center justify-between">
                <h2 class="text-white text-xl font-bold">{currentFile.name}</h2>
                <div class="flex items-center gap-2 mr-32">
                    <button
                        class="{looping ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'} text-white px-4 py-2 rounded font-bold transition-colors disabled:opacity-50"
                        on:click={looping ? stopRun : runCode}
                        disabled={debugging || (executing && !looping)}
                        title={looping ? 'Stop' : (debugMode ? 'Start Debugging' : 'Run Code')}
                    >
                        {#if looping}
                            <i class="fas fa-stop"></i>
                            Stop
                        {:else}
                            <i class="fas fa-play"></i>
                            {debugMode ? 'Start Debugging' : 'Run Code'}
                        {/if}
                    </button>
                    <button
                        class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold transition-colors"
                        on:click={() => showHelp = true}
                    >
                        <i class="fas fa-question-circle"></i> Help
                    </button>
                </div>
            </div>

            <!-- Code editor with line numbers -->
            <div class="flex-1 flex overflow-hidden">
                <CodeMirrorEditor
                    bind:this={codeEditor}
                    bind:value={currentFile.content}
                    {breakpoints}
                    {executableLines}
                    {currentDebugLine}
                    {debugVariables}
                    enableAutocomplete={false}
                    readonly={executing || looping || debugging}
                    on:breakpoint-toggle={(event) => toggleBreakpoint(event.detail.line)}
                    on:change={(event) => currentFile.content = event.detail.value}
                    on:run={handleRunShortcut}
                />
            </div>

            {#if error}
                <div class="bg-red-900 text-red-200 p-4 border-t border-red-700">
                    <i class="fas fa-exclamation-triangle"></i> {error}
                </div>
            {/if}
        </div>
    </div>

    <!-- Help Modal -->
    {#if showHelp}
        <div class="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40 p-8" transition:fade>
            <div class="bg-gray-800 rounded-lg shadow-2xl max-w-4xl max-h-full overflow-hidden flex flex-col">
                <div class="bg-gray-900 p-6 rounded-t-lg flex items-center justify-between">
                    <h3 class="text-white text-3xl font-bold">Help & Examples</h3>
                    <button
                        class="text-gray-400 hover:text-white text-4xl"
                        on:click={() => showHelp = false}
                    >
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto p-6 space-y-6">
                    {#each helpSections as section}
                        <div>
                            <h4 class="text-white text-2xl font-bold mb-4">{section.title}</h4>
                            <div class="space-y-3">
                                {#each section.examples as example}
                                    <div class="bg-gray-700 rounded-lg p-4">
                                        <div class="flex items-start justify-between gap-4">
                                            <div class="flex-1 min-w-0">
                                                <h5 class="text-yellow-400 font-bold text-lg mb-1">{example.name}</h5>
                                                <p class="text-gray-300 text-sm mb-2">{example.description}</p>
                                                <div class="bg-gray-900 rounded p-3 overflow-x-auto text-lg">
                                                    <pre class="text-green-400 help-code-block whitespace-pre"><code>{example.code}</code></pre>
                                                </div>
                                            </div>
                                            <button
                                                class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm transition-colors flex-shrink-0"
                                                on:click={() => insertCode(example.code)}
                                            >
                                                Insert
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
    
    <CloseButton scale={0.8} confirm />
</FourByThreeScreen>

<style>
    pre {
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.9em;
    }
    
    /* Enable text selection in help screen code blocks */
    .help-code-block {
        user-select: text;
        -webkit-user-select: text;
        -moz-user-select: text;
        -ms-user-select: text;
    }
    

</style> 