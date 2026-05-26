// Edge function: logistics-plan (PARALLEL VERSION)
// Genera la logística de un viaje multi-destino en paralelo:
// - 1 llamada para vuelos internacionales + transporte interno + itinerario día por día
// - N llamadas en paralelo (una por ciudad) para hospedaje + restaurantes + experiencias + arrival_options
// Esto evita el timeout de 150s al no pedir el JSON gigante en una sola llamada.
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

const MODEL = "google/gemini-2.5-pro";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(apiKey: string, system: string, user: string, toolName: string, schema: any) {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: { name: toolName, description: "Emite resultado", parameters: schema } }],
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI ${res.status}: ${t}`);
  }
  const json = await res.json();
  const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("AI no devolvió tool_call");
  return JSON.parse(argsStr);
}

// ───── Schemas pequeños ─────

const globalSchema = {
  type: "object",
  properties: {
    flights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tier: { type: "string" },
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
          mode: { type: "string" },
          provider: { type: "string" },
          duration: { type: "string" },
          price_per_person_usd: { type: "number" },
          scenic: { type: "boolean" },
          luggage_note: { type: "string" },
        },
        required: ["from", "to", "mode", "duration", "price_per_person_usd"],
      },
    },
    days: {
      type: "array",
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
  required: ["flights", "internal_transport", "days", "mandatory_costs", "total_estimado_usd"],
};

const citySchema = {
  type: "object",
  properties: {
    city: { type: "string" },
    nights: { type: "number" },
    arrival_options: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          mode: { type: "string" },
          tier: { type: "string" },
          provider: { type: "string" },
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
          tier: { type: "string" },
          tipo: { type: "string" },
          nombre: { type: "string" },
          barrio: { type: "string" },
          rating: { type: "number" },
          price_per_night_usd: { type: "number" },
          por_que: { type: "string" },
        },
        required: ["tier", "nombre", "price_per_night_usd"],
      },
    },
    restaurantes: {
      type: "array",
      minItems: 4,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          cocina: { type: "string" },
          rango_precio: { type: "string" },
          por_que: { type: "string" },
        },
        required: ["nombre", "cocina"],
      },
    },
    experiencias: {
      type: "array",
      minItems: 4,
      maxItems: 5,
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
};

const PRICING_REFS = `REFERENCIAS DE MERCADO (USD POR PERSONA, conservadoras y realistas):
VUELOS round-trip clase turista temporada media:
- México↔Europa occidental (MAD/BCN/CDG/FCO/LHR/AMS): 900–1,500
- México↔Grecia/Europa este (ATH/JTR/IST/VIE): 1,100–1,800
- México↔Asia (HND/BKK/SIN/DXB/DPS): 1,200–2,100
- México↔EEUU: 350–900 | Sudamérica: 500–1,000 | Doméstico MX: 100–250
Temporada alta (jun-ago, navidad, semana santa) +25-50%. Vuelo directo +15-30%.
TRENES (Europa): AVE Madrid-Barcelona 60-130, Italo/Trenitalia Roma-Florencia 30-70, Eurostar Londres-París 90-220, TGV París-Lyon 60-130.
FERRIES Grecia: Atenas-Santorini Blue Star 50-75, SeaJets rápido 90-140.
HOSPEDAJE por noche:
- MAD/BCN/Lisboa/Roma: 5★ 280-450, 4★ 150-240
- París/Londres/Ámsterdam: 5★ 450-750, 4★ 220-350
- Santorini/Mykonos temp alta: 5★ 500-900, 4★ 280-450
- Tokio/Singapur/HK: 5★ 350-600, 4★ 200-320
- Dubai/Bangkok/Bali: 5★ 250-500, 4★ 130-250
- NYC/Miami/LA: 5★ 400-700, 4★ 220-350
EXPERIENCIAS premium: tour guiado 80-180, cena tasting 120-300, day-trip privado 250-600.
NUNCA precios optimistas. Sé conservador.`;

const GLOBAL_SYSTEM = `Eres IATOS, analista senior de pricing de viajes de lujo. Devuelves JSON estricto con precios REALES de mercado.
Aerolíneas/operadores REALES (Iberia, Air France, Italo, Renfe AVE, Eurostar, Ferries Blue Star, etc).
En Europa <800km prefiere TREN/FERRY sobre vuelo.
${PRICING_REFS}`;

const CITY_SYSTEM = `Eres IATOS, analista senior de viajes de lujo. Para UNA ciudad devuelves JSON con:
- 2-3 arrival_options desde el punto anterior (incluye tren/ferry real cuando aplique)
- EXACTAMENTE 3 hospedajes (ahorro/equilibrio/premium) con hoteles REALES y conocidos
- 4-5 restaurantes reales que matcheen el estilo del usuario
- 4-5 experiencias/tours reales
${PRICING_REFS}`;

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

    // Perfil
    let perfilLine = "Usuario sin perfil — equilibrio premium.";
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
            .from("ai_user_preferences").select("*").eq("user_id", user.id).maybeSingle();
          if (prefs) {
            perfilLine = `Perfil: ritmo=${prefs.ritmo_viaje ?? "—"} | presupuesto=${prefs.nivel_presupuesto ?? "—"} | comida=${(prefs.estilo_comida ?? []).join(",") || "—"} | restricciones=${(prefs.restricciones_alimentarias ?? []).join(",") || "ninguna"} | hospedaje=${(prefs.hospedaje_preferencias ?? []).join(",") || "—"} | actividades=${(prefs.actividades_tarde ?? []).join(",") || "—"} | compañeros=${prefs.companeros_viaje ?? "—"}`;
          }
        }
      }
    } catch (e) {
      console.warn("perfil:", e);
    }

    const nights = body.fecha_salida && body.fecha_regreso
      ? Math.max(1, Math.round((new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) / 86400000))
      : Math.max(body.destinations.length * 3, 6);

    const viajeros = body.num_viajeros ?? 2;
    const fechas = `${body.fecha_salida ?? "flexible"} a ${body.fecha_regreso ?? "flexible"}`;
    const cityList = body.destinations.join(" → ");

    // ───── Llamada GLOBAL (vuelos + transporte + días + costos) ─────
    const globalPrompt = `${perfilLine}

Origen: ${body.origin}
Destinos en orden: ${cityList}
Viajeros: ${viajeros} | Fechas: ${fechas} (~${nights} noches)
Preferencia conexión: ${body.prefs?.connection ?? "smart"}

Entrega JSON con:
1. flights: 1-2 vuelos internacionales (origen→primera y última→origen) con tier ahorro/equilibrio/premium.
2. internal_transport: UN tramo por cada par consecutivo (${body.destinations.length - 1} tramos). Europa <800km usa TREN. Inter-islas griegas usa FERRY (Blue Star, SeaJets).
3. days: ${nights} días distribuidos lógicamente entre las ciudades, cada uno con ciudad/título/mañana/tarde/noche específicos.
4. mandatory_costs con currency_buffer_pct=3.
5. total_estimado_usd y resumen breve.`;

    // ───── Llamadas POR CIUDAD en paralelo ─────
    const cityPromises = body.destinations.map((city, i) => {
      const prevPoint = i === 0 ? body.origin : body.destinations[i - 1];
      const cityNights = Math.max(1, Math.round(nights / body.destinations.length));
      const cityPrompt = `${perfilLine}

Ciudad: ${city}
Punto anterior: ${prevPoint}
Viajeros: ${viajeros} | Noches sugeridas: ${cityNights}
Ruta completa del viaje (contexto): ${body.origin} → ${cityList}

Entrega JSON con:
- city: "${city}"
- nights: ${cityNights}
- arrival_options: 2-3 maneras de LLEGAR desde ${prevPoint}. Si es Europa <800km incluye tren real (Italo/Renfe AVE/SNCF/Eurostar). Si son islas griegas incluye ferry real (Blue Star, SeaJets) y vuelo Aegean/Sky Express.
- hospedaje: EXACTAMENTE 3 (ahorro/equilibrio/premium) con hoteles REALES de ${city} alineados al estilo del usuario.
- restaurantes: 4-5 reales en ${city} que matcheen el estilo de comida del usuario.
- experiencias: 4-5 tours/experiencias reales en ${city}.`;
      return callAI(apiKey, CITY_SYSTEM, cityPrompt, "emit_city", citySchema)
        .catch((e) => {
          console.error(`city ${city} failed:`, e.message);
          return {
            city, nights: cityNights,
            arrival_options: [], hospedaje: [], restaurantes: [], experiencias: [],
          };
        });
    });

    const globalPromise = callAI(apiKey, GLOBAL_SYSTEM, globalPrompt, "emit_global", globalSchema);

    const [globalData, ...cityData] = await Promise.all([globalPromise, ...cityPromises]);

    const logistics = {
      ...globalData,
      per_destination: cityData,
    };

    return new Response(JSON.stringify({ logistics }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("logistics-plan error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
