<script>
    import { pop } from "../../router";
    import { handleResize, bigScale } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import { onMount, onDestroy } from "svelte";
    import { fade } from "svelte/transition";
    import { helpSections } from "./helpContent.js";

    handleResize();

    let codeEditor;
    let outputIframe;
    let worker = null;
    let running = false;
    let error = null;
    let executionTimeout = null;
    let showHelp = false;
    const MAX_EXECUTION_TIME = 5000; // 5 seconds max

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
        if (running) return;
        
        running = true;
        error = null;
        
        // Clear output
        if (outputIframe && outputIframe.contentWindow) {
            outputIframe.contentWindow.postMessage({ type: 'clear' }, '*');
        }
        
        // Terminate existing worker if any
        if (worker) {
            worker.terminate();
        }
        
        // Create new worker
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl);
        
        // Set execution timeout
        executionTimeout = setTimeout(() => {
            if (worker) {
                worker.terminate();
                worker = null;
            }
            running = false;
            error = "Code execution timed out! (Maximum 5 seconds)";
            if (outputIframe && outputIframe.contentWindow) {
                outputIframe.contentWindow.postMessage({ 
                    type: 'error', 
                    text: error 
                }, '*');
            }
        }, MAX_EXECUTION_TIME);
        
        // Listen for worker messages
        worker.onmessage = (e) => {
            clearTimeout(executionTimeout);
            running = false;
            
            if (e.data.type === 'success') {
                // Display output
                e.data.output.forEach(item => {
                    if (outputIframe && outputIframe.contentWindow) {
                        outputIframe.contentWindow.postMessage({ 
                            type: 'print', 
                            text: item.data 
                        }, '*');
                    }
                });
                
                // Execute draw commands
                e.data.drawCommands.forEach(cmd => {
                    if (outputIframe && outputIframe.contentWindow) {
                        outputIframe.contentWindow.postMessage({ 
                            type: 'draw', 
                            command: cmd 
                        }, '*');
                    }
                });
            } else if (e.data.type === 'error') {
                error = e.data.error;
                if (outputIframe && outputIframe.contentWindow) {
                    outputIframe.contentWindow.postMessage({ 
                        type: 'error', 
                        text: error 
                    }, '*');
                }
            }
            
            // Clean up
            worker.terminate();
            worker = null;
            URL.revokeObjectURL(workerUrl);
        };
        
        // Execute code
        worker.postMessage({ type: 'execute', code: currentFile.content });
    }

    function selectFile(fileId) {
        // Save current file before switching
        if (currentFile) {
            currentFile.content = codeEditor.value;
        }
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
        const textarea = codeEditor;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        textarea.value = text.substring(0, start) + code + text.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + code.length;
        textarea.focus();
        showHelp = false;
    }
</script>

<FourByThreeScreen>
    <div class="flex h-full bg-gray-900">
        <!-- Left Side - Output (top) and Project (bottom) -->
        <div class="w-1/2 flex flex-col border-r-2 border-gray-700">
            <!-- Output Panel (Upper Left) -->
            <div class="h-1/2 flex flex-col border-b-2 border-gray-700">
                <div class="bg-gray-800 p-3 border-b border-gray-700">
                    <h2 class="text-white text-xl font-bold">Output</h2>
                </div>
                <div class="flex-1 relative">
                    <iframe
                        bind:this={outputIframe}
                        class="w-full h-full"
                        title="Code Output"
                        sandbox="allow-scripts"
                    ></iframe>
                </div>
            </div>

            <!-- Project Panel (Lower Left) -->
            <div class="h-1/2 flex flex-col bg-gray-800">
                <div class="bg-gray-900 p-3 border-b border-gray-700 flex items-center justify-between">
                    <h2 class="text-white text-xl font-bold">Project Files</h2>
                    <button
                        class="bg-blue-600 hover:bg-blue-700 text-white w-8 h-8 rounded flex items-center justify-center transition-colors"
                        on:click={createNewFile}
                        title="New File"
                    >
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto">
                    {#each Object.entries(project.files) as [fileId, file]}
                        <div 
                            class="flex items-center justify-between p-3 hover:bg-gray-700 cursor-pointer transition-colors {currentFileId === fileId ? 'bg-gray-700 border-l-4 border-blue-500' : ''}"
                            on:click={() => selectFile(fileId)}
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
                </div>
                <div class="p-3 border-t border-gray-700">
                    <button
                        class="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded font-bold transition-colors"
                        on:click={runCode}
                        disabled={running}
                    >
                        <i class="fas fa-play"></i>
                        {running ? 'Running...' : 'Run Code'}
                    </button>
                </div>
            </div>
        </div>

        <!-- Code Editor Panel (Right) -->
        <div class="w-1/2 flex flex-col">
            <div class="bg-gray-800 p-3 border-b border-gray-700 flex items-center justify-between">
                <h2 class="text-white text-xl font-bold">{currentFile.name}</h2>
                <button
                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 mr-32 rounded font-bold transition-colors"
                    on:click={() => showHelp = true}
                >
                    <i class="fas fa-question-circle"></i> Help
                </button>
            </div>

            <!-- Code editor -->
            <div class="flex-1 relative">
                <textarea
                    bind:this={codeEditor}
                    bind:value={currentFile.content}
                    class="w-full h-full p-4 bg-gray-800 text-green-400 font-mono text-lg resize-none focus:outline-none"
                    spellcheck="false"
                    style="tab-size: 4;"
                ></textarea>
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
                                        <div class="flex items-start justify-between">
                                            <div class="flex-1">
                                                <h5 class="text-yellow-400 font-bold text-lg mb-1">{example.name}</h5>
                                                <p class="text-gray-300 text-sm mb-2">{example.description}</p>
                                                <pre class="bg-gray-900 rounded p-3 text-green-400 overflow-x-auto"><code>{example.code}</code></pre>
                                            </div>
                                            <button
                                                class="ml-4 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm transition-colors"
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
    
    <CloseButton />
</FourByThreeScreen>

<style>
    textarea {
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    }
    
    pre {
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.9em;
    }
</style> 