import "./app.css";
import App from "./App.svelte";

import LogRocket from "logrocket";
if (window.location.host.indexOf("localhost") === -1) {
    LogRocket.init("ya0lem/tiny-quest", {
        release: "YAY v0.0.1",
        dom: {
            inputSanitizer: true,
            // textSanitizer: true,
        },
    });
}

const app = new App({
  target: document.getElementById("app"),
});

export default app;
