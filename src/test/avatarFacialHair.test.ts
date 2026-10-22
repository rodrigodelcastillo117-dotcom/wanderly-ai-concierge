// Una usuaria recibió su avatar con barba: el prompt pedía "preservar el vello facial" aunque la
// selfie no lo tuviera. El vello facial solo se dibuja si se ve en la foto.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/generate-avatar/index.ts", "utf8");

describe("avatar: nunca inventar barba", () => {
  it("el prompt con selfie ya no pide 'preservar vello facial' y sí prohíbe inventarlo", () => {
    expect(src).not.toMatch(/hairstyle, facial hair, skin tone/);
    expect(src).toMatch(/if the person is a woman, the avatar must NEVER have any facial hair/);
    expect(src).toMatch(/If the person is a man, draw a beard, mustache or stubble ONLY if it is visible in the selfie/);
    expect(src).toMatch(/This person is a woman: NO facial hair of any kind/);
    expect(src).toMatch(/\$\{FACIAL_HAIR_RULE\}/);
  });
  it("sin selfie (constructor), por defecto la cara va sin barba", () => {
    expect(src).toMatch(/none — smooth clean face, no beard, no stubble/);
    expect(src).toMatch(/none — woman, smooth clean face, absolutely no facial hair/);
  });
});
