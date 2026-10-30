// CANDADO · "Mi mundo" en el Perfil (30-oct-2026). Lo que Carlo extrañó: "el mundito con los países que
// viajas". Falla si:
//  - el Perfil (pestaña Avatar) deja de mostrar "Mi mundo";
//  - deja de contar los países de sus viajes (ya fuiste / planeados) o de pasarle al globo sus ciudades
//    con el estado de cada una (Tokio → Kioto → Osaka planeado, Lisboa → Sintra → Oporto hecho);
//  - el globo (three.js, ~1.7 MB) o siquiera la lectura de los viajes se carga sin que la sección se vea;
//  - se geocodifica (búsqueda de pago) para dibujarlo;
//  - sin viajes deja de salir el estado vacío con el botón para planear.
// Datos simulados, sin red ni gasto. El globo real usa WebGL (no corre en jsdom): se reemplaza por una marca.
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const db = vi.hoisted(() => ({ trips: [] as any[], tripsQueries: [] as string[], invokes: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = new Proxy({}, {
      get: (_t, k: string) => {
        if (k === "select") return (cols: string) => { if (table === "trips") db.tripsQueries.push(cols); return api; };
        if (k === "maybeSingle" || k === "single") return async () => ({ data: null, error: null });
        if (k === "limit") return async () => ({ data: [], error: null });
        if (k === "then") return (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null }).then(res, rej);
        return () => api;
      },
    });
    return api;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }), functions: { invoke: async (fn: string) => { db.invokes.push(fn); return { data: null, error: null }; } } } };
});
const session = vi.hoisted(() => ({ user: { id: "u1", email: "carlo@example.com", user_metadata: {} }, signOut: async () => {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => session }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => require("react").createElement("div", { "data-testid": id }) }));
vi.mock("@/components/BenefitsVault", () => ({ default: stub("stub-vault") }));
vi.mock("@/components/PromocionesActivas", () => ({ default: stub("stub-promos") }));
vi.mock("@/components/AvatarCreator", () => ({ default: stub("stub-creator") }));
vi.mock("@/components/lux/TravelAvatarCinematic", () => ({ TravelAvatarCinematic: stub("travel-avatar-card") }));
vi.mock("@/components/lux/TravelDNAStats", () => ({ useTravelDNA: () => ({ dna: null, reload: () => {} }), TravelDNAStats: stub("stub-dna-stats") }));
vi.mock("@/components/lux/CompatibilityPanel", () => ({ CompatibilityPanel: stub("stub-compat") }));
vi.mock("@/components/lux/BestMomentsPanel", () => ({ BestMomentsPanel: stub("stub-moments") }));
vi.mock("@/components/DeleteAccountSection", () => ({ DeleteAccountSection: stub("stub-delete") }));
vi.mock("@/components/InviteFriendsCard", () => ({ InviteFriendsCard: stub("stub-invite") }));
vi.mock("@/components/social/FriendsPrivacySection", () => ({ FriendsPrivacySection: stub("friends-privacy") }));
vi.mock("@/components/wrapped/WrappedPromo", () => ({ ProfileWrappedLink: stub("stub-wrapped") }));
vi.mock("@/hooks/useMyAvatar", () => ({ useMyAvatar: () => ({ url: null }), notifyAvatarUpdated: () => {} }));
vi.mock("@/hooks/usePriveSeal", () => ({ usePriveSeal: () => false }));
vi.mock("@/components/avatar/useAutoEvolveAvatar", () => ({ useAutoEvolveAvatar: () => {} }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));
// El globo 3D: si se importa, la marca dice con qué ciudades y países se dibujó.
const globe = vi.hoisted(() => ({ imported: 0 }));
vi.mock("@/components/mundo/WorldGlobe3D", () => {
  globe.imported++;
  const G = ({ ciudades, paises }: any) => require("react").createElement("div", {
    "data-testid": "candado-mundo-globo",
    "data-ciudades": ciudades.map((c: any) => `${c.name}:${c.estado}`).join("|"),
    "data-paises": paises.map((p: any) => `${p.iso2}:${p.estado}`).join("|"),
  });
  return { default: G, WorldGlobe3D: G };
});

// IntersectionObserver controlable: nada "se ve" hasta que la prueba lo dice.
const io = vi.hoisted(() => ({ list: [] as Array<{ cb: (e: any[]) => void; els: Set<Element> }> }));
class FakeIO {
  rec: { cb: (e: any[]) => void; els: Set<Element> };
  constructor(cb: (e: any[]) => void) { this.rec = { cb, els: new Set() }; io.list.push(this.rec); }
  observe(el: Element) { this.rec.els.add(el); }
  unobserve(el: Element) { this.rec.els.delete(el); }
  disconnect() { this.rec.els.clear(); }
  takeRecords() { return []; }
}
const verSeccion = (testid: string) => act(() => {
  for (const r of io.list) {
    const els = [...r.els].filter((el) => el.getAttribute("data-testid") === testid);
    if (els.length) r.cb(els.map((target) => ({ isIntersecting: true, target })));
  }
});

import Profile from "@/pages/Profile";

const T = (id: string, destino: string, pais: string, salida: string, regreso: string, destinations?: string[]) => ({
  id, user_id: "u1", destino, pais_destino: pais, fecha_salida: salida, fecha_regreso: regreso, destinations: destinations ?? null,
});
const CARLO = [
  T("jp", "Tokio → Kioto → Osaka", "Japón", localISODatePlus(60), localISODatePlus(69), ["Tokio", "Kioto", "Osaka"]),
  T("pt", "Lisboa → Sintra → Oporto", "Portugal", localISODatePlus(-200), localISODatePlus(-191), ["Lisboa", "Sintra", "Oporto"]),
  T("fr", "París", "Francia", localISODatePlus(-400), localISODatePlus(-395)),
];

const renderProfile = () => render(<MemoryRouter initialEntries={["/dashboard/perfil"]}><Profile /></MemoryRouter>);

beforeEach(() => {
  db.trips = CARLO;
  db.tripsQueries.length = 0;
  db.invokes.length = 0;
  io.list.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("CANDADO · Mi mundo (Perfil)", () => {
  it("está en la pestaña Avatar y no lee viajes ni baja el globo hasta que la sección se ve", async () => {
    renderProfile();
    const seccion = screen.getByTestId("mi-mundo");
    expect(within(seccion).getByText("Mi mundo")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(db.tripsQueries, "leyó los viajes sin que Mi mundo se viera").toEqual([]);
    expect(screen.queryByTestId("candado-mundo-globo")).toBeNull();
    expect(globe.imported, "importó el globo 3D en la pantalla inicial").toBe(0);
  });

  it("con viajes: cuenta los países (ya fuiste / planeados) y dibuja sus ciudades con su estado; sin geocodificar", async () => {
    renderProfile();
    verSeccion("mi-mundo");
    const conteo = await screen.findByTestId("mi-mundo-conteo", {}, { timeout: 8000 });
    expect(conteo.textContent).toMatch(/3 países/);
    expect(screen.getByTestId("mi-mundo-hechos").textContent).toBe("2"); // Portugal y Francia
    expect(screen.getByTestId("mi-mundo-planeados").textContent).toBe("1"); // Japón
    const chips = within(screen.getByTestId("mi-mundo-paises")).getAllByRole("listitem");
    expect(chips.map((c) => `${c.textContent?.replace(/\s*\(.*\)$/, "").replace(/^\S+\s/, "").trim()}:${c.getAttribute("data-estado")}`))
      .toEqual(["Francia:hecho", "Portugal:hecho", "Japón:planeado"]);
    // Solo lo necesario de cada viaje (sin los días del itinerario).
    expect(db.tripsQueries[0]).toMatch(/itinerario_json->destinations/);

    // El globo, solo cuando su recuadro está por verse.
    expect(screen.queryByTestId("candado-mundo-globo")).toBeNull();
    verSeccion("mi-mundo-globo");
    const g = await screen.findByTestId("candado-mundo-globo", {}, { timeout: 8000 });
    expect(g.getAttribute("data-ciudades")).toBe("Tokio:planeado|Kioto:planeado|Osaka:planeado|Lisboa:hecho|Sintra:hecho|Oporto:hecho|París:hecho");
    expect(g.getAttribute("data-paises")).toBe("FR:hecho|PT:hecho|JP:planeado");
    expect(db.invokes, "Mi mundo no debe gastar búsquedas (geocode)").not.toContain("geocode");
  });

  it("sin viajes: estado vacío amable con el botón para planear", async () => {
    db.trips = [];
    renderProfile();
    verSeccion("mi-mundo");
    const vacio = await screen.findByTestId("mi-mundo-vacio", {}, { timeout: 8000 });
    expect(vacio.textContent).toMatch(/primer viaje/);
    expect(within(vacio).getByRole("link", { name: /Planear un viaje/ }).getAttribute("href")).toBe("/dashboard/planear");
    expect(screen.queryByTestId("candado-mundo-globo")).toBeNull();
  });
});
