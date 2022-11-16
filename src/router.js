// Routing the different web pages for the "single page app" website style...
// Using https://github.com/ItalyPaleAle/svelte-spa-router

import Main from "./Main.svelte";
import Camera from "./apps/Camera.svelte";
import Photos from "./apps/Photos.svelte";
import Weather from "./apps/Weather.svelte";

export const routes = {
    // Exact path
    "/": Main,
    "/#": Main,
    "/#/": Main,

    "/camera": Camera,
    "/camera/": Camera,
    "/#/camera": Camera,
    "/#/camera/": Camera,

    "/photos": Photos,
    "/photos/": Photos,
    "/#/photos": Photos,
    "/#/photos/": Photos,

    "/weather": Weather,
    "/weather/": Weather,
    "/#/weather": Weather,
    "/#/weather/": Weather,

    // // Wildcard parameter
    // "/go/*": MainGame,
    // "/go": MainGame,
    // "/portal": PortalRedirect,

    // "/login": Login,
    // "/login/": Login,

    // "/about": About,
    // "/about/": About,

    // // Catch-all
    // // This is optional, but if present it must be the last
    // "*": NotFound,
};
