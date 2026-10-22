import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Aviso de Privacidad: eliminación honesta (sec2-b)", () => {
  const src = readFileSync("src/pages/Legal.tsx", "utf8");
  it("dice qué se borra y qué conserva Stripe por ley", () => {
    expect(src).toMatch(/Stripe conserva las facturas y los cargos/);
    expect(src).toMatch(/quitamos tus métodos de pago/);
    expect(src).toMatch(/PostHog que borre tu historial/);
  });
  it("no promete un borrado absoluto", () => {
    expect(src).not.toMatch(/borramos todos tus datos|eliminamos todo|borrado (total|absoluto)/i);
  });
  it("la política de reembolsos explica que un reembolso total termina el acceso de ese cargo", () => {
    expect(src).toMatch(/reembolsamos un cargo completo, la suscripción se cancela/);
  });
});
