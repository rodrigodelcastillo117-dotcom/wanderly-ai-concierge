// Auditoría de IATOS Privé en producción (28-oct-2026), todo menos Members Only. Cada prueba nombra el
// defecto (P1-x / P2) y falla con el código anterior a esta rama.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { activeStatus, baseStatus, motionState, priveMock } from "./helpers/priveTestKit";

vi.mock("@/lib/memberCard", async (orig) => ({ ...(await orig<any>()), useMemberCard: () => ({ card: null, loading: false }) }));
vi.mock("framer-motion", async () => (await import("./helpers/priveTestKit")).framerMotionMock);
vi.mock("@/lib/priveApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priveApi")>();
  const { priveMock: m } = await import("./helpers/priveTestKit");
  return { ...actual, priveApi: m.api };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "v@example.com" }, signOut: vi.fn() }) }));
vi.mock("@/hooks/useActiveTrip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useActiveTrip")>();
  const { resolveActiveTrip } = await import("@/lib/activeTrip");
  const resolved = resolveActiveTrip([], { pinnedId: null, todayLocal: "2026-10-28" });
  const result = { trips: [], trip: resolved.trip, resolved, loading: false, pinnedId: null, pin: async () => ({ ok: true }) };
  return { ...actual, useActiveTrip: () => result };
});
vi.mock("@/lib/stockPhoto", () => ({ loadStockPhoto: async () => ({ photo: null, transient: false }), cachedStockPhoto: () => undefined }));

import PriveRoot from "@/pages/prive/PriveRoot";
import PriveHub from "@/pages/prive/PriveHub";
import PriveInvitation from "@/pages/prive/PriveInvitation";
import PriveReset from "@/pages/prive/PriveReset";
import PriveMyPage from "@/pages/prive/PriveMyPage";
import PriveRequestsPage from "@/pages/prive/PriveRequestsPage";
import { normalizeStatus } from "@/lib/priveApi";
import { lockedCopy } from "@/components/prive/catalog/PriveLocked";
import { priveText } from "@/lib/priveI18n";
import { datedEventsFirst, eventDateText } from "@/lib/priveCatalogView";
import { ProgressRing } from "@/components/prive/ProgressRing";
import { CARD_TEXT } from "@/lib/memberCard";
import { editionText } from "@/lib/priveEditionI18n";

const { state, api } = priveMock;
const es = priveText("es");

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/prive" element={<PriveRoot />}>
          <Route index element={<PriveHub />} />
          <Route path="invitacion" element={<PriveInvitation />} />
          <Route path="restablecer" element={<PriveReset />} />
          <Route path="mi" element={<PriveMyPage />} />
          <Route path="solicitudes" element={<PriveRequestsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  motionState.reduce = true;
  state.statusOk = true;
  state.handler = () => ({ ok: true, data: {} });
  api.access.mockClear();
  api.universeCounts.mockReset();
  api.universeCounts.mockResolvedValue(null);
});

describe("P1-1 · PRO de cortesía: no se presenta un camino de 90 días que no avanza", () => {
  it("prive_status.pro_basis se lee (y sin PRO nunca hay base)", () => {
    expect(normalizeStatus({ is_pro: true, pro_basis: "comped" }).pro_basis).toBe("comped");
    expect(normalizeStatus({ is_pro: true, pro_basis: "trial" }).pro_basis).toBe("trial");
    expect(normalizeStatus({ is_pro: true, pro_basis: "paid" }).pro_basis).toBe("paid");
    expect(normalizeStatus({ is_pro: false, pro_basis: "comped" }).pro_basis).toBeNull();
    expect(normalizeStatus({ is_pro: true, pro_basis: "otra" }).pro_basis).toBeNull();
    expect(normalizeStatus({ is_pro: true }).pro_basis).toBeNull();
  });

  it("hub: dice que la cortesía no suma, sin anillo 0/90 ni promesa de invitación al llegar a 90", async () => {
    state.status = baseStatus({ pro_basis: "comped", tenure_days: 0 });
    renderAt("/prive");
    expect(await screen.findByTestId("prive-comped-line")).toHaveTextContent("Tu PRO de cortesía no suma días para Privé");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Llevas 0 de 90/)).toBeNull();
    expect(screen.queryByText(/Cuando llegues a 90/)).toBeNull();
    expect(screen.getByRole("link", { name: "Ver mi plan" })).toHaveAttribute("href", "/dashboard/pro");
    expect(screen.getByRole("link", { name: "Escribir a IATOS" }).getAttribute("href")).toMatch(/^mailto:/);
  });

  it("hub con prueba gratuita: el anillo sigue y avisa que la prueba no suma", async () => {
    state.status = baseStatus({ pro_basis: "trial", tenure_days: 0 });
    renderAt("/prive");
    expect(await screen.findByTestId("prive-trial-note")).toHaveTextContent(/prueba gratuita no suma días/);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("PRO pagado < 90: el progreso de siempre", async () => {
    state.status = baseStatus({ pro_basis: "paid", tenure_days: 47 });
    renderAt("/prive");
    expect(await screen.findByText("Llevas 47 de 90 días de PRO pagado")).toBeInTheDocument();
    expect(screen.queryByTestId("prive-comped-line")).toBeNull();
  });

  it("invitación ('Aún no es momento') con cortesía: no repite los 90 días", async () => {
    state.status = baseStatus({ pro_basis: "comped" });
    renderAt("/prive/invitacion");
    expect(await screen.findByRole("heading", { name: "Aún no es momento" })).toBeInTheDocument();
    expect(screen.getByTestId("prive-invitation-comped")).toHaveTextContent("Tu PRO de cortesía no suma días para Privé");
    expect(screen.queryByText(/Se abre al sumar 90 días/)).toBeNull();
    expect(screen.queryByText(/Llevas 0 de 90/)).toBeNull();
  });
});

describe("P1-2 · Restablecer sin contraseña Privé: sin callejón", () => {
  it("sin contraseña no ofrece el formulario ni 'Reportar contraseña comprometida' y lleva a /prive", async () => {
    state.status = baseStatus({ pro_basis: "comped" });
    renderAt("/prive/restablecer");
    expect(await screen.findByTestId("prive-reset-no-password")).toHaveTextContent("Aún no tienes contraseña Privé");
    expect(screen.queryByRole("button", { name: "Enviarme el enlace" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reportar contraseña comprometida/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver mi estado en Privé" })).toHaveAttribute("href", "/prive");
    expect(api.access).not.toHaveBeenCalledWith("request_reset", expect.anything());
  });

  it("con la invitación lista lleva a abrirla", async () => {
    state.status = baseStatus({ eligible: true, membership_status: "invited", invitation_pending: true });
    renderAt("/prive/restablecer");
    expect(await screen.findByRole("link", { name: "Abrir mi invitación" })).toHaveAttribute("href", "/prive/invitacion");
  });

  it("si el servidor responde NO_PASSWORD, muestra la misma salida útil (no el error suelto)", async () => {
    state.status = activeStatus();
    state.handler = (a) => (a === "request_reset" ? { ok: false, code: "NO_PASSWORD" } : { ok: true, data: {} });
    renderAt("/prive/restablecer");
    fireEvent.click(await screen.findByRole("button", { name: "Enviarme el enlace" }));
    expect(await screen.findByTestId("prive-reset-no-password")).toBeInTheDocument();
    expect(screen.queryByText("Aún no tienes una contraseña Privé. Créala desde tu invitación.")).toBeNull();
  });
});

describe("P1-9 · Iconic Events: no promete 'con fecha' si el evento no la tiene", () => {
  it("el universo ya no dice 'Eventos con fecha y fuente'", () => {
    expect(es.universes.iconic_events.line).not.toMatch(/con fecha/);
    expect(es.edits.once.line).not.toMatch(/con fecha/);
    expect(priveText("en").universes.iconic_events.line).not.toMatch(/with a date/);
  });
  it("cada evento dice su fecha o que está por confirmar; los fechados van primero", () => {
    expect(eventDateText({ universe: "iconic_events", event_start: "2027-06-04", event_end: "2027-06-06" } as any)).toMatch(/^Fecha: 4 jun 2027 al 6 jun 2027$/);
    expect(eventDateText({ universe: "iconic_events" } as any)).toMatch(/por confirmar/);
    expect(eventDateText({ universe: "the_table" } as any)).toBeNull();
    const out = datedEventsFirst([{ id: "a" }, { id: "b", event_start: "2027-03-01" }, { id: "c" }, { id: "d", event_start: "2026-12-01" }] as any[]);
    expect(out.map((e: any) => e.id)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("P2 · cifras con numerales alineados (el 0 se leía 'o')", () => {
  it("el número del anillo usa .prive-nums y la clase pide lining-nums", () => {
    render(<ProgressRing value={0} total={90} />);
    expect(screen.getByTestId("prive-ring-value")).toHaveClass("prive-nums");
    const css = readFileSync("src/components/prive/prive.css", "utf8");
    expect(css).toMatch(/\.prive-nums\s*\{[^}]*lining-nums/);
  });
});

describe("P2 · inglés mezclado: 'My Privé' → 'Mi Privé'", () => {
  it("el título de /prive/mi en español", () => {
    expect(es.my.brand).toBe("Mi Privé");
  });
  it("sin membresía, /prive/mi no pone 'Preferencias y seguridad' encima del aviso", async () => {
    state.status = baseStatus({ pro_basis: "comped" });
    renderAt("/prive/mi");
    expect(await screen.findByText("Aún no tienes una membresía Privé activa")).toBeInTheDocument();
    expect(screen.queryByText("Preferencias y seguridad")).toBeNull();
    expect(screen.getAllByText("Mi Privé").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Privé")).toBeNull();
  });
});

describe("P2 · candado de las áreas: explica por qué y lleva a un lugar útil", () => {
  it("según el estado real de la cuenta, nunca 'Desbloquea IATOS Privé…' a quien no puede desbloquear", () => {
    const comped = lockedCopy(es, "progress", baseStatus({ pro_basis: "comped" }));
    expect(comped.text).toMatch(/cortesía no suma días/);
    expect(comped.cta.to).toBe("/prive");
    const paid = lockedCopy(es, "progress", baseStatus({ pro_basis: "paid", tenure_days: 12 }));
    expect(paid.text).toMatch(/Llevas 12 de 90/);
    expect(lockedCopy(es, "teaser", baseStatus({ is_pro: false })).cta.to).toBe("/dashboard/pro");
    expect(lockedCopy(es, "invitation", baseStatus()).cta.to).toBe("/prive/invitacion");
    expect(lockedCopy(es, "locked", activeStatus()).text).toMatch(/contraseña Privé/);
    expect(es.catalog.lockedDefault).not.toMatch(/^Desbloquea/);
  });
  it("con candado, el botón de regresar no sube a otra área bloqueada", () => {
    const src = readFileSync("src/components/prive/catalog/PriveCatalogShell.tsx", "utf8");
    expect(src).toMatch(/usePriveBack\(locked \? null : back/);
  });
});

describe("P2 · solicitudes vacías: mensaje útil para quien no es miembro", () => {
  it("no remite a fichas que la cuenta no puede abrir", async () => {
    state.status = baseStatus({ pro_basis: "comped" });
    const { supabase } = await import("@/integrations/supabase/client");
    const spy = vi.spyOn(supabase, "rpc").mockResolvedValue({ data: [], error: null } as any);
    renderAt("/prive/solicitudes");
    const box = await screen.findByTestId("prive-requests-empty");
    expect(box).toHaveTextContent(/se abren con tu membresía/);
    expect(box).not.toHaveTextContent(/Desde una ficha/);
    expect(screen.getByRole("link", { name: "Ver mi estado en Privé" })).toHaveAttribute("href", "/prive");
    spy.mockRestore();
  });
});

describe("P2 · adelanto sin PRO: las colecciones muestran el conteo real (no 'En curaduría')", () => {
  it("con el conteo público de prive_teaser", async () => {
    api.universeCounts.mockResolvedValue({ the_table: 143, iconic_events: 42 });
    state.status = baseStatus({ is_pro: false });
    renderAt("/prive");
    expect(await screen.findByText("143 experiencias")).toBeInTheDocument();
    expect(screen.getByText("42 experiencias")).toBeInTheDocument();
    await waitFor(() => expect(api.universeCounts).toHaveBeenCalledTimes(1));
    expect(api.content).not.toHaveBeenCalled();
  });
});

describe("P2 · tarjeta de membresía y lectura sin conexión", () => {
  it("la tarjeta explica que la antigüedad no son los días de PRO pagado de Privé", () => {
    expect(CARD_TEXT.es.tenureNote).toMatch(/creaste tu cuenta/);
    expect(CARD_TEXT.es.priveRule).toMatch(/90 días de IATOS PRO pagado/);
  });
  it("la lectura sin conexión vacía dice qué hacer", () => {
    expect(editionText("es").offline.howTo).toMatch(/Guardar para leer sin internet/i);
    const src = readFileSync("src/pages/prive/edition/EditionOfflinePage.tsx", "utf8");
    expect(src).toMatch(/usePriveFont\(\)/);
  });
});
