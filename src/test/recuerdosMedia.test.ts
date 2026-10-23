// Recuerdos: fecha del EXIF, quitar EXIF/GPS, videos MP4/MOV sin ubicación y preparación de la subida.
import { describe, expect, it } from "vitest";
import { jpegHasMetadata, stripJpegMetadata } from "@/lib/boveda/files";
import { exifHasGps, exifInstant, mp4HasMetadata, readExifDate, readMp4Info, sanitizeMp4 } from "@/lib/recuerdos/media";
import { effectiveType, prepareRecuerdo, recuerdoProblem, RECUERDO_PHOTO_EDGE } from "@/lib/recuerdos/prepare";

// ───── JPEG sintético con EXIF (DateTimeOriginal, OffsetTimeOriginal) y puntero GPS ─────
function tiff(opts: { dto?: string; offset?: string; ifd0Date?: string; gps?: boolean; be?: boolean }): Uint8Array {
  const le = !opts.be;
  const buf = new Uint8Array(512);
  const dv = new DataView(buf.buffer);
  const w16 = (o: number, v: number) => dv.setUint16(o, v, le);
  const w32 = (o: number, v: number) => dv.setUint32(o, v, le);
  buf.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0); w16(2, 42); w32(4, 8);
  const ifd0: Array<[number, number, number, number]> = [];
  let data = 300; // zona de datos
  const putAscii = (s: string) => { const at = data; for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i); buf[at + s.length] = 0; data += s.length + 1; return at; };
  const exifAt = 120, gpsAt = 200;
  ifd0.push([0x8769, 4, 1, exifAt]);
  if (opts.gps) ifd0.push([0x8825, 4, 1, gpsAt]);
  if (opts.ifd0Date) { const s = opts.ifd0Date; ifd0.push([0x0132, 2, s.length + 1, putAscii(s)]); }
  const writeIfd = (at: number, entries: Array<[number, number, number, number]>) => {
    w16(at, entries.length);
    entries.forEach(([tag, type, count, value], k) => { const e = at + 2 + k * 12; w16(e, tag); w16(e + 2, type); w32(e + 4, count); w32(e + 8, value); });
    w32(at + 2 + entries.length * 12, 0);
  };
  writeIfd(8, ifd0);
  const exif: Array<[number, number, number, number]> = [];
  if (opts.dto) exif.push([0x9003, 2, opts.dto.length + 1, putAscii(opts.dto)]);
  if (opts.offset) exif.push([0x9011, 2, opts.offset.length + 1, putAscii(opts.offset)]);
  writeIfd(exifAt, exif);
  if (opts.gps) writeIfd(gpsAt, []);
  return buf.slice(0, data);
}
function jpegWithExif(t: Uint8Array): Uint8Array {
  const app1 = new Uint8Array([0xff, 0xe1, 0, 0, ...[..."Exif"].map((c) => c.charCodeAt(0)), 0, 0, ...t]);
  const len = app1.length - 2; app1[2] = len >> 8; app1[3] = len & 0xff;
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...dqt, ...sos]);
}

describe("EXIF: fecha de captura y GPS", () => {
  const jpg = jpegWithExif(tiff({ dto: "2026:07:14 18:22:05", offset: "+02:00", gps: true }));

  it("lee DateTimeOriginal como fecha LOCAL (sin moverla de día por la zona horaria)", () => {
    expect(readExifDate(jpg)).toEqual({ date: "2026-07-14", time: "18:22:05", offset: "+02:00" });
    expect(exifInstant(readExifDate(jpg)!)).toBe("2026-07-14T18:22:05+02:00");
  });

  it("también en big-endian y con DateTime de IFD0 como respaldo", () => {
    expect(readExifDate(jpegWithExif(tiff({ dto: "2025:12:31 23:59:59", be: true })))?.date).toBe("2025-12-31");
    expect(readExifDate(jpegWithExif(tiff({ ifd0Date: "2024:02:29 08:00:00" })))?.date).toBe("2024-02-29");
  });

  it("fechas vacías o imposibles (cámaras sin reloj) no cuentan", () => {
    expect(readExifDate(jpegWithExif(tiff({ dto: "0000:00:00 00:00:00" })))).toBeNull();
    expect(readExifDate(jpegWithExif(tiff({ dto: "2026:02:30 10:00:00" })))).toBeNull();
    expect(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readExifDate(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("encuentra el EXIF dentro de un HEIC (bloque Exif\\0\\0 en cualquier parte)", () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...[..."ftypheic"].map((c) => c.charCodeAt(0)), ...new Array(40).fill(7), ...[..."Exif"].map((c) => c.charCodeAt(0)), 0, 0, ...tiff({ dto: "2023:05:06 07:08:09" })]);
    expect(readExifDate(heic)?.date).toBe("2023-05-06");
  });

  it("la copia limpia ya no trae EXIF ni GPS", () => {
    expect(exifHasGps(jpg)).toBe(true);
    expect(jpegHasMetadata(jpg)).toBe(true);
    const clean = stripJpegMetadata(jpg);
    expect(exifHasGps(clean)).toBe(false);
    expect(readExifDate(clean)).toBeNull();
    expect(jpegHasMetadata(clean)).toBe(false);
  });
});

// ───── MP4/MOV sintético ─────
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...str(type), ...payload];
}
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
function mp4({ created, timescale = 600, duration = 600 * 12, withLocation = true }: { created: Date | null; timescale?: number; duration?: number; withLocation?: boolean }) {
  const secs = created ? Math.floor(created.getTime() / 1000) + 2082844800 : 0;
  const mvhd = box("mvhd", [0, 0, 0, 0, ...u32(secs), ...u32(secs), ...u32(timescale), ...u32(duration), ...new Array(80).fill(0)]);
  const xyz = [0xa9, ...str("xyz")];
  const loc = [0, 0, 0, 30, ...xyz, 0, 18, 0x15, 0xc7, ...str("+19.4326-099.1332/")];
  const udta = withLocation ? box("udta", loc) : [];
  const meta = withLocation ? box("meta", [0, 0, 0, 0, ...box("keys", str("com.apple.quicktime.location.ISO6709"))]) : [];
  const trak = box("trak", [...box("tkhd", new Array(84).fill(0)), ...(withLocation ? box("udta", str("Apple iPhone 15")) : [])]);
  const moov = box("moov", [...mvhd, ...trak, ...udta, ...meta]);
  const mdat = box("mdat", new Array(64).fill(0).map((_, i) => i));
  return new Uint8Array([...box("ftyp", [...str("qt  "), 0, 0, 2, 0, ...str("qt  ")]), ...moov, ...mdat]);
}

describe("videos MP4/MOV: fecha, duración y sin ubicación", () => {
  const when = new Date("2026-08-02T15:30:00Z");
  const v = mp4({ created: when });

  it("lee la fecha (mvhd) y la duración", () => {
    expect(readMp4Info(v)).toEqual({ createdAt: when, durationS: 12 });
    expect(readMp4Info(mp4({ created: null }))?.createdAt).toBeNull(); // 1904 = sin reloj
    expect(readMp4Info(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });

  it("convierte udta/meta (ubicación ©xyz, modelo) en 'free' sin mover los datos del video", () => {
    expect(mp4HasMetadata(v)).toBe(true);
    const { bytes, removed } = sanitizeMp4(v);
    expect(removed).toBe(3); // udta de moov, meta de moov y udta de trak
    expect(bytes.length).toBe(v.length);
    expect(mp4HasMetadata(bytes)).toBe(false);
    const text = String.fromCharCode(...bytes);
    expect(text).not.toContain("+19.4326");
    expect(text).not.toContain("iPhone");
    // mdat (los cuadros del video) queda idéntico y en el mismo lugar.
    const at = text.indexOf("mdat");
    expect([...bytes.slice(at, at + 68)]).toEqual([...v.slice(at, at + 68)]);
    expect(readMp4Info(bytes)?.durationS).toBe(12);
  });
});

// ───── Preparación completa (canvas simulado) ─────
// jsdom no tiene Blob.arrayBuffer: se lee con FileReader.
const read = (b: Blob) => new Promise<Uint8Array>((res) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.readAsArrayBuffer(b); });
const encode = async (f: Blob, edge: number) => ({ blob: new Blob([jpegWithExif(tiff({ dto: "2001:01:01 00:00:00", gps: true }))], { type: "image/jpeg" }), width: edge, height: Math.round(edge * 0.75) });

describe("prepareRecuerdo", () => {
  it("foto: fecha del EXIF del original; la copia reducida va sin EXIF/GPS y con miniatura", async () => {
    const f = new File([jpegWithExif(tiff({ dto: "2026:07:14 18:22:05", gps: true }))], "IMG_1.jpg", { type: "image/jpeg", lastModified: Date.UTC(2026, 9, 1) });
    const p = await prepareRecuerdo(f, { encode, today: "2026-10-23" });
    expect(p).toMatchObject({ kind: "foto", mime: "image/jpeg", ext: "jpg", takenOn: "2026-07-14", dateSource: "exif", width: RECUERDO_PHOTO_EDGE });
    const bytes = await read(p.blob);
    expect(jpegHasMetadata(bytes)).toBe(false);
    expect(exifHasGps(bytes)).toBe(false);
    expect(p.thumb).not.toBeNull();
    expect(jpegHasMetadata(await read(p.thumb!))).toBe(false);
  });

  it("sin EXIF (o con fecha futura): fecha del archivo", async () => {
    const lm = new Date(2026, 4, 9, 12, 0).getTime();
    const plain = new File([jpegWithExif(tiff({}))], "x.jpg", { type: "image/jpeg", lastModified: lm });
    expect(await prepareRecuerdo(plain, { encode, today: "2026-10-23" })).toMatchObject({ takenOn: "2026-05-09", dateSource: "archivo" });
    const future = new File([jpegWithExif(tiff({ dto: "2030:01:01 10:00:00" }))], "y.jpg", { type: "image/jpeg", lastModified: lm });
    expect(await prepareRecuerdo(future, { encode, today: "2026-10-23" })).toMatchObject({ takenOn: "2026-05-09", dateSource: "archivo" });
  });

  it("video: sin ubicación, fecha del video, miniatura opcional; de más de 60 s se rechaza", async () => {
    const f = new File([mp4({ created: new Date(2026, 7, 2, 10, 0) })], "IMG_2.MOV", { type: "video/quicktime" });
    const p = await prepareRecuerdo(f, { today: "2026-10-23", videoPoster: async () => null });
    expect(p).toMatchObject({ kind: "video", mime: "video/quicktime", ext: "mov", takenOn: "2026-08-02", dateSource: "video", durationS: 12, thumb: null });
    expect(mp4HasMetadata(await read(p.blob))).toBe(false);
    const long = new File([mp4({ created: null, duration: 600 * 75 })], "largo.mp4", { type: "video/mp4" });
    await expect(prepareRecuerdo(long, { today: "2026-10-23", videoPoster: async () => null })).rejects.toThrow(/60 segundos/);
  });

  it("límites claros por tipo y tamaño", () => {
    expect(recuerdoProblem({ type: "video/mp4", size: 51 * 1024 * 1024 })).toMatch(/50 MB/);
    expect(recuerdoProblem({ type: "video/x-msvideo", size: 10 })).toMatch(/MP4 o MOV/);
    expect(recuerdoProblem({ type: "application/pdf", size: 10 })).toMatch(/Sube fotos/);
    expect(recuerdoProblem({ type: "image/heic", size: 10 })).toBeNull();
    expect(effectiveType({ type: "", name: "IMG_9.HEIC" })).toBe("image/heic");
    expect(effectiveType({ type: "", name: "clip.mov" })).toBe("video/quicktime");
  });
});
