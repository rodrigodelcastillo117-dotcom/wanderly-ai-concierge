// Analytics de producto (PostHog). No-op si VITE_POSTHOG_KEY no está configurada.
import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";

let enabled = false;

export function initAnalytics() {
  if (enabled || !KEY) return;
  try {
    posthog.init(KEY, {
      api_host: HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      autocapture: false,
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
    posthog.capture(event, props);
  } catch {
    /* nunca romper la UI por analytics */
  }
}

export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (!enabled) return;
  try {
    posthog.identify(userId, props);
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
