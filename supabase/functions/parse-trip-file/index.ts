// parse-trip-file — recibe PDFs o imágenes (base64) y extrae el viaje
// completo (vuelos, hoteles, fechas, ciudades) usando Gemini multimodal.
// Devuelve un texto rico listo para pasar a /parsear-viaje + /analizar-viaje.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Eres un experto en planificación de viajes. Te van a dar PDFs o imágenes con itinerarios, boletos de avión, reservas de hotel, vouchers, tickets, screenshots de Booking/Expedia/Airbnb, etc.

Tu trabajo es EXTRAER toda la información del viaje y devolver un JSON estricto con esta forma:

{
  "summary": string,            // 1-2 párrafos en español describiendo el viaje COMPLETO con TODAS las ciudades, fechas, vuelos y hoteles que viste. Este texto debe servir para reconstruir el viaje al 100%.
  "destino": string,            // ciudad principal o resumen ("Norte de España")
  "destinations": string[],     // ciudades en orden de visita
  "ciudad_origen": string|null, // ciudad de origen del vuelo si aparece
  "fecha_salida": "YYYY-MM-DD"|null,
  "fecha_regreso": "YYYY-MM-DD"|null,
  "num_viajeros": number,       // por defecto 2
  "flights": [
    { "airline": string|null, "flight_number": string|null, "from": string|null, "to": string|null, "date": "YYYY-MM-DD"|null, "depart_time": string|null, "arrive_time": string|null, "confirmation": string|null }
  ],
  "hotels": [
    { "name": string, "city": string|null, "check_in": "YYYY-MM-DD"|null, "check_out": "YYYY-MM-DD"|null, "nights": number|null, "confirmation": string|null, "address": string|null }
  ],
  "presupuesto_objetivo": number|null,  // total en MXN si se infiere
  "notas": string                       // 1 frase con preferencias detectadas
}

Reglas:
- Si la información no está clara, usa null. NO inventes confirmaciones ni vuelos.
- Las fechas SIEMPRE en formato YYYY-MM-DD.
- Si hay varias páginas/imágenes, consolida TODO en un solo JSON.
- El campo "summary" es el más importante: debe contener TODO lo necesario para reconstruir el viaje.
- Responde SOLO el JSON, sin texto adicional.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const body = await req.json();
    const files: Array<{ name?: string; mime: string; data_base64: string }> = body?.files ?? [];
    const extra: string = body?.extra_prompt ?? "";

    if (!files.length) {
      return new Response(JSON.stringify({ error: "files requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Construye contenido multimodal (OpenAI-compat con image_url + data URL)
    const userParts: any[] = [
      { type: "text", text: `Fecha actual: ${new Date().toISOString().slice(0, 10)}.\nExtrae el viaje completo de los siguientes archivos.${extra ? `\n\nContexto adicional del usuario: ${extra}` : ""}` },
    ];
    for (const f of files) {
      const dataUrl = `data:${f.mime};base64,${f.data_base64}`;
      userParts.push({ type: "image_url", image_url: { url: dataUrl } });
    }

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 55000);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userParts },
        ],
        response_format: { type: "json_object" },
      }),
    }).finally(() => clearTimeout(tid));

    if (!res.ok) {
      const text = await res.text();
      console.error("Gateway error", res.status, text);
      return new Response(JSON.stringify({ error: `AI gateway ${res.status}`, raw: text }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    return new Response(JSON.stringify({ ok: true, ...parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
