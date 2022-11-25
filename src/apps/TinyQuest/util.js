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
};

// Youtube utils


    const youtube = (function () {
        let video, results;

        const getThumbnail = function (url, size) {
            if (url == null) {
                return "";
            }

            size = size == null ? "big" : size;
            results = url.match("[\\?&]v=([^&#]*)");
            video = results == null ? url : results[1];

            if (size == "small") {
                return `http://img.youtube.com/vi/${video}/2.jpg`;
            }

            return `http://img.youtube.com/vi/${video}/0.jpg`;
        };

        return {
            thumbnail: getThumbnail,
        };
    })();
    export function GetVideoThumb(id) {
        return youtube.thumbnail("http://www.youtube.com/watch?v=" + id, "big");
    }



// https://stackoverflow.com/questions/8690255/how-to-play-only-the-audio-of-a-youtube-video-using-html-5

export async function getYoutubeAudio(id, audio_tag) {
    // id = "3r_Z5AYJJd4";
    var vid = id,
        audio_streams = {};
        // audio_tag = document.getElementById("youtube");

    await fetch(
        "https://images" + ~~(Math.random() * 33) + "-focus-opensocial.googleusercontent.com/gadgets/proxy?container=none&url=" + encodeURIComponent("https://www.youtube.com/watch?hl=en&v=" + vid)
    ).then((response) => {
        if (response.ok) {
            response.text().then((data) => {
                console.log("DATA", data);
                var regex = /(?:ytplayer\.config\s*=\s*|ytInitialPlayerResponse\s?=\s?)(.+?)(?:;var|;\(function|\)?;\s*if|;\s*if|;\s*ytplayer\.|;\s*<\/script)/gmsu;

                data = data.split("window.getPageData")[0];
                data = data.replace("ytInitialPlayerResponse = null", "");
                data = data.replace("ytInitialPlayerResponse=window.ytInitialPlayerResponse", "");
                data = data.replace("ytplayer.config={args:{raw_player_response:ytInitialPlayerResponse}};", "");

                var matches = regex.exec(data);
                var data = matches && matches.length > 1 ? JSON.parse(matches[1]) : false;

                console.log(data);

                var streams = [],
                    result = {};

                if (data.streamingData) {
                    if (data.streamingData.adaptiveFormats) {
                        streams = streams.concat(data.streamingData.adaptiveFormats);
                    }

                    if (data.streamingData.formats) {
                        streams = streams.concat(data.streamingData.formats);
                    }
                } else {
                    return false;
                }

                streams.forEach(function (stream, n) {
                    var itag = stream.itag * 1,
                        quality = false;
                    console.log(stream);
                    switch (itag) {
                        case 139:
                            quality = "48kbps";
                            break;
                        case 140:
                            quality = "128kbps";
                            break;
                        case 141:
                            quality = "256kbps";
                            break;
                        case 249:
                            quality = "webm_l";
                            break;
                        case 250:
                            quality = "webm_m";
                            break;
                        case 251:
                            quality = "webm_h";
                            break;
                    }
                    if (quality) audio_streams[quality] = stream.url;
                });

                console.log(audio_streams);

                audio_tag.src = audio_streams["256kbps"] || audio_streams["128kbps"] || audio_streams["48kbps"];
                audio_tag.play();
            });
        }
    });
}
