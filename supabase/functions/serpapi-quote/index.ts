// serpapi-quote — Pricing engine
// Modo actual:
//   ENABLED=true  → consulta SerpApi en vivo (Google Flights + Google Hotels).
//                   Consume créditos SerpApi reales en cada request. Si SerpApi
//                   falla o no devuelve datos, cae automáticamente al estimador
//                   de IA (Gemini) como fallback.
//   ENABLED=false → salta SerpApi por completo y estima con IA (Gemini) usando
//                   conocimiento de Google Flights, Kayak, Skyscanner, Booking
//                   y precios históricos. Sin costo de SerpApi.
const ENABLED = true;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SERPAPI = "https://serpapi.com/search.json";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// --- FX USD→MXN con cache en memoria (TTL 6h) ---
const USD_MXN_FALLBACK = 20.5;
const FX_TTL_MS = 6 * 60 * 60 * 1000;
let fxCache: { rate: number; fetchedAt: number } | null = null;

async function getUsdMxnRate(): Promise<number> {
  const now = Date.now();
  if (fxCache && now - fxCache.fetchedAt < FX_TTL_MS) return fxCache.rate;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=MXN");
    if (!r.ok) throw new Error(`fx ${r.status}`);
    const j = await r.json();
    const rate = Number(j?.rates?.MXN);
    if (!Number.isFinite(rate) || rate < 10 || rate > 40) {
      console.warn("fx rate out of range or invalid:", rate);
      return USD_MXN_FALLBACK;
    }
    fxCache = { rate, fetchedAt: now };
    return rate;
  } catch (e) {
    console.warn("fx fetch failed, using fallback:", (e as Error).message);
    return USD_MXN_FALLBACK;
  }
}

function noPricingResponse() {
  return new Response(JSON.stringify({
    error: "no_pricing_available",
    message: "No pudimos obtener precios en este momento. Intenta de nuevo en unos minutos.",
  }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}


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
  u.searchParams.set("type", "1"); // round trip
  u.searchParams.set("adults", String(travelers));
  u.searchParams.set("currency", "USD");
  u.searchParams.set("hl", "es");
  u.searchParams.set("sort_by", "2"); // 2 = lowest price
  u.searchParams.set("api_key", key);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`flights ${r.status}`);
  const j = await r.json();
  // Combina todas las opciones y elige la MÁS BARATA real
  const all = [...(j?.best_flights ?? []), ...(j?.other_flights ?? [])]
    .filter((f: any) => Number(f?.price ?? 0) > 0)
    .sort((a: any, b: any) => Number(a.price) - Number(b.price));
  const best = all[0];
  if (!best) return null;
  const segs = best.flights ?? [];
  const airline = segs[0]?.airline ?? "—";
  const airline_logo = segs[0]?.airline_logo ?? null;
  const duration_min = best.total_duration ?? segs.reduce((s: number, x: any) => s + (x.duration ?? 0), 0);
  return {
    price_usd: Number(best.price ?? 0),
    price_per_person_usd: Math.round(Number(best.price ?? 0) / Math.max(1, travelers)),
    airline,
    airline_logo,
    duration: `${Math.floor(duration_min / 60)}h ${duration_min % 60}m`,
    stops: Math.max(0, segs.length - 1),
    departure: segs[0]?.departure_airport?.id,
    arrival: segs[segs.length - 1]?.arrival_airport?.id,
  };
}

async function serpHotels(key: string, city: string, checkin: string, checkout: string, travelers: number, nights: number) {
  const u = new URL(SERPAPI);
  u.searchParams.set("engine", "google_hotels");
  u.searchParams.set("q", `${city} hotels`);
  u.searchParams.set("check_in_date", checkin);
  u.searchParams.set("check_out_date", checkout);
  u.searchParams.set("adults", String(travelers));
  u.searchParams.set("currency", "USD");
  u.searchParams.set("hl", "es");
  u.searchParams.set("sort_by", "3");
  u.searchParams.set("min_rating", "8");
  u.searchParams.set("api_key", key);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`hotels ${r.status}`);
  const j = await r.json();
  const nightsSafe = Math.max(1, nights);

  // Deriva nightly correctamente: si no viene rate_per_night, usa total_rate / nights.
  // NUNCA tratar total_rate como si fuera por noche (bug de doble multiplicación).
  const withNightly = (j?.properties ?? []).map((p: any) => {
    const nightlyRaw = Number(p?.rate_per_night?.extracted_lowest ?? 0);
    const totalRaw = Number(p?.total_rate?.extracted_lowest ?? 0);
    const nightly = nightlyRaw > 0 ? nightlyRaw : (totalRaw > 0 ? totalRaw / nightsSafe : 0);
    return { p, nightly, nightlyRaw, totalRaw };
  }).filter((x: any) => x.nightly > 0);

  withNightly.sort((a: any, b: any) => a.nightly - b.nightly);
  const top = withNightly[0];
  if (!top) return null;

  if (top.nightly > 2000) {
    console.warn("hotels sanity: nightly>2000 usd", {
      name: top.p?.name, nightlyRaw: top.nightlyRaw, totalRaw: top.totalRaw, nights: nightsSafe, derived: top.nightly,
    });
  }

  return {
    name: top.p.name,
    rating: top.p.overall_rating ?? null,
    hotel_class: top.p.hotel_class ?? null,
    nightly_usd: Math.round(top.nightly),
    thumbnail: top.p.images?.[0]?.thumbnail ?? top.p.thumbnail ?? null,
    link: top.p.link ?? null,
  };
}


async function aiEstimate(apiKey: string, body: Body) {
  const travelers = Math.max(1, body.travelers ?? 1);
  const nights = Math.max(1, body.nights ?? 1);
  const month = body.depart ? new Date(body.depart).toLocaleString("en-US", { month: "long" }) : "—";

  const prompt = `Estima precios REALISTAS de mercado. Usa tu conocimiento de Google Flights, Kayak, Skyscanner, Booking, Expedia y precios históricos por mes/día/temporada. Sé PRECISO y CONSERVADOR — los usuarios casi siempre encuentran tarifas más caras de lo esperado. NUNCA devuelvas precios optimistas tipo "ofertón flash".

Ruta: ${body.origin} → ${body.destination}
Salida: ${body.depart} (${month})   Regreso: ${body.return_date}
Noches: ${nights}   Viajeros: ${travelers}

REFERENCIAS VUELO round-trip POR PERSONA en clase turista (temporada media):
- México ↔ Europa occidental (MAD, BCN, CDG, FCO, LHR, AMS): USD 900–1,500
- México ↔ Europa este/norte/Grecia (ATH, IST, JTR, VIE, BER): USD 1,100–1,800
- México ↔ Asia (HND, BKK, SIN, HKG, DXB, DPS): USD 1,200–2,100
- México ↔ EEUU: USD 350–900
- México ↔ Sudamérica: USD 500–1,000
- Doméstico México: USD 100–250
Temporada ALTA (jun-ago, navidad, semana santa): +25-50%. Vuelo directo: +15-30% sobre el con escala.

REFERENCIAS HOTEL por noche en USD:
- Madrid/Barcelona/Lisboa/Roma 5★: 280-450 | 4★: 150-240
- París/Londres/Ámsterdam 5★: 450-750 | 4★: 220-350
- Santorini/Mykonos temporada alta 5★: 500-900 | 4★: 280-450
- Tokio/Singapur/Hong Kong 5★: 350-600 | 4★: 200-320
- Dubai/Bangkok/Bali 5★: 250-500 | 4★: 130-250
- NYC/Miami/LA 5★: 400-700 | 4★: 220-350

Devuelve SOLO JSON válido (sin markdown):
{
  "flight": {
    "price_per_person_usd": number,    // round-trip POR PERSONA, clase turista, realista
    "airline": string,                  // aerolínea principal real (Aeromexico, Iberia, Air France, Lufthansa, Emirates...)
    "duration": string,                 // ej "11h 45m"
    "stops": number,                    // 0 directo, 1 escala
    "departure": string,                // IATA origen
    "arrival": string                   // IATA destino
  },
  "hotel": {
    "name": string,                     // hotel 4-5★ REAL conocido en el destino
    "rating": number,
    "hotel_class": number,              // 4 o 5
    "nightly_usd": number               // tarifa promedio por noche en USD
  }
}

CRITICAL: price_per_person_usd es POR PERSONA, no total. Sé realista, no barato.`;

  const r = await fetch(AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: "Eres analista senior de pricing de viajes con 15 años de experiencia. Conoces los precios reales de mercado al detalle. Respondes SOLO JSON válido. NUNCA das precios optimistas." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ai ${r.status}`);
  const j = await r.json();
  let raw = (j?.choices?.[0]?.message?.content ?? "").trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(raw);
  const f = parsed.flight ?? null;
  // Normalizar: total para todos los viajeros (compatibilidad)
  const ppp = Number(f?.price_per_person_usd ?? f?.price_usd ?? 0);
  const flight = f ? {
    price_usd: Math.round(ppp * travelers),
    price_per_person_usd: Math.round(ppp),
    airline: f.airline,
    duration: f.duration,
    stops: f.stops ?? 0,
    departure: f.departure,
    arrival: f.arrival,
  } : null;
  return { flight, hotel: parsed.hotel ?? null };
}

import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

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
      if (!flight && !hotel) return noPricingResponse();
      const flights_total = flight?.price_usd ?? 0;
      const hotel_total = hotel ? hotel.nightly_usd * nights : 0;
      const subtotal = flights_total + hotel_total;
      const total_usd = Math.round(subtotal);
      if (total_usd <= 0) return noPricingResponse();
      const fxRate = await getUsdMxnRate();
      const total_mxn = Math.round(total_usd * fxRate);
      return new Response(JSON.stringify({
        flight: flight ? { ...flight, airline_logo: null } : null,
        hotel: hotel ? { ...hotel, thumbnail: null, link: null } : null,
        breakdown: {
          flights_usd: flights_total,
          hotel_nightly_usd: hotel?.nightly_usd ?? 0,
          hotel_total_usd: hotel_total,
          nights,
          buffer_usd: 0,
        },
        total_usd,
        total_mxn,
        fx_rate: fxRate,
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

    let [flight, hotel] = await Promise.all([flightsPromise, hotelsPromise]);
    let source = "serpapi";

    // Fallback IA si SerpAPI no devolvió nada (sin créditos / error)
    if (!flight && !hotel && lovableKey) {
      try {
        const est = await aiEstimate(lovableKey, body);
        flight = est.flight as any;
        hotel = est.hotel as any;
        source = "ai-fallback";
      } catch (e) { console.error("ai fallback err:", (e as Error).message); }
    }

    if (!flight && !hotel) return noPricingResponse();

    const flights_total = flight?.price_usd ?? 0;
    const hotel_total = hotel ? hotel.nightly_usd * nights : 0;
    const subtotal = flights_total + hotel_total;
    const total_usd = Math.round(subtotal);
    if (total_usd <= 0) return noPricingResponse();
    const fxRate = await getUsdMxnRate();
    const total_mxn = Math.round(total_usd * fxRate);

    return new Response(JSON.stringify({
      flight, hotel,
      breakdown: {
        flights_usd: flights_total,
        hotel_nightly_usd: hotel?.nightly_usd ?? 0,
        hotel_total_usd: hotel_total,
        nights,
        buffer_usd: 0,
      },
      total_usd, total_mxn, fx_rate: fxRate, source,
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
