import { get } from "svelte/store";
import { writable } from "svelte/store";

export const invAspectRatio = 0.75; // mapHeight / mapWidth; // Height divided by width is a nice number like .75, but the inverse is not happy like 1.33333333333333

export const fullWidth = writable(1024);
export const fullHeight = writable(768);

export const landscape = writable(true); // landscape or portrait

export const bigWidth = writable();
export const bigHeight = writable();
export const bigScale = writable();
export const bigPadX = writable();
export const bigPadY = writable();

export function handleResize() {
    let fw = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    let fh = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
    fullWidth.set(fw);
    fullHeight.set(fh);
    // this component is scroll/zoom fixed  (as opposed to intro)
    // not doing so introduces problems on iOS since we disable scrolling from now on
    // document.getElementsByTagName("BODY")[0].style.height = fh + "px";
    let l = invAspectRatio > fh / fw;
    landscape.set(l);

    bigWidth.set(l ? (fh / invAspectRatio).toString() + "px" : "100%");
    bigHeight.set(l ? "100%" : (fw * invAspectRatio).toString() + "px");
    let bs = l ? fh / invAspectRatio : fw;
    bigScale.set(bs);
    let bigScaleY = l ? fh : fw * invAspectRatio;
    let bpx = (fw - bs) / 2;
    let bpy = (fh - bigScaleY) / 2;
    bigPadX.set(bpx);
    bigPadY.set(bpy);

    document.documentElement.style.setProperty("--big-scale", Math.floor(bs) + "px");
    document.documentElement.style.setProperty("--bigpadx", Math.floor(bpx) + "px");
    document.documentElement.style.setProperty("--bigpady", Math.floor(bpy) + "px");
}
