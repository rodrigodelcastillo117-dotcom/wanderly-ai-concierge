// supabase/functions/ai-tool/index.ts
// Generic Lovable AI bridge that returns plain text or JSON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    const { prompt, system, model = "google/gemini-2.5-flash", json = false } = (await req.json()) as {
      prompt: string; system?: string; model?: string; json?: boolean;
    };
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sys = system || "Eres un asistente de viaje preciso. Responde en español de México.";
    const sysFinal = json
      ? `${sys}\n\nIMPORTANTE: Responde SOLO con JSON válido sin ningún texto adicional, sin markdown, sin code fences.`
      : sys;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
        return new Response(JSON.stringify({ ok: true, data: parsed }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        // fallback to first {...} or [...]
        const m2 = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (m2) {
          try {
            return new Response(JSON.stringify({ ok: true, data: JSON.parse(m2[1]) }), {
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
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
