// hotels-search — top resultados Google Hotels vía SerpAPI + Booking deep-link.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetch } from "../_shared/ai.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SERPAPI = "https://serpapi.com/search.json";
const TP_TOKEN = Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? "";
// Marker de afiliado Travelpayouts. Fallback hardcoded 533299 para NUNCA perder comisión.
const TP_MARKER = (Deno.env.get("TRAVELPAYOUTS_MARKER") || TP_TOKEN.slice(0, 6) || "533299").trim() || "533299";

// Mismo esquema que tpDeepLink() en src/lib/affiliateLinks.ts: Booking.com se
// atribuye vía el redirect tp.media/click, no con un marker directo en la URL.
function tpDeepLink(targetUrl: string, subId: string): string {
  const p = new URLSearchParams({ marker: `${TP_MARKER}.${subId}`, u: targetUrl });
  return `https://tp.media/click?${p.toString()}`;
}

function bookingUrl(city: string, ci: string, co: string, adults: number) {
  const p = new URLSearchParams({
    ss: city,
    checkin: ci,
    checkout: co,
    group_adults: String(adults),
    no_rooms: "1",
  });
  return tpDeepLink(`https://www.booking.com/searchresults.html?${p.toString()}`, "hotels");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "hotels-search", __user.id, {
    perMinute: 12, perHour: 120, ipPerMinute: 40,
  });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


  try {
    const body = await req.json();
    const { city, checkin, checkout, adults = 1, hotel_class = "", query = "", sort = "value" } = body;
    const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    let results: any[] = [];
    let source = "serpapi";

    const nightsSafe = Math.max(1, Math.round(
      (new Date(checkout).getTime() - new Date(checkin).getTime()) / 86400000
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
      u.searchParams.set("api_key", serpKey!);
      try {
        const r = await fetch(u.toString());
        if (!r.ok) { console.error("hotels status", r.status); return []; }
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
            booking_url: bookingUrl(`${p.name} ${city}`, checkin, checkout, adults),
          }));
      } catch (e) {
        console.error("hotels err", (e as Error).message);
        return [];
      }
    };

    if (serpKey) {
      // Preferencias del cliente ("hotel boutique con vista al mar") van en la búsqueda de Google.
      const pref = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
      if (pref) results = await searchSerp(`${pref} ${city}`);
      if (results.length < 3) results = await searchSerp(`${city} hotels`);
    }

    if (results.length === 0 && lovableKey) {
      try {
        const prompt = `Lista 6 hoteles 4-5★ REALES y conocidos en ${city} con tarifa USD por noche realista para ${checkin}. SOLO JSON: {"options":[{"name":"...","hotel_class":4|5,"nightly_usd":N,"rating":4.5}]}`;
        const r = await aiFetch({
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Eres concierge de hoteles. Solo JSON válido, hoteles REALES." },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (r.ok) {
          const j = await r.json();
          let raw = (j?.choices?.[0]?.message?.content ?? "").trim();
          raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
          const parsed = JSON.parse(raw);
          results = (parsed.options ?? []).map((o: any) => ({
            name: o.name,
            rating: o.rating ?? null,
            hotel_class: o.hotel_class ?? null,
            nightly_usd: Number(o.nightly_usd ?? 0),
            thumbnail: null,
            amenities: [],
            booking_url: bookingUrl(`${o.name} ${city}`, checkin, checkout, adults),
          }));
          source = "ai-fallback";
        }
      } catch (e) { console.error("ai err", (e as Error).message); }
    }

    return new Response(JSON.stringify({
      ok: true, source, results,
      booking_url: bookingUrl(city, checkin, checkout, adults),
      meta: { city, checkin, checkout, adults },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
