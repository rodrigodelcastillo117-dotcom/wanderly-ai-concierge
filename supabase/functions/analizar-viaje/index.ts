// supabase/functions/analizar-viaje/index.ts
// Analiza un viaje usando Claude (Anthropic) con el perfil del usuario y datos solicitados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

interface AnalisisRequest {
  destino: string;
  pais_destino?: string;
  ciudad_origen: string;
  fecha_salida: string;
  fecha_regreso: string;
  num_viajeros: number;
  presupuesto_objetivo?: number | null;
}

const SYSTEM_PROMPT = `Eres un consultor de viajes premium con 20 años de experiencia, tono sofisticado, cálido y específico, como un concierge personal. Siempre respondes en español de México y todos los precios en pesos mexicanos (MXN).

REGLA #1 — PRECIOS REALES 2026 (no negociable). Usa estos rangos verificados de mercado. Tipo de cambio: 1 USD ≈ 18.5 MXN, 1 EUR ≈ 21 MXN.

VUELOS REDONDOS por persona desde CDMX (económica, temporada media-alta):
- CDMX ↔ París/Madrid/Barcelona/Roma: $18,000–$28,000 MXN (Aeroméxico, Air France, Iberia, KLM).
- CDMX ↔ Atenas (con escala): $22,000–$34,000 MXN.
- CDMX ↔ NYC/Miami/LA: $5,500–$12,000 MXN.
- CDMX ↔ Tokio/Seúl/Bangkok: $25,000–$42,000 MXN.
- CDMX ↔ Buenos Aires/Lima/Santiago: $8,000–$18,000 MXN.
- Vuelos internos Europa (París↔Atenas, Madrid↔Atenas): $1,800–$4,500 MXN.
- Premium economy: +60-90%. Business: 3-5x económica.

HOSPEDAJE/noche habitación doble temporada alta:
- 3★ Europa: $1,600–$2,800. 4★: $2,800–$5,000. 5★: $5,500–$12,000.
- Boutique Santorini/Mykonos verano: $7,000–$20,000.
- Airbnb céntrico 2p: $1,400–$3,500.

CRUCEROS (por persona):
- Mediterráneo 4 noches Celestyal: interior $14,000–$32,000, balcón $22,000–$48,000.
- Mediterráneo 7 noches MSC/Royal/NCL: $18,000–$55,000.

COMIDA por persona/día: económica $400–$700, media $800–$1,500, alta $1,800–$4,000.

TOURS/persona: medio día grupal $600–$1,400; día completo guía privado $2,500–$6,000; museos top (Louvre, Acrópolis, Vaticano) $300–$700; crucero atardecer Santorini $1,500–$3,500.

TRANSPORTE LOCAL (viaje completo): metro/bus Europa 7-14d $800–$1,800; trenes AVE/TGV/Italo $1,500–$4,500 por trayecto.

REGLA #2: Nombres reales (Pullman Paris Tour Eiffel, Celestyal Journey, Restaurant Septime, etc.) y barrios reales (Le Marais, Trastevere, Plaka, Malasaña).

REGLA #3: total_estimado = suma coherente del desglose para el GRUPO COMPLETO (multiplica por num_viajeros donde aplique: vuelos, comida, tours). Hospedaje es por habitación, no por persona.

REGLA #4: Responde SIEMPRE llamando a la herramienta "entregar_analisis_viaje". Nunca texto libre.`;

const TOOL_SCHEMA = {
  name: "entregar_analisis_viaje",
  description: "Entrega el análisis completo y estructurado de un viaje premium personalizado.",
  input_schema: {
    type: "object",
    properties: {
      analisis_narrativo: {
        type: "string",
        description: "Texto narrativo de 2-3 párrafos explicando por qué este viaje es perfecto para el cliente, mencionando elementos específicos de su perfil. Tono cálido y editorial.",
      },
      total_estimado: {
        type: "number",
        description: "Costo total estimado del viaje completo en MXN para el grupo entero.",
      },
      match_score: {
        type: "integer",
        description: "Score 0-100 de qué tanto coincide este destino con el perfil del cliente.",
      },
      desglose_presupuesto: {
        type: "object",
        properties: {
          vuelos: { type: "number" },
          hospedaje: { type: "number" },
          comida: { type: "number" },
          tours: { type: "number" },
          transporte_local: { type: "number" },
          extras: { type: "number" },
        },
        required: ["vuelos", "hospedaje", "comida", "tours", "transporte_local", "extras"],
      },
      vuelos: {
        type: "array",
        description: "2-3 opciones de vuelo (ahorro, equilibrio, premium).",
        items: {
          type: "object",
          properties: {
            tier: { type: "string", enum: ["ahorro", "equilibrio", "premium"] },
            aerolinea: { type: "string" },
            duracion: { type: "string" },
            escalas: { type: "string" },
            precio_por_persona: { type: "number" },
            notas: { type: "string" },
          },
          required: ["tier", "aerolinea", "duracion", "escalas", "precio_por_persona"],
        },
      },
      hospedaje: {
        type: "array",
        description: "3 opciones de hospedaje que matcheen el perfil.",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            tipo: { type: "string" },
            barrio: { type: "string" },
            rating: { type: "number" },
            precio_por_noche: { type: "number" },
            por_que: { type: "string", description: "Por qué encaja con el cliente." },
          },
          required: ["nombre", "tipo", "barrio", "rating", "precio_por_noche", "por_que"],
        },
      },
      itinerario: {
        type: "array",
        description: "Itinerario día por día.",
        items: {
          type: "object",
          properties: {
            dia: { type: "integer" },
            titulo: { type: "string" },
            mañana: { type: "string" },
            tarde: { type: "string" },
            noche: { type: "string" },
            costo_aprox_dia: { type: "number" },
          },
          required: ["dia", "titulo", "mañana", "tarde", "noche"],
        },
      },
      restaurantes: {
        type: "array",
        description: "5-8 restaurantes curados al paladar del cliente.",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            cocina: { type: "string" },
            rango_precio: { type: "string" },
            por_que: { type: "string" },
          },
          required: ["nombre", "cocina", "rango_precio", "por_que"],
        },
      },
      tours: {
        type: "array",
        description: "4-6 experiencias y tours curados.",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            duracion: { type: "string" },
            precio_por_persona: { type: "number" },
            por_que: { type: "string" },
          },
          required: ["nombre", "duracion", "precio_por_persona", "por_que"],
        },
      },
      tips_personalizados: {
        type: "array",
        description: "5-8 tips específicos según el perfil (qué empacar, idioma, costumbres, mejores días).",
        items: { type: "string" },
      },
      pais_destino: { type: "string" },
    },
    required: [
      "analisis_narrativo",
      "total_estimado",
      "match_score",
      "desglose_presupuesto",
      "vuelos",
      "hospedaje",
      "itinerario",
      "restaurantes",
      "tours",
      "tips_personalizados",
      "pais_destino",
    ],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY no está configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = (await req.json()) as AnalisisRequest;
    if (!body.destino || !body.fecha_salida || !body.fecha_regreso || !body.ciudad_origen) {
      return new Response(JSON.stringify({ error: "Faltan datos requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cargar perfil del viajero
    const { data: travelProfile } = await supabase
      .from("travel_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, ciudad_origen")
      .eq("id", user.id)
      .maybeSingle();

    const dias =
      Math.max(
        1,
        Math.round(
          (new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );

    const userPrompt = `Genera un análisis premium de viaje para el siguiente cliente y solicitud.

CLIENTE
- Nombre: ${profile?.full_name ?? "Cliente"}
- Ciudad de origen: ${body.ciudad_origen}
- Estilos de viaje: ${(travelProfile?.estilo_viaje ?? []).join(", ") || "no especificado"}
- Rango de presupuesto: ${travelProfile?.presupuesto_rango ?? "no especificado"}
- Ritmo de viaje: ${travelProfile?.ritmo_viaje ?? "equilibrado"}
- Preferencias de comida: ${(travelProfile?.preferencias_comida ?? []).join(", ") || "abierto"}
- Alergias / restricciones: ${(travelProfile?.alergias_restricciones ?? []).join(", ") || "ninguna"}
- Intereses: ${(travelProfile?.intereses ?? []).join(", ") || "varios"}
- Tipo de alojamiento preferido: ${(travelProfile?.tipo_alojamiento_preferido ?? []).join(", ") || "flexible"}
- Acompañantes típicos: ${travelProfile?.acompanantes_tipico ?? "no especificado"}
- Destinos visitados: ${(travelProfile?.destinos_visitados ?? []).join(", ") || "ninguno"}
- Idiomas hablados: ${(travelProfile?.idiomas_hablados ?? []).join(", ") || "español"}
- Movilidad especial: ${travelProfile?.movilidad_especial ? "sí" : "no"}
- Notas adicionales: ${travelProfile?.notas_adicionales ?? "ninguna"}

VIAJE SOLICITADO
- Destino: ${body.destino}
- País destino (si lo conoces): ${body.pais_destino ?? "deduce a partir del destino"}
- Fechas: del ${body.fecha_salida} al ${body.fecha_regreso} (${dias} días)
- Viajeros: ${body.num_viajeros}
- Presupuesto objetivo (MXN): ${body.presupuesto_objetivo ?? "sin presupuesto fijo"}

Investiga precios reales con web_search ANTES de generar la cotización. Mínimo 4-6 búsquedas (vuelos, hoteles principales, actividades, tipos de cambio). NO uses estimaciones genéricas. Cuando tengas los datos, llama a "entregar_analisis_viaje" con cifras realistas en MXN. Todas las narrativas en español de México.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 12000,
        system: SYSTEM_PROMPT,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 8,
          },
          TOOL_SCHEMA,
        ],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error("Claude error:", claudeRes.status, text);
      return new Response(
        JSON.stringify({ error: `Claude API error ${claudeRes.status}`, detail: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeRes.json();
    const toolUse = (claudeData.content ?? []).find(
      (b: any) => b.type === "tool_use" && b.name === "entregar_analisis_viaje"
    );
    if (!toolUse?.input) {
      console.error("No tool_use en respuesta:", JSON.stringify(claudeData).slice(0, 2000));
      return new Response(JSON.stringify({ error: "Respuesta inválida de IA" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const a = toolUse.input;


    // Guardar trip
    const { data: trip, error: insertErr } = await supabase
      .from("trips")
      .insert({
        user_id: user.id,
        destino: body.destino,
        pais_destino: a.pais_destino ?? body.pais_destino,
        ciudad_origen: body.ciudad_origen,
        fecha_salida: body.fecha_salida,
        fecha_regreso: body.fecha_regreso,
        num_viajeros: body.num_viajeros,
        presupuesto_objetivo: body.presupuesto_objetivo,
        status: "completo",
        total_estimado: a.total_estimado,
        moneda: "MXN",
        match_score: a.match_score,
        analisis_ai: a.analisis_narrativo,
        desglose_presupuesto: a.desglose_presupuesto,
        vuelos_json: a.vuelos,
        hospedaje_json: a.hospedaje,
        itinerario_json: a.itinerario,
        restaurantes_json: a.restaurantes,
        tours_json: a.tours,
        tips_personalizados: a.tips_personalizados,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ trip }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analizar-viaje error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
