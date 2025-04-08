<script>
    import { onMount, onDestroy } from "svelte";
    import { 
        bigScale, 
        pxToRem, 
        remToPx,
        handleResize 
    } from "../../screen";
    import FourByThreeScreen from "../../components/FourByThreeScreen.svelte";
    import CloseButton from "../../components/CloseButton.svelte";
    import OpenAI from "openai"; // Import OpenAI library
    import APIKeyInput from "./APIKeyInput.svelte"; // Added import
    import { age } from "../../stores"; // Import the age store
    import { tick } from 'svelte'; // Import tick for scrolling

    let userQuestion = "";
    let messages = []; // Array to store chat messages { role: 'user' | 'assistant' | 'error', content: string }
    let isLoading = false;
    let error = null;
    let chatContainer; // To control scrolling
    let understanding = []; // Array to track understanding from LLM
    let editingMessageIndex = -1; // Add this to track which message is being edited
    
    // Camera feature state
    let showCamera = false;
    let capturedPhoto = null;
    let video;
    let canvas;
    let stream;
    let facingMode = "environment"; // default to rear facing camera (user, environment)
    
    // Make instructionPrompt reactive to the age store
    $: instructionPrompt = `You are a wonder-sparking guide for a ${$age}-year-old explorer. Connect every concept to something tangible they can see, touch, or experience in their daily life. Use phrases like "Have you ever noticed..." or "Next time you're outside, look for..." to encourage real-world discovery.

    Share one surprising fact that challenges their assumptions. Ask open-ended questions that start with "What would happen if..." or "I wonder why..." to invite experimentation.

    Keep explanations vivid but brief (2-3 sentences maximum). For STEM topics, relate abstract concepts to physical objects or familiar experiences before explaining mechanisms.

    Always end with a concrete, doable challenge or observation task that extends learning beyond the conversation.
    
    Respond in JSON format with 'explanation' containing your answer and 'understanding' tracking their knowledge level.`;

    $: instructionPromptB = `You are a helpful and friendly AI assistant talking to a ${$age}-year-old kid. Keep your explanations simple, engaging, and appropriate for their age. Make it short. Just 2 or 3 sentences. Be encouraging and ask follow-up questions to keep the conversation going. If they ask STEM-related questions, try to explain concepts from first principles. If you can easily integrate a question to understand their level of understanding, do so.

Try to map out their level of understanding and knowledge. Any thing they say that indicates understanding, you should make note of it. Output all notes in the JSON array under the 'understanding' key.

Respond in JSON format with keys 'explanation' containing your answer and 'understanding' containing an array of observations about the user's level of understanding.`;

    let openai = null; // Initialize as null
    let apiKeyReady = false; // Added state for API key readiness
    const localStorageKey = 'openai_api_key';

    function initializeOpenAI() {
        const storedKey = localStorage.getItem(localStorageKey);
        if (storedKey) {
             // Instantiate OpenAI client only when key is available
            openai = new OpenAI({
                apiKey: storedKey, // Use key from local storage
                dangerouslyAllowBrowser: true // Necessary for client-side usage
            });
            apiKeyReady = true;
            // Start with a greeting?
            if (messages.length === 0) {
                 messages = [{ role: 'assistant', content: `Do you have any questions about how the world works?` }];
            }
        } else {
            apiKeyReady = false;
            messages = []; // Clear messages if no key
        }
    }

    // Function to scroll chat to the bottom
    async function scrollToBottom() {
        await tick(); // Wait for DOM updates
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    onMount(() => {
        initializeOpenAI(); // Check for key on mount
        handleResize(); // Call handleResize on mount
        window.addEventListener('resize', handleResize);
    });

    onDestroy(() => {
        window.removeEventListener('resize', handleResize);
        stopCamera(); // Make sure to stop the camera when component is destroyed
    });

    function handleKeySaved() {
        initializeOpenAI(); // Re-initialize OpenAI when key is saved/confirmed
    }

    // --- Updated OpenAI API call with Chat History ---
    async function callOpenAI(chatMessages) { // Expects an array of message objects
        if (!openai) {
            console.error("OpenAI client not initialized. API key might be missing.");
            throw new Error("API key not configured.");
        }
        console.log("Calling OpenAI API with messages:", chatMessages);

        // Get the latest message to check if it has a photo
        const latestMessage = chatMessages[chatMessages.length - 1];
        const hasPhoto = latestMessage.photo !== undefined;

        try {
            let response;
            
            if (hasPhoto) {
                // Use the chat completions API with vision capabilities
                // Format all messages for the API
                const apiMessages = chatMessages.map(msg => {
                    // For user messages with photos
                    if (msg.role === 'user' && msg.photo) {
                        const content = [];
                        
                        // Add text if present
                        if (msg.content.trim()) {
                            content.push({
                                type: "text",
                                text: msg.content
                            });
                        }
                        
                        // Add the image
                        content.push({
                            type: "image_url",
                            image_url: {
                                url: msg.photo
                            }
                        });
                        
                        return {
                            role: "user",
                            content: content
                        };
                    } 
                    // For text-only messages (user or assistant)
                    else {
                        return {
                            role: msg.role,
                            content: msg.content
                        };
                    }
                });
                
                // Add system message at the beginning
                apiMessages.unshift({
                    role: "system",
                    content: instructionPrompt
                });
                
                console.log("Sending vision request with messages:", apiMessages);
                
                response = await openai.chat.completions.create({
                    model: "gpt-4o", // Use vision-capable model
                    messages: apiMessages,
                    response_format: { type: "json_object" }
                });
                
                console.log("Vision API Response:", response);
                
                // Process the response
                if (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
                    try {
                        const jsonResponse = JSON.parse(response.choices[0].message.content);
                        if (jsonResponse && jsonResponse.explanation) {
                            // Check for understanding data and update our tracking
                            if (jsonResponse.understanding && Array.isArray(jsonResponse.understanding)) {
                                // Add new understanding items to our tracking array
                                const newUnderstanding = jsonResponse.understanding;
                                understanding = [...understanding, ...newUnderstanding];
                                console.log("Understanding updated:", newUnderstanding);
                                console.log("Current understanding:", understanding);
                            }
                            return jsonResponse.explanation;
                        } else {
                            // If no explanation key found, just return the whole content
                            return response.choices[0].message.content;
                        }
                    } catch (parseError) {
                        // If not valid JSON, just return the raw content
                        console.warn("Received non-JSON response from vision API");
                        return response.choices[0].message.content;
                    }
                } else {
                    throw new Error("Unexpected vision API response structure");
                }
            } else {
                // Use the regular chat completions API for text-only messages
                const apiMessages = [
                    { role: "system", content: instructionPrompt },
                    ...chatMessages.map(msg => ({ role: msg.role, content: msg.content }))
                ];
                
                response = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: apiMessages,
                    response_format: { type: "json_object" }
                });
                
                console.log("Chat API Response:", response);
                
                if (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
                    const jsonResponse = JSON.parse(response.choices[0].message.content);
                    if (jsonResponse && jsonResponse.explanation) {
                        // Check for understanding data and update our tracking
                        if (jsonResponse.understanding && Array.isArray(jsonResponse.understanding)) {
                            // Add new understanding items to our tracking array
                            const newUnderstanding = jsonResponse.understanding;
                            understanding = [...understanding, ...newUnderstanding];
                            console.log("Understanding updated:", newUnderstanding);
                            console.log("Current understanding:", understanding);
                        }
                        return jsonResponse.explanation;
                    } else {
                        // Attempt to handle non-JSON string response gracefully if possible
                        if (typeof response.choices[0].message.content === 'string') {
                            console.warn("Received non-JSON response, attempting to parse explanation differently.");
                            // Basic extraction if it's just a string unexpectedly
                            const potentialExplanation = response.choices[0].message.content.match(/"explanation"\s*:\s*"([^"]*)"/);
                            if (potentialExplanation && potentialExplanation[1]) {
                                return potentialExplanation[1];
                            }
                        }
                        throw new Error("Invalid JSON response format received from API.");
                    }
                } else {
                    throw new Error("Unexpected API response structure.");
                }
            }
        } catch (err) {
            console.error("OpenAI API Error:", err);
            if (err.response) {
                console.error("API Error Status:", err.response.status);
                console.error("API Error Data:", err.response.data);
                throw new Error(`API Error: ${err.response.status} - ${err.message}`);
            } else {
                throw new Error(err.message || "Failed to call OpenAI API.");
            }
        }
    }
    // --- End OpenAI API call ---

    async function askAI() {
        if ((!userQuestion.trim() && !capturedPhoto) || isLoading || !apiKeyReady) return;

        let messageContent = userQuestion.trim();
        let messageType = 'text';
        
        // Check if we have a photo to include
        if (capturedPhoto) {
            messageType = 'photo';
            if (messageContent) {
                messageType = 'photo+text';
            }
        }

        // Check if we're editing an existing message
        if (editingMessageIndex >= 0) {
            // Update the message at editingMessageIndex
            const updatedMessage = { 
                ...messages[editingMessageIndex], 
                content: messageContent,
                photo: capturedPhoto,
                type: messageType
            };
            
            // Keep only messages up to the edited message
            messages = [
                ...messages.slice(0, editingMessageIndex),
                updatedMessage
            ];
            
            // Reset editing state
            editingMessageIndex = -1;
        } else {
            // Add a new message
            const newUserMessage = { 
                role: 'user', 
                content: messageContent,
                photo: capturedPhoto,
                type: messageType
            };
            messages = [...messages, newUserMessage];
        }

        // Clear input field and photo
        userQuestion = "";
        capturedPhoto = null;
        isLoading = true;
        error = null;
        scrollToBottom();

        // Prepare message history for API call (excluding potential 'error' roles)
        const historyForApi = messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');

        try {
            const responseContent = await callOpenAI(historyForApi);
            messages = [...messages, { role: 'assistant', content: responseContent }];
        } catch (err) {
            console.error("Error calling AI:", err);
            error = err.message || "An unexpected error occurred.";
            // Add error message to chat
            messages = [...messages, { role: 'error', content: `Sorry, I encountered an error: ${error}` }];
        } finally {
            isLoading = false;
            scrollToBottom();
        }
    }

    function handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            askAI();
        }
    }

    function editMessage(index) {
        // Only allow editing user messages
        if (messages[index] && messages[index].role === 'user') {
            userQuestion = messages[index].content;
            capturedPhoto = messages[index].photo;
            editingMessageIndex = index;
            // Focus the textarea
            const textarea = document.querySelector('textarea');
            if (textarea) {
                textarea.focus();
            }
        }
    }

    function cancelEdit() {
        editingMessageIndex = -1;
        userQuestion = "";
        capturedPhoto = null;
    }

    function newConversation() {
        messages = [{ role: 'assistant', content: `Do you have any questions about how the world works?` }];
        userQuestion = "";
        error = null;
        isLoading = false;
        editingMessageIndex = -1;
        capturedPhoto = null;
        understanding = []; // Reset understanding when starting new conversation
        console.log("Understanding reset for new conversation");
        scrollToBottom();
    }

    // Camera functions
    function openCamera() {
        showCamera = true;
        startCamera();
    }

    function closeCamera() {
        showCamera = false;
        stopCamera();
    }

    function startCamera() {
        if (!showCamera) return;
        
        navigator.mediaDevices
            .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode }, audio: false })
            .then((s) => {
                stream = s;
                video.srcObject = stream;
                video.play();
            })
            .catch((err) => {
                console.error("Unable to access camera:", err);
                showCamera = false;
            });
    }

    function stopCamera() {
        if (video) video.srcObject = null;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
    }

    function takePhoto() {
        if (!video || !canvas) return;
        
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw the current video frame to the canvas
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to data URL
        capturedPhoto = canvas.toDataURL('image/jpeg');
        
        // Close camera after taking photo
        closeCamera();
    }

    function toggleFacing() {
        facingMode = facingMode === "user" ? "environment" : "user";
        stopCamera();
        startCamera();
    }

    function removePhoto() {
        capturedPhoto = null;
    }

    handleResize();
</script>

{#if !apiKeyReady}
    <APIKeyInput on:keySaved={handleKeySaved} />
{:else}
    <FourByThreeScreen bg="black">
        <div class="fit-full-space relative p-4 flex flex-col text-white h-full">

            <!-- Header with New Conversation Button -->
            <div class="flex justify-between items-center mb-3 px-2">
                 <button
                    on:click={newConversation}
                    class="px-2 py-2 text-5xl w-16 h-16 flex-center-all bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                >
                    +
                </button>
                 <span class="text-4xl text-gray-400 text-center w-full">Here we are again.<span class="pl-10 text-sm">(Age {$age})</span></span>
            </div>

            <!-- Camera Overlay -->
            {#if showCamera}
                <div class="absolute inset-0 z-20 bg-black flex flex-col">
                    <!-- svelte-ignore a11y-media-has-caption -->
                    <video bind:this={video} class="flex-grow object-contain" autoplay playsinline></video>
                    <canvas bind:this={canvas} class="hidden"></canvas>
                    
                    <div class="flex justify-around items-center p-4 bg-gray-900">
                        <button 
                            on:click={closeCamera}
                            class="text-5xl text-red-500 w-16 h-16 flex items-center justify-center"
                        >
                            <i class="fas fa-times-circle"></i>
                        </button>
                        
                        <button 
                            on:click={takePhoto}
                            class="rounded-full bg-white w-20 h-20 border-4 border-gray-400"
                        ></button>
                        
                        <button 
                            on:click={toggleFacing}
                            class="text-5xl text-blue-500 w-16 h-16 flex items-center justify-center"
                        >
                            <i class="fas fa-camera-rotate"></i>
                        </button>
                    </div>
                </div>
            {/if}

            <!-- Chat Messages Area -->
            <div bind:this={chatContainer} class="flex-grow bg-gray-800 border border-gray-600 rounded-lg p-4 overflow-y-auto mb-4 text-2xl space-y-4">
                 {#each messages as message, index (message.content + message.role + Math.random())} <!-- Improve key later if needed -->
                    <div class="flex" class:justify-end={message.role === 'user'} class:justify-start={message.role !== 'user'}>
                         {#if message.role === 'user'}
                             <div 
                                class="bg-blue-600 rounded-lg p-3 max-w-[75%] hover:bg-blue-500 cursor-pointer transition-colors"
                                on:click={() => editMessage(index)}
                                class:being-edited={editingMessageIndex === index}
                             >
                                {#if message.photo}
                                    <img 
                                        src={message.photo} 
                                        alt="User photo" 
                                        class="max-w-full rounded mb-2 max-h-96 object-contain"
                                    />
                                {/if}
                                <p>{message.content}</p>
                                {#if editingMessageIndex === index}
                                    <div class="text-sm text-gray-200 mt-1 italic">Editing this message...</div>
                                {/if}
                            </div>
                         {:else if message.role === 'assistant'}
                            <div class="bg-gray-600 rounded-lg p-3 max-w-[75%]">
                                 <p>{message.content}</p>
                            </div>
                         {:else if message.role === 'error'}
                             <div class="bg-red-700 rounded-lg p-3 max-w-[75%]">
                                <p class="text-red-200">{message.content}</p>
                             </div>
                        {/if}
                    </div>
                 {/each}
                 {#if isLoading}
                    <div class="flex justify-start">
                        <div class="bg-gray-600 rounded-lg p-3 max-w-[75%]">
                            <p class="text-gray-400 italic">AI is thinking...</p>
                         </div>
                    </div>
                 {/if}
            </div>

            <!-- Input Area -->
             <div class="flex flex-col">
                {#if editingMessageIndex >= 0}
                    <div class="text-amber-400 mb-2 flex items-center">
                        <span>Editing previous message. Messages after this point will be removed.</span>
                        <button 
                            on:click={cancelEdit} 
                            class="ml-2 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white"
                        >
                            Cancel
                        </button>
                    </div>
                {/if}
                
                <!-- Photo Preview Area -->
                {#if capturedPhoto}
                    <div class="relative mb-2 flex justify-center">
                        <img 
                            src={capturedPhoto} 
                            alt="Captured photo" 
                            class="h-24 object-contain rounded border border-gray-600"
                        />
                        <button 
                            on:click={removePhoto}
                            class="absolute -top-2 -right-2 bg-red-600 rounded-full w-8 h-8 flex items-center justify-center text-white"
                        >
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                {/if}
                
                <div class="flex items-end space-x-3">
                    <textarea
                        bind:value={userQuestion}
                        on:keypress={handleKeyPress}
                        disabled={isLoading}
                        placeholder={editingMessageIndex >= 0 ? "Edit your message..." : "Type your message..."}
                        class="flex-grow p-3 text-2xl bg-blue-950 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-400 disabled:opacity-50 resize-none min-h-[3rem] max-h-[10rem]"
                         rows="1"
                         on:input={(e) => {
                            // Auto-resize textarea
                            // Safely access textarea properties
                            const textarea = e.currentTarget;
                            if (textarea instanceof HTMLTextAreaElement) {
                                textarea.rows = 1; // Reset rows
                                const newRows = Math.ceil((textarea.scrollHeight - 24) / 30); // Adjust based on padding/line-height
                                textarea.rows = Math.min(newRows, 5); // Limit max rows
                            }
                         }}
                     ></textarea>
                     
                     <!-- Photo Button -->
                     <button
                        on:click={openCamera}
                        disabled={isLoading}
                        class="px-6 py-3 text-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors self-end"
                     >
                        <i class="fas fa-camera"></i>
                    </button>
                     
                     <button
                        on:click={askAI}
                        disabled={isLoading || (!userQuestion.trim() && !capturedPhoto)}
                        class="px-6 py-3 text-2xl bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors self-end"
                     >
                         {editingMessageIndex >= 0 ? 'Update' : 'Send'}
                    </button>
                </div>
            </div>

            <CloseButton />
        </div>
    </FourByThreeScreen>
{/if}

<style>
    /* Styles for textarea sizing and chat bubbles */
     textarea {
        line-height: 1.5; /* Adjust as needed */
        /* Ensure padding is accounted for in scrollHeight calculations if needed */
         padding: 0.75rem; /* 12px */
    }
    /* Minor adjustments if needed */
    .flex-grow {
        min-height: 0; /* Prevent flex items from overflowing */
    }
    
    .being-edited {
        border: 2px solid #ffd700;
        background-color: #1e40af !important;
    }
</style>
