// Vista previa de "Francia → París · Lyon" en la ruta multidestino y en "Planear viaje": qué es cada
// destino escrito y por qué ciudades reales se recorre (_shared/placeResolve.ts: Google Geocoding +
// Wikidata, caché de 30 días en serp_cache). La app solo la llama cuando la persona ESCRIBE un destino que
// la tabla curada y el catálogo de ciudades no conocen; abrir una pantalla no consulta nada.
// Costo: 1 llamada de Geocoding por destino nuevo (queda en ai_usage_log); Wikidata es gratis.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { dbCacheStore } from "../_shared/serpRuntime.ts";
import { resolveDestinations } from "../_shared/placeResolve.ts";

const MAX_DESTINATIONS = 8;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "place-resolve", __user.id, { perMinute: 20, perHour: 200, ipPerMinute: 60 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const body = (await req.json().catch(() => null)) as { destinations?: unknown } | null;
    const raw = Array.isArray(body?.destinations) ? body!.destinations : [];
    const list = [...new Set(raw.map((d) => String(d ?? "").replace(/\s+/g, " ").trim().slice(0, 120)).filter((d) => d.length >= 2))]
      .slice(0, MAX_DESTINATIONS);
    if (!list.length) return json({ error: "Escribe al menos un destino." }, 400);
    const google = googleTransportFor("place-resolve", __user.id);
    const results = await resolveDestinations(list, { google, store: dbCacheStore() });
    return json({ results });
  } catch (e) {
    console.error("place-resolve:", e instanceof Error ? e.message : e);
    return json({ error: "No pudimos revisar ese destino ahora. Intenta de nuevo." }, 503);
  }
});
