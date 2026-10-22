import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  categoryLabel, cityNames, countByCategory, fetchMembersCities, fetchMembersVenues, matchesCategory, sourceLine,
} from "@/lib/membersVenues";

// Members Only "agrega más": los lugares salen de members_venues (tabla de siempre + curaduría Privé,
// sin repetir) y las ciudades de members_cities. Supabase simulado.
const VENUES = [
  {
    id: "c1", ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria: "cocktail_bar", emoji: null,
    nombre: "Licoreria Limantour", por_que: "Hecho con fuente.", descripcion: "Texto curado", dress_code: null, precio_estimado: null,
    reserva_requerida: false, tags: [], address: "Álvaro Obregón 106", website: "https://limantour.tech/", fuente: "curaduria",
    effective_state: "VERIFICADO", effective_label: "NINGUNA", source_url: "https://www.limantour.tech/", verified_at: "2026-10-01T12:00:00+00:00",
    neighborhood: "Roma-Condesa", season_state: null, age_policy: "18+",
  },
  {
    id: "c2", ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria: "speakeasy", emoji: null,
    nombre: "Hanky Panky", por_que: null, descripcion: null, dress_code: null, precio_estimado: null, reserva_requerida: true,
    tags: [], address: null, website: null, fuente: "curaduria", effective_state: "CURADO", effective_label: "NINGUNA",
    source_url: null, verified_at: "2026-10-17T00:00:00+00:00", neighborhood: null, season_state: null, age_policy: "18+",
  },
  {
    id: "l1", ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria: "jazz_lounge", emoji: "🎷",
    nombre: "Parker & Lenox", por_que: null, descripcion: null, dress_code: "Smart casual", precio_estimado: "$$$",
    reserva_requerida: true, tags: ["jazz"], address: "Milán 14", website: null, fuente: "members", effective_state: null,
    effective_label: null, source_url: null, verified_at: null, neighborhood: null, season_state: null, age_policy: null,
  },
];
const sim = { citiesError: false };
const rpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
  if (fn === "members_access_state") return { data: { access: true, via: "plan", password_gate: false }, error: null };
  if (fn === "members_venues") return { data: VENUES, error: null };
  if (fn === "members_cities") return sim.citiesError
    ? { data: null, error: { message: "x" } }
    : { data: [{ ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", pais: "México", venues: 3 },
               { ciudad: "mc", ciudad_display: "Mónaco", pais: "Mónaco", venues: 2 }], error: null };
  return { data: null, error: null };
});
const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
const fromCalls: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args),
    from: (t: string) => {
      fromCalls.push(t);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generador encadenable simulado
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { confirmed_adult: true }, error: null }) };
      return q;
    },
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
  },
}));
// Usuario estable (como el contexto real): un objeto nuevo en cada render re-dispararía los efectos.
const AUTH = { user: { id: "u1" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true }) }));
vi.mock("@/components/CityVideoCard", () => ({ CityVideoCard: ({ city }: { city: string }) => <span data-testid="city-card">{city}</span> }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));

import { MembersOnlyPanel } from "@/components/MembersOnlyPanel";
import Members from "@/pages/Members";

beforeEach(() => { rpc.mockClear(); invoke.mockClear(); fromCalls.length = 0; sim.citiesError = false; });

describe("lógica de membersVenues", () => {
  it("línea de fuente: dominio sin www y fecha en español; lo viejo no tiene", () => {
    expect(sourceLine(VENUES[0] as never)).toBe("Fuente: limantour.tech · verificado el 1 de octubre de 2026");
    expect(sourceLine(VENUES[1] as never)).toBe("verificado el 17 de octubre de 2026");
    expect(sourceLine(VENUES[2] as never)).toBeNull();
    expect(sourceLine({ fuente: "curaduria", source_url: "no-es-url", verified_at: null })).toBeNull();
  });
  it("categorías desconocidas: filtro y conteo en 'Otros', etiqueta legible", () => {
    expect(matchesCategory({ categoria: "cocktail_bar" }, "otros")).toBe(true);
    expect(matchesCategory({ categoria: "speakeasy" }, "otros")).toBe(false);
    expect(matchesCategory({ categoria: "speakeasy" }, "speakeasy")).toBe(true);
    expect(matchesCategory({ categoria: "x" }, null)).toBe(true);
    expect(countByCategory([{ categoria: "cocktail_bar" }, { categoria: "mezcaleria" }, { categoria: "rooftop" }])).toEqual({ otros: 2, rooftop: 1 });
    expect(categoryLabel("cocktail_bar")).toBe("Cocktail bar");
    expect(categoryLabel("jazz_lounge")).toBe("Jazz Lounge");
  });
  it("ciudades: del servidor o la lista fija si falla", async () => {
    expect(cityNames(null, ["París"])).toEqual(["París"]);
    expect(cityNames([], ["París"])).toEqual(["París"]);
    expect(cityNames([{ ciudad: "mc", display: "Mónaco", pais: null, venues: 2 }], ["París"])).toEqual(["Mónaco"]);
    expect(await fetchMembersCities({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toBeNull();
    expect(await fetchMembersVenues({ rpc: async () => ({ data: null, error: { message: "MEMBERS_PRO_REQUIRED" } }) }, "CDMX"))
      .toEqual({ venues: [], error: true });
  });
});

describe("Members Only con la curaduría", () => {
  it("panel del Concierge: pide members_venues con la ciudad, muestra fuente y barrio; no lee la tabla", async () => {
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    expect(await screen.findByText("Licoreria Limantour")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("members_venues", { p_ciudad: "París" });
    expect(fromCalls).not.toContain("nightlife_premium");
    expect(screen.getByText("Fuente: limantour.tech · verificado el 1 de octubre de 2026")).toBeInTheDocument();
    expect(screen.getByText("Roma-Condesa")).toBeInTheDocument();
    expect(screen.getByText("Cocktail bar")).toBeInTheDocument();
    // Lo de siempre no inventa fuente.
    const legacy = screen.getByText("Parker & Lenox").closest("article")!;
    expect(within(legacy).queryByText(/Fuente:|verificado el/)).toBeNull();
    // "Otros" agrupa lo curado sin categoría conocida y filtra.
    fireEvent.click(screen.getByRole("button", { name: /Otros/ }));
    expect(screen.queryByText("Parker & Lenox")).toBeNull();
    expect(screen.getByText("Licoreria Limantour")).toBeInTheDocument();
    // Ciudades del servidor en sugerencias y tarjetas.
    await waitFor(() => expect(screen.getAllByTestId("city-card").map((e) => e.textContent)).toEqual(["Ciudad de México", "Mónaco"]));
    expect(document.querySelector('#cities-list-members option[value="Mónaco"]')).not.toBeNull();
    // La búsqueda manda el texto tal cual (el servidor resuelve CDMX, Mexico City, Polanco…).
    const input = screen.getByLabelText("Buscar por ciudad");
    fireEvent.change(input, { target: { value: "CDMX" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("members_venues", { p_ciudad: "CDMX" }));
  });

  it("la solicitud de reserva sigue igual (concierge-action)", async () => {
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    const card = (await screen.findByText("Licoreria Limantour")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Reservar con Concierge" }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [fn, opts] = invoke.mock.calls[0] as unknown as [string, { body: { type: string; payload: { venue_id: string; venue_name: string } } }];
    expect(fn).toBe("concierge-action");
    expect(opts.body.type).toBe("members_nightlife_reservation");
    expect(opts.body.payload).toMatchObject({ venue_id: "c1", venue_name: "Licoreria Limantour" });
  });

  it("si members_cities falla, quedan las ciudades fijas", async () => {
    sim.citiesError = true;
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    expect(await screen.findByText("Licoreria Limantour")).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("members_cities", undefined));
    expect(screen.getAllByTestId("city-card").map((e) => e.textContent)).toContain("Saint-Tropez");
  });

  it("página Members: misma RPC, fuente y barrio, ciudades del servidor", async () => {
    render(<MemoryRouter><Members /></MemoryRouter>);
    expect(await screen.findByText("Licoreria Limantour")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("members_venues", { p_ciudad: "París" });
    expect(fromCalls).not.toContain("nightlife_premium");
    expect(screen.getByText("Fuente: limantour.tech · verificado el 1 de octubre de 2026")).toBeInTheDocument();
    expect(screen.getByText("Roma-Condesa")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("city-card").map((e) => e.textContent)).toEqual(["Ciudad de México", "Mónaco"]));
  });

  it("sin promesas nuevas: lo agregado no dice VIP ni exclusivo", () => {
    for (const f of ["src/components/MembersVenueMeta.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/VIP|exclusiv/i);
    }
    const lib = readFileSync("src/lib/membersVenues.ts", "utf8").replace(/label: "(Casino|Evento) VIP"/g, "");
    expect(lib).not.toMatch(/VIP/);
    expect(lib).not.toMatch(/exclusiv/i);
  });
});
