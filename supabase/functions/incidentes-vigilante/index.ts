// incidentes-vigilante — tarea programada (cada 2 min) que nunca deja un caso perdido: escala lo que no tuvo
// avance o que nadie tomó (crítico 10 min, alto 30 min; incident_config), avisa si un mensaje del viajero no
// tiene respuesta o si venció la hora prometida, pasa a humanos lo del operador IA si deja de dar latido y
// reparte (y reintenta) los avisos pendientes. verify_jwt = false: lo dispara pg_cron con el secreto de Vault
// y se valida con isAuthorizedCron (falla cerrada). Responde también qué canales están prendidos o apagados.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { runIncidentWatch } from "../_shared/incident-alerts.ts";
import { incidentAlertDeps } from "../_shared/incident-runtime.ts";
import { despertarOperadorTick } from "../_shared/operador/runtime.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const r = await runIncidentWatch(incidentAlertDeps(admin));
    console.log("incidentes-vigilante:", JSON.stringify({ watch: r.watch, delivered: r.delivered }));
    // Operador IATOS: un tick (casos con algo nuevo, seguimientos vencidos y correos programados). Apagado → nada.
    await despertarOperadorTick();
    return json(r, r.ok ? 200 : 500);
  } catch (e) {
    console.error("incidentes-vigilante error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
