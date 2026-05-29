import { createRoot } from "react-dom/client";
import "./lib/browserCompat";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Registrar Service Worker para Web Push (silencioso si falla)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
