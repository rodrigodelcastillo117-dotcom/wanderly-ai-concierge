// Orquestación del avatar con dobles (nunca se llama a la IA real): variantes verificadas,
// reintento único, cupo diario, e idempotencia de la evolución por viaje.
import { describe, expect, it, vi } from "vitest";
import { createVariants, processTripEvolution, rebuildAvatar, type CoreDeps, type EvolutionDeps, type OwnedSouvenir } from "../../supabase/functions/_shared/avatar-flow.ts";
import type { ImageResult } from "../../supabase/functions/_shared/avatar-image.ts";
import type { Souvenir } from "../../supabase/functions/_shared/souvenirs.ts";

const SELFIE = "data:image/jpeg;base64,SELFIE";
let n = 0;
const okImage = (model = "google/gemini-3-pro-image-preview"): ImageResult => ({
  ok: true, url: `data:image/png;base64,IMG${++n}`, model, usage: { function: "t", provider: "lovable", model, cost_estimate_usd: 0.134 },
});

function core(scores: number[], quota = 99): CoreDeps & { prompts: string[]; logged: number } {
  const prompts: string[] = [];
  let left = quota;
  const deps = {
    prompts,
    logged: 0,
    generate: vi.fn(async (prompt: string) => { prompts.push(prompt); return okImage(); }),
    check: vi.fn(async () => {
      const s = scores.shift();
      return { likeness: s === undefined ? null : { score: s, diferencias: s < 72 ? ["mandíbula más ancha"] : [] }, usage: { function: "t", provider: "gemini" } };
    }),
    take: vi.fn(async (k: number) => { const g = Math.min(k, left); left -= g; return g; }),
    logUsage: vi.fn(() => { deps.logged++; }),
  };
  return deps as any;
}

describe("crear avatar: 2 variantes verificadas contra la selfie", () => {
  it("parecido alto: 2 variantes, sin reintentos, ordenadas por parecido", async () => {
    const d = core([80, 93]);
    const r = await createVariants(d, { selfies: [SELFIE], builder: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.variants.map((v) => v.score)).toEqual([93, 80]);
      expect(r.imagenes).toBe(2);
    }
    expect(d.generate).toHaveBeenCalledTimes(2);
    expect((d.generate as any).mock.calls[0][1]).toEqual([SELFIE]); // la selfie SÍ llega al modelo
  });

  it("parecido bajo: UN reintento con las diferencias del juez y se queda la mejor", async () => {
    const d = core([50, 90, 88]);
    const r = await createVariants(d, { selfies: [SELFIE], builder: null, variants: 2 });
    expect(r.ok).toBe(true);
    expect(d.generate).toHaveBeenCalledTimes(3);
    expect(d.prompts.some((p) => /Fix these differences: mandíbula más ancha/.test(p))).toBe(true);
    if (r.ok) expect(r.variants.every((v) => (v.score ?? 0) >= 72)).toBe(true);
  });

  it("cupo diario agotado: no se genera nada", async () => {
    const d = core([], 0);
    const r = await createVariants(d, { selfies: [SELFIE], builder: null });
    expect(r).toEqual({ ok: false, code: "limite_diario", imagenes: 0 });
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("cupo para 1: una variante y sin reintento aunque no se parezca", async () => {
    const d = core([40], 1);
    const r = await createVariants(d, { selfies: [SELFIE], builder: null });
    expect(r.ok && r.variants.length).toBe(1);
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it("por rasgos: sin juez (no hay foto con qué comparar)", async () => {
    const d = core([]);
    const r = await createVariants(d, { selfies: null, builder: { skin: "deep dark brown skin" } });
    expect(r.ok).toBe(true);
    expect(d.check).not.toHaveBeenCalled();
  });

  it("el error del proveedor se informa con su código", async () => {
    const d = core([]);
    d.generate = vi.fn(async () => ({ ok: false as const, code: "sin_creditos" as const, detail: "402", usage: [] }));
    const r = await createVariants(d, { selfies: [SELFIE], builder: null });
    expect(r).toMatchObject({ ok: false, code: "sin_creditos" });
  });
});

/** Base de datos de mentiras con la misma regla que avatar_claim_trip: una fila por (persona, viaje). */
function evolutionDeps(opts: { base?: string | null; scores?: number[]; owned?: OwnedSouvenir[] } = {}) {
  const rows = new Map<string, { id: string; status: string; visible?: boolean; souvenir: Souvenir }>();
  const notices: string[] = [];
  const published: string[] = [];
  let visible: string[] = [];
  const c = core(opts.scores ?? [95], 10);
  const deps: EvolutionDeps & { notices: string[]; published: string[]; rows: typeof rows; visible: () => string[] } = {
    ...c,
    notices, published, rows, visible: () => visible,
    claim: vi.fn(async (s: Souvenir) => {
      const key = "trip-1";
      const r = rows.get(key);
      if (!r) { rows.set(key, { id: "row-1", status: "pendiente", souvenir: s }); return { id: "row-1" }; }
      return null; // ya procesado o en proceso
    }),
    loadBase: vi.fn(async () => (opts.base === undefined ? "data:image/png;base64,BASE" : opts.base)),
    publish: vi.fn(async (url: string) => { published.push(url); return "https://cdn.iatos/avatar.png"; }),
    finish: vi.fn(async (_id, patch) => { const r = rows.get("trip-1")!; r.status = patch.status; r.visible = patch.visible; }),
    setVisible: vi.fn(async (keys: string[]) => { visible = keys; }),
    notify: vi.fn(async (title: string) => { notices.push(title); }),
  };
  return deps;
}

describe("evolución por viaje", () => {
  const roma = { destino: "Roma", pais_destino: "Italia" };

  it("viaje a Roma: se dibuja el pin del Coliseo, se publica y se avisa", async () => {
    const d = evolutionDeps();
    const out = await processTripEvolution(d, { trip: roma, owned: [] });
    expect(out.status).toBe("aplicado");
    expect(out.souvenir.key).toBe("ciudad:roma");
    expect(d.published).toHaveLength(1);
    expect(d.rows.get("trip-1")).toMatchObject({ status: "aplicado", visible: true });
    expect(d.notices).toEqual(["Tu avatar ganó un detalle de Roma"]);
    // Se edita la imagen BASE (la cara sale de ahí), no la última versión.
    expect((d.generate as any).mock.calls[0][1]).toEqual(["data:image/png;base64,BASE"]);
  });

  it("idempotente: el mismo viaje dos veces = una sola imagen y un solo aviso", async () => {
    const d = evolutionDeps();
    await processTripEvolution(d, { trip: roma, owned: [] });
    const second = await processTripEvolution(d, { trip: roma, owned: [] });
    expect(second.status).toBe("ya_procesado");
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(d.notices).toHaveLength(1);
  });

  it("máximo 3 recuerdos dibujados: el más viejo pasa a la colección", async () => {
    const owned: OwnedSouvenir[] = ["ciudad:cdmx", "ciudad:paris", "ciudad:tokio"].map((key) => ({ key, prompt: key, slot: "pin" as const, status: "aplicado" as const, visible: true }));
    const d = evolutionDeps({ owned });
    await processTripEvolution(d, { trip: roma, owned });
    expect(d.visible()).toEqual(["ciudad:paris", "ciudad:tokio", "ciudad:roma"]);
  });

  it("destino repetido: sin imagen nueva (no se gasta)", async () => {
    const owned: OwnedSouvenir[] = [{ key: "ciudad:roma", prompt: "x", slot: "pin", status: "aplicado", visible: true }, { key: "pais:IT", prompt: "x", slot: "pin", status: "aplicado", visible: false }];
    const d = evolutionDeps({ owned });
    const out = await processTripEvolution(d, { trip: roma, owned });
    expect(out.status).toBe("repetido");
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("sin avatar todavía: el recuerdo queda guardado y se avisa que se luce al crearlo", async () => {
    const d = evolutionDeps({ base: null });
    const out = await processTripEvolution(d, { trip: { destino: "Nueva York" }, owned: [] });
    expect(out.status).toBe("sin_avatar");
    expect(d.generate).not.toHaveBeenCalled();
    expect(d.notices[0]).toMatch(/Desbloqueaste un detalle de Nueva York/);
  });

  it("si la persona cambió en la edición (y en el reintento), NO se publica: va a la colección", async () => {
    const d = evolutionDeps({ scores: [40, 45] });
    const out = await processTripEvolution(d, { trip: roma, owned: [] });
    expect(d.generate).toHaveBeenCalledTimes(2);
    expect(d.published).toHaveLength(0);
    expect(out.status).toBe("aplicado");
    expect(d.rows.get("trip-1")).toMatchObject({ status: "aplicado", visible: false });
  });

  it("al estrenar avatar se dibujan en UNA imagen los últimos 3 de la colección", async () => {
    const d = evolutionDeps();
    const applied = ["ciudad:cdmx", "ciudad:paris", "ciudad:tokio", "ciudad:roma"].map((key) => ({ key, prompt: `item ${key}`, slot: "pin" as const }));
    const r = await rebuildAvatar(d, "data:image/png;base64,BASE", applied);
    expect(r.ok).toBe(true);
    expect(r.visibleKeys).toEqual(["ciudad:paris", "ciudad:tokio", "ciudad:roma"]);
    expect(d.generate).toHaveBeenCalledTimes(1);
  });
});
