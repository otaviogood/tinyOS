import { writable } from "svelte/store";
import { isPhone } from "./utils";

export const uid = writable("");
export const username = writable("");
export const userData = writable(null);
export const userDocRef = writable(null);

export const phoneScreen = writable(isPhone());
export const headerHeight = writable(isPhone() ? 70 : 52);

export const firebaseApp = writable(null);

// For Fast2d
export const timer = writable(new Map());

// 0 - force lower case
// 1 - force upper case
// 2 - not strict mixed case
// 3 - strict mixed case
export const casing = writable(0);