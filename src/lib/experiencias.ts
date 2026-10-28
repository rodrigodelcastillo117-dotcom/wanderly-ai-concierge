// Pestaña "Experiencias" del viaje (pedido del dueño, 27-oct-2026: "mucha gente ya compró vuelos y hotel
// y solo quiere lo TOP"). Lógica pura (se prueba con Vitest):
//   * ciudades y hotel de cada ciudad del viaje (sirve con viajes creados de cualquier forma);
//   * llamada a experiencias-top SOLO al pulsar un botón (nunca al abrir la pestaña);
//   * itinerario día por día por cercanía al hotel, con horarios reales de Google cuando existen;
//   * guardado en trips.itinerario_json (los "agregados" del día que ya muestra la página del viaje).
// La IA no elige lugares: todo sale de búsquedas reales; el orden es por distancia y horario.
import { readFunctionError } from "@/lib/functionErrors";
import { cityStays, sameCity, tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { addItineraryItem } from "../../supabase/functions/concierge-chat/actions.ts";
import { quotedHotelForCity } from "@/lib/cityHotels";
import { quotedHotelIndex } from "@/lib/purchasePlan";

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

export type SlotId = "desayuno" | "manana" | "comida" | "tarde" | "cena" | "noche";
export const SLOTS: Array<{ id: SlotId; label: string; hora: string }> = [
  { id: "desayuno", label: "Desayuno", hora: "09:00" },
  { id: "manana", label: "Mañana", hora: "10:30" },
  { id: "comida", label: "Comida", hora: "14:00" },
  { id: "tarde", label: "Tarde", hora: "16:30" },
  { id: "cena", label: "Cena", hora: "20:30" },
];

export type PlanSlot = { slot: SlotId; label: string; hora: string; item: ExpItem | null; nota: string | null };
export type PlanDay = { fecha: string | null; dia: number; slots: PlanSlot[] };
export type Plan = { days: PlanDay[]; avisos: string[] };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fmtFecha = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${DIAS[t.getUTCDay()]} ${t.getUTCDate()} ${MESES[t.getUTCMonth()]}`;
};
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const toMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + (b || 0); };

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
 */
export function buildItinerary(items: ExpItem[], days: Array<string | null>, from = "del hotel"): Plan {
  const avisos: string[] = [];
  const used = new Set<string>();
  const pool = [...items].sort(byDistance);
  const closedSaid = new Set<string>();
  const plan: PlanDay[] = days.map((fecha, i) => ({ fecha, dia: i + 1, slots: [] }));
  for (const d of plan) {
    const wd = d.fecha ? weekday(d.fecha) : null;
    for (const s of SLOTS) {
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
      d.slots.push({ slot: s.id, label: s.label, hora: s.hora, item: chosen, nota });
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
