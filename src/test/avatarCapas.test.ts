// Avatar por capas: PNG propio, recorte del verde croma, cara y "mano" en el cuerpo completo, y
// composición sin IA (grupo avatar-inventario). Todo con imágenes sintéticas: sin red ni IA.
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, isPng, makeRaster, resize, type Raster } from "../../supabase/functions/_shared/avatar-png.ts";
import { chromaCutout, trimToContent } from "../../supabase/functions/_shared/avatar-cutout.ts";
import {
  CANVAS, composeAvatar, faceCropBox, FACE_SIZE, faceRectFromAlpha, headBox, personaRect, slotsFor, slotStyle,
} from "../../supabase/functions/_shared/avatar-layers.ts";

const px = (r: Raster, x: number, y: number) => Array.from(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));

/** Figura de cuerpo completo sobre verde croma (con leve degradado, como lo dibuja un modelo). */
export function fullBody(w = 400, h = 500, opts: { greenEyes?: boolean; bg?: "verde" | "foto" } = {}): Raster {
  const r = makeRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = [0, 0, 0];
    for (let s = 0; s < 4; s++) {
      const u = (x + 0.25 + (s & 1) * 0.5) / w, v = (y + 0.25 + (s >> 1) * 0.5) / h;
      let c = opts.bg === "foto" ? [((u * 255) | 0), ((v * 200) | 0), (((u + v) * 90) | 0)] : [(u * 25) | 0, 232 + ((v * 22) | 0), (v * 18) | 0];
      const head = ((u - 0.5) / 0.07) ** 2 + ((v - 0.13) / 0.075) ** 2 < 1;
      const hair = ((u - 0.5) / 0.08) ** 2 + ((v - 0.11) / 0.07) ** 2 < 1 && v < 0.12;
      const torso = Math.abs(u - 0.5) < 0.14 && v > 0.21 && v < 0.6;
      const legs = (Math.abs(u - 0.45) < 0.045 || Math.abs(u - 0.55) < 0.045) && v >= 0.6 && v < 0.94;
      const arm = u > 0.3 && u < 0.37 && v > 0.22 && v < 0.42; // brazo levantado (a la izquierda de quien mira)
      const hand = ((u - 0.33) / 0.035) ** 2 + ((v - 0.24) / 0.028) ** 2 < 1;
      if (torso || legs) c = [180, 140, 90]; // gabardina camel
      if (arm || hand) c = arm ? [180, 140, 90] : [214, 166, 130];
      if (head) c = [214, 166, 130];
      if (hair) c = [40, 28, 20];
      if (opts.greenEyes && head && Math.abs(v - 0.13) < 0.006 && (Math.abs(u - 0.475) < 0.008 || Math.abs(u - 0.525) < 0.008)) c = [60, 150, 70];
      acc = acc.map((a, i) => a + c[i]);
    }
    const o = (y * w + x) * 4;
    r.data[o] = acc[0] / 4; r.data[o + 1] = acc[1] / 4; r.data[o + 2] = acc[2] / 4; r.data[o + 3] = 255;
  }
  return r;
}

function solid(w: number, h: number, c: number[]): Raster {
  const r = makeRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([c[0], c[1], c[2], c[3] ?? 255], i * 4);
  return r;
}

describe("PNG sin dependencias", () => {
  it("ida y vuelta RGBA y RGB (opaco se guarda en RGB, más ligero)", async () => {
    const a = fullBody(64, 80);
    a.data[3] = 10;
    const back = await decodePng(await encodePng(a));
    expect(back.width).toBe(64);
    expect(Array.from(back.data)).toEqual(Array.from(a.data));
    const opaque = solid(32, 32, [10, 20, 30]);
    const bytes = await encodePng(opaque);
    expect(isPng(bytes)).toBe(true);
    expect(bytes[25]).toBe(2); // tipo de color RGB
    expect(px(await decodePng(bytes), 5, 5)).toEqual([10, 20, 30, 255]);
  });
  it("rechaza lo que no es PNG (JPEG) con un error claro", async () => {
    await expect(decodePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]))).rejects.toThrow("no_es_png");
  });
  it("cambiar tamaño no oscurece los bordes transparentes (alfa premultiplicado)", () => {
    const r = makeRaster(4, 1);
    r.data.set([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    const half = resize(r, 2, 1);
    expect(px(half, 0, 0)[0]).toBe(255);
    expect(px(half, 1, 0)[0]).toBeGreaterThan(200); // sin halo negro
  });
});

describe("recorte del verde croma (decidido con pruebas)", () => {
  it("quita el fondo con borde suave, sin halo verde y sin borrar un ojo verde", () => {
    const { image, report } = chromaCutout(fullBody(400, 500, { greenEyes: true }));
    expect(report.ok).toBe(true);
    expect(report.bordeVerde).toBeGreaterThan(0.95);
    expect(report.transparente).toBeGreaterThan(0.5);
    expect(px(image, 5, 5)[3]).toBe(0); // esquina: fondo
    expect(px(image, 200, 65)[3]).toBe(255); // cara
    expect(px(image, 190, 65)[1]).toBeGreaterThan(px(image, 190, 65)[0]); // ojo verde intacto
    // Borde de la figura: ningún píxel semitransparente queda verdoso.
    for (let i = 0; i < image.data.length; i += 4) {
      const a = image.data[i + 3];
      if (a > 0 && a < 255) expect(image.data[i + 1] - Math.max(image.data[i], image.data[i + 2])).toBeLessThanOrEqual(8);
    }
  });
  it("si el modelo no respetó el fondo plano, falla limpio y deja la imagen como estaba", () => {
    const src = fullBody(200, 250, { bg: "foto" });
    const { image, report } = chromaCutout(src);
    expect(report.ok).toBe(false);
    expect(report.motivo).toBe("fondo_no_uniforme");
    expect(Array.from(image.data)).toEqual(Array.from(src.data));
  });
  it("objetos del inventario: recorte y ajuste al contenido", () => {
    const s = solid(100, 100, [0, 255, 0]);
    for (let y = 30; y < 70; y++) for (let x = 20; x < 60; x++) s.data.set([200, 120, 40, 255], (y * 100 + x) * 4);
    const t = trimToContent(chromaCutout(s).image);
    expect(t.width).toBe(t.height);
    expect(t.width).toBeLessThan(50);
  });
});

describe("cuerpo completo: cara para los círculos y objeto en la mano", () => {
  const persona = chromaCutout(fullBody(400, 500)).image;
  const cara = faceRectFromAlpha(persona);

  it("encuentra la cara arriba y al centro de la figura", () => {
    expect(cara.cx).toBeGreaterThan(0.45);
    expect(cara.cx).toBeLessThan(0.55);
    expect(cara.cy).toBeGreaterThan(0.08);
    expect(cara.cy).toBeLessThan(0.2);
    expect(cara.side).toBeGreaterThan(0.2);
    expect(cara.side).toBeLessThan(0.35);
  });
  it("un retrato de busto (avatares de antes) usa la mitad de arriba", () => {
    const busto = makeRaster(200, 200);
    for (let y = 40; y < 200; y++) for (let x = 20; x < 180; x++) busto.data[(y * 200 + x) * 4 + 3] = 255;
    expect(faceRectFromAlpha(busto).side).toBeGreaterThan(0.6);
  });
  it("ningún objeto toca la cabeza; el primero va en la mano si se conoce", () => {
    const pr = personaRect(400, 500);
    const head = headBox(cara, pr);
    for (const mano of [[0.33, 0.24], [0.5, 0.14], null] as const) {
      for (let n = 1; n <= 3; n++) {
        const slots = slotsFor(n, { pw: 400, ph: 500, cara, mano: mano as [number, number] | null });
        expect(slots).toHaveLength(n);
        for (const s of slots) {
          const off = s.cx + s.size * 0.5 < head.x0 || s.cx - s.size * 0.5 > head.x1 || s.cy + s.size * 0.5 < head.y0 || s.cy - s.size * 0.5 > head.y1;
          expect(off).toBe(true);
          expect(s.cy + s.size / 2).toBeLessThanOrEqual(CANVAS.h);
        }
      }
    }
    const withHand = slotsFor(1, { pw: 400, ph: 500, cara, mano: [0.33, 0.24] });
    expect(withHand[0].enMano).toBe(true);
    // Una "mano" sobre la cara no se usa: el objeto se va a los pies.
    expect(slotsFor(1, { pw: 400, ph: 500, cara, mano: [0.5, 0.13] })[0].enMano).toBeFalsy();
    expect(slotStyle(withHand[0]).transform).toMatch(/rotate/);
  });
  it("compone sin IA: cuerpo completo 4:5 y recorte de la cara cuadrado con la cara al centro", () => {
    const fondo = solid(300, 300, [70, 110, 170]);
    const obj = chromaCutout((() => { const s = solid(80, 80, [0, 255, 0]); for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) s.data.set([220, 160, 60, 255], (y * 80 + x) * 4); return s; })()).image;
    const out = composeAvatar({ fondo, persona, objetos: [obj, obj, obj], mano: [0.33, 0.24] });
    expect([out.full.width, out.full.height]).toEqual([CANVAS.w, CANVAS.h]);
    expect([out.face.width, out.face.height]).toEqual([FACE_SIZE, FACE_SIZE]);
    expect(px(out.full, 10, 10)).toEqual([70, 110, 170, 255]); // fondo del país
    const c = px(out.face, FACE_SIZE / 2, FACE_SIZE / 2 + 20);
    expect(Math.abs(c[0] - 214)).toBeLessThan(25); // piel al centro del recorte
    const box = faceCropBox(out.cara, personaRect(400, 500));
    expect(box.side).toBeLessThan(CANVAS.w / 2); // el recorte es de la cara, no del cuerpo
    // Sin fondo del país (aún no generado): degradado opaco de respaldo.
    const sinFondo = composeAvatar({ fondo: null, persona, objetos: [] });
    expect(px(sinFondo.full, 3, 3)[3]).toBe(255);
  });
});
