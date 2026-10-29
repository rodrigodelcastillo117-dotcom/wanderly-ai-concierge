// "Ya tengo mi viaje": la persona ya compró vuelos y hotel y solo quiere usar IATOS para lo demás
// (restaurantes, museos, tours y experiencias). El viaje se crea con LO QUE ELLA DIO, sin buscar
// nada: 0 llamadas a SerpApi, 0 a logistics-plan y 0 de IA. La única llamada externa es una por
// hotel a geocode-address (Google Places, ya existente) y solo al confirmar, para guardar su
// ubicación real (place_id, lat/lng y dirección).
//
// Dónde queda cada cosa (sin migración: todo en columnas JSON que ya existen en trips):
//  - itinerario_json.traido = true          → marca "lo traje yo" (trips.fuente solo acepta plan|documento).
//  - itinerario_json.bases[]                → por ciudad: { ciudad, llegada, salida, noches, hotel }
//                                             con hotel = { nombre, direccion, place_id, lat, lng, maps_url } | null.
//                                             Es lo que lee la pestaña "Experiencias" (tripBases()).
//  - itinerario_json.logistics.per_destination → las mismas fechas, para cityStays() (multi-destino).
//  - hospedaje_json[]                       → el hotel de cada ciudad con ya_lo_tengo: true y precio null.
//  - vuelos_json[]                          → el vuelo (número y fecha) con ya_lo_tengo: true y precio null.
//  - selections                             → vuelo y hoteles en "Ya lo tengo" (-2): el total no los suma.
import { cityStays, countryForStops, sameCity, tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { placeKey, type RegionExpansion } from "../../supabase/functions/_shared/regions.ts";
import { serializeSelections } from "@/lib/tripSelections";

type Client = {
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: any; error: any }> };
  from: (table: string) => any;
};

export type BroughtCity = {
  ciudad: string;
  /** Día de llegada (YYYY-MM-DD). */
  llegada: string;
  /** Día de salida (YYYY-MM-DD): la noche anterior es la última en esa ciudad. */
  salida: string;
  /** Nombre o dirección del hotel tal como lo escribió la persona (opcional). */
  hotel?: string | null;
};

export type BroughtFlight = { numero: string; fecha: string; seguir?: boolean };

export type BroughtTripInput = {
  userId: string;
  /** Ciudades YA expandidas (Toscana → Siena, Lucca), en orden. */
  cities: BroughtCity[];
  personas: number;
  origin?: string | null;
  flights?: BroughtFlight[];
  /** Cómo se expandió cada región escrita (para "Toscana: … por Siena y Lucca"). */
  expansions?: RegionExpansion[];
  /** Hoy en la zona de la persona (YYYY-MM-DD). */
  today: string;
};

export type ResolvedHotel = {
  /** false si Google devolvió un lugar que no se parece a lo que escribió la persona (no se usa en silencio). */
  coincide?: boolean;
  nombre: string;
  direccion: string | null;
  place_id: string | null;
  lat: number;
  lng: number;
  maps_url: string;
  /** Lo que se buscó en Google ("Hotel Artemide, Roma"). */
  consulta: string;
  consultado_at: string;
};

export type BroughtError = {
  campo: "ciudades" | "fechas" | "personas" | "hotel" | "vuelo" | "guardar";
  /** Índice de la ciudad o del vuelo con el problema. */
  index?: number;
  mensaje: string;
};

export const MAX_BROUGHT_CITIES = 12;
export const MAX_BROUGHT_FLIGHTS = 4;
const MAX_DAYS_AHEAD = 730;
const MAX_TRIP_NIGHTS = 180;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (d: unknown): d is string => typeof d === "string" && ISO.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`));
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const nightsOf = (a: string, b: string) => dayNum(b) - dayNum(a);
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "1 may 2027". */
export const fmtDay = (iso: string) => (isIso(iso) ? `${Number(iso.slice(8, 10))} ${MES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso);

/** "am 17" → "AM17" (mismo criterio que track-flight). */
export const normalizeFlightNumber = (f: string) => String(f ?? "").toUpperCase().replace(/\s/g, "");
const FLIGHT_RE = /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/;

/**
 * Valida lo que dio la persona. Devuelve TODOS los problemas (el formulario marca cada campo) en el
 * orden en que aparecen en pantalla; [] si se puede guardar.
 */
export function validateBroughtTrip(input: Pick<BroughtTripInput, "cities" | "personas" | "flights" | "today">): BroughtError[] {
  const errs: BroughtError[] = [];
  const cities = Array.isArray(input.cities) ? input.cities : [];
  if (!cities.length || cities.every((c) => !String(c?.ciudad ?? "").trim())) {
    errs.push({ campo: "ciudades", mensaje: "Escribe al menos una ciudad de tu viaje." });
    return errs;
  }
  if (cities.length > MAX_BROUGHT_CITIES) errs.push({ campo: "ciudades", mensaje: `Hasta ${MAX_BROUGHT_CITIES} ciudades por viaje.` });
  cities.forEach((c, i) => {
    const name = String(c?.ciudad ?? "").trim();
    if (!name) { errs.push({ campo: "ciudades", index: i, mensaje: `Escribe la ciudad ${i + 1}.` }); return; }
    if (i > 0 && sameCity(name, cities[i - 1]?.ciudad)) {
      errs.push({ campo: "ciudades", index: i, mensaje: `Pusiste ${name} dos veces seguidas: junta sus fechas en una sola.` });
    }
    if (!isIso(c.llegada) || !isIso(c.salida)) {
      errs.push({ campo: "fechas", index: i, mensaje: `Pon el día que llegas y el día que sales de ${name}.` });
      return;
    }
    if (c.salida <= c.llegada) errs.push({ campo: "fechas", index: i, mensaje: `En ${name} la salida debe ser después de la llegada (al menos una noche).` });
    const prev = cities[i - 1];
    if (prev && isIso(prev.salida) && c.llegada < prev.salida) {
      errs.push({ campo: "fechas", index: i, mensaje: `Llegas a ${name} (${fmtDay(c.llegada)}) antes de salir de ${String(prev.ciudad).trim()} (${fmtDay(prev.salida)}).` });
    }
    if (String(c.hotel ?? "").length > 200) errs.push({ campo: "hotel", index: i, mensaje: `El hotel de ${name} es muy largo: escribe solo su nombre o dirección.` });
  });
  const first = cities[0];
  const last = cities[cities.length - 1];
  if (!errs.some((e) => e.campo === "fechas") && isIso(first?.llegada) && isIso(last?.salida)) {
    if (last.salida < input.today) errs.push({ campo: "fechas", mensaje: "Ese viaje ya pasó: súbelo en «Sube un viaje que ya hiciste»." });
    else if (nightsOf(input.today, first.llegada) > MAX_DAYS_AHEAD) errs.push({ campo: "fechas", mensaje: "Ese viaje empieza en más de dos años: revisa el año." });
    else if (nightsOf(first.llegada, last.salida) > MAX_TRIP_NIGHTS) errs.push({ campo: "fechas", mensaje: `Un viaje puede durar hasta ${MAX_TRIP_NIGHTS} noches: revisa las fechas.` });
  }
  const n = Number(input.personas);
  if (!Number.isInteger(n) || n < 1 || n > 20) errs.push({ campo: "personas", mensaje: "Entre 1 y 20 personas." });
  const flights = (input.flights ?? []).filter((f) => String(f?.numero ?? "").trim() || String(f?.fecha ?? "").trim());
  if (flights.length > MAX_BROUGHT_FLIGHTS) errs.push({ campo: "vuelo", mensaje: `Hasta ${MAX_BROUGHT_FLIGHTS} vuelos.` });
  (input.flights ?? []).forEach((f, i) => {
    const num = normalizeFlightNumber(f?.numero ?? "");
    const fecha = String(f?.fecha ?? "").trim();
    if (!num && !fecha) return;
    if (!FLIGHT_RE.test(num)) { errs.push({ campo: "vuelo", index: i, mensaje: "Número de vuelo no válido (ej. AM 17)." }); return; }
    if (!isIso(fecha)) { errs.push({ campo: "vuelo", index: i, mensaje: `Pon la fecha del vuelo ${num}.` }); return; }
    // El vuelo de ida puede salir uno o dos días antes de llegar (vuelos nocturnos, cambio de huso).
    if (isIso(first?.llegada) && isIso(last?.salida) && (nightsOf(fecha, first.llegada) > 2 || fecha > last.salida)) {
      errs.push({ campo: "vuelo", index: i, mensaje: `El vuelo ${num} (${fmtDay(fecha)}) no cae en tu viaje (${fmtDay(first.llegada)} – ${fmtDay(last.salida)}).` });
    }
  });
  return errs;
}

/** Lo que se busca en Google para el hotel de una ciudad ("Hotel Artemide, Roma"). */
export function hotelQuery(hotel: string, city: string): string {
  const h = String(hotel ?? "").trim().replace(/\s+/g, " ");
  const c = String(city ?? "").trim();
  if (!h) return "";
  return c && !placeKey(h).includes(placeKey(c)) ? `${h}, ${c}` : h;
}

/** Ficha de Google Maps del lugar (con place_id, la ficha exacta). */
export function mapsUrlFor(name: string, placeId: string | null, lat?: number, lng?: number): string {
  const q = new URLSearchParams({ api: "1", query: name || (Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : "") });
  if (placeId) q.set("query_place_id", placeId);
  return `https://www.google.com/maps/search/?${q.toString()}`;
}

/**
 * Hotel → ubicación real con geocode-address (Places Text Search de Google, función ya existente).
 * null si Google no lo encuentra (nunca se inventan coordenadas).
 */
export async function resolveHotel(client: Pick<Client, "functions">, hotel: string, city: string, now: Date = new Date()): Promise<ResolvedHotel | null> {
  const consulta = hotelQuery(hotel, city);
  if (!consulta) return null;
  try {
    const { data, error } = await client.functions.invoke("geocode-address", { body: { address: consulta } });
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (error || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const nombre = String(data?.name ?? "").trim() || String(hotel).trim();
    const placeId = typeof data?.place_id === "string" && data.place_id ? data.place_id : null;
    const direccion = typeof data?.label === "string" && data.label.trim() && data.label.trim() !== nombre ? data.label.trim() : null;
    const out: ResolvedHotel = { nombre, direccion, place_id: placeId, lat, lng, maps_url: mapsUrlFor(nombre, placeId, lat, lng), consulta, consultado_at: now.toISOString() };
    // Google devolvió OTRO lugar ("Hotel PRUEBA AUDITORÍA" → "Otro Oaxaca"): no se cambia en silencio.
    return hotelMatches(hotel, nombre, direccion) ? out : { ...out, coincide: false };
  } catch {
    return null;
  }
}

export type TripBaseHotel = { nombre: string; direccion: string | null; place_id: string | null; lat: number; lng: number; maps_url: string | null };
export type TripBase = { ciudad: string; llegada: string | null; salida: string | null; noches: number | null; hotel: TripBaseHotel | null };

const STOP = new Set(["hotel", "hostal", "hostel", "the", "and", "las", "los", "del", "de", "la", "el", "en", "boutique", "suites", "suite", "inn", "resort", "spa", "casa"]);
const tokensOf = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));

/**
 * ¿Lo que encontró Google es lo que escribió la persona? Alguna palabra propia del nombre (o de la
 * dirección escrita: calle y número) debe aparecer en el nombre o la dirección de Google.
 */
export function hotelMatches(typed: string, nombre: string, direccion: string | null): boolean {
  const want = tokensOf(typed);
  if (!want.length) return true;
  const got = new Set([...tokensOf(nombre), ...tokensOf(direccion)]);
  return want.some((t) => got.has(t) || [...got].some((g) => g.length >= 5 && t.length >= 5 && (g.startsWith(t) || t.startsWith(g))));
}

/** Fila de trips para un viaje traído. `hotels[i]` es el hotel resuelto de la ciudad i (o null). */
export function broughtTripInsert(input: BroughtTripInput, hotels: Array<ResolvedHotel | null>) {
  const cities = input.cities.map((c) => ({ ...c, ciudad: String(c.ciudad).trim() }));
  const names = cities.map((c) => c.ciudad);
  const multi = cities.length > 1;
  const bases: TripBase[] = cities.map((c, i) => {
    const h = hotels[i] ?? null;
    return {
      ciudad: c.ciudad, llegada: c.llegada, salida: c.salida, noches: nightsOf(c.llegada, c.salida),
      hotel: h ? { nombre: h.nombre, direccion: h.direccion, place_id: h.place_id, lat: h.lat, lng: h.lng, maps_url: h.maps_url } : null,
    };
  });
  // Hospedaje: el hotel que ya tiene, sin precio (no se inventa ni se suma).
  const hospedaje_json = cities.flatMap((c, i) => {
    const h = hotels[i];
    if (!h) return [];
    return [{
      nombre: h.nombre, ciudad: c.ciudad, direccion: h.direccion, place_id: h.place_id, lat: h.lat, lng: h.lng, maps_url: h.maps_url,
      check_in: c.llegada, check_out: c.salida, noches: nightsOf(c.llegada, c.salida),
      tipo: "Tu hotel", tier: "propio", por_que: "Ya lo tienes reservado", ya_lo_tengo: true,
      fuente: "propio", fuente_precio: "propio", precio_por_noche: null, consulta: h.consulta, consultado_at: h.consultado_at,
    }];
  });
  const vuelos_json = (input.flights ?? []).filter((f) => normalizeFlightNumber(f.numero) && isIso(f.fecha)).map((f) => ({
    mode: "vuelo", numero_vuelo: normalizeFlightNumber(f.numero), fecha: f.fecha, ya_lo_tengo: true, estado_reserva: "reservado",
    tier: "propio", fuente: "propio", fuente_precio: "propio", precio_por_persona: null, seguimiento: !!f.seguir,
  }));
  const ui = {
    selVuelo: -2, selHospedaje: -2, nochesHospedaje: null, selTours: new Set<number>(),
    selHoteles: multi ? Object.fromEntries(names.map((n) => [n, -2])) : {},
  };
  const draft = { vuelos_json, hospedaje_json, tours_json: [] };
  return {
    user_id: input.userId,
    destino: names.join(" → "),
    pais_destino: countryForStops(names),
    ciudad_origen: String(input.origin ?? "").trim() || null,
    fecha_salida: cities[0].llegada,
    fecha_regreso: cities[cities.length - 1].salida,
    num_viajeros: Math.round(Number(input.personas)),
    presupuesto_objetivo: null,
    // Sin cotización: vuelos y hotel ya los tiene. Nada de "$0" ni de "estimado".
    total_estimado: null,
    desglose_presupuesto: null,
    moneda: "MXN",
    status: "listo",
    analisis_ai: null,
    vuelos_json,
    hospedaje_json,
    restaurantes_json: [],
    tours_json: [],
    itinerario_json: {
      traido: true,
      ...(multi ? { multi: true } : {}),
      destinations: names,
      days: [],
      bases,
      ...(multi ? { logistics: { per_destination: bases.map((b) => ({ city: b.ciudad, checkin: b.llegada, checkout: b.salida, nights: b.noches })) } } : {}),
      ...(input.expansions?.length ? { region_expansions: input.expansions } : {}),
    },
    tips_personalizados: null,
    selections: serializeSelections(draft, ui),
  };
}

export type CreateBroughtResult =
  | { ok: true; tripId: string; resolved: Record<string, ResolvedHotel>; warnings: string[] }
  | { ok: false; errors: BroughtError[]; resolved: Record<string, ResolvedHotel> };

/**
 * Valida, ubica cada hotel (una llamada a geocode-address por hotel que aún no esté en `resolved`),
 * guarda el viaje y, si la persona lo pidió, activa el seguimiento de su vuelo (track-flight, con las
 * reglas de su plan en el servidor). Nada más: ni SerpApi, ni logistics-plan, ni IA.
 */
export async function createBroughtTrip(client: Client, input: BroughtTripInput, opts: { resolved?: Record<string, ResolvedHotel>; now?: Date } = {}): Promise<CreateBroughtResult> {
  const resolved: Record<string, ResolvedHotel> = { ...(opts.resolved ?? {}) };
  const errors = validateBroughtTrip(input);
  if (errors.length) return { ok: false, errors, resolved };
  const hotels = await resolveHotels(client, input.cities, resolved, opts.now);
  if (hotels.errors.length) return { ok: false, errors: hotels.errors, resolved };

  const row = broughtTripInsert(input, hotels.list);
  const { data, error } = await client.from("trips").insert(row as any).select("id").single();
  if (error || !data?.id) return { ok: false, errors: [{ campo: "guardar", mensaje: "No pudimos guardar tu viaje. Revisa tu conexión e intenta de nuevo." }], resolved };
  const tripId = String(data.id);

  const warnings: string[] = [];
  for (const f of input.flights ?? []) {
    if (!f.seguir || !normalizeFlightNumber(f.numero) || !isIso(f.fecha)) continue;
    try {
      const { error: tErr } = await client.functions.invoke("track-flight", {
        body: { flight: normalizeFlightNumber(f.numero), flight_date: f.fecha, trip_id: tripId, today: input.today },
      });
      if (tErr) {
        const { readFunctionError } = await import("@/lib/functionErrors");
        warnings.push((await readFunctionError(tErr, `No pudimos activar el seguimiento del vuelo ${normalizeFlightNumber(f.numero)}.`)).message);
      }
    } catch {
      warnings.push(`No pudimos activar el seguimiento del vuelo ${normalizeFlightNumber(f.numero)}.`);
    }
  }
  return { ok: true, tripId, resolved, warnings };
}

/** Ubica los hoteles que faltan (una llamada por hotel nuevo). Reúsa lo ya resuelto por su consulta. */
export async function resolveHotels(client: Pick<Client, "functions">, cities: BroughtCity[], resolved: Record<string, ResolvedHotel>, now?: Date) {
  const errors: BroughtError[] = [];
  const list: Array<ResolvedHotel | null> = [];
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    const q = hotelQuery(c.hotel ?? "", c.ciudad);
    if (!q) { list.push(null); continue; }
    const k = placeKey(q);
    const hit = resolved[k] ?? (await resolveHotel(client, c.hotel ?? "", c.ciudad, now));
    if (hit && hit.coincide === false) {
      errors.push({ campo: "hotel", index: i, mensaje: `No encontramos «${String(c.hotel).trim()}» en ${c.ciudad} en Google Maps (lo más parecido fue «${hit.nombre}», que no es el que escribiste). Escribe el nombre completo o la dirección, o deja el campo vacío.` });
      list.push(null);
      continue;
    }
    if (!hit) {
      errors.push({ campo: "hotel", index: i, mensaje: `No encontramos «${String(c.hotel).trim()}» en ${c.ciudad} en Google Maps. Escribe el nombre completo o la dirección.` });
      list.push(null);
      continue;
    }
    resolved[k] = hit;
    list.push(hit);
  }
  return { list, errors };
}

/** ¿El viaje lo trajo la persona (ya tenía vuelos y hotel)? */
export function isBroughtTrip(trip: any): boolean {
  const it = trip?.itinerario_json;
  return !!it && typeof it === "object" && !Array.isArray(it) && it.traido === true;
}

/** Hotel que la persona ya tiene en esa ciudad (hospedaje_json con ya_lo_tengo). */
export function broughtHotelFor(trip: any, city: unknown): any | null {
  const list: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  return list.find((h) => h?.ya_lo_tengo && (!city || sameCity(h?.ciudad, city))) ?? null;
}

/** Vuelos que la persona ya tiene (número y fecha). */
export function broughtFlights(trip: any): Array<{ numero_vuelo: string; fecha: string | null; seguimiento?: boolean }> {
  const list: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  return list.filter((v) => v?.ya_lo_tengo && v?.numero_vuelo);
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const hotelOf = (h: any): TripBaseHotel | null => {
  const lat = num(h?.lat);
  const lng = num(h?.lng);
  if (!h || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { nombre: String(h.nombre ?? "").trim() || "Hotel", direccion: h.direccion ?? null, place_id: h.place_id ?? null, lat, lng, maps_url: h.maps_url ?? null };
};

/**
 * Ciudades del viaje con sus fechas y el hotel con coordenadas (lo que necesita un itinerario
 * "alrededor del hotel"). Un viaje traído lo lee de itinerario_json.bases; uno generado, de sus
 * estancias (cityStays) y del primer hotel con lat/lng de esa ciudad en hospedaje_json.
 */
export function tripBases(trip: any): TripBase[] {
  const saved: any[] = Array.isArray(trip?.itinerario_json?.bases) ? trip.itinerario_json.bases : [];
  if (saved.length) {
    return saved.filter((b) => String(b?.ciudad ?? "").trim()).map((b) => ({
      ciudad: String(b.ciudad).trim(), llegada: isIso(b.llegada) ? b.llegada : null, salida: isIso(b.salida) ? b.salida : null,
      noches: Number.isFinite(Number(b.noches)) ? Number(b.noches) : null, hotel: hotelOf(b.hotel),
    }));
  }
  const hotels: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const stays = cityStays(trip);
  const cities = stays.length ? stays.map((s) => s.city) : tripDestinations(trip).slice(0, 1);
  return cities.map((ciudad, i) => {
    const s = stays[i] ?? null;
    const h = hotels.find((x) => (cities.length === 1 || sameCity(x?.ciudad, ciudad)) && hotelOf(x));
    return {
      ciudad, llegada: s?.checkin ?? (isIso(trip?.fecha_salida) ? trip.fecha_salida : null), salida: s?.checkout ?? (isIso(trip?.fecha_regreso) ? trip.fecha_regreso : null),
      noches: s?.nights ?? (isIso(trip?.fecha_salida) && isIso(trip?.fecha_regreso) ? nightsOf(trip.fecha_salida, trip.fecha_regreso) : null), hotel: hotelOf(h),
    };
  });
}
