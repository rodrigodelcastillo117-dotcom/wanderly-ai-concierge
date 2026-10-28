// supabase/functions/buscar-promociones/index.ts
// Busca promociones reales en tiempo real (Perplexity) basadas en la Bóveda de Beneficios del usuario.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { callClaudeWithFallback, parseJsonLoose, toolInput } from "../_shared/claude.ts";
import { aiFetch } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

interface ReqBody {
  destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
}

function describeVault(vault: any): string {
  if (!vault) return "Sin datos en bóveda.";
  const parts: string[] = [];
  if (vault.credit_cards?.length) {
    parts.push("TARJETAS: " + vault.credit_cards.map((c: any) =>
      `${c.bank ?? "Banco"} ${c.card_tier ?? ""}${c.perks_enabled?.length ? ` (perks: ${c.perks_enabled.join(", ")})` : ""}`
    ).join("; "));
  }
  if (vault.airline_alliances?.length) {
    parts.push("AEROLÍNEAS: " + vault.airline_alliances.map((a: any) =>
      `${a.airline ?? a.alliance_name} (${a.alliance_name ?? ""} tier ${a.tier_status ?? "básico"})`
    ).join("; "));
  }
  if (vault.hotel_loyalty?.length) {
    parts.push("HOTELES: " + vault.hotel_loyalty.map((h: any) =>
      `${h.chain_name ?? "Cadena"} (${h.status_tier ?? "member"})`
    ).join("; "));
  }
  if (vault.car_rentals?.length) {
    parts.push("RENTA AUTOS: " + vault.car_rentals.map((r: any) =>
      `${r.company_name ?? "Compañía"} (${r.preferred_car_type ?? ""})`
    ).join("; "));
  }
  return parts.join("\n") || "Sin datos en bóveda.";
}

async function buscarConPerplexity(vaultDesc: string, body: ReqBody): Promise<{ texto: string; citations: string[] }> {
  const contexto = body.destino
    ? `Contexto del viaje: destino ${body.destino}${body.fecha_salida ? `, fechas ${body.fecha_salida} a ${body.fecha_regreso}` : ""}.`
    : "Sin viaje específico todavía; busca promos generales aplicables el próximo trimestre.";

  const query = `Investiga PROMOCIONES VIGENTES HOY (no expiradas) en español/inglés que beneficien a este viajero según su perfil de lealtad. ${contexto}

PERFIL DE BENEFICIOS DEL USUARIO:
${vaultDesc}

Devuelve 6-10 promociones REALES y VERIFICABLES con:
- Nombre de la promo
- Proveedor/marca exacta (banco, aerolínea, cadena hotelera, rentadora)
- Beneficio concreto y cuantificable (ej: "2x1 en Hilton Honors", "20% off vuelos AeroMéxico con Amex Platinum", "maleta gratis Star Alliance Gold")
- Categoría: vuelo / hotel / auto / tarjeta / experiencia
- Fecha de vigencia o término
- Cómo activarla (código, link, requisito)
- URL fuente oficial

Prioriza promociones que CRUCEN con los programas del usuario (ej: si tiene Amex Platinum + Hilton Diamond, busca convenios Amex Fine Hotels & Resorts). Evita anuncios genéricos.`;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        { role: "system", content: "Eres un cazador de promociones de viaje premium. Solo devuelves promos reales, vigentes y verificables con fuente." },
        { role: "user", content: query },
      ],
      temperature: 0.2,
      max_tokens: 3500,
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    texto: data.choices?.[0]?.message?.content ?? "",
    citations: data.citations ?? [],
  };
}

const TOOL_SCHEMA = {
  name: "entregar_promociones",
  description: "Entrega lista estructurada de promociones reales vigentes.",
  input_schema: {
    type: "object",
    properties: {
      resumen: { type: "string", description: "Resumen ejecutivo en 2 líneas del valor total estimado de los beneficios." },
      promociones: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            proveedor: { type: "string" },
            categoria: { type: "string", enum: ["vuelo", "hotel", "auto", "tarjeta", "experiencia"] },
            beneficio: { type: "string", description: "Beneficio cuantificable, ej: '20% off' o 'noche gratis'" },
            ahorro_estimado_mxn: { type: "number", description: "Estimación de ahorro en MXN. 0 si no aplica." },
            vigencia: { type: "string" },
            como_activar: { type: "string" },
            requisito_vault: { type: "string", description: "Qué item de la bóveda del usuario la habilita." },
            url: { type: "string" },
          },
          required: ["titulo", "proveedor", "categoria", "beneficio", "como_activar"],
        },
      },
    },
    required: ["resumen", "promociones"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!PERPLEXITY_API_KEY || !(ANTHROPIC_API_KEY || GEMINI_API_KEY || LOVABLE_API_KEY)) {
      return new Response(JSON.stringify({ error: "Claves de IA no configuradas" }), {
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
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const __rl = await enforceRateLimit(req, "buscar-promociones", user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
    if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);
    const body = (await req.json().catch(() => ({}))) as ReqBody;

    const { data: vault } = await supabase
      .from("user_vault_benefits").select("*").eq("user_id", user.id).maybeSingle();

    const vaultDesc = describeVault(vault);
    if (vaultDesc === "Sin datos en bóveda.") {
      return new Response(JSON.stringify({
        resumen: "Agrega tarjetas, aerolíneas u hoteles en Documentos y tarjetas para que IATOS AI cace promos a tu medida.",
        promociones: [],
        fuentes: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const investigacion = await buscarConPerplexity(vaultDesc, body);

    const system = "Estructuras promociones de viaje reales en español de México. Solo usa datos de la investigación; no inventes promos. Si la investigación no menciona una promo clara, no la incluyas.";
    const userContent = `BÓVEDA DEL USUARIO:\n${vaultDesc}\n\nINVESTIGACIÓN PERPLEXITY:\n${investigacion.texto}\n\nFUENTES:\n${investigacion.citations.map((c, i) => `[${i+1}] ${c}`).join("\n")}\n\nEstructura las promociones aplicables.`;

    // 1) Claude (modelo vigente). El modelo actual no acepta forzar la herramienta: se pide en el prompt.
    let out: any = null;
    if (ANTHROPIC_API_KEY) {
      const claudeRes = await callClaudeWithFallback({
        max_tokens: 4000,
        system: `${system}\n\nEntrega SIEMPRE el resultado llamando a la herramienta "entregar_promociones", sin texto adicional.`,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: userContent }],
      }, { apiKey: ANTHROPIC_API_KEY });
      if (claudeRes.ok) {
        out = toolInput(await claudeRes.json(), "entregar_promociones");
        if (!out) console.warn("buscar-promociones: Claude no llamó la herramienta; usando respaldo Gemini");
      } else {
        console.error("buscar-promociones: Claude no disponible; usando respaldo Gemini", claudeRes.status, (await claudeRes.text()).slice(0, 500));
      }
    }

    // 2) Respaldo: Gemini (aiFetch) con la misma estructura en JSON.
    if (!out && (GEMINI_API_KEY || LOVABLE_API_KEY)) {
      const r = await aiFetch({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY ?? ""}` },
        body: JSON.stringify({
          model: "google/gemini-flash-latest",
          messages: [
            { role: "system", content: `${system}\n\nDevuelve SOLO un JSON válido con esta forma: ${JSON.stringify(TOOL_SCHEMA.input_schema)}` },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (r.ok) {
        const j = await r.json();
        out = parseJsonLoose(j?.choices?.[0]?.message?.content ?? "");
      } else {
        console.error("buscar-promociones: respaldo Gemini falló", r.status, (await r.text()).slice(0, 500));
      }
    }

    if (!out) {
      return new Response(JSON.stringify({
        error: "ai_unavailable",
        message: "No pudimos estructurar las promociones ahora. Intenta de nuevo en unos minutos.",
        promociones: [],
        fuentes: investigacion.citations,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Array.isArray(out.promociones)) out.promociones = [];

    return new Response(JSON.stringify({ ...out, fuentes: investigacion.citations }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("buscar-promociones error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
