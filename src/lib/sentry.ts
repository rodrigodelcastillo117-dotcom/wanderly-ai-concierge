import * as Sentry from "@sentry/react";
import { scrubBreadcrumb, scrubSentryEvent } from "@/lib/piiScrub";

/**
 * Monitoreo de errores de frontend.
 *
 * El DSN de Sentry es PÚBLICO (publishable) — se puede versionar sin riesgo.
 * Pega aquí el DSN de tu proyecto de Sentry (Settings → Projects → Client Keys)
 * o define VITE_SENTRY_DSN. Mientras esté vacío, Sentry queda desactivado y la app
 * funciona normal.
 */
export const SENTRY_DSN: string =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? "";

export const sentryEnabled = Boolean(SENTRY_DSN);

export function initSentry() {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    // Sin PII (F-18): solo el id del usuario; correos y tokens se tapan en eventos y breadcrumbs.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Failed to fetch dynamically imported module",
    ],
  });
}

/** Solo el id interno del usuario (nunca el correo). */
export function setSentryUser(user: { id: string } | null) {
  if (!sentryEnabled) return;
  Sentry.setUser(user ? { id: user.id } : null);
}

export { Sentry };
