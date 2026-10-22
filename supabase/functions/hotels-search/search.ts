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

export type HotelsSearchEnv = { serpKey?: string | null; marker?: string | null };

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
      const r = await fetch(u.toString());
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
        .map(({ p, nightly, totalRaw }: any) => ({
          name: p.name,
          rating: p.overall_rating ?? null,
          reviews: p.reviews ?? null,
          hotel_class: p.hotel_class ?? null,
          nightly_usd: Math.round(nightly),
          total_usd: Math.round(totalRaw > 0 ? totalRaw : nightly * nightsSafe),
          thumbnail: p.images?.[0]?.thumbnail ?? null,
          amenities: (p.amenities ?? []).slice(0, 6),
          link: p.link ?? null,
          booking_url: bookingUrl(`${p.name} ${city}`, checkin, checkout, adults, marker),
        }));
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
      ...(disponible ? {} : { motivo: MOTIVO_NO_DISPONIBLE, fallas }),
      consulted_at: new Date().toISOString(),
      // Link de búsqueda (sin precio) para que el usuario busque por su cuenta.
      booking_url: bookingUrl(city, checkin, checkout, adults, marker),
      meta: { city, checkin, checkout, adults },
    },
  };
}
