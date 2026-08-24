import * as Sentry from "@sentry/react";

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
    // No enviamos PII automáticamente; el user se setea explícitamente al iniciar sesión.
    sendDefaultPii: false,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Failed to fetch dynamically imported module",
    ],
  });
}

export function setSentryUser(user: { id: string; email?: string | null } | null) {
  if (!sentryEnabled) return;
  Sentry.setUser(user ? { id: user.id, email: user.email ?? undefined } : null);
}

export { Sentry };
