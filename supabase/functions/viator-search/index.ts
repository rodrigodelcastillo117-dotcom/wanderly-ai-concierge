// Tours reales de Viator (Partner API v2, Acceso básico de afiliado) para las pantallas con sesión de
// IATOS: "Ver tours reales en Viator" en Comprar y en Tours/experiencias del viaje. La lógica vive en
// _shared/viator.ts (probada con Vitest); aquí solo autenticación, límite de ritmo, la bolsa de
// búsquedas en vivo del plan (live_search_take), la caché privada (public.serp_cache, 6 h) y la tasa
// de cambio con fuente (_shared/fx.ts).
//
// Entrada: { city, query?, date_from?, date_to?, currency? }.
// Salida: { ok:true, fuente:"Viator", results:[{ title, foto, rating, resenas, duracion, desde:{monto,
// moneda}, desde_mxn?, url (productUrl con afiliado) }], consultado_at } o { ok:false, code, motivo }.
// Sin llave o con la llave aún no habilitada (401/403) → { ok:false, code:"viator_no_disponible" } (200).
//
// La llave (VIATOR_API_KEY, o VIATOR_API_KEY_SANDBOX con la base de sandbox) solo se lee aquí con
// Deno.env.get y nunca se registra ni se devuelve. Términos de Viator: el contenido no se indexa ni se
// publica fuera de las pantallas propias con sesión.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { dbCacheStore, liveSearchGateFor } from "../_shared/serpRuntime.ts";
import { liveSearchLimitBody, FAIR_USE_EMPTY } from "../_shared/liveSearch.ts";
import { getRateToMxnInfo } from "../_shared/fx.ts";
import { runViatorSearch, viatorConfig } from "../_shared/viator.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
const bg = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") EdgeRuntime.waitUntil(p);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // Contenido de Viator: privado y sin indexar (términos de Viator).
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "viator-search", user.id, { perMinute: 10, perHour: 120, ipPerMinute: 40 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ ok: false, code: "entrada_invalida", motivo: "Petición inválida." }, 400);
  }
  const { apiKey, baseUrl } = viatorConfig((k) => Deno.env.get(k));
  const r = await runViatorSearch(
    { city: body.city, query: body.query, date_from: body.date_from, date_to: body.date_to, currency: body.currency },
    { fetchImpl: fetch, apiKey, baseUrl, store: dbCacheStore(), gate: liveSearchGateFor(user.id), fx: (c) => getRateToMxnInfo(c), timeoutMs: 8000, background: bg },
  );
  if (r.ok) return json(r);
  if (r.code === "falta_ciudad") return json(r, 400);
  if (r.code === "FREE_LIMIT_REACHED") {
    // Tope duro del plan: el mismo 402 que las demás búsquedas en vivo. Uso justo (PRO): 200 honesto.
    if (!r.soft) return json({ ok: false, ...liveSearchLimitBody(r.info) }, 402);
    return json({ ok: false, code: "limite_uso_justo", limite_uso_justo: true, motivo: FAIR_USE_EMPTY });
  }
  return json(r);
});
