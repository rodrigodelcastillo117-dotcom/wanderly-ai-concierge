// parse-trip-file — lee PDFs/imágenes con Gemini multimodal y extrae el
// viaje TAL CUAL aparece en los documentos. Devuelve datos mapeados al
// schema interno (vuelos_json, hospedaje_json, cruceros_json, itinerario_json).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Eres un EXTRACTOR EXPERTO de itinerarios de viaje. Recibirás PDFs o imágenes (itinerarios completos, boletos de avión, vouchers de crucero, reservaciones de hotel, transfers).

🚨 REGLA #1 — NO INVENTES NADA. Solo extrae lo que aparece literalmente en los documentos. Si un dato no está, devuelve null (no "—", no "N/A", no texto inventado).

🚨 REGLA #2 — Lee TODAS las páginas. Tablas, listas, calendarios día-por-día, totales de presupuesto, listas de "contactos", "códigos de confirmación", todo cuenta. Hojea el documento varias veces antes de responder.

🚨 REGLA #3 — Hospedajes "gratis" o sin costo (texto como "$0", "CASA", "AMOR", "gratis", "sin costo", "depto de un amigo", "Airbnb de Sofía") SIGUEN siendo hospedajes válidos. Mapéalos con costo_cero=true y motivo="quedándome con un amigo/familiar" (o lo que diga). NO los omitas.

🚨 REGLA #4 — Cruceros: extrae cada puerto del itinerario y agrégalos también a "destinations" en orden cronológico junto con las ciudades.

🚨 REGLA #5 — Códigos de reserva (PNR, confirmaciones) suelen aparecer en una tabla al final. Cruza esos códigos con los vuelos y hoteles que ya extrajiste.

Devuelve SOLO este JSON estricto, sin markdown:

{
  "summary": string,                         // 3-5 párrafos describiendo el viaje COMPLETO tal cual
  "destino": string,                         // resumen ("París → Madrid → Atenas → Crucero Egeo")
  "destinations": string[],                  // ciudades + puertos del crucero en orden cronológico
  "ciudad_origen": string|null,
  "fecha_salida": "YYYY-MM-DD"|null,         // primer día del viaje
  "fecha_regreso": "YYYY-MM-DD"|null,        // último día
  "num_viajeros": number,                    // mínimo 1, default 2 si es claro que viajan en pareja
  "presupuesto_total_mxn": number|null,      // total estimado del viaje en MXN
  "presupuesto_pagado_mxn": number|null,     // lo que ya está pagado
  "moneda_original": string|null,            // "MXN", "USD", "EUR"
  "vuelos": [
    {
      "aerolinea": string,                   // "Air France", "Iberia", etc.
      "numero_vuelo": string|null,           // "AF0179"
      "from_ciudad": string,                 // "Ciudad de México"
      "from_iata": string|null,              // "MEX"
      "to_ciudad": string,                   // "París"
      "to_iata": string|null,                // "CDG"
      "fecha": "YYYY-MM-DD"|null,
      "hora_salida": string|null,            // "21:15"
      "hora_llegada": string|null,
      "duracion": string|null,
      "escalas": string|null,                // "directo" o "1 escala en LHR"
      "clase": string|null,                  // "Económica", "Premium", "Business"
      "pasajeros": number|null,              // cuántos pax en este boleto
      "precio_total_mxn": number|null,       // precio total del tramo (todos los pax)
      "precio_por_persona_mxn": number|null,
      "confirmacion": string|null,           // PNR
      "notas": string|null
    }
  ],
  "hoteles": [
    {
      "nombre": string,                      // "Hotel Indigo Gran Vía"
      "ciudad": string,                      // "Madrid"
      "barrio": string|null,
      "direccion": string|null,
      "check_in": "YYYY-MM-DD"|null,
      "check_out": "YYYY-MM-DD"|null,
      "noches": number|null,
      "tipo": string|null,                   // "Hotel boutique", "Departamento de amigo", "Resort"
      "rating": number|null,                 // 9.0
      "precio_por_noche_mxn": number|null,
      "precio_total_mxn": number|null,       // 0 si es gratis
      "costo_cero": boolean,                 // true si es gratis/AMOR/casa de amigo/$0
      "motivo_gratis": string|null,          // "Departamento de un amigo en París"
      "confirmacion": string|null,
      "notas": string|null
    }
  ],
  "cruceros": [
    {
      "naviera": string|null,                // "Celestyal"
      "barco": string|null,                  // "Discovery"
      "puertos": string[],                   // ["Lavrio", "Mykonos", "Kusadasi/Éfeso", "Patmos", "Santorini", "Lavrio"]
      "fecha_embarque": "YYYY-MM-DD"|null,
      "fecha_desembarque": "YYYY-MM-DD"|null,
      "noches": number|null,
      "camarote": string|null,               // "Oceanview", "Balcón"
      "precio_total_mxn": number|null,
      "confirmacion": string|null,
      "estado": string|null,                 // "PAGADO", "PENDIENTE"
      "notas": string|null
    }
  ],
  "transfers": [
    { "tipo": string, "from": string, "to": string, "fecha": "YYYY-MM-DD"|null, "hora": string|null, "proveedor": string|null, "precio_mxn": number|null, "confirmacion": string|null }
  ],
  "itinerario": [
    {
      "dia": number,
      "fecha": "YYYY-MM-DD"|null,
      "ciudad": string,                      // ciudad principal de ese día
      "titulo": string,                      // título corto del día tal como aparece
      "mañana": string,                      // copia literal de lo que dice para la mañana
      "tarde": string,
      "noche": string,
      "tips": string|null,                   // tips del día tal como aparecen
      "reservas": string[]                   // ["Air France AF0179 X2VZDD", "Hotel Indigo"]
    }
  ],
  "pendientes": string[],                    // tareas pendientes ("Reservar crucero", "Comprar tickets Acrópolis")
  "contactos": [
    { "nombre": string, "valor": string }    // todos los códigos/teléfonos del final del PDF
  ],
  "notas_generales": string                  // resumen libre de tips, equipaje, recordatorios
}

Conversiones de moneda aproximadas (úsalas SOLO si el PDF da EUR/USD): USD≈18 MXN, EUR≈20 MXN.

Antes de responder, autocheck: ¿incluiste TODOS los vuelos del PDF? ¿TODOS los hoteles (incluso los gratis)? ¿El crucero con todos sus puertos? ¿Cada día del itinerario? Si falta algo, regresa al PDF antes de cerrar el JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });


  // --- Auth gate: require valid Supabase JWT to prevent API quota abuse ---
  try {
    const __authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!__authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const __serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const __token = __authHeader.replace(/^Bearer\s+/i, "");
    if (!__serviceKey || __token !== __serviceKey) {
      const __apikey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const __ures = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { Authorization: __authHeader, apikey: __apikey },
    });
    if (!__ures.ok) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // --- end auth gate ---
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
      { type: "text", text: `Fecha actual: ${new Date().toISOString().slice(0, 10)}.\n\nExtrae el viaje COMPLETO de estos archivos exactamente como aparece. Recuerda: hospedajes gratis/AMOR/CASA SÍ se incluyen (con costo_cero=true). Crucero con TODOS sus puertos. Itinerario día por día. NO inventes nada.${extra ? `\n\nContexto extra del usuario: ${extra}` : ""}` },
    ];
    for (const f of files) {
      const dataUrl = `data:${f.mime};base64,${f.data_base64}`;
      userParts.push({ type: "image_url", image_url: { url: dataUrl } });
    }

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 110000);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        // gemini-2.5-flash: 3-5x más rápido que pro en extracción multimodal,
        // mantiene calidad alta en JSON estructurado de PDFs/imágenes.
        model: "google/gemini-2.5-flash",
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

    // Mapea a schema interno
    const vuelos_json = (parsed.vuelos ?? []).map((v: any) => ({
      aerolinea: v.aerolinea ?? "—",
      numero_vuelo: v.numero_vuelo ?? null,
      tier: v.clase ?? "Reservado",
      clase: v.clase ?? null,
      from: v.from_ciudad ?? v.from ?? null,
      from_iata: v.from_iata ?? null,
      to: v.to_ciudad ?? v.to ?? null,
      to_iata: v.to_iata ?? null,
      ciudad: v.to_ciudad ?? v.to ?? null,
      fecha: v.fecha ?? null,
      hora_salida: v.hora_salida ?? null,
      hora_llegada: v.hora_llegada ?? null,
      duracion: v.duracion ?? "—",
      escalas: v.escalas ?? "directo",
      pasajeros: v.pasajeros ?? null,
      precio_total: v.precio_total_mxn ?? null,
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
      precio_por_noche: h.costo_cero ? 0 : (h.precio_por_noche_mxn ?? null),
      precio_total: h.costo_cero ? 0 : (h.precio_total_mxn ?? null),
      costo_cero: !!h.costo_cero,
      motivo_gratis: h.motivo_gratis ?? null,
      por_que: h.costo_cero
        ? (h.motivo_gratis ?? "Hospedaje sin costo — quedándote con amigo/familiar")
        : (h.notas ?? "Reservado en tu PDF"),
      confirmacion: h.confirmacion ?? null,
      desde_pdf: true,
    }));

    const cruceros_json = (parsed.cruceros ?? []).map((c: any) => ({
      naviera: c.naviera ?? null,
      barco: c.barco ?? null,
      puertos: c.puertos ?? [],
      fecha_embarque: c.fecha_embarque ?? null,
      fecha_desembarque: c.fecha_desembarque ?? null,
      noches: c.noches ?? null,
      camarote: c.camarote ?? null,
      precio_total: c.precio_total_mxn ?? null,
      confirmacion: c.confirmacion ?? null,
      estado: c.estado ?? null,
      notas: c.notas ?? null,
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
      presupuesto_pagado_mxn: parsed.presupuesto_pagado_mxn ?? null,
      vuelos_json,
      hospedaje_json,
      cruceros_json,
      transfers: parsed.transfers ?? [],
      itinerario: parsed.itinerario ?? [],
      pendientes: parsed.pendientes ?? [],
      contactos: parsed.contactos ?? [],
      notas_generales: parsed.notas_generales ?? "",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
