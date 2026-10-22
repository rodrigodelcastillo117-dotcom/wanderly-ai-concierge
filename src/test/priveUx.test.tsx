// IATOS Privé · pase de experiencia (dueño, 2026-10-22):
//   1. el idioma sigue al de la persona (es por omisión, en si su idioma principal es inglés);
//   2. ninguna tarjeta de destino queda vacía (foto o respaldo de marca), con la fila compartida;
//   3. explorar destinos sin lista infinita: búsqueda sin acentos, una región a la vez, "Ver más";
//   4. la navegación interna no abre pestañas nuevas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { activeStatus, futureIso, motionState, priveMock, SESSION_TOKEN } from "./helpers/priveTestKit";
import { priveHomeFixture } from "./helpers/priveHomeFixture";

vi.mock("framer-motion", async () => (await import("./helpers/priveTestKit")).framerMotionMock);
vi.mock("@/lib/priveApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priveApi")>();
  const { priveMock: m } = await import("./helpers/priveTestKit");
  return { ...actual, priveApi: m.api };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "v@example.com" }, signOut: vi.fn() }) }));
const tripState: { trip: null | { id: string; destino: string; fecha_salida: string; fecha_regreso: string } } = { trip: null };
vi.mock("@/hooks/useActiveTrip", () => ({ useActiveTrip: () => ({ trips: tripState.trip ? [tripState.trip] : [], trip: tripState.trip, loading: false }) }));
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: vi.fn(),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));

import { langFromTag, PRIVE_TEXT, resolvePriveLang } from "@/lib/priveI18n";
import { browsable, featuredDestinations, groupByRegion, normalizeQuery, searchDestinations } from "@/lib/priveBrowse";
import { destinationPhotoQueries, loadPrivePhoto } from "@/lib/privePhoto";
import { __resetStockPhotos, cachedStockPhoto, loadStockPhoto } from "@/lib/stockPhoto";
import { messageFor } from "@/lib/priveCopy";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";
import { DestinationBrowser } from "@/components/prive/catalog/DestinationBrowser";
import { ShowMore } from "@/components/prive/catalog/ShowMore";
import { PriveLangProvider } from "@/components/prive/PriveLang";
import { GrandWelcome } from "@/components/prive/GrandWelcome";
import PriveRoot from "@/pages/prive/PriveRoot";
import PriveHub from "@/pages/prive/PriveHub";
import { PRIVE_SESSION_KEY } from "@/lib/priveSession";

const { state, api } = priveMock;
const home = priveHomeFixture();
// Las marcas de Privé se quedan en inglés con subtítulo en español (nota del dueño): "The World, Beyond
// Ordinary.", "Curated for You", los doce universos… Todo lo demás debe estar en español.
const BRAND_LINES = new Set(["IATOS PRIVÉ", "The World, Beyond Ordinary."]);
const ENGLISH_CEREMONY = Object.values(PRIVE_TEXT.en.ceremony).filter((v): v is string => typeof v === "string" && !BRAND_LINES.has(v));
const ENGLISH_WORDS = /\b(WELCOME|EXPLORE|YOUR WORLD|JUST GOT BIGGER|There are places|Explore Your World|Ask Iato|See all|OPEN INVITATION|ENTER IATOS|Skip|Continue|Some destinations|Illustrative photo|Featured|Where to\?)\b/;

const photo = (q: string) => ({ data: { image: `https://images.pexels.com/photos/${encodeURIComponent(q)}.jpeg`, photographer: "Ana Foto", page_url: "https://www.pexels.com/photo/1/" }, error: null });

function setBrowserLanguages(langs: string[]) {
  Object.defineProperty(window.navigator, "languages", { configurable: true, get: () => langs });
  Object.defineProperty(window.navigator, "language", { configurable: true, get: () => langs[0] });
}

beforeEach(() => {
  __resetStockPhotos();
  invoke.mockReset();
  invoke.mockImplementation(async (_fn: string, opts: { body: { query: string } }) => photo(opts.body.query));
  localStorage.clear();
  sessionStorage.clear();
  motionState.reduce = true;
  setBrowserLanguages(["es-MX", "es"]);
});
afterEach(() => {
  vi.useRealTimers();
  setBrowserLanguages(["es-MX", "es"]);
});

describe("idioma de Privé", () => {
  it("español por omisión; inglés solo si el idioma principal es inglés", () => {
    expect(resolvePriveLang()).toBe("es");
    expect(resolvePriveLang({ languages: [] })).toBe("es");
    expect(resolvePriveLang({ languages: ["es-MX", "en-US"] })).toBe("es");
    expect(resolvePriveLang({ languages: ["en-US", "es-MX"] })).toBe("en");
    expect(resolvePriveLang({ languages: ["en-GB"] })).toBe("en");
    // Un idioma que Privé no tiene no decide: se usa el siguiente que sí (o español).
    expect(resolvePriveLang({ languages: ["fr-FR", "en"] })).toBe("en");
    expect(resolvePriveLang({ languages: ["pt-BR"] })).toBe("es");
  });
  it("el idioma del perfil (cuando exista el campo) gana al del navegador", () => {
    expect(resolvePriveLang({ profile: "en", languages: ["es-MX"] })).toBe("en");
    expect(resolvePriveLang({ profile: "es-MX", languages: ["en-US"] })).toBe("es");
    expect(resolvePriveLang({ profile: "Español", languages: ["en-US"] })).toBe("es");
    expect(resolvePriveLang({ profile: "", languages: ["en-US"] })).toBe("en");
    expect(langFromTag("de")).toBeNull();
  });
  it("los dos diccionarios tienen las mismas llaves (nada se queda sin traducir)", () => {
    const keys = (o: unknown, p = ""): string[] => (o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => [`${p}${k}`, ...keys(v, `${p}${k}.`)]) : []);
    expect(keys(PRIVE_TEXT.en).sort()).toEqual(keys(PRIVE_TEXT.es).sort());
    expect(PRIVE_TEXT.en.welcome.cities).toHaveLength(PRIVE_TEXT.es.welcome.cities.length);
  });
  it("los mensajes del servidor siguen el idioma vigente", () => {
    expect(messageFor("WRONG_PASSWORD", "es")).toMatch(/Contraseña Privé incorrecta/);
    expect(messageFor("WRONG_PASSWORD", "en")).toMatch(/Incorrect Privé password/);
  });
});

describe("Grand Welcome en el idioma de la persona", () => {
  it("español: sin ninguna línea en inglés, con las seis ciudades en español", async () => {
    render(<MemoryRouter><GrandWelcome onDone={() => {}} /></MemoryRouter>);
    const dlg = screen.getByRole("dialog", { name: "Bienvenida a IATOS Privé" });
    expect(within(dlg).getByText("TE DAMOS LA BIENVENIDA A PRIVÉ")).toBeInTheDocument();
    expect(within(dlg).getByText("TU MUNDO ACABA DE CRECER.")).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Saltar" })).toBeInTheDocument();
    for (const c of ["París", "Ciudad de México", "Tokio", "Nueva York", "Dubái", "Roma"]) expect(within(dlg).getByText(c)).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getAllByRole("img")).toHaveLength(6));
    const text = dlg.textContent ?? "";
    for (const line of ENGLISH_CEREMONY) expect(text).not.toContain(line);
    expect(text).not.toMatch(ENGLISH_WORDS);
  });
  it("inglés: navegador en inglés → ceremonia y ciudades en inglés", () => {
    setBrowserLanguages(["en-US", "en"]);
    render(<MemoryRouter><GrandWelcome onDone={() => {}} /></MemoryRouter>);
    const dlg = screen.getByRole("dialog", { name: "Welcome to IATOS Privé" });
    expect(within(dlg).getByText("WELCOME TO PRIVÉ")).toBeInTheDocument();
    expect(within(dlg).getByText("YOUR WORLD JUST GOT BIGGER.")).toBeInTheDocument();
    expect(within(dlg).getByText("Mexico City")).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });
  it("las seis fotos pasan por la fila compartida; si una consulta no trae foto se prueba la siguiente", async () => {
    invoke.mockImplementation(async (_fn: string, opts: { body: { query: string } }) =>
      (opts.body.query.startsWith("mexico city palacio") ? { data: { image: null }, error: null } : photo(opts.body.query)));
    render(<MemoryRouter><GrandWelcome onDone={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(6));
    const queries = invoke.mock.calls.map((c) => (c[1] as { body: { query: string } }).body.query);
    expect(queries).toContain("mexico city palacio de bellas artes");
    expect(queries).toContain("mexico city skyline");
    expect(invoke.mock.calls.every((c) => c[0] === "pexels-image")).toBe(true);
    // Crédito obligatorio en cada foto.
    expect(screen.getAllByText(/Foto ilustrativa · Pexels · Ana Foto/)).toHaveLength(6);
  });
});

describe("fotos: nunca una tarjeta vacía y un fallo temporal no se recuerda", { timeout: 20_000 }, () => {
  it("cada consulta de destino viene en inglés y con respaldo", () => {
    expect(destinationPhotoQueries("cdmx", "Ciudad de México")[0]).toBe("Mexico City Palacio de Bellas Artes");
    expect(destinationPhotoQueries("queretaro", "Querétaro")).toContain("Querétaro Mexico");
    expect(destinationPhotoQueries("nuevo-destino", "Nuevo Destino")).toEqual(["Nuevo Destino city", "Nuevo Destino"]);
    // Todo destino del dueño tiene al menos dos consultas.
    for (const [slug, m] of Object.entries(PRIVE_DESTINATION_INDEX)) expect(m.q.length, slug).toBeGreaterThanOrEqual(m.q.length > 1 ? 2 : 1);
  });
  it("Pexels caído (503 / upstream_error) es temporal: no se guarda como 'sin foto'", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsHttpError", context: { status: 503, headers: { get: () => "30" } } } });
    expect(await loadStockPhoto("rome colosseum")).toEqual({ photo: null, transient: true });
    expect(cachedStockPhoto("rome colosseum")).toBeUndefined();
    invoke.mockResolvedValueOnce({ data: { image: null, upstream_error: true }, error: null });
    expect(await loadStockPhoto("rome colosseum")).toEqual({ photo: null, transient: true });
    expect(cachedStockPhoto("rome colosseum")).toBeUndefined();
    const ok = await loadStockPhoto("rome colosseum");
    expect(ok.photo?.image).toMatch(/^https:\/\/images\.pexels\.com\//);
  });
  it("la cadena se corta en un fallo temporal y sigue en 'sin foto'", async () => {
    invoke.mockImplementation(async (_f: string, o: { body: { query: string } }) => (o.body.query === "a" ? { data: { image: null }, error: null } : photo(o.body.query)));
    expect((await loadPrivePhoto(["a", "b"])).status).toBe("ok");
    __resetStockPhotos();
    invoke.mockClear();
    invoke.mockImplementation(async () => ({ data: null, error: { context: { status: 429, headers: { get: () => "60" } } } }));
    expect((await loadPrivePhoto(["x", "y"])).status).toBe("retry");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("cada tarjeta de destino muestra foto o el respaldo de marca, nunca vacía", async () => {
    let n = 0;
    // Una de cada tres consultas no tiene foto en Pexels; el resto sí.
    invoke.mockImplementation(async (_f: string, o: { body: { query: string } }) => ((n++ % 3 === 0) ? { data: { image: null }, error: null } : photo(o.body.query)));
    // jsdom no tiene IntersectionObserver: todas las tarjetas "se ven" a la vez y la fila (20/min) las
    // reparte en varios minutos; se adelanta el reloj para verlas todas resueltas.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MemoryRouter><PriveLangProvider><DestinationBrowser data={home} /></PriveLangProvider></MemoryRouter>);
    for (let i = 0; i < 6; i++) await act(async () => { vi.advanceTimersByTime(61_000); });
    await waitFor(() => {
      const boxes = screen.getAllByTestId("prive-photo");
      expect(boxes.length).toBeGreaterThan(10);
      for (const b of boxes) expect(b.getAttribute("data-status")).not.toBe("pending");
    });
    for (const b of screen.getAllByTestId("prive-photo")) {
      const img = b.querySelector("img");
      const fallback = b.querySelector('[data-testid="prive-photo-fallback"]');
      expect(img || fallback, b.outerHTML.slice(0, 120)).toBeTruthy();
      if (fallback) expect(fallback.textContent?.trim().length).toBeGreaterThan(0); // el nombre en filigrana
    }
  });
  it("tras agotar los reintentos de un fallo temporal queda el respaldo, no una caja vacía", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invoke.mockImplementation(async () => ({ data: null, error: { context: { status: 503, headers: { get: () => null } } } }));
    render(<MemoryRouter><PriveLangProvider><DestinationBrowser data={{ ...home, destinations: home.destinations.filter((d) => d.slug === "roma") }} /></PriveLangProvider></MemoryRouter>);
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(60_000); });
    await waitFor(() => expect(screen.getAllByTestId("prive-photo-fallback").length).toBeGreaterThan(0));
    expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(2); // sí reintentó
  });
});

describe("buscar y explorar sin lista infinita", { timeout: 20_000 }, () => {
  const list = browsable(home.destinations);
  it("búsqueda sin acentos, alias y país", () => {
    expect(normalizeQuery("  Querétaro ")).toBe("queretaro");
    expect(searchDestinations(list, "queretaro")[0].slug).toBe("queretaro");
    expect(searchDestinations(list, "QUERÉTARO")[0].slug).toBe("queretaro");
    expect(searchDestinations(list, "cdmx")[0].slug).toBe("cdmx");
    expect(searchDestinations(list, "nyc")[0].slug).toBe("nueva-york");
    expect(searchDestinations(list, "new york")[0].slug).toBe("nueva-york");
    expect(searchDestinations(list, "monaco")[0].slug).toBe("mc");
    expect(searchDestinations(list, "zurich")[0].slug).toBe("zurich");
    const italia = searchDestinations(list, "italia").map((d) => d.slug);
    expect(italia).toEqual(expect.arrayContaining(["roma", "milan", "florencia", "venecia", "capri"]));
    expect(searchDestinations(list, "zzzz")).toEqual([]);
    expect(searchDestinations(list, "")).toEqual([]);
  });
  it("regiones en orden de marca y destacados con más contenido primero", () => {
    const groups = groupByRegion(list);
    expect(groups[0].key).toBe("mexico");
    expect(groups.map((g) => g.key)).toEqual(["mexico", "europa", "norteamerica", "medio_oriente", "asia_oceania", "otras_regiones"]);
    expect(groups.reduce((a, g) => a + g.items.length, 0)).toBe(list.length);
    const f = featuredDestinations(list, 8);
    expect(f).toHaveLength(8);
    expect(f.every((d) => d.coverage === "PILOTO_VERIFICADO")).toBe(true);
  });
  it("pestañas de región: una sola región a la vez, con flechas del teclado", () => {
    render(<MemoryRouter><PriveLangProvider><DestinationBrowser data={home} /></PriveLangProvider></MemoryRouter>);
    const tablist = screen.getByRole("tablist", { name: "Regiones" });
    let tabs = within(tablist).getAllByRole("tab");
    // Primero "Destacados" (lo verificado con más experiencias) y luego una pestaña por región.
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual(["Destacados", "México", "Europa", "Norteamérica", "Medio Oriente", "Asia y Oceanía", "Otras regiones"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getAllByTestId("prive-dest-card")).toHaveLength(8);
    fireEvent.click(tabs[1]);
    tabs = within(tablist).getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tabs[1].id);
    const slugs = () => within(screen.getByRole("tabpanel")).getAllByTestId("prive-dest-card").map((a) => a.getAttribute("data-slug"));
    const mexico = home.destinations.filter((d) => d.region_group === "mexico" && d.kind !== "neighborhood").map((d) => d.slug);
    expect(slugs()).toEqual(mexico);
    expect(slugs()).not.toContain("paris");
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    expect(within(tablist).getAllByRole("tab")[2]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(within(tablist).getAllByRole("tab")[2]);
    expect(slugs()).toContain("paris");
    expect(slugs()).not.toContain("cdmx");
    fireEvent.keyDown(within(tablist).getAllByRole("tab")[2], { key: "End" });
    expect(within(tablist).getAllByRole("tab")[6]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(within(tablist).getAllByRole("tab")[6], { key: "Home" });
    expect(within(tablist).getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    // "Ver todos (N)": índice compacto de la región, sin fotos.
    fireEvent.click(within(tablist).getAllByRole("tab")[2]);
    fireEvent.click(screen.getByRole("button", { name: /Ver todos \(\d+\)/ }));
    expect(screen.getByTestId("prive-region-index")).toBeInTheDocument();
    expect(within(screen.getByTestId("prive-region-index")).getByRole("link", { name: /Florencia/ })).toHaveAttribute("href", "/prive/destino/florencia");
  });
  it("buscar «queretaro» encuentra Querétaro en un toque; Escape limpia", () => {
    render(<MemoryRouter><PriveLangProvider><DestinationBrowser data={home} /></PriveLangProvider></MemoryRouter>);
    const input = screen.getByRole("searchbox", { name: "Buscar un destino" });
    expect(input).toHaveAttribute("placeholder", "¿A dónde?");
    fireEvent.change(input, { target: { value: "queretaro" } });
    const results = screen.getByTestId("prive-search-results");
    expect(within(results).getByRole("status")).toHaveTextContent("1 destino para «queretaro»");
    expect(within(results).getByRole("link", { name: /Querétaro/ })).toHaveAttribute("href", "/prive/destino/queretaro");
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.change(input, { target: { value: "lugar-que-no-existe" } });
    expect(screen.getByRole("status")).toHaveTextContent("No encontramos");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
  it("la página entera de destinos ya no dibuja las ~110 tarjetas: solo destacados + una región", () => {
    render(<MemoryRouter><PriveLangProvider><DestinationBrowser data={home} /></PriveLangProvider></MemoryRouter>);
    const cards = screen.getAllByTestId("prive-dest-card");
    expect(cards.length).toBeLessThanOrEqual(8); // solo la pestaña abierta (Destacados)
    expect(browsable(home.destinations).length).toBeGreaterThan(90);
  });
  it("listas largas con «Ver más»", () => {
    const items = Array.from({ length: 20 }, (_, i) => `e${i}`);
    render(<PriveLangProvider><ShowMore items={items} render={(x) => <p key={x}>{x}</p>} /></PriveLangProvider>);
    expect(screen.getAllByText(/^e\d+$/)).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "Ver más (11)" }));
    expect(screen.getAllByText(/^e\d+$/)).toHaveLength(18);
    fireEvent.click(screen.getByRole("button", { name: "Ver más (2)" }));
    expect(screen.getAllByText(/^e\d+$/)).toHaveLength(20);
  });
  it("en inglés el explorador también cambia (nombres en inglés)", () => {
    setBrowserLanguages(["en-US"]);
    render(<MemoryRouter><PriveLangProvider><DestinationBrowser data={home} /></PriveLangProvider></MemoryRouter>);
    expect(screen.getByRole("searchbox", { name: "Search a destination" })).toHaveAttribute("placeholder", "Where to?");
    expect(screen.getByRole("tab", { name: /Mexico/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Featured/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Mexico City").length).toBeGreaterThan(0);
  });
});

const EXPS = [
  { id: "q1", slug: "quintonil", name: "Quintonil", universe: "the_table", subcategory: "alta_cocina", state: "CURADO", why: "Cocina mexicana de autor.",
    destination: { slug: "cdmx", name: "Ciudad de México" }, accolades: [{ name: "Guía MICHELIN", year: 2026, url: "https://guide.michelin.com/x" }] },
  { id: "q2", slug: "pujol", name: "Pujol", universe: "the_table", subcategory: "alta_cocina", state: "VERIFICADO", why: "Mole madre.",
    destination: { slug: "cdmx", name: "Ciudad de México" } },
  { id: "q3", slug: "viejo", name: "Bar Viejo", universe: "after_dark", subcategory: "bar", state: "DESACTUALIZADO", destination: { slug: "cdmx", name: "Ciudad de México" } },
];

describe("hub desbloqueado en español y navegación interna en la misma pestaña", { timeout: 20_000 }, () => {
  const renderHub = () => {
    localStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: SESSION_TOKEN, expiresAt: futureIso(), userId: "u1" }));
    state.statusOk = true;
    state.status = activeStatus();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api.content as any).mockImplementation(async (fn: string) =>
      fn === "prive_home" ? { ok: true, data: home }
        : fn === "prive_universe" ? { ok: true, data: { found: true, universe: "the_table", experiences: EXPS, age_locked_count: 0, adult_confirmed: false } }
          : fn === "prive_for_you" ? { ok: true, data: EXPS.slice(0, 2) } : { ok: true, data: [] });
    return render(
      <MemoryRouter initialEntries={["/prive"]}>
        <Routes><Route path="/prive" element={<PriveRoot />}><Route index element={<PriveHub />} /></Route></Routes>
      </MemoryRouter>,
    );
  };
  afterEach(() => { api.content.mockReset(); api.content.mockImplementation(async (_fn: string, ps: string | null) => (ps ? { ok: true, data: [] } : { ok: false, code: "PRIVE_NO_SESSION" })); });

  it("sin texto en inglés para quien usa español", async () => {
    const { container } = renderHub();
    expect(await screen.findByText(/más allá de lo ordinario/i)).toBeInTheDocument();
    await screen.findByTestId("prive-catalog-home");
    const text = container.textContent ?? "";
    for (const line of ENGLISH_CEREMONY) expect(text).not.toContain(line);
    expect(text).not.toMatch(ENGLISH_WORDS);
    // Las colecciones van con conteo y foto dentro del explorador; no se duplican con las fichas estáticas.
    expect(screen.queryByRole("list", { name: "Las 12 colecciones" })).toBeNull();
    expect(screen.getByRole("link", { name: /The Art of Dining · El arte de la mesa · 40 experiencias/ })).toHaveAttribute("href", "/prive/universo/the_table");
    expect(container.querySelector(".prive-root")).toHaveAttribute("lang", "es-MX");
  });
  it("portada cinematográfica con el nombre, Para ti, colecciones con foto y la experiencia de la semana", async () => {
    tripState.trip = null;
    renderHub();
    const hero = await screen.findByTestId("prive-hero");
    // Marca en inglés + subtítulo en español; propuesta personal; "Explora tu mundo" y "Pregúntale a Iato".
    expect(within(hero).getByRole("heading", { level: 1 })).toHaveTextContent(/The World, Beyond Ordinary\.\s*El mundo, más allá de lo ordinario\./);
    expect(within(hero).getByTestId("prive-hero-personal")).toHaveTextContent(/^Valentina, esta es tu selección/);
    expect(within(hero).getByRole("link", { name: "Explora tu mundo" })).toHaveAttribute("href", "/prive/explorar");
    expect(within(hero).getByRole("link", { name: "Pregúntale a Iato" })).toHaveAttribute("href", "/dashboard/concierge");
    const forYou = await screen.findByTestId("prive-for-you");
    expect(within(forYou).getByRole("heading", { name: /Curated for You\s*Elegido para ti/ })).toBeInTheDocument();
    expect(within(forYou).getByText(/Selección editorial/)).toBeInTheDocument(); // sin viaje: no finge personalización
    // Lo desactualizado no se recomienda.
    expect(within(forYou).queryByText("Bar Viejo")).toBeNull();
    expect(within(forYou).getAllByTestId("prive-exp-tile").length).toBe(2);
    const spot = await screen.findByTestId("prive-spotlight");
    expect(within(spot).getByText("Experiencia de la semana")).toBeInTheDocument();
    expect(within(spot).getByRole("link")).toHaveAttribute("href", expect.stringMatching(/^\/prive\/experiencia\/(quintonil|pujol)$/));
    const edit = screen.getByTestId("prive-edit");
    for (const n of ["The Art of Dining", "Escape to the Sea", "Extraordinary Stays", "Signature Mexico"]) expect(within(edit).getByText(n)).toBeInTheDocument();
    expect(within(edit).getByText("El arte de la mesa")).toBeInTheDocument();
    // Los doce universos viven en Explorar, no duplicados en la portada.
    expect(screen.queryByTestId("prive-twelve")).toBeNull();
    expect(screen.getByRole("link", { name: /The Twelve Universes/ })).toHaveAttribute("href", "/prive/explorar");
    expect(screen.queryByText(/Selección en crecimiento/)).toBeNull();
  });
  it("Para ti usa el viaje activo: prive_for_you con el destino y las fechas del viaje", async () => {
    tripState.trip = { id: "t1", destino: "Ciudad de México, México", fecha_salida: "2026-11-12", fecha_regreso: "2026-11-16" };
    renderHub();
    const forYou = await screen.findByTestId("prive-for-you");
    expect(within(forYou).getByText(/Para tu viaje a Ciudad de México/)).toBeInTheDocument();
    const next = await screen.findByTestId("prive-next-journey");
    expect(within(next).getByRole("heading", { name: "Tu próximo capítulo: Ciudad de México." })).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Explorar Ciudad de México" })).toHaveAttribute("href", "/prive/destino/cdmx");
    expect(within(next).getByRole("link", { name: "Agregar al itinerario" })).toHaveAttribute("href", "/dashboard/viajes/t1");
    expect(within(screen.getByTestId("prive-hero")).getByTestId("prive-hero-personal")).toHaveTextContent("Valentina, tu próximo capítulo: Ciudad de México.");
    expect(api.content).toHaveBeenCalledWith("prive_for_you", expect.anything(), expect.objectContaining({ _destination: "cdmx", _from: "2026-11-12", _to: "2026-11-16" }));
    tripState.trip = null;
  });
  it("ningún enlace interno abre otra pestaña y no hay enlaces dentro de enlaces", async () => {
    const { container } = renderHub();
    await screen.findByTestId("prive-catalog-home");
    await waitFor(() => expect(container.querySelectorAll('[data-testid="prive-photo"] img').length).toBeGreaterThan(0));
    const anchors = [...container.querySelectorAll("a[href]")] as HTMLAnchorElement[];
    expect(anchors.length).toBeGreaterThan(20);
    for (const a of anchors) {
      const href = a.getAttribute("href")!;
      if (href.startsWith("/")) expect(a.getAttribute("target"), href).toBeNull();
      expect(a.querySelector("a"), href).toBeNull();
    }
    // Las tarjetas llevan el crédito como texto (sin enlace anidado).
    expect(container.querySelectorAll('.prive-dest-card [data-testid="prive-photo-credit"]').length).toBeGreaterThan(0);
  });
});
