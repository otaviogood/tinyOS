<script>
    import {
        uid,
        username,
        userData,
        phoneScreen,
        firebaseApp,
    } from "../stores";
    // import { FirebaseApp, Doc, Collection, User, UploadTask, StorageRef } from "sveltefire";
    // import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
    import { DateTime, Interval, Duration } from "luxon";
    import { push, pop } from "../router";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../screen";
    import { sleep, getRandomInt, shuffleArray, preventZoom } from "../utils";
    import FourByThreeScreen from "../components/FourByThreeScreen.svelte";

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
        // {name: "Weather", icon: "fa-cloud-sun-rain", bgcolor: "bg-blue-500", link: "weather"},
        {name: "Stories", icon: "fa-book-open", bgcolor: "bg-yellow-500", link: "stories"},
        {name: "Timer", icon: "fa-clock-rotate-left", bgcolor: "bg-purple-500", link: "timer"},
        {name: "Music Maker", icon: "fa-drum", bgcolor: "bg-emerald-500", link: "musicsequencer"},
        // {name: "Construct", icon: "fa-building", bgcolor: "bg-amber-500", link: "construct"},
        {name: "Plane Design", icon: "fa-plane-departure", bgcolor: "bg-rose-500", link: "airplanedesigner"},
        // {name: "CityMap", icon: "fa-road", bgcolor: "bg-emerald-500", link: "citymap"},
        {name: "Map", icon: "fa-globe", bgcolor: "bg-cyan-500", link: "map"},
        // {name: "Space", icon: "fa-atom", bgcolor: "bg-violet-500", link: "spaceexplorer"},
        {name: "Word Finder", icon: "fa-table-cells-large", bgcolor: "bg-violet-500", link: "wordfinder"},
        {name: "Word Fit", icon: "fa-table-cells", bgcolor: "bg-amber-500", link: "wordfit"},
        {name: "Word Hive", icon: "fa-circle-nodes", bgcolor: "bg-indigo-500", link: "wordhex"},
        {name: "Dot Plot", icon: "fa-chart-line", bgcolor: "bg-yellow-500", link: "graphdots"},
        // {name: "Orbits", icon: "fa-atom", bgcolor: "bg-violet-500", link: "orbits"},
        // {name: "Motor", icon: "fa-compass", bgcolor: "bg-amber-500", link: "Motor"},
        // {name: "Bluetooth", icon: "fa-compass", bgcolor: "bg-amber-500", link: "Bluetooth"},
        {name: "Settings", icon: "fa-cog", bgcolor: "bg-gray-500", link: "settings"},
    ];

    handleResize();
</script>

<FourByThreeScreen bg="black">
    <div class="wrapper">
        {#each icons as icon, i}
            <div class="flex-center-all flex-col text-white select-none bXXorder border-red-500">
                <button class="p-2 active:scale-105 transform transition-all duration-75" on:pointerup={() => {push("/" + icon.link)}}>
                    <div class="w-56 h-56 roundeXXd-3xl {icon.bgcolor} flex-center-all text-9xl text-white" style="border-radius:4rem"><i class="fas {icon.icon}"></i></div>
                    <div class="font-bold text-3xl m-2">{icon.name.toUpperCase()}</div>
                </button>
            </div>
        {/each}
    </div>
</FourByThreeScreen>

<style>
    .wrapper {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        grid-template-rows: repeat(4, 1fr);
        height:100rem;
        /* row-gap: 1rem;
        column-gap: 1rem; */
    }
</style>
