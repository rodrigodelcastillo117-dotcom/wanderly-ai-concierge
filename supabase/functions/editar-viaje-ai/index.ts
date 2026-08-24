// Editar viaje con AI: el usuario describe en lenguaje natural los cambios
// y la IA reescribe/reorganiza/recotiza el viaje completo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getUsdMxnRate, getEurMxnRate } from "../_shared/fx.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

function buildSystem(fxUsd: number, fxEur: number) {
  return `Eres un concierge de viajes premium. Recibes un viaje YA cotizado (en JSON) e instrucciones en lenguaje natural del usuario para modificarlo: reorganizar días, cambiar ciudades, ajustar presupuesto, agregar/quitar tours, cambiar hospedaje, cambiar fechas, recotizar, etc.

Devuelves el viaje COMPLETO ACTUALIZADO en JSON con la MISMA ESTRUCTURA que recibiste. Conserva los campos no afectados por la instrucción. Recalcula desglose_presupuesto y total_estimado de forma coherente.

REGLAS:
- Todos los precios en MXN. Tipo de cambio DEL DÍA (úsalo exactamente, no inventes otro): 1 USD = ${fxUsd.toFixed(2)} MXN, 1 EUR = ${fxEur.toFixed(2)} MXN.
- En vuelos_json devuelve 3 opciones (ahorro/equilibrio/premium) por ciudad si es multi-destino, o 3 totales si es single.
- Mantén nombres reales de aerolíneas, hoteles, restaurantes y barrios.
- analisis_ai: reescribe un párrafo breve mencionando los cambios aplicados.
- NO inventes IDs ni campos nuevos. Solo cambia el contenido pedido.
- total_estimado DEBE ser exactamente la suma de los valores de desglose_presupuesto. Nunca devuelvas 0 si hay ítems cotizados.
- Responde SOLO con un objeto JSON válido, sin markdown, sin texto extra.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Sesión inválida" }, 401);

    const __rl = await enforceRateLimit(req, "editar-viaje-ai", userData.user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
    if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

    const { trip_id, instruction } = await req.json();
    if (!trip_id || !instruction || typeof instruction !== "string") {
      return json({ error: "Faltan trip_id o instruction" }, 400);
    }

    const { data: trip, error: tripErr } = await supabase
      .from("trips").select("*").eq("id", trip_id).eq("user_id", userData.user.id).maybeSingle();
    if (tripErr || !trip) return json({ error: "Viaje no encontrado" }, 404);

    const currentSnapshot = {
      destino: trip.destino,
      pais_destino: trip.pais_destino,
      ciudad_origen: trip.ciudad_origen,
      fecha_salida: trip.fecha_salida,
      fecha_regreso: trip.fecha_regreso,
      num_viajeros: trip.num_viajeros,
      presupuesto_objetivo: trip.presupuesto_objetivo,
      total_estimado: trip.total_estimado,
      analisis_ai: trip.analisis_ai,
      desglose_presupuesto: trip.desglose_presupuesto,
      vuelos_json: trip.vuelos_json,
      hospedaje_json: trip.hospedaje_json,
      itinerario_json: trip.itinerario_json,
      restaurantes_json: trip.restaurantes_json,
      tours_json: trip.tours_json,
      tips_personalizados: trip.tips_personalizados,
    };

    const userMsg = `INSTRUCCIÓN DEL USUARIO:
"""${instruction}"""

VIAJE ACTUAL (JSON):
${JSON.stringify(currentSnapshot, null, 2)}

Devuelve el viaje completo actualizado como un único objeto JSON.`;

    const [fxUsd, fxEur] = await Promise.all([getUsdMxnRate(), getEurMxnRate()]);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: buildSystem(fxUsd, fxEur) },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI error", aiRes.status, t);
      if (aiRes.status === 429) return json({ error: "Demasiadas solicitudes, intenta en un minuto." }, 429);
      if (aiRes.status === 402) return json({ error: "Sin créditos de IA. Agrega créditos en Configuración." }, 402);
      return json({ error: "Error de IA", detail: t }, 502);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!parsed) return json({ error: "Respuesta de IA inválida" }, 502);

    // Coherencia: total_estimado SIEMPRE = suma del desglose (nunca confiar en la aritmética del modelo).
    if (parsed.desglose_presupuesto && typeof parsed.desglose_presupuesto === "object") {
      const suma = Object.values(parsed.desglose_presupuesto)
        .map((v) => Number(v) || 0)
        .reduce((a: number, b: number) => a + b, 0);
      if (suma > 0) parsed.total_estimado = Math.round(suma);
    }

    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    const allowed = [
      "destino","pais_destino","ciudad_origen","fecha_salida","fecha_regreso",
      "num_viajeros","presupuesto_objetivo","total_estimado","analisis_ai",
      "desglose_presupuesto","vuelos_json","hospedaje_json","itinerario_json",
      "restaurantes_json","tours_json","tips_personalizados",
    ];
    for (const k of allowed) if (parsed[k] !== undefined) update[k] = parsed[k];

    const { data: updated, error: updErr } = await supabase
      .from("trips").update(update).eq("id", trip_id).select().single();
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ trip: updated });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "Error" }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
