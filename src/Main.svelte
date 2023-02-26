<script>
    import {
        uid,
        username,
        userData,
        phoneScreen,
        firebaseApp,
    } from "./stores";
    // import { FirebaseApp, Doc, Collection, User, UploadTask, StorageRef } from "sveltefire";
    // import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
    import { DateTime, Interval, Duration } from "luxon";
    import { push, pop, replace } from "svelte-spa-router";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "./screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "./utils";

    const icons = [
        {name: "Tiny Quest", icon: "fa-hat-wizard", bgcolor: "bg-green-500", link: "tinyquest/mapscreen"},
        // {name: "Video", icon: "fa-play", bgcolor: "bg-indigo-500", link: "video"},
        {name: "Music", icon: "fa-music", bgcolor: "bg-pink-500", link: "musicplayer"},
        {name: "Paint", icon: "fa-paint-brush", bgcolor: "bg-orange-500", link: "paint"},
        {name: "Camera", icon: "fa-camera", bgcolor: "bg-red-500", link: "camera"},
        {name: "Microphone", icon: "fa-microphone", bgcolor: "bg-indigo-500", link: "microphone"},
        // {name: "Calendar", icon: "fa-calendar", bgcolor: "bg-indigo-500", link: "calendar"},
        // {name: "Maps", icon: "fa-map-marker", bgcolor: "bg-orange-500", link: "maps"},
        // {name: "Photos", icon: "fa-images", bgcolor: "bg-green-500", link: "photos"},
        {name: "Weather", icon: "fa-cloud-sun-rain", bgcolor: "bg-blue-500", link: "weather"},
        {name: "Stories", icon: "fa-book-open", bgcolor: "bg-yellow-500", link: "stories"},
        {name: "Timer", icon: "fa-clock-rotate-left", bgcolor: "bg-purple-500", link: "timer"},
        // {name: "Music Maker", icon: "fa-drum", bgcolor: "bg-cyan-500", link: "musicsequencer"},
        {name: "Settings", icon: "fa-cog", bgcolor: "bg-gray-500", link: "settings"},
    ];

    handleResize();
</script>

<div class="fit-full-space select-none overflow-hidden bg-black" on:touchstart={preventZoom}>
    <div class="wrapper">
        {#each icons as icon, i}
            <div class="flex-center-all flex-col text-white select-none bXXorder border-red-500">
                <button class="p-2 active:scale-105 transform transition-all duration-75" on:pointerup={() => {push("/" + icon.link)}}>
                    <div class="w-64 h-64 roundeXXd-3xl {icon.bgcolor} flex-center-all text-9xl text-white" style="border-radius:5rem"><i class="fas {icon.icon}"></i></div>
                    <div class="font-bold text-3xl m-2">{icon.name.toUpperCase()}</div>
                </button>
            </div>
        {/each}
    </div>
</div>

<style>
    .wrapper {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: repeat(4, 1fr);
        height:100rem;
        /* row-gap: 1rem;
        column-gap: 1rem; */
    }
</style>
