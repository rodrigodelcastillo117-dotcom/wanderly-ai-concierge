// Verificación estática: cada <label> visible queda asociado a su campo (htmlFor/id),
// envuelve al control, o nombra un grupo con id (aria-labelledby). Antes: 54 etiquetas sueltas.
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { it, expect } from "vitest";

const root = path.resolve(__dirname, "..");
// Páginas de otros equipos que no tocamos en este cambio.
const OTHER_OWNERS = ["Concierge.tsx", "TripDetail.tsx", "Gastos.tsx", "DashboardHome.tsx"];
const files = ["pages", "components"].flatMap((d) =>
  readdirSync(path.join(root, d)).filter((f) => f.endsWith(".tsx") && !OTHER_OWNERS.includes(f)).map((f) => path.join(root, d, f)),
);

it("no quedan <label> sin asociar en los formularios", () => {
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const re = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const [, attrs, inner] = m;
      if (/htmlFor=|\bid=/.test(attrs)) continue; // asociada o usada como aria-labelledby
      if (/<(input|Input|select|textarea|Textarea|Checkbox)\b/.test(inner) || /\{children\}/.test(inner)) continue; // envuelve al control
      const line = src.slice(0, m.index).split("\n").length;
      offenders.push(`${path.relative(root, f)}:${line}`);
    }
  }
  // "Destinos en orden" (MultiDestRoute) titula una lista de paradas, no un campo.
  expect(offenders.filter((o) => !o.startsWith("pages/MultiDestRoute.tsx"))).toEqual([]);
});

import { render, screen } from "@testing-library/react";
import { Slider } from "@/components/ui/slider";
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

it("el Slider pasa su nombre accesible al control con role=slider", () => {
  render(<><span id="lbl">Viajeros</span><Slider aria-labelledby="lbl" value={[2]} min={1} max={5} /><Slider aria-label="Presupuesto" value={[3]} /></>);
  expect(screen.getByRole("slider", { name: "Viajeros" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Presupuesto" })).toBeInTheDocument();
});
