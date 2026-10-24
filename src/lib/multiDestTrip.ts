// Filas del viaje multi-destino (trips.*_json) a partir del plan de logistics-plan. Antes vivía dentro
// de MultiDestRoute.tsx y mezclaba todo en vuelos_json: coches y trenes como "vuelos", una renta de
// auto "vía Aeropuerto FCO" como vuelo a Roma y "Directo" puesto a mano en cada vuelo estimado
// (caso Roma → Florencia → Venecia, 22-oct-2026). Ahora:
//  - vuelos_json lleva SOLO vuelos: el internacional (logistics.flights) y vuelos internos;
//  - coche, tren, bus y ferry quedan en el plan (logistics.per_destination[].arrival_options y
//    road_trip), que TripDetail muestra como transporte por tierra;
//  - un vuelo estimado (sin tarifa de un proveedor) no nombra aerolínea ni dice "Directo".
import { mainAirport } from "../../supabase/functions/_shared/airports.ts";
import { sameCity, stayForCity } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { airportCityName } from "../../supabase/functions/_shared/airports.ts";
import { layoverCodesFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard.ts";
import { transportModeOf } from "../../supabase/functions/_shared/booking/offers.ts";

/** Ciudades de escala de la tarifa: las que mandó logistics-plan o las del enlace de Aviasales. */
const defaultLayovers: LayoverFn = (link) => {
  const codes = layoverCodesFromAviasalesLink(link);
  return codes ? codes.map(airportCityName) : null;
};

// "en_vivo": vuelo internacional consultado en Google Flights por logistics-plan (openJaw.ts).
const isEstimated = (fuente: unknown) => !["travelpayouts", "serpapi", "en_vivo"].includes(String(fuente ?? "estimado").toLowerCase());
// El modo viene en texto libre ("Tren de alta velocidad", "Vuelo directo"): se lee su palabra clave.
const isFlightMode = (m: unknown) => { const t = transportModeOf(m); return t == null || t === "vuelo"; };

/** Ciudades de escala de un enlace de Aviasales (token t: "…MEXCUNMADOTP…"). */
export type LayoverFn = (link: string | null | undefined, origin: string | null, destination: string | null) => string[] | null;

// Datos del proveedor de un restaurante (restaurantFromPlace / verifyRestaurants) que se guardan en el viaje.
const PLACE_KEYS = ["fuente", "estado_dato", "verificado", "nota", "place_id", "maps_url", "website", "telefono", "direccion", "rating",
  "num_reviews", "nivel_precio", "reservable", "photo_ref", "consultado_at", "tip"];
const pick = (o: any, keys: string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) out[k] = o[k];
  return out;
};

export function multiDestTripRows(logistics: any, stops: string[], origin: string, opts: { layovers?: LayoverFn } = {}) {
  const USD_MXN = Number(logistics?.fx_usd_mxn) > 0 ? Number(logistics.fx_usd_mxn) : 20.5;
  const mxn = (usd: unknown) => Math.round(Number(usd ?? 0) * USD_MXN);
  const originClean = String(origin ?? "").trim();
  const vuelos_json: any[] = [];

  // Vuelo internacional (origen → primera ciudad, regreso desde la última).
  (logistics?.flights ?? []).forEach((f: any) => {
    const est = isEstimated(f?.fuente_precio);
    const to = f?.to && stops.some((s) => sameCity(s, f.to)) ? f.to : stops[0];
    const dep = f?.dep_iata ?? mainAirport(f?.from ?? originClean);
    const arr = f?.arr_iata ?? mainAirport(to);
    const escalasCiudades = est ? null : Array.isArray(f?.layovers) ? f.layovers : (opts.layovers ?? defaultLayovers)(f?.booking_link, dep, arr);
    vuelos_json.push({
      tier: f?.tier || "equilibrio",
      mode: "vuelo",
      aerolinea: est ? "Aerolínea por confirmar" : f?.airline_suggested || "Aerolínea por confirmar",
      duracion: f?.duration || "",
      escalas: est ? "Escalas por confirmar" : escalasCiudades ? (escalasCiudades.length ? `Escalas: ${escalasCiudades.join(" · ")}` : "Directo") : "Escalas por confirmar",
      ...(escalasCiudades ? { escalas_ciudades: escalasCiudades } : {}),
      // En vivo: el precio en MXN de Google Flights tal cual (el mismo que sumó el servidor al total).
      precio_por_persona: !est && Number(f?.price_per_person_mxn) > 0 ? Math.round(Number(f.price_per_person_mxn)) : mxn(f?.price_per_person_usd),
      fuente_precio: est ? "estimado" : f.fuente_precio,
      estado_dato: f?.estado_dato ?? (est ? "ESTIMADO" : null),
      ...(f?.consultado_at ? { consultado_at: f.consultado_at } : {}),
      ...(f?.approximate_dates ? { approximate_dates: true } : {}),
      booking_link: est ? null : f?.booking_link ?? null,
      notas: f?.notes ? `${String(f.from ?? originClean).trim()} → ${to} · ${f.notes}` : `${String(f?.from ?? originClean).trim()} → ${to}`,
      ciudad: to,
      from: String(f?.from ?? originClean).trim(),
      to,
      dep_iata: dep ?? null,
      arr_iata: arr ?? null,
      // Google Flights en vivo: horarios de la ida, aeropuerto del regreso, total del itinerario,
      // la búsqueda exacta y "Vuelas a Florencia (FLR), a 55 km de Siena".
      ...(!est ? pick(f, ["salida", "llegada", "return_from_iata", "return_from", "price_total_mxn", "google_flights_url", "booking_token",
        "departure_token", "frescura", "precio_guardado", "travel_class", "aeropuerto_nota", "proveedor"]) : {}),
    });
  });

  const hospedaje_json: any[] = [];
  const restaurantes_json: any[] = [];
  const tours_json: any[] = [];
  (logistics?.per_destination ?? []).forEach((pd: any, i: number) => {
    // Solo los VUELOS internos entran a vuelos_json; coche, tren, bus y ferry quedan en el plan.
    // A la primera ciudad se llega con el vuelo internacional: sus "vuelos" y lo que sale del origen
    // (una renta de auto en Ciudad de México para ir a Roma) no son opciones reales.
    (pd?.arrival_options ?? []).forEach((opt: any) => {
      if (!isFlightMode(opt?.mode) || i === 0) return;
      vuelos_json.push({
        tier: opt?.tier || "equilibrio",
        mode: "vuelo",
        aerolinea: "Aerolínea por confirmar",
        duracion: opt?.duration || "",
        escalas: "Escalas por confirmar",
        precio_por_persona: mxn(opt?.price_per_person_usd),
        fuente_precio: "estimado",
        estado_dato: "ESTIMADO",
        notas: opt?.notes ? `${opt.from} → ${pd.city} · ${opt.notes}` : `${opt?.from} → ${pd.city}`,
        ciudad: pd.city,
        from: opt?.from,
        to: pd.city,
      });
    });
    (pd?.hospedaje ?? []).forEach((h: any) => {
      hospedaje_json.push({
        tipo: h.tipo || h.tier || "Hospedaje",
        nombre: h.nombre,
        barrio: h.barrio || pd.city,
        rating: h.rating ?? null,
        precio_por_noche: mxn(h.price_per_night_usd),
        fuente_precio: h.fuente_precio ?? "estimado",
        ...(h.estado_dato ? { estado_dato: h.estado_dato } : {}),
        ...(h.consultado_at ? { consultado_at: h.consultado_at } : {}),
        booking_link: h.booking_url ?? null,
        ...(h.property_token ? { property_token: h.property_token } : {}),
        ...(h.website ? { website: h.website } : {}),
        por_que: h.por_que || "",
        ciudad: pd.city,
        tier: h.tier,
        noches: Number(pd.nights) || null,
      });
    });
    (pd?.restaurantes ?? []).forEach((r: any) => {
      // Sin dato de precio no se inventa uno (antes "$$" por omisión en los 142 restaurantes del multidestino).
      // Los datos de Google (place_id, sitio, ficha, calificación) pasan tal cual; ningún enlace de la IA.
      restaurantes_json.push({
        nombre: r.nombre, cocina: r.cocina, ...(r.rango_precio ? { rango_precio: r.rango_precio } : {}), por_que: r.por_que || "", ciudad: pd.city,
        ...pick(r, PLACE_KEYS),
      });
    });
    (pd?.experiencias ?? []).forEach((t: any) => {
      tours_json.push({
        nombre: t.nombre, duracion: t.duracion || "", precio_por_persona: mxn(t.price_per_person_usd), fuente: t.fuente ?? "estimado",
        ...(t.estado_dato ? { estado_dato: t.estado_dato } : {}), rating: t.rating ?? null, por_que: t.por_que || "", ciudad: pd.city,
        ...pick(t, ["place_id", "maps_url", "num_reviews", "verificado", "nota_verificacion"]),
      });
    });
  });

  return { vuelos_json, hospedaje_json, restaurantes_json, tours_json };
}

/**
 * Formas de llegar POR TIERRA a una ciudad del viaje (coche, tren, bus, ferry): del plan guardado y,
 * en viajes viejos, las filas de tierra que quedaron mezcladas en vuelos_json.
 */
export function groundOptionsForCity(trip: any, city: string): any[] {
  const logistics = trip?.itinerario_json?.logistics;
  const fx = Number(logistics?.fx_usd_mxn) || 0;
  const per: any[] = Array.isArray(logistics?.per_destination) ? logistics.per_destination : [];
  // Una sola fuente de verdad (E2E España, 23-oct-2026): el tramo por tierra que SUMA el total
  // (logistics.internal_transport) va primero, con su precio, operador y duración; antes Destinos
  // pintaba arrival_options (AVE a 1,219) mientras Comprar y el total sumaban otro (AVE a 1,032).
  const quoted = (Array.isArray(logistics?.internal_transport) ? logistics.internal_transport : [])
    .filter((t: any) => sameCity(t?.to, city) && t?.from && !sameCity(t.from, city) && !isFlightMode(t?.mode))
    .map((t: any) => ({ mode: t.mode, aerolinea: t.provider ?? null, duracion: t.duration ?? null,
      precio_por_persona: Math.round((Number(t.price_per_person_usd) || 0) * fx) || null,
      fuente_precio: "estimado", estado_dato: "ESTIMADO", from: t.from, to: city, notas: t.luggage_note ?? null, quoted: true }));
  // Las demás opciones del plan son alternativas: no suman al total y llevan su propia fuente.
  const alt = quoted.length > 0;
  const fromPlan = per.filter((pd) => sameCity(pd?.city, city)).flatMap((pd) => (pd?.arrival_options ?? []).filter((o: any) => !isFlightMode(o?.mode)))
    .map((o: any) => ({ mode: o.mode, aerolinea: o.provider, duracion: o.duration,
      precio_por_persona: Math.round((Number(o.price_per_person_usd) || 0) * fx) || null,
      fuente_precio: "estimado", estado_dato: "ESTIMADO", from: o.from, to: city, notas: o.notes ?? null, ...(alt ? { alternativa: true } : {}) }));
  const legacy = (Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []).filter((v: any) => !isFlightMode(v?.mode) && sameCity(v?.ciudad ?? v?.to, city));
  const origin = String(trip?.ciudad_origen ?? "");
  const seen = new Set<string>();
  // Dedup por modo + operador: si el plan repite el tramo cotizado (mismo tren, mismo operador), queda el cotizado.
  return [...quoted, ...legacy, ...fromPlan].filter((o) => {
    // Lo que "sale" del origen (otro continente) no es una forma de llegar por tierra.
    if (origin && sameCity(String(o?.from ?? "").replace(/\(.*?\)/g, " "), origin)) return false;
    const k = `${o?.mode}|${String(o?.aerolinea ?? "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Fechas de una renta de auto para un tramo (recoger en `from`, devolver en `to`). Un tramo de ida
 * entre dos ciudades (Madrid → Córdoba) se recoge y se devuelve el día del tramo (la llegada a `to`);
 * antes la devolución era el regreso del viaje (2027-05-19 en vez de 2027-05-07). En la misma ciudad
 * se devuelve al salir de ella (o al final del viaje si no se sabe).
 */
export function legCarRentalDates(trip: any, from: string, to: string, legDate?: string | null): { pickup: string | null; dropoff: string | null } {
  const iso = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const cleanFrom = String(from ?? "").replace(/\(.*?\)/g, " ").trim();
  const oneWay = !!cleanFrom && !!to && !sameCity(cleanFrom, to);
  if (oneWay) {
    // La fecha del tramo (la que muestra Comprar) manda; si no viene, la llegada a `to` o la salida de `from`.
    const day = iso(legDate) ?? iso(stayForCity(trip, to)?.checkin) ?? iso(stayForCity(trip, cleanFrom)?.checkout) ?? iso(trip?.fecha_salida);
    return { pickup: day, dropoff: day };
  }
  const stay = stayForCity(trip, to || cleanFrom);
  return { pickup: iso(stay?.checkin) ?? iso(trip?.fecha_salida), dropoff: iso(stay?.checkout) ?? iso(trip?.fecha_regreso) };
}

/**
 * Fechas iniciales de la pantalla Renta de auto. Si la URL trae un tramo de ida (recoger en una ciudad
 * y devolver en otra), la devolución NUNCA se rellena con el regreso del viaje: es el mismo día de la
 * recogida (o queda vacía para que la persona la elija). Antes, sin `return` en la URL, la pantalla
 * ponía la fecha_regreso del viaje (fin del viaje) a un tramo de ida.
 */
export function carSearchDefaults(
  q: { city?: string | null; dropoff?: string | null; pickup?: string | null; ret?: string | null },
  trip: { destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null } | null | undefined,
): { city: string; pickup: string; ret: string; oneWayLeg: boolean } {
  const iso = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "");
  const city = String(q.city ?? "").trim();
  const dropoff = String(q.dropoff ?? "").trim();
  const oneWayLeg = !!city && !!dropoff && !sameCity(city, dropoff);
  const pickup = iso(q.pickup) || (oneWayLeg ? "" : iso(trip?.fecha_salida));
  let ret = iso(q.ret);
  if (!ret) ret = oneWayLeg ? pickup : iso(trip?.fecha_regreso);
  // Una devolución anterior a la recogida no es válida: se iguala a la recogida.
  if (ret && pickup && ret < pickup) ret = pickup;
  return { city: city || String(trip?.destino ?? "").trim(), pickup, ret, oneWayLeg };
}

export type LegOption = {
  /** "vuelo" | "tren" | "coche" | "bus" | "ferry" | "taxi" | "traslado" | "otro" (transportModeOf) */
  mode: string;
  provider: string | null;
  duration: string | null;
  /** Precio por persona en MXN (siempre estimado: no hay inventario en vivo entre ciudades). */
  pricePp: number | null;
  fuente: string;
  from: string;
  to: string;
  row: any;
  /** Tramo de logistics.internal_transport: es el que suma el total ("Transporte entre ciudades"). */
  quoted?: boolean;
  /** USD por persona del tramo cotizado (para cobrar exactamente lo que suma el servidor). */
  priceUsdPp?: number | null;
};

const legMode = (m: unknown): string => transportModeOf(m) ?? "vuelo";

/**
 * Cómo ir de una ciudad del viaje a la siguiente (París → Roma): vuelos internos guardados en
 * vuelos_json, transporte por tierra del plan (tren, coche, bus, ferry) y los tramos de
 * logistics.internal_transport. Todo es estimado; sin opciones devuelve [] (no se inventa una).
 */
export function legOptionsFor(trip: any, from: string, to: string): LegOption[] {
  const fx = Number(trip?.itinerario_json?.logistics?.fx_usd_mxn) || 0;
  const out: LegOption[] = [];
  const fromOk = (f: unknown) => !f || sameCity(String(f).replace(/\(.*?\)/g, " "), from);
  // Primero el tramo de logistics.internal_transport: es el que suma el total del viaje (el servidor
  // suma esos tramos en "transporte_local"). Va antes para que la deduplicación lo conserve a él y no a
  // una opción parecida de arrival_options con otro precio (AVE Granada → Barcelona a 115 vs 85 USD).
  for (const t of Array.isArray(trip?.itinerario_json?.logistics?.internal_transport) ? trip.itinerario_json.logistics.internal_transport : []) {
    if (!sameCity(t?.to, to) || !sameCity(t?.from, from)) continue;
    const mode = legMode(t?.mode);
    const usd = Number(t?.price_per_person_usd) > 0 ? Number(t.price_per_person_usd) : null;
    out.push({ mode, provider: mode === "vuelo" ? null : t?.provider ?? null, duration: t?.duration || null,
      pricePp: fx > 0 && usd ? Math.round(usd * fx) : null, fuente: "estimado", from, to, quoted: true, priceUsdPp: usd,
      row: { mode, aerolinea: t?.provider ?? null, duracion: t?.duration ?? null, from, to, fuente_precio: "estimado" } });
  }
  for (const v of Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []) {
    if (!isFlightMode(v?.mode) || !sameCity(v?.to ?? v?.ciudad, to) || !v?.from || !sameCity(v.from, from)) continue;
    out.push({ mode: "vuelo", provider: isEstimated(v?.fuente_precio) ? null : v?.aerolinea ?? null, duration: v?.duracion || null,
      pricePp: Number(v?.precio_por_persona) > 0 ? Math.round(Number(v.precio_por_persona)) : null, fuente: String(v?.fuente_precio ?? "estimado"), from, to, row: v });
  }
  // Vuelos internos que el plan propone en arrival_options ("Vuelo directo" Granada → Barcelona) y que
  // un viaje guardado antes no pasó a vuelos_json.
  for (const pd of Array.isArray(trip?.itinerario_json?.logistics?.per_destination) ? trip.itinerario_json.logistics.per_destination : []) {
    if (!sameCity(pd?.city, to)) continue;
    for (const o of Array.isArray(pd?.arrival_options) ? pd.arrival_options : []) {
      if (transportModeOf(o?.mode) !== "vuelo" || !o?.from || !fromOk(o.from)) continue;
      const usd = Number(o?.price_per_person_usd) > 0 ? Number(o.price_per_person_usd) : null;
      out.push({ mode: "vuelo", provider: null, duration: o?.duration || null, pricePp: fx > 0 && usd ? Math.round(usd * fx) : null, fuente: "estimado", from, to,
        row: { mode: "vuelo", duracion: o?.duration ?? null, from, to, fuente_precio: "estimado", estado_dato: "ESTIMADO" } });
    }
  }
  for (const g of groundOptionsForCity(trip, to)) {
    if (!fromOk(g?.from)) continue;
    out.push({ mode: legMode(g?.mode ?? g?.modo), provider: g?.aerolinea ?? null, duration: g?.duracion || null,
      pricePp: Number(g?.precio_por_persona) > 0 ? Math.round(Number(g.precio_por_persona)) : null, fuente: "estimado", from, to, row: { ...g, from, to } });
  }
  const seen = new Set<string>();
  return out.filter((o) => {
    const k = `${o.mode}|${String(o.provider ?? "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Nombre del rubro "transporte_local" del desglose. logistics-plan suma ahí los tramos de
 * logistics.internal_transport (trenes, coches o vuelos de una ciudad a otra): si los hay, es
 * "Transporte entre ciudades"; si no, "Transporte local". Sin cambiar el esquema (sigue siendo
 * transporte_local).
 */
export function transportRubroLabel(trip: any): string {
  const legs: any[] = Array.isArray(trip?.itinerario_json?.logistics?.internal_transport) ? trip.itinerario_json.logistics.internal_transport : [];
  const intercity = legs.some((l) => l?.from && l?.to && !sameCity(String(l.from), String(l.to)) && Number(l?.price_per_person_usd) > 0);
  return intercity ? "Transporte entre ciudades" : "Transporte local";
}
