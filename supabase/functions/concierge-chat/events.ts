// Herramienta search_events de Iato (Event Radar): eventos reales de Google Events vía SerpApi
// (engine=google_events, https://serpapi.com/google-events-api). Mismo patrón que webSearch.ts:
// caché compartida de 6 h en public.serp_cache (llave = ciudad + fechas + consulta), bolsa de
// búsquedas en vivo del plan (live_search_take), freno de gasto de la cuenta y registro de costo.
// Lógica sin Deno: las dependencias llegan por parámetro (Vitest las simula).
//
// Qué devuelve SerpApi en events_results (documentación, 23-oct-2026): title, date.start_date
// ("Dec 7"), date.when ("Sat, Dec 7, 8 – 11 PM"), address[], venue{name,link}, event_location_map,
// ticket_info[{source, link, link_type:"tickets"|…}], thumbnail. No trae precio de boleto: Iato nunca
// lo muestra. Parámetros documentados: q (con la ciudad), location, no_cache. No se usan hl/gl/htichips
// (no aparecen en la página de la API): las fechas se filtran aquí.

import {
  type AccountBrake, cacheGet, cacheKey, cachePut, type CacheStore, freshnessOf, isSerpQuotaError, type LiveGate,
} from "../_shared/serpCache.ts";
import { normText } from "./context.ts";
import type { TmEvent, TmQuery, TmResult } from "../_shared/ticketmaster.ts";

export const EVENTS_ENGINE = "google_events";
export const MAX_EVENTS = 6;

export interface EventTicket { fuente: string; link: string }
export interface EventResult {
  title: string;
  /** YYYY-MM-DD si se pudo leer la fecha de Google; si no, null y queda `cuando_google`. */
  fecha: string | null;
  /** HH:MM (24 h) si Google la trae. */
  hora: string | null;
  /** Fecha y hora en español ("sáb 7 dic · 20:00"); si no se pudo leer, el texto de Google. */
  cuando: string;
  recinto?: string;
  direccion?: string;
  /** Solo enlaces de venta de boletos (link_type "tickets"): sitio de boletos, no una compra hecha. */
  boletos: EventTicket[];
  miniatura?: string;
  /** De dónde salió: "ticketmaster" (Discovery API) o "google_events" (por omisión). */
  fuente?: "ticketmaster" | "google_events";
  /** Ticketmaster: "onsale" (en venta) u "offsale" (agotado / fuera de venta). Nunca cancelados. */
  estado?: "onsale" | "offsale";
  /** Ticketmaster: página oficial de compra (campo `url`). */
  url?: string;
  categoria?: string;
  lat?: number;
  lng?: number;
  /** Ticketmaster: solo si publica priceRanges ("desde"; puede cambiar). */
  precio_desde?: { amount: number; currency: string };
}

export interface EventSearchDeps {
  fetchImpl: typeof fetch;
  serpKey?: string;
  store?: CacheStore | null;
  gate?: LiveGate;
  brake?: AccountBrake;
  onLive?: (ok: boolean) => void | Promise<void>;
  timeoutMs?: number;
  now?: () => number;
  background?: (p: Promise<unknown>) => void;
  /** Ticketmaster (fuente primaria si hay llave). Sin esto, solo Google Events, como antes. */
  ticketmaster?: (q: TmQuery) => Promise<TmResult>;
  /** Ubicación física (con permiso) cuando el turno es "aquí" (turnPlace.scope === "here"). */
  nearCoords?: { lat: number; lng: number } | null;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\//i.test(v.trim()) ? v.trim() : undefined);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/**
 * "Dec 7", "7 dic", "December 7" → YYYY-MM-DD. Google no da el año: se toma el de la referencia (inicio
 * del rango pedido o hoy) y, si la fecha quedaría más de 60 días antes, el siguiente.
 */
export function parseEventDate(startDate: unknown, refISO: string): string | null {
  const s = normText(startDate);
  let m = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  let month: number | undefined, day: number | undefined;
  if (m && MONTHS[m[1]]) { month = MONTHS[m[1]]; day = Number(m[2]); } else {
    m = s.match(/\b(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?/);
    if (m && MONTHS[m[2]]) { month = MONTHS[m[2]]; day = Number(m[1]); }
  }
  if (!month || !day || day > 31 || !ISO.test(refISO)) return null;
  const ref = Date.parse(`${refISO}T00:00:00Z`);
  let year = Number(refISO.slice(0, 4));
  const at = (y: number) => Date.parse(`${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`);
  if (!Number.isFinite(at(year))) return null;
  if (at(year) < ref - 60 * 86400000) year += 1;
  const d = new Date(at(year));
  return Number.isFinite(d.getTime()) && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
}

/** Hora de inicio de "Sat, Dec 7, 8 – 11 PM" / "8:30 PM" / "20:00" → "20:00". */
export function parseEventTime(when: unknown): string | null {
  const s = String(when ?? "");
  const ampm = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:[–-]\s*\d{1,2}(?::\d{2})?\s*)?([AaPp])\.?\s?[Mm]\.?/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/p/i.test(ampm[3])) h += 12;
    return `${String(h).padStart(2, "0")}:${ampm[2] ?? "00"}`;
  }
  const h24 = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return h24 ? `${h24[1].padStart(2, "0")}:${h24[2]}` : null;
}

export function formatEventWhen(fecha: string | null, hora: string | null, fallback: string): string {
  if (!fecha) return clean(fallback, 120);
  const d = new Date(`${fecha}T12:00:00Z`);
  const txt = `${DIA[d.getUTCDay()]} ${d.getUTCDate()} ${MES[d.getUTCMonth()]}`;
  return hora ? `${txt} · ${hora}` : txt;
}

/** events_results de SerpApi → lo que ve el modelo y lo que arma las cards. Filtra por el rango pedido. */
export function mapGoogleEvents(json: any, range: { from?: string | null; to?: string | null } = {}, todayISO = new Date().toISOString().slice(0, 10)): EventResult[] {
  const from = range.from && ISO.test(range.from) ? range.from : null;
  const to = range.to && ISO.test(range.to) ? range.to : from;
  const ref = from ?? todayISO;
  const list = Array.isArray(json?.events_results) ? json.events_results : [];
  const out: EventResult[] = [];
  for (const e of list) {
    const title = clean(e?.title, 160);
    if (!title) continue;
    const when = clean(e?.date?.when, 160);
    const fecha = parseEventDate(e?.date?.start_date ?? when, ref);
    // Con rango pedido, solo lo que cae dentro (si la fecha no se pudo leer, no se afirma que caiga).
    if (from && (!fecha || fecha < from || (to && fecha > to))) continue;
    const hora = parseEventTime(when);
    const address = Array.isArray(e?.address) ? e.address.map((a: unknown) => clean(a, 120)).filter(Boolean) : [];
    const recinto = clean(e?.venue?.name, 120) || undefined;
    const direccion = address.join(", ").slice(0, 200) || undefined;
    const boletos: EventTicket[] = (Array.isArray(e?.ticket_info) ? e.ticket_info : [])
      .filter((t: any) => String(t?.link_type ?? "tickets").toLowerCase() === "tickets" && https(t?.link) && clean(t?.source, 40))
      .slice(0, 2)
      .map((t: any) => ({ fuente: clean(t.source, 40), link: https(t.link)! }));
    out.push({
      title, fecha, hora, cuando: formatEventWhen(fecha, hora, when || clean(e?.date?.start_date, 40)),
      ...(recinto ? { recinto } : {}), ...(direccion ? { direccion } : {}), boletos,
      ...(https(e?.thumbnail) ? { miniatura: https(e.thumbnail) } : {}),
    });
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

/** Consulta para Google Events: lo que pidió + ciudad (+ mes si el rango cae en un solo mes). */
export function eventsQuery(args: { city: string; query?: string; from?: string | null; to?: string | null }): string {
  const what = clean(args.query, 80) || "eventos";
  let q = `${what} en ${clean(args.city, 80)}`;
  const from = args.from && ISO.test(args.from) ? args.from : null;
  const to = args.to && ISO.test(args.to) ? args.to : from;
  if (from && to && from.slice(0, 7) === to.slice(0, 7)) q += ` ${MES_LARGO[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  return q.slice(0, 200);
}

/**
 * ¿El usuario pidió eventos? Solo así Iato llama a search_events (cada búsqueda cuesta): eventos,
 * conciertos, teatro, deportes, festivales… o "qué hacer" con una fecha concreta.
 */
const EVENT_WORDS = /\b(eventos?|conciertos?|concert\w*|teatro|obras? de teatro|musical(es)?|opera|ballet|espectaculos?|shows?|stand ?up|festival(es)?|partidos?|futbol|beisbol|basquet\w*|nba|nfl|mlb|f1|formula 1|lucha libre|box|boletos? para|entradas? para|que hay (este|el) (fin|sabado|domingo|viernes))\b/;
const WHAT_TO_DO = /\b(que (hacer|hay que hacer|puedo hacer|hago)|planes?)\b/;
const DATE_MARK = /\b(hoy|manana|esta noche|este (fin de semana|finde|sabado|domingo|viernes|lunes|martes|miercoles|jueves|mes)|el (sabado|domingo|viernes|lunes|martes|miercoles|jueves)|fin de semana|del \d{1,2} al \d{1,2}|\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|(en|de) (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/;
export function eventsRequested(message: unknown): boolean {
  const m = normText(message);
  return EVENT_WORDS.test(m) || (WHAT_TO_DO.test(m) && DATE_MARK.test(m));
}

async function fetchJson(fetchImpl: typeof fetch, url: string, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(t);
  }
}

async function runGoogleEventSearch(args: Record<string, unknown>, deps: EventSearchDeps): Promise<Record<string, unknown>> {
  const city = clean(args.city, 80);
  if (!city) return { error: "falta_ciudad" };
  const now = deps.now ?? Date.now;
  const todayISO = new Date(now()).toISOString().slice(0, 10);
  const from = typeof args.date_from === "string" && ISO.test(args.date_from) ? args.date_from : null;
  const toRaw = typeof args.date_to === "string" && ISO.test(args.date_to) ? args.date_to : null;
  const to = toRaw && from && toRaw < from ? from : toRaw ?? from;
  const query = clean(args.query, 80);
  const q = eventsQuery({ city, query, from, to });
  // La llave: ciudad, fechas y consulta (sin la api_key). Dos personas con la misma pregunta pagan una.
  const key = await cacheKey(EVENTS_ENGINE, { q, city: normText(city), from: from ?? "", to: to ?? "" });
  const ok = (events: EventResult[], consulted_at: string, extra: Record<string, unknown> = {}) =>
    ({ ok: true, source: EVENTS_ENGINE, results: events, consulted_at, ...extra });

  const cached = await cacheGet(deps.store, key);
  if (cached && freshnessOf(cached, now()).fresh) {
    return ok(((cached.response as { results?: EventResult[] })?.results ?? []), cached.fetched_at, { from_cache: true });
  }
  const saved = () => (cached ? ok(((cached.response as { results?: EventResult[] })?.results ?? []), cached.fetched_at, { from_cache: true, precio_guardado: true }) : null);

  if (!deps.serpKey) return { error: "no_configurado" };
  let paused: "budget" | "quota" | null = null;
  try { paused = deps.brake ? await deps.brake.paused() : null; } catch { paused = null; }
  if (paused) return saved() ?? { error: "busquedas_en_pausa" };

  let refund: (() => Promise<void>) | undefined;
  if (deps.gate) {
    const d = await deps.gate();
    if (!d.allow) return saved() ?? { code: "FREE_LIMIT_REACHED", limite_uso_justo: true, motivo: "Se alcanzó el límite de búsquedas en vivo del plan." };
    refund = (d as { refund?: () => Promise<void> }).refund;
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", EVENTS_ENGINE);
  url.searchParams.set("q", q);
  url.searchParams.set("api_key", deps.serpKey);
  let r: { status: number; ok: boolean; json: unknown };
  try {
    r = await fetchJson(deps.fetchImpl, url.toString(), deps.timeoutMs ?? 7000);
  } catch (e) {
    if (refund) await refund().catch(() => {});
    return { error: (e as Error)?.name === "AbortError" ? "timeout" : "tool_fetch_error" };
  }
  const billable = r.ok && !!r.json && typeof r.json === "object" && !(r.json as { error?: unknown }).error;
  const live = Promise.resolve().then(() => deps.onLive?.(billable)).catch(() => { /* registrar nunca rompe la búsqueda */ });
  if (deps.background) deps.background(live); else await live;
  if (!billable) {
    if (refund) await refund().catch(() => {});
    if (deps.brake && isSerpQuotaError(r.status, r.json)) {
      try { await deps.brake.tripQuota(); } catch { /* el freno es una ayuda */ }
    }
    const msg = String((r.json as { error?: unknown } | null)?.error ?? "");
    if (r.ok && /no results|hasn't returned any results/i.test(msg)) return ok([], new Date(now()).toISOString());
    return { error: `http_${r.status}` };
  }
  const results = mapGoogleEvents(r.json, { from, to }, todayISO);
  const put = Promise.resolve(cachePut(deps.store, key, EVENTS_ENGINE, { results })).catch(() => { /* la caché es opcional */ });
  if (deps.background) deps.background(put); else await put;
  return ok(results, new Date(now()).toISOString());
}

// ═══ Ticketmaster (fuente primaria) + Google Events (respaldo o complemento) ═══

/** Con tantos eventos de Ticketmaster ya no se gasta una búsqueda de SerpApi (la bolsa es chica). */
export const TM_ENOUGH = 3;

const DIA_TM = (fecha: string | null, hora: string | null, fallback: string) => formatEventWhen(fecha, hora, fallback);

/** Evento de Ticketmaster → el mismo formato que ve el modelo y que arma las cards. */
export function fromTicketmaster(e: TmEvent): EventResult {
  return {
    title: e.title, fecha: e.fecha, hora: e.hora, cuando: DIA_TM(e.fecha, e.hora, e.fecha ?? ""),
    ...(e.recinto ? { recinto: e.recinto } : {}), ...(e.direccion ? { direccion: e.direccion } : {}),
    boletos: [{ fuente: "Ticketmaster", link: e.url }], ...(e.miniatura ? { miniatura: e.miniatura } : {}),
    fuente: "ticketmaster", estado: e.estado, url: e.url, ...(e.categoria ? { categoria: e.categoria } : {}),
    ...(typeof e.lat === "number" && typeof e.lng === "number" ? { lat: e.lat, lng: e.lng } : {}),
    ...(e.precio ? { precio_desde: { amount: e.precio.min, currency: e.precio.currency } } : {}),
  };
}

const words = (s: unknown) => normText(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
const overlap = (a: unknown, b: unknown) => {
  const x = words(a), y = new Set(words(b));
  if (!x.length || !y.size) return 0;
  return x.filter((w) => y.has(w)).length / Math.min(x.length, y.size);
};

/** ¿Es el mismo evento? Mismo día + nombre parecido + mismo recinto (si ambos lo traen). */
export function sameEvent(a: EventResult, b: EventResult): boolean {
  if (!a.fecha || !b.fecha || a.fecha !== b.fecha) return false;
  const na = normText(a.title), nb = normText(b.title);
  const nameMatch = na === nb || na.includes(nb) || nb.includes(na) || overlap(a.title, b.title) >= 0.6;
  if (!nameMatch) return false;
  if (!a.recinto || !b.recinto) return true;
  const ra = normText(a.recinto), rb = normText(b.recinto);
  return ra === rb || ra.includes(rb) || rb.includes(ra) || overlap(a.recinto, b.recinto) >= 0.5;
}

/** Ticketmaster primero; de Google Events solo lo que no esté ya (desduplicado por nombre + fecha + recinto). */
export function mergeEvents(primary: EventResult[], extra: EventResult[], max = MAX_EVENTS): EventResult[] {
  const out = [...primary];
  for (const g of extra) {
    if (out.length >= max) break;
    if (!out.some((e) => sameEvent(e, g))) out.push(g);
  }
  return out.slice(0, max);
}

/**
 * Ticketmaster ordena por fecha: con más resultados que los que se muestran, son los PRIMEROS del rango,
 * no todos. Caso E2E 28-oct-2026: "conciertos en CDMX el próximo mes" → "Ticketmaster devuelve 6
 * conciertos en noviembre, todos entre el 1 y el 3" (eran los 6 primeros por fecha).
 */
export function partialNote(found: number, from: string | null, to: string | null): Record<string, unknown> {
  if (found <= MAX_EVENTS) return {};
  const rango = from && to && from !== to ? ` (${from} a ${to})` : "";
  return {
    parcial: true, mostrados: MAX_EVENTS,
    nota: `Son los primeros ${MAX_EVENTS} por fecha de un rango con más eventos${rango}. No digas que solo hay estos ni des un total: di que son los primeros por fecha y que hay más en Ticketmaster.`,
  };
}

/**
 * search_events: Ticketmaster como fuente primaria cuando hay llave (gratis, con su propio límite) y
 * Google Events (SerpApi, con la bolsa del plan y el freno de gasto) como respaldo o complemento.
 * Usa la ubicación física solo si el turno es "aquí"; si no, la ciudad pedida.
 */
export async function runEventSearch(args: Record<string, unknown>, deps: EventSearchDeps): Promise<Record<string, unknown>> {
  if (!deps.ticketmaster) return runGoogleEventSearch(args, deps);
  const city = clean(args.city, 80);
  if (!city && !deps.nearCoords) return { error: "falta_ciudad" };
  const from = typeof args.date_from === "string" && ISO.test(args.date_from) ? args.date_from : null;
  const toRaw = typeof args.date_to === "string" && ISO.test(args.date_to) ? args.date_to : null;
  const to = toRaw && from && toRaw < from ? from : toRaw ?? from;
  const query = clean(args.query, 80);
  const t0 = (deps.now ?? Date.now)();
  let tm: TmResult;
  try {
    tm = await deps.ticketmaster({ city, coords: deps.nearCoords ?? null, from, to, category: query || null, keyword: query || null });
  } catch {
    tm = { ok: false, code: "ticketmaster_error", motivo: "Ticketmaster no respondió." };
  }
  const tmOk = tm.ok === true ? tm : null;
  const primary = tmOk ? tmOk.results.map(fromTicketmaster) : [];
  if (tmOk && primary.length >= TM_ENOUGH) {
    return { ok: true, source: "ticketmaster", results: primary.slice(0, MAX_EVENTS), consulted_at: tmOk.consulted_at, ...(tmOk.from_cache ? { from_cache: true } : {}),
      ...partialNote(primary.length, from, to) };
  }
  const aviso = tmOk ? undefined : (tm as { motivo?: string }).motivo;
  // El respaldo usa lo que queda del tiempo de la herramienta (Ticketmaster puede tardar hasta 8 s).
  const left = Math.max(3000, (deps.timeoutMs ?? 7000) - ((deps.now ?? Date.now)() - t0));
  const g = city ? await runGoogleEventSearch(args, { ...deps, timeoutMs: Math.min(deps.timeoutMs ?? 7000, left) }) : { error: "falta_ciudad" };
  const gResults = g.ok === true && Array.isArray(g.results) ? g.results as EventResult[] : [];
  if (tmOk) {
    const merged = mergeEvents(primary, gResults);
    const both = gResults.length > 0 && merged.length > primary.length;
    return { ok: true, source: both ? "ticketmaster+google_events" : "ticketmaster", results: merged, consulted_at: tmOk.consulted_at,
      ...(tmOk.from_cache && !both ? { from_cache: true } : {}) };
  }
  // Sin Ticketmaster: Google Events tal cual, con el aviso honesto de por qué no hay Ticketmaster.
  return { ...g, ...(aviso ? { aviso_ticketmaster: aviso } : {}) };
}
