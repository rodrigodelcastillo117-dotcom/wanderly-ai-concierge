// Imagen para compartir de una tarjeta de IATOS Wrapped (canvas propio, 1080×1920, 9:16), sin
// dependencias. Se dibuja SOLO el CardSpec que recibe: con includePhotos = false (lo normal) el spec ya
// no trae fotos ni avatar (buildCardSpec), así que en la imagen tampoco hay forma de que se cuelen.
// Las fotos (enlaces firmados de Supabase) se piden con crossOrigin="anonymous"; si una no carga se
// deja el marco vacío.
import { loadImage, shareOrDownload, type ShareOutcome } from "@/lib/postcard";
import { visibleRouteLabels, type CardSpec } from "@/lib/wrapped";

export const SHARE_W = 1080;
export const SHARE_H = 1920;

const GOLD = "#C9A961";
const GOLD_LIGHT = "#E8D5A0";
const IVORY = "#F5EBDD";
const INK = "#0A0A0A";
const SERIF = "Fraunces, Georgia, serif";
const SANS = "Manrope, system-ui, sans-serif";

type Ctx = CanvasRenderingContext2D;
export type ShareImages = { photos: Array<HTMLImageElement | null>; photo: HTMLImageElement | null; avatar: HTMLImageElement | null };

function spacing(ctx: Ctx, px: number) {
  const c = ctx as Ctx & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

/** Parte el texto en líneas que caben en maxW (a lo más maxLines; la última termina en "…"). */
export function wrapLines(ctx: Pick<Ctx, "measureText">, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
  out[maxLines - 1] = `${last.replace(/\s+$/, "")}…`;
  return out;
}

function fit(ctx: Ctx, text: string, weight: string, family: string, start: number, maxW: number, min: number): number {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxW) { size -= 4; ctx.font = `${weight} ${size}px ${family}`; }
  return size;
}

function cover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLock(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(201,169,97,0.75)"; ctx.fillStyle = "rgba(201,169,97,0.75)"; ctx.lineWidth = s * 0.12;
  ctx.beginPath(); ctx.arc(cx, cy - s * 0.18, s * 0.28, Math.PI, 0); ctx.stroke();
  roundRect(ctx, cx - s * 0.42, cy - s * 0.2, s * 0.84, s * 0.62, s * 0.1); ctx.fill();
  ctx.restore();
}

export function drawCardSpec(ctx: Ctx, spec: CardSpec, year: number, imgs: ShareImages) {
  const W = SHARE_W, H = SHARE_H, M = 110, CW = W - M * 2;
  ctx.clearRect(0, 0, W, H);
  // Fondo: la foto del momento (si se incluye) o negro con brillo dorado.
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  if (imgs.photo && spec.photo) {
    cover(ctx, imgs.photo, 0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(10,10,10,0.7)"); g.addColorStop(0.22, "rgba(10,10,10,0.1)"); g.addColorStop(0.45, "rgba(10,10,10,0.55)"); g.addColorStop(0.62, "rgba(10,10,10,0.9)"); g.addColorStop(1, "rgba(10,10,10,0.98)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.18, 40, W * 0.5, H * 0.4, H * 0.9);
    g.addColorStop(0, "#3b301c"); g.addColorStop(0.45, "#15110b"); g.addColorStop(1, INK);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(201,169,97,0.07)"; ctx.lineWidth = 2;
    for (let i = 1; i < 9; i++) { ctx.beginPath(); ctx.arc(W / 2, H * 1.05, 180 * i, Math.PI, 0); ctx.stroke(); }
  }
  ctx.strokeStyle = "rgba(201,169,97,0.85)"; ctx.lineWidth = 3; ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.strokeStyle = "rgba(201,169,97,0.3)"; ctx.lineWidth = 1.5; ctx.strokeRect(58, 58, W - 116, H - 116);

  // Encabezado.
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.fillStyle = GOLD; ctx.font = `600 46px ${SERIF}`; spacing(ctx, 6);
  ctx.fillText("IATOS", M, 170);
  ctx.textAlign = "right"; ctx.font = `700 24px ${SANS}`; spacing(ctx, 7);
  ctx.fillText(`WRAPPED ${year}`, W - M, 166);
  ctx.textAlign = "left";

  // Con la foto del momento de fondo, el texto va en la mitad de abajo (sobre la parte oscura).
  const hero = !!(imgs.photo && spec.photo);
  let y = hero ? Math.round(H * 0.5) : 330;
  ctx.fillStyle = GOLD; ctx.font = `700 30px ${SANS}`; spacing(ctx, 8);
  ctx.fillText(spec.kicker.toUpperCase(), M, y);
  spacing(ctx, 0);
  y += 40;

  if (spec.avatar && imgs.avatar) {
    const r = 170, cx = W / 2, cy = y + r + 30;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ring.addColorStop(0, GOLD_LIGHT); ring.addColorStop(1, "#8C7238"); ctx.fillStyle = ring; ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip(); cover(ctx, imgs.avatar, cx - r, cy - r, r * 2, r * 2); ctx.restore();
    y = cy + r + 60;
  }

  if (spec.title) {
    const lines = (() => {
      fit(ctx, spec.title!, "italic 600", SERIF, 132, CW, 84);
      return wrapLines(ctx, spec.title!, CW, 2);
    })();
    const size = parseInt(ctx.font.match(/(\d+)px/)?.[1] ?? "96", 10);
    ctx.fillStyle = IVORY;
    for (const l of lines) { y += size * 1.05; ctx.fillText(l, M - 4, y); }
    y += 24;
  }

  if (spec.big) {
    const size = fit(ctx, spec.big, "600", SERIF, 300, CW, 120);
    const g = ctx.createLinearGradient(M, y, M + CW, y + size);
    g.addColorStop(0, GOLD_LIGHT); g.addColorStop(1, GOLD);
    ctx.fillStyle = g;
    y += size * 0.95; ctx.fillText(spec.big, M - 6, y);
    if (spec.bigUnit) { ctx.fillStyle = IVORY; ctx.font = `500 54px ${SANS}`; y += 76; ctx.fillText(spec.bigUnit, M, y); }
    y += 30;
  }

  if (spec.quote) {
    ctx.fillStyle = GOLD; ctx.font = `600 200px ${SERIF}`; ctx.fillText("“", M - 10, y + 150);
    ctx.fillStyle = IVORY; ctx.font = `italic 500 66px ${SERIF}`;
    y += 90;
    for (const l of wrapLines(ctx, spec.quote, CW, hero ? 5 : 6)) { y += 84; ctx.fillText(l, M, y); }
    y += 30;
  }

  if (spec.body) {
    ctx.fillStyle = "rgba(245,235,221,0.86)"; ctx.font = `500 42px ${SANS}`;
    for (const l of wrapLines(ctx, spec.body, CW, 4)) { y += 58; ctx.fillText(l, M, y); }
    y += 36;
  }

  if (spec.stats?.length) {
    const colW = CW / spec.stats.length;
    spec.stats.forEach((s, i) => {
      const x = M + i * colW;
      ctx.fillStyle = GOLD; fit(ctx, s.value, "600", SERIF, 96, colW - 24, 50); ctx.fillText(s.value, x, y + 96);
      ctx.fillStyle = "rgba(245,235,221,0.75)"; ctx.font = `600 26px ${SANS}`;
      wrapLines(ctx, s.label, colW - 24, 2).forEach((l, k) => ctx.fillText(l, x, y + 140 + k * 34));
    });
    y += 230;
  }

  if (spec.list?.length) {
    for (const it of spec.list) {
      y += 24;
      ctx.strokeStyle = "rgba(201,169,97,0.22)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
      y += 74;
      let x = M;
      if (it.lead) { ctx.font = `56px ${SANS}`; ctx.fillStyle = IVORY; ctx.fillText(it.lead, x, y); x += 86; }
      ctx.fillStyle = IVORY;
      const metaW = it.meta ? 200 : 0;
      fit(ctx, it.text, "500", SERIF, 54, W - M - x - metaW, 34); ctx.fillText(it.text, x, y);
      if (it.meta) { ctx.textAlign = "right"; ctx.fillStyle = GOLD; ctx.font = `600 32px ${SANS}`; ctx.fillText(it.meta, W - M, y); ctx.textAlign = "left"; }
    }
    y += 40;
  }

  if (spec.bars?.length) {
    const h = 420, gap = 14, bw = (CW - gap * (spec.bars.length - 1)) / spec.bars.length;
    const max = Math.max(1, ...spec.bars.map((b) => b.value));
    spec.bars.forEach((b, i) => {
      const x = M + i * (bw + gap);
      const bh = b.value > 0 ? Math.max(10, (b.value / max) * h) : 4;
      ctx.fillStyle = b.highlight ? GOLD : "rgba(245,235,221,0.18)";
      roundRect(ctx, x, y + h - bh, bw, bh, Math.min(12, bw / 2)); ctx.fill();
      ctx.fillStyle = b.highlight ? GOLD : "rgba(245,235,221,0.55)"; ctx.font = `700 26px ${SANS}`; ctx.textAlign = "center";
      ctx.fillText(b.label, x + bw / 2, y + h + 46); ctx.textAlign = "left";
    });
    y += h + 90;
  }

  if (spec.route && spec.route.points.length > 1) {
    const r = spec.route;
    const box = { x: M, y: y + 20, w: CW, h: CW / r.aspect };
    ctx.save(); roundRect(ctx, box.x, box.y, box.w, box.h, 18);
    ctx.fillStyle = "rgba(201,169,97,0.04)"; ctx.fill(); ctx.strokeStyle = "rgba(201,169,97,0.3)"; ctx.lineWidth = 2; ctx.stroke(); ctx.clip();
    ctx.strokeStyle = "rgba(245,235,221,0.08)"; ctx.lineWidth = 1.5;
    for (const gx of r.grid.xs) { ctx.beginPath(); ctx.moveTo(box.x + gx * box.w, box.y); ctx.lineTo(box.x + gx * box.w, box.y + box.h); ctx.stroke(); }
    for (const gy of r.grid.ys) { ctx.beginPath(); ctx.moveTo(box.x, box.y + gy * box.h); ctx.lineTo(box.x + box.w, box.y + gy * box.h); ctx.stroke(); }
    const P = r.points.map(([px, py]) => [box.x + px * box.w, box.y + py * box.h] as const);
    ctx.strokeStyle = "rgba(201,169,97,0.8)"; ctx.lineWidth = 3.5;
    for (const [a, b] of r.legs) {
      const [x1, y1] = P[a], [x2, y2] = P[b];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.22;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
    }
    const show = visibleRouteLabels(r);
    P.forEach(([x, yy], i) => {
      ctx.fillStyle = "rgba(201,169,97,0.25)"; ctx.beginPath(); ctx.arc(x, yy, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = GOLD_LIGHT; ctx.beginPath(); ctx.arc(x, yy, 10, 0, Math.PI * 2); ctx.fill();
      if (show[i]) {
        const right = show[i] === "left";
        ctx.fillStyle = IVORY; ctx.font = `600 26px ${SANS}`; ctx.textAlign = right ? "right" : "left";
        ctx.fillText(r.labels[i], right ? x - 22 : x + 22, yy + (yy < box.y + 60 ? 46 : -18));
        ctx.textAlign = "left";
      }
    });
    ctx.restore();
    y = box.y + box.h + 40;
  }

  const tiles = spec.photos?.length ?? spec.privatePhotos ?? 0;
  if (tiles > 0) {
    const cols = tiles === 1 ? 1 : 2, rows = Math.ceil(tiles / cols), gap = 22;
    const tw = (CW - gap * (cols - 1)) / cols;
    const th = Math.min(tw * 1.25, (H - 300 - y - gap * (rows - 1)) / rows);
    for (let i = 0; i < tiles; i++) {
      const x = M + (i % cols) * (tw + gap), ty = y + 20 + Math.floor(i / cols) * (th + gap);
      ctx.save(); roundRect(ctx, x, ty, tw, th, 22); ctx.clip();
      const img = spec.photos ? imgs.photos[i] : null;
      if (img) cover(ctx, img, x, ty, tw, th);
      else { ctx.fillStyle = "#17130d"; ctx.fillRect(x, ty, tw, th); drawLock(ctx, x + tw / 2, ty + th / 2, 70); }
      ctx.restore();
      ctx.strokeStyle = "rgba(201,169,97,0.45)"; ctx.lineWidth = 2; roundRect(ctx, x, ty, tw, th, 22); ctx.stroke();
    }
    y += 20 + rows * th + (rows - 1) * gap + 30;
  }

  if (spec.cta) {
    const bw = 520, bh = 116, bx = (W - bw) / 2, by = Math.max(y + 40, H - 520);
    const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh); g.addColorStop(0, GOLD); g.addColorStop(1, GOLD_LIGHT);
    ctx.fillStyle = g; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = INK; ctx.font = `700 42px ${SANS}`; ctx.textAlign = "center"; ctx.fillText(spec.cta.label, W / 2, by + 74); ctx.textAlign = "left";
  }

  // Pie.
  if (spec.footnote) {
    ctx.fillStyle = "rgba(245,235,221,0.6)"; ctx.font = `500 28px ${SANS}`;
    const lines = wrapLines(ctx, spec.footnote, CW, 3);
    lines.forEach((l, i) => ctx.fillText(l, M, H - 210 - (lines.length - 1 - i) * 40));
  }
  ctx.fillStyle = "rgba(201,169,97,0.9)"; ctx.font = `700 24px ${SANS}`; spacing(ctx, 7); ctx.textAlign = "center";
  ctx.fillText(`TU ${year} EN VIAJES · IATOS`, W / 2, H - 112);
  spacing(ctx, 0); ctx.textAlign = "left";
}

async function ensureFonts() {
  try {
    const f = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!f) return;
    await Promise.race([
      Promise.all([f.load("italic 600 120px Fraunces"), f.load("600 120px Fraunces"), f.load("500 40px Manrope"), f.load("700 30px Manrope")]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* sin fuentes: Georgia / system-ui */ }
}

/** PNG de la tarjeta (null si el navegador no tiene canvas). */
export async function renderCardImage(spec: CardSpec, year: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W; canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [, photos, photo, avatar] = await Promise.all([
    ensureFonts(),
    Promise.all((spec.photos ?? []).map((p) => loadImage(p.url))),
    loadImage(spec.photo ?? null),
    loadImage(spec.avatar ?? null),
  ]);
  const toBlob = () => new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
  try {
    drawCardSpec(ctx, spec, year, { photos, photo, avatar });
    return await toBlob();
  } catch {
    // Canvas "contaminado" por una imagen sin CORS: se repite sin imágenes externas.
    drawCardSpec(ctx, { ...spec, photos: undefined, photo: null, avatar: null, privatePhotos: spec.photos?.length ?? spec.privatePhotos }, year, { photos: [], photo: null, avatar: null });
    return await toBlob();
  }
}

export async function shareCardImage(spec: CardSpec, year: number, filename: string, preferDownload = false): Promise<ShareOutcome> {
  const blob = await renderCardImage(spec, year);
  if (!blob) return "failed";
  return shareOrDownload(blob, filename, `Mi ${year} en viajes con IATOS`, preferDownload, `Mi ${year} en viajes`);
}
