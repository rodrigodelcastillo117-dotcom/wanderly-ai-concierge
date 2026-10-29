// Ronda 3, P2-5 · Perfil más claro, sin quitar funciones: pestañas con títulos claros (Avatar,
// Documentos, Amigos, Ajustes), la tarjeta dorada y el avatar una sola vez, etiquetas en español y
// Ajustes a la vista. Falla con el Perfil de a1abb6a (una sola página de ~9 pantallas).
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
vi.mock("@/components/lux/TravelDNAStats", () => ({
  useTravelDNA: () => ({ dna: { dominant: "cultural", tripCount: 3, visitCount: 5, perfil: null }, reload: () => {} }),
  TravelDNAStats: stub("stub-dna-stats"),
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
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><Profile /><Where /></MemoryRouter>);
const src = () => readFileSync("src/pages/Profile.tsx", "utf8");

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

describe("P2-5 · Perfil en pestañas con títulos claros", () => {
  it("cuatro pestañas: Avatar, Documentos, Amigos y Ajustes; abre en Avatar", async () => {
    renderAt("/dashboard/perfil");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent?.trim());
    expect(tabs).toEqual(["Avatar", "Documentos", "Amigos", "Ajustes"]);
    expect(screen.getByRole("tab", { name: "Avatar" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Tu avatar de viaje" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Tu perfil de viajero" })).toBeInTheDocument();
    expect(within(panel).getByTestId("travel-avatar-card")).toBeInTheDocument();
  });

  it("cada función sigue en su pestaña (no se quita nada)", async () => {
    renderAt("/dashboard/perfil");
    const open = async (name: string) => { await act(async () => { fireEvent.mouseDown(screen.getByRole("tab", { name })); fireEvent.click(screen.getByRole("tab", { name })); }); return screen.getByRole("tabpanel"); };
    let p = screen.getByRole("tabpanel");
    for (const id of ["travel-avatar-card", "stub-dna-stats", "stub-moments", "stub-wrapped"]) expect(within(p).getByTestId(id)).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: /Borrar mi avatar/ })).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: /Editar mis preferencias/ })).toBeInTheDocument();
    expect(within(p).getByRole("link", { name: /Sube un viaje que ya hiciste/ })).toHaveAttribute("href", "/dashboard/viajes/importar");
    p = await open("Documentos");
    for (const id of ["stub-vault", "stub-promos"]) expect(within(p).getByTestId(id)).toBeInTheDocument();
    p = await open("Amigos");
    for (const id of ["friends-privacy", "stub-compat", "stub-invite"]) expect(within(p).getByTestId(id)).toBeInTheDocument();
    p = await open("Ajustes");
    expect(within(p).getByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    for (const t of ["Plan y facturación", "Preferencias de viaje", "Privacidad con tus amigos", "Cookies y analítica", "Ayuda"]) expect(p).toHaveTextContent(t);
    expect(within(p).getByTestId("stub-delete")).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: /Cerrar sesión/ })).toBeInTheDocument();
  });

  it("el engrane (#ajustes) abre directo la pestaña Ajustes", () => {
    renderAt("/dashboard/perfil#ajustes");
    expect(screen.getByRole("tab", { name: "Ajustes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("los avisos de Social (#que-ven-mis-amigos) abren la pestaña Amigos", () => {
    renderAt("/dashboard/perfil#que-ven-mis-amigos");
    expect(screen.getByRole("tab", { name: "Amigos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("friends-privacy")).toBeInTheDocument();
  });

  it("al cambiar de pestaña queda en la dirección (atrás y compartir funcionan)", async () => {
    renderAt("/dashboard/perfil");
    await act(async () => { fireEvent.mouseDown(screen.getByRole("tab", { name: "Documentos" })); });
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/perfil#documentos");
  });
});

describe("P2-5 · sin repeticiones ni etiquetas raras", () => {
  it("la tarjeta dorada y el avatar salen una vez (en la tarjeta del avatar), no también en el encabezado", () => {
    const s = src();
    expect(s).not.toMatch(/MemberCardButton/);
    expect(s).not.toMatch(/<AvatarCircle/);
  });
  it("etiquetas en español: sin «Tu Travel Avatar» ni «Premium»", () => {
    const s = src();
    expect(s).not.toMatch(/Travel Avatar/);
    expect(s).not.toMatch(/>Premium</);
    renderAt("/dashboard/perfil");
    expect(document.body.textContent).not.toMatch(/Travel Avatar|Premium/i);
  });
  it("la tarjeta del avatar ya no muestra «Mente refinada» ni «Viajero global»", () => {
    const c = readFileSync("src/components/lux/TravelAvatarCinematic.tsx", "utf8");
    expect(c).not.toMatch(/archetype\.tag/);
    expect(c).toMatch(/culture\.key !== "default"/);
  });
});
