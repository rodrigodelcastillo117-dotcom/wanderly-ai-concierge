// incidente — "Tengo un problema" desde la app. Con sesión (verify_jwt + getAuthUser). Abre el caso en la Mesa
// de operaciones (concierge_requests type 'incidente', migración 20261029080000_incidentes), avisa al equipo de
// guardia de inmediato (correo + push; canales extra si están prendidos) y responde con la guía inmediata,
// el folio y la hora en que le escribimos. La lógica vive en _shared/incident-report.ts y core.ts.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { redactPii } from "../_shared/redact.ts";
import { reportIncident } from "../_shared/incident-report.ts";
import { deliverIncidentAlerts } from "../_shared/incident-alerts.ts";
import { incidentAlertDeps } from "../_shared/incident-runtime.ts";
import { despertarOperador } from "../_shared/operador/runtime.ts";
import { INCIDENT_LIMITS, parseIncidentBody } from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  const rl = await enforceRateLimit(req, "incidente", user.id, INCIDENT_LIMITS);
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  try {
    const parsed = parseIncidentBody(await req.json().catch(() => null));
    if (!parsed.ok) return json({ ok: false, code: parsed.code, message: parsed.message }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const deps = incidentAlertDeps(admin);
    const r = await reportIncident({
      db: deps.admin,
      deliver: (id) => deliverIncidentAlerts(deps, { requestId: id }),
      warn: (...a) => console.warn(...a.map((x) => redactPii(String(x)))),
    }, { ...parsed.value, userId: user.id, origen: "usuario", canal: "app",
      idempotencyKey: parsed.value.idempotencyKey ? `app:${user.id.slice(0, 8)}:${parsed.value.idempotencyKey}` : null });
    if (!r.ok) return json(r, r.code === "RATE_LIMITED" ? 429 : r.code === "DESCRIPTION_REQUIRED" || r.code === "INVALID" ? 400 : 500);
    // Operador IATOS: si el caso nació del operador IA, se despierta ya (apagado → no hace nada).
    if (r.created && r.assignee === "iato_ops") await despertarOperador(r.id, "nuevo");
    return json({
      ok: true, id: r.id, folio: r.folio, created: r.created, categoria: r.categoria, categoria_label: r.categoriaLabel, severidad: r.severidad,
      guia: r.guia, texto: r.texto, siguiente_paso: r.siguientePaso, siguiente_paso_hora: r.siguientePasoHora, team_notified: r.teamNotified,
    });
  } catch (e) {
    console.error("incidente error", redactPii((e as Error)?.message ?? e));
    return json({ ok: false, code: "INTERNAL_ERROR", message: "No pudimos abrir tu caso. Inténtalo de nuevo o escríbenos a hola@traveliatos.life." }, 500);
  }
});
