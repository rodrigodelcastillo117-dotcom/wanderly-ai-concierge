// reclamos — API del motor de derechos y reclamaciones (Operador IATOS). Contrato: docs/iatos/IATOS_DERECHOS_RECLAMOS.md.
// POST (JWT del usuario) {action, ...}:
//   evaluar | evaluar_servicio            → derechos (sin red, sin base)
//   preparar | preparar_servicio          → carta + caso (NO envía)
//   confirmar_envio {id, confirm:true}    → envía con consentimiento explícito (bandera reclamos_enabled)
//   ya_lo_envie | estado | cancelar | resuelto | escalar | queja
//   ver_todo {permiso:true, alcance?}     → lectura con la sesión del usuario (RLS)
//   admin_listar | admin_ver {id}         → solo administradores (con su propia sesión)
// verify_jwt = true en config.toml (pasarela) y además todo POST valida el JWT aquí y falla cerrado.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { buildReclamosDeps } from "../_shared/derechos/runtime.ts";
import {
  cancelarReclamo, confirmarEnvio, escalarReclamo, estadoReclamos, marcarEnviadoPorUsuario, prepararReclamoServicio, prepararReclamoVuelo,
  registrarQueja, resolverReclamo,
} from "../_shared/derechos/servicio.ts";
import { evaluarVuelo } from "../_shared/derechos/motor.ts";
import { evaluarServicio } from "../_shared/derechos/servicios.ts";
import { verTodo } from "../_shared/derechos/contexto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const user = await getAuthUser(req);
    if (!user) return unauthorizedResponse(corsHeaders);
    const rl = await enforceRateLimit(req, "reclamos", user.id, { perMinute: 20, perHour: 120, ipPerMinute: 40 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body || typeof body.action !== "string") return json({ ok: false, code: "BAD_REQUEST" }, 400);
    if (body.id !== undefined && !UUID.test(String(body.id))) return json({ ok: false, code: "BAD_REQUEST" }, 400);
    const a = body.action;
    if (a === "evaluar") return json({ ok: true, evaluacion: evaluarVuelo(body.caso ?? {}) });
    if (a === "evaluar_servicio") return json({ ok: true, evaluacion: evaluarServicio(body.caso ?? {}) });
    // Lecturas con la sesión del usuario (RLS): ver_todo y operador.
    if (a === "ver_todo" || a === "admin_listar" || a === "admin_ver") {
      const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
      });
      if (a === "ver_todo") return json(await verTodo(userDb as never, user.id, { permiso: body.permiso === true, alcance: body.alcance, trip_id: body.trip_id }));
      const r = a === "admin_listar" ? await userDb.rpc("admin_claims_list", { _status: body.estado ?? null, _limit: 100 }) : await userDb.rpc("admin_claim_view", { _id: body.id });
      return r.error ? json({ ok: false, code: "FORBIDDEN" }, 403) : json({ ok: true, data: r.data });
    }
    const deps = buildReclamosDeps({ origen: "usuario" });
    const r = a === "preparar" ? await prepararReclamoVuelo(deps, user.id, body as never)
      : a === "preparar_servicio" ? await prepararReclamoServicio(deps, user.id, body as never)
      : a === "confirmar_envio" ? await confirmarEnvio(deps, user.id, body)
      : a === "ya_lo_envie" ? await marcarEnviadoPorUsuario(deps, user.id, body)
      : a === "estado" ? await estadoReclamos(deps, user.id, body)
      : a === "cancelar" ? await cancelarReclamo(deps, user.id, body)
      : a === "resuelto" ? await resolverReclamo(deps, user.id, body)
      : a === "escalar" ? await escalarReclamo(deps, user.id, body)
      : a === "queja" ? await registrarQueja(deps, user.id, body)
      : { status: 400, body: { ok: false, code: "UNKNOWN_ACTION" } };
    return json(r.body, r.status);
  } catch (e) {
    console.error("reclamos error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL", message: "No se pudo completar. No se envió nada." }, 500);
  }
});
