// Reglas de subida por bucket (F-11 / IATOS-054). El SERVIDOR las impone con file_size_limit y
// allowed_mime_types (migración 20261022141400_sec2_storage_bucket_limits.sql); aquí se repiten
// para avisar antes de subir con un mensaje claro. src/test/uploadRules.test.ts verifica que ambas
// listas coincidan.

export type UploadBucket = "recibos" | "journal-photos" | "travel-moments" | "trip-documents";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export const UPLOAD_RULES: Record<UploadBucket, { maxBytes: number; types: string[] }> = {
  recibos: { maxBytes: MAX_UPLOAD_BYTES, types: [...IMAGES, "application/pdf"] },
  "journal-photos": { maxBytes: MAX_UPLOAD_BYTES, types: [...IMAGES, "image/gif"] },
  "travel-moments": { maxBytes: MAX_UPLOAD_BYTES, types: [...IMAGES, "image/gif"] },
  // Documentos del viaje (bucket privado, migración 20261022143100_trip_documents.sql).
  "trip-documents": { maxBytes: MAX_UPLOAD_BYTES, types: ["application/pdf", ...IMAGES] },
};

/** null si el archivo se puede subir; si no, el mensaje para el usuario. */
export function uploadProblem(bucket: UploadBucket, file: { type: string; size: number }): string | null {
  const rule = UPLOAD_RULES[bucket];
  if (!rule.types.includes((file.type || "").toLowerCase())) {
    return bucket === "recibos" || bucket === "trip-documents"
      ? "Sube una foto (JPG, PNG, WEBP o HEIC) o un PDF."
      : "Sube una foto en JPG, PNG, WEBP, HEIC o GIF.";
  }
  if (file.size > rule.maxBytes) return "El archivo pesa más de 10 MB. Elige uno más ligero.";
  return null;
}

/** Nombre de archivo seguro para la ruta en storage: sin carpetas, espacios raros ni símbolos. */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(-80);
  return base || "archivo";
}

/** Extensión segura (solo letras y números, máx. 5) o la de respaldo. */
export function safeExtension(name: string, fallback = "jpg"): string {
  const ext = (name.includes(".") ? name.split(".").pop() ?? "" : "").toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback;
}
