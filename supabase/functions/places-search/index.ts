// Places API (New) - Text Search
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

type Body = {
  query: string;
  lat?: number;
  lng?: number;
  radius?: number; // meters, default 5000
  language?: string; // default es
  region?: string;  // ej "mx"
  maxResults?: number; // 1-20
  openNow?: boolean;
  minRating?: number;
  priceLevels?: string[]; // PRICE_LEVEL_FREE, INEXPENSIVE, MODERATE, EXPENSIVE, VERY_EXPENSIVE
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
  "places.websiteUri",
  "places.photos",
  "places.currentOpeningHours.openNow",
  "places.businessStatus",
].join(",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);


  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!key || !lovableKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.query || typeof body.query !== "string" || body.query.trim().length === 0) {
      return new Response(JSON.stringify({ error: "query requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: Record<string, unknown> = {
      textQuery: body.query.trim(),
      languageCode: body.language ?? "es",
      maxResultCount: Math.min(Math.max(body.maxResults ?? 10, 1), 20),
    };
    if (body.region) payload.regionCode = body.region;
    if (typeof body.openNow === "boolean") payload.openNow = body.openNow;
    if (typeof body.minRating === "number") payload.minRating = body.minRating;
    if (body.priceLevels?.length) payload.priceLevels = body.priceLevels;
    if (typeof body.lat === "number" && typeof body.lng === "number") {
      payload.locationBias = {
        circle: {
          center: { latitude: body.lat, longitude: body.lng },
          radius: Math.min(Math.max(body.radius ?? 5000, 1), 50000),
        },
      };
    }

    const res = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message ?? "Places searchText error", raw: data }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = (data.places ?? []).map((p: any) => ({
      id: p.id,
      name: p.displayName?.text ?? null,
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      ratings_count: p.userRatingCount ?? 0,
      price_level: p.priceLevel ?? null,
      primary_type: p.primaryType ?? null,
      types: p.types ?? [],
      maps_url: p.googleMapsUri ?? null,
      website: p.websiteUri ?? null,
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
