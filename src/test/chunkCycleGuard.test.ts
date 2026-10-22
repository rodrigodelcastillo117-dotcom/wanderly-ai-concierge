// Incidente Smart Spend (oct 2026): en producción vendor-charts y vendor-3d se importaban entre sí
// y la pestaña tronaba con "TypeError: ….x is not a function". Estas pruebas fijan:
//  - la guarda del build detecta ciclos entre chunks (directos y transitivos) y hace fallar el build;
//  - el reparto de vite.chunks.ts manda lo compartido por gráficas y globo a UN solo chunk hoja;
//  - cada grupo vendor es cerrado: sus paquetes solo dependen del mismo grupo o de uno anterior,
//    con lo que Rollup no tiene nada que "decidir" (fue esa decisión la que cambió entre versiones).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rollup, type Plugin } from "rollup";
import { VENDOR_GROUPS, chunkCycleGuard, findChunkCycles, vendorChunk, type ChunkLike } from "../../vite.chunks";

const chunk = (fileName: string, imports: string[]): ChunkLike => ({ type: "chunk", fileName, imports });
const bundleOf = (...chunks: ChunkLike[]) => Object.fromEntries(chunks.map((c) => [c.fileName, c]));

describe("findChunkCycles", () => {
  it("detecta el ciclo de producción vendor-charts ↔ vendor-3d", () => {
    const b = bundleOf(
      chunk("assets/vendor-core.js", []),
      chunk("assets/vendor-charts-Ch0oaFac.js", ["assets/vendor-3d-Cj9XNtF5.js", "assets/vendor-core.js"]),
      chunk("assets/vendor-3d-Cj9XNtF5.js", ["assets/vendor-core.js", "assets/vendor-charts-Ch0oaFac.js"]),
      { type: "asset", fileName: "assets/index.css" },
    );
    const cycles = findChunkCycles(b);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(["assets/vendor-charts-Ch0oaFac.js", "assets/vendor-3d-Cj9XNtF5.js"]));
  });

  it("detecta ciclos transitivos (a → b → c → a)", () => {
    const cycles = findChunkCycles(bundleOf(chunk("a.js", ["b.js"]), chunk("b.js", ["c.js"]), chunk("c.js", ["a.js"]), chunk("d.js", ["a.js"])));
    expect(cycles).toEqual([["a.js", "b.js", "c.js", "a.js"]]);
  });

  it("un grafo sin ciclos (diamante) está sano", () => {
    expect(findChunkCycles(bundleOf(chunk("app.js", ["charts.js", "d3.js"]), chunk("charts.js", ["d3.js", "core.js"]), chunk("d3.js", []), chunk("core.js", [])))).toEqual([]);
  });
});

describe("chunkCycleGuard (plugin del build)", () => {
  it("con un ciclo, el build FALLA con un mensaje que nombra los chunks", () => {
    const plugin = chunkCycleGuard();
    const errors: string[] = [];
    const ctx = { error: (m: string) => { errors.push(m); throw new Error(m); }, warn: () => {} };
    const bad = bundleOf(chunk("vendor-charts.js", ["vendor-3d.js"]), chunk("vendor-3d.js", ["vendor-charts.js"]));
    expect(() => plugin.generateBundle.call(ctx, {}, bad)).toThrow(/Chunks circulares/);
    expect(errors[0]).toMatch(/vendor-charts\.js → vendor-3d\.js → vendor-charts\.js|vendor-3d\.js → vendor-charts\.js → vendor-3d\.js/);
    expect(() => plugin.generateBundle.call(ctx, {}, bundleOf(chunk("a.js", ["b.js"]), chunk("b.js", [])))).not.toThrow();
  });

  it("avisa (sin fallar) de paquetes sin grupo que Rollup metió en un chunk vendor", () => {
    const warns: string[] = [];
    const ctx = { error: (m: string) => { throw new Error(m); }, warn: (m: string) => { warns.push(m); } };
    const b = { "vendor-charts.js": { type: "chunk" as const, fileName: "vendor-charts.js", name: "vendor-charts", imports: [], modules: { "/x/node_modules/recharts/es6/index.js": {}, "/x/node_modules/paquete-nuevo/index.js": {} } } };
    chunkCycleGuard().generateBundle.call(ctx, {}, b);
    expect(warns.join("\n")).toMatch(/vendor-charts .*paquete-nuevo/);
    expect(warns.join("\n")).not.toMatch(/recharts/);
  });
});

describe("reparto vendor (vite.chunks.ts)", () => {
  const nm = (p: string) => `/app/node_modules/${p}/index.js`;

  it("lo compartido por recharts y el globo vive en vendor-d3; el 3D no se fuerza a un chunk manual", () => {
    for (const p of ["d3-scale", "d3-array", "d3-delaunay", "d3-geo", "d3-geo-voronoi", "internmap", "delaunator", "robust-predicates"]) {
      expect(vendorChunk(nm(p)), p).toBe("vendor-d3");
    }
    for (const p of ["three", "three-globe", "three-conic-polygon-geometry", "globe.gl", "react-globe.gl", "kapsule", "@react-three/fiber"]) {
      expect(vendorChunk(nm(p)), p).toBeUndefined();
    }
    expect(vendorChunk(nm("recharts"))).toBe("vendor-charts");
    expect(vendorChunk(nm("victory-vendor"))).toBe("vendor-charts");
    expect(vendorChunk("/app/src/pages/Gastos.tsx")).toBeUndefined();
  });

  it("build real con Rollup: el caso de producción (delaunator pedido por d3-delaunay y por el globo) no produce ciclos", async () => {
    // Mini node_modules virtual con la misma forma que el árbol real.
    const files: Record<string, string> = {
      "/app/src/main.js": `export const go = () => [import("./SmartSpend.js"), import("./Globe.js")];`,
      "/app/src/SmartSpend.js": `import { chart } from "recharts"; export default chart;`,
      "/app/src/Globe.js": `import { globe } from "three-globe"; export default globe;`,
      [nm("recharts")]: `import { scale } from "d3-scale"; export const chart = () => scale();`,
      [nm("d3-scale")]: `import { arr } from "d3-array"; export const scale = () => arr();`,
      [nm("d3-array")]: `export const arr = () => 1;`,
      [nm("three-globe")]: `import { poly } from "three-conic-polygon-geometry"; import { scale } from "d3-scale"; export const globe = () => poly() + scale();`,
      [nm("three-conic-polygon-geometry")]: `import Delaunator from "delaunator"; import { voronoi } from "d3-geo-voronoi"; export const poly = () => new Delaunator().n + voronoi();`,
      [nm("d3-geo-voronoi")]: `import { Delaunay } from "d3-delaunay"; export const voronoi = () => new Delaunay().n;`,
      [nm("d3-delaunay")]: `import Delaunator from "delaunator"; export class Delaunay { constructor() { this.n = new Delaunator().n; } }`,
      [nm("delaunator")]: `export default class Delaunator { constructor() { this.n = 2; } }`,
    };
    const virtual: Plugin = {
      name: "virtual-fs",
      resolveId(src, importer) {
        if (src in files) return src;
        if (src.startsWith("./") && importer) return importer.replace(/[^/]+$/, "") + src.slice(2);
        return nm(src);
      },
      load(id) { return files[id]; },
    };
    const build = async (manualChunks: (id: string) => string | undefined) => {
      const b = await rollup({ input: "/app/src/main.js", plugins: [virtual], onwarn: () => {} });
      const out = await b.generate({ format: "es", manualChunks, plugins: [chunkCycleGuard() as Plugin] });
      await b.close();
      return out.output;
    };

    const out = await build(vendorChunk);
    const byName = Object.fromEntries(out.filter((o) => o.type === "chunk").map((o) => [o.name, o]));
    expect(Object.keys(byName["vendor-d3"].modules)).toEqual(expect.arrayContaining([nm("delaunator"), nm("d3-delaunay"), nm("d3-array")]));
    expect(byName["vendor-d3"].imports).toEqual([]); // hoja: no importa a nadie
    expect(byName["vendor-charts"].imports.every((f) => f.startsWith("vendor-d3"))).toBe(true);

    // El reparto anterior + la decisión de Rollup 4.21 (delaunator en vendor-3d) = el ciclo de
    // producción. La guarda lo convierte en un build fallido.
    const old = (id: string) => {
      const p = /node_modules\/([^/]+)/.exec(id)?.[1];
      if (!p) return undefined;
      if (p === "recharts" || p.startsWith("d3-")) return "vendor-charts";
      if (p.startsWith("three") || p === "delaunator") return "vendor-3d";
      return undefined;
    };
    await expect(build(old)).rejects.toThrow(/Chunks circulares/);
  });

  it("cada grupo es cerrado: las dependencias de sus paquetes instalados están en el mismo grupo o en uno anterior", () => {
    const root = join(__dirname, "..", "..", "node_modules");
    const rank = new Map(VENDOR_GROUPS.map(([name], i) => [name, i]));
    const groupOf = (pkg: string) => vendorChunk(`/x/node_modules/${pkg}/index.js`);
    const installed: string[] = [];
    for (const d of readdirSync(root)) {
      if (d.startsWith(".")) continue;
      if (d.startsWith("@")) for (const s of readdirSync(join(root, d))) installed.push(`${d}/${s}`);
      else installed.push(d);
    }
    // Dependencias que nunca llegan al navegador (solo Node o tipos).
    const SERVER_ONLY = /^(@types\/|csstype$|ws$|node-fetch$|@supabase\/node-fetch$|whatwg-url$|bufferutil$|utf-8-validate$|loose-envify$)/;
    const problems: string[] = [];
    for (const pkg of installed) {
      const g = groupOf(pkg);
      if (!g) continue;
      const pj = join(root, pkg, "package.json");
      if (!existsSync(pj)) continue;
      const deps = Object.keys(JSON.parse(readFileSync(pj, "utf8")).dependencies ?? {});
      for (const dep of deps) {
        if (SERVER_ONLY.test(dep) || !existsSync(join(root, dep))) continue;
        const dg = groupOf(dep);
        if (!dg || rank.get(dg)! > rank.get(g)!) problems.push(`${pkg} (${g}) → ${dep} (${dg ?? "sin grupo"})`);
      }
    }
    expect(problems).toEqual([]);
  });
});
