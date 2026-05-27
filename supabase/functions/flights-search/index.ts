// flights-search — devuelve top resultados reales de Google Flights vía SerpAPI
// con deep-link de compra. Fallback IA si no hay créditos.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SERPAPI = "https://serpapi.com/search.json";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const IATA: Record<string, string> = {
  "mexico city": "MEX", "ciudad de mexico": "MEX", "cdmx": "MEX",
  "guadalajara": "GDL", "monterrey": "MTY", "cancun": "CUN", "tijuana": "TIJ",
  "madrid": "MAD", "barcelona": "BCN", "paris": "CDG", "london": "LHR",
  "rome": "FCO", "roma": "FCO", "milan": "MXP", "athens": "ATH", "atenas": "ATH",
  "santorini": "JTR", "mykonos": "JMK", "istanbul": "IST", "lisbon": "LIS",
  "lisboa": "LIS", "amsterdam": "AMS", "berlin": "BER", "vienna": "VIE",
  "tokyo": "HND", "tokio": "HND", "new york": "JFK", "nyc": "JFK",
  "los angeles": "LAX", "miami": "MIA", "dubai": "DXB", "bali": "DPS",
  "bangkok": "BKK", "singapore": "SIN", "hong kong": "HKG",
};

function quickIata(city: string): string | null {
  if (!city) return null;
  const k = city.toLowerCase().trim().split(",")[0].trim();
  return IATA[k] ?? null;
}

async function aiIata(apiKey: string, city: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(AI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Respondes SOLO el código IATA de 3 letras del aeropuerto principal. Sin texto extra." },
          { role: "user", content: city },
        ],
      }),
    }).finally(() => clearTimeout(tid));
    if (!r.ok) return null;
    const j = await r.json();
    const code = (j?.choices?.[0]?.message?.content ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return code.length === 3 ? code : null;
  } catch { return null; }
}


function googleFlightsUrl(o: string, d: string, dep: string, ret: string, adults: number) {
  // Formato deep-link directo a Google Flights con filtros aplicados
  const q = encodeURIComponent(`flights from ${o} to ${d} on ${dep} returning ${ret} for ${adults} adults`);
  return `https://www.google.com/travel/flights?q=${q}`;
}

function airlineSiteSearch(airline: string, o: string, d: string, dep: string, ret: string) {
  const q = encodeURIComponent(`${airline} vuelo ${o} ${d} ${dep} ${ret}`);
  return `https://www.google.com/search?q=${q}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { origin, destination, depart, return_date, travelers = 1, type = "round" } = body;
    const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    let dep = quickIata(origin);
    let arr = quickIata(destination);
    if ((!dep || !arr) && lovableKey) {
      const [d2, a2] = await Promise.all([
        dep ? Promise.resolve(dep) : aiIata(lovableKey, origin),
        arr ? Promise.resolve(arr) : aiIata(lovableKey, destination),
      ]);
      dep = d2 ?? dep; arr = a2 ?? arr;
    }

    if (!dep || !arr) {
      return new Response(JSON.stringify({ ok: false, error: "no_iata", origin, destination }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let results: any[] = [];
    let source = "serpapi";
    let google_flights_url: string | null = null;

    if (serpKey) {
      const u = new URL(SERPAPI);
      u.searchParams.set("engine", "google_flights");
      u.searchParams.set("departure_id", dep);
      u.searchParams.set("arrival_id", arr);
      u.searchParams.set("outbound_date", depart);
      if (type === "round" && return_date) u.searchParams.set("return_date", return_date);
      u.searchParams.set("type", type === "round" ? "1" : "2");
      u.searchParams.set("adults", String(travelers));
      u.searchParams.set("currency", "USD");
      u.searchParams.set("hl", "es");
      u.searchParams.set("api_key", serpKey);

      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 18000);
        const r = await fetch(u.toString(), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
        if (r.ok) {
          const j = await r.json();
          google_flights_url = j?.search_metadata?.google_flights_url ?? null;
          const all = [...(j?.best_flights ?? []), ...(j?.other_flights ?? [])].slice(0, 12);
          results = all.map((f: any) => {
            const segs = f.flights ?? [];
            const dur = f.total_duration ?? 0;
            const stops = Math.max(0, segs.length - 1);
            const airline = segs[0]?.airline ?? "—";
            return {
              price_usd: Number(f.price ?? 0),
              price_per_person_usd: Math.round(Number(f.price ?? 0) / Math.max(1, travelers)),
              airline,
              airline_logo: segs[0]?.airline_logo ?? null,
              duration: `${Math.floor(dur / 60)}h ${dur % 60}m`,
              stops,
              departure: { id: segs[0]?.departure_airport?.id, time: segs[0]?.departure_airport?.time },
              arrival: { id: segs[segs.length - 1]?.arrival_airport?.id, time: segs[segs.length - 1]?.arrival_airport?.time },
              booking_token: f.booking_token ?? null,
              buy_url: googleFlightsUrl(origin, destination, depart, return_date ?? depart, travelers),
              airline_buy_url: airlineSiteSearch(airline, origin, destination, depart, return_date ?? depart),
            };
          });
        } else {
          console.error("serpapi flights status:", r.status);
        }
      } catch (e) { console.error("serpapi flights err:", (e as Error).message); }
    }

    // Fallback IA: estima 3 opciones realistas
    if (results.length === 0 && lovableKey) {
      try {
        const prompt = `Estima 3 opciones REALES y realistas de vuelo ${origin}->${destination} salida ${depart} regreso ${return_date} para ${travelers} adulto(s) en USD por persona round-trip. Devuelve SOLO JSON: {"options":[{"airline":"...","price_per_person_usd":N,"duration":"Xh Ym","stops":0|1|2}]}`;
        const r = await fetch(AI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Analista de pricing aéreo. Solo JSON válido." },
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
            price_usd: Math.round(Number(o.price_per_person_usd ?? 0) * travelers),
            price_per_person_usd: Math.round(Number(o.price_per_person_usd ?? 0)),
            airline: o.airline,
            airline_logo: null,
            duration: o.duration,
            stops: o.stops ?? 0,
            departure: { id: dep },
            arrival: { id: arr },
            booking_token: null,
            buy_url: googleFlightsUrl(origin, destination, depart, return_date ?? depart, travelers),
            airline_buy_url: airlineSiteSearch(o.airline, origin, destination, depart, return_date ?? depart),
          }));
          source = "ai-fallback";
        }
      } catch (e) { console.error("ai fallback err:", (e as Error).message); }
    }

    return new Response(JSON.stringify({
      ok: true, source, results,
      google_flights_url: google_flights_url ?? googleFlightsUrl(origin, destination, depart, return_date ?? depart, travelers),
      meta: { origin, destination, depart, return_date, travelers, dep_iata: dep, arr_iata: arr },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
