// vigilancia-cron — IATOS se adelanta a los problemas: vigila vuelos (cancelación, retraso grande, cambio de puerta o
// terminal, desvío), pide reconfirmación a proveedores (con consentimiento del viajero) y manda avisos de viaje
// (check-in, documentos, clima extremo, alertas oficiales), una sola vez y a buena hora. Solo tareas programadas
// (x-cron-secret desde Vault o llave de servicio): docs/ops/programar-vigilancia.sql. Apagado con
// app_flags.vigilancia_enabled = false. La lógica vive en _shared/vigilancia/ (probada con Vitest).
//
// POST { fases?: ("vuelos" | "confirmaciones" | "avisos_viaje" | "entregar")[] }   (sin fases = todas)
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { correrVigilancia, type Fase, FASES } from "../_shared/vigilancia/runner.ts";
import { buildVigilanciaDeps } from "../_shared/vigilancia/runtime.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const fases = Array.isArray(body?.fases) ? (body.fases as unknown[]).filter((f): f is Fase => FASES.includes(f as Fase)) : FASES;
    const r = await correrVigilancia(buildVigilanciaDeps(), fases.length ? fases : FASES);
    if (r.errores.length) console.error("vigilancia-cron: errores", JSON.stringify(r.errores.slice(0, 10)));
    return json({ ok: r.errores.length === 0, ...r }, r.errores.length && !r.vuelos.revisados && !r.avisos.enviados ? 500 : 200);
  } catch (e) {
    const message = safeErrorMessage(e);
    console.error("vigilancia-cron: falló la corrida", message);
    return json({ ok: false, error: message }, 500);
  }
});
