// incidente (lógica sin Deno, probada en src/test/incidentes*.test.ts): valida lo que manda el formulario
// "Tengo un problema" y lo pasa a reportIncident (_shared/incident-report.ts). Nunca confía en el cliente: la
// severidad la calcula el servidor por reglas y el viaje solo se liga si es de la persona (lo revisa la base).
import { isComplaintSubtype, isExpectation, isIncidentCategory } from "../_shared/incident-labels.ts";
import type { ReportIncidentInput } from "../_shared/incident-report.ts";
import { idemKeyFrom } from "../_shared/idempotency.ts";

/** Límite por persona: 3 por minuto, 20 por hora (y 10 por minuto por red). */
export const INCIDENT_LIMITS = { perMinute: 3, perHour: 20, ipPerMinute: 10 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type ParsedIncidentBody = Omit<ReportIncidentInput, "userId" | "origen" | "canal">;

export function parseIncidentBody(raw: unknown): { ok: true; value: ParsedIncidentBody } | { ok: false; code: string; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "INVALID_REQUEST", message: "Solicitud inválida." };
  const b = raw as Record<string, unknown>;
  const descripcion = typeof b.descripcion === "string" ? b.descripcion.replace(/\r/g, "").trim().slice(0, 2000) : "";
  if (descripcion.length < 3) return { ok: false, code: "DESCRIPTION_REQUIRED", message: "Cuéntanos qué pasó (al menos unas palabras)." };
  if (b.categoria != null && !isIncidentCategory(b.categoria)) return { ok: false, code: "INVALID_CATEGORY", message: "Elige qué tipo de problema es." };
  const u = (b.ubicacion && typeof b.ubicacion === "object" ? b.ubicacion : null) as Record<string, unknown> | null;
  const r = (b.refs && typeof b.refs === "object" ? b.refs : null) as Record<string, unknown> | null;
  const key = idemKeyFrom(b.idempotency_key);
  return {
    ok: true,
    value: {
      descripcion,
      categoria: isIncidentCategory(b.categoria) ? b.categoria : null,
      tripId: typeof b.trip_id === "string" && UUID.test(b.trip_id) ? b.trip_id : null,
      ubicacion: u ? { ciudad: s(u.ciudad, 120), pais: s(u.pais, 80), direccion: s(u.direccion, 200), lat: n(u.lat), lng: n(u.lng), zona_horaria: s(u.zona_horaria, 64) } : null,
      refs: r ? { vuelo: s(r.vuelo, 12), pnr: s(r.pnr, 8), proveedor: s(r.proveedor, 120), reserva: s(r.reserva, 120), fecha_vuelo: s(r.fecha_vuelo, 10) } : null,
      quejaSubtipo: isComplaintSubtype(b.queja_subtipo) ? b.queja_subtipo : null,
      expectativa: isExpectation(b.expectativa) ? b.expectativa : null,
      vulnerable: b.vulnerable === true,
      idempotencyKey: key,
    },
  };
}
