// serpapi-quote — Pricing engine
// Modo actual: ENABLED=false → estima con IA (Gemini) usando conocimiento de
// Google Flights, Kayak, Skyscanner, Booking y precios históricos por mes/día.
// Cuando se reactive (ENABLED=true) vuelve a SerpApi en vivo sin cambios.
const ENABLED = false;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SERPAPI = "https://serpapi.com/search.json";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface Body {
  origin: string;
  destination: string;
  depart: string;
  return_date: string;
  nights: number;
  travelers?: number;
  currency?: string;
}

// Mapa básico ciudad → IATA (fallback rápido). Si no aparece, usamos IA.
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
    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Respondes SOLO el código IATA de 3 letras del aeropuerto principal de la ciudad. Sin texto extra." },
          { role: "user", content: city },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const code = (j?.choices?.[0]?.message?.content ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return code.length === 3 ? code : null;
  } catch { return null; }
}

async function serpFlights(key: string, dep: string, arr: string, outbound: string, ret: string, travelers: number) {
  const u = new URL(SERPAPI);
  u.searchParams.set("engine", "google_flights");
  u.searchParams.set("departure_id", dep);
  u.searchParams.set("arrival_id", arr);
  u.searchParams.set("outbound_date", outbound);
  u.searchParams.set("return_date", ret);
  u.searchParams.set("adults", String(travelers));
  u.searchParams.set("currency", "USD");
  u.searchParams.set("hl", "es");
  u.searchParams.set("api_key", key);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`flights ${r.status}`);
  const j = await r.json();
  const best = j?.best_flights?.[0] ?? j?.other_flights?.[0];
  if (!best) return null;
  const segs = best.flights ?? [];
  const airline = segs[0]?.airline ?? "—";
  const airline_logo = segs[0]?.airline_logo ?? null;
  const duration_min = best.total_duration ?? segs.reduce((s: number, x: any) => s + (x.duration ?? 0), 0);
  return {
    price_usd: Number(best.price ?? 0),         // total para todos los adultos
    airline,
    airline_logo,
    duration: `${Math.floor(duration_min / 60)}h ${duration_min % 60}m`,
    stops: Math.max(0, segs.length - 1),
    departure: segs[0]?.departure_airport?.id,
    arrival: segs[segs.length - 1]?.arrival_airport?.id,
  };
}

async function serpHotels(key: string, city: string, checkin: string, checkout: string, travelers: number) {
  const u = new URL(SERPAPI);
  u.searchParams.set("engine", "google_hotels");
  u.searchParams.set("q", `${city} hotels`);
  u.searchParams.set("check_in_date", checkin);
  u.searchParams.set("check_out_date", checkout);
  u.searchParams.set("adults", String(travelers));
  u.searchParams.set("currency", "USD");
  u.searchParams.set("hl", "es");
  u.searchParams.set("hotel_class", "4,5");
  u.searchParams.set("sort_by", "8"); // lowest price
  u.searchParams.set("api_key", key);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`hotels ${r.status}`);
  const j = await r.json();
  const props = j?.properties ?? [];
  const top = props.find((p: any) => p?.rate_per_night?.extracted_lowest) ?? props[0];
  if (!top) return null;
  return {
    name: top.name,
    rating: top.overall_rating ?? null,
    hotel_class: top.hotel_class ?? null,
    nightly_usd: Number(top.rate_per_night?.extracted_lowest ?? top.total_rate?.extracted_lowest ?? 0),
    thumbnail: top.images?.[0]?.thumbnail ?? top.thumbnail ?? null,
    link: top.link ?? null,
  };
}

async function aiEstimate(apiKey: string, body: Body) {
  const travelers = Math.max(1, body.travelers ?? 1);
  const nights = Math.max(1, body.nights ?? 1);
  const prompt = `Estima precios REALISTAS de viaje para esta ruta usando tu conocimiento de Google Flights, Kayak, Skyscanner, Booking, Expedia y precios históricos por mes/día. NO inventes números bajos: usa rangos reales de mercado.

Ruta: ${body.origin} → ${body.destination}
Salida: ${body.depart}   Regreso: ${body.return_date}
Noches: ${nights}   Viajeros: ${travelers}

Devuelve SOLO JSON con esta forma exacta (sin texto extra, sin markdown):
{
  "flight": {
    "price_usd": number,           // total round-trip para TODOS los ${travelers} viajeros, en USD
    "airline": string,             // aerolínea típica/recomendada en esa ruta
    "duration": string,            // ej "11h 45m"
    "stops": number,               // 0 directo, 1 una escala, etc
    "departure": string,           // IATA origen ej "MEX"
    "arrival": string              // IATA destino ej "CDG"
  },
  "hotel": {
    "name": string,                // hotel 4-5★ representativo en el destino
    "rating": number,              // 1-5
    "hotel_class": number,         // 4 o 5
    "nightly_usd": number          // tarifa promedio por noche en USD para esas fechas
  }
}

Considera temporada (alta/baja) según el mes de ${body.depart}, día de la semana, y patrones históricos. Sé preciso, no optimista.`;

  const r = await fetch(AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Eres un experto en pricing de viajes. Respondes SOLO JSON válido, sin markdown ni explicaciones." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ai ${r.status}`);
  const j = await r.json();
  let raw = (j?.choices?.[0]?.message?.content ?? "").trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(raw);
  return { flight: parsed.flight ?? null, hotel: parsed.hotel ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // === MODO ESTIMACIÓN IA (sin gastar SerpApi) ===
  if (!ENABLED) {
    try {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
      const body = (await req.json()) as Body;
      const travelers = Math.max(1, body.travelers ?? 1);
      const nights = Math.max(1, body.nights ?? 1);
      const { flight, hotel } = await aiEstimate(lovableKey, body);
      const flights_total = flight?.price_usd ?? 0;
      const hotel_total = hotel ? hotel.nightly_usd * nights : 0;
      const subtotal = flights_total + hotel_total;
      const buffer = subtotal * 0.2;
      const total_usd = Math.round(subtotal + buffer);
      const total_mxn = Math.round(total_usd * 18.5);
      return new Response(JSON.stringify({
        flight: flight ? { ...flight, airline_logo: null } : null,
        hotel: hotel ? { ...hotel, thumbnail: null, link: null } : null,
        breakdown: {
          flights_usd: flights_total,
          hotel_nightly_usd: hotel?.nightly_usd ?? 0,
          hotel_total_usd: hotel_total,
          nights,
          buffer_usd: Math.round(buffer),
        },
        total_usd,
        total_mxn,
        source: "ai-estimate",
        fetched_at: new Date().toISOString(),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      console.error("ai-estimate error:", msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  try {
    const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!serpKey) {
      return new Response(JSON.stringify({ error: "SERPAPI_PRIVATE_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const travelers = Math.max(1, body.travelers ?? 1);
    const nights = Math.max(1, body.nights ?? 1);

    // Resolver IATA
    let depCode = quickIata(body.origin);
    let arrCode = quickIata(body.destination);
    if (!depCode && lovableKey) depCode = await aiIata(lovableKey, body.origin);
    if (!arrCode && lovableKey) arrCode = await aiIata(lovableKey, body.destination);

    const flightsPromise = (depCode && arrCode)
      ? serpFlights(serpKey, depCode, arrCode, body.depart, body.return_date, travelers).catch((e) => {
          console.error("flights err:", e.message); return null;
        })
      : Promise.resolve(null);

    const hotelsPromise = serpHotels(serpKey, body.destination, body.depart, body.return_date, travelers)
      .catch((e) => { console.error("hotels err:", e.message); return null; });

    const [flight, hotel] = await Promise.all([flightsPromise, hotelsPromise]);

    const flights_total = flight?.price_usd ?? 0;
    const hotel_total = hotel ? hotel.nightly_usd * nights : 0;
    const subtotal = flights_total + hotel_total;
    const buffer = subtotal * 0.2;
    const total_usd = Math.round(subtotal + buffer);
    const total_mxn = Math.round(total_usd * 18.5); // tipo de cambio aprox

    return new Response(JSON.stringify({
      flight,
      hotel,
      breakdown: {
        flights_usd: flights_total,
        hotel_nightly_usd: hotel?.nightly_usd ?? 0,
        hotel_total_usd: hotel_total,
        nights,
        buffer_usd: Math.round(buffer),
      },
      total_usd,
      total_mxn,
      fetched_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("serpapi-quote error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
