// Pantallas del catálogo de IATOS Privé (sobre usePriveAccess del grupo ui): errores PRIVE_* → candado,
// estados honestos (DESACTUALIZADO en gris y sin "Solicitar"), etiquetas solo con evidencia, crédito
// de Pexels, cobertura calculada y declaración 18+.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
// Las ranuras reales de FOR YOU (privekey, edition) leen la cuenta con useAuth.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "v@example.com" }, signOut: vi.fn() }) }));
const TRIPS = () => [] as { id: string }[];
vi.mock("@/hooks/useActiveTrip", async () => {
  // La misma forma que el hook real (trips, trip, resolved, loading…), con la regla real de viaje activo.
  const { resolveActiveTrip } = await import("@/lib/activeTrip");
  return {
    useActiveTrip: () => {
      const trips = TRIPS();
      const resolved = resolveActiveTrip(trips, { pinnedId: null, todayLocal: "2026-10-22" });
      return { trips, trip: resolved.trip, resolved, loading: false, pinnedId: null, pin: async () => ({ ok: true }) };
    },
  };
});
// usePriveAccess (grupo ui): content() no llama sin sesión y devuelve {ok, data} o {ok:false, code}.
const access = { session: null as null | { token: string }, content: vi.fn() };
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => access }));

import { createPriveCatalogApi, PriveLockedError, type ContentFn, type PriveExperience } from "@/lib/priveCatalogApi";
import { canRequest, imageQueries, labelWithEvidence, pexelsCredit, priceText } from "@/lib/priveCatalogView";
import PriveDestinationPage from "@/pages/prive/PriveDestinationPage";
import { __resetStockPhotos } from "@/lib/stockPhoto";
import { ExperienceDetail } from "@/components/prive/catalog/ExperienceDetail";

const exp = (over: Partial<PriveExperience> = {}): PriveExperience => ({
  id: "e1", slug: "mc-fixture", name: "Fixture Mesa", universe: "the_table", subcategory: "alta_cocina", state: "CURADO",
  verified_at: "2026-10-20T00:00:00Z", label: "EXPERIENCIA_CURADA", label_evidence: { sources: 2 }, why: "Hecho con fuente.",
  destination: { slug: "mc", name: "Mónaco", timezone: "Europe/Monaco" }, website: "https://fixture.test/", booking_method: "web",
  age_policy: "todas", price_level: 4, sources: ["https://fixture.test/", "https://guide.test/x"],
  image: { source: "pexels", query: "fine dining", illustrative: true }, ...over,
});

const unlocked = (data: unknown) => {
  access.session = { token: "tok" };
  access.content.mockResolvedValue({ ok: true, data });
};
beforeEach(() => {
  rpc.mockReset(); invoke.mockReset(); access.content.mockReset(); access.session = null;
  access.content.mockResolvedValue({ ok: false, code: "PRIVE_NO_SESSION" });
  __resetStockPhotos();
  invoke.mockResolvedValue({ data: { image: "https://images.pexels.com/1.jpg", photographer: "Ana Foto", photographer_url: "https://www.pexels.com/@ana", page_url: "https://www.pexels.com/photo/1" }, error: null });
});

describe("cliente del catálogo", () => {
  it("un código de sesión Privé se vuelve PriveLockedError (el hook ya borró la sesión y vuelve al candado)", async () => {
    const api = createPriveCatalogApi(async () => ({ ok: false, code: "PRIVE_SESSION_EXPIRED" }), () => null);
    const err = await api.destination("mc").catch((e) => e);
    expect(err).toBeInstanceOf(PriveLockedError);
    expect(err.code).toBe("PRIVE_SESSION_EXPIRED");
  });
  it("pasa los argumentos de la RPC (el hook agrega _ps)", async () => {
    const content = vi.fn(async () => ({ ok: true as const, data: { found: false } }));
    await createPriveCatalogApi(content as unknown as ContentFn, () => "t").destination("monte carlo");
    expect(content).toHaveBeenCalledWith("prive_destination", { _slug: "monte carlo" });
  });
  it("solicitar sin sesión no llama al servidor", async () => {
    await expect(createPriveCatalogApi(vi.fn(), () => null).request({ experienceId: "e1", title: "x" })).rejects.toBeInstanceOf(PriveLockedError);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("solicitar manda la sesión en x-prive-session a concierge-action", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, request: { id: "r1", status: "solicitado" } }, error: null });
    await createPriveCatalogApi(vi.fn(), () => "tok-7").request({ experienceId: "e1", title: "Mesa" });
    expect(invoke).toHaveBeenCalledWith("concierge-action", expect.objectContaining({ headers: { "x-prive-session": "tok-7" } }));
    expect((invoke.mock.calls[0][1] as { body: { type: string } }).body.type).toBe("prive_request");
  });
});

describe("textos honestos", () => {
  it("sin evidencia no hay etiqueta; con evidencia se explica", () => {
    expect(labelWithEvidence({ label: "PARTNER_VERIFICADO", label_evidence: {} })).toBeNull();
    expect(labelWithEvidence({ label: "BENEFICIO_EXCLUSIVO" })).toBeNull();
    expect(labelWithEvidence({ label: "EXPERIENCIA_CURADA", label_evidence: { sources: 2 }, verified_at: "2026-10-20" })?.evidence)
      .toMatch(/no tiene acuerdo comercial/);
  });
  it("precio solo con fuente; si no, por confirmar", () => {
    expect(priceText({ price_level: 3 })).toBe("Precio por confirmar · nivel $$$");
    expect(priceText({ price: { min: 380, max: 450, currency: "EUR", basis: "por_persona", source: "https://x.test" } })).toMatch(/según la fuente/);
  });
  it("crédito de Pexels y orden de consultas de imagen", () => {
    expect(pexelsCredit("Ana")).toBe("Foto ilustrativa · Pexels · Ana");
    // La ciudad va en inglés (Pexels busca mejor así) cuando el destino está en el índice.
    expect(imageQueries(exp())).toEqual(["fine dining", "alta cocina Monaco", "fine dining tasting menu plating"]);
  });
  it("lo desactualizado o no disponible no se puede solicitar", () => {
    expect(canRequest({ state: "DESACTUALIZADO" })).toBe(false);
    expect(canRequest({ state: "NO_DISPONIBLE" })).toBe(false);
    expect(canRequest({ state: "CURADO" })).toBe(true);
  });
});

const renderDest = () => render(
  <MemoryRouter initialEntries={["/prive/destino/mc"]}>
    <Routes><Route path="/prive/destino/:slug" element={<PriveDestinationPage />} /></Routes>
  </MemoryRouter>,
);

describe("página de destino", () => {
  it("sin sesión Privé muestra el candado y no pide contenido a la base", async () => {
    renderDest();
    expect(await screen.findByTestId("prive-locked")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("muestra estados, cobertura calculada, lo desactualizado en gris y la declaración 18+", async () => {
    unlocked({
      found: true, destination: { slug: "mc", name: "Mónaco", kind: "country", timezone: "Europe/Monaco" },
      coverage: { level: "COBERTURA_PARCIAL", publicables: 2, verificadas: 0, universos: 1 },
      experiences: [exp(), exp({ id: "e2", slug: "mc-old", name: "Fixture Bar Viejo", universe: "after_dark", state: "DESACTUALIZADO", label: undefined })],
      age_locked_count: 2, adult_terms_version: "2026-10-22",
    });
    renderDest();
    expect(await screen.findByText("Fixture Mesa")).toBeInTheDocument();
    // "Selección en crecimiento" era relleno: con cobertura parcial no se dice nada.
    expect(screen.queryByTestId("prive-coverage")).toBeNull();
    expect(screen.getByText(/Por verificar: la última revisión tiene más de 90 días/)).toBeInTheDocument();
    expect(screen.getByTestId("prive-age-gate")).toHaveTextContent("Hay 2 experiencias");
    expect(screen.getByTestId("prive-planner")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Foto ilustrativa · Pexels/).length).toBeGreaterThan(0));
  });
  it("llegar con las fechas del viaje (#para-tus-fechas) pide prive_for_you con esas fechas y lleva a la sección", async () => {
    // Enlace "Ver experiencias para mis fechas" de Your Next Journey (privekey): la sección carga después, así
    // que el salto al ancla lo hace la propia sección cuando ya existe.
    access.session = { token: "tok" };
    access.content.mockImplementation(async (fn: string) => fn === "prive_for_you"
      ? { ok: true, data: [exp({ id: "e9", slug: "mc-fechas", name: "Fixture En Tus Fechas" })] }
      : { ok: true, data: { found: true, destination: { slug: "mc", name: "Mónaco", kind: "country", timezone: "Europe/Monaco" }, experiences: [exp()], age_locked_count: 0 } });
    const scroll = vi.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<MemoryRouter initialEntries={["/prive/destino/mc?desde=2026-11-12&hasta=2026-11-16#para-tus-fechas"]}>
        <Routes><Route path="/prive/destino/:slug" element={<PriveDestinationPage />} /></Routes></MemoryRouter>);
      const sec = await screen.findByTestId("prive-more-in");
      expect(sec).toHaveAttribute("id", "para-tus-fechas");
      expect(within(sec).getByText("Fixture En Tus Fechas")).toBeInTheDocument();
      expect(access.content).toHaveBeenCalledWith("prive_for_you", expect.objectContaining({ _destination: "mc", _from: "2026-11-12", _to: "2026-11-16" }));
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts[0]).toBe(sec);
    } finally { Element.prototype.scrollIntoView = prev; }
  });
  it("destino sin contenido verificado: lo dice, sin inventar", async () => {
    unlocked({ found: true, destination: { slug: "mascate", name: "Mascate", kind: "locality" },
      coverage: { level: "SIN_COBERTURA_VERIFICADA", publicables: 0, verificadas: 0, universos: 0 }, experiences: [], age_locked_count: 0 });
    renderDest();
    expect(await screen.findByText(/Aún no tenemos experiencias verificadas en Mascate/)).toBeInTheDocument();
    expect(screen.getByTestId("prive-coverage")).toHaveTextContent("Aún no tenemos selección verificada");
  });
  it("si la base responde PRIVE_NOT_ELIGIBLE, candado con el motivo", async () => {
    access.session = { token: "tok" };
    access.content.mockResolvedValue({ ok: false, code: "PRIVE_NOT_ELIGIBLE" });
    renderDest();
    expect(await screen.findByTestId("prive-locked")).toHaveTextContent("90 días");
  });
});

describe("ficha", () => {
  it("curada: estado, etiqueta con evidencia, fuentes y acciones; aviso de que solicitar no es reservar", () => {
    render(<MemoryRouter><ExperienceDetail e={exp()} onLocked={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId("prive-state")).toHaveTextContent("Curado");
    expect(screen.getByTestId("prive-label")).toHaveTextContent("Experiencia curada");
    expect(screen.getByText("guide.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Solicitar con Iato/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agregar a mi viaje/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pregúntale a Iato" })).toHaveAttribute("href", expect.stringMatching(/^\/dashboard\/concierge\?ask=/));
    expect(screen.getByText(/Solicitar no es reservar/)).toBeInTheDocument();
    expect(screen.getByText("Horario por confirmar")).toBeInTheDocument();
    expect(screen.getByText("Disponibilidad no consultada")).toBeInTheDocument();
  });
  it("desactualizada: sin Solicitar ni Agregar al viaje", () => {
    render(<MemoryRouter><ExperienceDetail e={exp({ state: "DESACTUALIZADO" })} onLocked={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /Solicitar con Iato/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Agregar a mi viaje/ })).toBeNull();
    expect(screen.getByText(/No se puede solicitar mientras esté por verificar/)).toBeInTheDocument();
  });
  it("casino: aviso de información práctica sin apuestas", () => {
    render(<MemoryRouter><ExperienceDetail e={exp({ universe: "casino_grand_nights", age_policy: "18+", label: undefined })} onLocked={() => {}} /></MemoryRouter>);
    expect(screen.getByRole("note")).toHaveTextContent("IATOS no promueve ni intermedia apuestas");
    expect(screen.getByText("Solo mayores de 18")).toBeInTheDocument();
  });
});

describe("hub", () => {
  it("la sección del catálogo se registra en PRIVE_HUB_SECTIONS, no se dibuja sin contenido y es personal (sin catálogo genérico)", async () => {
    const { PRIVE_HUB_SECTIONS } = await import("@/components/prive/PriveCatalogSlot");
    const sec = PRIVE_HUB_SECTIONS.find((x) => x.id === "catalogo")!;
    expect(sec.rpc).toBe("prive_home");
    expect(sec.render({ total: 0, universes: [], destinations: [] })).toBeNull();
    render(<MemoryRouter>{sec.render({ total: 3, universes: [{ key: "the_table", count: 3 }],
      destinations: [{ slug: "mc", name: "Mónaco", region_group: "europa", kind: "country", coverage: "COBERTURA_PARCIAL", count: 3 }] })}</MemoryRouter>);
    // Dueño, 23-oct-2026: la sección es "Para ti", 100 % personal. Los destinos destacados, las regiones y las
    // colecciones (The Art of Dining…) se mudaron a Explorar; aquí queda el acceso claro a Explorar. Con wave2 la
    // sección también monta el acceso a The Privé Key, cuyo ejemplo "Estoy en Mónaco…" abre The Key con la petición.
    expect(screen.getByTestId("prive-catalog-home")).toBeInTheDocument();
    for (const l of screen.queryAllByRole("link", { name: /Mónaco/ })) expect(l.getAttribute("href")).toMatch(/^\/prive\/key\?w=Estoy%20en%20M%C3%B3naco/);
    expect(screen.queryByRole("link", { name: /The Art of Dining/ })).toBeNull();
    expect(screen.getByTestId("prive-explore-access")).toHaveAttribute("href", "/prive/explorar");
  });
});
