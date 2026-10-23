// Metadatos de fotos y videos de Recuerdos, sin dependencias y a nivel de bytes (probado con Vitest):
//   · readExifDate: fecha de captura del EXIF (DateTimeOriginal → DateTimeDigitized → DateTime) de un
//     JPEG, o de cualquier archivo que traiga un bloque "Exif\0\0" (HEIC/HEIF). La fecha EXIF es la hora
//     LOCAL de donde se tomó: el día del calendario sale tal cual, sin pasarlo por zonas horarias.
//   · exifHasGps: ¿trae ubicación GPS? (para comprobar que la copia que se sube ya no la tiene).
//   · readMp4Info / sanitizeMp4: fecha y duración de un MP4/MOV (caja mvhd) y una copia SIN las cajas
//     donde viven la ubicación y los datos de la cámara (udta, meta y uuid/XMP). No se borran (eso
//     movería los datos del video y lo rompería): se convierten en cajas 'free' del mismo tamaño
//     llenas de ceros, que los reproductores ignoran.

// ───────────────────────── EXIF ─────────────────────────
export type ExifDate = { date: string; time: string | null; offset: string | null };

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = "";
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

type Tiff = { b: Uint8Array; base: number; le: boolean };
const u16 = (t: Tiff, o: number) => {
  const i = t.base + o;
  if (i + 2 > t.b.length) throw new Error("exif_corto");
  return t.le ? t.b[i] | (t.b[i + 1] << 8) : (t.b[i] << 8) | t.b[i + 1];
};
const u32 = (t: Tiff, o: number) => {
  const i = t.base + o;
  if (i + 4 > t.b.length) throw new Error("exif_corto");
  return t.le
    ? (t.b[i] | (t.b[i + 1] << 8) | (t.b[i + 2] << 16) | (t.b[i + 3] << 24)) >>> 0
    : ((t.b[i] << 24) | (t.b[i + 1] << 16) | (t.b[i + 2] << 8) | t.b[i + 3]) >>> 0;
};

function tiffAt(b: Uint8Array, base: number): Tiff | null {
  if (base + 8 > b.length) return null;
  const order = ascii(b, base, 2);
  if (order !== "II" && order !== "MM") return null;
  const t = { b, base, le: order === "II" };
  return u16(t, 2) === 42 ? t : null;
}

/** Entradas de un IFD: etiqueta → { tipo, cuenta, valor/desplazamiento }. */
function readIfd(t: Tiff, off: number): Map<number, { type: number; count: number; value: number; at: number }> {
  const out = new Map<number, { type: number; count: number; value: number; at: number }>();
  const n = u16(t, off);
  if (n > 500) throw new Error("exif_raro");
  for (let k = 0; k < n; k++) {
    const e = off + 2 + k * 12;
    out.set(u16(t, e), { type: u16(t, e + 2), count: u32(t, e + 4), value: u32(t, e + 8), at: e + 8 });
  }
  return out;
}

function asciiValue(t: Tiff, e: { type: number; count: number; value: number; at: number } | undefined): string | null {
  if (!e || e.type !== 2 || e.count < 2 || e.count > 64) return null;
  const at = e.count <= 4 ? e.at : e.value;
  const s = ascii(t.b, t.base + at, e.count).replace(/\0.*$/s, "").trim();
  return s || null;
}

const EXIF_DT = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

function parseExifDateTime(s: string | null, offset: string | null): ExifDate | null {
  const m = s ? EXIF_DT.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; // "0000:00:00" de cámaras sin reloj
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}:${m[6]}`, offset: offset && OFFSET.test(offset) ? offset : null };
}

/** Bloque TIFF del EXIF: en un JPEG (segmento APP1 "Exif\0\0") o buscando "Exif\0\0" (HEIC/HEIF). */
export function findExifTiff(b: Uint8Array): Tiff | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      if (marker === 0xe1 && ascii(b, i + 4, 6) === "Exif\0\0") return tiffAt(b, i + 10);
      i += 2 + len;
    }
    return null;
  }
  const limit = Math.min(b.length - 14, 32 * 1024 * 1024);
  for (let i = 0; i < limit; i++) {
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
      const t = tiffAt(b, i + 6);
      if (t) return t;
    }
  }
  return null;
}

/** Fecha de captura del EXIF, o null si no hay (o no se puede leer). Nunca lanza. */
export function readExifDate(b: Uint8Array): ExifDate | null {
  try {
    const t = findExifTiff(b);
    if (!t) return null;
    const ifd0 = readIfd(t, u32(t, 4));
    const exifPtr = ifd0.get(0x8769);
    const exif = exifPtr ? readIfd(t, exifPtr.value) : new Map();
    const offset = asciiValue(t, exif.get(0x9011)) ?? asciiValue(t, exif.get(0x9010));
    return parseExifDateTime(asciiValue(t, exif.get(0x9003)), offset)
      ?? parseExifDateTime(asciiValue(t, exif.get(0x9004)), asciiValue(t, exif.get(0x9012)) ?? offset)
      ?? parseExifDateTime(asciiValue(t, ifd0.get(0x0132)), offset);
  } catch {
    return null;
  }
}

/** ¿El archivo trae un bloque EXIF con ubicación GPS (puntero GPSInfo)? */
export function exifHasGps(b: Uint8Array): boolean {
  try {
    const t = findExifTiff(b);
    if (!t) return false;
    return readIfd(t, u32(t, 4)).has(0x8825);
  } catch {
    return false;
  }
}

/** Instante ISO cuando el EXIF trae zona ("2026-07-14T18:22:05+02:00"); si no, null. */
export function exifInstant(d: ExifDate): string | null {
  return d.time && d.offset ? `${d.date}T${d.time}${d.offset}` : null;
}

// ───────────────────────── MP4 / MOV ─────────────────────────
type Box = { type: string; start: number; header: number; end: number };

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let i = from;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i + 8 <= to) {
    let size = view.getUint32(i);
    const type = ascii(b, i + 4, 4);
    let header = 8;
    if (size === 1) {
      if (i + 16 > to) return;
      const big = view.getUint32(i + 8) * 2 ** 32 + view.getUint32(i + 12);
      size = big; header = 16;
    } else if (size === 0) {
      size = to - i;
    }
    if (size < header || i + size > to) return; // caja rota: se deja de leer
    yield { type, start: i, header, end: i + size };
    i += size;
  }
}

const isMp4 = (b: Uint8Array) => b.length >= 12 && ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(ascii(b, 4, 4));

export type Mp4Info = { createdAt: Date | null; durationS: number | null };

/** Fecha de creación (UTC) y duración de la caja mvhd. null si no es un MP4/MOV legible. */
export function readMp4Info(b: Uint8Array): Mp4Info | null {
  if (!isMp4(b)) return null;
  try {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (const top of boxes(b, 0, b.length)) {
      if (top.type !== "moov") continue;
      for (const c of boxes(b, top.start + top.header, top.end)) {
        if (c.type !== "mvhd") continue;
        const p = c.start + c.header;
        const version = b[p];
        let created: number, timescale: number, duration: number;
        if (version === 1) {
          created = view.getUint32(p + 4) * 2 ** 32 + view.getUint32(p + 8);
          timescale = view.getUint32(p + 20);
          duration = view.getUint32(p + 24) * 2 ** 32 + view.getUint32(p + 28);
        } else {
          created = view.getUint32(p + 4);
          timescale = view.getUint32(p + 12);
          duration = view.getUint32(p + 16);
        }
        // Segundos desde 1904-01-01 UTC. Muchas cámaras sin reloj escriben 0 (1904): se ignora.
        const ms = (created - 2082844800) * 1000;
        const createdAt = created > 0 && ms > Date.UTC(1990, 0, 1) ? new Date(ms) : null;
        const durationS = timescale > 0 && duration > 0 && duration < 2 ** 52 ? Math.round((duration / timescale) * 100) / 100 : null;
        return { createdAt, durationS };
      }
      return { createdAt: null, durationS: null };
    }
    return { createdAt: null, durationS: null };
  } catch {
    return null;
  }
}

// Cajas contenedoras donde pueden ir udta/meta (ubicación ©xyz, modelo de cámara, claves de Apple).
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "edts"]);
const STRIP = new Set(["udta", "meta", "uuid"]);

function neutralize(out: Uint8Array, box: Box) {
  // Encabezado se conserva (tamaño), el tipo pasa a 'free' y el contenido a ceros.
  out[box.start + 4] = 0x66; out[box.start + 5] = 0x72; out[box.start + 6] = 0x65; out[box.start + 7] = 0x65;
  out.fill(0, box.start + box.header, box.end);
}

function stripIn(out: Uint8Array, from: number, to: number): number {
  let n = 0;
  for (const bx of boxes(out, from, to)) {
    if (STRIP.has(bx.type)) { neutralize(out, bx); n++; }
    else if (CONTAINERS.has(bx.type)) n += stripIn(out, bx.start + bx.header, bx.end);
  }
  return n;
}

/** Copia del MP4/MOV sin metadatos de ubicación ni de cámara. Lanza si no es un MP4/MOV. */
export function sanitizeMp4(b: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; removed: number } {
  if (!isMp4(b)) throw new Error("not_mp4");
  const out = new Uint8Array(b.length);
  out.set(b);
  let removed = 0;
  let sawMoov = false;
  for (const top of boxes(out, 0, out.length)) {
    if (top.type === "moov") { sawMoov = true; removed += stripIn(out, top.start + top.header, top.end); }
    else if (STRIP.has(top.type)) { neutralize(out, top); removed++; }
  }
  if (!sawMoov) throw new Error("mp4_sin_moov");
  return { bytes: out, removed };
}

/** ¿Queda alguna caja con metadatos (udta/meta/uuid) o el texto de ubicación de Apple (©xyz)? */
export function mp4HasMetadata(b: Uint8Array): boolean {
  if (!isMp4(b)) return false;
  const any = (from: number, to: number): boolean => {
    for (const bx of boxes(b, from, to)) {
      if (STRIP.has(bx.type)) return true;
      if ((bx.type === "moov" || CONTAINERS.has(bx.type)) && any(bx.start + bx.header, bx.end)) return true;
    }
    return false;
  };
  if (any(0, b.length)) return true;
  // ©xyz (A9 78 79 7A) suelto en la caja moov: no debería existir fuera de udta/meta.
  for (const top of boxes(b, 0, b.length)) {
    if (top.type !== "moov") continue;
    for (let i = top.start; i + 4 <= top.end; i++) {
      if (b[i] === 0xa9 && b[i + 1] === 0x78 && b[i + 2] === 0x79 && b[i + 3] === 0x7a) return true;
    }
  }
  return false;
}
