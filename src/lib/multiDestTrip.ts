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

const isEstimated = (fuente: unknown) => String(fuente ?? "estimado").toLowerCase() !== "travelpayouts" && String(fuente ?? "estimado").toLowerCase() !== "serpapi";
const isFlightMode = (m: unknown) => !m || m === "vuelo" || m === "vuelo_interno";

/** Ciudades de escala de un enlace de Aviasales (token t: "…MEXCUNMADOTP…"). Se completa en el punto 7. */
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
    const escalasCiudades = !est && opts.layovers ? opts.layovers(f?.booking_link, dep, arr) : null;
    vuelos_json.push({
      tier: f?.tier || "equilibrio",
      mode: "vuelo",
      aerolinea: est ? "Aerolínea por confirmar" : f?.airline_suggested || "Aerolínea por confirmar",
      duracion: f?.duration || "",
      escalas: est ? "Escalas por confirmar" : f?.stops || "Escalas por confirmar",
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
