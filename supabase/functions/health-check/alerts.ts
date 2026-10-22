// Decisiones del chequeo diario que no dependen de Deno (probadas en src/test/healthAlerts.test.ts):
// salud de las tareas programadas, cuándo mandar correo, a quién y con qué contenido.
import type { CheckResult } from "./checks.ts";
import { redactSecrets } from "../_shared/redact.ts";

export const JOBS_CHECK_NAME = "Tareas programadas (pg_cron)";
/** Las tres tareas que crea docs/ops/programar-tareas.sql. */
export const EXPECTED_JOBS = ["flight-watch-every-15-min", "price-watch-twice-daily", "health-check-daily"];
/** Sin cambios en lo que falla, el correo se repite como recordatorio una vez por semana. */
export const REMINDER_DAYS = 7;

const DAY_MIN = 1440;

const parseList = (field: string): number[] | null => {
  if (!/^\d+(,\d+)*$/.test(field)) return null;
  return field.split(",").map(Number).sort((a, b) => a - b);
};

/** Mayor separación (cíclica) entre valores de una lista, ej. horas 3,15 → 12. */
const maxGap = (values: number[], cycle: number) => {
  if (values.length <= 1) return cycle;
  let gap = 0;
  for (let i = 0; i < values.length; i++) {
    const next = i + 1 < values.length ? values[i + 1] : values[0] + cycle;
    gap = Math.max(gap, next - values[i]);
  }
  return gap;
};

/** Periodo máximo entre corridas de una expresión cron de 5 campos, en minutos (aprox. y conservador). */
export function cronPeriodMinutes(expr: string): number {
  const parts = (expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return DAY_MIN;
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== "*" || dom !== "*") return 31 * DAY_MIN;
  if (dow !== "*") return 7 * DAY_MIN;
  if (hour === "*") {
    const step = /^\*\/(\d+)$/.exec(min);
    if (step) return Math.max(1, Number(step[1]));
    if (min === "*") return 1;
    const mins = parseList(min);
    return mins ? maxGap(mins, 60) : 60;
  }
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (hourStep) return Math.max(1, Number(hourStep[1])) * 60;
  const hours = parseList(hour);
  return hours ? maxGap(hours, 24) * 60 : DAY_MIN;
}

export type CronJobRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  last_start: string | null;
  last_status: string | null;
  last_message?: string | null;
  failed_24h?: number;
};

export type CronHealth = {
  available: boolean;
  jobs: CronJobRow[];
  http: { window_hours: number; total: number; failed: number; last_failure: string | null } | null;
};

const hoursAgo = (ms: number) => {
  const h = Math.round(ms / 3_600_000);
  return h < 1 ? "menos de 1 h" : `${h} h`;
};

/**
 * Revisa que cada tarea haya corrido en las últimas 2× su periodo y que la última haya terminado
 * bien, y que las llamadas HTTP de pg_net a las funciones respondan 2xx.
 */
export function jobHealth(payload: CronHealth | null, rpcError: string | null, now: Date): CheckResult {
  const base = { name: JOBS_CHECK_NAME, ms: 0 };
  if (rpcError || !payload) {
    return { ...base, ok: true, warn: "No se pudo revisar el historial de tareas (falta la migración de cron_health)", detail: redactSecrets(rpcError) };
  }
  if (!payload.available) return { ...base, ok: true, warn: "pg_cron no está disponible: no se pudo revisar si las tareas corren" };

  const problems: string[] = [];
  const warnings: string[] = [];
  const byName = new Map(payload.jobs.map((j) => [j.jobname, j]));
  const missing = EXPECTED_JOBS.filter((n) => !byName.get(n)?.active);
  if (missing.length) problems.push(`No están programadas o están pausadas: ${missing.join(", ")}`);

  for (const j of payload.jobs) {
    if (!j.active) continue;
    const period = cronPeriodMinutes(j.schedule);
    const last = j.last_start ? Date.parse(j.last_start) : NaN;
    if (!Number.isFinite(last)) problems.push(`${j.jobname} nunca ha corrido`);
    else if (now.getTime() - last > 2 * period * 60_000) problems.push(`${j.jobname} no corre desde hace ${hoursAgo(now.getTime() - last)}`);
    else if (j.last_status === "failed") problems.push(`${j.jobname} falló en su última corrida${j.last_message ? ` (${redactSecrets(j.last_message, 80)})` : ""}`);
  }

  const http = payload.http;
  if (http && http.failed > 0) {
    const text = `${http.failed} de ${http.total} llamadas a funciones programadas fallaron en ${Math.round(http.window_hours)} h${http.last_failure ? ` (última: ${redactSecrets(http.last_failure, 60)})` : ""}`;
    if (http.total >= 2 && http.failed === http.total) problems.push(text);
    else warnings.push(text);
  }

  if (problems.length) return { ...base, ok: false, detail: redactSecrets([...problems, ...warnings].join(" · "), 400) };
  if (warnings.length) return { ...base, ok: true, warn: redactSecrets(warnings.join(" · "), 300) };
  return { ...base, ok: true, detail: `${payload.jobs.length} tareas al día` };
}

/** Qué está mal, sin el detalle que cambia a diario (ej. "1,234 búsquedas"): nombre + nivel. */
export function alertSignature(results: Pick<CheckResult, "name" | "ok" | "warn">[]): string {
  return results
    .filter((r) => !r.ok || r.warn)
    .map((r) => `${r.name}:${r.ok ? "warn" : "fail"}`)
    .sort()
    .join("|");
}

export type PreviousRun = { ran_at: string; results: Pick<CheckResult, "name" | "ok" | "warn">[] | null; email_status: string | null };

export type EmailDecision = { send: true; reason: "changed" | "reminder" | "first" } | { send: false; status: "not_needed" | "skipped_unchanged" };

/**
 * Manda correo solo si algo necesita atención y (a) cambió el conjunto de fallas/avisos respecto al
 * chequeo anterior o al último correo enviado, o (b) pasó una semana desde el último correo.
 * `previous` va del más reciente al más viejo y no incluye la corrida actual.
 */
export function shouldEmail(current: CheckResult[], previous: PreviousRun[], now: Date): EmailDecision {
  const sig = alertSignature(current);
  if (!sig) return { send: false, status: "not_needed" };
  const lastSent = previous.find((p) => p.email_status === "sent" || p.email_status === "partial");
  if (!lastSent) return { send: true, reason: "first" };
  const prev = previous[0];
  if (alertSignature(prev?.results ?? []) !== sig || alertSignature(lastSent.results ?? []) !== sig) {
    return { send: true, reason: "changed" };
  }
  const days = (now.getTime() - Date.parse(lastSent.ran_at)) / 86_400_000;
  if (days >= REMINDER_DAYS) return { send: true, reason: "reminder" };
  return { send: false, status: "skipped_unchanged" };
}

/**
 * Destinatarios. Mientras el dominio no esté verificado en Resend, solo se entrega al correo de la
 * cuenta de Resend: HEALTH_ALERT_EMAIL (uno o varios separados por coma) manda solo ahí. Si no está,
 * se usa el correo de cada administrador.
 */
export function alertRecipients(envValue: string | undefined, adminEmails: string[]): string[] {
  const valid = (e: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e);
  const fromEnv = (envValue ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(valid);
  const list = fromEnv.length ? fromEnv : adminEmails.map((e) => e.trim().toLowerCase()).filter(valid);
  return [...new Set(list)];
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Asunto y cuerpo (HTML interno, sin el layout) del correo de alerta. Todo texto va escapado y limpio. */
export function alertEmail(results: CheckResult[], reason: "changed" | "reminder" | "first") {
  const ok = results.every((r) => r.ok);
  const rows = results
    .filter((r) => !r.ok || r.warn)
    .map((r) => `<li><strong>${esc(r.name)}:</strong> ${esc(redactSecrets(r.ok ? r.warn : `falla — ${r.detail ?? "sin detalle"}`, 300))}</li>`)
    .join("");
  const subject = `${reason === "reminder" ? "Recordatorio — " : ""}${ok ? "IATOS: hay algo que atender" : "IATOS: un servicio está fallando"}`;
  const intro = reason === "reminder"
    ? "Sigue pendiente lo mismo que hace una semana:"
    : "El chequeo diario encontró lo siguiente:";
  const html = `<p>${intro}</p><ul>${rows}</ul><p>El detalle está en Perfil → Panel de métricas. Solo te volveremos a escribir si esto cambia, o en una semana si sigue igual.</p>`;
  return { subject, html };
}

/** Resume el resultado de los envíos en lo que se guarda en health_checks.email_status. */
export function emailOutcome(sends: { ok: boolean; error?: string }[]): { status: "sent" | "partial" | "failed" | "no_recipient"; error: string | null } {
  if (sends.length === 0) return { status: "no_recipient", error: null };
  const failed = sends.filter((s) => !s.ok);
  const error = failed.length ? redactSecrets(failed.map((f) => f.error ?? "error").join("; "), 300) ?? "error" : null;
  if (failed.length === 0) return { status: "sent", error: null };
  return { status: failed.length === sends.length ? "failed" : "partial", error };
}
