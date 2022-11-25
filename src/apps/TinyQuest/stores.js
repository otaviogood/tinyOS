import { writable } from "svelte/store";
import { get } from "svelte/store";
import { tweened } from "svelte/motion";
import { cubicInOut } from "svelte/easing";

// **************************************************************************************************
// We have to remember to manually reset any game vars because we will hold state as we change pages.
// **************************************************************************************************

export const earnedStar = writable(false);
export const currentTownIndex = writable(null);

// animated - start out as null so it doesn't animate in from 0.0
export const currentX = tweened(null, { duration: 2000, easing: cubicInOut });
export const currentY = tweened(null, { duration: 2000, easing: cubicInOut });
export const animInterp = tweened(0.0, { duration: 2000, easing: cubicInOut });

export const allTowns = writable([]);
