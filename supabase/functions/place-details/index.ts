// Places API (New) - Place Details
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "priceLevel",
  "types",
  "primaryType",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours",
  "currentOpeningHours",
  "businessStatus",
  "photos",
  "reviews",
  "editorialSummary",
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

    const url = new URL(req.url);
    let placeId = url.searchParams.get("placeId") ?? "";
    let language = url.searchParams.get("language") ?? "es";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      placeId = body.placeId ?? placeId;
      language = body.language ?? language;
    }
    if (!placeId) {
      return new Response(JSON.stringify({ error: "placeId requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(
      `https://connector-gateway.lovable.dev/google_maps/places/v1/places/${encodeURIComponent(placeId)}?languageCode=${encodeURIComponent(language)}`,
      {
        headers: {
          "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
      },
    );

    const p = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: p?.error?.message ?? "Place details error", raw: p }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = {
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
      phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      maps_url: p.googleMapsUri ?? null,
      business_status: p.businessStatus ?? null,
      opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
      open_now: p.currentOpeningHours?.openNow ?? null,
      summary: p.editorialSummary?.text ?? null,
      photos: (p.photos ?? []).slice(0, 10).map((ph: any) => ({
        ref: ph.name,
        width: ph.widthPx,
        height: ph.heightPx,
      })),
      reviews: (p.reviews ?? []).slice(0, 5).map((r: any) => ({
        author: r.authorAttribution?.displayName ?? null,
        rating: r.rating ?? null,
        text: r.text?.text ?? r.originalText?.text ?? null,
        relative_time: r.relativePublishTimeDescription ?? null,
      })),
      source: "Google Places (New)",
    };

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
