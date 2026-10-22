// privevalor · curaduría: el lote verificado (data/prive/valor/2026-10) cumple las reglas, la migración de
// siembra está sincronizada con esos archivos, y el validador rechaza lo que la base rechazaría.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dropProblems, importSql, tipProblems, validateBatch } from "../../scripts/prive/value-lib.mjs";

const root = join(__dirname, "..", "..");
const drops = JSON.parse(readFileSync(join(root, "data/prive/valor/2026-10/drops.json"), "utf8"));
const tips = JSON.parse(readFileSync(join(root, "data/prive/valor/2026-10/insider.json"), "utf8"));
const seed = readFileSync(join(root, "supabase/migrations/20261024100400_privevalor_seed.sql"), "utf8");

describe("lote verificado 2026-10", () => {
  it("todos los Drops pasan la validación y traen fuente oficial https y fecha de verificación", () => {
    const r = validateBatch(drops, dropProblems, { today: "2026-10-22" });
    expect(r.rejected).toEqual([]);
    for (const d of drops) {
      expect(d.source_url).toMatch(/^https:\/\//);
      expect(d.link_url).toMatch(/^https:\/\//);
      expect(Date.parse(d.last_verified_at)).not.toBeNaN();
    }
  });
  it("no hay beneficios de tarjeta ni beneficios IATOS (no verificables / sin convenio)", () => {
    expect(drops.filter((d: { type: string }) => d.type === "beneficio_tarjeta" || d.type === "beneficio_iatos")).toEqual([]);
  });
  it("ningún Drop declara porcentaje ni escasez", () => {
    const txt = JSON.stringify(drops);
    expect(txt).not.toMatch(/[0-9]\s*%/);
    expect(txt).not.toMatch(/solo quedan|últim[oa]s? lugares|last chance|only \d+ left/i);
  });
  it("todos los consejos pasan la validación, con fuente y fecha de revisión", () => {
    const r = validateBatch(tips, tipProblems, { today: "2026-10-22" });
    expect(r.rejected).toEqual([]);
    expect(new Set(tips.map((t: { destination_slug: string }) => t.destination_slug))).toEqual(new Set(["paris", "mc", "cdmx", "los-cabos", "nueva-york", "tokio", "londres"]));
  });
  it("la migración de siembra contiene exactamente los slugs del lote (generada por load_value_curation.mjs)", () => {
    for (const d of drops) expect(seed).toContain(`"slug": "${d.slug}"`);
    for (const t of tips) expect(seed).toContain(`"slug": "${t.slug}"`);
    expect(seed).toContain(importSql("prive_drops_import_batch", drops, "valor-2026-10", false).replace(/^SELECT /, "").replace(/;\n$/, ""));
  });
});

describe("validador de Drops (espejo de la base)", () => {
  const ok = { slug: "x-y-z", type: "promocion_publica", title_es: "Promo real", provider_name: "Proveedor", benefit_es: "Beneficio real",
    conditions_es: "Condiciones", eligibility_es: "Todos", source_url: "https://a.test", link_url: "https://a.test", last_verified_at: "2026-10-22T00:00:00Z", verified_by: "equipo" };
  it("acepta una promoción completa", () => expect(dropProblems(ok)).toEqual([]));
  it("rechaza porcentaje sin comparación, escasez, http, beneficio IATOS, vencido y precio sin fuente", () => {
    expect(dropProblems({ ...ok, title_es: "Hasta 40% en suites" }).join()).toMatch(/porcentaje/);
    expect(dropProblems({ ...ok, benefit_es: "Solo quedan 2 habitaciones" }).join()).toMatch(/escasez/);
    expect(dropProblems({ ...ok, source_url: "http://a.test" }).join()).toMatch(/source_url/);
    expect(dropProblems({ ...ok, type: "beneficio_iatos" }).join()).toMatch(/IATOS/);
    expect(dropProblems({ ...ok, valid_until: "2026-10-01" }, { today: "2026-10-22" }).join()).toMatch(/vencido/);
    expect(dropProblems({ ...ok, offer_price: 20 }).join()).toMatch(/moneda y fuente/);
    expect(dropProblems({ ...ok, offer_price: 80, reference_price: 100, price_currency: "EUR", price_source_url: "https://a.test", discount_pct: 40 }).join()).toMatch(/porcentaje/);
    expect(dropProblems({ ...ok, offer_price: 75, reference_price: 100, price_currency: "EUR", price_source_url: "https://a.test", discount_pct: 25, benefit_es: "25 % menos" })).toEqual([]);
  });
  it("el SQL de importación no se puede romper con el contenido (dollar-quoting)", () => {
    const sql = importSql("prive_drops_import_batch", [{ ...ok, benefit_es: "texto con $pv$ y comillas '" }], "b", true);
    expect(sql).toMatch(/^SELECT public\.prive_drops_import_batch\(\$pvx\$/);
    expect(sql.trim().endsWith(", 'b', true);")).toBe(true);
  });
});

describe("rutas de privevalor", () => {
  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  it("se cargan bajo demanda (no crecen el paquete inicial) y viven dentro de PriveRoot", () => {
    for (const page of ["PriveDropsPage", "PriveInsiderPage"]) {
      expect(app).toMatch(new RegExp(`const ${page} = lazyWithRetry\\(\\(\\) => import\\("\\./pages/prive/${page}"\\)\\)`));
      expect(app).not.toMatch(new RegExp(`^import ${page}`, "m"));
    }
    const prive = app.slice(app.indexOf('<Route path="/prive"'), app.indexOf("</Route>", app.indexOf('<Route path="/prive"')));
    for (const p of ['path="drops"', 'path="insider"', 'path="insider/:destino"']) expect(prive).toContain(p);
  });
});
