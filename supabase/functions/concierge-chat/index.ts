// supabase/functions/concierge-chat/index.ts
// Concierge IA ultra-lujo: Lovable AI Gateway con salida estructurada (texto + tarjetas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

const SYSTEM = `Eres "Wanderly Concierge", un asistente de viaje ULTRA-LUJO para el 0.1% de patrimonio neto. Tono: cálido, refinado, breve, en español de México. Usas el contexto del viaje activo y la bóveda de beneficios del usuario para ofrecer acciones, no respuestas genéricas.

Cuando recomiendes algo accionable (restaurante, transporte, vuelo, hotel, jet, equipaje, alerta proactiva), DEBES devolverlo como una tarjeta estructurada en el array "cards". El campo "text" es solo la voz humana corta de tu respuesta (1-3 frases). NO repitas en "text" los datos de las tarjetas.

Si el usuario activa "God Mode", busca reservas imposibles, upgrades a jet privado en empty-legs, mesas en restaurantes Michelin sold-out, accesos VIP, etc. Sé audaz.

Si el usuario menciona equipaje, ofrece "Equipaje Invisible" (logistics card).
Si menciona vuelo o First Class, considera ofrecer un Empty Leg en jet privado (jet card).
Si detectas urgencia (retraso, emergencia, robo), usa una alerta (alert card).

Responde SIEMPRE con JSON válido:
{
  "text": "string",
  "cards": [
    { "type": "restaurant", "title": string, "subtitle": string, "image_prompt": string, "rating": number, "cta_label": string, "cta_action": string, "meta": string },
    { "type": "transport", "title": string, "subtitle": string, "cta_label": string, "meta": string },
    { "type": "alert", "title": string, "body": string, "cta_label": string },
    { "type": "luggage", "title": string, "from": string, "to": string, "status": string, "cta_label": string },
    { "type": "jet", "title": string, "route": string, "price_usd": number, "fbo": string, "cta_label": string }
  ]
}

"cards" puede estar vacío si solo conversas. Nunca inventes precios sin marcarlos como "estimado".`;

interface Body {
  messages: { role: "user" | "assistant"; content: string }[];
  god_mode?: boolean;
  context?: {
    destino?: string;
    fechas?: string;
    bovedaResumen?: string;
  };
}

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

    const body = (await req.json()) as Body;

    // Carga contexto del viaje activo y bóveda
    const { data: trip } = await supabase
      .from("trips").select("destino, pais_destino, fecha_salida, fecha_regreso")
      .eq("user_id", u.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: vault } = await supabase
      .from("user_vault_benefits").select("*").eq("user_id", u.user.id).maybeSingle();

    const vaultLines: string[] = [];
    if (vault?.credit_cards?.length) vaultLines.push("Tarjetas: " + vault.credit_cards.map((c: any) => `${c.bank} ${c.card_tier}`).join("; "));
    if (vault?.airline_alliances?.length) vaultLines.push("Aerolíneas: " + vault.airline_alliances.map((a: any) => `${a.airline} ${a.tier_status}`).join("; "));
    if (vault?.hotel_loyalty?.length) vaultLines.push("Hoteles: " + vault.hotel_loyalty.map((h: any) => `${h.chain_name} ${h.status_tier}`).join("; "));

    const contextoStr = `Viaje activo: ${trip ? `${trip.destino} (${trip.fecha_salida} a ${trip.fecha_regreso})` : "ninguno"}.\nBóveda: ${vaultLines.join(" | ") || "vacía"}.${body.god_mode ? "\nMODO: GOD MODE activo — caza reservas imposibles y upgrades premium." : ""}`;

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
          { role: "system", content: contextoStr },
          ...body.messages.slice(-12),
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `AI gateway ${res.status}`, detail: t }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { const m = content.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { text: content, cards: [] }; }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("concierge-chat error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
