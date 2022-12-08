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
