// Audita la descripción libre del usuario y devuelve un perfil estructurado
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { descripcion, contexto } = await req.json();
    if (!descripcion || descripcion.trim().length < 5) {
      return new Response(JSON.stringify({ error: "descripcion requerida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const system = `Eres un analista de perfil de viajero. A partir de la descripción libre del usuario y el contexto que ya tenemos sobre él, devuelve EXCLUSIVAMENTE un JSON válido (sin markdown, sin texto extra) con la siguiente estructura:
{
  "resumen": "1-2 frases describiéndolo como viajero",
  "rasgos": ["rasgo1", "rasgo2", "..."],
  "motivaciones": ["motivación1", "..."],
  "evitar": ["cosas que no le gustan"],
  "tono_recomendaciones": "casual | sofisticado | técnico | cálido",
  "señales_clave": { "clave": "valor" }
}`;

    const userMsg = `Descripción del usuario:\n${descripcion}\n\nContexto previo:\n${JSON.stringify(contexto ?? {}, null, 2)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: "ai_error", detail: txt }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let perfil: any = {};
    try { perfil = JSON.parse(content); } catch { perfil = { resumen: content }; }

    return new Response(JSON.stringify({ perfil }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
