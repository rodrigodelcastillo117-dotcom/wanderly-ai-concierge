/**
 * THE PRIVATE EDITION — lógica pura (sin red ni React) que comparten las pantallas, el PDF y la lectura
 * sin conexión. Todo lo que aquí se decide es PRESENTACIÓN sobre la edición común que entrega el servidor
 * (prive_edition_issue): el servidor ya filtró lo no publicado y las imágenes sin licencia.
 *
 * Personalización barata (especificación §8): una sola biblioteca editorial para todos; cada miembro solo
 * cambia selección, orden, portada y tiempo de lectura. Cero llamadas de IA por miembro. Nunca se infiere
 * nada por sexo o género: la única entrada son las preferencias que el miembro eligió (y su consentimiento).
 */

export type Lang = "es" | "en";
export type Localized = { es: string; en?: string | null };

export const INTERESTS: { key: string; es: string; en: string }[] = [
  { key: "viajes_internacionales", es: "Viajes internacionales", en: "International travel" },
  { key: "hoteles_y_villas", es: "Hoteles y villas", en: "Hotels & villas" },
  { key: "yates_y_embarcaciones", es: "Yates y embarcaciones", en: "Yachts & boats" },
  { key: "aviacion_privada", es: "Aviación privada", en: "Private aviation" },
  { key: "superautos", es: "Superautos", en: "Supercars" },
  { key: "relojes", es: "Relojes", en: "Watches" },
  { key: "moda", es: "Moda", en: "Fashion" },
  { key: "belleza", es: "Belleza", en: "Beauty" },
  { key: "joyeria", es: "Joyería", en: "Jewellery" },
  { key: "arquitectura_y_diseno", es: "Arquitectura y diseño", en: "Architecture & design" },
  { key: "gastronomia", es: "Gastronomía", en: "Gastronomy" },
  { key: "deportes", es: "Deportes", en: "Sports" },
  { key: "formula_1", es: "Fórmula 1", en: "Formula 1" },
  { key: "golf", es: "Golf", en: "Golf" },
  { key: "finanzas_y_mercados", es: "Finanzas y mercados", en: "Finance & markets" },
  { key: "negocios", es: "Negocios", en: "Business" },
  { key: "inteligencia_artificial", es: "Inteligencia artificial", en: "Artificial intelligence" },
  { key: "tecnologia", es: "Tecnología", en: "Technology" },
  { key: "arte", es: "Arte", en: "Art" },
  { key: "cultura", es: "Cultura", en: "Culture" },
  { key: "bienestar", es: "Bienestar", en: "Wellness" },
  { key: "eventos_internacionales", es: "Eventos internacionales", en: "International events" },
  { key: "noticias_mundiales", es: "Noticias mundiales", en: "World news" },
  { key: "mexico", es: "México", en: "Mexico" },
  { key: "experiencias_extraordinarias", es: "Experiencias extraordinarias", en: "Extraordinary experiences" },
];
export const INTEREST_KEYS = INTERESTS.map((i) => i.key);
export const interestLabel = (key: string, lang: Lang) => INTERESTS.find((i) => i.key === key)?.[lang] ?? key;

export type EditionKind = "viajes" | "negocios" | "estilo_de_vida" | "mi_mezcla";
export const EDITION_KINDS: { key: EditionKind; es: string; en: string; preset: Record<string, 1 | 2 | 3> }[] = [
  { key: "viajes", es: "Edición de viajes", en: "Travel edition", preset: {
    viajes_internacionales: 3, hoteles_y_villas: 3, experiencias_extraordinarias: 3, gastronomia: 2, yates_y_embarcaciones: 2,
    aviacion_privada: 2, eventos_internacionales: 2, mexico: 2, cultura: 1, arte: 1 } },
  { key: "negocios", es: "Edición de negocios", en: "Business edition", preset: {
    negocios: 3, finanzas_y_mercados: 3, inteligencia_artificial: 3, noticias_mundiales: 3, tecnologia: 2, mexico: 1,
    viajes_internacionales: 1, eventos_internacionales: 1 } },
  { key: "estilo_de_vida", es: "Edición de estilo de vida", en: "Lifestyle edition", preset: {
    relojes: 3, moda: 3, gastronomia: 3, joyeria: 2, belleza: 2, arquitectura_y_diseno: 2, arte: 2, bienestar: 2, superautos: 2,
    yates_y_embarcaciones: 2, golf: 2, formula_1: 2, hoteles_y_villas: 2, cultura: 1 } },
  { key: "mi_mezcla", es: "Mi mezcla", en: "My mix", preset: {} },
];

export const SECTION_KEYS = ["carta", "portada", "reportajes", "agenda", "explicadores", "world_brief", "oportunidades"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const DEFAULT_SECTION_ORDER: SectionKey[] = ["carta", "portada", "reportajes", "agenda", "explicadores", "world_brief", "oportunidades"];

// ───────────────────────────── tipos de lo que entrega el servidor ─────────────────────────────
export type Block =
  | { t: "p" | "h"; es: string; en?: string }
  | { t: "quote"; es: string; en?: string; cite?: Localized }
  | { t: "note"; kind: "analysis" | "context" | "disclaimer"; es: string; en?: string }
  | { t: "facts"; title: Localized; items: { label: Localized; value: Localized }[] }
  | { t: "img"; image: string; size?: "full" | "half" }
  | { t: "agenda"; items: { date: string; end?: string; es: string; en?: string; source: string }[] };

export interface EditionImage {
  key: string; provider: string; url: string; page_url?: string; photographer?: string; photographer_url?: string;
  license?: string; license_url?: string; illustrative: boolean; depicts: Localized; alt: Localized; focal?: string;
  allow_pdf?: boolean; allow_offline?: boolean; license_status?: "pending" | "approved" | "blocked";
}
export interface EditionSource {
  key: string; kind: string; entity: string; author?: string; title: string; url: string; published_at?: string; consulted_at: string;
  used_for?: string; data_used: string; reuse_rights: string; attribution: string; distribution_restrictions?: string; link_status?: string;
}
export type ActionKind = "explore_destination" | "explore_universe" | "ask_iato" | "plan_trip" | "hotels" | "restaurants" | "official_link";
export interface EditionAction { kind: ActionKind; target?: string; url?: string; prompt?: Localized; label: Localized }
export interface EditionArticle {
  slug: string; issue?: string; section: Exclude<SectionKey, "oportunidades">; format: "letter" | "feature" | "short" | "explainer" | "brief" | "agenda";
  topics: string[]; kicker: Localized; title: Localized; dek: Localized; byline: Localized; hero_image?: string;
  fact_status: "verified_facts" | "analysis" | "opinion" | "mixed" | "editorial"; sensitive?: boolean; fact_date?: string; valid_until?: string;
  expired?: boolean; destinations: string[]; reading_minutes: number; word_count?: number; sort_order: number; version: number;
  drafted_by?: "claude" | "human"; published_at?: string; approved_by_label?: string; correction?: { note: string; at: string };
  body?: Block[]; actions?: EditionAction[]; image_keys?: string[]; sources?: EditionSource[];
  status?: string; editor_notes?: string; checks?: { blocking: string[]; warnings: string[] };
}
export interface EditionIssue {
  slug: string; number: number; period_start: string; period_label: Localized; title: Localized; cover_line: Localized;
  cover_image?: string; cover_article?: string; research_closed_at?: string; published_at?: string; version?: number;
  approved_by_label?: string; status?: string; plan?: Record<string, unknown>; retracted?: { note: string; at: string };
}
export interface IssuePayload {
  found: boolean; preview?: boolean; issue?: EditionIssue; articles?: EditionArticle[]; images?: Record<string, EditionImage>;
  retracted?: { slug: string; at: string; note: string }[]; saved?: string[]; generated_at?: string;
}
export interface EditionPrefs {
  saved?: boolean; edition_kind: EditionKind; interests: Record<string, number>; excluded: string[]; language: Lang | null;
  reading_minutes: number; section_order: SectionKey[]; show_name_on_cover: boolean; personalization_consent: boolean;
  first_name?: string | null; consented_at?: string | null;
}
export const DEFAULT_PREFS: EditionPrefs = {
  edition_kind: "mi_mezcla", interests: {}, excluded: [], language: null, reading_minutes: 20, section_order: [],
  show_name_on_cover: false, personalization_consent: false,
};

// ───────────────────────────── idioma ─────────────────────────────
/** Idioma del miembro: el que eligió; si no, el del navegador (inglés si empieza con "en"); si no, español. */
export function resolveLanguage(prefs: Pick<EditionPrefs, "language"> | null | undefined, navigatorLanguage?: string | null): Lang {
  if (prefs?.language === "en" || prefs?.language === "es") return prefs.language;
  return /^en\b/i.test(navigatorLanguage ?? "") ? "en" : "es";
}
/** Texto en el idioma pedido; si no existe, el español y fallback=true (la pantalla lo dice). */
export function tr(loc: Localized | null | undefined, lang: Lang): { text: string; fallback: boolean } {
  if (!loc) return { text: "", fallback: false };
  if (lang === "en" && loc.en) return { text: loc.en, fallback: false };
  return { text: loc.es ?? "", fallback: lang === "en" && !!loc.es };
}
export const txt = (loc: Localized | null | undefined, lang: Lang) => tr(loc, lang).text;
export const blockText = (b: { es: string; en?: string }, lang: Lang) => (lang === "en" && b.en ? b.en : b.es);

export function formatDate(iso: string | null | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "es-MX", { ...opts, timeZone: "America/Mexico_City" });
}
export const todayInMexicoCity = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// ───────────────────────────── personalización ─────────────────────────────
/** Pesos efectivos: el preset de la edición elegida + lo que el miembro marcó (con consentimiento), sin excluidos. */
export function effectiveWeights(prefs: EditionPrefs): Record<string, number> {
  const kind = EDITION_KINDS.find((k) => k.key === prefs.edition_kind) ?? EDITION_KINDS[3];
  const own = prefs.personalization_consent ? prefs.interests ?? {} : {};
  const w: Record<string, number> = { ...kind.preset };
  for (const [k, v] of Object.entries(own)) if (INTEREST_KEYS.includes(k) && [1, 2, 3].includes(v)) w[k] = Math.max(w[k] ?? 0, v);
  for (const ex of prefs.excluded ?? []) delete w[ex];
  return w;
}
export const isPersonalized = (prefs: EditionPrefs) => Object.keys(effectiveWeights(prefs)).length > 0;

export function scoreArticle(a: Pick<EditionArticle, "topics">, weights: Record<string, number>) {
  return a.topics.reduce((s, t) => s + (weights[t] ?? 0), 0);
}
const isExcluded = (a: Pick<EditionArticle, "topics" | "format">, excluded: string[]) =>
  a.format !== "letter" && a.topics.some((t) => excluded.includes(t));

export interface PersonalizedEdition {
  cover: EditionArticle | null;
  coverImage: string | null;
  sections: { key: SectionKey; articles: EditionArticle[] }[];
  /** Piezas que no caben en el tiempo de lectura elegido: siguen disponibles, al final. */
  moreTime: EditionArticle[];
  hidden: { slug: string; reason: "excluded" }[];
  readingMinutes: number;
  personalized: boolean;
  /** Intereses elegidos que este número aún no cubre (aviso honesto). */
  uncovered: string[];
}

/**
 * Selección y orden del miembro sobre la edición común. Determinista: mismo número + mismas preferencias
 * = misma edición. No recibe perfil ni datos personales (no puede inferir nada por género).
 */
export function personalizeIssue(payload: IssuePayload, prefs: EditionPrefs = DEFAULT_PREFS): PersonalizedEdition {
  const articles = [...(payload.articles ?? [])];
  const weights = effectiveWeights(prefs);
  const personalized = Object.keys(weights).length > 0;
  const excluded = prefs.excluded ?? [];
  const hidden = articles.filter((a) => isExcluded(a, excluded)).map((a) => ({ slug: a.slug, reason: "excluded" as const }));
  const visible = articles.filter((a) => !isExcluded(a, excluded));
  const rank = (a: EditionArticle) => (personalized ? scoreArticle(a, weights) : 0);
  const byRank = (x: EditionArticle, y: EditionArticle) => rank(y) - rank(x) || x.sort_order - y.sort_order;

  // Portada: la del número; si el miembro personaliza, el reportaje con imagen que mejor coincide (empate → la del editor).
  const editorsCover = visible.find((a) => a.slug === payload.issue?.cover_article) ?? null;
  let cover = editorsCover;
  if (personalized) {
    const candidates = visible.filter((a) => (a.format === "feature") && a.hero_image && payload.images?.[a.hero_image]);
    const best = [...candidates].sort(byRank)[0];
    if (best && (!editorsCover || rank(best) > rank(editorsCover))) cover = best;
  }
  const coverImage = (cover?.hero_image && payload.images?.[cover.hero_image] ? cover.hero_image : null)
    ?? (payload.issue?.cover_image && payload.images?.[payload.issue.cover_image] ? payload.issue.cover_image : null);

  // Orden de secciones: el del miembro, y luego las demás en el orden editorial.
  const order: SectionKey[] = [...(prefs.section_order ?? []).filter((s) => (SECTION_KEYS as readonly string[]).includes(s))];
  for (const s of DEFAULT_SECTION_ORDER) if (!order.includes(s)) order.push(s);

  // Presupuesto de lectura: la carta y la portada siempre entran; luego por relevancia.
  const budget = Math.max(5, prefs.reading_minutes || 20);
  const priority = [...visible].sort((x, y) => {
    const pin = (a: EditionArticle) => (a.format === "letter" ? 2 : a.slug === cover?.slug ? 1 : 0);
    return pin(y) - pin(x) || byRank(x, y);
  });
  const inBudget = new Set<string>();
  let used = 0;
  for (const a of priority) {
    const pinned = a.format === "letter" || a.slug === cover?.slug;
    if (pinned || used + a.reading_minutes <= budget || (a.format === "brief" && used + a.reading_minutes <= budget + 2)) {
      inBudget.add(a.slug); used += a.reading_minutes;
    }
  }
  const sections = order.map((key) => ({
    key,
    articles: visible.filter((a) => a.section === key && inBudget.has(a.slug)).sort(byRank),
  })).filter((s) => s.articles.length > 0 || s.key === "oportunidades");
  const moreTime = visible.filter((a) => !inBudget.has(a.slug)).sort(byRank);
  const covered = new Set(visible.flatMap((a) => a.topics));
  const uncovered = Object.keys(prefs.personalization_consent ? prefs.interests ?? {} : {}).filter((k) => !covered.has(k) && !excluded.includes(k));
  return { cover, coverImage, sections, moreTime, hidden, readingMinutes: used, personalized, uncovered };
}

// ───────────────────────────── Flight Edition ─────────────────────────────
export interface FlightOptions {
  destination?: string | null;   // slug de destino Privé (cdmx, mc…) o texto libre del viaje
  interests?: string[];
  minutes: number;
  includeGuide: boolean;
}
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Nombres de los destinos que usa la edición (slugs del catálogo Privé). */
export const DESTINATION_LABELS: Record<string, { es: string; en: string }> = {
  cdmx: { es: "Ciudad de México", en: "Mexico City" }, mc: { es: "Mónaco", en: "Monaco" }, merida: { es: "Mérida", en: "Mérida" },
  guadalajara: { es: "Guadalajara", en: "Guadalajara" }, "los-cabos": { es: "Los Cabos", en: "Los Cabos" },
  ginebra: { es: "Ginebra", en: "Geneva" }, "miami-beach": { es: "Miami Beach", en: "Miami Beach" },
};
export const destinationLabel = (slug: string, lang: Lang) => DESTINATION_LABELS[slug]?.[lang] ?? slug;
/** Texto libre de un viaje ("Mérida, Yucatán") → slug de destino si coincide con los del número. */
export function matchDestination(text: string | null | undefined, articles: EditionArticle[]): string | null {
  if (!text) return null;
  const t = norm(text);
  const aliases: Record<string, string[]> = {
    cdmx: ["cdmx", "ciudad de mexico", "mexico city", "mexico, d.f", "df"], mc: ["monaco", "monte carlo", "montecarlo", "mc"],
    merida: ["merida"], guadalajara: ["guadalajara"], "los-cabos": ["los cabos", "cabo san lucas", "san jose del cabo"],
    ginebra: ["ginebra", "geneva", "geneve"], "miami-beach": ["miami beach", "miami"],
  };
  const slugs = new Set(articles.flatMap((a) => a.destinations));
  for (const slug of slugs) {
    if (norm(slug) === t) return slug;
    if ((aliases[slug] ?? []).some((al) => t === al || t.startsWith(al + ",") || t.startsWith(al + " "))) return slug;
  }
  return null;
}
/** Selección para el vuelo: primero lo del destino (si pide guía), luego intereses, hasta el tiempo elegido. */
export function selectFlightEdition(payload: IssuePayload, opts: FlightOptions): EditionArticle[] {
  const all = (payload.articles ?? []).filter((a) => !a.expired);
  const weights: Record<string, number> = {};
  for (const k of opts.interests ?? []) weights[k] = 2;
  const dest = opts.destination ?? null;
  const score = (a: EditionArticle) =>
    (opts.includeGuide && dest && a.destinations.includes(dest) ? 100 : 0) + scoreArticle(a, weights) * 5 + (a.format === "feature" ? 2 : 0);
  const sorted = [...all].filter((a) => a.format !== "letter").sort((x, y) => score(y) - score(x) || x.sort_order - y.sort_order);
  const out: EditionArticle[] = [];
  let used = 0;
  const letter = all.find((a) => a.format === "letter");
  if (letter) { out.push(letter); used += letter.reading_minutes; }
  for (const a of sorted) {
    if (used + a.reading_minutes > Math.max(5, opts.minutes)) continue;
    out.push(a); used += a.reading_minutes;
  }
  return out.sort((x, y) => x.sort_order - y.sort_order);
}

// ───────────────────────────── imágenes ─────────────────────────────
/** ¿Se puede usar esta imagen aquí? Solo con licencia (el servidor ya no entrega las demás) y el uso permitido. */
export function imageAllowed(img: EditionImage | undefined | null, use: "online" | "pdf" | "offline", preview = false): img is EditionImage {
  // https (servidor) o blob: (copia local guardada por la propia app para leer sin conexión).
  if (!img || !img.url || !/^(https:\/\/|blob:)/.test(img.url)) return false;
  // Vista previa del editor: una licencia PENDIENTE se ve en pantalla (marcada); nunca en PDF ni offline.
  if (img.license_status === "blocked") return false;
  if (img.license_status === "pending") return preview && use === "online";
  if (!img.license || !img.photographer) return false;
  if (use === "pdf") return !!img.allow_pdf;
  if (use === "offline") return !!img.allow_offline;
  return true;
}
export function imageCredit(img: EditionImage, lang: Lang) {
  const by = lang === "en" ? "Photo" : "Foto";
  const ill = img.illustrative ? (lang === "en" ? "Illustrative photo · " : "Foto ilustrativa · ") : "";
  return `${ill}${by}: ${img.photographer} / ${img.provider === "pexels" ? "Pexels" : img.provider} · ${img.license}`;
}

// ───────────────────────────── From Page to Experience ─────────────────────────────
export type ResolvedAction =
  | { kind: "internal"; to: string; state?: Record<string, unknown>; label: string; needsNetwork: true; source: ActionKind }
  | { kind: "external"; href: string; label: string; needsNetwork: true; source: ActionKind };
const UNIVERSES = ["the_table", "after_dark", "casino_grand_nights", "yacht_sea", "private_stays", "iconic_events", "culture_access",
  "wellness_escape", "adventure_elite", "sport_leisure", "celebrations", "signature_mexico"];
/**
 * Acción auténtica de un artículo → ruta EXISTENTE de la app (Privé, Iato, viajes, búsquedas con Booking
 * Bridge) o enlace oficial https. Lo desconocido o inseguro se descarta (null): nunca un botón inventado.
 */
export function resolveAction(a: EditionAction, lang: Lang): ResolvedAction | null {
  const label = txt(a.label, lang);
  if (!label) return null;
  const enc = encodeURIComponent;
  switch (a.kind) {
    case "explore_destination":
      return a.target && /^[a-z0-9-]{2,60}$/.test(a.target) ? { kind: "internal", to: `/prive/destino/${a.target}`, label, needsNetwork: true, source: a.kind } : null;
    case "explore_universe":
      return a.target && UNIVERSES.includes(a.target) ? { kind: "internal", to: `/prive/universo/${a.target}`, label, needsNetwork: true, source: a.kind } : null;
    case "ask_iato":
      return { kind: "internal", to: "/dashboard/concierge", state: { prefill: txt(a.prompt, lang) || label }, label, needsNetwork: true, source: a.kind };
    case "plan_trip":
      return a.target ? { kind: "internal", to: `/dashboard/planear?destino=${enc(a.target)}`, label, needsNetwork: true, source: a.kind } : null;
    case "hotels":
      return a.target ? { kind: "internal", to: `/dashboard/hoteles?city=${enc(a.target)}`, label, needsNetwork: true, source: a.kind } : null;
    case "restaurants":
      return a.target ? { kind: "internal", to: `/dashboard/restaurantes?city=${enc(a.target)}`, label, needsNetwork: true, source: a.kind } : null;
    case "official_link":
      try {
        const u = new URL(a.url ?? "");
        return u.protocol === "https:" ? { kind: "external", href: u.toString(), label, needsNetwork: true, source: a.kind } : null;
      } catch { return null; }
    default:
      return null;
  }
}

// ───────────────────────────── Privé Opportunities (= PRIVÉ DROPS de privevalor) ─────────────────────────────
/**
 * Interfaz ESTRECHA de lectura sobre prive_drops(_ps, …) del equipo privevalor (Drops = Opportunities).
 * Solo los campos que la revista muestra. Si la RPC aún no existe en la base, la lista es vacía y la
 * pantalla lo dice: cero oportunidades antes que una inventada.
 */
export interface Opportunity {
  id: string; slug: string; type: string; status: "activo" | "por_verificar" | "vencido" | "programado" | "retirado" | string;
  title: Localized; provider: { name: string; url?: string }; destination?: { slug: string; es: string; en?: string };
  benefit: Localized; conditions?: Localized; eligibility?: Localized; restrictions?: Localized;
  valid_from?: string; valid_until?: string; price?: { offer?: number; reference?: number; currency?: string; source?: string; discount_pct?: number };
  source: { url: string; name?: string }; link: string; last_verified_at: string; relationship?: string; interests?: string[];
}
/** Visible solo si está activa o por verificar, con fuente y enlace https, verificada y dentro de su vigencia hoy (CDMX). */
export function isOpportunityLive(o: Opportunity, today = todayInMexicoCity()): boolean {
  if (!o || !["activo", "por_verificar"].includes(o.status)) return false;
  if (!/^https:\/\//.test(o.source?.url ?? "") || !/^https:\/\//.test(o.link ?? "")) return false;
  if (!o.last_verified_at) return false;
  if (o.valid_until && o.valid_until < today) return false;
  if (o.valid_from && o.valid_from > today) return false;
  return true;
}
export const liveOpportunities = (items: Opportunity[] | null | undefined, today = todayInMexicoCity()) =>
  (items ?? []).filter((o) => isOpportunityLive(o, today));

// ───────────────────────────── lectura sin conexión: reconciliar al volver la red ─────────────────────────────
export interface OfflinePackMeta { id: string; kind: "issue" | "flight"; issue: string; title: string; generated_at: string; lang: Lang; versions: Record<string, number> }
/**
 * Al recuperar conexión: compara la copia guardada con lo que hoy publica el servidor. Quita lo retirado o
 * despublicado y actualiza lo corregido. Devuelve qué cambió para decírselo al miembro.
 */
export function reconcilePack(saved: IssuePayload, fresh: IssuePayload): { next: IssuePayload; updated: string[]; removed: string[] } {
  const freshBySlug = new Map((fresh.articles ?? []).map((a) => [a.slug, a]));
  const retracted = new Set((fresh.retracted ?? []).map((r) => r.slug));
  const updated: string[] = [];
  const removed: string[] = [];
  const articles: EditionArticle[] = [];
  for (const a of saved.articles ?? []) {
    const f = freshBySlug.get(a.slug);
    if (retracted.has(a.slug) || !f) { removed.push(a.slug); continue; }
    if (f.version !== a.version) { updated.push(a.slug); articles.push(f); } else articles.push(a);
  }
  const images: Record<string, EditionImage> = {};
  for (const a of articles) for (const k of a.image_keys ?? []) {
    const img = fresh.images?.[k] ?? saved.images?.[k];
    if (img && fresh.images?.[k]) images[k] = img;   // una licencia retirada desaparece también de la copia
  }
  return { next: { ...saved, articles, images, generated_at: fresh.generated_at ?? saved.generated_at, retracted: fresh.retracted }, updated, removed };
}

/** Mínimo para declarar "número disponible": al menos 4 piezas no-breve (si no, se dice "edición en preparación"). */
export const hasEnoughContent = (payload: IssuePayload | null | undefined) =>
  (payload?.articles ?? []).filter((a) => a.format !== "brief").length >= 4;
