// flights-search { action: "explore" } — "Vuelos baratos desde {origen}" y la pantalla Explorar destinos.
// Sin Deno.serve: se prueba con Vitest (src/test/exploreServer.test.ts) con fixtures.
//
// Motor: SerpApi `google_travel_explore` (destinos con precio, fechas, escalas, duración y
// coordenadas desde un origen). UNA búsqueda por origen y mes, guardada 12 h en la caché compartida
// serp_cache (misma llave para todos los usuarios).
//
// Regla de gasto del dueño:
//  - `live: false` (lo que hace la ventana "Planear viaje" al abrirse y al cambiar de origen): SOLO
//    lee la caché vigente. Nunca llama a SerpApi; sin caché responde `sin_cache` y la pantalla
//    invita a pulsar "Explorar destinos".
//  - `live: true` (solo tras pulsar "Explorar destinos" o "Buscar precios"): pasa por el fetch de la
//    caché compartida (createSerpFetch): un acierto no gasta; un fallo cuenta contra la bolsa del
//    plan (live_search_take) y el freno de la cuenta (serpBrake). Lo cierra finalizeSearchResponse.
// Nunca se inventan precios: un destino sin precio (o en una moneda sin tasa verificable) va con
// precio_mxn = null y la pantalla dice "Sin precio ahora".
import { mainAirport, cityAirports } from "../_shared/airports.ts";
import { cacheGet, cacheKey, type CacheStore, freshnessOf } from "../_shared/serpCache.ts";
import type { FxInfo } from "../_shared/fx.ts";
import { quickIata, type SearchResult } from "./search.ts";

export const EXPLORE_ENGINE = "google_travel_explore";
const SERPAPI = "https://serpapi.com/search.json";
export const EXPLORE_MAX_RESULTS = 40;

export const EXPLORE_NOTA_PRECIO =
  "Precio de referencia por persona, ida y vuelta en clase turista, según Google (Explorar). Se vuelve a consultar antes de comprar.";
export const EXPLORE_SIN_CACHE = (origen: string) =>
  `Aún no hay precios guardados desde ${origen}. Pulsa "Buscar precios" para consultarlos.`;

export type ExploreEnv = {
  serpKey?: string | null;
  /** fetch con caché compartida y cuota (serpFetchFor + liveSearchGateFor). Solo con live. */
  serpFetch?: typeof fetch;
  /** Almacén de la caché compartida, para la lectura sin gasto (live: false). */
  store?: CacheStore | null;
  /** Tasa a MXN con fuente (_shared/fx.ts getRateToMxnInfo). */
  fx?: (code: string) => Promise<FxInfo | null>;
  now?: () => number;
};

export type ExploreDestino = {
  destino: string;
  pais: string | null;
  iata: string | null;
  lat: number | null;
  lng: number | null;
  salida: string | null;
  regreso: string | null;
  escalas: number | null;
  duracion_min: number | null;
  aerolinea: string | null;
  foto: string | null;
  precio_mxn: number | null;
  moneda_original: string | null;
};

/** Parámetros fijos (la caché se comparte por origen y mes; los filtros no parten la llave). */
export function exploreParams(depIata: string, month: number): Record<string, string> {
  return {
    engine: EXPLORE_ENGINE,
    departure_id: depIata,
    month: String(month),
    travel_duration: "2", // una semana
    type: "1", // ida y vuelta
    adults: "1",
    currency: "MXN",
    hl: "es",
    gl: "mx",
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const isoDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const httpsUrl = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null);

/** Destinos de la respuesta de google_travel_explore, en MXN (convertidos con fuente si hace falta). */
export async function parseExplore(json: any, fx?: ExploreEnv["fx"]): Promise<{ destinos: ExploreDestino[]; fx: FxInfo | null; moneda: string }> {
  const moneda = String(json?.search_parameters?.currency ?? "MXN").toUpperCase();
  let rate: FxInfo | null = moneda === "MXN" ? null : fx ? await fx(moneda).catch(() => null) : null;
  const canConvert = moneda === "MXN" || !!rate;
  const list: any[] = Array.isArray(json?.destinations) ? json.destinations : [];
  const destinos = list.map((d): ExploreDestino => {
    const price = num(d?.flight_price);
    const mxn = price != null && price > 0 && canConvert ? Math.round(moneda === "MXN" ? price : price * rate!.rate) : null;
    const code = typeof d?.destination_airport?.code === "string" ? d.destination_airport.code.toUpperCase() : null;
    const known = code ? cityAirports(code) : null;
    return {
      destino: String(d?.name ?? known?.name ?? code ?? "").trim(),
      pais: typeof d?.country === "string" ? d.country : known?.country ?? null,
      iata: code,
      lat: num(d?.gps_coordinates?.latitude) ?? known?.lat ?? null,
      lng: num(d?.gps_coordinates?.longitude) ?? known?.lng ?? null,
      salida: isoDate(d?.start_date),
      regreso: isoDate(d?.end_date),
      escalas: num(d?.number_of_stops),
      duracion_min: num(d?.flight_duration),
      aerolinea: typeof d?.airline === "string" ? d.airline : null,
      foto: httpsUrl(d?.thumbnail),
      precio_mxn: mxn,
      moneda_original: price != null ? moneda : null,
    };
  }).filter((d) => d.destino);
  destinos.sort((a, b) => (a.precio_mxn ?? Infinity) - (b.precio_mxn ?? Infinity));
  if (moneda === "MXN") rate = null;
  return { destinos: destinos.slice(0, EXPLORE_MAX_RESULTS), fx: rate, moneda };
}

export async function exploreDestinations(body: any, env: ExploreEnv): Promise<SearchResult> {
  const now = env.now ?? Date.now;
  const origen = String(body?.origin ?? "").trim().slice(0, 80);
  const dep = mainAirport(origen) ?? quickIata(origen);
  if (!origen || !dep) return { status: 400, body: { ok: false, error: "origen_desconocido", origin: origen } };
  const m = Math.round(Number(body?.month ?? 0));
  const month = Number.isFinite(m) && m >= 0 && m <= 12 ? m : 0;
  const live = body?.live === true;
  const params = exploreParams(dep, month);
  const meta = { origin: origen, dep_iata: dep, month, engine: EXPLORE_ENGINE };

  const respond = async (json: unknown, extra: Record<string, unknown>): Promise<SearchResult> => {
    const p = await parseExplore(json, env.fx);
    const disponible = p.destinos.length > 0;
    return {
      status: 200,
      body: {
        ok: true,
        source: "serpapi",
        disponible,
        results: p.destinos,
        etiqueta_fuente: "Google (Explorar)",
        nota_precio: EXPLORE_NOTA_PRECIO,
        precio_tipo: "referencia",
        moneda: "MXN",
        ...(p.fx ? { fx: { de: p.moneda, tasa: p.fx.rate, fuente: p.fx.source, fecha: p.fx.fetched_at } } : {}),
        ...(disponible ? {} : { motivo: "Google no devolvió destinos con precio desde este origen ahora." }),
        meta,
        ...extra,
      },
    };
  };

  if (!live) {
    // Solo lectura: nunca toca SerpApi ni la bolsa del usuario.
    const key = await cacheKey(EXPLORE_ENGINE, new URLSearchParams(params));
    const row = await cacheGet(env.store, key);
    if (row && freshnessOf(row, now()).fresh) {
      return respond(row.response, { consulted_at: row.fetched_at, estado_dato: "CONSULTADO_EN_VIVO", from_cache: true, precio_guardado: false });
    }
    return {
      status: 200,
      body: { ok: true, source: "none", disponible: false, sin_cache: true, results: [], motivo: EXPLORE_SIN_CACHE(origen), meta },
    };
  }

  if (!env.serpKey) {
    return { status: 200, body: { ok: true, source: "none", disponible: false, results: [], motivo: "Búsqueda de precios no disponible ahora; intenta más tarde.", fallas: ["explore_sin_llave"], meta } };
  }
  const u = new URL(SERPAPI);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("api_key", env.serpKey);
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 18000);
    const r = await (env.serpFetch ?? fetch)(u.toString(), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
    const cache = r.headers.get("x-iatos-cache");
    if (r.ok) {
      const at = r.headers.get("x-iatos-fetched-at") ?? new Date(now()).toISOString();
      return respond(await r.json(), { consulted_at: at, from_cache: cache === "hit" || cache === "stale" });
    }
    const falla = cache === "limit" ? "explore_limite_del_plan" : cache === "paused" ? "explore_busquedas_en_pausa" : `explore_http_${r.status}`;
    if (!cache) console.error("serpapi explore status:", r.status); // nunca la URL: lleva la llave
    return { status: 200, body: { ok: true, source: "serpapi", disponible: false, results: [], motivo: "No pudimos consultar precios ahora.", fallas: [falla], meta } };
  } catch (e) {
    console.error("serpapi explore err:", (e as Error).message);
    return { status: 200, body: { ok: true, source: "none", disponible: false, results: [], motivo: "No pudimos consultar precios ahora.", fallas: ["explore_error"], meta } };
  }
}
