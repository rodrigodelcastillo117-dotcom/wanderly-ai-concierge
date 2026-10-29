// reclamos-cron — seguimiento automático: un recordatorio al proveedor si no responde en su plazo y, al
// vencer el plazo de escalamiento, el reclamo pasa a "escalable" (el usuario decide si se envía la queja).
// verify_jwt = false: lo dispara pg_cron con el secreto de Vault; se valida con isAuthorizedCron (falla cerrada).
// Con reclamos_enabled apagada no sale ningún recordatorio (la base lo impide).
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { buildReclamosDeps } from "../_shared/derechos/runtime.ts";
import { runSeguimiento } from "../_shared/derechos/servicio.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  try {
    const r = await runSeguimiento(buildReclamosDeps());
    console.log("reclamos-cron:", JSON.stringify(r.body));
    return json(r.body, r.status);
  } catch (e) {
    console.error("reclamos-cron error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
