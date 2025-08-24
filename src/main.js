import "./app.css";
import App from "./App.svelte";

import LogRocket from "logrocket";
// Only initialize LogRocket in production builds to avoid any dev-time network beacons
if (import.meta && import.meta.env && import.meta.env.PROD) {
    LogRocket.init("ya0lem/tiny-quest", {
        release: "YAY v0.0.1",
        dom: {
            inputSanitizer: true,
            // textSanitizer: true,
        },
        network: {
            isEnabled: false,
            requestSanitizer: (request) => {
                const url = String(request?.url || "");
                const baseUrl = url.split('#')[0].split('?')[0];
                // Drop large/binary/static assets and known heavy routes
                if (/\.(gltf|glb|bin|wasm|png|jpe?g|webp|gif|mp3|wav|ogg|mp4|webm|zip)$/i.test(baseUrl)) return null;
                if (/\/apps\//i.test(baseUrl)) return null;
                if (/\/public\//i.test(baseUrl)) return null;
                if (/\/apps\/bricks|\/TinyQuest|\/LDCadShadowLibrary/i.test(url)) return null;

                // Truncate oversized request bodies
                if (typeof request.body === "string" && request.body.length > 200000) {
                    return { ...request, body: request.body.slice(0, 200000) + "… [truncated]" };
                }
                return request;
            },
            responseSanitizer: (response) => {
                const ct = String((response?.headers?.["content-type"] || response?.headers?.["Content-Type"] || "")).toLowerCase();

                // Drop large/binary/static assets and known heavy routes
                if (/image|audio|video|octet-stream|font|application\/wasm/.test(ct)) return null;
                // If headers are missing, fall back to body truncation below

                // Truncate oversized response bodies
                if (typeof response.body === "string" && response.body.length > 200000) {
                    return { ...response, body: response.body.slice(0, 200000) + "… [truncated]" };
                }
                return response;
            },
        },
    });
}

const app = new App({
  target: document.getElementById("app"),
});

export default app;
