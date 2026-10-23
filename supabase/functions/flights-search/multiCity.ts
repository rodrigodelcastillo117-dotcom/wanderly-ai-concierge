// flights-search { type: "multi", legs: [...] } — varias ciudades con Google Flights (SerpApi
// `google_flights`, type=3 + multi_city_json). Sin Deno.serve: se prueba con fixtures
// (src/test/exploreServer.test.ts).
//
// Google Flights devuelve primero las opciones del PRIMER tramo con el precio TOTAL del itinerario
// (y un departure_token para elegir el siguiente). Así se etiqueta: nunca como precio de un solo
// vuelo ni como una reserva. Pasa por el mismo fetch con caché compartida, bolsa del plan y freno de
// la cuenta que el resto de flights-search; solo se llama tras una acción explícita del usuario.
import { googleFlightResult, MOTIVO_NO_DISPONIBLE, quickIata, type FlightsSearchEnv, type SearchResult } from "./search.ts";

const SERPAPI = "https://serpapi.com/search.json";
export const MULTI_MAX_LEGS = 6;
/** Clase de Google Flights (SerpApi travel_class). */
export const TRAVEL_CLASS: Record<string, string> = { turista: "1", premium: "2", business: "3", primera: "4" };

export type MultiLeg = { from: string; to: string; date: string };

export function multiCityJson(legs: Array<{ departure_id: string; arrival_id: string; date: string }>): string {
  return JSON.stringify(legs.map((l) => ({ departure_id: l.departure_id, arrival_id: l.arrival_id, date: l.date })));
}

export async function searchMultiCity(body: any, env: FlightsSearchEnv): Promise<SearchResult> {
  const raw: any[] = Array.isArray(body?.legs) ? body.legs : [];
  const travelers = Math.min(9, Math.max(1, Math.round(Number(body?.travelers) || 1)));
  if (raw.length < 2 || raw.length > MULTI_MAX_LEGS) return { status: 400, body: { ok: false, error: "tramos_invalidos" } };
  const legs = raw.map((l) => ({
    from: String(l?.from ?? "").trim(), to: String(l?.to ?? "").trim(), date: String(l?.date ?? "").trim(),
  }));
  if (legs.some((l) => !/^\d{4}-\d{2}-\d{2}$/.test(l.date))) return { status: 400, body: { ok: false, error: "fecha_invalida" } };
  const coded = legs.map((l) => ({ departure_id: quickIata(l.from), arrival_id: quickIata(l.to), date: l.date }));
  if (coded.some((l) => !l.departure_id || !l.arrival_id)) {
    return { status: 400, body: { ok: false, error: "no_iata", legs } };
  }
  const meta = { legs: coded, travelers, type: "multi" };
  if (!env.serpKey) {
    return { status: 200, body: { ok: true, source: "none", disponible: false, results: [], motivo: MOTIVO_NO_DISPONIBLE, fallas: ["google_flights_sin_llave"], meta } };
  }
  const u = new URL(SERPAPI);
  u.searchParams.set("engine", "google_flights");
  u.searchParams.set("type", "3");
  u.searchParams.set("multi_city_json", multiCityJson(coded as Array<{ departure_id: string; arrival_id: string; date: string }>));
  u.searchParams.set("adults", String(travelers));
  const cls = TRAVEL_CLASS[String(body?.travel_class ?? "").toLowerCase()];
  if (cls && cls !== "1") u.searchParams.set("travel_class", cls);
  u.searchParams.set("currency", "USD");
  u.searchParams.set("hl", "es");
  u.searchParams.set("api_key", env.serpKey);

  const fallas: string[] = [];
  let results: any[] = [];
  let google_flights_url: string | null = null;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 18000);
    const r = await (env.serpFetch ?? fetch)(u.toString(), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
    if (r.ok) {
      const j = await r.json();
      google_flights_url = j?.search_metadata?.google_flights_url ?? null;
      const first = coded[0];
      results = [...(j?.best_flights ?? []), ...(j?.other_flights ?? [])]
        .filter((f: any) => Number(f?.price ?? 0) > 0)
        .sort((a: any, b: any) => Number(a.price) - Number(b.price))
        .slice(0, 12)
        .map((f: any) => ({
          ...googleFlightResult(f, travelers, false, google_flights_url ?? "", { origin: first.departure_id!, destination: first.arrival_id!, depart: first.date }),
          // El enlace tfs de un solo tramo no sirve para varias ciudades: se usa el de Google Flights.
          buy_url: google_flights_url,
          price_note: `Precio total del itinerario de ${coded.length} tramos para ${travelers} ${travelers === 1 ? "viajero" : "viajeros"}, según Google Flights.`,
          tramos: `tramo 1 de ${coded.length} (el precio es el total del itinerario; los demás tramos se eligen después)`,
          tramo: "multi_1",
        }));
      if (!results.length) fallas.push("google_flights_sin_resultados");
    } else {
      const c = r.headers.get("x-iatos-cache");
      fallas.push(c === "limit" ? "google_flights_limite_del_plan" : c === "paused" ? "google_flights_busquedas_en_pausa" : `google_flights_http_${r.status}`);
    }
  } catch (e) {
    console.error("serpapi multi err:", (e as Error).message);
    fallas.push("google_flights_error");
  }
  const disponible = results.length > 0;
  return {
    status: 200,
    body: {
      ok: true,
      source: disponible ? "serpapi" : "none",
      disponible,
      results,
      etiqueta_fuente: disponible ? "Google Flights" : null,
      ...(disponible ? {} : { motivo: MOTIVO_NO_DISPONIBLE, fallas }),
      google_flights_url,
      meta,
    },
  };
}
