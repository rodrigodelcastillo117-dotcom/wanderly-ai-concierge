// Places API (New) - Text Search. La usa Iato (search_places). Usa el transporte y los presets de
// _shared/google-places.ts (antes armaba su propia máscara):
//   * consulta de comida (restaurante, cena, desayuno, brunch, trattoria…) o `food`/`meal` → preset
//     "atmosphere" (Text Search Enterprise + Atmosphere): trae reservable, servesBreakfast/Brunch/
//     Lunch/Dinner, sitio, teléfonos, nivel de precio y horario. Solo cuando el usuario busca.
//   * cualquier otra → preset "rich" (Text Search Enterprise, el mismo SKU que la máscara anterior:
//     rating, nivel de precio, sitio y horario) + teléfonos.
// `meal` ("desayuno" | "brunch" | "comida" | "cena") filtra con los campos serves* reales de Google
// (sin dato no entra). La llave de Google vive solo en el servidor.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { googleErrorMessage } from "../_shared/google-maps.ts";
import { type PriceLevel, searchText } from "../_shared/google-places.ts";
import { placesSearchOutput, placesSearchPreset } from "./shape.ts";

type Body = {
  query: string;
  lat?: number;
  lng?: number;
  radius?: number; // meters, default 5000
  language?: string; // default es
  region?: string;  // ej "mx"
  maxResults?: number; // 1-20
  openNow?: boolean;
  minRating?: number;
  priceLevels?: string[]; // PRICE_LEVEL_FREE, INEXPENSIVE, MODERATE, EXPENSIVE, VERY_EXPENSIVE
  /** Pide los campos de restaurante (reservable, sirve desayuno/comida/cena). */
  food?: boolean;
  /** Filtra por comida con servesBreakfast/Brunch/Lunch/Dinner. */
  meal?: string;
  /** Ciudad para armar "Reservar en TheFork". */
  city?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "places-search", __user.id, { perMinute: 30, perHour: 300, ipPerMinute: 80 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const transport = googleTransportFor("places-search", __user.id);
    if (!transport) return json({ error: "GOOGLE_MAPS_API_KEY no configurada" }, 500);

    const body = (await req.json()) as Body;
    if (!body?.query || typeof body.query !== "string" || body.query.trim().length === 0) return json({ error: "query requerido" }, 400);

    const preset = placesSearchPreset(body);
    const r = await searchText(transport, {
      query: body.query.trim(),
      language: body.language ?? "es",
      region: body.region,
      maxResults: Math.min(Math.max(body.maxResults ?? 10, 1), 20),
      openNow: typeof body.openNow === "boolean" ? body.openNow : undefined,
      minRating: typeof body.minRating === "number" ? body.minRating : undefined,
      priceLevels: Array.isArray(body.priceLevels) ? body.priceLevels.filter((x): x is PriceLevel => typeof x === "string" && x.startsWith("PRICE_LEVEL_")) : undefined,
      near: typeof body.lat === "number" && typeof body.lng === "number" ? { lat: body.lat, lng: body.lng, radius: body.radius ?? 5000 } : undefined,
      preset,
      dropClosed: true,
    });
    if (!r.ok) return json({ error: googleErrorMessage(r.error.kind), kind: r.error.kind }, r.error.status >= 400 ? r.error.status : 502);
    return json(placesSearchOutput(r.places, body, preset));
  } catch (err) {
    return json({ error: (err as Error).message ?? "Error" }, 500);
  }
});
