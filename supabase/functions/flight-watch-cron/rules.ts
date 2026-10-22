// Reglas de alerta de vuelos rastreados. Sin dependencias de Deno para probarlas con Vitest
// (src/test/flightWatchRules.test.ts). index.ts solo conecta esto con SerpApi y la base.
import type { FlightData, FlightOutcome } from "../_shared/flight-serpapi.ts";
import { redactSecrets } from "../_shared/redact.ts";

/** Cambios de hora estimada menores a esto no se avisan (el widget "baila" unos minutos). */
export const MIN_ESTIMATED_CHANGE_MIN = 15;
/** Un retraso menor a esto no se avisa ni se guarda como "retrasado". */
export const MIN_DELAY_ALERT_MIN = 15;

export type TrackedFlight = {
  id: string;
  user_id: string;
  trip_id: string | null;
  flight: string;
  flight_date: string | null;
  route: string | null;
  last_status: string | null;
  last_gate: string | null;
  last_terminal: string | null;
  last_estimated: string | null;
  last_notified_estimated?: string | null;
  last_notified_fingerprint?: string | null;
  consecutive_failures?: number | null;
  arrival_at?: string | null;
  departure_at?: string | null;
};

export type ProviderStatus = "ok" | "no_data" | "date_mismatch" | "provider_error" | "quota";

const known = (s: string | null | undefined) => (s && s !== "desconocido" ? s : null);

const toMinutes = (hhmm: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Minutos entre dos horas HH:MM, por el camino corto (23:50 → 00:10 son 20 min). Null si no son horas. */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = toMinutes(a), y = toMinutes(b);
  if (x == null || y == null) return null;
  const d = Math.abs(x - y) % 1440;
  return Math.min(d, 1440 - d);
}

export const fingerprint = (s: { status: string | null; gate: string | null; terminal: string | null; estimated: string | null }) =>
  [s.status, s.gate, s.terminal, s.estimated].map((v) => v ?? "").join("|");

export type Evaluation = {
  changes: string[];
  /** Estado que se guarda y contra el que se compara la próxima vez. */
  state: { status: string | null; gate: string | null; terminal: string | null; estimated: string | null; notifiedEstimated: string | null };
  fingerprint: string;
  /** Vuelo terminado (aterrizó o se canceló): se deja de consultar. */
  finished: boolean;
};

/**
 * Compara lo último que vio (o avisó) el usuario con la lectura nueva.
 * - Un estado "desconocido" (o un retraso de pocos minutos) es "sin dato": no avisa ni borra el anterior.
 * - Primera lectura: avisa si ya viene cancelado o retrasado; si no, solo se guarda.
 * - Primera puerta asignada: sí avisa (es el aviso más útil).
 * - Hora estimada: solo avisa si se movió al menos 15 min respecto a la última avisada.
 * - Si el resultado es idéntico a lo último avisado (huella), no se repite.
 */
export function evaluate(prev: TrackedFlight, d: FlightData): Evaluation {
  const changes: string[] = [];
  const prevStatus = known(prev.last_status);
  const minorDelay = d.status === "retrasado" && typeof d.delay_minutes === "number" && d.delay_minutes < MIN_DELAY_ALERT_MIN;
  const observed = minorDelay ? null : known(d.status);

  let status = prevStatus;
  if (observed && observed !== prevStatus) {
    if (prevStatus) changes.push(`Estado: ${prevStatus} → ${observed}`);
    else if (observed === "cancelado") changes.push("Vuelo cancelado");
    else if (observed === "retrasado") {
      const extra = typeof d.delay_minutes === "number" && d.delay_minutes > 0 ? ` ${d.delay_minutes} min` : "";
      const salida = d.estimated_departure ? `, sale a las ${d.estimated_departure}` : "";
      changes.push(`Vuelo retrasado${extra}${salida}`);
    }
    status = observed;
  }

  const gate = d.gate ?? prev.last_gate ?? null;
  if (d.gate && d.gate !== prev.last_gate) {
    changes.push(prev.last_gate ? `Puerta: ${prev.last_gate} → ${d.gate}` : `Puerta asignada: ${d.gate}`);
  }

  const terminal = d.terminal ?? prev.last_terminal ?? null;
  if (d.terminal && prev.last_terminal && d.terminal !== prev.last_terminal) {
    changes.push(`Terminal: ${prev.last_terminal} → ${d.terminal}`);
  }

  const reference = prev.last_notified_estimated ?? prev.last_estimated ?? null;
  let notifiedEstimated = reference;
  const est = d.estimated_departure ?? null;
  if (est && est !== reference) {
    if (!reference) {
      notifiedEstimated = est; // primera lectura: referencia, sin aviso
    } else {
      const diff = minutesBetween(reference, est);
      if (diff == null || diff >= MIN_ESTIMATED_CHANGE_MIN) {
        changes.push(`Hora estimada de salida: ${reference} → ${est}`);
        notifiedEstimated = est;
      }
    }
  }

  const fp = fingerprint({ status, gate, terminal, estimated: notifiedEstimated });
  const dedupedChanges = changes.length > 0 && fp === prev.last_notified_fingerprint ? [] : changes;

  return {
    changes: dedupedChanges,
    state: { status, gate, terminal, estimated: est ?? prev.last_estimated ?? null, notifiedEstimated },
    fingerprint: fp,
    finished: status === "aterrizado" || status === "cancelado",
  };
}

/** Columnas a guardar después de una consulta con datos. */
export function successUpdate(prev: TrackedFlight, d: FlightData, ev: Evaluation, notified: boolean, now: Date) {
  const at = now.toISOString();
  return {
    last_status: ev.state.status,
    last_gate: ev.state.gate,
    last_terminal: ev.state.terminal,
    last_estimated: ev.state.estimated,
    last_notified_estimated: ev.state.notifiedEstimated,
    last_notified_fingerprint: notified ? ev.fingerprint : prev.last_notified_fingerprint ?? null,
    last_successful_check_at: at,
    // Compatibilidad: last_checked_at ahora significa "última consulta con datos".
    last_checked_at: at,
    last_provider_status: "ok" as ProviderStatus,
    check_error: null,
    consecutive_failures: 0,
    arrival_at: d.arrival_at ?? prev.arrival_at ?? null,
    departure_at: d.departure_at ?? prev.departure_at ?? null,
    ...(ev.finished ? { active: false } : {}),
  };
}

const FAILURE_TEXT: Record<Exclude<ProviderStatus, "ok">, string> = {
  no_data: "Google no mostró el estado de este vuelo",
  date_mismatch: "El proveedor respondió con otra fecha; no se usó",
  provider_error: "SerpApi no respondió",
  quota: "Se acabaron las búsquedas de SerpApi",
};

/** Columnas a guardar cuando no hubo datos utilizables: nunca marca la consulta como exitosa. */
export function failureUpdate(prev: TrackedFlight, outcome: Exclude<FlightOutcome, { kind: "ok" }>) {
  const detail = "message" in outcome ? redactSecrets(outcome.message, 160) : undefined;
  return {
    last_provider_status: outcome.kind as ProviderStatus,
    check_error: redactSecrets(detail ? `${FAILURE_TEXT[outcome.kind]}: ${detail}` : FAILURE_TEXT[outcome.kind], 200) ?? null,
    consecutive_failures: (prev.consecutive_failures ?? 0) + 1,
  };
}

/** Un número de vuelo y una fecha son un solo vuelo, aunque lo sigan varios usuarios. */
export const flightCacheKey = (f: Pick<TrackedFlight, "flight" | "flight_date">) =>
  `${f.flight.toUpperCase().replace(/\s/g, "")}|${f.flight_date ?? ""}`;

export const dedupKey = (f: Pick<TrackedFlight, "id">, fp: string) => `flight:${f.id}:${fp}`;

export const flightUrl = (f: Pick<TrackedFlight, "trip_id">) => (f.trip_id ? `/dashboard/viajes/${f.trip_id}` : "/dashboard/concierge");
