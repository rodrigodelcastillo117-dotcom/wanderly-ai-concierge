// supabase/functions/travelpayouts-flights/index.ts
// Consulta precios de vuelos via Travelpayouts/Aviasales v3 prices_for_dates.
// Acepta IATA o nombre de ciudad (auto-resuelve via autocomplete Travelpayouts).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TP_TOKEN = Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? "";
// Marker de afiliado Travelpayouts. Fallback hardcoded 533299 para NUNCA perder comisión.
const TP_MARKER = (Deno.env.get("TRAVELPAYOUTS_MARKER") || TP_TOKEN.slice(0, 6) || "533299").trim() || "533299";

interface FlightsRequest {
  origin_iata?: string;
  destination_iata?: string;
  origin_city?: string;
  destination_city?: string;
  departure_date: string; // YYYY-MM-DD
  return_date?: string | null;
  adults?: number;
  currency?: string; // "usd" default
}

async function resolveIata(input: string | undefined): Promise<string | null> {
  if (!input) return null;
  const cleaned = input.trim();
  if (!cleaned) return null;
  if (/^[A-Z]{3}$/.test(cleaned.toUpperCase())) return cleaned.toUpperCase();
  try {
    const url = `https://autocomplete.travelpayouts.com/places2?term=${encodeURIComponent(cleaned)}&locale=en&types[]=city&types[]=airport`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const city = arr.find((x: any) => x?.type === "city" && x?.code) ?? arr.find((x: any) => x?.code);
    return city?.code ? String(city.code).toUpperCase() : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const okJson = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (!TP_TOKEN) {
      return okJson({ source: "travelpayouts", error: "TRAVELPAYOUTS_TOKEN no configurada", flights: [] }, 200);
    }

    const body = (await req.json()) as FlightsRequest;
    if (!body?.departure_date) {
      return okJson({ source: "travelpayouts", error: "departure_date requerido", flights: [] }, 400);
    }

    const [origin, destination] = await Promise.all([
      resolveIata(body.origin_iata ?? body.origin_city),
      resolveIata(body.destination_iata ?? body.destination_city),
    ]);

    if (!origin || !destination) {
      return okJson({
        source: "travelpayouts",
        error: `No se pudieron resolver códigos IATA (origen=${origin}, destino=${destination})`,
        flights: [],
      });
    }

    const currency = (body.currency ?? "usd").toLowerCase();
    const params = new URLSearchParams({
      origin,
      destination,
      departure_at: body.departure_date,
      currency,
      sorting: "price",
      direct: "false",
      limit: "30",
      token: TP_TOKEN,
    });
    if (body.return_date) params.set("return_at", body.return_date);

    const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params.toString()}`;
    const res = await fetch(url, {
      headers: { "X-Access-Token": TP_TOKEN, Accept: "application/json" },
    });

    if (!res.ok) {
      const t = await res.text();
      return okJson({
        source: "travelpayouts",
        error: `Travelpayouts HTTP ${res.status}: ${t.slice(0, 300)}`,
        flights: [],
      });
    }

    const data = await res.json();
    if (!data?.success || !Array.isArray(data?.data)) {
      return okJson({ source: "travelpayouts", error: "Respuesta sin data", flights: [] });
    }

    const marker = TP_MARKER || "lovable";
    const flights = data.data.slice(0, 20).map((f: any) => {
      const rawLink: string = f?.link ?? "";
      const bookingLink = rawLink
        ? `https://www.aviasales.com${rawLink}${rawLink.includes("?") ? "&" : "?"}marker=${marker}`
        : `https://www.aviasales.com/search/${origin}${(body.departure_date ?? "").replaceAll("-", "").slice(2)}${destination}?marker=${marker}`;

      return {
        airline: f?.airline ?? "",
        flight_number: f?.flight_number ?? "",
        price: Number(f?.price) || 0,
        currency: currency.toUpperCase(),
        departure_at: f?.departure_at ?? null,
        return_at: f?.return_at ?? null,
        duration_minutes: Number(f?.duration) || null,
        duration_to_minutes: Number(f?.duration_to) || null,
        duration_back_minutes: Number(f?.duration_back) || null,
        stops: Number(f?.transfers ?? 0),
        return_stops: Number(f?.return_transfers ?? 0),
        origin_airport: f?.origin_airport ?? origin,
        destination_airport: f?.destination_airport ?? destination,
        booking_link: bookingLink,
      };
    });

    flights.sort((a: any, b: any) => a.price - b.price);

    return okJson({
      source: "travelpayouts",
      consulted_at: new Date().toISOString(),
      origin,
      destination,
      currency: currency.toUpperCase(),
      departure_date: body.departure_date,
      return_date: body.return_date ?? null,
      flights,
    });
  } catch (e: any) {
    console.error("travelpayouts-flights error:", e);
    return okJson({ source: "travelpayouts", error: e?.message ?? "Error desconocido", flights: [] });
  }
});
