// "Comprobar precio" (Fase 3/4): vuelve a consultar la FUENTE ORIGINAL de la oferta. Sin Deno; el
// fetch se inyecta (en producción, el de la caché compartida de SerpApi con la bolsa del usuario).
//
//  * Vuelo de Google Flights: SerpApi "Google Flights Booking Options" con el booking_token del
//    resultado → booking_options[] con vendedor, precio y booking_request {url, post_data}
//    (https://serpapi.com/google-flights-booking-options).
//  * Hotel de Google Hotels: SerpApi "Property Details" con el property_token → featured_prices[] /
//    prices[] con source, link, official y rooms[] (https://serpapi.com/google-hotels-property-details).
// Si la fuente no responde, se dice; nunca se inventa un precio ni disponibilidad.
import { checkAllowlisted } from "./allowlist.ts";
import { isIsoDate } from "./links.ts";

const SERPAPI = "https://serpapi.com/search.json";

export type ExactOption = {
  seller: string;
  price: number | null;
  currency: string;
  url?: string | null;
  form?: { action: string; fields: Array<[string, string]> } | null;
  phone?: string | null;
  official?: boolean;
  room?: string | null;
  title?: string | null;
  extensions?: string[];
};

export type PriceChange = { changed: boolean; direction: "same" | "up" | "down" | "unknown"; old: number | null; new: number | null; delta: number | null; pct: number | null };

export type RecheckResult =
  | { ok: true; checked_at: string; availability: "available_at_check" | "sold_out"; price: number | null; currency: string; options: ExactOption[];
      price_change: PriceChange; room_match: "match" | "mismatch" | "not_selected"; cached: boolean }
  | { ok: false; code: "RECHECK_UNAVAILABLE" | "PROVIDER_DOWN" | "LIVE_LIMIT" | "NO_TOKEN" | "BAD_INPUT"; message: string };

/** Diferencia de precio con tolerancia (por redondeo de moneda). */
export function comparePrice(oldP: number | null | undefined, newP: number | null | undefined, tolerancePct = 1): PriceChange {
  const o = Number(oldP), n = Number(newP);
  if (!(o > 0) || !(n > 0)) return { changed: false, direction: "unknown", old: o > 0 ? o : null, new: n > 0 ? n : null, delta: null, pct: null };
  const delta = Math.round((n - o) * 100) / 100;
  const pct = Math.round(((n - o) / o) * 1000) / 10;
  if (Math.abs(pct) <= tolerancePct) return { changed: false, direction: "same", old: o, new: n, delta, pct };
  return { changed: true, direction: n > o ? "up" : "down", old: o, new: n, delta, pct };
}

/** booking_request.post_data ("u=…&…") → campos del formulario. */
export function postDataFields(postData: unknown): Array<[string, string]> | null {
  if (typeof postData !== "string" || !postData || postData.length > 20000) return null;
  try {
    const fields = Array.from(new URLSearchParams(postData).entries());
    return fields.length ? fields : null;
  } catch {
    return null;
  }
}

export function parseFlightBookingOptions(j: any): ExactOption[] {
  const out: ExactOption[] = [];
  for (const opt of Array.isArray(j?.booking_options) ? j.booking_options : []) {
    // Boletos separados (ida y regreso con vendedores distintos): no hay UNA compra exacta.
    if (opt?.separate_tickets) continue;
    const t = opt?.together;
    if (!t) continue;
    const price = Number(t.price);
    let form: ExactOption["form"] = null;
    const br = t.booking_request;
    if (br?.url && checkAllowlisted(br.url).ok) {
      const fields = postDataFields(br.post_data);
      if (fields) form = { action: String(br.url), fields };
    }
    out.push({
      seller: String(t.book_with ?? "Vendedor"),
      price: price > 0 ? price : null,
      currency: "USD",
      form,
      phone: typeof t.booking_phone === "string" ? t.booking_phone : null,
      title: typeof t.option_title === "string" ? t.option_title : null,
      extensions: Array.isArray(t.extensions) ? t.extensions.map(String).slice(0, 8) : [],
    });
  }
  return out;
}

const normRoom = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseHotelPrices(j: any, selectedRoom?: string | null): { options: ExactOption[]; room_match: "match" | "mismatch" | "not_selected" } {
  const out: ExactOption[] = [];
  let matched = false;
  const all = [...(Array.isArray(j?.featured_prices) ? j.featured_prices : []), ...(Array.isArray(j?.prices) ? j.prices : [])];
  const seen = new Set<string>();
  for (const p of all) {
    const link = typeof p?.link === "string" && checkAllowlisted(p.link).ok ? p.link : null;
    const total = Number(p?.total_rate?.extracted_lowest ?? 0);
    const key = `${p?.source}|${total}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (selectedRoom) {
      for (const r of Array.isArray(p?.rooms) ? p.rooms : []) {
        if (normRoom(r?.name) !== normRoom(selectedRoom)) continue;
        const rl = typeof r?.link === "string" && checkAllowlisted(r.link).ok ? r.link : null;
        if (!rl) continue;
        matched = true;
        out.push({ seller: String(p?.source ?? "Proveedor"), price: Number(r?.total_rate?.extracted_lowest) || null, currency: "USD", url: rl,
          official: !!p?.official, room: String(r.name) });
      }
    }
    if (link) out.push({ seller: String(p?.source ?? "Proveedor"), price: total > 0 ? total : null, currency: "USD", url: link, official: !!p?.official, room: null });
  }
  return { options: out, room_match: !selectedRoom ? "not_selected" : matched ? "match" : "mismatch" };
}

export type RecheckEnv = { serpKey?: string | null; serpFetch?: typeof fetch; now?: () => number };

async function serp(env: RecheckEnv, params: Record<string, string>): Promise<{ ok: true; json: any; cached: boolean } | { ok: false; code: "PROVIDER_DOWN" | "LIVE_LIMIT" | "RECHECK_UNAVAILABLE" }> {
  if (!env.serpKey) return { ok: false, code: "RECHECK_UNAVAILABLE" };
  const u = new URL(SERPAPI);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // Comprobar precio = consulta en vivo: no_cache evita la caché de SerpApi y la compartida de IATOS
  // (que además recorta booking_options y featured_prices). Gasta de la bolsa del usuario.
  u.searchParams.set("no_cache", "true");
  u.searchParams.set("api_key", env.serpKey);
  try {
    const r = await (env.serpFetch ?? fetch)(u.toString(), { signal: AbortSignal.timeout(20000) });
    if (r.headers.get("x-iatos-cache") === "limit") return { ok: false, code: "LIVE_LIMIT" };
    if (!r.ok) return { ok: false, code: "PROVIDER_DOWN" };
    return { ok: true, json: await r.json(), cached: r.headers.get("x-iatos-cache") === "hit" };
  } catch {
    return { ok: false, code: "PROVIDER_DOWN" };
  }
}

const MSG = {
  RECHECK_UNAVAILABLE: "No podemos comprobar el precio con la fuente ahora. El proveedor te mostrará el precio final.",
  PROVIDER_DOWN: "La fuente del precio no respondió. Intenta de nuevo en unos minutos o continúa en el proveedor.",
  LIVE_LIMIT: "Llegaste al límite de búsquedas en vivo de tu plan; el proveedor te mostrará el precio final.",
  NO_TOKEN: "Esta opción no se puede volver a consultar con su fuente.",
  BAD_INPUT: "Faltan datos de la búsqueda original.",
};

export type FlightRecheckInput = { booking_token: string; origin: string; destination: string; depart: string; return_date?: string | null; adults: number; old_price?: number | null };

export async function recheckFlight(q: FlightRecheckInput, env: RecheckEnv): Promise<RecheckResult> {
  if (!q.booking_token || typeof q.booking_token !== "string" || q.booking_token.length > 4000) return { ok: false, code: "NO_TOKEN", message: MSG.NO_TOKEN };
  if (!/^[A-Z]{3}$/.test(q.origin) || !/^[A-Z]{3}$/.test(q.destination) || !isIsoDate(q.depart)) return { ok: false, code: "BAD_INPUT", message: MSG.BAD_INPUT };
  const params: Record<string, string> = {
    engine: "google_flights", booking_token: q.booking_token, departure_id: q.origin, arrival_id: q.destination,
    outbound_date: q.depart, type: q.return_date ? "1" : "2", adults: String(Math.max(1, Math.round(q.adults || 1))), currency: "USD", hl: "es",
  };
  if (q.return_date && isIsoDate(q.return_date)) params.return_date = q.return_date;
  const r = await serp(env, params);
  if (!r.ok) return { ok: false, code: r.code, message: MSG[r.code] };
  const options = parseFlightBookingOptions(r.json);
  const prices = options.map((o) => o.price).filter((p): p is number => !!p);
  const best = prices.length ? Math.min(...prices) : null;
  return {
    ok: true, checked_at: new Date(env.now?.() ?? Date.now()).toISOString(),
    availability: options.length ? "available_at_check" : "sold_out", price: best, currency: "USD", options,
    price_change: comparePrice(q.old_price, best), room_match: "not_selected", cached: r.cached,
  };
}

export type HotelRecheckInput = { property_token: string; q: string; checkin: string; checkout: string; adults: number; old_price?: number | null; room?: string | null };

export async function recheckHotel(q: HotelRecheckInput, env: RecheckEnv): Promise<RecheckResult> {
  if (!q.property_token || typeof q.property_token !== "string" || q.property_token.length > 1000) return { ok: false, code: "NO_TOKEN", message: MSG.NO_TOKEN };
  if (!isIsoDate(q.checkin) || !isIsoDate(q.checkout) || q.checkout <= q.checkin || !q.q) return { ok: false, code: "BAD_INPUT", message: MSG.BAD_INPUT };
  const r = await serp(env, {
    engine: "google_hotels", q: q.q.slice(0, 120), property_token: q.property_token, check_in_date: q.checkin, check_out_date: q.checkout,
    adults: String(Math.max(1, Math.round(q.adults || 1))), currency: "USD", hl: "es",
  });
  if (!r.ok) return { ok: false, code: r.code, message: MSG[r.code] };
  const { options, room_match } = parseHotelPrices(r.json, q.room ?? null);
  const prices = options.filter((o) => !o.room).map((o) => o.price).filter((p): p is number => !!p);
  const best = prices.length ? Math.min(...prices) : null;
  return {
    ok: true, checked_at: new Date(env.now?.() ?? Date.now()).toISOString(),
    // Sin ningún precio para esas fechas = agotado según la fuente (no "disponible").
    availability: options.length ? "available_at_check" : "sold_out", price: best, currency: "USD", options,
    price_change: comparePrice(q.old_price, best), room_match, cached: r.cached,
  };
}
