// Contrato y validación de las "cards" del concierge (hallazgos B-02, B-03, B-04 y B-10).
// Lógica pura, importable desde Vitest y desde el cliente (los tipos de card).
//
// Antes el servidor devolvía tal cual lo que escribía el modelo: precios que no venían de
// ninguna búsqueda, jets con "$24,000" de ejemplo, enlaces javascript: y cards de tipos que la
// pantalla no sabía dibujar. Ahora cada card pasa por validateCards() después del modelo.

import { slimToolResult } from "./tools.ts";
import { neutralizeDeep } from "./guard.ts";

export const CARD_TYPES = ["flight", "hotel", "attraction", "restaurant", "transport", "alert", "luggage", "jet"] as const;
export type CardType = typeof CARD_TYPES[number];

/**
 * Estado del dato que muestra la card (diseño C-1). Lo asigna SOLO el servidor.
 * - CONSULTADO_EN_VIVO: el precio coincide con un resultado de herramienta de este turno.
 * - NO_VERIFICADO: el modelo puso un precio que no aparece en ningún resultado; se quita.
 * - SOLICITUD_HUMANA: jet/equipaje — no hay proveedor conectado; es una solicitud de cotización.
 */
export type EstadoDato = "CONSULTADO_EN_VIVO" | "NO_VERIFICADO" | "SOLICITUD_HUMANA";

export interface ConciergeCard {
  type: CardType;
  title: string;
  subtitle?: string;
  meta?: string;
  body?: string;
  cta_label?: string;
  cta_action?: string;
  image_url?: string;
  provider?: string;
  from?: string;
  to?: string;
  route?: string;
  fbo?: string;
  status?: string;
  rating?: number;
  price?: number;
  price_usd?: number;
  currency?: string;
  fuente?: string;
  estado_dato?: EstadoDato;
  consultado_at?: string;
  price_note?: string;
}

/** Solo https: (nada de javascript:, data:, http:, ni URLs con usuario/contraseña). */
export function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s || s.length > 2048) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

// ═══ Resultados de herramientas → lo que ve el modelo (B-03) ═══

const AI_SOURCE = /^(ai|ia|ai[-_ ]?fallback|ia[-_ ]?fallback|estimad[oa]|estimate[ds]?|llm|gemini|modelo)$/i;
export const isAiSource = (v: unknown) => typeof v === "string" && AI_SOURCE.test(v.trim());

const ESTIMATE_KEYS = new Set(["estimate", "estimates", "estimado", "estimados", "ai_estimate", "estimacion"]);

const itemSource = (x: any) => x?.source ?? x?.fuente ?? x?.fuente_precio ?? x?.provider;

/** Quita de listas los elementos marcados como estimación de IA y las llaves de estimado. */
function dropAiItems(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((x) => !(x && typeof x === "object" && isAiSource(itemSource(x)))).map(dropAiItems);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !ESTIMATE_KEYS.has(k.toLowerCase()))
      .map(([k, v]) => [k, dropAiItems(v)]));
  }
  return value;
}

const SEARCH_TOOLS = new Set(["search_flights", "search_hotels", "search_attractions", "search_nearby"]);

export interface ToolUnavailable { disponible: false; motivo: string; fuente?: string; error?: string }

/**
 * Prepara un resultado de herramienta para el modelo: si vino de la estimación de IA
 * (source "ai-fallback") o vacío, el modelo recibe una nota explícita {disponible:false, motivo}
 * y NUNCA las opciones inventadas. Los textos de terceros se neutralizan.
 */
export function prepareToolResultForModel(name: string, raw: unknown): Record<string, unknown> {
  const r = raw as any;
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    return { disponible: false, motivo: "El proveedor no devolvió datos." } satisfies ToolUnavailable;
  }
  if (r.error === "timeout") {
    return { disponible: false, error: "timeout", motivo: "El proveedor tardó demasiado en responder; la búsqueda en vivo no está disponible ahora." };
  }
  if (r.error || r.ok === false) {
    return { disponible: false, error: String(r.error ?? "error").slice(0, 160), motivo: "El proveedor no respondió; la búsqueda en vivo no está disponible ahora." };
  }
  if (isAiSource(r.source) || isAiSource(r.provider)) {
    return {
      disponible: false,
      fuente: "ai-fallback",
      motivo: "La búsqueda en vivo no está disponible ahora. El proveedor solo devolvió estimaciones de IA y no se pueden mostrar como opciones reales.",
    };
  }
  const cleaned = dropAiItems(r) as Record<string, unknown>;
  if (SEARCH_TOOLS.has(name)) {
    const lists = Object.values(cleaned).filter(Array.isArray) as unknown[][];
    if (!lists.some((l) => l.length > 0)) {
      return { disponible: false, fuente: typeof r.source === "string" ? r.source : undefined, motivo: "La búsqueda en vivo no trajo resultados para esos datos." };
    }
  }
  const out: Record<string, unknown> = {
    disponible: true,
    ...(slimToolResult(neutralizeDeep(cleaned, 400)) as Record<string, unknown>),
  };
  if (name === "check_flight_status" && (r.provider === "perplexity" || r?.data?.fuente === "perplexity")) {
    out.nota_fuente = "Dato obtenido de una búsqueda web, no del sistema de la aerolínea: dilo así y sugiere confirmar con la aerolínea.";
  }
  return out;
}

// ═══ Evidencia de este turno ═══

export interface ToolRun { name: string; args?: Record<string, unknown>; result: Record<string, unknown> }

export interface Evidence {
  prices: { tool: string; value: number; currency: string; source: string }[];
  ratings: { tool: string; value: number }[];
  available: Record<string, boolean>;
  unavailable: Record<string, string>;
}

const PRICE_KEY = /(^|_)(price|precio|nightly|total|amount|rate|tarifa|costo|cost)(_|$)|_usd$/i;
const RATING_KEY = /^(rating|overall_rating|calificacion)$/i;

const DEFAULT_SOURCE: Record<string, string> = {
  search_flights: "serpapi",
  search_hotels: "serpapi",
  search_attractions: "tripadvisor",
  search_nearby: "google_maps",
  check_flight_status: "serpapi",
};

export function collectEvidence(runs: ToolRun[]): Evidence {
  const ev: Evidence = { prices: [], ratings: [], available: {}, unavailable: {} };
  for (const run of runs) {
    const res = run.result ?? {};
    if (res.disponible === false) {
      if (!ev.available[run.name]) ev.unavailable[run.name] = String(res.motivo ?? "no disponible");
      continue;
    }
    ev.available[run.name] = true;
    delete ev.unavailable[run.name];
    const topSource = typeof res.source === "string" ? res.source : DEFAULT_SOURCE[run.name] ?? run.name;
    const visit = (node: unknown, currency: string, source: string, depth: number) => {
      if (depth > 8 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((n) => visit(n, currency, source, depth + 1)); return; }
      const obj = node as Record<string, unknown>;
      const cur = typeof obj.currency === "string" ? obj.currency.toUpperCase() : currency;
      const src = typeof obj.source === "string" && !isAiSource(obj.source) ? obj.source : source;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          if (PRICE_KEY.test(k)) ev.prices.push({ tool: run.name, value: v, currency: /_usd$/i.test(k) ? "USD" : cur, source: src });
          else if (RATING_KEY.test(k)) ev.ratings.push({ tool: run.name, value: v });
        } else if (typeof v === "string" && RATING_KEY.test(k) && Number.isFinite(Number(v)) && Number(v) > 0) {
          // TripAdvisor devuelve el rating como texto ("4.5").
          ev.ratings.push({ tool: run.name, value: Number(v) });
        } else if (v && typeof v === "object") visit(v, cur, src, depth + 1);
      }
    };
    visit(res, "USD", topSource, 0);
  }
  return ev;
}

// Qué herramienta puede respaldar el precio de cada tipo de card.
const PRICE_TOOLS: Partial<Record<CardType, string[]>> = {
  flight: ["search_flights"],
  hotel: ["search_hotels"],
  attraction: ["search_attractions"],
  restaurant: ["search_attractions", "search_nearby"],
  transport: [],
};

// Cards que muestran opciones de compra: sin una búsqueda disponible en este turno, eran inventadas.
const REQUIRES_TOOL: Partial<Record<CardType, string>> = { flight: "search_flights", hotel: "search_hotels" };

const str = (v: unknown, max: number) => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) ? n : undefined;
}

const approxEq = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);

const normCurrency = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(s) ? s : undefined;
};

export interface ValidationOutcome { cards: ConciergeCard[]; dropped: { type: string; reason: string }[] }

export const MAX_CARDS = 8;

/**
 * Valida y limpia las cards del modelo contra la evidencia de herramientas de ESTE turno.
 * - Descarta cards mal formadas o de tipos desconocidos.
 * - Solo deja URLs https.
 * - Un precio solo se muestra si coincide (±1 %) con un resultado real de la herramienta que
 *   corresponde, y entonces lleva su fuente. Si no, se quita y queda "precio no verificado".
 * - Jet y equipaje no tienen proveedor: nunca llevan precio; son solicitudes de cotización.
 * - Vuelo/hotel sin una búsqueda disponible en este turno se descarta (sería inventado).
 */
export function validateCards(raw: unknown, ev: Evidence, consultadoAt: string = new Date().toISOString()): ValidationOutcome {
  const out: ValidationOutcome = { cards: [], dropped: [] };
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (out.cards.length >= MAX_CARDS) { out.dropped.push({ type: "?", reason: "demasiadas" }); continue; }
    if (!item || typeof item !== "object" || Array.isArray(item)) { out.dropped.push({ type: "?", reason: "mal_formada" }); continue; }
    const r = item as Record<string, unknown>;
    const type = String(r.type ?? "").toLowerCase() as CardType;
    if (!CARD_TYPES.includes(type)) { out.dropped.push({ type: String(r.type ?? "?"), reason: "tipo_desconocido" }); continue; }
    const title = str(r.title, 140);
    if (!title) { out.dropped.push({ type, reason: "sin_titulo" }); continue; }
    const needTool = REQUIRES_TOOL[type];
    if (needTool && !ev.available[needTool]) { out.dropped.push({ type, reason: "sin_respaldo_de_busqueda" }); continue; }

    const card: ConciergeCard = { type, title };
    const opt = (key: keyof ConciergeCard, max: number) => {
      const v = str(r[key as string], max);
      if (v) (card as any)[key] = v;
    };
    opt("subtitle", 160); opt("meta", 200); opt("cta_label", 40); opt("provider", 60);
    opt("from", 120); opt("to", 120); opt("route", 120); opt("fbo", 120); opt("status", 160);
    if (type === "alert") {
      const body = str(r.body, 600);
      if (!body) { out.dropped.push({ type, reason: "alerta_sin_texto" }); continue; }
      card.body = body;
    }
    const cta = safeHttpsUrl(r.cta_action);
    if (cta) card.cta_action = cta;
    const img = safeHttpsUrl(r.image_url);
    if (img) card.image_url = img;

    const rating = toNumber(r.rating);
    if (rating !== undefined && rating > 0 && rating <= 10 && ev.ratings.some((x) => Math.abs(x.value - rating) < 0.05)) {
      card.rating = rating;
    }

    if (type === "jet" || type === "luggage") {
      // No existe proveedor de jets ni de equipaje conectado: es una solicitud a un humano.
      card.estado_dato = "SOLICITUD_HUMANA";
      card.cta_label = "Solicitar cotización";
      delete card.cta_action;
      out.cards.push(card);
      continue;
    }

    const price = toNumber(r.price ?? r.price_usd);
    if (price !== undefined && price > 0) {
      const currency = normCurrency(r.currency) ?? "USD";
      const tools = PRICE_TOOLS[type] ?? [];
      const match = ev.prices.find((p) => tools.includes(p.tool) && p.currency === currency && approxEq(p.value, price));
      if (match) {
        card.price = price;
        if (currency === "USD") card.price_usd = price;
        card.currency = currency;
        card.fuente = match.source;
        card.estado_dato = "CONSULTADO_EN_VIVO";
        card.consultado_at = consultadoAt;
      } else {
        card.estado_dato = "NO_VERIFICADO";
        card.price_note = "precio no verificado";
      }
    }
    out.cards.push(card);
  }
  return out;
}

const TOOL_LABEL: Record<string, string> = {
  search_flights: "vuelos",
  search_hotels: "hoteles",
  search_attractions: "lugares",
  search_nearby: "lugares cercanos",
  check_flight_status: "estado del vuelo",
};

const ALREADY_HONEST = /no (est[aá]|esta) disponible|no disponible|no (pude|pudimos|logr[eé]|tengo|hay)|sin resultados|no (encontr|tra)|no (me )?respondi|fuera de servicio|no se pudo/i;

/**
 * Si una búsqueda de este turno no estuvo disponible (ai-fallback, vacía, error o timeout) y el
 * texto del modelo no lo dice, se antepone una frase honesta. Determinista.
 */
export function enforceAvailabilityHonesty(text: string, ev: Evidence): string {
  const missing = Object.keys(ev.unavailable).filter((t) => TOOL_LABEL[t] && !ev.available[t]);
  if (!missing.length || ALREADY_HONEST.test(text)) return text;
  const names = missing.map((t) => TOOL_LABEL[t]).join(" y ");
  const anyEmpty = missing.some((t) => /no trajo resultados/.test(ev.unavailable[t]));
  const line = anyEmpty && missing.length === 1
    ? `La búsqueda en vivo de ${names} no trajo resultados, así que no te muestro opciones inventadas.`
    : `La búsqueda en vivo de ${names} no está disponible en este momento, así que no te muestro opciones como si fueran reales.`;
  return `${line} ${text}`.trim();
}
