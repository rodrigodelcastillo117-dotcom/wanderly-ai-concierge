// Fotos del diario y de "Mejores momentos" (T-P2-2). Misma limpieza que la Bóveda
// (src/lib/boveda/files.ts): la foto se vuelve a codificar como JPEG en un canvas y además se le
// quitan EXIF/GPS/XMP a nivel de bytes; se verifica antes de subir. Los buckets son PRIVADOS: se
// guarda la ruta y la app pide enlaces firmados (1 h) a quien tiene acceso.
import { prepareVaultFile } from "@/lib/boveda/files";

export const JOURNAL_BUCKET = "journal-photos" as const;
export const MOMENTS_BUCKET = "travel-moments-private" as const;
/** Vida del enlace firmado de una foto en pantalla. */
export const PHOTO_SIGNED_URL_TTL_S = 3600;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];

/**
 * JPEG listo para subir, sin metadatos (lanza Error con un mensaje para la persona). Un GIF se
 * decodifica igual que un PNG (el canvas toma el primer cuadro).
 */
export async function preparePhotoFile(file: File, deps: { reencode?: (f: Blob) => Promise<Blob | null> } = {}): Promise<Blob> {
  const type = (file.type || "").toLowerCase();
  if (!PHOTO_TYPES.includes(type)) throw new Error("Sube una foto en JPG, PNG, WEBP, HEIC o GIF.");
  const input = type === "image/gif" ? new File([file], file.name, { type: "image/png" }) : file;
  const prepared = await prepareVaultFile(input, deps);
  if (prepared.kind !== "image") throw new Error("Sube una foto.");
  return prepared.blob;
}

export function newPhotoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/** {autor}/{viaje}/{uuid}.jpg: la política de storage exige acceso al viaje de la carpeta. */
export const journalPhotoPath = (userId: string, tripId: string, id = newPhotoId()) => `${userId}/${tripId}/${id}.jpg`;
/** {uid}/{uuid}.jpg en el bucket privado de momentos. */
export const momentPhotoPath = (userId: string, id = newPhotoId()) => `${userId}/${id}.jpg`;

type SignClient = {
  storage: { from: (b: string) => { createSignedUrls: (paths: string[], ttl: number) => PromiseLike<{ data: Array<{ path: string | null; signedUrl: string | null; error?: string | null }> | null; error: unknown }> } };
};

/** Enlaces firmados por ruta (los que fallan no aparecen). */
export async function signPhotoPaths(client: SignClient, bucket: string, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!list.length) return out;
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrls(list, PHOTO_SIGNED_URL_TTL_S);
    if (error || !data) return out;
    for (const r of data) if (r?.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  } catch {
    // Sin red o sin permiso: la entrada se muestra sin foto.
  }
  return out;
}
