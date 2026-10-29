// Mejora 9.5 · Perfil › Avatar sin llamados repetidos (cuenta nueva) y sin emoji en el botón.
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const qb: any = { select: () => qb, eq: () => qb, lt: () => qb, order: () => qb, limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) }, from: () => qb },
}));
// Objeto estable (como el de AuthProvider): el Perfil recarga sus datos cuando cambia `user`.
const session = vi.hoisted(() => ({ user: { id: "u1", email: "sofia@correo.mx", user_metadata: {} }, signOut: async () => {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => session }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
// Las piezas de cada pestaña se prueban en sus propios archivos: aquí solo importa dónde quedan.
const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => require("react").createElement("div", { "data-testid": id }) }));
vi.mock("@/components/BenefitsVault", () => ({ default: stub("stub-vault") }));
vi.mock("@/components/PromocionesActivas", () => ({ default: stub("stub-promos") }));
vi.mock("@/components/AvatarCreator", () => ({ default: stub("stub-creator") }));
vi.mock("@/components/lux/TravelAvatarCinematic", () => ({ TravelAvatarCinematic: stub("travel-avatar-card") }));
const dnaState = vi.hoisted(() => ({ dna: null as any, statsProps: null as any }));
vi.mock("@/components/lux/TravelDNAStats", () => ({
  useTravelDNA: () => ({ dna: dnaState.dna, reload: () => {} }),
  TravelDNAStats: (p: any) => { dnaState.statsProps = p; return require("react").createElement("div", { "data-testid": "stub-dna-stats" }); },
}));
vi.mock("@/components/lux/CompatibilityPanel", () => ({ CompatibilityPanel: stub("stub-compat") }));
vi.mock("@/components/lux/BestMomentsPanel", () => ({ BestMomentsPanel: stub("stub-moments") }));
vi.mock("@/components/DeleteAccountSection", () => ({ DeleteAccountSection: stub("stub-delete") }));
vi.mock("@/components/InviteFriendsCard", () => ({ InviteFriendsCard: stub("stub-invite") }));
vi.mock("@/components/social/FriendsPrivacySection", () => ({ FriendsPrivacySection: stub("friends-privacy") }));
vi.mock("@/components/wrapped/WrappedPromo", () => ({ ProfileWrappedLink: stub("stub-wrapped") }));
vi.mock("@/hooks/useMyAvatar", () => ({ useMyAvatar: () => ({ url: "https://cdn/a.png" }), notifyAvatarUpdated: () => {} }));
vi.mock("@/hooks/usePriveSeal", () => ({ usePriveSeal: () => false }));
vi.mock("@/components/avatar/useAutoEvolveAvatar", () => ({ useAutoEvolveAvatar: () => {} }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));
vi.mock("@/lib/memberCard", async (orig) => ({ ...(await orig<any>()), useMemberCard: () => ({ card: { tier: "gold" }, loading: false }) }));

import Profile from "@/pages/Profile";

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.hash}</p>; };


const renderProfile = () => render(<MemoryRouter initialEntries={["/dashboard/perfil"]}><Profile /></MemoryRouter>);
const NUEVA = { dominant: null, tripCount: 0, visitCount: 0, perfil: null, fuente: "ninguna", stats: [], viajesHechos: 0, viajesPlaneados: 0, lugares: 0 };
const CON_DATOS = { dominant: "cultural", tripCount: 3, visitCount: 5, perfil: null, fuente: "viajes", stats: [], viajesHechos: 1, viajesPlaneados: 2, lugares: 5 };

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); dnaState.statsProps = null; });

describe("Perfil › Avatar", () => {
  it("ya no repite «recalcúlalo aquí» al pie ni lleva emoji en el botón", () => {
    dnaState.dna = CON_DATOS;
    renderProfile();
    const btn = screen.getByTestId("dna-recalcular");
    expect(btn).toHaveTextContent(/^Recalcular mi perfil de viajero$/);
    expect(screen.queryByRole("button", { name: /recalcúlalo aquí/ })).toBeNull();
    expect(screen.queryByText(/se recalcula automáticamente cada 3 viajes/)).toBeNull();
    expect(btn.className).toMatch(/bg-gradient-gold/);
  });

  it("cuenta nueva: recalcular no es la acción principal y «Sube un viaje» sale una vez en esta sección", () => {
    dnaState.dna = NUEVA;
    renderProfile();
    expect(screen.getByTestId("dna-recalcular").className).not.toMatch(/bg-gradient-gold/);
    expect(dnaState.statsProps.showImportLink).toBe(false);
    expect(screen.getAllByRole("link", { name: /Sube un viaje que ya hiciste/ })).toHaveLength(1);
  });
});

