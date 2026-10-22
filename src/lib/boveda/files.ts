// Archivos de la Bóveda: validación, limpieza de metadatos (EXIF/GPS) y rutas.
// · Las fotos se vuelven a codificar como JPEG en un canvas: el archivo que se sube ya no trae
//   EXIF, GPS, modelo de cámara ni miniaturas. Además se pasa por stripJpegMetadata (por si el
//   navegador no puede decodificar y se usa el original) y se verifica antes de subir.
// · El bucket travel-vault solo acepta image/jpeg y application/pdf, hasta 10 MB.
// · Ruta {user_id}/{item_id}/{uuid}.jpg|pdf: sin el nombre original del archivo.
import type { VaultFileSide } from "./types";

export const VAULT_MAX_BYTES = 10 * 1024 * 1024;
/** Una foto de celular puede pesar más antes de reducirla; lo que se sube nunca pasa de 10 MB. */
export const VAULT_MAX_INPUT_IMAGE_BYTES = 25 * 1024 * 1024;
export const VAULT_INPUT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const VAULT_STORED_TYPES = ["image/jpeg", "application/pdf"] as const;
export const PHOTO_MAX_EDGE = 2400;
export const PHOTO_QUALITY = 0.85;
/** Vida del enlace firmado para ver o descargar un archivo. */
export const VAULT_SIGNED_URL_TTL_S = 60;

export type InputKind = "image" | "pdf";

/** null si se puede procesar; si no, el mensaje para la persona. */
export function validateVaultInput(file: { type: string; size: number; name?: string }): { kind: InputKind } | { error: string } {
  const type = (file.type || "").toLowerCase();
  if (!(file.size > 0)) return { error: "El archivo está vacío." };
  if (type === "application/pdf") {
    return file.size > VAULT_MAX_BYTES ? { error: "El PDF pesa más de 10 MB. Elige uno más ligero." } : { kind: "pdf" };
  }
  if ((VAULT_INPUT_IMAGE_TYPES as readonly string[]).includes(type)) {
    return file.size > VAULT_MAX_INPUT_IMAGE_BYTES ? { error: "La foto pesa más de 25 MB." } : { kind: "image" };
  }
  return { error: "Sube una foto (JPG, PNG, WEBP o HEIC) o un PDF." };
}

export function buildVaultPath(userId: string, itemId: string, fileId: string, kind: InputKind): string {
  return `${userId}/${itemId}/${fileId}.${kind === "pdf" ? "pdf" : "jpg"}`;
}

export function defaultSide(kind: InputKind, existing: VaultFileSide[]): VaultFileSide {
  if (kind === "pdf") return "pdf";
  if (!existing.includes("frente")) return "frente";
  if (!existing.includes("reverso")) return "reverso";
  return "pagina";
}

// ───── JPEG: quitar metadatos a nivel de bytes ─────
// Se conservan los segmentos necesarios para decodificar (APP0 JFIF, APP2 ICC, APP14 Adobe, tablas,
// SOF, SOS y los datos). Se quitan APP1 (EXIF y XMP, donde viven GPS y cámara), APP3–APP13
// (IPTC/Photoshop), APP15 y comentarios (COM).
const KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
}

type Segment = { marker: number; start: number; end: number };

function* segments(bytes: Uint8Array): Generator<Segment | { sos: number }> {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("jpeg_corrupt");
    let j = i;
    while (j < bytes.length && bytes[j] === 0xff) j++; // bytes de relleno
    const marker = bytes[j];
    if (marker === 0xda) { yield { sos: i }; return; }
    if (marker === 0xd9) { yield { sos: i }; return; }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { yield { marker, start: i, end: j + 1 }; i = j + 1; continue; }
    const len = (bytes[j + 1] << 8) | bytes[j + 2];
    if (!(len >= 2) || j + 1 + len > bytes.length) throw new Error("jpeg_corrupt");
    yield { marker, start: i, end: j + 1 + len };
    i = j + 1 + len;
  }
}

const isMetadataMarker = (m: number) => (m >= 0xe1 && m <= 0xef && !KEEP_APP.has(m)) || m === 0xfe;

/** Copia del JPEG sin EXIF/XMP/IPTC/comentarios. Lanza si no es un JPEG válido. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isJpeg(bytes)) throw new Error("not_jpeg");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  for (const seg of segments(bytes)) {
    if ("sos" in seg) { parts.push(bytes.subarray(seg.sos)); break; }
    if (!isMetadataMarker(seg.marker)) parts.push(bytes.subarray(seg.start, seg.end));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** true si el JPEG trae algún segmento de metadatos (EXIF, XMP, IPTC, comentario). */
export function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (!isJpeg(bytes)) return false;
  try {
    for (const seg of segments(bytes)) {
      if ("sos" in seg) return false;
      if (isMetadataMarker(seg.marker)) return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function fitWithin(width: number, height: number, max = PHOTO_MAX_EDGE): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function reencode(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close?.(); return null; }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", PHOTO_QUALITY));
}

const bytesOf = async (b: Blob): Promise<Uint8Array> => {
  if (typeof b.arrayBuffer === "function") return new Uint8Array(await b.arrayBuffer());
  // Navegadores viejos (y jsdom): FileReader.
  return await new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
};

export type PreparedFile = { blob: Blob; mime: "image/jpeg" | "application/pdf"; kind: InputKind; size: number };

/**
 * Deja el archivo listo para subir: fotos → JPEG reescrito y sin metadatos; PDF → se comprueba que
 * sí sea PDF. Lanza Error con un mensaje para la persona si no se puede.
 */
export async function prepareVaultFile(file: File, deps: { reencode?: (f: Blob) => Promise<Blob | null> } = {}): Promise<PreparedFile> {
  const check = validateVaultInput(file);
  if ("error" in check) throw new Error(check.error);
  if (check.kind === "pdf") {
    const head = await bytesOf(file.slice(0, 8));
    if (!isPdf(head)) throw new Error("Ese archivo no parece un PDF.");
    return { blob: file, mime: "application/pdf", kind: "pdf", size: file.size };
  }
  const re = await (deps.reencode ?? reencode)(file);
  let bytes: Uint8Array;
  if (re) {
    bytes = await bytesOf(re);
  } else if ((file.type || "").toLowerCase() === "image/jpeg") {
    bytes = await bytesOf(file); // el navegador no la pudo decodificar: se limpian los bytes del original
  } else {
    throw new Error("No pudimos leer la foto. Tómala de nuevo o súbela en JPG.");
  }
  if (!isJpeg(bytes)) throw new Error("No pudimos preparar la foto. Intenta de nuevo.");
  const clean = stripJpegMetadata(bytes);
  if (jpegHasMetadata(clean)) throw new Error("No pudimos quitar los datos ocultos de la foto.");
  if (clean.length > VAULT_MAX_BYTES) throw new Error("La foto sigue pesando más de 10 MB. Intenta con otra.");
  const blob = new Blob([clean], { type: "image/jpeg" });
  return { blob, mime: "image/jpeg", kind: "image", size: clean.length };
}
