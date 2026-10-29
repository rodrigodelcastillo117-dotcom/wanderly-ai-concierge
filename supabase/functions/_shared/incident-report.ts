// Incidentes: "Tengo un problema" de punta a punta (formulario de la app, Iato, canales). Puro (sin Deno).
//   1. Entiende el mensaje (reglas; categoría elegida o detectada; queja, sentimiento y expectativa).
//   2. Severidad por reglas (incidentSeverityFor) y guía inmediata honesta (incidentGuide).
//   3. Crea el caso (idempotente) con la guía como primera respuesta en la bitácora.
//   4. Avisa al equipo YA (deliverIncidentAlerts del caso); si falla, el vigilante reintenta.
//   5. Devuelve el texto para la persona: qué hacer ahora, qué hará el equipo, folio y hora prometida.
import { detectIncident } from "./incident-detect.ts";
import {
  categoryLabel, type ComplaintSubtype, type Expectation, type IncidentCategory, type IncidentSeverity, isComplaintSubtype, isExpectation,
  isIncidentCategory,
} from "./incident-labels.ts";
import { guideText, incidentGuide, type IncidentGuide, incidentReplyText, incidentSeverityFor } from "./incident-rules.ts";
import { cleanLocation, createIncident, type IncidentDb, type IncidentErrorCode, type IncidentLocation, type IncidentRefs } from "./incidents.ts";

export type ReportIncidentInput = {
  userId: string;
  /** Lo que escribió la persona. */
  descripcion: string;
  /** Lo que eligió en el formulario (si no, se detecta del texto; si no se detecta, 'otro'). */
  categoria?: IncidentCategory | null;
  origen: "usuario" | "iato" | "canal";
  canal: "app" | "iato" | "email" | "telegram" | "whatsapp" | "sms" | "voz";
  tripId?: string | null;
  ubicacion?: IncidentLocation | null;
  refs?: IncidentRefs | null;
  quejaSubtipo?: ComplaintSubtype | null;
  expectativa?: Expectation | null;
  vulnerable?: boolean | null;
  /** Clave del cliente (reintentos) o de Iato (una por categoría y día). */
  idempotencyKey?: string | null;
  accionesTomadas?: string[] | null;
};

export type ReportIncidentResult =
  | {
    ok: true; id: string; folio: string; created: boolean; categoria: IncidentCategory; categoriaLabel: string; severidad: IncidentSeverity;
    motivos: string[]; guia: IncidentGuide; texto: string; siguientePaso: string | null; siguientePasoHora: string | null; teamNotified: boolean;
    assignee: "iato_ops" | "humano"; queja: { subtipo: ComplaintSubtype } | null; sentimiento: string; expectativa: Expectation | null;
  }
  | { ok: false; code: IncidentErrorCode | "INVALID_REQUEST"; message: string };

export interface ReportIncidentDeps {
  db: IncidentDb;
  /** Reparte los avisos del caso (deliverIncidentAlerts con requestId). */
  deliver: (requestId: string) => Promise<{ sent: number; failed: number; claimed?: number }>;
  /** Tope de espera del aviso (la persona no espera más que esto; si tarda, sigue en segundo plano). */
  deliverTimeoutMs?: number;
  warn?: (...a: unknown[]) => void;
}

const MESSAGES: Partial<Record<IncidentErrorCode | "INVALID_REQUEST", string>> = {
  RATE_LIMITED: "Ya abriste varios casos en poco tiempo. Si es urgente, escribe en el caso que ya tienes abierto en Mis solicitudes.",
  DESCRIPTION_REQUIRED: "Cuéntanos qué pasó (al menos unas palabras).",
  INVALID_REQUEST: "Revisa lo que escribiste e inténtalo de nuevo.",
  INVALID: "Revisa lo que escribiste e inténtalo de nuevo.",
};

export async function reportIncident(d: ReportIncidentDeps, input: ReportIncidentInput): Promise<ReportIncidentResult> {
  const text = String(input.descripcion ?? "").trim();
  if (text.length < 3) return { ok: false, code: "DESCRIPTION_REQUIRED", message: MESSAGES.DESCRIPTION_REQUIRED! };
  const forced = isIncidentCategory(input.categoria) ? input.categoria : null;
  const det = detectIncident(text, { forceCategory: forced });
  const categoria: IncidentCategory = forced ?? det.categoria ?? "otro";
  const quejaSub = isComplaintSubtype(input.quejaSubtipo) ? input.quejaSubtipo : det.queja?.subtipo ?? null;
  const queja = categoria === "queja" ? { subtipo: quejaSub ?? "servicio_iatos" } : quejaSub && det.queja ? { subtipo: quejaSub } : null;
  const expectativa = isExpectation(input.expectativa) ? input.expectativa : det.expectativa;
  const ubicacion = cleanLocation(input.ubicacion);
  const sev = incidentSeverityFor(categoria, {
    texto: text, zonaHoraria: ubicacion?.zona_horaria ?? null, vulnerable: input.vulnerable ?? null, sentimiento: det.sentimiento,
    quejaSubtipo: queja?.subtipo ?? null, expectativa,
  });
  const guia = incidentGuide(categoria, { expectativa, severidad: sev.severidad });

  const r = await createIncident(d.db, {
    userId: input.userId, categoria, descripcion: text, origen: input.origen, severidad: sev.severidad, idempotencyKey: input.idempotencyKey ?? null,
    tripId: input.tripId ?? null, ubicacion, refs: input.refs ?? null, queja, sentimiento: det.sentimiento, expectativa,
    idioma: det.idioma, textoOriginal: text, canal: input.canal,
    accionesTomadas: [...(input.accionesTomadas ?? []), "Iato le dio la guía inmediata (qué hacer ahora)"],
    respuestaInmediata: guideText(guia),
  });
  if (!r.ok) { const f = r as Extract<typeof r, { ok: false }>; return { ok: false, code: f.code, message: MESSAGES[f.code] ?? "No pudimos abrir tu caso. Inténtalo de nuevo o escríbenos a hola@traveliatos.life." }; }

  // Aviso al equipo ya (con tope de espera). Si no sale, queda en cola y el vigilante lo reintenta.
  let teamNotified = !r.created || (r.assignee === "iato_ops" && !r.alertId);
  if (r.created && r.alertId) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const out = await Promise.race([
        d.deliver(r.id),
        new Promise<null>((res) => { timer = setTimeout(() => res(null), d.deliverTimeoutMs ?? 8000); }),
      ]);
      teamNotified = !!out && out.sent > 0;
    } catch (e) {
      d.warn?.("incidente: aviso al equipo pendiente", e instanceof Error ? e.message : e);
      teamNotified = false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const byOperator = r.assignee === "iato_ops" && !r.alertId;
  return {
    ok: true, id: r.id, folio: r.folio, created: r.created, categoria, categoriaLabel: categoryLabel(categoria), severidad: r.severity,
    motivos: sev.motivos, guia,
    texto: incidentReplyText(guia, { folio: r.folio, dueAt: r.nextStepDueAt, tz: ubicacion?.zona_horaria ?? null, teamNotified, severidad: r.severity, byOperator }),
    siguientePaso: r.nextStep, siguientePasoHora: r.nextStepDueAt, teamNotified, assignee: r.assignee, queja, sentimiento: det.sentimiento, expectativa,
  };
}
