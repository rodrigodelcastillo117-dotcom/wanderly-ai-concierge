// suggest-restaurants — restaurantes REALES por ciudad para viajes que no los traen (típico de
// imports de PDF). Antes los "sugería" un modelo de IA con rangos de precio sin fuente; ahora
// salen de Google Places API (New): nombre, calificación y número de reseñas, nivel de precio,
// horario, si acepta reservaciones, sitio web y link de Google Maps, con la fecha de consulta.
// Si Google no responde se devuelve una lista vacía con el motivo: nunca se inventa.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { googleErrorMessage } from "../_shared/google-maps.ts";
import { suggestRestaurants } from "../_shared/google-restaurants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "suggest-restaurants", __user.id, { perMinute: 10, perHour: 80, ipPerMinute: 30 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const { cities = [], travelers = 2, preferences = "" } = await req.json();
    if (!Array.isArray(cities) || cities.length === 0) return json({ error: "cities[] requerido" }, 400);

    const transport = googleTransportFor("suggest-restaurants", __user.id);
    if (!transport) {
      return json({ ok: false, restaurantes: [], disponible: false, motivo: googleErrorMessage("error") });
    }
    return json(await suggestRestaurants(transport, { cities, travelers, preferences }));
  } catch (e) {
    console.error("suggest-restaurants error:", (e as Error).message);
    return json({ ok: false, restaurantes: [], disponible: false, motivo: googleErrorMessage("error") }, 500);
  }
});
