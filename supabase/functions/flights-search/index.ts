// flights-search — vuelos reales: Google Flights vía SerpApi y, si no hay, la caché de Travelpayouts.
// Si ninguna fuente responde se dice "no disponible" (con link de búsqueda); nunca se inventan vuelos.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { searchFlights } from "./search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "flights-search", __user.id, { perMinute: 15, perHour: 150, ipPerMinute: 50 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const body = await req.json();
    const { status, body: out } = await searchFlights(body, {
      serpKey: Deno.env.get("SERPAPI_PRIVATE_KEY"),
      tpToken: Deno.env.get("TRAVELPAYOUTS_TOKEN"),
      lovableKey: Deno.env.get("LOVABLE_API_KEY"),
      marker: Deno.env.get("TRAVELPAYOUTS_MARKER"),
    });
    return new Response(JSON.stringify(out), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
