import { createRoot } from "react-dom/client";
import "./lib/browserCompat";
import { initSentry } from "./lib/sentry";
import { applyConsent } from "./lib/consent";
import { installExternalLinkHandler } from "./lib/externalLinks";
import { watchForNewVersion } from "./lib/versionCheck";
import { toast } from "sonner";
import App from "./App.tsx";
import "./index.css";

initSentry();
// PostHog y Travelpayouts solo se cargan si el usuario ya los aceptó en el CookieBanner.
applyConsent();
// Enlaces a otros sitios: siempre en pestaña nueva (src/lib/externalLinks.ts).
installExternalLinkHandler();

createRoot(document.getElementById("root")!).render(<App />);

// Versión nueva publicada mientras la pestaña estaba abierta: se ofrece actualizar (nunca a la fuerza).
watchForNewVersion(() => {
  toast("Hay una versión nueva de IATOS", {
    description: "Actualiza para ver lo más reciente.",
    duration: Infinity,
    action: { label: "Actualizar", onClick: () => window.location.reload() },
  });
});

// Registrar Service Worker para Web Push (silencioso si falla)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
