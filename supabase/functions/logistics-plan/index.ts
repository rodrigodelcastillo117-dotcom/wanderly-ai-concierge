// Edge function: logistics-plan
// Genera la logística COMPLETA de un viaje multi-destino:
// - vuelos internacionales (origen ↔ destinos)
// - transporte interno (trenes, roadtrips con paradas, ferries, vuelos internos)
// - 3 opciones de hospedaje POR CIUDAD personalizadas al estilo del usuario
// - 4-6 restaurantes POR CIUDAD según preferencias gastronómicas
// - 4-6 experiencias/tours POR CIUDAD según intereses
// - itinerario día por día distribuido entre ciudades
// - costos obligatorios (city taxes, visas, buffer cambiario 3%)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Body {
  origin: string;
  destinations: string[];
  fecha_salida?: string;
  fecha_regreso?: string;
  num_viajeros?: number;
  prefs?: {
    connection?: "tiempo" | "paisaje" | "smart";
    roadtripStops?: boolean;
    luggageLogistics?: boolean;
  };
}

const SYSTEM = `Eres un consultor de viajes de lujo (IATOS) que diseña travesías multi-destino completas.
Devuelves SIEMPRE un JSON estricto siguiendo el esquema indicado, con datos REALISTAS y específicos:
- Aerolíneas, operadores de tren y hoteles deben ser REALES (Italo, Renfe AVE, Shinkansen, Eurostar, ÖBB Nightjet, Aman, Belmond, Soho House, etc.)
- Precios en USD por persona, coherentes con el mercado actual
- Personaliza hospedaje, restaurantes y experiencias al perfil del usuario (estilo, presupuesto, gastronomía, intereses)
- 3 opciones de hospedaje POR CIUDAD: una ahorro, una equilibrio, una premium — todas alineadas al estilo del usuario
- 4-6 restaurantes POR CIUDAD que matcheen estilo_comida + restricciones
- 4-6 experiencias POR CIUDAD que matcheen actividades_tarde + intereses
- Itinerario día por día distribuyendo las noches entre ciudades de manera lógica

REGLA CRÍTICA DE TRANSPORTE ENTRE CIUDADES (arrival_options):
- Para CADA ciudad de destino debes proponer entre 2 y 4 maneras DISTINTAS de llegar desde el punto anterior (origen para la primera ciudad, ciudad anterior para las siguientes).
- En EUROPA y rutas cortas (<800km) SIEMPRE incluye al menos UNA opción de tren de alta velocidad (Italo/Frecciarossa Roma-Florencia-Venecia 1h30-2h ~$40-90; Renfe AVE Madrid-Barcelona 2h30 ~$60-120; SNCF TGV; Eurostar; ÖBB Nightjet) — frecuentemente es MÁS BARATO y rápido que volar.
- En Japón usa Shinkansen JR Pass.
- Cuando exista, también ofrece opción bus low-cost (FlixBus) como tier económico.
- Solo recomienda vuelo interno si la distancia >800km O si no hay tren directo razonable.
- Marca tier: economico | equilibrio | premium. Marca scenic:true cuando la ruta sea panorámica.`;


const schema = {
  type: "object",
  properties: {
    flights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tier: { type: "string", description: "ahorro | equilibrio | premium" },
          from: { type: "string" },
          to: { type: "string" },
          airline_suggested: { type: "string" },
          duration: { type: "string" },
          stops: { type: "string" },
          price_per_person_usd: { type: "number" },
          notes: { type: "string" },
        },
        required: ["from", "to", "duration", "price_per_person_usd"],
      },
    },
    internal_transport: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          mode: { type: "string", description: "tren | roadtrip | bus | ferry | vuelo_interno" },
          provider: { type: "string" },
          duration: { type: "string" },
          price_per_person_usd: { type: "number" },
          scenic: { type: "boolean" },
          suggested_stops: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, why: { type: "string" } },
              required: ["name"],
            },
          },
          luggage_note: { type: "string" },
        },
        required: ["from", "to", "mode", "duration", "price_per_person_usd"],
      },
    },
    per_destination: {
      type: "array",
      description: "Una entrada por cada ciudad de destino, con 3 hospedajes, restaurantes y experiencias",
      items: {
        type: "object",
        properties: {
          city: { type: "string" },
          nights: { type: "number", description: "Noches sugeridas en esta ciudad" },
          arrival_options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            description:
              "2-4 maneras de LLEGAR a esta ciudad desde el punto anterior. Incluye SIEMPRE tren si la ruta es europea <800km.",
            items: {
              type: "object",
              properties: {
                from: { type: "string", description: "Ciudad/punto de origen del tramo" },
                mode: { type: "string", description: "vuelo | tren | roadtrip | bus | ferry" },
                tier: { type: "string", description: "economico | equilibrio | premium" },
                provider: { type: "string", description: "Aerolínea/operador real (Italo, Renfe AVE, Iberia, FlixBus…)" },
                duration: { type: "string" },
                price_per_person_usd: { type: "number" },
                scenic: { type: "boolean" },
                notes: { type: "string" },
              },
              required: ["from", "mode", "duration", "price_per_person_usd"],
            },
          },
          hospedaje: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                tier: { type: "string", description: "ahorro | equilibrio | premium" },
                tipo: { type: "string", description: "Boutique, Hotel 5★, B&B, Apart-hotel…" },
                nombre: { type: "string" },
                barrio: { type: "string" },
                rating: { type: "number" },
                price_per_night_usd: { type: "number" },
                por_que: { type: "string", description: "Por qué matchea el estilo del usuario" },
              },
              required: ["tier", "nombre", "price_per_night_usd"],
            },
          },
          restaurantes: {
            type: "array",
            minItems: 4,
            items: {
              type: "object",
              properties: {
                nombre: { type: "string" },
                cocina: { type: "string" },
                rango_precio: { type: "string", description: "$, $$, $$$, $$$$" },
                por_que: { type: "string" },
              },
              required: ["nombre", "cocina"],
            },
          },
          experiencias: {
            type: "array",
            minItems: 4,
            items: {
              type: "object",
              properties: {
                nombre: { type: "string" },
                duracion: { type: "string" },
                price_per_person_usd: { type: "number" },
                por_que: { type: "string" },
              },
              required: ["nombre"],
            },
          },
        },
        required: ["city", "nights", "arrival_options", "hospedaje", "restaurantes", "experiencias"],
      },
    },
    days: {
      type: "array",
      description: "Itinerario día por día. Cada día indica en qué ciudad está y plan mañana/tarde/noche.",
      items: {
        type: "object",
        properties: {
          dia: { type: "number" },
          ciudad: { type: "string" },
          titulo: { type: "string" },
          "mañana": { type: "string" },
          tarde: { type: "string" },
          noche: { type: "string" },
        },
        required: ["dia", "ciudad", "titulo"],
      },
    },
    local_transport_tips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          city: { type: "string" },
          recommendation: { type: "string" },
          est_daily_usd: { type: "number" },
        },
        required: ["city", "recommendation"],
      },
    },
    mandatory_costs: {
      type: "object",
      properties: {
        city_taxes_usd: { type: "number" },
        visa_fees_usd: { type: "number" },
        currency_buffer_pct: { type: "number" },
        currency_buffer_usd: { type: "number" },
        notes: { type: "string" },
      },
      required: ["city_taxes_usd", "visa_fees_usd", "currency_buffer_pct", "currency_buffer_usd"],
    },
    total_estimado_usd: { type: "number" },
    resumen: { type: "string" },
  },
  required: ["flights", "internal_transport", "per_destination", "days", "mandatory_costs", "total_estimado_usd"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.origin || !Array.isArray(body?.destinations) || body.destinations.length < 1) {
      return new Response(JSON.stringify({ error: "origin y destinations son requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Recuperar perfil del usuario para personalizar
    let perfilLine = "Usuario sin perfil configurado — usa equilibrio premium.";
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const supa = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user } } = await supa.auth.getUser(token);
        if (user) {
          const { data: prefs } = await supa
            .from("ai_user_preferences")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();
          if (prefs) {
            perfilLine = `Perfil del usuario:
- Ritmo: ${prefs.ritmo_viaje ?? "—"}
- Presupuesto: ${prefs.nivel_presupuesto ?? "—"}
- Estilo de comida: ${(prefs.estilo_comida ?? []).join(", ") || "—"}
- Restricciones alimentarias: ${(prefs.restricciones_alimentarias ?? []).join(", ") || "ninguna"}
- Hospedaje preferido: ${(prefs.hospedaje_preferencias ?? []).join(", ") || "—"}
- Actividades de tarde: ${(prefs.actividades_tarde ?? []).join(", ") || "—"}
- Deal-breakers: ${(prefs.deal_breakers ?? []).join(", ") || "ninguno"}
- Compañeros: ${prefs.companeros_viaje ?? "—"}
- Propósito: ${prefs.proposito_viaje ?? "—"}`;
          }
        }
      }
    } catch (e) {
      console.warn("No se pudo cargar perfil:", e);
    }

    const nights =
      body.fecha_salida && body.fecha_regreso
        ? Math.max(
            1,
            Math.round(
              (new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) /
                86400000,
            ),
          )
        : Math.max(body.destinations.length * 3, 6);

    const userPrompt = `
${perfilLine}

Origen: ${body.origin}
Destinos en orden: ${body.destinations.join(" → ")}
Viajeros: ${body.num_viajeros ?? 2}
Fechas: ${body.fecha_salida ?? "flexible"} a ${body.fecha_regreso ?? "flexible"} (~${nights} noches totales)
Preferencia de conexión: ${body.prefs?.connection ?? "smart"}
Roadtrips con paradas: ${body.prefs?.roadtripStops === false ? "no" : "sí"}
Logística de equipaje: ${body.prefs?.luggageLogistics === false ? "no" : "sí"}

ENTREGA un JSON que cumpla el esquema con:
1. flights: 1-2 vuelos internacionales (origen→primera ciudad, última ciudad→origen). Si los costos varían, incluye tiers.
2. internal_transport: UN tramo entre CADA par consecutivo de destinos (${body.destinations.length - 1} tramos mínimo). Trenes reales (Italo/Renfe/Shinkansen) cuando aplique. Roadtrips con 2-4 paradas.
3. per_destination: ${body.destinations.length} entradas — UNA por cada ciudad. Cada una con EXACTAMENTE 3 hospedajes (ahorro/equilibrio/premium) tipos REALES alineados al estilo, 4-6 restaurantes y 4-6 experiencias.
4. days: ~${nights} días distribuidos lógicamente entre las ciudades (ej. 3 noches Roma, 2 Florencia, 2 Venecia), cada día con ciudad, título, mañana/tarde/noche específicos.
5. mandatory_costs con currency_buffer_pct=3 sobre el total.
6. total_estimado_usd coherente con todo lo anterior.
`.trim();

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_logistics",
              description: "Emite la logística y curaduría completa del viaje multi-destino",
              parameters: schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_logistics" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI gateway: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = toolCall?.function?.arguments;
    if (!argsStr) {
      return new Response(JSON.stringify({ error: "AI no devolvió tool_call" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let logistics: any;
    try {
      logistics = JSON.parse(argsStr);
    } catch {
      return new Response(JSON.stringify({ error: "AI devolvió JSON inválido" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ logistics }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
