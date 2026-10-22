// Analytics de producto (PostHog). No-op si VITE_POSTHOG_KEY no está configurada.
// Solo se inicia tras el consentimiento del usuario (ver lib/consent.ts y CookieBanner).
import posthog from "posthog-js";
import { scrubCapture, stripPii } from "@/lib/piiScrub";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";

let enabled = false;

export function initAnalytics() {
  if (!KEY) return;
  if (enabled) {
    // Re-aceptó después de haber rechazado en esta misma sesión.
    try { posthog.opt_in_capturing(); } catch { /* noop */ }
    return;
  }
  try {
    posthog.init(KEY, {
      api_host: HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      autocapture: false,
      // Sin datos personales en propiedades de eventos ni en la persona (F-18).
      before_send: (event) => (event ? scrubCapture(event) : event),
    });
    enabled = true;
  } catch (e) {
    console.warn("PostHog init falló:", e);
  }
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
  if (!enabled) return;
  try {
    posthog.capture(event, props ? stripPii(props) : props);
  } catch {
    /* nunca romper la UI por analytics */
  }
}

/** Solo el id interno: el correo, el nombre o el teléfono no se mandan a PostHog (F-18). */
export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (!enabled) return;
  try {
    posthog.identify(userId, props ? stripPii(props) : undefined);
  } catch {
    /* noop */
  }
}

export function resetAnalytics() {
  if (!enabled) return;
  try {
    posthog.reset();
  } catch {
    /* noop */
  }
}

/** Deja de enviar eventos (el usuario eligió "Solo esenciales"). */
export function optOutAnalytics() {
  if (!enabled) return;
  try {
    posthog.opt_out_capturing();
  } catch {
    /* noop */
  }
}
