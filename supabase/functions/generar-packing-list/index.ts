// Edge function: generar-packing-list
// Genera una lista de equipaje PREMIUM con Lovable AI (Gemini) y la guarda en packing_lists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Eres Iato, el concierge premium de IATOS AI. Tu tarea es generar una lista de equipaje 
PREMIUM, específica y útil para el viaje descrito por el usuario. NO eres una lista 
genérica — eres una recomendación de concierge que conoce el destino, el clima, las 
actividades y los códigos sociales de cada lugar.

REGLAS NO NEGOCIABLES:

1. PERSONALIZA POR DESTINO. No uses listas genéricas tipo "calcetines, camisas, pantalones".
   Sé específico: "Calzado cerrado obligatorio para Acrópolis (prohíben tacones en piedra)",
   "Chaqueta ligera para rooftops parisinos (frío incluso en verano)".

2. CALCULA CANTIDADES INTELIGENTEMENTE.
   - Outfits casuales = (días totales × 1) - (lavanderías disponibles × 3)
   - Outfits formales = número de cenas premium/teatros/eventos en el itinerario
   - Ropa interior = días totales + 2 backups
   - Calcetines = días + 2 backups
   - Calzado = mínimo 2 (caminar + elegante), agregar deportivo si hay actividad atlética
   - Si hay crucero/yacht: agregar 1 outfit formal (formal night)
   - Si hay playa/piscina: trajes de baño = días en playa / 2

3. CATEGORIZA POR FUNCIÓN. Categorías obligatorias cuando apliquen:
   DOCUMENTOS Y DINERO · ELECTRÓNICA Y CARGADORES · ROPA CASUAL · ROPA FORMAL ·
   CALZADO · TOILETRIES Y CUIDADO PERSONAL · MEDICAMENTOS Y SALUD ·
   ESPECÍFICO DEL DESTINO · CARRY-ON OBLIGATORIO (si hay vuelo internacional).

4. CADA ITEM TIENE: id, nombre, cantidad, prioridad (esencial|recomendado|opcional),
   donde (carry_on|documentado|ambos), nota (opcional pero premium).

5. ADAPTADORES POR PAÍS: Europa continental tipo C/F; UK e Irlanda tipo G; USA/Canadá/México A/B;
   Japón tipo A (110V); Australia tipo I. Multi-zona → universal.

6. NOTAS CULTURALES OBLIGATORIAS. Ej: Grecia/Atenas (hombros y rodillas cubiertos en monasterios,
   calzado cerrado Acrópolis), Italia (Vaticano), Tailandia (templos), Medio Oriente (conservador),
   Japón (calcetines limpios), crucero (formal night).

7. INTEGRACIÓN VAULT:
   - Amex Platinum → "Tarjeta Platinum (acceso lounges Centurion/Priority Pass)"
   - Amex Centurion → "Tarjeta Centurion (Concierge 24/7)"
   - Marriott/Hyatt elite → "Tarjeta de elite física para upgrade en check-in"

8. TIPS DE IATO (3-5 al final): "1 outfit completo en carry-on", "bolsa plegable para lavandería",
   "foto de tu maleta antes de documentar", + específicos del destino.

9. SI HAY VUELO INTERNACIONAL → categoría CARRY-ON OBLIGATORIO con pasaporte+copias,
   medicamentos recetados, cargadores+power bank, 1 muda, toiletries <100ml, audífonos.

10. SI HAY CRUCERO → nota de formal night, traje de baño extra, bolsa para zapatos mojados.

Devuelve ÚNICAMENTE la herramienta entregar_packing_list. No agregues texto fuera de la tool call.`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "entregar_packing_list",
    description: "Devuelve la lista de equipaje premium estructurada",
    parameters: {
      type: "object",
      properties: {
        resumen: { type: "string", description: "1 línea descriptiva" },
        alerta_clima: { type: "string", description: "Opcional; alerta clima" },
        categorias: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              nombre: { type: "string", description: "Incluye emoji" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    nombre: { type: "string" },
                    cantidad: { type: "string" },
                    prioridad: { type: "string", enum: ["esencial", "recomendado", "opcional"] },
                    donde: { type: "string", enum: ["carry_on", "documentado", "ambos"] },
                    nota: { type: "string" },
                  },
                  required: ["id", "nombre", "cantidad", "prioridad", "donde"],
                  additionalProperties: false,
                },
              },
            },
            required: ["id", "nombre", "items"],
            additionalProperties: false,
          },
        },
        tips_iato: { type: "array", items: { type: "string" } },
      },
      required: ["resumen", "categorias", "tips_iato"],
      additionalProperties: false,
    },
  },
} as const;

function buildUserPrompt(trip: any, profile: any, vault: any[], travelDna: any) {
  const dias =
    trip.fecha_salida && trip.fecha_regreso
      ? Math.max(
          1,
          Math.round(
            (new Date(trip.fecha_regreso).getTime() -
              new Date(trip.fecha_salida).getTime()) /
              86400000
          ) + 1
        )
      : "?";

  const viaje = trip.viaje_json ?? {};
  const vuelos = (viaje.vuelos ?? []).map((v: any) =>
    `${v.aerolinea ?? ""} ${v.numero_vuelo ?? ""} ${v.origen ?? ""}→${v.destino ?? ""}`.trim()
  );
  const hoteles = (viaje.hoteles ?? []).map(
    (h: any) => `${h.nombre ?? "Hotel"} (${h.noches ?? "?"} noches)`
  );
  const restaurantes = (viaje.restaurantes ?? [])
    .filter((r: any) => /formal|premium|michelin|fine/i.test(JSON.stringify(r)))
    .map((r: any) => r.nombre)
    .filter(Boolean);
  const experiencias = (viaje.experiencias ?? viaje.actividades ?? [])
    .map((e: any) => e.nombre ?? e.titulo)
    .filter(Boolean);
  const crucero = viaje.cruceros?.[0] ?? viaje.crucero;

  const vaultNames = (vault ?? []).map((b: any) => b.benefit_name ?? b.name).filter(Boolean);

  return `VIAJE A PLANEAR:
- Destinos: ${trip.destino}${trip.pais_destino ? ` (${trip.pais_destino})` : ""}
- Fechas: ${trip.fecha_salida} → ${trip.fecha_regreso} (${dias} días)
- Viajeros: ${trip.viajeros ?? 1}
- Notas del viaje: ${trip.notas ?? "—"}

ITINERARIO RESUMIDO:
- Vuelos: ${vuelos.length ? vuelos.join(" · ") : "—"}
- Hoteles: ${hoteles.length ? hoteles.join(" · ") : "—"}
- Restaurantes formales/premium: ${restaurantes.length ? restaurantes.join(", ") : "—"}
- Experiencias destacadas: ${experiencias.length ? experiencias.slice(0, 12).join(", ") : "—"}
- Crucero: ${crucero ? JSON.stringify(crucero).slice(0, 300) : "—"}

CONTEXTO DEL VIAJERO:
- Nombre: ${profile?.full_name ?? "—"}
- Vault activo: ${vaultNames.length ? vaultNames.join(", ") : "—"}
- Travel DNA: ${travelDna ? JSON.stringify(travelDna).slice(0, 400) : "—"}

GENERA LA LISTA DE EQUIPAJE PREMIUM SIGUIENDO TODAS LAS REGLAS DEL SYSTEM_PROMPT.
Llama a entregar_packing_list con el JSON completo.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { trip_id } = await req.json().catch(() => ({}));
    if (!trip_id) {
      return new Response(JSON.stringify({ error: "trip_id_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: trip, error: tripErr } = await admin
      .from("trips")
      .select("*")
      .eq("id", trip_id)
      .maybeSingle();
    if (tripErr || !trip) {
      return new Response(JSON.stringify({ error: "trip_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: owner or accepted collaborator
    if (trip.user_id !== userId) {
      const { data: collab } = await admin
        .from("trip_collaborators")
        .select("user_id")
        .eq("trip_id", trip_id)
        .eq("user_id", userId)
        .eq("status", "accepted")
        .maybeSingle();
      if (!collab) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const [{ data: profile }, { data: vault }, { data: dnaPref }] = await Promise.all([
      admin.from("profiles").select("*").eq("id", trip.user_id).maybeSingle(),
      admin.from("user_vault_benefits").select("*").eq("user_id", trip.user_id),
      admin.from("ai_user_preferences").select("*").eq("user_id", trip.user_id).maybeSingle(),
    ]);

    const userPrompt = buildUserPrompt(trip, profile, vault ?? [], dnaPref);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "entregar_packing_list" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "ai_error", detail: txt.slice(0, 500) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response", JSON.stringify(aiJson).slice(0, 600));
      return new Response(JSON.stringify({ error: "no_tool_call" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let lista: any;
    try {
      lista = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!lista?.categorias || !Array.isArray(lista.categorias)) {
      return new Response(JSON.stringify({ error: "invalid_schema" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: saved, error: upsertErr } = await admin
      .from("packing_lists")
      .upsert(
        {
          trip_id,
          user_id: userId,
          lista_json: lista,
          estado_checkboxes: {},
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "trip_id" }
      )
      .select()
      .single();

    if (upsertErr) {
      console.error("upsert error", upsertErr);
      return new Response(JSON.stringify({ error: "save_failed", detail: upsertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, packing_list: saved }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("fatal", e);
    return new Response(JSON.stringify({ error: "fatal", detail: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
