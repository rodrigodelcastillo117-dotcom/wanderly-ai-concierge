// Recuerdos: deja cada archivo listo para subir, en el navegador y antes de que salga del dispositivo.
//   · Fecha: la del EXIF (fotos) o la de la caja mvhd (videos); si no hay, la fecha del archivo.
//   · Fotos: se reducen (lado mayor 2048 px) y se comprimen (JPEG 0.82) en un canvas, y la copia se
//     limpia a nivel de bytes (sin EXIF/GPS/XMP, igual que la Bóveda y los Mejores momentos); se
//     verifica que ya no traiga metadatos. Miniatura de 480 px para el calendario.
//   · Videos cortos (MP4 o MOV, hasta 60 s y 50 MB): no se recomprimen (el navegador no puede hacerlo
//     bien); se les quitan las cajas de metadatos donde va la ubicación (sanitizeMp4) y se verifica.
// Las dependencias del navegador (canvas, <video>) son inyectables para las pruebas.
import { jpegHasMetadata, stripJpegMetadata, isJpeg } from "@/lib/boveda/files";
import { exifInstant, mp4HasMetadata, readExifDate, readMp4Info, sanitizeMp4 } from "@/lib/recuerdos/media";
import { localDay, type DateSource } from "@/lib/recuerdos/model";

export const RECUERDO_PHOTO_EDGE = 2048;
export const RECUERDO_PHOTO_QUALITY = 0.82;
export const RECUERDO_THUMB_EDGE = 480;
export const RECUERDO_MAX_PHOTO_INPUT = 30 * 1024 * 1024;
export const RECUERDO_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const RECUERDO_MAX_VIDEO_S = 60;
export const RECUERDO_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const RECUERDO_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
/** Lo que acepta el selector de archivos. */
export const RECUERDO_ACCEPT = [...RECUERDO_PHOTO_TYPES, ".heic", ".heif", ...RECUERDO_VIDEO_TYPES, ".mov", ".mp4"].join(",");
/** Texto del límite (se muestra junto al botón de subir). */
export const RECUERDO_LIMITS_TEXT = "Fotos JPG, PNG, WEBP o HEIC. Videos cortos MP4 o MOV de hasta 60 segundos y 50 MB.";

export type PreparedRecuerdo = {
  kind: "foto" | "video";
  blob: Blob;
  mime: "image/jpeg" | "video/mp4" | "video/quicktime";
  ext: "jpg" | "mp4" | "mov";
  thumb: Blob | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
  takenOn: string;
  takenAt: string | null;
  dateSource: DateSource;
  name: string;
};

type Encoded = { blob: Blob; width: number; height: number };
export type PrepareDeps = {
  /** Reescribe la foto como JPEG dentro de `edge` px (null si el navegador no puede leerla). */
  encode?: (file: Blob, edge: number, quality: number) => Promise<Encoded | null>;
  /** Cuadro del video como JPEG (miniatura) y su tamaño; null si no se puede. */
  videoPoster?: (file: Blob) => Promise<Encoded | null>;
  /** Duración leída por el navegador si el archivo no la trae en mvhd. */
  videoDuration?: (file: Blob) => Promise<number | null>;
  /** Hoy (YYYY-MM-DD), para no aceptar fechas futuras. */
  today?: string;
};

const lower = (s: string) => (s || "").toLowerCase();

/** Tipo efectivo: algunos navegadores no ponen type a HEIC/MOV; se mira la extensión. */
export function effectiveType(file: { type: string; name?: string }): string {
  const t = lower(file.type);
  if (t) return t === "image/jpg" ? "image/jpeg" : t;
  const ext = lower(file.name ?? "").split(".").pop() ?? "";
  return ({ heic: "image/heic", heif: "image/heif", mov: "video/quicktime", mp4: "video/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[ext] ?? "";
}

/** null si el archivo se puede subir; si no, el mensaje para la persona. */
export function recuerdoProblem(file: { type: string; size: number; name?: string }): string | null {
  const t = effectiveType(file);
  if (!(file.size > 0)) return "El archivo está vacío.";
  if (RECUERDO_PHOTO_TYPES.includes(t)) return file.size > RECUERDO_MAX_PHOTO_INPUT ? "La foto pesa más de 30 MB." : null;
  if (RECUERDO_VIDEO_TYPES.includes(t)) return file.size > RECUERDO_MAX_VIDEO_BYTES ? "El video pesa más de 50 MB. Sube uno más corto." : null;
  if (t.startsWith("video/")) return "Ese formato de video no se puede subir. Usa MP4 o MOV.";
  return "Sube fotos (JPG, PNG, WEBP o HEIC) o videos cortos (MP4 o MOV).";
}

async function bytesOf(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === "function") return new Uint8Array(await b.arrayBuffer());
  return await new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

/** Fecha del archivo (lastModified) en la zona del dispositivo; hoy si no hay. */
function fileDate(file: File, today: string): { takenOn: string; takenAt: string | null } {
  const ms = Number(file.lastModified);
  if (Number.isFinite(ms) && ms > Date.UTC(1990, 0, 1)) {
    const d = new Date(ms);
    const day = localDay(d);
    if (day <= today) return { takenOn: day, takenAt: d.toISOString() };
  }
  return { takenOn: today, takenAt: null };
}

// ───── Implementaciones del navegador ─────
export function fitEdge(w: number, h: number, edge: number) {
  if (w <= edge && h <= edge) return { width: w, height: h };
  const s = edge / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

async function browserEncode(file: Blob, edge: number, quality: number): Promise<Encoded | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return null; }
  const { width, height } = fitEdge(bmp.width, bmp.height, edge);
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) { bmp.close?.(); return null; }
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), "image/jpeg", quality));
  return blob ? { blob, width, height } : null;
}

function withVideo<T>(file: Blob, run: (v: HTMLVideoElement, done: (x: T | null) => void) => void, timeoutMs = 8000): Promise<T | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (x: T | null) => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute("src"); resolve(x); };
    const timer = setTimeout(() => done(null), timeoutMs);
    v.muted = true; v.playsInline = true; v.preload = "metadata";
    v.onerror = () => done(null);
    run(v, done);
    v.src = url;
  });
}

const browserDuration = (file: Blob) => withVideo<number>(file, (v, done) => {
  v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
});

const browserPoster = (file: Blob) => withVideo<Encoded>(file, (v, done) => {
  v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch { done(null); } };
  v.onseeked = () => {
    const { width, height } = fitEdge(v.videoWidth || 1, v.videoHeight || 1, RECUERDO_THUMB_EDGE);
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx || !v.videoWidth) return done(null);
    ctx.drawImage(v, 0, 0, width, height);
    c.toBlob((b) => done(b ? { blob: b, width: v.videoWidth, height: v.videoHeight } : null), "image/jpeg", 0.75);
  };
});

/** JPEG limpio de metadatos y verificado (lanza con un mensaje para la persona). */
async function cleanJpeg(blob: Blob): Promise<Blob> {
  const bytes = await bytesOf(blob);
  if (!isJpeg(bytes)) throw new Error("No pudimos preparar la foto. Intenta de nuevo.");
  const clean = stripJpegMetadata(bytes);
  if (jpegHasMetadata(clean)) throw new Error("No pudimos quitar los datos ocultos de la foto.");
  return new Blob([clean], { type: "image/jpeg" });
}

/** Prepara una foto o video. Lanza Error con un mensaje claro si no se puede subir. */
export async function prepareRecuerdo(file: File, deps: PrepareDeps = {}): Promise<PreparedRecuerdo> {
  const problem = recuerdoProblem(file);
  if (problem) throw new Error(problem);
  const today = deps.today ?? localDay(new Date());
  const type = effectiveType(file);
  const original = await bytesOf(file);

  if (RECUERDO_VIDEO_TYPES.includes(type)) {
    const info = readMp4Info(original);
    if (!info) throw new Error("No pudimos leer ese video. Usa MP4 o MOV.");
    const duration = info.durationS ?? (await (deps.videoDuration ?? browserDuration)(file));
    if (duration != null && duration > RECUERDO_MAX_VIDEO_S + 0.5) throw new Error(`El video dura más de ${RECUERDO_MAX_VIDEO_S} segundos. Sube uno más corto.`);
    let clean: Uint8Array<ArrayBuffer>;
    try { clean = sanitizeMp4(original).bytes; } catch { throw new Error("No pudimos leer ese video. Usa MP4 o MOV."); }
    if (mp4HasMetadata(clean)) throw new Error("No pudimos quitar la ubicación del video.");
    const mime = type === "video/quicktime" ? "video/quicktime" : "video/mp4";
    const blob = new Blob([clean], { type: mime });
    const poster = await (deps.videoPoster ?? browserPoster)(blob).catch(() => null);
    const thumb = poster ? await cleanJpeg(poster.blob).catch(() => null) : null;
    const created = info.createdAt && localDay(info.createdAt) <= today ? info.createdAt : null;
    const date = created ? { takenOn: localDay(created), takenAt: created.toISOString(), source: "video" as const } : { ...fileDate(file, today), source: "archivo" as const };
    return {
      kind: "video", blob, mime, ext: mime === "video/quicktime" ? "mov" : "mp4", thumb,
      width: poster?.width ?? null, height: poster?.height ?? null, durationS: duration == null ? null : Math.round(duration * 100) / 100,
      takenOn: date.takenOn, takenAt: date.takenAt, dateSource: date.source, name: file.name,
    };
  }

  // Foto: la fecha se lee del ORIGINAL (la copia que se sube ya no trae EXIF).
  const exif = readExifDate(original);
  const encode = deps.encode ?? browserEncode;
  const main = await encode(file, RECUERDO_PHOTO_EDGE, RECUERDO_PHOTO_QUALITY);
  let mainBlob: Blob;
  if (main) mainBlob = await cleanJpeg(main.blob);
  else if (type === "image/jpeg") mainBlob = await cleanJpeg(file); // sin canvas: el original, limpio
  else throw new Error(type.includes("hei") ? "Tu navegador no puede abrir fotos HEIC. Súbela desde el celular o en JPG." : "No pudimos leer la foto. Intenta con otra.");
  if (mainBlob.size > RECUERDO_MAX_VIDEO_BYTES) throw new Error("La foto sigue pesando demasiado. Intenta con otra.");
  const t = await encode(mainBlob, RECUERDO_THUMB_EDGE, 0.72).catch(() => null);
  const thumb = t ? await cleanJpeg(t.blob).catch(() => null) : null;
  const exifOk = exif && exif.date <= today ? exif : null;
  const date = exifOk
    ? { takenOn: exifOk.date, takenAt: exifInstant(exifOk), source: "exif" as const }
    : { ...fileDate(file, today), source: "archivo" as const };
  return {
    kind: "foto", blob: mainBlob, mime: "image/jpeg", ext: "jpg", thumb,
    width: main?.width ?? null, height: main?.height ?? null, durationS: null,
    takenOn: date.takenOn, takenAt: date.takenAt, dateSource: date.source, name: file.name,
  };
}
