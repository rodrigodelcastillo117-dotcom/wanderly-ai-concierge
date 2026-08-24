// Analiza un texto libre del usuario y devuelve preferencias estructuradas para
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
// la configuración de ruta multi-destino.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Eres un asistente experto en viajes que interpreta preferencias en lenguaje natural y las convierte en configuración estructurada de una ruta multi-destino.

Devuelves SIEMPRE un JSON estricto con esta forma exacta:
{
  "connection": "tiempo" | "paisaje" | "smart",
  "roadtripStops": boolean,
  "luggageLogistics": boolean,
  "pace": "relajado" | "balanceado" | "intenso",
  "themes": string[],            // ej. ["gastronomía","arte","naturaleza","nightlife","historia","aventura","wellness","compras","romántico","familiar","lujo","local"]
  "avoid": string[],             // cosas a evitar (ej. "vuelos largos","madrugar","tours grupales","lugares turísticos","frío")
  "transport_preference": string,// ej. "tren","auto rentado","vuelos directos","mixto"
  "budget_style": "ahorro" | "balanceado" | "premium" | "lujo",
  "summary": string              // 1-2 frases resumiendo lo que IATOS entendió, en español, en 2da persona ("Buscas...")
}

Reglas:
- "connection":
  • "tiempo" si prioriza rapidez, eficiencia, vuelos directos, poco tiempo, "aprovechar al máximo".
  • "paisaje" si prioriza rutas escénicas, trenes panorámicos, roadtrip, naturaleza, vistas.
  • "smart" (default) si menciona presupuesto, costo-beneficio, o no está claro.
- "roadtripStops": true si menciona auto, roadtrip, pueblos, paradas, carretera, miradores.
- "luggageLogistics": true por defecto; false solo si dice explícitamente que no le importa o que viaja ligero sin necesidad de storage.
- Infiere themes y avoid de TODO lo que el usuario escriba, no inventes cosas no mencionadas.
- summary debe sonar humano, no robótico. NO uses bullets.
- NO incluyas texto fuera del JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "analizar-preferencias-ruta", __user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const { prompt, contexto } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMsg = [
      contexto ? `Contexto del viaje: ${JSON.stringify(contexto)}` : "",
      `Preferencias del usuario:\n${prompt}`,
    ].filter(Boolean).join("\n\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Gateway error", res.status, text);
      if (res.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intenta en un momento." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (res.status === 402) {
        return new Response(JSON.stringify({ error: "Sin créditos de IA disponibles." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI gateway ${res.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    // Defaults defensivos
    parsed.connection = ["tiempo", "paisaje", "smart"].includes(parsed.connection) ? parsed.connection : "smart";
    parsed.roadtripStops = typeof parsed.roadtripStops === "boolean" ? parsed.roadtripStops : true;
    parsed.luggageLogistics = typeof parsed.luggageLogistics === "boolean" ? parsed.luggageLogistics : true;
    parsed.themes = Array.isArray(parsed.themes) ? parsed.themes : [];
    parsed.avoid = Array.isArray(parsed.avoid) ? parsed.avoid : [];
    parsed.summary = typeof parsed.summary === "string" ? parsed.summary : "";

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
