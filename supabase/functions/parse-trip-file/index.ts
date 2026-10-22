// parse-trip-file — lee PDFs/imágenes con Gemini multimodal y extrae el
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetch } from "../_shared/ai.ts";
import { getEurMxnRateInfo, getUsdMxnRateInfo } from "../_shared/fx.ts";
import { currenciesUsed, moneyMeta, normalizeCurrency, readMoney, type MxnRates } from "./money.ts";
import { validateExtraction } from "./schema.ts";
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

🚨 REGLA #6 — PRECIOS: copia SOLO montos que aparecen impresos en el documento (total pagado, tarifa, impuestos incluidos si el documento da el total). Si un boleto o pase de abordar NO muestra precio, el precio es null. Nunca estimes, promedies ni completes precios.

🚨 REGLA #7 — Los archivos vienen numerados en el orden recibido (0, 1, 2…). En "documentos" di qué es cada uno y en cada vuelo/hotel/crucero pon en "archivo" el número del archivo de donde salió.

Devuelve SOLO este JSON estricto, sin markdown:

{
  "summary": string,                         // 3-5 párrafos describiendo el viaje COMPLETO tal cual
  "destino": string,                         // resumen ("París → Madrid → Atenas → Crucero Egeo")
  "destinations": string[],                  // ciudades + puertos del crucero en orden cronológico
  "ciudad_origen": string|null,
  "fecha_salida": "YYYY-MM-DD"|null,         // primer día del viaje
  "fecha_regreso": "YYYY-MM-DD"|null,        // último día
  "num_viajeros": number,                    // mínimo 1, default 2 si es claro que viajan en pareja
  "presupuesto_total": number|null,          // total del viaje TAL CUAL aparece (en moneda_original)
  "presupuesto_pagado": number|null,         // lo que ya está pagado (en moneda_original)
  "moneda_original": string|null,            // código ISO de la moneda principal del documento: "MXN", "USD", "EUR"
  "documentos": [ { "archivo": number, "tipo": "boleto"|"pase_abordar"|"hotel"|"crucero"|"transfer"|"itinerario"|"otro", "pagado": boolean|null } ],
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
      "precio_total": number|null,           // precio total del tramo (todos los pax), tal cual
      "precio_por_persona": number|null,
      "moneda": string|null,                 // "MXN", "USD", "EUR"… de ESTE precio
      "confirmacion": string|null,           // PNR
      "notas": string|null,
      "archivo": number|null                 // de qué archivo salió (0, 1, 2…)
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
      "precio_por_noche": number|null,
      "precio_total": number|null,           // 0 si es gratis
      "moneda": string|null,
      "costo_cero": boolean,                 // true si es gratis/AMOR/casa de amigo/$0
      "motivo_gratis": string|null,          // "Departamento de un amigo en París"
      "confirmacion": string|null,
      "notas": string|null,
      "archivo": number|null
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
      "precio_total": number|null,
      "moneda": string|null,
      "confirmacion": string|null,
      "estado": string|null,                 // "PAGADO", "PENDIENTE"
      "notas": string|null
    }
  ],
  "transfers": [
    { "tipo": string, "from": string, "to": string, "fecha": "YYYY-MM-DD"|null, "hora": string|null, "proveedor": string|null, "precio": number|null, "moneda": string|null, "confirmacion": string|null }
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

Montos: cópialos TAL CUAL aparecen, en su moneda original, SIN convertir, y escribe su moneda en "moneda" (código ISO: MXN, USD, EUR…). La conversión a pesos la hace el sistema con el tipo de cambio del día.

Antes de responder, autocheck: ¿incluiste TODOS los vuelos del PDF? ¿TODOS los hoteles (incluso los gratis)? ¿El crucero con todos sus puertos? ¿Cada día del itinerario? Si falta algo, regresa al PDF antes de cerrar el JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "parse-trip-file", __user.id, { perMinute: 6, perHour: 40, ipPerMinute: 20 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


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
    if (files.length > 8) {
      return new Response(JSON.stringify({ error: "Máximo 8 archivos por viaje" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const f of files) {
      if (typeof f?.data_base64 !== "string" || !/^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/.test(String(f?.mime))) {
        return new Response(JSON.stringify({ error: "Formato no admitido: sube PDF o imágenes (JPG, PNG, WEBP, HEIC)" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    files.forEach((f, i) => {
      const dataUrl = `data:${f.mime};base64,${f.data_base64}`;
      userParts.push({ type: "text", text: `Archivo ${i}${f.name ? ` (${String(f.name).slice(0, 80)})` : ""}:` });
      userParts.push({ type: "image_url", image_url: { url: dataUrl } });
    });

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 110000);

    const res = await aiFetch({
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        // Flash vigente: 3-5x más rápido que pro en extracción multimodal,
        // mantiene calidad alta en JSON estructurado de PDFs/imágenes.
        model: "google/gemini-flash-latest",
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
    const content = data?.choices?.[0]?.message?.content ?? "";
    // IATOS-064: la respuesta del modelo se valida campo por campo antes de usarla.
    const checked = validateExtraction(content);
    if (!checked.ok) {
      console.warn("parse-trip-file: respuesta inválida:", checked.error);
      return new Response(JSON.stringify({ ok: false, code: "no_legible", error: "No pudimos leer un viaje en esos archivos. Prueba con un PDF o una captura más clara." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed: any = checked.data;

    // Montos: el modelo copia el original y aquí se convierte con el tipo de cambio de _shared/fx.ts
    // (fuente y fecha). Solo se piden las tasas de las monedas que aparecen.
    const monedaDoc = normalizeCurrency(parsed.moneda_original);
    const needed = currenciesUsed(parsed);
    const rates: MxnRates = {};
    if (needed.includes("USD")) rates.USD = await getUsdMxnRateInfo();
    if (needed.includes("EUR")) rates.EUR = await getEurMxnRateInfo();
    const money = (item: any, field: string) => readMoney(item, field, monedaDoc, rates);
    const presupuestoTotal = money(parsed, "presupuesto_total");
    const presupuestoPagado = money(parsed, "presupuesto_pagado");

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
      precio_total: money(v, "precio_total").mxn,
      precio_por_persona: money(v, "precio_por_persona").mxn,
      ...moneyMeta(money(v, "precio_total").original ? money(v, "precio_total") : money(v, "precio_por_persona")),
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
      precio_por_noche: h.costo_cero ? 0 : money(h, "precio_por_noche").mxn,
      precio_total: h.costo_cero ? 0 : money(h, "precio_total").mxn,
      ...(h.costo_cero ? {} : moneyMeta(money(h, "precio_total").original ? money(h, "precio_total") : money(h, "precio_por_noche"))),
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
      precio_total: money(c, "precio_total").mxn,
      ...moneyMeta(money(c, "precio_total")),
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
      presupuesto_total_mxn: presupuestoTotal.mxn,
      presupuesto_pagado_mxn: presupuestoPagado.mxn,
      presupuesto_original: presupuestoTotal.original,
      moneda_original: monedaDoc,
      // Tasas usadas, con fuente y fecha (vacío si todo venía en MXN).
      fx: Object.keys(rates).length ? rates : null,
      vuelos_json,
      hospedaje_json,
      cruceros_json,
      transfers: (parsed.transfers ?? []).map((t: any) => {
        const m = money(t, "precio");
        return { ...t, precio_mxn: m.mxn, ...moneyMeta(m) };
      }),
      itinerario: parsed.itinerario ?? [],
      pendientes: parsed.pendientes ?? [],
      contactos: parsed.contactos ?? [],
      notas_generales: parsed.notas_generales ?? "",
      // Lo leído tal cual (montos en su moneda original, ya validado) para la vista previa de
      // "Sube un viaje que ya hiciste", y los avisos de lo que no se pudo leer.
      extraccion: parsed,
      avisos: checked.avisos,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
