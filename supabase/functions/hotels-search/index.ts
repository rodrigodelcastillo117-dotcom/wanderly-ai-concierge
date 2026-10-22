// hotels-search — hoteles reales de Google Hotels vía SerpApi + link de Booking (afiliado).
// Si SerpApi no responde se dice "no disponible" (con link de búsqueda); nunca se inventan hoteles.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { searchHotels } from "./search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "hotels-search", __user.id, {
    perMinute: 12, perHour: 120, ipPerMinute: 40,
  });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const body = await req.json();
    const { status, body: out } = await searchHotels(body, {
      serpKey: Deno.env.get("SERPAPI_PRIVATE_KEY"),
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
