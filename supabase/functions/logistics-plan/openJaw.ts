// Vuelo internacional del multidestino con precio REAL (sin Deno, se prueba con Vitest).
//
// Antes: el vuelo origen → primera ciudad (regreso desde la última) salía con un precio que estimaba la
// IA, "Aerolínea por confirmar", y así entraba al total. Ahora logistics-plan cotiza el open-jaw en
// Google Flights (flights-search { type: "multi" }: SerpApi google_flights type=3 + multi_city_json,
// con la caché compartida serp_cache, el freno de la cuenta y la cuota de siempre) y arma los 3 tiers
// con resultados reales. Sin resultados o con error se queda lo de antes, rotulado "estimado".
//
// Un lugar sin aeropuerto (Siena) vuela al de la tabla más cercano (Florencia FLR) y se dice así.
import { airportCityName, nearestAirport, type AirportPick } from "../_shared/airports.ts";
import { CABIN_CODE, googleFlightsSearchUrl } from "../_shared/booking/links.ts";
import { frescuraPrecio } from "../_shared/priceFreshness.ts";

type Tier = "ahorro" | "equilibrio" | "premium";
export type OpenJawLeg = { from: string; to: string; date: string };

export type OpenJawPlan =
  | {
    ok: true;
    legs: [OpenJawLeg, OpenJawLeg];
    travelers: number;
    travel_class: string;
    origin: AirportPick;
    /** Aeropuerto de llegada (primera ciudad). */
    arrival: AirportPick;
    /** Aeropuerto del regreso (última ciudad). */
    departure: AirportPick;
    /** "Vuelas a Florencia (FLR), a 55 km de Siena" (solo si algún lugar no tiene aeropuerto). */
    notes: string[];
    firstCity: string;
    lastCity: string;
    originCity: string;
  }
  | { ok: false; reason: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Clase válida del cuerpo ("turista" si no viene o no se reconoce). */
export function travelClassOf(raw: unknown): string {
  const k = String(raw ?? "").trim().toLowerCase();
  return CABIN_CODE[k] ? k : "turista";
}

const placeNote = (verb: string, p: AirportPick) => `${verb} ${p.city} (${p.airport}), a ${p.km} km de ${p.place}`;

/**
 * Tramos del open-jaw: [origen → primera ciudad en fecha_salida] y [última ciudad → origen en
 * fecha_regreso], con los aeropuertos de la tabla (o el más cercano). ok:false con el motivo si no se
 * puede cotizar (sin fechas, lugar desconocido…): entonces el vuelo queda como estimado.
 */
export function planOpenJaw(b: {
  origin: string; destinations: string[]; fecha_salida?: string | null; fecha_regreso?: string | null;
  num_viajeros?: number | null; travel_class?: unknown;
}): OpenJawPlan {
  const cities = (Array.isArray(b.destinations) ? b.destinations : []).map((c) => String(c ?? "").trim()).filter(Boolean);
  if (!cities.length) return { ok: false, reason: "sin_destinos" };
  const dep = String(b.fecha_salida ?? ""), ret = String(b.fecha_regreso ?? "");
  if (!ISO.test(dep) || !ISO.test(ret)) return { ok: false, reason: "sin_fechas" };
  if (ret < dep) return { ok: false, reason: "fechas_invalidas" };
  const originCity = String(b.origin ?? "").trim();
  const firstCity = cities[0];
  const lastCity = cities[cities.length - 1];
  const origin = nearestAirport(originCity);
  const arrival = nearestAirport(firstCity);
  const departure = nearestAirport(lastCity);
  if (!origin) return { ok: false, reason: `sin_aeropuerto:${originCity}` };
  if (!arrival) return { ok: false, reason: `sin_aeropuerto:${firstCity}` };
  if (!departure) return { ok: false, reason: `sin_aeropuerto:${lastCity}` };
  if (origin.airport === arrival.airport || origin.airport === departure.airport) return { ok: false, reason: "mismo_aeropuerto" };
  const notes: string[] = [];
  if (!origin.exact) notes.push(placeNote("Sales de", origin));
  if (!arrival.exact) notes.push(placeNote("Vuelas a", arrival));
  if (!departure.exact) notes.push(placeNote("Regresas desde", departure));
  return {
    ok: true,
    legs: [{ from: origin.airport, to: arrival.airport, date: dep }, { from: departure.airport, to: origin.airport, date: ret }],
    travelers: Math.min(9, Math.max(1, Math.round(Number(b.num_viajeros) || 1))),
    travel_class: travelClassOf(b.travel_class),
    origin, arrival, departure, notes, firstCity, lastCity, originCity,
  };
}

/** Cuerpo para flights-search: varias ciudades, MXN (el total se suma sin tipo de cambio) y hl=es. */
export function openJawSearchBody(p: Extract<OpenJawPlan, { ok: true }>) {
  return { type: "multi", legs: p.legs, travelers: p.travelers, travel_class: p.travel_class, currency: "MXN" };
}

/** Búsqueda de Google Flights con los mismos tramos, fechas, pasajeros y clase (si SerpApi no dio la suya). */
export function openJawGoogleFlightsUrl(p: Extract<OpenJawPlan, { ok: true }>): string | null {
  return googleFlightsSearchUrl({ origin: p.legs[0].from, destination: p.legs[0].to, returnFrom: p.legs[1].from, depart: p.legs[0].date,
    ret: p.legs[1].date, adults: p.travelers, cabin: CABIN_CODE[p.travel_class] ?? 1 });
}

const GF = /^https:\/\/www\.google\.com\/travel\/flights(\?|\/|$)/;
const price = (r: any) => Number(r?.price_total) || 0;
const minutes = (r: any) => Number(r?.duration_minutes) || Number.POSITIVE_INFINITY;
const stopsOf = (r: any) => (Number.isFinite(Number(r?.stops)) ? Number(r.stops) : 9);

/**
 * Tres resultados distintos cuando hay: ahorro = el más barato; premium = el más rápido (menos escalas
 * al empatar) entre los de precio medio o mayor; equilibrio = el de precio medio que queda.
 */
export function pickTiers(results: any[]): Record<Tier, any> | null {
  const sorted = [...results].filter((r) => price(r) > 0).sort((a, b) => price(a) - price(b));
  if (!sorted.length) return null;
  const ahorro = sorted[0];
  const median = price(sorted[Math.floor((sorted.length - 1) / 2)]);
  const pool = sorted.filter((r) => r !== ahorro && price(r) >= median);
  const premium = [...(pool.length ? pool : sorted.slice(1))].sort((a, b) => minutes(a) - minutes(b) || stopsOf(a) - stopsOf(b) || price(a) - price(b))[0] ?? ahorro;
  const mid = sorted.filter((r) => r !== ahorro && r !== premium);
  const equilibrio = mid.length ? mid[Math.floor((mid.length - 1) / 2)] : premium;
  return { ahorro, equilibrio, premium };
}

export type OpenJawQuote =
  | { live: true; flights: any[]; consultado_at: string; frescura: string; precio_guardado: boolean; results: number }
  | { live: false; reason: string };

/**
 * Tiers reales a partir de la respuesta de flights-search (type "multi", MXN). live:false si no hubo
 * resultados reales en MXN (error, sin llave, cuota, pausa sin precio guardado…).
 */
export function openJawTiers(resp: any, p: OpenJawPlan, opts: { fx: number; now?: number }): OpenJawQuote {
  // (cast explícito: el tsconfig de la app no estrecha uniones sin strictNullChecks)
  if (!p.ok) return { live: false, reason: (p as { reason: string }).reason };
  if (!resp || typeof resp !== "object") return { live: false, reason: "sin_respuesta" };
  if (resp.error && !Array.isArray(resp.results)) return { live: false, reason: `error:${String(resp.error).slice(0, 80)}` };
  if (resp.ok !== true || resp.source !== "serpapi") {
    const f = Array.isArray(resp.fallas) && resp.fallas.length ? resp.fallas.join(",") : resp.code ?? resp.motivo ?? "sin_resultados";
    return { live: false, reason: String(f).slice(0, 120) };
  }
  const real = (Array.isArray(resp.results) ? resp.results : []).filter((r: any) => r && String(r.currency ?? resp.currency ?? "").toUpperCase() === "MXN" && price(r) > 0);
  const tiers = pickTiers(real);
  if (!tiers) return { live: false, reason: "sin_resultados_mxn" };
  const now = opts.now ?? Date.now();
  const fx = Number(opts.fx) > 0 ? Number(opts.fx) : 0;
  const serpUrl = typeof resp.google_flights_url === "string" && GF.test(resp.google_flights_url) ? resp.google_flights_url : null;
  const fallbackUrl = openJawGoogleFlightsUrl(p);
  const travelers = p.travelers;
  const guardado = resp.precio_guardado === true;
  const consultadoAt = String(real[0]?.consultado_at ?? resp.consulted_at ?? new Date(now).toISOString());
  const fr = frescuraPrecio({ estado: guardado ? "OBSOLETO" : (resp.estado_dato ?? null), consultadoAt }, now);
  const nota = p.notes.join(" · ");
  const build = (r: any, tier: Tier) => {
    const total = Math.round(price(r));
    const pp = Math.round(total / travelers);
    const layovers = (Array.isArray(r.layovers) ? r.layovers : []).map((l: any) => {
      const code = String(l?.airport ?? "").toUpperCase();
      const city = code ? airportCityName(code) : "";
      return city && city !== code ? city : String(l?.name ?? code);
    }).filter(Boolean);
    const airlines: string[] = Array.isArray(r.airlines) && r.airlines.length ? r.airlines.map(String) : r.airline ? [String(r.airline)] : [];
    const link = (typeof r.buy_url === "string" && GF.test(r.buy_url) ? r.buy_url : null) ?? serpUrl ?? fallbackUrl;
    return {
      tier,
      from: p.originCity,
      to: p.firstCity,
      return_from: p.lastCity,
      airline_suggested: airlines.join(" · ") || "Aerolínea por confirmar",
      airlines,
      duration: String(r.duration ?? ""),
      salida: r.departure?.time ?? null,
      llegada: r.arrival?.time ?? null,
      dep_iata: r.departure?.id ?? p.legs[0].from,
      arr_iata: r.arrival?.id ?? p.legs[0].to,
      return_from_iata: p.legs[1].from,
      stops: layovers.length ? `Escalas: ${layovers.join(" · ")}` : stopsOf(r) === 0 ? "Directo" : `${stopsOf(r)} escala${stopsOf(r) === 1 ? "" : "s"}`,
      layovers,
      // Precio del itinerario completo (ida y regreso) para todos los viajeros, en MXN de Google Flights.
      price_total_mxn: total,
      price_per_person_mxn: pp,
      price_per_person_usd: fx ? Math.round(pp / fx) : null,
      currency: "MXN",
      booking_link: link,
      google_flights_url: link,
      ...(r.booking_token ? { booking_token: r.booking_token } : {}),
      ...(r.departure_token ? { departure_token: r.departure_token } : {}),
      fuente_precio: "en_vivo",
      proveedor: "google_flights",
      consultado_at: consultadoAt,
      frescura: fr.frescura,
      estado_dato: guardado ? "OBSOLETO" : "CONSULTADO_EN_VIVO",
      ...(guardado ? { precio_guardado: true } : {}),
      travel_class: p.travel_class,
      ...(nota ? { aeropuerto_nota: nota } : {}),
      notes: `Precio total ida y regreso (${p.legs[0].from}→${p.legs[0].to} · ${p.legs[1].from}→${p.legs[1].to}) para ${travelers} ${travelers === 1 ? "viajero" : "viajeros"}, según Google Flights. Horarios del vuelo de ida; el regreso se elige en Google Flights.`,
    };
  };
  return {
    live: true,
    flights: [build(tiers.ahorro, "ahorro"), build(tiers.equilibrio, "equilibrio"), build(tiers.premium, "premium")],
    consultado_at: consultadoAt,
    frescura: fr.frescura,
    precio_guardado: guardado,
    results: real.length,
  };
}

/** Lo que el vuelo del tier suma al total (MXN): el precio real por persona × viajeros, o el estimado en USD × tipo de cambio. */
export function flightsTotalMxn(f: any, travelers: number, fx: number): number {
  const n = Math.max(1, Number(travelers) || 1);
  const pp = Number(f?.price_per_person_mxn);
  if (pp > 0) return Math.round(pp) * n;
  return Math.round((Number(f?.price_per_person_usd) || 0) * n * (Number(fx) || 0));
}
