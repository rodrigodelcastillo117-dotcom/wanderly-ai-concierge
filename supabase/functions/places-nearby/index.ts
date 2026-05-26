// Google Places Nearby Search (New API) — usa el GOOGLE_MAPS_API_KEY del connector
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Body = {
  lat: number;
  lng: number;
  kind: "restaurant" | "hospital" | "police" | "pharmacy" | "atm" | "embassy" | "gas_station" | "lodging";
  radius?: number; // meters, default 1500
  keyword?: string;
};

const KIND_TO_TYPE: Record<string, string> = {
  restaurant: "restaurant",
  hospital: "hospital",
  police: "police",
  pharmacy: "pharmacy",
  atm: "atm",
  embassy: "embassy",
  gas_station: "gas_station",
  lodging: "lodging",
};

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
    if (typeof body?.lat !== "number" || typeof body?.lng !== "number" || !body?.kind) {
      return new Response(JSON.stringify({ error: "lat, lng, kind requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const type = KIND_TO_TYPE[body.kind];
    if (!type) {
      return new Response(JSON.stringify({ error: "kind inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Places API (New) — searchNearby
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.rating",
          "places.userRatingCount",
          "places.priceLevel",
          "places.nationalPhoneNumber",
          "places.internationalPhoneNumber",
          "places.googleMapsUri",
          "places.websiteUri",
          "places.currentOpeningHours.openNow",
          "places.primaryTypeDisplayName",
        ].join(","),
      },
      body: JSON.stringify({
        includedTypes: [type],
        maxResultCount: 15,
        locationRestriction: {
          circle: {
            center: { latitude: body.lat, longitude: body.lng },
            radius: body.radius ?? 1500,
          },
        },
        rankPreference: "DISTANCE",
        languageCode: "es",
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Places API error", data);
      return new Response(JSON.stringify({ error: data?.error?.message || "Places API error", details: data }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const places = (data.places ?? []).map((p: any) => ({
      id: p.id,
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating ?? null,
      ratings_count: p.userRatingCount ?? 0,
      price_level: p.priceLevel ?? null,
      phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
      maps_url: p.googleMapsUri ?? null,
      website: p.websiteUri ?? null,
      open_now: p.currentOpeningHours?.openNow ?? null,
      type: p.primaryTypeDisplayName?.text ?? null,
    }));

    return new Response(JSON.stringify({ ok: true, places }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
