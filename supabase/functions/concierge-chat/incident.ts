// Iato y los incidentes. Lógica sin Deno (probada en src/test/incidentes*.test.ts).
//
// 1) Detección en CADA mensaje (reglas, sin IA): si la persona tiene un problema o se queja —aunque no diga
//    "queja"— se abre el caso ANTES de llamar al modelo. Así no depende de que el modelo use la herramienta,
//    ni de que haya cuota, ni de que el proveedor de IA responda: si la IA falla, se contesta igual con la
//    guía inmediata, el folio y la hora prometida.
// 2) Herramienta report_incident para lo que las reglas no vieron (el modelo la usa si nota un problema).
//    Misma clave por persona, categoría y día: la detección y la herramienta nunca abren dos casos.
import type { ToolDef } from "./toolDefs.ts";
import { detectIncident } from "../_shared/incident-detect.ts";
import { INCIDENT_CATEGORIES, isIncidentCategory } from "../_shared/incident-labels.ts";
import type { ReportIncidentInput, ReportIncidentResult } from "../_shared/incident-report.ts";
import { promiseText } from "../_shared/incident-rules.ts";

export const REPORT_INCIDENT_TOOL: ToolDef = {
  name: "report_incident",
  description:
    "Abre un CASO para que el equipo IATOS atienda un problema real del viajero: vuelo cancelado o retrasado, conexión perdida, " +
    "sobreventa, el chofer o traslado no llegó, problema con el hotel o una reserva, equipaje perdido, pasaporte o documentos perdidos, " +
    "robo, salud, seguridad, cobros o reembolsos, o una QUEJA (aunque no diga 'queja': molestia con IATOS, un proveedor, un cobro, el trato o la app). " +
    "Úsala en cuanto notes el problema; devuelve folio, guía inmediata, lo que hará el equipo y la hora prometida. " +
    "No la uses para preguntas normales (buscar, reservar, '¿mi vuelo está a tiempo?').",
  input_schema: {
    type: "object",
    properties: {
      categoria: { type: "string", enum: INCIDENT_CATEGORIES, description: "Tipo de problema" },
      descripcion: { type: "string", description: "Qué pasó, con las palabras de la persona (dónde está, qué necesita)" },
      vuelo: { type: "string", description: "Número de vuelo si aplica (ej. AF179)" },
      proveedor: { type: "string", description: "Hotel, aerolínea, chofer o lugar involucrado (opcional)" },
    },
    required: ["categoria", "descripcion"],
  },
};

export type IatoIncidentContext = {
  userId: string;
  todayISO: string;
  tz?: string | null;
  tripId?: string | null;
  coords?: { lat: number; lng: number } | null;
  place?: string | null;
};

export type IatoIncidentDeps = { report: (input: ReportIncidentInput) => Promise<ReportIncidentResult> };

const keyFor = (c: IatoIncidentContext, categoria: string) => `iato:${c.userId}:${categoria}:${c.todayISO}`;

function baseInput(c: IatoIncidentContext, descripcion: string, categoria: string | null): ReportIncidentInput {
  return {
    userId: c.userId, descripcion, categoria: isIncidentCategory(categoria) ? categoria : null, origen: "iato", canal: "iato",
    tripId: c.tripId ?? null,
    ubicacion: c.coords || c.tz || c.place ? { lat: c.coords?.lat ?? null, lng: c.coords?.lng ?? null, zona_horaria: c.tz ?? null, ciudad: c.place ?? null } : null,
  };
}

/** Detección en cada mensaje: abre (o recupera) el caso si las reglas ven un problema o una queja. */
export async function autoOpenIncident(message: string, c: IatoIncidentContext, d: IatoIncidentDeps): Promise<Extract<ReportIncidentResult, { ok: true }> | null> {
  const det = detectIncident(message);
  if (!det.detected || !det.categoria) return null;
  const r = await d.report({ ...baseInput(c, message, det.categoria), idempotencyKey: keyFor(c, det.categoria) });
  return r.ok ? r : null;
}

/** Herramienta report_incident (el modelo la llama). */
export async function runReportIncidentTool(args: Record<string, unknown>, c: IatoIncidentContext, d: IatoIncidentDeps): Promise<Record<string, unknown>> {
  const descripcion = typeof args.descripcion === "string" ? args.descripcion.slice(0, 2000) : "";
  const categoria = isIncidentCategory(args.categoria) ? args.categoria : detectIncident(descripcion).categoria ?? "otro";
  const r = await d.report({
    ...baseInput(c, descripcion, categoria), idempotencyKey: keyFor(c, categoria),
    refs: { vuelo: typeof args.vuelo === "string" ? args.vuelo : null, proveedor: typeof args.proveedor === "string" ? args.proveedor : null },
  });
  if (r.ok) return incidentToolResult(r, c.tz ?? null);
  const f = r as Extract<ReportIncidentResult, { ok: false }>;
  return { ok: false, error: f.code, mensaje: f.message };
}

/** Lo que ve el modelo del caso abierto (para que conteste con lo que se hace AHORA y con honestidad). */
export function incidentToolResult(r: Extract<ReportIncidentResult, { ok: true }>, tz: string | null): Record<string, unknown> {
  return {
    ok: true, folio: r.folio, categoria: r.categoriaLabel, severidad: r.severidad, nuevo: r.created,
    aviso_al_equipo: r.teamNotified ? "enviado" : "pendiente (se reintenta solo)",
    quien_lo_atiende: r.assignee === "iato_ops" ? "operador de IATOS (pasa a una persona si hace falta)" : "equipo humano de IATOS",
    que_hacer_ahora: r.guia.ahora, emergencia: r.guia.emergencia, lo_que_hara_el_equipo: r.guia.equipo,
    siguiente_paso: r.siguientePaso, hora_prometida: promiseText(r.siguientePasoHora, tz),
    queja: r.queja ? { subtipo: r.queja.subtipo, sentimiento: r.sentimiento, espera: r.expectativa } : null,
  };
}

/** Nota para el modelo cuando la detección ya abrió el caso en este turno. */
export function incidentPromptNote(r: Extract<ReportIncidentResult, { ok: true }>, tz: string | null): string {
  const promise = promiseText(r.siguientePasoHora, tz);
  return [
    `CASO ABIERTO (incidente, no lo vuelvas a abrir): folio ${r.folio} · ${r.categoriaLabel} · severidad ${r.severidad}` +
      ` · aviso al equipo ${r.teamNotified ? "enviado" : "pendiente (se reintenta solo)"}${r.assignee === "iato_ops" ? " · lo atiende el operador de IATOS" : ""}.`,
    "Responde en el idioma de la persona y en este orden: 1) qué hacer AHORA MISMO (usa estos pasos y adáptalos a lo que contó):",
    ...r.guia.ahora.map((x) => `   - ${x}`),
    r.guia.emergencia ? `   - ${r.guia.emergencia}` : "",
    `2) lo que hará el equipo, sin prometer de más: ${r.guia.equipo}`,
    `3) el folio ${r.folio} y ${promise ? `que le escribimos ${promise}` : "que le escribimos aquí y por correo"}.`,
    r.queja ? `Es una queja (${r.queja.subtipo}; ánimo: ${r.sentimiento}; espera: ${r.expectativa ?? "que se resuelva"}): reconoce lo que pasó sin excusas ni culparla, y no ofrezcas reembolsos ni compensaciones que no estén confirmados.` : "",
    "Si te falta un dato clave (dónde está, número de vuelo o de reserva), pídelo en una sola pregunta al final.",
  ].filter(Boolean).join("\n");
}

/** Respuesta sin modelo (si la IA falla o no hay cuota): la guía, el folio y la hora prometida. */
export function incidentDirectReply(r: Extract<ReportIncidentResult, { ok: true }>): string {
  return r.texto.trim();
}
