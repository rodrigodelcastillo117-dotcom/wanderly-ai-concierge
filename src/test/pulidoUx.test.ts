// Pulido UX (auditoría en producción, 24-oct-2026): detalles de maquetación y botones que no hacían nada.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Recuerdos: pestañas Calendario / Por viaje en escritorio", () => {
  const src = read("src/pages/Recuerdos.tsx");
  it("la fila de pestañas no se encoge (con nombres de viaje largos quedaba en 0 px y encimada)", () => {
    const tablist = src.match(/role="tablist" aria-label="Vistas de Recuerdos" className="([^"]+)"/)?.[1] ?? "";
    expect(tablist.split(/\s+/)).toContain("shrink-0");
  });
  it("el filtro de viaje tiene ancho acotado y puede encogerse", () => {
    const select = src.match(/id="recuerdos-filter"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(select).toMatch(/\bsm:w-64\b/);
    expect(src).toMatch(/<div className="flex min-w-0 items-center gap-2 text-sm">\s*<label htmlFor="recuerdos-filter"/);
  });
});

describe("Traductor: 'Traducir' sin frase", () => {
  it("queda desactivado (antes se podía tocar y no pasaba nada)", () => {
    const src = read("src/pages/TripTranslator.tsx");
    const line = src.split("\n").find((l) => l.includes(">Traducir</Button>")) ?? "";
    expect(line).toContain("disabled={loading || !customInput.trim()}");
  });
});

describe("Comparador: ejemplos distintos por campo", () => {
  it("Destino 1 y Destino 2 no repiten el mismo ejemplo", () => {
    const src = read("src/pages/Compare.tsx");
    const list = src.match(/const DEST_EXAMPLES = \[([^\]]+)\]/)?.[1] ?? "";
    const items = list.split(",").map((s) => s.trim()).filter(Boolean);
    expect(new Set(items).size).toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(4); // hasta 4 destinos
    expect(src).not.toContain("(ej: Tokio, Japón)`");
  });
});

describe("THE PRIVATE EDITION: el fondo de lectura cubre toda la pantalla", () => {
  it("EditionRoot y la lectura sin conexión usan min-h-screen (en modo papel quedaba una franja negra)", () => {
    expect(read("src/pages/prive/edition/EditionRoot.tsx")).toContain('className="ped min-h-screen"');
    expect(read("src/pages/prive/edition/EditionOfflinePage.tsx")).toContain('className="ped min-h-screen"');
  });
});
