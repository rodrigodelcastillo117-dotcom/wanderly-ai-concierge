// Recuerdos: lógica pura (sin red) de la vista unificada, el calendario, los álbumes y la asignación de
// viaje por fecha. La prueban src/test/recuerdos*.test.ts(x).
//
// Una vista, tres fuentes (sin copiar nada):
//   · "recuerdo": lo que la persona sube en Recuerdos (tabla recuerdos, bucket privado recuerdos).
//   · "momento": sus Mejores momentos (travel_moments, bucket travel-moments-private).
//   · "diario": las fotos de SUS entradas del diario (trip_journal_entries, bucket journal-photos).
// Solo los recuerdos se pueden borrar, mover de viaje o marcar como favoritos desde aquí; los otros dos
// se editan donde nacieron (el visor lo dice).
import { MONTHS_ES } from "@/lib/wrapped";

export const RECUERDOS_BUCKET = "recuerdos" as const;

export type RecuerdoSource = "recuerdo" | "momento" | "diario";
export type DateSource = "exif" | "video" | "archivo" | "manual" | "subida";
export type TripSource = "fecha" | "manual" | "ninguno";

export type RecuerdoItem = {
  /** Única entre fuentes: "<fuente>:<id>". */
  key: string;
  id: string;
  source: RecuerdoSource;
  /** false = lo compartió otro miembro del viaje (solo se ve). */
  mine: boolean;
  tripId: string | null;
  /** Día del calendario (YYYY-MM-DD). */
  day: string;
  /** Para ordenar dentro del día. */
  sortKey: string;
  mediaType: "foto" | "video";
  bucket: string;
  path: string;
  thumbPath: string | null;
  /** URL pública heredada (momentos muy viejos); se usa si no hay ruta privada. */
  legacyUrl?: string | null;
  favorite: boolean;
  dateSource: DateSource;
  tripSource: TripSource;
  caption?: string | null;
  durationS?: number | null;
};

export type RecuerdoTrip = { id: string; destino: string | null; pais_destino?: string | null; fecha_salida: string | null; fecha_regreso: string | null; mine?: boolean };

// ───────────────────────── fechas ─────────────────────────
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayNum = (iso: string | null | undefined): number | null => {
  const m = iso ? ISO.exec(iso.slice(0, 10)) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};
const isoOfDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** Día local (YYYY-MM-DD) de un instante, en la zona del dispositivo. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Viaje al que pertenece una foto por su fecha: el que la contiene entre salida y regreso (sin regreso,
 * solo el día de salida). Si se encimen dos, el más corto (el más específico), y a igual duración el que
 * empezó después. null si ninguno.
 */
export function tripForDate(day: string, trips: RecuerdoTrip[]): string | null {
  const d = dayNum(day);
  if (d == null) return null;
  let best: { id: string; len: number; start: number } | null = null;
  for (const t of trips) {
    const s = dayNum(t.fecha_salida);
    if (s == null) continue;
    let e = dayNum(t.fecha_regreso) ?? s;
    if (e < s) e = s;
    if (d < s || d > e) continue;
    const len = e - s;
    if (!best || len < best.len || (len === best.len && s > best.start)) best = { id: t.id, len, start: s };
  }
  return best?.id ?? null;
}

// ───────────────────────── calendario ─────────────────────────
export type CalendarCell = { day: string; inMonth: boolean; items: RecuerdoItem[] };

/** Cuadrícula del mes (semanas de lunes a domingo, 5 o 6 filas) con los recuerdos de cada día. */
export function monthGrid(year: number, month: number, items: RecuerdoItem[]): CalendarCell[] {
  const first = Date.UTC(year, month, 1) / 86400000;
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (new Date(first * 86400000).getUTCDay() + 6) % 7; // lunes = 0
  const total = Math.ceil((lead + daysIn) / 7) * 7;
  const byDay = groupByDay(items);
  const out: CalendarCell[] = [];
  for (let i = 0; i < total; i++) {
    const day = isoOfDay(first - lead + i);
    out.push({ day, inMonth: i >= lead && i < lead + daysIn, items: byDay.get(day) ?? [] });
  }
  return out;
}

export const WEEKDAYS_ES = ["L", "M", "M", "J", "V", "S", "D"];

export function monthLabel(year: number, month: number): string {
  const m = MONTHS_ES[month];
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${year}`;
}

/** "14 de julio de 2026". */
export function dayLabel(day: string): string {
  const m = ISO.exec(day);
  if (!m) return day;
  return `${Number(m[3])} de ${MONTHS_ES[Number(m[2]) - 1]} de ${m[1]}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const n = year * 12 + month + delta;
  return { year: Math.floor(n / 12), month: ((n % 12) + 12) % 12 };
}

/** Recuerdos por día, en orden (dentro del día: favoritas primero y luego por hora). */
export function groupByDay(items: RecuerdoItem[]): Map<string, RecuerdoItem[]> {
  const out = new Map<string, RecuerdoItem[]>();
  for (const it of sortItems(items)) {
    const list = out.get(it.day);
    if (list) list.push(it); else out.set(it.day, [it]);
  }
  return out;
}

export function sortItems(items: RecuerdoItem[]): RecuerdoItem[] {
  return [...items].sort((a, b) => a.day.localeCompare(b.day) || Number(b.favorite) - Number(a.favorite) || a.sortKey.localeCompare(b.sortKey) || a.key.localeCompare(b.key));
}

/** Mes con el recuerdo más reciente (o el actual si no hay ninguno). */
export function latestMonth(items: RecuerdoItem[], today: string): { year: number; month: number } {
  const last = items.reduce<string | null>((m, it) => (!m || it.day > m ? it.day : m), null) ?? today;
  return { year: Number(last.slice(0, 4)), month: Number(last.slice(5, 7)) - 1 };
}

// ───────────────────────── filtros y álbumes ─────────────────────────
/** "todos", "sin-viaje" o el id de un viaje. */
export type TripFilter = string;

export function filterByTrip(items: RecuerdoItem[], filter: TripFilter): RecuerdoItem[] {
  if (filter === "todos") return items;
  if (filter === "sin-viaje") return items.filter((i) => !i.tripId);
  return items.filter((i) => i.tripId === filter);
}

export type Album = {
  /** id del viaje o "sin-viaje". */
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  count: number;
  photos: number;
  videos: number;
  cover: RecuerdoItem | null;
  /** ¿Compartido con los miembros del viaje? (solo para álbumes de un viaje). */
  shared: boolean;
  /** Hay fotos que compartieron otros miembros. */
  fromOthers: number;
};

/** Álbumes por viaje (del más reciente al más antiguo) y al final "Sin viaje". Solo los que tienen fotos. */
export function buildAlbums(items: RecuerdoItem[], trips: RecuerdoTrip[], sharedTrips: Set<string>): Album[] {
  const byTrip = new Map<string, RecuerdoItem[]>();
  for (const it of sortItems(items)) {
    const k = it.tripId ?? "sin-viaje";
    const list = byTrip.get(k);
    if (list) list.push(it); else byTrip.set(k, [it]);
  }
  const albums: Album[] = [];
  for (const [id, list] of byTrip) {
    const trip = trips.find((t) => t.id === id);
    const cover = list.find((i) => i.favorite && i.mediaType === "foto") ?? list.find((i) => i.mediaType === "foto") ?? list[0] ?? null;
    albums.push({
      id,
      title: id === "sin-viaje" ? "Sin viaje" : (trip?.destino?.trim() || "Viaje"),
      start: id === "sin-viaje" ? list[0]?.day ?? null : trip?.fecha_salida ?? list[0]?.day ?? null,
      end: id === "sin-viaje" ? list[list.length - 1]?.day ?? null : trip?.fecha_regreso ?? trip?.fecha_salida ?? list[list.length - 1]?.day ?? null,
      count: list.length,
      photos: list.filter((i) => i.mediaType === "foto").length,
      videos: list.filter((i) => i.mediaType === "video").length,
      cover,
      shared: id !== "sin-viaje" && sharedTrips.has(id),
      fromOthers: list.filter((i) => !i.mine).length,
    });
  }
  return albums.sort((a, b) => {
    if (a.id === "sin-viaje") return 1;
    if (b.id === "sin-viaje") return -1;
    return String(b.start ?? "").localeCompare(String(a.start ?? ""));
  });
}

/** "10 – 15 de marzo de 2026" o "28 de junio – 3 de julio de 2026". */
export function rangeLabelEs(start: string | null, end: string | null): string {
  if (!start) return "";
  const a = ISO.exec(start.slice(0, 10)), b = ISO.exec((end ?? start).slice(0, 10));
  if (!a || !b) return "";
  const [da, ma, ya] = [Number(a[3]), Number(a[2]) - 1, a[1]];
  const [db, mb, yb] = [Number(b[3]), Number(b[2]) - 1, b[1]];
  if (start.slice(0, 10) === (end ?? start).slice(0, 10)) return `${da} de ${MONTHS_ES[ma]} de ${ya}`;
  if (ya === yb && ma === mb) return `${da} – ${db} de ${MONTHS_ES[ma]} de ${ya}`;
  if (ya === yb) return `${da} de ${MONTHS_ES[ma]} – ${db} de ${MONTHS_ES[mb]} de ${ya}`;
  return `${da} de ${MONTHS_ES[ma]} de ${ya} – ${db} de ${MONTHS_ES[mb]} de ${yb}`;
}

export function countLabel(photos: number, videos: number): string {
  const p = `${photos.toLocaleString("es-MX")} ${photos === 1 ? "foto" : "fotos"}`;
  return videos ? `${p} · ${videos} ${videos === 1 ? "video" : "videos"}` : p;
}

/** De dónde salió la fecha, en palabras (el visor la muestra: nada de fechas sin fuente). */
export function dateSourceLabel(s: DateSource): string {
  switch (s) {
    case "exif": return "Fecha tomada de la foto";
    case "video": return "Fecha tomada del video";
    case "archivo": return "Fecha del archivo (la foto no traía fecha)";
    case "manual": return "Fecha puesta a mano";
    case "subida": return "Fecha en que la subiste";
  }
}

export function sourceLabel(s: RecuerdoSource): string | null {
  if (s === "momento") return "De tus Mejores momentos";
  if (s === "diario") return "Del diario del viaje";
  return null;
}

// ───────────────────────── filas de la base → vista ─────────────────────────
export type RecuerdoRow = {
  id: string; user_id: string; trip_id: string | null; media_type: "foto" | "video"; storage_path: string; thumb_path: string | null;
  taken_on: string; taken_at: string | null; created_at: string; favorite: boolean; date_source: DateSource; trip_source: TripSource;
  duration_s?: number | string | null;
};
export type MomentRow = { id: string; trip_id: string | null; caption: string | null; created_at: string; image_path: string | null; image_url: string | null };
export type JournalRow = { id: string; trip_id: string; text: string | null; created_at: string; photo_path: string | null };

export const MOMENTS_BUCKET_NAME = "travel-moments-private";
export const JOURNAL_BUCKET_NAME = "journal-photos";

export function unifyItems(me: string, rows: { recuerdos: RecuerdoRow[]; moments: MomentRow[]; journal: JournalRow[] }): RecuerdoItem[] {
  const out: RecuerdoItem[] = [];
  for (const r of rows.recuerdos) {
    out.push({
      key: `recuerdo:${r.id}`, id: r.id, source: "recuerdo", mine: r.user_id === me, tripId: r.trip_id, day: r.taken_on.slice(0, 10),
      sortKey: r.taken_at ?? r.created_at, mediaType: r.media_type, bucket: RECUERDOS_BUCKET, path: r.storage_path, thumbPath: r.thumb_path,
      favorite: !!r.favorite, dateSource: r.date_source, tripSource: r.trip_source,
      durationS: r.duration_s == null ? null : Number(r.duration_s),
    });
  }
  for (const m of rows.moments) {
    if (!m.image_path && !m.image_url) continue;
    out.push({
      key: `momento:${m.id}`, id: m.id, source: "momento", mine: true, tripId: m.trip_id, day: localDay(new Date(m.created_at)),
      sortKey: m.created_at, mediaType: "foto", bucket: MOMENTS_BUCKET_NAME, path: m.image_path ?? "", thumbPath: null,
      legacyUrl: m.image_path ? null : m.image_url, favorite: false, dateSource: "subida", tripSource: m.trip_id ? "manual" : "ninguno", caption: m.caption,
    });
  }
  for (const j of rows.journal) {
    if (!j.photo_path) continue;
    out.push({
      key: `diario:${j.id}`, id: j.id, source: "diario", mine: true, tripId: j.trip_id, day: localDay(new Date(j.created_at)),
      sortKey: j.created_at, mediaType: "foto", bucket: JOURNAL_BUCKET_NAME, path: j.photo_path, thumbPath: null,
      favorite: false, dateSource: "subida", tripSource: "manual", caption: j.text,
    });
  }
  return sortItems(out);
}

/** Ruta que se pide para una miniatura (la miniatura si existe; si no, el archivo). */
export const thumbOf = (it: RecuerdoItem) => it.thumbPath ?? (it.mediaType === "foto" ? it.path : null);

/**
 * ¿Se puede armar ya «Hazme mi video»? El video de IATOS Wrapped usa los viajes que ya empezaron; sin
 * ninguno, el botón llevaba a «todavía no empiezan» sin poder hacer nada (R2 viajes, Recuerdos).
 */
export function videoAvailable(trips: Pick<RecuerdoTrip, "fecha_salida">[], today: string): boolean {
  return trips.some((t) => !!t.fecha_salida && t.fecha_salida.slice(0, 10) <= today);
}
