// Avatar por capas con dobles (nunca IA real): cuerpo completo, juez contra el recorte de la cara,
// mano ubicada por el juez, y recuerdos nuevos SIN IA (composición gratuita).
import { describe, expect, it, vi } from "vitest";
import { createVariants, processTripEvolution, type CoreDeps, type EvolutionDeps } from "../../supabase/functions/_shared/avatar-flow.ts";
import { identityPrompt, builderPrompt, likenessPrompt, parseLikeness } from "../../supabase/functions/_shared/avatar-prompts.ts";
import { checkLikeness } from "../../supabase/functions/_shared/avatar-image.ts";
import type { ImageResult } from "../../supabase/functions/_shared/avatar-image.ts";
import type { Souvenir } from "../../supabase/functions/_shared/souvenirs.ts";

const SELFIE = "data:image/jpeg;base64,SELFIE";
let n = 0;
const okImage = (): ImageResult => ({ ok: true, url: `data:image/png;base64,IMG${++n}`, model: "google/gemini-3-pro-image-preview", usage: { function: "t", provider: "lovable", cost_estimate_usd: 0.134 } });

function core(scores: Array<{ score: number; mano?: [number, number] | null }>, prepareOk = true) {
  const prompts: string[] = [];
  const checks: unknown[][] = [];
  const deps: CoreDeps = {
    generate: vi.fn(async (p: string) => { prompts.push(p); return okImage(); }),
    check: vi.fn(async (...args: unknown[]) => {
      checks.push(args);
      const s = scores.shift();
      return { likeness: s ? { score: s.score, diferencias: s.score < 72 ? ["nariz distinta"] : [], mano: s.mano ?? null } : null, usage: null };
    }),
    take: vi.fn(async (k: number) => k),
    logUsage: vi.fn(),
    prepare: vi.fn(async (url: string) => prepareOk
      ? { persona: `${url}#persona`, faceView: `${url}#cara`, cara: { cx: 0.5, cy: 0.12, side: 0.28 } }
      : null),
  };
  return { deps, prompts, checks };
}

describe("prompts de cuerpo completo (versión con capas)", () => {
  it("cuerpo completo, de pie, mano derecha vacía levantada, verde croma, sin tocar la cara", () => {
    const p = identityPrompt({ photos: 1, capas: true });
    expect(p).toMatch(/FULL BODY portrait, head to toe/);
    expect(p).toMatch(/head about one sixth of the body height/);
    expect(p).toMatch(/hand is EMPTY/);
    expect(p).toMatch(/Hands never cover the face/);
    expect(p).toMatch(/#00FF00/);
    expect(p).toMatch(/NOT a caricature/);
    for (const rule of [/skin tone/i, /glasses/i, /facial hair/i]) expect(p).toMatch(rule);
    expect(builderPrompt({}, 1, { capas: true })).toMatch(/FULL BODY/);
    // La versión anterior (sin capas) no cambia: retrato de busto.
    expect(identityPrompt({ photos: 1 })).not.toMatch(/FULL BODY|head to toe/i);
  });
  it("el juez compara la cara y ubica la mano (0-1000 → fracción)", () => {
    expect(likenessPrompt("selfie", { mano: true })).toMatch(/close crop of the face/);
    expect(likenessPrompt("selfie", { mano: true })).toMatch(/"mano": \[x, y\]/);
    expect(parseLikeness('{"score": 88, "diferencias": [], "mano": [330, 410]}')).toEqual({ score: 88, diferencias: [], mano: [0.33, 0.41] });
    expect(parseLikeness('{"score": 88, "diferencias": [], "mano": null}')).toEqual({ score: 88, diferencias: [], mano: null });
    expect(parseLikeness('{"score": 88, "diferencias": [], "mano": [2000, 5]}')?.mano).toBeNull();
  });
  it("checkLikeness manda selfie, recorte de la cara y figura completa (sin red)", async () => {
    let body: any = null;
    const r = await checkLikeness({
      lovableKey: "k",
      chat: async (init) => { body = JSON.parse(String(init.body)); return { res: new Response(JSON.stringify({ choices: [{ message: { content: '{"score":90,"diferencias":[],"mano":[300,400]}' } }] })), provider: "gemini", model: "m" }; },
    }, { reference: SELFIE, candidate: "data:cara", full: "data:cuerpo", mode: "selfie", fn: "t", userId: null });
    expect(body.messages[0].content.map((c: any) => c.image_url?.url).filter(Boolean)).toEqual([SELFIE, "data:cara", "data:cuerpo"]);
    expect(r.likeness?.mano).toEqual([0.3, 0.4]);
  });
});

describe("crear con capas: recorte y juez contra la cara", () => {
  it("la variante es la persona recortada, con su cara y la mano; el juez ve el recorte de la cara", async () => {
    const { deps, checks } = core([{ score: 91, mano: [0.33, 0.4] }, { score: 85, mano: null }]);
    const r = await createVariants(deps, { selfies: [SELFIE], builder: null, capas: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants[0]).toMatchObject({ recortada: true, score: 91, mano: [0.33, 0.4], cara: { cx: 0.5, cy: 0.12, side: 0.28 } });
    expect(r.variants[0].url).toMatch(/#persona$/);
    expect(checks[0][1]).toMatch(/#cara$/); // recorte de la cara
    expect(checks[0][3]).toMatch(/^data:image\/png;base64,IMG/); // figura completa para la mano
  });
  it("parecido bajo: un reintento, también juzgado por la cara", async () => {
    const { deps, prompts, checks } = core([{ score: 50 }, { score: 90 }, { score: 88 }]);
    const r = await createVariants(deps, { selfies: [SELFIE], builder: null, variants: 1, capas: true });
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toMatch(/Fix these differences: nariz distinta/);
    expect(prompts[1]).toMatch(/FULL BODY/);
    expect(checks.every((c) => String(c[1]).endsWith("#cara"))).toBe(true);
    expect(r.ok && r.variants[0].score).toBe(90);
  });
  it("si el recorte falla (fondo no plano), la variante se guarda tal cual y el juez ve la imagen", async () => {
    const { deps, checks } = core([{ score: 80 }], false);
    const r = await createVariants(deps, { selfies: [SELFIE], builder: null, variants: 1, capas: true });
    expect(r.ok && r.variants[0]).toMatchObject({ recortada: false, cara: null });
    expect(checks[0][3]).toBeUndefined();
  });
});

function evo(objetos: string[] | null, failPublish = false) {
  const rows = new Map<string, { status: string; visible?: boolean; model?: string | null }>();
  const notices: string[] = [];
  const published: string[][] = [];
  let visible: string[] = [];
  const { deps: c } = core([]);
  const deps: EvolutionDeps = {
    ...c,
    claim: vi.fn(async (_s: Souvenir) => (rows.has("t") ? null : (rows.set("t", { status: "pendiente" }), { id: "t" }))),
    loadBase: vi.fn(async () => "data:image/png;base64,BASE"),
    publish: vi.fn(async () => "https://cdn/x.png"),
    finish: vi.fn(async (_id, patch) => { rows.set("t", { status: patch.status, visible: patch.visible, model: patch.model }); }),
    setVisible: vi.fn(async (k: string[]) => { visible = k; }),
    notify: vi.fn(async (t: string, b: string) => { notices.push(`${t} — ${b}`); }),
    loadLayers: vi.fn(async () => (objetos ? { objetos } : null)),
    publishLayers: vi.fn(async (o: string[]) => { if (failPublish) throw new Error("storage"); published.push(o); return "https://cdn/cara.png"; }),
  };
  return { deps, rows, notices, published, visible: () => visible };
}

describe("recuerdos con capas: SIN IA", () => {
  it("viaje a París: croissant en la mano, se publica gratis y se avisa", async () => {
    const d = evo(["c-cdmx-1"]);
    const out = await processTripEvolution(d.deps, { trip: { destino: "París" }, owned: [] });
    expect(out).toMatchObject({ status: "aplicado", url: "https://cdn/cara.png", dibujado: true });
    expect(d.deps.generate).not.toHaveBeenCalled();
    expect(d.deps.check).not.toHaveBeenCalled();
    expect(d.published).toEqual([["c-cdmx-1", "c-paris-1"]]);
    expect(d.visible()).toEqual(["ciudad:cdmx", "ciudad:paris"]);
    expect(d.rows.get("t")).toMatchObject({ status: "aplicado", visible: true, model: "capas" });
    expect(d.notices[0]).toMatch(/Croissant 🥐 y Torre Eiffel 🗼/);
  });
  it("máximo 3: sale el más viejo", async () => {
    const d = evo(["c-cdmx-1", "c-paris-1", "p-ar-1"]);
    await processTripEvolution(d.deps, { trip: { destino: "Roma" }, owned: [] });
    expect(d.published[0]).toEqual(["c-paris-1", "p-ar-1", "c-roma-1"]);
  });
  it("si componer falla, el recuerdo queda en la colección (sin IA, sin cobro)", async () => {
    const d = evo([], true);
    const out = await processTripEvolution(d.deps, { trip: { destino: "Roma" }, owned: [] });
    expect(out.status).toBe("aplicado");
    expect(d.rows.get("t")).toMatchObject({ status: "aplicado", visible: false });
    expect(d.deps.generate).not.toHaveBeenCalled();
  });
  it("avatar de antes (sin capas): sigue el camino con IA de siempre", async () => {
    const d = evo(null);
    (d.deps.check as any).mockResolvedValue({ likeness: { score: 95, diferencias: [] }, usage: null });
    await processTripEvolution(d.deps, { trip: { destino: "Roma" }, owned: [] });
    expect(d.deps.generate).toHaveBeenCalledTimes(1);
    expect(d.deps.publishLayers).not.toHaveBeenCalled();
  });
});
