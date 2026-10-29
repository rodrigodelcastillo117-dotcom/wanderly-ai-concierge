// supabase/functions/buscar-promociones/index.ts
// Busca promociones vigentes para las membresías, tarjetas y seguros que la persona guardó en
// Documentos y tarjetas (vault_items), con Claude y su búsqueda web. Reglas en ./logic.ts.
//   200 { resumen, promociones, fuentes }  ·  503/502 { error, code: "SERVICE_UNAVAILABLE", message }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { callClaudeWithFallback } from "../_shared/claude.ts";
import { logUsage } from "../_shared/serpRuntime.ts";
import { usageFromClaude } from "../_shared/usage.ts";
import { finalPromos, PROMO_MESSAGES, promoLines, promoRequest, type PromoBody, type VaultRow } from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_TURNS = 3; // la búsqueda web puede pausar el turno (pause_turn): se continúa como mucho 2 veces

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const unavailable = (status: number, message: string) => json({ error: "ai_unavailable", code: "SERVICE_UNAVAILABLE", message }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado", code: "UNAUTHENTICATED" }, 401);
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Sesión inválida", code: "UNAUTHENTICATED" }, 401);
    const user = userData.user;

    const __rl = await enforceRateLimit(req, "buscar-promociones", user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
    if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);
    const body = (await req.json().catch(() => ({}))) as PromoBody;

    // Fuente actual: Documentos y tarjetas (RLS: solo las filas de la persona). Solo columnas sin datos sensibles.
    const { data: rows, error: rowsErr } = await supabase
      .from("vault_items").select("section, kind, title, tier, benefits").in("section", ["membresia", "tarjeta", "seguro"]).limit(100);
    if (rowsErr) {
      console.error("buscar-promociones: vault_items", rowsErr.message);
      return unavailable(502, PROMO_MESSAGES.failed);
    }
    const lines = promoLines((rows ?? []) as VaultRow[]);
    if (!lines.length) return json({ resumen: PROMO_MESSAGES.empty, promociones: [], fuentes: [] });

    if (!ANTHROPIC_API_KEY) return unavailable(503, PROMO_MESSAGES.unavailable);

    const request = promoRequest(lines, body, new Date().toISOString().slice(0, 10));
    const messages: Array<{ role: string; content: unknown }> = [...request.messages];
    const replies: Array<{ content?: any[]; stop_reason?: string }> = [];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await callClaudeWithFallback({ ...request, messages }, { apiKey: ANTHROPIC_API_KEY, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) {
        console.error("buscar-promociones: Claude", res.status, (await res.text()).slice(0, 300));
        return unavailable(502, PROMO_MESSAGES.failed);
      }
      const data = await res.json();
      const u = usageFromClaude(data);
      if (u) await logUsage({ user_id: user.id, function: "buscar-promociones", provider: "anthropic", ...u });
      replies.push(data);
      if (data?.stop_reason !== "pause_turn") break;
      // La búsqueda web pausó el turno: se devuelve tal cual para que continúe.
      messages.push({ role: "assistant", content: data.content });
    }

    const out = finalPromos(replies);
    if (!out) {
      console.warn("buscar-promociones: sin herramienta o declinó", replies[replies.length - 1]?.stop_reason);
      return unavailable(502, PROMO_MESSAGES.failed);
    }
    if (out.descartadas) console.warn("buscar-promociones: promociones sin fuente descartadas", out.descartadas);
    return json({ resumen: out.resumen, promociones: out.promociones, fuentes: out.fuentes });
  } catch (e) {
    console.error("buscar-promociones error:", (e as Error)?.message);
    return unavailable(502, PROMO_MESSAGES.failed);
  }
});
