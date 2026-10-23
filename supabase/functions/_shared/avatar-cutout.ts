// Recorte de la persona (y de los objetos del inventario) SIN IA y sin costo: la imagen se genera sobre
// un fondo verde croma plano (#00FF00) y aquí se quita ese verde con un relleno por inundación desde
// los bordes, con borde suave y sin halo verde. Lógica pura sobre RGBA (avatar-png.ts): corre en la
// función, en el navegador y en Vitest.
//
// Por qué así (ver docs en el reporte del grupo avatar-inventario):
//   · Generamos nosotros la imagen, así que el fondo lo elegimos: un color que no existe en la piel,
//     el pelo ni el atuendo (el prompt prohíbe verde en la ropa) se separa con aritmética.
//   · Inundación desde los bordes: un ojo verde o un detalle verde DENTRO de la persona no se borra
//     (no está conectado con el fondo), salvo que sea casi idéntico al verde croma.
//   · Las librerías de recorte con IA no convienen: @imgly/background-removal es AGPL; RMBG-1.4 no
//     permite uso comercial; rembg/BiRefNet (MIT) necesitan Python u ONNX de ~100 MB (no caben en
//     una Edge Function); MediaPipe (Apache-2.0) solo corre en el navegador, está entrenado con
//     fotos reales y deja el pelo tosco.
import { makeRaster, type Raster } from "./avatar-png.ts";

/** Verde croma que se pide al modelo. */
export const CHROMA_HEX = "#00FF00";
export const CHROMA_RGB: [number, number, number] = [0, 255, 0];

export type CutoutOptions = {
  /** Distancia RGB al verde por debajo de la cual el píxel es fondo puro (alfa 0). */
  inner?: number;
  /** Distancia RGB por encima de la cual es figura (alfa 255). Entre ambas: borde suave. */
  outer?: number;
};

export type CutoutReport = {
  ok: boolean;
  /** Motivo si no se pudo: el modelo no respetó el fondo plano, o casi no quedó figura. */
  motivo?: "fondo_no_uniforme" | "sin_figura" | "sin_fondo";
  /** Verde que se detectó en los bordes. */
  key: [number, number, number];
  /** Fracción de los bordes (arriba, izquierda, derecha) que era verde croma. */
  bordeVerde: number;
  /** Fracción de la imagen que quedó transparente. */
  transparente: number;
  /** Fracción de píxeles de la figura que aún se ven verdosos (debe ser ~0). */
  halo: number;
};

const isGreenish = (r: number, g: number, b: number) => g > 120 && g - Math.max(r, b) > 60;

/**
 * Quita el fondo verde. Regresa una imagen nueva con alfa y un reporte. Si `ok` es false, la imagen
 * regresa sin cambios (opaca) para que quien llama use su respaldo.
 */
export function chromaCutout(src: Raster, opts: CutoutOptions = {}): { image: Raster; report: CutoutReport } {
  const inner = opts.inner ?? 90;
  const outer = opts.outer ?? 170;
  const { width: w, height: h, data: s } = src;

  // 1) Verde real del fondo: mediana de los bordes de arriba, izquierda y derecha (abajo suele estar
  //    el pecho de la persona, que toca el borde).
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  let borde = 0;
  const visit = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    borde++;
    if (isGreenish(s[p], s[p + 1], s[p + 2])) { rs.push(s[p]); gs.push(s[p + 1]); bs.push(s[p + 2]); }
  };
  for (let x = 0; x < w; x++) visit(x, 0);
  for (let y = 1; y < h; y++) { visit(0, y); visit(w - 1, y); }
  const med = (a: number[]) => { const c = [...a].sort((x, y) => x - y); return c.length ? c[c.length >> 1] : 0; };
  const key: [number, number, number] = rs.length ? [med(rs), med(gs), med(bs)] : [...CHROMA_RGB];
  const bordeVerde = rs.length / Math.max(1, borde);
  const fail = (motivo: CutoutReport["motivo"]) => ({
    image: { width: w, height: h, data: new Uint8ClampedArray(s) },
    report: { ok: false, motivo, key, bordeVerde, transparente: 0, halo: 0 },
  });
  if (bordeVerde < 0.8) return fail("fondo_no_uniforme");

  // 2) Distancia de cada píxel al verde del fondo (o al verde puro, la menor: tolera degradados).
  const n = w * h;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = s[i * 4], g = s[i * 4 + 1], b = s[i * 4 + 2];
    const d1 = Math.hypot(r - key[0], g - key[1], b - key[2]);
    // "Verdor" relativo: un verde más claro u oscuro que el de la mediana sigue siendo fondo.
    const spill = g - Math.max(r, b);
    const d2 = spill > 0 ? Math.max(0, 255 - spill) * 0.9 + Math.max(r, b) * 0.4 : 999;
    dist[i] = Math.min(d1, d2);
  }

  // 3) Inundación desde todos los bordes por píxeles "de fondo o de borde" (dist < outer).
  const region = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const seed = (i: number) => { if (!region[i] && dist[i] < outer) { region[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    // Solo se avanza desde píxeles claramente de fondo: el borde suave no "salta" hacia adentro.
    if (dist[i] >= inner + (outer - inner) * 0.5) continue;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }

  // 4) Alfa: en la región, rampa suave entre inner y outer; fuera, opaco. Huecos encerrados (entre el
  //    pelo, bajo el brazo) casi idénticos al verde croma también se quitan.
  const near = dilate(region, w, h, 2);
  const out = makeRaster(w, h);
  const d = out.data;
  let transparentes = 0, figura = 0, verdosos = 0;
  for (let i = 0; i < n; i++) {
    let a = 255;
    const enclosed = dist[i] < inner * 0.6;
    if (region[i] || enclosed) a = Math.round(255 * Math.min(1, Math.max(0, (dist[i] - inner) / (outer - inner))));
    let r = s[i * 4], g = s[i * 4 + 1], b = s[i * 4 + 2];
    if (a < 255 || near[i]) {
      // Des-mezcla del verde en el borde suave y tope del canal verde (sin halo verde en el pelo).
      // Si la des-mezcla da un color imposible (el alfa estimado no cuadra), solo se quita el verde.
      const af = a / 255;
      if (af > 0.05 && af < 1) {
        const ur = (r - key[0] * (1 - af)) / af, ug = (g - key[1] * (1 - af)) / af, ub = (b - key[2] * (1 - af)) / af;
        if (Math.min(ur, ug, ub) > -25 && Math.max(ur, ug, ub) < 280) { r = ur; g = ug; b = ub; }
      }
      g = Math.min(g, Math.max(r, b) + 6);
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
    if (a === 0) transparentes++;
    if (a > 200) {
      figura++;
      if (isGreenish(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) verdosos++;
    }
  }
  const transparente = transparentes / n;
  const halo = verdosos / Math.max(1, figura);
  if (transparente < 0.08) return fail("sin_fondo");
  if (figura / n < 0.05) return fail("sin_figura");
  return { image: out, report: { ok: true, key, bordeVerde, transparente, halo } };
}

/** Máscara dilatada `r` píxeles (máximo separable): el anillo junto al fondo también se des-verdea. */
function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = m[y * w + k];
    t[y * w + x] = v;
  }
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = t[k * w + x];
    o[y * w + x] = v;
  }
  return o;
}

/** Recorta al contenido visible (alfa > 8) y deja un margen; para los objetos del inventario. */
export function trimToContent(src: Raster, marginRatio = 0.04): Raster {
  const { width: w, height: h, data: s } = src;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (s[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return src;
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const m = Math.round(side * marginRatio);
  const size = side + m * 2;
  const out = makeRaster(size, size);
  const ox = Math.round((size - (x1 - x0 + 1)) / 2), oy = Math.round((size - (y1 - y0 + 1)) / 2);
  for (let y = y0; y <= y1; y++) {
    const from = (y * w + x0) * 4;
    out.data.set(s.subarray(from, from + (x1 - x0 + 1) * 4), ((y - y0 + oy) * size + ox) * 4);
  }
  return out;
}
