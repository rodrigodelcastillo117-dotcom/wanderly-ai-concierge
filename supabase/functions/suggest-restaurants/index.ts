// suggest-restaurants — sugiere 4-6 restaurantes REALES y reconocidos por ciudad
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
// para complementar viajes importados desde PDF que no traen restaurantes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  // --- Auth gate: require valid Supabase JWT to prevent API quota abuse ---
  try {
    const __authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!__authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const __serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const __token = __authHeader.replace(/^Bearer\s+/i, "");
    if (!__serviceKey || __token !== __serviceKey) {
      const __apikey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const __ures = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { Authorization: __authHeader, apikey: __apikey },
    });
    if (!__ures.ok) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // --- end auth gate ---
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");
    const { cities = [], travelers = 2 } = await req.json();
    if (!Array.isArray(cities) || cities.length === 0) {
      return new Response(JSON.stringify({ error: "cities[] requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Eres un concierge gastronómico. Para cada ciudad de la lista, sugiere 5 restaurantes REALES y reconocidos (que existen, con nombre exacto, mezcla de íconos locales y joyas modernas, ningún restaurante inventado). Devuelve JSON estricto:

{
  "restaurantes": [
    {
      "nombre": "Nombre real del restaurante",
      "ciudad": "ciudad exacta como en la lista",
      "cocina": "Tipo de cocina (Bistró francés, Mariscos griegos…)",
      "rango_precio": "$ | $$ | $$$ | $$$$",
      "por_que": "1-2 frases de por qué vale la pena para ${travelers} personas",
      "tip": "Tip práctico (reservar X días antes, pedir Y, ir a hora Z)"
    }
  ]
}

Ciudades: ${cities.join(", ")}.
NO inventes nombres. Si no estás 100% seguro de uno, omítelo.`;

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    }).finally(() => clearTimeout(tid));

    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `gateway ${res.status}`, raw: t }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
    // strip markdown fences
    let cleaned = String(content)
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    parsed = tryParse(cleaned);
    if (!parsed) {
      // extract from first { to last }
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end > start) {
        let slice = cleaned.slice(start, end + 1)
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]")
          .replace(/[\x00-\x1F\x7F]/g, " ");
        parsed = tryParse(slice) ?? {};
      } else {
        parsed = {};
      }
    }
    return new Response(JSON.stringify({ ok: true, restaurantes: parsed.restaurantes ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
