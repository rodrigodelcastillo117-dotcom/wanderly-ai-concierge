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
  "supabase/functions/_shared/email-templates.ts",
  "supabase/functions/_shared/email-kit.ts",
  "supabase/functions/_shared/email-ops.ts",
  "supabase/functions/concierge-chat/prompt.ts",
];

const FORBIDDEN = [
  /se requiere (una )?tarjeta/i,
  /con tarjeta/i,
  /renueva automáticamente cada mes/i,
  /ilimitad/i,
  // N-04 / D-P3-6: "Mensajes sin límite" (Pro.tsx) contradecía "100 mensajes con Iato al mes".
  /sin\s+l[ií]mites?/i,
  /unlimited/i,
  /24\/7/,
  /primer mes gratis/i,
];

describe("textos comerciales", () => {
  it.each(FILES)("%s no contradice la prueba sin tarjeta ni promete de más", (f) => {
    const src = read(f);
    for (const re of FORBIDDEN) expect(src, `${f} contiene ${re}`).not.toMatch(re);
  });

  it("cada modo de prueba describe solo lo que ocurre (G-1: no prometer sin tarjeta si está apagado)", async () => {
    const { trialCopy } = await import("@/lib/planCopy");
    const card = trialCopy("card");
    const noCard = trialCopy("no_card");
    const all = (c: ReturnType<typeof trialCopy>) => [c.line, c.after, c.cta, c.conditions, c.signup, c.checkoutNote, ...c.policy].join(" ");
    expect(all(card)).not.toMatch(/sin tarjeta|sin cobro automático/i);
    expect(all(card)).toMatch(/tarjeta/);
    expect(all(noCard)).toMatch(/sin tarjeta/);
    expect(all(noCard)).not.toMatch(/registras tu tarjeta|si no cancelas/i);
    // Con tarjeta se cobra al terminar la prueba: el precio con IVA debe estar a la vista.
    expect(all(card)).toMatch(/IVA incluido/);
    for (const c of [card, noCard]) expect(all(c)).not.toMatch(/ilimitad|24\/7/i);
  });

  it("N-04: ningún texto exportado por planCopy promete \"sin límite\" o \"ilimitado\"", async () => {
    const c = await import("@/lib/planCopy");
    const strings: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(Object.values(c).filter((v) => typeof v !== "function"));
    for (const mode of ["card", "no_card"] as const) collect(c.trialCopy(mode));
    collect(c.freeUsageLines({ concierge_limit: null, concierge_remaining: null, trips_limit: null, trips_remaining: null }));
    collect(c.freeUsageLines({ concierge_limit: 3, concierge_remaining: 1, trips_limit: 1, trips_remaining: 0 }));
    expect(strings.length).toBeGreaterThan(10);
    for (const s of strings) for (const re of FORBIDDEN) expect(s, `planCopy: "${s}" contiene ${re}`).not.toMatch(re);
  });

  it("N-04: la página PRO muestra el uso gratuito con planCopy (sin tope del servidor = lo publicado del plan gratuito)", async () => {
    const c = await import("@/lib/planCopy");
    expect(read("src/pages/Pro.tsx")).toMatch(/freeUsageLines\(/);
    const sinTope = c.freeUsageLines({ concierge_limit: null, concierge_remaining: null, trips_limit: null, trips_remaining: null });
    expect(sinTope).toEqual({ concierge: c.FREE_CONCIERGE_LINE, trips: c.FREE_TRIP_LINE });
    expect(c.FREE_FEATURES).toContain(c.FREE_CONCIERGE_LINE);
    expect(c.freeUsageLines({ concierge_limit: 3, concierge_remaining: 2, trips_limit: 1, trips_remaining: 0 }))
      .toEqual({ concierge: "2 de 3 mensajes gratis", trips: "0 de 1 gratis" });
    // PRO publica 100 mensajes al mes: ninguna pantalla puede decir lo contrario.
    expect(c.PRO_FEATURES).toContain("100 mensajes con Iato al mes");
  });

  it("landing, registro, PRO y términos leen la misma fuente", () => {
    for (const f of ["src/pages/Landing.tsx", "src/pages/Auth.tsx", "src/pages/Pro.tsx", "src/pages/Legal.tsx"]) {
      expect(read(f)).toMatch(/from "@\/lib\/planCopy"|from "@\/hooks\/usePlanConfig"/);
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
