// supabase/functions/ai-tool/index.ts
// Generic Lovable AI bridge that returns plain text or JSON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetch } from "../_shared/ai.ts";
import { planAiCall, TtlCache, type AiToolRequest } from "./tasks.ts";

/**
 * Tope del lado del servidor para la respuesta de la IA (R2: Comparar se quedaba en «Comparando...» más
 * de 90 s). Al vencer se responde 504 con code "timeout", no se espera más. Genérico: AI_TOOL_TIMEOUT_MS
 * (40 s); las tareas de tasks.ts llevan el suyo (Comparar: 20 s, modelo ligero sin razonamiento).
 */
export { AI_TOOL_TIMEOUT_MS } from "./tasks.ts";
// Misma combinación de destinos → misma respuesta sin volver a llamar a la IA (por instancia).
const cache = new TtlCache<unknown>();
const isTimeout = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as Error)?.name ?? "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const __rl = await enforceRateLimit(req, "ai-tool", u.user.id, { perMinute: 10, perHour: 80, ipPerMinute: 30 });
    if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

    const reqBody = (await req.json()) as AiToolRequest;
    const { prompt, system, json = false } = reqBody;
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sys = system || "Eres un asistente de viaje preciso. Responde en español de México.";
    const sysFinal = json
      ? `${sys}\n\nIMPORTANTE: Responde SOLO con JSON válido sin ningún texto adicional, sin markdown, sin code fences.`
      : sys;

    const plan = planAiCall(reqBody);
    const hit = plan.cacheKey ? cache.get(plan.cacheKey) : undefined;
    if (hit !== undefined) {
      return new Response(JSON.stringify({ ok: true, data: hit, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await aiFetch({
      signal: AbortSignal.timeout(plan.timeoutMs),
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: plan.model,
        ...(plan.maxTokens ? { max_tokens: plan.maxTokens } : {}),
        ...(plan.reasoningEffort ? { reasoning_effort: plan.reasoningEffort } : {}),
        messages: [
          { role: "system", content: sysFinal },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!r.ok) {
      const errTxt = await r.text();
      return new Response(JSON.stringify({ error: `AI ${r.status}`, detail: errTxt.slice(0, 500) }), {
        status: r.status === 402 ? 402 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await r.json();
    let text = data?.choices?.[0]?.message?.content ?? "";

    if (json) {
      // try to extract JSON from possibly wrapped response
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) text = m[1].trim();
      try {
        const parsed = JSON.parse(text);
        if (plan.cacheKey) cache.set(plan.cacheKey, parsed, plan.cacheTtlMs);
        return new Response(JSON.stringify({ ok: true, data: parsed }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        // fallback to first {...} or [...]
        const m2 = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (m2) {
          try {
            const parsed2 = JSON.parse(m2[1]);
            if (plan.cacheKey) cache.set(plan.cacheKey, parsed2, plan.cacheTtlMs);
            return new Response(JSON.stringify({ ok: true, data: parsed2 }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch {}
        }
        return new Response(JSON.stringify({ ok: false, error: "JSON inválido", raw: text }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (isTimeout(e)) {
      return new Response(JSON.stringify({ ok: false, code: "timeout", error: "La IA tardó demasiado en responder. Intenta de nuevo." }), {
        status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
