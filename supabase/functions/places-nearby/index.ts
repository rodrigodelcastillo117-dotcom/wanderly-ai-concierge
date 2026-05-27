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

const KIND_TO_QUERY: Record<string, string> = {
  restaurant: "restaurants",
  hospital: "hospitales",
  police: "policía",
  pharmacy: "farmacias",
  atm: "cajeros automáticos",
  embassy: "embajadas",
  gas_station: "gasolineras",
  lodging: "hoteles",
};

async function searchWithSerpApi(body: Body) {
  const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");
  if (!serpKey) return null;

  const query = body.keyword || KIND_TO_QUERY[body.kind] || body.kind;
  const params = new URLSearchParams({
    engine: "google_maps",
    q: query,
    ll: `@${body.lat},${body.lng},14z`,
    type: "search",
    hl: "es",
    api_key: serpKey,
  });
  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || "SerpAPI Google Maps error");

  return (data.local_results ?? []).slice(0, 15).map((p: any) => ({
    id: p.place_id ?? p.data_id ?? p.position?.toString() ?? crypto.randomUUID(),
    name: p.title ?? "",
    address: p.address ?? "",
    lat: p.gps_coordinates?.latitude ?? null,
    lng: p.gps_coordinates?.longitude ?? null,
    rating: p.rating ?? null,
    ratings_count: p.reviews ?? 0,
    price_level: p.price ?? null,
    phone: p.phone ?? null,
    maps_url: p.place_id
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.title ?? query)}&query_place_id=${encodeURIComponent(p.place_id)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.title ?? query} ${p.address ?? ""}`)}`,
    website: p.website ?? null,
    open_now: typeof p.open_state === "string" ? !p.open_state.toLowerCase().includes("cerrado") : null,
    type: p.type ?? p.types?.[0] ?? null,
    photo_url: p.thumbnail ?? null,
    source: "SerpAPI Google Maps",
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!key || !lovableKey) {
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
    const res = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": key,
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
      try {
        const fallbackPlaces = await searchWithSerpApi(body);
        if (fallbackPlaces) {
          return new Response(JSON.stringify({ ok: true, places: fallbackPlaces, source: "serpapi_fallback" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (fallbackError) {
        console.error("SerpAPI fallback error", fallbackError);
      }
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
      photo_url: null,
      source: "Google Places",
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
