// Precios reales bajo demanda con lo que ya está contratado (SerpApi), sin Viator ni Kayak:
//  * Vuelo multidestino: flights-search { type: "multi" } (Google Flights type=3 + multi_city_json).
//  * Ofertas de un hotel por proveedor: hotels-search { action: "offers" } (Property Details).
// Solo se llaman tras un botón explícito ("Consultar precio real del recorrido", "Ver ofertas reales");
// el servidor aplica la caché compartida, la bolsa de búsquedas del plan y el freno de la cuenta.
//
// Cómo sumar el precio multidestino al total como "verificado" (pendiente, no se hizo aquí para no
// tocar el total que trabaja otra rama): guardar el resumen (MultiFareSummary) en
// trips.itinerario_json.verified_fares.multi = { total_usd, consulted_at, fx_usd_mxn, legs } y, en
// computeTripDesglose (src/lib/quote.ts), cuando selVuelo === -3 ("precio verificado del recorrido"),
// usar vuelos = round(total_usd × fx_usd_mxn) en lugar de vuelos_json[selVuelo]; tripTotalSummary /
// RealTripTotal lo marcarían trust "verificado" con fuente Google Flights y su hora de consulta. El
// tipo de cambio debe ser el del plan (itinerario_json.logistics.fx_usd_mxn) para que cuadre.
import { noteLiveSearchState } from "@/lib/livePause";
import { cityStays, tripFlightRoute, type TripRouteLike } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { mainAirport } from "../../supabase/functions/_shared/airports.ts";
import { checkAllowlisted, checkTrustedSource } from "@/lib/bookingAllowlist";
import { readFunctionError } from "@/lib/functionErrors";

export type Invoke = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: any; error: any }>;

/** Un traslado entre ciudades del viaje con el modo elegido (de buildBuyFlow: "vuelo", "tren", "coche"…). */
export type InterCityLeg = { from: string; to: string; date: string | null; mode: string | null };
export type FlightLeg = { from: string; to: string; date: string };
export type MultiLegPlan = {
  legs: FlightLeg[];
  /** Tramos por tierra (u otros) que no van en multi_city_json. */
  omitted: Array<{ from: string; to: string; mode: string | null }>;
  /** Por qué no se puede consultar (sin origen, sin fechas…); null si se puede. */
  missing: string | null;
};

const iso = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * Tramos de AVIÓN de un viaje multidestino: origen → primera ciudad, los traslados entre ciudades que
 * se hacen en avión y última ciudad → origen (open-jaw). Los traslados por tierra no entran.
 */
export function tripMultiCityLegs(trip: TripRouteLike | null | undefined, inter: InterCityLeg[] = []): MultiLegPlan {
  const r = tripFlightRoute(trip);
  const empty = (missing: string): MultiLegPlan => ({ legs: [], omitted: [], missing });
  if (!r.multi) return empty("El viaje tiene un solo destino.");
  if (!r.origin) return empty(`No reconocemos el aeropuerto de ${r.originCity || "tu ciudad de salida"}.`);
  if (!r.destination || !r.returnFrom) return empty("No reconocemos el aeropuerto de una de las ciudades del viaje.");
  if (!r.depart || !r.ret) return empty("Faltan las fechas del viaje.");
  const stays = cityStays(trip);
  const legs: FlightLeg[] = [{ from: r.origin, to: r.destination, date: r.depart }];
  const omitted: MultiLegPlan["omitted"] = [];
  for (const l of inter) {
    const a = mainAirport(l.from);
    const b = mainAirport(l.to);
    const date = iso(l.date) ? l.date : stays.find((s) => s.city === l.to)?.checkin ?? null;
    if (l.mode === "vuelo" && a && b && a !== b && iso(date)) legs.push({ from: a, to: b, date });
    else omitted.push({ from: l.from, to: l.to, mode: l.mode });
  }
  legs.push({ from: r.returnFrom, to: r.origin, date: r.ret });
  for (let i = 1; i < legs.length; i++) if (legs[i].date < legs[i - 1].date) return { legs, omitted, missing: "Las fechas de los tramos no van en orden." };
  if (legs.length > 6) return { legs, omitted, missing: "Google Flights acepta hasta 6 tramos." };
  return { legs, omitted, missing: null };
}

const hhmm = (at: string | null) => {
  const t = at ? new Date(at) : null;
  return t && Number.isFinite(t.getTime()) ? t.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : null;
};

/** Mensaje honesto cuando no hubo precio (cuota, pausa, sin resultados). */
function emptyMessage(data: any, what: string): string {
  noteLiveSearchState(data);
  if (typeof data?.motivo === "string" && (data.limite_uso_justo || data.busquedas_en_pausa)) return data.motivo;
  const f: string[] = Array.isArray(data?.fallas) ? data.fallas : [];
  if (f.some((x) => /limite_del_plan/.test(x))) return "Llegaste al límite de búsquedas en vivo de tu plan: no consultamos el precio. Puedes buscarlo directo en el sitio.";
  if (f.some((x) => /en_pausa/.test(x))) return "Las búsquedas de precios en vivo están en pausa por ahora y no tenemos un precio guardado. Puedes buscarlo directo en el sitio.";
  if (f.some((x) => /sin_resultados|sin_ofertas/.test(x))) return `Google no publicó ${what} para estas fechas.`;
  return "La consulta en vivo no está disponible ahora; intenta más tarde.";
}

// (message?: undefined en la rama ok: el tsconfig de la app no estrecha uniones sin strictNullChecks)
export type MultiFareSummary =
  | { ok: true; totalUsd: number; perPersonUsd: number; travelers: number; airlines: string[]; source: string; consultedAt: string | null; time: string | null;
      savedPrice: boolean; url: string | null; legs: number; note: string; message?: undefined;
      /** Moneda en que Google Flights dio el precio ("MXN" si se pidió así; entonces totalUsd/perPersonUsd van en 0). */
      currency: string; total: number; perPerson: number }
  | { ok: false; message: string; url: string | null };

export function summarizeMultiFare(data: any, travelers: number): MultiFareSummary {
  const url = typeof data?.google_flights_url === "string" && checkAllowlisted(data.google_flights_url).ok ? data.google_flights_url : null;
  const best = Array.isArray(data?.results) ? data.results.find((x: any) => Number(x?.price_usd) > 0 || Number(x?.price_total) > 0) : null;
  if (!data?.ok || !best) return { ok: false, message: emptyMessage(data, "un precio para este recorrido"), url };
  const legs = Array.isArray(data?.meta?.legs) ? data.meta.legs.length : 0;
  const consultedAt = best.consultado_at ?? data.consulted_at ?? null;
  const currency = String(best.currency ?? data.currency ?? "USD").toUpperCase();
  const total = Math.round(Number(currency === "USD" ? best.price_usd ?? best.price_total : best.price_total) || 0);
  const usdTotal = currency === "USD" ? total : 0;
  return {
    ok: true, totalUsd: usdTotal, perPersonUsd: Math.round(usdTotal / Math.max(1, travelers)), travelers,
    currency, total, perPerson: Math.round(total / Math.max(1, travelers)),
    airlines: Array.isArray(best.airlines) && best.airlines.length ? best.airlines.map(String) : best.airline ? [String(best.airline)] : [],
    source: data.etiqueta_fuente ?? "Google Flights", consultedAt, time: hhmm(consultedAt), savedPrice: data.precio_guardado === true || best.precio_guardado === true,
    url: (typeof best.buy_url === "string" && checkAllowlisted(best.buy_url).ok ? best.buy_url : null) ?? url, legs,
    note: `Total del itinerario de ${legs} tramos para ${travelers} ${travelers === 1 ? "viajero" : "viajeros"}. Aerolíneas del primer tramo; los demás se eligen en Google Flights.`,
  };
}

/** Pide el precio del recorrido (una búsqueda de SerpApi si no está en caché). */
export async function requestMultiFare(invoke: Invoke, legs: FlightLeg[], travelers: number,
  opts: { travel_class?: string | null; currency?: "MXN" | "USD" } = {}): Promise<MultiFareSummary> {
  try {
    // Clase y moneda solo si se piden (el vuelo en vivo del plan: los mismos parámetros que su cotización).
    const extra = { ...(opts.travel_class && opts.travel_class !== "turista" ? { travel_class: opts.travel_class } : {}), ...(opts.currency ? { currency: opts.currency } : {}) };
    const { data, error } = await invoke("flights-search", { body: { type: "multi", legs, travelers, ...extra } });
    if (error) {
      const info = await readFunctionError(error, "No pudimos consultar el precio. Intenta de nuevo.");
      return { ok: false, message: info.message, url: null };
    }
    return summarizeMultiFare(data, travelers);
  } catch (e) {
    const info = await readFunctionError(e, "No pudimos consultar el precio. Intenta de nuevo.");
    return { ok: false, message: info.message, url: null };
  }
}

export type HotelOfferView = { source: string; totalUsd: number; label: string; url: string | null; official: boolean; freeCancellation: boolean };
export type HotelOffersSummary =
  | { ok: true; offers: HotelOfferView[]; consultedAt: string | null; time: string | null; savedPrice: boolean; note: string; message?: undefined }
  | { ok: false; message: string };

/** Enlace de una oferta: el que dio la fuente, revisado otra vez en el navegador. */
const safeLink = (u: unknown): string | null => {
  const a = checkAllowlisted(u);
  if (a.ok) return a.url;
  const t = checkTrustedSource(u);
  return t.ok ? t.url : null;
};

export function summarizeHotelOffers(data: any): HotelOffersSummary {
  const list: any[] = Array.isArray(data?.results) ? data.results : [];
  const offers = list
    .filter((o) => Number(o?.total_usd) > 0 && typeof o?.source === "string")
    .map((o) => ({ source: o.source, totalUsd: Math.round(Number(o.total_usd)), label: String(o.label ?? `Ver en ${o.source}`), url: safeLink(o.url),
      official: o.official === true, freeCancellation: o.free_cancellation === true }))
    .sort((a, b) => Number(!!b.url) - Number(!!a.url) || a.totalUsd - b.totalUsd)
    .slice(0, 5);
  if (!data?.ok || !offers.length) return { ok: false, message: emptyMessage(data, "ofertas de este hotel") };
  const consultedAt = list[0]?.consultado_at ?? data.consulted_at ?? null;
  return { ok: true, offers, consultedAt, time: hhmm(consultedAt), savedPrice: data.precio_guardado === true, note: typeof data.nota === "string" ? data.nota : "" };
}

export type HotelOffersQuery = { property_token: string; checkin: string; checkout: string; adults: number; name?: string | null };

export async function requestHotelOffers(invoke: Invoke, q: HotelOffersQuery): Promise<HotelOffersSummary> {
  try {
    const { data, error } = await invoke("hotels-search", { body: { action: "offers", ...q } });
    if (error) return { ok: false, message: (await readFunctionError(error, "No pudimos consultar las ofertas. Intenta de nuevo.")).message };
    return summarizeHotelOffers(data);
  } catch (e) {
    return { ok: false, message: (await readFunctionError(e, "No pudimos consultar las ofertas. Intenta de nuevo.")).message };
  }
}
