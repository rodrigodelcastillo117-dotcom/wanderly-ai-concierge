import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { activeStatus, baseStatus, motionState, priveMock, SESSION_TOKEN, futureIso } from "./helpers/priveTestKit";

// La tarjeta de rango se pide al servidor (my_member_card); aquí sin red: la de Privé de siempre.
vi.mock("@/lib/memberCard", async (orig) => ({ ...(await orig<any>()), useMemberCard: () => ({ card: null, loading: false }) }));
vi.mock("framer-motion", async () => (await import("./helpers/priveTestKit")).framerMotionMock);
vi.mock("@/lib/priveApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priveApi")>();
  const { priveMock: m } = await import("./helpers/priveTestKit");
  return { ...actual, priveApi: m.api };
});
const loadStockPhoto = vi.fn(async (q: string) => ({ photo: { image: `https://images.pexels.com/${encodeURIComponent(q)}.jpg`, photographer: "Ana", page_url: null }, transient: false }));
vi.mock("@/lib/stockPhoto", () => ({ loadStockPhoto: (q: string) => loadStockPhoto(q), cachedStockPhoto: () => undefined }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "v@example.com" }, signOut: vi.fn() }) }));
// Prueba hermética: el hub lee el viaje activo (useActiveTrip → /rest/v1/trips y /rest/v1/profiles). Sin
// este mock cada corrida mandaba ~30 GET reales al VITE_SUPABASE_URL del .env (producción). Sin viajes.
vi.mock("@/hooks/useActiveTrip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useActiveTrip")>();
  const { resolveActiveTrip } = await import("@/lib/activeTrip");
  const resolved = resolveActiveTrip([], { pinnedId: null, todayLocal: "2026-10-22" });
  const result = { trips: [], trip: resolved.trip, resolved, loading: false, pinnedId: null, pin: async () => ({ ok: true }) };
  return { ...actual, useActiveTrip: () => result };
});

import PriveRoot from "@/pages/prive/PriveRoot";
import PriveHub from "@/pages/prive/PriveHub";
import PriveMembership from "@/pages/prive/PriveMembership";
import { PriveCatalogSlot, type PriveHubSection } from "@/components/prive/PriveCatalogSlot";
import { PRIVE_SESSION_KEY } from "@/lib/priveSession";
import type { PriveStatus } from "@/lib/priveApi";

const { state, api } = priveMock;

function ReplayButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/prive", { state: { replayWelcome: true } })}>replay-test</button>;
}

const renderAt = (path = "/prive", extra?: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/prive" element={<PriveRoot />}>
          <Route index element={<>{extra}<PriveHub /></>} />
          <Route path="membresia" element={<PriveMembership />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

// Sesión normal en este navegador abierto: el token en localStorage + la cookie de sesión del navegador.
const withSession = () => {
  document.cookie = "iatos_prive_bs=1; Path=/";
  localStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: SESSION_TOKEN, expiresAt: futureIso(), userId: "u1" }));
};

const setStatus = (s: PriveStatus) => { state.status = s; };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  motionState.reduce = false;
  state.statusOk = true;
  state.handler = () => ({ ok: true, data: {} });
  api.status.mockClear();
  api.access.mockClear();
  api.content.mockClear();
  api.illustrativePhoto.mockClear();
  loadStockPhoto.mockClear();
});

describe("/prive: una pantalla por estado del servidor", () => {
  it("FREE → adelanto elegante con PRO, sin contenido reservado", async () => {
    setStatus(baseStatus({ is_pro: false }));
    renderAt();
    expect(await screen.findByText(/Hay lugares que se visitan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conocer IATOS PRO" })).toHaveAttribute("href", "/dashboard/pro");
    expect(screen.getAllByText("En curaduría").length).toBe(12);
    expect(api.content).not.toHaveBeenCalled();
  });

  it("PRO < 90 → progreso honesto, sin cuenta regresiva ni escasez", async () => {
    setStatus(baseStatus({ tenure_days: 47 }));
    const { container } = renderAt();
    expect(await screen.findByText("Llevas 47 de 90 días de PRO pagado")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "47");
    expect(screen.getByText(/No cuentan los días de prueba gratuita/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/faltan|solo quedan|últimos|apúrate|cupo|lugares limitados/i);
  });

  it.each([
    ["preparando", baseStatus({ tenure_days: 92, eligible: true }), /se está preparando/],
    ["invitación lista", baseStatus({ tenure_days: 92, eligible: true, membership_status: "invited", invitation_pending: true }), /Tu invitación está lista/],
    ["falta contraseña", activeStatus({ has_password: false, password_status: null }), /Falta un paso/],
    ["pausada (PRO terminó)", activeStatus({ is_pro: false, eligible: false }), /Está pausada porque tu PRO terminó/],
    ["pausada (antigüedad)", activeStatus({ eligible: false, tenure_days: 61 }), /hoy suman 61 de 90/],
    ["revocada", activeStatus({ membership_status: "revoked" }), /no está activa/],
    ["debe restablecer", activeStatus({ password_status: "must_reset" }), /Crea una contraseña Privé nueva/],
  ])("%s", async (_n, s, text) => {
    setStatus(s);
    renderAt();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("invitación lista lleva a /prive/invitacion", async () => {
    setStatus(baseStatus({ eligible: true, membership_status: "invited" }));
    renderAt();
    expect(await screen.findByRole("link", { name: "Abrir mi invitación" })).toHaveAttribute("href", "/prive/invitacion");
  });

  it("si no se puede leer el estado: error honesto y Reintentar (nunca un muro de pago)", async () => {
    state.statusOk = false;
    renderAt();
    expect(await screen.findByText("No pudimos cargar Privé")).toBeInTheDocument();
    expect(screen.queryByText(/Conocer IATOS PRO/)).toBeNull();
    state.statusOk = true;
    setStatus(baseStatus({ is_pro: false }));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText(/Hay lugares que se visitan/)).toBeInTheDocument();
  });
});

describe("candado y sesión Privé", () => {
  it("activada sin sesión → contraseña; al desbloquear guarda la sesión del usuario y abre el hub", async () => {
    setStatus(activeStatus());
    state.handler = (action) => (action === "unlock" ? { ok: true, data: { ok: true, prive_session: SESSION_TOKEN, expires_at: futureIso() } } : { ok: true, data: {} });
    renderAt();
    const input = await screen.findByLabelText("Contraseña Privé");
    expect(api.content).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "faro lento sobre bahía 1987" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText(/más allá de lo ordinario/i)).toBeInTheDocument();
    expect(api.access).toHaveBeenCalledWith("unlock", { password: "faro lento sobre bahía 1987", remember: true });
    const stored = JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!);
    expect(stored).toMatchObject({ token: SESSION_TOKEN, userId: "u1" });
    // El servidor no confirmó remember: queda como sesión normal (con la cookie de sesión del navegador).
    expect(stored.remember).toBeUndefined();
    expect(Object.keys({ ...localStorage }).filter((k) => k !== PRIVE_SESSION_KEY)).toEqual([]);
    expect(screen.getByTestId("prive-curating")).toHaveTextContent("Contenido en curaduría");
  });

  it("sesión recordada siempre (sin casilla); solo se guarda como recordada si el servidor lo aceptó", async () => {
    setStatus(activeStatus());
    state.handler = (action) => (action === "unlock"
      ? { ok: true, data: { ok: true, prive_session: SESSION_TOKEN, expires_at: new Date(Date.now() + 365 * 86400e3).toISOString(), remember: true } }
      : { ok: true, data: {} });
    renderAt();
    const input = await screen.findByLabelText("Contraseña Privé");
    expect(screen.queryByTestId("prive-remember")).toBeNull();
    fireEvent.change(input, { target: { value: "faro lento sobre bahía 1987" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("The World, Beyond Ordinary.")).toBeInTheDocument();
    expect(api.access).toHaveBeenCalledWith("unlock", { password: "faro lento sobre bahía 1987", remember: true });
    expect(JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!)).toMatchObject({ token: SESSION_TOKEN, remember: true });
  });

  it("sesión recordada: cada uso con el servidor corre su vencimiento local a 365 días; la normal no cambia", async () => {
    setStatus(activeStatus());
    const soon = new Date(Date.now() + 10 * 86400e3).toISOString();
    localStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: SESSION_TOKEN, expiresAt: soon, userId: "u1", remember: true }));
    const view = renderAt();
    await waitFor(() => expect(api.content).toHaveBeenCalled());
    await waitFor(() => expect(Date.parse(JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!).expiresAt)).toBeGreaterThan(Date.now() + 364 * 86400e3));
    expect(JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!)).toMatchObject({ token: SESSION_TOKEN, remember: true });
    view.unmount();
    localStorage.clear();
    api.content.mockClear();
    withSession();
    const before = JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!).expiresAt;
    renderAt();
    await waitFor(() => expect(api.content).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!).expiresAt).toBe(before);
  });

  it("contraseña incorrecta y bloqueo temporal: mensajes calmados", async () => {
    setStatus(activeStatus());
    let n = 0;
    state.handler = () => (++n === 1 ? { ok: false, code: "WRONG_PASSWORD" } : { ok: false, code: "LOCKED", lockedUntil: new Date(Date.now() + 5 * 60e3).toISOString() });
    renderAt();
    const input = await screen.findByLabelText("Contraseña Privé");
    fireEvent.change(input, { target: { value: "otra cosa" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña Privé incorrecta");
    fireEvent.change(input, { target: { value: "otra cosa" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Podrás intentarlo de nuevo a las/));
    expect(localStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña Privé?" })).toHaveAttribute("href", "/prive/restablecer");
  });

  it("un error PRIVE_* en cualquier llamada borra la sesión y regresa al candado", async () => {
    setStatus(activeStatus({ welcome_version_seen: 0 }));
    withSession();
    state.handler = (action) => (action === "save_progress" ? { ok: false, code: "PRIVE_SESSION_EXPIRED" } : { ok: true, data: {} });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Saltar" }));
    expect(await screen.findByText("Tu sesión Privé venció. Vuelve a ingresar tu contraseña.")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña Privé")).toBeInTheDocument();
    expect(localStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
  });

  it("PRIVE_* desde la membresía también regresa a /prive con candado", async () => {
    setStatus(activeStatus());
    withSession();
    state.handler = (action) => (action === "revoke_sessions" ? { ok: false, code: "PRIVE_NOT_PRO" } : { ok: true, data: {} });
    renderAt("/prive/membresia");
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar todas mis sesiones Privé" }));
    // Termina en /prive (sin el encabezado de la membresía) con el candado.
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Tu membresía" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Tu acceso personal" })).toBeInTheDocument();
    });
    expect(screen.getByText("Tu acceso a Privé está en pausa porque tu plan PRO no está activo.")).toBeInTheDocument();
    expect(localStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
  });

  it("no se pide contenido Privé sin sesión; con sesión sí, con su token", async () => {
    const section: PriveHubSection = { id: "s", title: "Para ti", rpc: "prive_for_you", render: () => <p>contenido</p> };
    setStatus(activeStatus());
    const ui = (
      <MemoryRouter initialEntries={["/prive"]}>
        <Routes>
          <Route path="/prive" element={<PriveRoot />}>
            <Route index element={<PriveCatalogSlot sections={[section]} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const first = render(ui);
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.content).not.toHaveBeenCalled();
    first.unmount();
    withSession();
    render(ui);
    expect(await screen.findByText("contenido")).toBeInTheDocument();
    expect(api.content).toHaveBeenCalledWith("prive_for_you", SESSION_TOKEN, {});
  });
});

describe("Grand Welcome", () => {
  it("se reproduce sola la primera vez; Saltar guarda la versión en el servidor", async () => {
    setStatus(activeStatus({ welcome_version_seen: 0 }));
    withSession();
    renderAt();
    const dlg = await screen.findByRole("dialog", { name: "Bienvenida a IATOS Privé" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Saltar" }));
    await waitFor(() => expect(api.access).toHaveBeenCalledWith("save_progress", { welcome_version: 1, prive_session: SESSION_TOKEN }));
    expect(screen.queryByRole("dialog", { name: "Bienvenida a IATOS Privé" })).toBeNull();
    expect(Object.keys({ ...localStorage }).filter((k) => k !== PRIVE_SESSION_KEY)).toEqual([]);
  });

  it("si el servidor dice que ya la vio, no se reproduce; se puede repetir desde la membresía", async () => {
    setStatus(activeStatus({ welcome_version_seen: 1 }));
    withSession();
    renderAt("/prive", <ReplayButton />);
    await screen.findByText(/más allá de lo ordinario/i);
    expect(screen.queryByRole("dialog", { name: "Bienvenida a IATOS Privé" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "replay-test" }));
    expect(await screen.findByRole("dialog", { name: "Bienvenida a IATOS Privé" })).toBeInTheDocument();
    // Repetirla no vuelve a escribir la versión.
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Bienvenida a IATOS Privé" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bienvenida a IATOS Privé" })).toBeNull());
    expect(api.access).not.toHaveBeenCalledWith("save_progress", expect.objectContaining({ welcome_version: 1 }));
  });

  it("la membresía ofrece repetir la bienvenida", async () => {
    setStatus(activeStatus());
    withSession();
    renderAt("/prive/membresia");
    fireEvent.click(await screen.findByRole("button", { name: "Ver la bienvenida otra vez" }));
    expect(await screen.findByRole("dialog", { name: "Bienvenida a IATOS Privé" })).toBeInTheDocument();
  });

  it("con movimiento completo empieza en negro y avanza por escenas; las fotos se piden después", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setStatus(activeStatus({ welcome_version_seen: 0 }));
      withSession();
      renderAt();
      const dlg = await screen.findByRole("dialog", { name: "Bienvenida a IATOS Privé" });
      expect(dlg).toHaveAttribute("data-motion", "full");
      expect(within(dlg).queryByText("TE DAMOS LA BIENVENIDA A PRIVÉ")).toBeNull();
      expect(loadStockPhoto).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(800); });
      // El temporizador de la primera escena se programa en un efecto que puede correr después de
      // findByRole (antes fallaba de vez en cuando): se espera la escena en lugar de leerla de inmediato.
      await waitFor(() => expect(within(dlg).getByText("TE DAMOS LA BIENVENIDA A PRIVÉ")).toBeInTheDocument());
      await act(async () => { vi.advanceTimersByTime(2400); });
      expect(within(dlg).getByText("TU MUNDO ACABA DE CRECER.")).toBeInTheDocument();
      // Las seis fotos se piden por la fila compartida (stockPhoto), una consulta por ciudad.
      await waitFor(() => expect(loadStockPhoto).toHaveBeenCalledTimes(6));
      // Cada escena programa la siguiente al renderizar: se avanza por tramos.
      for (let i = 0; i < 4; i++) await act(async () => { vi.advanceTimersByTime(2500); });
      expect(within(dlg).getByRole("button", { name: "Continuar" })).toBeInTheDocument();
      expect(within(dlg).getByText(/Fotos ilustrativas de Pexels/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("con movimiento reducido todo aparece de una vez, sin escenas ni temporizadores", async () => {
    motionState.reduce = true;
    setStatus(activeStatus({ welcome_version_seen: 0 }));
    withSession();
    renderAt();
    const dlg = await screen.findByRole("dialog", { name: "Bienvenida a IATOS Privé" });
    expect(dlg).toHaveAttribute("data-motion", "reduced");
    expect(within(dlg).getByText("TE DAMOS LA BIENVENIDA A PRIVÉ")).toBeInTheDocument();
    expect(within(dlg).getByText("TU MUNDO ACABA DE CRECER.")).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Continuar" })).toBeInTheDocument();
    expect(within(dlg).getAllByRole("listitem").length).toBe(6);
  });
});

describe("guía de inicio", () => {
  const onb = () => screen.findByRole("dialog", { name: /Tu mundo|Elegido para ti|Las 12 colecciones|Tu planeador|Reservas y Concierge|Tu membresía|TE DAMOS LA BIENVENIDA A TU MUNDO/ });
  const lastOnboardingSave = () => {
    const calls = api.access.mock.calls.filter(([a, b]) => a === "save_progress" && (b as { onboarding?: unknown }).onboarding);
    return (calls.at(-1)?.[1] as { onboarding?: Record<string, unknown> } | undefined)?.onboarding;
  };

  it("reanuda en el paso guardado; Siguiente/Atrás guardan el avance en el servidor", async () => {
    setStatus(activeStatus({ onboarding: { version: 1, step: 2 } }));
    withSession();
    renderAt();
    await onb();
    expect(screen.getByTestId("prive-onb-progress")).toHaveTextContent("Paso 3 de 6");
    expect(screen.getByRole("heading", { name: "Las 12 colecciones" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(screen.getByTestId("prive-onb-progress")).toHaveTextContent("Paso 4 de 6");
    await waitFor(() => expect(lastOnboardingSave()).toMatchObject({ version: 1, step: 3 }));
    fireEvent.click(screen.getByRole("button", { name: "Paso anterior" }));
    expect(screen.getByTestId("prive-onb-progress")).toHaveTextContent("Paso 3 de 6");
    await waitFor(() => expect(lastOnboardingSave()).toMatchObject({ step: 2 }));
  });

  it("teclado: flechas para moverse, foco en el título del paso y Esc para saltar", async () => {
    setStatus(activeStatus({ onboarding: {} }));
    withSession();
    renderAt();
    const dlg = await onb();
    expect(dlg).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dlg, { key: "ArrowRight" });
    expect(screen.getByTestId("prive-onb-progress")).toHaveTextContent("Paso 2 de 6");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Elegido para ti" }));
    fireEvent.keyDown(dlg, { key: "ArrowLeft" });
    expect(screen.getByTestId("prive-onb-progress")).toHaveTextContent("Paso 1 de 6");
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("prive-onboarding")).toBeNull());
    expect(lastOnboardingSave()).toMatchObject({ version: 1, step: 0, skipped_at: expect.any(String) });
  });

  it("el consentimiento del Travel DNA se guarda; reservas: cinco etiquetas sin prometer nada", async () => {
    setStatus(activeStatus({ onboarding: { version: 1, step: 1 } }));
    withSession();
    renderAt();
    await onb();
    fireEvent.click(screen.getByRole("button", { name: "Sí, personalizar con mi DNA" }));
    await waitFor(() => expect(lastOnboardingSave()).toMatchObject({ dna_consent: true }));
    expect(screen.getByRole("link", { name: /Mi perfil → Travel DNA/ })).toHaveAttribute("href", "/dashboard/perfil");
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    for (const t of ["Recomendación", "Enlace externo", "Solicitud de reserva", "Reserva confirmada", "Beneficio exclusivo comprobado"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getByText(/no garantiza reservas/)).toBeInTheDocument();
  });

  it("al terminar: TE DAMOS LA BIENVENIDA A TU MUNDO. → EXPLORAR PRIVÉ guarda completed_at", async () => {
    setStatus(activeStatus({ onboarding: { version: 1, step: 5 } }));
    withSession();
    renderAt();
    await onb();
    fireEvent.click(screen.getByRole("button", { name: /Terminar/ }));
    expect(screen.getByRole("heading", { name: "TE DAMOS LA BIENVENIDA A TU MUNDO." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EXPLORAR PRIVÉ" }));
    await waitFor(() => expect(screen.queryByTestId("prive-onboarding")).toBeNull());
    expect(lastOnboardingSave()).toMatchObject({ completed_at: expect.any(String) });
  });

  it("después de la bienvenida sigue la guía si no está terminada", async () => {
    setStatus(activeStatus({ welcome_version_seen: 0, onboarding: {} }));
    withSession();
    renderAt();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Bienvenida a IATOS Privé" })).getByRole("button", { name: "Saltar" }));
    expect(await screen.findByTestId("prive-onboarding")).toBeInTheDocument();
  });
});

describe("membresía", () => {
  it("pausada porque el PRO terminó: tarjeta y estado, sin acciones sensibles", async () => {
    setStatus(activeStatus({ is_pro: false, eligible: false }));
    renderAt("/prive/membresia");
    expect(await screen.findByTestId("prive-membership-status")).toHaveTextContent("Pausada porque tu PRO terminó");
    expect(screen.getByTestId("prive-member-card")).toHaveTextContent("Pausada · tu PRO terminó");
    expect(screen.queryByRole("button", { name: "Cerrar todas mis sesiones Privé" })).toBeNull();
    // Sin PRO el servidor devuelve antigüedad 0: no se muestra como dato.
    expect(screen.queryByText("Días de PRO pagado")).toBeNull();
  });

  it("desbloqueada: cambiar contraseña, reportar, cerrar sesiones, términos y ayuda", async () => {
    setStatus(activeStatus());
    withSession();
    state.handler = () => ({ ok: true, data: {} });
    renderAt("/prive/membresia");
    expect(await screen.findByRole("button", { name: "Cambiar contraseña" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reportar contraseña comprometida" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Términos" })).toHaveAttribute("href", "/terminos");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar todas mis sesiones Privé" }));
    await waitFor(() => expect(api.access).toHaveBeenCalledWith("revoke_sessions", { prive_session: SESSION_TOKEN }));
    expect(await screen.findByText(/Cerramos todas tus sesiones Privé/)).toBeInTheDocument();
    expect(localStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
  });
});
