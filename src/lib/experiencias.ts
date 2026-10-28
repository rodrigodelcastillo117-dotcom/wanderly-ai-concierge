// Pestaña "Experiencias" del viaje (pedido del dueño, 27-oct-2026: "mucha gente ya compró vuelos y hotel
// y solo quiere lo TOP"). Lógica pura (se prueba con Vitest):
//   * ciudades y hotel de cada ciudad del viaje (sirve con viajes creados de cualquier forma);
//   * llamada a experiencias-top SOLO al pulsar un botón (nunca al abrir la pestaña);
//   * itinerario día por día por cercanía al hotel, con horarios reales de Google cuando existen;
//   * guardado en trips.itinerario_json (los "agregados" del día que ya muestra la página del viaje).
// La IA no elige lugares: todo sale de búsquedas reales; el orden es por distancia y horario.
import { clockOf } from "../../supabase/functions/_shared/tripCalendar.ts";
import { readFunctionError } from "@/lib/functionErrors";
import { cityStays, sameCity, tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { addItineraryItem } from "../../supabase/functions/concierge-chat/actions.ts";
import { quotedHotelForCity } from "@/lib/cityHotels";
import { quotedHotelIndex } from "@/lib/purchasePlan";
import { durationHours, isGroundTripOption, tripFlightProblems } from "@/lib/booking";
import { countryOfCity } from "../../supabase/functions/_shared/airports.ts";

export type Invoke = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: any; error: any }>;

export type TripCity = { label: string; key: string; checkin: string | null; checkout: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown) => (typeof v === "string" && ISO.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Ciudades del viaje con sus fechas (multi-destino: la estancia de cada ciudad; uno solo: el viaje). */
export function tripCities(trip: any, keyFor: (label: string) => string = (x) => x): TripCity[] {
  const stays = cityStays(trip);
  if (stays.length) return stays.map((s) => ({ label: s.city, key: keyFor(s.city), checkin: s.checkin, checkout: s.checkout }));
  const dests = tripDestinations(trip);
  const list = dests.length ? dests : [String(trip?.destino ?? "").trim()].filter(Boolean);
  return list.map((c) => ({ label: c, key: keyFor(c), checkin: iso(trip?.fecha_salida), checkout: iso(trip?.fecha_regreso) }));
}

export type CityHotel = { nombre: string; lat: number | null; lng: number | null; origen: "tuyo" | "cotizado" };

const hotelCoords = (h: any) => ({
  lat: num(h?.lat) ?? num(h?.latitud) ?? num(h?.latitude) ?? num(h?.gps_coordinates?.latitude),
  lng: num(h?.lng) ?? num(h?.longitud) ?? num(h?.longitude) ?? num(h?.gps_coordinates?.longitude),
});

/**
 * Hotel del viaje en esa ciudad: el que agregó la persona (o uno reservado) primero; si no, el de la
 * cotización. null si el viaje no tiene hotel (se usa el centro aproximado y se dice).
 */
export function hotelForCity(trip: any, city: string, multi: boolean): CityHotel | null {
  const list: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const inCity = (h: any) => !multi || !h?.ciudad || sameCity(h.ciudad, city);
  const own = list.find((h) => inCity(h) && (h?.desde_usuario === true || h?.desde_pdf === true || /reservad|confirmad/i.test(String(h?.estado_reserva ?? ""))));
  const pick = own ?? (() => {
    const i = multi ? quotedHotelForCity(trip, city) : quotedHotelIndex(trip);
    return i >= 0 ? list[i] : null;
  })();
  const nombre = String(pick?.nombre ?? pick?.name ?? "").trim();
  if (!nombre) return null;
  return { nombre, ...hotelCoords(pick), origen: own ? "tuyo" : "cotizado" };
}

// ─── Lo TOP ya buscado, guardado en este navegador ───
// Caso E2E 28-oct-2026: al recargar la página se perdía lo TOP y había que volver a buscar (otra búsqueda
// en vivo). Se guarda la última respuesta por viaje y ciudad, 12 h, solo en este navegador; el bloque dice
// cuándo se consultó. Sin almacenamiento (modo privado) no pasa nada: se busca con el botón como antes.

export const EXP_CACHE_TTL_MS = 12 * 3600_000;
const expTopKey = (tripId: string, city: string) => `iatos:exp-top:${tripId}:${city.toLowerCase()}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const defaultStorage = (): StorageLike | null => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

export function saveExpTop(tripId: string | null | undefined, city: string, data: unknown, now = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  if (!tripId || !storage || !data) return;
  try { storage.setItem(expTopKey(tripId, city), JSON.stringify({ at: now, data })); } catch { /* lleno o bloqueado */ }
}

export function loadExpTop(tripId: string | null | undefined, city: string, now = Date.now(), storage: StorageLike | null = defaultStorage()): any | null {
  if (!tripId || !storage) return null;
  try {
    const raw = storage.getItem(expTopKey(tripId, city));
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; data?: any };
    const at = Number(v?.at);
    if (!Number.isFinite(at) || now - at > EXP_CACHE_TTL_MS || now < at || !v?.data?.ok) return null;
    return v.data;
  } catch { return null; }
}

// ─── Llamada (solo con botón) ───

export type ExpRequest = { city: string; dateFrom?: string | null; dateTo?: string | null; hotel?: CityHotel | null; query?: string | null; blocks?: string[] };

export type ExpResponse = { ok: boolean; data?: any; message?: string; limit?: boolean };

export async function requestExperiencias(invoke: Invoke, q: ExpRequest): Promise<ExpResponse> {
  const body: Record<string, unknown> = { city: q.city };
  if (q.dateFrom) body.date_from = q.dateFrom;
  if (q.dateTo) body.date_to = q.dateTo;
  if (q.hotel) body.hotel = { nombre: q.hotel.nombre, ...(q.hotel.lat != null && q.hotel.lng != null ? { lat: q.hotel.lat, lng: q.hotel.lng } : {}) };
  if (q.query) body.query = q.query;
  if (q.blocks?.length) body.blocks = q.blocks;
  try {
    const { data, error } = await invoke("experiencias-top", { body });
    if (error) {
      const e = await readFunctionError(error, "No pudimos buscar ahora. Intenta de nuevo.");
      return { ok: false, message: e.message, limit: /l[ií]mite/i.test(e.message) };
    }
    if (!data?.ok) return { ok: false, message: String(data?.motivo ?? data?.message ?? "No pudimos buscar ahora. Intenta de nuevo."), limit: data?.limite_uso_justo === true };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (await readFunctionError(e, "No pudimos buscar ahora. Intenta de nuevo.")).message };
  }
}

// ─── Elementos y claves ("Ya reservé") ───

export type ExpKind = "restaurante" | "museo" | "tour" | "wow" | "evento";
export type OpeningPeriod = { open: { day: number; hour: number; minute: number }; close: { day: number; hour: number; minute: number } | null };

export type ExpItem = {
  key: string;
  kind: ExpKind;
  city: string;
  title: string;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  rating: number | null;
  reviews: number | null;
  serves?: { desayuno: boolean | null; brunch: boolean | null; comida: boolean | null; cena: boolean | null } | null;
  periods?: OpeningPeriod[] | null;
  /** Evento: fecha y hora fijas. */
  fecha?: string | null;
  hora?: string | null;
  address?: string | null;
  placeId?: string | null;
  url?: string | null;
};

const slug = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Clave estable del elemento para la marca "Ya reservé" (trip_purchase_marks.item_key, ≤ 300). */
export function expKey(kind: ExpKind, city: string, id: string | null | undefined, title: string): string {
  return `exp:${slug(city)}:${kind}:${String(id ?? "").slice(0, 120) || slug(title)}`.slice(0, 300);
}

/** Respuesta de experiencias-top → elementos (para elegir y para el itinerario). */
export function itemsFromResponse(data: any, city: string): Record<ExpKind, ExpItem[]> {
  const out: Record<ExpKind, ExpItem[]> = { restaurante: [], museo: [], tour: [], wow: [], evento: [] };
  for (const r of Array.isArray(data?.restaurantes?.items) ? data.restaurantes.items : []) {
    if (!r?.nombre) continue;
    out.restaurante.push({
      key: expKey("restaurante", city, r.place_id, r.nombre), kind: "restaurante", city, title: r.nombre,
      lat: num(r.lat), lng: num(r.lng), distanceKm: num(r.distancia_km), rating: num(r.rating), reviews: num(r.resenas),
      serves: r.sirve ?? null, periods: Array.isArray(r.periodos) ? r.periodos : null, address: r.direccion ?? null, placeId: r.place_id ?? null,
    });
  }
  for (const m of Array.isArray(data?.museos?.items) ? data.museos.items : []) {
    if (!m?.nombre) continue;
    out.museo.push({
      key: expKey("museo", city, m.id, m.nombre), kind: "museo", city, title: m.nombre,
      lat: num(m.lugar?.lat), lng: num(m.lugar?.lng), distanceKm: num(m.distancia_km), rating: num(m.lugar?.rating), reviews: num(m.lugar?.resenas),
      periods: Array.isArray(m.lugar?.periodos) ? m.lugar.periodos : null, placeId: m.lugar?.place_id ?? null, url: m.taquilla_oficial ?? null,
    });
  }
  for (const [kind, block] of [["tour", data?.tours], ["wow", data?.wow]] as const) {
    for (const t of Array.isArray(block?.results) ? block.results : []) {
      if (!t?.title) continue;
      out[kind].push({ key: expKey(kind, city, t.codigo, t.title), kind, city, title: t.title, lat: null, lng: null, distanceKm: null, rating: num(t.rating), reviews: num(t.resenas), url: t.url ?? null });
    }
  }
  for (const e of Array.isArray(data?.eventos?.results) ? data.eventos.results : []) {
    if (!e?.title) continue;
    out.evento.push({
      key: expKey("evento", city, e.id, e.title), kind: "evento", city, title: e.title, lat: num(e.lat), lng: num(e.lng), distanceKm: null,
      rating: null, reviews: null, fecha: iso(e.fecha), hora: typeof e.hora === "string" ? e.hora : null, address: [e.recinto, e.direccion].filter(Boolean).join(", ") || null, url: e.url ?? null,
    });
  }
  return out;
}

// ─── Itinerario día por día ───

export type SlotId = "desayuno" | "manana" | "comida" | "tarde" | "cena" | "noche" | "llegada" | "salida" | "en_camino";
export const SLOTS: Array<{ id: SlotId; label: string; hora: string }> = [
  { id: "desayuno", label: "Desayuno", hora: "09:00" },
  { id: "manana", label: "Mañana", hora: "10:30" },
  { id: "comida", label: "Comida", hora: "14:00" },
  { id: "tarde", label: "Tarde", hora: "16:30" },
  { id: "cena", label: "Cena", hora: "20:30" },
];

/**
 * Un espacio del día. `texto` se muestra en lugar de "Libre" cuando no hay lugar elegido por IATOS:
 * "Llegada y descanso", "Salida al aeropuerto" o la comida que el itinerario del viaje ya tiene.
 */
export type PlanSlot = { slot: SlotId; label: string; hora: string; item: ExpItem | null; nota: string | null; texto?: string | null };
export type PlanDay = { fecha: string | null; dia: number; slots: PlanSlot[] };
export type Plan = { days: PlanDay[]; avisos: string[] };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fmtFecha = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${DIAS[t.getUTCDay()]} ${t.getUTCDate()} ${MESES[t.getUTCMonth()]}`;
};
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const toMin = (h: string) => { const [a, b] = String(h ?? "").split(":").map(Number); return Number.isFinite(a) ? a * 60 + (b || 0) : 0; };
const fromMin = (m: number) => { const x = Math.max(0, Math.min(23 * 60 + 59, Math.round(m))); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Días de la estancia (de la llegada al último día antes de salir; al menos uno). */
export function stayDays(checkin: string | null, checkout: string | null, fallbackCount = 2): Array<string | null> {
  if (checkin && ISO.test(checkin)) {
    const end = checkout && ISO.test(checkout) && checkout > checkin ? checkout : null;
    const out: string[] = [];
    let t = Date.parse(`${checkin}T00:00:00Z`);
    const stop = end ? Date.parse(`${end}T00:00:00Z`) : t + 86400000;
    while (t < stop && out.length < 21) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; }
    return out.length ? out : [checkin];
  }
  return Array.from({ length: Math.max(1, fallbackCount) }, () => null);
}

/**
 * ¿Abierto ese día a esa hora según los periodos de Google? null si Google no publica horario.
 * false también si ese día no tiene ningún periodo (cerrado todo el día).
 */
export function openAt(periods: OpeningPeriod[] | null | undefined, day: number, hhmm: string): boolean | null {
  if (!Array.isArray(periods) || !periods.length) return null;
  const now = day * 1440 + toMin(hhmm);
  const W = 7 * 1440;
  for (const p of periods) {
    if (!p?.open) continue;
    if (!p.close) {
      if (p.open.day === 0 && p.open.hour === 0 && p.open.minute === 0) return true;
      continue;
    }
    const s = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let e = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (e <= s) e += W;
    if ((now >= s && now < e) || (now + W >= s && now + W < e)) return true;
  }
  return false;
}

// ─── Llegada, salida y lo que el itinerario ya tiene (pendiente E2E 28-oct-2026) ───
// El día de llegada tras un vuelo largo no lleva tours ni museos por la mañana ("Llegada y descanso" y
// una cena cerca del hotel si cabe); con la hora de llegada del vuelo no se pone nada antes de llegar;
// el último día se deja tiempo para ir al aeropuerto si se sabe la hora del vuelo; y no se repite una
// comida que el itinerario del viaje ya tiene ese día.

/** Más de esto (horas de vuelo) es un vuelo largo; sin duración, un vuelo internacional cuenta como largo. */
export const LONG_FLIGHT_HOURS = 8;

export type ArrivalInfo = {
  /** Día en que se llega (puede ser el día siguiente a la salida); null = el primer día de la estancia. */
  fecha: string | null;
  /** Hora local de llegada "HH:MM" si el vuelo la trae. */
  hora: string | null;
  horas: number | null;
  internacional: boolean | null;
  largo: boolean;
};
export type DepartureInfo = { fecha: string; hora: string; internacional: boolean | null };
export type ExistingMeal = { slot: "desayuno" | "comida" | "cena"; titulo: string };
export type ItineraryContext = { arrival?: ArrivalInfo | null; departure?: DepartureInfo | null; meals?: Record<string, ExistingMeal[]> };

/** "HH:MM" de "2026-11-11 12:45", "12:45" o "7:05" (la misma función que usa el servidor para el calendario del viaje). */
export { clockOf };

const fmtHoras = (h: number) => { const H = Math.floor(h), M = Math.round((h - H) * 60); return M ? `${H} h ${M} min` : `${H} h`; };

/** Horas de vuelo publicadas (minutos de Google Flights o "12h 45m"); null si no se saben o no son creíbles. */
function flightHours(v: any, trip: any): number | null {
  const min = num(v?.duration_min) ?? num(v?.total_duration) ?? num(v?.duration_minutes);
  const h = min != null && min > 0 ? min / 60 : durationHours(v?.duracion ?? v?.duration);
  if (h == null || !(h > 0)) return null;
  // "65 h" de una tarifa de referencia (ida y vuelta con escalas largas) no dice cuánto dura la ida.
  if (tripFlightProblems(v, trip).includes("duracion_absurda")) return null;
  return h;
}

const normCountry = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** ¿Vuelo internacional? Por los países de origen y destino; null si no se sabe. */
function isInternational(trip: any, v: any, city: string): boolean | null {
  const from = countryOfCity(v?.from) ?? countryOfCity(trip?.ciudad_origen);
  const to = countryOfCity(v?.to) ?? countryOfCity(city) ?? (trip?.pais_destino ? String(trip.pais_destino) : null);
  if (!from || !to) return null;
  return normCountry(from) !== normCountry(to);
}

const flightRows = (trip: any): any[] => (Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []).filter((v: any) => v && !isGroundTripOption(v));

/** El vuelo de la persona: el elegido, uno suyo (PDF / "ya lo tengo"), el equilibrado o el primero. */
function pickFlight(trip: any, rows: any[]): any | null {
  if (!rows.length) return null;
  const all: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const si = Number(trip?.selections?.vuelo?.i);
  const sel = Number.isInteger(si) && si >= 0 ? all[si] : null;
  if (sel && rows.includes(sel)) return sel;
  return rows.find((v) => v?.desde_pdf === true || v?.ya_lo_tengo === true || /reservad|confirmad/i.test(String(v?.estado_reserva ?? "")))
    ?? rows.find((v) => String(v?.tier ?? "").toLowerCase() === "equilibrio")
    ?? rows[0];
}

/** Cómo se llega a la ciudad (solo si se llega en avión: por tierra no hay vuelo largo que descansar). */
export function arrivalFor(trip: any, city: TripCity, isFirst: boolean): ArrivalInfo | null {
  const rows = flightRows(trip).filter((v) => {
    const to = v?.to ?? v?.ciudad;
    if (to) return sameCity(to, city.label) || sameCity(v?.ciudad, city.label);
    return isFirst;
  }).filter((v) => !(v?.from && sameCity(v.from, city.label)));
  // Un vuelo con fecha (traído en PDF) cuenta si es del día de llegada o el anterior (vuelo nocturno).
  const dated = city.checkin ? rows.filter((v) => !iso(v?.fecha) || iso(v.fecha) === city.checkin || addDays(iso(v.fecha)!, 1) === city.checkin) : rows;
  const v = pickFlight(trip, dated);
  if (!v) return null;
  const rawArr = v?.llegada ?? v?.hora_llegada ?? v?.arrival?.time ?? v?.arrives ?? v?.arrival_time ?? null;
  const hora = clockOf(rawArr);
  const fecha = iso(rawArr) ?? (hora && iso(v?.fecha) ? iso(v.fecha) : null);
  const horas = flightHours(v, trip);
  const internacional = isInternational(trip, v, city.label);
  const largo = horas != null ? horas > LONG_FLIGHT_HOURS : internacional === true;
  return { fecha, hora, horas, internacional, largo };
}

/** Vuelo de salida de la ciudad con hora (traído en PDF o capturado): para dejar tiempo de ir al aeropuerto. */
export function departureFor(trip: any, city: TripCity, isLast: boolean): DepartureInfo | null {
  const rows = flightRows(trip).filter((v) => {
    const f = iso(v?.fecha), h = clockOf(v?.hora_salida ?? v?.salida);
    if (!f || !h) return false;
    if (city.checkin && f < city.checkin) return false;
    if (v?.from) return sameCity(v.from, city.label);
    return isLast && !!city.checkout && f === city.checkout;
  });
  if (!rows.length) return null;
  const v = [...rows].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  const to = v?.to ?? trip?.ciudad_origen ?? null;
  const from = countryOfCity(city.label), dest = countryOfCity(to);
  return { fecha: iso(v.fecha)!, hora: clockOf(v.hora_salida ?? v.salida)!, internacional: from && dest ? normCountry(from) !== normCountry(dest) : null };
}

const MEAL_WORDS: Array<[ExistingMeal["slot"], RegExp]> = [
  ["desayuno", /\b(desayun\w*|brunch|breakfast)\b/i],
  ["comida", /\b(comida|comer|almuerzo|almorzar|lunch)\b/i],
  ["cena", /\b(cena|cenar|dinner)\b/i],
];
const mealByHour = (h: string | null): ExistingMeal["slot"] | null => {
  if (!h) return null;
  const m = toMin(h);
  return m < 11 * 60 + 30 ? "desayuno" : m < 17 * 60 ? "comida" : m >= 18 * 60 ? "cena" : null;
};
const short = (t: unknown) => { const x = String(t ?? "").replace(/\s+/g, " ").trim(); return x.length > 90 ? `${x.slice(0, 87)}…` : x; };

/**
 * Comidas que el itinerario del viaje ya tiene por fecha: las agregadas (Iato, reservas, la persona) y
 * las del texto del día ("Noche: cena en Trattoria da Enzo"). Los agregados de Experiencias de esta
 * ciudad no cuentan: se reemplazan al guardar.
 */
export function existingMeals(trip: any, cityKey: string, multi: boolean): Record<string, ExistingMeal[]> {
  const it = trip?.itinerario_json;
  const days: any[] = Array.isArray(it) ? it : it && typeof it === "object" && Array.isArray(it.days) ? it.days : [];
  const start = iso(trip?.fecha_salida);
  const out: Record<string, ExistingMeal[]> = {};
  const add = (fecha: string, m: ExistingMeal) => {
    const list = (out[fecha] ??= []);
    if (!list.some((x) => x.slot === m.slot)) list.push(m);
  };
  for (const d of days) {
    if (!d || typeof d !== "object") continue;
    // Multi-destino: solo por fecha (la numeración de días puede ser por ciudad).
    const n = Number(d.dia);
    const fecha = iso(d.fecha) ?? (!multi && start && Number.isInteger(n) && n >= 1 ? addDays(start, n - 1) : null);
    if (!fecha) continue;
    for (const a of Array.isArray(d.agregados) ? d.agregados : []) {
      if (!a || (a.fuente === SOURCE && sameCity(a.ciudad, cityKey))) continue;
      const titulo = String(a.titulo ?? "");
      const byWord = MEAL_WORDS.find(([, re]) => re.test(titulo))?.[0] ?? null;
      const isFood = /restaur|food|comida/i.test(String(a.tipo ?? a.categoria ?? ""));
      const slot = byWord ?? (isFood ? mealByHour(clockOf(a.hora)) : null);
      if (slot) add(fecha, { slot, titulo: short(titulo) });
    }
    const textFor: Array<[ExistingMeal["slot"], unknown]> = [["desayuno", d["mañana"] ?? d.manana], ["comida", d.tarde], ["comida", d["mañana"] ?? d.manana], ["cena", d.noche]];
    for (const [slot, txt] of textFor) {
      if (typeof txt !== "string" || !txt.trim()) continue;
      const re = MEAL_WORDS.find(([k]) => k === slot)![1];
      if (re.test(txt)) add(fecha, { slot, titulo: short(txt) });
    }
  }
  return out;
}

/** Todo lo que el plan necesita saber del viaje para esa ciudad. */
export function itineraryContext(trip: any, city: TripCity, cities: TripCity[], multi: boolean): ItineraryContext {
  const i = Math.max(0, cities.findIndex((c) => c.label === city.label));
  return {
    arrival: arrivalFor(trip, city, i === 0),
    departure: departureFor(trip, city, i === cities.length - 1),
    meals: existingMeals(trip, city.key, multi),
  };
}

/** Lo que dura cada espacio (para dejar tiempo de salir al aeropuerto). */
const SLOT_MIN: Partial<Record<SlotId, number>> = { desayuno: 60, manana: 150, comida: 90, tarde: 150, cena: 120 };

const fits = (item: ExpItem, slot: SlotId): boolean => {
  if (item.kind === "restaurante") {
    const sv = item.serves ?? null;
    if (slot === "desayuno") return sv?.desayuno === true || sv?.brunch === true;
    if (slot === "comida") return sv?.comida !== false;
    if (slot === "cena") return sv?.cena !== false;
    return false;
  }
  if (item.kind === "museo") return slot === "manana" || slot === "tarde";
  if (item.kind === "tour") return slot === "manana" || slot === "tarde";
  if (item.kind === "wow") return slot === "tarde";
  return false;
};

const kmText = (km: number, from: string) => (km < 0.1 ? `a menos de 100 m ${from}` : `${km.toLocaleString("es-MX")} km ${from}`);

const byDistance = (a: ExpItem, b: ExpItem) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999)
  || (Number(b.rating ?? 0) - Number(a.rating ?? 0)) || (Number(b.reviews ?? 0) - Number(a.reviews ?? 0));

/**
 * Ordena por día los elementos elegidos (o los TOP sugeridos): desayuno, mañana (museo o tour), comida,
 * tarde (experiencia) y cena, del más cercano al hotel al más lejano. Un lugar con horario de Google
 * que cierra ese día (o a esa hora) no se pone ahí y se dice. Los eventos van en su fecha y hora.
 * Con `ctx` (itineraryContext): respeta la llegada (vuelo largo → "Llegada y descanso" y solo una cena
 * cerca del hotel si cabe; con hora de llegada, nada antes), la salida al aeropuerto y las comidas que
 * el itinerario del viaje ya tiene ese día (no pone otra).
 */
export function buildItinerary(items: ExpItem[], days: Array<string | null>, from = "del hotel", ctx: ItineraryContext = {}): Plan {
  const avisos: string[] = [];
  const used = new Set<string>();
  const pool = [...items].sort(byDistance);
  const closedSaid = new Set<string>();
  const arrival = ctx.arrival ?? null;
  const departure = ctx.departure ?? null;
  const dayList = [...days];
  // El día del vuelo de regreso (checkout) no es noche de hotel, pero con hora de vuelo se planea la mañana.
  const lastDay = dayList[dayList.length - 1];
  if (departure && lastDay && !dayList.includes(departure.fecha) && addDays(lastDay, 1) === departure.fecha) dayList.push(departure.fecha);
  const plan: PlanDay[] = dayList.map((fecha, i) => ({ fecha, dia: i + 1, slots: [] }));
  const arrivalDay = arrival ? (arrival.fecha && plan.some((p) => p.fecha === arrival.fecha) ? arrival.fecha : plan[0]?.fecha ?? null) : null;

  const pick = (d: PlanDay, wd: number | null, s: { id: SlotId; hora: string }): { chosen: ExpItem | null; nota: string | null } => {
    let chosen: ExpItem | null = null;
    let nota: string | null = null;
    for (const it of pool) {
      if (used.has(it.key) || it.kind === "evento" || !fits(it, s.id)) continue;
      if (wd !== null) {
        const open = openAt(it.periods, wd, s.hora);
        if (open === false) {
          const k = `${it.key}|${d.fecha}`;
          if (it.kind === "museo" && !closedSaid.has(k) && !openAt(it.periods, wd, "12:00")) {
            closedSaid.add(k);
            avisos.push(`${it.title} cierra el ${fmtFecha(d.fecha!)} (horario de Google): no lo pusimos ese día.`);
          }
          continue;
        }
        if (open === null && it.kind === "museo") nota = "Horario no consultado en Google: revisa su sitio oficial.";
      }
      chosen = it;
      break;
    }
    if (chosen) used.add(chosen.key);
    else nota = null;
    if (chosen && chosen.kind !== "museo") nota = chosen.distanceKm != null ? kmText(chosen.distanceKm, from) : null;
    else if (chosen && chosen.kind === "museo" && !nota && chosen.distanceKm != null) nota = kmText(chosen.distanceKm, from);
    return { chosen, nota };
  };

  for (const d of plan) {
    const wd = d.fecha ? weekday(d.fecha) : null;
    const meals = (d.fecha && ctx.meals?.[d.fecha]) || [];
    // Aún en camino (el vuelo llega al día siguiente): nada en la ciudad ese día.
    if (arrival?.fecha && d.fecha && d.fecha < arrival.fecha) {
      d.slots.push({ slot: "en_camino", label: "En camino", hora: "—", item: null, nota: `Tu vuelo llega el ${fmtFecha(arrival.fecha)}${arrival.hora ? ` a las ${arrival.hora}` : ""}.`, texto: "Día de vuelo" });
      continue;
    }
    const isArrival = !!arrival && d.fecha === arrivalDay && (d.fecha !== null || d.dia === 1);
    const arrMin = isArrival && arrival!.hora ? toMin(arrival!.hora) : null;
    const isDeparture = !!departure && d.fecha === departure.fecha;
    // Llegar al aeropuerto 3 h antes (internacional o sin saber) o 2 h (nacional), más ~1 h de traslado.
    const cutoff = isDeparture ? toMin(departure!.hora) - (departure!.internacional === false ? 120 : 180) - 60 : null;
    if (isArrival && arrival!.largo) {
      const motivo = arrival!.horas != null ? `Vuelo de ${fmtHoras(arrival!.horas)}` : "Vuelo internacional";
      d.slots.push({ slot: "llegada", label: "Llegada", hora: arrival!.hora ?? "—", item: null, texto: "Llegada y descanso",
        nota: `${motivo}${arrival!.hora ? `, llegas a las ${arrival!.hora}` : ""}: sin tours ni museos por la mañana para que descanses.` });
    } else if (isArrival && arrMin !== null) {
      d.slots.push({ slot: "llegada", label: "Llegada", hora: arrival!.hora!, item: null, texto: "Llegada al hotel", nota: `Tu vuelo llega a las ${arrival!.hora}.` });
    }
    for (const s of SLOTS) {
      const sMin = toMin(s.hora);
      const meal = meals.find((m) => m.slot === s.id);
      if (isArrival && arrival!.largo) {
        // Tras un vuelo largo: solo comidas (cena cerca del hotel), y solo si caben después de llegar y descansar.
        if (s.id !== "comida" && s.id !== "cena") continue;
        if (s.id === "comida" && (arrMin === null || arrMin + 150 > sMin)) continue;
        if (s.id === "cena" && arrMin !== null && arrMin + 120 > sMin) continue;
      } else if (arrMin !== null && sMin < arrMin + 90) continue;
      if (cutoff !== null && sMin + (SLOT_MIN[s.id] ?? 90) > cutoff) continue;
      if (meal) {
        d.slots.push({ slot: s.id, label: s.label, hora: s.hora, item: null, texto: meal.titulo, nota: "Ya está en el itinerario de tu viaje: no agregamos otra." });
        continue;
      }
      const { chosen, nota } = pick(d, wd, s);
      d.slots.push({ slot: s.id, label: s.label, hora: s.hora, item: chosen, nota });
    }
    if (isDeparture && cutoff !== null) {
      d.slots.push({ slot: "salida", label: "Aeropuerto", hora: fromMin(cutoff), item: null, texto: "Salida al aeropuerto",
        nota: `Tu vuelo sale a las ${departure!.hora}: llega al aeropuerto ${departure!.internacional === false ? "2 h" : "3 h"} antes.` });
    }
  }
  // Eventos: su fecha y su hora (Ticketmaster).
  for (const ev of items.filter((x) => x.kind === "evento")) {
    const d = plan.find((p) => p.fecha && p.fecha === ev.fecha);
    if (!d) { avisos.push(`${ev.title} es el ${ev.fecha ? fmtFecha(ev.fecha) : "día que indica Ticketmaster"}, fuera de tus días en la ciudad.`); continue; }
    used.add(ev.key);
    const hora = ev.hora && /^\d{2}:\d{2}/.test(ev.hora) ? ev.hora.slice(0, 5) : "21:00";
    d.slots.push({ slot: "noche", label: "Evento", hora, item: ev, nota: "Hora publicada por Ticketmaster" });
    d.slots.sort((a, b) => toMin(a.hora) - toMin(b.hora));
  }
  const left = items.filter((x) => !used.has(x.key));
  if (left.length) avisos.push(`No cupieron en tus días: ${left.slice(0, 4).map((x) => x.title).join(", ")}${left.length > 4 ? ` y ${left.length - 4} más` : ""}.`);
  return { days: plan, avisos };
}

/** Si la persona no eligió nada: los TOP sugeridos (3 restaurantes por día, museos, tours y wow). */
export function suggestedItems(all: Record<ExpKind, ExpItem[]>, dayCount: number): ExpItem[] {
  const n = Math.max(1, dayCount);
  return [
    ...all.restaurante.slice(0, n * 3), ...all.museo.slice(0, n), ...all.tour.slice(0, n), ...all.wow.slice(0, n),
  ];
}

// ─── Guardado en el itinerario del viaje ───

const SOURCE = "experiencias";

/**
 * Plan → trips.itinerario_json: cada espacio con lugar va como "agregado" del día (lo que ya muestra la
 * página del viaje en "Agregado por ti"). Se reemplazan los agregados de Experiencias de esa ciudad (no
 * los de Iato ni el texto del análisis). En multi-destino el día nuevo lleva su ciudad.
 */
export function applyPlanToItinerary(itinerario: unknown, trip: { fecha_salida?: string | null }, cityKey: string, plan: Plan, multi: boolean): unknown {
  const isObj = !!itinerario && typeof itinerario === "object" && !Array.isArray(itinerario);
  const days0: any[] = Array.isArray(itinerario) ? itinerario : isObj && Array.isArray((itinerario as any).days) ? (itinerario as any).days : [];
  const cleaned = days0.map((d) => (Array.isArray(d?.agregados)
    ? { ...d, agregados: d.agregados.filter((a: any) => !(a?.fuente === SOURCE && sameCity(a?.ciudad, cityKey))) }
    : d));
  let next: unknown = isObj ? { ...(itinerario as Record<string, unknown>), days: cleaned } : cleaned;
  for (const d of plan.days) {
    if (!d.fecha) continue;
    for (const s of d.slots) {
      if (!s.item) continue;
      const entry: any = {
        fecha: d.fecha, hora: s.hora, titulo: `${s.label}: ${s.item.title}`, ...(s.item.address ? { lugar: s.item.address } : {}),
        nota: "Desde Experiencias. No es una reserva: márcalo como \"Ya reservé\" cuando reserves.", fuente: SOURCE, ciudad: cityKey, exp_key: s.item.key,
      };
      next = addItineraryItem(next, trip, entry);
    }
  }
  // addItineraryItem marca "agregado_por: iato": estos los agregó la persona desde Experiencias.
  const fix = (list: any[]) => list.map((d) => (Array.isArray(d?.agregados)
    ? { ...d, agregados: d.agregados.map((a: any) => (a?.fuente === SOURCE ? { ...a, agregado_por: "usuario" } : a)) } : d));
  next = Array.isArray(next) ? fix(next) : { ...(next as Record<string, unknown>), days: fix((next as any).days ?? []) };
  if (multi) {
    const fechas = new Set(plan.days.map((d) => d.fecha).filter(Boolean));
    const list: any[] = Array.isArray(next) ? next : (next as any).days;
    list.forEach((d, i) => { if (d && !d.ciudad && fechas.has(d.fecha)) list[i] = { ...d, ciudad: cityKey }; });
  }
  return next;
}
