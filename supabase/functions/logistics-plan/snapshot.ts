// Snapshot de cotización del plan multi-ciudad (trip_quotes, origin "logistics-plan"). Sin Deno.
//
// logistics-plan no crea el viaje: lo guarda el cliente (MultiDestRoute) y trip_quotes es solo de
// service role. Por eso el cliente, ya con el viaje creado, pide { action: "snapshot", trip_id,
// request_key } y el servidor arma la fila con el plan que ÉL MISMO generó y guardó en
// quota_reservations.result, nunca con números que mande el navegador. Mismo constructor que
// analizar-viaje (_shared/quotes.ts → buildQuoteSnapshot).
import { buildQuoteSnapshot, type QuoteRow } from "../_shared/quotes.ts";

export type SnapshotTrip = {
  id: string;
  user_id: string;
  total_estimado?: number | null;
  num_viajeros?: number | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
};

export type SnapshotBuild = { ok: true; row: QuoteRow } | { ok: false; reason: string };

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Referencia de cada renglón para su estado. Hospedaje cuenta como consultado en vivo solo si el
 * hotel del tier elegido en TODAS las ciudades vino de Google Hotels (SerpApi) en ese request.
 * Vuelos de Travelpayouts son caché de búsquedas (≤48 h): nunca "en vivo", quedan ESTIMADO.
 */
export function logisticsReferences(logistics: any) {
  const tier = String(logistics?.selected_tier ?? "equilibrio");
  const quotedAt = typeof logistics?.quoted_at === "string" ? logistics.quoted_at : null;
  const hotels = arr(logistics?.per_destination).map((pd) =>
    arr(pd?.hospedaje).find((h) => h?.tier === tier) ?? arr(pd?.hospedaje)[0] ?? null);
  const allLive = hotels.length > 0 && hotels.every((h) => h?.fuente_precio === "serpapi");
  return {
    hospedaje: allLive
      ? { fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: quotedAt }
      : { fuente_precio: "estimado", estado_dato: "ESTIMADO" },
    vuelos: {
      fuente_precio: arr(logistics?.flights).some((f) => f?.fuente_precio === "travelpayouts") ? "travelpayouts" : "estimado",
      estado_dato: "ESTIMADO",
    },
  };
}

export function buildLogisticsSnapshot(logistics: any, trip: SnapshotTrip, userId: string, now: Date = new Date()): SnapshotBuild {
  if (!logistics || typeof logistics !== "object") return { ok: false, reason: "plan_not_found" };
  if (!trip?.id || trip.user_id !== userId) return { ok: false, reason: "trip_not_owned" };
  const total = Math.round(Number(logistics.total_estimado_mxn) || 0);
  const breakdown = logistics.desglose_presupuesto;
  if (!(total > 0) || !breakdown || typeof breakdown !== "object") return { ok: false, reason: "plan_without_total" };
  // El viaje debe ser el de ESTE plan: el total que guardó el cliente es el que calculó el servidor.
  if (Math.round(Number(trip.total_estimado) || 0) !== total) return { ok: false, reason: "total_mismatch" };
  const rate = Number(logistics.fx_usd_mxn);
  if (!(rate > 0)) return { ok: false, reason: "plan_without_fx" };

  const travelers = Number(logistics.travelers) || Number(trip.num_viajeros) || 1;
  const row = buildQuoteSnapshot({
    tripId: trip.id,
    userId,
    origin: "logistics-plan",
    breakdown,
    travelers,
    nights: Number(logistics.nights) || 0,
    rooms: Number(logistics.rooms) || Math.max(1, Math.ceil(travelers / 2)),
    dateFrom: logistics.date_from ?? trip.fecha_salida ?? null,
    dateTo: logistics.date_to ?? trip.fecha_regreso ?? null,
    fx: {
      rate,
      source: String(logistics.fx_source ?? "desconocida"),
      fetched_at: String(logistics.fx_at ?? logistics.quoted_at ?? now.toISOString()),
      is_fallback: logistics.fx_is_fallback !== false,
    },
    reference: logisticsReferences(logistics),
    sources: { ...(logistics.pricing_sources ?? {}), tier: logistics.selected_tier ?? null, quoted_at: logistics.quoted_at ?? null },
    now,
  });
  return { ok: true, row };
}
