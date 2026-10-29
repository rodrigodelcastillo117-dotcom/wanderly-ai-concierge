// Recuerdos contra Supabase (cliente inyectable para las pruebas). Todo pasa por la sesión de la persona:
// RLS y las políticas de storage deciden qué ve (migración 20261027100000_recuerdos.sql).
import { newPhotoId, signPhotoPaths } from "@/lib/photoUpload";
import {
  RECUERDOS_BUCKET, unifyItems, type JournalRow, type MomentRow, type RecuerdoItem, type RecuerdoRow, type RecuerdoTrip, type TripSource,
} from "@/lib/recuerdos/model";
import type { PreparedRecuerdo } from "@/lib/recuerdos/prepare";
import { shortTripName } from "@/lib/tripName";

type Res = { data: unknown; error: unknown };
type Query = PromiseLike<Res> & {
  select: (cols: string) => Query; eq: (c: string, v: unknown) => Query; in: (c: string, v: unknown[]) => Query;
  not: (c: string, op: string, v: unknown) => Query; order: (c: string, o?: unknown) => Query; limit: (n: number) => Query;
  insert: (v: unknown) => Query; update: (v: unknown) => Query; delete: () => Query; single: () => PromiseLike<Res>;
};
type Bucket = {
  upload: (path: string, body: Blob, opts: { contentType: string; upsert: boolean; cacheControl?: string }) => PromiseLike<{ error: unknown }>;
  remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
  createSignedUrls: (paths: string[], ttl: number) => PromiseLike<{ data: Array<{ path: string | null; signedUrl: string | null; error?: string | null }> | null; error: unknown }>;
};
export type RecuerdosClient = { from: (t: string) => Query; storage: { from: (b: string) => Bucket } };

const rows = <T>(r: Res | null | undefined): T[] => (r && !r.error && Array.isArray(r.data) ? (r.data as T[]) : []);
const TRIP_COLS = "id, destino, pais_destino, fecha_salida, fecha_regreso";
const REC_COLS = "id, user_id, trip_id, media_type, storage_path, thumb_path, taken_on, taken_at, created_at, favorite, date_source, trip_source, duration_s";

export type RecuerdosLoad = { items: RecuerdoItem[]; trips: RecuerdoTrip[]; sharedTrips: Set<string> };

export async function loadRecuerdos(client: RecuerdosClient, userId: string): Promise<RecuerdosLoad> {
  const [recR, momR, jouR, ownR, colR, shR] = await Promise.all([
    client.from("recuerdos").select(REC_COLS).order("taken_on", { ascending: true }).limit(5000),
    client.from("travel_moments").select("id, trip_id, caption, created_at, image_path, image_url").eq("user_id", userId).limit(1000),
    client.from("trip_journal_entries").select("id, trip_id, text, created_at, photo_path").eq("author_id", userId).not("photo_path", "is", null).limit(1000),
    client.from("trips").select(TRIP_COLS).eq("user_id", userId).order("fecha_salida", { ascending: false }).limit(500),
    client.from("trip_collaborators").select("trip_id").eq("user_id", userId).eq("status", "accepted"),
    client.from("recuerdos_album_shares").select("trip_id").eq("user_id", userId),
  ]);
  if (recR?.error) throw new Error("No pudimos cargar tus recuerdos.");
  // Nombre corto (si el destino guardado es la frase completa que escribió la persona, auditoría 10/10).
  const named = (t: RecuerdoTrip) => ({ ...t, destino: shortTripName(t) });
  const own = rows<RecuerdoTrip>(ownR).map((t) => ({ ...named(t), mine: true }));
  const sharedIds = rows<{ trip_id: string }>(colR).map((c) => c.trip_id).filter((id) => !own.some((t) => t.id === id));
  const shared = sharedIds.length ? rows<RecuerdoTrip>(await client.from("trips").select(TRIP_COLS).in("id", sharedIds)).map((t) => ({ ...named(t), mine: false })) : [];
  return {
    items: unifyItems(userId, { recuerdos: rows<RecuerdoRow>(recR), moments: rows<MomentRow>(momR), journal: rows<JournalRow>(jouR) }),
    trips: [...own, ...shared].sort((a, b) => String(b.fecha_salida ?? "").localeCompare(String(a.fecha_salida ?? ""))),
    sharedTrips: new Set(rows<{ trip_id: string }>(shR).map((s) => s.trip_id)),
  };
}

/** Enlaces firmados (1 h) de varias rutas, agrupadas por bucket. Clave: "<bucket>|<ruta>". */
export async function signItems(client: RecuerdosClient, wanted: Array<{ bucket: string; path: string }>): Promise<Map<string, string>> {
  const byBucket = new Map<string, string[]>();
  for (const w of wanted) {
    if (!w.path) continue;
    const list = byBucket.get(w.bucket) ?? [];
    list.push(w.path); byBucket.set(w.bucket, list);
  }
  const out = new Map<string, string>();
  await Promise.all([...byBucket].map(async ([bucket, paths]) => {
    for (let i = 0; i < paths.length; i += 100) {
      const m = await signPhotoPaths(client as never, bucket, paths.slice(i, i + 100));
      for (const [p, url] of m) out.set(`${bucket}|${p}`, url);
    }
  }));
  return out;
}

export type UploadResult = { ok: true; row: RecuerdoRow } | { ok: false; error: string };

/** Sube archivo (y miniatura) y crea la fila. Si algo falla, borra lo que alcanzó a subir. */
export async function uploadRecuerdo(
  client: RecuerdosClient, userId: string, p: PreparedRecuerdo, trip: { id: string | null; source: TripSource }, id = newPhotoId(),
): Promise<UploadResult> {
  const bucket = client.storage.from(RECUERDOS_BUCKET);
  const path = `${userId}/${id}.${p.ext}`;
  const thumbPath = p.thumb ? `${userId}/${id}_t.jpg` : null;
  const up = await bucket.upload(path, p.blob, { contentType: p.mime, upsert: false, cacheControl: "3600" });
  if (up.error) return { ok: false, error: "No se pudo subir. Revisa tu conexión e intenta de nuevo." };
  let thumbOk = false;
  if (thumbPath && p.thumb) thumbOk = !(await bucket.upload(thumbPath, p.thumb, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" })).error;
  const record = {
    id, user_id: userId, trip_id: trip.id, trip_source: trip.id ? trip.source : "ninguno",
    media_type: p.kind, mime_type: p.mime, storage_path: path, thumb_path: thumbOk ? thumbPath : null,
    bytes: p.blob.size, width: p.width, height: p.height, duration_s: p.durationS,
    taken_on: p.takenOn, taken_at: p.takenAt, date_source: p.dateSource,
  };
  const ins = await client.from("recuerdos").insert(record).select(REC_COLS).single();
  if (ins.error || !ins.data) {
    await bucket.remove([path, ...(thumbOk && thumbPath ? [thumbPath] : [])]);
    const msg = String((ins.error as { message?: string } | null)?.message ?? "");
    if (msg.includes("recuerdos_cupo")) return { ok: false, error: "Llegaste al máximo de 5,000 recuerdos. Borra algunos para subir más." };
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
  return { ok: true, row: ins.data as RecuerdoRow };
}

export async function deleteRecuerdo(client: RecuerdosClient, it: Pick<RecuerdoItem, "id" | "path" | "thumbPath">): Promise<boolean> {
  const del = await client.from("recuerdos").delete().eq("id", it.id);
  if (del.error) return false;
  // La fila ya no existe: si storage falla, el archivo queda solo para su dueña (y se va con la cuenta).
  await client.storage.from(RECUERDOS_BUCKET).remove([it.path, ...(it.thumbPath ? [it.thumbPath] : [])]);
  return true;
}

export async function setFavorite(client: RecuerdosClient, id: string, favorite: boolean): Promise<boolean> {
  return !(await client.from("recuerdos").update({ favorite }).eq("id", id)).error;
}

export async function moveToTrip(client: RecuerdosClient, id: string, tripId: string | null): Promise<boolean> {
  return !(await client.from("recuerdos").update({ trip_id: tripId, trip_source: tripId ? "manual" : "ninguno" }).eq("id", id)).error;
}

export async function setAlbumShared(client: RecuerdosClient, userId: string, tripId: string, shared: boolean): Promise<boolean> {
  const r = shared
    ? await client.from("recuerdos_album_shares").insert({ user_id: userId, trip_id: tripId })
    : await client.from("recuerdos_album_shares").delete().eq("user_id", userId).eq("trip_id", tripId);
  const code = (r.error as { code?: string } | null)?.code;
  return !r.error || code === "23505"; // ya estaba compartido
}
