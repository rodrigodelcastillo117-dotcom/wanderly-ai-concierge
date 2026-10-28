// Consentimiento de cookies/analítica.
//
// Por qué: el banner decía "solo almacenamiento esencial", pero PostHog se iniciaba al
// arrancar y el script de Travelpayouts se cargaba desde index.html en todas las
// páginas, ANTES de cualquier elección. Ahora ninguno de los dos se carga hasta que el
// usuario acepta; si elige "Solo esenciales", nunca se cargan.
import { initAnalytics, optOutAnalytics } from "@/lib/analytics";

export type ConsentChoice = "accepted" | "essential";

const KEY = "iatos_cookie_consent_v2";
export const CONSENT_EVENT = "iatos:consent-changed";
export const OPEN_SETTINGS_EVENT = "iatos:open-cookie-settings";

// Script de medición de conversiones de afiliado (Travelpayouts Drive).
export const TRAVELPAYOUTS_SRC = "https://tp-em.com/NTMzMjk5.js?t=533299";

/**
 * Travelpayouts Drive se carga SOLO si el dueño lo activa (VITE_TRAVELPAYOUTS_DRIVE_ENABLED=true) después
 * de verificar traveliatos.life en el proyecto 533299 de Travelpayouts (docs/ops/LEEME.md).
 *
 * Por qué (auditoría de cuenta #3, 28-oct): al aceptar cookies, el script pedía su configuración a
 * tp-em.com/entrypoint_config y la respuesta era 403 sin CORS: errores rojos en la consola ("blocked by
 * CORS policy", "config is not valid") y ninguna medición. Ese fallo de red lo registra el navegador y no
 * se puede atrapar desde la página, y cualquier prueba previa desde el navegador también lo registraría;
 * por eso la carga queda detrás de esta llave hasta confirmar que Travelpayouts responde a nuestro dominio.
 * Los enlaces de afiliado (con su marker) no dependen de este script y siguen funcionando.
 */
export function travelpayoutsDriveEnabled(env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>): boolean {
  return String(env?.VITE_TRAVELPAYOUTS_DRIVE_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function getConsent(): ConsentChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "accepted" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(choice: ConsentChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* sin almacenamiento: la elección vale solo para esta visita */
  }
  applyConsent(choice);
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
  } catch {
    /* noop */
  }
}

export function loadTravelpayouts(doc: Document = document) {
  if (doc.querySelector(`script[data-iatos="travelpayouts"]`)) return;
  const script = doc.createElement("script");
  script.async = true;
  script.src = TRAVELPAYOUTS_SRC;
  script.dataset.iatos = "travelpayouts";
  // Si el script no carga, se quita sin más (no reintenta en esta visita).
  script.onerror = () => { script.remove(); };
  doc.head.appendChild(script);
}

/** Carga (o no) los terceros según la elección guardada. Se llama al arrancar la app. */
export function applyConsent(choice: ConsentChoice | null = getConsent()) {
  if (choice === "accepted") {
    initAnalytics();
    if (travelpayoutsDriveEnabled()) loadTravelpayouts();
  } else if (choice === "essential") {
    // Si antes aceptó y ahora se retracta, dejamos de capturar en esta sesión.
    optOutAnalytics();
  }
}

export function openCookieSettings() {
  try {
    window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
  } catch {
    /* noop */
  }
}
