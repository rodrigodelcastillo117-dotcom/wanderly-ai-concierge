// Planificador de experiencias de IATOS Privé (Experience Planner). Lógica pura y determinista: sin
// Deno, sin red y sin IA. La usan Iato (concierge-chat/prive.ts, herramienta search_prive con `plan`),
// la app (src/lib/privePlanner.ts) y las pruebas (src/test/privePlanner.test.ts).
//
// Qué hace: con experiencias candidatas (del catálogo verificado), fechas, hotel y preferencias arma una
// PROPUESTA por días y la valida:
//  * horario: solo se usa si el horario tiene fuente; si no, "horario por confirmar";
//  * temporada: un lugar cerrado por temporada en esas fechas no entra (y se dice);
//  * traslados: distancia en línea recta × 1.4 a 20 km/h + 10 min, siempre etiquetado ESTIMADO; sin
//    coordenadas, "traslado no calculado";
//  * presupuesto: solo suma precios con fuente; el resto es "precio por confirmar";
//  * edad, dress code, reserva y restricciones de cada lugar;
//  * choques de horario y alternativas.
// Nunca confirma ni reserva: el resultado es status "propuesta" y lo dice.
import { haversineKm } from "../analizar-viaje/groundTransport.ts";

export type Universe =
  | "the_table" | "after_dark" | "casino_grand_nights" | "yacht_sea" | "private_stays" | "iconic_events"
  | "culture_access" | "wellness_escape" | "adventure_elite" | "sport_leisure" | "celebrations" | "signature_mexico";
export type DataState = "VERIFICADO" | "CURADO" | "ESTIMADO" | "PENDIENTE" | "DESACTUALIZADO" | "NO_DISPONIBLE";
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Candidate {
  id: string;
  slug?: string;
  name: string;
  universe: Universe | string;
  subcategory: string;
  state: DataState | string;
  label?: string | null;
  age_policy?: "todas" | "18+" | "21+" | string;
  dress_code?: string | null;
  booking_method?: string | null;
  reservation_required?: boolean | null;
  restrictions?: string | null;
  safety?: string | null;
  price_level?: number | null;
  price?: { min?: number | null; max?: number | null; currency?: string | null; basis?: string | null; source?: string | null } | null;
  opening_hours?: { hours: Partial<Record<Day, [string, string][]>>; source: string } | null;
  duration_min?: number | null;
  lat?: number | null;
  lng?: number | null;
  season?: { state?: string | null; months?: number[] | null; reopens_on?: string | null; closes_on?: string | null; note?: string | null } | null;
  website?: string | null;
  booking_url?: string | null;
  tags?: string[] | null;
  destination?: { slug: string; name: string; timezone?: string | null; currency?: string | null } | null;
}

export type IntentKey =
  | "cena" | "restaurante" | "espectaculo" | "lounge" | "concierto" | "beach_club" | "navegacion" | "golf" | "spa"
  | "arte" | "gastronomia" | "evento" | "casino" | "propuesta" | "fotografia" | "cultural" | "hotel" | "traslado" | "regreso";

type Slot = "manana" | "comida" | "tarde" | "noche" | "tarde_noche";

interface IntentDef {
  label: string;
  universes: string[];
  /** Subcategoría, nombre o etiquetas que deben coincidir (texto normalizado). */
  match?: RegExp;
  /** Lo que NO cuenta aunque coincida (un salón náutico no es un paseo en barco). */
  exclude?: RegExp;
  slot: Slot;
  /** Hora preferida de inicio y última hora razonable de inicio (local, HH:MM). */
  start: string;
  latest: string;
  /** Duración por omisión (ESTIMADO) si el lugar no publica una. */
  duration: number;
  /** Paso derivado (traslado/regreso): no busca una experiencia. */
  derived?: boolean;
}

// Tabla fija de intenciones (nada de IA). Las duraciones son ESTIMADAS y se dicen como tales.
export const INTENTS: Record<IntentKey, IntentDef> = {
  cena: { label: "Cena", universes: ["the_table"], slot: "noche", start: "20:00", latest: "21:45", duration: 150 },
  restaurante: { label: "Restaurante", universes: ["the_table"], slot: "comida", start: "13:30", latest: "21:30", duration: 120 },
  gastronomia: { label: "Gastronomía", universes: ["the_table", "signature_mexico"], slot: "comida", start: "13:30", latest: "21:30", duration: 120 },
  espectaculo: { label: "Espectáculo", universes: ["iconic_events", "after_dark", "culture_access"], match: /(show|espectacul|cabaret|opera|teatro|ballet|burlesque|musical|concert)/, slot: "noche", start: "21:00", latest: "23:30", duration: 120 },
  lounge: { label: "Lounge / coctelería", universes: ["after_dark"], match: /(lounge|cocteler|cocktail|bar|speakeasy|rooftop|jazz)/, slot: "noche", start: "22:30", latest: "01:00", duration: 90 },
  concierto: { label: "Concierto", universes: ["iconic_events", "culture_access", "after_dark"], match: /(concert|concierto|jazz|opera|orquesta|sinfon|recital|musica en vivo|live music)/, slot: "noche", start: "20:30", latest: "22:30", duration: 120 },
  beach_club: { label: "Tarde en un beach club", universes: ["wellness_escape", "yacht_sea", "after_dark", "the_table", "celebrations"], match: /(beach|playa|plage|club de playa|lido)/, slot: "tarde", start: "13:00", latest: "16:00", duration: 240 },
  navegacion: { label: "Paseo en barco", universes: ["yacht_sea"], match: /(barco|yate|yacht|velero|sail|catamaran|boat|charter|navega|lancha|paseo|crucero|cruise|riva)/,
    exclude: /(salon|show|feria|expo|regata|festival|boat show|yacht show|club nautico)/, slot: "tarde", start: "17:00", latest: "19:00", duration: 150 },
  golf: { label: "Golf", universes: ["sport_leisure"], match: /golf/, slot: "manana", start: "08:30", latest: "11:00", duration: 270 },
  spa: { label: "Spa", universes: ["wellness_escape"], match: /(spa|hammam|termas|wellness|bienestar|onsen|temazcal)/, slot: "tarde", start: "15:30", latest: "18:00", duration: 150 },
  arte: { label: "Arte", universes: ["culture_access"], match: /(arte|art|museo|museum|galer|fundacion|foundation|exposic)/, slot: "manana", start: "10:30", latest: "16:00", duration: 120 },
  evento: { label: "Evento", universes: ["iconic_events"], slot: "noche", start: "19:30", latest: "22:00", duration: 180 },
  casino: { label: "Casino (información práctica)", universes: ["casino_grand_nights"], slot: "noche", start: "22:45", latest: "01:00", duration: 120 },
  propuesta: { label: "Propuesta / celebración", universes: ["celebrations"], slot: "tarde_noche", start: "18:30", latest: "20:30", duration: 90 },
  fotografia: { label: "Fotografía", universes: ["celebrations", "culture_access"], match: /(foto|photo)/, slot: "tarde_noche", start: "17:30", latest: "19:30", duration: 90 },
  cultural: { label: "Experiencia cultural", universes: ["culture_access", "signature_mexico"], slot: "manana", start: "10:00", latest: "16:00", duration: 150 },
  hotel: { label: "Hotel", universes: ["private_stays"], slot: "noche", start: "18:00", latest: "23:00", duration: 0 },
  traslado: { label: "Traslado", universes: [], slot: "tarde_noche", start: "00:00", latest: "23:59", duration: 0, derived: true },
  regreso: { label: "Regreso al hotel", universes: [], slot: "noche", start: "00:00", latest: "23:59", duration: 0, derived: true },
};

/** Plantillas compuestas (orden del dueño). Cada una es una secuencia en un mismo día. */
export const TEMPLATES: Record<string, { label: string; steps: IntentKey[] }> = {
  cena_espectaculo_lounge: { label: "Cena + espectáculo + lounge", steps: ["cena", "espectaculo", "lounge"] },
  restaurante_traslado_concierto: { label: "Restaurante + traslado + concierto", steps: ["restaurante", "traslado", "concierto"] },
  beach_navegacion_cena: { label: "Beach club + navegación + cena", steps: ["beach_club", "navegacion", "cena"] },
  golf_spa_restaurante: { label: "Golf + spa + restaurante", steps: ["golf", "spa", "restaurante"] },
  arte_gastronomia_evento: { label: "Arte + gastronomía + evento", steps: ["arte", "gastronomia", "evento"] },
  casino_espectaculo_regreso: { label: "Casino legal + espectáculo + regreso", steps: ["espectaculo", "casino", "regreso"] },
  propuesta_fotografia_cena: { label: "Propuesta romántica + fotografía + cena", steps: ["propuesta", "fotografia", "cena"] },
  cultural_traslado_hotel: { label: "Experiencia cultural + traslado + hotel", steps: ["cultural", "traslado", "hotel"] },
};

const norm = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Frases del usuario → intención (español e inglés). Determinista.
const PHRASES: [RegExp, IntentKey][] = [
  [/\b(beach ?club|club de playa|playa|plage|lido)\b/, "beach_club"],
  [/\b(barco|yate|velero|catamaran|navegacion|navegar|boat|yacht|sailing|lancha|paseo en mar)\b/, "navegacion"],
  [/\b(casino|ruleta|blackjack)\b/, "casino"],
  [/\b(espectaculo|show|cabaret|opera|ballet|teatro)\b/, "espectaculo"],
  [/\b(concierto|concert|jazz en vivo|orquesta)\b/, "concierto"],
  [/\b(lounge|coctel|cocteleria|cocktail|speakeasy|rooftop|copa)\b/, "lounge"],
  [/\b(golf)\b/, "golf"],
  [/\b(spa|masaje|hammam|onsen|temazcal|wellness)\b/, "spa"],
  [/\b(arte|museo|galeria|museum|gallery)\b/, "arte"],
  [/\b(propuesta|pedida|aniversario|proposal|celebracion)\b/, "propuesta"],
  [/\b(fotografia|fotografo|sesion de fotos|photo|photographer)\b/, "fotografia"],
  [/\b(evento|gala|festival|gran premio|grand prix)\b/, "evento"],
  [/\b(cultural|cultura|tradicion|artesan|taller)\b/, "cultural"],
  [/\b(cena|cenar|dinner)\b/, "cena"],
  [/\b(comida|almuerzo|lunch|restaurante|gastronom)\b/, "restaurante"],
];

/** "Quiero una cena espectacular, conocer un casino elegante…" → ["cena","casino",…] (en orden de aparición). */
export function parseIntents(text: string): IntentKey[] {
  const t = ` ${norm(text)} `;
  const found: { key: IntentKey; at: number }[] = [];
  for (const [re, key] of PHRASES) {
    const m = new RegExp(re.source, "g").exec(t);
    if (m && !found.some((f) => f.key === key)) found.push({ key, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.key);
}

/** Plantilla que mejor cubre las intenciones pedidas (o null). */
export function matchTemplate(intents: IntentKey[]): string | null {
  let best: string | null = null;
  let bestHits = 1;
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const hits = t.steps.filter((s) => !INTENTS[s].derived && intents.includes(s)).length;
    if (hits > bestHits) { best = key; bestHits = hits; }
  }
  return best;
}

// ─────────────────────────────── Tiempo ───────────────────────────────
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
/** Horas de madrugada (00:00–05:59) cuentan como la noche anterior: 01:00 = 25:00. */
const nightMin = (hhmm: string) => { const v = toMin(hhmm); return v < 6 * 60 ? v + 24 * 60 : v; };
/** HH:MM sin dar la vuelta (25:30 = 1:30 de la madrugada siguiente), para zonedIso. */
const fmtRaw = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fmt = (min: number) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const DAYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (iso: string): Day => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/** ISO con el desfase real de la zona del destino para esa fecha y hora (para guardar en el viaje). */
export function zonedIso(dateIso: string, hhmm: string, timeZone?: string | null): string {
  const extra = toMin(hhmm) >= 1440 ? 1 : 0;
  const date = extra ? addDays(dateIso, 1) : dateIso;
  const [h, m] = fmt(toMin(hhmm)).split(":").map(Number);
  if (!timeZone) return `${date}T${fmt(toMin(hhmm))}:00`;
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  const offsetMin = Math.round((asLocal - guess) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// ─────────────────────────────── Traslados (ESTIMADO) ───────────────────────────────
export const URBAN_ROAD_FACTOR = 1.4;
export const URBAN_KMH = 20;
export const TRANSFER_BUFFER_MIN = 10;
/** Sin coordenadas se reserva este colchón para no encimar, pero se dice que no se calculó. */
export const UNKNOWN_TRANSFER_MIN = 30;

export interface Transfer { minutes: number | null; km: number | null; label: "ESTIMADO"; text: string; assumed_min: number }

type Point = { lat?: number | null; lng?: number | null; name?: string | null };
const hasPoint = (p?: Point | null): p is { lat: number; lng: number; name?: string | null } =>
  !!p && Number.isFinite(p.lat as number) && Number.isFinite(p.lng as number);

export function estimateTransfer(a?: Point | null, b?: Point | null): Transfer {
  if (!hasPoint(a) || !hasPoint(b)) {
    return { minutes: null, km: null, label: "ESTIMADO", assumed_min: UNKNOWN_TRANSFER_MIN,
      text: "Traslado no calculado: falta la ubicación exacta" };
  }
  const km = haversineKm(a, b) * URBAN_ROAD_FACTOR;
  const minutes = Math.max(5, Math.round(((km / URBAN_KMH) * 60 + TRANSFER_BUFFER_MIN) / 5) * 5);
  return { minutes, km: Math.round(km * 10) / 10, label: "ESTIMADO", assumed_min: minutes,
    text: km < 0.8 ? `≈ ${minutes} min a pie o en auto (aprox.)` : `≈ ${minutes} min en auto (aprox.)` };
}

// ─────────────────────────────── Selección de candidatos ───────────────────────────────
const STATE_RANK: Record<string, number> = { VERIFICADO: 3, CURADO: 2, ESTIMADO: 1 };
export const usableState = (s: string) => s in STATE_RANK;

export function matchesIntent(c: Candidate, intent: IntentKey): boolean {
  const def = INTENTS[intent];
  if (def.derived) return false;
  const text = norm(`${c.subcategory} ${c.name} ${(c.tags ?? []).join(" ")}`);
  if (def.exclude?.test(text)) return false;
  if (intent === "beach_club") return !!def.match?.test(text);
  if (!def.universes.includes(String(c.universe))) return false;
  return def.match ? def.match.test(text) || (intent === "lounge" && c.universe === "after_dark") : true;
}

/** ¿Abre por temporada en esa fecha? null = la fuente no dice nada. */
export function seasonOpenOn(c: Candidate, dateIso: string): boolean | null {
  const s = c.season;
  if (!s) return null;
  if (s.reopens_on && dateIso < s.reopens_on) return false;
  if (s.closes_on && dateIso > s.closes_on && !(s.reopens_on && dateIso >= s.reopens_on && s.reopens_on > s.closes_on)) return false;
  if (s.months?.length && !s.months.includes(Number(dateIso.slice(5, 7)))) return false;
  if (s.months?.length || s.reopens_on || s.closes_on) return true;
  return s.state === "cerrado_por_temporada" ? false : null;
}

/** Ventanas abiertas (minutos) de un día según el horario con fuente; null = horario por confirmar. */
function openWindows(c: Candidate, dateIso: string): [number, number][] | null {
  if (!c.opening_hours?.source || !c.opening_hours.hours) return null;
  const list = c.opening_hours.hours[weekday(dateIso)];
  if (!list) return [];
  return list.map(([a, b]) => { const s = toMin(a); let e = toMin(b); if (e <= s) e += 1440; return [s, e] as [number, number]; });
}

export interface PlanRequest {
  dateFrom: string;           // YYYY-MM-DD (primer día)
  nights: number;             // 3 noches = días 1, 2 y 3 (la mañana del día 4 es la salida)
  hotel?: { name?: string | null; lat?: number | null; lng?: number | null } | null;
  partySize?: number | null;
  budget?: { amount: number; currency: string } | null;
  budgetLevel?: number | null;
  /** Edad del integrante más joven (si se sabe). */
  youngestAge?: number | null;
  intents?: IntentKey[];
  text?: string;              // o el texto del usuario, que se traduce con parseIntents
  template?: string | null;
  timeZone?: string | null;
}

export interface PlannedItem {
  intent: IntentKey;
  intent_label: string;
  day: number;
  date: string;
  start: string;
  end: string;
  /** Minutos desde la medianoche del día (pueden pasar de 1440 si termina de madrugada). */
  start_min: number;
  end_min: number;
  start_iso: string;
  time_status: "horario_por_confirmar" | "segun_horario_publicado";
  time_text: string;
  duration_status: "ESTIMADO" | "publicado";
  experience: Pick<Candidate, "id" | "slug" | "name" | "universe" | "subcategory" | "state" | "label" | "website" | "booking_url" | "booking_method"> | null;
  transfer_before: Transfer | null;
  price_text: string;
  requirements: string[];
  warnings: string[];
  alternatives: { id: string; name: string; state: string }[];
}

export interface PlanResult {
  status: "propuesta";
  destination: string | null;
  template: string | null;
  days: { day: number; date: string; items: PlannedItem[]; return_to_hotel: Transfer | null }[];
  unplaced: { intent: IntentKey; reason: string }[];
  budget: { currency: string | null; known_total: number | null; items_with_price: number; items_without_price: number; text: string; over_budget: boolean | null };
  requirements: string[];
  disclaimers: string[];
}

function priceFor(c: Candidate, party: number): { amount: number | null; currency: string | null; text: string } {
  const p = c.price;
  if (!p?.source || (p.min == null && p.max == null)) {
    return { amount: null, currency: null, text: c.price_level ? `Precio por confirmar (nivel ${"$".repeat(c.price_level)})` : "Precio por confirmar" };
  }
  const base = Number(p.min ?? p.max);
  const perPerson = p.basis === "por_persona" || p.basis === "menu_degustacion" || p.basis === "entrada";
  const amount = perPerson ? base * party : base;
  const range = p.min != null && p.max != null && p.max !== p.min ? `${p.min}–${p.max}` : `${base}`;
  return { amount, currency: p.currency ?? null,
    text: `${range} ${p.currency ?? ""}${perPerson ? " por persona" : ""} (según la fuente; desde ${amount} ${p.currency ?? ""} para ${party})`.replace(/\s+/g, " ").trim() };
}

function requirementsFor(c: Candidate, req: PlanRequest): { reqs: string[]; blocking: string | null } {
  const reqs: string[] = [];
  let blocking: string | null = null;
  if (c.age_policy === "18+" || c.age_policy === "21+") {
    reqs.push(`Edad mínima ${c.age_policy.replace("+", "")} años (identificación oficial)`);
    const min = c.age_policy === "21+" ? 21 : 18;
    if (req.youngestAge != null && req.youngestAge < min) blocking = `Requiere ${min}+ y alguien del grupo tiene ${req.youngestAge}`;
  }
  if (c.dress_code) reqs.push(`Dress code: ${c.dress_code}`);
  if (c.reservation_required || (c.booking_method && !["walk_in"].includes(c.booking_method))) {
    reqs.push(c.booking_method === "walk_in" ? "Sin reserva (por orden de llegada)" : "Requiere reserva: se solicita, no está confirmada");
  } else if (c.booking_method === "walk_in") reqs.push("Sin reserva (por orden de llegada)");
  if (c.restrictions) reqs.push(c.restrictions);
  if (c.universe === "casino_grand_nights") reqs.push("Información práctica. IATOS no promueve ni intermedia apuestas. Juega con responsabilidad.");
  if (c.universe === "adventure_elite" && c.safety) reqs.push(`Seguridad: ${c.safety}`);
  return { reqs, blocking };
}

function rankCandidates(cands: Candidate[], intent: IntentKey, req: PlanRequest, from: Point | null): Candidate[] {
  const lvl = req.budgetLevel ?? null;
  return cands
    .filter((c) => usableState(String(c.state)) && matchesIntent(c, intent))
    .map((c) => {
      let score = (STATE_RANK[String(c.state)] ?? 0) * 100;
      if (lvl && c.price_level) score -= Math.abs(lvl - c.price_level) * 15;
      if (hasPoint(from) && hasPoint(c)) score -= Math.min(60, haversineKm(from, c) * 5);
      if (c.label === "EXPERIENCIA_PRIVADA" && intent === "navegacion") score += 10;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .map((x) => x.c);
}

const SLOT_ORDER: Record<Slot, number> = { manana: 0, comida: 1, tarde: 2, tarde_noche: 3, noche: 4 };

/**
 * Arma la propuesta. Determinista: mismas entradas → mismo resultado.
 */
export function planExperiences(candidates: Candidate[], req: PlanRequest): PlanResult {
  const party = Math.max(1, Math.round(req.partySize ?? 2));
  const nights = Math.max(1, Math.min(14, Math.round(req.nights || 1)));
  let intents = (req.intents?.length ? req.intents : parseIntents(req.text ?? "")).filter((i) => INTENTS[i]);
  const template = req.template && TEMPLATES[req.template] ? req.template : matchTemplate(intents);
  if (req.template && TEMPLATES[req.template]) intents = [...TEMPLATES[req.template].steps];
  const hotel: Point | null = req.hotel ?? null;
  const tz = req.timeZone ?? candidates.find((c) => c.destination?.timezone)?.destination?.timezone ?? null;
  const destination = candidates.find((c) => c.destination)?.destination?.name ?? null;

  const days = Array.from({ length: nights }, (_, i) => ({ day: i + 1, date: addDays(req.dateFrom, i), items: [] as PlannedItem[], return_to_hotel: null as Transfer | null }));
  const unplaced: { intent: IntentKey; reason: string }[] = [];
  const used = new Set<string>();

  // Orden de colocación: por franja del día (mañana → noche), respetando el orden de la plantilla.
  const real = intents.filter((i) => !INTENTS[i].derived);
  const ordered = [...real].sort((a, b) => SLOT_ORDER[INTENTS[a].slot] - SLOT_ORDER[INTENTS[b].slot] || real.indexOf(a) - real.indexOf(b));
  // Los pasos de la plantilla van juntos el día 1; lo demás se reparte en los días menos cargados.
  const templateSteps = new Set<IntentKey>(template ? TEMPLATES[template].steps : []);

  for (const intent of ordered) {
    const def = INTENTS[intent];
    const ranked = rankCandidates(candidates.filter((c) => !used.has(c.id)), intent, req, hotel);
    if (!ranked.length) {
      unplaced.push({ intent, reason: `Sin opción verificada en el catálogo${destination ? ` de ${destination}` : ""} para "${def.label}". Iato no inventa lugares.` });
      continue;
    }
    let placed = false;
    const templateDay = 0;
    const dayOrder = templateSteps.has(intent)
      ? [templateDay, ...[...days.keys()].filter((i) => i !== templateDay)]
      : [...days.keys()].sort((a, b) =>
          (templateSteps.size && a === templateDay ? 1 : 0) - (templateSteps.size && b === templateDay ? 1 : 0)
          || days[a].items.length - days[b].items.length || a - b);
    const tried: string[] = [];
    for (const cand of ranked.slice(0, 4)) {
      for (const di of dayOrder) {
        const day = days[di];
        const season = seasonOpenOn(cand, day.date);
        if (season === false) { tried.push(`${cand.name}: cerrado por temporada el ${day.date}${cand.season?.note ? ` (${cand.season.note})` : ""}`); continue; }
        const { reqs, blocking } = requirementsFor(cand, req);
        if (blocking) { tried.push(`${cand.name}: ${blocking}`); break; }
        const prev = day.items[day.items.length - 1] ?? null;
        const fromPoint: Point | null = prev ? (candidates.find((c) => c.id === prev.experience?.id) ?? null) : hotel;
        const transfer = estimateTransfer(fromPoint, cand);
        const duration = cand.duration_min ?? def.duration;
        const night = def.slot === "noche";
        let start = night ? nightMin(def.start) : toMin(def.start);
        const latest = night ? nightMin(def.latest) : toMin(def.latest);
        // Se coloca por franjas (mañana → noche): va después de todo lo que ya hay ese día.
        const lastEnd = day.items.length ? Math.max(...day.items.map((x) => x.end_min)) : null;
        if (lastEnd != null) start = Math.max(start, lastEnd + transfer.assumed_min);
        if (day.items.some((x) => start < x.end_min && start + duration > x.start_min)) { tried.push(`${cand.name}: se enciman horarios el ${day.date}`); continue; }
        const windows = openWindows(cand, day.date);
        let timeStatus: PlannedItem["time_status"] = "horario_por_confirmar";
        if (windows) {
          const w = windows.find(([s, e]) => Math.max(start, s) + duration <= e && Math.max(start, s) <= latest);
          if (!w) { tried.push(`${cand.name}: cerrado o sin horario compatible el ${day.date} (según su horario publicado)`); continue; }
          start = Math.max(start, w[0]);
          timeStatus = "segun_horario_publicado";
        }
        if (start > latest) { tried.push(`${cand.name}: no cabe el ${day.date} sin encimarse con lo anterior`); continue; }
        const end = start + duration;
        const price = priceFor(cand, party);
        const warnings: string[] = [];
        if (cand.state === "CURADO") warnings.push("Curado: pendiente de verificación en el sitio oficial");
        if (cand.state === "ESTIMADO") warnings.push("Dato práctico estimado");
        if (season === null && cand.season?.note) warnings.push(`Temporada: ${cand.season.note}`);
        if (!cand.duration_min) warnings.push(`Duración estimada (${duration} min)`);
        const item: PlannedItem = {
          intent, intent_label: def.label, day: day.day, date: day.date,
          start: fmt(start), end: fmt(end), start_min: start, end_min: end, start_iso: zonedIso(day.date, fmtRaw(start), tz),
          time_status: timeStatus,
          time_text: timeStatus === "horario_por_confirmar" ? `${fmt(start)} sugerido · horario por confirmar` : `${fmt(start)} · dentro del horario publicado`,
          duration_status: cand.duration_min ? "publicado" : "ESTIMADO",
          experience: { id: cand.id, slug: cand.slug, name: cand.name, universe: cand.universe, subcategory: cand.subcategory, state: cand.state,
            label: cand.label ?? null, website: cand.website ?? null, booking_url: cand.booking_url ?? null, booking_method: cand.booking_method ?? null },
          transfer_before: transfer,
          price_text: price.text,
          requirements: reqs,
          warnings,
          alternatives: ranked.filter((c) => c.id !== cand.id).slice(0, 2).map((c) => ({ id: c.id, name: c.name, state: String(c.state) })),
        };
        day.items.push(item);
        day.items.sort((a, b) => a.start_min - b.start_min);
        used.add(cand.id);
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) unplaced.push({ intent, reason: tried.length ? tried.slice(0, 3).join(" · ") : `No hubo hueco para "${def.label}" en ${nights} noche(s)` });
  }

  // Traslados entre elementos ya ordenados y regreso al hotel.
  for (const day of days) {
    day.items.forEach((it, i) => {
      const prev = i > 0 ? candidates.find((c) => c.id === day.items[i - 1].experience?.id) ?? null : hotel;
      const cur = candidates.find((c) => c.id === it.experience?.id) ?? null;
      it.transfer_before = estimateTransfer(prev, cur);
    });
    const last = day.items[day.items.length - 1];
    if (last && hotel) day.return_to_hotel = estimateTransfer(candidates.find((c) => c.id === last.experience?.id) ?? null, hotel);
  }

  // Presupuesto: solo precios con fuente.
  const placedItems = days.flatMap((d) => d.items);
  const priced = placedItems.map((it) => priceFor(candidates.find((c) => c.id === it.experience?.id)!, party));
  const currencies = [...new Set(priced.filter((p) => p.amount != null).map((p) => p.currency))];
  const known = currencies.length === 1 ? priced.reduce((s, p) => s + (p.amount ?? 0), 0) : null;
  const withPrice = priced.filter((p) => p.amount != null).length;
  const without = priced.length - withPrice;
  const cur = currencies.length === 1 ? currencies[0] : null;
  const over = req.budget && known != null && cur === req.budget.currency ? known > req.budget.amount : null;
  const budgetText = withPrice === 0
    ? "Precio por confirmar: ninguno de estos lugares publica un precio con fuente"
    : `${known != null ? `Desde ${known} ${cur} con precio publicado` : "Precios en varias monedas"}${without ? ` · ${without} con precio por confirmar` : ""}`;

  const requirements = [...new Set(placedItems.flatMap((it) => it.requirements))];
  return {
    status: "propuesta",
    destination,
    template,
    days,
    unplaced,
    budget: { currency: cur, known_total: known, items_with_price: withPrice, items_without_price: without, text: budgetText, over_budget: over },
    requirements,
    disclaimers: [
      "Es una propuesta de Iato: nada está reservado ni confirmado.",
      "Horarios sugeridos: solo se usan los horarios que el lugar publica; los demás están por confirmar.",
      "Traslados ESTIMADOS (distancia en línea recta, ciudad a ~20 km/h); el tiempo real depende del tráfico.",
      "Precios solo con fuente; lo demás, por confirmar.",
    ],
  };
}

/** Texto corto en español para que Iato lo explique (sin inventar nada que no esté en el plan). */
export function planSummary(plan: PlanResult): string {
  const lines: string[] = [];
  for (const d of plan.days) {
    if (!d.items.length) continue;
    lines.push(`Día ${d.day} (${d.date}):`);
    for (const it of d.items) {
      const t = it.transfer_before?.minutes != null ? ` · traslado ${it.transfer_before.text}` : it.transfer_before ? ` · ${it.transfer_before.text}` : "";
      lines.push(`- ${it.time_text}: ${it.intent_label} en ${it.experience?.name} [${it.experience?.state}]${t}. ${it.price_text}.`);
    }
  }
  for (const u of plan.unplaced) lines.push(`Sin colocar: ${INTENTS[u.intent].label} — ${u.reason}`);
  lines.push(plan.budget.text + ".");
  lines.push(plan.disclaimers[0]);
  return lines.join("\n");
}
