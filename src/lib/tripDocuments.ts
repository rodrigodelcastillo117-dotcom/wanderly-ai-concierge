// Documentos del viaje (boletos, pasaporte, pólizas, reservas) en el bucket PRIVADO trip-documents.
// Ruta: {trip_id}/{uuid}-{nombre}. Las políticas de storage y de la tabla trip_documents usan
// has_trip_access(trip_id) (migración 20261022143100); aquí van las mismas reglas del lado del
// cliente para avisar antes de subir. El servidor (bucket y CHECKs) es quien manda.

export const TRIP_DOC_BUCKET = "trip-documents";

export const TRIP_DOC_KINDS = ["boleto", "pasaporte", "poliza", "reserva", "otro"] as const;
export type TripDocKind = (typeof TRIP_DOC_KINDS)[number];

export const TRIP_DOC_KIND_LABEL: Record<TripDocKind, string> = {
  boleto: "Boleto",
  pasaporte: "Pasaporte",
  poliza: "Póliza de seguro",
  reserva: "Reserva",
  otro: "Otro",
};

/** 10 MB: igual que file_size_limit del bucket y el CHECK de trip_documents.size. */
export const TRIP_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** Igual que allowed_mime_types del bucket y el CHECK de trip_documents.mime. */
export const TRIP_DOC_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** Vida del enlace de descarga: 60 s. */
export const SIGNED_URL_TTL_S = 60;

export type TripDocument = {
  id: string;
  trip_id: string;
  uploaded_by: string;
  kind: TripDocKind;
  storage_path: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
};

/** Mensaje para el usuario si el archivo no se puede subir; null si está bien. */
export function validateDocFile(file: { size: number; type: string }): string | null {
  if (!file || !(file.size > 0)) return "El archivo está vacío.";
  if (file.size > TRIP_DOC_MAX_BYTES) return "El archivo pesa más de 10 MB.";
  if (!(TRIP_DOC_MIME as readonly string[]).includes(String(file.type || "").toLowerCase())) {
    return "Solo se aceptan PDF o imágenes (JPG, PNG, WEBP, HEIC).";
  }
  return null;
}

/** Nombre seguro para la ruta: sin carpetas, sin caracteres raros, máximo 100. */
export function safeFileName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return (clean || "documento").slice(-100);
}

export function buildDocPath(tripId: string, uuid: string, name: string): string {
  return `${tripId}/${uuid}-${safeFileName(name)}`;
}

/** Borra quien lo subió o el dueño del viaje (mismo criterio que la política DELETE). */
export function canDeleteDoc(doc: Pick<TripDocument, "uploaded_by">, userId: string | null | undefined, ownerId: string | null | undefined): boolean {
  if (!userId) return false;
  return doc.uploaded_by === userId || ownerId === userId;
}

export function formatBytes(n: number): string {
  if (!(n > 0)) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
