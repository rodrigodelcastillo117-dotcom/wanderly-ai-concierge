// Lógica de flights-search sin Deno.serve, para poder probarla con fetch simulado.
//
// Fuentes, en orden: Google Flights (SerpApi, en vivo) → Travelpayouts (caché de búsquedas de
// Aviasales, hasta 48 h). Si ninguna trae vuelos se responde con results: [] y disponible: false,
// más un link de búsqueda de afiliado. NUNCA se sustituyen por vuelos "estimados" por IA: antes
// se devolvían aerolíneas y precios inventados con botón de compra, como si fueran reales.
import { aiFetch } from "../_shared/ai.ts";
import { resolveTpMarker } from "../_shared/tp-params.ts";
import { mainAirport } from "../_shared/airports.ts";
import { googleFlightsSearchUrl } from "../_shared/booking/links.ts";
import { airlineCode } from "../_shared/airlines.ts";

const SERPAPI = "https://serpapi.com/search.json";

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

export function quickIata(city: string): string | null {
  if (!city) return null;
  // Tabla compartida de aeropuertos: entiende acentos y espacios ("Ciudad de México " → MEX) y
  // cambia un código de ciudad por su aeropuerto principal.
  const known = mainAirport(city);
  if (known) return known;
  const k = city.toLowerCase().trim().split(",")[0].trim();
  return IATA[k] ?? (/^[A-Za-z]{3}$/.test(k) ? k.toUpperCase() : null);
}

async function aiIata(apiKey: string, city: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await aiFetch({
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-flash-latest",
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

function ensureAviasalesMarker(url: string, marker: string) {
  if (!/^https:\/\/(www\.)?aviasales\.com\//i.test(url)) return url;
  if (/[?&]marker=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}marker=${marker}`;
}

// Aviasales deep-link con marker de afiliado Travelpayouts (formato DDMM).
// NUNCA usamos google.com/travel — Google bloquea ese embed con ERR_BLOCKED_BY_RESPONSE.
export function aviasalesBuyUrl(depIata: string, arrIata: string, depart: string, ret: string | null | undefined, adults: number, marker: string) {
  const dd = (depart ?? "").split("-");
  const rd = (ret ?? "").split("-");
  const datePart = dd.length === 3 ? `${dd[2]}${dd[1]}` : "";
  const retPart = rd.length === 3 ? `${rd[2]}${rd[1]}` : "";
  return ensureAviasalesMarker(`https://www.aviasales.com/search/${depIata}${datePart}${arrIata}${retPart}${adults}`, marker);
}

// Mapa de aerolíneas → sitio oficial (cuando no hay link de Aviasales).
const AIRLINE_SITES: Record<string, string> = {
  "aeromexico": "https://aeromexico.com", "aeroméxico": "https://aeromexico.com", "am": "https://aeromexico.com",
  "iberia": "https://iberia.com", "ib": "https://iberia.com",
  "american": "https://aa.com", "american airlines": "https://aa.com", "aa": "https://aa.com",
  "united": "https://united.com", "ua": "https://united.com",
  "delta": "https://delta.com", "dl": "https://delta.com",
  "air france": "https://airfrance.com", "af": "https://airfrance.com",
  "klm": "https://klm.com", "kl": "https://klm.com",
  "lufthansa": "https://lufthansa.com", "lh": "https://lufthansa.com",
  "british airways": "https://britishairways.com", "ba": "https://britishairways.com",
  "latam": "https://latam.com", "la": "https://latam.com",
  "avianca": "https://avianca.com", "av": "https://avianca.com",
  "volaris": "https://volaris.com", "y4": "https://volaris.com",
  "viva aerobus": "https://vivaaerobus.com", "vivaaerobus": "https://vivaaerobus.com", "vb": "https://vivaaerobus.com",
  "air canada": "https://aircanada.com", "ac": "https://aircanada.com",
  "turkish airlines": "https://turkishairlines.com", "tk": "https://turkishairlines.com",
};
function airlineSite(airline: string) {
  const key = (airline ?? "").toLowerCase().trim();
  return AIRLINE_SITES[key] ?? `https://www.google.com/search?q=${encodeURIComponent(airline + " vuelos")}`;
}

export type FlightsSearchEnv = {
  serpKey?: string | null;
  tpToken?: string | null;
  lovableKey?: string | null;
  marker?: string | null;
  /** fetch para SerpApi: el de la caché compartida (_shared/serpCache.ts) en producción. */
  serpFetch?: typeof fetch;
};

export type SearchResult = { status: number; body: Record<string, unknown> };

export const MOTIVO_NO_DISPONIBLE = "Búsqueda en vivo no disponible ahora; intenta más tarde.";

/** Travelpayouts es un respaldo: tarifas que otros viajeros encontraron en las últimas 48 h. */
export const TP_LABEL = "Precio de referencia (Aviasales, búsquedas de las últimas 48 h); puede variar";

const minutes = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
const hm = (m: number | null) => (m === null ? "—" : `${Math.floor(m / 60)}h ${m % 60}m`);

/**
 * Un resultado de Google Flights (SerpApi) con todo lo que trae: tramos con aerolínea, número de
 * vuelo, horarios, avión y clase; escalas con su duración; emisiones. `price` es el total para
 * todos los viajeros (ida y vuelta si es redondo, como lo muestra Google Flights).
 */
export function googleFlightResult(f: any, travelers: number, roundTrip: boolean, searchLink: string,
  q?: { origin: string; destination: string; depart: string; ret?: string | null; leg?: "outbound" | "return" }) {
  const segs: any[] = Array.isArray(f?.flights) ? f.flights : [];
  const dur = minutes(f?.total_duration) ?? 0;
  const airline = segs[0]?.airline ?? "—";
  const airlines = [...new Set(segs.map((s) => s?.airline).filter(Boolean))];
  const price = Number(f?.price ?? 0);
  // Se compra en la MISMA fuente que dio el precio: Google Flights con ruta, fechas y pasajeros (tfs).
  // Aviasales queda como búsqueda alternativa, dicho así (su precio puede no coincidir).
  const gf = q ? googleFlightsSearchUrl({ ...q, ret: roundTrip ? q.ret ?? null : null, adults: travelers,
    airline: airlines.length === 1 ? airlineCode(String(airline)) : null }) : null;
  return {
    price_usd: price,
    price_per_person_usd: Math.round(price / Math.max(1, travelers)),
    airline,
    airlines,
    airline_logo: segs[0]?.airline_logo ?? f?.airline_logo ?? null,
    duration: `${Math.floor(dur / 60)}h ${dur % 60}m`,
    duration_minutes: dur || null,
    stops: Math.max(0, segs.length - 1),
    departure: { id: segs[0]?.departure_airport?.id, time: segs[0]?.departure_airport?.time },
    arrival: { id: segs[segs.length - 1]?.arrival_airport?.id, time: segs[segs.length - 1]?.arrival_airport?.time },
    segments: segs.map((s) => ({
      airline: s?.airline ?? null,
      flight_number: s?.flight_number ?? null,
      from: s?.departure_airport?.id ?? null,
      from_name: s?.departure_airport?.name ?? null,
      departs: s?.departure_airport?.time ?? null,
      to: s?.arrival_airport?.id ?? null,
      to_name: s?.arrival_airport?.name ?? null,
      arrives: s?.arrival_airport?.time ?? null,
      duration: hm(minutes(s?.duration)),
      airplane: s?.airplane ?? null,
      travel_class: s?.travel_class ?? null,
      overnight: s?.overnight === true,
      often_delayed: s?.often_delayed_by_over_30_min === true,
    })),
    layovers: (Array.isArray(f?.layovers) ? f.layovers : []).map((l: any) => ({
      airport: l?.id ?? null,
      name: l?.name ?? null,
      duration: hm(minutes(l?.duration)),
      overnight: l?.overnight === true,
    })),
    carbon_kg: minutes(f?.carbon_emissions?.this_flight) !== null ? Math.round(f.carbon_emissions.this_flight / 1000) : null,
    price_note: `Precio total para ${Math.max(1, travelers)} ${travelers === 1 ? "viajero" : "viajeros"}${roundTrip ? ", ida y vuelta" : ", solo ida"}, según Google Flights.`,
    booking_token: f?.booking_token ?? null,
    departure_token: f?.departure_token ?? null,
    buy_url: gf ?? searchLink,
    ...(gf ? { alt_buy_url: searchLink, alt_buy_note: "Búsqueda alternativa en Aviasales: el precio puede variar." } : {}),
    // Google Flights da el precio ida y vuelta, pero los tramos son solo de la ida (o, en el paso del
    // regreso, solo del regreso). Con departure_token se elige el regreso en IATOS (searchFlights).
    tramos: q?.leg === "return" ? "regreso (el precio es el total ida y vuelta)"
      : roundTrip ? (f?.departure_token ? "solo la ida (elige el regreso; el precio ya es ida y vuelta)" : "solo la ida (el regreso se elige al comprar; el precio ya es ida y vuelta)")
      : "solo ida",
    ...(q?.leg === "return" ? { tramo: "regreso" } : roundTrip ? { tramo: "ida" } : {}),
    airline_buy_url: airlineSite(airline),
    fuente: "google_flights",
  };
}

export async function searchFlights(body: any, env: FlightsSearchEnv): Promise<SearchResult> {
  const { origin, destination, depart, return_date, travelers = 1, type = "round" } = body ?? {};
  const marker = resolveTpMarker(env.marker);
  const roundTrip = type === "round" && !!return_date;
  // Paso 2 de un viaje redondo (SerpApi): con el departure_token de la ida elegida, Google Flights
  // devuelve los regresos de ESA ida, cada uno con su booking_token (→ booking_options en
  // booking-bridge "Comprobar precio"). Sin esto un redondo nunca tenía booking_token.
  const departureToken = typeof body?.departure_token === "string" && body.departure_token.length > 0 && body.departure_token.length <= 4000
    ? body.departure_token : null;
  if (departureToken && !roundTrip) {
    return { status: 400, body: { ok: false, error: "departure_token_requiere_redondo" } };
  }

  let dep = quickIata(origin);
  let arr = quickIata(destination);
  if ((!dep || !arr) && env.lovableKey) {
    const [d2, a2] = await Promise.all([
      dep ? Promise.resolve(dep) : aiIata(env.lovableKey, origin),
      arr ? Promise.resolve(arr) : aiIata(env.lovableKey, destination),
    ]);
    dep = d2 ?? dep; arr = a2 ?? arr;
  }
  if (!dep || !arr) {
    return { status: 400, body: { ok: false, error: "no_iata", origin, destination } };
  }

  const searchLink = aviasalesBuyUrl(dep, arr, depart, roundTrip ? return_date : null, travelers, marker);
  let results: any[] = [];
  let source = "none";
  let google_flights_url: string | null = null;
  const fallas: string[] = [];

  if (env.serpKey) {
    const u = new URL(SERPAPI);
    u.searchParams.set("engine", "google_flights");
    u.searchParams.set("departure_id", dep);
    u.searchParams.set("arrival_id", arr);
    u.searchParams.set("outbound_date", depart);
    if (roundTrip) u.searchParams.set("return_date", return_date);
    u.searchParams.set("type", roundTrip ? "1" : "2");
    u.searchParams.set("adults", String(travelers));
    u.searchParams.set("currency", "USD");
    u.searchParams.set("hl", "es");
    u.searchParams.set("sort_by", "2"); // más barato primero
    if (departureToken) u.searchParams.set("departure_token", departureToken);
    u.searchParams.set("api_key", env.serpKey);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 18000);
      const r = await (env.serpFetch ?? fetch)(u.toString(), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
      if (r.ok) {
        const j = await r.json();
        google_flights_url = j?.search_metadata?.google_flights_url ?? null;
        const all = [...(j?.best_flights ?? []), ...(j?.other_flights ?? [])]
          .filter((f: any) => Number(f?.price ?? 0) > 0)
          .sort((a: any, b: any) => Number(a.price) - Number(b.price))
          .slice(0, 12);
        results = all.map((f: any) => googleFlightResult(f, travelers, roundTrip, searchLink,
          { origin: dep!, destination: arr!, depart, ret: return_date ?? null, leg: departureToken ? "return" : "outbound" }));
        if (results.length > 0) source = "serpapi";
        else fallas.push("google_flights_sin_resultados");
      } else if (r.headers.get("x-iatos-cache") === "limit") {
        // La bolsa de búsquedas en vivo del plan se agotó: no se llamó a SerpApi.
        fallas.push("google_flights_limite_del_plan");
      } else if (r.headers.get("x-iatos-cache") === "paused") {
        // La cuenta de SerpApi está en pausa (presupuesto o cuota) y no había precio guardado.
        fallas.push("google_flights_busquedas_en_pausa");
      } else {
        // Nunca registrar la URL: lleva la API key.
        console.error("serpapi flights status:", r.status);
        fallas.push(`google_flights_http_${r.status}`);
      }
    } catch (e) {
      console.error("serpapi flights err:", (e as Error).message);
      fallas.push("google_flights_error");
    }
  } else {
    fallas.push("google_flights_sin_llave");
  }

  // Respaldo con datos REALES: precios en caché de Travelpayouts (búsquedas de las últimas ~48 h).
  // No aplica al paso del regreso: Aviasales no sabe qué ida se eligió.
  if (results.length === 0 && env.tpToken && !departureToken) {
    try {
      const u = new URL("https://api.travelpayouts.com/v1/prices/cheap");
      u.searchParams.set("origin", dep);
      u.searchParams.set("destination", arr);
      u.searchParams.set("depart_date", depart);
      if (roundTrip) u.searchParams.set("return_date", return_date);
      u.searchParams.set("currency", "usd");
      u.searchParams.set("token", env.tpToken);
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(u.toString(), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
      if (r.ok) {
        const j = await r.json();
        const items: any[] = Object.values(j?.data?.[arr] ?? {});
        results = items.slice(0, 10).map((o: any) => ({
          price_usd: Math.round(Number(o.price ?? 0) * travelers),
          price_per_person_usd: Math.round(Number(o.price ?? 0)),
          airline: o.airline ?? "—",
          airline_logo: o.airline ? `https://pics.avs.io/200/80/${o.airline}.png` : null,
          duration: "—",
          stops: Number(o.transfers ?? 0),
          departure: { id: dep, time: o.departure_at ?? null },
          // La caché no trae hora de llegada; `return_at` es la salida del regreso, no la llegada.
          arrival: { id: arr, time: null },
          return_at: o.return_at ?? null,
          booking_token: null,
          buy_url: searchLink,
          airline_buy_url: searchLink,
          // Caché de búsquedas de otros viajeros (hasta 48 h): nunca "en vivo".
          fuente: "travelpayouts",
          estado_dato: "ESTIMADO",
          etiqueta: TP_LABEL,
          vigencia_hasta: typeof o.expires_at === "string" ? o.expires_at : null,
        }))
          .filter((x) => x.price_per_person_usd > 0)
          .sort((a, b) => a.price_per_person_usd - b.price_per_person_usd);
        if (results.length > 0) source = "travelpayouts";
        else fallas.push("travelpayouts_sin_resultados");
      } else {
        console.error("travelpayouts status:", r.status);
        fallas.push(`travelpayouts_http_${r.status}`);
      }
    } catch (e) {
      console.error("travelpayouts err:", (e as Error).message);
      fallas.push("travelpayouts_error");
    }
  }

  const disponible = results.length > 0;
  return {
    status: 200,
    body: {
      ok: true,
      source,
      disponible,
      results,
      // Etiqueta legible de la fuente (la fecha real la agrega finalizeSearchResponse).
      etiqueta_fuente: source === "serpapi" ? "Google Flights" : source === "travelpayouts" ? TP_LABEL : null,
      ...(source === "travelpayouts" ? { estado_dato: "ESTIMADO" } : {}),
      ...(disponible ? {} : { motivo: MOTIVO_NO_DISPONIBLE, fallas }),
      consulted_at: new Date().toISOString(),
      // Travelpayouts es caché (hasta 48 h); Google Flights se consulta en el momento.
      cache_max_age_h: source === "travelpayouts" ? 48 : source === "serpapi" ? 0 : null,
      // Link de búsqueda (sin precio) para que el usuario busque por su cuenta si no hay datos.
      search_url: searchLink,
      google_flights_url: google_flights_url ?? searchLink,
      meta: { origin, destination, depart, return_date, travelers, dep_iata: dep, arr_iata: arr, ...(departureToken ? { leg: "return" } : {}) },
    },
  };
}
