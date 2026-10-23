// IATOS Privé · EXPLORE con diferenciador fuerte (dueño, 23-oct-2026): "Para ti" 100 % personal y Explorar con
// "Mapa + ¿cuándo ir?" y "Ruleta de inspiración". Datos de clima SIMULADOS (se reemplaza priveExploreGeo) para
// que las reglas se prueben con números conocidos; eventos y catálogo simulados con el servidor Privé de prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { activeStatus, futureIso, motionState, priveMock, SESSION_TOKEN } from "./helpers/priveTestKit";
import { priveHomeFixture } from "./helpers/priveHomeFixture";

vi.mock("framer-motion", async () => (await import("./helpers/priveTestKit")).framerMotionMock);
vi.mock("@/lib/priveApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priveApi")>();
  const { priveMock: m } = await import("./helpers/priveTestKit");
  return { ...actual, priveApi: m.api };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "v@example.com" }, signOut: vi.fn() }) }));
vi.mock("@/hooks/useActiveTrip", async () => {
  const { resolveActiveTrip } = await import("@/lib/activeTrip");
  return {
    useActiveTrip: () => {
      const resolved = resolveActiveTrip([], { pinnedId: null, todayLocal: "2026-10-22" });
      return { trips: [], trip: resolved.trip, resolved, loading: false, pinnedId: null, pin: async () => ({ ok: true }) };
    },
  };
});
const profile = { ciudad_origen: "Ciudad de México" as string | null };
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: vi.fn(async () => ({ data: [], error: null })),
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...profile }, error: null }) }) }) }),
  },
}));
// Clima SIMULADO: m[mes] = [máx, mín, lluvia mm, fracción con nieve].
vi.mock("@/lib/priveExploreGeo", () => {
  const flat = (hi: number, lo: number, rain: number, snow = 0) => Array.from({ length: 12 }, () => [hi, lo, rain, snow]);
  const paris = flat(8, 2, 55); paris[5] = [24, 13, 50, 0]; paris[6] = [26, 15, 45, 0];
  const dubai = flat(38, 30, 2); dubai[0] = [24, 15, 10, 0]; dubai[11] = [26, 17, 12, 0];
  const courchevel = flat(18, 6, 70); courchevel[0] = [-3, -11, 70, 0.95]; courchevel[11] = [-1, -9, 75, 0.8];
  const cdmx = flat(24, 9, 20); cdmx[6] = [21, 11, 160, 0];
  const tokio = flat(20, 10, 300);
  return {
    PRIVE_CLIMATE_SOURCE: { name: "NASA POWER", version: "v2.10.1", period: "2001–2025", checked: "2026-10-23", url: "https://power.larc.nasa.gov/", terms: "https://example.test" },
    PRIVE_GEO: {
      paris: { lat: 48.8567, lng: 2.3522, m: paris },
      dubai: { lat: 25.2697, lng: 55.3094, m: dubai },
      courchevel: { lat: 45.415, lng: 6.6339, m: courchevel },
      cdmx: { lat: 19.3538, lng: -99.1359, m: cdmx },
      tokio: { lat: 35.6894, lng: 139.6917, m: tokio },
    },
  };
});

if (!("PointerEvent" in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;

import { PRIVE_TEXT } from "@/lib/priveI18n";
import {
  clusterPoints, eventInMonth, flightEstimate, monthClimate, rouletteCandidates, seasonKind, shuffleDeck, yearFor,
} from "@/lib/priveExplore";
import { PRIVE_GEO } from "@/lib/priveExploreGeo";
import { exploreView } from "@/pages/prive/PriveExplorePage";
import { __resetForYouCache } from "@/components/prive/key/useForYouData";
import { __resetStockPhotos } from "@/lib/stockPhoto";
import { PRIVE_SESSION_KEY } from "@/lib/priveSession";
import PriveRoot from "@/pages/prive/PriveRoot";
import PriveHub from "@/pages/prive/PriveHub";
import PriveExplorePage from "@/pages/prive/PriveExplorePage";

const { state, api } = priveMock;
const home = priveHomeFixture();
const YEAR = yearFor(5);
const EXP = (o: Record<string, unknown>) => ({ subcategory: "x", state: "VERIFICADO", ...o });
const TABLE = [
  EXP({ id: "t1", slug: "le-cinq", name: "Le Cinq", universe: "the_table", why: "Cocina francesa de temporada.", price_level: 4,
    destination: { slug: "paris", name: "París" }, accolades: [{ name: "Guía MICHELIN", year: 2026, url: "https://guide.michelin.com/x" }],
    score: { score: 40, reasons: ["dna:the_table", "calidad:verificado"] } }),
  EXP({ id: "t2", slug: "pujol", name: "Pujol", universe: "the_table", why: "Mole madre.", price_level: 3, destination: { slug: "cdmx", name: "Ciudad de México" },
    score: { score: 30, reasons: ["presupuesto:nivel_3"] } }),
  EXP({ id: "t3", slug: "zuma", name: "Zuma", universe: "the_table", price_level: 2, destination: { slug: "dubai", name: "Dubái" }, score: { score: 10, reasons: [] } }),
  EXP({ id: "t4", slug: "viejo", name: "Viejo", universe: "the_table", state: "DESACTUALIZADO", destination: { slug: "tokio", name: "Tokio" } }),
];
const EVENTS = [
  EXP({ id: "e1", slug: "fiesta-musica-paris", name: "Fête de la Musique", universe: "iconic_events", destination: { slug: "paris", name: "París" },
    event_start: `${YEAR}-06-21`, event_end: `${YEAR}-06-21` }),
  EXP({ id: "e2", slug: "art-basel-x", name: "Feria de arte", universe: "iconic_events", destination: { slug: "dubai", name: "Dubái" },
    event_start: `${yearFor(0)}-01-10`, event_end: `${yearFor(0)}-01-14` }),
];
let ideas: { slug: string; name: string; universe?: string; month?: number; saved_at: string }[] = [];

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const renderAt = (path: string) => {
  document.cookie = "iatos_prive_bs=1; Path=/";
  localStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: SESSION_TOKEN, expiresAt: futureIso(), userId: "u1" }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/prive" element={<PriveRoot />}>
          <Route index element={<PriveHub />} />
          <Route path="explorar" element={<PriveExplorePage />} />
        </Route>
        <Route path="*" element={<Where />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  __resetStockPhotos();
  __resetForYouCache();
  localStorage.clear();
  sessionStorage.clear();
  motionState.reduce = true;
  state.statusOk = true;
  state.status = activeStatus();
  profile.ciudad_origen = "Ciudad de México";
  ideas = [];
  invoke.mockReset();
  invoke.mockImplementation(async (_f: string, o: { body: { query: string } }) => ({ data: { image: `https://images.pexels.com/x/${encodeURIComponent(o.body.query)}.jpg`, photographer: "Ana" }, error: null }));
  api.content.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (api.content as any).mockImplementation(async (fn: string, _ps: string, args: Record<string, unknown> = {}) => {
    if (fn === "prive_home") return { ok: true, data: home };
    if (fn === "prive_universe") return { ok: true, data: { found: true, universe: args._universe, experiences: args._universe === "iconic_events" ? EVENTS : TABLE, age_locked_count: 0, adult_confirmed: false } };
    if (fn === "prive_ideas") return { ok: true, data: ideas };
    if (fn === "prive_idea_save") {
      const slug = String(args._destination);
      ideas = ideas.filter((i) => i.slug !== slug);
      if (args._saved !== false) ideas.unshift({ slug, name: slug === "paris" ? "París" : slug, universe: args._universe as string, month: args._month == null ? undefined : Number(args._month) + 1, saved_at: "2026-10-23T10:00:00Z" });
      return { ok: true, data: { ok: true, saved: args._saved !== false } };
    }
    if (fn === "prive_drops") return { ok: true, data: { items: [], expired_recent: 0, destination_found: true } };
    if (fn === "prive_for_you") return { ok: true, data: TABLE.slice(0, 2) };
    return { ok: true, data: [] };
  });
});

describe("reglas de Explorar (lógica pura)", () => {
  it("temporada por clima: buen clima, nieve, fuera y sin datos", () => {
    expect(seasonKind(PRIVE_GEO.paris, 5)).toBe("good");
    expect(seasonKind(PRIVE_GEO.paris, 0)).toBe("off"); // 8 °C
    expect(seasonKind(PRIVE_GEO.dubai, 6)).toBe("off"); // 38 °C
    expect(seasonKind(PRIVE_GEO.dubai, 0)).toBe("good");
    expect(seasonKind(PRIVE_GEO.courchevel, 0)).toBe("snow");
    expect(seasonKind(PRIVE_GEO.cdmx, 6)).toBe("off"); // lluvia 160 mm, muy por encima de su promedio
    expect(seasonKind(PRIVE_GEO.tokio, 3)).toBe("off"); // 300 mm, por encima del tope
    expect(seasonKind(undefined, 3)).toBe("unknown");
    expect(monthClimate(PRIVE_GEO.paris, 5)).toMatchObject({ high: 24, low: 13, rain: 50, kind: "good" });
  });
  it("horas de vuelo: estimado por distancia, redondeado a media hora; distancias cortas se marcan", () => {
    const f = flightEstimate(PRIVE_GEO.cdmx, PRIVE_GEO.paris)!;
    expect(f.km).toBeGreaterThan(9000);
    expect(f.km).toBeLessThan(9400);
    expect(f.hours).toBe(11.5);
    expect(flightEstimate(PRIVE_GEO.paris, { lat: 48.9, lng: 2.4 })!.short).toBe(true);
    expect(flightEstimate(null, PRIVE_GEO.paris)).toBeNull();
  });
  it("eventos en el mes: cuenta si el evento toca el mes, aunque empiece antes", () => {
    expect(eventInMonth({ event_start: "2027-02-27", event_end: "2027-03-02" }, 2027, 2)).toBe(true);
    expect(eventInMonth({ event_start: "2027-02-27", event_end: "2027-03-02" }, 2027, 3)).toBe(false);
    expect(eventInMonth({ event_start: "2027-06-21" }, 2027, 5)).toBe(true);
    expect(eventInMonth({}, 2027, 5)).toBe(false);
  });
  it("grupos del mapa: lo cercano se agrupa, lo lejano no", () => {
    const g = clusterPoints([{ slug: "a", x: 0, y: 0 }, { slug: "b", x: 10, y: 5 }, { slug: "c", x: 200, y: 0 }], 30);
    expect(g.map((x) => x.slugs.length).sort()).toEqual([1, 2]);
  });
  it("ruleta: solo publicable y dentro del presupuesto; el mes suma o resta; barajado reproducible", () => {
    const geo = PRIVE_GEO as Record<string, (typeof PRIVE_GEO)[string]>;
    const all = rouletteCandidates(TABLE as never, { budget: "any", month: null, geo });
    expect(all.map((c) => c.slug).sort()).toEqual(["cdmx", "dubai", "paris"]); // Tokio está desactualizado
    expect(rouletteCandidates(TABLE as never, { budget: "moderate", month: null, geo }).map((c) => c.slug)).toEqual(["dubai"]);
    const jan = rouletteCandidates(TABLE as never, { budget: "any", month: 0, geo, events: EVENTS as never, year: yearFor(0) });
    const dubai = jan.find((c) => c.slug === "dubai")!, paris = jan.find((c) => c.slug === "paris")!;
    expect(dubai).toMatchObject({ season: "good" });
    expect(dubai.events.map((e) => e.slug)).toEqual(["art-basel-x"]); // evento con fecha en enero
    expect(paris.season).toBe("off");
    expect(jan.indexOf(dubai)).toBeLessThan(jan.indexOf(paris)); // el mal clima resta aunque París tenga más puntaje propio
    expect(shuffleDeck([1, 2, 3, 4, 5, 6], 42)).toEqual(shuffleDeck([1, 2, 3, 4, 5, 6], 42));
    expect(shuffleDeck([1, 2, 3, 4, 5, 6], 42).slice(0, 4).sort()).toEqual([1, 2, 3, 4]);
  });
  it("la pestaña vive en la URL; los enlaces de antes (?region, ?q) abren el Catálogo", () => {
    expect(exploreView(new URLSearchParams(""))).toBe("mapa");
    expect(exploreView(new URLSearchParams("vista=ruleta"))).toBe("ruleta");
    expect(exploreView(new URLSearchParams("region=europa"))).toBe("catalogo");
    expect(exploreView(new URLSearchParams("q=paris"))).toBe("catalogo");
  });
});

describe("Para ti es 100 % personal", { timeout: 30_000 }, () => {
  it("sin catálogo genérico: ni buscador, ni destinos por región, ni colecciones, ni universos; con acceso a Explorar", async () => {
    ideas = [{ slug: "paris", name: "París", universe: "the_table", month: 7, saved_at: "2026-10-20T10:00:00Z" }];
    renderAt("/prive");
    await screen.findByTestId("prive-catalog-home", {}, { timeout: 15_000 });
    for (const id of ["prive-search-input", "prive-region-tabs", "prive-featured-destinations", "prive-edit", "prive-twelve", "prive-collections"]) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    expect(screen.getByTestId("prive-explore-access")).toHaveAttribute("href", "/prive/explorar");
    // Personal: próximo viaje (sin viaje invita a planear), elegido para ti, experiencia de la semana, lo nuevo, tus ideas.
    expect(await screen.findByTestId("pk-next-journey")).toHaveTextContent("Planear un viaje");
    expect(await screen.findByTestId("pk-curated")).toBeInTheDocument();
    expect(await screen.findByTestId("prive-spotlight")).toBeInTheDocument();
    expect(screen.getByTestId("prive-new-this-week")).toBeInTheDocument();
    const list = await screen.findByTestId("prive-ideas-list", {}, { timeout: 15_000 });
    expect(within(list).getByRole("link", { name: "París" })).toHaveAttribute("href", "/prive/destino/paris");
    expect(within(list).getByText(/The Table · para julio/)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Planear" })).toHaveAttribute("href", "/dashboard/planear?destino=Par%C3%ADs");
  });
  it("las ideas persisten en el servidor: quitar una llama a prive_idea_save y desaparece", async () => {
    ideas = [{ slug: "paris", name: "París", saved_at: "2026-10-20T10:00:00Z" }];
    renderAt("/prive");
    const list = await screen.findByTestId("prive-ideas-list", {}, { timeout: 15_000 });
    fireEvent.click(within(list).getByRole("button", { name: "Quitar París de tus ideas" }));
    await waitFor(() => expect(api.content).toHaveBeenCalledWith("prive_idea_save", expect.anything(), expect.objectContaining({ _destination: "paris", _saved: false })));
    expect(await screen.findByText(/Aún no guardas ideas/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Girar la ruleta/ })).toHaveAttribute("href", "/prive/explorar?vista=ruleta");
  });
});

describe("Explorar · Mapa + ¿cuándo ir?", { timeout: 30_000 }, () => {
  const rowOf = (slug: string) => screen.getByTestId("prive-map-list").querySelector(`[data-slug="${slug}"]`) as HTMLElement;
  it("tres pestañas claras arriba; el mapa abre por omisión con el mes de la URL", async () => {
    renderAt("/prive/explorar?mes=6");
    const tabs = await screen.findByRole("tablist", { name: "Formas de explorar" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Mapa¿Cuándo ir?", "RuletaInspírate", "CatálogoBuscar y universos"]);
    expect(within(tabs).getByRole("tab", { name: /Mapa/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "¿A dónde ir en junio?" }, { timeout: 15_000 })).toBeInTheDocument();
    // Teclado en las pestañas: flecha derecha → Ruleta (y queda en la URL).
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: /Mapa/ }), { key: "ArrowRight" });
    expect(screen.getAllByTestId("where").at(-1)).toHaveTextContent("vista=ruleta");
  });
  it("filtro por mes con datos simulados: temporada, nieve, eventos y horas de vuelo estimadas", async () => {
    renderAt("/prive/explorar?vista=mapa&mes=6");
    await screen.findByTestId("prive-map-list", {}, { timeout: 15_000 });
    await waitFor(() => expect(rowOf("paris")).toHaveAttribute("aria-label", expect.stringMatching(/1 evento/)));
    expect(rowOf("paris")).toHaveAttribute("data-kind", "good");
    expect(rowOf("dubai")).toHaveAttribute("data-kind", "off");
    expect(rowOf("paris").getAttribute("aria-label")).toMatch(/≈ 11\.5 h de vuelo directo desde Ciudad de México \(estimado\)/);
    // Solo en temporada.
    fireEvent.click(screen.getByRole("radio", { name: /En temporada/ }));
    let slugs = [...screen.getByTestId("prive-map-list").querySelectorAll("[data-slug]")].map((x) => x.getAttribute("data-slug"));
    expect(slugs).toContain("paris");
    expect(slugs).not.toContain("dubai");
    // Cambiar a enero: Dubái entra (buen clima + evento), París sale, Courchevel es temporada de nieve.
    fireEvent.click(screen.getByRole("radio", { name: "enero" }));
    expect(await screen.findByRole("heading", { name: "¿A dónde ir en enero?" })).toBeInTheDocument();
    slugs = [...screen.getByTestId("prive-map-list").querySelectorAll("[data-slug]")].map((x) => x.getAttribute("data-slug"));
    expect(slugs).toEqual(expect.arrayContaining(["dubai", "courchevel"]));
    expect(slugs).not.toContain("paris");
    expect(rowOf("courchevel")).toHaveAttribute("data-kind", "snow");
    expect(screen.getAllByTestId("where").at(-1)).toHaveTextContent("mes=1");
    // Tocar un destino abre su tarjeta: foto, por qué en ese mes, clima, eventos, vuelo y acciones.
    fireEvent.click(rowOf("dubai"));
    const sheet = await screen.findByTestId("prive-map-sheet");
    expect(within(sheet).getByRole("heading", { name: "Dubái" })).toHaveFocus();
    expect(sheet).toHaveTextContent("En enero suele tener buen clima");
    expect(within(sheet).getByTestId("prive-map-climate")).toHaveTextContent("Máx. 24 °C · mín. 15 °C · lluvia 10 mm al mes");
    expect(sheet).toHaveTextContent("NASA POWER");
    expect(within(sheet).getByTestId("prive-map-events")).toHaveTextContent(/Feria de arte · 10–14 ene/);
    expect(within(sheet).getByRole("link", { name: "Ver ficha y fuente" })).toHaveAttribute("href", "/prive/experiencia/art-basel-x");
    expect(within(sheet).getByTestId("prive-map-flight")).toHaveTextContent(/≈ \d+(\.5)? h de vuelo directo desde Ciudad de México/);
    expect(within(sheet).getByTestId("prive-map-flight")).toHaveTextContent("Estimado por distancia");
    expect(within(sheet).getByRole("link", { name: "Ver destino" })).toHaveAttribute("href", "/prive/destino/dubai");
    expect(within(sheet).getByRole("link", { name: "Planear" })).toHaveAttribute("href", "/dashboard/planear?destino=Dub%C3%A1i");
    expect(api.content).toHaveBeenCalledWith("prive_universe", expect.anything(), expect.objectContaining({ _universe: "iconic_events" }));
  });
  it("sin ciudad en el perfil no se supone ninguna: pide elegirla y la recuerda", async () => {
    profile.ciudad_origen = null;
    renderAt("/prive/explorar?mes=6");
    await screen.findByTestId("prive-map-list", {}, { timeout: 15_000 });
    fireEvent.click(rowOf("paris"));
    expect(await screen.findByTestId("prive-map-flight")).toHaveTextContent("Elige tu ciudad de salida");
    fireEvent.change(screen.getByTestId("prive-map-origin"), { target: { value: "dubai" } });
    expect(screen.getByTestId("prive-map-flight")).toHaveTextContent(/desde Dubái/);
    expect(localStorage.getItem("iatos_prive_origin_v1")).toBe("dubai");
  });
  it("accesible: lista alternativa para lector de pantalla y teclado; el mapa se mueve con teclado", async () => {
    renderAt("/prive/explorar?mes=6");
    const map = await screen.findByTestId("prive-world-map", {}, { timeout: 15_000 });
    expect(map).toHaveAttribute("role", "region");
    expect(map).toHaveAttribute("tabindex", "0");
    expect(map.getAttribute("aria-label")).toMatch(/La misma información está en la lista de destinos/);
    // Los puntos son solo visuales (aria-hidden, fuera del orden de tabulación); la lista es la alternativa.
    const pins = await screen.findAllByTestId(/prive-map-(pin|cluster)/);
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) { expect(p).toHaveAttribute("tabindex", "-1"); expect(p.closest("[aria-hidden='true']")).not.toBeNull(); }
    expect(screen.getByRole("link", { name: "Ir a la lista de destinos" })).toHaveAttribute("href", expect.stringMatching(/^#/));
    const list = screen.getByRole("list", { name: "Destinos en junio" });
    const rows = within(list).getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r.getAttribute("aria-label")).toMatch(/\. (Buen clima|Temporada de nieve|No es su mejor clima|Sin datos de clima)/);
    // Teclado: + acerca, 0 vuelve al mundo; los meses se recorren con flechas.
    const z0 = Number(map.getAttribute("data-zoom"));
    fireEvent.keyDown(map, { key: "+" });
    expect(Number(map.getAttribute("data-zoom"))).toBeGreaterThan(z0);
    fireEvent.keyDown(map, { key: "0" });
    expect(Number(map.getAttribute("data-zoom"))).toBeCloseTo(z0, 2);
    const june = screen.getByRole("radio", { name: "junio" });
    fireEvent.keyDown(june, { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "¿A dónde ir en julio?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "julio" })).toHaveFocus();
    // Tocar un punto abre la misma tarjeta.
    const pin = screen.getAllByTestId("prive-map-pin")[0];
    fireEvent.click(pin);
    expect(await screen.findByTestId("prive-map-sheet")).toHaveAttribute("data-slug", pin.getAttribute("data-slug"));
  });
});

describe("Explorar · Ruleta de inspiración", { timeout: 30_000 }, () => {
  it("mood → tarjetas con razones reales → otro / me late (se guarda en Ideas) → planear", async () => {
    renderAt("/prive/explorar?vista=ruleta");
    const rl = await screen.findByTestId("prive-roulette", {}, { timeout: 15_000 });
    const spin = within(rl).getByTestId("prive-roulette-spin");
    expect(spin).toBeDisabled(); // sin ánimo no se gira
    fireEvent.click(within(rl).getByRole("radio", { name: /The Table/ }));
    fireEvent.click(within(rl).getByRole("radio", { name: /Alto · hasta \$\$\$/ }));
    fireEvent.click(within(rl).getByRole("radio", { name: "junio" }));
    fireEvent.click(spin);
    const card = await screen.findByTestId("prive-roulette-card");
    expect(api.content).toHaveBeenCalledWith("prive_universe", expect.anything(), expect.objectContaining({ _universe: "the_table", _limit: 200 }));
    // Presupuesto "Alto" (≤ $$$): Le Cinq ($$$$) no cuenta, así que París no sale; quedan CDMX y Dubái.
    const seen = [card.getAttribute("data-slug")];
    expect(["cdmx", "dubai"]).toContain(seen[0]);
    const reasons = screen.getByTestId("prive-roulette-reasons");
    expect(reasons).toHaveTextContent(/de The Table en la selección Privé/);
    if (seen[0] === "cdmx") {
      expect(reasons).toHaveTextContent("Para empezar: Pujol: Mole madre.");
      expect(reasons).toHaveTextContent("Acorde a tu nivel de presupuesto");
    } else {
      expect(reasons).toHaveTextContent("Ojo: en junio no es su mejor clima (NASA POWER)");
    }
    expect(screen.getByText("Propuesta 1 de 2")).toBeInTheDocument();
    // "Otro" (botón) → la siguiente.
    fireEvent.click(screen.getByTestId("prive-roulette-skip"));
    const card2 = await screen.findByTestId("prive-roulette-card");
    expect(card2.getAttribute("data-slug")).not.toBe(seen[0]);
    seen.push(card2.getAttribute("data-slug"));
    // "Me late" deslizando a la derecha.
    fireEvent.pointerDown(card2, { clientX: 100, button: 0 });
    fireEvent.pointerMove(card2, { clientX: 260, button: 0 });
    fireEvent.pointerUp(card2, { clientX: 260, button: 0 });
    const liked = await screen.findByTestId("prive-roulette", {}, { timeout: 15_000 });
    await waitFor(() => expect(liked).toHaveAttribute("data-phase", "liked"));
    await waitFor(() => expect(api.content).toHaveBeenCalledWith("prive_idea_save", expect.anything(),
      expect.objectContaining({ _destination: seen[1], _saved: true, _universe: "the_table", _month: 5, _budget: "high", _source: "ruleta" })));
    expect(await screen.findByTestId("prive-roulette-status")).toHaveTextContent(/quedó guardado en tus ideas/);
    const plan = screen.getByTestId("prive-roulette-plan");
    expect(plan).toHaveTextContent("Planear este viaje");
    expect(plan.getAttribute("href")).toMatch(/^\/dashboard\/planear\?destino=/);
    fireEvent.click(plan);
    expect(screen.getAllByTestId("where").at(-1)?.textContent).toMatch(/^\/dashboard\/planear\?destino=(Ciudad|Dub)/);
  });
  it("con teclado: flecha izquierda = otro, flecha derecha = me late; al final, resumen con planear", async () => {
    renderAt("/prive/explorar?vista=ruleta");
    const rl = await screen.findByTestId("prive-roulette", {}, { timeout: 15_000 });
    fireEvent.click(within(rl).getByRole("radio", { name: /The Table/ }));
    fireEvent.click(within(rl).getByTestId("prive-roulette-spin"));
    const c1 = await screen.findByTestId("prive-roulette-card");
    expect(c1).toHaveFocus();
    fireEvent.keyDown(c1, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("prive-roulette")).toHaveAttribute("data-phase", "liked"));
    fireEvent.click(screen.getByRole("button", { name: "Seguir girando" }));
    for (let k = 0; k < 2; k++) {
      const c = await screen.findByTestId("prive-roulette-card");
      act(() => { fireEvent.keyDown(c, { key: "ArrowLeft" }); });
    }
    await waitFor(() => expect(screen.getByTestId("prive-roulette")).toHaveAttribute("data-phase", "end"));
    expect(screen.getByText("Te latieron")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Planear este viaje" })[0].getAttribute("href")).toMatch(/^\/dashboard\/planear\?destino=/);
  });
  it("sin resultados lo dice (no inventa destinos)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api.content as any).mockImplementation(async (fn: string) => (fn === "prive_home" ? { ok: true, data: home }
      : fn === "prive_universe" ? { ok: true, data: { found: true, experiences: [] } } : { ok: true, data: [] }));
    renderAt("/prive/explorar?vista=ruleta");
    const rl = await screen.findByTestId("prive-roulette", {}, { timeout: 15_000 });
    fireEvent.click(within(rl).getByRole("radio", { name: /After Dark/ }));
    fireEvent.click(within(rl).getByTestId("prive-roulette-spin"));
    expect(await screen.findByText(/No encontramos destinos con ese ánimo y presupuesto/)).toBeInTheDocument();
  });
});

describe("Explorar en español: sin texto en inglés (salvo las marcas de Privé)", { timeout: 30_000 }, () => {
  // Marcas permitidas: "Explore", los doce universos (The Table…), "Destinations", "The Twelve Universes".
  const ENGLISH = /\b(Map|Roulette|Catalogue|Where to go|When to go|Love it|Next|Spin|Zoom|In season|With events|Good weather|Snow season|flight|Choose your|See destination|Plan this trip|Why you'll love|Your ideas)\b/;
  it("mapa y ruleta", async () => {
    const { container, unmount } = renderAt("/prive/explorar?mes=1");
    await screen.findByTestId("prive-map-list", {}, { timeout: 15_000 });
    expect(container.textContent).not.toMatch(ENGLISH);
    unmount();
    const r = renderAt("/prive/explorar?vista=ruleta");
    const rl = await screen.findByTestId("prive-roulette", {}, { timeout: 15_000 });
    fireEvent.click(within(rl).getByRole("radio", { name: /The Table/ }));
    fireEvent.click(within(rl).getByTestId("prive-roulette-spin"));
    await screen.findByTestId("prive-roulette-card");
    expect(r.container.textContent).not.toMatch(ENGLISH);
  });
  it("los diccionarios nuevos tienen las mismas llaves en ES y EN", () => {
    for (const k of ["map", "roulette", "personal"] as const) {
      expect(Object.keys(PRIVE_TEXT.en[k]).sort()).toEqual(Object.keys(PRIVE_TEXT.es[k]).sort());
    }
  });
});
