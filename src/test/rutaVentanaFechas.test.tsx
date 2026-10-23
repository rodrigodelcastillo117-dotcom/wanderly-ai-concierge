// D1 (E2E 23-oct): con /dashboard/ruta ya abierta, la ventana "Planear viaje" volvía a mandar ahí con
// fechas en la URL, pero la página (misma ruta, sin volver a montarse) seguía mostrando "Elegir salida".
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/MultiDestRoute.tsx", "utf8");
const dialog = readFileSync("src/components/plan/PlanTripDialog.tsx", "utf8");

describe("ventana → /dashboard/ruta ya abierta", () => {
  it("la ventana navega con una marca nueva cada vez", () => {
    expect(dialog).toMatch(/navigate\(path, \{ state: \{ ventana: Date\.now\(\) \} \}\)/);
  });
  it("la página vuelve a leer ciudades, fechas, noches y viajeros cuando cambia la marca", () => {
    const block = page.slice(page.indexOf("const ventanaVista"));
    for (const s of ["setStops(dest)", 'setFechaSalida(params.get("fecha_salida")', 'setFechaRegreso(params.get("fecha_regreso")', "setNightsSel(nightsFromQuery", "setViajeros("]) {
      expect(block).toContain(s);
    }
    expect(block).toMatch(/if \(!ventana \|\| ventana === ventanaVista\.current\) return;/);
  });
});
