// Edge function: logistics-plan
// Genera la logística completa de un viaje multi-destino:
// vuelos, transporte interno (trenes / roadtrips con paradas / transporte local),
// costos obligatorios (city taxes, visas, buffer cambiario 3%).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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

const SYSTEM = `Eres un planeador de logística de viaje de lujo (IATOS).
Devuelves SIEMPRE un JSON estricto siguiendo el esquema indicado.
Para cada tramo entre ciudades consideras la mejor combinación entre:
- vuelos directos / con escala
- trenes de alta velocidad o escénicos
- roadtrips con paradas en pueblos pequeños o miradores
- transporte local recomendado en cada destino

Estimas precios realistas en USD por persona, duraciones, y agregas costos obligatorios
(city taxes, tasas hoteleras, visados si aplica) y un buffer cambiario del 3%.`;

const schema = {
  type: "object",
  properties: {
    flights: {
      type: "array",
      items: {
        type: "object",
        properties: {
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
  required: ["flights", "internal_transport", "mandatory_costs", "total_estimado_usd"],
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

    const userPrompt = `
Origen: ${body.origin}
Destinos en orden: ${body.destinations.join(" → ")}
Viajeros: ${body.num_viajeros ?? 2}
Fechas: ${body.fecha_salida ?? "flexible"} a ${body.fecha_regreso ?? "flexible"}
Preferencia de conexión: ${body.prefs?.connection ?? "smart"}
Roadtrips con paradas: ${body.prefs?.roadtripStops === false ? "no" : "sí"}
Logística de equipaje: ${body.prefs?.luggageLogistics === false ? "no" : "sí"}

Devuelve un JSON que cumpla el esquema. Para roadtrips incluye 2-4 paradas (pueblos pequeños o miradores).
Para trenes especifica el operador real (ej. Italo, Renfe AVE, Shinkansen) cuando exista.
Para mandatory_costs aplica un currency_buffer del 3% sobre el total estimado.
Asegura coherencia: total_estimado_usd ≈ suma de flights + internal_transport + city_taxes + visa_fees + currency_buffer.
`.trim();

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "lovable-cloud",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_logistics",
              description: "Emite la logística completa del viaje",
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

    let logistics: unknown;
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
