// Geocoding API - address → lat/lng (y reverse opcional)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!key || !lovableKey) {
      return new Response(JSON.stringify({ error: "Google Maps connector no configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    let address = url.searchParams.get("address") ?? "";
    let latlng = url.searchParams.get("latlng") ?? "";
    let language = url.searchParams.get("language") ?? "es";
    let region = url.searchParams.get("region") ?? "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      address = body.address ?? address;
      latlng = body.latlng ?? latlng;
      language = body.language ?? language;
      region = body.region ?? region;
    }

    if (!address && !latlng) {
      return new Response(JSON.stringify({ error: "address o latlng requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({ key, language });
    if (address) params.set("address", address);
    if (latlng) params.set("latlng", latlng);
    if (region) params.set("region", region);

    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || (data.status !== "OK" && data.status !== "ZERO_RESULTS")) {
      return new Response(JSON.stringify({ error: data?.error_message ?? data?.status ?? "Geocode error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = (data.results ?? []).map((r: any) => ({
      formatted_address: r.formatted_address,
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
      place_id: r.place_id ?? null,
      types: r.types ?? [],
      location_type: r.geometry?.location_type ?? null,
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
