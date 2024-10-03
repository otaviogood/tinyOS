<script>
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import {
        invAspectRatio,
        fullWidth,
        fullHeight,
        landscape,
        bigWidth,
        bigHeight,
        bigScale,
        bigPadX,
        bigPadY,
        handleResize,
    } from "../screen";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";
    import Line from "../components/Line.svelte";
    import CloseButton from "../components/CloseButton.svelte";
    import { cubicInOut } from 'svelte/easing';

    let elem;
    let mapElem;
    let map;
    let userMarkerElem; // Add a variable for the user marker element

    let showOverlay = false;
    let currentLat = 0;
    let currentLon = 0;
    let currentZoom = 0;
    let bearing = 0;
    let pitch = 0; // Add this line to store the pitch value

    let userLat = null;
    let userLon = null;
    let locationError = null;
    let userMarker; // Add a variable for the user marker

    function loadMapLibre() {
        return new Promise((resolve, reject) => {
            if (window.maplibregl) {
                resolve();
                return;
            }

            const scriptSrc = "https://unpkg.com/maplibre-gl/dist/maplibre-gl.js";
            const cssSrc = "https://unpkg.com/maplibre-gl/dist/maplibre-gl.css";

            const script = document.createElement("script");
            script.src = scriptSrc;
            script.onload = () => {
                const link = document.createElement("link");
                link.href = cssSrc;
                link.rel = "stylesheet";
                link.onload = resolve;
                link.onerror = reject;
                document.head.appendChild(link);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function getUserLocation() {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLat = position.coords.latitude;
                    userLon = position.coords.longitude;
                    if (map) {
                        map.flyTo({
                            center: [userLon, userLat],
                            zoom: 15,
                            essential: true // this animation is considered essential with respect to prefers-reduced-motion
                        });

                        // Add or update the user marker
                        if (!userMarker) {
                            userMarker = new maplibregl.Marker({
                                element: userMarkerElem,
                            })
                                .setLngLat([userLon, userLat])
                                .addTo(map);
                        } else {
                            userMarker.setLngLat([userLon, userLat]);
                        }
                    }
                    locationError = null; // Clear any previous error
                },
                (error) => {
                    console.error("Error getting user location:", error);
                    locationError = error.message;
                }
            );
        } else {
            locationError = "Geolocation is not supported by this device.";
        }
    }

    onMount(async () => {
        try {
            await loadMapLibre();
            initializeMap();
            getUserLocation(); // Request user location when the component mounts
        } catch (error) {
            console.error("Failed to load MapLibre:", error);
            // Here you might want to show an error message to the user
        }

        return () => {
            if (map) map.remove();
        };
    });

    function initializeMap() {
        try {
            map = new maplibregl.Map({
                container: mapElem,
                style: "https://tiles.openfreemap.org/styles/liberty",
                center: [userLon ?? -122.16948119194505, userLat ?? 37.42985352686819], // Use user location if available
                zoom: 17,
            });

            // Remove or comment out this marker if not needed
            // let marker = new maplibregl.Marker({
            //     color: "#FFFFFF",
            //     draggable: true,
            // })
            //     .setLngLat([-122.1694, 37.4298])
            //     .addTo(map);

            map.on("error", function (e) {
                console.error("Map error:", e.error);
            });

            // // Touch event listeners
            // map.on('touchstart', showOverlayAndUpdate);
            map.on('touchmove', updateOverlayInfo);
            // map.on('touchend', hideOverlay);

            // // Mouse event listeners
            // map.on('mouseenter', showOverlayAndUpdate);
            map.on('mousemove', updateOverlayInfo);
            // map.on('mouseleave', hideOverlay);

            // Update on any move (including zoom)
            map.on("move", updateOverlayInfo);

            map.on("rotate", () => {
                bearing = map.getBearing();
                pitch = map.getPitch(); // Add this line to update pitch
            });

            // Initialize the bearing and pitch
            bearing = map.getBearing();
            pitch = map.getPitch(); // Add this line

            function updateOverlayInfo() {
                showOverlay = true;
                const center = map.getCenter();
                currentLat = center.lat.toFixed(6);
                currentLon = center.lng.toFixed(6);
                currentZoom = map.getZoom().toFixed(2);
            pitch = map.getPitch(); // Add this line
            }
        } catch (error) {
            console.error("Failed to initialize map:", error);
            // Consider setting an error state variable here to show an error message in the UI
        }
    }

    function resetNorth() {
        if (map) {
            map.easeTo({
                bearing: 0,
                duration: 1000,
                easing: cubicInOut,
                essential: true // This makes the animation respect the 'prefers-reduced-motion' setting
            });
        }
    }

    handleResize();
</script>

<FourByThreeScreen bg="black">
    <div class="flex-center-all flex-col h-full w-full" bind:this={elem}>
        <div bind:this={mapElem} class="w-full h-full" />
        <!-- Make a small rectangle overlaid in bottom right corner to prevent click on map button in bottom right. -->
        <div class="absolute bottom-0 right-0 w-[440px] h-[48px] bg-gray-600/5 z-10" />

        <!-- Add the lat/lon overlay -->
        {#if showOverlay}
            <div class="coordinate-overlay">
                <div class="coordinate-label lat">Lat: {currentLat}</div>
                <div class="coordinate-label lon">Lon: {currentLon}</div>
            </div>
        {/if}

            <!-- Add a button to request user location -->
            <button
                class="absolute top-4 left-4 bg-[#5AB4E7] text-white p-6 text-5xl rounded-full active:scale-110 transform transition-all duration-75"
                style="border: 0.4rem solid #0E4D64;"
                on:click={getUserLocation}
            >
                <i class="fa-solid fa-person-rays" />
            </button>

            <!-- Display location error if any -->
            {#if locationError}
                <div class="absolute top-16 right-20 bg-red-500 text-white p-2 rounded">
                    {locationError}
                </div>
            {:else}
                <!-- User marker element -->
                <div bind:this={userMarkerElem} class="custom-marker">
                    <i class="fa-solid fa-child-reaching" />
                    <div class="user-marker-shadow" />
                </div>
            {/if}

        <!-- Compass (North Arrow) -->
        <div class="compass absolute right-24 bottom-24 active:scale-110 transform transition-all duration-75" on:pointerup={resetNorth}>
            <div class="compass-container absolute bottom-16 right-16" style="transform: rotateX({pitch*.7}deg) rotate({-bearing}deg)">
                <svg class="compass" width="20rem" height="20rem" viewBox="0 0 1024 1024">
                    <!-- Outer Circle -->
                    <circle cx="512" cy="512" r="300" fill="#5AB4E740" stroke="#5AB4E7" stroke-width="2rem" />

                    <!-- Triangles with dark-cyan borders -->
                    <polygon points="512,112 612,452 412,452 512,112" fill="#FF7232" stroke="#0E4D64" stroke-width="1.5rem" />
                    <polygon points="512,912 612,572 412,572 512,912" fill="#FF7232" stroke="#0E4D64" stroke-width="1.5rem" />
                    <polygon points="912,512 572,612 572,412 912,512" fill="#FF7232" stroke="#0E4D64" stroke-width="1.5rem" />
                    <polygon points="112,512 452,412 452,612 112,512" fill="#FF7232" stroke="#0E4D64" stroke-width="1.5rem" />

                    <!-- Interior Circle -->
                    <circle cx="512" cy="512" r="125" fill="#FFFFFF" stroke="#0E4D64" stroke-width="1.5rem" />
                    <circle cx="512" cy="512" r="50" fill="#ffb030" stroke="#0E4D64" stroke-width="1.5rem" />
                </svg>

                <!-- Direction Labels -->
                <div class="direction-label north" style="transform: translateX(-50%) rotate({bearing}deg)">N</div>
                <div class="direction-label south" style="transform: translateX(-50%) rotate({bearing}deg)">S</div>
                <div class="direction-label east" style="transform: translateY(-50%) rotate({bearing}deg)">E</div>
                <div class="direction-label west" style="transform: translateY(-50%) rotate({bearing}deg)">W</div>
            </div>

        </div>
            <CloseButton />
    </div></FourByThreeScreen
>

<style>
    .compass-container {
        position: relative;
        width: 20rem;
        height: 20rem;
        bottom: 0;
        right: 0;
        transform-style: preserve-3d;
    }

    .direction-label {
        position: absolute;
        width: 3.5rem;
        height: 3.5rem;
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: #5ab4e7;
        border: 0.4rem solid #0e4d64;
        border-radius: 50%;
        font-size: 1.5rem;
        font-weight: bold;
        color: #ffffff;
    }

    .north {
        background-color: #FF7232;
        top: -1.5rem;
        left: 50%;
    }
    .south {
        bottom: -1.5rem;
        left: 50%;
    }
    .east {
        right: -1.5rem;
        top: 50%;
    }
    .west {
        left: -1.5rem;
        top: 50%;
    }

    .compass {
        transform-origin: center;
    }

    .slider {
        margin-top: 1rem;
        width: 20rem;
    }

    .custom-marker {
        font-size: 3.5rem;
        color: #ff5090;
        display: block;
        margin-top: -1.5rem;
    }

    .user-marker {
        color: red;
        display: block;
        position: relative;
    }

    .user-marker-shadow {
        position: absolute;
        width: 80%;
        height: 70%;
        background: radial-gradient(circle, rgba(0, 0, 0, 0.74) 0%, rgba(0, 0, 0, 0.3) 40%, rgba(0, 0, 0, 0) 70%);
        top: 70%;
        left: 50%;
        transform: translate(-50%, -15%) scale(2.2, 1);
        z-index: -1;
        border-radius: 50%;
        filter: blur(3px);
    }

    .coordinate-overlay {
        position: absolute;
        top: 0rem;
        left: 0rem;
        display: flex;
        flex-direction: column;
    }

    .coordinate-label {
        background-color: #5AB4E7;
        color: white;
        padding: 1rem;
        border-radius: 1rem;
        font-size: 2rem;
        font-family: monospace;
        white-space: nowrap;
    }

    .lat {
        position: absolute;
        transform: rotate(90deg);
        transform-origin: top left;
        margin-top: 8rem;
        margin-left: 7rem;
    }

    .lon {
        position: absolute;
        margin-top: 2rem;
        margin-left: 8rem;
    }
</style>
