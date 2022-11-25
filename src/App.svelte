<script>
    import { onMount } from "svelte";
    import { Howl, Howler } from "howler";
    import { handleResize } from "./screen";
    import Router from "svelte-spa-router";
    import { routes } from "./router.js";
    import { firebaseConfig } from "./secrets";
    import { initializeApp } from "firebase/app";
    import { FirebaseApp, Doc, Collection, User, UploadTask, StorageRef } from "sveltefire";
    import {
        getFirestore,
        doc,
        getDoc,
        setDoc,
        collection,
        addDoc,
        serverTimestamp,
        Timestamp,
        enableIndexedDbPersistence,
    } from "firebase/firestore";
    import { uid, username, userData, phoneScreen, headerHeight, firebaseApp } from "./stores";

    const app = initializeApp(firebaseConfig);
    $firebaseApp = app;

    // Enable cached offline db use: https://firebase.google.com/docs/firestore/manage-data/enable-offline
    const db = getFirestore($firebaseApp);
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == "failed-precondition") {
            console.error("Multiple tabs open, Firebase persistence can only be enabled in one tab at a a time.")
        } else if (err.code == "unimplemented") {
            window.alert("The current browser does not support all of the features required to enable persistence.")
        }
    });

    // For iOS screen rotation
    window.addEventListener("orientationchange", function (event) {
        window.dispatchEvent(new Event("resize"));
    });
    window.addEventListener("resize", handleResize);

    // This is for ios to not scroll on drag vertical. https://stackoverflow.com/questions/7768269/ipad-safari-disable-scrolling-and-bounce-effect
    function preventDefault(e) {
        if (window.letMeScroll) {
            window.letMeScroll = undefined;
            return;
        }
        e.preventDefault();
    }
    function disableScroll() {
        document.body.addEventListener("touchmove", preventDefault, { passive: false });
    }
    function enableScroll() {
        document.body.removeEventListener("touchmove", preventDefault);
    }
    disableScroll();

    // By default, audio on mobile browsers and Chrome/Safari is locked until a sound is played within a user interaction
    // https://github.com/goldfire/howler.js#documentation
    var sound = new Howl({
        src: ['silence.wav'],
        onplayerror: function() {
            sound.once('unlock', function() {
            sound.play();
            });
        }
    });
    sound.play();
</script>

<div class="fit-full-space overflow-hidden" on:contextmenu|preventDefault|stopPropagation={() => void(0)} >
    <Router {routes} />
</div>

<!-- <FirebaseApp config={firebaseConfig}> -->
    <!-- <Header /> -->
    <!-- Leave space for the fixed header at the top. Maybe not the best way to do this??? -->
    <!-- <div style={$phoneScreen ? "" : "height:" + $headerHeight + "px;flex-basis:" + $headerHeight + "px"} /> -->
    <!-- <Router {routes} /> -->
    <!-- <User persist={sessionStorage} let:user let:auth>
        <div slot="signed-out">Signed out!</div>
    </User> -->
    <!-- <div style={$phoneScreen ? "height:" + $headerHeight + "px;flex-basis:" + $headerHeight + "px" : ""} /> -->
<!-- </FirebaseApp> -->

<style lang="postcss" global>
    :root {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
            "Helvetica Neue", sans-serif;
    }

    /* Nice scrollbars */
    /* width */
    .scroll::-webkit-scrollbar {
        width: 10px;
        height: 10px;
    }

    /* bottom-right corner rectangle */
    .scroll::-webkit-scrollbar-corner {
        @apply bg-gray-300;
        /* @apply dark:bg-gray-900; */
    }

    /* Track */
    .scroll::-webkit-scrollbar-track {
        background-color: #f0f0f0;
        /* @apply dark:bg-gray-800; */
    }

    /* Handle */
    .scroll::-webkit-scrollbar-thumb {
        background-color: #bbb;
        /* @apply dark:bg-gray-500; */
        @apply rounded;
    }

    /* Handle on hover */
    .scroll::-webkit-scrollbar-thumb:hover {
        background-color: #666;
    }
    pre {
        font-family:'Roboto Slab', serif;
        letter-spacing: .125rem;
    }
</style>
