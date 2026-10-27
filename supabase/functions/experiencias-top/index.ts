// experiencias-top — "Buscar lo TOP de {ciudad}" de la pestaña Experiencias del viaje (y la búsqueda
// "cena romántica" de esa pestaña). La lógica vive en _shared/experiencias.ts (probada con Vitest);
// aquí solo autenticación, límite de ritmo, la bolsa de búsquedas en vivo del plan (live_search_take:
// UNA unidad por pulsación, cubre Google Places y Viator), la caché privada de Viator (serp_cache, 6 h)
// y Ticketmaster (su caché y sus límites).
//
// Entrada: { city, date_from?, date_to?, hotel?: { lat?, lng?, nombre? }, query?, blocks? }.
// Salida: { ok:true, ciudad, ancla, restaurantes, museos, tours, wow, eventos, avisos, consultado_at }.
// Nunca se llama al abrir la pestaña: solo al pulsar un botón. Las llaves (GOOGLE_MAPS_API_KEY,
// VIATOR_API_KEY, TICKETMASTER_API_KEY) solo se leen en el servidor y nunca se devuelven.
// Google Places: el contenido no se guarda (términos de Google); cada pulsación es una consulta nueva.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { dbCacheStore, liveSearchGateFor } from "../_shared/serpRuntime.ts";
import { FAIR_USE_EMPTY, liveSearchLimitBody } from "../_shared/liveSearch.ts";
import { getRateToMxnInfo } from "../_shared/fx.ts";
import { runViatorSearch, viatorConfig } from "../_shared/viator.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { ticketmasterFor } from "../_shared/ticketmasterRuntime.ts";
import { type Block, BLOCKS, runExperiencias } from "../_shared/experiencias.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
const bg = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") EdgeRuntime.waitUntil(p);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // Contenido de Viator y Google: privado y sin indexar.
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  // Cada pulsación hace hasta 4 consultas a Google y 3 a Viator: ritmo bajo por persona.
  const rl = await enforceRateLimit(req, "experiencias-top", user.id, { perMinute: 4, perHour: 30, ipPerMinute: 12 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  let body: Record<string, any>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ ok: false, code: "entrada_invalida", motivo: "Petición inválida." }, 400);
  }
  const city = String(body.city ?? "").trim().slice(0, 80);
  if (!city) return json({ ok: false, code: "falta_ciudad", motivo: "Falta la ciudad." }, 400);

  // Una unidad de la bolsa de búsquedas en vivo por pulsación (la misma que usan las demás búsquedas).
  const gate = await liveSearchGateFor(user.id)();
  if (!gate.allow) {
    const denied = gate as { allow: false; soft?: boolean; info?: Record<string, unknown> };
    if (!denied.soft) return json({ ok: false, ...liveSearchLimitBody(denied.info) }, 402);
    return json({ ok: false, code: "limite_uso_justo", limite_uso_justo: true, motivo: FAIR_USE_EMPTY });
  }

  const { apiKey, baseUrl } = viatorConfig((k) => Deno.env.get(k));
  const store = dbCacheStore();
  try {
    const blocks = Array.isArray(body.blocks) ? (body.blocks as unknown[]).filter((b): b is Block => BLOCKS.includes(b as Block)) : undefined;
    const out = await runExperiencias({
      city, date_from: body.date_from ?? null, date_to: body.date_to ?? null,
      hotel: body.hotel && typeof body.hotel === "object" ? { lat: Number(body.hotel.lat), lng: Number(body.hotel.lng), nombre: typeof body.hotel.nombre === "string" ? body.hotel.nombre : null } : null,
      query: typeof body.query === "string" ? body.query : null,
      blocks,
    }, {
      transport: googleTransportFor("experiencias-top", user.id),
      viator: (args) => runViatorSearch(args, { fetchImpl: fetch, apiKey, baseUrl, store, fx: (c) => getRateToMxnInfo(c), timeoutMs: 8000, background: bg }),
      ticketmaster: ticketmasterFor("experiencias-top", user.id, { background: bg }),
    });
    return json(out);
  } catch (e) {
    // La búsqueda no se hizo: se devuelve la unidad.
    if (gate.allow && gate.refund) await gate.refund().catch(() => {});
    console.error("experiencias-top error:", (e as Error)?.message?.slice(0, 200));
    return json({ ok: false, code: "error", motivo: "No pudimos buscar ahora. Intenta de nuevo en un momento." }, 500);
  }
});
