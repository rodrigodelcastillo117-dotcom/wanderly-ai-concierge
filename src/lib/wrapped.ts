// IATOS Wrapped ("Tu año en viajes"): cálculo puro de las métricas y de las tarjetas, para probarlo
// sin red. Reglas:
//   · Solo datos reales del usuario. Una tarjeta sin datos NO se muestra (nunca cifras de relleno).
//   · Un viaje es del año si SALIÓ ese año y ya empezó (los futuros todavía no son "tu año").
//   · Los días se cuentan una vez aunque dos viajes se encimen, hasta hoy y hasta el 31 de diciembre.
//   · Kilómetros: haversine entre coordenadas reales (geocodificadas) de tu ciudad de origen y tus
//     destinos, en orden; la vuelta a casa solo si el viaje tiene fecha de regreso. Sin coordenadas,
//     no hay tarjeta.
//   · Fotos: solo las tuyas (Recuerdos del año, Mejores momentos y tus entradas del diario; las
//     favoritas ⭐ de Recuerdos primero). Al compartir, las fotos y el
//     avatar NO van salvo que la persona active «Incluir mis fotos» (buildCardSpec).
//   · De otras personas solo se muestra el nombre (wrapped_companions en la base).
import { matchCity, matchCountry, norm } from "../../supabase/functions/_shared/souvenirs.ts";
import { haversineKm } from "../../supabase/functions/_shared/geo-distance.ts";
import { computeTravelDna, DNA_ARCHETYPES, type DnaKey } from "@/lib/travelDna";
import { canonicalCategory } from "@/lib/expenseCategories";
import { convert, formatMoney, fxLabel, type FxTable } from "@/lib/fx";
import { dayNumber, yearOf, yearsWithTrips } from "@/lib/wrappedPromo";

export type WrappedTrip = {
  id: string;
  destino: string | null;
  pais_destino?: string | null;
  ciudad_origen?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  itinerario_json?: unknown;
  num_viajeros?: number | null;
  total_estimado?: number | null;
  hospedaje_json?: unknown;
};
export type WrappedMoment = { id: string; trip_id?: string | null; caption?: string | null; destino?: string | null; created_at: string; tags?: string[] | null; photoUrl?: string | null };
export type WrappedJournal = { id: string; trip_id: string; text?: string | null; created_at: string; photoUrl?: string | null };
/** Foto de Recuerdos (tabla recuerdos): fecha de captura y estrella de favorita. */
export type WrappedRecuerdo = { id: string; trip_id?: string | null; taken_on: string; favorite?: boolean | null; photoUrl?: string | null };
export type WrappedExpense = { amount: number; currency?: string | null; category?: string | null; expense_date: string };
export type WrappedVisit = { category?: string | null; visited_at?: string | null };
export type WrappedVisitedPlace = { visited_at?: string | null };
export type WrappedBadge = { nombre: string; icono?: string | null; unlocked_at?: string | null };
export type WrappedCompanion = { name: string; shared_trips: number };
export type Coord = { lat: number; lng: number };

export type WrappedInput = {
  year: number;
  /** Fecha local de hoy (YYYY-MM-DD). */
  today: string;
  firstName?: string | null;
  avatarUrl?: string | null;
  /** Ciudad de origen del perfil: respaldo para viajes sin ciudad_origen. */
  homeCity?: string | null;
  trips: WrappedTrip[];
  moments?: WrappedMoment[];
  journal?: WrappedJournal[];
  /** Fotos de Recuerdos del año (las favoritas ⭐ van primero en la tarjeta y en el video). */
  recuerdos?: WrappedRecuerdo[];
  expenses?: WrappedExpense[];
  visits?: WrappedVisit[];
  visitedPlaces?: WrappedVisitedPlace[];
  badges?: WrappedBadge[];
  companions?: WrappedCompanion[];
  /** Coordenadas por consulta de geocodificación (geoKey). */
  coords?: Record<string, Coord>;
  fx?: FxTable | null;
};

export type Country = { code: string | null; name: string; flag: string };
export type Stop = { label: string; query: string; country: Country | null; isCity: boolean };

export const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_INITIALS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const EARTH_KM = 40075;

// ───────────────────────── fechas (sin new Date("YYYY-MM-DD"), que cae un día antes) ─────────────────────────
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
export { dayNumber, yearsWithTrips };
const monthOfDay = (d: number) => new Date(d * 86400000).getUTCMonth();

/** "10 – 24 de julio", "28 de junio – 3 de julio". */
export function rangeLabel(start: string, end: string): string {
  const a = ISO.exec(start), b = ISO.exec(end);
  if (!a || !b) return "";
  const [da, ma, db, mb] = [Number(a[3]), Number(a[2]) - 1, Number(b[3]), Number(b[2]) - 1];
  if (start.slice(0, 10) === end.slice(0, 10)) return `${da} de ${MONTHS_ES[ma]}`;
  if (ma === mb && a[1] === b[1]) return `${da} – ${db} de ${MONTHS_ES[ma]}`;
  return `${da} de ${MONTHS_ES[ma]} – ${db} de ${MONTHS_ES[mb]}`;
}

// ───────────────────────── viajes del año ─────────────────────────
/** Viajes que salieron en `year` y ya empezaron (hoy incluido), del más antiguo al más reciente. */
export function tripsInYear<T extends WrappedTrip>(trips: T[], year: number, today: string): T[] {
  const t0 = dayNumber(today);
  return trips
    .filter((t) => {
      const s = dayNumber(t.fecha_salida);
      return s != null && t0 != null && yearOf(t.fecha_salida) === year && s <= t0;
    })
    .sort((a, b) => String(a.fecha_salida).localeCompare(String(b.fecha_salida)));
}

// ───────────────────────── lugares ─────────────────────────
function countryFromRow(code: string | null, name: string, flag: string | null): Country {
  return { code, name, flag: flag ?? "🌍" };
}
function countryOf(text: string | null | undefined): Country | null {
  const r = matchCountry(text);
  return r ? countryFromRow(r[0], r[1], r[6]) : null;
}
function countryByCode(code: string): Country | null {
  const r = matchCountry(code);
  return r ? countryFromRow(r[0], r[1], r[6]) : null;
}
/** El texto ES un país (no una ciudad que lo menciona): "Japón", "Italia". */
function isCountryName(text: string): Country | null {
  const r = matchCountry(text);
  if (!r) return null;
  const t = norm(text);
  // Los primeros alias son nombres del país; los últimos suelen ser ciudades ("doha", "petra").
  const exact = t === norm(r[1]) || t === norm(r[2]).replace(/^the /, "") || r[3].slice(0, 2).includes(t) || (t.length <= 4 && r[3].includes(t));
  return exact ? countryFromRow(r[0], r[1], r[6]) : null;
}

const SPLIT = /\s*(?:→|->|;|\||\/|\s-\s|\s–\s)\s*/;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Paradas del viaje en orden: ruta multidestino o el destino (partido por "→", ";"…). */
export function tripStops(t: WrappedTrip): Stop[] {
  const itin = t.itinerario_json && typeof t.itinerario_json === "object" && !Array.isArray(t.itinerario_json)
    ? (t.itinerario_json as { destinations?: unknown }).destinations : null;
  const raw = Array.isArray(itin) && itin.some((x) => typeof x === "string" && x.trim())
    ? (itin as unknown[]).filter((x): x is string => typeof x === "string")
    : String(t.destino ?? "").split(SPLIT);
  const pieces = raw.map(clean).filter(Boolean);
  const tripCountry = countryOf(t.pais_destino);
  const out: Stop[] = [];
  for (const piece of pieces) {
    const parts = piece.split(",").map(clean).filter(Boolean);
    const city = matchCity(piece);
    let stop: Stop;
    if (city) {
      // El catálogo agrupa lugares cercanos en un solo recuerdo (Siena → Florencia, Isla Mujeres →
      // Holbox): de ahí solo se toma el país; el nombre canónico solo si es la misma ciudad.
      const typed = parts[0] ?? piece;
      const t = norm(typed);
      const same = t === norm(city.lugar) || t === city.id.replace(/-/g, " ") || (t.length <= 4 && city.aliases.includes(t));
      const country = countryByCode(city.pais) ?? countryFromRow(city.pais, city.pais, null);
      const label = same ? city.lugar : typed;
      stop = { label, query: `${label}, ${country.name}`, country, isCity: true };
    } else if (isCountryName(piece)) {
      const c = isCountryName(piece)!;
      stop = { label: c.name, query: c.name, country: c, isCity: false };
    } else {
      const label = parts[0] ?? piece;
      const rest = parts.slice(1).join(", ");
      const country = (rest && countryOf(rest)) || (pieces.length === 1 ? tripCountry : null);
      stop = { label, query: country && !rest ? `${label}, ${country.name}` : piece, country, isCity: true };
    }
    if (!out.some((s) => norm(s.label) === norm(stop.label))) out.push(stop);
  }
  return out;
}

/** Clave estable de una consulta de geocodificación. */
export const geoKey = (q: string) => norm(q);

/** Consulta de la ciudad de origen del viaje (o la del perfil). */
export function originQuery(t: WrappedTrip, homeCity?: string | null): string | null {
  const o = clean(String(t.ciudad_origen ?? "")) || clean(String(homeCity ?? ""));
  return o || null;
}

/** Lugares a geocodificar para los kilómetros (sin repetir, a lo más `max`). */
export function geocodeQueries(trips: WrappedTrip[], homeCity?: string | null, max = 24): string[] {
  const seen = new Map<string, string>();
  for (const t of trips) {
    const o = originQuery(t, homeCity);
    for (const q of [o, ...tripStops(t).map((s) => s.query)]) {
      if (q && !seen.has(geoKey(q))) seen.set(geoKey(q), q);
    }
  }
  return [...seen.values()].slice(0, max);
}

// ───────────────────────── resultado ─────────────────────────
export type WrappedTripSummary = { id: string; label: string; start: string; end: string; days: number; month: number };
export type WrappedPhoto = { url: string; caption?: string | null; place?: string | null; favorite?: boolean };
export type WrappedStats = {
  year: number;
  firstName: string | null;
  avatarUrl: string | null;
  trips: WrappedTripSummary[];
  daysAway: number;
  countries: Country[];
  cities: string[];
  visitedPlaces: number;
  km: { total: number; tripsWithRoute: number; tripsTotal: number; points: Array<Coord & { label: string }>; legs: Array<[number, number]> } | null;
  longest: WrappedTripSummary | null;
  months: number[];
  topMonth: { month: number; days: number } | null;
  photos: WrappedPhoto[];
  photoCount: number;
  favorite: { text: string; place: string | null; when: string | null; photoUrl: string | null } | null;
  companions: WrappedCompanion[];
  spend: { total: number; currency: string; count: number; topCategory: string | null; note: string | null } | null;
  badges: Array<{ nombre: string; icono: string | null }>;
  dna: { key: DnaKey; label: string; tag: string } | null;
};

const tripLabel = (stops: Stop[], fallback: string) => {
  const labels = stops.map((s) => s.label);
  if (!labels.length) return fallback;
  return labels.length <= 2 ? labels.join(" · ") : `${labels.slice(0, 2).join(" · ")} +${labels.length - 2}`;
};

export function computeWrapped(input: WrappedInput): WrappedStats {
  const { year, today } = input;
  const t0 = dayNumber(today) ?? 0;
  const y1 = dayNumber(`${year}-12-31`) ?? t0;
  const trips = tripsInYear(input.trips, year, today);
  const tripIds = new Set(trips.map((t) => t.id));
  const coords = input.coords ?? {};

  // Días (unión, sin contar dos veces) y meses.
  const days = new Set<number>();
  const summaries: WrappedTripSummary[] = [];
  const stopsByTrip = new Map<string, Stop[]>();
  for (const t of trips) {
    const s = dayNumber(t.fecha_salida)!;
    let e = dayNumber(t.fecha_regreso) ?? s;
    if (e < s) e = s;
    const endReal = Math.min(e, t0);
    for (let d = s; d <= Math.min(endReal, y1); d++) days.add(d);
    const stops = tripStops(t);
    stopsByTrip.set(t.id, stops);
    const endIso = new Date(endReal * 86400000).toISOString().slice(0, 10);
    summaries.push({ id: t.id, label: tripLabel(stops, clean(String(t.destino ?? "")) || "Viaje"), start: String(t.fecha_salida).slice(0, 10), end: endIso, days: endReal - s + 1, month: monthOfDay(s) });
  }
  const months = Array.from({ length: 12 }, () => 0);
  for (const d of days) months[monthOfDay(d)]++;
  const activeMonths = months.filter((n) => n > 0).length;
  const topIdx = months.reduce((best, n, i) => (n > months[best] ? i : best), 0);
  const topMonth = trips.length >= 2 && activeMonths >= 2 ? { month: topIdx, days: months[topIdx] } : null;
  const longest = trips.length >= 2
    ? [...summaries].sort((a, b) => b.days - a.days || a.start.localeCompare(b.start))[0]
    : null;

  // Países y ciudades (sin la ciudad de origen).
  const countries = new Map<string, Country>();
  const cities = new Map<string, string>();
  for (const t of trips) {
    const origin = norm(originQuery(t, input.homeCity)?.split(",")[0] ?? "");
    const originCity = matchCity(originQuery(t, input.homeCity))?.lugar;
    for (const s of stopsByTrip.get(t.id) ?? []) {
      if (s.country) countries.set(s.country.code ?? norm(s.country.name), s.country);
      const k = norm(s.label);
      if (s.isCity && k && k !== origin && s.label !== originCity && !cities.has(k)) cities.set(k, s.label);
    }
  }

  // Kilómetros con coordenadas reales.
  let km: WrappedStats["km"] = null;
  {
    let total = 0, withRoute = 0;
    const points: Array<Coord & { label: string }> = [];
    const legs: Array<[number, number]> = [];
    const idx = (c: Coord & { label: string }) => {
      let i = points.findIndex((p) => Math.abs(p.lat - c.lat) < 1e-4 && Math.abs(p.lng - c.lng) < 1e-4);
      if (i < 0) { points.push({ lat: c.lat, lng: c.lng, label: c.label }); i = points.length - 1; }
      return i;
    };
    for (const t of trips) {
      const o = originQuery(t, input.homeCity);
      const oc = o && coords[geoKey(o)] ? { ...coords[geoKey(o)], label: clean(o.split(",")[0]) } : undefined;
      const seq: Array<Coord & { label: string }> = [];
      if (oc) seq.push(oc);
      for (const s of stopsByTrip.get(t.id) ?? []) { const c = coords[geoKey(s.query)]; if (c) seq.push({ ...c, label: s.label }); }
      if (oc && t.fecha_regreso && seq.length > 1) seq.push(oc);
      let tripKm = 0;
      for (let i = 1; i < seq.length; i++) {
        const d = haversineKm(seq[i - 1], seq[i]);
        if (d >= 1) { tripKm += d; legs.push([idx(seq[i - 1]), idx(seq[i])]); }
      }
      if (tripKm > 0) { total += tripKm; withRoute++; }
    }
    if (total >= 1) km = { total: Math.round(total), tripsWithRoute: withRoute, tripsTotal: trips.length, points, legs };
  }

  // Fotos y momento favorito: solo los tuyos.
  const inYear = (m: { trip_id?: string | null; created_at: string }) =>
    m.trip_id && tripIds.has(m.trip_id) ? true : !m.trip_id || !input.trips.some((t) => t.id === m.trip_id) ? yearOf(m.created_at) === year : false;
  const moments = (input.moments ?? []).filter(inYear).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const journal = (input.journal ?? []).filter((j) => tripIds.has(j.trip_id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const placeOf = (tripId?: string | null, destino?: string | null) =>
    clean(String(destino ?? "")) || summaries.find((s) => s.id === tripId)?.label || null;
  // Recuerdos: los de la fecha del año (la foto se tomó ese año), ya sin repetir.
  const recuerdos = (input.recuerdos ?? []).filter((r) => r.photoUrl && yearOf(r.taken_on) === year)
    .sort((a, b) => a.taken_on.localeCompare(b.taken_on) || a.id.localeCompare(b.id));
  const recPhoto = (r: WrappedRecuerdo): WrappedPhoto => ({ url: r.photoUrl!, caption: null, place: placeOf(r.trip_id), favorite: !!r.favorite });
  const photos: WrappedPhoto[] = [
    ...recuerdos.filter((r) => r.favorite).map(recPhoto),
    ...moments.filter((m) => m.photoUrl).map((m) => ({ url: m.photoUrl!, caption: m.caption ?? null, place: placeOf(m.trip_id, m.destino) })),
    ...journal.filter((j) => j.photoUrl).map((j) => ({ url: j.photoUrl!, caption: null, place: placeOf(j.trip_id) })),
    ...recuerdos.filter((r) => !r.favorite).map(recPhoto),
  ];
  const whenOf = (tripId: string | null | undefined, created: string) => {
    const s = summaries.find((x) => x.id === tripId);
    const m = s ? s.month : (ISO.exec(created) ? Number(ISO.exec(created)![2]) - 1 : null);
    return m == null ? null : `${MONTHS_ES[m]} ${year}`;
  };
  let favorite: WrappedStats["favorite"] = null;
  const captioned = moments.filter((m) => clean(String(m.caption ?? "")).length > 0)
    .sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0) || Number(!!b.photoUrl) - Number(!!a.photoUrl) || b.created_at.localeCompare(a.created_at));
  if (captioned[0]) {
    const m = captioned[0];
    favorite = { text: truncate(clean(m.caption!), 180), place: placeOf(m.trip_id, m.destino), when: whenOf(m.trip_id, m.created_at), photoUrl: m.photoUrl ?? null };
  } else {
    const j = journal.filter((x) => clean(String(x.text ?? "")).length >= 12)
      .sort((a, b) => Number(!!b.photoUrl) - Number(!!a.photoUrl) || String(b.text).length - String(a.text).length)[0];
    if (j) favorite = { text: truncate(clean(j.text!), 180), place: placeOf(j.trip_id), when: whenOf(j.trip_id, j.created_at), photoUrl: j.photoUrl ?? null };
  }

  // Gastos registrados en el año.
  let spend: WrappedStats["spend"] = null;
  const exps = (input.expenses ?? []).filter((e) => yearOf(e.expense_date) === year && Number(e.amount) > 0);
  if (exps.length) {
    const curs = new Set(exps.map((e) => String(e.currency || "MXN").toUpperCase()));
    const single = curs.size === 1 ? [...curs][0] : null;
    const target = single ?? "MXN";
    const byCat: Record<string, number> = {};
    const missing = new Set<string>();
    let total = 0;
    for (const e of exps) {
      const c = String(e.currency || "MXN").toUpperCase();
      const v = c === target ? Number(e.amount) : input.fx ? convert(Number(e.amount), c, target, input.fx) : null;
      if (v == null) { missing.add(c); continue; }
      total += v;
      const k = canonicalCategory(String(e.category ?? ""));
      byCat[k] = (byCat[k] ?? 0) + v;
    }
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const notes: string[] = [];
    if (!single && input.fx) notes.push(`Convertido a MXN · ${fxLabel(input.fx)}.`);
    if (missing.size) notes.push(`Sin convertir: ${[...missing].join(", ")}.`);
    if (total > 0) spend = { total: Math.round(total), currency: target, count: exps.length, topCategory: top, note: notes.join(" ") || null };
  }

  // Tipo de viajero con lo que hiciste ese año (sin lo declarado en el onboarding).
  let dna: WrappedStats["dna"] = null;
  const visits = (input.visits ?? []).filter((v) => yearOf(v.visited_at) === year);
  const core = computeTravelDna({ today, trips, visits });
  if (core.dominant && core.fuente === "real") dna = { key: core.dominant, ...DNA_ARCHETYPES[core.dominant] };

  const badges = (input.badges ?? []).filter((b) => yearOf(b.unlocked_at) === year && clean(b.nombre))
    .map((b) => ({ nombre: clean(b.nombre), icono: b.icono ?? null }));

  return {
    year,
    firstName: clean(String(input.firstName ?? "")).split(" ")[0] || null,
    avatarUrl: input.avatarUrl ?? null,
    trips: summaries,
    daysAway: days.size,
    countries: [...countries.values()],
    cities: [...cities.values()],
    visitedPlaces: (input.visitedPlaces ?? []).filter((p) => yearOf(p.visited_at) === year).length,
    km,
    longest,
    months,
    topMonth,
    photos,
    photoCount: photos.length,
    favorite,
    companions: (input.companions ?? []).filter((c) => clean(c.name) && c.shared_trips > 0),
    spend,
    badges,
    dna,
  };
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
}

// ───────────────────────── tarjetas ─────────────────────────
export type WrappedCardKind = "cover" | "trips" | "places" | "km" | "longest" | "month" | "photos" | "moment" | "companions" | "spend" | "badges" | "dna" | "outro";

/** Tarjetas en orden, omitiendo las que no tienen datos. Sin viajes en el año: ninguna. */
export function buildWrappedCards(s: WrappedStats): WrappedCardKind[] {
  if (!s.trips.length) return [];
  const out: WrappedCardKind[] = ["cover", "trips"];
  if (s.countries.length || s.cities.length) out.push("places");
  if (s.km) out.push("km");
  if (s.longest) out.push("longest");
  if (s.topMonth) out.push("month");
  if (s.photos.length) out.push("photos");
  if (s.favorite) out.push("moment");
  if (s.companions.length) out.push("companions");
  if (s.spend) out.push("spend");
  if (s.badges.length) out.push("badges");
  if (s.dna) out.push("dna");
  out.push("outro");
  return out;
}

// Contenido de una tarjeta: lo usan la pantalla (DOM) y la imagen para compartir (canvas).
export type CardSpec = {
  kind: WrappedCardKind;
  kicker: string;
  title?: string;
  big?: string;
  bigUnit?: string;
  body?: string;
  stats?: Array<{ value: string; label: string }>;
  list?: Array<{ lead?: string; text: string; meta?: string }>;
  bars?: Array<{ label: string; value: number; highlight: boolean }>;
  photos?: WrappedPhoto[];
  /** Fotos retenidas al compartir (se dibujan marcos con candado). */
  privatePhotos?: number;
  photo?: string | null;
  avatar?: string | null;
  quote?: string;
  route?: RouteLayout;
  footnote?: string;
  cta?: { label: string; href: string };
};

const n = (v: number) => v.toLocaleString("es-MX");
const plural = (v: number, one: string, many: string) => (v === 1 ? one : many);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type RouteLayout = {
  /** Ancho / alto del recuadro (el mapa conserva la geografía dentro de él). */
  aspect: number;
  /** Puntos en [0..1] × [0..1] del recuadro. */
  points: Array<[number, number]>;
  labels: string[];
  legs: Array<[number, number]>;
  /** Meridianos (x) y paralelos (y) de la retícula, en [0..1]. */
  grid: { xs: number[]; ys: number[] };
};

/** Mapa de la ruta: proyección equirectangular del área recorrida, con margen y retícula. */
export function routeLayout(points: Array<Coord & { label?: string }>, legs: Array<[number, number]> = [], aspect = 1.6): RouteLayout {
  if (!points.length) return { aspect, points: [], labels: [], legs: [], grid: { xs: [], ys: [] } };
  const lngs = points.map((p) => p.lng), lats = points.map((p) => p.lat);
  let x0 = Math.min(...lngs) - 10, x1 = Math.max(...lngs) + 10, y0 = Math.min(...lats) - 8, y1 = Math.max(...lats) + 8;
  let sx = Math.max(x1 - x0, 24), sy = Math.max(y1 - y0, 15);
  if (sx / sy > aspect) sy = sx / aspect; else sx = sy * aspect;
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2;
  x0 = cx - sx / 2; x1 = cx + sx / 2; y0 = cy - sy / 2; y1 = cy + sy / 2;
  const step = sx > 150 ? 30 : sx > 60 ? 15 : 5;
  const xs: number[] = [], ys: number[] = [];
  for (let g = Math.ceil(x0 / step) * step; g <= x1; g += step) xs.push((g - x0) / sx);
  for (let g = Math.ceil(y0 / step) * step; g <= y1; g += step) ys.push((y1 - g) / sy);
  return {
    aspect,
    points: points.map((p) => [(p.lng - x0) / sx, (y1 - p.lat) / sy]),
    labels: points.map((p) => p.label ?? ""),
    legs,
    grid: { xs, ys },
  };
}

/**
 * Lado de cada etiqueta ("left" / "right") o null si no cabe sin taparse con otra etiqueta u otro punto.
 * Unidades del recuadro: ancho = aspect, alto = 1. Se prueba primero el lado con más espacio.
 */
export function visibleRouteLabels(r: RouteLayout, charW = 0.026, labelH = 0.075): Array<"left" | "right" | null> {
  const boxes: Array<[number, number, number, number]> = [];
  const P = r.points.map(([x, y]) => [x * r.aspect, y] as const);
  const hits = (b: [number, number, number, number], self: number) =>
    boxes.some(([x0, y0, x1, y1]) => b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0)
    || P.some(([px, py], j) => j !== self && px > b[0] - 0.02 && px < b[2] + 0.02 && py > b[1] - 0.02 && py < b[3] + 0.02)
    || b[0] < 0 || b[2] > r.aspect;
  return P.map(([X, y], i) => {
    const label = r.labels[i];
    if (!label) return null;
    const w = label.length * charW;
    const y0 = y < 0.12 ? y + 0.02 : y - labelH, y1 = y0 + labelH;
    const sides: Array<"left" | "right"> = X > r.aspect * 0.7 ? ["left", "right"] : ["right", "left"];
    for (const side of sides) {
      const b: [number, number, number, number] = side === "right" ? [X + 0.02, y0, X + 0.02 + w, y1] : [X - 0.02 - w, y0, X - 0.02, y1];
      if (!hits(b, i)) { boxes.push(b); return side; }
    }
    return null;
  });
}

/**
 * Tarjeta → contenido. `includePhotos` = false (por defecto al compartir) quita TODAS las fotos y el
 * avatar; en pantalla la persona ve las suyas (includePhotos = true).
 */
export function buildCardSpec(kind: WrappedCardKind, s: WrappedStats, opts: { includePhotos: boolean }): CardSpec {
  const Y = s.year;
  const withPhotos = opts.includePhotos;
  switch (kind) {
    case "cover":
      return {
        kind, kicker: "Tu resumen del año", title: `Tu ${Y} en viajes`,
        body: s.firstName ? `${s.firstName}, esto fue lo que viviste.` : "Esto fue lo que viviste.",
        avatar: withPhotos ? s.avatarUrl : null,
      };
    case "trips": {
      const count = s.trips.length;
      return {
        kind, kicker: "Tus viajes", big: n(count), bigUnit: plural(count, "viaje", "viajes"),
        body: `${n(s.daysAway)} ${plural(s.daysAway, "día", "días")} de viaje en ${Y}.`,
        list: s.trips.slice(0, 5).map((t) => ({ text: t.label, meta: cap(MONTHS_ES[t.month]).slice(0, 3) })),
        footnote: count > 5 ? `y ${count - 5} ${plural(count - 5, "viaje", "viajes")} más` : undefined,
      };
    }
    case "places": {
      const c = s.countries.length, ci = s.cities.length;
      const stats = [
        ...(c && ci ? [{ value: n(ci), label: plural(ci, "ciudad", "ciudades") }] : []),
        ...(s.visitedPlaces ? [{ value: n(s.visitedPlaces), label: plural(s.visitedPlaces, "lugar visitado", "lugares visitados") }] : []),
      ];
      return {
        kind, kicker: "Tu mapa del año",
        title: c ? `${n(c)} ${plural(c, "país", "países")}` : `${n(ci)} ${plural(ci, "ciudad", "ciudades")}`,
        list: s.countries.slice(0, 6).map((x) => ({ lead: x.flag, text: x.name })),
        body: ci ? s.cities.slice(0, 8).join(" · ") + (ci > 8 ? ` y ${ci - 8} más` : "") : undefined,
        stats,
      };
    }
    case "km": {
      const k = s.km!;
      const laps = k.total / EARTH_KM;
      const body = laps >= 1
        ? `Como dar ${laps.toLocaleString("es-MX", { maximumFractionDigits: 1 })} ${laps < 1.05 ? "vuelta" : "vueltas"} al mundo.`
        : `El ${Math.max(1, Math.round(laps * 100))} % de una vuelta al mundo.`;
      const partial = k.tripsWithRoute < k.tripsTotal ? ` Incluye ${k.tripsWithRoute} de ${k.tripsTotal} viajes (los demás no tienen ubicación).` : "";
      return {
        kind, kicker: "Kilómetros", big: n(k.total), bigUnit: "km", body,
        route: routeLayout(k.points, k.legs),
        footnote: `En línea recta entre tu ciudad de origen y tus destinos.${partial}`,
      };
    }
    case "longest": {
      const l = s.longest!;
      return { kind, kicker: "Tu viaje más largo", title: l.label, big: n(l.days), bigUnit: plural(l.days, "día", "días"), body: rangeLabel(l.start, l.end) };
    }
    case "month": {
      const m = s.topMonth!;
      return {
        kind, kicker: "Tu mes más viajero", title: cap(MONTHS_ES[m.month]),
        body: `${n(m.days)} ${plural(m.days, "día", "días")} de viaje en ${MONTHS_ES[m.month]}.`,
        bars: s.months.map((v, i) => ({ label: MONTH_INITIALS[i], value: v, highlight: i === m.month })),
      };
    }
    case "photos": {
      const shown = s.photos.slice(0, 6);
      return {
        kind, kicker: "Tus mejores momentos",
        title: `${n(s.photoCount)} ${plural(s.photoCount, "foto guardada", "fotos guardadas")}`,
        ...(withPhotos ? { photos: shown } : { privatePhotos: shown.length, footnote: "Tus fotos son privadas." }),
      };
    }
    case "moment": {
      const f = s.favorite!;
      return {
        kind, kicker: "Un momento para recordar", quote: f.text,
        body: [f.place, f.when].filter(Boolean).join(" · ") || undefined,
        photo: withPhotos ? f.photoUrl : null,
      };
    }
    case "companions": {
      const [top, ...rest] = s.companions;
      return {
        kind, kicker: "Con quién viajaste más", title: top.name,
        big: n(top.shared_trips), bigUnit: plural(top.shared_trips, "viaje juntos", "viajes juntos"),
        list: rest.slice(0, 3).map((c) => ({ text: c.name, meta: `${n(c.shared_trips)} ${plural(c.shared_trips, "viaje", "viajes")}` })),
      };
    }
    case "spend": {
      const sp = s.spend!;
      return {
        kind, kicker: "Tus gastos del año", big: formatMoney(sp.total, sp.currency, 0),
        body: `${n(sp.count)} ${plural(sp.count, "gasto registrado", "gastos registrados")}${sp.topCategory ? `. Lo que más: ${sp.topCategory.toLowerCase()}` : ""}.`,
        footnote: sp.note ?? undefined,
      };
    }
    case "badges":
      return {
        kind, kicker: "Logros", big: n(s.badges.length), bigUnit: plural(s.badges.length, "logro desbloqueado", "logros desbloqueados"),
        list: s.badges.slice(0, 4).map((b) => ({ lead: b.icono ?? "🏅", text: b.nombre })),
      };
    case "dna":
      return { kind, kicker: "Tu tipo de viajero", title: s.dna!.label, body: s.dna!.tag, footnote: `Según tus viajes y lugares de ${Y}.` };
    case "outro":
      return {
        kind, kicker: `Gracias, ${Y}`, title: `Planea tu ${Y + 1}`, body: "¿A dónde vamos ahora?",
        cta: { label: "Crear viaje", href: "/dashboard/planear" },
      };
  }
}

/** Nombre del archivo PNG: "iatos-wrapped-2026-03-kilometros.png". */
export function cardFilename(kind: WrappedCardKind, index: number, year: number): string {
  const names: Record<WrappedCardKind, string> = {
    cover: "portada", trips: "viajes", places: "lugares", km: "kilometros", longest: "viaje-mas-largo", month: "mes",
    photos: "fotos", moment: "momento", companions: "companeros", spend: "gastos", badges: "logros", dna: "tipo-de-viajero", outro: "cierre",
  };
  return `iatos-wrapped-${year}-${String(index + 1).padStart(2, "0")}-${names[kind]}.png`;
}

/** Siguiente/anterior sin salirse de las tarjetas. */
export function stepIndex(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + dir));
}

/** La tarjeta muestra fotos o avatar de la persona (solo entonces tiene sentido «Incluir mis fotos»). */
export function cardHasPhotos(kind: WrappedCardKind, s: WrappedStats): boolean {
  const spec = buildCardSpec(kind, s, { includePhotos: true });
  return !!(spec.photos?.length || spec.photo || spec.avatar);
}
