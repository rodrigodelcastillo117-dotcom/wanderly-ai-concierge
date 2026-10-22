// Prompts de identidad, juez de parecido y generación con respaldo de modelos (sin red real).
import { describe, expect, it, vi } from "vitest";
import {
  builderPrompt, decodeDataUrl, extractImageUrl, identityPrompt, likenessPrompt, parseLikeness, souvenirPrompt, toDataUrl, validSelfie,
} from "../../supabase/functions/_shared/avatar-prompts.ts";
import { checkLikeness, DEFAULT_IMAGE_MODELS, generateImage, imageCostUsd, imageModels } from "../../supabase/functions/_shared/avatar-image.ts";

const PNG = "data:image/png;base64," + "A".repeat(400);

describe("prompt de identidad (por qué antes no se parecía)", () => {
  it("pide conservar rasgos concretos, sin caricatura, en retrato cuadrado con la cara grande", () => {
    const p = identityPrompt({ photos: 1 });
    for (const rule of [/skin tone/i, /glasses/i, /beard|facial hair/i, /eye shape/i, /apparent age/i, /hairline/i]) expect(p).toMatch(rule);
    expect(p).toMatch(/NOT a caricature/);
    expect(p).toMatch(/SQUARE 1:1/);
    expect(p).not.toMatch(/FULL BODY|head to toe|Pixar/i);
  });
  it("varias fotos de la misma persona, y correcciones del juez al reintentar", () => {
    expect(identityPrompt({ photos: 3 })).toMatch(/3 attached photos all show the SAME real person/);
    const retry = identityPrompt({ photos: 1, fixes: ["barba más corta", "sin lentes"] });
    expect(retry.startsWith("A previous attempt did NOT look enough like this person")).toBe(true);
    expect(retry).toMatch(/barba más corta; sin lentes/);
  });
  it("el modo por rasgos y la edición con recuerdos no tocan la cara", () => {
    expect(builderPrompt({ skin: "warm tan medium skin" })).toMatch(/warm tan medium skin/);
    const e = souvenirPrompt([{ prompt: "a tiny taxi charm", slot: "dije" }]);
    expect(e).toMatch(/Keep the person EXACTLY identical/);
    expect(e).toMatch(/never covering the face or hair, nothing on the head/);
    expect(e).toMatch(/1\. a tiny taxi charm — hanging/);
  });
});

describe("juez de parecido", () => {
  it("acepta solo JSON con score 0-100", () => {
    expect(parseLikeness('```json\n{"score": 83, "diferencias": ["nariz más ancha"]}\n```')).toEqual({ score: 83, diferencias: ["nariz más ancha"] });
    expect(parseLikeness({ score: "64.6", diferencias: [1, "", "pelo más corto"] })).toEqual({ score: 65, diferencias: ["pelo más corto"] });
    expect(parseLikeness({ score: 140 })).toBeNull();
    expect(parseLikeness("parecido alto")).toBeNull();
    expect(parseLikeness([])).toBeNull();
    expect(likenessPrompt("selfie")).toMatch(/Image 1 is a real photo/);
  });
  it("checkLikeness manda referencia y candidato y lee el JSON (sin red)", async () => {
    const chat = vi.fn(async () => ({ res: new Response(JSON.stringify({ choices: [{ message: { content: '{"score":91,"diferencias":[]}' } }], usage: { prompt_tokens: 2000, completion_tokens: 20 } })), provider: "gemini", model: "gemini-flash-latest" }));
    const out = await checkLikeness({ chat, lovableKey: "k" }, { reference: PNG, candidate: PNG, mode: "selfie", fn: "generate-avatar", userId: "u" });
    expect(out.likeness?.score).toBe(91);
    expect(out.usage?.input_tokens).toBe(2000);
    const body = JSON.parse((chat.mock.calls[0] as any)[0].body);
    expect(body.messages[0].content.filter((c: any) => c.type === "image_url")).toHaveLength(2);
  });
});

describe("generación con respaldo de modelos", () => {
  const imgResponse = (url: string) => new Response(JSON.stringify({ choices: [{ message: { images: [{ type: "image_url", image_url: { url } }] } }] }));
  it("modelo inexistente (404) → el siguiente; la selfie va antes del texto", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("model not found", { status: 404 }))
      .mockResolvedValueOnce(imgResponse(PNG));
    const r = await generateImage({ fetch: fetchMock, lovableKey: "k", models: DEFAULT_IMAGE_MODELS, chat: vi.fn() }, { prompt: "p", images: [PNG], fn: "generate-avatar", userId: "u" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.model).toBe(DEFAULT_IMAGE_MODELS[1]);
      expect(r.usage.cost_estimate_usd).toBe(0.067);
    }
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.modalities).toEqual(["image", "text"]);
    expect(body.messages[0].content[0].type).toBe("image_url");
  });
  it("sin créditos (402) se detiene sin probar otros modelos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 402 }));
    const r = await generateImage({ fetch: fetchMock, lovableKey: "k", models: DEFAULT_IMAGE_MODELS, chat: vi.fn() }, { prompt: "p", images: [], fn: "f", userId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { code?: string }).code).toBe("sin_creditos");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("lee la imagen en sus formatos y valida la selfie", () => {
    expect(extractImageUrl({ choices: [{ message: { content: [{ type: "image_url", image_url: { url: PNG } }] } }] })).toBe(PNG);
    expect(extractImageUrl({ choices: [{ message: { content: "no image" } }] })).toBeNull();
    const bytes = new Uint8Array(300).fill(7);
    expect(decodeDataUrl(toDataUrl(bytes, "image/png"))?.bytes.length).toBe(300);
    expect(validSelfie("data:image/jpeg;base64," + "A".repeat(4000))).toBe(true);
    expect(validSelfie("data:image/heic;base64," + "A".repeat(4000))).toBe(false);
    expect(validSelfie("https://ejemplo.mx/selfie.jpg")).toBe(false);
  });
  it("costos y lista de modelos configurable", () => {
    expect(imageCostUsd("google/gemini-3-pro-image-preview")).toBe(0.134);
    expect(imageCostUsd("google/gemini-2.5-flash-image")).toBe(0.039);
    expect(imageModels(" a/b , c/d ")).toEqual(["a/b", "c/d"]);
    expect(imageModels("")).toEqual(DEFAULT_IMAGE_MODELS);
  });
});
