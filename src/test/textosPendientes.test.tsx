// Textos sueltos que quedaron del E2E en producción (28-oct-2026): nada en inglés ni códigos sin sentido
// en la UI en español, sin cambiar marcas (IATOS, PRO, Privé).
//  * Planear: "3 tiers" → "3 opciones (ahorro · equilibrio · premium)".
//  * Iato: "PERFIL EN CONSTRUCCIÓN · V1" → "Perfil en construcción" (la versión solo con un perfil real);
//    "Members Only" / "Nightlife Premium" → "Solo para miembros" / "Vida nocturna premium".
//  * Destinos del viaje por tierra: "4 opciones" (días + transportes sumados) y "2 por tierra" → un
//    subtítulo que dice qué es cada número; el aviso del autobús ya no sale dos veces.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const db = { prefs: null as any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generador encadenable simulado
const qb = (table: string): any => {
  const api: any = {
    select: () => api, eq: () => api, order: () => api, limit: () => api, in: () => api,
    maybeSingle: async () => ({ data: table === "ai_user_preferences" ? db.prefs : null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return api;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => qb(t), rpc: async () => ({ data: [], error: null }), functions: { invoke: async () => ({ data: null, error: null }) } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: async () => {} }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));

import { TravelerAvatar } from "@/components/TravelerAvatar";
import { MembersTeaser } from "@/components/MembersTeaser";
import { TripBuildPreview } from "@/components/TripBuildPreview";
import { citySubtitle } from "@/lib/cityHeader";

describe("Iato: el avatar no muestra 'V1' sin perfil", () => {
  it("sin perfil: 'Perfil en construcción', sin 'v1' ni 'versión'", async () => {
    db.prefs = { perfil_ia: null, dna_version: 1 };
    const { container } = render(<TravelerAvatar compact />);
    await waitFor(() => expect(container.textContent).toContain("Perfil en construcción"));
    expect(container.textContent).not.toMatch(/\bv\s?1\b|versión/i);
  });
  it("con perfil real: 'Explorador cultural · versión 3' (en español, sin 'v3')", async () => {
    db.prefs = { perfil_ia: { estilo_dominante: "Explorador cultural", resumen: "x" }, dna_version: 3 };
    const { container } = render(<TravelerAvatar compact />);
    await waitFor(() => expect(container.textContent).toContain("versión 3"));
    expect(container.textContent).not.toMatch(/\bv3\b/);
  });
});

describe("Iato: 'Members Only' en español", () => {
  it("el adelanto dice 'Solo para miembros' y 'Vida nocturna premium'", () => {
    const { container } = render(<MemoryRouter><MembersTeaser passwordGate={false} onUnlocked={() => {}} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Solo para miembros" })).toBeInTheDocument();
    expect(container.textContent).toContain("Vida nocturna premium");
    expect(container.textContent).not.toMatch(/Members Only|Nightlife/);
    // La marca IATOS PRO no cambia.
    expect(screen.getByRole("link", { name: "Conocer IATOS PRO" })).toBeInTheDocument();
  });
});

describe("Planear: sin '3 tiers'", () => {
  it("dice 3 opciones con sus nombres", () => {
    const { container } = render(<MemoryRouter><TripBuildPreview origin="Ciudad de México" destinoRaw="Roma" fechaSalida="2026-11-10" fechaRegreso="2026-11-15" viajeros={2} /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/tiers?\b/i);
    expect(container.textContent).toContain("Vuelos por ciudad en 3 opciones (ahorro · equilibrio · premium) con escalas reales");
  });
});

describe("Destinos por tierra: el encabezado de la ciudad tiene sentido", () => {
  it("dice qué es cada número y no escribe lo que no hay", () => {
    expect(citySubtitle({ nights: 2, days: 3, ground: 2 })).toBe("2 noches · 3 días de itinerario · 2 formas de llegar por tierra");
    expect(citySubtitle({ nights: null, days: 0, ground: 1 })).toBe("1 forma de llegar por tierra");
    expect(citySubtitle({ nights: 1, days: 1, ground: 0 })).toBe("1 noche · 1 día de itinerario");
    expect(citySubtitle({})).toBe("");
  });
});
