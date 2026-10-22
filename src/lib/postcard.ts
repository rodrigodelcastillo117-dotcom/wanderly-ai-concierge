/**
 * Postal de "viajes juntos": los dos avatares sobre la foto del destino, con timbre y matasellos,
 * dibujada en el navegador (canvas → PNG). Sin IA y sin subir nada: la imagen se genera y se
 * comparte (Web Share) o se descarga desde el dispositivo.
 *
 * Las imágenes se piden con crossOrigin="anonymous": si un servidor no permite CORS, esa imagen
 * simplemente no carga (no "ensucia" el canvas) y se usa el respaldo de marca (degradado o inicial).
 */

export const POSTCARD_W = 1080;
export const POSTCARD_H = 1350;

export type PostcardInput = {
  place: string;
  country?: string | null;
  year?: string | null;
  /** true = aún no viajan ahí (sueño o próximo viaje): "Próximo destino". */
  upcoming?: boolean;
  names: [string, string];
  avatars: [string | null, string | null];
  photoUrl?: string | null;
  /** La foto es ilustrativa (Pexels), no del viaje: se marca como tal, igual que en la app. */
  photoIsStock?: boolean;
  /** Sello dorado de miembro IATOS Privé junto a cada avatar. */
  prive?: [boolean, boolean];
};

const GOLD = "#C9A961";
const IVORY = "#F5EBDD";
const INK = "#0A0A0A";

/** "Rodrigo & Carlo · Roma 2026" */
export function postcardCaption(p: Pick<PostcardInput, "names" | "place" | "year" | "upcoming">): string {
  const tail = p.upcoming ? `${p.place} · Próximamente` : [p.place, p.year].filter(Boolean).join(" ");
  return `${p.names[0]} & ${p.names[1]} · ${tail}`;
}

export function postcardFilename(p: Pick<PostcardInput, "names" | "place" | "year">): string {
  const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `postal-${slug(p.names[0])}-${slug(p.names[1])}-${slug(p.place)}${p.year ? `-${p.year}` : ""}.png`.replace(/-+/g, "-");
}

export function loadImage(url: string | null | undefined, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (v: HTMLImageElement | null) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish(null), timeoutMs);
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.onload = () => { clearTimeout(t); finish(img.naturalWidth > 0 ? img : null); };
    img.onerror = () => { clearTimeout(t); finish(null); };
    img.src = url;
  });
}

/** Dibuja la imagen cubriendo el rectángulo; biasY 0 = arriba, 0.5 = centro (avatares: arriba). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, biasY = 0.5) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) * biasY;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, weight: string, start: number, maxW: number, min = 40): number {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 4;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function drawAvatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.beginPath(); ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, "#E8D5A0"); ring.addColorStop(0.5, GOLD); ring.addColorStop(1, "#8C7238");
  ctx.fillStyle = ring; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (img) {
    ctx.fillStyle = "#1a1610"; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2, 0.08);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, "#E8D5A0"); g.addColorStop(1, "#A8873F");
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(r * 0.9)}px Fraunces, Georgia, serif`;
    ctx.fillText((name.trim()[0] ?? "?").toUpperCase(), cx, cy + r * 0.05);
  }
  ctx.restore();
}

/** Sello Privé (roseta dorada con palomita), igual que PriveSeal. */
function drawPriveSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(201,169,97,0.6)"; ctx.shadowBlur = 18;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (Math.PI * i) / 12 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.83;
    const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, "#F3E3B0"); g.addColorStop(0.5, GOLD); g.addColorStop(1, "#8C7238");
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = r * 0.19; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.37, cy + r * 0.03);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.28);
  ctx.lineTo(cx + r * 0.38, cy - r * 0.25);
  ctx.stroke();
  ctx.restore();
}

/** Timbre dentado con "IATOS" y el año. */
type MakeCanvas = () => Pick<HTMLCanvasElement, "width" | "height" | "getContext">;
const defaultCanvas: MakeCanvas = () => document.createElement("canvas");

function drawStamp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, year: string, makeCanvas: MakeCanvas) {
  const off = makeCanvas();
  off.width = w; off.height = h;
  const s = off.getContext("2d") as CanvasRenderingContext2D | null;
  if (!s) return;
  s.fillStyle = "#F3E9D2"; s.fillRect(0, 0, w, h);
  s.globalCompositeOperation = "destination-out";
  const hole = 9, step = 26;
  for (let px = step / 2; px < w; px += step) { s.beginPath(); s.arc(px, 0, hole, 0, Math.PI * 2); s.arc(px, h, hole, 0, Math.PI * 2); s.fill(); }
  for (let py = step / 2; py < h; py += step) { s.beginPath(); s.arc(0, py, hole, 0, Math.PI * 2); s.arc(w, py, hole, 0, Math.PI * 2); s.fill(); }
  s.globalCompositeOperation = "source-over";
  s.strokeStyle = GOLD; s.lineWidth = 3; s.strokeRect(20, 20, w - 40, h - 40);
  const g = s.createLinearGradient(0, 30, 0, h - 30);
  g.addColorStop(0, "#1a1610"); g.addColorStop(1, "#2b2416");
  s.fillStyle = g; s.fillRect(26, 26, w - 52, h - 52);
  s.fillStyle = GOLD; s.textAlign = "center"; s.textBaseline = "middle";
  fitFont(s, "IATOS", "Fraunces, Georgia, serif", "600", 36, w - 70, 20);
  s.fillText("IATOS", w / 2, h * 0.36);
  s.font = "600 11px Manrope, system-ui, sans-serif";
  setSpacing(s, 2);
  s.fillText("VIAJES JUNTOS", w / 2 + 1, h * 0.54);
  s.font = "600 28px Manrope, system-ui, sans-serif";
  setSpacing(s, 3);
  s.fillStyle = IVORY;
  s.fillText(year, w / 2 + 1, h * 0.72);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((5 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
  ctx.drawImage(off as HTMLCanvasElement, -w / 2, -h / 2);
  ctx.restore();
}

/** Matasellos: doble aro con el lugar, y ondas a un lado. */
function drawPostmark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, place: string, year: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.strokeStyle = "rgba(245,235,221,0.78)";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r - 14, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(245,235,221,0.85)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "700 17px Manrope, system-ui, sans-serif";
  setSpacing(ctx, 4);
  ctx.fillText("SALUDOS", 0, -r * 0.42);
  const label = place.toUpperCase();
  fitFont(ctx, label, "Manrope, system-ui, sans-serif", "800", 30, r * 1.5, 14);
  setSpacing(ctx, 2);
  ctx.fillText(label, 0, 0);
  ctx.font = "700 20px Manrope, system-ui, sans-serif";
  ctx.fillText(year, 0, r * 0.42);
  ctx.lineWidth = 3;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    for (let px = -r - 170; px <= -r - 14; px += 4) {
      const py = i * 26 + Math.sin(px / 14) * 7;
      if (px === -r - 170) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export type PostcardImages = { photo: HTMLImageElement | null; avatars: [HTMLImageElement | null, HTMLImageElement | null] };

export function drawPostcard(ctx: CanvasRenderingContext2D, p: PostcardInput, imgs: PostcardImages, makeCanvas: MakeCanvas = defaultCanvas) {
  const W = POSTCARD_W, H = POSTCARD_H;
  ctx.clearRect(0, 0, W, H);
  // Fondo: la foto del destino o el degradado de la marca.
  if (imgs.photo) {
    drawCover(ctx, imgs.photo, 0, 0, W, H, 0.5);
  } else {
    const g = ctx.createRadialGradient(W * 0.3, H * 0.25, 60, W * 0.5, H * 0.5, H * 0.85);
    g.addColorStop(0, "#3a3020"); g.addColorStop(0.5, "#17130d"); g.addColorStop(1, INK);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(201,169,97,0.08)"; ctx.lineWidth = 2;
    for (let i = 1; i < 9; i++) { ctx.beginPath(); ctx.ellipse(W / 2, H * 0.62, 120 * i, 50 * i, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  top.addColorStop(0, "rgba(10,10,10,0.72)"); top.addColorStop(1, "rgba(10,10,10,0)");
  ctx.fillStyle = top; ctx.fillRect(0, 0, W, H * 0.42);
  const bottom = ctx.createLinearGradient(0, H * 0.42, 0, H);
  bottom.addColorStop(0, "rgba(10,10,10,0)"); bottom.addColorStop(0.55, "rgba(10,10,10,0.72)"); bottom.addColorStop(1, "rgba(10,10,10,0.96)");
  ctx.fillStyle = bottom; ctx.fillRect(0, H * 0.42, W, H * 0.58);

  // Marco dorado doble.
  ctx.strokeStyle = "rgba(201,169,97,0.9)"; ctx.lineWidth = 3; ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = "rgba(201,169,97,0.35)"; ctx.lineWidth = 1.5; ctx.strokeRect(54, 54, W - 108, H - 108);

  const year = p.year ?? String(new Date().getFullYear());
  // "Saludos desde" + destino grande.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 18;
  ctx.fillStyle = GOLD; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.font = "600 28px Manrope, system-ui, sans-serif";
  setSpacing(ctx, 9);
  ctx.fillText(p.upcoming ? "PRÓXIMO DESTINO" : "SALUDOS DESDE", 100, 170);
  setSpacing(ctx, 0);
  ctx.fillStyle = IVORY;
  fitFont(ctx, p.place, "Fraunces, Georgia, serif", "italic 600", 168, W - 200 - 230, 70);
  ctx.fillText(p.place, 94, 330);
  if (p.country) {
    ctx.font = "500 30px Manrope, system-ui, sans-serif";
    setSpacing(ctx, 4);
    ctx.fillStyle = "rgba(245,235,221,0.8)";
    ctx.fillText(p.country.toUpperCase(), 100, 392);
  }
  ctx.restore();

  drawStamp(ctx, W - 100 - 176, 92, 176, 214, year, makeCanvas);
  drawPostmark(ctx, W - 250, 430, 92, p.place, year);

  // Los dos avatares, encimados.
  const cy = 830, r = 172, gap = 150;
  drawAvatar(ctx, imgs.avatars[1], p.names[1], W / 2 + gap, cy, r);
  drawAvatar(ctx, imgs.avatars[0], p.names[0], W / 2 - gap, cy, r);
  // Sello Privé abajo a la izquierda/derecha de cada avatar (lado de afuera, no tapa el "&").
  if (p.prive?.[0]) drawPriveSeal(ctx, W / 2 - gap - r * 0.7, cy + r * 0.7, 40);
  if (p.prive?.[1]) drawPriveSeal(ctx, W / 2 + gap + r * 0.7, cy + r * 0.7, 40);
  // Sello "&" entre los dos.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(W / 2, cy + r - 18, 46, 0, Math.PI * 2);
  ctx.fillStyle = GOLD; ctx.fill();
  ctx.restore();
  ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "italic 600 52px Fraunces, Georgia, serif";
  ctx.fillText("&", W / 2, cy + r - 14);

  // Nombres y pie.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = IVORY;
  const names = `${p.names[0]} & ${p.names[1]}`;
  fitFont(ctx, names, "Fraunces, Georgia, serif", "600", 78, W - 220, 44);
  ctx.fillText(names, W / 2, 1140);
  ctx.fillStyle = GOLD;
  ctx.font = "600 26px Manrope, system-ui, sans-serif";
  setSpacing(ctx, 7);
  ctx.fillText((p.upcoming ? `${p.place} · próximamente` : `${p.place} · ${year}`).toUpperCase(), W / 2 + 3, 1196);
  ctx.fillStyle = "rgba(245,235,221,0.5)";
  ctx.font = "500 20px Manrope, system-ui, sans-serif";
  setSpacing(ctx, 6);
  ctx.fillText("HECHO CON IATOS", W / 2 + 3, H - 84);
  setSpacing(ctx, 0);
  if (imgs.photo && p.photoIsStock) {
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(245,235,221,0.55)";
    ctx.font = "500 16px Manrope, system-ui, sans-serif";
    ctx.fillText("Foto ilustrativa", W - 76, H - 66);
    ctx.textAlign = "center";
  }
}

async function ensureFonts() {
  try {
    const f = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!f) return;
    await Promise.race([
      Promise.all([f.load("italic 600 120px Fraunces"), f.load("600 60px Fraunces"), f.load("600 26px Manrope"), f.load("800 26px Manrope")]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* sin fuentes: Georgia / system-ui */ }
}

/** Genera la postal como PNG. null si el navegador no tiene canvas. */
export async function renderPostcard(p: PostcardInput): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = POSTCARD_W; canvas.height = POSTCARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [, photo, a0, a1] = await Promise.all([ensureFonts(), loadImage(p.photoUrl), loadImage(p.avatars[0]), loadImage(p.avatars[1])]);
  const imgs: PostcardImages = { photo, avatars: [a0, a1] };
  try {
    drawPostcard(ctx, p, imgs);
    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
  } catch {
    // Último recurso (no debería pasar con crossOrigin): sin fotos externas.
    drawPostcard(ctx, p, { photo: null, avatars: [null, null] });
    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
  }
}

export type ShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

/** Comparte con Web Share (si el dispositivo comparte archivos) o descarga el PNG. */
export async function shareOrDownload(blob: Blob, filename: string, text: string, preferDownload = false, title = "Postal IATOS"): Promise<ShareOutcome> {
  const file = typeof File !== "undefined" ? new File([blob], filename, { type: "image/png" }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!preferDownload && file && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text });
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
      // Si compartir falla por otra razón, se descarga.
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
