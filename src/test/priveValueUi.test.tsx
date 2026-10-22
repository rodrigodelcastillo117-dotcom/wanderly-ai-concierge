// privevalor · pantallas: Drops (vencidos y porcentajes dudosos no se pintan; editorial cuando no hay nada),
// Privilege Radar (cuatro estados, verificación obligatoria), The Value of Your Privé (cajas separadas por
// tipo y moneda), Passport (privado; fundador solo con criterio), Insider + Before You Go (agregar a notas
// del viaje), vista previa antes del día 90 (sin contenido protegido) e idioma de la persona.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() }, from: vi.fn() },
}));
type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler> = {};
const content = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
  const h = handlers[fn];
  if (!h) return { ok: false, code: "SERVICE_UNAVAILABLE" };
  const out = h(args);
  if (out && typeof out === "object" && "__code" in (out as Record<string, unknown>)) return { ok: false, code: (out as { __code: string }).__code };
  return { ok: true, data: out };
});
const access = { session: { token: "tok" } as null | { token: string }, content, status: null as null | Record<string, unknown> };
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => access }));

import PriveDropsPage from "@/pages/prive/PriveDropsPage";
import PriveInsiderPage from "@/pages/prive/PriveInsiderPage";
import { PassportCard, PrivateEditTeaser, PrivePreview, PrivilegeRadar, ValueOfYourPrive, DropsTeaser } from "@/components/prive/value";
import { valueLangFrom } from "@/lib/priveValueI18n";
import type { PriveDrop } from "@/lib/priveValueModel";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const future = iso(new Date(Date.now() + 30 * 86400e3));
const past = iso(new Date(Date.now() - 5 * 86400e3));
const recent = new Date(Date.now() - 2 * 86400e3).toISOString();
const D = (over: Partial<PriveDrop>): PriveDrop => ({
  id: over.slug ?? "d", slug: "d", type: "promocion_publica", status: "activo", title: { es: "Título", en: "Title" },
  provider: { name: "Proveedor Oficial" }, benefit: { es: "Beneficio real" }, conditions: { es: "Condiciones reales" }, eligibility: { es: "Todos" },
  source: { url: "https://oficial.test/fuente", name: "Sitio oficial" }, link: "https://oficial.test/oferta", last_verified_at: recent, ...over,
});

const renderAt = (path: string, el: React.ReactNode, route = "*") =>
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>);

beforeEach(() => {
  handlers = { prive_value_track: () => true };
  content.mockClear(); rpc.mockReset(); access.session = { token: "tok" }; access.status = null;
  Object.defineProperty(navigator, "languages", { value: ["es-MX"], configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("PRIVÉ DROPS", () => {
  it("muestra proveedor, condiciones, elegibilidad, vigencia, fuente y fecha; oculta vencidos y porcentajes sin comparación", async () => {
    handlers.prive_drops = () => ({ expired_recent: 2, destination_found: true, items: [
      D({ slug: "louvre", title: { es: "Louvre gratis el primer viernes" }, valid_until: future, destination: { slug: "paris", es: "París" }, reasons: ["viaje"] }),
      D({ slug: "vencido-en-cache", title: { es: "Oferta vencida" }, valid_until: past }),
      D({ slug: "falso-40", title: { es: "Hasta 40% en suites" } }),
      D({ slug: "pct-ok", title: { es: "Tarifa de temporada" }, benefit: { es: "25 % menos que su tarifa estándar" }, type: "tarifa_publicada",
          price: { offer: 300, reference: 400, currency: "EUR", source: "https://oficial.test/precios", discount_pct: 25 } }),
      D({ slug: "edit", type: "editorial", title: { es: "Gran Premio 2027" } }),
    ] });
    handlers.prive_radar = () => ({ programs: [], items: [], suggestions: [] });
    renderAt("/prive/drops", <PriveDropsPage />);
    const list = await screen.findByTestId("prive-drops-list");
    const cards = within(list).getAllByTestId("prive-drop");
    expect(cards).toHaveLength(3);
    expect(screen.queryByText("Oferta vencida")).toBeNull();
    expect(screen.queryByText("Hasta 40% en suites")).toBeNull();
    const louvre = cards[0];
    expect(within(louvre).getByText("Louvre gratis el primer viernes")).toBeTruthy();
    expect(within(louvre).getByText(/Proveedor Oficial · París/)).toBeTruthy();
    expect(within(louvre).getByText("Condiciones reales")).toBeTruthy();
    expect(within(louvre).getByText(/Vigencia: Hasta el/)).toBeTruthy();
    expect(within(louvre).getByText("Para tu próximo viaje")).toBeTruthy();
    expect(within(louvre).getByRole("link", { name: "Sitio oficial" }).getAttribute("href")).toBe("https://oficial.test/fuente");
    const official = within(louvre).getByRole("link", { name: /Abrir el sitio oficial/ });
    expect(official.getAttribute("target")).toBe("_blank");
    expect(official.getAttribute("rel")).toContain("noopener");
    expect(within(louvre).getByText(/Verificado el/)).toBeTruthy();
    // El porcentaje verificable sí se muestra, junto a su comparación.
    expect(within(cards[1]).getByTestId("prive-drop-price").textContent).toMatch(/−25 %/);
    // La editorial se etiqueta como tal.
    expect(within(cards[2]).getByText("Oportunidad editorial")).toBeTruthy();
    expect(within(cards[2]).getByText(/no es una promoción ni un beneficio/)).toBeTruthy();
    expect(screen.getByTestId("prive-drops-expired").textContent).toMatch(/2 oportunidades vencieron/);
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_value_track", expect.objectContaining({ _event: "drops_view" })));
  });

  it("abrir el enlace oficial registra un evento sin texto (solo id)", async () => {
    handlers.prive_drops = () => ({ expired_recent: 0, destination_found: true, items: [D({ slug: "a" })] });
    handlers.prive_radar = () => ({ programs: [], items: [], suggestions: [] });
    renderAt("/prive/drops", <PriveDropsPage />);
    fireEvent.click(await screen.findByRole("link", { name: /Abrir el sitio oficial/ }));
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_value_track", { _event: "drop_link_open", _ref: "a", _destination: null, _surface: "drops" }));
  });

  it("sin oportunidades verificables: lo dice y ofrece contenido editorial útil con fuente", async () => {
    handlers.prive_drops = () => ({ expired_recent: 0, destination_found: true, items: [] });
    handlers.prive_radar = () => ({ programs: [], items: [], suggestions: [] });
    handlers.prive_insider_index = () => ({ destinations: [{ slug: "paris", es: "París", en: "Paris", tips: 5, before_you_go: 4, last_checked: "2026-10-22" }], saved: 0, trips: [] });
    handlers.prive_insider = () => ({ found: true, destination: { slug: "paris", es: "París", en: "Paris" }, trips: [], tips: [
      { id: "t1", slug: "paris-louvre-cierra-martes", category: "errores", destination: { slug: "paris" }, title: { es: "El Louvre cierra los martes" },
        body: { es: "Abre lunes, jueves…" }, before_you_go: true, rank: 1, source: { url: "https://www.louvre.fr/en/visit/hours-admission", name: "Musée du Louvre", checked_at: "2026-10-22" } }] });
    renderAt("/prive/drops", <PriveDropsPage />);
    expect(await screen.findByTestId("prive-drops-empty")).toBeTruthy();
    const fb = await screen.findByTestId("prive-editorial-fallback");
    expect(await within(fb).findByText("El Louvre cierra los martes")).toBeTruthy();
    expect(within(fb).getByText(/Revisado el 22 de octubre de 2026/)).toBeTruthy();
  });

  it("filtros en la URL: se conservan al volver", async () => {
    handlers.prive_drops = () => ({ expired_recent: 0, destination_found: true, items: [
      D({ slug: "a", title: { es: "En París" }, destination: { slug: "paris", es: "París" } }),
      D({ slug: "b", title: { es: "En Mónaco" }, destination: { slug: "mc", es: "Mónaco" } }),
      D({ slug: "g", title: { es: "Global" } }),
    ] });
    handlers.prive_radar = () => ({ programs: [], items: [], suggestions: [] });
    renderAt("/prive/drops?destino=mc", <PriveDropsPage />);
    const list = await screen.findByTestId("prive-drops-list");
    expect(within(list).queryByText("En París")).toBeNull();
    expect(within(list).getByText("En Mónaco")).toBeTruthy();
    expect(within(list).getByText("Global")).toBeTruthy();
  });

  it("un código PRIVE_* muestra el candado, sin contenido", async () => {
    handlers.prive_drops = () => ({ __code: "PRIVE_SESSION_EXPIRED" });
    renderAt("/prive/drops", <PriveDropsPage />);
    expect(await screen.findByTestId("prive-locked")).toBeTruthy();
    expect(screen.queryByTestId("prive-drop")).toBeNull();
  });

  it("DropsTeaser prioriza una oportunidad real y no pinta nada sin sesión", async () => {
    handlers.prive_drops = () => ({ expired_recent: 0, destination_found: true, items: [D({ slug: "e", type: "editorial", title: { es: "Editorial" } }), D({ slug: "r", title: { es: "Real" }, reasons: ["boveda"] })] });
    const { unmount } = renderAt("/prive", <DropsTeaser />);
    const t = await screen.findByTestId("prive-drops-teaser");
    expect(within(t).getByText("Real")).toBeTruthy();
    expect(within(t).queryByText("Editorial")).toBeNull();
    unmount();
    handlers.prive_drops = () => ({ __code: "PRIVE_NO_SESSION" });
    const r = renderAt("/prive", <DropsTeaser />);
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_drops", expect.anything()));
    expect(r.container.innerHTML).toBe("");
  });

  it("PrivateEditTeaser queda reservado para THE PRIVATE EDITION (no pinta un botón sin destino)", () => {
    const r = render(<PrivateEditTeaser />);
    expect(r.container.innerHTML).toBe("");
  });
});

describe("THE PRIVILEGE RADAR", () => {
  it("cuatro estados; marca de la Bóveda = POSIBLE BENEFICIO; VERIFICADO exige cómo se verificó", async () => {
    const items = [
      { id: "r1", program: "Marriott Bonvoy", benefit: "Mejora con puntos", state: "por_comprobar" },
      { id: "r2", program: "Banco", benefit: "Salas", state: "verificado", verification_note: "Con mi banco", verified_at: "2026-10-20T00:00:00Z" },
      { id: "r3", program: "Hotel", benefit: "Noche", state: "utilizado", verification_note: "ok", verified_at: "2026-10-01T00:00:00Z", used_at: "2026-10-10" },
      { id: "r4", program: "Mi tarjeta", benefit: "Seguro", state: "posible" },
    ];
    handlers.prive_radar = () => ({ programs: [{ kind: "hotel", label: "Marriott Bonvoy", tier: "Gold Elite" }], items,
      suggestions: [D({ slug: "nightly", type: "beneficio_lealtad", title: { es: "Nightly Upgrade Awards" }, matched_program: "Marriott Bonvoy", reasons: ["boveda"] })] });
    const save = vi.fn(() => ({ ok: false, code: "VERIFICATION_REQUIRED" }));
    handlers.prive_radar_save = save;
    renderAt("/prive", <PrivilegeRadar />);
    const radar = await screen.findByTestId("prive-radar");
    expect(within(radar).getByText("Marriott Bonvoy · Gold Elite")).toBeTruthy();
    expect(within(radar).getByText(/nunca números de tarjeta/)).toBeTruthy();
    expect(within(radar).getByTestId("prive-radar-suggested").textContent).toBe("POSIBLE BENEFICIO");
    expect(within(radar).getByText("Coincide con Marriott Bonvoy de tu Bóveda")).toBeTruthy();
    const states = within(radar).getAllByTestId("prive-radar-state").map((x) => x.textContent);
    expect(states).toEqual(["ELEGIBILIDAD POR COMPROBAR", "BENEFICIO VERIFICADO", "BENEFICIO UTILIZADO", "POSIBLE BENEFICIO"]);
    // Marcar verificado sin nota: no se envía y se explica.
    const first = within(radar).getAllByTestId("prive-radar-item")[0];
    fireEvent.click(within(first).getByRole("button", { name: "Marcar verificado" }));
    fireEvent.click(within(first).getByRole("button", { name: "Marcar verificado" }));
    expect(await within(first).findByText(/escribe cómo lo comprobaste/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    // Con nota, sí se envía.
    fireEvent.change(within(first).getByLabelText(/Cómo lo verificaste/), { target: { value: "Confirmado en mi cuenta" } });
    fireEvent.click(within(first).getByRole("button", { name: "Marcar verificado" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ _item: { id: "r1", state: "verificado", verification_note: "Confirmado en mi cuenta", used_at: undefined } }));
    // "utilizado" no se ofrece desde un estado no verificado.
    expect(within(first).queryByRole("button", { name: "Marcar utilizado" })).toBeNull();
  });
});

describe("THE VALUE OF YOUR PRIVÉ", () => {
  it("separa comprobado, estimado, potencial y sin ahorro; nunca suma monedas", async () => {
    handlers.prive_value_summary = () => ({
      totals: {}, organized_plans: 1, radar: { posible: 1, por_comprobar: 1, verificado: 0, utilizado: 0 },
      entries: [
        { id: "1", kind: "comprobado", title: "Hotel", currency: "MXN", reference_amount: 5200, paid_amount: 4100, savings_amount: 1100, reference_source: "Tarifa", evidence_note: "Folio" },
        { id: "2", kind: "comprobado", title: "Museo", currency: "EUR", reference_amount: 32, paid_amount: 0, savings_amount: 32, reference_source: "Tarifa oficial", evidence_note: "Primer viernes" },
        { id: "3", kind: "estimado", title: "Cena", currency: "EUR", reference_amount: 300, paid_amount: 250, savings_amount: 50, reference_source: "Menú" },
        { id: "4", kind: "sin_ahorro", title: "Aniversario", non_monetary_note: "Noche organizada" },
      ] });
    renderAt("/prive/mi", <ValueOfYourPrive />);
    const proven = await screen.findByTestId("prive-value-comprobado");
    const amounts = within(proven).getAllByTestId("prive-value-amount").map((x) => x.textContent?.replace(/\s+/g, " "));
    expect(amounts).toHaveLength(2);
    expect(amounts.join(" | ")).toMatch(/(EUR\s?32|€32)/);
    expect(amounts.join(" | ")).toMatch(/MXN 1,100/);
    expect(within(screen.getByTestId("prive-value-estimado")).getByTestId("prive-value-amount").textContent).toMatch(/(EUR\s?50|€50)/);
    expect(within(screen.getByTestId("prive-value-potencial")).getByText(/2 beneficios sin monto calculable/)).toBeTruthy();
    const nm = screen.getByTestId("prive-value-sin_ahorro");
    expect(within(nm).getByText("1 plan Privé agregado a tus viajes")).toBeTruthy();
    expect(within(nm).getByText("Aniversario")).toBeTruthy();
    expect(within(nm).queryByTestId("prive-value-amount")).toBeNull();
  });
  it("sin registros: lo dice, sin inventar cifras", async () => {
    handlers.prive_value_summary = () => ({ totals: {}, entries: [], organized_plans: 0, radar: { posible: 0, por_comprobar: 0, verificado: 0, utilizado: 0 } });
    renderAt("/prive/mi", <ValueOfYourPrive />);
    expect(await screen.findByText(/No calculamos ahorros sin una referencia/)).toBeTruthy();
    expect(screen.queryAllByTestId("prive-value-amount")).toHaveLength(0);
  });
  it("el formulario no envía un ahorro comprobado sin evidencia", async () => {
    handlers.prive_value_summary = () => ({ totals: {}, entries: [], organized_plans: 0, radar: { posible: 0, por_comprobar: 0, verificado: 0, utilizado: 0 } });
    const save = vi.fn(() => ({ ok: true, entry: {} }));
    handlers.prive_value_save = save;
    renderAt("/prive/mi", <ValueOfYourPrive />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar valor" }));
    fireEvent.change(screen.getByLabelText("Qué fue"), { target: { value: "Hotel" } });
    fireEvent.change(screen.getByLabelText("Precio de referencia"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Lo que pagaste"), { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText("Fuente del precio de referencia"), { target: { value: "Tarifa pública" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Un ahorro comprobado necesita evidencia.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("THE PRIVÉ PASSPORT", () => {
  const passport = (member: Record<string, unknown>) => () => ({ member: { first_name: "Valentina", member_code: "IP-7KQM-X4TD", member_since: "2026-07-01T18:00:00Z", tenure_days: 113, status: "active", founding_member: false, ...member },
    stats: { visitado: 1, experiencia: 0, favorito: 0, deseo: 1, recuerdo: 0, countries: 1 },
    entries: [{ id: "p1", kind: "visitado", title: "Primera vez en París", happened_on: "2025-05-10", destination: { slug: "paris", es: "París", en: "Paris", country: "FR" } }] });
  it("tarjeta con nombre, Member Since, número no sensible, antigüedad y estado; privado; sin fundador sin criterio", async () => {
    handlers.prive_passport = passport({});
    renderAt("/prive/mi", <PassportCard />);
    const card = await screen.findByTestId("prive-passport-card");
    expect(within(card).getByText("Valentina")).toBeTruthy();
    expect(within(card).getByText("IP-7KQM-X4TD")).toBeTruthy();
    expect(within(card).getByText(/1 de julio de 2026/)).toBeTruthy();
    expect(screen.getByText("3 meses")).toBeTruthy();
    expect(screen.queryByTestId("prive-founding")).toBeNull();
    expect(screen.getAllByText(/solo tú lo ves/).length).toBeGreaterThan(0);
    expect(screen.getByText("Primera vez en París")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Platinum|Black|VIP|nivel de gasto/i);
  });
  it("Founding Member solo con la fecha de corte del servidor, y explica el criterio", async () => {
    handlers.prive_passport = passport({ founding_member: true, founding_cutoff: "2026-12-31" });
    renderAt("/prive/mi", <PassportCard />);
    expect(await screen.findByTestId("prive-founding")).toBeTruthy();
    expect(screen.getByText(/en o antes del 31 de diciembre de 2026/)).toBeTruthy();
  });
  it("no envía una nota con número de tarjeta", async () => {
    handlers.prive_passport = passport({});
    const save = vi.fn(() => ({ ok: true }));
    handlers.prive_passport_save = save;
    renderAt("/prive/mi", <PassportCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar al pasaporte" }));
    fireEvent.change(screen.getByLabelText("Destino o lugar"), { target: { value: "Roma" } });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Cena" } });
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), { target: { value: "pagué con 4111 1111 1111 1111" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No escribas números de tarjeta.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("THE INSIDER'S NOTEBOOK + BEFORE YOU GO", () => {
  const tip = { id: "t1", slug: "paris-louvre-cierra-martes", category: "errores", destination: { slug: "paris", es: "París", en: "Paris" },
    title: { es: "El Louvre cierra los martes", en: "The Louvre is closed on Tuesdays" }, body: { es: "Abre lunes…", en: "Open Monday…" }, before_you_go: true, rank: 1,
    source: { url: "https://www.louvre.fr/en/visit/hours-admission", name: "Musée du Louvre · Hours & admission", checked_at: "2026-10-22" } };
  it("Before You Go del próximo viaje real + agregar un consejo a las notas del viaje", async () => {
    handlers.prive_insider_index = () => ({ destinations: [{ slug: "paris", es: "París", en: "Paris", tips: 5, before_you_go: 4, last_checked: "2026-10-22" }], saved: 0, trips: [] });
    handlers.prive_before_you_go = () => ({ trip: { id: "trip1", destino: "París, Francia", fecha_salida: future, days_until: 10 }, destination: { slug: "paris", es: "París", en: "Paris" }, tips: [tip] });
    const add = vi.fn(() => ({ ok: true, added: true }));
    handlers.prive_tip_add_to_trip = add;
    renderAt("/prive/insider", <PriveInsiderPage />, "/prive/insider");
    const byg = await screen.findByTestId("prive-before-you-go");
    expect(within(byg).getByText("París · en 10 días")).toBeTruthy();
    expect(within(byg).getByText("El Louvre cierra los martes")).toBeTruthy();
    fireEvent.click(within(byg).getByRole("button", { name: /Agregar a las notas del viaje/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ _tip: "t1", _trip: "trip1" }));
    expect(await within(byg).findByTestId("prive-tip-added")).toBeTruthy();
    expect(screen.getByTestId("prive-insider-index").textContent).toMatch(/5 consejos/);
  });
  it("sin viaje próximo no se inventa un Before You Go", async () => {
    handlers.prive_insider_index = () => ({ destinations: [], saved: 0, trips: [] });
    handlers.prive_before_you_go = () => ({ trip: null });
    renderAt("/prive/insider", <PriveInsiderPage />, "/prive/insider");
    await screen.findByText(/Aún no hay consejos verificados/);
    expect(screen.queryByTestId("prive-before-you-go")).toBeNull();
  });
  it("cuaderno de un destino agrupado por categoría, con fuente", async () => {
    handlers.prive_insider = () => ({ found: true, destination: { slug: "paris", es: "París", en: "Paris" }, trips: [], tips: [tip] });
    renderAt("/prive/insider/paris", <PriveInsiderPage />, "/prive/insider/:destino");
    expect(await screen.findByRole("heading", { level: 1, name: "París" })).toBeTruthy();
    expect(within(screen.getByTestId("prive-insider-tips")).getByText("Errores frecuentes")).toBeTruthy();
    expect(screen.getByText(/Crea un viaje para guardar consejos/)).toBeTruthy();
  });
  it("las categorías filtran una sola rejilla (no apilan secciones)", async () => {
    const tip2 = { ...tip, id: "t2", slug: "paris-otro", category: "transporte", title: { es: "Otro consejo" }, rank: 2 };
    handlers.prive_insider = () => ({ found: true, destination: { slug: "paris", es: "París", en: "Paris" }, trips: [], tips: [tip, tip2] });
    renderAt("/prive/insider/paris", <PriveInsiderPage />, "/prive/insider/:destino");
    const grid = await screen.findByTestId("prive-insider-tips");
    expect(within(grid).getAllByTestId("prive-tip")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Transporte" }));
    expect(within(screen.getByTestId("prive-insider-tips")).getAllByTestId("prive-tip")).toHaveLength(1);
    expect(screen.getByText("Otro consejo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Transporte" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("en inglés si el idioma de la persona es inglés (marca en inglés, textos traducidos)", async () => {
    Object.defineProperty(navigator, "languages", { value: ["en-GB", "es"], configurable: true });
    handlers.prive_insider = () => ({ found: true, destination: { slug: "paris", es: "París", en: "Paris" }, trips: [], tips: [tip] });
    renderAt("/prive/insider/paris", <PriveInsiderPage />, "/prive/insider/:destino");
    expect(await screen.findByRole("heading", { level: 1, name: "Paris" })).toBeTruthy();
    expect(screen.getByText("The Louvre is closed on Tuesdays")).toBeTruthy();
    expect(screen.getByText("Common mistakes")).toBeTruthy();
    expect(valueLangFrom(["fr-FR", "en-US"])).toBe("en");
    expect(valueLangFrom(["fr-FR"])).toBe("es");
  });
});

describe("Vista previa antes del día 90", () => {
  it("progreso real, explicación y destinos públicos; sin contenido protegido ni urgencia", async () => {
    access.session = null;
    access.status = { is_pro: true, tenure_days: 47, required_days: 90 };
    rpc.mockImplementation(async (fn: string) => fn === "prive_teaser"
      ? { data: { destinations: [{ slug: "paris", name: "París", region_group: "europa" }, { slug: "cdmx", name: "Ciudad de México", region_group: "mexico" }] }, error: null }
      : { data: true, error: null });
    renderAt("/prive", <PrivePreview />);
    expect((await screen.findByTestId("prive-preview-progress")).textContent).toBe("Llevas 47 de 90 días de IATOS PRO pagado.");
    expect(await screen.findByText("Ciudad de México")).toBeTruthy();
    expect(screen.getAllByText("Ejemplo ilustrativo")).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/faltan|últim|solo hoy|apresúrate|invitación exclusiva/i);
    expect(content).not.toHaveBeenCalled();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("prive_preview_track", { _event: "preview_view" }));
  });
  it("sin PRO: invita a conocer PRO, sin anillo de progreso", async () => {
    access.session = null;
    access.status = { is_pro: false, tenure_days: 0, required_days: 90 };
    rpc.mockResolvedValue({ data: null, error: null });
    renderAt("/prive", <PrivePreview />);
    expect(await screen.findByRole("link", { name: "Conocer IATOS PRO" })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
