// suggest-restaurants — restaurantes REALES por ciudad para viajes que no los traen (típico de
// imports de PDF). Antes los "sugería" un modelo de IA con rangos de precio sin fuente; ahora
// salen de Google Places API (New): nombre, calificación y número de reseñas, nivel de precio,
// horario, si acepta reservaciones, sitio web y link de Google Maps, con la fecha de consulta.
// Si Google no responde se devuelve una lista vacía con el motivo: nunca se inventa.
//
// Personalización (_shared/tasteProfile.ts): la lista de Google se REORDENA según las cocinas que
// la persona elige de verdad (visitas, favoritos, Mejores momentos) y cada coincidencia lleva su
// porqué ("Para ti: te gusta la cocina japonesa (4 visitas)"). Una restricción (vegano, sin gluten)
// entra en la búsqueda. No se agregan restaurantes ni se cambian sus datos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { getTasteProfile } from "../_shared/tasteProfileStore.ts";
import { personalizeRestaurants, restaurantQueryPreference, tasteToday, type TasteProfile } from "../_shared/tasteProfile.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { googleErrorMessage } from "../_shared/google-maps.ts";
import { suggestRestaurants } from "../_shared/google-restaurants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

/** Perfil de gustos con tope de 800 ms: sin él la lista sale igual, en el orden de Google. */
async function tasteFor(req: Request, userId: string): Promise<TasteProfile | null> {
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const r = await getTasteProfile({ db, cache: adminClient(), userId, todayISO: tasteToday(), timeoutMs: 800 });
    return r.profile;
  } catch {
    return null;
  }
}

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
    // Con preferencia explícita, Google y el perfil van en paralelo; sin ella, el perfil decide si
    // hay una restricción que buscar (vegano, sin gluten…).
    const tasteP = tasteFor(req, __user.id);
    const explicit = String(preferences ?? "").trim();
    const outP = explicit ? suggestRestaurants(transport, { cities, travelers, preferences: explicit }) : null;
    const taste = await tasteP;
    const out = await (outP ?? suggestRestaurants(transport, { cities, travelers, preferences: restaurantQueryPreference(taste) ?? "" }));
    return json({ ...out, restaurantes: personalizeRestaurants(out.restaurantes, taste), personalizado: !!taste });
  } catch (e) {
    console.error("suggest-restaurants error:", (e as Error).message);
    return json({ ok: false, restaurantes: [], disponible: false, motivo: googleErrorMessage("error") }, 500);
  }
});
