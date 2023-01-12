import { Howl, Howler } from "howler";

// Special case for ipad pro acting like MacOS: https://stackoverflow.com/questions/57776001/how-to-detect-ipad-pro-as-ipad-using-javascript
function isIpadOS() {
    return navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform);
}

// Had to write my own OS detection because most things miss iPad pro detection and call it Mac OS. :/
// From: https://stackoverflow.com/questions/38241480/detect-macos-ios-windows-android-and-linux-os-with-js
export function getOS() {
    if (isIpadOS()) return "iOS";

    var userAgent = window.navigator.userAgent,
        platform = window.navigator.platform,
        macosPlatforms = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"],
        windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"],
        iosPlatforms = ["iPhone", "iPad", "iPod"],
        os = null;

    if (macosPlatforms.indexOf(platform) !== -1) {
        os = "Mac OS";
    } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = "iOS";
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = "Windows";
    } else if (/Android/.test(userAgent)) {
        os = "Android";
    } else if (!os && /Linux/.test(platform)) {
        os = "Linux";
    }

    return os;
}

export function isPhone() {
    var userAgent = window.navigator.userAgent,
        platform = window.navigator.platform,
        macosPlatforms = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"],
        windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"],
        iosPlatforms = ["iPhone"], //, "iPad", "iPod"],
        os = null;

    if (macosPlatforms.indexOf(platform) !== -1) {
        os = "Mac OS";
    } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = "iOS";
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = "Windows";
    } else if (/Android/.test(userAgent)) {
        os = "Android";
    } else if (!os && /Linux/.test(platform)) {
        os = "Linux";
    }

    return os === "iOS" || os === "Android";
}

export function download(filename, text) {
    var element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
    element.setAttribute("download", filename);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}

export function makeid() {
    var result = "";
    var characters = "ABCDEF1234567890";
    for (var i = 0; i < 30; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length)); // TODO: more secure random so images can't be guessed
    }
    return result;
}

// From: https://stackoverflow.com/questions/2090551/parse-query-string-in-javascript
export function parseQuery(queryString) {
    var query = {};
    var pairs = (queryString[0] === "?" ? queryString.substr(1) : queryString).split("&");
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split("=");
        query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
    }
    return query;
}

export async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function preventZoom(e) {
    var t2 = e.timeStamp;
    var t1 = e.currentTarget.dataset.lastTouch || t2;
    var dt = t2 - t1;
    var fingers = e.touches.length;
    e.currentTarget.dataset.lastTouch = t2;

    if (!dt || dt > 500 || fingers > 1) return; // not double-tap

    e.preventDefault();
    e.target.click();
}

export function HSVToRGB(hi, si, vi) {
    var fr = 0,
        fg = 0,
        fb = 0;
    var h = hi * 360;
    var s = si;
    var v = vi;
    var i = 0;
    var f = 0,
        p = 0,
        q = 0,
        t = 0;

    if (s == 0) {
        // gray
        fr = fg = fb = v;
    } else {
        h /= 60;
        i = Math.floor(h);

        // fractional part
        f = h - i;
        p = v * (1 - s);
        q = v * (1 - s * f);
        t = v * (1 - s * (1 - f));

        if (i == 1) {
            fr = q;
            fg = v;
            fb = p;
        } else if (i == 2) {
            fr = p;
            fg = v;
            fb = t;
        } else if (i == 3) {
            fr = p;
            fg = q;
            fb = v;
        } else if (i == 4) {
            fr = t;
            fg = p;
            fb = v;
        } else if (i == 5) {
            fr = v;
            fg = p;
            fb = q;
        } else {
            // i == 0
            fr = v;
            fg = t;
            fb = p;
        }
    }
    return [(fr * 255) | 0, (fg * 255) | 0, (fb * 255) | 0];
    //    return ColorABGR.new2((fr * 255) | 0, (fg * 255) | 0, (fb * 255) | 0, 255);
}

// Youtube utils

// const youtube = (function () {
//     let video, results;

//     const getThumbnail = function (url, size) {
//         if (url == null) {
//             return "";
//         }

//         size = size == null ? "big" : size;
//         results = url.match("[\\?&]v=([^&#]*)");
//         video = results == null ? url : results[1];

//         if (size == "small") {
//             return `http://img.youtube.com/vi/${video}/2.jpg`;
//         }

//         return `http://img.youtube.com/vi/${video}/0.jpg`;
//     };

//     return {
//         thumbnail: getThumbnail,
//     };
// })();
// export function GetVideoThumb(id) {
//     return youtube.thumbnail("http://www.youtube.com/watch?v=" + id, "big");
// }

    // Debugging function that speaks text through audio out. Also logs it.
    let speaking = false;
    export function speakDebug(text, verbose = true) {
        speaking = true;
        speechSynthesis.cancel();
        let utter = new SpeechSynthesisUtterance(text.toLowerCase());
        //utter.rate = 2.0;
        speechSynthesis.speak(utter);
        if (verbose) console.log("🔊 " + text);
        utter.onend = function (event) {
            speaking = false;
            // console.log("Utterance has finished being spoken after " + event.elapsedTime + " milliseconds.");
        };
    }


// play speech from pre-rendered mp3s.
// Pass in a list of string args.
export async function speechPlay() {
    for (var i = 0; i < arguments.length; i++) {
        // console.log(arguments[i]);
        let words = arguments[i];
        var sound = new Howl({
            src: ["speech/" + words.replace(/[^a-zA-Z0-9]/g, "_") + '.mp3']
        });
        if (!sound) console.error("Sound not found: " + words);
        sound.play();
        let dur = sound.duration();
        // sloppy wait for sound to load
        while (dur === 0) {
            await sleep(30);
            dur = sound.duration();
        }
        await sleep(dur * 1000 * 0.7); // hacky 0.7 - speech synth pads with too much silence
    }
}