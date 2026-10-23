// Avatar por capas: fondo de su país + persona recortada DE CUERPO COMPLETO + hasta 3 objetos de sus
// viajes. Sin IA y sin costo. La geometría la comparten la función (PNG públicos) y el cliente (vista
// previa instantánea con CSS), así lo que se ve al elegir es lo que se publica.
//
// Dos imágenes públicas por versión:
//   · cuerpo completo (4:5): Perfil, tarjeta del Travel DNA, imagen para compartir;
//   · recorte de la cara (cuadrado): profiles.avatar_url → todos los círculos (menú, barra, amigos).
//     Con cuerpo completo la cara ocupa ~8 % de la imagen y en un círculo de 32 px no se reconocería.
//
// "En la mano": el retrato se genera con la mano derecha levantada frente al pecho, vacía y con los
// dedos curvos; el juez de parecido (la misma llamada que ya se paga al crear) marca dónde quedó esa
// mano y ahí se coloca el objeto principal, un poco arriba del puño, como quien lo presume. Los demás
// objetos van a sus pies, a los lados. Si no hay punto de la mano (modo por rasgos o el juez no lo
// dio), el principal también va a los pies. Nada toca la cara ni la cabeza (headBox).
import { drawOver, makeRaster, resize, shadowOf, type Raster } from "./avatar-png.ts";

/** Lienzo del avatar de cuerpo completo (4:5). */
export const CANVAS = { w: 1024, h: 1280 };
/** Lado del recorte de la cara (círculos). */
export const FACE_SIZE = 512;

/** Rectángulo de la cara en la imagen de la persona: centro y lado, en fracciones (lado = fracción del alto). */
export type FaceRect = { cx: number; cy: number; side: number };
/** Punto de la mano levantada en la imagen de la persona (fracciones), o null. */
export type HandPoint = [number, number] | null;

/** Caja en píxeles del lienzo (centro, lado, giro). */
export type Slot = { cx: number; cy: number; size: number; rot: number; enMano?: boolean };

/** Dónde queda la persona en el lienzo: ajustada ("contain"), centrada y apoyada abajo. */
export function personaRect(pw: number, ph: number, c = CANVAS): { x: number; y: number; w: number; h: number } {
  const k = Math.min(c.w / pw, c.h / ph);
  const w = pw * k, h = ph * k;
  return { x: (c.w - w) / 2, y: c.h - h, w, h };
}

/**
 * Rectángulo de la cara a partir del alfa de la persona recortada (determinista, sin IA). Cuerpo
 * completo: la cabeza es ~1/6 del alto de la figura (lo pide el prompt). Si la figura es ancha y baja
 * (retrato de busto, avatares de antes), la cara es la mitad de arriba.
 */
export function faceRectFromAlpha(p: Raster): FaceRect {
  const { width: w, height: h, data: d } = p;
  let top = -1, bottom = -1, maxW = 0;
  const rowCount = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 128) n++;
    rowCount[y] = n;
    if (n > w * 0.01) { if (top < 0) top = y; bottom = y; }
    if (n > maxW) maxW = n;
  }
  if (top < 0) return { cx: 0.5, cy: 0.3, side: 0.5 };
  const H = bottom - top + 1;
  const busto = H / Math.max(1, maxW) < 1.4;
  const band = Math.max(2, Math.round(H * (busto ? 0.35 : 0.14)));
  let sx = 0, sn = 0;
  for (let y = top; y < Math.min(h, top + band); y++) {
    for (let x = 0; x < w; x++) { const a = d[(y * w + x) * 4 + 3]; if (a > 128) { sx += x * a; sn += a; } }
  }
  const cxPx = sn ? sx / sn : w / 2;
  const cyPx = top + H * (busto ? 0.42 : 0.1);
  const sidePx = Math.min(h, Math.max(h * 0.12, H * (busto ? 0.85 : 0.3)));
  return { cx: cxPx / w, cy: cyPx / h, side: sidePx / h };
}

/** Caja de la cabeza en el lienzo (para que ningún objeto la toque). */
export function headBox(cara: FaceRect, pr: { x: number; y: number; w: number; h: number }) {
  const s = cara.side * pr.h;
  const cx = pr.x + cara.cx * pr.w, cy = pr.y + cara.cy * pr.h;
  return { x0: cx - s * 0.36, x1: cx + s * 0.36, y0: cy - s * 0.55, y1: cy + s * 0.2 };
}

/** Cuadro del recorte de la cara en el lienzo (cuadrado, dentro del lienzo). */
export function faceCropBox(cara: FaceRect, pr: { x: number; y: number; w: number; h: number }, c = CANVAS) {
  const side = Math.min(c.w, c.h, Math.max(64, cara.side * pr.h));
  const cx = pr.x + cara.cx * pr.w, cy = pr.y + cara.cy * pr.h;
  const x = Math.min(c.w - side, Math.max(0, cx - side / 2));
  const y = Math.min(c.h - side, Math.max(0, cy - side / 2));
  return { x, y, side };
}

const intersects = (s: Slot, b: { x0: number; x1: number; y0: number; y1: number }) => {
  const half = s.size * 0.6; // margen por el giro
  return s.cx + half > b.x0 && s.cx - half < b.x1 && s.cy + half > b.y0 && s.cy - half < b.y1;
};

/**
 * Lugares de n objetos en el lienzo. El primero en la mano (si se conoce), los demás a los pies.
 * Ninguno toca la cabeza.
 */
export function slotsFor(n: number, opts: { pw: number; ph: number; cara: FaceRect; mano: HandPoint }, c = CANVAS): Slot[] {
  if (n <= 0) return [];
  const pr = personaRect(opts.pw, opts.ph, c);
  const head = headBox(opts.cara, pr);
  const floorL: Slot = { cx: c.w * 0.15, cy: c.h * 0.885, size: c.w * 0.2, rot: -6 };
  const floorR: Slot = { cx: c.w * 0.85, cy: c.h * 0.885, size: c.w * 0.2, rot: 6 };
  const sideL: Slot = { cx: c.w * 0.14, cy: c.h * 0.7, size: c.w * 0.16, rot: -4 };
  let hand: Slot | null = null;
  if (opts.mano && opts.mano.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
    const size = Math.max(c.w * 0.12, Math.min(c.w * 0.24, opts.cara.side * pr.h * 0.62));
    const hx = pr.x + opts.mano[0] * pr.w, hy = pr.y + opts.mano[1] * pr.h;
    // Una "mano" dentro de la cabeza es un error del juez: el objeto va a los pies.
    const enCabeza = hx > head.x0 && hx < head.x1 && hy > head.y0 && hy < head.y1;
    if (!enCabeza) hand = { cx: hx, cy: hy - size * 0.3, size, rot: -5, enMano: true };
    // Si quedara sobre la cara o la cabeza, baja hasta salir (y si no cabe, a los pies).
    for (let i = 0; hand && i < 12 && intersects(hand, head); i++) hand = { ...hand, cy: hand.cy + size * 0.15 };
    if (hand && (intersects(hand, head) || hand.cy + hand.size / 2 > c.h)) hand = null;
  }
  const order = hand ? [hand, floorR, floorL] : [floorR, floorL, sideL];
  return order.slice(0, Math.min(3, n));
}

/** Respaldo sin imagen de fondo (país sin fondos aún o asset no generado): el degradado de siempre. */
export function backdropGradient(w: number, h: number): Raster {
  const out = makeRaster(w, h);
  const d = out.data;
  const cx = w * 0.5, cy = h * 0.3, maxR = Math.max(w, h) * 0.7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      // espresso (#2a1a10) arriba → carbón (#141414) abajo, con brillo dorado detrás de la cabeza.
      let r = 42 + (20 - 42) * t, g = 26 + (20 - 26) * t, b = 16 + (20 - 16) * t;
      const glow = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / maxR) ** 2 * 0.45;
      r += (212 - r) * glow; g += (175 - g) * glow; b += (55 - b) * glow;
      const o = (y * w + x) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  return out;
}

/** Recorte tipo "cover" a w×h (centrado). */
export function cover(src: Raster, w: number, h: number): Raster {
  const k = Math.max(w / src.width, h / src.height);
  const sw = Math.round(w / k), sh = Math.round(h / k);
  const ox = Math.floor((src.width - sw) / 2), oy = Math.floor((src.height - sh) / 2);
  return resize(crop(src, ox, oy, sw, sh), w, h);
}

export function crop(src: Raster, x: number, y: number, w: number, h: number): Raster {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.min(src.width - x, Math.round(w)); h = Math.min(src.height - y, Math.round(h));
  const out = makeRaster(w, h);
  for (let r = 0; r < h; r++) {
    const from = ((y + r) * src.width + x) * 4;
    out.data.set(src.data.subarray(from, from + w * 4), r * w * 4);
  }
  return out;
}

export type LayerInput = {
  /** Fondo del país (cualquier tamaño; se recorta tipo cover). null = degradado de respaldo. */
  fondo: Raster | null;
  /** Persona recortada (PNG con alfa), cuerpo completo. */
  persona: Raster;
  /** Objetos recortados, en el orden en que se muestran (el primero, en la mano). */
  objetos: Raster[];
  cara?: FaceRect | null;
  mano?: HandPoint;
};

/** Compone el avatar: imagen de cuerpo completo (4:5) y recorte de la cara (cuadrado). Sin red. */
export function composeAvatar(input: LayerInput, c = CANVAS): { full: Raster; face: Raster; cara: FaceRect } {
  const canvas = input.fondo ? cover(input.fondo, c.w, c.h) : backdropGradient(c.w, c.h);
  for (let i = 3; i < canvas.data.length; i += 4) canvas.data[i] = 255;
  const pr = personaRect(input.persona.width, input.persona.height, c);
  const persona = resize(input.persona, pr.w, pr.h);
  drawOver(canvas, persona, pr.x + pr.w / 2, pr.y + pr.h / 2);
  const cara = input.cara ?? faceRectFromAlpha(input.persona);
  const objetos = input.objetos.slice(0, 3);
  const slots = slotsFor(objetos.length, { pw: input.persona.width, ph: input.persona.height, cara, mano: input.mano ?? null }, c);
  slots.forEach((slot, i) => {
    const src = objetos[i];
    const k = slot.size / Math.max(src.width, src.height);
    const obj = resize(src, src.width * k, src.height * k);
    const shadow = shadowOf(obj, Math.max(2, Math.round(c.w * 0.008)), slot.enMano ? 0.3 : 0.42);
    drawOver(canvas, shadow, slot.cx + c.w * 0.004, slot.cy + c.w * (slot.enMano ? 0.008 : 0.014), slot.rot);
    drawOver(canvas, obj, slot.cx, slot.cy, slot.rot);
  });
  const box = faceCropBox(cara, pr, c);
  const face = resize(crop(canvas, box.x, box.y, box.side, box.side), FACE_SIZE, FACE_SIZE);
  return { full: canvas, face, cara };
}

/** Estilo CSS (porcentajes del lienzo) de un objeto para la vista previa del cliente: misma geometría. */
export function slotStyle(slot: Slot, c = CANVAS): { left: string; top: string; width: string; height: string; transform: string } {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return {
    left: pct((slot.cx - slot.size / 2) / c.w),
    top: pct((slot.cy - slot.size / 2) / c.h),
    width: pct(slot.size / c.w),
    height: pct(slot.size / c.h),
    transform: `rotate(${slot.rot}deg)`,
  };
}

/** Estilo CSS de la persona dentro del lienzo (vista previa). */
export function personaStyle(pw: number, ph: number, c = CANVAS): { left: string; top: string; width: string; height: string } {
  const r = personaRect(pw, ph, c);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return { left: pct(r.x / c.w), top: pct(r.y / c.h), width: pct(r.w / c.w), height: pct(r.h / c.h) };
}
