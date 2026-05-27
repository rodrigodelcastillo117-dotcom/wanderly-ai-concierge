// Recalcula profiles.food_dna a partir de visited_places del usuario.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = userData.user.id;

    const { data: visits, error } = await supabase
      .from("visited_places")
      .select("cuisine,price_level,rating,lat,lng,primary_type,visited_at")
      .eq("user_id", user_id)
      .eq("status", "visited");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cuisines: Record<string, number> = {};
    const prices: Record<string, number> = {};
    const types: Record<string, number> = {};
    let ratingSum = 0; let ratingN = 0;
    let latSum = 0; let lngSum = 0; let geoN = 0;

    for (const v of visits ?? []) {
      if (v.cuisine) cuisines[v.cuisine] = (cuisines[v.cuisine] ?? 0) + 1;
      if (v.price_level) prices[v.price_level] = (prices[v.price_level] ?? 0) + 1;
      if (v.primary_type) types[v.primary_type] = (types[v.primary_type] ?? 0) + 1;
      if (typeof v.rating === "number") { ratingSum += v.rating; ratingN++; }
      if (typeof v.lat === "number" && typeof v.lng === "number") {
        latSum += Number(v.lat); lngSum += Number(v.lng); geoN++;
      }
    }

    const top = (obj: Record<string, number>, n = 5) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));

    const food_dna = {
      total_visits: visits?.length ?? 0,
      avg_rating: ratingN ? Number((ratingSum / ratingN).toFixed(2)) : null,
      top_cuisines: top(cuisines, 8),
      preferred_price: top(prices, 3)[0]?.key ?? null,
      price_distribution: top(prices, 5),
      top_types: top(types, 6),
      home_centroid: geoN ? { lat: latSum / geoN, lng: lngSum / geoN } : null,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from("profiles")
      .update({ food_dna })
      .eq("id", user_id);
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, food_dna }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
