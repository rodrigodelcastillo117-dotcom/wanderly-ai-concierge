// Edge Function avatar-assets-gen y su lógica compartida con el script (con dobles; nunca IA real):
// idempotente por huella, respuesta por id, topes de gasto, máximo 3 por llamada y puerta x-cron-secret.
// También la bandera avatar_capas_enabled: apagada = todo como antes.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { clasificar, generarLote, PILOTO_IDS, planConHuella, type AssetGenDeps } from "../../supabase/functions/_shared/avatar-assets-gen.ts";
import { MAX_IDS_POR_LLAMADA, parseGenBody, TOPE_TOTAL_USD } from "../../supabase/functions/_shared/avatar-assets-gen-core.ts";
import { encodePng, makeRaster } from "../../supabase/functions/_shared/avatar-png.ts";
import { toDataUrl } from "../../supabase/functions/_shared/avatar-prompts.ts";
import { createVariants, type CoreDeps } from "../../supabase/functions/_shared/avatar-flow.ts";
import { costoEstimado } from "../../supabase/functions/_shared/avatar-inventory.ts";

const MODELS = ["google/gemini-3-pro-image-preview"];

async function pngOn(green: boolean): Promise<string> {
  const r = makeRaster(120, 120);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
    const inside = Math.hypot(x - 60, y - 60) < 35;
    r.data.set(inside || !green ? [210, 150, 60, 255] : [0, 255, 0, 255], (y * 120 + x) * 4);
  }
  return toDataUrl(await encodePng(r), "image/png");
}

function deps(over: Partial<AssetGenDeps> = {}) {
  const uploads: string[] = [];
  const rows: any[] = [];
  const usage: any[] = [];
  const d: AssetGenDeps = {
    generate: vi.fn(async (prompt: string) => ({
      ok: true as const, url: await pngOn(!/backdrop/.test(prompt)), model: MODELS[0],
      usage: { function: "x", provider: "lovable", model: MODELS[0], cost_estimate_usd: 0.134 },
    })),
    fetchBytes: vi.fn(async () => null),
    upload: vi.fn(async (p: string) => { uploads.push(p); }),
    upsertAsset: vi.fn(async (r: any) => { rows.push(r); }),
    logUsage: vi.fn((u: any) => { usage.push(u); }),
    ...over,
  };
  return { d, uploads, rows, usage };
}

describe("avatar-assets-gen: lote de hasta 3", () => {
  it("genera lo pendiente, salta lo ya generado (misma huella) y marca ids desconocidos; respuesta por id en orden", async () => {
    const plan = new Map(planConHuella().map((a) => [a.id, a]));
    const existing = new Map([["c-paris-1", plan.get("c-paris-1")!.hash]]);
    const t = deps();
    const r = await generarLote(["mx-angel", "c-paris-1", "no-existe"], existing, { models: MODELS, maxUsd: 1, paralelo: true }, t.d);
    expect(r.resultados.map((x) => [x.id, x.estado])).toEqual([["mx-angel", "generado"], ["c-paris-1", "saltado"], ["no-existe", "error"]]);
    expect(t.d.generate).toHaveBeenCalledTimes(1);
    expect(t.uploads).toEqual(["fondos/mx-angel.png"]);
    expect(t.rows[0]).toMatchObject({ id: "mx-angel", kind: "fondo", pais: "MX", souvenir_key: null, width: 1024, height: 1280 });
    expect(t.usage[0]).toMatchObject({ function: "avatar-assets", cost_estimate_usd: 0.134 }); // ai_usage_log
    expect(r.gastado).toBe(0.134);
  });
  it("un prompt cambiado se vuelve a generar; forzar regenera aunque exista", () => {
    const existing = new Map([["c-paris-1", "0000000000000000"]]);
    expect(clasificar(["c-paris-1"], existing).pendientes.map((a) => a.id)).toEqual(["c-paris-1"]);
    const plan = new Map(planConHuella().map((a) => [a.id, a.hash]));
    expect(clasificar(["c-paris-1"], new Map([["c-paris-1", plan.get("c-paris-1")!]]), true).pendientes).toHaveLength(1);
  });
  it("tope por llamada y tope acumulado: si el estimado no cabe, no se llama a la IA", async () => {
    const t = deps();
    const r = await generarLote(["c-paris-1", "c-paris-2", "p-ar-1"], new Map(), { models: MODELS, maxUsd: 0.2, paralelo: true }, t.d);
    expect(r.tope).toBe(true);
    expect(r.resultados.every((x) => x.estado === "error" && /tope/.test(x.detalle ?? ""))).toBe(true);
    expect(t.d.generate).not.toHaveBeenCalled();
    const t2 = deps();
    const r2 = await generarLote(["c-paris-1"], new Map(), { models: MODELS, maxUsd: 1, gastadoPrevio: TOPE_TOTAL_USD - 0.1, topeTotalUsd: TOPE_TOTAL_USD }, t2.d);
    expect(r2.tope).toBe(true);
    expect(t2.d.generate).not.toHaveBeenCalled();
  });
  it("si el modelo no respeta el verde en un objeto, ese id es error (no se sube nada)", async () => {
    const t = deps({ generate: vi.fn(async () => ({ ok: true as const, url: await pngOn(false), model: MODELS[0], usage: { function: "x", provider: "lovable", cost_estimate_usd: 0.134 } })) });
    const r = await generarLote(["c-paris-1"], new Map(), { models: MODELS, maxUsd: 1 }, t.d);
    expect(r.resultados[0]).toMatchObject({ estado: "error" });
    expect(r.resultados[0].detalle).toMatch(/recorte/);
    expect(t.uploads).toEqual([]);
  });
  it("cuerpo de la petición: 1 a 3 ids válidos, max_usd 0-10", () => {
    expect(MAX_IDS_POR_LLAMADA).toBe(3);
    expect(parseGenBody({ ids: ["mx-angel", "mx-angel"] })).toEqual({ ok: true, ids: ["mx-angel"], maxUsd: 1, forzar: false });
    expect(parseGenBody({ ids: ["a-1", "b-1", "c-1", "d-1"] }).ok).toBe(false);
    expect(parseGenBody({ ids: ["../x"] }).ok).toBe(false);
    expect(parseGenBody({ ids: [] }).ok).toBe(false);
    expect(parseGenBody({ ids: ["mx-angel"], max_usd: 50 }).ok).toBe(false);
    expect(parseGenBody(null).ok).toBe(false);
  });
  it("los 12 de la prueba piloto existen en el catálogo y van en 4 llamadas de 3 (≈1.61 USD)", () => {
    const plan = new Set(planConHuella().map((a) => a.id));
    const flat = PILOTO_IDS.flat();
    expect(PILOTO_IDS.map((g) => g.length)).toEqual([3, 3, 3, 3]);
    expect(new Set(flat).size).toBe(12);
    for (const id of flat) expect(plan.has(id), id).toBe(true);
    for (const g of PILOTO_IDS) expect(parseGenBody({ ids: g }).ok).toBe(true);
    expect(costoEstimado(12)).toBe(1.608);
  });
  it("la función: puerta x-cron-secret (isAuthorizedCron), verify_jwt = false, misma lógica que el script", () => {
    const src = readFileSync("supabase/functions/avatar-assets-gen/index.ts", "utf8");
    expect(src).toMatch(/isAuthorizedCron\(req\)/);
    expect(src).toMatch(/generarLote\(/);
    expect(src).toMatch(/paralelo: true/);
    expect(src).toMatch(/ai_usage_log/);
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(/\[functions\.avatar-assets-gen\]\s*\nverify_jwt = false/);
    expect(readFileSync("scripts/avatar-assets/generate.mjs", "utf8")).toMatch(/generarLote/);
  });
});

describe("bandera avatar_capas_enabled (apagada = todo como antes)", () => {
  it("generate-avatar y avatar-capas preguntan al servidor; el cliente usa avatar_capas_activo", () => {
    const gen = readFileSync("supabase/functions/generate-avatar/index.ts", "utf8");
    expect(gen).toMatch(/const capas = await capasHabilitado\(db, uid\);/);
    expect(gen).toMatch(/if \(!capas\) return json\(\{ ok: true, variants: out, verificado: selfies\.length > 0 \}\);/);
    expect(readFileSync("supabase/functions/avatar-capas/index.ts", "utf8")).toMatch(/capasHabilitado\(db, uid\)/);
    expect(readFileSync("supabase/functions/_shared/avatar-runtime.ts", "utf8")).toMatch(/rpc\("avatar_capas_para"/);
    expect(readFileSync("src/components/avatar/useAvatarLayers.ts", "utf8")).toMatch(/rpc\("avatar_capas_activo"\)/);
  });
  it("crear con la bandera apagada: retrato de siempre, sin recorte ni cuerpo completo", async () => {
    const prompts: string[] = [];
    const prepare = vi.fn();
    const d: CoreDeps = {
      generate: vi.fn(async (p: string) => { prompts.push(p); return { ok: true as const, url: "data:image/png;base64,X", model: "m", usage: { function: "t", provider: "lovable" } }; }),
      check: vi.fn(async () => ({ likeness: { score: 90, diferencias: [] }, usage: null })),
      take: vi.fn(async (k: number) => k),
      logUsage: vi.fn(),
      prepare,
    };
    const r = await createVariants(d, { selfies: ["data:image/jpeg;base64,S"], builder: null, capas: false });
    expect(prepare).not.toHaveBeenCalled();
    expect(prompts.every((p) => !/FULL BODY|#00FF00/.test(p))).toBe(true);
    expect(r.ok && r.variants[0]).not.toHaveProperty("recortada");
  });
});
