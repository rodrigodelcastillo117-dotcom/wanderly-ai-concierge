// Ferris en vivo (Ferryhopper, servidor MCP público) para la pantalla Ferris y los tramos en ferry del
// viaje. La lógica vive en _shared/ferryhopper.ts (probada con Vitest); aquí solo autenticación, límite
// de ritmo por usuario e IP, la bolsa de búsquedas en vivo del plan (live_search_take), el tope global
// de la cuenta (check_rate_limit "global:ferryhopper") y la caché privada (public.serp_cache, 30 min).
//
// Entrada: { from, to, date (AAAA-MM-DD), passengers? }.
// Salida: { ok:true, fuente:"Ferryhopper", consultado_at, results:[{ naviera, barco, sale, llega,
// desde:{monto, moneda:"EUR"}|null, url }], url_ruta, nota } o { ok:false, code, motivo }.
// No hay llave: Ferryhopper no la pide. Nunca se presenta como reservado.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { dbCacheStore, liveSearchGateFor, logUsage } from "../_shared/serpRuntime.ts";
import { liveSearchLimitBody, FAIR_USE_EMPTY } from "../_shared/liveSearch.ts";
import { runFerrySearch } from "../_shared/ferryhopper.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
const bg = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") EdgeRuntime.waitUntil(p);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" } });

/** Tope de toda la cuenta hacia Ferryhopper (entre instancias): 30 por minuto. */
async function accountSlot(): Promise<boolean> {
  try {
    const { data, error } = await adminClient().rpc("check_rate_limit", { _subject: "global:ferryhopper", _bucket: "ferryhopper:m", _limit: 30, _window_seconds: 60 });
    if (error) return true; // falla abierta: es gratis y el límite por usuario sigue activo
    const allowed = (data as { allowed?: unknown } | null)?.allowed;
    return allowed !== false;
  } catch {
    return true;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "ferry-search", user.id, { perMinute: 10, perHour: 60, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ ok: false, code: "entrada_invalida", motivo: "Petición inválida." }, 400);
  }
  const r = await runFerrySearch(
    { from: body.from, to: body.to, date: body.date, passengers: body.passengers },
    {
      fetchImpl: fetch, store: dbCacheStore(), gate: liveSearchGateFor(user.id), limiter: accountSlot, timeoutMs: 12000, background: bg,
      // Gratis (sin costo por llamada); queda en ai_usage_log para vigilar el volumen.
      onLive: (ok) => { if (ok) bg(logUsage({ user_id: user.id, function: "ferry-search", provider: "ferryhopper", model: "mcp_search_ferry_trips", searches: 1, cost_estimate_usd: 0 })); },
    },
  );
  if (r.ok) return json(r);
  if (r.code === "entrada_invalida") return json(r, 400);
  if (r.code === "FREE_LIMIT_REACHED") {
    if (!r.soft) return json({ ok: false, ...liveSearchLimitBody(r.info) }, 402);
    return json({ ok: false, code: "limite_uso_justo", limite_uso_justo: true, motivo: FAIR_USE_EMPTY });
  }
  return json(r);
});
