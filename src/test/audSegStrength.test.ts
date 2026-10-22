// Auditoría de cierre (CALIDAD_PRUEBAS.md): pruebas que matan mutaciones que antes detectaba UNA sola
// prueba o ninguna directa. Código real, sin mocks del módulo bajo prueba.
import { describe, expect, it } from "vitest";
import { runDeletion, type DeletionDeps, type StepName, type StepState } from "../../supabase/functions/_shared/account-deletion";
import { hostBacked, safeHttpsUrl } from "../../supabase/functions/concierge-chat/cards";

describe("borrado de cuenta: un paso bloqueante que falla detiene TODO lo que sigue (mutación M10)", () => {
  const ORDER: StepName[] = ["stripe_cancel", "storage", "db_purge", "stripe_customer_redact", "posthog_delete"];
  for (const failing of ["stripe_cancel", "storage", "db_purge"] as StepName[]) {
    it(`falla ${failing}: no corre ningún paso posterior ni se borra la identidad`, async () => {
      const steps = new Map<StepName, StepState>(ORDER.map((s) => [s, { step: s, status: "pending", attempts: 0, last_error: null }]));
      const ran: StepName[] = [];
      let identity = 0;
      const step = (s: StepName) => async () => { ran.push(s); if (s === failing) throw new Error("caído"); return "done" as const; };
      const deps: DeletionDeps = {
        loadSteps: async () => [...steps.values()],
        saveStep: async (s, p) => { steps.set(s, { step: s, status: p.status, attempts: p.attempts, last_error: p.last_error }); },
        steps: Object.fromEntries(ORDER.map((s) => [s, step(s)])) as DeletionDeps["steps"],
        identityDeleted: async () => false,
        deleteIdentity: async () => { identity++; },
        markRequest: async () => {},
        redact: (e) => String((e as Error).message),
      };
      const out = await runDeletion(deps);
      expect(out.blockedAt).toBe(failing);
      expect(out.identityDeleted).toBe(false);
      expect(identity).toBe(0);
      expect(ran).toEqual(ORDER.slice(0, ORDER.indexOf(failing) + 1));
    });
  }
});

describe("enlaces de las tarjetas de Iato (mutaciones M8 y X2)", () => {
  it("safeHttpsUrl: solo https sin usuario/contraseña y con dominio", () => {
    expect(safeHttpsUrl("https://www.opentable.com/r/pujol")).toBe("https://www.opentable.com/r/pujol");
    for (const bad of ["http://opentable.com", "javascript:alert(1)", "data:text/html,x", "https://user:pw@opentable.com",
      "https://opentable.com@evil.example", "https://localhost/x", " ", 42, null]) {
      expect(safeHttpsUrl(bad), String(bad)).toBeUndefined();
    }
  });
  it("hostBacked: el dominio o un subdominio real; nunca un sufijo pegado", () => {
    const ev = { hosts: ["opentable.com"] };
    expect(hostBacked("https://opentable.com/x", ev)).toBe(true);
    expect(hostBacked("https://www.opentable.com/x", ev)).toBe(true);
    expect(hostBacked("https://mx.opentable.com/x", ev)).toBe(true);
    expect(hostBacked("https://evilopentable.com/x", ev)).toBe(false);
    expect(hostBacked("https://opentable.com.evil.example/x", ev)).toBe(false);
    expect(hostBacked("no es url", ev)).toBe(false);
  });
});
