// God Mode F1: estado canónico de una reserva (vista public.reservation_state_v, migración
// 20261028010000_godmode_estados) y su etiqueta honesta. Lógica pura: la usan concierge-chat (contexto y
// guardarraíl de texto) y la UI (tarjetas de solicitud). Sin Deno ni React.

export type CanonicalState =
  | "SELECTED" | "PRICE_RECHECK_REQUIRED" | "READY_TO_BOOK" | "REDIRECTED_TO_PROVIDER" | "REQUESTED"
  | "PENDING_CONFIRMATION" | "CONFIRMED" | "FAILED" | "CANCELLED" | "EXPIRED";
export type Verification = "verificado_proveedor" | "verificado_equipo" | "sin_evidencia";

export interface ReservationStateRow {
  source_table?: string | null;
  source_id?: string | null;
  trip_id?: string | null;
  title?: string | null;
  kind?: string | null;
  raw_status?: string | null;
  canonical_state?: string | null;
  verification?: string | null;
  evidence_source?: string | null;
  updated_at?: string | null;
}

/** Solo esto cuenta como reserva: CONFIRMED con evidencia del proveedor o del equipo. */
export function isVerifiedConfirmed(r: ReservationStateRow | null | undefined): boolean {
  return !!r && r.canonical_state === "CONFIRMED" && (r.verification === "verificado_proveedor" || r.verification === "verificado_equipo");
}

/** Estado de una solicitud de concierge_requests (texto de la base) → canónico, igual que la vista. */
export function requestStatusToCanonical(status: string | null | undefined, type?: string | null): CanonicalState {
  switch (String(status ?? "")) {
    case "solicitado": case "pending": return "REQUESTED";
    case "confirmado_externamente": return type === "prive_request" ? "CONFIRMED" : "PENDING_CONFIRMATION";
    case "cancelado": case "cancelled": return "CANCELLED";
    case "rechazado": case "rejected": case "failed": return "FAILED";
    case "caducado": case "expired": return "EXPIRED";
    default: return "PENDING_CONFIRMATION";
  }
}

export type StateTone = "open" | "confirmed" | "closed";

/** Etiqueta para el usuario: nunca dice "reservada" sin evidencia. */
export function reservationStateLabel(r: ReservationStateRow): { label: string; tone: StateTone } {
  const s = r.canonical_state;
  if (s === "CONFIRMED") {
    if (r.verification === "verificado_proveedor") return { label: "Confirmada por el proveedor", tone: "confirmed" };
    if (r.verification === "verificado_equipo") return { label: "Confirmada por el equipo IATOS", tone: "confirmed" };
    return { label: "Sin confirmación verificable · aún no es una reserva", tone: "open" };
  }
  if (r.raw_status === "resuelto") return { label: "Atendida por el equipo · sin confirmación de reserva", tone: "closed" };
  switch (s) {
    case "REQUESTED": return { label: "Solicitud enviada · aún no es una reserva", tone: "open" };
    case "PENDING_CONFIRMATION": return { label: "Esperando confirmación · aún no es una reserva", tone: "open" };
    case "REDIRECTED_TO_PROVIDER": return { label: "Abriste el sitio del proveedor · sin compra confirmada", tone: "open" };
    case "SELECTED": case "PRICE_RECHECK_REQUIRED": case "READY_TO_BOOK": return { label: "Elegida · aún no reservada", tone: "open" };
    case "FAILED": return { label: "No se logró · no hay reserva", tone: "closed" };
    case "CANCELLED": return { label: "Cancelada", tone: "closed" };
    case "EXPIRED": return { label: "Venció · no hay reserva", tone: "closed" };
    default: return { label: "Estado sin confirmar · aún no es una reserva", tone: "open" };
  }
}

export const RESERVATION_STATE_RULE =
  "<estado_reservas_usuario> es el estado REAL de sus solicitudes y reservas (base de IATOS). Solo di 'reservado', 'confirmado' o 'tu reserva' " +
  "si la fila tiene estado CONFIRMED y verificacion verificado_proveedor o verificado_equipo; cita quién confirmó. REQUESTED o PENDING_CONFIRMATION = " +
  "'solicitud enviada, aún no es una reserva'. REDIRECTED_TO_PROVIDER = abrió el sitio del proveedor: abrir un enlace no es una compra. " +
  "Nunca cambies un estado con tu texto.";

/** Bloque breve para el prompt: máximo 8 filas, lo indispensable. */
export function reservationStatesForPrompt(rows: ReservationStateRow[] | null | undefined, max = 8) {
  return (Array.isArray(rows) ? rows : []).slice(0, max).map((r) => {
    const out: Record<string, unknown> = {
      titulo: String(r.title ?? "").slice(0, 80),
      tipo: r.kind ?? undefined,
      estado: r.canonical_state ?? undefined,
      verificacion: r.verification ?? undefined,
      etiqueta: reservationStateLabel(r).label,
    };
    if (r.evidence_source) out.fuente_evidencia = r.evidence_source;
    if (r.trip_id) out.trip_id = r.trip_id;
    if (r.updated_at) out.actualizado = String(r.updated_at).slice(0, 10);
    return out;
  });
}
