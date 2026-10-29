// Perfil de gustos ("taste profile") — lo que a la persona le ha gustado DE VERDAD, en ≤ ~600 tokens.
//
// Lo usan Iato (concierge-chat), recomendar-destinos (Inicio y Descubrir), suggest-restaurants,
// analizar-viaje y evolucionar-dna, para que las sugerencias digan el porqué con datos reales
// ("Porque te encantó Mykonos…") y nunca con gustos inventados.
//
// Señales y peso (determinista; probado en src/test/tasteProfile.test.ts):
//   momento   10  foto que la persona eligió destacar en "Mejores momentos" (= "esto me encantó")
//   favorito   5  lugar o destino guardado como favorito
//   visitado   3  lugar marcado como visitado (Cercanos, visitas del viaje)
//   viaje      2  viaje pasado con evidencia de que sí se hizo (importado de un documento, gastos,
//                 momentos o visitas); 1.2 si solo fue cotizado y sus fechas ya pasaron
//   declarado  1  lo que dijo en el onboarding (estilo, intereses, comida)
//   diario     6  gusto o disgusto que la persona ESCRIBIÓ en su diario de viaje (aprender-diario lo
//                 extrae con la frase literal que lo respalda; ella puede corregirlo o borrarlo)
// Cada peso se multiplica por la antigüedad (1.0 este año → 0.6 a los 4+ años).
//
// Privacidad: solo entra lo de la persona (user_id === userId). Las filas de otro usuario se
// descartan aunque la consulta las devuelva (viajes compartidos, colaboradores, amigos).
// Lógica pura, sin Deno: corre igual en Vitest.

// v2: entra lo aprendido del diario (journal_learnings); la caché v1 se recalcula sola.
export const TASTE_VERSION = 2;
/** Tope del bloque de texto (tokens estimados con 3.6 caracteres por token, como el resto de IATOS). */
export const TASTE_MAX_TOKENS = 600;
export const CHARS_PER_TOKEN = 3.6;

export const WEIGHTS = { momento: 10, diario: 6, favorito: 5, visitado: 3, viaje: 2, declarado: 1 } as const;
/** Viaje pasado sin evidencia de que se hizo (solo cotizado): sigue pesando más que lo declarado. */
export const UNCONFIRMED_TRIP_WEIGHT = 1.2;
export type SignalKind = keyof typeof WEIGHTS;
type Dim = "destino" | "lugar" | "cocina" | "tema";

export type TasteInputs = {
  userId: string;
  todayISO: string;
  trips?: any[] | null;
  moments?: any[] | null;
  visitedPlaces?: any[] | null;
  userVisits?: any[] | null;
  savedRecos?: any[] | null;
  travelProfile?: any | null;
  aiPrefs?: any | null;
  expenses?: any[] | null;
  /** journal_learnings: lo que la IA aprendió de las entradas del diario que la persona escribió. */
  journalLearnings?: any[] | null;
};

/** Un punto aprendido del diario, listo para el prompt ("Te encantó la pasta cacio e pepe de Roscioli"). */
export type DiaryItem = { texto: string; lugar: string | null; ciudad: string | null; categoria: string };
/** Topes del perfil: lo más reciente primero. */
export const DIARY_MAX_LIKES = 8;
export const DIARY_MAX_DISLIKES = 6;

/** explicito = viene de una foto en Mejores momentos o de un favorito (lo que de verdad te encantó). */
export type TasteItem = { label: string; score: number; por_que: string; explicito?: boolean; solo_cotizado?: boolean };
export type PastTrip = {
  destino: string; fecha: string | null; noches: number | null; viajeros: number | null;
  hotel: string | null; precio_noche: number | null; gasto_real: string | null;
  fuente: "documento" | "iatos"; momentos: number; confirmado: boolean;
};

export type TasteProfile = {
  v: number;
  hash: string;
  computed_for: string;
  conteos: { momentos: number; viajes_pasados: number; viajes_importados: number; visitados: number; favoritos: number; diario?: number };
  encanta: TasteItem[];
  lugares: TasteItem[];
  cocinas: TasteItem[];
  temas: TasteItem[];
  viajes_pasados: PastTrip[];
  patrones: {
    noches_tipicas: number | null;
    acompanantes: string | null;
    hotel_clase: string | null;
    precio_noche_mediana: number | null;
    nivel_precio_restaurantes: string | null;
  };
  declarado: {
    ritmo: string | null; presupuesto: string | null; estilo: string[]; intereses: string[];
    comida: string[]; acompanantes: string | null; dna: string | null;
  };
  evitar: string[];
  /** Lo que escribiste en tu diario (v2). */
  diario?: { gustos: DiaryItem[]; disgustos: DiaryItem[] };
  ya_visitados: string[];
  proximos: string[];
  deseos: string[];
};

// ═══ utilidades ═══

/** Texto seguro y corto: sin controles, sin marcas de etiqueta/código, espacios colapsados. */
export function clean(value: unknown, max = 80): string {
  const s = String(value ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>{}`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export const normKey = (v: unknown) => String(v ?? "")
  .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Nombre de archivo de cámara o de app ("IMG_1234", "20250712_183011", "WhatsApp Image…"): no es un viaje. */
export function looksLikeFilename(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return true;
  if (/^(img|dsc|dscn|dsc_|pxl|dcim|mvimg|vid|photo|foto|image|imagen|screenshot|captura|whatsapp|signal|telegram|snapchat|pic|picture)[\s_\-.(]*\d/i.test(s)) return true;
  if (/^whatsapp image/i.test(s)) return true;
  if (/^[\d_\-.\s()]{6,}$/.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return true;
  if (/^[a-z0-9_-]{16,}$/i.test(s) && /\d/.test(s)) return true;
  return false;
}

/**
 * "Hoy" del perfil de gustos: la fecha de la Ciudad de México para TODAS las funciones, así la
 * caché no se recalcula de ida y vuelta entre funciones que usan UTC y la zona del usuario.
 */
export function tasteToday(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const isoDay = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v.slice(0, 10) : null);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = Math.round((dayMs(b) - dayMs(a)) / 86400000);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** 1.0 si es de este año; baja 0.1 por año hasta 0.6. Sin fecha o en el futuro = 1. */
export function recency(at: unknown, todayISO: string): number {
  const d = isoDay(at);
  if (!d) return 1;
  const years = (dayMs(todayISO) - dayMs(d)) / (365.25 * 86400000);
  if (!Number.isFinite(years) || years <= 1) return 1;
  return Math.max(0.6, Math.round((1 - 0.1 * (years - 1)) * 100) / 100);
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthYear = (iso: string | null) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`.trim() : null);

export function money(n: number | null | undefined, currency = "MXN"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const r = Math.round(n / 100) * 100;
  return `$${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${currency}`;
}

const median = (xs: number[]): number | null => {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown, max = 8): string[] => {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []) {
    const s = clean(typeof x === "string" ? x : (x?.label ?? x?.nombre ?? x?.name ?? ""), 40);
    if (s && !out.some((o) => normKey(o) === normKey(s))) out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

/** FNV-1a 32 bits: estable entre Deno y Node, suficiente para saber si el perfil cambió. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ═══ viajes ═══

const IMPORT_SOURCES = new Set(["documento", "document", "import", "importado", "pdf", "archivo", "email", "correo", "upload"]);

/** Viaje importado de un documento (otro grupo agrega trips.source = 'documento'); también PDFs viejos. */
export function isImportedTrip(trip: any): boolean {
  const src = normKey(trip?.source ?? trip?.origen_datos ?? trip?.import_source ?? trip?.fuente ?? "");
  if (src && IMPORT_SOURCES.has(src)) return true;
  if (/importad|completad|realizad/.test(normKey(trip?.status))) return true;
  return [...arr(trip?.vuelos_json), ...arr(trip?.hospedaje_json)].some((x) => x?.desde_pdf === true);
}

const isCancelled = (trip: any) => /cancel/.test(normKey(trip?.status));

/** Ciudades del destino ("Madrid → París", "Mykonos, Grecia"): la ciudad, sin el país. */
export function tripPlaces(trip: any): string[] {
  const out: string[] = [];
  for (const part of String(trip?.destino ?? "").split(/→|;|\/|\s-\s|\s\+\s|\sy\s/)) {
    const city = clean(part.split(",")[0], 40);
    if (city && city.length > 1 && !out.some((o) => normKey(o) === normKey(city))) out.push(city);
  }
  return out.slice(0, 4);
}

/** Hotel que la persona eligió (selección guardada, el único que hay o el del documento). Cotizar 3 no es elegir. */
function chosenHotel(trip: any): any | null {
  const list = arr(trip?.hospedaje_json).filter((h) => h && typeof h === "object");
  if (!list.length) return null;
  const i = trip?.selections?.hospedaje?.i;
  if (typeof i === "number" && i >= 0 && list[i]) return list[i];
  if (list.length === 1) return list[0];
  return list.find((h) => h?.desde_pdf === true) ?? null;
}

/** Clase de hotel a partir del tipo o de lo que costó la noche (MXN). */
export function hotelClass(tipo: unknown, nightlyMxn: number | null): string | null {
  const t = normKey(tipo);
  if (/lujo|luxury|5 estrellas|cinco estrellas|5\*|gran turismo|resort de lujo/.test(t)) return "lujo";
  if (/boutique/.test(t)) return "boutique";
  if (/hostal|hostel|albergue/.test(t)) return "económico";
  if (nightlyMxn === null) return t ? clean(tipo, 24) : null;
  if (nightlyMxn >= 8000) return "lujo";
  if (nightlyMxn >= 4000) return "superior";
  if (nightlyMxn >= 1500) return "medio";
  return "económico";
}

function companionsLabel(n: number | null): string | null {
  if (!n || n < 1) return null;
  if (n === 1) return "solo";
  if (n === 2) return "en pareja o en dos";
  return `en grupo (${n})`;
}

// ═══ agregación ═══

type Bucket = {
  dim: Dim; label: string; labelWeight: number; score: number;
  fotos: number; captions: string[]; deFoto: boolean; favoritos: number; visitas: number; diario: number;
  viajes: string[]; cotizados: string[]; declarado: boolean;
};

class Ledger {
  private map = new Map<string, Bucket>();
  add(dim: Dim, rawLabel: unknown, kind: SignalKind, weight: number, extra: { caption?: string; when?: string | null; fromPhoto?: boolean; quoted?: boolean } = {}) {
    const label = clean(rawLabel, 48);
    const key = normKey(label);
    if (!key || key.length < 2) return;
    const id = `${dim}:${key}`;
    const b = this.map.get(id) ?? {
      dim, label, labelWeight: 0, score: 0, fotos: 0, captions: [], deFoto: false, favoritos: 0, visitas: 0, diario: 0, viajes: [], cotizados: [], declarado: false,
    };
    b.score += weight;
    if (weight > b.labelWeight) { b.label = label; b.labelWeight = weight; }
    if (kind === "momento") {
      b.fotos++;
      if (extra.fromPhoto) b.deFoto = true;
      if (extra.caption && b.captions.length < 2 && !b.captions.includes(extra.caption)) b.captions.push(extra.caption);
    }
    if (kind === "favorito") b.favoritos++;
    if (kind === "visitado") b.visitas++;
    if (kind === "diario") b.diario++;
    if (kind === "viaje" && extra.when) {
      const list = extra.quoted ? b.cotizados : b.viajes;
      if (!list.includes(extra.when)) list.push(extra.when);
    }
    if (kind === "declarado") b.declarado = true;
    this.map.set(id, b);
  }
  top(dim: Dim, n: number, exclude: Set<string>): Bucket[] {
    return [...this.map.values()]
      .filter((b) => b.dim === dim && !isExcluded(b.label, exclude))
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, n);
  }
}

function isExcluded(label: string, exclude: Set<string>): boolean {
  const k = normKey(label);
  for (const e of exclude) {
    if (!e) continue;
    if (k === e || cuisineStemMatch(e, k)) return true;
  }
  return false;
}

/** Raíz de una cocina o tema ("japonesa" → "japon") para comparar "Restaurante japonés" con "japonesa". */
export function stemOf(label: unknown): string {
  const k = normKey(label).split(" ").filter((w) => w.length > 2 && !["restaurante", "cocina", "comida", "de", "del"].includes(w))[0] ?? "";
  return k.length <= 3 ? k : k.slice(0, Math.min(5, k.length - 1));
}

export function cuisineStemMatch(a: unknown, b: unknown): boolean {
  const sa = stemOf(a);
  if (!sa || sa.length < 3) return false;
  return new RegExp(`(^|\\s)${sa}`).test(normKey(b));
}

function phrase(b: Bucket): string {
  const parts: string[] = [];
  if (b.fotos) {
    const fotos = `${b.fotos} ${b.fotos === 1 ? "foto" : "fotos"} en Mejores momentos`;
    parts.push(b.deFoto && b.fotos === 1 && !b.viajes.length ? `${fotos} (lugar reconocido en la foto)` : fotos);
    if (b.captions[0]) parts.push(`«${clean(b.captions[0], 60)}»`);
  }
  if (b.diario) parts.push(b.diario === 1 ? "lo contaste en tu diario" : `${b.diario} veces en tu diario`);
  if (b.favoritos) parts.push(b.favoritos === 1 ? "lo guardaste en favoritos" : `${b.favoritos} favoritos`);
  if (b.viajes.length) parts.push(b.viajes.length === 1 ? `viajaste ${b.viajes[0]}` : `${b.viajes.length} viajes (${b.viajes.slice(0, 2).join(", ")})`);
  if (b.cotizados.length && !b.viajes.length) parts.push(`lo cotizaste para ${b.cotizados[0]}`);
  if (b.visitas) parts.push(b.visitas === 1 ? "lo visitaste" : `${b.visitas} visitas`);
  if (!parts.length && b.declarado) parts.push("lo dijiste en tu perfil");
  return parts.join("; ");
}

/**
 * Un viaje solo cotizado que ya pasó, sin fotos, gastos, visitas ni nada más (no hay evidencia de que se
 * hizo): pesa poco y NUNCA es algo que «te encantó» (R2: Descubre decía «Porque te encantó Budapest», un
 * viaje creado por accidente).
 */
const onlyQuoted = (b: Bucket) => b.cotizados.length > 0 && !b.viajes.length && !b.fotos && !b.favoritos && !b.diario && !b.visitas && !b.declarado;

const item = (b: Bucket): TasteItem => ({
  label: b.label, score: Math.round(b.score * 10) / 10, por_que: phrase(b), ...(b.fotos || b.favoritos || b.diario ? { explicito: true } : {}),
  ...(onlyQuoted(b) ? { solo_cotizado: true } : {}),
});

/** Lo que se puede citar como «te encantó» / «te gustó»: todo menos lo que solo se cotizó. */
export const lovedLabels = (p: { encanta?: TasteItem[]; lugares?: TasteItem[] } | null | undefined): string[] =>
  [...(p?.encanta ?? []), ...(p?.lugares ?? [])]
    // `por_que` también lo delata en un perfil guardado antes de la marca (la caché se recalcula a diario).
    .filter((x) => !x.solo_cotizado && !/^lo cotizaste para /.test(x.por_que ?? ""))
    .map((x) => x.label);

// ═══ construcción ═══

export function buildTasteProfile(input: TasteInputs): TasteProfile {
  const { userId, todayISO } = input;
  const own = (rows: any[] | null | undefined) => arr(rows).filter((r) => r && typeof r === "object" && r.user_id === userId);
  const trips = own(input.trips).filter((t) => !isCancelled(t));
  const moments = own(input.moments);
  const visited = own(input.visitedPlaces);
  const visits = own(input.userVisits);
  const saved = own(input.savedRecos);
  const expenses = own(input.expenses);
  const learnings = own(input.journalLearnings);
  const tp = input.travelProfile && input.travelProfile.user_id === userId ? input.travelProfile : null;
  const ai = input.aiPrefs && input.aiPrefs.user_id === userId ? input.aiPrefs : null;
  const dna = ai?.perfil_ia ?? tp?.perfil_ia ?? null;

  const ledger = new Ledger();
  const tripById = new Map(trips.map((t) => [t.id, t]));

  // Evidencia de que un viaje sí se hizo.
  const momentsByTrip = new Map<string, number>();
  for (const m of moments) if (m.trip_id) momentsByTrip.set(m.trip_id, (momentsByTrip.get(m.trip_id) ?? 0) + 1);
  const visitTrips = new Set(visits.map((v) => v.trip_id).filter(Boolean));
  const spend = new Map<string, Map<string, number>>();
  for (const e of expenses) {
    const amount = Number(e.amount);
    if (!e.trip_id || !Number.isFinite(amount) || amount <= 0) continue;
    const cur = clean(e.currency || "MXN", 4).toUpperCase();
    const byCur = spend.get(e.trip_id) ?? new Map<string, number>();
    byCur.set(cur, (byCur.get(cur) ?? 0) + amount);
    spend.set(e.trip_id, byCur);
  }

  // ── Viajes pasados (completados e importados) ──
  const past: Array<PastTrip & { _end: string; _rank: number }> = [];
  const upcoming: string[] = [];
  const nights: number[] = [];
  const travelers: number[] = [];
  const nightly: number[] = [];
  const hotelTypes: string[] = [];
  for (const t of trips) {
    const start = isoDay(t.fecha_salida);
    const end = isoDay(t.fecha_regreso) ?? start;
    if (!end) continue;
    const places = tripPlaces(t);
    if (!places.length) continue;
    if (end >= todayISO) { upcoming.push(places[0]); continue; }
    const imported = isImportedTrip(t);
    const nMoments = momentsByTrip.get(t.id) ?? 0;
    const confirmed = imported || nMoments > 0 || spend.has(t.id) || visitTrips.has(t.id);
    const w = (confirmed ? WEIGHTS.viaje : UNCONFIRMED_TRIP_WEIGHT) * recency(end, todayISO);
    const when = monthYear(start ?? end);
    places.forEach((p, i) => ledger.add("destino", p, "viaje", i === 0 ? w : w * 0.7, { when, quoted: !confirmed }));
    const n = daysBetween(start, end);
    if (confirmed && n) nights.push(n);
    const pax = Number(t.num_viajeros);
    if (confirmed && Number.isFinite(pax) && pax > 0) travelers.push(pax);
    const h = chosenHotel(t);
    const price = Number(h?.precio_por_noche);
    const priceOk = Number.isFinite(price) && price > 0 ? price : null;
    if (confirmed && priceOk) nightly.push(priceOk);
    if (confirmed && h?.tipo) hotelTypes.push(String(h.tipo));
    const byCur = spend.get(t.id);
    let gasto: string | null = null;
    if (byCur) {
      const [cur, total] = [...byCur.entries()].sort((a, b) => b[1] - a[1])[0];
      gasto = money(total, cur);
    }
    past.push({
      destino: clean(places.join(" → ") + (t.pais_destino && !normKey(t.destino).includes(normKey(t.pais_destino)) ? `, ${t.pais_destino}` : ""), 60),
      fecha: start ? start.slice(0, 7) : end.slice(0, 7),
      noches: n, viajeros: Number.isFinite(pax) && pax > 0 ? pax : null,
      hotel: h ? clean([h.nombre, h.tipo && !normKey(h.nombre).includes(normKey(h.tipo)) ? `(${h.tipo})` : ""].filter(Boolean).join(" "), 50) || null : null,
      precio_noche: priceOk, gasto_real: gasto, fuente: imported ? "documento" : "iatos", momentos: nMoments, confirmado: confirmed,
      _end: end, _rank: nMoments * 10 + (confirmed ? 5 : 0),
    });
  }

  // ── Mejores momentos (el peso más alto) ──
  for (const m of moments) {
    const trip = m.trip_id ? tripById.get(m.trip_id) : null;
    const w = WEIGHTS.momento * recency(isoDay(trip?.fecha_regreso) ?? isoDay(m.taken_at) ?? isoDay(m.created_at), todayISO);
    const caption = clean(m.caption, 90);
    const vision = m.ai_tags && typeof m.ai_tags === "object" ? m.ai_tags : null;
    const typed = clean(m.destino, 48) || (trip ? tripPlaces(trip)[0] : "") || (!looksLikeFilename(m.trip_name) ? clean(m.trip_name, 48) : "");
    const seen = vision && Number(vision.confianza_lugar) >= 0.75 ? clean(vision.lugar_reconocible, 48) : "";
    if (typed) ledger.add("destino", typed, "momento", w, { caption });
    else if (seen) ledger.add("destino", seen, "momento", w * 0.5, { caption, fromPhoto: true });
    if (m.place_name) ledger.add("lugar", m.place_name, "momento", w, { caption });
    const tags = [...arr(m.tags), ...arr(vision?.tags)].map((x) => clean(x, 24)).filter(Boolean);
    const uniq = [...new Set(tags.map(normKey))].slice(0, 6);
    for (const tag of uniq) ledger.add("tema", tag, "momento", w * 0.5, { caption });
  }

  // ── Favoritos y visitados ──
  let favCount = 0;
  let visitCount = 0;
  const priceLevels: Record<string, number> = {};
  const dislikes: string[] = [];
  for (const v of visited) {
    const status = normKey(v.status || "visited");
    const kind: SignalKind = /favorit|love|encant/.test(status) ? "favorito"
      : /wish|want|quiero|pendiente|guardad|saved/.test(status) ? "declarado" : "visitado";
    const notes = normKey(v.notes);
    if (/no me gusto|no volveria|no lo recomiendo|decepcion|terrible|pesimo|malisimo/.test(notes)) {
      if (v.name) dislikes.push(clean(v.name, 40));
      continue;
    }
    const w = WEIGHTS[kind] * recency(v.visited_at, todayISO);
    if (kind === "favorito") favCount++;
    if (kind === "visitado") visitCount++;
    if (v.cuisine) ledger.add("cocina", v.cuisine, kind, w);
    if (v.name && kind !== "visitado") ledger.add("lugar", v.name, kind, w);
    else if (v.name && notes) ledger.add("lugar", v.name, kind, w);
    if (kind !== "declarado" && v.price_level) priceLevels[String(v.price_level)] = (priceLevels[String(v.price_level)] ?? 0) + 1;
  }
  for (const v of visits) {
    const w = WEIGHTS.visitado * recency(v.visited_at, todayISO);
    visitCount++;
    if (v.category) ledger.add("tema", v.category, "visitado", w * 0.5);
    if (v.place_name) ledger.add("lugar", v.place_name, "visitado", w * 0.6);
  }
  for (const r of saved) {
    const w = WEIGHTS.favorito * recency(r.created_at, todayISO);
    favCount++;
    const isDest = /destin/.test(normKey(r.tipo)) || !r.tipo;
    ledger.add(isDest ? "destino" : "lugar", r.titulo, "favorito", w);
  }

  // ── Diario: lo que la persona escribió que le gustó o no (más reciente primero) ──
  const diario = { gustos: [] as DiaryItem[], disgustos: [] as DiaryItem[] };
  const byDate = [...learnings].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  for (const l of byDate) {
    const texto = clean(l.texto, 100);
    if (texto.length < 3) continue;
    const neg = l.sentimiento === "negativo";
    const list = neg ? diario.disgustos : diario.gustos;
    if (list.some((x) => normKey(x.texto) === normKey(texto))) continue;
    if (list.length >= (neg ? DIARY_MAX_DISLIKES : DIARY_MAX_LIKES)) continue;
    const lugar = clean(l.lugar, 48) || null;
    list.push({ texto, lugar, ciudad: clean(l.ciudad, 40) || null, categoria: clean(l.categoria, 20) || "otro" });
    // Un lugar que te gustó (lo dijiste tú) cuenta en "Lugares que te gustaron".
    if (!neg && lugar) ledger.add("lugar", lugar, "diario", WEIGHTS.diario * recency(l.created_at, todayISO));
  }

  // ── Declarado (onboarding) ──
  const declared = {
    ritmo: clean(tp?.ritmo_viaje ?? ai?.ritmo_viaje, 30) || null,
    presupuesto: clean(tp?.presupuesto_rango ?? ai?.nivel_presupuesto, 30) || null,
    estilo: strs(tp?.estilo_viaje, 4),
    intereses: strs(tp?.intereses ?? ai?.actividades_tarde, 6),
    comida: strs(tp?.preferencias_comida ?? ai?.estilo_comida, 5),
    acompanantes: clean(tp?.acompanantes_tipico ?? ai?.companeros_viaje, 30) || null,
    dna: clean(dna?.estilo_dominante, 60) || null,
  };
  for (const s of [...declared.estilo, ...declared.intereses]) ledger.add("tema", s, "declarado", WEIGHTS.declarado);
  for (const c of declared.comida) ledger.add("cocina", c, "declarado", WEIGHTS.declarado);
  const declaredVisited = strs(tp?.destinos_visitados, 20);
  for (const d of declaredVisited) ledger.add("destino", d, "declarado", WEIGHTS.declarado * 0.5);

  // ── Lo que hay que evitar (explícito) ──
  const evitar = strs([
    ...arr(ai?.deal_breakers), ...arr(tp?.alergias_restricciones), ...arr(ai?.restricciones_alimentarias),
    ...arr(dna?.evitar), ...dislikes,
  ], 8);
  const exclude = new Set(evitar.map(normKey));

  const encanta = ledger.top("destino", 5, exclude).map(item);
  const lugares = ledger.top("lugar", 5, exclude).map(item);
  const cocinas = ledger.top("cocina", 5, exclude).map(item);
  const temas = ledger.top("tema", 6, exclude).map(item);

  const viajesPasados = past
    .sort((a, b) => b._rank - a._rank || b._end.localeCompare(a._end))
    .slice(0, 6)
    .map(({ _end: _e, _rank: _r, ...rest }) => rest);

  const topPrice = Object.entries(priceLevels).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const nightlyMedian = median(nightly);
  const yaVisitados = strs([...past.flatMap((p) => p.destino.split(",")[0].split(" → ")), ...declaredVisited], 20);

  const body = {
    conteos: {
      momentos: moments.length, viajes_pasados: past.length, viajes_importados: past.filter((p) => p.fuente === "documento").length,
      visitados: visitCount, favoritos: favCount, diario: diario.gustos.length + diario.disgustos.length,
    },
    encanta, lugares, cocinas, temas, viajes_pasados: viajesPasados,
    patrones: {
      noches_tipicas: median(nights) !== null ? Math.round(median(nights)!) : null,
      acompanantes: companionsLabel(median(travelers) !== null ? Math.round(median(travelers)!) : null),
      hotel_clase: hotelClass(hotelTypes.find((x) => /lujo|boutique|estrellas|hostal|hostel/.test(normKey(x))) ?? null, nightlyMedian),
      precio_noche_mediana: nightlyMedian !== null ? Math.round(nightlyMedian) : null,
      nivel_precio_restaurantes: topPrice ? priceLabel(topPrice) : null,
    },
    declarado: declared,
    evitar,
    diario,
    ya_visitados: yaVisitados,
    proximos: strs(upcoming, 5),
    deseos: strs(tp?.destinos_pendientes, 5),
  };
  return { v: TASTE_VERSION, hash: profileHash(body), computed_for: todayISO, ...body };
}

function priceLabel(level: string): string {
  const k = normKey(level);
  if (/very expensive|very_expensive|4/.test(k)) return "muy alto ($$$$)";
  if (/expensive|3/.test(k)) return "alto ($$$)";
  if (/moderate|2/.test(k)) return "medio ($$)";
  if (/inexpensive|1|free/.test(k)) return "económico ($)";
  return clean(level, 20);
}

/** Huella del contenido (sin puntajes): cambia cuando cambia lo que la IA debe saber. */
export function profileHash(p: Omit<TasteProfile, "v" | "hash" | "computed_for">): string {
  return fnv1a(JSON.stringify([
    p.encanta.map((x) => x.label), p.lugares.map((x) => x.label), p.cocinas.map((x) => x.label), p.temas.map((x) => x.label),
    p.viajes_pasados.map((x) => [x.destino, x.fecha, x.fuente, x.momentos]), p.patrones, p.declarado, p.evitar, p.ya_visitados,
    p.proximos, p.conteos.momentos, TASTE_VERSION,
    p.diario ? [p.diario.gustos.map((x) => [x.texto, x.lugar, x.ciudad]), p.diario.disgustos.map((x) => [x.texto, x.lugar, x.ciudad])] : null,
  ]));
}

// ═══ texto para el prompt ═══

export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

export const TASTE_CITATION_RULE =
  "Personalización: usa los gustos demostrados (Mejores momentos > favoritos > visitados > viajes pasados > lo declarado) para elegir y ordenar. " +
  "Cuando una sugerencia se apoye en ellos, dilo en media frase y en segunda persona (\"Porque te encantó Mykonos…\", \"Como en tu viaje a Kioto…\"). " +
  "\"Te encantó\" solo para lo que esté en la línea \"Te encantó\" (fotos destacadas y favoritos); para un viaje pasado di \"Como en tu viaje a…\". " +
  "Lo de \"De tu diario\" lo escribió la persona: cítalo como \"Como escribiste en tu diario…\" y respeta lo que no le gustó. " +
  "Cita solo gustos que aparezcan en esos datos; si no hay uno que aplique, no inventes un porqué personal.";

export type RenderOptions = { maxTokens?: number; omitDeclared?: boolean; includeRule?: boolean; includeVisited?: boolean };

export function hasTasteSignals(p: TasteProfile | null | undefined): boolean {
  if (!p) return false;
  return p.encanta.length + p.lugares.length + p.cocinas.length + p.temas.length + p.viajes_pasados.length + p.evitar.length
    + (p.diario?.gustos.length ?? 0) + (p.diario?.disgustos.length ?? 0) > 0;
}

/**
 * Texto compacto (≤ maxTokens) para cualquier prompt. Si no cabe, recorta primero lo de menor
 * prioridad (ya visitados, deseos, temas, lugares, cocinas, viajes) y al final los "te encantó".
 */
export function renderTasteProfile(p: TasteProfile | null | undefined, opts: RenderOptions = {}): string {
  if (!p || !hasTasteSignals(p) && !(p.declarado.estilo.length || p.declarado.ritmo || p.declarado.presupuesto)) return "";
  const max = Math.min(opts.maxTokens ?? TASTE_MAX_TOKENS, TASTE_MAX_TOKENS);
  const work = {
    encanta: [...p.encanta], viajes: [...p.viajes_pasados], cocinas: [...p.cocinas], lugares: [...p.lugares],
    temas: [...p.temas], deseos: [...p.deseos], visitados: opts.includeVisited === false ? [] : [...p.ya_visitados],
    proximos: opts.includeVisited === false ? [] : [...p.proximos], evitar: [...p.evitar],
    diarioSi: [...(p.diario?.gustos ?? [])], diarioNo: [...(p.diario?.disgustos ?? [])],
  };
  const render = () => renderLines(p, work, opts).join("\n");
  let text = render();
  const trimOrder: Array<[keyof typeof work, number]> = [
    ["visitados", 4], ["deseos", 0], ["proximos", 2], ["temas", 3], ["lugares", 2], ["cocinas", 2], ["viajes", 2], ["diarioSi", 4], ["diarioNo", 3],
    ["visitados", 0], ["proximos", 0], ["temas", 0], ["lugares", 0], ["cocinas", 1], ["viajes", 1], ["diarioSi", 2], ["diarioNo", 2], ["evitar", 3], ["encanta", 2], ["viajes", 0],
    ["diarioSi", 1], ["diarioNo", 1], ["encanta", 1],
  ];
  for (const [key, keep] of trimOrder) {
    while (estimateTokens(text) > max && work[key].length > keep) {
      work[key].pop();
      text = render();
    }
  }
  if (estimateTokens(text) > max) text = `${text.slice(0, Math.floor(max * CHARS_PER_TOKEN) - 1)}…`;
  return text;
}

function renderLines(p: TasteProfile, w: {
  encanta: TasteItem[]; viajes: PastTrip[]; cocinas: TasteItem[]; lugares: TasteItem[]; temas: TasteItem[];
  deseos: string[]; visitados: string[]; proximos: string[]; evitar: string[]; diarioSi: DiaryItem[]; diarioNo: DiaryItem[];
}, opts: RenderOptions): string[] {
  const lines: string[] = [];
  const c = p.conteos;
  lines.push(`Señales: ${c.momentos} momentos destacados, ${c.viajes_pasados} viajes pasados (${c.viajes_importados} importado${c.viajes_importados === 1 ? "" : "s"}), ${c.favoritos} favoritos, ${c.visitados} visitas.`);
  const fmt = (x: TasteItem) => `${x.label}${x.por_que ? ` (${x.por_que})` : ""}`;
  const loved = w.encanta.filter((x) => x.explicito);
  const more = w.encanta.filter((x) => !x.explicito);
  // "Te encantó" solo con evidencia explícita (foto destacada o favorito); lo demás es "también".
  if (loved.length) lines.push(`Te encantó: ${loved.map(fmt).join(" · ")}`);
  if (more.length) lines.push(`${loved.length ? "También" : "Destinos con más peso"}: ${more.map(fmt).join(" · ")}`);
  const diaryFmt = (x: DiaryItem) => `${x.texto}${x.ciudad && !normKey(x.texto).includes(normKey(x.ciudad)) ? ` (${x.ciudad})` : ""}`;
  if (w.diarioSi.length) lines.push(`De tu diario (lo escribiste tú): ${w.diarioSi.map(diaryFmt).join(" · ")}`);
  if (w.diarioNo.length) lines.push(`No te gustó (de tu diario): ${w.diarioNo.map(diaryFmt).join(" · ")}`);
  if (w.viajes.length) {
    lines.push(`Viajes pasados: ${w.viajes.map((t) => {
      const bits = [monthYear(t.fecha ? `${t.fecha}-01` : null), t.noches ? `${t.noches} noches` : "", companionsLabel(t.viajeros) ?? "",
        t.hotel ? `hotel ${t.hotel}` : "", t.precio_noche ? `${money(t.precio_noche)}/noche` : "", t.gasto_real ? `gastaste ${t.gasto_real}` : "",
        t.fuente === "documento" ? "importado de tu documento" : t.confirmado ? "" : "solo cotizado"].filter(Boolean);
      return `${t.destino}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    }).join(" · ")}`);
  }
  const pat = p.patrones;
  const patBits = [pat.noches_tipicas ? `~${pat.noches_tipicas} noches` : "", pat.acompanantes ?? "",
    pat.hotel_clase ? `hotel ${pat.hotel_clase}${pat.precio_noche_mediana ? ` (mediana ${money(pat.precio_noche_mediana)}/noche)` : ""}` : "",
    pat.nivel_precio_restaurantes ? `restaurantes de precio ${pat.nivel_precio_restaurantes}` : ""].filter(Boolean);
  if (patBits.length) lines.push(`Cómo viajas de verdad: ${patBits.join(" · ")}.`);
  if (w.cocinas.length) lines.push(`Cocinas: ${w.cocinas.map((x) => `${x.label}${x.por_que ? ` (${x.por_que})` : ""}`).join(" · ")}`);
  if (w.lugares.length) lines.push(`Lugares que te gustaron: ${w.lugares.map((x) => `${x.label}${x.por_que ? ` (${x.por_que})` : ""}`).join(" · ")}`);
  if (w.temas.length) lines.push(`Temas: ${w.temas.map((x) => x.label).join(", ")}.`);
  if (!opts.omitDeclared) {
    const d = p.declarado;
    const bits = [d.ritmo ? `ritmo ${d.ritmo}` : "", d.presupuesto ? `presupuesto ${d.presupuesto}` : "", d.estilo.length ? `estilo ${d.estilo.join(", ")}` : "",
      d.intereses.length ? `intereses ${d.intereses.join(", ")}` : "", d.comida.length ? `comida ${d.comida.join(", ")}` : "",
      d.acompanantes ? `suele viajar ${d.acompanantes}` : "", d.dna ? `Travel DNA: ${d.dna}` : ""].filter(Boolean);
    if (bits.length) lines.push(`Lo que dijiste en tu perfil (pesa menos que lo demostrado): ${bits.join(" · ")}.`);
  }
  if (w.evitar.length) lines.push(`Evitar: ${w.evitar.join(", ")}.`);
  if (w.deseos.length) lines.push(`Quieres conocer: ${w.deseos.join(", ")}.`);
  if (w.visitados.length) lines.push(`Ya conoces: ${w.visitados.join(", ")}.`);
  if (w.proximos.length) lines.push(`Ya planeados: ${w.proximos.join(", ")}.`);
  if (opts.includeRule) lines.push(TASTE_CITATION_RULE);
  return lines;
}

// ═══ restaurantes: orden y porqué personal (sin IA) ═══

const RESTRICTION_QUERY: Array<[RegExp, string]> = [
  [/vegan/, "veganos"], [/vegetarian/, "vegetarianos"], [/gluten|celiac/, "sin gluten"], [/kosher/, "kosher"], [/halal/, "halal"],
];

/** Restricción alimentaria que debe ir en la búsqueda (un vegano no quiere una lista de asadores). */
export function restaurantQueryPreference(p: TasteProfile | null | undefined): string | null {
  if (!p) return null;
  const all = normKey(p.evitar.join(" ") + " " + p.declarado.comida.join(" "));
  for (const [re, q] of RESTRICTION_QUERY) if (re.test(all)) return q;
  return null;
}

/**
 * Reordena restaurantes reales (Google) según las cocinas que la persona elige de verdad y les pone
 * un porqué personal. Nunca agrega restaurantes ni cambia sus datos: solo orden y "por_que".
 */
export function personalizeRestaurants<T extends Record<string, unknown>>(list: T[], p: TasteProfile | null | undefined): T[] {
  if (!p || !Array.isArray(list) || !list.length) return list;
  const loved = p.cocinas.filter((c) => c.score >= WEIGHTS.visitado || c.por_que.includes("foto"));
  const declaredOnly = p.cocinas.filter((c) => !loved.includes(c));
  const scored = list.map((r, i) => {
    const text = `${r.cocina ?? ""} ${r.nombre ?? ""}`;
    const hit = loved.find((c) => cuisineStemMatch(c.label, text));
    const soft = hit ? null : declaredOnly.find((c) => cuisineStemMatch(c.label, text));
    const avoid = p.evitar.some((e) => cuisineStemMatch(e, text));
    const score = (hit ? 3 : 0) + (soft ? 1 : 0) - (avoid ? 5 : 0);
    let out: T = r;
    if (hit || soft) {
      const c = (hit ?? soft)!;
      const why = hit
        ? `Para ti: te gusta la cocina ${c.label.toLowerCase()}${c.por_que ? ` (${c.por_que})` : ""}.`
        : `Para ti: dijiste que te gusta la cocina ${c.label.toLowerCase()}.`;
      out = { ...r, para_ti: why, por_que: `${why} ${String(r.por_que ?? "")}`.trim() };
    }
    return { r: out, score, i };
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.r);
}

/**
 * Quita de una razón de la IA «Porque te encantó X…» cuando X no está en lo que de verdad le gustó a la
 * persona (`loved`, normalmente perfil.encanta): la IA no puede afirmar un gusto sin evidencia.
 */
export function stripUnfoundedLove(reason: string, loved: string[]): string {
  const r = String(reason ?? "");
  const m = /^\s*porque te encant(?:ó|o|aron)\s+([^:,.;—–-]+)[:,.;—–-]?\s*/i.exec(r);
  if (!m) return r;
  const said = normKey(m[1]);
  const ok = loved.some((l) => { const k = normKey(l); return !!k && (said.includes(k) || k.includes(said)); });
  if (ok) return r;
  const rest = r.slice(m[0].length).trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : r;
}
