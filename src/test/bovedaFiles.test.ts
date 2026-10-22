import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VAULT_MAX_BYTES, VAULT_STORED_TYPES, buildVaultPath, defaultSide, fitWithin, isJpeg, jpegHasMetadata, prepareVaultFile,
  stripJpegMetadata, validateVaultInput,
} from "@/lib/boveda/files";

const MIGRATION = readFileSync("supabase/migrations/20261023190000_boveda.sql", "utf8");
const enc = (s: string) => Array.from(new TextEncoder().encode(s));
const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];

/** JPEG mínimo con JFIF, EXIF (con "GPS"), XMP, IPTC, comentario, ICC y datos de imagen. */
function jpegWithMetadata(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, [...enc("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [...enc("Exif\0\0"), ...enc("GPS 19.4326N 99.1332W Pixel 9 Pro")]),
    ...seg(0xe1, enc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Ana Prueba</x:xmpmeta>")),
    ...seg(0xe2, enc("ICC_PROFILE\0sRGB")),
    ...seg(0xed, enc("Photoshop 3.0\0IPTC autor")),
    ...seg(0xfe, enc("comentario secreto")),
    ...seg(0xdb, [0, 1, 2, 3]),
    0xff, 0xff, // relleno antes de un marcador
    ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9,
  ]);
}

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const readBlob = (b: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
  r.onerror = () => reject(r.error);
  r.readAsArrayBuffer(b);
});

describe("Bóveda · limpieza de metadatos (EXIF/GPS)", () => {
  it("quita EXIF, XMP, IPTC y comentarios; conserva JFIF, ICC, tablas y datos", () => {
    const src = jpegWithMetadata();
    expect(jpegHasMetadata(src)).toBe(true);
    const out = stripJpegMetadata(src);
    const t = text(out);
    expect(t).not.toMatch(/Exif|GPS|Pixel|xmpmeta|Ana Prueba|IPTC|comentario/);
    expect(t).toContain("JFIF");
    expect(t).toContain("ICC_PROFILE");
    expect(isJpeg(out)).toBe(true);
    expect(jpegHasMetadata(out)).toBe(false);
    // Los datos comprimidos (desde SOS) quedan idénticos.
    const tail = Array.from(src.slice(src.length - 7));
    expect(Array.from(out.slice(out.length - 7))).toEqual(tail);
  });

  it("es idempotente y rechaza lo que no es JPEG o está corrupto", () => {
    const once = stripJpegMetadata(jpegWithMetadata());
    expect(Array.from(stripJpegMetadata(once))).toEqual(Array.from(once));
    expect(() => stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow();
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow();
    expect(jpegHasMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBe(true);
  });

  it("prepareVaultFile: la foto reescrita sale sin metadatos aunque el navegador los dejara", async () => {
    const photo = new File([jpegWithMetadata()], "IMG_0001.jpg", { type: "image/jpeg" });
    // Simula un canvas que (por error) devolviera EXIF: la limpieza de bytes lo quita igual.
    const out = await prepareVaultFile(photo, { reencode: async () => new Blob([jpegWithMetadata()], { type: "image/jpeg" }) });
    expect(out.mime).toBe("image/jpeg");
    const bytes = await readBlob(out.blob);
    expect(jpegHasMetadata(bytes)).toBe(false);
    expect(text(bytes)).not.toContain("GPS");
  });

  it("si el navegador no puede decodificar un JPEG, limpia los bytes del original", async () => {
    const photo = new File([jpegWithMetadata()], "x.jpg", { type: "image/jpeg" });
    const out = await prepareVaultFile(photo, { reencode: async () => null });
    expect(jpegHasMetadata(await readBlob(out.blob))).toBe(false);
  });

  it("HEIC que no se puede decodificar: mensaje claro, no se sube tal cual", async () => {
    const heic = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], "IMG.HEIC", { type: "image/heic" });
    await expect(prepareVaultFile(heic, { reencode: async () => null })).rejects.toThrow(/No pudimos leer la foto/);
  });
});

describe("Bóveda · validación de archivos", () => {
  it("acepta fotos y PDF; rechaza HTML, SVG, vacíos y tamaños de más", () => {
    expect(validateVaultInput({ type: "image/jpeg", size: 1000 })).toEqual({ kind: "image" });
    expect(validateVaultInput({ type: "image/heic", size: 1000 })).toEqual({ kind: "image" });
    expect(validateVaultInput({ type: "application/pdf", size: 1000 })).toEqual({ kind: "pdf" });
    expect(validateVaultInput({ type: "text/html", size: 10 })).toHaveProperty("error");
    expect(validateVaultInput({ type: "image/svg+xml", size: 10 })).toHaveProperty("error");
    expect(validateVaultInput({ type: "image/jpeg", size: 0 })).toHaveProperty("error");
    expect(validateVaultInput({ type: "application/pdf", size: VAULT_MAX_BYTES + 1 })).toHaveProperty("error");
    expect(validateVaultInput({ type: "image/jpeg", size: 26 * 1024 * 1024 })).toHaveProperty("error");
  });

  it("un archivo que dice ser PDF pero no lo es se rechaza", async () => {
    const fake = new File(["<html>hola</html>"], "poliza.pdf", { type: "application/pdf" });
    await expect(prepareVaultFile(fake)).rejects.toThrow(/no parece un PDF/);
    const real = new File(["%PDF-1.7\n..."], "poliza.pdf", { type: "application/pdf" });
    await expect(prepareVaultFile(real)).resolves.toMatchObject({ mime: "application/pdf", kind: "pdf" });
  });

  it("la ruta no lleva el nombre original y cumple el CHECK de la base", () => {
    const u = "b0000000-0000-4000-8000-0000000000a1", i = "b1000000-0000-4000-8000-000000000001", f = "b2000000-0000-4000-8000-000000000001";
    const path = buildVaultPath(u, i, f, "image");
    expect(path).toBe(`${u}/${i}/${f}.jpg`);
    expect(buildVaultPath(u, i, f, "pdf")).toMatch(/\.pdf$/);
    expect(path).toMatch(new RegExp(`^${u}/${i}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|pdf)$`));
  });

  it("el bucket del servidor acepta exactamente lo que sube el cliente (JPEG y PDF, 10 MB)", () => {
    const m = MIGRATION.match(/VALUES \('travel-vault', 'travel-vault', false, (\d+), ARRAY\[([^\]]+)\]\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(VAULT_MAX_BYTES);
    expect([...m![2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()).toEqual([...VAULT_STORED_TYPES].sort());
  });

  it("reduce fotos grandes y elige frente/reverso", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(defaultSide("image", [])).toBe("frente");
    expect(defaultSide("image", ["frente"])).toBe("reverso");
    expect(defaultSide("image", ["frente", "reverso"])).toBe("pagina");
    expect(defaultSide("pdf", [])).toBe("pdf");
  });
});
