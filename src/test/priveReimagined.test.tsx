// IATOS Privé · "The World Reimagined" (Documento A + navegación de seis áreas del Documento B):
// búsqueda universal estructurada, relaciones geográficas, shell de navegación, Explorar con estado en
// la URL, Mi Privé, ranuras de los otros equipos y las tres propuestas de portada.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { activeStatus, baseStatus, futureIso, motionState, priveMock, SESSION_TOKEN } from "./helpers/priveTestKit";
import { priveHomeFixture } from "./helpers/priveHomeFixture";

vi.mock("framer-motion", async () => (await import("./helpers/priveTestKit")).framerMotionMock);
vi.mock("@/lib/priveApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priveApi")>();
  const { priveMock: m } = await import("./helpers/priveTestKit");
  return { ...actual, priveApi: m.api };
});
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
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: vi.fn(async () => ({ data: [], error: null })),
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));

import { parseSearch, searchArgs } from "@/lib/priveSearch";
import { placeLine } from "@/lib/priveBrowse";
import { activeArea, PRIVE_AREAS } from "@/components/prive/shell/PriveNav";
import { askIatoHref } from "@/lib/priveLinks";
import { __resetForYouCache } from "@/components/prive/key/useForYouData";
import { __resetStockPhotos } from "@/lib/stockPhoto";
import { PRIVE_SESSION_KEY } from "@/lib/priveSession";
import PriveRoot from "@/pages/prive/PriveRoot";
import PriveHub from "@/pages/prive/PriveHub";
import PriveExplorePage from "@/pages/prive/PriveExplorePage";
import PriveMyPage from "@/pages/prive/PriveMyPage";
import PriveKeyPage from "@/pages/prive/PriveKeyPage";
import PriveDropsPage from "@/pages/prive/PriveDropsPage";
import PriveInsiderPage from "@/pages/prive/PriveInsiderPage";
import PriveUniversePage from "@/pages/prive/PriveUniversePage";
import * as KeySlots from "@/components/prive/key";
import * as ValueSlots from "@/components/prive/value";

const { state, api } = priveMock;
const home = priveHomeFixture();
const EXPS = [
  { id: "q1", slug: "quintonil", name: "Quintonil", universe: "the_table", subcategory: "alta_cocina", state: "CURADO", why: "Cocina mexicana de autor.",
    destination: { slug: "cdmx", name: "Ciudad de México" }, accolades: [{ name: "Guía MICHELIN", year: 2026, url: "https://guide.michelin.com/x" }] },
  { id: "p1", slug: "le-cinq", name: "Le Cinq", universe: "the_table", subcategory: "alta_cocina", state: "VERIFICADO", why: "Cocina francesa.",
    destination: { slug: "paris", name: "París" } },
];

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }

const renderAt = (path: string) => {
  // Sesión normal en este navegador abierto: token en localStorage + cookie de sesión del navegador (AUD-01).
  document.cookie = "iatos_prive_bs=1; Path=/";
  localStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: SESSION_TOKEN, expiresAt: futureIso(), userId: "u1" }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/prive" element={<PriveRoot />}>
          <Route index element={<PriveHub />} />
          <Route path="explorar" element={<PriveExplorePage />} />
          <Route path="mi" element={<PriveMyPage />} />
          <Route path="key" element={<PriveKeyPage />} />
          <Route path="drops" element={<PriveDropsPage />} />
          <Route path="insider" element={<PriveInsiderPage />} />
          <Route path="universo/:key" element={<PriveUniversePage />} />
        </Route>
        <Route path="*" element={<Where />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  __resetStockPhotos();
  __resetForYouCache(); // caché de 60 s de las ranuras de privekey: cada prueba con sus propios datos
  localStorage.clear();
  sessionStorage.clear();
  motionState.reduce = true;
  state.statusOk = true;
  state.status = activeStatus();
  invoke.mockReset();
  invoke.mockImplementation(async (_f: string, o: { body: { query: string } }) => ({ data: { image: `https://images.pexels.com/x/${encodeURIComponent(o.body.query)}.jpg`, photographer: "Ana" }, error: null }));
  api.content.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (api.content as any).mockImplementation(async (fn: string, _ps: string, args: Record<string, unknown> = {}) => {
    if (fn === "prive_home") return { ok: true, data: home };
    if (fn === "prive_universe") return { ok: true, data: { found: true, universe: args._universe, experiences: EXPS, age_locked_count: 0, adult_confirmed: false } };
    if (fn === "prive_for_you") return { ok: true, data: EXPS };
    if (fn === "prive_saved") return { ok: true, data: [{ ...EXPS[0], saved: true }] };
    if (fn === "prive_search") {
      const cities = (args._cities as string[]) ?? [];
      const kw = ((args._keywords as string[] | null) ?? []).map((k) => k.toLowerCase());
      const items = EXPS.filter((e) => cities.includes(e.destination.slug) && (!kw.length || args._universes || kw.some((k) => e.name.toLowerCase().includes(k))));
      return { ok: true, data: { available: true, cities: cities.map((c) => ({ query: c, resolved: true, city: { slug: c, name: c === "paris" ? "París" : c }, items: items.filter((e) => e.destination.slug === c) })) } };
    }
    // privevalor (wave2): Drops sin oportunidades vigentes, radar vacío, un cuaderno Insider, sin viaje próximo.
    if (fn === "prive_drops") return { ok: true, data: { items: [], expired_recent: 0, destination_found: true } };
    if (fn === "prive_radar") return { ok: true, data: { programs: [], items: [], suggestions: [] } };
    if (fn === "prive_insider_index") return { ok: true, data: { destinations: [{ slug: "cdmx", es: "Ciudad de México", en: "Mexico City", tips: 6, before_you_go: 5, last_checked: "2026-10-01" }], saved: 0, trips: [] } };
    if (fn === "prive_before_you_go") return { ok: true, data: { trip: null } };
    if (fn === "prive_passport") return { ok: true, data: { member: { first_name: "Valentina", member_code: "IP-7KQM-X4TD", member_since: "2026-06-01", tenure_days: 143, status: "active", founding_member: false },
      stats: { visitado: 0, experiencia: 0, favorito: 0, deseo: 0, recuerdo: 0, countries: 0 }, entries: [] } };
    if (fn === "prive_value_summary") return { ok: true, data: { totals: {}, entries: [], organized_plans: 0, radar: { posible: 0, por_comprobar: 0 } } };
    return { ok: true, data: [] };
  });
});

describe("búsqueda universal estructurada (sin IA por tecla)", () => {
  it("entiende destinos con alias, acentos e idiomas, intenciones y nombres propios", () => {
    const romantic = parseSearch("Una cena romántica en París.");
    expect(romantic.cities).toEqual(["paris"]);
    expect(romantic.universes).toEqual(expect.arrayContaining(["the_table", "celebrations"]));
    const monaco = parseSearch("Lo mejor de Mónaco.");
    expect(monaco.cities).toEqual(["mc"]);
    expect(monaco.destinationOnly).toBe(true);
    const yachts = parseSearch("Yates en Los Cabos.");
    expect(yachts.cities).toEqual(["los-cabos"]);
    expect(yachts.universes).toContain("yacht_sea");
    const rooftop = parseSearch("Un rooftop espectacular en Nueva York.");
    expect(rooftop.cities).toEqual(["nueva-york"]);
    expect(rooftop.universes).toContain("after_dark");
    const japan = parseSearch("Experiencias únicas en Japón.");
    expect(japan.country).toBe("japon");
    expect(japan.cities).toEqual(expect.arrayContaining(["tokio", "kioto", "osaka"]));
    expect(parseSearch("cdmx").cities).toEqual(["cdmx"]);
    expect(parseSearch("Montecarlo").cities).toEqual(["monaco-monte-carlo"]);
    expect(parseSearch("polanco").cities).toEqual(["cdmx-polanco"]);
    expect(parseSearch("roma norte").cities).toEqual(["cdmx-roma-condesa"]);
    const named = parseSearch("Quintonil");
    expect(named.cities).toEqual([]);
    expect(named.keywords).toEqual(["quintonil"]);
    expect(parseSearch("").cities).toEqual([]);
  });
  it("sin destino usa el del viaje o los destacados (máximo 5) y pide más resultados con intención", () => {
    expect(searchArgs(parseSearch("Quintonil"), ["cdmx", "paris", "mc", "tokio", "dubai", "roma"])._cities).toEqual(["cdmx", "paris", "mc", "tokio", "dubai"]);
    expect(searchArgs(parseSearch("Lo mejor de Mónaco"), ["cdmx"])).toMatchObject({ _cities: ["mc"], _universes: null, _keywords: null, _per_universe: 2 });
  });
});

describe("relaciones geográficas correctas (Fase 3)", () => {
  it("barrio, zona, corredor, área metropolitana, región y ciudad", () => {
    expect(placeLine("cdmx-polanco", "es")).toBe("Barrio de Ciudad de México");
    expect(placeLine("monaco-monte-carlo", "es")).toBe("Zona de Mónaco");
    expect(placeLine("punta-mita", "es")).toBe("En Riviera Nayarit");
    expect(placeLine("interlomas", "es")).toBe("Área metropolitana de Ciudad de México");
    expect(placeLine("riviera-nayarit", "es")).toBe("Región · México");
    expect(placeLine("cdmx", "es")).toBe("México");
    expect(placeLine("paris", "es")).toBe("Francia");
    expect(placeLine("cdmx-polanco", "en")).toBe("Neighbourhood of Mexico City");
  });
});

describe("navegación de seis áreas", () => {
  it("cada ruta pertenece a su área", () => {
    expect(PRIVE_AREAS.map((a) => a.to)).toEqual(["/prive", "/prive/key", "/prive/drops", "/prive/insider", "/prive/explorar", "/prive/mi"]);
    expect(activeArea("/prive")).toBe("forYou");
    expect(activeArea("/prive/destino/cdmx")).toBe("explore");
    expect(activeArea("/prive/experiencia/x")).toBe("explore");
    expect(activeArea("/prive/membresia")).toBe("my");
    expect(activeArea("/prive/solicitudes")).toBe("my");
    expect(activeArea("/prive/insider/tokio")).toBe("insider");
  });
  it("miembro: seis áreas arriba, cinco abajo e Insider a un toque; todo en la misma pestaña", async () => {
    const { container } = renderAt("/prive");
    await screen.findByTestId("prive-hero");
    const navs = screen.getAllByRole("navigation", { name: "Secciones de IATOS Privé" });
    expect(navs).toHaveLength(2);
    // Las seis áreas y, aparte (separador), el acceso a THE PRIVATE EDITION.
    expect(within(navs[0]).getAllByRole("link").map((a) => a.textContent)).toEqual(["Para ti", "The Key", "Drops", "Insider", "Explorar", "Mi Privé", "Revista"]);
    expect(screen.getAllByTestId("prive-edition-nav").every((a) => a.getAttribute("href") === "/prive/edicion")).toBe(true);
    const bottom = screen.getByTestId("prive-bottom-nav");
    expect(within(bottom).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/prive", "/prive/key", "/prive/explorar", "/prive/drops", "/prive/mi"]);
    expect(within(bottom).getByRole("link", { name: /Para ti/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link", { name: /Insider/ }).some((a) => a.getAttribute("href") === "/prive/insider")).toBe(true);
    await screen.findByTestId("prive-catalog-home");
    for (const a of container.querySelectorAll("a[href^='/']")) expect(a.getAttribute("target")).toBeNull();
  });
  it("sin membresía (adelanto) no hay navegación de miembro", async () => {
    state.status = baseStatus({ is_pro: false });
    renderAt("/prive");
    await screen.findByText(/Hay lugares que se visitan/);
    expect(screen.queryByTestId("prive-bottom-nav")).toBeNull();
  });
  it("The Key, Drops e Insider existen (páginas reales de los otros equipos) y nunca son una página vacía", async () => {
    // Antes eran stubs (prive-coming-soon con "Pregúntale a Iato"); con wave2 son las páginas reales de privekey y
    // privevalor. Equivalente: cada una abre con su marca como h1 y con contenido útil aunque no haya datos.
    {
      const { unmount } = renderAt("/prive/key");
      const page = await screen.findByTestId("prive-key-page");
      expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent(/The Privé Key/i);
      expect(within(page).getByTestId("pk-studio")).toBeInTheDocument();
      expect(within(page).getByRole("textbox")).toBeInTheDocument(); // se puede pedir algo de inmediato
      unmount();
    }
    {
      const { unmount } = renderAt("/prive/drops");
      expect(await screen.findByRole("heading", { level: 1, name: /Privé Drops/i })).toBeInTheDocument();
      // Sin oportunidades vigentes: lo dice y ofrece contenido editorial, no una página en blanco.
      expect(await screen.findByTestId("prive-drops-empty")).toHaveTextContent(/\S/);
      expect(api.content).toHaveBeenCalledWith("prive_drops", expect.anything(), expect.objectContaining({ _limit: 60 }));
      unmount();
    }
    {
      const { unmount } = renderAt("/prive/insider");
      expect(await screen.findByRole("heading", { level: 1, name: /The Insider's Notebook/i })).toBeInTheDocument();
      const index = await screen.findByTestId("prive-insider-index");
      expect(within(index).getByRole("link", { name: /Ciudad de México/ })).toHaveAttribute("href", "/prive/insider/cdmx");
      unmount();
    }
    // Las ranuras del contrato existen sin props obligatorias.
    for (const k of ["PriveKeyLauncher", "YourWorldIsReady", "CuratedForYou", "YourNextJourney"]) expect(typeof (KeySlots as Record<string, unknown>)[k]).toBe("function");
    for (const k of ["PrivateEditTeaser", "DropsTeaser", "PassportCard", "ValueOfYourPrive"]) expect(typeof (ValueSlots as Record<string, unknown>)[k]).toBe("function");
  });
});

// Dueño, 23-oct-2026: la búsqueda universal se mudó de "Para ti" a Explorar · Catálogo (Para ti es personal).
describe("EXPLORE · Catálogo: búsqueda, ficha en ≤3 acciones; propuestas de portada de Para ti", () => {
  it("Para ti ya no tiene buscador; en Explorar · Catálogo sí", async () => {
    const { unmount } = renderAt("/prive");
    await screen.findByTestId("prive-catalog-home");
    expect(screen.queryByTestId("prive-search-input")).toBeNull();
    unmount();
    renderAt("/prive/explorar?vista=catalogo");
    expect(await screen.findByTestId("prive-search-input")).toBeInTheDocument();
  });
  it("escribir muestra destinos al instante; confirmar busca experiencias con prive_search; abrir la ficha", async () => {
    renderAt("/prive/explorar?vista=catalogo");
    const input = await screen.findByTestId("prive-search-input");
    expect(input).toHaveAttribute("placeholder", "Un destino, una experiencia, una noche extraordinaria…");
    fireEvent.change(input, { target: { value: "cdmx" } });
    expect(await screen.findByTestId("prive-search-dest")).toHaveAttribute("href", "/prive/destino/cdmx");
    expect(api.content).not.toHaveBeenCalledWith("prive_search", expect.anything(), expect.anything());
    fireEvent.change(input, { target: { value: "Una cena romántica en París" } });
    fireEvent.submit(input.closest("form")!);
    const results = await screen.findByTestId("prive-search-exp-results");
    await waitFor(() => expect(within(results).getByRole("status")).toHaveTextContent("1 experiencia en París"));
    expect(api.content).toHaveBeenCalledWith("prive_search", expect.anything(), expect.objectContaining({ _cities: ["paris"], _universes: expect.arrayContaining(["the_table"]) }));
    // Acción 3: abrir la ficha.
    expect(within(results).getByRole("link", { name: /Le Cinq/ })).toHaveAttribute("href", "/prive/experiencia/le-cinq");
    expect(screen.getByTestId("where")).toHaveTextContent("q=Una+cena+rom");
  });
  it("un restaurante por su nombre, sin ciudad: se busca en los destinos destacados", async () => {
    renderAt("/prive/explorar?vista=catalogo");
    const input = await screen.findByTestId("prive-search-input");
    fireEvent.change(input, { target: { value: "Quintonil" } });
    fireEvent.submit(input.closest("form")!);
    const results = await screen.findByTestId("prive-search-exp-results");
    expect((await within(results).findAllByRole("link", { name: /Quintonil/ }))[0]).toHaveAttribute("href", "/prive/experiencia/quintonil");
    expect(api.content).toHaveBeenCalledWith("prive_search", expect.anything(), expect.objectContaining({ _keywords: ["quintonil"], _cities: expect.arrayContaining(["cdmx"]) }));
  });
  it("sin resultados lo dice y ofrece preguntarle a Iato con la misma frase", async () => {
    renderAt("/prive/explorar?vista=catalogo");
    const input = await screen.findByTestId("prive-search-input");
    fireEvent.change(input, { target: { value: "Zzyzx imposible" } });
    fireEvent.submit(input.closest("form")!);
    const results = await screen.findByTestId("prive-search-exp-results");
    await waitFor(() => expect(within(results).getByRole("status")).toHaveTextContent(/No encontramos experiencias verificadas para «Zzyzx imposible»/));
    expect(within(results).getByTestId("prive-search-ask")).toHaveAttribute("href", askIatoHref("Zzyzx imposible"));
  });
  it("las tres propuestas son portadas funcionales y comparables (?portada=a|b|c)", async () => {
    for (const v of ["a", "b", "c"]) {
      const { unmount } = renderAt(`/prive?portada=${v}`);
      const hero = await screen.findByTestId("prive-hero");
      expect(hero).toHaveAttribute("data-variant", v);
      expect(within(hero).getByRole("link", { name: "Explora tu mundo" })).toBeInTheDocument();
      expect((await screen.findByTestId("prive-catalog-home"))).toHaveAttribute("data-variant", v);
      unmount();
    }
    const { unmount } = renderAt("/prive");
    expect(await screen.findByTestId("prive-hero")).toHaveAttribute("data-variant", "c");
    unmount();
  });
});

describe("EXPLORE y universos", () => {
  it("la región vive en la URL: al volver, la misma pestaña; los doce universos son navegables", async () => {
    renderAt("/prive/explorar?region=europa");
    const tabs = await screen.findByRole("tablist", { name: "Regiones" });
    expect(within(tabs).getByRole("tab", { name: /Europa/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(tabs).getByRole("tab", { name: /México/ }));
    expect(screen.getAllByTestId("where").at(-1)).toHaveTextContent("region=mexico");
    const uni = screen.getByTestId("prive-twelve");
    const links = within(uni).getAllByRole("link");
    expect(links).toHaveLength(12);
    expect(links[0]).toHaveAttribute("href", "/prive/universo/the_table");
    expect(within(uni).getByText("The Table")).toBeInTheDocument();
    expect(within(uni).getByText("La mesa")).toBeInTheDocument();
  });
  it("un universo filtra por destino desde la URL y muestra destinos relacionados", async () => {
    renderAt("/prive/universo/the_table?destino=paris");
    await screen.findByTestId("prive-universe-hero");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The Table");
    const filter = screen.getByRole("navigation", { name: "Filtrar por destino" });
    expect(within(filter).getByRole("button", { name: /París · 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Le Cinq")).toBeInTheDocument();
    expect(screen.queryByText("Quintonil")).toBeNull();
    fireEvent.click(within(filter).getByRole("button", { name: "Todos los destinos" }));
    expect(screen.getByText("Quintonil")).toBeInTheDocument();
  });
});

describe("un solo botón de regresar en todo Privé (arriba a la izquierda)", () => {
  // El dueño veía dos: "← IATOS" (barra) y "← IATOS Privé" (página). Ahora la barra tiene el único
  // y sabe a dónde volver; ninguna página dibuja su propio "← …".
  const arrows = (c: HTMLElement) => c.querySelectorAll("a svg.lucide-arrow-left").length;
  it("portada y áreas principales: uno solo, que sale de Privé", async () => {
    for (const [path, ready] of [["/prive/drops", "prive-drops-empty"], ["/prive/insider", "prive-insider-index"], ["/prive/explorar", "prive-explore-tabs"], ["/prive/explorar?vista=catalogo", "prive-twelve"]] as const) {
      const { container, unmount } = renderAt(path);
      await screen.findByTestId(ready);
      expect(screen.getAllByTestId("prive-back")).toHaveLength(1);
      expect(screen.getByTestId("prive-back")).toHaveAttribute("href", "/dashboard");
      expect(arrows(container)).toBe(1);
      unmount();
    }
  });
  it("página interna: el mismo botón sube un nivel (universo → Explorar)", async () => {
    const { container } = renderAt("/prive/universo/the_table?destino=paris");
    await screen.findByTestId("prive-universe-hero");
    const back = screen.getByTestId("prive-back");
    expect(back).toHaveAttribute("href", "/prive/explorar");
    expect(back).toHaveTextContent("Explorar");
    expect(arrows(container)).toBe(1);
  });
  it("iPhone: la barra no suma otra vez la franja de la hora (ya la deja el body) y tiene 1rem de aire", async () => {
    renderAt("/prive/drops");
    await screen.findByTestId("prive-drops-empty");
    const header = screen.getByTestId("prive-back").closest("header")!;
    expect(header.className).toContain("pt-4");
    expect(header.className).not.toContain("safe-area-inset-top");
  });
});

describe("MY PRIVÉ", () => {
  it("tarjeta, guardados con foto y las secciones de preferencias y seguridad", async () => {
    renderAt("/prive/mi");
    await screen.findByTestId("prive-my");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/My Privé/);
    // Antes: la MemberCard de prive-ux. Con wave2 y sesión Privé abierta, la tarjeta la dibuja THE PRIVÉ PASSPORT
    // (privevalor, prive_passport): mismo nombre y número de miembro, una sola tarjeta (no dos).
    const passport = await screen.findByTestId("prive-passport");
    const card = await within(passport).findByTestId("prive-passport-card");
    expect(card).toHaveTextContent("Valentina");
    expect(within(card).getByTestId("prive-member-number")).toHaveTextContent("IP-7KQM-X4TD");
    expect(screen.queryByTestId("prive-member-card")).toBeNull();
    // THE VALUE OF YOUR PRIVÉ (prive_value_summary): sin registros no inventa ahorros.
    const value = await screen.findByTestId("prive-value");
    expect(within(value).getByRole("heading", { name: /The Value of Your Privé/i })).toBeInTheDocument();
    await within(value).findByTestId("prive-value-comprobado");
    expect(within(value).queryAllByTestId("prive-value-amount")).toHaveLength(0);
    const saved = await screen.findByTestId("prive-my-saved");
    expect(await within(saved).findByText("Quintonil")).toBeInTheDocument();
    expect(within(saved).getByRole("button", { name: "Guardado" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Preferencias y seguridad" })).toBeInTheDocument();
  });
});
