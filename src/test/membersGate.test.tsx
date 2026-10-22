import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fetchMembersAccess, summarizeTeaser } from "@/lib/membersAccess";

// Supabase simulado: el servidor decide el acceso; la "tabla" solo responde si hay derecho.
const state = { access: false, via: null as string | null, password_gate: false };
const fromCalls: string[] = [];
const rpcCalls: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string) => {
      rpcCalls.push(fn);
      if (fn === "members_venues") return {
        data: state.access ? [{ id: "v1", ciudad: "paris", ciudad_display: "París", categoria: "cabaret", nombre: "Lugar Reservado", address: "1 Rue", reserva_requerida: true, tags: [], fuente: "members" }] : null,
        error: state.access ? null : { message: "MEMBERS_PRO_REQUIRED" },
      };
      if (fn === "members_access_state") return { data: { ...state }, error: null };
      if (fn === "members_teaser") return {
        data: [
          { ciudad: "paris", ciudad_display: "París", pais: "Francia", categoria: "cabaret", venues: 3 },
          { ciudad: "paris", ciudad_display: "París", pais: "Francia", categoria: "jazz_lounge", venues: 1 },
          { ciudad: "tokio", ciudad_display: "Tokio", pais: "Japón", categoria: "speakeasy", venues: 2 },
        ], error: null,
      };
      return { data: null, error: null };
    }),
    from: (t: string) => {
      fromCalls.push(t);
      const q: any = { select: () => q, eq: () => q, order: async () => ({ data: [{ id: "v1", ciudad: "paris", ciudad_display: "París", categoria: "cabaret", nombre: "Lugar Reservado", address: "1 Rue", reserva_requerida: true, tags: [] }], error: null }) };
      return q;
    },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/CityVideoCard", () => ({ CityVideoCard: () => null }));
vi.mock("@/components/VenueDetailDialog", () => ({ VenueDetailDialog: () => null }));

import { MembersOnlyPanel } from "@/components/MembersOnlyPanel";

const renderPanel = () => render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);

describe("Members Only = PRO", () => {
  beforeEach(() => { state.access = false; state.via = null; state.password_gate = false; fromCalls.length = 0; rpcCalls.length = 0; });

  it("gratis: adelanto con ciudades, categorías y conteos; no pide lugares a la tabla", async () => {
    renderPanel();
    expect(await screen.findByText(/6 lugares en 2 ciudades/)).toBeInTheDocument();
    expect(screen.getByText("París")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conocer IATOS PRO" })).toHaveAttribute("href", "/dashboard/pro");
    expect(screen.queryByText("Lugar Reservado")).toBeNull();
    expect(fromCalls).not.toContain("nightlife_premium");
    expect(rpcCalls).not.toContain("members_venues");
    expect(screen.queryByLabelText("Contraseña temporal de miembro")).toBeNull();
  });

  it("con la contraseña temporal encendida se ofrece el campo", async () => {
    state.password_gate = true;
    renderPanel();
    expect(await screen.findByLabelText("Contraseña temporal de miembro")).toBeInTheDocument();
  });

  it("PRO: carga los lugares completos (por la RPC members_venues, no la tabla)", async () => {
    state.access = true; state.via = "plan";
    renderPanel();
    expect(await screen.findByText("Lugar Reservado")).toBeInTheDocument();
    await waitFor(() => expect(rpcCalls).toContain("members_venues"));
    expect(fromCalls).not.toContain("nightlife_premium");
  });

  it("resumen del adelanto y estado ante error", async () => {
    expect(summarizeTeaser([
      { ciudad: "a", ciudad_display: "A", pais: null, categoria: "x", venues: 2 },
      { ciudad: "b", ciudad_display: "B", pais: null, categoria: "x", venues: 5 },
    ])).toEqual({ cities: [{ ciudad: "b", display: "B", pais: null, total: 5 }, { ciudad: "a", display: "A", pais: null, total: 2 }], categories: { x: 7 }, total: 7 });
    expect(await fetchMembersAccess({ rpc: async () => ({ data: null, error: { message: "x" } }) }))
      .toEqual({ access: false, via: null, accessExpiresAt: null, passwordGate: false });
  });

  it("no queda contraseña fija en el frontend", () => {
    for (const f of ["src/pages/Members.tsx", "src/components/MembersOnlyPanel.tsx", "src/components/MembersTeaser.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/MEMBERS_PASSWORD|password_unlocked:\s*true/);
    }
    expect(readFileSync("src/components/MembersTeaser.tsx", "utf8")).toContain('rpc("unlock_members_access"');
  });
});
