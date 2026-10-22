/**
 * Monitoreo de errores de frontend.
 *
 * El DSN de Sentry es PÚBLICO (publishable) — se puede versionar sin riesgo.
 * Pega aquí el DSN de tu proyecto de Sentry (Settings → Projects → Client Keys)
 * o define VITE_SENTRY_DSN. Mientras esté vacío, Sentry queda desactivado y la app
 * funciona normal.
 *
 * @sentry/react (~70 kB comprimido) se descarga con import() solo si hay DSN: antes iba en el
 * paquete inicial de todas las visitas aunque estuviera desactivado (E-23). Lo que llega antes
 * de que termine de cargar (usuario, errores) se guarda y se envía al cargar.
 */
type SentryModule = typeof import("@sentry/react");

export const SENTRY_DSN: string =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? "";

export const sentryEnabled = Boolean(SENTRY_DSN);

let sentry: SentryModule | null = null;
let pendingUser: { id: string; email?: string } | null | undefined;
const pendingErrors: { error: unknown; extra?: Record<string, unknown> }[] = [];

export function initSentry(load: () => Promise<SentryModule> = () => import("@sentry/react")) {
  if (!sentryEnabled || sentry) return;
  load()
    .then((S) => {
      S.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        integrations: [S.browserTracingIntegration()],
        tracesSampleRate: 0.1,
        // No enviamos PII automáticamente; el user se setea explícitamente al iniciar sesión.
        sendDefaultPii: false,
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications",
          "Failed to fetch dynamically imported module",
        ],
      });
      sentry = S;
      if (pendingUser !== undefined) S.setUser(pendingUser);
      for (const e of pendingErrors.splice(0)) S.captureException(e.error, e.extra ? { extra: e.extra } : undefined);
    })
    .catch(() => {
      /* sin monitoreo: la app sigue igual */
    });
}

export function setSentryUser(user: { id: string; email?: string | null } | null) {
  if (!sentryEnabled) return;
  const u = user ? { id: user.id, email: user.email ?? undefined } : null;
  if (sentry) sentry.setUser(u);
  else pendingUser = u;
}

/** Reporta un error (p. ej. desde AppErrorBoundary). No-op sin DSN. */
export function captureException(error: unknown, extra?: Record<string, unknown>) {
  if (!sentryEnabled) return;
  if (sentry) sentry.captureException(error, extra ? { extra } : undefined);
  else if (pendingErrors.length < 20) pendingErrors.push({ error, extra });
}
