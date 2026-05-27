// parse-trip-file — lee PDFs/imágenes con Gemini multimodal y extrae el
// viaje TAL CUAL aparece en los documentos. Devuelve datos mapeados al
// schema interno (vuelos_json, hospedaje_json, itinerario_json) para que
// el cliente pueda guardar el viaje sin re-generación por IA.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Eres un extractor de itinerarios de viaje. Te entregarán PDFs o imágenes (boletos de avión, vouchers de crucero, reservas de hotel, itinerarios de agencia, etc.).

REGLA #1: NO INVENTES NADA. Solo extrae lo que aparece textualmente en los documentos. Si un dato no está, usa null.

Devuelve SOLO este JSON estricto:

{
  "summary": string,                 // 2-4 párrafos en español describiendo el viaje COMPLETO tal cual aparece
  "destino": string,                 // resumen ("París → Atenas → Crucero Grecia → París")
  "destinations": string[],          // ciudades en orden cronológico (incluye paradas del crucero)
  "ciudad_origen": string|null,
  "fecha_salida": "YYYY-MM-DD"|null,
  "fecha_regreso": "YYYY-MM-DD"|null,
  "num_viajeros": number,            // por defecto 2
  "presupuesto_total_mxn": number|null,
  "vuelos": [
    {
      "aerolinea": string,
      "numero_vuelo": string|null,
      "from": string,                // ciudad o IATA
      "to": string,                  // ciudad o IATA (usar como "ciudad" del tramo)
      "fecha": "YYYY-MM-DD"|null,
      "hora_salida": string|null,
      "hora_llegada": string|null,
      "duracion": string|null,
      "escalas": string|null,        // "directo" o "1 escala en XXX"
      "clase": string|null,
      "precio_por_persona_mxn": number|null,
      "confirmacion": string|null,
      "notas": string|null
    }
  ],
  "hoteles": [
    {
      "nombre": string,
      "ciudad": string,
      "barrio": string|null,
      "direccion": string|null,
      "check_in": "YYYY-MM-DD"|null,
      "check_out": "YYYY-MM-DD"|null,
      "noches": number|null,
      "tipo": string|null,           // "Hotel 5★", "Boutique", "Resort", etc.
      "rating": number|null,
      "precio_por_noche_mxn": number|null,
      "precio_total_mxn": number|null,
      "confirmacion": string|null,
      "notas": string|null
    }
  ],
  "cruceros": [
    {
      "naviera": string|null,
      "barco": string|null,
      "itinerario": string[],        // puertos en orden
      "fecha_embarque": "YYYY-MM-DD"|null,
      "fecha_desembarque": "YYYY-MM-DD"|null,
      "noches": number|null,
      "camarote": string|null,
      "precio_total_mxn": number|null,
      "confirmacion": string|null
    }
  ],
  "itinerario": [
    { "dia": number, "fecha": "YYYY-MM-DD"|null, "ciudad": string, "titulo": string, "mañana": string, "tarde": string, "noche": string }
  ],
  "notas_generales": string
}

Reglas:
- Fechas SIEMPRE en YYYY-MM-DD. Si ves "15 jul 2026" conviértelo.
- Si el precio viene en USD/EUR conviértelo aprox (USD≈18 MXN, EUR≈20 MXN) y márcalo en notas.
- Para cruceros, agrega también cada puerto del itinerario al array "destinations" en orden.
- El "itinerario" llénalo SOLO con lo que aparece en el PDF. Si solo dice "Día 3: Atenas", deja mañana/tarde/noche como "" — NO inventes actividades.
- Responde SOLO el JSON, sin texto adicional, sin markdown.`;

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

    const userParts: any[] = [
      { type: "text", text: `Fecha actual: ${new Date().toISOString().slice(0, 10)}.\nExtrae el viaje COMPLETO de los siguientes archivos exactamente como aparece. No inventes nada.${extra ? `\n\nContexto del usuario: ${extra}` : ""}` },
    ];
    for (const f of files) {
      const dataUrl = `data:${f.mime};base64,${f.data_base64}`;
      userParts.push({ type: "image_url", image_url: { url: dataUrl } });
    }

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 90000);

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

    // Mapea a schema interno del proyecto (vuelos_json / hospedaje_json)
    const vuelos_json = (parsed.vuelos ?? []).map((v: any) => ({
      aerolinea: v.aerolinea ?? "—",
      numero_vuelo: v.numero_vuelo ?? null,
      tier: v.clase ?? "Reservado",
      from: v.from ?? null,
      to: v.to ?? null,
      ciudad: v.to ?? null,
      fecha: v.fecha ?? null,
      hora_salida: v.hora_salida ?? null,
      hora_llegada: v.hora_llegada ?? null,
      duracion: v.duracion ?? "—",
      escalas: v.escalas ?? "—",
      precio_por_persona: v.precio_por_persona_mxn ?? null,
      confirmacion: v.confirmacion ?? null,
      notas: v.notas ?? null,
      desde_pdf: true,
    }));

    const hospedaje_json = (parsed.hoteles ?? []).map((h: any) => ({
      nombre: h.nombre ?? "—",
      ciudad: h.ciudad ?? null,
      barrio: h.barrio ?? "",
      direccion: h.direccion ?? null,
      tipo: h.tipo ?? "Reservado",
      tier: h.tipo ?? "Reservado",
      rating: h.rating ?? null,
      check_in: h.check_in ?? null,
      check_out: h.check_out ?? null,
      noches: h.noches ?? null,
      precio_por_noche: h.precio_por_noche_mxn ?? null,
      precio_total: h.precio_total_mxn ?? null,
      por_que: h.notas ?? "Reservado en tu PDF",
      confirmacion: h.confirmacion ?? null,
      desde_pdf: true,
    }));

    return new Response(JSON.stringify({
      ok: true,
      summary: parsed.summary ?? "",
      destino: parsed.destino ?? null,
      destinations: parsed.destinations ?? [],
      ciudad_origen: parsed.ciudad_origen ?? null,
      fecha_salida: parsed.fecha_salida ?? null,
      fecha_regreso: parsed.fecha_regreso ?? null,
      num_viajeros: parsed.num_viajeros ?? 2,
      presupuesto_total_mxn: parsed.presupuesto_total_mxn ?? null,
      vuelos_json,
      hospedaje_json,
      cruceros: parsed.cruceros ?? [],
      itinerario: parsed.itinerario ?? [],
      notas_generales: parsed.notas_generales ?? "",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
