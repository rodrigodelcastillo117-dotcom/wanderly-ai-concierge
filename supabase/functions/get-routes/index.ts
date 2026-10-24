// Routes API v2 - computeRoutes para los 4 modos (la lógica vive en routes.ts, probada con Vitest).
// Casetas reales solo en el modo coche; se consulta únicamente cuando el usuario pulsa "Cómo llegar"
// o "Consultar casetas" (nunca al abrir una pantalla).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { dbCacheStore } from "../_shared/serpRuntime.ts";
import { getRateToMxnInfo } from "../_shared/fx.ts";
import { type Body, computeRoutes, waypoint } from "./routes.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "get-routes", __user.id, { perMinute: 20, perHour: 200, ipPerMinute: 60 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


  try {
    // Transporte del conector de Google que ya existe (misma llave del servidor; registra el uso).
    const google = googleTransportFor("get-routes", __user.id);
    if (!google) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.origin || !body?.destination) {
      return new Response(JSON.stringify({ error: "origin y destination requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!waypoint(body.origin) || !waypoint(body.destination)) {
      return new Response(JSON.stringify({ error: "Cada punto requiere {lat,lng}, placeId o address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await computeRoutes(google, body, { store: dbCacheStore(), rate: (c) => getRateToMxnInfo(c) });

    return new Response(JSON.stringify({ routes: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "No pudimos calcular la ruta en este momento." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
