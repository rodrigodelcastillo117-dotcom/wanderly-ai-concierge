import { createRoot } from "react-dom/client";
import "./lib/browserCompat";
import { initSentry } from "./lib/sentry";
import { applyConsent } from "./lib/consent";
import App from "./App.tsx";
import "./index.css";

initSentry();
// PostHog y Travelpayouts solo se cargan si el usuario ya los aceptó en el CookieBanner.
applyConsent();

createRoot(document.getElementById("root")!).render(<App />);

// Registrar Service Worker para Web Push (silencioso si falla)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
