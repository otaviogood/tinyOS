<script>
    import {
        uid,
        username,
        userData,
        phoneScreen,
        firebaseApp,
    } from "./stores";
    import { FirebaseApp, Doc, Collection, User, UploadTask, StorageRef } from "sveltefire";
    import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
    import { DateTime, Interval, Duration } from "luxon";
    import { push, pop, replace } from "svelte-spa-router";

    const icons = [
        {name: "Camera", icon: "fa-camera", bgcolor: "bg-red-500", link: "camera"},
        {name: "Weather", icon: "fa-cloud-sun-rain", bgcolor: "bg-blue-500", link: "weather"},
        {name: "Settings", icon: "fa-cog", bgcolor: "bg-gray-500", link: "settings"},
        {name: "Video", icon: "fa-play", bgcolor: "bg-indigo-500", link: "video"},
        {name: "Audio", icon: "fa-volume-up", bgcolor: "bg-pink-500", link: "audio"},
        {name: "Calendar", icon: "fa-calendar", bgcolor: "bg-indigo-500", link: "calendar"},
        {name: "Maps", icon: "fa-map-marker", bgcolor: "bg-orange-500", link: "maps"},
        {name: "Tiny Quest", icon: "fa-dice", bgcolor: "bg-blue-500", link: "tinyquest"},
        {name: "Photos", icon: "fa-images", bgcolor: "bg-green-500", link: "photos"},
        {name: "Paint", icon: "fa-paint-brush", bgcolor: "bg-orange-500", link: "paint"},
    ];
    // const userAction = async () => {
    //     const response = await fetch('http://example.com/movies.json');
    //     const myJson = await response.json(); //extract JSON from the http response
    //     console.log(myJson);
    // }
    // userAction();
</script>

<div class="wrapper">
    {#each icons as icon, i}
        <div class="flex-center-all flex-col text-white select-none">
            <button class="p-2 active:scale-105 transform transition-all duration-75" on:click={() => {push("/" + icon.link)}}>
                <div class="w-32 h-32 rounded-3xl {icon.bgcolor} flex-center-all text-7xl text-white"><i class="fas {icon.icon}"></i></div>
                <div class="font-bold text-lg m-1">{icon.name}</div>
            </button>
        </div>
    {/each}
</div>

<style>
    .wrapper {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: repeat(4, 1fr);
        height:100vh;
        /* row-gap: 1rem;
        column-gap: 1rem; */
    }
</style>
