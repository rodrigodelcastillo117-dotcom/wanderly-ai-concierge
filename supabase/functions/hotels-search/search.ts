// Lógica de hotels-search sin Deno.serve, para poder probarla con fetch simulado.
//
// Fuente: Google Hotels vía SerpApi (en vivo). Si no hay llave, falla o viene vacío, se responde
// con results: [], disponible: false y un link de búsqueda de Booking (afiliado). NUNCA se
// sustituyen por hoteles y tarifas "estimados" por IA presentados como reales.
import { resolveTpMarker } from "../_shared/tp-params.ts";

const SERPAPI = "https://serpapi.com/search.json";

export const MOTIVO_NO_DISPONIBLE = "Búsqueda en vivo no disponible ahora; intenta más tarde.";

// Mismo esquema que tpDeepLink() en src/lib/affiliateLinks.ts: Booking.com se
// atribuye vía el redirect tp.media/click, no con un marker directo en la URL.
export function tpDeepLink(targetUrl: string, subId: string, marker: string): string {
  const p = new URLSearchParams({ marker: `${marker}.${subId}`, u: targetUrl });
  return `https://tp.media/click?${p.toString()}`;
}

export function bookingUrl(city: string, ci: string, co: string, adults: number, marker: string) {
  const p = new URLSearchParams({
    ss: city,
    checkin: ci,
    checkout: co,
    group_adults: String(adults),
    no_rooms: String(Math.max(1, Math.ceil(adults / 2))),
  });
  return tpDeepLink(`https://www.booking.com/searchresults.html?${p.toString()}`, "hotels", marker);
}

const pos = (v: unknown) => (Number(v) > 0 ? Math.round(Number(v)) : null);

/**
 * Un hotel de Google Hotels (SerpApi) con lo que trae: tarifa por noche y total CON impuestos y
 * cargos (los `extracted_lowest` de Google ya los incluyen) y, si Google los publica, los montos
 * antes de impuestos; categoría numérica, ubicación, horarios de entrada/salida y el sitio que da
 * la tarifa más baja.
 */
export function hotelResult(p: any, nightly: number, totalRaw: number, nights: number, city: string, checkin: string, checkout: string, adults: number, marker: string) {
  const nightlyBefore = pos(p?.rate_per_night?.extracted_before_taxes_fees);
  const totalBefore = pos(p?.total_rate?.extracted_before_taxes_fees);
  const cls = Number(p?.extracted_hotel_class ?? (typeof p?.hotel_class === "number" ? p.hotel_class : String(p?.hotel_class ?? "").match(/\d/)?.[0]));
  const cheapest = Array.isArray(p?.prices) ? p.prices.find((x: any) => x?.source) : null;
  return {
    name: p.name,
    rating: p.overall_rating ?? null,
    reviews: p.reviews ?? null,
    location_rating: p.location_rating ?? null,
    // Número (1–5): antes llegaba el texto "5-star hotel" y la pantalla no podía pintar estrellas.
    hotel_class: Number.isFinite(cls) && cls > 0 ? cls : null,
    type: p.type ?? null,
    nightly_usd: Math.round(nightly),
    total_usd: Math.round(totalRaw > 0 ? totalRaw : nightly * nights),
    nights,
    nightly_before_taxes_usd: nightlyBefore,
    total_before_taxes_usd: totalBefore,
    // Google Hotels da la tarifa con impuestos y cargos; si no trae total, se calcula noche × noches.
    total_incluye_impuestos: totalRaw > 0,
    total_calculado: !(totalRaw > 0),
    lat: p?.gps_coordinates?.latitude ?? null,
    lng: p?.gps_coordinates?.longitude ?? null,
    check_in_time: p.check_in_time ?? null,
    check_out_time: p.check_out_time ?? null,
    proveedor_tarifa: cheapest?.source ?? null,
    property_token: p.property_token ?? null,
    thumbnail: p.images?.[0]?.thumbnail ?? null,
    amenities: (p.amenities ?? []).slice(0, 6),
    link: p.link ?? null,
    booking_url: bookingUrl(`${p.name} ${city}`, checkin, checkout, adults, marker),
    fuente: "google_hotels",
  };
}

export type HotelsSearchEnv = {
  serpKey?: string | null;
  marker?: string | null;
  /** fetch para SerpApi: el de la caché compartida (_shared/serpCache.ts) en producción. */
  serpFetch?: typeof fetch;
};

export async function searchHotels(body: any, env: HotelsSearchEnv): Promise<{ status: number; body: Record<string, unknown> }> {
  const { city, checkin, checkout, adults = 1, hotel_class = "", query = "", sort = "value" } = body ?? {};
  const marker = resolveTpMarker(env.marker);
  const fallas: string[] = [];
  let results: any[] = [];

  const nightsSafe = Math.max(1, Math.round(
    (new Date(checkout).getTime() - new Date(checkin).getTime()) / 86400000,
  )) || 1;

  // sort "value" (default): los mejor calificados de Google Hotels, presentados de menor a mayor
  // precio para que quien llama pueda armar tiers. sort "price": los más baratos.
  const searchSerp = async (q: string): Promise<any[]> => {
    const u = new URL(SERPAPI);
    u.searchParams.set("engine", "google_hotels");
    u.searchParams.set("q", q);
    u.searchParams.set("check_in_date", checkin);
    u.searchParams.set("check_out_date", checkout);
    u.searchParams.set("adults", String(adults));
    u.searchParams.set("currency", "USD");
    u.searchParams.set("hl", "es");
    if (hotel_class) u.searchParams.set("hotel_class", hotel_class);
    u.searchParams.set("sort_by", sort === "price" ? "3" : "8"); // 3 = menor precio, 8 = mejor calificación
    u.searchParams.set("api_key", env.serpKey!);
    try {
      const r = await (env.serpFetch ?? fetch)(u.toString());
      if (r.headers.get("x-iatos-cache") === "limit") { fallas.push("google_hotels_limite_del_plan"); return []; }
      if (r.headers.get("x-iatos-cache") === "paused") { fallas.push("google_hotels_busquedas_en_pausa"); return []; }
      // Nunca registrar la URL: lleva la API key.
      if (!r.ok) { console.error("hotels status", r.status); fallas.push(`google_hotels_http_${r.status}`); return []; }
      const j = await r.json();
      let withNightly = (j?.properties ?? []).map((p: any) => {
        const nightlyRaw = Number(p?.rate_per_night?.extracted_lowest ?? 0);
        const totalRaw = Number(p?.total_rate?.extracted_lowest ?? 0);
        const nightly = nightlyRaw > 0 ? nightlyRaw : (totalRaw > 0 ? totalRaw / nightsSafe : 0);
        if (nightly > 2000) {
          console.warn("hotels-search sanity: nightly>2000 usd", {
            name: p?.name, nightlyRaw, totalRaw, nights: nightsSafe, derived: nightly,
          });
        }
        return { p, nightly, totalRaw };
      }).filter((x: any) => x.nightly > 0);
      if (sort !== "price") {
        const wellRated = withNightly.filter((x: any) => Number(x.p?.overall_rating ?? 0) >= 4.0);
        if (wellRated.length >= 3) withNightly = wellRated;
      }
      return withNightly
        .sort((a: any, b: any) => a.nightly - b.nightly)
        .slice(0, 15)
        .map(({ p, nightly, totalRaw }: any) => hotelResult(p, nightly, totalRaw, nightsSafe, city, checkin, checkout, adults, marker));
    } catch (e) {
      console.error("hotels err", (e as Error).message);
      fallas.push("google_hotels_error");
      return [];
    }
  };

  if (env.serpKey) {
    // Preferencias del cliente ("hotel boutique con vista al mar") van en la búsqueda de Google.
    const pref = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (pref) results = await searchSerp(`${pref} ${city}`);
    if (results.length < 3) {
      const general = await searchSerp(`${city} hotels`);
      if (general.length > results.length) results = general;
    }
    if (results.length === 0 && fallas.length === 0) fallas.push("google_hotels_sin_resultados");
  } else {
    fallas.push("google_hotels_sin_llave");
  }

  const disponible = results.length > 0;
  return {
    status: 200,
    body: {
      ok: true,
      // "serpapi" SOLO si de verdad hay resultados de Google Hotels (antes se decía aunque no hubiera).
      source: disponible ? "serpapi" : "none",
      disponible,
      results,
      etiqueta_fuente: disponible ? "Google Hotels" : null,
      ...(disponible ? {} : { motivo: MOTIVO_NO_DISPONIBLE, fallas }),
      consulted_at: new Date().toISOString(),
      // Link de búsqueda (sin precio) para que el usuario busque por su cuenta.
      booking_url: bookingUrl(city, checkin, checkout, adults, marker),
      meta: { city, checkin, checkout, adults },
    },
  };
}
