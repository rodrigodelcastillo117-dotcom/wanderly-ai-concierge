// Ferris en vivo de Ferryhopper (servidor MCP público, mcp.ferryhopper.com). Sin dependencias de Deno:
// lo usa ferry-search y se prueba con Vitest con respuestas grabadas del servidor (2026-10-24).
//
// Qué es (partners.ferryhopper.com/mcp, 2026-10-24): "Search ports and connections across 35 countries and
// 220+ ferry operators", "real-time ferry itineraries with indicative prices", "a direct link to
// Ferryhopper.com for booking and payment". No pide llave ni registro; se habla JSON-RPC 2.0 por HTTP
// (Streamable HTTP: la respuesta llega como evento SSE "data: {...}").
//   * tools/call search_ferry_trips {legs:[{departureLocation, arrivalLocation, departureDate}]} →
//     structuredContent.legs[].options[].segments[] con salida/llegada (hora del puerto), naviera
//     (marketingCompany), barco y accommodations[].expectedPrice.totalPriceInCents.
//   * Moneda y pasajeros: el widget oficial del servidor (ui://widgets/ferry-trips-picker.html) formatea
//     ese monto como EUR y arma el enlace con passengers=1: es el precio de UN pasajero en euros.
//   * El enlace de compra es el del widget: /en/booking/results?utm_source=llm_mcp&aff_uid=<affiliateId de
//     _meta.ferryhopper/widgetConfig>&IDSCode=…&itinerary=…&dates=…&passengers=…
// Reglas de IATOS: se muestra "desde €X por persona · Ferryhopper, consultado HH:MM" (precio indicativo
// de Ferryhopper, se confirma al comprar); nunca "Reservado". Caché corta (30 min) en public.serp_cache,
// bolsa de búsquedas del plan (live_search_take) y tope global de la cuenta con check_rate_limit.

import { cacheGet, cacheKey, type CacheStore, freshnessOf, type GateDecision, type LiveGate } from "./serpCache.ts";
import { ferryhopperResultsUrl } from "./booking/groundLinks.ts";

export const FERRY_ENGINE = "ferryhopper_trips";
export const FERRYHOPPER_MCP_URL = "https://mcp.ferryhopper.com/mcp";
export const FERRY_CACHE_TTL_SECONDS = 30 * 60;
export const MAX_FERRY_OPTIONS = 6;
/** Moneda del monto que da Ferryhopper (la que usa su widget oficial). */
export const FERRY_CURRENCY = "EUR";

export interface FerryOption {
  id: string;
  naviera: string;
  barco: string | null;
  /** "HH:MM" tal como la da Ferryhopper (hora local de cada puerto; por eso no se calcula la duración). */
  sale: string;
  llega: string;
  /** Fecha de llegada si es otro día (AAAA-MM-DD). */
  llega_fecha: string | null;
  /** El asiento o cubierta más barato que listó Ferryhopper (1 pasajero, EUR). Sin dato, null. */
  desde: { monto: number; moneda: "EUR" } | null;
  cabina: boolean;
  vehiculos: boolean;
  /** Enlace de compra en Ferryhopper con esta salida (formato del widget oficial). */
  url: string;
}

export type FerryResult =
  | { ok: true; fuente: "Ferryhopper"; consultado_at: string; from_cache: boolean; origen: { nombre: string; codigo: string } | null;
      destino: { nombre: string; codigo: string } | null; fecha: string; pasajeros: number; results: FerryOption[];
      /** Búsqueda de la ruta en Ferryhopper con los pasajeros del viaje (sin elegir salida). */
      url_ruta: string | null; nota: string; code?: undefined }
  | { ok: false; code: "entrada_invalida" | "ferry_ocupado" | "ferry_error" | "FREE_LIMIT_REACHED"; motivo: string; soft?: boolean; info?: Record<string, unknown> };

export interface FerryDeps {
  fetchImpl: typeof fetch;
  store?: CacheStore | null;
  gate?: LiveGate;
  /** Ranura de la cuenta (check_rate_limit global); false = demasiadas consultas. */
  limiter?: () => Promise<boolean>;
  timeoutMs?: number;
  now?: () => number;
  background?: (p: Promise<unknown>) => void;
  onLive?: (ok: boolean) => void;
}

export const FERRY_NOTE = "Precio indicativo de Ferryhopper para 1 pasajero en asiento o cubierta; el total con tus pasajeros, cabina o auto se confirma al comprar en Ferryhopper.";

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (v: unknown) => clean(v, 80).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** Cuerpo JSON-RPC de la búsqueda (exportado para probar lo que se manda). */
export function searchBody(from: string, to: string, date: string, id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_ferry_trips", arguments: { legs: [{ departureLocation: from, arrivalLocation: to, departureDate: date }] } } };
}

/** Respuesta del servidor MCP: JSON directo o eventos SSE ("data: {...}"). */
export function parseMcpResponse(text: string): any | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (t.startsWith("{")) { try { return JSON.parse(t); } catch { return null; } }
  for (const line of t.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try { const j = JSON.parse(line.slice(5).trim()); if (j && (j.result || j.error)) return j; } catch { /* sigue */ }
  }
  return null;
}

/** IDSCode del widget oficial: <salida><llegada><naviera><AAAAMMDD><HHMM><AAAAMMDD><HHMM>-<barco>. */
export function idsCode(s: any): string | null {
  const a = STAMP.exec(String(s?.departureDateTime ?? ""));
  const b = STAMP.exec(String(s?.arrivalDateTime ?? ""));
  const dp = clean(s?.departurePort?.code, 6), ap = clean(s?.arrivalPort?.code, 6), co = clean(s?.ownerCompany?.code, 8), v = clean(s?.vessel?.code, 12);
  if (!a || !b || !dp || !ap || !co || !v) return null;
  return `${dp}${ap}${co}${a[1].replace(/-/g, "")}${a[2]}${a[3]}${b[1].replace(/-/g, "")}${b[2]}${b[3]}-${v}`;
}

/** Enlace de compra de UNA salida (como el widget de Ferryhopper), con los pasajeros del viaje. */
export function optionUrl(segments: any[], cfg: { baseUrl?: string; affiliateId?: string }, passengers: number): string | null {
  const base = String(cfg.baseUrl ?? "");
  if (!/^https:\/\/www\.ferryhopper\.com$/.test(base) || !segments.length) return null;
  const codes = segments.map(idsCode);
  if (codes.some((c) => !c)) return null;
  const route = ferryhopperResultsUrl({
    ports: [clean(segments[0].departurePort?.code, 6), ...segments.map((s) => clean(s.arrivalPort?.code, 6))],
    dates: segments.map((s) => String(s.departureDateTime).slice(0, 10)), passengers,
  });
  if (!route) return null;
  const u = new URL(route);
  u.searchParams.set("utm_source", "llm_mcp");
  const aff = clean(cfg.affiliateId, 40);
  if (/^[A-Za-z0-9_-]+$/.test(aff)) u.searchParams.set("aff_uid", aff);
  u.searchParams.set("IDSCode", codes.join(","));
  return u.toString();
}

/** Opciones de search_ferry_trips → tarjetas (máx. 6, por hora de salida). Sin enlace válido no se muestra. */
export function mapFerryOptions(json: any, passengers: number, max = MAX_FERRY_OPTIONS): { options: FerryOption[]; from: { nombre: string; codigo: string } | null; to: { nombre: string; codigo: string } | null } {
  const result = json?.result ?? {};
  const cfg = result?._meta?.["ferryhopper/widgetConfig"] ?? {};
  const leg = result?.structuredContent?.legs?.[0];
  const port = (p: any) => (p?.code ? { nombre: clean(p.name, 60), codigo: clean(p.code, 6) } : null);
  const out: FerryOption[] = [];
  for (const o of Array.isArray(leg?.options) ? leg.options : []) {
    const segs = Array.isArray(o?.segments) ? o.segments : [];
    if (!segs.length) continue;
    const first = segs[0], last = segs[segs.length - 1];
    const a = STAMP.exec(String(first?.departureDateTime ?? ""));
    const b = STAMP.exec(String(last?.arrivalDateTime ?? ""));
    const url = optionUrl(segs, cfg, passengers);
    if (!a || !b || !url) continue;
    // Lo más barato que NO es cabina ni vehículo (asiento o cubierta), sumando tramos; si un tramo no
    // tiene asiento con precio, no se da "desde".
    let total = 0;
    let priced = true;
    for (const s of segs) {
      const seats = (Array.isArray(s?.accommodations) ? s.accommodations : [])
        .filter((x: any) => !/CABIN|VEHICLE|CAR|PET/i.test(String(x?.type ?? "")))
        .map((x: any) => Number(x?.expectedPrice?.totalPriceInCents)).filter((n: number) => Number.isFinite(n) && n > 0);
      if (!seats.length) { priced = false; break; }
      total += Math.min(...seats);
    }
    out.push({
      id: clean(o.id, 80),
      naviera: clean(first?.marketingCompany?.name ?? first?.ownerCompany?.name, 60) || "Naviera",
      barco: clean(first?.vessel?.name, 60) || null,
      sale: `${a[2]}:${a[3]}`, llega: `${b[2]}:${b[3]}`, llega_fecha: b[1] !== a[1] ? b[1] : null,
      desde: priced && total > 0 ? { monto: Math.round(total) / 100, moneda: FERRY_CURRENCY } : null,
      cabina: segs.some((s: any) => s?.hasCabin === true), vehiculos: segs.some((s: any) => s?.hasVehicles === true),
      url,
    });
  }
  out.sort((x, y) => x.sale.localeCompare(y.sale));
  return { options: out.slice(0, max), from: port(leg?.departurePort), to: port(leg?.arrivalPort) };
}

export async function runFerrySearch(args: Record<string, unknown>, d: FerryDeps): Promise<FerryResult> {
  const now = d.now ?? Date.now;
  const from = clean(args.from, 80);
  const to = clean(args.to, 80);
  const date = typeof args.date === "string" && ISO.test(args.date) ? args.date : "";
  const passengers = Math.min(20, Math.max(1, Math.round(Number(args.passengers) || 1)));
  const today = new Date(now()).toISOString().slice(0, 10);
  if (!from || !to || norm(from) === norm(to) || !date) return { ok: false, code: "entrada_invalida", motivo: "Escribe puerto de salida, de llegada y una fecha." };
  if (date < today) return { ok: false, code: "entrada_invalida", motivo: "La fecha ya pasó." };

  const key = await cacheKey(FERRY_ENGINE, { from: norm(from), to: norm(to), date, pax: passengers });
  const done = (m: ReturnType<typeof mapFerryOptions>, at: string, fromCache: boolean): FerryResult => ({
    ok: true, fuente: "Ferryhopper", consultado_at: at, from_cache: fromCache, origen: m.from, destino: m.to, fecha: date, pasajeros: passengers,
    results: m.options,
    url_ruta: m.from && m.to ? ferryhopperResultsUrl({ ports: [m.from.codigo, m.to.codigo], dates: [date], passengers }) : null,
    nota: FERRY_NOTE,
  });
  const cached = await cacheGet(d.store, key);
  if (cached && freshnessOf(cached, now()).fresh) {
    const r = cached.response as ReturnType<typeof mapFerryOptions>;
    if (r && Array.isArray(r.options)) return done(r, cached.fetched_at, true);
  }
  if (d.limiter && !(await d.limiter())) return { ok: false, code: "ferry_ocupado", motivo: "Hay muchas consultas de ferris en este momento; intenta en un minuto." };
  let refund: (() => Promise<void>) | undefined;
  if (d.gate) {
    const g = await d.gate();
    if (!g.allow) {
      const denied = g as Extract<GateDecision, { allow: false }>;
      return { ok: false, code: "FREE_LIMIT_REACHED", soft: denied.soft, info: denied.info, motivo: "Se alcanzó el límite de búsquedas en vivo del plan." };
    }
    refund = (g as Extract<GateDecision, { allow: true }>).refund;
  }
  const fail = async (error: string): Promise<FerryResult> => {
    if (refund) await refund().catch(() => {});
    d.onLive?.(false);
    return { ok: false, code: "ferry_error", motivo: `Ferryhopper no respondió (${error}); puedes buscar directo en Ferryhopper.` };
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), d.timeoutMs ?? 12000);
  try {
    const res = await d.fetchImpl(FERRYHOPPER_MCP_URL, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(searchBody(from, to, date)),
    });
    const json = parseMcpResponse(await res.text());
    if (!res.ok || !json || json.error || json.result?.isError) return fail(res.ok ? "respuesta_invalida" : `http_${res.status}`);
    const mapped = mapFerryOptions(json, passengers);
    d.onLive?.(true);
    // También se guarda una búsqueda sin salidas (puerto sin servicio ese día): es un dato real.
    if (d.store) {
      const put = Promise.resolve(d.store.put(key, FERRY_ENGINE, mapped, FERRY_CACHE_TTL_SECONDS)).catch(() => {});
      if (d.background) d.background(put); else await put;
    }
    return done(mapped, new Date(now()).toISOString(), false);
  } catch (e) {
    return fail((e as Error)?.name === "AbortError" ? "tiempo_agotado" : "sin_conexion");
  } finally {
    clearTimeout(timer);
  }
}

/** "consultado 14:05" (hora local de quien mira). */
export function consultedLabel(iso: string, fromCache: boolean): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const hh = String(t.getHours()).padStart(2, "0"), mm = String(t.getMinutes()).padStart(2, "0");
  return `${fromCache ? "guardado" : "en vivo"} · consultado ${hh}:${mm}`;
}
