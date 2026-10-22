import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pase de accesibilidad (E-15 / IATOS-088) en pantallas que no cubrió el grupo de flujos.
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── Contraste WCAG 2.1 de los tokens del tema oscuro (src/index.css) ──────────────────────
const css = read("src/index.css");
const token = (name: string): [number, number, number] => {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(css);
  if (!m) throw new Error(`token ${name} no encontrado`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const hslToRgb = ([h, s, l]: [number, number, number]) => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const blend = (fg: number[], bg: number[], a: number) => fg.map((c, i) => a * c + (1 - a) * bg[i]);
const ratio = (fg: number[], bg: number[]) => {
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("contraste del texto atenuado en el tema oscuro", () => {
  const muted = hslToRgb(token("muted-foreground"));
  const surfaces = ["background", "card", "surface-elevated", "muted"] as const;

  it.each(surfaces)("muted-foreground sobre %s cumple AA (≥ 4.5:1)", (s) => {
    expect(ratio(muted, hslToRgb(token(s)))).toBeGreaterThanOrEqual(4.5);
  });

  it("muted-foreground/70 NO cumple AA para texto normal: por eso no se usa en texto informativo", () => {
    const bg = hslToRgb(token("background"));
    expect(ratio(blend(muted, bg, 0.7), bg)).toBeLessThan(4.5);
    for (const f of ["src/components/ReadonlyBudget.tsx", "src/components/NotificationBell.tsx", "src/pages/TripMap.tsx", "src/pages/TripPacking.tsx"]) {
      // Solo texto (p/span/li); los iconos decorativos pueden ir atenuados.
      expect(read(f)).not.toMatch(/<(p|span|li)\b[^>]*(text-muted-foreground\/(40|50|60|70)\b|text-foreground\/40\b)/);
      expect(read(f)).not.toMatch(/\? "line-through text-foreground\/40"/);
    }
  });
});

// ── Campos con nombre accesible ─────────────────────────────────────────────────────────
describe("campos con nombre accesible", () => {
  it.each([
    ["src/pages/Currency.tsx", ['aria-label="Cantidad a convertir"', 'aria-label="Moneda de origen"', 'aria-label="Moneda de destino"']],
    ["src/pages/Gastos.tsx", ['htmlFor="gasto-monto"', 'id="gasto-monto"', 'htmlFor="gasto-moneda"', 'htmlFor="gasto-categoria"', 'htmlFor="gasto-fecha"', 'htmlFor="gasto-descripcion"', 'htmlFor="gasto-recibo"']],
    ["src/pages/MultiDestRoute.tsx", ["aria-label={`Parada ${i + 1}`}", 'aria-label="Emoción del viaje"']],
    ["src/pages/Social.tsx", ['aria-label="Código de tu amigo"']],
    ["src/pages/TripTranslator.tsx", ['aria-label="Frase en español para traducir"']],
    ["src/components/FlightStatusDialog.tsx", ['aria-label="Número de vuelo"']],
    ["src/components/ConciergeActions.tsx", ['aria-label="¿A dónde vas?"']],
    ["src/components/MembersOnlyPanel.tsx", ['aria-label="Buscar por ciudad"']],
    ["src/components/EditWithAIDialog.tsx", ['aria-label="Cambios que quieres en tu viaje"']],
    ["src/pages/Benefits.tsx", ['aria-label="Buscar en tu bóveda"', 'aria-label="Ordenar"']],
    ["src/components/boveda/FileTiles.tsx", ['aria-label="Tomar foto del documento"', 'aria-label="Subir foto o PDF"']],
    ["src/pages/TripDetail.tsx", ['aria-label="Número de viajeros"', 'aria-label="Noches en este hospedaje"']],
  ])("%s", (file, attrs) => {
    const src = read(file as string);
    for (const a of attrs as string[]) expect(src, `${file} sin ${a}`).toContain(a);
  });
});
