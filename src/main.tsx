import { createRoot } from "react-dom/client";
import "./lib/browserCompat";
import { initSentry } from "./lib/sentry";
import { initAnalytics } from "./lib/analytics";
import App from "./App.tsx";
import "./index.css";

initSentry();
initAnalytics();

createRoot(document.getElementById("root")!).render(<App />);

// Registrar Service Worker para Web Push (silencioso si falla)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
