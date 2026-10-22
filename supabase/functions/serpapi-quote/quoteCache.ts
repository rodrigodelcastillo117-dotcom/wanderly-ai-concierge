// Cotización en vivo de un viaje manual guardada por viaje (24 h). Sin dependencias de Deno: se
// prueba con Vitest (src/test/serpapiQuoteCache.test.ts).
//
// Antes cada vista de un viaje sin vuelos ni hoteles gastaba 2 búsquedas de SerpApi (vuelo + hotel),
// también para usuarios gratuitos. Ahora:
//   - la primera vista cotiza en vivo y guarda la cotización con su fecha real de consulta;
//   - las vistas siguientes muestran la guardada (aunque ya tenga más de 24 h, marcada como
//     "precio de hace X" para que el usuario decida actualizarla);
//   - solo se vuelve a consultar cuando el usuario pide "Actualizar precio", y como máximo una vez
//     cada 24 h por viaje. Cada consulta real gasta de su bolsa de búsquedas en vivo.

import { estadoDato, type CacheRow } from "../_shared/serpCache.ts";

export const QUOTE_TTL_SECONDS = 24 * 3600;

/** Lo que define una cotización: el viaje y los datos con que se cotiza (cambiar fechas = otra). */
export function quoteKeyParams(tripId: string, body: Record<string, unknown>) {
  return {
    trip_id: tripId,
    origin: String(body.origin ?? ""),
    destination: String(body.destination ?? ""),
    depart: String(body.depart ?? ""),
    return_date: String(body.return_date ?? ""),
    nights: Math.max(1, Number(body.nights) || 1),
    travelers: Math.max(1, Number(body.travelers) || 1),
  };
}

/** Cuándo se consultaron de verdad los precios de la cotización guardada. */
export function quotedAt(row: Pick<CacheRow, "response" | "fetched_at">): string {
  const r = row.response as { fetched_at?: unknown } | null;
  const at = typeof r?.fetched_at === "string" && Number.isFinite(Date.parse(r.fetched_at)) ? r.fetched_at : row.fetched_at;
  // Nunca más nueva que la fila: la cotización no puede ser posterior a cuando se guardó.
  return Date.parse(at) <= Date.parse(row.fetched_at) ? at : row.fetched_at;
}

export function quoteFresh(row: Pick<CacheRow, "response" | "fetched_at">, now = Date.now()): boolean {
  return now - Date.parse(quotedAt(row)) < QUOTE_TTL_SECONDS * 1000;
}

export type QuoteDecision = { action: "serve"; fresh: boolean; refreshBlocked: boolean } | { action: "live" };

/** Servir la guardada o consultar en vivo. */
export function decideQuote(row: Pick<CacheRow, "response" | "fetched_at"> | null, refresh: boolean, now = Date.now()): QuoteDecision {
  if (!row || !row.response || typeof row.response !== "object") return { action: "live" };
  const fresh = quoteFresh(row, now);
  if (!refresh) return { action: "serve", fresh, refreshBlocked: false };
  // Pidió actualizar, pero no han pasado 24 h: se muestra la misma (no se gasta otra búsqueda).
  if (fresh) return { action: "serve", fresh, refreshBlocked: true };
  return { action: "live" };
}

/** Cuándo se podrá volver a pedir una cotización en vivo de este viaje. */
export const refreshAvailableAt = (row: Pick<CacheRow, "response" | "fetched_at">) =>
  new Date(Date.parse(quotedAt(row)) + QUOTE_TTL_SECONDS * 1000).toISOString();

/** Cotización guardada con su procedencia real (nunca "en vivo" pasadas 24 h). */
export function decorateCachedQuote(
  row: Pick<CacheRow, "response" | "fetched_at">,
  now = Date.now(),
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const fresh = quoteFresh(row, now);
  return {
    ...(row.response as Record<string, unknown>),
    fetched_at: quotedAt(row),
    estado_dato: estadoDato(fresh),
    precio_guardado: !fresh,
    cached: true,
    can_refresh: !fresh,
    refresh_available_at: refreshAvailableAt(row),
    ...extra,
  };
}

export const REFRESH_TOO_SOON =
  "Este precio se actualizó hace menos de 24 h; para cuidar tus búsquedas en vivo, se puede volver a consultar una vez al día.";
export const REFRESH_FAILED =
  "No pudimos actualizar el precio ahora; te mostramos el último que consultamos. Verifícalo antes de reservar.";
