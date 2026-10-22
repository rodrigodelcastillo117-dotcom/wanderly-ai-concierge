// Reserva → confirmación → liberación del cupo de análisis (IATOS-P1-FREE-02), sin dependencias
// de Deno: se prueba con Vitest inyectando las dependencias.
//
// El cupo se aparta al empezar (reserve_quota), se CONFIRMA solo si el resultado cumple el contrato
// mínimo y quedó guardado (commit_quota) y se LIBERA ante cualquier fallo: timeout, error 500, caída
// de la IA o de un proveedor, datos insuficientes, resultado parcial o error al guardar.
import type { QuotaResult } from "./quota.ts";

export type ReservationDeps = {
  reserve(requestKey: string): Promise<QuotaResult>;
  commit(reservationId: string, tripId: string | null, result: unknown): PromiseLike<{ error: { message: string } | null }>;
  release(reservationId: string, reason: string): PromiseLike<{ error: { message: string } | null }>;
};

export type WorkCtx = {
  /** Llamar justo antes de guardar. false = se acabó el tiempo: no guardar nada. */
  beginPersist(): boolean;
  readonly cancelled: boolean;
};

export type WorkResult =
  | { ok: true; tripId: string | null; result?: unknown; response: Response }
  | { ok: false; reason: string; response?: Response };

export type ReservationOutcome =
  | { type: "ok"; response: Response }
  | { type: "replay"; tripId: string | null; result: unknown }
  | { type: "denied"; quota: QuotaResult }
  | { type: "failed"; reason: string; response?: Response };

export const ANALYSIS_TIMEOUT_MS = 240_000;

async function safeRelease(deps: ReservationDeps, id: string, reason: string) {
  try {
    const { error } = await deps.release(id, reason);
    // Si falla, la reserva caduca sola a los 10 minutos: el usuario no pierde el beneficio.
    if (error) console.error("release_quota error:", id, reason, error.message);
  } catch (e) {
    console.error("release_quota exception:", id, reason, (e as Error).message);
  }
}

async function safeCommit(deps: ReservationDeps, id: string, tripId: string | null, result: unknown) {
  for (let i = 0; i < 2; i++) {
    try {
      const { error } = await deps.commit(id, tripId, result);
      if (!error) return true;
      console.error("commit_quota error:", id, error.message);
    } catch (e) {
      console.error("commit_quota exception:", id, (e as Error).message);
    }
  }
  // El viaje ya se entregó: se responde igual. La reserva caduca y queda en el diagnóstico.
  return false;
}

export async function runWithReservation(
  deps: ReservationDeps,
  requestKey: string,
  work: (ctx: WorkCtx) => Promise<WorkResult>,
  opts: { timeoutMs?: number } = {},
): Promise<ReservationOutcome> {
  const quota = await deps.reserve(requestKey);
  if (quota.reason === "replay") return { type: "replay", tripId: quota.trip_id ?? null, result: quota.result ?? null };
  if (!quota.allowed || !quota.reservation_id) return { type: "denied", quota };
  const id = quota.reservation_id;

  let timedOut = false;
  let persisting = false;
  const ctx: WorkCtx = {
    beginPersist: () => {
      if (timedOut) return false;
      persisting = true;
      return true;
    },
    get cancelled() {
      return timedOut;
    },
  };

  const workP: Promise<WorkResult> = work(ctx).catch((e) => {
    console.error("análisis falló con excepción:", (e as Error)?.message ?? e);
    return { ok: false, reason: "exception" } as WorkResult;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<"timeout">((res) => {
    timer = setTimeout(() => res("timeout"), opts.timeoutMs ?? ANALYSIS_TIMEOUT_MS);
  });

  let out: WorkResult | "timeout" = await Promise.race([workP, timeoutP]);
  if (timer) clearTimeout(timer);
  if (out === "timeout") {
    if (persisting) {
      // Ya estaba guardando: esperamos a que termine para no dejar un viaje sin confirmar.
      out = await workP;
    } else {
      timedOut = true;
      await safeRelease(deps, id, "timeout");
      return { type: "failed", reason: "timeout" };
    }
  }

  if (out.ok) {
    await safeCommit(deps, id, out.tripId, out.result ?? null);
    return { type: "ok", response: out.response };
  }
  // (cast explícito: el tsconfig del frontend no es strict y no estrecha la unión por `ok`)
  const failed = out as Extract<WorkResult, { ok: false }>;
  await safeRelease(deps, id, failed.reason);
  return { type: "failed", reason: failed.reason, response: failed.response };
}

/**
 * Llave de idempotencia. 'c:' = la manda el cliente (una por intento, guardada en sessionStorage):
 * permite devolver el viaje ya guardado si se perdió la respuesta. Sin llave válida, 'd:' derivada
 * de los datos del viaje: evita el doble clic, pero nunca devuelve un viaje viejo.
 */
export function resolveRequestKey(raw: unknown, parts: unknown[]): string {
  if (typeof raw === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(raw)) return `c:${raw}`;
  const norm = parts
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .map((p) => p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim())
    .join("|");
  return `d:${norm}`.slice(0, 280);
}

const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;

/** Contrato mínimo de un análisis de un destino para cobrarlo. */
export function analysisMeetsContract(a: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!a || typeof a !== "object") return { ok: false, missing: ["respuesta"] };
  if (!nonEmpty(a.itinerario)) missing.push("itinerario");
  if (!(Number(a.total_estimado) > 0)) missing.push("total_estimado");
  if (!nonEmpty(a.vuelos) && !nonEmpty(a.hospedaje)) missing.push("vuelos_u_hospedaje");
  return { ok: missing.length === 0, missing };
}

/** Contrato mínimo del plan multi-ciudad: itinerario, total y logística en TODAS las ciudades. */
export function logisticsMeetsContract(l: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!l || typeof l !== "object") return { ok: false, missing: ["respuesta"] };
  if (!nonEmpty(l.days)) missing.push("days");
  if (!(Number(l.total_estimado_mxn) > 0)) missing.push("total_estimado_mxn");
  const per = Array.isArray(l.per_destination) ? l.per_destination : [];
  if (!per.length) missing.push("per_destination");
  per.forEach((pd: any) => {
    if (!nonEmpty(pd?.hospedaje) && !nonEmpty(pd?.arrival_options)) missing.push(`ciudad:${pd?.city ?? "?"}`);
  });
  return { ok: missing.length === 0, missing };
}
