// Bolsa de búsquedas en vivo por usuario (plan_limits.live_searches). Sin dependencias de Deno: se
// prueba con Vitest. La base decide (live_search_take) y aquí se traduce a lo que ve el usuario.
//   FREE  → tope duro al día (5): sin más búsquedas en vivo; se responde FREE_LIMIT_REACHED si no
//           hay otra fuente gratuita (caché vigente o Travelpayouts).
//   TRIAL → tope duro de la prueba (30), igual que FREE.
//   PRO   → uso justo (80 al mes, solo con pro_limits_enforced): nunca se bloquea; se sirve el
//           último precio guardado marcado como tal ("precio guardado", estado OBSOLETO).
// Los análisis de viaje (analizar-viaje, logistics-plan) tienen su propia cuota y no gastan de aquí
// (ver internalCall.ts). Los mensajes de Iato sí: sus herramientas llaman a estas funciones.

import { freeLimitBody, type FreeLimitBody } from "./quota.ts";
import { cacheProvenance, type GateDecision, type LiveGate, type SerpTrace } from "./serpCache.ts";
import { frescuraPrecio } from "./priceFreshness.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

/**
 * Antes de cada búsqueda real: aparta 1 en la base. Si la base no responde se permite (falla
 * abierta: una búsqueda cuesta centavos y el límite de ritmo sigue activo), pero se registra.
 */
export function makeLiveSearchGate(rpc: Rpc, userId: string, log: (...a: unknown[]) => void = console.error): LiveGate {
  return async (): Promise<GateDecision> => {
    try {
      const { data, error } = await rpc("live_search_take", { _user_id: userId, _units: 1 });
      const r = data as { allowed?: unknown; soft?: unknown; plan?: unknown } | null;
      if (error || !r || typeof r.allowed !== "boolean") {
        log("live_search_take falló; se permite la búsqueda:", error?.message ?? "respuesta inesperada");
        return { allow: true };
      }
      if (r.allowed) {
        const plan = typeof r.plan === "string" ? r.plan : "free";
        return {
          allow: true,
          refund: async () => {
            const { error: e } = await rpc("live_search_refund", { _user_id: userId, _plan: plan, _units: 1 });
            if (e) log("live_search_refund falló:", e.message);
          },
        };
      }
      return { allow: false, soft: r.soft === true, info: r as Record<string, unknown> };
    } catch (e) {
      log("live_search_take excepción; se permite la búsqueda:", (e as Error)?.message);
      return { allow: true };
    }
  };
}

/** Cuerpo FREE_LIMIT_REACHED para un tope duro de búsquedas en vivo. */
export function liveSearchLimitBody(info: Record<string, unknown> | undefined): FreeLimitBody {
  return freeLimitBody("live_searches", (info ?? {}) as Parameters<typeof freeLimitBody>[1]);
}

export const FAIR_USE_EMPTY =
  "Por uso justo ya no hacemos más búsquedas en vivo este mes para tu cuenta y no tenemos un precio guardado para esta búsqueda. Se renueva el día 1; mientras tanto puedes buscar directo con el enlace.";

export const FAIR_USE_NOTICE =
  "Por uso justo te mostramos precios guardados (no en vivo) hasta el día 1. Verifícalos antes de reservar.";

export const PAUSED_NOTICE =
  "Las búsquedas de precios en vivo están en pausa por ahora. Te mostramos el último precio guardado o un precio de referencia, con su fecha: verifícalo antes de reservar.";

export const PAUSED_EMPTY =
  "Las búsquedas de precios en vivo están en pausa por ahora y no tenemos un precio guardado para esta búsqueda. Puedes buscar directo con el enlace.";

export type LiveLimitOutcome =
  | { kind: "ok" }
  /** Tope duro y no hay nada que mostrar: 402 FREE_LIMIT_REACHED. */
  | { kind: "blocked"; body: FreeLimitBody }
  /** Se responde con lo que sí hubo (caché vigente, Travelpayouts) + un aviso. */
  | { kind: "notice"; message: string }
  /** Uso justo de PRO sin precio guardado: 200 "no disponible", nunca 402. */
  | { kind: "fair_use_empty"; message: string }
  /** La cuenta de SerpApi está en pausa (presupuesto o cuota) y no hubo nada que mostrar. */
  | { kind: "paused_empty"; message: string };

/** Qué responder según lo que pasó con el límite y cuántos resultados hay. */
export function liveLimitOutcome(trace: SerpTrace, resultCount: number): LiveLimitOutcome {
  const d = trace.denied;
  if (!d) {
    if (!trace.paused) return { kind: "ok" };
    return resultCount > 0 ? { kind: "notice", message: PAUSED_NOTICE } : { kind: "paused_empty", message: PAUSED_EMPTY };
  }
  if (d.soft) return resultCount > 0 ? { kind: "notice", message: FAIR_USE_NOTICE } : { kind: "fair_use_empty", message: FAIR_USE_EMPTY };
  const body = liveSearchLimitBody(d.info);
  return resultCount > 0 ? { kind: "notice", message: body.message } : { kind: "blocked", body };
}

/**
 * Cierra la respuesta de flights-search / hotels-search: fecha real de consulta y estado del dato
 * (si salió de la caché o es un precio guardado) y lo que corresponda por el límite del plan.
 */
export function finalizeSearchResponse(
  out: { status: number; body: Record<string, unknown> },
  trace: SerpTrace,
  now = Date.now(),
): { status: number; body: Record<string, unknown> } {
  const count = Array.isArray(out.body.results) ? out.body.results.length : 0;
  const outcome = liveLimitOutcome(trace, count);
  if (outcome.kind === "blocked") return { status: 402, body: outcome.body as unknown as Record<string, unknown> };
  const body: Record<string, unknown> = { ...out.body };
  if (body.source === "serpapi" && trace.hits + trace.stale + trace.live > 0) {
    const p = cacheProvenance(trace, now);
    body.consulted_at = p.fetched_at;
    body.estado_dato = p.estado_dato;
    body.precio_guardado = p.precio_guardado;
    body.from_cache = p.from_cache;
    body.cache_max_age_h = Math.round((p.cache_age_seconds / 3600) * 10) / 10;
  }
  // Frescura determinista (en_vivo ≤ 15 min · cache con antigüedad · obsoleto): la pantalla y Iato
  // nunca llaman "en vivo" a una respuesta de la caché de hace horas.
  if (body.source === "serpapi") {
    const f = frescuraPrecio({ estado: body.estado_dato as string | undefined, consultadoAt: (body.consulted_at as string | undefined) ?? null }, now);
    body.frescura = f.frescura;
    body.etiqueta_frescura = f.etiqueta;
  }
  if (outcome.kind === "notice") body.aviso_limite = outcome.message;
  if (outcome.kind === "fair_use_empty") {
    body.motivo = outcome.message;
    body.limite_uso_justo = true;
  }
  if (outcome.kind === "paused_empty") {
    body.motivo = outcome.message;
    body.busquedas_en_pausa = true;
  }
  if (trace.paused) body.busquedas_en_pausa = true;
  // Cada resultado lleva su propia etiqueta (para que el chat o la pantalla no la pierdan).
  if (Array.isArray(body.results)) {
    body.results = (body.results as Record<string, unknown>[]).map((r) => {
      if (!r || typeof r !== "object" || r.estado_dato) return r;
      if (body.source === "serpapi") {
        return { ...r, estado_dato: body.estado_dato ?? "CONSULTADO_EN_VIVO", consultado_at: body.consulted_at ?? null, precio_guardado: body.precio_guardado === true,
          frescura: body.frescura ?? null };
      }
      return r;
    });
  }
  return { status: out.status, body };
}
