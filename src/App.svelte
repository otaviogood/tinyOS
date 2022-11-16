<script>
    import { onMount } from "svelte";
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
</script>

<!-- <FirebaseApp config={firebaseConfig}> -->
    <!-- <Header /> -->
    <!-- Leave space for the fixed header at the top. Maybe not the best way to do this??? -->
    <!-- <div style={$phoneScreen ? "" : "height:" + $headerHeight + "px;flex-basis:" + $headerHeight + "px"} /> -->
    <Router {routes} />
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

    /* main {
        text-align: center;
        padding: 1em;
        margin: 0 auto;
    }

    img {
        height: 16rem;
        width: 16rem;
    }

    h1 {
        color: #ff3e00;
        text-transform: uppercase;
        font-size: 4rem;
        font-weight: 100;
        line-height: 1.1;
        margin: 2rem auto;
        max-width: 14rem;
    }

    p {
        max-width: 14rem;
        margin: 1rem auto;
        line-height: 1.35;
    }

    @media (min-width: 480px) {
        h1 {
            max-width: none;
        }

        p {
            max-width: none;
        }
    } */
</style>
