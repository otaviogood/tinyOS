import { writable, get } from "svelte/store";

export const frameCount = writable(0);
export const animateCount = writable(0);

export class Animator {
    constructor(fps, tickFunc) {
        this.fps = fps;
        this.fpsInterval = 1000 / fps;
        this.lastDrawTime = 0;
        this.requestID = null;
        this.timingQueue = [];
        this.tqLen = 60;
        this.tickFunc = tickFunc;
    }

    animate(now) {
        this.requestID = requestAnimationFrame(this.animate.bind(this));

        // calc elapsed time since last loop
        var elapsed = now - this.lastDrawTime;

        this.timingQueue.push(elapsed);
        this.timingQueue = this.timingQueue.slice(-this.tqLen); // fifo queue and also Update svelte

        animateCount.set(get(animateCount) + 1);

        // if enough time has elapsed, draw the next frame
        let bailCount = 0;
        let totalTickInterval = 0;
        while (elapsed > this.fpsInterval) {
            // Get ready for next frame by setting lastDrawTime=now, but...
            // Also, adjust for fpsInterval not being multiple of 16.67
            let tickInterval = elapsed % this.fpsInterval;
            totalTickInterval += tickInterval;
            elapsed -= this.fpsInterval;

            this.tickFunc();

            frameCount.set(get(frameCount) + 1);
            bailCount++;
            if (bailCount > 5) {
                console.log("anim missed");
                break;
            }
            if (elapsed > this.fpsInterval * 20) {
                console.error("Anim too long without animation frame", elapsed, this.fpsInterval * 20)
                this.lastDrawTime = now;
                return;
            }
        }
        this.lastDrawTime = now - elapsed;
    }

    // Animation state/parameters
    start() {
        frameCount.set(0);
        animateCount.set(0);
        this.lastDrawTime = performance.now();
        this.timingQueue = [];

        if (this.requestID) cancelAnimationFrame(this.requestID);
        this.requestID = requestAnimationFrame(this.animate.bind(this));
    }

    stop() {
        if (this.requestID) cancelAnimationFrame(this.requestID);
    }
}
