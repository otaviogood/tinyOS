/*******************************************************************************************************
A simple dynamic router that uses Vite's import.meta.glob to auto-discover *.svelte files in /apps and
/apps/TinyQuest. It implements push() and pop() for navigation and listens to hash changes so that any
existing svelte-spa-router–style functionality should continue to work.

Usage Example:
--------------------------------------------------------------------------------
<!-- main.js (or similar entry) -->
import Router, { push, pop } from './router.js';
import App from './App.svelte';

const app = new App({
  target: document.body,
  props: {
    Router,
    push,
    pop
  }
});
--------------------------------------------------------------------------------
Then in your App.svelte (or wherever you're currently using svelte-spa-router),
replace svelte-spa-router features with references to this Router store/logic.
*******************************************************************************************************/

import { writable } from 'svelte/store';

// 1) Create a store to hold the current "path" (mimicking hash-based routing).
export const currentRoute = writable(getHashRoute());

// 2) Listen to hash changes, update currentRoute whenever the hash changes (mimics svelte-spa-router).
window.addEventListener('hashchange', () => {
  currentRoute.set(getHashRoute());
});

// 3) A helper to extract a normalized path from the current hash.
function getHashRoute() {
  const route = window.location.hash.replace(/^#/, '').replace(/\/+$/, '') || '/';
  return route;
}

// 4) push() and pop() to mimic svelte-spa-router's "navigate()" and default back button behavior.
export function push(path) {
  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  window.history.pushState({}, '', '#' + path);
  window.dispatchEvent(new Event('hashchange'));
}

export function pop() {
  window.history.back();
}

/*******************************************************************************************************
 Dynamic Imports via Vite's import.meta.glob

 This will grab any .svelte file under /apps (including TinyQuest subfolder).
 The object keys look like "./apps/Camera.svelte", "./apps/TinyQuest/MapScreen.svelte", etc.

 We then map them into a route resolution function that tries to match the "folder/file" pattern to
 your route (e.g. "/camera" -> "./apps/Camera.svelte", "/tinyquest/mapscreen" -> "./apps/TinyQuest/MapScreen.svelte").
 If there's a subfolder containing an identically named component, e.g. "./apps/MusicSequencer/MusicSequencer.svelte",
 then going to "/musicsequencer" will load that.
*******************************************************************************************************/
const discoveredModules = import.meta.glob([
  './apps/**/*.svelte',  // This catches everything including subfolders
]);

// 5) Our NotFound fallback component. You can create your own or modify as you desire.
let NotFound = null;
try {
  // If you have a NotFound.svelte in apps, we can pick it up automatically
  NotFound = discoveredModules['./apps/NotFound.svelte'];
} catch (e) {
  // Otherwise do nothing, we'll handle it below
}

/*******************************************************************************************************
 getComponentForRoute(route) is our main resolution function:
  - Normalizes the route to something like "/camera" or "/tinyquest/mapscreen"
  - Tries direct matching with and without subfolder pattern
    → e.g. "/MusicSequencer" might match ./apps/MusicSequencer/MusicSequencer.svelte
    → e.g. "/camera" might match ./apps/Camera.svelte
  - If not found, returns NotFound (if present) or null
*******************************************************************************************************/
// A better capitalize helper that preserves camelCase
function capitalize(str) {
  if (!str) return str;
  
  // Split on any existing capitals, preserving them
  const parts = str.split(/(?=[A-Z])/);
  
  // Capitalize first letter of first part, keep rest of first part lowercase
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  
  // Join it all back together (other parts keep their original case)
  return parts.join('');
}

async function getComponentForRoute(route) {
  // Clean up the route but DON'T lowercase it
  route = route.replace(/\/+$/, '');
  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  // Handle root route
  if (route.toLowerCase() === '/') {
    const mainKey = './apps/Main.svelte';
    if (mainKey in discoveredModules) {
      const module = await discoveredModules[mainKey]();
      return module.default;
    }
  }

  // Split route into segments and remove empty ones
  // Don't lowercase here anymore - preserve the case for processing
  const routeSegments = route.split('/').filter(Boolean);
  
  const attempts = [];
  
  // 1. Direct match (for simple apps like Timer.svelte)
  attempts.push('./apps/' + routeSegments.map(s => capitalize(s)).join('/') + '.svelte');
  
  // 2. Subfolder match (for apps like MusicSequencer/MusicSequencer.svelte)
  if (routeSegments.length === 1) {
    const name = capitalize(routeSegments[0]);
    attempts.push(`./apps/${name}/${name}.svelte`);
  }
  
  // 3. Nested subfolder match (for apps like TinyQuest/Dungeon/Dungeon.svelte)
  if (routeSegments.length > 1) {
    const lastSegment = capitalize(routeSegments[routeSegments.length - 1]);
    const parentPath = routeSegments.slice(0, -1).map(s => capitalize(s)).join('/');
    attempts.push(`./apps/${parentPath}/${lastSegment}/${lastSegment}.svelte`);
  }

  // Try each attempt in order, but make case-insensitive comparisons
  for (const attempt of attempts) {
    // Find a case-insensitive match in discoveredModules
    const match = Object.keys(discoveredModules).find(
      key => key.toLowerCase() === attempt.toLowerCase()
    );
    if (match) {
      const module = await discoveredModules[match]();
      return module.default;
    }
  }

  // Fallback to NotFound
  if (NotFound) {
    const notFoundModule = await NotFound();
    return notFoundModule.default;
  }
  
  return null;
}

/*******************************************************************************************************
 Finally, we export a Svelte store that provides { component, route } so you can <svelte:component> it.

 Example usage in your main layout (pseudo-code):
 ------------------------------------------------
 <script>
   import { Router } from "./router.js";
 </script>

 <svelte:component this={$Router.component} {Router} />
------------------------------------------------
*******************************************************************************************************/
export const Router = (() => {
  const { subscribe } = writable({ component: null, route: '' });

  // We subscribe to currentRoute changes and dynamically import the matching .svelte module.
  currentRoute.subscribe(async (newRoute) => {
    const component = await getComponentForRoute(newRoute);
    routeStore.set({ component, route: newRoute });
  });

  // We keep an internal store so that each update sets { component, route }.
  const routeStore = writable({ component: null, route: '' });

  return {
    subscribe: routeStore.subscribe
  };
})();