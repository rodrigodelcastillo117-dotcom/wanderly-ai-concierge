import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { conciergeHeaderCopy, membersOnlySubtitle, FIXER_LINE } from "@/lib/planCopy";

// IATOS-089 / IATOS-013: a una cuenta gratis no se le dice "Concierge PRO te escucha" ni se le
// promete que el Concierge PRO gestiona sus reservas.
const sub = vi.hoisted(() => ({ value: {} as any }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => sub.value }));

import { ConciergeHeading } from "@/components/concierge/ConciergeHeading";

const free = { loading: false, isPro: false, isTrialing: false, trialDaysLeft: null, access: { concierge_remaining: 2, concierge_limit: 3 } };
const pro = { loading: false, isPro: true, isTrialing: false, trialDaysLeft: null, access: { concierge_remaining: null, concierge_limit: null } };

describe("ConciergeHeading", () => {
  beforeEach(() => { sub.value = free; });

  it("cuenta gratis: 'Iato te escucha', cupo real y enlace a PRO; nunca 'Concierge PRO'", () => {
    render(<MemoryRouter><ConciergeHeading /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Iato te escucha" })).toBeInTheDocument();
    expect(screen.getByText(/te quedan 2 de 3 mensajes con Iato este mes/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conoce PRO" })).toHaveAttribute("href", "/dashboard/pro");
    expect(document.body.textContent).not.toMatch(/Concierge PRO/);
  });

  // Ronda 3 (§4): el asistente se llama Iato en todos los planes; el plan va arriba ("CONCIERGE PRO").
  it("PRO: 'Iato te escucha' con el plan arriba y sin aviso de cupo", () => {
    sub.value = pro;
    render(<MemoryRouter><ConciergeHeading /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Iato te escucha" })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/CONCIERGE PRO/);
    expect(screen.queryByRole("link", { name: "Conoce PRO" })).toBeNull();
  });

  it("mientras carga no afirma ningún plan", () => {
    sub.value = { ...free, loading: true };
    render(<MemoryRouter><ConciergeHeading /></MemoryRouter>);
    expect(document.body.textContent).not.toMatch(/PRO|gratuito/);
  });
});

describe("textos por plan", () => {
  it("prueba: dice los días que quedan", () => {
    expect(conciergeHeaderCopy({ isPro: true, isTrialing: true, trialDaysLeft: 12 }).note).toBe("Prueba de IATOS PRO: te quedan 12 días.");
    expect(conciergeHeaderCopy({ isPro: true, isTrialing: true, trialDaysLeft: 1 }).note).toBe("Prueba de IATOS PRO: te queda 1 día.");
  });
  it("Members Only no promete reservas gestionadas por el Concierge PRO", () => {
    for (const isPro of [true, false]) {
      const t = membersOnlySubtitle({ isPro });
      expect(t).not.toMatch(/gestionadas por tu Concierge PRO/);
      expect(t).toMatch(/la confirmación depende de cada lugar/);
      // Auditoría Privé P1-5: sin "acceso preferente" (no hay prioridad real que lo respalde).
      expect(t).not.toMatch(/preferente|prioridad/i);
      expect(FIXER_LINE).not.toMatch(/preferente|prioridad/i);
    }
    expect(membersOnlySubtitle({ isPro: false })).toMatch(/Con IATOS PRO\.$/);
  });
  it("ninguna pantalla vuelve a poner el texto fijo", () => {
    const root = join(__dirname, "..", "..");
    for (const f of ["src/pages/Concierge.tsx", "src/components/MembersOnlyPanel.tsx", "src/pages/DashboardHome.tsx"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).not.toMatch(/Concierge PRO te escucha/);
      expect(src).not.toMatch(/reservas gestionadas por tu Concierge PRO/);
      expect(src).not.toMatch(/Planeo, reservo/);
    }
  });
});
