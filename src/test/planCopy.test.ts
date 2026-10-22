import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Las decisiones DEC-01/DEC-02 exigen que landing, registro, PRO, avisos, términos, correos y el
// prompt de Iato digan lo mismo. Estas frases contradecían la prueba sin tarjeta o prometían de más.
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const FILES = [
  "src/pages/Landing.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Pro.tsx",
  "src/components/ProGate.tsx",
  "src/pages/Legal.tsx",
  "supabase/functions/_shared/email.ts",
  "supabase/functions/concierge-chat/prompt.ts",
];

const FORBIDDEN = [
  /se requiere (una )?tarjeta/i,
  /con tarjeta/i,
  /renueva automáticamente cada mes/i,
  /ilimitad/i,
  /24\/7/,
  /primer mes gratis/i,
];

describe("textos comerciales", () => {
  it.each(FILES)("%s no contradice la prueba sin tarjeta ni promete de más", (f) => {
    const src = read(f);
    for (const re of FORBIDDEN) expect(src, `${f} contiene ${re}`).not.toMatch(re);
  });

  it("landing, registro, PRO y términos leen la misma fuente", () => {
    for (const f of ["src/pages/Landing.tsx", "src/pages/Auth.tsx", "src/pages/Pro.tsx", "src/pages/Legal.tsx"]) {
      expect(read(f)).toMatch(/from "@\/lib\/planCopy"/);
    }
  });

  it("el precio dice IVA incluido y la prueba dice sin tarjeta y sin cobro automático", async () => {
    const c = await import("@/lib/planCopy");
    expect(c.PRICE_LINE).toBe("$99 MXN al mes, IVA incluido");
    expect(c.TRIAL_LINE).toMatch(/sin tarjeta/);
    expect(c.TRIAL_LINE).toMatch(/sin cobro automático/);
    expect(c.AFTER_TRIAL_LINE).toMatch(/plan gratuito/);
    expect(c.FIXER_LINE).toMatch(/sujeto a disponibilidad/);
  });
});
