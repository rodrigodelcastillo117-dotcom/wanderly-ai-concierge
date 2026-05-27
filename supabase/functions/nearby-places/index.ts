// Places API (New) — Nearby Search
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Body = {
  lat: number;
  lng: number;
  radius?: number; // meters, default 1500, max 50000
  type?: string;   // "restaurant" (default), "cafe", "bar", "tourist_attraction", etc.
  types?: string[];
  language?: string;
  maxResults?: number; // 1-20
  rankPreference?: "POPULARITY" | "DISTANCE";
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.types",
  "places.primaryType",
  "places.googleMapsUri",
  "places.photos",
  "places.currentOpeningHours.openNow",
  "places.businessStatus",
].join(",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (typeof body?.lat !== "number" || typeof body?.lng !== "number") {
      return new Response(JSON.stringify({ error: "lat y lng requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const includedTypes = body.types?.length ? body.types : [body.type ?? "restaurant"];
    const radius = Math.min(Math.max(body.radius ?? 1500, 1), 50000);

    const payload = {
      includedTypes,
      maxResultCount: Math.min(Math.max(body.maxResults ?? 20, 1), 20),
      languageCode: body.language ?? "es",
      rankPreference: body.rankPreference ?? "POPULARITY",
      locationRestriction: {
        circle: {
          center: { latitude: body.lat, longitude: body.lng },
          radius,
        },
      },
    };

    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message ?? "Nearby error", raw: data }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = (data.places ?? []).map((p: any) => ({
      placeId: p.id,
      name: p.displayName?.text ?? null,
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      ratings_count: p.userRatingCount ?? 0,
      price_level: p.priceLevel ?? null,
      types: p.types ?? [],
      primary_type: p.primaryType ?? null,
      maps_url: p.googleMapsUri ?? null,
      open_now: p.currentOpeningHours?.openNow ?? null,
      business_status: p.businessStatus ?? null,
      photo_ref: p.photos?.[0]?.name ?? null,
      source: "Google Places (New)",
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
