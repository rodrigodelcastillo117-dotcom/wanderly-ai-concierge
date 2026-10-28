// Viator Partner API v2 ("Acceso básico" de afiliado). Sin dependencias de Deno: lo usan viator-search
// y la herramienta search_tours de Iato (concierge-chat), y se prueba con Vitest con fixtures armados
// según la documentación (docs.viator.com/partner-api/technical, 23-oct-2026):
//   * Base: https://api.viator.com/partner (producción) · https://api.sandbox.viator.com/partner.
//   * Encabezados: exp-api-key (la llave, SOLO del servidor), Accept: application/json;version=2.0,
//     Accept-Language (es-MX), Content-Type: application/json.
//   * POST /search/freetext: searchTerm, searchTypes [{searchType: "DESTINATIONS"|"PRODUCTS",
//     pagination {start, count}}], productFiltering {destination, dateRange {from, to}}, currency.
//     Responde destinations.results[{id, name, parentDestinationName}] y products.results[…].
//   * POST /products/search: filtering {destination (requerido), startDate, endDate}, sorting
//     {sort: "TRAVELER_RATING", order: "DESCENDING"}, pagination {start, count ≤ 50}, currency.
//     Responde products[…] y totalCount.
//   * Producto (resumen): productCode, title, images[{isCover, variants[{url, width, height}]}],
//     reviews {totalReviews, combinedAverageRating}, duration {fixedDurationInMinutes |
//     variableDurationFromMinutes/ToMinutes}, pricing {summary.fromPrice, currency}, productUrl (ya
//     trae el afiliado: pid, mcid, medium=api).
//   * El destino se resuelve con /search/freetext (searchTypes DESTINATIONS, 1 llamada pequeña) en
//     lugar de bajar /destinations completo (todos los destinos de Viator; se refresca semanal).
//
// Términos de Viator (aceptados por el dueño): el contenido solo sirve para mandar visitas de afiliado
// a viator.com (productUrl con pid P00327354 · mcid 42383), solo en pantallas propias con sesión, sin
// indexar (nada de páginas públicas, sitemap ni metadatos SEO) y caché corta (6 h), privada
// (public.serp_cache, solo service_role) y solo para servir la misma consulta.

import { cacheGet, cacheKey, cachePut, type CacheStore, freshnessOf, type GateDecision, type LiveGate } from "./serpCache.ts";
import type { FxInfo } from "./fx.ts";

export const VIATOR_ENGINE = "viator_products";
export const VIATOR_PROD_BASE = "https://api.viator.com/partner";
export const VIATOR_SANDBOX_BASE = "https://api.sandbox.viator.com/partner";
export const MAX_TOURS = 6;
/** Afiliado directo de IATOS (públicos, no secretos): mismos de _shared/booking/links.ts. */
export const VIATOR_PID = "P00327354";
export const VIATOR_MCID = "42383";
/**
 * Monedas que acepta `currency` en /products/search y /search/freetext (documentación v2). MXN está:
 * por omisión se pide en MXN y el "desde" es el de Viator, sin convertir. Con otra moneda, el
 * equivalente en MXN sale SOLO de _shared/fx.ts (tasa con fuente y fecha).
 */
export const VIATOR_CURRENCIES = new Set(["AED", "ARS", "AUD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "DKK", "EUR", "FJD", "GBP", "HKD", "IDR",
  "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PEN", "PHP", "PLN", "SEK", "SGD", "THB", "TRY", "TWD", "USD", "VND", "ZAR"]);
/** Sin la llave habilitada (401/403: tarda hasta 24 h) no se vuelve a intentar en 15 min. */
export const AUTH_PAUSE_SECONDS = 15 * 60;

export const NO_DISPONIBLE_MOTIVO = "Los tours de Viator aún no están disponibles en IATOS. Puedes buscar directo en Viator.";

export interface ViatorTour {
  codigo: string;
  title: string;
  foto?: string;
  /** combinedAverageRating (1 decimal) y totalReviews de Viator. */
  rating?: number;
  resenas?: number;
  duracion?: string;
  /** "Desde": pricing.summary.fromPrice en la moneda que devolvió Viator. */
  desde?: { monto: number; moneda: string };
  /** Si el precio no viene en MXN: equivalente con tasa verificable de _shared/fx.ts (nunca la de respaldo). */
  desde_mxn?: { monto: number; fx_fuente: string; fx_fecha: string };
  /** productUrl de Viator (con el afiliado de IATOS): "Ver en Viator", no es una reserva. */
  url: string;
  /** Free tour: al guía se le paga con propina; el "desde" de Viator no es el costo del recorrido. */
  free_tour?: boolean;
  /** El título vino en inglés (Viator no tiene versión en español de ese producto). */
  titulo_en_ingles?: boolean;
}

// ─── Títulos en español y free tours (E2E 28-oct-2026) ───
// "Madrid Historical Walking Tour" (inglés) a "desde $63.61 MXN": era un free tour (la ficha dice
// "Free-Tour-Exploring-the-historical-Madrid"), así que el monto no es lo que cuesta el recorrido. Con
// Accept-Language es-MX Viator traduce casi todo; lo que llega en inglés va al final y, si hay al menos
// tres en español, no se muestra.
const EN_WORDS = /\b(walking|historical|history|day trip|from|with|and|the|of|private|guided|skip|line|tickets?|experience|small|group|tasting|highlights|city|old town|evening|night|cooking|class|by|in)\b/g;
const ES_WORDS = /\b(de|del|la|el|los|las|con|y|en|por|visita|excursi[oó]n|recorrido|guiad[oa]|entradas?|paseo|desde|sin|clase|cocina|ciudad|noche|traslado)\b/;
export function looksEnglish(title: unknown): boolean {
  const t = String(title ?? "").toLowerCase();
  if (!t.trim() || /[áéíóúñ¿¡]/.test(t) || ES_WORDS.test(t)) return false;
  return (t.match(EN_WORDS) ?? []).length >= 1 && t.split(/\s+/).length >= 3;
}
const FREE_TOUR = /\b(free[ -]tour|tour gratis|tour gratuito)\b/i;
export const FREE_TOUR_NOTE = "Free tour: al guía se le paga con propina; el precio de Viator no es el costo del recorrido.";

export type ViatorResult =
  | { ok: true; fuente: "Viator"; source: "viator"; results: ViatorTour[]; consultado_at: string; from_cache: boolean; moneda: string;
      destino?: { id: string; nombre: string } | null; code?: undefined;
      /** Solo si no quedó ningún tour: cuántos mandó Viator y la ruta del primer enlace (sin llave ni query). */
      diagnostico?: { recibidos: number; ruta_ejemplo: string | null; claves: string[] } }
  | { ok: false; code: "viator_no_disponible" | "viator_ocupado" | "viator_error" | "falta_ciudad" | "FREE_LIMIT_REACHED"; motivo: string;
      error?: string; soft?: boolean; info?: Record<string, unknown>; limite_uso_justo?: boolean };

export interface ViatorDeps {
  fetchImpl: typeof fetch;
  /** Deno.env.get("VIATOR_API_KEY") (o la de sandbox con su base). Nunca se registra ni se devuelve. */
  apiKey?: string;
  baseUrl?: string;
  store?: CacheStore | null;
  gate?: LiveGate;
  /** Tipo de cambio con fuente (getRateToMxnInfo de _shared/fx.ts). */
  fx?: (currency: string) => Promise<FxInfo | null>;
  timeoutMs?: number;
  now?: () => number;
  background?: (p: Promise<unknown>) => void;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Llave y base según los secretos: producción primero; sandbox solo si no hay la de producción. */
export function viatorConfig(env: (k: string) => string | undefined): { apiKey?: string; baseUrl: string } {
  const prod = env("VIATOR_API_KEY")?.trim();
  if (prod) return { apiKey: prod, baseUrl: VIATOR_PROD_BASE };
  const sb = env("VIATOR_API_KEY_SANDBOX")?.trim();
  return sb ? { apiKey: sb, baseUrl: VIATOR_SANDBOX_BASE } : { baseUrl: VIATOR_PROD_BASE };
}

/**
 * productUrl de Viator: https, de viator.com, ficha de producto (/tours/…) y con el afiliado de IATOS
 * (si no trae pid/mcid se le agregan). Cualquier otra cosa → null (el tour no se muestra).
 */
export function affiliateProductUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (host !== "viator.com" && !host.endsWith(".viator.com")) return null;
  // Viator puede devolver la ficha con prefijo de idioma (/es-MX/tours/…) por el Accept-Language.
  if (!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tours\//.test(u.pathname)) return null;
  if (!u.searchParams.get("pid")) u.searchParams.set("pid", VIATOR_PID);
  if (!u.searchParams.get("mcid")) u.searchParams.set("mcid", VIATOR_MCID);
  return u.toString();
}

/** 240 → "4 h"; 90 → "1 h 30 min"; variable 120–180 → "2–3 h". */
export function formatDuration(d: any): string | undefined {
  const fmt = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
  const fixed = Number(d?.fixedDurationInMinutes);
  if (Number.isFinite(fixed) && fixed > 0) return fmt(Math.round(fixed));
  const a = Number(d?.variableDurationFromMinutes);
  const b = Number(d?.variableDurationToMinutes);
  if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > a) {
    return a % 60 === 0 && b % 60 === 0 ? `${a / 60}–${b / 60} h` : `${fmt(Math.round(a))} – ${fmt(Math.round(b))}`;
  }
  return undefined;
}

/** Foto de portada (isCover) con el ancho más cercano a 480 px. */
function coverPhoto(images: unknown): string | undefined {
  const list = Array.isArray(images) ? images : [];
  const img = list.find((i: any) => i?.isCover) ?? list[0];
  const variants = (Array.isArray(img?.variants) ? img.variants : []).filter((v: any) => typeof v?.url === "string" && /^https:\/\//i.test(v.url));
  if (!variants.length) return undefined;
  const best = variants.reduce((a: any, b: any) => (Math.abs(Number(b.width) - 480) < Math.abs(Number(a.width) - 480) ? b : a));
  return best.url;
}

/** Resúmenes de producto de Viator → tarjetas. Sin productUrl válido (con afiliado) no se muestra. */
export function mapViatorProducts(list: unknown, max = MAX_TOURS): ViatorTour[] {
  const out: ViatorTour[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(list) ? list as any[] : []) {
    const codigo = clean(p?.productCode, 40);
    const title = clean(p?.title, 160);
    const url = affiliateProductUrl(p?.productUrl);
    if (!codigo || !title || !url || seen.has(codigo)) continue;
    seen.add(codigo);
    const t: ViatorTour = { codigo, title, url };
    const foto = coverPhoto(p?.images);
    if (foto) t.foto = foto;
    const r = Number(p?.reviews?.combinedAverageRating);
    const n = Number(p?.reviews?.totalReviews);
    if (Number.isFinite(r) && r > 0 && r <= 5) t.rating = Math.round(r * 10) / 10;
    if (Number.isFinite(n) && n > 0) t.resenas = Math.round(n);
    const dur = formatDuration(p?.duration);
    if (dur) t.duracion = dur;
    const price = Number(p?.pricing?.summary?.fromPrice);
    const cur = clean(p?.pricing?.currency, 3).toUpperCase();
    if (Number.isFinite(price) && price > 0 && /^[A-Z]{3}$/.test(cur)) t.desde = { monto: Math.round(price * 100) / 100, moneda: cur };
    // La ficha (slug) también lo dice: /tours/Madrid/Free-Tour-Exploring-the-historical-Madrid/…
    let slug = "";
    try { slug = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " "); } catch { /* url ya validada */ }
    if (FREE_TOUR.test(title) || FREE_TOUR.test(slug)) t.free_tour = true;
    if (looksEnglish(title)) t.titulo_en_ingles = true;
    out.push(t);
  }
  // Primero los títulos en español; los que solo existen en inglés van al final y sobran si hay ≥ 3 en español.
  const es = out.filter((t) => !t.titulo_en_ingles), en = out.filter((t) => t.titulo_en_ingles);
  return (es.length >= 3 ? es : [...es, ...en]).slice(0, max);
}

/** Destino de /search/freetext (DESTINATIONS): el de nombre igual a la ciudad o el primero. */
export function pickDestination(json: any, city: string): { id: string; nombre: string } | null {
  const list = Array.isArray(json?.destinations?.results) ? json.destinations.results : [];
  const c = norm(city);
  const hit = list.find((d: any) => norm(d?.name) === c) ?? list.find((d: any) => norm(d?.name).startsWith(c) || c.startsWith(norm(d?.name))) ?? list[0];
  const id = hit?.id ?? hit?.destinationId;
  return id !== undefined && id !== null && /^\d+$/.test(String(id)) ? { id: String(id), nombre: clean(hit?.name, 80) } : null;
}

/** ¿El usuario pidió tours o actividades? Solo así Iato usa search_tours. */
const TOUR_WORDS = /\b(tours?|excursion(es)?|actividades|experiencias|visitas? guiadas?|recorridos? guiados?|paseos? en (barco|lancha|globo|catamaran|velero|kayak)|free tour|day trips?|snorkel\w*|buceo|que tours?)\b/;
export function toursRequested(message: unknown): boolean {
  return TOUR_WORDS.test(norm(message));
}

const pauseKey = () => cacheKey("viator_pause", { flag: "pausa" });

async function viatorPost(d: ViatorDeps, path: string, body: unknown): Promise<{ status: number; ok: boolean; json: any; retryAfter: number | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), d.timeoutMs ?? 6000);
  try {
    const res = await d.fetchImpl(`${d.baseUrl ?? VIATOR_PROD_BASE}${path}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "exp-api-key": d.apiKey ?? "",
        Accept: "application/json;version=2.0",
        "Accept-Language": "es-MX",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    const ra = Number(res.headers?.get?.("Retry-After"));
    return { status: res.status, ok: res.ok, json, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
  } finally {
    clearTimeout(t);
  }
}

/** Monto en MXN solo con tasa verificable (frankfurter/BCE); con la tabla de respaldo no se convierte. */
async function withMxn(tours: ViatorTour[], d: ViatorDeps): Promise<ViatorTour[]> {
  if (!d.fx) return tours;
  const rates = new Map<string, FxInfo | null>();
  const out: ViatorTour[] = [];
  for (const t of tours) {
    if (!t.desde || t.desde.moneda === "MXN") { out.push(t); continue; }
    if (!rates.has(t.desde.moneda)) rates.set(t.desde.moneda, await d.fx(t.desde.moneda).catch(() => null));
    const fx = rates.get(t.desde.moneda);
    out.push(fx && !fx.is_fallback && fx.rate > 0
      ? { ...t, desde_mxn: { monto: Math.round(t.desde.monto * fx.rate), fx_fuente: "Banco Central Europeo (frankfurter.app)", fx_fecha: fx.fetched_at.slice(0, 10) } }
      : t);
  }
  return out;
}

export async function runViatorSearch(args: Record<string, unknown>, d: ViatorDeps): Promise<ViatorResult> {
  const city = clean(args.city, 80);
  if (!city) return { ok: false, code: "falta_ciudad", motivo: "Falta la ciudad." };
  const now = d.now ?? Date.now;
  const today = new Date(now()).toISOString().slice(0, 10);
  const query = clean(args.query, 80);
  const wanted = clean(args.currency, 3).toUpperCase() || "MXN";
  const currency = VIATOR_CURRENCIES.has(wanted) ? wanted : "MXN";
  // Fechas solo hacia adelante (Viator filtra disponibilidad futura).
  let from = typeof args.date_from === "string" && ISO.test(args.date_from) ? args.date_from : null;
  let to = typeof args.date_to === "string" && ISO.test(args.date_to) ? args.date_to : null;
  if (from && from < today) from = today;
  if (to && (to < today || (from && to < from))) to = null;
  if (to && !from) from = today;

  // Cuántos tours (default 6; hasta 12 para el criterio TOP de Experiencias). La llave de caché solo
  // cambia si se pide otro tamaño (las entradas existentes siguen valiendo).
  const maxN = args.max == null || args.max === "" ? NaN : Number(args.max);
  const max = Number.isFinite(maxN) ? Math.min(12, Math.max(1, Math.round(maxN))) : MAX_TOURS;
  const key = await cacheKey(VIATOR_ENGINE, { city: norm(city), q: norm(query), cur: currency, from: from ?? "", to: to ?? "", ...(max !== MAX_TOURS ? { max } : {}) });
  const ok = async (results: ViatorTour[], at: string, fromCache: boolean, destino: { id: string; nombre: string } | null = null): Promise<ViatorResult> =>
    ({ ok: true, fuente: "Viator", source: "viator", results: await withMxn(results, d), consultado_at: at, from_cache: fromCache, moneda: currency, destino });

  const cached = await cacheGet(d.store, key);
  const cachedResults = (cached?.response as { results?: ViatorTour[] } | undefined)?.results;
  // Una entrada vacía (versiones anteriores sí las guardaban) no cuenta: se vuelve a consultar.
  if (cached && freshnessOf(cached, now()).fresh && Array.isArray(cachedResults) && cachedResults.length > 0) {
    const r = cached.response as { results?: ViatorTour[]; destino?: { id: string; nombre: string } | null };
    return ok(cachedResults, cached.fetched_at, true, r?.destino ?? null);
  }
  const noDisponible = (error?: string): ViatorResult => ({ ok: false, code: "viator_no_disponible", motivo: NO_DISPONIBLE_MOTIVO, ...(error ? { error } : {}) });
  if (!d.apiKey) return noDisponible("sin_llave");

  // Pausa compartida tras un 401/403 (llave aún no habilitada) o un 429 de Viator.
  const pause = await cacheGet(d.store, await pauseKey());
  if (pause && freshnessOf(pause, now()).fresh) {
    return (pause.response as { motivo?: string })?.motivo === "auth"
      ? noDisponible("llave_no_habilitada")
      : { ok: false, code: "viator_ocupado", motivo: "Viator está recibiendo muchas consultas; intenta en unos minutos." };
  }

  let refund: (() => Promise<void>) | undefined;
  if (d.gate) {
    const g = await d.gate();
    if (!g.allow) {
      const denied = g as Extract<GateDecision, { allow: false }>;
      return { ok: false, code: "FREE_LIMIT_REACHED", soft: denied.soft, info: denied.info, limite_uso_justo: true, motivo: "Se alcanzó el límite de búsquedas en vivo del plan." };
    }
    refund = (g as Extract<GateDecision, { allow: true }>).refund;
  }
  const fail = async (r: { status: number; retryAfter: number | null } | null, error: string): Promise<ViatorResult> => {
    if (refund) await refund().catch(() => {});
    if (r && (r.status === 401 || r.status === 403)) {
      await Promise.resolve(d.store?.put(await pauseKey(), "viator_pause", { motivo: "auth" }, AUTH_PAUSE_SECONDS)).catch(() => {});
      return noDisponible("llave_no_habilitada");
    }
    if (r && r.status === 429) {
      const secs = Math.min(600, Math.max(10, Math.round(r.retryAfter ?? 60)));
      await Promise.resolve(d.store?.put(await pauseKey(), "viator_pause", { motivo: "429" }, secs)).catch(() => {});
      return { ok: false, code: "viator_ocupado", motivo: "Viator está recibiendo muchas consultas; intenta en unos minutos." };
    }
    return { ok: false, code: "viator_error", error, motivo: "Viator no respondió; intenta más tarde o busca directo en Viator." };
  };

  try {
    // 1) Ciudad → destino de Viator.
    const dr = await viatorPost(d, "/search/freetext", {
      searchTerm: city, searchTypes: [{ searchType: "DESTINATIONS", pagination: { start: 1, count: 3 } }], currency,
    });
    if (!dr.ok) return fail(dr, `http_${dr.status}`);
    const destino = pickDestination(dr.json, city);
    // 2) Productos: con consulta, texto libre filtrado por destino; sin consulta, los mejor calificados del destino.
    let list: unknown;
    if (query || !destino) {
      const productFiltering: Record<string, unknown> = {};
      if (destino) productFiltering.destination = destino.id;
      if (from) productFiltering.dateRange = { from, ...(to ? { to } : {}) };
      const pr = await viatorPost(d, "/search/freetext", {
        searchTerm: destino ? (query || city) : `${query} ${city}`.trim(),
        ...(Object.keys(productFiltering).length ? { productFiltering } : {}),
        searchTypes: [{ searchType: "PRODUCTS", pagination: { start: 1, count: max } }],
        currency,
      });
      if (!pr.ok) return fail(pr, `http_${pr.status}`);
      list = pr.json?.products?.results;
    } else {
      const pr = await viatorPost(d, "/products/search", {
        filtering: { destination: destino.id, ...(from ? { startDate: from } : {}), ...(to ? { endDate: to } : {}) },
        sorting: { sort: "TRAVELER_RATING", order: "DESCENDING" },
        pagination: { start: 1, count: max },
        currency,
      });
      if (!pr.ok) return fail(pr, `http_${pr.status}`);
      list = pr.json?.products;
    }
    const results = mapViatorProducts(list, max);
    if (!results.length) {
      // Vacío: no se guarda en caché (para no esconder 6 h un problema de parseo) y se dice por qué.
      const raw = Array.isArray(list) ? list as any[] : [];
      let ruta: string | null = null;
      try { ruta = raw[0]?.productUrl ? new URL(String(raw[0].productUrl)).pathname.slice(0, 60) : null; } catch { ruta = "invalida"; }
      const base = await ok(results, new Date(now()).toISOString(), false, destino);
      return { ...base, diagnostico: { recibidos: raw.length, ruta_ejemplo: ruta, claves: raw[0] ? Object.keys(raw[0]).slice(0, 15) : [] } } as ViatorResult;
    }
    const put = Promise.resolve(cachePut(d.store, key, VIATOR_ENGINE, { results, destino })).catch(() => { /* la caché es opcional */ });
    if (d.background) d.background(put); else await put;
    return ok(results, new Date(now()).toISOString(), false, destino);
  } catch (e) {
    return fail(null, (e as Error)?.name === "AbortError" ? "timeout" : "fetch_error");
  }
}
