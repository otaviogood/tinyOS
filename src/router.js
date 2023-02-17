// Routing the different web pages for the "single page app" website style...
// Using https://github.com/ItalyPaleAle/svelte-spa-router

import Main from "./Main.svelte";
import Camera from "./apps/Camera.svelte";
import Photos from "./apps/Photos.svelte";
import Weather from "./apps/Weather.svelte";
import MusicPlayer from "./apps/MusicPlayer.svelte";
import Microphone from "./apps/Microphone.svelte";
import Stories from "./apps/Stories.svelte";
import Timer from "./apps/Timer.svelte";
import Paint from "./apps/Paint/Paint.svelte";
import Settings from "./apps/Settings.svelte";

// import TinyQuest from "./apps/TinyQuest.svelte";
// TinyQuest
import Alphabet1 from "./apps/TinyQuest/Alphabet1.svelte";
import MapScreen from "./apps/TinyQuest/MapScreen.svelte";
import EggMatch from "./apps/TinyQuest/EggMatch.svelte";
import NumberPies from "./apps/TinyQuest/NumberPies.svelte";
import Skyscraper from "./apps/TinyQuest/Skyscraper.svelte";
import Harbor from "./apps/TinyQuest/Harbor.svelte";
import MorseCode from "./apps/TinyQuest/MorseCode.svelte";
import RocketLaunch from "./apps/TinyQuest/RocketLaunch.svelte";
import ListenSounds from "./apps/TinyQuest/ListenSounds.svelte";
import Reading1 from "./apps/TinyQuest/Reading1.svelte";
import BusStop from "./apps/TinyQuest/BusStop.svelte";
import MathGrid from "./apps/TinyQuest/MathGrid.svelte";
import AirplaneCrash from "./apps/TinyQuest/AirplaneCrash.svelte";
import BlockDrop from "./apps/TinyQuest/BlockDrop.svelte";


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

    "/musicplayer": MusicPlayer,
    "/musicplayer/": MusicPlayer,
    "/#/musicplayer": MusicPlayer,
    "/#/musicplayer/": MusicPlayer,

    "/microphone": Microphone,
    "/microphone/": Microphone,
    "/#/microphone": Microphone,
    "/#/microphone/": Microphone,

    "/paint": Paint,
    "/paint/": Paint,
    "/#/paint": Paint,
    "/#/paint/": Paint,

    "/stories": Stories,
    "/stories/": Stories,
    "/#/stories": Stories,
    "/#/stories/": Stories,

    "/timer": Timer,
    "/timer/": Timer,
    "/#/timer": Timer,
    "/#/timer/": Timer,

    "/settings": Settings,
    "/settings/": Settings,
    "/#/settings": Settings,
    "/#/settings/": Settings,

    // TinyQuest
    "/tinyquest/mapscreen": MapScreen,
    "/tinyquest/mapscreen/": MapScreen,
    "/tinyquest/#/mapscreen": MapScreen,
    "/tinyquest/#/mapscreen/": MapScreen,
    // Wildcard parameter
    "/tinyquest/alphabet1/*": Alphabet1,
    "/tinyquest/alphabet1": Alphabet1,

    "/tinyquest/eggmatch": EggMatch,
    "/tinyquest/numberpies": NumberPies,
    "/tinyquest/skyscraper": Skyscraper,
    "/tinyquest/harbor": Harbor,
    "/tinyquest/morsecode": MorseCode,
    "/tinyquest/rocketlaunch": RocketLaunch,
    "/tinyquest/listensounds": ListenSounds,
    "/tinyquest/reading1": Reading1,
    "/tinyquest/busstop": BusStop,
    "/tinyquest/mathgrid": MathGrid,
    "/tinyquest/airplanecrash": AirplaneCrash,
    "/tinyquest/blockdrop": BlockDrop,

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
