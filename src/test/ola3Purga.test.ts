// Integración de la Ola 3: al borrar un viaje, los triggers encolan archivos de varios buckets
// (gastos_split agregó trip-receipts; recuerdos agregó trips_purge_recuerdos con el bucket recuerdos) y
// trip-files-purge solo borra los de PURGE_BUCKETS: una fila de otro bucket se QUITA de la cola sin
// borrar el archivo. Aquí se comprueba que cada bucket que una migración encola esté en PURGE_BUCKETS.
// La parte SQL (qué se encola al borrar un viaje) está en supabase/tests/ola3.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drainQueue, PURGE_BUCKETS, type QueueRow } from "../../supabase/functions/trip-files-purge/purge";

const MIG = "supabase/migrations";

/** Buckets que alguna migración encola en storage_purge_queue por un viaje borrado. */
function bucketsQueuedOnTripDelete(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(`${MIG}/${f}`, "utf8");
    // Cada INSERT INTO storage_purge_queue … 'trip_deleted' (hasta el ; que lo cierra).
    for (const m of sql.matchAll(/INSERT INTO public\.storage_purge_queue[\s\S]*?;/g)) {
      const stmt = m[0];
      if (!stmt.includes("'trip_deleted'")) continue;
      for (const b of stmt.matchAll(/'(trip-documents|journal-photos|trip-receipts|recuerdos|[a-z]+(?:-[a-z]+)+)'/g)) out.add(b[1]);
      // SELECT 'recuerdos', p.name … (bucket literal como primera columna)
      const lit = stmt.match(/SELECT\s+'([a-z-]+)'\s*,/);
      if (lit) out.add(lit[1]);
    }
  }
  return out;
}

describe("Ola 3 · purga de archivos al borrar un viaje", () => {
  it("cada bucket que encolan los triggers del viaje está en PURGE_BUCKETS (documentos, diario, recibos y Recuerdos)", () => {
    const queued = bucketsQueuedOnTripDelete();
    expect([...queued].sort()).toEqual(expect.arrayContaining(["journal-photos", "recuerdos", "trip-documents", "trip-receipts"]));
    for (const b of queued) expect(PURGE_BUCKETS.has(b), `PURGE_BUCKETS no tiene ${b}`).toBe(true);
  });

  it("drainQueue borra los archivos de Recuerdos encolados (antes se quitaban de la cola sin borrarse)", async () => {
    let queue: QueueRow[] = [
      { id: 1, bucket_id: "recuerdos", name: "u1/r1.jpg" },
      { id: 2, bucket_id: "recuerdos", name: "u1/r1_t.jpg" },
      { id: 3, bucket_id: "trip-receipts", name: "t1/ticket.jpg" },
      { id: 4, bucket_id: "travel-vault", name: "u1/pasaporte.jpg" },
    ];
    const removed: string[] = [];
    const r = await drainQueue({
      load: async (n) => queue.slice(0, n),
      remove: async (bucket, names) => { removed.push(...names.map((x) => `${bucket}:${x}`)); return { error: null }; },
      done: async (ids) => { queue = queue.filter((q) => !ids.includes(q.id)); },
    });
    expect(removed.sort()).toEqual(["recuerdos:u1/r1.jpg", "recuerdos:u1/r1_t.jpg", "trip-receipts:t1/ticket.jpg"]);
    // La bóveda nunca se toca desde esta purga.
    expect(r).toMatchObject({ removed: 3, skipped: 1, failed: 0 });
  });
});
