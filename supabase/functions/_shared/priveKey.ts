// THE PRIVÉ KEY · "Make it Extraordinary" — el modo Privé de Iato (Doc B §2, §10, §11).
// Lógica pura y determinista: sin Deno, sin red y SIN IA. La usan concierge-chat (modo prive_key y la
// herramienta search_prive), la app (src/lib/priveKey.ts) y las pruebas (src/test/priveKey*.test.ts).
//
// Del deseo escrito ("Tengo $10,000 MXN para celebrar un aniversario en CDMX") a hasta TRES propuestas
// diferenciadas, cada una una secuencia completa armada con el Experience Planner (privePlanner.ts):
//   THE SIGNATURE   singularidad y calidad dentro del presupuesto
//   THE INSIDER     autenticidad, criterio local y valor
//   THE UNEXPECTED  inesperada pero coherente con lo pedido
// Reglas que se prueban:
//  * pregunta SOLO lo que falta (lugar, fecha, personas, presupuesto) y en una sola ronda;
//  * usa bien el viaje activo (lo resuelve _shared/activeTrip.ts en el servidor): si el texto nombra otro
//    lugar, no se usa ese viaje; si hay empate, no se adivina;
//  * nada se inventa: solo experiencias del catálogo verificado; horarios y precios solo con fuente;
//    traslados siempre ESTIMADOS; disponibilidad nunca consultada aquí;
//  * presupuesto: lo que excede (por precio publicado o por la nota de precio de la curaduría) no entra, y
//    "cabe en tu presupuesto" solo se dice si TODO tiene precio con fuente y la suma cabe;
//  * nunca dice reservado, confirmado, garantizado ni VIP;
//  * los tres niveles no comparten ninguna experiencia.
import { INTENTS, matchesIntent, parseIntents, planExperiences, type Candidate, type IntentKey, type PlannedItem, type PlanResult, usableState }
  from "./privePlanner.ts";
import { KEY_PLACES, KEY_TERMS } from "./priveKeyPlaces.ts";

export type Lang = "es" | "en";
export type KeyMode = "key" | "h48" | "surprise";
export type Tier = "signature" | "insider" | "unexpected";
export type Companions = "pareja" | "padres" | "familia" | "amigos" | "solo" | "trabajo";
export type Occasion = "aniversario" | "cumpleanos" | "propuesta" | "luna_de_miel" | "celebracion" | "romantica" | "negocios";

/** Candidato del catálogo con lo que The Key necesita además del planificador. */
export interface KeyCandidate extends Candidate {
  why?: string | null;
  neighborhood?: string | null;
  verified_at?: string | null;
  price_note?: string | null;
  accolades?: { name: string; year: number; url?: string }[] | null;
  image?: Record<string, unknown> | null;
  reasons?: string[] | null;
  availability?: { state?: string | null; checked_at?: string | null } | null;
  members_only_venue?: boolean | null;
  event_start?: string | null;
  event_end?: string | null;
}

export const t = (lang: Lang, es: string, en: string) => (lang === "en" ? en : es);
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9$€£.,:/]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: unknown) => ` ${norm(s).replace(/[$€£.,:/]/g, " ").replace(/\s+/g, " ")} `;

// ─────────────────────────────── Lugar ───────────────────────────────
export interface Place { slug: string; name_es: string; name_en: string; kind: string; parent: string | null; is_destination: boolean;
  currency: string | null; term: string }
const PLACES = new Map(KEY_PLACES.map(([slug, es, en, kind, parent, dest, cur]) => [slug, { slug, name_es: es, name_en: en, kind, parent, is_destination: dest, currency: cur }]));
// Términos que también son palabras comunes: solo cuentan tras "en/a/de/in/to/at" ("a nice dinner" no es Niza).
const AMBIGUOUS = new Set(["nice", "rio", "lima", "cabo", "oia", "mexico", "roma", "como", "vegas", "caba", "napa", "vail", "porto"]);
const TERMS = [...KEY_TERMS].sort((a, b) => b[0].length - a[0].length);

export function placeBySlug(slug: string | null | undefined): Omit<Place, "term"> | null {
  return slug ? PLACES.get(slug) ?? null : null;
}
export const placeName = (p: { name_es: string; name_en: string } | null | undefined, lang: Lang) => (p ? (lang === "en" ? p.name_en : p.name_es) : "");

/** Lugar que nombra el texto (el término más largo gana: "roma condesa" antes que "roma"). */
export function detectPlace(text: string): Place | null {
  const w = words(text);
  for (const [term, slug] of TERMS) {
    const at = w.indexOf(` ${term} `);
    if (at < 0) continue;
    if (AMBIGUOUS.has(term)) {
      const before = w.slice(0, at).trim().split(" ").pop() ?? "";
      // "a" es preposición en español pero artículo en inglés ("a nice dinner"): no cuenta para "nice".
      const preps = ["en", "de", "in", "to", "at", "para", "hacia", "desde", "visit", "visitar", "conocer", ...(term === "nice" ? [] : ["a"])];
      if (!preps.includes(before)) continue;
    }
    const p = PLACES.get(slug);
    if (p) return { ...p, term };
  }
  return null;
}

/** Destinos con experiencias dentro de un país o región que no es destino ("Japón" → Tokio, Kioto, Osaka). */
export function childDestinations(slug: string): Omit<Place, "term">[] {
  return [...PLACES.values()].filter((p) => p.parent === slug && p.is_destination && p.kind !== "neighborhood");
}

// ─────────────────────────────── Presupuesto ───────────────────────────────
export interface Budget { amount: number; currency: string; assumed_currency: boolean }
const CUR_WORDS: [RegExp, string][] = [
  [/^(mxn|pesos?|mxp|peso mexicano|pesos mexicanos)$/, "MXN"], [/^(usd|us\$|dolares?|dollars?|dls|dlls)$/, "USD"],
  [/^(eur|euros?|€)$/, "EUR"], [/^(gbp|libras?|pounds?|£)$/, "GBP"], [/^(jpy|yenes?|yen)$/, "JPY"], [/^(aed|dirhams?)$/, "AED"],
];
const curOf = (w: string | undefined | null) => (w ? CUR_WORDS.find(([re]) => re.test(w.trim()))?.[1] ?? null : null);

function toNumber(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");     // 10,000 · 10.000
  else s = s.replace(",", ".");                                           // 1,5 → 1.5
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "$10,000 MXN", "10 mil pesos", "500 euros", "€800", "USD 300", "15k". Sin moneda explícita y con "$": MXN (se dice). */
export function parseBudget(text: string): Budget | null {
  const s = String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const re = /(us\$|\$|€|£|mxn|usd|eur)?\s?(\d[\d.,]*)\s?(k|mil)?\s?(mxn|pesos mexicanos|pesos|peso|usd|dolares|dolar|dollars|dls|dlls|eur|euros|euro|gbp|libras|yenes|yen|jpy|aed|dirhams)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [, pre, num, mult, post] = m;
    if (!pre && !mult && !post) continue;                       // "somos 4", "48 horas": no es dinero
    let n = toNumber(num);
    if (n == null) continue;
    if (mult) n *= 1000;
    const after = s.slice(re.lastIndex, re.lastIndex + 8);
    if (!pre && !post && /^\s*(horas|hrs|h\b|noches|dias|personas)/.test(after)) continue;
    const explicit = curOf(post) ?? (pre === "€" ? "EUR" : pre === "£" ? "GBP" : pre === "us$" ? "USD" : curOf(pre ?? ""));
    if (n < 50) continue;
    return { amount: Math.round(n), currency: explicit ?? "MXN", assumed_currency: !explicit };
  }
  return null;
}

// ─────────────────────────────── Personas, ocasión, restricciones ───────────────────────────────
const NUM_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function parseParty(text: string): { size: number | null; companions: Companions | null; minors: boolean } {
  const w = words(text);
  const minors = /\b(ninos|ninas|hijos pequenos|menores|bebe|kids|children)\b/.test(w);
  const num = (x: string) => (/^\d+$/.test(x) ? Number(x) : NUM_WORDS[x] ?? null);
  const m = w.match(/\b(?:somos|seremos|para|party of|we are|grupo de)\s+(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:horas|hrs|noches|dias|mil|k|pesos|mxn|usd|euros|eur|de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)))/)
    ?? w.match(/\b(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six)\s+(?:personas|adultos|people|adults|amigos|amigas|friends|invitados)\b/);
  let size = m ? num(m[1]) : null;
  let companions: Companions | null = null;
  if (/\b(mi|con mi|my|with my)\s+(pareja|esposa|esposo|novia|novio|marido|mujer|prometida|prometido|partner|wife|husband|girlfriend|boyfriend|fiance|fiancee)\b/.test(w)
    || /\b(romantic|romantica|romantico|aniversario|anniversary|luna de miel|honeymoon|pedida|propuesta de matrimonio)\b/.test(w)) companions = "pareja";
  if (/\b(mis padres|mis papas|my parents|mi mama y mi papa)\b/.test(w)) companions = "padres";
  if (/\b(familia|family|mis hijos|my kids)\b/.test(w)) companions = "familia";
  if (/\b(amigos|amigas|friends)\b/.test(w)) companions = "amigos";
  if (/\b(viajo solo|viajo sola|yo solo|yo sola|solo yo|by myself|alone|solo trip)\b/.test(w)) companions = "solo";
  if (/\b(negocios|clientes|business|trabajo|colegas)\b/.test(w)) companions = companions ?? "trabajo";
  if (size == null) size = companions === "pareja" || companions === "padres" ? 2 : companions === "solo" ? 1 : null;
  return { size: size && size >= 1 && size <= 30 ? size : null, companions, minors };
}

export function parseOccasion(text: string): Occasion | null {
  const w = words(text);
  if (/\b(propuesta de matrimonio|pedida|pedir matrimonio|proposal|propose)\b/.test(w)) return "propuesta";
  if (/\b(aniversario|anniversary)\b/.test(w)) return "aniversario";
  if (/\b(luna de miel|honeymoon)\b/.test(w)) return "luna_de_miel";
  if (/\b(cumpleanos|cumple|birthday)\b/.test(w)) return "cumpleanos";
  if (/\b(celebrar|celebracion|celebrate|celebration|festejar)\b/.test(w)) return "celebracion";
  if (/\b(romantica|romantico|romantic|inolvidable con mi pareja)\b/.test(w)) return "romantica";
  if (/\b(clientes|negocios|business dinner)\b/.test(w)) return "negocios";
  return null;
}

/** Restricciones que el usuario escribe. Iato las avisa al lugar; nunca promete que se cumplen. */
export function parseRestrictions(text: string): string[] {
  const w = words(text);
  const out: string[] = [];
  if (/\b(vegetarian[oa]?|vegetarian)\b/.test(w)) out.push("vegetariano");
  if (/\b(vegan[oa]?|vegan)\b/.test(w)) out.push("vegano");
  if (/\b(sin gluten|celiac[oa]|gluten free)\b/.test(w)) out.push("sin_gluten");
  if (/\b(sin alcohol|no bebo|no alcohol|sober|abstemi[oa])\b/.test(w)) out.push("sin_alcohol");
  if (/\b(silla de ruedas|movilidad reducida|accesible|wheelchair|accessible)\b/.test(w)) out.push("accesible");
  if (/\b(alergi[ao]s?|allerg(y|ic))\b/.test(w)) out.push("alergias");
  if (/\b(sin mariscos|no mariscos|no seafood|shellfish)\b/.test(w)) out.push("sin_mariscos");
  return out;
}

const RESTRICTION_TEXT: Record<string, [string, string]> = {
  vegetariano: ["Vegetariano: avísalo al reservar; Iato no puede confirmar el menú", "Vegetarian: mention it when booking; Iato cannot confirm the menu"],
  vegano: ["Vegano: avísalo al reservar; Iato no puede confirmar el menú", "Vegan: mention it when booking; Iato cannot confirm the menu"],
  sin_gluten: ["Sin gluten: confírmalo con el lugar antes de ir", "Gluten-free: confirm it with the venue before going"],
  sin_alcohol: ["Sin alcohol: se omiten bares y casinos", "No alcohol: bars and casinos are left out"],
  accesible: ["Accesibilidad: confirma acceso y baños con cada lugar; el catálogo no lo verifica", "Accessibility: confirm access with each venue; the catalogue does not verify it"],
  alergias: ["Alergias: avísalas al reservar y confírmalas con el lugar", "Allergies: mention them when booking and confirm with the venue"],
  sin_mariscos: ["Sin mariscos: avísalo al reservar", "No seafood: mention it when booking"],
};

// ─────────────────────────────── Fecha ───────────────────────────────
const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12, january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12, ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

export const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

/** Fecha que nombra el texto, o null. "esta noche"/"hoy" = hoy; "el sábado" = el próximo (hoy si es sábado). */
export function parseDate(text: string, todayISO: string): string | null {
  const w = words(text);
  const raw = String(text ?? "");
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isIso(iso[1])) return iso[1];
  if (/\b(pasado manana|day after tomorrow)\b/.test(w)) return addDaysIso(todayISO, 2);
  if (/\b(hoy|esta noche|today|tonight|ahora|right now|ahorita)\b/.test(w)) return todayISO;
  // "mañana" como día (no "por la mañana" / "en la mañana" / "de la mañana")
  if (/\b(tomorrow)\b/.test(w) || (/\bmanana\b/.test(w) && !/\b(la|las|en la|por la|de la)\s+manana\b/.test(w))) return addDaysIso(todayISO, 1);
  if (/\b(este fin de semana|el fin de semana|fin de semana|this weekend|weekend)\b/.test(w)) {
    const d = dow(todayISO);
    return d === 6 || d === 0 ? todayISO : addDaysIso(todayISO, 6 - d);
  }
  for (const [name, n] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b(el|este|next|this|on)?\\s?${name}\\b`).test(w)) {
      const d = dow(todayISO);
      return addDaysIso(todayISO, (n - d + 7) % 7);
    }
  }
  const year = Number(todayISO.slice(0, 4));
  const fix = (y: number, m: number, d: number) => {
    let s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!isIso(s) || new Date(`${s}T12:00:00Z`).getUTCDate() !== d) return null;
    if (s < todayISO) s = `${y + 1}${s.slice(4)}`;
    return s;
  };
  const dm = w.match(/\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (dm) return fix(year, MONTHS[dm[2]], Number(dm[1]));
  const md = w.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{1,2})\b/);
  if (md) return fix(year, MONTHS[md[1]], Number(md[2]));
  const sl = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (sl) return fix(sl[3] ? Number(sl[3].length === 2 ? `20${sl[3]}` : sl[3]) : year, Number(sl[2]), Number(sl[1]));
  return null;
}

export function parseMode(text: string): { mode: KeyMode; nights: number; layoverHours: number | null } {
  const w = words(text);
  const lay = w.match(/\b(?:escala|layover|conexion)\b(?:\s+\w+){0,3}?\s+(\d{1,2})\s*(?:horas|hrs|h|hours)\b/) ?? w.match(/\b(\d{1,2})\s*(?:horas|hrs|h|hours)\s+de\s+escala\b/);
  const layover = /\b(escala|layover)\b/.test(w);
  if (/\b(sorprendeme|sorprendenos|sorpresa|surprise me|surprise us|sorprender)\b/.test(w)) return { mode: "surprise", nights: 1, layoverHours: null };
  if (!layover && /\b(48\s?(?:h|hrs|horas|hours)|dos dias|2 dias|two days|fin de semana completo|weekend getaway|escapada de fin de semana)\b/.test(w)) return { mode: "h48", nights: 2, layoverHours: null };
  if (!layover && /\b(72\s?(?:h|horas|hours)|tres dias|3 dias|three days)\b/.test(w)) return { mode: "h48", nights: 3, layoverHours: null };
  return { mode: "key", nights: 1, layoverHours: lay ? Number(lay[1]) : layover ? null : null };
}

// ─────────────────────────────── Deseo ───────────────────────────────
export interface TripCtx {
  id: string; destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null; num_viajeros?: number | null;
  /** Por qué es el viaje en contexto (resolveActiveTrip). */
  reason?: string | null;
}
export interface KeyAnswers {
  destination?: string | null;
  date?: string | null;          // YYYY-MM-DD | today | tomorrow | weekend
  party?: number | null;
  budget?: { amount: number; currency: string } | "open" | null;
  mode?: KeyMode | null;
}
export interface Wish {
  text: string;
  mode: KeyMode;
  nights: number;
  layoverHours: number | null;
  place: Omit<Place, "term"> | null;
  /** Texto para buscar el destino en la base (slug o nombre). */
  destinationQuery: string | null;
  destinationSource: "text" | "trip" | "answer" | null;
  date: string | null;
  dateSource: "text" | "trip" | "answer" | null;
  party: number | null;
  partySource: "text" | "trip" | "answer" | null;
  budget: Budget | null;
  budgetOpen: boolean;
  companions: Companions | null;
  occasion: Occasion | null;
  minors: boolean;
  restrictions: string[];
  intents: IntentKey[];
  timeOfDay: "noche" | "tarde" | "dia" | null;
  /** Viaje usado para este plan (null si no aplica o si el deseo es de otro lugar). */
  trip: (TripCtx & { label?: string }) | null;
  tripNote: string | null;
  notes: string[];
}

function relDate(v: string | null | undefined, todayISO: string): string | null {
  if (!v) return null;
  if (isIso(v)) return v;
  if (v === "today") return todayISO;
  if (v === "tomorrow") return addDaysIso(todayISO, 1);
  if (v === "weekend") { const d = dow(todayISO); return d === 6 || d === 0 ? todayISO : addDaysIso(todayISO, 6 - d); }
  return null;
}

const tripMatchesPlace = (trip: TripCtx, place: { name_es: string; name_en: string; slug: string } | null) => {
  if (!place) return true;
  const td = words(trip.destino);
  return [place.name_es, place.name_en, place.slug.replace(/-/g, " ")].some((n) => td.includes(` ${norm(n)} `))
    || (detectPlace(String(trip.destino ?? ""))?.slug === place.slug)
    || (placeBySlug(detectPlace(String(trip.destino ?? ""))?.parent ?? null)?.slug === place.slug);
};

/**
 * Lee el deseo con el contexto del viaje activo. `trip` es el que resolvió activeTrip.ts (o null si no hay
 * o hay empate: entonces no se usa ninguno).
 */
export function resolveWish(text: string, answers: KeyAnswers = {}, ctx: { todayISO: string; trip?: TripCtx | null; lang?: Lang } = { todayISO: "" }): Wish {
  const lang = ctx.lang ?? "es";
  const clean = String(text ?? "").slice(0, 600);
  const pm = parseMode(clean);
  const mode = answers.mode ?? pm.mode;
  const nights = mode === "h48" ? Math.max(2, pm.nights) : 1;
  const notes: string[] = [];
  let place: Omit<Place, "term"> | null = detectPlace(clean);
  let destinationSource: Wish["destinationSource"] = place ? "text" : null;
  if (answers.destination) {
    const p = detectPlace(answers.destination) ?? placeBySlug(norm(answers.destination).replace(/ /g, "-"));
    place = p ?? { slug: norm(answers.destination).replace(/ /g, "-"), name_es: answers.destination, name_en: answers.destination, kind: "locality", parent: null, is_destination: true, currency: null };
    destinationSource = "answer";
  }
  // Viaje activo: solo si coincide con el lugar del deseo (o si el deseo no nombra lugar).
  let trip: Wish["trip"] = null;
  let tripNote: string | null = null;
  if (ctx.trip) {
    if (!place || tripMatchesPlace(ctx.trip, place)) {
      trip = { ...ctx.trip };
      if (!place) {
        const tp = detectPlace(String(ctx.trip.destino ?? ""));
        place = tp ?? (ctx.trip.destino ? { slug: norm(ctx.trip.destino).replace(/ /g, "-"), name_es: String(ctx.trip.destino), name_en: String(ctx.trip.destino), kind: "locality", parent: null, is_destination: true, currency: null } : null);
        destinationSource = place ? "trip" : null;
      }
    } else {
      tripNote = t(lang, `Tu viaje en contexto es a ${ctx.trip.destino}; este plan es para ${placeName(place, lang)}, así que no lo mezclo con ese viaje.`,
        `Your trip in context is to ${ctx.trip.destino}; this plan is for ${placeName(place, lang)}, so I keep it separate from that trip.`);
    }
  }
  const destinationQuery = place ? (place.is_destination ? place.slug : null) : null;

  // Fecha: texto > respuesta > viaje (si está en curso, hoy; si es futuro, su primer día).
  let date = parseDate(clean, ctx.todayISO);
  let dateSource: Wish["dateSource"] = date ? "text" : null;
  const ans = relDate(answers.date, ctx.todayISO);
  if (ans) { date = ans; dateSource = "answer"; }
  if (!date && trip?.fecha_salida) {
    const start = String(trip.fecha_salida).slice(0, 10);
    const end = String(trip.fecha_regreso ?? trip.fecha_salida).slice(0, 10);
    if (start <= ctx.todayISO && end >= ctx.todayISO) { date = ctx.todayISO; dateSource = "trip"; }
    else if (start > ctx.todayISO) { date = start; dateSource = "trip"; }
  }
  if (date && date < ctx.todayISO) { notes.push(t(lang, "La fecha ya pasó: la cambié por hoy.", "That date has passed: I used today.")); date = ctx.todayISO; }

  const party = parseParty(clean);
  let size = party.size;
  let partySource: Wish["partySource"] = size ? "text" : null;
  if (answers.party && answers.party >= 1 && answers.party <= 30) { size = Math.round(answers.party); partySource = "answer"; }
  if (!size && trip?.num_viajeros && trip.num_viajeros >= 1) { size = Math.min(30, Math.round(trip.num_viajeros)); partySource = "trip"; }

  let budget = parseBudget(clean);
  let budgetOpen = /\b(sin tope|sin limite|sin presupuesto|no importa el precio|cueste lo que cueste|no budget|money is no object)\b/.test(words(clean));
  if (answers.budget === "open") { budget = null; budgetOpen = true; }
  else if (answers.budget && answers.budget.amount > 0) budget = { amount: Math.round(answers.budget.amount), currency: String(answers.budget.currency || "MXN").toUpperCase().slice(0, 3), assumed_currency: false };
  if (budget?.assumed_currency) notes.push(t(lang, `Tomé el presupuesto en pesos mexicanos (${budget.amount.toLocaleString("es-MX")} MXN).`, `I read the budget as Mexican pesos (${budget.amount.toLocaleString("en-US")} MXN).`));

  const w = words(clean);
  // Por omisión, The Key arma una noche completa (Doc B §2); de día solo si se pide.
  const timeOfDay: Wish["timeOfDay"] = /\b(noche|cena|night|evening|dinner|tonight|esta noche)\b/.test(w) ? "noche"
    : /\b(tarde|afternoon|atardecer|sunset|comida|lunch)\b/.test(w) ? "tarde"
    : /\b(de dia|durante el dia|todo el dia|en el dia|por la manana|daytime|all day|desayuno|brunch)\b/.test(w) ? "dia" : null;
  // "aniversario"/"celebrar" son la OCASIÓN, no una actividad: solo una pedida de mano pide ese paso.
  const occasion = parseOccasion(clean);
  const intents = parseIntents(clean).filter((i) => i !== "propuesta" || occasion === "propuesta");

  return {
    text: clean, mode, nights, layoverHours: pm.layoverHours, place, destinationQuery, destinationSource, date, dateSource,
    party: size, partySource, budget, budgetOpen, companions: party.companions, occasion, minors: party.minors,
    restrictions: parseRestrictions(clean), intents, timeOfDay,
    trip, tripNote, notes,
  };
}

// ─────────────────────────────── Preguntas (solo lo que falta) ───────────────────────────────
export interface KeyQuestion {
  id: "destination" | "date" | "party" | "budget";
  text: string;
  hint?: string;
  input: "place" | "date" | "number" | "budget";
  options: { value: string; label: string }[];
}

const POPULAR = ["cdmx", "mc", "paris", "tokio", "los-cabos", "nueva-york"];
const BUDGET_PRESETS: Record<string, number[]> = { MXN: [3000, 6000, 10000, 20000], USD: [200, 400, 800, 1500], EUR: [200, 400, 800, 1500] };

export function missingQuestions(wish: Wish, lang: Lang = "es", opts: { tripCandidates?: TripCtx[] } = {}): KeyQuestion[] {
  const q: KeyQuestion[] = [];
  if (!wish.place || !wish.destinationQuery) {
    const children = wish.place && !wish.place.is_destination ? childDestinations(wish.place.slug) : [];
    const fromTrips = (opts.tripCandidates ?? []).map((tr) => detectPlace(String(tr.destino ?? ""))).filter((p): p is Place => !!p && p.is_destination);
    const opts2 = children.length ? children : [...fromTrips, ...POPULAR.map((s) => placeBySlug(s)!).filter(Boolean)];
    const seen = new Set<string>();
    q.push({
      id: "destination",
      text: wish.place && children.length
        ? t(lang, `¿En qué parte de ${placeName(wish.place, lang)}?`, `Where in ${placeName(wish.place, lang)}?`)
        : t(lang, "¿Dónde quieres vivirlo?", "Where would you like to live it?"),
      hint: fromTrips.length > 1 ? t(lang, "Tienes varios viajes próximos: elige uno o escribe otro lugar.", "You have several upcoming trips: pick one or type another place.") : undefined,
      input: "place",
      options: opts2.filter((p) => !seen.has(p.slug) && seen.add(p.slug)).slice(0, 6).map((p) => ({ value: p.slug, label: placeName(p, lang) })),
    });
  }
  if (wish.mode !== "surprise" && !wish.date) {
    q.push({ id: "date", text: t(lang, "¿Qué día?", "Which day?"), input: "date", options: [
      { value: "today", label: t(lang, "Hoy", "Today") }, { value: "tomorrow", label: t(lang, "Mañana", "Tomorrow") },
      { value: "weekend", label: t(lang, "Este fin de semana", "This weekend") },
    ] });
  }
  if (wish.mode !== "surprise" && !wish.party) {
    q.push({ id: "party", text: t(lang, "¿Cuántas personas?", "How many people?"), input: "number", options: [
      { value: "1", label: t(lang, "Solo yo", "Just me") }, { value: "2", label: "2" }, { value: "4", label: "4" }, { value: "6", label: "6" },
    ] });
  }
  if (wish.mode !== "surprise" && !wish.budget && !wish.budgetOpen) {
    const cur = wish.place?.currency && BUDGET_PRESETS[wish.place.currency] ? wish.place.currency : "MXN";
    const loc = lang === "en" ? "en-US" : "es-MX";
    q.push({ id: "budget", text: t(lang, "¿Hasta cuánto en total?", "Up to how much in total?"),
      hint: t(lang, "Solo cuento precios con fuente; lo demás te lo marco por confirmar.", "I only count sourced prices; the rest is marked to be confirmed."),
      input: "budget", options: [
        { value: "open", label: t(lang, "Sin tope fijo", "No fixed limit") },
        ...BUDGET_PRESETS[cur].map((n) => ({ value: `${n} ${cur}`, label: `${n.toLocaleString(loc)} ${cur}` })),
      ] });
  }
  return q;
}

// ─────────────────────────────── Precio y presupuesto ───────────────────────────────
const PER_PERSON = new Set(["por_persona", "menu_degustacion", "entrada"]);
/** Monto de la nota de precio de la curaduría ("Menú degustación $6,090 MXN") — ESTIMADO, solo para excluir. */
export function notePriceHint(note: string | null | undefined): { amount: number; currency: string; per_person: boolean } | null {
  if (!note) return null;
  const s = note.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const m = s.match(/(us\$|\$|€|£)?\s?(\d[\d.,]*)\s?(mxn|usd|eur|euros|€|gbp|£|jpy|yenes|aed)?/);
  if (!m || (!m[1] && !m[3])) return null;
  const n = toNumber(m[2]);
  if (n == null || n < 10) return null;
  const cur = curOf(m[3] ?? "") ?? (m[1] === "€" ? "EUR" : m[1] === "£" ? "GBP" : m[1] === "us$" ? "USD" : "MXN");
  const per = /(por persona|p\/p|pp\b|per person|menu|degustacion|cubierto|entrada|boleto|ticket)/.test(s) || !/(por grupo|por embarcacion|por mesa|total|charter|por barco)/.test(s);
  return { amount: n, currency: cur, per_person: per };
}

export type FxToMxn = Partial<Record<string, number>>;
export const DEFAULT_FX: FxToMxn = { MXN: 1, USD: 20.5, EUR: 22, GBP: 26, JPY: 0.135, AED: 5.6 };
export function convert(amount: number, from: string, to: string, fx: FxToMxn = DEFAULT_FX): number | null {
  if (from === to) return amount;
  const a = fx[from], b = fx[to];
  return a && b ? Math.round((amount * a) / b) : null;
}

interface Cost { amount: number | null; currency: string | null; basis: "fuente" | "nota_curaduria" | "por_confirmar"; source_url: string | null; checked_at: string | null; text: string }

export function costFor(c: KeyCandidate, party: number, lang: Lang): Cost {
  const p = c.price;
  if (p?.source && (p.min != null || p.max != null)) {
    const base = Number(p.min ?? p.max);
    const per = PER_PERSON.has(String(p.basis ?? ""));
    const amount = per ? base * party : base;
    const range = p.min != null && p.max != null && p.max !== p.min ? `${p.min}–${p.max}` : `${base}`;
    return { amount, currency: p.currency ?? null, basis: "fuente", source_url: p.source, checked_at: (p as { checked_at?: string }).checked_at ?? null,
      text: t(lang, `${range} ${p.currency ?? ""}${per ? " por persona" : ""} según la fuente · desde ${amount.toLocaleString("es-MX")} ${p.currency ?? ""} para ${party}`,
        `${range} ${p.currency ?? ""}${per ? " per person" : ""} per source · from ${amount.toLocaleString("en-US")} ${p.currency ?? ""} for ${party}`).replace(/\s+/g, " ").trim() };
  }
  const hint = notePriceHint(c.price_note);
  if (hint) {
    const amount = hint.per_person ? hint.amount * party : hint.amount;
    return { amount, currency: hint.currency, basis: "nota_curaduria", source_url: c.website ?? null, checked_at: c.verified_at ?? null,
      text: t(lang, `${c.price_note} (nota de la curaduría; confírmalo)`, `${c.price_note} (curation note; please confirm)`) };
  }
  return { amount: null, currency: null, basis: "por_confirmar", source_url: null, checked_at: null,
    text: c.price_level ? t(lang, `Precio por confirmar (nivel ${"$".repeat(c.price_level)})`, `Price to be confirmed (level ${"$".repeat(c.price_level)})`)
      : t(lang, "Precio por confirmar", "Price to be confirmed") };
}

/** Nivel de precio máximo razonable por persona con ese presupuesto (sin precio publicado). */
export function levelCeiling(budget: Budget | null, party: number, steps: number, fx: FxToMxn = DEFAULT_FX): number {
  if (!budget) return 4;
  const mxn = convert(budget.amount, budget.currency, "MXN", fx) ?? budget.amount;
  const perPersonPerStep = mxn / Math.max(1, party) / Math.max(1, Math.min(steps, 3)) * 1.6; // la cena pesa más que el resto
  return perPersonPerStep >= 3500 ? 4 : perPersonPerStep >= 1400 ? 3 : perPersonPerStep >= 500 ? 2 : 1;
}

/** ¿El candidato, por sí solo, ya rebasa el presupuesto? (precio con fuente o nota de curaduría) */
export function exceedsBudget(c: KeyCandidate, budget: Budget | null, party: number, fx: FxToMxn = DEFAULT_FX): boolean {
  if (!budget) return false;
  const cost = costFor(c, party, "es");
  if (cost.amount == null || !cost.currency) return false;
  const inBudget = convert(cost.amount, cost.currency, budget.currency, fx);
  return inBudget != null && inBudget > budget.amount;
}

export interface BudgetSummary {
  limit: { amount: number; currency: string } | null;
  sourced_total: number | null;
  estimated_total: number | null;
  currency: string | null;
  unknown: number;
  status: "dentro" | "probable" | "no_verificable" | "excede" | "sin_tope";
  text: string;
}

function summarizeBudget(costs: Cost[], budget: Budget | null, open: boolean, lang: Lang, fx: FxToMxn): BudgetSummary {
  const cur = budget?.currency ?? costs.find((c) => c.currency)?.currency ?? null;
  let sourced = 0, est = 0, unknown = 0, converted = false;
  for (const c of costs) {
    if (c.amount == null || !c.currency || !cur) { unknown++; continue; }
    const v = convert(c.amount, c.currency, cur, fx);
    if (v == null) { unknown++; continue; }
    if (c.currency !== cur) converted = true;
    if (c.basis === "fuente" && !(c.currency !== cur)) sourced += v; else est += v;
  }
  const loc = lang === "en" ? "en-US" : "es-MX";
  const money = (n: number) => `${Math.round(n).toLocaleString(loc)} ${cur ?? ""}`.trim();
  const total = sourced + est;
  let status: BudgetSummary["status"];
  let text: string;
  if (!budget) {
    status = "sin_tope";
    text = total > 0 ? t(lang, `Con precio conocido: desde ${money(total)}${unknown ? ` · ${unknown} por confirmar` : ""}.`, `With known prices: from ${money(total)}${unknown ? ` · ${unknown} to be confirmed` : ""}.`)
      : t(lang, "Ningún lugar publica precio con fuente: todo por confirmar.", "No venue publishes a sourced price: all to be confirmed.");
  } else if (total > budget.amount) {
    status = "excede";
    text = t(lang, `Supera tu presupuesto de ${money(budget.amount)} (lo conocido suma ${money(total)}).`, `Over your ${money(budget.amount)} budget (known prices add up to ${money(total)}).`);
  } else if (unknown === 0 && est === 0 && !converted) {
    status = "dentro";
    text = t(lang, `Cabe en tu presupuesto según precios publicados: ${money(sourced)} de ${money(budget.amount)}.`, `Fits your budget per published prices: ${money(sourced)} of ${money(budget.amount)}.`);
  } else if (unknown === 0) {
    status = "probable";
    text = t(lang, `Debería caber: ${money(total)} de ${money(budget.amount)}, con montos estimados${converted ? " y tipo de cambio aproximado" : ""}. Confírmalos.`,
      `Should fit: ${money(total)} of ${money(budget.amount)}, with estimated amounts${converted ? " and an approximate exchange rate" : ""}. Please confirm them.`);
  } else {
    status = "no_verificable";
    text = t(lang, `Lo conocido suma ${money(total)} de ${money(budget.amount)}; ${unknown} ${unknown === 1 ? "lugar no publica" : "lugares no publican"} precio, así que no puedo asegurar que cabe.`,
      `Known prices add up to ${money(total)} of ${money(budget.amount)}; ${unknown} ${unknown === 1 ? "venue doesn't" : "venues don't"} publish a price, so I can't promise it fits.`);
  }
  if (open && !budget) text = t(lang, "Sin tope fijo. ", "No fixed limit. ") + text;
  return { limit: budget ? { amount: budget.amount, currency: budget.currency } : null, sourced_total: sourced || null, estimated_total: est || null,
    currency: cur, unknown, status, text };
}

// ─────────────────────────────── Propuestas ───────────────────────────────
export const TIER_META: Record<Tier, { title: string; es: string; en: string; conceptEs: string; conceptEn: string }> = {
  signature: { title: "THE SIGNATURE", es: "La firma", en: "The signature",
    conceptEs: "Lo más singular y de mayor calidad que cabe en lo que pediste.", conceptEn: "The most singular, highest-quality option within what you asked." },
  insider: { title: "THE INSIDER", es: "Criterio local", en: "Local insight",
    conceptEs: "Autenticidad y criterio local: donde iría alguien que conoce la ciudad, con buen valor.", conceptEn: "Authentic and local: where someone who knows the city would go, with good value." },
  unexpected: { title: "THE UNEXPECTED", es: "Lo inesperado", en: "The unexpected",
    conceptEs: "Algo que no esperabas, pero coherente con tu ocasión.", conceptEn: "Something you didn't expect, yet true to your occasion." },
};

const LOCAL = /\b(tradicional|mercado|cantina|barrio|local|mezcal|pulque|taqueria|fonda|bistro|bistrot|izakaya|trattoria|osteria|tasca|taberna|jazz|speakeasy|familiar|artesan|cocina de autor|street food|antojitos)\b/;
const UNEXPECTED_UNIVERSES = new Set(["signature_mexico", "yacht_sea", "wellness_escape", "culture_access", "adventure_elite", "sport_leisure", "celebrations", "iconic_events"]);
const UNEXPECTED_STEPS: IntentKey[] = ["navegacion", "espectaculo", "concierto", "spa", "fotografia", "arte", "golf", "cultural"];

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const recentAccolade = (c: KeyCandidate) => Math.max(0, ...(c.accolades ?? []).map((a) => Number(a.year) || 0)) >= 2024;
/** Peso de los reconocimientos con fuente (estrellas MICHELIN, The World's 50 Best) desde 2024. */
export function accoladeScore(c: KeyCandidate): number {
  let s = 0;
  for (const a of c.accolades ?? []) {
    if ((Number(a.year) || 0) < 2024) continue;
    const n = norm(a.name);
    const stars = /tres estrellas|three stars|3 stars/.test(n) ? 3 : /dos estrellas|two stars|2 stars/.test(n) ? 2 : /una estrella|one star|1 star/.test(n) ? 1 : 0;
    s += stars * 30;
    if (/world s 50 best/.test(n)) s += 25; else if (/50 best/.test(n)) s += 8;
  }
  return Math.min(120, s);
}
const text = (c: KeyCandidate) => ` ${norm(`${c.subcategory} ${c.name} ${(c.tags ?? []).join(" ")} ${c.why ?? ""}`).replace(/_/g, " ")} `;

export function tierPreference(tier: Tier, ctx: { seed: string; avoidUniverses: Set<string>; ceiling: number }) {
  return (c: KeyCandidate, intent: IntentKey): number => {
    let s = 0;
    const lvl = c.price_level ?? null;
    if (lvl && lvl > ctx.ceiling) s -= 400;  // fuera de presupuesto por nivel (sin precio publicado)
    if (tier === "signature") {
      if (recentAccolade(c)) s += 30;
      s += accoladeScore(c);
      if (lvl) s += lvl * 12;
      if (c.label === "EXPERIENCIA_PRIVADA" || c.label === "PARTNER_VERIFICADO") s += 15;
      if ((c.reasons ?? []).some((r) => r.startsWith("dna:"))) s += 10;
    } else if (tier === "insider") {
      if (c.universe === "signature_mexico") s += 60;
      if (LOCAL.test(text(c))) s += 50;
      if (c.neighborhood) s += 10;
      if (lvl) s -= Math.max(0, lvl - 2) * 25;
      if (c.price?.source) s += 10;
      if (recentAccolade(c) && (lvl ?? 0) >= 4) s -= 30;
    } else {
      if (UNEXPECTED_UNIVERSES.has(String(c.universe)) && !ctx.avoidUniverses.has(String(c.universe))) s += 70;
      if (ctx.avoidUniverses.has(String(c.universe)) && !["cena", "restaurante", "gastronomia"].includes(intent)) s -= 40;
      s += hash(`${ctx.seed}|${c.id}`) % 30;  // variedad determinista
    }
    return s;
  };
}

export interface KeyStep {
  order: number;
  day: number;
  date: string;
  start: string;
  end: string;
  start_iso: string;
  time_status: PlannedItem["time_status"];
  time_text: string;
  intent: IntentKey;
  intent_label: string;
  experience: {
    id: string; slug?: string; name: string; universe: string; subcategory: string; state: string; label?: string | null; neighborhood?: string | null;
    why?: string | null; website?: string | null; booking_url?: string | null; booking_method?: string | null; verified_at?: string | null;
    destination?: Candidate["destination"]; image?: Record<string, unknown> | null; lat?: number | null; lng?: number | null;
  };
  transfer: { minutes: number | null; text: string; label: "ESTIMADO" } | null;
  cost: Cost;
  reason: string;
  confirmable: string[];
  pending: string[];
  requirements: string[];
  warnings: string[];
  alternatives: { id: string; name: string; state: string }[];
}

export interface KeyProposal {
  tier: Tier;
  title: string;
  subtitle: string;
  concept: string;
  steps: KeyStep[];
  days: number;
  universes: string[];
  budget: BudgetSummary;
  confirmable: string[];
  pending: string[];
  requirements: string[];
  unplaced: { intent: IntentKey; reason: string }[];
  return_to_hotel: { text: string; label: "ESTIMADO" } | null;
  narrative: string;
  disclaimers: string[];
  status: "propuesta";
}

export interface KeyResult {
  status: "questions" | "proposals" | "no_coverage";
  wish: Wish;
  questions: KeyQuestion[];
  proposals: KeyProposal[];
  /** Mensaje honesto cuando hay menos de tres propuestas o ninguna. */
  note: string | null;
  disclaimers: string[];
  candidates_considered: number;
}

const INTENT_LABEL: Partial<Record<IntentKey, [string, string]>> = {
  cena: ["Cena", "Dinner"], restaurante: ["Comida", "Lunch"], gastronomia: ["Gastronomía local", "Local food"], espectaculo: ["Espectáculo", "Show"],
  lounge: ["Una copa", "A nightcap"], concierto: ["Concierto", "Concert"], beach_club: ["Tarde de playa", "Beach afternoon"],
  navegacion: ["Paseo en barco", "Boat outing"], golf: ["Golf", "Golf"], spa: ["Spa", "Spa"], arte: ["Arte", "Art"], evento: ["Evento", "Event"],
  casino: ["Casino (información práctica)", "Casino (practical info)"], propuesta: ["Momento de celebración", "Celebration moment"],
  fotografia: ["Fotografía", "Photography"], cultural: ["Experiencia cultural", "Cultural experience"], hotel: ["Hotel", "Hotel"],
};
const intentLabel = (i: IntentKey, lang: Lang) => (INTENT_LABEL[i] ? (lang === "en" ? INTENT_LABEL[i]![1] : INTENT_LABEL[i]![0]) : INTENTS[i].label);

/** Pasos por nivel: los del usuario siempre; luego complementos solo si el catálogo tiene con qué. */
export function stepsFor(tier: Tier, wish: Wish, pool: KeyCandidate[], prevUniverses: Set<string>): IntentKey[] {
  // La firma solo suma pasos que estén a su altura (nivel alto, premio reciente o verificado).
  const premium = (c: KeyCandidate) => (c.price_level ?? 0) >= 3 || recentAccolade(c) || c.state === "VERIFICADO";
  const has = (i: IntentKey) => pool.some((c) => matchesIntent(c, i) && (tier !== "signature" || premium(c)));
  const asked = wish.intents.filter((i) => !INTENTS[i].derived && !(wish.restrictions.includes("sin_alcohol") && (i === "lounge" || i === "casino")));
  const noAlcohol = wish.restrictions.includes("sin_alcohol");
  const day = wish.timeOfDay === "dia" || wish.timeOfDay === "tarde";
  let extra: IntentKey[] = [];
  if (wish.mode === "h48") {
    extra = tier === "signature" ? ["arte", "restaurante", "cena", "espectaculo", "spa", "cena", "lounge"]
      : tier === "insider" ? ["cultural", "gastronomia", "lounge", "arte", "restaurante", "concierto"]
      : ["navegacion", "spa", "cena", "concierto", "fotografia", "restaurante"];
  } else if (tier === "signature") {
    extra = day ? ["arte", "restaurante", "spa"] : wish.occasion === "propuesta" ? ["propuesta", "cena", "lounge"] : ["cena", "espectaculo", "lounge"];
  } else if (tier === "insider") {
    extra = day ? ["cultural", "gastronomia", "arte"] : ["cena", "lounge", "concierto"];
  } else {
    // De noche, el ancla inesperada tiene que poder ser de tarde-noche (nada de museos a las 10:30).
    const anchors = day ? UNEXPECTED_STEPS : UNEXPECTED_STEPS.filter((i) => ["tarde", "tarde_noche", "noche"].includes(INTENTS[i].slot));
    const anchor = anchors.find((i) => has(i) && pool.some((c) => matchesIntent(c, i) && !prevUniverses.has(String(c.universe))))
      ?? anchors.find((i) => has(i));
    // Mismo bloque de la noche: la cena va antes que un espectáculo; un ancla de tarde (barco, spa) va antes por franja.
    // Un espectáculo de noche abre la velada y luego una copa (la cena no cabría después); un ancla de tarde
    // (barco, spa, fotografía) va antes de la cena.
    const nightAnchor = anchor && INTENTS[anchor].slot === "noche";
    extra = day ? [...(anchor ? [anchor] : []), "restaurante"] : nightAnchor ? [anchor!, "lounge", "cena"] : [...(anchor ? [anchor] : []), "cena", "lounge"];
  }
  const out: IntentKey[] = [...asked];
  const maxSteps = wish.layoverHours != null ? (wish.layoverHours < 6 ? 1 : wish.layoverHours < 10 ? 2 : 3) : wish.mode === "h48" ? 3 * wish.nights : 3;
  for (const i of extra) {
    if (out.length >= Math.max(maxSteps, asked.length)) break;
    if (noAlcohol && (i === "lounge" || i === "casino")) continue;
    // Una sola comida fuerte por franja: si ya hay cena, no se agrega otra en planes de una noche.
    if (wish.mode !== "h48" && out.includes(i)) continue;
    if (wish.mode !== "h48" && ["cena", "gastronomia", "restaurante"].includes(i) && out.some((x) => ["cena", "gastronomia", "restaurante"].includes(x)) && !day) continue;
    if (has(i)) out.push(i);
  }
  return out;
}

function confirmablePending(c: KeyCandidate, it: PlannedItem, cost: Cost, lang: Lang): { confirmable: string[]; pending: string[] } {
  const confirmable: string[] = [];
  const pending: string[] = [];
  if (c.booking_url) confirmable.push(t(lang, "Tiene página oficial de reservas: ahí eliges fecha y mesa", "Has an official booking page: pick date and table there"));
  else if (c.website) confirmable.push(t(lang, "Sitio oficial para consultar y reservar", "Official site to check and book"));
  if (usableState(String(c.state))) confirmable.push(t(lang, "Puedes pedírselo al equipo IATOS (solicitud, no reserva)", "You can ask the IATOS team (a request, not a booking)"));
  if (it.time_status === "horario_por_confirmar") pending.push(t(lang, "Horario por confirmar", "Opening hours to be confirmed"));
  if (cost.basis !== "fuente") pending.push(cost.basis === "nota_curaduria" ? t(lang, "Precio estimado por la curaduría", "Price estimated by curation") : t(lang, "Precio por confirmar", "Price to be confirmed"));
  if (!(c.availability?.state === "disponible" && c.availability?.checked_at)) pending.push(t(lang, "Disponibilidad no consultada", "Availability not checked"));
  if (c.state === "CURADO") pending.push(t(lang, "Curado: pendiente de verificación en el sitio oficial", "Curated: pending verification on the official site"));
  if (c.state === "ESTIMADO") pending.push(t(lang, "Datos prácticos estimados", "Practical data estimated"));
  if (c.reservation_required || (c.booking_method && c.booking_method !== "walk_in")) pending.push(t(lang, "Requiere reserva", "Booking required"));
  return { confirmable, pending };
}

function reasonFor(c: KeyCandidate, tier: Tier, wish: Wish, lang: Lang): string {
  const parts: string[] = [];
  if (c.why) parts.push(c.why);
  const r = c.reasons ?? [];
  if (r.includes("viaje:destino_del_viaje") && wish.trip) parts.push(t(lang, "Está en el destino de tu viaje.", "It's in your trip's destination."));
  if (r.some((x) => x.startsWith("dna:"))) parts.push(t(lang, "Encaja con tu Travel DNA (con tu permiso).", "Matches your Travel DNA (with your consent)."));
  if (r.includes("viaje:evento_en_tus_fechas")) parts.push(t(lang, "Hay un evento en tus fechas según la fuente.", "There's an event on your dates per the source."));
  if (!parts.length) parts.push(tier === "insider" ? t(lang, "Elegido por su carácter local.", "Chosen for its local character.")
    : tier === "unexpected" ? t(lang, "Elegido para salir de lo obvio.", "Chosen to step off the obvious path.") : t(lang, "Elegido por su calidad.", "Chosen for its quality."));
  return parts.join(" ");
}

function stepFrom(it: PlannedItem, c: KeyCandidate, order: number, tier: Tier, wish: Wish, party: number, lang: Lang): KeyStep {
  const cost = costFor(c, party, lang);
  const { confirmable, pending } = confirmablePending(c, it, cost, lang);
  const warnings = [...it.warnings.filter((x) => !/^Curado|^Dato práctico/.test(x))];
  return {
    order, day: it.day, date: it.date, start: it.start, end: it.end, start_iso: it.start_iso, time_status: it.time_status,
    time_text: it.time_status === "horario_por_confirmar" ? t(lang, `${it.start} sugerido · horario por confirmar`, `${it.start} suggested · hours to be confirmed`)
      : t(lang, `${it.start} · dentro del horario publicado`, `${it.start} · within published hours`),
    intent: it.intent, intent_label: intentLabel(it.intent, lang),
    experience: { id: c.id, slug: c.slug, name: c.name, universe: String(c.universe), subcategory: c.subcategory, state: String(c.state), label: c.label ?? null,
      neighborhood: c.neighborhood ?? null, why: c.why ?? null, website: c.website ?? null, booking_url: c.booking_url ?? null, booking_method: c.booking_method ?? null,
      verified_at: c.verified_at ?? null, destination: c.destination ?? null, image: c.image ?? null, lat: c.lat ?? null, lng: c.lng ?? null },
    transfer: it.transfer_before ? { minutes: it.transfer_before.minutes, label: "ESTIMADO",
      text: it.transfer_before.minutes != null ? t(lang, `≈ ${it.transfer_before.minutes} min (aprox., depende del tráfico)`, `≈ ${it.transfer_before.minutes} min (approx., traffic-dependent)`)
        : t(lang, "Traslado no calculado: falta la ubicación exacta", "Transfer not calculated: exact location missing") } : null,
    cost, reason: reasonFor(c, tier, wish, lang), confirmable, pending,
    requirements: [...it.requirements, ...wish.restrictions.filter((r) => r !== "sin_alcohol").map((r) => RESTRICTION_TEXT[r]?.[lang === "en" ? 1 : 0] ?? r)],
    warnings, alternatives: it.alternatives,
  };
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

function narrativeFor(p: Omit<KeyProposal, "narrative">, wish: Wish, lang: Lang): string {
  const first = p.steps[0];
  const seq = p.steps.map((s) => `${s.intent_label.toLowerCase()} en ${s.experience.name}`);
  const seqEn = p.steps.map((s) => `${s.intent_label.toLowerCase()} at ${s.experience.name}`);
  const occ = wish.occasion === "aniversario" ? t(lang, "para su aniversario", "for your anniversary") : wish.occasion === "propuesta" ? t(lang, "para ese momento", "for that moment")
    : wish.occasion === "cumpleanos" ? t(lang, "para el cumpleaños", "for the birthday") : "";
  if (!first) return "";
  return t(lang,
    `${p.title} · ${p.subtitle}${occ ? ` ${occ}` : ""}: ${seq.join(", después ")}. ${p.budget.text} Nada está reservado: abajo tienes qué se puede pedir y qué falta confirmar.`,
    `${p.title}${occ ? ` ${occ}` : ""}: ${seqEn.join(", then ")}. ${p.budget.text} Nothing is booked: below is what you can request and what still needs confirming.`);
}

export interface BuildOpts {
  lang?: Lang;
  todayISO: string;
  fx?: FxToMxn;
  hotel?: { name?: string | null; lat?: number | null; lng?: number | null } | null;
  /** Experiencias a excluir (Otra sorpresa). */
  exclude?: string[];
  seed?: string;
}

export const DISCLAIMERS = (lang: Lang) => [
  t(lang, "Son propuestas de Iato con el catálogo verificado de IATOS Privé: nada está reservado ni confirmado.", "These are Iato's proposals from the verified IATOS Privé catalogue: nothing is booked or confirmed."),
  t(lang, "Horarios y precios solo con fuente; lo demás está marcado por confirmar.", "Hours and prices only with a source; everything else is marked to be confirmed."),
  t(lang, "Traslados ESTIMADOS (línea recta, ciudad a ~20 km/h): el real depende del tráfico.", "Transfers are ESTIMATES (straight line, ~20 km/h in the city): real times depend on traffic."),
  t(lang, "No son acuerdos comerciales ni accesos VIP: son recomendaciones con fuente.", "They are not commercial deals or VIP access: they are sourced recommendations."),
];

function prefilter(cands: KeyCandidate[], wish: Wish, fx: FxToMxn, exclude: Set<string>): KeyCandidate[] {
  const party = wish.party ?? 2;
  const from = wish.date ?? "";
  const to = wish.date ? addDaysIso(wish.date, Math.max(0, wish.nights - 1)) : "";
  return cands.filter((c) => usableState(String(c.state)) && !exclude.has(c.id)
    // Un club solo para miembros no se propone: IATOS no puede dar ese acceso.
    && !(c.members_only_venue || /(^| )(members?|miembros|membresia)( |$)/.test(norm(String(c.subcategory ?? "").replace(/_/g, " "))))
    // Un evento con fechas solo entra si cae en las fechas del plan.
    && !(from && (c.event_start || c.event_end) && (String(c.event_end ?? c.event_start).slice(0, 10) < from || String(c.event_start ?? c.event_end).slice(0, 10) > to))
    && !(wish.restrictions.includes("sin_alcohol") && (c.universe === "casino_grand_nights" || (c.universe === "after_dark" && /bar|cocteler|cocktail|lounge|club/.test(text(c)))))
    && !(c.universe === "casino_grand_nights" && !wish.intents.includes("casino"))
    && !exceedsBudget(c, wish.budget, party, fx));
}

function buildTier(tier: Tier, pool: KeyCandidate[], wish: Wish, opts: BuildOpts, prevUniverses: Set<string>): KeyProposal | null {
  const lang = opts.lang ?? "es";
  const fx = opts.fx ?? DEFAULT_FX;
  const party = wish.party ?? 2;
  let intents = stepsFor(tier, wish, pool, prevUniverses);
  if (!intents.length) return null;
  const ceiling = levelCeiling(wish.budget, party, intents.length, fx);
  const byId = new Map(pool.map((c) => [c.id, c]));
  const run = (ints: IntentKey[]): PlanResult => planExperiences(pool, {
    dateFrom: wish.date ?? opts.todayISO, nights: wish.nights, partySize: party, intents: ints, template: null,
    hotel: opts.hotel ?? null, youngestAge: wish.minors ? 10 : null,
    timeZone: pool.find((c) => c.destination?.timezone)?.destination?.timezone ?? null,
    preference: tierPreference(tier, { seed: `${opts.seed ?? ""}|${tier}|${wish.text}`, avoidUniverses: prevUniverses, ceiling }) as (c: Candidate, i: IntentKey) => number,
  });
  let plan = run(intents);
  // Presupuesto: si lo conocido rebasa, se quita el paso opcional más caro y se vuelve a armar (máximo 2 veces).
  for (let tries = 0; tries < 2 && wish.budget; tries++) {
    const items = plan.days.flatMap((d) => d.items);
    const costs = items.map((it) => costFor(byId.get(it.experience!.id)!, party, lang));
    const sum = summarizeBudget(costs, wish.budget, wish.budgetOpen, lang, fx);
    if (sum.status !== "excede") break;
    const optional = items.map((it, i) => ({ it, c: costs[i] })).filter((x) => !wish.intents.includes(x.it.intent) && x.c.amount != null)
      .sort((a, b) => (convert(b.c.amount!, b.c.currency!, "MXN", fx) ?? 0) - (convert(a.c.amount!, a.c.currency!, "MXN", fx) ?? 0));
    if (!optional.length) break;
    intents = intents.filter((i, idx) => !(i === optional[0].it.intent && idx === intents.lastIndexOf(i)));
    plan = run(intents);
  }
  const items = plan.days.flatMap((d) => d.items).filter((it) => it.experience && byId.has(it.experience.id));
  if (!items.length) return null;
  const steps = items.map((it, i) => stepFrom(it, byId.get(it.experience!.id)!, i + 1, tier, wish, party, lang));
  const budget = summarizeBudget(steps.map((s) => s.cost), wish.budget, wish.budgetOpen, lang, fx);
  if (budget.status === "excede") return null;  // nunca se presenta un plan que ya sabemos que no cabe
  const meta = TIER_META[tier];
  const lastDay = plan.days.filter((d) => d.items.length).pop();
  const base: Omit<KeyProposal, "narrative"> = {
    tier, title: meta.title, subtitle: lang === "en" ? meta.en : meta.es, concept: lang === "en" ? meta.conceptEn : meta.conceptEs,
    steps, days: uniq(steps.map((s) => s.day)).length, universes: uniq(steps.map((s) => s.experience.universe)), budget,
    confirmable: uniq(steps.flatMap((s) => s.confirmable)), pending: uniq(steps.flatMap((s) => s.pending)),
    requirements: uniq(steps.flatMap((s) => s.requirements)),
    unplaced: plan.unplaced.filter((u) => wish.intents.includes(u.intent)).map((u) => ({ intent: u.intent, reason: lang === "en"
      ? `No verified option in the catalogue for "${intentLabel(u.intent, "en")}". Iato doesn't invent places.` : u.reason })),
    return_to_hotel: lastDay?.return_to_hotel ? { text: lastDay.return_to_hotel.text, label: "ESTIMADO" } : null,
    disclaimers: DISCLAIMERS(lang), status: "propuesta",
  };
  return { ...base, narrative: narrativeFor(base, wish, lang) };
}

/**
 * Hasta tres propuestas diferenciadas (sin experiencias compartidas). Si el deseo aún no tiene lo
 * mínimo, devuelve las preguntas que faltan y ninguna propuesta.
 */
export function buildKey(cands: KeyCandidate[], wish: Wish, opts: BuildOpts, extra: { tripCandidates?: TripCtx[] } = {}): KeyResult {
  const lang = opts.lang ?? "es";
  const questions = missingQuestions(wish, lang, extra);
  const base = { wish, questions, disclaimers: DISCLAIMERS(lang), candidates_considered: 0 };
  if (questions.length) return { ...base, status: "questions", proposals: [], note: null };
  const fx = opts.fx ?? DEFAULT_FX;
  const pool = prefilter(cands, wish, fx, new Set(opts.exclude ?? []));
  if (!pool.length) {
    return { ...base, status: "no_coverage", proposals: [], candidates_considered: 0,
      note: t(lang, `Todavía no hay experiencias verificadas de IATOS Privé que encajen en ${placeName(wish.place, lang) || "ese lugar"}${wish.budget ? " con ese presupuesto" : ""}. No te propongo lugares que no hayamos podido comprobar.`,
        `There are no verified IATOS Privé experiences yet that fit ${placeName(wish.place, lang) || "that place"}${wish.budget ? " within that budget" : ""}. I won't propose places we haven't been able to check.`) };
  }
  if (wish.mode === "surprise") {
    const s = buildSurprise(pool, wish, opts);
    return { ...base, status: s ? "proposals" : "no_coverage", proposals: s ? [s] : [], candidates_considered: pool.length,
      note: s ? null : t(lang, "No encontré una sorpresa verificada que encaje. Prueba otro lugar o ajusta el presupuesto.", "I couldn't find a verified surprise that fits. Try another place or adjust the budget.") };
  }
  const proposals: KeyProposal[] = [];
  const used = new Set<string>();
  const usedUniverses = new Set<string>();
  for (const tier of ["signature", "insider", "unexpected"] as Tier[]) {
    const p = buildTier(tier, pool.filter((c) => !used.has(c.id)), wish, opts, usedUniverses);
    if (!p) continue;
    // Diferenciación: la de criterio local no puede ser la misma secuencia de universos que la firma.
    if (proposals.some((q) => q.steps.map((s) => s.intent).join() === p.steps.map((s) => s.intent).join()
      && q.universes.join() === p.universes.join() && tier === "unexpected")) continue;
    proposals.push(p);
    p.steps.forEach((s) => { used.add(s.experience.id); usedUniverses.add(s.experience.universe); });
  }
  const note = proposals.length === 0
    ? t(lang, "Con lo verificado de este destino no pude armar una secuencia que cumpla lo que pides. No te invento opciones.", "With what's verified for this destination I couldn't build a sequence that meets your request. I won't invent options.")
    : proposals.length < 3 ? t(lang, `Con lo verificado hoy hay ${proposals.length === 1 ? "una propuesta" : "dos propuestas"} realmente distintas; no relleno con repeticiones.`,
      `With what's verified today there ${proposals.length === 1 ? "is one genuinely different proposal" : "are two genuinely different proposals"}; I don't pad with repeats.`) : null;
  return { ...base, status: proposals.length ? "proposals" : "no_coverage", proposals, note, candidates_considered: pool.length };
}

/** SURPRISE ME: una experiencia inesperada, adecuada y verificable. "Otra sorpresa" = exclude con las anteriores. */
export function buildSurprise(pool: KeyCandidate[], wish: Wish, opts: BuildOpts): KeyProposal | null {
  const lang = opts.lang ?? "es";
  const party = wish.party ?? 2;
  const night = wish.timeOfDay === "noche";
  const fit = pool.filter((c) => c.universe !== "private_stays" && (!night || !["sport_leisure", "adventure_elite"].includes(String(c.universe))));
  if (!fit.length) return null;
  const seed = `${opts.seed ?? opts.todayISO}|${wish.place?.slug ?? ""}|${(opts.exclude ?? []).length}`;
  const ceiling = levelCeiling(wish.budget, party, 1, opts.fx);
  const scored = fit.map((c) => ({ c, s: (UNEXPECTED_UNIVERSES.has(String(c.universe)) ? 60 : 0) + (c.state === "VERIFICADO" ? 20 : 0)
    + ((c.price_level ?? 0) > ceiling ? -500 : 0) + (hash(`${seed}|${c.id}`) % 50) }))
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name));
  const NIGHT_SLOTS = ["noche", "tarde_noche"];
  for (const { c } of scored.slice(0, 12)) {
    const matching = (Object.keys(INTENTS) as IntentKey[]).filter((i) => !INTENTS[i].derived && i !== "casino" && matchesIntent(c, i));
    // De noche, solo lo que de verdad es de noche (un museo a las 10:00 no es "esta noche").
    const intent = night ? matching.find((i) => NIGHT_SLOTS.includes(INTENTS[i].slot)) : matching[0];
    if (!intent) continue;
    const plan = planExperiences([c], { dateFrom: wish.date ?? opts.todayISO, nights: 1, partySize: party, intents: [intent], youngestAge: wish.minors ? 10 : null,
      timeZone: c.destination?.timezone ?? null });
    const it = plan.days[0].items[0];
    if (!it) continue;
    const step = stepFrom(it, c, 1, "unexpected", wish, party, lang);
    const budget = summarizeBudget([step.cost], wish.budget, wish.budgetOpen, lang, opts.fx ?? DEFAULT_FX);
    if (budget.status === "excede") continue;
    const base: Omit<KeyProposal, "narrative"> = {
      tier: "unexpected", title: "SURPRISE ME", subtitle: t(lang, "Sorpréndeme", "Surprise me"),
      concept: t(lang, "Una sola experiencia, inesperada pero adecuada, del catálogo verificado.", "One unexpected yet fitting experience from the verified catalogue."),
      steps: [step], days: 1, universes: [step.experience.universe], budget, confirmable: step.confirmable, pending: step.pending, requirements: step.requirements,
      unplaced: [], return_to_hotel: null, disclaimers: DISCLAIMERS(lang), status: "propuesta",
    };
    return { ...base, narrative: t(lang, `Sorpresa: ${c.name}. ${step.reason} ${budget.text} No está reservado.`, `Surprise: ${c.name}. ${step.reason} ${budget.text} It isn't booked.`) };
  }
  return null;
}

// ─────────────────────────────── Costo por plan (Doc B §17) ───────────────────────────────
/** Costo de generar un plan: este modo no llama a ningún modelo de IA ni a APIs de pago. */
export interface KeyCost { ai_calls: 0; ai_tokens: 0; paid_api_calls: 0; db_rpc_calls: number; cache: "hit" | "miss"; est_usd: number; ms: number }
/** Supabase Edge: 2 USD por millón de invocaciones fuera del plan; una RPC de Postgres no se cobra aparte. */
export const EDGE_USD_PER_INVOCATION = 2 / 1_000_000;
export const keyCost = (db_rpc_calls: number, cache: "hit" | "miss", ms: number): KeyCost =>
  ({ ai_calls: 0, ai_tokens: 0, paid_api_calls: 0, db_rpc_calls, cache, est_usd: EDGE_USD_PER_INVOCATION, ms });

/** Palabras que The Key nunca puede afirmar. Solo valen negadas ("nada está reservado", "ni accesos VIP"). */
const CLAIM = /\b(reservad[oa]s?|confirmad[oa]s?|garantizad[oa]s?|vip|booked|confirmed|guaranteed|acceso exclusivo|exclusive access|descuento|discount|disponible hoy|available now|mesa asegurada)\b/gi;
const NEGATED = /\b(nada|no|ni|nunca|aun no|todavia no|sin|nothing|not|isn t|aren t|never|nor|or)\b[^.;:]{0,45}?$/i;
export function findKeyClaims(text: string): string[] {
  const s = String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, " ");
  const out: string[] = [];
  for (const m of s.matchAll(CLAIM)) {
    const before = s.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
    if (!NEGATED.test(before)) out.push(m[0]);
  }
  return out;
}

/** Texto visible de un resultado, para auditar que no afirma reservas ni privilegios. */
export function visibleText(r: KeyResult): string {
  return [r.note ?? "", ...r.proposals.flatMap((p) => [p.title, p.subtitle, p.concept, p.narrative, p.budget.text, ...p.confirmable, ...p.pending,
    ...p.steps.flatMap((s) => [s.time_text, s.intent_label, s.cost.text, s.reason, s.transfer?.text ?? "", ...s.requirements, ...s.warnings])])].join("\n");
}
