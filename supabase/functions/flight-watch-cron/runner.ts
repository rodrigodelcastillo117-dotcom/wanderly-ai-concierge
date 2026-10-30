// Ciclo de una corrida de flight-watch-cron, con las dependencias inyectadas para probarlo
// (src/test/flightWatchRunner.test.ts). Garantías:
// - Reclama vuelos en lotes pequeños (claim_tracked_flights, FOR UPDATE SKIP LOCKED): dos
//   corridas que se enciman nunca procesan el mismo vuelo.
// - Concurrencia limitada y un tiempo total acotado: deja de reclamar antes del límite, y lo
//   que no alcanzó queda para la siguiente corrida (no se marcó como intentado).
// - Un mismo vuelo+fecha se consulta una sola vez por corrida aunque lo sigan varios usuarios.
// - Si SerpApi dice que se acabaron las búsquedas, se detiene para no seguir gastando.
import type { FlightOutcome } from "../_shared/flight-serpapi.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import {
  dedupKey, evaluate, failureUpdate, flightCacheKey, flightUrl, successUpdate, type TrackedFlight,
} from "./rules.ts";

export type RunnerDeps = {
  claim: (limit: number) => Promise<TrackedFlight[]>;
  check: (flight: string, date: string, route: string | null) => Promise<FlightOutcome>;
  save: (id: string, update: Record<string, unknown>) => Promise<void>;
  /** Inserta el aviso si no existe ya (dedup_key). true si se creó. */
  notify: (n: { user_id: string; title: string; body: string; related_id: string | null; dedup_key: string }) => Promise<boolean>;
  push: (userId: string, payload: { title: string; body: string; url: string }) => Promise<number>;
  /** Correo del aviso (opcional, apagado por defecto). Solo se llama si el aviso se insertó. */
  email?: (flight: TrackedFlight, change: { changes: string[]; status: string | null; url: string }) => Promise<void>;
  /**
   * Canales del viajero (Telegram/WhatsApp) respetando su canal preferido y su horario de no molestar
   * (_shared/channels/entrega.ts). Si existe, REEMPLAZA a `push` (la entrega decide push y canales). Devuelve cuántos
   * avisos salieron ya (0 si quedó diferido por el horario).
   */
  deliver?: (flight: TrackedFlight, payload: { title: string; body: string; url: string }, change: { changes: string[]; status: string | null; fingerprint: string }) => Promise<number>;
  now: () => number;
  log?: (...args: unknown[]) => void;
};

export type RunnerOptions = {
  maxChecks: number;
  concurrency: number;
  /** Tiempo total de la corrida en ms. */
  deadlineMs: number;
  /** Tiempo máximo de una consulta: no se reclama un lote si ya no alcanza a terminar. */
  perCallTimeoutMs: number;
};

export const DEFAULT_OPTIONS: RunnerOptions = { maxChecks: 50, concurrency: 5, deadlineMs: 100_000, perCallTimeoutMs: 10_000 };

/** FLIGHT_WATCH_MAX_CHECKS (1–200, por defecto 50). */
export function parseMaxChecks(raw: string | undefined, fallback = DEFAULT_OPTIONS.maxChecks): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 200) : fallback;
}

export type RunSummary = {
  claimed: number;
  provider_calls: number;
  cache_hits: number;
  with_data: number;
  no_data: number;
  date_mismatch: number;
  provider_errors: number;
  quota_exhausted: boolean;
  notified: number;
  pushed: number;
  finished: number;
  failed_rows: number;
  stopped_by_deadline: boolean;
  elapsed_ms: number;
};

export async function runFlightWatch(deps: RunnerDeps, opts: RunnerOptions = DEFAULT_OPTIONS): Promise<RunSummary> {
  const started = deps.now();
  const log = deps.log ?? (() => {});
  const cache = new Map<string, Promise<FlightOutcome>>();
  const s: RunSummary = {
    claimed: 0, provider_calls: 0, cache_hits: 0, with_data: 0, no_data: 0, date_mismatch: 0, provider_errors: 0,
    quota_exhausted: false, notified: 0, pushed: 0, finished: 0, failed_rows: 0, stopped_by_deadline: false, elapsed_ms: 0,
  };

  const lookup = (f: TrackedFlight): Promise<FlightOutcome> => {
    const key = flightCacheKey(f);
    const hit = cache.get(key);
    if (hit) { s.cache_hits++; return hit; }
    s.provider_calls++;
    const p = deps.check(f.flight, f.flight_date!, f.route).catch((e): FlightOutcome => ({
      kind: "provider_error", message: safeErrorMessage(e),
    }));
    cache.set(key, p);
    return p;
  };

  const processRow = async (f: TrackedFlight) => {
    try {
      const outcome = await lookup(f);
      if (outcome.kind !== "ok") {
        if (outcome.kind === "quota") s.quota_exhausted = true;
        if (outcome.kind === "quota" || outcome.kind === "provider_error") s.provider_errors++;
        else s[outcome.kind]++;
        await deps.save(f.id, failureUpdate(f, outcome));
        return;
      }
      s.with_data++;
      const ev = evaluate(f, outcome.data);
      let notified = false;
      if (ev.changes.length > 0) {
        const title = `Vuelo ${f.flight} actualizado`;
        const body = ev.changes.join(" · ");
        // El aviso dentro de la app va primero y con llave única: si dos corridas detectan el mismo
        // cambio, solo una lo inserta y solo esa manda el push.
        notified = await deps.notify({ user_id: f.user_id, title, body, related_id: f.trip_id ?? null, dedup_key: dedupKey(f, ev.fingerprint) });
        if (notified) {
          s.notified++;
          // Se espera antes de sumar: `s.pushed += await …` leería el contador viejo con filas en paralelo.
          const payload = { title, body, url: flightUrl(f) };
          const sent = await (deps.deliver
            ? deps.deliver(f, payload, { changes: ev.changes, status: ev.state.status, fingerprint: ev.fingerprint })
            : deps.push(f.user_id, payload)).catch(() => 0);
          s.pushed += sent;
          if (deps.email) await deps.email(f, { changes: ev.changes, status: ev.state.status, url: flightUrl(f) }).catch(() => {});
        }
      }
      if (ev.finished) s.finished++;
      // Aunque el aviso ya existiera, se guarda la huella para no volver a intentarlo.
      await deps.save(f.id, successUpdate(f, outcome.data, ev, notified || ev.changes.length > 0, new Date(deps.now())));
    } catch (e) {
      s.failed_rows++;
      log("flight-watch-cron: fila fallida", f.id, safeErrorMessage(e));
    }
  };

  while (s.claimed < opts.maxChecks) {
    if (s.quota_exhausted) break;
    if (deps.now() - started > opts.deadlineMs - opts.perCallTimeoutMs) { s.stopped_by_deadline = true; break; }
    const batch = await deps.claim(Math.min(opts.concurrency, opts.maxChecks - s.claimed));
    if (batch.length === 0) break;
    s.claimed += batch.length;
    await Promise.all(batch.map(processRow));
  }

  s.elapsed_ms = deps.now() - started;
  return s;
}
