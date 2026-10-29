// "Consultar precio en vivo" del vuelo de un viaje que se cotizó sin precio en vivo (caso Álvaro,
// 28-oct-2026: solo veía "búscalo en Google Flights" sin saber por qué). Lógica pura (sin red):
//  - qué decirle (el motivo que guardó el análisis, la tarifa de referencia con su fecha y fuente, y qué
//    destino se buscó: "India" → Delhi);
//  - qué pedirle a flights-search (la ruta del viaje; gasta de la bolsa de búsquedas del usuario);
//  - cómo leer la respuesta (precio con su fuente y hora, o el motivo honesto). Nunca un precio inventado.
import { placeQuestion, resolveFlightPlace } from "../../supabase/functions/_shared/airports.ts";
import { tripFlightRoute } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { NO_PRICE_TEXT, noLivePriceReason } from "../../supabase/functions/_shared/flightNoPrice.ts";
import type { ReferenceFare } from "../../supabase/functions/_shared/tpReference.ts";

// Este aviso sale donde NO hay vuelos en la lista (TripPurchasePlan: «Aún no tenemos precio real…»); antes
// decía «los vuelos de arriba son estimados» y arriba no había ninguno (R3 viajes P2-5, Budapest).
export const GENERIC_NO_LIVE = "Este viaje se cotizó sin precio en vivo de vuelos. Consulta el precio en vivo aquí o búscalo en Google Flights.";

export type FlightNoLiveInfo = {
  /** Motivo en español simple. */
  texto: string;
  referencia: ReferenceFare | null;
  /** "India es un país: buscamos vuelos a Delhi (DEL)…". */
  destinoNota: string | null;
  /** Lo que se le manda a flights-search, o null si falta un dato (entonces `pregunta`). */
  body: Record<string, unknown> | null;
  pregunta: string | null;
};

const rows = (trip: any): any[] => (Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []);

export function flightNoLiveInfo(trip: any): FlightNoLiveInfo {
  const vs = rows(trip);
  const marked = vs.find((v) => v?.sin_precio_vivo?.texto);
  const referencia = (vs.find((v) => v?.tarifa_referencia)?.tarifa_referencia as ReferenceFare | undefined) ?? null;
  const r = tripFlightRoute(trip);
  const firstCity = r.cities[0] ?? String(trip?.destino ?? "");
  const place = firstCity ? resolveFlightPlace(firstCity) : null;
  const destinoNota = (vs.find((v) => v?.destino_nota)?.destino_nota as string | undefined)
    ?? (place?.ok && place.via !== "ciudad" ? place.note : null);
  let pregunta: string | null = null;
  if (!r.destination) pregunta = (place && placeQuestion(place)) || "No reconocimos tu destino: escribe la ciudad para cotizar el vuelo.";
  else if (!r.origin) pregunta = "No reconocimos tu ciudad de salida: escríbela en tu viaje para cotizar el vuelo.";
  else if (!r.depart) pregunta = "Falta la fecha de salida del viaje para cotizar el vuelo.";
  const body = pregunta ? null : {
    origin: r.origin, destination: r.destination, depart: r.depart,
    ...(r.ret ? { return_date: r.ret } : {}), travelers: r.adults, type: r.ret ? "round" : "oneway",
  };
  return { texto: marked?.sin_precio_vivo?.texto ?? GENERIC_NO_LIVE, referencia, destinoNota, body, pregunta };
}

export type LiveQuoteOutcome =
  | { kind: "precio"; precioPpUsd: number; aerolinea: string | null; fuente: string; consultadoAt: string | null; url: string | null; nota: string }
  | { kind: "sin_precio"; texto: string; referencia: ReferenceFare | null };

const hhmm = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso) : null;
  return t && Number.isFinite(t.getTime()) ? t.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : null;
};

/** Lee la respuesta de flights-search (200, o el cuerpo de un 400 "no_iata"). */
export function liveQuoteOutcome(data: Record<string, any> | null | undefined, roundTrip: boolean): LiveQuoteOutcome {
  const d = data ?? {};
  const list: any[] = Array.isArray(d.results) ? d.results : [];
  const best = list.filter((x) => Number(x?.price_per_person_usd) > 0).sort((a, b) => a.price_per_person_usd - b.price_per_person_usd)[0];
  if (d.ok === true && best) {
    const serp = d.source === "serpapi";
    const at = d.consulted_at ?? null;
    const fuente = serp ? "Google Flights" : "Aviasales (búsquedas de las últimas 48 h)";
    const when = hhmm(at);
    return {
      kind: "precio", precioPpUsd: Math.round(Number(best.price_per_person_usd)), aerolinea: best.airline && best.airline !== "—" ? String(best.airline) : null,
      fuente, consultadoAt: at, url: typeof best.buy_url === "string" ? best.buy_url : null,
      nota: `${fuente}${when ? ` · consultado ${when}` : ""}${serp && d.precio_guardado ? " · precio guardado, no en vivo" : ""} · ${roundTrip ? "ida y vuelta" : "solo ida"}, por persona. No cambia tu total: si te gusta, cómpralo en el sitio.`,
    };
  }
  const why = typeof d.motivo_detalle === "string" && d.motivo_detalle ? d.motivo_detalle : noLivePriceReason(d)?.texto ?? NO_PRICE_TEXT.sin_respuesta;
  return { kind: "sin_precio", texto: why, referencia: (d.tarifa_referencia as ReferenceFare | undefined) ?? null };
}

/** "USD 1,050 por persona · Tarifa de referencia…". */
export function referenceLine(r: ReferenceFare): string {
  return `USD ${r.precio_usd_pp.toLocaleString("es-MX")} por persona · ${r.etiqueta}`;
}
