// ai-reservations-cron — recordatorio único al restaurante y vencimientos de Reservas IA.
// verify_jwt = false: lo dispara pg_cron con el secreto de Vault y se valida con isAuthorizedCron
// (falla cerrada). Idempotente: la base solo deja un recordatorio y una transición por estado.
// Con la bandera apagada no hace nada. Lógica en _shared/ai-reservations/service.ts (runCron).
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { buildServiceDeps } from "../_shared/ai-reservations/runtime.ts";
import { runCron } from "../_shared/ai-reservations/service.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  try {
    const r = await runCron(buildServiceDeps());
    console.log("ai-reservations-cron:", JSON.stringify({ reminded: r.body.reminded, expired: r.body.expired, errors: r.body.errors ?? 0 }));
    return json(r.body, r.status);
  } catch (e) {
    console.error("ai-reservations-cron error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
