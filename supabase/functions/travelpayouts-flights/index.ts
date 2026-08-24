// supabase/functions/travelpayouts-flights/index.ts
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
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
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "travelpayouts-flights", __user.id, { perMinute: 20, perHour: 200, ipPerMinute: 60 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

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

    const fetchTp = async (departAt: string, returnAt?: string | null) => {
      const params = new URLSearchParams({
        origin,
        destination,
        departure_at: departAt,
        currency,
        sorting: "price",
        direct: "false",
        limit: "30",
        token: TP_TOKEN,
      });
      if (returnAt) params.set("return_at", returnAt);
      const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params.toString()}`;
      const res = await fetch(url, {
        headers: { "X-Access-Token": TP_TOKEN, Accept: "application/json" },
      });
      if (!res.ok) {
        const t = await res.text();
        return { ok: false, error: `Travelpayouts HTTP ${res.status}: ${t.slice(0, 300)}`, rows: [] as any[] };
      }
      const data = await res.json();
      if (!data?.success || !Array.isArray(data?.data)) {
        return { ok: false, error: "Respuesta sin data", rows: [] as any[] };
      }
      return { ok: true, error: null as string | null, rows: data.data as any[] };
    };

    // 1) Fecha exacta. 2) Si la caché de Travelpayouts no tiene esa fecha,
    //    reintenta a nivel mes (YYYY-MM) y prioriza las salidas más cercanas.
    let attempt = await fetchTp(body.departure_date, body.return_date);
    let rows = attempt.rows;
    let approximate = false;
    let lastError = attempt.error;

    if (rows.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(body.departure_date)) {
      const month = body.departure_date.slice(0, 7);
      const monthAttempt = await fetchTp(month, body.return_date ? body.return_date.slice(0, 7) : null);
      if (monthAttempt.rows.length > 0) {
        const target = new Date(body.departure_date).getTime();
        rows = monthAttempt.rows
          .slice()
          .sort((a: any, b: any) => {
            const da = Math.abs(new Date(a?.departure_at ?? 0).getTime() - target);
            const db = Math.abs(new Date(b?.departure_at ?? 0).getTime() - target);
            return da - db;
          })
          .slice(0, 20);
        approximate = true;
      } else {
        lastError = monthAttempt.error ?? lastError;
      }
    }

    const data = { data: rows };
    if (rows.length === 0) {
      return okJson({
        source: "travelpayouts",
        error: lastError ?? "sin_resultados_en_cache",
        approximate_dates: false,
        flights: [],
      });
    }


    const marker = (TP_MARKER && TP_MARKER.trim()) ? TP_MARKER.trim() : "533299";
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
      approximate_dates: approximate,
      flights,
    });

  } catch (e: any) {
    console.error("travelpayouts-flights error:", e);
    return okJson({ source: "travelpayouts", error: e?.message ?? "Error desconocido", flights: [] });
  }
});
