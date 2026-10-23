// hotels-search { action: "offers" } — ofertas reales por proveedor de UN hotel (Booking.com, Expedia,
// Hotels.com, sitio oficial…) con SerpApi Google Hotels "Property Details" (engine=google_hotels +
// property_token; https://serpapi.com/google-hotels-property-details). Sin Deno.serve: se prueba con
// fixtures (src/test/hotelOffers.test.ts).
//
// - Solo se llama tras el botón "Ver ofertas reales": nada automático.
// - Pasa por el mismo fetch que el resto de hotels-search: caché compartida (3 h por propiedad + fechas
//   + huéspedes, travelDateTtlSeconds), bolsa de búsquedas en vivo del plan y freno de la cuenta.
// - Cada oferta lleva el enlace QUE DA LA FUENTE (featured_prices[].link / prices[].link), revisado
//   con la lista blanca (google.com/travel/lodging/clk, booking.com…) o, si es un sitio directo que
//   vino de la respuesta, como fuente confiable (sin imitar marcas). Nunca se arma ni se inventa.
// - Es un precio consultado, no una reserva: el proveedor confirma el precio final.
import { checkAllowlisted, checkTrustedSource } from "../_shared/booking/allowlist.ts";
import { isIsoDate } from "../_shared/booking/links.ts";
import { MOTIVO_NO_DISPONIBLE } from "./search.ts";

const SERPAPI = "https://serpapi.com/search.json";
export const MAX_OFFERS = 5;

export type HotelOffer = {
  source: string;
  total_usd: number;
  nightly_usd: number | null;
  total_before_taxes_usd: number | null;
  official: boolean;
  free_cancellation: boolean;
  url: string | null;
  /** "Sitio oficial del hotel" o "Ver en Booking". */
  label: string;
  logo: string | null;
};

const pos = (v: unknown) => (Number(v) > 0 ? Math.round(Number(v)) : null);

/** Nombre corto del proveedor para el botón: "Booking.com" → "Booking". */
export function shortSource(source: string): string {
  const s = source.trim();
  return s.replace(/\.(com|com\.mx|mx|net)$/i, "").trim() || s;
}

export function offerLabel(source: string, official: boolean): string {
  return official ? "Sitio oficial del hotel" : `Ver en ${shortSource(source)}`;
}

/** Enlace de la oferta tal como lo dio la fuente, solo si pasa la lista blanca o es una fuente confiable. */
export function offerLink(raw: unknown): string | null {
  const strict = checkAllowlisted(raw);
  if (strict.ok) return strict.url;
  const trusted = checkTrustedSource(raw);
  return trusted.ok ? trusted.url : null;
}

/**
 * Ofertas por fuente de la respuesta de Property Details: una por proveedor (la más barata), con
 * total de la estancia > 0, ordenadas de menor a mayor total, las que tienen enlace primero; máximo 5.
 */
export function parseHotelOffers(j: any, max = MAX_OFFERS): HotelOffer[] {
  const all = [...(Array.isArray(j?.featured_prices) ? j.featured_prices : []), ...(Array.isArray(j?.prices) ? j.prices : [])];
  const best = new Map<string, HotelOffer>();
  for (const p of all) {
    const source = String(p?.source ?? "").trim();
    const total = pos(p?.total_rate?.extracted_lowest);
    if (!source || !total) continue;
    const official = p?.official === true;
    const offer: HotelOffer = {
      source,
      total_usd: total,
      nightly_usd: pos(p?.rate_per_night?.extracted_lowest),
      total_before_taxes_usd: pos(p?.total_rate?.extracted_before_taxes_fees),
      official,
      free_cancellation: p?.free_cancellation === true,
      url: offerLink(p?.link),
      label: offerLabel(source, official),
      logo: typeof p?.logo === "string" && /^https:\/\//.test(p.logo) ? p.logo : null,
    };
    const k = source.toLowerCase();
    const prev = best.get(k);
    if (!prev || (offer.url && !prev.url) || (!!offer.url === !!prev.url && offer.total_usd < prev.total_usd)) best.set(k, offer);
  }
  return [...best.values()]
    .sort((a, b) => Number(!!b.url) - Number(!!a.url) || a.total_usd - b.total_usd)
    .slice(0, max);
}

export type HotelOffersEnv = { serpKey?: string | null; serpFetch?: typeof fetch };

export async function searchHotelOffers(body: any, env: HotelOffersEnv): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = typeof body?.property_token === "string" ? body.property_token.trim() : "";
  const checkin = body?.checkin, checkout = body?.checkout;
  if (!token || token.length > 1000) return { status: 400, body: { ok: false, error: "property_token_invalido" } };
  if (!isIsoDate(checkin) || !isIsoDate(checkout) || checkout <= checkin) return { status: 400, body: { ok: false, error: "fechas_invalidas" } };
  const adults = Math.min(9, Math.max(1, Math.round(Number(body?.adults) || 1)));
  const nights = Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000);
  const name = String(body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const meta = { checkin, checkout, adults, nights, name: name || null };
  const fallas: string[] = [];
  let results: HotelOffer[] = [];

  if (!env.serpKey) {
    fallas.push("google_hotels_sin_llave");
  } else {
    const u = new URL(SERPAPI);
    u.searchParams.set("engine", "google_hotels");
    // Con property_token SerpApi ignora q; va por si la fuente lo pide, y no cambia la llave de caché entre
    // botones del mismo hotel (siempre el mismo nombre).
    if (name) u.searchParams.set("q", name);
    u.searchParams.set("property_token", token);
    u.searchParams.set("check_in_date", checkin);
    u.searchParams.set("check_out_date", checkout);
    u.searchParams.set("adults", String(adults));
    u.searchParams.set("currency", "USD");
    u.searchParams.set("hl", "es");
    u.searchParams.set("api_key", env.serpKey);
    try {
      const r = await (env.serpFetch ?? fetch)(u.toString(), { signal: AbortSignal.timeout(20000) });
      const c = r.headers.get("x-iatos-cache");
      if (c === "limit") fallas.push("google_hotels_limite_del_plan");
      else if (c === "paused" && !r.ok) fallas.push("google_hotels_busquedas_en_pausa");
      else if (!r.ok) {
        // Nunca registrar la URL: lleva la API key.
        console.error("hotel offers status", r.status);
        fallas.push(`google_hotels_http_${r.status}`);
      } else {
        results = parseHotelOffers(await r.json());
        if (!results.length) fallas.push("google_hotels_sin_ofertas");
      }
    } catch (e) {
      console.error("hotel offers err", (e as Error).message);
      fallas.push("google_hotels_error");
    }
  }

  const disponible = results.length > 0;
  return {
    status: 200,
    body: {
      ok: true,
      source: disponible ? "serpapi" : "none",
      disponible,
      results,
      etiqueta_fuente: disponible ? "Google Hotels" : null,
      nota: `Total de la estancia (${nights} ${nights === 1 ? "noche" : "noches"}, ${adults} ${adults === 1 ? "adulto" : "adultos"}) por proveedor, según Google Hotels. No es una reserva: el proveedor confirma el precio final.`,
      ...(disponible ? {} : { motivo: MOTIVO_NO_DISPONIBLE, fallas }),
      consulted_at: new Date().toISOString(),
      meta,
    },
  };
}
