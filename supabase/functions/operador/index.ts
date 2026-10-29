// operador — el cerebro del Operador IATOS (bucle de agente con Claude: _shared/operador/bucle.ts).
// verify_jwt = false. Quién puede llamarlo:
//   · pg_cron / el vigilante / otras funciones (x-cron-secret o la llave de servicio, isAuthorizedCron):
//       {tick: true}                     → latido, trabaja los casos pendientes (operator_due) y manda los correos
//                                          programados a proveedores que ya están en su horario.
//       {incident_id, motivo}            → trabaja ese caso ahora (al crearse o al llegar un mensaje).
//   · el viajero con su sesión: {incident_id} de SU caso → lo despierta tras escribir en la app (mismo candado:
//     si ya lo trabaja otro, no pasa nada; si no hay nada nuevo, no gasta).
// Con app_flags.operador_enabled = false no hace nada (responde apagado).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { getAuthUser } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { tickOperador, trabajarCaso } from "../_shared/operador/bucle.ts";
import { buildOperadorDeps } from "../_shared/operador/runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOTIVOS = new Set(["nuevo", "mensaje", "despertado", "seguimiento", "vigilante"]);
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
/** async: responde 202 ya y trabaja en segundo plano (lo usan las funciones que despiertan al operador). */
const enFondo = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") { EdgeRuntime.waitUntil(p); return true; }
  return false;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({})) as { tick?: boolean; incident_id?: string; motivo?: string; async?: boolean };
  try {
    if (await isAuthorizedCron(req)) {
      const deps = buildOperadorDeps();
      if (body.tick) {
        const p = tickOperador(deps, { max: 5, presupuestoMs: 45_000, despacho: deps.despacho }).then((r) => {
          console.log("operador tick:", JSON.stringify({ apagado: r.apagado, casos: r.casos.map((c) => [c.resultado, c.acciones.length, c.gastoUsd]), correos: r.correos }));
          return r;
        });
        if (body.async && enFondo(p.catch((e) => console.error("operador tick error:", safeErrorMessage(e))))) return json({ ok: true, aceptado: true }, 202);
        return json(await p);
      }
      if (!UUID.test(String(body.incident_id ?? ""))) return json({ ok: false, code: "BAD_REQUEST" }, 400);
      const p = trabajarCaso(deps, String(body.incident_id), MOTIVOS.has(String(body.motivo)) ? String(body.motivo) : "despertado").then((r) => {
        console.log("operador caso:", JSON.stringify({ resultado: r.resultado, acciones: r.acciones, gasto: r.gastoUsd, escalado: r.escalado }));
        return r;
      });
      if (body.async && enFondo(p.catch((e) => console.error("operador caso error:", safeErrorMessage(e))))) return json({ ok: true, aceptado: true }, 202);
      return json(await p);
    }
    // El viajero despierta SU caso (después de escribir en la app).
    const user = await getAuthUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const rl = await enforceRateLimit(req, "operador", user.id, { perMinute: 6, perHour: 60, ipPerMinute: 20 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
    if (!UUID.test(String(body.incident_id ?? ""))) return json({ ok: false, code: "BAD_REQUEST" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: own } = await admin.from("concierge_requests").select("id").eq("id", body.incident_id).eq("user_id", user.id).eq("type", "incidente").maybeSingle();
    if (!own) return json({ ok: false, code: "NOT_FOUND" }, 404);
    const r = await trabajarCaso(buildOperadorDeps(), String(body.incident_id), "mensaje");
    return json({ ok: true, resultado: r.resultado });
  } catch (e) {
    console.error("operador error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
