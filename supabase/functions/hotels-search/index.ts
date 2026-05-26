// hotels-search — top resultados Google Hotels vía SerpAPI + Booking deep-link.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SERPAPI = "https://serpapi.com/search.json";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function bookingUrl(city: string, ci: string, co: string, adults: number) {
  const p = new URLSearchParams({
    ss: city,
    checkin: ci,
    checkout: co,
    group_adults: String(adults),
    no_rooms: "1",
  });
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { city, checkin, checkout, adults = 1, hotel_class = "" } = body;
    const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    let results: any[] = [];
    let source = "serpapi";

    if (serpKey) {
      const u = new URL(SERPAPI);
      u.searchParams.set("engine", "google_hotels");
      u.searchParams.set("q", `${city} hotels`);
      u.searchParams.set("check_in_date", checkin);
      u.searchParams.set("check_out_date", checkout);
      u.searchParams.set("adults", String(adults));
      u.searchParams.set("currency", "USD");
      u.searchParams.set("hl", "es");
      if (hotel_class) u.searchParams.set("hotel_class", hotel_class);
      u.searchParams.set("sort_by", "8");
      u.searchParams.set("api_key", serpKey);
      try {
        const r = await fetch(u.toString());
        if (r.ok) {
          const j = await r.json();
          const props = (j?.properties ?? []).slice(0, 15);
          results = props.map((p: any) => ({
            name: p.name,
            rating: p.overall_rating ?? null,
            reviews: p.reviews ?? null,
            hotel_class: p.hotel_class ?? null,
            nightly_usd: Number(p.rate_per_night?.extracted_lowest ?? p.total_rate?.extracted_lowest ?? 0),
            total_usd: Number(p.total_rate?.extracted_lowest ?? 0),
            thumbnail: p.images?.[0]?.thumbnail ?? null,
            amenities: (p.amenities ?? []).slice(0, 6),
            link: p.link ?? null,
            booking_url: bookingUrl(`${p.name} ${city}`, checkin, checkout, adults),
          }));
        } else console.error("hotels status", r.status);
      } catch (e) { console.error("hotels err", (e as Error).message); }
    }

    if (results.length === 0 && lovableKey) {
      try {
        const prompt = `Lista 6 hoteles 4-5★ REALES y conocidos en ${city} con tarifa USD por noche realista para ${checkin}. SOLO JSON: {"options":[{"name":"...","hotel_class":4|5,"nightly_usd":N,"rating":4.5}]}`;
        const r = await fetch(AI_URL, {
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
