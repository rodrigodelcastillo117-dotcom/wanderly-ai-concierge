// FOR YOU honesto (Doc A Fase 1 §3 y §5; Doc B §3): viaje correcto, editorial que se dice editorial, gustos solo
// con permiso, y "Your World is Ready" medible y sin bloquear.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { forYouSource, personalization, personalizationLabel, reasonText, tripDestination, type HomeDestination } from "@/lib/priveKeyForYou";
import { resolveActiveTrip } from "@/lib/activeTrip";

const HOME: HomeDestination[] = [
  { slug: "cdmx", name: "Ciudad de México", kind: "locality", count: 25 }, { slug: "mc", name: "Mónaco", kind: "country", count: 17 },
  { slug: "paris", name: "París", kind: "locality", count: 16 }, { slug: "cdmx-polanco", name: "Polanco", kind: "neighborhood", count: 9 },
  { slug: "lisboa", name: "Lisboa", kind: "locality", count: 0 },
];
const T = (id: string, destino: string, a: string, b: string) => ({ id, destino, fecha_salida: a, fecha_regreso: b });
const CDMX = T("11111111-1111-4111-8111-111111111111", "Ciudad de México", "2026-11-20", "2026-11-24");
const PARIS = T("22222222-2222-4222-8222-222222222222", "París", "2026-12-10", "2026-12-14");
const LISBOA = T("33333333-3333-4333-8333-333333333333", "Lisboa", "2026-11-02", "2026-11-06");
const today = "2026-10-22";

describe("de qué viaje y qué destino (lógica)", () => {
  it("un viaje: su destino y sus fechas", () => {
    const s = forYouSource(resolveActiveTrip([CDMX], { todayLocal: today }), HOME);
    expect(s).toMatchObject({ kind: "trip", destination: { slug: "cdmx" }, from: "2026-11-20", to: "2026-11-24" });
  });
  it("un barrio en el destino del viaje cuenta como su ciudad", () => {
    expect(tripDestination({ id: "x", destino: "Polanco, CDMX" }, HOME)).toEqual({ slug: "cdmx", name: "Ciudad de México" });
  });
  it("dos viajes sin fijar: NO elige; pide escoger y mientras muestra editorial", () => {
    const s = forYouSource(resolveActiveTrip([CDMX, PARIS], { todayLocal: today }), HOME);
    expect(s.kind).toBe("ambiguous");
    if (s.kind === "ambiguous") expect(s.candidates.map((c) => c.id)).toEqual([CDMX.id, PARIS.id]);
  });
  it("con el viaje fijado (el mismo que usa Iato), ese", () => {
    const s = forYouSource(resolveActiveTrip([CDMX, PARIS], { todayLocal: today, pinnedId: PARIS.id }), HOME);
    expect(s).toMatchObject({ kind: "trip", destination: { slug: "paris" } });
  });
  it("viaje a un destino sin selección verificada: lo dice y no lo sustituye por otro viaje", () => {
    const s = forYouSource(resolveActiveTrip([LISBOA], { todayLocal: today }), HOME);
    expect(s).toMatchObject({ kind: "trip_no_coverage", place: "Lisboa", fallback: { slug: "cdmx" } });
  });
  it("sin viajes: selección editorial del destino con más contenido verificado", () => {
    expect(forYouSource(resolveActiveTrip([], { todayLocal: today }), HOME)).toEqual({ kind: "editorial", destination: { slug: "cdmx", name: "Ciudad de México" } });
  });
});

describe("etiqueta honesta", () => {
  const editorial = forYouSource(resolveActiveTrip([], { todayLocal: today }), HOME);
  it("sin viaje ni permiso de gustos: 'aún no personalizada'", () => {
    const k = personalization(editorial, [{ reasons: ["calidad:verificado"] }]);
    expect(k).toBe("editorial");
    expect(personalizationLabel(k, editorial, "es")).toBe("Selección editorial verificada · aún no personalizada");
  });
  it("'por tus gustos' SOLO si el servidor dio razones de Travel DNA (que exigen permiso)", () => {
    expect(personalization(editorial, [{ reasons: ["dna:the_table"] }])).toBe("taste");
    expect(personalizationLabel("taste", editorial, "en")).toBe("Ordered by your tastes, with your consent");
  });
  it("las razones son solo las del servidor", () => {
    expect(reasonText(["viaje:destino_del_viaje", "dna:after_dark", "premio:2026", "algo_raro"], "es"))
      .toEqual(["En el destino de tu viaje", "Encaja con tus gustos (con tu permiso)", "Reconocimiento 2026 con fuente"]);
  });
});

// ───────────── Componentes ─────────────
const content = vi.fn();
const access: any = { session: { token: "ps" }, content, unlocked: true, view: "unlocked", loading: false, patchStatus: vi.fn(),
  status: { membership_status: "active", activated_at: new Date(Date.now() - 2 * 86400000).toISOString(), welcome_version_seen: 99, first_name: "Ana", onboarding: {} } };
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => access }));
let trips: any[] = [];
let pinned: string | null = null;
vi.mock("@/hooks/useActiveTrip", async () => {
  const { resolveActiveTrip: r } = await vi.importActual<typeof import("@/lib/activeTrip")>("@/lib/activeTrip");
  return { useActiveTrip: () => { const resolved = r(trips, { todayLocal: "2026-10-22", pinnedId: pinned }); return { trips, resolved, trip: resolved.trip, loading: false }; } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn() } }));

import { CuratedForYou, YourNextJourney, YourWorldIsReady, shouldShowWorldReady } from "@/components/prive/key";
import { __resetForYouCache } from "@/components/prive/key/useForYouData";

const exp = (id: string, reasons: string[] = []) => ({ id, slug: `cdmx-${id}`, name: `Lugar ${id}`, universe: "the_table", subcategory: "cocina", state: "CURADO",
  destination: { slug: "cdmx", name: "Ciudad de México" }, why: `Hecho con fuente ${id}.`, reasons, image: { query: "q", illustrative: true } });

beforeEach(() => {
  Object.defineProperty(window.navigator, "languages", { value: ["es-MX"], configurable: true });
  __resetForYouCache(); content.mockReset(); invoke.mockReset(); trips = []; pinned = null;
  try { localStorage.clear(); } catch { /* */ }
  invoke.mockResolvedValue({ data: null, error: { message: "sin red" } });
  content.mockImplementation(async (fn: string, args: any) => {
    if (fn === "prive_home") return { ok: true, data: { destinations: HOME, total: 58 } };
    if (fn === "prive_for_you") return { ok: true, data: args._destination === "cdmx" ? [exp("a", args._from ? ["viaje:destino_del_viaje"] : []), exp("b"), exp("c")] : [] };
    return { ok: true, data: true };
  });
});
const wrap = (el: React.ReactNode) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("<CuratedForYou />", () => {
  it("sin viaje: editorial y lo dice", async () => {
    wrap(<CuratedForYou />);
    expect(await screen.findByTestId("pk-personalization")).toHaveTextContent("Selección editorial verificada · aún no personalizada");
    expect(await screen.findAllByTestId("pk-tile")).toHaveLength(3);
    expect(content).toHaveBeenCalledWith("prive_for_you", expect.objectContaining({ _destination: "cdmx", _from: null }));
  });
  it("con viaje: pide el destino Y las fechas del viaje y lo dice", async () => {
    trips = [CDMX];
    wrap(<CuratedForYou />);
    expect(await screen.findByTestId("pk-personalization")).toHaveTextContent(/Priorizado para tu viaje: Ciudad de México/);
    expect(content).toHaveBeenCalledWith("prive_for_you", expect.objectContaining({ _destination: "cdmx", _from: "2026-11-20", _to: "2026-11-24" }));
    expect((await screen.findAllByText("En el destino de tu viaje")).length).toBe(1);
  });
  it("dos viajes: pregunta cuál; al elegir, usa ese", async () => {
    trips = [CDMX, PARIS];
    wrap(<CuratedForYou />);
    const group = await screen.findByRole("group", { name: "¿Para qué viaje?" });
    fireEvent.click(within(group).getByRole("button", { name: /París/ }));
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_for_you", expect.objectContaining({ _destination: "paris", _from: "2026-12-10" })));
  });
});

describe("<YourNextJourney />", () => {
  it("con viaje: 'Tu próximo capítulo' con sus acciones", async () => {
    trips = [CDMX];
    wrap(<YourNextJourney />);
    expect(await screen.findByText("Tu próximo capítulo: Ciudad de México.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organizar una noche" }).getAttribute("href")).toMatch(/^\/prive\/key\?w=/);
    expect(screen.getByRole("link", { name: "Ver mi itinerario" }).getAttribute("href")).toBe(`/dashboard/viajes/${CDMX.id}`);
  });
  it("con empate: no adivina", async () => {
    trips = [CDMX, PARIS];
    wrap(<YourNextJourney />);
    expect(await screen.findByText("¿Cuál es tu próximo viaje?")).toBeInTheDocument();
    expect(screen.queryByText(/Tu próximo capítulo/)).toBeNull();
  });
  it("sin viaje: ofrece planear uno", async () => {
    wrap(<YourNextJourney />);
    expect(await screen.findByRole("link", { name: "Planear un viaje" })).toBeInTheDocument();
  });
});

describe("<YourWorldIsReady />", () => {
  it("solo para miembros recién activados, tras la ceremonia", () => {
    const s = { membership_status: "active", activated_at: "2026-10-20T00:00:00Z", welcome_version_seen: 99 };
    const now = Date.parse("2026-10-22T00:00:00Z");
    expect(shouldShowWorldReady(s, false, now)).toBe(true);
    expect(shouldShowWorldReady({ ...s, welcome_version_seen: 0 }, false, now)).toBe(false); // ceremonia pendiente
    expect(shouldShowWorldReady({ ...s, activated_at: "2026-08-01T00:00:00Z" }, false, now)).toBe(false);
    expect(shouldShowWorldReady(s, true, now)).toBe(false);
  });
  it("no bloquea esperando el plan; mide el tiempo hasta abrir una experiencia y ofrece gustos rápidos sin datos", async () => {
    let release: (v: unknown) => void = () => {};
    invoke.mockImplementation((name: string) => name === "concierge-chat" ? new Promise((r) => { release = r; }) : Promise.resolve({ data: null, error: { message: "x" } }));
    wrap(<YourWorldIsReady />);
    const tiles = await screen.findAllByTestId("pk-tile"); // las experiencias llegan antes que el plan
    expect(tiles).toHaveLength(3);
    expect(screen.getByText("Iato está revisando el catálogo verificado…")).toBeInTheDocument();
    fireEvent.click(within(tiles[0]).getByRole("link", { name: "Ver" }));
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_key_track", { _event: "world_ready_open", _props: { ms: expect.any(Number) } }));
    expect(screen.getByTestId("pk-taste-open")).toBeInTheDocument();
    release({ data: { ok: false, code: "PRIVE_ERROR" }, error: null });
    expect(await screen.findByRole("link", { name: "Abrir con The Key" })).toBeInTheDocument(); // respaldo si el plan no llega
  });
  it("gustos rápidos: con permiso explícito", async () => {
    wrap(<YourWorldIsReady />);
    fireEvent.click(await screen.findByTestId("pk-taste-open"));
    fireEvent.click(screen.getByRole("button", { name: "Alta cocina" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_key_taste_save", { _taste: { loves: ["alta_cocina"], budget: null }, _consent: true }));
  });
});
