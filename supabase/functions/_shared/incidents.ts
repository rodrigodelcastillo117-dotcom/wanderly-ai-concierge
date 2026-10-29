// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// INCIDENTES · núcleo (interfaz estable para los demás módulos: monitor de vuelos, contacto con proveedores,
// operador IA, canales). Migración: 20261029080000_incidentes.sql. Puro: sin Deno (se prueba con Vitest).
//
// Modelo: un incidente es una fila de concierge_requests (type 'incidente') + su estado operativo en
// `incidents` + su bitácora en `incident_events`. Todo cambio pasa por funciones de la base (service_role):
// estas funciones solo las envuelven con tipos claros y validan lo que mandan.
//
// Quién lo atiende: nace asignado al OPERADOR IA ('iato_ops') si está prendido y vivo (latido reciente); si
// no, va directo al equipo humano. El vigilante (cron) lo escala a humanos si no hay avance a tiempo
// (crítico 10 min, alto 30 min; configurable en incident_config), si el operador pide a una persona
// (assignIncident 'humano') o si el operador deja de dar latido.
//
// Reglas que hace cumplir la base (no se pueden saltar desde aquí):
//   · createIncident es idempotente por idempotencyKey: misma clave → mismo caso (created=false).
//   · setIncidentStatus('resuelto') de alguien que NO es el equipo humano con nota NO cierra: deja el caso
//     "esperando_confirmacion" y se le pregunta al usuario "¿quedó resuelto?".
//   · setIncidentStatus('no_se_pudo') del operador IA no cierra: escala a una persona.
//   · Si el usuario dice que no quedó resuelto, se reabre y sube de severidad (my_incident_confirm).
//
// Uso típico (monitor de vuelos):
//   const r = await createIncident(admin, { userId, categoria: "vuelo_cancelado", origen: "monitor_vuelos",
//     descripcion: "AM 401 MEX-MAD del 29-oct cancelado", idempotencyKey: `vuelo:AM401:2026-10-29:cancelado:${userId}`,
//     refs: { vuelo: "AM401", fecha_vuelo: "2026-10-29" }, contexto: { zonaHoraria: "Europe/Madrid" } });
//   if (r.ok) await deliverIncidentAlerts(alertDeps, { requestId: r.id });   // _shared/incident-alerts.ts
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
import {
  type ComplaintSubtype, type Expectation, type IncidentCategory, type IncidentOrigin, type IncidentSeverity, isComplaintSubtype,
  isExpectation, isIncidentCategory, isSentiment, isSeverity, isValidTimeZone, type Sentiment,
} from "./incident-labels.ts";
import { incidentSeverityFor, type SeverityContext } from "./incident-rules.ts";

export * from "./incident-labels.ts";
export { classifyIncident, detectIncident, type AiIncidentClassifier, type IncidentDetection, normalizeText } from "./incident-detect.ts";
export {
  EMERGENCY_LINE, incidentGuide, incidentReplyText, incidentSeverityFor, type IncidentGuide, promiseText, type SeverityContext,
} from "./incident-rules.ts";

// ───────────────────────────── tipos ─────────────────────────────

/** Cliente de Supabase con la llave de servicio (o cualquier cosa con .rpc). */
export interface IncidentDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type IncidentAssignee = "iato_ops" | "humano";
export type IncidentChannel = "app" | "iato" | "email" | "push" | "telegram" | "whatsapp" | "sms" | "voz" | "mesa";
export type IncidentActor = "usuario" | "iato" | "iato_ops" | "equipo" | "sistema" | "proveedor" | "monitor";
export type IncidentEventKind =
  | "creado" | "mensaje" | "accion" | "decision" | "estado" | "asignacion" | "escalamiento" | "alerta" | "nota"
  | "siguiente_paso" | "confirmacion" | "sistema";

export type IncidentLocation = {
  ciudad?: string | null;
  pais?: string | null;
  direccion?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Zona IANA, p. ej. "Europe/Paris": da la hora local del viajero en los avisos. */
  zona_horaria?: string | null;
};
export type IncidentRefs = {
  vuelo?: string | null;
  /** 5–8 letras/números. */
  pnr?: string | null;
  proveedor?: string | null;
  reserva?: string | null;
  /** YYYY-MM-DD */
  fecha_vuelo?: string | null;
};

export interface CreateIncidentInput {
  userId: string;
  categoria: IncidentCategory;
  /** Qué pasó (3–4000). */
  descripcion: string;
  origen: IncidentOrigin;
  /** Si no se da: incidentSeverityFor(categoria, contexto) (reglas deterministas). */
  severidad?: IncidentSeverity | null;
  contexto?: SeverityContext | null;
  /** Misma clave = mismo caso. Úsala SIEMPRE desde monitores ("vuelo:AM401:2026-10-29:cancelado:<user>"). 8–200. */
  idempotencyKey?: string | null;
  tripId?: string | null;
  ubicacion?: IncidentLocation | null;
  refs?: IncidentRefs | null;
  /** Nombre del procedimiento que sigue el operador (p. ej. "vuelo_cancelado_v1"). */
  playbook?: string | null;
  /** Lo que ya se hizo antes de abrir el caso (Iato dio la guía, el monitor consultó el estado…). */
  accionesTomadas?: string[] | null;
  /** Obligatorio si categoria = 'queja'. */
  queja?: { subtipo: ComplaintSubtype } | null;
  sentimiento?: Sentiment | null;
  expectativa?: Expectation | null;
  idioma?: "es" | "en" | "otro" | null;
  textoOriginal?: string | null;
  /** Siguiente paso visible al usuario (si no, uno por defecto). La hora la pone la base según severidad. */
  siguientePaso?: string | null;
  /** Lo que ya se le contestó a la persona (guía inmediata): queda en la bitácora como primera respuesta. */
  respuestaInmediata?: string | null;
  canal?: "app" | "iato" | "email" | "telegram" | "whatsapp" | "sms" | "voz" | null;
}

export type CreateIncidentResult =
  | {
    ok: true;
    /** false = ya existía con esa idempotencyKey (no se creó otro). */
    created: boolean;
    id: string;
    folio: string;
    severity: IncidentSeverity;
    assignee: IncidentAssignee;
    escalationLevel: number;
    /** Aviso al equipo que quedó en cola (repártelo con deliverIncidentAlerts). */
    alertId: string | null;
    nextStep: string | null;
    nextStepDueAt: string | null;
    tripId: string | null;
    /** Por qué esa severidad (vacío si vino dada). */
    motivos: string[];
  }
  | { ok: false; code: IncidentErrorCode; detail?: string };

export type IncidentErrorCode =
  | "USER_REQUIRED" | "USER_NOT_FOUND" | "INVALID_CATEGORY" | "INVALID_SEVERITY" | "DESCRIPTION_REQUIRED" | "IDEM_CONFLICT"
  | "RATE_LIMITED" | "INVALID" | "NOT_FOUND" | "BAD_STATUS" | "BAD_ACTOR" | "ILLEGAL_TRANSITION" | "REASON_REQUIRED"
  | "HUMAN_REQUIRED" | "BAD_ASSIGNEE" | "NOT_ADMIN" | "CLOSED" | "TAKEN_BY_HUMAN" | "TEXT_REQUIRED" | "BAD_DUE" | "DB_ERROR";

export interface IncidentEventInput {
  kind: IncidentEventKind;
  actor: IncidentActor;
  body?: string | null;
  data?: Record<string, unknown> | null;
  channel?: IncidentChannel | null;
  direction?: "entrante" | "saliente" | "interno" | null;
  /** Con quién (usuario, "Hotel Riu", un correo…). */
  counterpart?: string | null;
  /** Lo ve el usuario en "Mis solicitudes" (solo mensajes). */
  visibleToUser?: boolean;
  delivery?: "enviado" | "fallido" | "apagado" | "recibido" | null;
  /** Idempotencia por incidente (p. ej. el id del mensaje del proveedor). */
  dedupeKey?: string | null;
  providerMessageId?: string | null;
  actorId?: string | null;
}

export type IncidentStatusTarget = "en_proceso" | "resuelto" | "no_se_pudo" | "cancelado";
export type SetStatusResult =
  | { ok: true; status: "en_proceso" | "esperando_confirmacion" | "resuelto" | "rechazado" | "cancelado" | "escalado"; closed: boolean; code?: "HUMAN_REQUIRED" }
  | { ok: false; code: IncidentErrorCode; detail?: string };

export type AssignTarget =
  | { to: "humano"; reason: string; adminId?: string | null }
  | { to: "iato_ops"; reason?: string | null };

// ───────────────────────────── utilidades ─────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s.length ? s : null;
};
const clipMultiline = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r/g, "").trim().slice(0, max);
  return s.length ? s : null;
};
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const strip = <T extends Record<string, unknown>>(o: T): T | null => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
  return Object.keys(out).length ? out : null;
};
const dbFail = (error: { message: string } | null, data: unknown): { ok: false; code: IncidentErrorCode; detail?: string } => {
  const d = data as { code?: string; detail?: string } | null;
  return { ok: false, code: (d?.code as IncidentErrorCode) ?? "DB_ERROR", detail: error?.message?.slice(0, 200) ?? d?.detail };
};

/** Ubicación limpia (lo que no cumple el formato se descarta en vez de rechazar el caso). */
export function cleanLocation(u: IncidentLocation | null | undefined): IncidentLocation | null {
  if (!u || typeof u !== "object") return null;
  return strip({
    ciudad: clip(u.ciudad, 120), pais: clip(u.pais, 80), direccion: clip(u.direccion, 200),
    lat: num(u.lat, -90, 90), lng: num(u.lng, -180, 180),
    zona_horaria: isValidTimeZone(u.zona_horaria) ? u.zona_horaria : null,
  });
}

export function cleanRefs(r: IncidentRefs | null | undefined): IncidentRefs | null {
  if (!r || typeof r !== "object") return null;
  const pnr = typeof r.pnr === "string" ? r.pnr.replace(/\s+/g, "").toUpperCase() : null;
  const vuelo = typeof r.vuelo === "string" ? r.vuelo.replace(/\s+/g, "").toUpperCase().slice(0, 12) : null;
  return strip({
    vuelo: vuelo || null,
    pnr: pnr && /^[A-Z0-9]{5,8}$/.test(pnr) ? pnr : null,
    proveedor: clip(r.proveedor, 120), reserva: clip(r.reserva, 120),
    fecha_vuelo: typeof r.fecha_vuelo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha_vuelo) ? r.fecha_vuelo : null,
  });
}

/** Folio corto del caso (igual que la mesa y el correo). */
export const incidentFolio = (id: string) => String(id ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();

// ───────────────────────────── API ─────────────────────────────

/** Crea (o recupera, con la misma idempotencyKey) un incidente. Calcula la severidad si no viene. */
export async function createIncident(admin: IncidentDb, input: CreateIncidentInput): Promise<CreateIncidentResult> {
  if (!input || !UUID.test(String(input.userId ?? ""))) return { ok: false, code: "USER_REQUIRED" };
  if (!isIncidentCategory(input.categoria)) return { ok: false, code: "INVALID_CATEGORY" };
  const descripcion = clipMultiline(input.descripcion, 4000);
  if (!descripcion || descripcion.length < 3) return { ok: false, code: "DESCRIPTION_REQUIRED" };
  const ubicacion = cleanLocation(input.ubicacion);
  let motivos: string[] = [];
  let severidad = input.severidad && isSeverity(input.severidad) ? input.severidad : null;
  if (!severidad) {
    const s = incidentSeverityFor(input.categoria, {
      texto: descripcion, zonaHoraria: ubicacion?.zona_horaria ?? null, sentimiento: input.sentimiento ?? null,
      quejaSubtipo: input.queja?.subtipo ?? null, expectativa: input.expectativa ?? null, ...(input.contexto ?? {}),
    });
    severidad = s.severidad; motivos = s.motivos;
  }
  const queja = input.categoria === "queja"
    ? { subtipo: isComplaintSubtype(input.queja?.subtipo) ? input.queja!.subtipo : "servicio_iatos" }
    : input.queja && isComplaintSubtype(input.queja.subtipo) ? { subtipo: input.queja.subtipo } : null;
  const acciones = (input.accionesTomadas ?? []).map((a) => clip(a, 300)).filter((a): a is string => !!a).slice(0, 30);
  const key = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length >= 8 ? input.idempotencyKey.trim().slice(0, 200) : null;

  const payload = {
    user_id: input.userId,
    categoria: input.categoria,
    severidad,
    descripcion,
    origen: input.origen,
    idem_key: key,
    trip_id: input.tripId && UUID.test(input.tripId) ? input.tripId : null,
    ubicacion,
    refs: cleanRefs(input.refs),
    playbook: clip(input.playbook, 60),
    acciones_tomadas: acciones.length ? acciones : null,
    queja,
    sentimiento: isSentiment(input.sentimiento) ? input.sentimiento : null,
    expectativa: isExpectation(input.expectativa) ? input.expectativa : null,
    idioma: input.idioma === "es" || input.idioma === "en" || input.idioma === "otro" ? input.idioma : null,
    texto_original: clipMultiline(input.textoOriginal, 4000),
    siguiente_paso: clip(input.siguientePaso, 300),
    respuesta_inmediata: clipMultiline(input.respuestaInmediata, 4000),
    canal: input.canal ?? null,
  };
  const { data, error } = await admin.rpc("incident_create", { _input: payload });
  const r = data as Record<string, unknown> | null;
  if (error || !r?.ok) return dbFail(error, r);
  return {
    ok: true,
    created: r.created === true,
    id: String(r.id),
    folio: String(r.folio ?? incidentFolio(String(r.id))),
    severity: (isSeverity(r.severity) ? r.severity : severidad) as IncidentSeverity,
    assignee: r.assignee === "iato_ops" ? "iato_ops" : "humano",
    escalationLevel: Number(r.escalation_level ?? 0),
    alertId: typeof r.alert_id === "string" ? r.alert_id : null,
    nextStep: typeof r.next_step === "string" ? r.next_step : null,
    nextStepDueAt: typeof r.next_step_due_at === "string" ? r.next_step_due_at : null,
    tripId: typeof r.trip_id === "string" ? r.trip_id : null,
    motivos: r.created === true ? motivos : [],
  };
}

/** Una línea en la bitácora (mensaje enviado/recibido por un canal, acción, decisión, nota…). */
export async function addIncidentEvent(admin: IncidentDb, incidentId: string, ev: IncidentEventInput):
  Promise<{ ok: true; eventId: number | null; duplicate: boolean } | { ok: false; code: IncidentErrorCode; detail?: string }> {
  if (!UUID.test(String(incidentId ?? ""))) return { ok: false, code: "NOT_FOUND" };
  const { data, error } = await admin.rpc("incident_add_event", {
    _id: incidentId,
    _ev: {
      kind: ev.kind, actor: ev.actor, body: clipMultiline(ev.body, 4000), data: ev.data ?? {}, channel: ev.channel ?? null,
      direction: ev.direction ?? null, counterpart: clip(ev.counterpart, 200), visible_to_user: ev.visibleToUser === true,
      delivery: ev.delivery ?? null, dedupe_key: clip(ev.dedupeKey, 200), provider_message_id: clip(ev.providerMessageId, 200),
      actor_id: ev.actorId && UUID.test(ev.actorId) ? ev.actorId : null,
    },
  });
  const r = data as { ok?: boolean; event_id?: number | null; duplicate?: boolean } | null;
  if (error || !r?.ok) return dbFail(error, r);
  return { ok: true, eventId: r.event_id ?? null, duplicate: r.duplicate === true };
}

/**
 * Cambia el estado. OJO: 'resuelto' solo cierra si lo hace el equipo con nota (≥ 10); desde el operador IA
 * deja el caso "esperando_confirmacion" (se le pregunta al usuario). 'no_se_pudo' del operador → escala.
 */
export async function setIncidentStatus(admin: IncidentDb, incidentId: string, status: IncidentStatusTarget,
  opts: { actor?: "iato_ops" | "equipo" | "sistema" | "usuario"; note?: string | null; actorId?: string | null } = {}): Promise<SetStatusResult> {
  const { data, error } = await admin.rpc("incident_set_status", {
    _id: incidentId, _status: status, _actor: opts.actor ?? "iato_ops", _note: clipMultiline(opts.note, 2000),
    _actor_id: opts.actorId && UUID.test(opts.actorId) ? opts.actorId : null,
  });
  const r = data as { ok?: boolean; status?: string; closed?: boolean; code?: string } | null;
  if (error || !r?.ok) return dbFail(error, r);
  return { ok: true, status: r.status as Extract<SetStatusResult, { ok: true }>["status"], closed: r.closed === true,
    ...(r.code === "HUMAN_REQUIRED" ? { code: "HUMAN_REQUIRED" as const } : {}) };
}

/** Pide a una persona (escala y avisa) o lo devuelve al operador IA (solo si nadie del equipo lo tomó). */
export async function assignIncident(admin: IncidentDb, incidentId: string, target: AssignTarget, actor: "iato_ops" | "equipo" | "sistema" = "iato_ops"):
  Promise<{ ok: true; assignee: IncidentAssignee; alertId: string | null; escalationLevel: number | null } | { ok: false; code: IncidentErrorCode; detail?: string }> {
  const { data, error } = await admin.rpc("incident_assign", {
    _id: incidentId, _assignee: target.to, _reason: clip(target.reason ?? null, 500),
    _admin_id: target.to === "humano" && target.adminId && UUID.test(target.adminId) ? target.adminId : null, _actor: actor,
  });
  const r = data as { ok?: boolean; assignee?: string; alert_id?: string; escalation_level?: number } | null;
  if (error || !r?.ok) return dbFail(error, r);
  return { ok: true, assignee: r.assignee === "iato_ops" ? "iato_ops" : "humano", alertId: r.alert_id ?? null, escalationLevel: r.escalation_level ?? null };
}

/** Siguiente paso visible al usuario con su hora prometida (si vence sin avance, el vigilante avisa). */
export async function setIncidentNextStep(admin: IncidentDb, incidentId: string, text: string, dueAt: Date | string,
  actor: "iato_ops" | "equipo" | "sistema" = "iato_ops"): Promise<{ ok: true } | { ok: false; code: IncidentErrorCode; detail?: string }> {
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) return { ok: false, code: "BAD_DUE" };
  const { data, error } = await admin.rpc("incident_set_next_step", { _id: incidentId, _text: clip(text, 300), _due: due.toISOString(), _actor: actor });
  const r = data as { ok?: boolean } | null;
  if (error || !r?.ok) return dbFail(error, r);
  return { ok: true };
}

/** Latido del operador IA: mientras lo mande (cada ≤ 5 min), los casos nuevos son suyos primero. */
export async function operatorHeartbeat(admin: IncidentDb): Promise<boolean> {
  const { data, error } = await admin.rpc("incident_operator_heartbeat", {});
  return !error && !!(data as { ok?: boolean } | null)?.ok;
}

/** Corre el vigilante (lo llama la función incidentes-vigilante). `now` solo para pruebas. */
export async function watchIncidents(admin: IncidentDb, now?: Date): Promise<{ ok: boolean; escalated: number; alerts: number; operatorAlive: boolean; pendingAlerts: number; error?: string }> {
  const { data, error } = await admin.rpc("incident_watch", now ? { _now: now.toISOString() } : {});
  const r = (data ?? {}) as { ok?: boolean; escalated?: number; alerts?: number; operator_alive?: boolean; pending_alerts?: number };
  if (error) return { ok: false, escalated: 0, alerts: 0, operatorAlive: false, pendingAlerts: 0, error: error.message.slice(0, 200) };
  return { ok: r.ok === true, escalated: r.escalated ?? 0, alerts: r.alerts ?? 0, operatorAlive: r.operator_alive === true, pendingAlerts: r.pending_alerts ?? 0 };
}

/**
 * Mensaje que llegó por un canal (webhook de Telegram/WhatsApp/SMS/voz/correo) → bitácora del incidente.
 * Idempotente por providerMessageId. Si nadie le contesta a tiempo, el vigilante avisa al equipo.
 */
export async function ingestInboundMessage(admin: IncidentDb, incidentId: string, msg: {
  channel: Exclude<IncidentChannel, "mesa" | "push">; from: string; text: string; providerMessageId: string; fromUser?: boolean; data?: Record<string, unknown>;
}) {
  return addIncidentEvent(admin, incidentId, {
    kind: "mensaje", actor: msg.fromUser === false ? "proveedor" : "usuario", channel: msg.channel, direction: "entrante",
    counterpart: msg.from, body: msg.text, visibleToUser: msg.fromUser !== false, delivery: "recibido",
    dedupeKey: `in:${msg.channel}:${msg.providerMessageId}`, providerMessageId: msg.providerMessageId, data: msg.data ?? {},
  });
}
