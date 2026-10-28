// avisos-viaje — tarjeta "Antes de viajar": avisos de viaje OFICIALES de un país con fuente y fecha.
// GOV.UK (FCDO) y US State Dept (gratis, sin llave) + enlace a la Guía del Viajero de la SRE (siempre
// primero). La lógica vive en _shared/travelAdvisories.ts (probada con Vitest); aquí solo se conecta la
// caché compartida (serp_cache), la traducción fiel con Claude Haiku (costo en ai_usage_log) y el usuario.
//
// POST { pais?: string, destino?: string, trip_id?: uuid }
//   200 { ok: true, pais, para_mexicanos, fuentes[], fallas[], traduccion, traduccion_estado, … }
//   200 { ok: false, code: "pais_no_reconocido", mensaje, para_mexicanos }
//   400 sin país ni destino · 401 sin sesión · 429 límite
// Sin costo por abrir la página varias veces: fuentes 6 h y traducción 7 días en caché compartida.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { dbCacheStore, logUsage } from "../_shared/serpRuntime.ts";
import { usageFromClaude } from "../_shared/usage.ts";
import { callClaudeWithFallback, responseText } from "../_shared/claude.ts";
import { getTravelAdvisory, type ModelCall, makeTranslator } from "../_shared/travelAdvisories.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  // Llama a Claude (traducción) cuando no está en caché: cubeta de pago (falla cerrada).
  const rl = await enforceRateLimit(req, "avisos-viaje", user.id, { perMinute: 12, perHour: 80, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const body = await req.json().catch(() => null);
  let pais = text(body?.pais) || text(body?.destino);
  const tripId = typeof body?.trip_id === "string" && UUID.test(body.trip_id) ? body.trip_id : null;
  if (!pais && tripId) {
    // Con la sesión del usuario: RLS decide si puede ver ese viaje (dueño o compartido).
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: trip } = await db.from("trips").select("pais_destino, destino").eq("id", tripId).maybeSingle();
    pais = text(trip?.pais_destino) || text(trip?.destino);
  }
  if (!pais) return json({ ok: false, error: "Indica el país o destino." }, 400);

  const call: ModelCall = async ({ model, system, user: userMsg, maxTokens }) => {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return { ok: false, text: "", model: null };
    try {
      const res = await callClaudeWithFallback({
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMsg }],
      }, { models: [model], signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.warn("avisos-viaje: Claude", res.status, (await res.text().catch(() => "")).slice(0, 200));
        return { ok: false, text: "", model };
      }
      const data = await res.json();
      const u = usageFromClaude(data);
      if (u) await logUsage({ user_id: user.id, function: "avisos-viaje", provider: "anthropic", ...u, model: u.model ?? model });
      return { ok: true, text: responseText(data), model: u?.model ?? model };
    } catch (e) {
      console.warn("avisos-viaje: Claude", (e as Error)?.message);
      return { ok: false, text: "", model };
    }
  };

  try {
    const result = await getTravelAdvisory(pais, { fetchImpl: fetch, store: dbCacheStore(), translate: makeTranslator(call) });
    return json(result);
  } catch (e) {
    console.warn("avisos-viaje:", (e as Error)?.message);
    return json({ ok: false, error: "No pudimos consultar los avisos oficiales ahora." }, 502);
  }
});
