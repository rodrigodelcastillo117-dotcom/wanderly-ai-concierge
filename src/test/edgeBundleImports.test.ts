// El empaquetador de Supabase (despliegue con Lovable) solo incluye la carpeta de cada función y
// supabase/functions/_shared. Una importación relativa a la carpeta de OTRA función compila con
// `deno check` pero rompe el despliegue ("Module not found"), como pasó con concierge-chat.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";

const BASE = "supabase/functions";

function crossFolderImports(fn: string, path: string, seen: Set<string>, out: string[]) {
  if (seen.has(path)) return;
  seen.add(path);
  const src = readFileSync(path, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const target = normalize(join(dirname(path), m[1]));
    const top = relative(BASE, target).split(sep)[0];
    if (top !== fn && top !== "_shared") out.push(`${path} → ${m[1]}`);
    else if (target.endsWith(".ts") && existsSync(target)) crossFolderImports(fn, target, seen, out);
  }
}

describe("edge functions se pueden empaquetar por separado", () => {
  it("ninguna función importa (directa o indirectamente) archivos de la carpeta de otra función", () => {
    const out: string[] = [];
    for (const fn of readdirSync(BASE)) {
      const index = join(BASE, fn, "index.ts");
      if (fn !== "_shared" && existsSync(index)) crossFolderImports(fn, index, new Set(), out);
    }
    expect(out).toEqual([]);
  });
});
