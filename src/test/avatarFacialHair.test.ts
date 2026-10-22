// Una usuaria recibió su avatar con barba: el prompt pedía "preservar el vello facial" aunque la
// selfie no lo tuviera. Mujer: nunca vello facial. Hombre: solo si se ve en la foto.
import { describe, expect, it } from "vitest";
import { builderPrompt, identityPrompt, souvenirPrompt } from "../../supabase/functions/_shared/avatar-prompts";

describe("avatar: nunca inventar barba", () => {
  it("el prompt con selfie prohíbe vello facial en mujeres y solo lo permite en hombres si se ve", () => {
    for (const p of [identityPrompt({ photos: 1 }), identityPrompt({ photos: 3, variant: 2, fixes: ["nariz"] })]) {
      expect(p).toMatch(/if the person is a woman, the avatar must NEVER have any facial hair/);
      expect(p).toMatch(/If the person is a man, draw a beard, mustache or stubble ONLY if it is visible in the photo/);
      expect(p).not.toMatch(/Facial hair exactly as in the photo/);
    }
  });
  it("sin selfie (constructor), la cara va sin barba; mujer: ninguna", () => {
    expect(builderPrompt({})).toMatch(/none — smooth clean face, no beard, no stubble/);
    expect(builderPrompt({ gender: "mujer" })).toMatch(/none — woman, smooth clean face, absolutely no facial hair/);
    expect(builderPrompt({ gender: "female" })).toMatch(/absolutely no facial hair/);
  });
  it("la evolución por viaje nunca agrega barba", () => {
    expect(souvenirPrompt([{ prompt: "a small Eiffel pin", slot: "pin" }])).toMatch(/Never add a beard, mustache or stubble/);
  });
});
