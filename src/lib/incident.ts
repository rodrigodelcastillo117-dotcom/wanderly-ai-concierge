// Incidentes (lado de la app): "Tengo un problema" (función incidente), "¿quedó resuelto?" y mensajes del
// viajero (RPC my_incident_*), y las acciones de la mesa para incidentes (admin_incident_*; el correo y el push
// los manda ops-desk). La severidad, la guía y el aviso al equipo los decide el servidor.
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionErrors";
import { newIdemKey } from "../../supabase/functions/_shared/idempotency.ts";
import {
  categoryLabel, FORM_CATEGORIES, INCIDENT_CATEGORY_LABEL, INCIDENT_SEVERITY_LABEL, type IncidentCategory, type IncidentSeverity,
} from "../../supabase/functions/_shared/incident-labels.ts";

export { categoryLabel, FORM_CATEGORIES, INCIDENT_CATEGORY_LABEL, INCIDENT_SEVERITY_LABEL, newIdemKey, type IncidentCategory, type IncidentSeverity };

export const INCIDENT_TEXT_MAX = 2000;

export type IncidentDraft = {
  categoria: IncidentCategory | null;
  descripcion: string;
  tripId: string | null;
  compartirUbicacion: boolean;
};

export type IncidentLocationInput = { lat: number; lng: number } | null;

/** Zona horaria del teléfono (para que el equipo vea la hora local de la persona). */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function draftProblem(d: IncidentDraft): string | null {
  if (!d.categoria) return "Elige qué tipo de problema es.";
  if (d.descripcion.trim().length < 3) return "Cuéntanos qué pasó (al menos unas palabras).";
  if (d.descripcion.trim().length > INCIDENT_TEXT_MAX) return `Máximo ${INCIDENT_TEXT_MAX} caracteres.`;
  return null;
}

export type IncidentSent = {
  ok: true; id: string; folio: string; categoriaLabel: string; severidad: IncidentSeverity;
  ahora: string[]; emergencia: string | null; equipo: string; siguientePaso: string | null; siguientePasoHora: string | null; teamNotified: boolean;
};
export type IncidentSendResult = IncidentSent | { ok: false; kind: "offline" | "rate_limited" | "invalid" | "session" | "error"; message: string };

const OFFLINE = "Estás sin conexión: tu caso no se envió y sigue aquí escrito. Si es una emergencia, llama al número de emergencias (911 en México, Estados Unidos y Canadá; 112 en la Unión Europea).";
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Envía el caso. `idemKey` se conserva entre reintentos del MISMO envío: no se duplica. */
export async function sendIncident(d: IncidentDraft, loc: IncidentLocationInput, idemKey: string): Promise<IncidentSendResult> {
  if (isOffline()) return { ok: false, kind: "offline", message: OFFLINE };
  const tz = deviceTimeZone();
  let data: unknown, error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke("incidente", {
      body: {
        categoria: d.categoria, descripcion: d.descripcion.trim(), trip_id: d.tripId,
        ubicacion: loc || tz ? { lat: loc?.lat ?? null, lng: loc?.lng ?? null, zona_horaria: tz } : null,
        idempotency_key: idemKey,
      },
    }));
  } catch (e) {
    error = e;
  }
  if (error) {
    const info = await readFunctionError(error, "No pudimos abrir tu caso. Inténtalo de nuevo o escríbenos a hola@traveliatos.life.");
    const name = (error as { name?: string })?.name;
    if (isOffline() || (name === "FunctionsFetchError" && info.status === null)) return { ok: false, kind: "offline", message: OFFLINE };
    if (info.status === 401) return { ok: false, kind: "session", message: info.message };
    if (info.status === 429) return { ok: false, kind: "rate_limited", message: info.message };
    if (info.status === 400) return { ok: false, kind: "invalid", message: info.message };
    return { ok: false, kind: "error", message: info.message };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  const guia = (r.guia ?? {}) as { ahora?: string[]; emergencia?: string | null; equipo?: string };
  if (r.ok !== true || typeof r.folio !== "string") return { ok: false, kind: "error", message: "No pudimos abrir tu caso. Inténtalo de nuevo." };
  return {
    ok: true, id: String(r.id), folio: r.folio, categoriaLabel: String(r.categoria_label ?? ""), severidad: r.severidad as IncidentSeverity,
    ahora: Array.isArray(guia.ahora) ? guia.ahora : [], emergencia: guia.emergencia ?? null, equipo: guia.equipo ?? "",
    siguientePaso: (r.siguiente_paso as string) ?? null, siguientePasoHora: (r.siguiente_paso_hora as string) ?? null, teamNotified: r.team_notified === true,
  };
}

/** "a más tardar a las 21:50" en la hora del teléfono. */
export function promisedTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

type RpcOk = { ok: true; data: Record<string, unknown> } | { ok: false; message: string; code?: string };
async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcOk> {
  try {
    const { data, error } = await supabase.rpc(fn as any, args as any);
    if (error) return { ok: false, message: /42501|administradores/.test(`${error.code} ${error.message}`) ? "Acceso solo para administradores." : "No se pudo guardar. Intenta de nuevo.", code: error.code };
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok === false) return { ok: false, code: String(r.code ?? ""), message: INCIDENT_ERROR[String(r.code)] ?? "No se pudo completar." };
    return { ok: true, data: r };
  } catch {
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

const INCIDENT_ERROR: Record<string, string> = {
  RESOLUTION_NOTE_REQUIRED: "Escribe la nota de resolución (al menos 10 caracteres): el viajero la verá.",
  ILLEGAL_TRANSITION: "Ese cambio ya no aplica. Actualiza la lista.",
  NOT_FOUND: "Ya no existe o ya se cerró. Actualiza la lista.",
  MESSAGE_REQUIRED: "Escribe tu mensaje.",
  RATE_LIMITED: "Enviaste muchos mensajes seguidos; espera un momento.",
  TOO_OLD: "Este caso se cerró hace más de 7 días. Abre uno nuevo con «Tengo un problema».",
  CLOSED: "Este caso ya está cerrado.",
};

// ───────── viajero ─────────
export const confirmIncident = (id: string, resolved: boolean, comment?: string | null) =>
  rpc("my_incident_confirm", { _id: id, _resolved: resolved, _comment: comment?.trim() || null });
/** El viajero escribe en su caso. Además despierta al Operador IATOS (si está apagado, no hace nada; si falla, el
 * vigilante lo recoge en ≤ 2 min): no se espera su respuesta. */
export async function messageIncident(id: string, text: string): Promise<RpcOk> {
  const r = await rpc("my_incident_message", { _id: id, _text: text.trim() });
  if (r.ok) void supabase.functions.invoke("operador", { body: { incident_id: id } }).catch(() => undefined);
  return r;
}

// ───────── mesa ─────────
export const takeIncident = (id: string) => rpc("admin_incident_take", { _id: id });

/** Escalar: sube un nivel y reparte el aviso ya (al respaldo incluido). */
export async function escalateIncident(id: string, note?: string | null): Promise<RpcOk & { sent?: number }> {
  const r = await rpc("admin_incident_escalate", { _id: id, _note: note?.trim() || null });
  if (!r.ok) return r;
  const { data } = await supabase.functions.invoke("ops-desk", { body: { incident_id: id } }).catch(() => ({ data: null }));
  return { ...r, sent: Number((data as { sent?: number } | null)?.sent ?? 0) };
}

/** Marcar resuelto con nota (obligatoria): el viajero la ve en la app y por correo (ops-desk). */
export async function resolveIncident(id: string, note: string, evidence?: string | null): Promise<RpcOk & { email?: string }> {
  const r = await rpc("admin_incident_resolve", { _id: id, _note: note.trim(), _evidence: evidence?.trim() || null });
  if (!r.ok) return r;
  let email = "pendiente";
  const replyId = r.data.reply_id;
  if (typeof replyId === "string") {
    const { data, error } = await supabase.functions.invoke("ops-desk", { body: { reply_id: replyId } }).catch((e) => ({ data: null, error: e }));
    email = error ? "pendiente" : String((data as { email_status?: string } | null)?.email_status ?? "pendiente");
  }
  return { ...r, email };
}

export type IncidentLogEvent = { id: number; at: string; kind: string; actor: string; by?: { name?: string | null; email?: string | null } | null;
  channel?: string | null; direction?: string | null; counterpart?: string | null; body?: string | null; delivery?: string | null; data?: Record<string, unknown> | null };

/** Resumen del Operador IA a partir de la bitácora (acciones, gasto, si pasó a una persona y lo último que hizo). */
export type OperatorSummary = { acciones: number; gastoUsd: number; escalado: boolean; motivo: string | null; ultima: string | null; herramientas: string[] };
export function operatorSummary(events: IncidentLogEvent[]): OperatorSummary | null {
  const op = events.filter((e) => e.actor === "iato_ops");
  if (!op.length) return null;
  let gasto = 0;
  const herramientas: string[] = [];
  let escalado = false;
  let motivo: string | null = null;
  for (const e of op) {
    const d = (e.data?.operador ?? null) as { herramienta?: string; gasto_usd?: number; escalado?: boolean; motivo?: string } | null;
    if (!d) continue;
    if (typeof d.gasto_usd === "number") gasto = Math.max(gasto, d.gasto_usd);
    if (d.herramienta && e.kind !== "mensaje") herramientas.push(d.herramienta);
    if (d.escalado || d.herramienta === "pedir_humano") { escalado = true; motivo = d.motivo ?? motivo ?? "El operador pidió a una persona"; }
  }
  const ultima = [...op].reverse().find((e) => e.kind === "accion" || e.kind === "decision")?.body ?? null;
  return { acciones: herramientas.length, gastoUsd: Math.round(gasto * 1000) / 1000, escalado, motivo, ultima, herramientas };
}

/** Nombre en español de cada herramienta del operador (para la bitácora de la Mesa). */
export const OPERATOR_TOOL_LABEL: Record<string, string> = {
  ver_viaje: "Revisó el viaje (con permiso)", pedir_permiso: "Pidió permiso al viajero", revisar_derechos_vuelo: "Revisó derechos del pasajero",
  revisar_derechos_servicio: "Revisó derechos del consumidor", preparar_reclamo: "Preparó el reclamo", enviar_reclamo: "Envió el reclamo",
  estado_vuelo: "Consultó el estado del vuelo", buscar_vuelos_alternativos: "Buscó vuelos alternativos", opciones_traslado: "Dio opciones de traslado",
  lugares_cercanos: "Buscó lugares cercanos", buscar_contacto_proveedor: "Buscó el contacto oficial del proveedor", escribir_proveedor: "Escribió al proveedor",
  escribir_viajero: "Escribió al viajero", prometer_seguimiento: "Prometió hora de seguimiento", pedir_humano: "Pidió a una persona", proponer_cierre: "Propuso cerrar",
};
export async function incidentLog(id: string): Promise<{ ok: true; events: IncidentLogEvent[] } | { ok: false; message: string }> {
  const r = await rpc("admin_incident_log", { _id: id });
  if (!r.ok) return { ok: false, message: (r as { message: string }).message };
  return { ok: true, events: Array.isArray(r.data.events) ? (r.data.events as IncidentLogEvent[]) : [] };
}
