// supabase/functions/analizar-viaje/index.ts
// Flujo: Perplexity (sonar-pro) investiga precios reales -> Claude estructura el análisis premium.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
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

REGLAS ESTRICTAS DE PRECIOS:
1. PROHIBIDO inventar, redondear hacia abajo o "ajustar" precios. Cada cifra que pongas DEBE aparecer textualmente (o ser conversión directa USD→MXN / EUR→MXN) en la sección "INVESTIGACIÓN DE PRECIOS REALES".
2. Si Perplexity te da un rango (ej: "$25,000-$32,000"), usa el PUNTO MEDIO, nunca el extremo bajo.
3. Tipo de cambio fijo: 1 USD = 18.5 MXN, 1 EUR = 21 MXN. Convierte siempre.
4. Para vuelos con varios segmentos (ej: CDMX→París→Madrid→Atenas), cada tier (ahorro/equilibrio/premium) debe representar el COSTO TOTAL DE TODOS LOS SEGMENTOS por persona, no un solo tramo. Si Perplexity desglosa por tramo, SUMA los tramos antes de poner el precio.
5. Si una opción "equilibrio" o "premium" sale más barata que "ahorro", está mal: revisa y corrige.
6. Nombres reales de hoteles, aerolíneas, restaurantes y barrios — los que aparezcan en la investigación.
7. total_estimado = suma coherente del desglose para el GRUPO COMPLETO (multiplica por num_viajeros en vuelos/comida/tours; hospedaje es por habitación × noches).
8. En analisis_narrativo cita explícitamente 2-3 fuentes reales de la lista de FUENTES CITADAS.
9. Responde SIEMPRE llamando a la herramienta "entregar_analisis_viaje". Nunca texto libre.`;

const TOOL_SCHEMA = {
  name: "entregar_analisis_viaje",
  description: "Entrega el análisis completo y estructurado de un viaje premium personalizado.",
  input_schema: {
    type: "object",
    properties: {
      analisis_narrativo: { type: "string" },
      total_estimado: { type: "number" },
      match_score: { type: "integer" },
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
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            tipo: { type: "string" },
            barrio: { type: "string" },
            rating: { type: "number" },
            precio_por_noche: { type: "number" },
            por_que: { type: "string" },
          },
          required: ["nombre", "tipo", "barrio", "rating", "precio_por_noche", "por_que"],
        },
      },
      itinerario: {
        type: "array",
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
      tips_personalizados: { type: "array", items: { type: "string" } },
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

async function investigarConPerplexity(body: AnalisisRequest, dias: number): Promise<{ texto: string; citations: string[] }> {
  const query = `Investiga precios REALES y actuales para este viaje. Devuelve CIFRAS PUNTUALES en MXN (no rangos vagos). Si el destino implica varios países/ciudades, desglosa TODOS los vuelos necesarios.

Origen: ${body.ciudad_origen}
Destino: ${body.destino}
Fechas: ${body.fecha_salida} al ${body.fecha_regreso} (${dias} días)
Viajeros: ${body.num_viajeros}

FORMATO OBLIGATORIO: Para cada ítem reporta "Aerolínea/Hotel X: $XX,XXX MXN" con cifra única (si el sitio da rango, usa el punto medio). Incluye link de fuente entre paréntesis.

1. VUELOS — Identifica TODOS los segmentos necesarios entre ${body.ciudad_origen} y ${body.destino} (incluyendo si hay que volar entre ciudades intermedias o llegar a puerto de crucero). Para CADA segmento, da 3 opciones:
   - AHORRO: aerolínea real, escalas, duración, precio MXN por persona (tarifa más económica disponible esas fechas)
   - EQUILIBRIO: directo o 1 escala buena, precio MXN
   - PREMIUM: premium economy o business, precio MXN
   Luego suma el TOTAL del viaje aéreo por persona para cada tier.
   Fuentes: Google Flights, Skyscanner, Kayak, Aeroméxico, sitios de aerolíneas.

2. HOSPEDAJE — ${dias} noches totales (desglosa por ciudad si aplica). 3 opciones con NOMBRE REAL del hotel (3★, 4★ boutique, 5★), barrio, rating, precio MXN por noche habitación doble en esas fechas exactas. Fuentes: Booking.com, Hotels.com.

3. CRUCERO (si aplica): nombre real, naviera, itinerario, precio MXN por persona interior y balcón. Fuentes: Celestyal, MSC, Royal Caribbean.

4. TOURS: 4-6 experiencias reales con nombre, duración y precio MXN por persona. Fuentes: GetYourGuide, Viator, Civitatis.

5. COMIDA: 5-6 restaurantes reales bien valorados con rango ($/$$/$$$) y cocina.

6. TRANSPORTE LOCAL: metro/tren/transfers, total MXN estimado para ${body.num_viajeros} personas.

Tipo de cambio actual USD→MXN y EUR→MXN. Sé exhaustivo con cifras puntuales.`;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        { role: "system", content: "Eres un investigador de precios de viajes. Responde con datos reales, cifras concretas y nombres específicos. En español." },
        { role: "user", content: query },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Perplexity error ${res.status}: ${t}`);
  }
  const data = await res.json();
  return {
    texto: data.choices?.[0]?.message?.content ?? "",
    citations: data.citations ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!PERPLEXITY_API_KEY) {
      return new Response(JSON.stringify({ error: "PERPLEXITY_API_KEY no configurada" }), {
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

    const body = (await req.json()) as AnalisisRequest;
    if (!body.destino || !body.fecha_salida || !body.fecha_regreso || !body.ciudad_origen) {
      return new Response(JSON.stringify({ error: "Faltan datos requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: travelProfile } = await supabase
      .from("travel_profiles").select("*").eq("user_id", user.id).maybeSingle();
    const { data: profile } = await supabase
      .from("profiles").select("full_name, ciudad_origen").eq("id", user.id).maybeSingle();

    const dias = Math.max(1, Math.round(
      (new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) / (1000 * 60 * 60 * 24)
    ));

    // PASO 1: Perplexity investiga precios reales
    console.log("Investigando precios con Perplexity...");
    const investigacion = await investigarConPerplexity(body, dias);
    console.log("Perplexity OK, citations:", investigacion.citations.length);

    // PASO 2: Claude estructura el análisis usando los datos reales
    const userPrompt = `Genera un análisis premium de viaje usando EXCLUSIVAMENTE los precios reales investigados abajo.

CLIENTE
- Nombre: ${profile?.full_name ?? "Cliente"}
- Ciudad origen: ${body.ciudad_origen}
- Estilos: ${(travelProfile?.estilo_viaje ?? []).join(", ") || "no especificado"}
- Presupuesto: ${travelProfile?.presupuesto_rango ?? "no especificado"}
- Ritmo: ${travelProfile?.ritmo_viaje ?? "equilibrado"}
- Comida: ${(travelProfile?.preferencias_comida ?? []).join(", ") || "abierto"}
- Alergias: ${(travelProfile?.alergias_restricciones ?? []).join(", ") || "ninguna"}
- Intereses: ${(travelProfile?.intereses ?? []).join(", ") || "varios"}
- Alojamiento: ${(travelProfile?.tipo_alojamiento_preferido ?? []).join(", ") || "flexible"}
- Acompañantes: ${travelProfile?.acompanantes_tipico ?? "no especificado"}
- Idiomas: ${(travelProfile?.idiomas_hablados ?? []).join(", ") || "español"}
- Notas: ${travelProfile?.notas_adicionales ?? "ninguna"}

VIAJE
- Destino: ${body.destino}
- Fechas: ${body.fecha_salida} al ${body.fecha_regreso} (${dias} días)
- Viajeros: ${body.num_viajeros}
- Presupuesto objetivo (MXN): ${body.presupuesto_objetivo ?? "sin presupuesto fijo"}

==========================================
INVESTIGACIÓN DE PRECIOS REALES (Perplexity, datos en vivo)
==========================================
${investigacion.texto}

FUENTES CITADAS:
${investigacion.citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}
==========================================

Llama a "entregar_analisis_viaje" usando estos precios reales. Todo en MXN.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "entregar_analisis_viaje" },
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error("Claude error:", claudeRes.status, text);
      return new Response(JSON.stringify({ error: `Claude API error ${claudeRes.status}`, detail: text }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeRes.json();
    const toolUse = (claudeData.content ?? []).find(
      (b: any) => b.type === "tool_use" && b.name === "entregar_analisis_viaje"
    );
    if (!toolUse?.input) {
      console.error("No tool_use:", JSON.stringify(claudeData).slice(0, 2000));
      return new Response(JSON.stringify({ error: "Respuesta inválida de IA" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const a = toolUse.input;

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
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ trip, fuentes: investigacion.citations }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analizar-viaje error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
