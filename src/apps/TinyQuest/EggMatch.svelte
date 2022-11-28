<script>
    import "./TailwindStyles.svelte";
    import { onMount } from "svelte";
    import { slide, fade } from "svelte/transition";
    import { Howl, Howler } from "howler";
    import EggSprites from "./EggSprites.svelte";
    import IconsMisc from "./IconsMisc.svelte";
    import StarBar from "./StarBar.svelte";
    import SVGCache from "./SVGCache.svelte";
    import WinScreen from "./WinScreen.svelte";
    import { pop } from "svelte-spa-router";
    import { allTowns, currentTownIndex, earnedStar } from "./stores";
    import { spin } from "./Transitions";
    import { invAspectRatio, fullWidth, fullHeight, landscape, bigWidth, bigHeight, bigScale, bigPadX, bigPadY, handleResize } from "../../screen";
    import { sleep, getRandomInt, preventZoom } from "./util";
    import { speechPlay } from "../../utils";

    var snd_good = new Howl({ src: ["/TinyQuest/sfx/sfx_coin_double1.wav"], volume: 0.25 });
    var snd_fanfare = new Howl({ src: ["/TinyQuest/sfx/sfx_sound_mechanicalnoise2.wav"], volume: 0.25 });
    var snd_error = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_error10.wav"], volume: 0.25 });
    var snd_shake = new Howl({ src: ["/TinyQuest/sfx/sfx_sounds_pause6_out.wav"], volume: 0.3 });
    var snd_break = new Howl({ src: ["/TinyQuest/sfx/sfx_exp_various3.wav"], volume: 0.25 });
    /*!speech
        ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]
    */

    const maxStars = 6; // 6*4 = 24, 26 letters in alphabet, so don't overflow.
    let letters;
    let currentLetters;
    let occupied = [0, 0, 0, 0];

    let starCount = 0;
    let started = false;
    let finalGraphic = false;
    let town;
    let gameType;

    function removeLetter(l) {
        letters = letters.replace(l, "");
    }

    function genPos() {
        // Spawn eggs in random position
        let x = Math.random() * 0.32 + 0.43;
        let y = Math.random() * 0.5 + 0.02;
        // Make sure they don't overlap.
        for (let reps = 0; reps < 8; reps++) {
            let collision = false;
            for (let i = 0; i < currentLetters.length; i++) {
                let dx = x - currentLetters[i].x0;
                let dy = y - currentLetters[i].y0;
                if (Math.sqrt(dx * dx + dy * dy) < 0.16) {
                    collision = true;
                    x = Math.random() * 0.32 + 0.43;
                    y = Math.random() * 0.5 + 0.02;
                }
            }
            if (!collision) break;
        }
        return [x, y];
    }

    function randomizeLetters() {
        currentLetters = [];
        occupied = [];
        for (let i = 0; i < 4; i++) {
            let xy = genPos();
            currentLetters.push({ letter: letters[getRandomInt(letters.length)], x0: xy[0], y0: xy[1], which: currentLetters.length });
            removeLetter(currentLetters[currentLetters.length - 1].letter);
            occupied.push(0);
        }
    }

    onMount(() => {
        town = $allTowns[$currentTownIndex];
        gameType = town?.options?.game;
        return () => {};
    });

    let frameCount = 0;
    let frame;
    async function loop(msSinceStart) {
        frame = requestAnimationFrame(loop);
        frameCount += 1;

        for (let i = 0; i < currentLetters.length; i++) {
            if (currentLetters[i].x === undefined) currentLetters[i].x = currentLetters[i].x0;
            if (currentLetters[i].y === undefined) currentLetters[i].y = currentLetters[i].y0;
            if (!dragging) {
                const maxSpeed = 0.01;
                let dx = currentLetters[i].x0 - currentLetters[i].x;
                let dy = currentLetters[i].y0 - currentLetters[i].y;
                let mag = Math.sqrt(dx * dx + dy * dy);
                if (mag > maxSpeed) {
                    dx /= mag;
                    dy /= mag;
                    dx *= maxSpeed;
                    dy *= maxSpeed;
                }
                currentLetters[i].x += dx;
                currentLetters[i].y += dy;
                if (occupied[i] === 1 && dx === 0.0 && dy === 0.0 && currentLetters[i].which === i) {
                    occupied[i] += 1.0 / 64.0;
                }
            }
            if (occupied[i] != Math.round(occupied[i])) {
                occupied[i] += 1.0 / 64.0;
                if (occupied[i] === 2.0) {
                    snd_break.play();
                    if (occupied[0] === 2.0 && occupied[1] === 2.0 && occupied[2] === 2.0 && occupied[3] === 2.0) {
                        starCount++;
                        snd_good.play();
                        if (starCount >= maxStars) {
                            // Finished game. Yay!
                            await sleep(2000);
                            finalGraphic = true;
                            snd_fanfare.play();
                            $earnedStar = true;
                            return;
                        } else {
                            inside = -1;
                            await sleep(2000);
                            randomizeLetters();
                        }
                    }
                }
            }
        }
    }

    async function startGame() {
        finalGraphic = false;
        started = true;
        starCount = 0;
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        currentLetters = [];
        occupied = [];
        inside = -1;
        await sleep(200);
        randomizeLetters();
        loop(0);
    }
    function resetToSplashScreen() {
        started = false;
        pop();
    }

    function getPointerPos(ev) {
        let x = ev.clientX / $bigScale;
        let y = ev.clientY / $bigScale;
        return [x, y];
    }

    let dragging = 0;
    let mouseDownX = -1;
    let mouseDownY = -1;
    let mouseX = -1;
    let mouseY = -1;
    function handleDragStart(e, i) {
        speechSynthesis.cancel();
        if (occupied[i] > 0) return;
        dragging = i + 1;
        let xy = getPointerPos(e);
        mouseDownX = xy[0];
        mouseDownY = xy[1];
        mouseX = xy[0];
        mouseY = xy[1];
        speechPlay(currentLetters[i].letter);
    }

    let inside = -1;
    function handleDragMove(e) {
        if (!dragging) return;
        let d = dragging - 1;
        let xy = getPointerPos(e);
        const dx = xy[0] - mouseX;
        const dy = xy[1] - mouseY;
        mouseX = xy[0];
        mouseY = xy[1];
        currentLetters[d].x0 += dx;
        currentLetters[d].y0 += dy;
        // Keep eggs in screen bounds
        if (currentLetters[d].x0 > 0.77) currentLetters[d].x0 = 0.77;
        if (currentLetters[d].y0 > 0.65) currentLetters[d].y0 = 0.65;
        if (currentLetters[d].y0 < -0.05) currentLetters[d].y0 = -0.05;

        currentLetters[d].x += currentLetters[d].x0 - currentLetters[d].x;
        currentLetters[d].y += currentLetters[d].y0 - currentLetters[d].y;

        let floory = Math.floor((currentLetters[d].y / invAspectRatio + 0.125) / 0.25);
        if (currentLetters[d].x < 0.43) inside = Math.max(0, floory);
        else inside = -1;
    }

    function handleDragEnd(e) {
        if (!dragging) return;
        let i = dragging - 1;
        if (inside >= 0) {
            if (!occupied[inside] && currentLetters[dragging - 1].which === inside) {
                occupied[inside] = 1;
                currentLetters[i].x0 = 0.35;
                currentLetters[i].y0 = 0.02 + inside * invAspectRatio * 0.25;
                snd_shake.play();
            } else {
                let xy = genPos();
                currentLetters[i].x0 = xy[0];
                currentLetters[i].y0 = xy[1];
                snd_error.play();
            }
        }
        dragging = 0;
    }

    function interp(a, b, anim) {
        anim = Math.max(0, anim);
        return a + (b - a) * ((anim % 1) + Math.floor(anim));
    }

    // prettier-ignore
    let nestXML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 146.48 65.81"><defs><style>.cls-1 {isolation: isolate;}.cls-2 {fill: #5c3010;}.cls-3,.cls-4 {fill: #ffda6d;}.cls-4 {mix-blend-mode: multiply;}</style></defs
        ><g class="cls-1"><g id="Layer_1" data-name="Layer 1"><path class="cls-2"
            d="M505.62,440.41a17.45,17.45,0,0,0-3.89-9.79,10.8,10.8,0,0,0-4.4-3.08,24,24,0,0,0,3-.21A2.11,2.11,0,0,0,502,424.5c-.76-2.28-4.58-4.08-6.52-5a22.07,22.07,0,0,0-4.24-1.36,3.71,3.71,0,0,0,1.11-.83c1.38-1.52,0-2.87-1.27-3.79-3.27-2.34-7.58-3.37-11.9-3.53a6.3,6.3,0,0,0,2.4-2c1.28-2-2.12-2.91-3.35-3.27a36.7,36.7,0,0,0-10.21-1.27,42.15,42.15,0,0,0-11,1.64,6.23,6.23,0,0,0,2-2.11c.05-.1.13-.32,0-.38a8.34,8.34,0,0,0-5,.24,27.81,27.81,0,0,0-4.05,1.75s-1.56.81-2.55,1.22c.73-1.62,2-3,2.3-4.82.44-2.67-3.7-1.82-4.9-1.42a22.81,22.81,0,0,0-7.89,5.26,21.06,21.06,0,0,0-2.76,3.14c-.06-3.43-1.64-8.18-4.58-7.86-2.48.28-2.22,3.12-2.72,5.08-2.59-2.49-7.09-4.68-10.41-4.21-.94.14-1.38,1.74-1.42,3.14a17.72,17.72,0,0,0-2-1.21,22.58,22.58,0,0,0-7.89-2.44c-4.06-.44-6,2.61-5.84,6-5.9-1.62-12.05-.38-17.61,2.12-2.06.92-8.07,4.05-4.95,6.53l-2,.83a24.65,24.65,0,0,0-10.51,8.12c-1.21,1.62-4.14,5-2.63,7.11.59.84,1.6.93,2.74.63a17.46,17.46,0,0,0-1.34,1.38,15.3,15.3,0,0,0-3.75,8c-.39,3.3,2.83,4.4,5.53,3.88,3.1-.59,5.64-3.17,8.07-5.33a19,19,0,0,0-2.05,8c0,1.68,1.18,3,2.87,2.19a10,10,0,0,0,2.61-1.8c.45-.45.89-.9,1.32-1.36-2.54,4.73-5.6,13.35,1.39,15.11,3,.75,6.86-.69,9.64-1.63a40.44,40.44,0,0,0,9.24-4.59,2.78,2.78,0,0,0,0,2.75c.85,1.18,3.2-.29,5.29-2a4.45,4.45,0,0,0-.7,3.6c.75,2.06,2.73,2.59,4.75,2.78,3.62.34,7.33-1,10.68-2.18,1.55-.55,3.06-1.12,4.55-1.82a35.77,35.77,0,0,0,3.48-2.25c-.56,1.06-.8,2.16.45,2.42s3.24-1.49,4.15-2.19l1-.76c-.67,3.76-.65,7.62,3.31,7.3,2.26-.19,4.46-2,6.14-4.16-.17,1.44.34,2.61,2.54,2.84,3.05.33,6.27-1.75,8.54-4.09a8.4,8.4,0,0,0,10.79,6.63c3.95-1.27,4.53-5.17,3.79-8.87a21.34,21.34,0,0,0,7.12,1.9,51.94,51.94,0,0,0,11.49.29c2.06-.18,4.45-.86,5.61-2.73,1-1.67.34-3.33-.64-4.84a32.3,32.3,0,0,0,6.36,1.28c1.62.18,3.4.36,4.33-1.21.52-.9-.09-2.27-.82-3.41A5.86,5.86,0,0,0,505.62,440.41Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-3"
            d="M498.49,445.08a6.25,6.25,0,0,0-2.65-1.35c.24.21.48.42.69.64.93,1,3.24,3.64,2.48,5.17a1.53,1.53,0,0,1-.16.25c0,.17.11.34.16.51,0-.11-.18-.2-.39-.28-1,.77-2.81.22-3.83,0-2-.4-3.87-1.34-5.86-1.73l-1.44-.27c-.41.25-.7.68-.43,1.06,1.32,1.85,4.32,5.95,0,6.47a41.09,41.09,0,0,1-7.44,0,47.1,47.1,0,0,1-13.94-2.91,17.79,17.79,0,0,0-.94-2c0,2.42.43,4.83,0,7.22a12.52,12.52,0,0,1-.07,1.7c-.44,4.26-4.14,4.15-6.72,2.87-2.88-.26-4.87-4.16-5.15-7.49a1.93,1.93,0,0,0-.54.36,15.28,15.28,0,0,1-6.47,4.29c-4.47,1.52-2.4-3.64-2.14-5.64.08-.59-.89-.13-1,.22,0,.07-.05.15-.08.23-.9,2.17-7.23,10-9,5.26-.62-1.68-.32-3.58-.18-5.46a7.33,7.33,0,0,0,1.1-1.69c-2.22,1.76-4.22,3.82-7,4.72-.51.17-.85-.41-.75-.83a7.67,7.67,0,0,1,.88-2.13c-1.74.53-3,1.87-4.59,2.71a53.92,53.92,0,0,1-8.47,3.27c-2.84.9-6.2,1.55-9.07.44-3.63-1.4.43-5.87,1.51-7.79a.92.92,0,0,0,.11-.36,23.49,23.49,0,0,1-6.64,3.71h0c-.43.27-.66.3-.76.2h-.06a.66.66,0,0,1-.79-.67,7.35,7.35,0,0,1,1.24-3.67,18.94,18.94,0,0,0-1.25,1.62c-5.65,2.67-11.55,6.54-18,6.38-3.74-.1-4.73-3.42-4.27-6.53a26.93,26.93,0,0,1,2.46-8.27.59.59,0,0,0,.22-.38,8.43,8.43,0,0,1,.7-1c.34-.4-.08-.6-.44-.36-1.7,1.21-3.22,2.67-4.94,3.84-2.7,1.82-1.26-3.9-1-4.92.15-.53.32-1,.51-1.52a38.26,38.26,0,0,1,1.36-4.21c.29-.72.57-1.43.83-2.15a23,23,0,0,0-2.64,3.53c-1.76,1-3.39,2.19-5.14,3.17-3.21,1.78-7.39,1.84-6.3-2.75a16.6,16.6,0,0,1,3.35-6.19c.57-.72,1.33-1.39,1.87-2.14a12.63,12.63,0,0,0,1.64-1.38l-.25.09c-1.32.49-3.37,1.42-4.79.77-1.6-.73-.31-2.78.38-3.68A12.56,12.56,0,0,1,368,422.5a.53.53,0,0,1,.23-.39c.19-.15.39-.29.59-.43.3-.3.6-.59.92-.87a22.13,22.13,0,0,1,5.17-3.21,50.68,50.68,0,0,1,9.58-4.65c-.37.08-.72.17-1,.22a32,32,0,0,0-5,1.38.42.42,0,0,0-.16-.17c-3.42-1.95,3.77-4.81,5.38-5.45,5.15-2.06,10.89-2.69,16.05-.35.69.31,1.57-.51,1.52-1.2-.61-7.28,6.57-4.26,10.21-2.71a21,21,0,0,1,2.72,1.48,29.11,29.11,0,0,1,3.47,1.32,17.54,17.54,0,0,0-1.16-2,.35.35,0,0,0-.07-.21,4.12,4.12,0,0,1-.36-2.59c.11-2.22,4-.19,4.64.12a12.32,12.32,0,0,1,5.23,4.88c.34.57,1.3-.08,1.57-.36,1.05-1.08,1.09-3,1.51-4.4.59-2,2.93,2.87,3.2,3.54a16.39,16.39,0,0,1,.85,3.48,6,6,0,0,0-.42,1.5,44,44,0,0,1,5.68-5.66,22.93,22.93,0,0,1,5-3.49c.47-.24,5.07-2.33,3.4,1.08a7.47,7.47,0,0,0-.51,1.07c-.3,1-1.21,1.84-1.14,2.9a.54.54,0,0,0,.67.56c1.9-.4,3.63-2.15,5.32-3.05a27.06,27.06,0,0,1,2.87-1.25l.62-.17a1.75,1.75,0,0,1,2.6.45c-1.54.9-3.13,1.66-4.65,2.62a2.68,2.68,0,0,0-.76.94c2-.26,4.11-.27,6.18-.38a24.65,24.65,0,0,1,3.41-.74,47.54,47.54,0,0,1,11.31.06,39.31,39.31,0,0,1,4.18.74c.69.16,3.39.62,1.5,1.36a23.78,23.78,0,0,1-3.89,1.32,1.55,1.55,0,0,0-.79.49,34.78,34.78,0,0,0-4.22.78h0a56.69,56.69,0,0,1,6.05.54c1.65.32,3.32.61,5,.94a31.87,31.87,0,0,1,3.39.62,18.66,18.66,0,0,1,2.53.82c.3.1.61.19.91.3a.59.59,0,0,1,.33.26,19.65,19.65,0,0,1,1.74,1c2.2,1.38-3.37,1.74-4.27,1.79a1.74,1.74,0,0,0-1,.6,51.39,51.39,0,0,1,9.79,2.36c1.6.59,6.18,2,6.61,4.16.38,1.94-1.62,1.93-3,1.93-2,0-4-.05-6,0a24.45,24.45,0,0,1,5.91,3.38c2.47,2.16,4.45,4.5,5.2,7.75,0,0,0,.08,0,.11.28,1.06.47,2.15.64,3.2C503.8,444.17,501.24,445.35,498.49,445.08Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-4"
            d="M503.27,440.77c-.17-1-.36-2.14-.64-3.2,0,0,0-.07,0-.11-.75-3.25-2.73-5.59-5.2-7.75a24.45,24.45,0,0,0-5.91-3.38c2,0,4,0,6,0,1.42,0,3.42,0,3-1.93-.43-2.17-5-3.57-6.61-4.16a51.39,51.39,0,0,0-9.79-2.36,1.74,1.74,0,0,1,1-.6c.9-.05,6.47-.41,4.27-1.79a19.65,19.65,0,0,0-1.74-1,.59.59,0,0,0-.33-.26c-.3-.11-.61-.2-.91-.3a18.66,18.66,0,0,0-2.53-.82,31.87,31.87,0,0,0-3.39-.62c-1.67-.33-3.34-.62-5-.94a56.69,56.69,0,0,0-6.05-.54h0a34.78,34.78,0,0,1,4.22-.78,1.55,1.55,0,0,1,.79-.49,23.78,23.78,0,0,0,3.89-1.32c.49-.19.67-.36.66-.51a106.09,106.09,0,0,0-12.89,3c-2.51.82-4.75,1.62-7.43,1.38s-5-.68-7.57-.84a175.36,175.36,0,0,0-18.34-.14l-.1.11,0-.11c-6.18.26-12.34.8-18.5,1.51-6,.69-12.4,1.72-17.5,5.12-2.88,1.93-5.12,4.67-2.76,8.11a18.51,18.51,0,0,0,6.11,5.46,46.57,46.57,0,0,0,16.16,5.33c5.08.73,10.28,2.09,15.43,1.89q.83-.08,1.65-.12c.85,0,.81,1.21,0,1.3-.63.06-1.26.1-1.91.13a89.67,89.67,0,0,0-17.84,3.35c-5.85,1.68-10.88,4.76-16.3,7.44-.39.19-1,0-1-.56.43-3.62,3.2-5.94,4.78-9-4.78,2.1-9,5.85-12.71,9.38-1,1-4,4.08-5.44,2.06-2.11-2.91-.71-8,.69-10.94a41.77,41.77,0,0,1,5.62-8.4c-1.43,1-2.83,2.12-4.3,3.07s-4,3.06-6.06,2.56c-3.92-1,2.44-8.26,5.51-11.46-6.28,1.37-11.62,5.86-16.65,9.61a.65.65,0,0,1-1-.56c.36-4.53,4.75-7.94,8-10.53A51.23,51.23,0,0,1,386,419.41a36.54,36.54,0,0,0-9.14,2.27c-3.66,1.43-6.95,3.63-10.69,4.85a.65.65,0,0,1-.8-.79,15.36,15.36,0,0,1,.8-1.8,21.37,21.37,0,0,0-1.77,2.12c-.69.9-2,2.95-.38,3.68,1.42.65,3.47-.28,4.79-.77l.25-.09a12.63,12.63,0,0,1-1.64,1.38c-.54.75-1.3,1.42-1.87,2.14a16.6,16.6,0,0,0-3.35,6.19c-1.09,4.59,3.09,4.53,6.3,2.75,1.75-1,3.38-2.21,5.14-3.17a23,23,0,0,1,2.64-3.53c-.26.72-.54,1.43-.83,2.15a38.26,38.26,0,0,0-1.36,4.21c-.19.49-.36,1-.51,1.52-.26,1-1.7,6.74,1,4.92,1.72-1.17,3.24-2.63,4.94-3.84.36-.24.78,0,.44.36a8.43,8.43,0,0,0-.7,1,.59.59,0,0,1-.22.38,26.93,26.93,0,0,0-2.46,8.27c-.46,3.11.53,6.43,4.27,6.53,6.46.16,12.36-3.71,18-6.38a18.94,18.94,0,0,1,1.25-1.62,7.35,7.35,0,0,0-1.24,3.67.66.66,0,0,0,.79.67h.06c.1.1.33.07.76-.2h0a23.49,23.49,0,0,0,6.64-3.71.92.92,0,0,1-.11.36c-1.08,1.92-5.14,6.39-1.51,7.79,2.87,1.11,6.23.46,9.07-.44A53.92,53.92,0,0,0,423.1,457c1.61-.84,2.85-2.18,4.59-2.71a7.67,7.67,0,0,0-.88,2.13c-.1.42.24,1,.75.83,2.79-.9,4.79-3,7-4.72a7.33,7.33,0,0,1-1.1,1.69c-.14,1.88-.44,3.78.18,5.46,1.74,4.73,8.07-3.09,9-5.26,0-.08.06-.16.08-.23.1-.35,1.07-.81,1-.22-.26,2-2.33,7.16,2.14,5.64a15.28,15.28,0,0,0,6.47-4.29,1.93,1.93,0,0,1,.54-.36c.28,3.33,2.27,7.23,5.15,7.49,2.58,1.28,6.28,1.39,6.72-2.87a12.52,12.52,0,0,0,.07-1.7c.39-2.39,0-4.8,0-7.22a17.79,17.79,0,0,1,.94,2,47.1,47.1,0,0,0,13.94,2.91,41.09,41.09,0,0,0,7.44,0c4.32-.52,1.32-4.62,0-6.47-.27-.38,0-.81.43-1.06l1.44.27c2,.39,3.85,1.33,5.86,1.73,1,.2,2.87.75,3.83,0,.21.08.35.17.39.28-.05-.17-.11-.34-.16-.51a1.53,1.53,0,0,0,.16-.25c.76-1.53-1.55-4.2-2.48-5.17-.21-.22-.45-.43-.69-.64a6.25,6.25,0,0,1,2.65,1.35C501.24,445.35,503.8,444.17,503.27,440.77Zm-13.75-1.52a91.91,91.91,0,0,0-10.63-.23,28,28,0,0,1,5.42,4.29.65.65,0,0,1-.63,1.08,86.86,86.86,0,0,1-10.22-2.72c2.71,2.4,7.05,5.54,3.37,7.61-2.38,1.34-6,.43-8.39-.32a61.34,61.34,0,0,1-8-3.28c.32,2.19,1,4.9-.71,6.4s-4-1.75-5.19-2.38c-2.67-1.45-4,4.12-7.17,2.77-2.3-1-2.46-3.59-3.34-5.64-2.12,1.22-3.41,3.49-5.72,4.5-.39.17-1,0-1-.56.67-5.8,5-11.82,10-14.74a.65.65,0,0,1,.79.1,5.39,5.39,0,0,0,2.69,2c5-1.83,10.13-3.33,15-5.39a41.17,41.17,0,0,0,8-4.19c1.31-.93,3.11-2.44,4.85-2.44,5.18,0,11.22,3.24,15.51,5.95,1.19.74,8.24,5.63,3.92,7.16C495.5,440.14,492.2,439.49,489.52,439.25Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-2"
            d="M462.44,415.75c-.23.06-.77.71-.27.77a2.51,2.51,0,0,0,.59,0,17,17,0,0,1,8,2.83c5.29,3.48-1.76,6.79-4.48,7.82-5.72,2.19-11.86,3.18-17.9,3.94-5.63.71-11.17,1.91-16.85,2.1a129.46,129.46,0,0,1-16.72-.39l-2.45-.6a50.2,50.2,0,0,1-13.94-5.76c-8-4.9,2.7-9.67,7.19-11.06.19-.05.31-.38,0-.32-3.95.93-9.42,2.5-11.71,6.29-2.68,4.41,3.66,7.4,6.85,9.05,5.82,3,12.5,4.38,18.86,5.66a75,75,0,0,0,20.66,1.45c.26,0,.78-.66.33-.68A135,135,0,0,1,418,433.59a138.52,138.52,0,0,0,18-.11c7.9-.48,16-.37,23.73-2.26,4.72-1.15,13.18-3,15.1-8.3C476.94,417.08,466.2,414.7,462.44,415.75Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-2"
            d="M396.39,435.31c-.84.86-2.52,1.43-3.52,2.2a30.26,30.26,0,0,0-4.08,3.84c-1,1.11-5.29,6.17-3.76,7.65a.78.78,0,0,0,.84.14c3.08-1.16,6.23-4,8.66-6.17.34-.31.24-.87-.27-.56-1.49.89-3,1.71-4.47,2.65-.93.6-2,1.48-3.05,2,.17-1.7,4.38-6.46,5-7.14a36.26,36.26,0,0,1,3.65-3.47c.7-.57,1-.5,1.3-1.08C396.82,435.17,396.51,435.2,396.39,435.31Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-2"
            d="M386.42,421.28a24.43,24.43,0,0,0-9,2.08c-1.32.57-4.45,1.85-4.36,3.71,0,.26.12.46.4.5a2.77,2.77,0,0,0,1.52-.23,34,34,0,0,1,5.95-1.54c.17,0,.42-.36.13-.36a37.14,37.14,0,0,0-4.08.3c-.67.07-1.36.09-2,.22a8.61,8.61,0,0,0,1.83-1c3-1.74,6.27-2.5,9.54-3.33C386.49,421.59,386.69,421.27,386.42,421.28Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-2"
            d="M490.35,435.06c-.33-1.72-2.66-2.65-4.16-3.09-2.08-.6-4.46-1.58-6.64-1.07-.16,0-.34.36-.14.39h0a25.46,25.46,0,0,1,8.18,3.24,15.78,15.78,0,0,0-2.18-.22c-1.81,0-3.63.21-5.43.33-.21,0-.59.5-.26.52,3.15.15,6.43-.41,9.42.85A1,1,0,0,0,490.35,435.06Z"
            transform="translate(-359.17 -399.18)" /><path class="cls-2"
            d="M455.61,444.48a9.68,9.68,0,0,0-1.4-4.28c-.15-.25-.55.15-.53.35.14,1.38.41,2.74.47,4.14,0,.44,0,1,0,1.52-.71-.7-1.3-1.63-1.86-2.29a13.7,13.7,0,0,1-2.34-3.08h0a.54.54,0,0,0-.05-.11h0c0-.16-.37,0-.38.17a6.91,6.91,0,0,0,1.16,3.65c.74,1.34,1.85,3.37,3.33,4,.6.25,1.31-.3,1.53-.85A7.38,7.38,0,0,0,455.61,444.48Z"
            transform="translate(-359.17 -399.18)" /></g></g></svg>
    `;

    handleResize();
    // startGame();
</script>

<div
    class="fit-full-space select-none overflow-hidden"
    style="background-color:#b080b0"
    on:touchstart={preventZoom}
    on:pointerleave|preventDefault|stopPropagation={(e) => handleDragEnd(e)}
    on:pointermove|preventDefault|stopPropagation={(e) => handleDragMove(e)}
    on:pointerup|preventDefault|stopPropagation={(e) => handleDragEnd(e)}
>
    <div class="relative overflow-hidden select-none" style="width:{$bigWidth}; height:{$bigHeight};margin-left:{$bigPadX}px;margin-top:{$bigPadY}px">
        {#if !started}
            <div in:fade class="flex-center-all h-full flex flex-col relative">
                <img src="TinyQuest/gamedata/eggmatch/1466.webp" class="absolute" style="object-fit:cover;width:100%;height:100%;" alt="jungle background" />
                <div class="absolute" style="width:100%;height:100%;background-color:#ffb0ff60" />
                <EggSprites icon="egg-hunt" size="24rem" style="margin:0;z-index:10;" />
                <div class="text-9xl font-bold m-8 z-10">{town?.name}</div>
                <button class="bg-red-500 text-white text-9xl rounded-3xl px-8 z-10" on:pointerup|preventDefault|stopPropagation={startGame}>START</button>
            </div>
        {:else}
            <div in:fade class="flex flex-row h-full w-full relative">
                <img src="TinyQuest/gamedata/eggmatch/1466.webp" class="absolute" style="object-fit:cover;width:100%;height:100%" alt="jungle background" />
                <div class="absolute" style="width:100%;height:100%;background-color:#ffb0ffb0" />
                <div id="playBoard" class="h-full w-full font-bold relative">
                    {#if currentLetters}
                        {#each currentLetters as letter, i}
                            {#if occupied[i] < 2}
                                <div
                                    on:pointerdown|preventDefault|stopPropagation={(e) => handleDragStart(e, i)}
                                    class={i === dragging - 1 ? "XXXbg-green-500 z-20" : "XXXbg-green-900 z-10"}
                                    style="width:14rem;height:14rem;position:absolute;left:{letter.x * 100}rem;top:{letter.y * 100}rem;border-radius:100rem;"
                                >
                                    <EggSprites
                                        icon="egg"
                                        size="14rem"
                                        style="position:absolute;left:0;top:0;transform: rotate({Math.sin(interp(0.0, 3.14159 * 16, occupied[i] - 1)) * interp(0.15, 0.0, occupied[i] - 1)}rad);"
                                    />
                                    <div
                                        class="absolute text-4xl pointer-events-none flex-center-all"
                                        style="font-size:8rem;color:#202020;line-height:3rem;width:14rem;height:14rem;opacity:{interp(1.0, 0.0, occupied[i] - 1)}"
                                    >
                                        {letter.letter.toLowerCase()}
                                    </div>
                                </div>
                            {:else}
                                <div
                                    class="{i === dragging - 1 ? 'XXbg-green-500 z-20' : 'XXbg-green-900 z-10'} "
                                    style="width:14rem;height:14rem;position:absolute;left:{letter.x * 100}rem;top:{letter.y * 100}rem;border-radius:100rem;"
                                >
                                    <EggSprites icon={["dinosaur", "dinosaur-egg", "dragon-1", "dragon"][letter.which]} size="14rem" style="position:absolute;left:0;top:0;pointer-events: none;" />
                                </div>
                            {/if}

                            <div
                                class=""
                                style="{inside === i ? 'background-color:#602060b0;' : 'background-color:#402040b0;'}position:absolute;left:0rem;top:{letter.which * 19}rem;width:{interp(
                                    34,
                                    51,
                                    occupied[i] - 1
                                )}rem;height:18rem;border-radius:0 4rem 4rem 0"
                            />
                            <EggSprites
                                icon={["dinosaur-1", "stegosaurus", "pterosaurus", "dragon-2"][letter.which]}
                                size="16rem"
                                style="position:absolute;left:1rem;top:{letter.which * 19}rem;pointer-events: none;"
                            />
                            <span class="text-white" style="position:absolute;left:18rem;top:{letter.which * 19}rem;font-size:10rem;line-height:1.1"
                                >{letter.letter}{occupied[i] === 2.0 ? letter.letter.toLowerCase() : ""}</span
                            >
                            <div style="position:absolute;left:35rem;top:{letter.which * 19 + 12}rem;width:14rem;XXXheight:6rem;border-radius:100%">
                                <SVGCache xml={nestXML} size="14rem" style="height:6rem" />
                            </div>
                        {/each}
                    {/if}
                </div>
                <StarBar {maxStars} {starCount} bg="#604060c0" on:pointerup={resetToSplashScreen} />
                <WinScreen {maxStars} active={finalGraphic} on:startGame={startGame} on:resetToSplashScreen={resetToSplashScreen} style="position:absolute;z-index:100;background-color:#00000080" />
            </div>
        {/if}
    </div>
</div>

<style>
</style>
