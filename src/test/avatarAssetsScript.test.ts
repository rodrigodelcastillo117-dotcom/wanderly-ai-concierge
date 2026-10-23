// scripts/avatar-assets/generate.mjs con dobles: muestra el costo antes, no llama a la IA sin
// --confirm, es idempotente y procesa fondos (4:5) y objetos (recortados). Nunca se usa la API real.
import { describe, expect, it, vi } from "vitest";
import { buildPlan, parseArgs, processImage, run } from "../../scripts/avatar-assets/generate.mjs";
import { encodePng, decodePng, makeRaster } from "../../supabase/functions/_shared/avatar-png.ts";
import { planDeAssets, promptHash } from "../../supabase/functions/_shared/avatar-inventory.ts";
import { toDataUrl } from "../../supabase/functions/_shared/avatar-prompts.ts";

async function greenObjectPng(): Promise<Uint8Array> {
  const r = makeRaster(120, 120);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
    const inside = Math.hypot(x - 60, y - 60) < 35;
    r.data.set(inside ? [210, 150, 60, 255] : [0, 255, 0, 255], (y * 120 + x) * 4);
  }
  return encodePng(r);
}

function deps(existing: Array<{ id: string; prompt_hash: string }> = []) {
  const logs: string[] = [];
  const uploads: string[] = [];
  const rows: any[] = [];
  return {
    logs, uploads, rows,
    d: {
      log: (m: string) => logs.push(m),
      models: ["google/gemini-3-pro-image-preview"],
      listAssets: vi.fn(async () => existing),
      generate: vi.fn(async () => ({ ok: true, url: toDataUrl(await greenObjectPng(), "image/png"), model: "google/gemini-3-pro-image-preview", usage: { function: "avatar-assets", provider: "lovable", cost_estimate_usd: 0.134 } })),
      fetchBytes: vi.fn(async () => null),
      upload: vi.fn(async (p: string) => { uploads.push(p); }),
      upsertAsset: vi.fn(async (r: any) => { rows.push(r); }),
      logUsage: vi.fn(),
    },
  };
}

describe("script del inventario", () => {
  it("sin --confirm: muestra el costo estimado y NO llama a la IA", async () => {
    const t = deps();
    const r = await run([], t.d);
    expect(r.dryRun).toBe(true);
    expect(t.d.generate).not.toHaveBeenCalled();
    expect(t.logs.join("\n")).toMatch(/396 imágenes \(76 fondos \+ 320 objetos\)/);
    expect(t.logs.join("\n")).toMatch(/COSTO ESTIMADO DE ESTA CORRIDA: 53\.06 USD/);
  });
  it("idempotente: se salta lo ya generado con la misma huella; regenera si cambió el prompt", () => {
    const plan = planDeAssets();
    const existing = new Map([[plan[0].id, promptHash(plan[0].prompt)], [plan[1].id, "0000000000000000"]]);
    const p = buildPlan(parseArgs([]), existing, 0.134);
    expect(p.pendientes.map((a: any) => a.id)).not.toContain(plan[0].id);
    expect(p.pendientes.map((a: any) => a.id)).toContain(plan[1].id);
    expect(p.costoEstimado).toBe(Math.round((plan.length - 1) * 0.134 * 1000) / 1000);
  });
  it("con --confirm genera, recorta y registra (dobles); tope de seguridad --max-usd", async () => {
    const t = deps();
    const r = await run(["--confirm", "--ids=c-paris-1,c-paris-2"], t.d);
    expect(r).toMatchObject({ ok: true, generados: 2, fallidos: 0 });
    expect(t.uploads).toEqual(["objetos/c-paris-1.png", "objetos/c-paris-2.png"]);
    expect(t.rows[0]).toMatchObject({ id: "c-paris-1", kind: "objeto", souvenir_key: "ciudad:paris", path: "objetos/c-paris-1.png" });
    expect(t.rows[0].prompt_hash).toMatch(/^[0-9a-f]{16}$/);
    const caro = deps();
    const r2 = await run(["--confirm", "--max-usd=1"], caro.d);
    expect(r2).toMatchObject({ ok: false, code: 3 });
    expect(caro.d.generate).not.toHaveBeenCalled();
  });
  it("si se acaban los créditos se detiene (no sigue pidiendo)", async () => {
    const t = deps();
    (t.d as any).generate = vi.fn(async () => ({ ok: false, code: "sin_creditos", detail: "402", usage: [] }));
    const r = await run(["--confirm", "--solo=objetos", "--limite=5"], t.d);
    expect(t.d.generate).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });
  it("procesa: fondo a 4:5 opaco; objeto recortado con transparencia", async () => {
    const bg = makeRaster(200, 200);
    for (let i = 0; i < bg.data.length; i += 4) bg.data.set([30, 60, 90, 255], i);
    const f = await processImage("fondo", await encodePng(bg));
    expect([f.width, f.height]).toEqual([1024, 1280]);
    const o = await processImage("objeto", await greenObjectPng());
    const back = await decodePng(o.bytes);
    expect(back.data[3]).toBe(0); // esquina transparente
    expect(o.width).toBeLessThan(120);
  });
});
