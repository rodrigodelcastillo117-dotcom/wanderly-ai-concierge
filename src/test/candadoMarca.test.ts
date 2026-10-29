// CANDADO · estilo negro y dorado (29-oct-2026). Falla si cambian los colores de la marca: el fondo
// negro carbón, el dorado champagne, el crema del texto, el degradado dorado de los botones, la paleta de
// IATOS Privé o el color de la barra del navegador. Se lee el CSS con postcss (el árbol real, no un texto)
// y se compara el COLOR resultante (cualquier forma de escribir el mismo color pasa; otro color no).
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type Root } from "postcss";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";

const ROOT = path.resolve(__dirname, "../..");
const css = (f: string): Root => postcss.parse(readFileSync(path.join(ROOT, f), "utf8"), { from: f });

/** El último valor de cada variable en TODA regla del archivo (lo que gana en la cascada, si alguien
 *  agrega un tema claro u otra regla que pise la variable, también se ve aquí). */
function tokens(root: Root): Map<string, { value: string; selector: string }[]> {
  const out = new Map<string, { value: string; selector: string }[]>();
  root.walkDecls(/^--/, (d) => {
    const rule = d.parent as { selector?: string } | undefined;
    const selector = rule?.selector ?? "";
    const list = out.get(d.prop) ?? [];
    list.push({ value: d.value.trim(), selector });
    out.set(d.prop, list);
  });
  return out;
}

type RGB = [number, number, number];
function hslToRgb(h: number, s: number, l: number): RGB {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
/** "41 47% 59%", "41deg 47% 59%", "hsl(41 47% 59%)", "#C9A961", "rgba(201,169,97,.4)" → RGB. */
function toRgb(v: string): RGB | null {
  const s = v.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})\b/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hsl = s.replace(/^hsla?\(/, "").match(/^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  return null;
}
const near = (a: RGB | null, b: RGB, tol = 3) => !!a && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const hex = (h: string) => toRgb(h)!;

// La marca (docs/iatos/LO_QUE_NO_SE_TOCA.md, «Estilo negro y dorado»).
const MARCA: Record<string, RGB> = {
  "--background": hex("#0A0A0A"), // carbón
  "--foreground": hex("#F4F1EB"), // crema (36 30% 94%)
  "--card": hex("#141414"),
  "--surface": hex("#141414"),
  "--surface-elevated": hex("#1C1C1C"),
  "--popover": hex("#141414"),
  "--primary": hex("#C8A865"), // dorado champagne (41 47% 59%, ≈ #C9A961)
  "--primary-foreground": hex("#0F0F0F"),
  "--primary-glow": hex("#E0C385"),
  "--accent": hex("#C8A865"),
  "--ring": hex("#C8A865"),
  "--border": hex("#262626"),
  "--sidebar-background": hex("#0D0D0D"),
  "--sidebar-primary": hex("#C8A865"),
};
const PRIVE: Record<string, RGB> = {
  "--pv-black": hex("#070707"),
  "--pv-ink": hex("#0d0d0e"),
  "--pv-surface": hex("#141416"),
  "--pv-gold": hex("#c9a961"),
  "--pv-gold-soft": hex("#d9c08a"),
  "--pv-champagne": hex("#e8dcc2"),
  "--pv-text": hex("#f5f2ea"),
};

describe("CANDADO · negro y dorado", () => {
  const app = tokens(css("src/index.css"));

  it.each(Object.entries(MARCA))("%s conserva su color en toda regla de src/index.css", (prop, rgb) => {
    const decls = app.get(prop);
    expect(decls, `${prop} ya no está definido`).toBeTruthy();
    for (const d of decls!) expect(near(toRgb(d.value), rgb), `${prop} cambió en "${d.selector}": ${d.value}`).toBe(true);
  });

  it("el degradado dorado de los botones sigue siendo dorado (del dorado a su brillo)", () => {
    const g = app.get("--gradient-gold")?.at(-1)?.value ?? "";
    const stops = Array.from(g.matchAll(/hsla?\(([^)]+)\)/g)).map((m) => toRgb(m[1]));
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(near(stops[0], MARCA["--primary"])).toBe(true);
    expect(near(stops[stops.length - 1], MARCA["--primary-glow"])).toBe(true);
  });

  it("no hay tema claro: ninguna regla pone un fondo claro", () => {
    for (const d of app.get("--background") ?? []) {
      const c = toRgb(d.value)!;
      expect(Math.max(...c), `fondo claro en "${d.selector}"`).toBeLessThan(40);
    }
  });

  it("Tailwind sigue tomando los colores de esas variables (bg-background, text-primary, bg-gradient-gold)", () => {
    const ext = (tailwindConfig as any).theme.extend;
    expect(ext.colors.background).toBe("hsl(var(--background))");
    expect(ext.colors.foreground).toBe("hsl(var(--foreground))");
    expect(ext.colors.primary.DEFAULT).toBe("hsl(var(--primary))");
    expect(ext.colors.primary.foreground).toBe("hsl(var(--primary-foreground))");
    expect(ext.colors.card.DEFAULT ?? ext.colors.card).toBe("hsl(var(--card))");
    expect(ext.backgroundImage["gradient-gold"]).toBe("var(--gradient-gold)");
  });

  it.each(Object.entries(PRIVE))("Privé: %s conserva su color", (prop, rgb) => {
    const decls = tokens(css("src/components/prive/prive.css")).get(prop);
    expect(decls, `${prop} ya no está definido`).toBeTruthy();
    for (const d of decls!) expect(near(toRgb(d.value), rgb), `${prop} cambió en "${d.selector}": ${d.value}`).toBe(true);
  });

  it("la barra del navegador en el celular sigue negra (index.html theme-color)", () => {
    const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = doc.querySelector('meta[name="theme-color"]');
    expect(meta).not.toBeNull();
    expect(near(toRgb(meta!.getAttribute("content") ?? ""), [0, 0, 0], 12)).toBe(true);
  });
});
