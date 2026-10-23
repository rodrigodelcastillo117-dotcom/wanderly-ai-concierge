// «Hazme mi video» de IATOS Wrapped: video vertical 9:16 tipo historia, de 30 a 60 s, hecho TODO en el
// navegador (canvas + MediaRecorder). Las fotos nunca salen del dispositivo a otro servicio.
//   · Escenas: portada, tus mejores fotos (favoritas de Recuerdos primero) con efecto Ken Burns y
//     transición suave, y los textos de las tarjetas del Wrapped (viajes, países, kilómetros…).
//   · Sin música: no hay en el proyecto una pista con licencia clara para incluirla (nada inventado).
//   · Si el navegador no puede grabar (sin MediaRecorder o sin captureStream), la pantalla ofrece la
//     presentación a pantalla completa con el mismo dibujo (drawVideoFrame) y explica por qué.
// El plan y el dibujo son puros (se prueban con un canvas simulado); la grabación recibe sus
// dependencias (reloj, requestAnimationFrame, MediaRecorder) para probarla sin navegador.
import { buildCardSpec, buildWrappedCards, type CardSpec, type WrappedStats } from "@/lib/wrapped";

export const VIDEO_W = 720;
export const VIDEO_H = 1280;
export const VIDEO_FPS = 30;
export const VIDEO_MIN_S = 30;
export const VIDEO_MAX_S = 60;
export const FADE_S = 0.7;
const MAX_PHOTOS = 14;

const GOLD = "#C9A961";
const GOLD_LIGHT = "#E8D5A0";
const IVORY = "#F5EBDD";
const INK = "#0A0A0A";
const SERIF = "Fraunces, Georgia, serif";
const SANS = "Manrope, system-ui, sans-serif";

export type KenBurns = { fromScale: number; toScale: number; fromX: number; fromY: number; toX: number; toY: number };
export type VideoScene =
  | { kind: "text"; start: number; dur: number; kicker: string; title?: string; big?: string; unit?: string; body?: string }
  | { kind: "photo"; start: number; dur: number; photo: number; caption?: string | null; place?: string | null; kb: KenBurns };
export type VideoPlan = { year: number; total: number; scenes: VideoScene[]; photos: string[] };

const TEXT_KINDS = new Set(["trips", "places", "km", "longest", "month", "companions", "badges", "dna"]);

function textScene(spec: CardSpec): Omit<Extract<VideoScene, { kind: "text" }>, "start" | "dur"> {
  return { kind: "text", kicker: spec.kicker, title: spec.title, big: spec.big, unit: spec.bigUnit, body: spec.body };
}

/** Ken Burns distinto en cada foto (determinista): acercar o alejar y desplazarse un poco. */
export function kenBurns(i: number): KenBurns {
  const zoomIn = i % 2 === 0;
  const dir = [[-1, -1], [1, -1], [1, 1], [-1, 1]][i % 4];
  const d = 0.04;
  return {
    fromScale: zoomIn ? 1.0 : 1.14, toScale: zoomIn ? 1.14 : 1.0,
    fromX: -dir[0] * d, fromY: -dir[1] * d, toX: dir[0] * d, toY: dir[1] * d,
  };
}

/**
 * Plan del video: portada → (foto, tarjeta, foto, foto…) → cierre. Duración entre 30 y 60 s: con pocas
 * fotos cada escena dura más; con muchas, se usan las primeras (las favoritas van primero).
 */
export function buildVideoPlan(stats: WrappedStats, opts: { maxPhotos?: number } = {}): VideoPlan {
  const photos = stats.photos.filter((p) => !!p.url).slice(0, opts.maxPhotos ?? MAX_PHOTOS);
  const cards = buildWrappedCards(stats).filter((k) => TEXT_KINDS.has(k)).map((k) => buildCardSpec(k, stats, { includePhotos: false }));
  const cover = { kind: "text" as const, kicker: "IATOS Wrapped", title: `Tu ${stats.year} en viajes`, body: stats.firstName ? `${stats.firstName}, esto fue lo que viviste.` : "Esto fue lo que viviste." };
  const outro = { kind: "text" as const, kicker: `Gracias, ${stats.year}`, title: `Planea tu ${stats.year + 1}`, body: "traveliatos.life" };

  // Intercala: una tarjeta cada dos fotos (si hay fotos); si no hay fotos, solo tarjetas.
  type Draft = Omit<Extract<VideoScene, { kind: "text" }>, "start" | "dur"> | { kind: "photo"; photo: number };
  const middle: Draft[] = [];
  let c = 0;
  photos.forEach((_, i) => {
    middle.push({ kind: "photo", photo: i });
    if (i % 2 === 1 && c < cards.length) middle.push(textScene(cards[c++]));
  });
  while (c < cards.length) middle.push(textScene(cards[c++]));
  const drafts: Draft[] = [cover, ...middle, outro];

  const base = (d: Draft) => (d.kind === "photo" ? 3.4 : 3.2);
  let total = drafts.reduce((s, d) => s + base(d), 0);
  // Demasiado largo: quita fotos del final (nunca las tarjetas).
  while (total > VIDEO_MAX_S) {
    const idx = drafts.map((d) => d.kind).lastIndexOf("photo");
    if (idx < 0) break;
    total -= base(drafts[idx]);
    drafts.splice(idx, 1);
  }
  const stretch = total < VIDEO_MIN_S ? VIDEO_MIN_S / total : total > VIDEO_MAX_S ? VIDEO_MAX_S / total : 1;
  let t = 0;
  let k = 0;
  const scenes: VideoScene[] = drafts.map((d) => {
    const dur = Math.round(base(d) * stretch * 1000) / 1000;
    const start = t;
    t += dur;
    if (d.kind === "photo") {
      const p = photos[d.photo];
      return { kind: "photo", start, dur, photo: d.photo, caption: p.caption ?? null, place: p.place ?? null, kb: kenBurns(k++) };
    }
    return { ...d, start, dur };
  });
  return { year: stats.year, total: Math.round(t * 1000) / 1000, scenes, photos: photos.map((p) => p.url) };
}

/** Escena(s) visibles en t: la actual y, durante la transición, la siguiente con su opacidad. */
export function scenesAt(plan: VideoPlan, t: number): Array<{ scene: VideoScene; alpha: number; progress: number }> {
  const clamped = Math.max(0, Math.min(t, plan.total - 1e-6));
  const i = plan.scenes.findIndex((s) => clamped >= s.start && clamped < s.start + s.dur);
  if (i < 0) return [];
  const cur = plan.scenes[i];
  const progress = (clamped - cur.start) / cur.dur;
  const out = [{ scene: cur, alpha: 1, progress }];
  const next = plan.scenes[i + 1];
  const left = cur.start + cur.dur - clamped;
  if (next && left < FADE_S) out.push({ scene: next, alpha: 1 - left / FADE_S, progress: 0 });
  return out;
}

const ease = (x: number) => x * x * (3 - 2 * x);

type Ctx = CanvasRenderingContext2D;
type Img = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };

function size(img: Img): { w: number; h: number } {
  const w = Number(img.naturalWidth || (typeof img.width === "number" ? img.width : 0)) || 1;
  const h = Number(img.naturalHeight || (typeof img.height === "number" ? img.height : 0)) || 1;
  return { w, h };
}

function lines(ctx: Ctx, text: string, maxW: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.slice(0, max);
}

function drawBackdrop(ctx: Ctx) {
  ctx.fillStyle = INK; ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  const g = ctx.createRadialGradient(VIDEO_W / 2, VIDEO_H * 0.2, 30, VIDEO_W / 2, VIDEO_H * 0.45, VIDEO_H * 0.9);
  g.addColorStop(0, "#3b301c"); g.addColorStop(0.5, "#15110b"); g.addColorStop(1, INK);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
}

function drawText(ctx: Ctx, s: Extract<VideoScene, { kind: "text" }>, p: number) {
  drawBackdrop(ctx);
  const M = 64, CW = VIDEO_W - M * 2;
  const rise = (1 - ease(Math.min(1, p * 3))) * 30;
  let y = VIDEO_H * 0.36 + rise;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = GOLD; ctx.font = `700 22px ${SANS}`;
  ctx.fillText(s.kicker.toUpperCase(), M, y);
  y += 24;
  if (s.title) {
    ctx.fillStyle = IVORY; ctx.font = `italic 600 64px ${SERIF}`;
    for (const l of lines(ctx, s.title, CW, 3)) { y += 72; ctx.fillText(l, M, y); }
    y += 16;
  }
  if (s.big) {
    ctx.fillStyle = GOLD_LIGHT; ctx.font = `600 150px ${SERIF}`;
    y += 140; ctx.fillText(s.big, M - 4, y);
    if (s.unit) { ctx.fillStyle = IVORY; ctx.font = `500 34px ${SANS}`; y += 52; ctx.fillText(s.unit, M, y); }
    y += 10;
  }
  if (s.body) {
    ctx.fillStyle = "rgba(245,235,221,0.85)"; ctx.font = `500 28px ${SANS}`;
    for (const l of lines(ctx, s.body, CW, 4)) { y += 40; ctx.fillText(l, M, y); }
  }
}

function drawPhoto(ctx: Ctx, s: Extract<VideoScene, { kind: "photo" }>, p: number, img: Img | null | undefined) {
  ctx.fillStyle = INK; ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  if (img) {
    const e = ease(p);
    const scale = s.kb.fromScale + (s.kb.toScale - s.kb.fromScale) * e;
    const ox = (s.kb.fromX + (s.kb.toX - s.kb.fromX) * e) * VIDEO_W;
    const oy = (s.kb.fromY + (s.kb.toY - s.kb.fromY) * e) * VIDEO_H;
    const { w, h } = size(img);
    const cover = Math.max(VIDEO_W / w, VIDEO_H / h) * scale * 1.1; // 10 % de margen para desplazarse
    const dw = w * cover, dh = h * cover;
    ctx.drawImage(img, (VIDEO_W - dw) / 2 + ox, (VIDEO_H - dh) / 2 + oy, dw, dh);
  }
  const g = ctx.createLinearGradient(0, VIDEO_H * 0.6, 0, VIDEO_H);
  g.addColorStop(0, "rgba(10,10,10,0)"); g.addColorStop(1, "rgba(10,10,10,0.85)");
  ctx.fillStyle = g; ctx.fillRect(0, VIDEO_H * 0.6, VIDEO_W, VIDEO_H * 0.4);
  const text = s.place || s.caption;
  if (text) {
    ctx.textAlign = "left"; ctx.fillStyle = IVORY; ctx.font = `italic 500 40px ${SERIF}`;
    const ls = lines(ctx, text, VIDEO_W - 128, 2);
    ls.forEach((l, i) => ctx.fillText(l, 64, VIDEO_H - 150 - (ls.length - 1 - i) * 48));
  }
}

/** Dibuja el cuadro del instante t (segundos). `images[i]` es la foto i del plan (o null si no cargó). */
export function drawVideoFrame(ctx: Ctx, plan: VideoPlan, t: number, images: Array<Img | null>) {
  const visible = scenesAt(plan, t);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK; ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  for (const v of visible) {
    ctx.globalAlpha = v.alpha;
    if (v.scene.kind === "photo") drawPhoto(ctx, v.scene, v.progress, images[v.scene.photo]);
    else drawText(ctx, v.scene, v.progress);
  }
  ctx.globalAlpha = 1;
  // Marco y firma, siempre.
  ctx.strokeStyle = "rgba(201,169,97,0.7)"; ctx.lineWidth = 2; ctx.strokeRect(24, 24, VIDEO_W - 48, VIDEO_H - 48);
  ctx.fillStyle = GOLD; ctx.font = `600 26px ${SERIF}`; ctx.textAlign = "left"; ctx.fillText("IATOS", 52, 82);
  ctx.textAlign = "right"; ctx.font = `700 16px ${SANS}`; ctx.fillText(`WRAPPED ${plan.year}`, VIDEO_W - 52, 78);
  ctx.textAlign = "center"; ctx.fillStyle = "rgba(201,169,97,0.85)"; ctx.font = `700 15px ${SANS}`;
  ctx.fillText(`TU ${plan.year} EN VIAJES · IATOS`, VIDEO_W / 2, VIDEO_H - 56);
  ctx.textAlign = "left";
  // Barra de avance.
  const prog = Math.max(0, Math.min(1, t / plan.total));
  ctx.fillStyle = "rgba(245,235,221,0.2)"; ctx.fillRect(52, 40, VIDEO_W - 104, 3);
  ctx.fillStyle = GOLD_LIGHT; ctx.fillRect(52, 40, (VIDEO_W - 104) * prog, 3);
  ctx.restore();
}

// ───────────────────────── grabación ─────────────────────────
type RecorderCtor = { new (stream: MediaStream, opts?: MediaRecorderOptions): MediaRecorder; isTypeSupported?: (t: string) => boolean };

/** Formatos en orden de preferencia: MP4 (Safari, Chrome reciente) y si no, WebM. */
export const RECORDER_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function pickRecorderType(MR: RecorderCtor | undefined | null): string | null {
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  return RECORDER_TYPES.find((t) => { try { return MR.isTypeSupported!(t); } catch { return false; } }) ?? null;
}

export type RecordSupport = { ok: true; mime: string } | { ok: false; reason: string };

/** ¿Este navegador puede grabar el video? Si no, el motivo en palabras simples. */
export function recordSupport(env: { MediaRecorder?: RecorderCtor; canvasCaptureStream?: boolean } = {
  MediaRecorder: typeof MediaRecorder !== "undefined" ? (MediaRecorder as unknown as RecorderCtor) : undefined,
  canvasCaptureStream: typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function",
}): RecordSupport {
  if (!env.MediaRecorder) return { ok: false, reason: "Tu navegador no permite grabar video desde la página." };
  if (!env.canvasCaptureStream) return { ok: false, reason: "Tu navegador no permite convertir la animación en video." };
  const mime = pickRecorderType(env.MediaRecorder);
  if (!mime) return { ok: false, reason: "Tu navegador no sabe guardar video en MP4 ni en WebM." };
  return { ok: true, mime };
}

export const extensionFor = (mime: string) => (mime.startsWith("video/mp4") ? "mp4" : "webm");
export const videoFilename = (year: number, mime: string) => `iatos-wrapped-${year}.${extensionFor(mime)}`;

export type RecordDeps = {
  canvas: HTMLCanvasElement;
  MediaRecorder: RecorderCtor;
  mime: string;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};

/** Graba el plan en tiempo real (dura lo que dura el video) y devuelve el archivo. */
export function recordVideo(plan: VideoPlan, images: Array<Img | null>, deps: RecordDeps): Promise<Blob> {
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancelRaf = deps.cancelRaf ?? ((id) => cancelAnimationFrame(id));
  const ctx = deps.canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("sin_canvas"));
  const stream = (deps.canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(VIDEO_FPS);
  const rec = new deps.MediaRecorder(stream, { mimeType: deps.mime, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  return new Promise<Blob>((resolve, reject) => {
    let id = 0;
    let aborted = false;
    const stopTracks = () => { try { stream.getTracks?.().forEach((t) => t.stop()); } catch { /* nada */ } };
    rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stopTracks();
      if (aborted) return reject(new Error("cancelado"));
      const blob = new Blob(chunks, { type: deps.mime.split(";")[0] });
      if (!blob.size) return reject(new Error("video_vacio"));
      resolve(blob);
    };
    rec.onerror = () => { cancelRaf(id); stopTracks(); reject(new Error("grabacion_fallo")); };
    deps.signal?.addEventListener("abort", () => { aborted = true; cancelRaf(id); try { rec.stop(); } catch { reject(new Error("cancelado")); } });
    drawVideoFrame(ctx, plan, 0, images);
    rec.start(1000);
    const t0 = now();
    const tick = () => {
      if (aborted) return;
      const t = (now() - t0) / 1000;
      drawVideoFrame(ctx, plan, Math.min(t, plan.total), images);
      deps.onProgress?.(Math.min(1, t / plan.total));
      if (t >= plan.total) { try { rec.stop(); } catch { reject(new Error("grabacion_fallo")); } return; }
      id = raf(tick);
    };
    id = raf(tick);
  });
}
