import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Modelos retirados (404) o parámetros que hoy dan 400. Si aparecen en una edge function, esa
// función falla en producción o paga un viaje extra de 404 en cada llamada.
const RETIRED = [/"google\/gemini-2\.5-flash(-lite)?"/, /claude-sonnet-4-2025/, /claude-3/];

// Archivos de otros equipos todavía pendientes de migrar (ver reporte). Quitar de aquí al migrarlos.
const PENDING_OTHER_OWNERS = new Set(["concierge-chat/index.ts", "health-check/index.ts", "health-check/checks.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("edge functions sin modelos retirados", () => {
  it("ningún archivo usa un modelo retirado", () => {
    const root = path.resolve(__dirname, "../../supabase/functions");
    const offenders = walk(root)
      .map((p) => path.relative(root, p))
      .filter((rel) => !PENDING_OTHER_OWNERS.has(rel) && !rel.startsWith("_shared/ai.ts"))
      .filter((rel) => RETIRED.some((re) => re.test(readFileSync(path.join(root, rel), "utf8"))));
    expect(offenders).toEqual([]);
  });
});
