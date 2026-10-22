// hotels-search — hoteles reales de Google Hotels vía SerpApi + link de Booking (afiliado).
// Si SerpApi no responde se dice "no disponible" (con link de búsqueda); nunca se inventan hoteles.
// SerpApi pasa por la caché compartida (12 h) y, salvo que lo llame un análisis de viaje (que ya
// tiene su cuota), cada búsqueda real gasta de la bolsa de búsquedas en vivo del plan del usuario.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { isAnalysisCall, liveSearchGateFor, serpFetchFor } from "../_shared/serpRuntime.ts";
import { finalizeSearchResponse } from "../_shared/liveSearch.ts";
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
    const analysis = await isAnalysisCall(req, __user.id);
    const serp = serpFetchFor("hotels-search", __user.id, analysis ? undefined : liveSearchGateFor(__user.id));
    const result = await searchHotels(body, {
      serpKey: Deno.env.get("SERPAPI_PRIVATE_KEY"),
      marker: Deno.env.get("TRAVELPAYOUTS_MARKER"),
      serpFetch: serp.fetch,
    });
    const { status, body: out } = finalizeSearchResponse(result, serp.trace);
    return new Response(JSON.stringify(out), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
