// Acceso a datos de la Bóveda (Supabase). RLS del servidor: cada cuenta solo ve y cambia lo suyo.
import { supabase } from "@/integrations/supabase/client";
import { buildVaultPath, prepareVaultFile, VAULT_SIGNED_URL_TTL_S, type PreparedFile } from "./files";
import { VAULT_BUCKET, type VaultFile, type VaultFileSide, type VaultItem, type VaultItemInput } from "./types";
import type { TripLite } from "./alerts";

// Las tablas nuevas aún no están en los tipos generados de Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

export async function listVault(): Promise<{ items: VaultItem[]; files: VaultFile[]; unavailable: boolean }> {
  const [itemsRes, filesRes] = await Promise.all([
    db.from("vault_items").select("*").order("created_at", { ascending: true }),
    db.from("vault_files").select("*").order("created_at", { ascending: true }),
  ]);
  if (itemsRes.error) return { items: [], files: [], unavailable: true };
  return { items: (itemsRes.data ?? []) as VaultItem[], files: (filesRes.data ?? []) as VaultFile[], unavailable: false };
}

export async function listUpcomingTrips(): Promise<TripLite[]> {
  const { data, error } = await supabase.from("trips")
    .select("id,destino,pais_destino,fecha_salida,fecha_regreso,status")
    .not("fecha_salida", "is", null)
    .order("fecha_salida", { ascending: true })
    .limit(30);
  return error ? [] : ((data ?? []) as TripLite[]);
}

export async function saveItem(input: VaultItemInput, id?: string): Promise<VaultItem> {
  const q = id ? db.from("vault_items").update(input).eq("id", id) : db.from("vault_items").insert(input);
  const { data, error } = await q.select("*").single();
  if (error) throw error;
  return data as VaultItem;
}

/** Borra primero los archivos del bucket (la base no puede borrarlos) y luego la fila. */
export async function deleteItem(item: VaultItem, files: VaultFile[]): Promise<void> {
  const paths = files.filter((f) => f.item_id === item.id).map((f) => f.storage_path);
  if (paths.length) {
    const { error } = await supabase.storage.from(VAULT_BUCKET).remove(paths);
    if (error) throw error;
  }
  const { error } = await db.from("vault_items").delete().eq("id", item.id);
  if (error) throw error;
}

export async function uploadFile(userId: string, itemId: string, file: File, side: VaultFileSide): Promise<VaultFile> {
  return uploadPrepared(userId, itemId, await prepareVaultFile(file), side);
}

/** Sube un archivo ya preparado (foto sin metadatos o PDF verificado). */
export async function uploadPrepared(userId: string, itemId: string, prepared: PreparedFile, side: VaultFileSide): Promise<VaultFile> {
  const path = buildVaultPath(userId, itemId, newId(), prepared.kind);
  const { error: upErr } = await supabase.storage.from(VAULT_BUCKET)
    .upload(path, prepared.blob, { contentType: prepared.mime, upsert: false, cacheControl: "0" });
  if (upErr) throw upErr;
  const { data, error } = await db.from("vault_files")
    .insert({ item_id: itemId, side: prepared.kind === "pdf" ? "pdf" : side, storage_path: path, mime: prepared.mime, size: prepared.size })
    .select("*").single();
  if (error) {
    // Sin fila no se ve: no se deja el archivo huérfano.
    await supabase.storage.from(VAULT_BUCKET).remove([path]);
    throw error;
  }
  return data as VaultFile;
}

export async function deleteFile(file: VaultFile): Promise<void> {
  const { error } = await supabase.storage.from(VAULT_BUCKET).remove([file.storage_path]);
  if (error) throw error;
  const { error: rowErr } = await db.from("vault_files").delete().eq("id", file.id);
  if (rowErr) throw rowErr;
}

/** Enlace firmado de vida corta (60 s). Nunca hay enlaces públicos. */
export async function signedUrl(file: VaultFile): Promise<string | null> {
  const { data, error } = await supabase.storage.from(VAULT_BUCKET).createSignedUrl(file.storage_path, VAULT_SIGNED_URL_TTL_S);
  return error ? null : data?.signedUrl ?? null;
}

export async function summarizeWithIato(system: string, prompt: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai-tool", { body: { system, prompt } });
  if (error) throw error;
  if (!data?.ok || typeof data.text !== "string") throw new Error(data?.error || "Sin respuesta");
  return data.text;
}
