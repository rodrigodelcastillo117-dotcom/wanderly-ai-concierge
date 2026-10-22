// Herramienta web_search de Iato: resultados orgánicos de Google (SerpApi) con caché compartida de
// 24 h (public.serp_cache, motor "google_web"), la bolsa de búsquedas en vivo del plan
// (live_search_take) y registro de costo (ai_usage_log). Si SerpApi no está disponible o el plan llegó
// a su límite, respaldo gratuito: búsqueda de Wikipedia en español (sin llave), citada como tal.
// Lógica sin Deno: las dependencias llegan por parámetro (Vitest las simula).
//
// Por qué existe: "¿dónde está la Centurion dentro de la T1 de CDMX?" no tiene respuesta en TripAdvisor;
// sin una herramienta de datos prácticos Iato inventaba "dos salas, entre las puertas 8 y 11".

import {
  type AccountBrake, cacheGet, cacheKey, cachePut, type CacheStore, freshnessOf, isSerpQuotaError, type LiveGate,
} from "../_shared/serpCache.ts";

export const WEB_ENGINE = "google_web";

export interface WebResult { title: string; snippet: string; link: string; source: string }

export interface WebSearchDeps {
  fetchImpl: typeof fetch;
  serpKey?: string;
  store?: CacheStore | null;
  gate?: LiveGate;
  /**
   * Freno de toda la cuenta de SerpApi (presupuesto del mes/día y pausa de 1 h por cuota agotada), el
   * mismo que usan vuelos, hoteles y lugares (AUD-IATO-06: antes Iato seguía gastando con la cuenta
   * en pausa y no avisaba a las demás funciones cuando SerpApi decía que no quedaban búsquedas).
   */
  brake?: AccountBrake;
  /** Búsqueda real cobrada por SerpApi (para ai_usage_log). */
  onLive?: (ok: boolean) => void | Promise<void>;
  timeoutMs?: number;
  now?: () => number;
}

const host = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Lo que se guarda y se manda al modelo: título, fragmento y enlace (https) de cada resultado. */
export function mapSerpOrganic(json: any): { results: WebResult[]; answer?: { text: string; link?: string; source?: string } } {
  const results: WebResult[] = (Array.isArray(json?.organic_results) ? json.organic_results : [])
    .map((r: any) => ({ title: clean(r?.title, 160), snippet: clean(r?.snippet ?? r?.rich_snippet?.top?.extensions?.join(" · "), 400), link: String(r?.link ?? ""), source: clean(r?.source ?? host(String(r?.link ?? "")), 60) }))
    .filter((r: WebResult) => r.title && /^https:\/\//.test(r.link))
    .slice(0, 6);
  const ab = json?.answer_box;
  const abText = clean(ab?.answer ?? ab?.snippet ?? (Array.isArray(ab?.list) ? ab.list.join(" · ") : ""), 500);
  const out: { results: WebResult[]; answer?: { text: string; link?: string; source?: string } } = { results };
  if (abText) out.answer = { text: abText, ...(typeof ab?.link === "string" && /^https:\/\//.test(ab.link) ? { link: ab.link, source: host(ab.link) } : {}) };
  return out;
}

async function fetchJson(fetchImpl: typeof fetch, url: string, timeoutMs: number, headers?: Record<string, string>) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(t);
  }
}

/** Respaldo gratuito: búsqueda en Wikipedia (es). Sin llave; se identifica con User-Agent. */
export async function wikipediaSearch(query: string, deps: Pick<WebSearchDeps, "fetchImpl" | "timeoutMs">) {
  const url = `https://es.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=4`;
  try {
    const r = await fetchJson(deps.fetchImpl, url, Math.min(deps.timeoutMs ?? 5000, 5000), { "User-Agent": "IATOS-Concierge/2.0 (hola@traveliatos.life)" });
    const pages = Array.isArray((r.json as any)?.pages) ? (r.json as any).pages : [];
    return pages.map((p: any) => ({
      title: clean(p?.title, 160),
      snippet: clean(String(p?.excerpt ?? p?.description ?? "").replace(/<[^>]+>/g, ""), 400),
      link: `https://es.wikipedia.org/wiki/${encodeURIComponent(String(p?.key ?? p?.title ?? "").replace(/ /g, "_"))}`,
      source: "es.wikipedia.org",
    })).filter((x: WebResult) => x.title).slice(0, 4) as WebResult[];
  } catch {
    return [] as WebResult[];
  }
}

export async function runWebSearch(args: Record<string, unknown>, deps: WebSearchDeps): Promise<Record<string, unknown>> {
  const query = clean(args.query, 200);
  if (!query) return { error: "falta_query" };
  const gl = typeof args.country === "string" && /^[a-z]{2}$/i.test(args.country) ? args.country.toLowerCase() : "mx";
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 7000;
  const params = { engine: "google", q: query, hl: "es", gl, num: "8" };
  const key = await cacheKey(WEB_ENGINE, params);

  const cached = await cacheGet(deps.store, key);
  if (cached && freshnessOf(cached, now()).fresh) {
    return { ok: true, source: "google_web", ...(cached.response as Record<string, unknown>), consulted_at: cached.fetched_at, from_cache: true };
  }

  const fallback = async (motivo: string) => {
    const wiki = await wikipediaSearch(query, deps);
    if (wiki.length) return { ok: true, source: "wikipedia", results: wiki, nota_fuente: `Respaldo gratuito (Wikipedia) porque ${motivo}: es información general, dilo así.`, consulted_at: new Date(now()).toISOString() };
    return null;
  };

  if (!deps.serpKey) return (await fallback("la búsqueda de Google no está configurada")) ?? { error: "no_configurado" };

  // Cuenta en pausa (presupuesto o cuota): lo guardado con su fecha, o el respaldo gratuito.
  let paused: "budget" | "quota" | null = null;
  try { paused = deps.brake ? await deps.brake.paused() : null; } catch { paused = null; }
  if (paused) {
    if (cached) return { ok: true, source: "google_web", ...(cached.response as Record<string, unknown>), consulted_at: cached.fetched_at, from_cache: true, precio_guardado: true };
    return (await fallback("las búsquedas en vivo de Google están en pausa")) ?? { error: "busquedas_en_pausa" };
  }

  let refund: (() => Promise<void>) | undefined;
  if (deps.gate) {
    const d = await deps.gate();
    if (!d.allow) {
      // Plan sin búsquedas en vivo: lo guardado (aunque esté vencido) con su fecha, o Wikipedia.
      if (cached) return { ok: true, source: "google_web", ...(cached.response as Record<string, unknown>), consulted_at: cached.fetched_at, from_cache: true, precio_guardado: true };
      return (await fallback("se alcanzó el límite de búsquedas en vivo del plan")) ?? { code: "FREE_LIMIT_REACHED", limite_uso_justo: true, motivo: "Se alcanzó el límite de búsquedas en vivo del plan." };
    }
    refund = (d as { refund?: () => Promise<void> }).refund;
  }

  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", deps.serpKey);
  let r: { status: number; ok: boolean; json: unknown };
  try {
    r = await fetchJson(deps.fetchImpl, url.toString(), timeoutMs);
  } catch (e) {
    if (refund) await refund().catch(() => {});
    const fb = await fallback("Google no respondió");
    return fb ?? { error: (e as Error)?.name === "AbortError" ? "timeout" : "tool_fetch_error" };
  }
  const billable = r.ok && !!r.json && typeof r.json === "object" && !(r.json as { error?: unknown }).error;
  try { await deps.onLive?.(billable); } catch { /* registrar nunca rompe la búsqueda */ }
  if (!billable) {
    if (refund) await refund().catch(() => {});
    if (deps.brake && isSerpQuotaError(r.status, r.json)) {
      try { await deps.brake.tripQuota(); } catch { /* el freno es una ayuda, no un requisito */ }
    }
    // SerpApi responde {error:"Google hasn't returned any results"} cuando no hay resultados.
    const msg = String((r.json as { error?: unknown } | null)?.error ?? "");
    if (r.ok && /no results|hasn't returned any results/i.test(msg)) return { ok: true, source: "google_web", results: [] };
    return (await fallback("Google no respondió")) ?? { error: `http_${r.status}` };
  }
  const mapped = mapSerpOrganic(r.json);
  await cachePut(deps.store, key, WEB_ENGINE, mapped);
  return { ok: true, source: "google_web", ...mapped, consulted_at: new Date(now()).toISOString() };
}
