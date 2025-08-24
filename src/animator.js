import { writable } from "svelte/store";

export const frameCount = writable(0);
export const animateCount = writable(0);

export class Animator {
    constructor(fps, tickFunc) {
        this.fps = Number.isFinite(fps) && fps > 0 ? fps : 60;
        this.fpsIntervalMs = 1000 / this.fps;
        this.lastDrawTimeMs = 0;
        this.requestID = null;
        this.timingQueue = [];
        this.tqLen = 60;
        this.tickFunc = tickFunc;

        // this.frameCount = 0;
        // this.animateCount = 0;

        this.subscribers = new Set();
        this._animate = this.animate.bind(this);
    }

    subscribe(tickFunction, debug) {
        this.subscribers.add(tickFunction);
        // if (debug) console.log("SUBSCRIBED ", debug, this.subscribers);
        // auto-resume if previously idle
        if (!this.requestID) {
            this.lastDrawTimeMs = performance.now();
            this.requestID = requestAnimationFrame(this._animate);
        }
    }
    unsubscribe(tickFunction) {
        // console.log("***UN*** SUBSCRIBED");
        this.subscribers.delete(tickFunction);
        // auto-stop if no work left
        if (this.subscribers.size === 0 && !this.tickFunc && this.requestID) {
            cancelAnimationFrame(this.requestID);
            this.requestID = null;
        }
    }

    animate(now) {
        // Short-circuit when idle (no tick function and no subscribers)
        if (!this.tickFunc && this.subscribers.size === 0) {
            if (this.requestID) {
                cancelAnimationFrame(this.requestID);
                this.requestID = null;
            }
            this.lastDrawTimeMs = now;
            return;
        }

        this.requestID = requestAnimationFrame(this._animate);

        // calc elapsed time since last loop
        var elapsed = now - this.lastDrawTimeMs;

        if (this.tickFunc || this.subscribers.size > 0) {
            this.timingQueue.push(elapsed);
            this.timingQueue = this.timingQueue.slice(-this.tqLen); // fifo queue and also Update svelte

            animateCount.update(n => n + 1);

            // if enough time has elapsed, draw the next frame
            let bailCount = 0;
            while (elapsed >= this.fpsIntervalMs) {
                // Get ready for next frame by setting lastDrawTimeMs=now, but...
                // Also, adjust for fpsIntervalMs not being multiple of 16.67
                elapsed -= this.fpsIntervalMs;

                if (this.tickFunc) this.tickFunc();
                // loop through set and call all functions
                this.subscribers.forEach((tickFunction) => {
                    tickFunction(this.fpsIntervalMs * 0.001);
                });

                frameCount.update(n => n + 1);
                bailCount++;
                if (bailCount > 5) {
                    console.log("anim missed");
                    this.lastDrawTimeMs = now;
                    break;
                }
                if (elapsed > this.fpsIntervalMs * 20) {
                    console.warn(
                        "Anim too long without animation frame: " + elapsed.toFixed(1) + " / " + this.fpsIntervalMs.toFixed(1)
                    );
                    this.lastDrawTimeMs = now;
                    return;
                }
            }
        }
        this.lastDrawTimeMs = now - elapsed;
    }

    // Animation state/parameters
    start() {
        frameCount.set(0);
        animateCount.set(0);
        this.lastDrawTimeMs = performance.now();
        this.timingQueue = [];

        if (this.requestID) cancelAnimationFrame(this.requestID);
        this.requestID = requestAnimationFrame(this._animate);
    }

    stop() {
        if (this.requestID) cancelAnimationFrame(this.requestID);
        this.requestID = null;
    }
}
