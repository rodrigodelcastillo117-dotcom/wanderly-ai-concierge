// Hora de consulta ya escrita en la zona del usuario (auditoría 10, ronda 2, N2). El clima decía
// "consultado hoy 28 de octubre, 21:18 hora CDMX" cuando eran las 20:18 (02:18 UTC; CDMX es UTC−6 todo
// el año): la herramienta entregaba solo UTC y el modelo convertía mal. Ahora cada resultado con
// consultado_at / consulted_at lleva también `consultado_local`, ya formateado, y el modelo lo copia.
// Sin Deno (Vitest).

const TZ_LABEL: Record<string, string> = {
  "America/Mexico_City": "hora CDMX", "America/Monterrey": "hora de Monterrey", "America/Cancun": "hora de Cancún",
  "America/Tijuana": "hora de Tijuana", "America/Bogota": "hora de Bogotá", "America/New_York": "hora de Nueva York",
  "America/Los_Angeles": "hora de Los Ángeles", "Europe/Madrid": "hora de Madrid", "Europe/Paris": "hora de París",
  "Europe/Rome": "hora de Roma", "Europe/Lisbon": "hora de Lisboa", "Europe/London": "hora de Londres", "Asia/Tokyo": "hora de Tokio",
};

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export const tzLabel = (tz: string) => TZ_LABEL[tz] ?? `hora de ${String(tz.split("/").pop() ?? tz).replace(/_/g, " ")}`;

/** "28 oct 2026, 20:18 (hora CDMX)". null si la fecha o la zona no sirven. */
export function formatLocalStamp(iso: unknown, tz: unknown): string | null {
  if (typeof iso !== "string" || !Number.isFinite(Date.parse(iso)) || !validTz(tz)) return null;
  const d = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("es-MX", {
    timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const month = String(parts.month ?? "").replace(".", "");
  return `${parts.day} ${month} ${parts.year}, ${parts.hour}:${parts.minute} (${tzLabel(tz)})`;
}

const STAMP_KEYS = ["consultado_at", "consulted_at"];

/**
 * Agrega `consultado_local` (y una nota para no convertir) a un resultado de herramienta que trae la
 * hora de consulta en UTC. No cambia el valor ISO (lo usan las tarjetas y la evidencia).
 */
export function withLocalStamp<T>(result: T, tz: unknown): T {
  if (!result || typeof result !== "object" || Array.isArray(result) || !validTz(tz)) return result;
  const r = result as Record<string, unknown>;
  const key = STAMP_KEYS.find((k) => typeof r[k] === "string");
  if (!key) return result;
  const local = formatLocalStamp(r[key], tz);
  if (!local) return result;
  return { ...r, consultado_local: local, nota_hora: "Para decir cuándo se consultó usa consultado_local tal cual (ya está en la hora del usuario); no conviertas consultado_at, que está en UTC." } as T;
}

const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-10-30" → "viernes 30 de octubre" (el día de la semana lo calcula el servidor, no el modelo). */
export function longDay(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? `${DIA[d.getUTCDay()]} ${d.getUTCDate()} de ${MES[d.getUTCMonth()]}` : null;
}
