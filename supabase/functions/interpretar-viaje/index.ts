// interpretar-viaje — intérprete de viaje completo. Convierte el texto libre del viajero ("Arabia Saudita,
// un crucero, Cape Town y el regreso por Londres…") en la estructura de _shared/tripSpec.ts: origen,
// paradas en orden (país/región → ciudades base PROPUESTAS), tramos con modo (vuelo, tren, coche, ferry,
// crucero), regreso por otra ciudad, fechas, viajeros, preferencias, reservas y preguntas concretas para
// lo ambiguo. NO genera ni guarda el viaje: la persona revisa "Entendí…" y confirma; ese paso es el que
// usa una búsqueda de su plan (logistics-plan o analizar-viaje).
//
// Mismo modelo y proveedor que parsear-viaje (Gemini Flash vigente vía _shared/ai.ts, con el gateway de
// Lovable de respaldo). Costo en ai_usage_log. La salida del modelo se valida (validateTripSpec): fechas
// ISO, sin precios, naviera solo si está en el texto, paradas no escritas marcadas como sugerencia y
// cobertura completa (nada de lo escrito se descarta en silencio).
//
// POST { texto, contexto?: { origen, fecha_salida, fecha_regreso, viajeros } }
//   200 { ok: true, spec, texto_recortado_para_ia: boolean }
//   400 { ok: false, error }  ·  422 { ok: false, code: "respuesta_invalida" }  ·  503 { ok: false, code: "sin_ia" }
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { aiFetchDetailed } from "../_shared/ai.ts";
import { logUsage } from "../_shared/serpRuntime.ts";
import { usageFromChat } from "../_shared/usage.ts";
import { MAX_SPEC_TEXT, tripSpecRequestBody, validateTripSpec } from "../_shared/tripSpec.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  const rl = await enforceRateLimit(req, "interpretar-viaje", user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const body = await req.json().catch(() => null);
  const texto = typeof body?.texto === "string" ? body.texto.trim() : "";
  if (texto.length < 2) return json({ ok: false, error: "Describe tu viaje." }, 400);
  const c = body?.contexto ?? {};
  const ctx = {
    hoy: new Date().toISOString().slice(0, 10),
    origen: typeof c.origen === "string" ? c.origen.slice(0, 80) : null,
    fecha_salida: typeof c.fecha_salida === "string" && ISO.test(c.fecha_salida) ? c.fecha_salida : null,
    fecha_regreso: typeof c.fecha_regreso === "string" && ISO.test(c.fecha_regreso) ? c.fecha_regreso : null,
    viajeros: Number.isInteger(c.viajeros) && c.viajeros >= 1 && c.viajeros <= 20 ? c.viajeros : null,
  };

  if (!Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) {
    return json({ ok: false, code: "sin_ia", message: "El intérprete no está disponible ahora. Revisa y corrige el resumen a mano." }, 503);
  }

  try {
    const { res, provider, model } = await aiFetchDetailed({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY") ?? ""}`, "Lovable-API-Key": Deno.env.get("LOVABLE_API_KEY") ?? "" },
      body: JSON.stringify(tripSpecRequestBody(texto, ctx)),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) {
      console.warn("interpretar-viaje: IA", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return json({ ok: false, code: "respuesta_invalida", message: "No pudimos interpretar tu viaje ahora. Revisa y corrige el resumen a mano." }, 502);
    }
    const data = await res.json();
    await logUsage({ user_id: user.id, function: "interpretar-viaje", provider, model, ...(usageFromChat(data) ?? {}) });
    const checked = validateTripSpec(data?.choices?.[0]?.message?.content ?? "", texto, { origen: ctx.origen, viajeros: ctx.viajeros });
    if (!checked.ok) return json({ ok: false, code: "respuesta_invalida", message: "No pudimos interpretar tu viaje. Revisa y corrige el resumen a mano." }, 422);
    const spec = checked.spec;
    // Fechas del formulario si el texto no las trae (se dicen como elegidas, no supuestas).
    if (!spec.fecha_salida && ctx.fecha_salida) { spec.fecha_salida = ctx.fecha_salida; spec.fechas_expresas = true; }
    if (!spec.fecha_regreso && ctx.fecha_regreso && (!spec.fecha_salida || ctx.fecha_regreso > spec.fecha_salida)) spec.fecha_regreso = ctx.fecha_regreso;
    return json({ ok: true, spec, texto_recortado_para_ia: texto.length > MAX_SPEC_TEXT });
  } catch (e) {
    console.warn("interpretar-viaje:", (e as Error)?.message);
    return json({ ok: false, code: "respuesta_invalida", message: "No pudimos interpretar tu viaje ahora. Revisa y corrige el resumen a mano." }, 502);
  }
});
