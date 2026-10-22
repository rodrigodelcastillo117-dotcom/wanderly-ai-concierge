// T-P2-3: vacía storage_purge_queue (archivos de viajes borrados). Lógica pura (Vitest).
// Solo se borran rutas de los buckets del viaje; cada fila se quita de la cola cuando su archivo se
// borró (o ya no existía). Si storage falla, la fila se queda para el siguiente intento.

export const PURGE_BUCKETS = new Set(["trip-documents", "journal-photos"]);

export type QueueRow = { id: number; bucket_id: string; name: string };
export type PurgeDeps = {
  /** Siguiente lote de la cola (de una persona o de todas). */
  load: (limit: number) => Promise<QueueRow[]>;
  /** storage.from(bucket).remove(names) con la llave de servicio. */
  remove: (bucket: string, names: string[]) => Promise<{ error: string | null }>;
  /** Quita esas filas de la cola. */
  done: (ids: number[]) => Promise<void>;
};
export type PurgeResult = { removed: number; failed: number; skipped: number; rounds: number };

export async function drainQueue(deps: PurgeDeps, opts: { batch?: number; maxRounds?: number } = {}): Promise<PurgeResult> {
  const batch = opts.batch ?? 100;
  const maxRounds = opts.maxRounds ?? 20;
  const out: PurgeResult = { removed: 0, failed: 0, skipped: 0, rounds: 0 };
  for (; out.rounds < maxRounds; out.rounds++) {
    const rows = await deps.load(batch);
    if (!rows.length) break;
    const byBucket = new Map<string, QueueRow[]>();
    const finished: number[] = [];
    for (const r of rows) {
      if (!PURGE_BUCKETS.has(r.bucket_id) || !r.name || r.name.includes("..") || r.name.startsWith("/")) {
        out.skipped++;
        finished.push(r.id); // nunca se borra algo fuera de los buckets del viaje
        continue;
      }
      byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r]);
    }
    let progressed = finished.length > 0;
    for (const [bucket, list] of byBucket) {
      const { error } = await deps.remove(bucket, list.map((r) => r.name));
      if (error) { out.failed += list.length; continue; }
      out.removed += list.length;
      finished.push(...list.map((r) => r.id));
      progressed = true;
    }
    if (finished.length) await deps.done(finished);
    if (!progressed) break; // todo falló: se reintenta en la próxima llamada
  }
  return out;
}
