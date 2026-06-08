// supabase/functions/parsear-viaje/index.ts
// Convierte un prompt natural ("quiero ir a Tokio en julio con mi pareja, ~$60k MXN")
// en parámetros estructurados que /analizar-viaje pueda usar.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const MASTER_PROMPT_IATOS = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();


const SYSTEM = `Eres un experto en geografía y planificación de viajes. Lees la entrada del usuario PALABRA POR PALABRA, sin omitir ni reinterpretar nada, y extraes parámetros estructurados de descripciones libres en español.

ANTES DE RESPONDER: identifica mentalmente cada sustantivo propio (ciudades, países, regiones), cada cifra (presupuesto, días, viajeros), cada fecha relativa o absoluta, cada exclusión ("sin", "no", "evitar", "ya tengo") y cada preferencia de estilo. NO inventes datos que el usuario no dijo, pero EXPANDE regiones genéricas según las reglas de "destinations".

Devuelves SIEMPRE un JSON estricto con esta forma exacta:
{
  "destino": string,                  // ciudad principal o resumen ("Norte de España")
  "pais_destino": string|null,
  "destinations": string[],           // lista ORDENADA de ciudades reales a visitar. Si es viaje de 1 ciudad, array de 1.
  "is_multi": boolean,                // true si destinations.length >= 2
  "ciudad_origen": string|null,       // null si no se menciona
  "fecha_salida": "YYYY-MM-DD",
  "fecha_regreso": "YYYY-MM-DD",
  "num_viajeros": number,             // 1..12, por defecto 2
  "presupuesto_objetivo": number|null,// total en MXN, null si no se menciona
  "notas": string                     // 1 frase con preferencias detectadas (estilo, roadtrip, lujo, etc.)
}

Reglas CRÍTICAS para "destinations":
- Si el usuario menciona una REGIÓN o ruta genérica (ej. "norte de España", "Toscana", "Riviera Maya", "circuito por Japón"), EXPANDE a 4-7 ciudades reales icónicas en orden lógico de roadtrip/tren.
  • "norte de España" → ["San Sebastián","Bilbao","Santander","Oviedo","Santiago de Compostela"]
  • "Toscana" → ["Florencia","Siena","San Gimignano","Pisa","Lucca"]
  • "Riviera Maya" → ["Playa del Carmen","Tulum","Bacalar","Holbox"]
  • "Andalucía" → ["Sevilla","Córdoba","Granada","Málaga","Cádiz"]
- Si menciona ciudades explícitas separadas por comas/y/→, úsalas en ese orden.
- Si es UNA sola ciudad, devuelve array de 1 elemento.
- Adapta el número de ciudades a la duración: ~2-3 noches por ciudad (13 días ≈ 5-6 ciudades).
- Usa nombres oficiales de ciudades, sin descripciones.

Reglas generales:
- Usa la fecha actual proporcionada como ancla para fechas relativas.
- Si no se da duración, asume 7 días.
- Si no se da número de viajeros, usa 2. "mi pareja/novio/novia" = 2, "familia" = 4, "solo/a" = 1, "amigos" = 4.
- Si mencionan USD/EUR, convierte a MXN (USD≈18, EUR≈20).
- NO incluyas texto fuera del JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hoy = new Date().toISOString().slice(0, 10);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-pro-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Fecha actual: ${hoy}\n\nDescripción del viaje:\n${prompt}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Gateway error", res.status, text);
      return new Response(JSON.stringify({ error: `AI gateway ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // intenta extraer JSON envuelto
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

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
