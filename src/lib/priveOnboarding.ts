// Modelo de estado de la bienvenida y la guía de inicio de Privé. La fuente de verdad es el
// servidor (prive_memberships.welcome_version_seen y .onboarding, vía prive_status y
// prive-access → save_progress). Nunca localStorage: otro dispositivo debe ver lo mismo.
import type { PriveOnboarding, PriveStatus } from "@/lib/priveApi";
import { ONBOARDING_VERSION, WELCOME_VERSION } from "@/lib/priveCopy";

export const ONBOARDING_STEPS = 6;

/** La bienvenida se reproduce sola una vez por miembro y por versión. */
export const shouldAutoPlayWelcome = (s: Pick<PriveStatus, "welcome_version_seen">) =>
  s.welcome_version_seen < WELCOME_VERSION;

/** Paso donde reanudar la guía, o null si ya se terminó u omitió en la versión vigente. */
export function onboardingResumeStep(ob: PriveOnboarding | null | undefined): number | null {
  const o = ob ?? {};
  const sameVersion = o.version === ONBOARDING_VERSION;
  if (sameVersion && (o.completed_at || o.skipped_at)) return null;
  const step = sameVersion && typeof o.step === "number" && Number.isFinite(o.step) ? Math.floor(o.step) : 0;
  return Math.max(0, Math.min(ONBOARDING_STEPS - 1, step));
}

export function onboardingProgress(prev: PriveOnboarding | null | undefined, step: number, extra: Partial<PriveOnboarding> = {}): PriveOnboarding {
  return { ...(prev ?? {}), version: ONBOARDING_VERSION, step, ...extra };
}

export const onboardingCompleted = (prev: PriveOnboarding | null | undefined, now = new Date()): PriveOnboarding =>
  ({ ...(prev ?? {}), version: ONBOARDING_VERSION, step: ONBOARDING_STEPS - 1, completed_at: now.toISOString(), skipped_at: null });

export const onboardingSkipped = (prev: PriveOnboarding | null | undefined, step: number, now = new Date()): PriveOnboarding =>
  ({ ...(prev ?? {}), version: ONBOARDING_VERSION, step, skipped_at: now.toISOString() });
