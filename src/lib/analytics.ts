// Analytics de producto (PostHog). No-op si VITE_POSTHOG_KEY no está configurada.
// Solo se inicia tras el consentimiento del usuario (ver lib/consent.ts y CookieBanner).
//
// posthog-js (~60 kB comprimido) se descarga con import() SOLO cuando hay llave y el usuario
// aceptó: antes iba en el paquete inicial de todas las visitas, aunque la mayoría nunca lo usara
// (E-23). Los eventos que llegan mientras se descarga se encolan y se envían al terminar.
import type { PostHog } from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let optedOut = false;
const queue: ((ph: PostHog) => void)[] = [];
const MAX_QUEUE = 50;

/** Ejecuta `fn` con PostHog ya cargado; si se está descargando, lo encola. Sin consentimiento: nada. */
function withClient(fn: (ph: PostHog) => void) {
  if (client) {
    try { fn(client); } catch { /* nunca romper la UI por analytics */ }
  } else if (loading && queue.length < MAX_QUEUE) {
    queue.push(fn);
  }
}

export function initAnalytics(load: () => Promise<{ default: PostHog }> = () => import("posthog-js")) {
  if (!KEY) return;
  optedOut = false;
  if (client) {
    // Re-aceptó después de haber rechazado en esta misma sesión.
    try { client.opt_in_capturing(); } catch { /* noop */ }
    return;
  }
  if (loading) return;
  loading = load()
    .then(({ default: posthog }) => {
      if (optedOut) return null;
      posthog.init(KEY, {
        api_host: HOST,
        person_profiles: "identified_only",
        capture_pageview: true,
        autocapture: false,
      });
      client = posthog;
      for (const fn of queue.splice(0)) {
        try { fn(posthog); } catch { /* noop */ }
      }
      return posthog;
    })
    .catch((e) => {
      console.warn("PostHog init falló:", e);
      queue.length = 0;
      loading = null;
      return null;
    });
}

export type AnalyticsEvent =
  | "signup"
  | "login"
  | "onboarding_completed"
  | "trip_quoted"
  | "concierge_message_sent"
  | "checkout_started"
  | "checkout_completed"
  | "affiliate_click";

export function track(event: AnalyticsEvent, props?: Record<string, unknown>) {
  withClient((ph) => ph.capture(event, props));
}

export function identifyUser(userId: string, props?: Record<string, unknown>) {
  withClient((ph) => ph.identify(userId, props));
}

export function resetAnalytics() {
  withClient((ph) => ph.reset());
}

/** Deja de enviar eventos (el usuario eligió "Solo esenciales"). */
export function optOutAnalytics() {
  optedOut = true;
  queue.length = 0;
  if (client) {
    try { client.opt_out_capturing(); } catch { /* noop */ }
  }
}
