// Helpers de acceso PRO y cuota gratuita.
// Se ejecutan SOLO en el servidor con service_role (nunca se acepta esa key del cliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type QuotaKind, type QuotaOptions, type QuotaResult, runQuota } from "./quota.ts";
import type { ReservationDeps } from "./reservation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEYS") ??
  "";

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { QuotaKind, QuotaOptions, QuotaResult } from "./quota.ts";
export {
  freeLimitResponse,
  inProgressResponse,
  invalidRequestResponse,
  paywallResponse,
  quotaDeniedResponse,
  serviceUnavailableResponse,
  unauthenticatedResponse,
} from "./quota.ts";

/**
 * Consume una unidad de cuota gratuita. Si el usuario es PRO, siempre permite y no descuenta.
 * Llamar DESPUÉS de validar la entrada: una petición inválida no debe gastar la cuota.
 * Ante un error de verificación, trip_analysis niega (ver QuotaOptions.failClosed).
 */
export function consumeQuota(userId: string, kind: QuotaKind, opts: QuotaOptions = {}): Promise<QuotaResult> {
  return runQuota(
    (id, k) => adminClient().rpc("consume_free_quota", { _user_id: id, _kind: k }),
    userId,
    kind,
    opts,
  );
}

/**
 * Aparta una unidad de cuota (reserve_quota). Se confirma con commitQuota solo si el trabajo salió
 * bien y se libera con releaseQuota si falló. Ante un error de verificación, niega (fail-closed).
 */
export function reserveQuota(userId: string, kind: QuotaKind, requestKey: string): Promise<QuotaResult> {
  return runQuota(
    (id, k) => adminClient().rpc("reserve_quota", { _user_id: id, _kind: k, _request_key: requestKey }),
    userId,
    kind,
    { failClosed: true },
  );
}

/** Confirma la reserva. Nunca lanza: si falla, se registra y la reserva caduca sola (no se cobra). */
export async function commitQuota(
  reservationId: string,
  tripId: string | null = null,
  result: unknown = null,
): Promise<{ error: { message: string } | null }> {
  try {
    const { error } = await adminClient().rpc("commit_quota", { _reservation_id: reservationId, _trip_id: tripId, _result: result });
    if (error) console.error("commit_quota error:", error.message);
    return { error: error ? { message: error.message } : null };
  } catch (e) {
    console.error("commit_quota exception:", (e as Error).message);
    return { error: { message: (e as Error).message } };
  }
}

export async function releaseQuota(reservationId: string | null | undefined, reason: string) {
  if (!reservationId) return;
  try {
    const { error } = await adminClient().rpc("release_quota", { _reservation_id: reservationId, _reason: reason });
    if (error) console.error("release_quota error:", error.message);
  } catch (e) {
    console.error("release_quota exception:", (e as Error).message);
  }
}

/** Dependencias reales para runWithReservation (_shared/reservation.ts). */
export function reservationDeps(userId: string, kind: QuotaKind): ReservationDeps {
  return {
    reserve: (key) => reserveQuota(userId, kind, key),
    commit: (id, tripId, result) => commitQuota(id, tripId, result),
    release: (id, reason) => adminClient().rpc("release_quota", { _reservation_id: id, _reason: reason }),
  };
}

export type PlanLimit = {
  plan: "free" | "pro" | "trial";
  kind: string;
  period: "month" | "once" | "day" | "trial" | "active";
  /** null = ilimitado (o límite de PRO mientras pro_limits_enforced esté apagado). */
  limit: number | null;
  daily_limit: number | null;
  /** true = al pasarse se degrada (p. ej. precios en caché) en vez de bloquear. */
  soft: boolean;
  enforced: boolean;
};

/**
 * Límite configurado en public.plan_limits para este usuario y tipo (price_watches,
 * tracked_flights, live_searches...). Aún NO se aplica en esas funciones: es para el paso que las
 * conecte. Devuelve null si no se pudo leer (quien lo use decide si falla abierto o cerrado).
 */
export async function planLimit(userId: string, kind: string): Promise<PlanLimit | null> {
  try {
    const { data, error } = await adminClient().rpc("plan_limit", { _user_id: userId, _kind: kind });
    if (error) {
      console.error("plan_limit error:", error.message);
      return null;
    }
    return data as PlanLimit;
  } catch (e) {
    console.error("plan_limit exception:", (e as Error).message);
    return null;
  }
}

/** ¿Es PRO? Ante un error responde false (fail-closed): no se regala acceso de pago por una caída. */
export async function isPro(userId: string): Promise<boolean> {
  try {
    const { data, error } = await adminClient().rpc("is_pro", { _user_id: userId });
    if (error) {
      console.error("is_pro error:", error.message);
      return false;
    }
    return Boolean(data);
  } catch (e) {
    console.error("is_pro exception:", (e as Error).message);
    return false;
  }
}
