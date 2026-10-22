// Límites de "activos a la vez" (alertas de precio, vuelos seguidos) leídos de plan_limits con
// planLimit(). Sin dependencias de Deno: se prueba con Vitest (src/test/planGate.test.ts).
//
// Misma regla que concierge/trip_analysis (pagos): FREE siempre se aplica; PRO solo con
// app_flags.pro_limits_enforced (si no, plan_limit() devuelve limit=null); TRIAL siempre.
// Además hay un tope duro de seguridad que nunca se pasa, aunque el plan sea ilimitado.

import { freeLimitBody, type FreeLimitBody, type PlanLimitKind } from "./quota.ts";

/** Lo que devuelve public.plan_limit() (ver entitlements.ts → PlanLimit). */
export type PlanLimitInfo = {
  plan: "free" | "pro" | "trial";
  limit: number | null;
};

export type ActiveDecision =
  | { allowed: true; limit: number }
  /** No se pudo leer el plan: se niega sin culpar al usuario (503), no se regala acceso. */
  | { allowed: false; kind: "unavailable" }
  | { allowed: false; kind: "limit"; body: FreeLimitBody };

export function activeLimitDecision(
  kind: Extract<PlanLimitKind, "price_watches" | "tracked_flights">,
  rule: PlanLimitInfo | null,
  activeCount: number,
  hardCap: number,
): ActiveDecision {
  if (!rule || (rule.plan !== "free" && rule.plan !== "pro" && rule.plan !== "trial")) return { allowed: false, kind: "unavailable" };
  const planLimit = typeof rule.limit === "number" && rule.limit >= 0 ? rule.limit : null;
  const limit = planLimit === null ? hardCap : Math.min(planLimit, hardCap);
  if (activeCount < limit) return { allowed: true, limit };
  return {
    allowed: false,
    kind: "limit",
    body: freeLimitBody(kind, {
      quota: kind === "price_watches" ? "price_watches_active" : "tracked_flights_active",
      limit,
      used: activeCount,
      renews_at: null,
      // Un PRO que llega a su máximo no recibe oferta de "mejorar"; FREE y la prueba sí.
      upgrade_available: rule.plan !== "pro",
    }),
  };
}
