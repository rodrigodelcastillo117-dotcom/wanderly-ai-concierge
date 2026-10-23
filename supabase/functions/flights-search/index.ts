// flights-search — vuelos reales: Google Flights vía SerpApi y, si no hay, la caché de Travelpayouts.
// Si ninguna fuente responde se dice "no disponible" (con link de búsqueda); nunca se inventan vuelos.
// SerpApi pasa por la caché compartida (6 h) y, salvo que lo llame un análisis de viaje (que ya tiene
// su cuota), cada búsqueda real gasta de la bolsa de búsquedas en vivo del plan del usuario.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { dbCacheStore, isAnalysisCall, liveSearchGateFor, serpFetchFor } from "../_shared/serpRuntime.ts";
import { getRateToMxnInfo } from "../_shared/fx.ts";
import { finalizeSearchResponse } from "../_shared/liveSearch.ts";
import { searchFlights } from "./search.ts";
import { exploreDestinations } from "./explore.ts";
import { searchMultiCity } from "./multiCity.ts";

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
    const analysis = await isAnalysisCall(req, __user.id);
    const serp = serpFetchFor("flights-search", __user.id, analysis ? undefined : liveSearchGateFor(__user.id));
    const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");
    // "explore": Vuelos baratos desde {origen} / Explorar destinos. Con live:false solo lee la caché
    // compartida (cero búsquedas de pago); con live:true pasa por la bolsa del plan y el freno.
    // type "multi": varias ciudades (google_flights type=3). Lo demás: la búsqueda de siempre.
    const result = body?.action === "explore"
      ? await exploreDestinations(body, { serpKey, serpFetch: serp.fetch, store: dbCacheStore(), fx: (c) => getRateToMxnInfo(c) })
      : body?.type === "multi"
      ? await searchMultiCity(body, { serpKey, serpFetch: serp.fetch })
      : await searchFlights(body, {
        serpKey,
        tpToken: Deno.env.get("TRAVELPAYOUTS_TOKEN"),
        lovableKey: Deno.env.get("LOVABLE_API_KEY"),
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
