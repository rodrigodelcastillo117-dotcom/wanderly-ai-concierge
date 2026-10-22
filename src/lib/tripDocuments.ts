// Documentos del viaje (boletos, pasaporte, pólizas, reservas) en el bucket PRIVADO trip-documents.
// Ruta: {trip_id}/{uuid}-{nombre}. Las políticas de storage y de la tabla trip_documents usan
// has_trip_access(trip_id) (migración 20261022143100); tipo, tamaño y nombre seguro son las reglas
// comunes de uploadRules.ts, para avisar antes de subir. El servidor (bucket y CHECKs) es quien manda.
import { UPLOAD_RULES, safeFileName, uploadProblem } from "@/lib/uploadRules";

export const TRIP_DOC_BUCKET = "trip-documents" as const;

export const TRIP_DOC_KINDS = ["boleto", "pasaporte", "visa", "poliza", "reserva", "otro"] as const;
export type TripDocKind = (typeof TRIP_DOC_KINDS)[number];

export const TRIP_DOC_KIND_LABEL: Record<TripDocKind, string> = {
  boleto: "Boleto",
  pasaporte: "Pasaporte",
  visa: "Visa",
  poliza: "Póliza de seguro",
  reserva: "Reserva",
  otro: "Otro",
};

/**
 * T-P2-4: quién ve cada documento. "viaje" = todos los del viaje; "solo_yo" = solo quien lo subió (ni
 * el dueño del viaje). Lo impone el servidor (políticas de trip_documents y de storage).
 */
export type TripDocVisibility = "viaje" | "solo_yo";
export const TRIP_DOC_VISIBILITY_LABEL: Record<TripDocVisibility, string> = { viaje: "Todo el viaje", solo_yo: "Solo yo" };
/** Igual que el trigger trip_documents_default_visibility: pasaporte y visa, "solo yo". */
export function defaultDocVisibility(kind: TripDocKind): TripDocVisibility {
  return kind === "pasaporte" || kind === "visa" ? "solo_yo" : "viaje";
}

/** 10 MB: igual que file_size_limit del bucket y el CHECK de trip_documents.size. */
export const TRIP_DOC_MAX_BYTES = UPLOAD_RULES[TRIP_DOC_BUCKET].maxBytes;

/** Igual que allowed_mime_types del bucket y el CHECK de trip_documents.mime. */
export const TRIP_DOC_MIME: readonly string[] = UPLOAD_RULES[TRIP_DOC_BUCKET].types;

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
  visibility?: TripDocVisibility;
};

/** Mensaje para el usuario si el archivo no se puede subir; null si está bien. */
export function validateDocFile(file: { size: number; type: string }): string | null {
  if (!file || !(file.size > 0)) return "El archivo está vacío.";
  return uploadProblem(TRIP_DOC_BUCKET, file);
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
