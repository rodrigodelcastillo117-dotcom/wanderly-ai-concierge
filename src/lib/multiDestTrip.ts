// Filas del viaje multi-destino (trips.*_json) a partir del plan de logistics-plan. Antes vivía dentro
// de MultiDestRoute.tsx y mezclaba todo en vuelos_json: coches y trenes como "vuelos", una renta de
// auto "vía Aeropuerto FCO" como vuelo a Roma y "Directo" puesto a mano en cada vuelo estimado
// (caso Roma → Florencia → Venecia, 22-oct-2026). Ahora:
//  - vuelos_json lleva SOLO vuelos: el internacional (logistics.flights) y vuelos internos;
//  - coche, tren, bus y ferry quedan en el plan (logistics.per_destination[].arrival_options y
//    road_trip), que TripDetail muestra como transporte por tierra;
//  - un vuelo estimado (sin tarifa de un proveedor) no nombra aerolínea ni dice "Directo".
import { mainAirport } from "../../supabase/functions/_shared/airports.ts";
import { sameCity } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { airportCityName } from "../../supabase/functions/_shared/airports.ts";
import { layoverCodesFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard.ts";

/** Ciudades de escala de la tarifa: las que mandó logistics-plan o las del enlace de Aviasales. */
const defaultLayovers: LayoverFn = (link) => {
  const codes = layoverCodesFromAviasalesLink(link);
  return codes ? codes.map(airportCityName) : null;
};

const isEstimated = (fuente: unknown) => String(fuente ?? "estimado").toLowerCase() !== "travelpayouts" && String(fuente ?? "estimado").toLowerCase() !== "serpapi";
const isFlightMode = (m: unknown) => !m || m === "vuelo" || m === "vuelo_interno";

/** Ciudades de escala de un enlace de Aviasales (token t: "…MEXCUNMADOTP…"). */
export type LayoverFn = (link: string | null | undefined, origin: string | null, destination: string | null) => string[] | null;

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
      precio_por_persona: mxn(f?.price_per_person_usd),
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
        por_que: h.por_que || "",
        ciudad: pd.city,
        tier: h.tier,
        noches: Number(pd.nights) || null,
      });
    });
    (pd?.restaurantes ?? []).forEach((r: any) => {
      restaurantes_json.push({ nombre: r.nombre, cocina: r.cocina, rango_precio: r.rango_precio || "$$", por_que: r.por_que || "", ciudad: pd.city });
    });
    (pd?.experiencias ?? []).forEach((t: any) => {
      tours_json.push({
        nombre: t.nombre, duracion: t.duracion || "", precio_por_persona: mxn(t.price_per_person_usd), fuente: t.fuente ?? "estimado",
        ...(t.estado_dato ? { estado_dato: t.estado_dato } : {}), rating: t.rating ?? null, por_que: t.por_que || "", ciudad: pd.city,
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
  const per: any[] = Array.isArray(trip?.itinerario_json?.logistics?.per_destination) ? trip.itinerario_json.logistics.per_destination : [];
  const fromPlan = per.filter((pd) => sameCity(pd?.city, city)).flatMap((pd) => (pd?.arrival_options ?? []).filter((o: any) => !isFlightMode(o?.mode)))
    .map((o: any) => ({ mode: o.mode, aerolinea: o.provider, duracion: o.duration,
      precio_por_persona: Math.round((Number(o.price_per_person_usd) || 0) * (Number(trip?.itinerario_json?.logistics?.fx_usd_mxn) || 0)) || null,
      fuente_precio: "estimado", estado_dato: "ESTIMADO", from: o.from, to: city, notas: o.notes ?? null }));
  const legacy = (Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []).filter((v: any) => !isFlightMode(v?.mode) && sameCity(v?.ciudad ?? v?.to, city));
  const origin = String(trip?.ciudad_origen ?? "");
  const seen = new Set<string>();
  return [...legacy, ...fromPlan].filter((o) => {
    // Lo que "sale" del origen (otro continente) no es una forma de llegar por tierra.
    if (origin && sameCity(String(o?.from ?? "").replace(/\(.*?\)/g, " "), origin)) return false;
    const k = `${o?.mode}|${String(o?.aerolinea ?? "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type LegOption = {
  /** "vuelo" | "tren" | "coche" | "bus" | "ferry" */
  mode: string;
  provider: string | null;
  duration: string | null;
  /** Precio por persona en MXN (siempre estimado: no hay inventario en vivo entre ciudades). */
  pricePp: number | null;
  fuente: string;
  from: string;
  to: string;
  row: any;
};

const legMode = (m: unknown) => {
  const s = String(m ?? "").toLowerCase();
  if (!s || s === "vuelo" || s === "vuelo_interno" || s === "avion") return "vuelo";
  if (s === "train") return "tren";
  if (s === "roadtrip" || s === "auto" || s === "car") return "coche";
  if (s === "autobus") return "bus";
  return s;
};

/**
 * Cómo ir de una ciudad del viaje a la siguiente (París → Roma): vuelos internos guardados en
 * vuelos_json, transporte por tierra del plan (tren, coche, bus, ferry) y los tramos de
 * logistics.internal_transport. Todo es estimado; sin opciones devuelve [] (no se inventa una).
 */
export function legOptionsFor(trip: any, from: string, to: string): LegOption[] {
  const fx = Number(trip?.itinerario_json?.logistics?.fx_usd_mxn) || 0;
  const out: LegOption[] = [];
  const fromOk = (f: unknown) => !f || sameCity(String(f).replace(/\(.*?\)/g, " "), from);
  for (const v of Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []) {
    if (!isFlightMode(v?.mode) || !sameCity(v?.to ?? v?.ciudad, to) || !v?.from || !sameCity(v.from, from)) continue;
    out.push({ mode: "vuelo", provider: isEstimated(v?.fuente_precio) ? null : v?.aerolinea ?? null, duration: v?.duracion || null,
      pricePp: Number(v?.precio_por_persona) > 0 ? Math.round(Number(v.precio_por_persona)) : null, fuente: String(v?.fuente_precio ?? "estimado"), from, to, row: v });
  }
  for (const g of groundOptionsForCity(trip, to)) {
    if (!fromOk(g?.from)) continue;
    out.push({ mode: legMode(g?.mode ?? g?.modo), provider: g?.aerolinea ?? null, duration: g?.duracion || null,
      pricePp: Number(g?.precio_por_persona) > 0 ? Math.round(Number(g.precio_por_persona)) : null, fuente: "estimado", from, to, row: { ...g, from, to } });
  }
  for (const t of Array.isArray(trip?.itinerario_json?.logistics?.internal_transport) ? trip.itinerario_json.logistics.internal_transport : []) {
    if (!sameCity(t?.to, to) || !sameCity(t?.from, from)) continue;
    const mode = legMode(t?.mode);
    out.push({ mode, provider: mode === "vuelo" ? null : t?.provider ?? null, duration: t?.duration || null,
      pricePp: fx > 0 && Number(t?.price_per_person_usd) > 0 ? Math.round(Number(t.price_per_person_usd) * fx) : null, fuente: "estimado", from, to,
      row: { mode, aerolinea: t?.provider ?? null, duracion: t?.duration ?? null, from, to, fuente_precio: "estimado" } });
  }
  const seen = new Set<string>();
  return out.filter((o) => {
    const k = `${o.mode}|${String(o.provider ?? "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
