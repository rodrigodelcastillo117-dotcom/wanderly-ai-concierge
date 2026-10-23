// PNG sin dependencias para el avatar por capas: leer y escribir PNG de 8 bits RGBA, cambiar de tamaño
// y mezclar capas. Corre igual en Deno (Edge Functions), en el navegador y en Node/Vitest: la
// compresión usa CompressionStream("deflate") (zlib nativo de cada plataforma), nada de WASM ni npm.
//
// Por qué propio y no una librería: las de Deno/npm que hacen esto (imagescript, fast-png, pngjs) son
// MIT y servirían, pero son una dependencia remota más en las funciones y un paquete transitivo en el
// cliente; lo que necesitamos (PNG no entrelazado, RGBA de 8 bits) cabe en ~250 líneas probadas.
// Lo que no se soporta (PNG entrelazado, JPEG) regresa un error claro y quien llama usa su respaldo.

export type Raster = { width: number; height: number; data: Uint8ClampedArray };

export function makeRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

async function pump(stream: CompressionStream | DecompressionStream, bytes: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Sin await: si se espera la escritura antes de leer, la contrapresión puede atorar el flujo.
  writer.write(bytes as unknown as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const deflate = (b: Uint8Array) => pump(new CompressionStream("deflate"), b);
const inflate = (b: Uint8Array) => pump(new DecompressionStream("deflate"), b);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((v, i) => bytes[i] === v);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export class PngError extends Error {}

/** PNG (no entrelazado; gris, RGB, paleta, gris+alfa o RGBA; 1-16 bits) → RGBA de 8 bits. */
export async function decodePng(bytes: Uint8Array): Promise<Raster> {
  if (!isPng(bytes)) throw new PngError("no_es_png");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = view.getUint32(pos - 12 - len + 8);
      height = view.getUint32(pos - 12 - len + 12);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!width || !height || width > 8192 || height > 8192) throw new PngError("dimensiones_invalidas");
  if (interlace) throw new PngError("png_entrelazado");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new PngError("formato_no_soportado");
  let total = 0;
  for (const c of idat) total += c.length;
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  const raw = await inflate(joined);

  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = Math.ceil((width * bitsPP) / 8);
  if (raw.length < (stride + 1) * height) throw new PngError("datos_incompletos");
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const out = makeRaster(width, height);
  const px = out.data;
  const sample = (row: Uint8Array, x: number, ch: number): number => {
    // Valor 0-255 de un canal (escala bits < 8; de 16 bits toma el byte alto).
    if (depth === 8) return row[x * channels + ch];
    if (depth === 16) return row[(x * channels + ch) * 2];
    const bitIndex = (x * channels + ch) * depth;
    const v = (row[bitIndex >> 3] >> (8 - depth - (bitIndex & 7))) & ((1 << depth) - 1);
    return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    for (let i = 0; i < stride; i++) {
      const x = raw[src++];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new PngError("filtro_invalido");
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (ctype === 6) {
        px[d] = sample(cur, x, 0); px[d + 1] = sample(cur, x, 1); px[d + 2] = sample(cur, x, 2); px[d + 3] = sample(cur, x, 3);
      } else if (ctype === 2) {
        const r = sample(cur, x, 0), g = sample(cur, x, 1), b2 = sample(cur, x, 2);
        px[d] = r; px[d + 1] = g; px[d + 2] = b2;
        px[d + 3] = trns && trns.length >= 6 && depth === 8 && r === trns[1] && g === trns[3] && b2 === trns[5] ? 0 : 255;
      } else if (ctype === 3) {
        const idx = sample(cur, x, 0);
        if (!palette || idx * 3 + 2 >= palette.length) throw new PngError("paleta_invalida");
        px[d] = palette[idx * 3]; px[d + 1] = palette[idx * 3 + 1]; px[d + 2] = palette[idx * 3 + 2];
        px[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (ctype === 0) {
        const g = sample(cur, x, 0);
        px[d] = px[d + 1] = px[d + 2] = g; px[d + 3] = 255;
      } else {
        const g = sample(cur, x, 0);
        px[d] = px[d + 1] = px[d + 2] = g; px[d + 3] = sample(cur, x, 1);
      }
    }
    prev.set(cur);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const t = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  out.set(t, 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

/** ¿Todos los píxeles son opacos? (entonces se guarda en RGB: ~25 % menos peso). */
export function isOpaque(r: Raster): boolean {
  const d = r.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
  return true;
}

/** RGBA de 8 bits → PNG (RGB si es opaco). Filtro adaptativo por fila (el de menor suma absoluta). */
export async function encodePng(r: Raster): Promise<Uint8Array> {
  const { width, height, data } = r;
  const rgb = isOpaque(r);
  const bpp = rgb ? 3 : 4;
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, t = x * bpp;
      line[t] = data[s]; line[t + 1] = data[s + 1]; line[t + 2] = data[s + 2];
      if (!rgb) line[t + 3] = data[s + 3];
    }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], cc = i >= bpp ? prev[i - bpp] : 0;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, cc);
        const v = (line[i] - p) & 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // El candidato ganador pudo quedar a medias por el corte temprano: se recalcula completo.
    const c = cand[best];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], cc = i >= bpp ? prev[i - bpp] : 0;
      const p = best === 0 ? 0 : best === 1 ? a : best === 2 ? b : best === 3 ? (a + b) >> 1 : paeth(a, b, cc);
      c[i] = (line[i] - p) & 0xff;
    }
    raw[y * (stride + 1)] = best;
    raw.set(c, y * (stride + 1) + 1);
    prev.set(line);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = rgb ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ───────────── tamaño y mezcla ─────────────

/** Pesos de un filtro triangular separable (sirve para agrandar y para achicar sin "escalones"). */
function weights(src: number, dst: number): { idx: Int32Array; w: Float32Array; n: number } {
  const scale = src / dst;
  const support = Math.max(1, scale);
  const n = Math.ceil(support) * 2 + 1;
  const idx = new Int32Array(dst * n);
  const w = new Float32Array(dst * n);
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) * scale - 0.5;
    const start = Math.floor(center - support) + 1;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const j = start + k;
      const wt = Math.max(0, 1 - Math.abs((j - center) / support));
      idx[i * n + k] = Math.min(src - 1, Math.max(0, j));
      w[i * n + k] = wt;
      sum += wt;
    }
    for (let k = 0; k < n; k++) w[i * n + k] = sum > 0 ? w[i * n + k] / sum : 0;
  }
  return { idx, w, n };
}

/** Cambia el tamaño con alfa premultiplicado (los bordes transparentes no se oscurecen). */
export function resize(src: Raster, dw: number, dh: number): Raster {
  dw = Math.max(1, Math.round(dw)); dh = Math.max(1, Math.round(dh));
  if (dw === src.width && dh === src.height) return { width: dw, height: dh, data: new Uint8ClampedArray(src.data) };
  const sw = src.width, sh = src.height, s = src.data;
  const pre = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = s[i * 4 + 3] / 255;
    pre[i * 4] = s[i * 4] * a; pre[i * 4 + 1] = s[i * 4 + 1] * a; pre[i * 4 + 2] = s[i * 4 + 2] * a; pre[i * 4 + 3] = s[i * 4 + 3];
  }
  const hx = weights(sw, dw);
  const tmp = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < hx.n; k++) {
        const wt = hx.w[x * hx.n + k];
        if (!wt) continue;
        const p = (y * sw + hx.idx[x * hx.n + k]) * 4;
        r += pre[p] * wt; g += pre[p + 1] * wt; b += pre[p + 2] * wt; a += pre[p + 3] * wt;
      }
      const t = (y * dw + x) * 4;
      tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
    }
  }
  const hy = weights(sh, dh);
  const out = makeRaster(dw, dh);
  const d = out.data;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < hy.n; k++) {
        const wt = hy.w[y * hy.n + k];
        if (!wt) continue;
        const p = (hy.idx[y * hy.n + k] * dw + x) * 4;
        r += tmp[p] * wt; g += tmp[p + 1] * wt; b += tmp[p + 2] * wt; a += tmp[p + 3] * wt;
      }
      const o = (y * dw + x) * 4;
      const af = a / 255;
      d[o] = af > 0 ? r / af : 0; d[o + 1] = af > 0 ? g / af : 0; d[o + 2] = af > 0 ? b / af : 0; d[o + 3] = a;
    }
  }
  return out;
}

/** Recorte "cover" a un cuadrado de `size` (como object-fit: cover, centrado). */
export function coverSquare(src: Raster, size: number): Raster {
  const side = Math.min(src.width, src.height);
  const ox = Math.floor((src.width - side) / 2), oy = Math.floor((src.height - side) / 2);
  let sq = src;
  if (src.width !== src.height) {
    sq = makeRaster(side, side);
    for (let y = 0; y < side; y++) {
      const from = ((y + oy) * src.width + ox) * 4;
      sq.data.set(src.data.subarray(from, from + side * 4), y * side * 4);
    }
  }
  return resize(sq, size, size);
}

/**
 * Dibuja `src` sobre `dst` (operación "over") centrado en (cx, cy), girado `angleDeg` y con
 * `opacity`. Muestreo bilineal inverso: `src` ya debe venir del tamaño final.
 */
export function drawOver(dst: Raster, src: Raster, cx: number, cy: number, angleDeg = 0, opacity = 1): void {
  const rad = (angleDeg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = src.width / 2, hh = src.height / 2;
  const ext = Math.ceil(Math.abs(hw * cos) + Math.abs(hh * sin)) + 1;
  const eyt = Math.ceil(Math.abs(hw * sin) + Math.abs(hh * cos)) + 1;
  const x0 = Math.max(0, Math.floor(cx - ext)), x1 = Math.min(dst.width - 1, Math.ceil(cx + ext));
  const y0 = Math.max(0, Math.floor(cy - eyt)), y1 = Math.min(dst.height - 1, Math.ceil(cy + eyt));
  const s = src.data, d = dst.data, sw = src.width, sh = src.height;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = dx * cos + dy * sin + hw - 0.5;
      const v = -dx * sin + dy * cos + hh - 0.5;
      if (u < -1 || v < -1 || u > sw || v > sh) continue;
      const ux = Math.floor(u), vy = Math.floor(v), fx = u - ux, fy = v - vy;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const sx = ux + (k & 1), sy = vy + (k >> 1);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
        const p = (sy * sw + sx) * 4;
        const pa = s[p + 3] * wt;
        r += s[p] * pa; g += s[p + 1] * pa; b += s[p + 2] * pa; a += pa;
      }
      if (a <= 0) continue;
      const sa = (a / 255) * opacity;
      const o = (y * dst.width + x) * 4;
      const da = d[o + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;
      const cr = r / a, cg = g / a, cb = b / a;
      d[o] = (cr * sa + d[o] * da * (1 - sa)) / outA;
      d[o + 1] = (cg * sa + d[o + 1] * da * (1 - sa)) / outA;
      d[o + 2] = (cb * sa + d[o + 2] * da * (1 - sa)) / outA;
      d[o + 3] = outA * 255;
    }
  }
}

/** Sombra suave de una figura: su alfa desenfocado (caja separable, 2 pasadas) en negro. */
export function shadowOf(src: Raster, radius: number, strength = 0.35): Raster {
  const pad = radius * 2;
  const w = src.width + pad * 2, h = src.height + pad * 2;
  let a = new Float32Array(w * h);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) a[(y + pad) * w + x + pad] = src.data[(y * src.width + x) * 4 + 3];
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        t[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    const u = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        u[y * w + x] = acc / (2 * r + 1);
        acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
      }
    }
    a = u;
  }
  const out = makeRaster(w, h);
  for (let i = 0; i < w * h; i++) out.data[i * 4 + 3] = a[i] * strength;
  return out;
}
