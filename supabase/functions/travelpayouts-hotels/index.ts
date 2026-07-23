// supabase/functions/travelpayouts-hotels/index.ts
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
// Consulta precios de hoteles via Hotellook cache.json (Travelpayouts).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TP_TOKEN = Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? "";
const TP_MARKER = Deno.env.get("TRAVELPAYOUTS_MARKER") ?? TP_TOKEN.slice(0, 6);

interface HotelsRequest {
  city: string;
  checkin: string;  // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  adults?: number;
  currency?: string; // "usd"
  limit?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const okJson = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (!TP_TOKEN) {
      return okJson({ source: "hotellook", error: "TRAVELPAYOUTS_TOKEN no configurada", hotels: [] });
    }

    const body = (await req.json()) as HotelsRequest;
    if (!body?.city || !body?.checkin || !body?.checkout) {
      return okJson({ source: "hotellook", error: "city/checkin/checkout requeridos", hotels: [] }, 400);
    }

    const adults = Math.max(1, Number(body.adults) || 2);
    const currency = (body.currency ?? "usd").toLowerCase();
    const limit = Math.min(50, Number(body.limit) || 20);

    const params = new URLSearchParams({
      location: body.city,
      checkIn: body.checkin,
      checkOut: body.checkout,
      adults: String(adults),
      currency,
      limit: String(limit),
      token: TP_TOKEN,
    });

    const url = `https://engine.hotellook.com/api/v2/cache.json?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });

    if (!res.ok) {
      const t = await res.text();
      return okJson({
        source: "hotellook",
        error: `Hotellook HTTP ${res.status}: ${t.slice(0, 300)}`,
        hotels: [],
      });
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      return okJson({ source: "hotellook", error: "Respuesta no es array", hotels: [] });
    }

    const marker = TP_MARKER || "lovable";
    const nights = Math.max(
      1,
      Math.round(
        (new Date(body.checkout).getTime() - new Date(body.checkin).getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    const hotels = data.slice(0, limit).map((h: any) => {
      const total = Number(h?.priceFrom) || 0;
      const perNight = total > 0 ? Math.round(total / nights) : 0;
      const hotelId = h?.hotelId ?? h?.id;
      const bookingLink = hotelId
        ? `https://search.hotellook.com/hotels?hotelId=${hotelId}&checkIn=${body.checkin}&checkOut=${body.checkout}&adults=${adults}&marker=${marker}`
        : `https://search.hotellook.com/?destination=${encodeURIComponent(body.city)}&checkIn=${body.checkin}&checkOut=${body.checkout}&adults=${adults}&marker=${marker}`;

      return {
        hotel_id: hotelId ?? null,
        name: h?.hotelName ?? "Hotel",
        stars: Number(h?.stars) || null,
        rating: Number(h?.rating) || null,
        price_total: total,
        price_per_night: perNight,
        currency: currency.toUpperCase(),
        location_name: h?.location?.name ?? body.city,
        location_country: h?.location?.country ?? null,
        booking_link: bookingLink,
      };
    });

    hotels.sort((a: any, b: any) => a.price_per_night - b.price_per_night);

    return okJson({
      source: "hotellook",
      consulted_at: new Date().toISOString(),
      city: body.city,
      checkin: body.checkin,
      checkout: body.checkout,
      nights,
      adults,
      currency: currency.toUpperCase(),
      hotels,
    });
  } catch (e: any) {
    console.error("travelpayouts-hotels error:", e);
    return okJson({ source: "hotellook", error: e?.message ?? "Error desconocido", hotels: [] });
  }
});
