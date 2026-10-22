import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { activeStatus, baseStatus, motionState, priveMock, SESSION_TOKEN, futureIso } from "./helpers/priveTestKit";

vi.mock("framer-motion", async () => (await import("./helpers/priveTestKit")).framerMotionMock);
vi.mock("@/lib/priveApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priveApi")>();
  const { priveMock: m } = await import("./helpers/priveTestKit");
  return { ...actual, priveApi: m.api };
});
const signOut = vi.fn(async () => {});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "v@example.com" }, signOut }) }));

import PriveRoot from "@/pages/prive/PriveRoot";
import PriveInvitation from "@/pages/prive/PriveInvitation";
import PriveReset from "@/pages/prive/PriveReset";
import { MemberCard } from "@/components/prive/MemberCard";
import { PRIVE_INVITE_TOKEN_KEY, PRIVE_RESET_TOKEN_KEY, PRIVE_SESSION_KEY } from "@/lib/priveSession";

const { state, api } = priveMock;
const TOKEN = "invTOKEN_0123456789abcdefXYZ";
const PASSPHRASE = "lumen-orquidea-puerto-terciopelo-82";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/prive" element={<PriveRoot />}>
          <Route index element={<p>HUB</p>} />
          <Route path="invitacion" element={<PriveInvitation />} />
          <Route path="restablecer" element={<PriveReset />} />
        </Route>
        <Route path="/auth" element={<p>AUTH</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  // Movimiento reducido: escenas cortas, sin esperar animaciones.
  motionState.reduce = true;
  state.statusOk = true;
  api.access.mockClear();
  api.status.mockClear();
  signOut.mockClear();
});

/** Servidor simulado: acepta, crea contraseña (o la genera) y desbloquea. */
function happyServer(over: Record<string, unknown> = {}) {
  state.handler = (action, body) => {
    if (action in over) return over[action];
    if (action === "accept_invitation") {
      state.status = { ...state.status, membership_status: "active", activated_at: "2026-10-22T18:30:00Z", member_code: "IP-7KQM-X4TD" };
      return { ok: true, data: { ok: true } };
    }
    if (action === "set_password") {
      state.status = { ...state.status, has_password: true, password_status: "active" };
      // Forma de la rama core: la frase llega como generated_password y la primera sesión ya viene abierta.
      return {
        ok: true,
        data: body.generate ? { ok: true, generated_password: PASSPHRASE, prive_session: SESSION_TOKEN, expires_at: futureIso() } : { ok: true },
      };
    }
    if (action === "unlock") return { ok: true, data: { ok: true, prive_session: SESSION_TOKEN, expires_at: futureIso() } };
    return { ok: true, data: { ok: true } };
  };
}

const goToEnvelope = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 950)); });
  return screen.findByRole("button", { name: "OPEN INVITATION" });
};

describe("/prive/invitacion", () => {
  it("el token #t= se quita de la URL al llegar y se envía solo al aceptar", async () => {
    state.status = baseStatus({ eligible: true, membership_status: "invited", invitation_pending: true });
    happyServer();
    window.history.replaceState(null, "", `/prive/invitacion#t=${TOKEN}`);
    renderAt("/prive/invitacion");
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.href).not.toContain(TOKEN);
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBe(TOKEN);
    expect(Object.keys({ ...localStorage }).filter((k) => k !== PRIVE_SESSION_KEY)).toEqual([]);
    // La revelación no existe en el DOM antes de que el servidor acepte.
    expect(screen.queryByText("YOUR PRIVÉ MEMBERSHIP HAS BEEN UNLOCKED.")).toBeNull();
    fireEvent.click(await goToEnvelope());
    expect(await screen.findByTestId("prive-welcome-name")).toHaveTextContent("WELCOME, VALENTINA.");
    expect(screen.getAllByText("YOUR PRIVÉ MEMBERSHIP HAS BEEN UNLOCKED.").length).toBeGreaterThan(0);
    expect(api.access).toHaveBeenCalledWith("accept_invitation", { token: TOKEN });
    // Aceptada: el token ya no se guarda.
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBeNull();
  });

  it("invitación de otra cuenta: mensaje genérico y cambio de cuenta", async () => {
    state.status = baseStatus({ eligible: true, membership_status: "invited" });
    happyServer({ accept_invitation: { ok: false, code: "INVITATION_OTHER_ACCOUNT" } });
    sessionStorage.setItem(PRIVE_INVITE_TOKEN_KEY, TOKEN);
    renderAt("/prive/invitacion");
    fireEvent.click(await goToEnvelope());
    expect(await screen.findByRole("heading", { name: "Esta invitación es para otra cuenta" })).toBeInTheDocument();
    expect(screen.getByText(/no corresponde a la cuenta con la que iniciaste sesión/)).toBeInTheDocument();
    expect(screen.queryByText(/WELCOME,/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar de cuenta" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(await screen.findByText("AUTH")).toBeInTheDocument();
  });

  it("invitación vencida: se pide una nueva y se puede abrir sin el token viejo", async () => {
    state.status = baseStatus({ eligible: true, membership_status: "invited" });
    let first = true;
    happyServer();
    const base = state.handler;
    state.handler = (action, body) => {
      if (action === "accept_invitation" && first) { first = false; return { ok: false, code: "INVITATION_EXPIRED" }; }
      return base(action, body);
    };
    sessionStorage.setItem(PRIVE_INVITE_TOKEN_KEY, TOKEN);
    renderAt("/prive/invitacion");
    fireEvent.click(await goToEnvelope());
    expect(await screen.findByRole("heading", { name: "Tu invitación venció" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviarme una nueva" }));
    await waitFor(() => expect(api.access).toHaveBeenCalledWith("resend_invitation", {}));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir ahora" }));
    fireEvent.click(await screen.findByRole("button", { name: "OPEN INVITATION" }));
    await screen.findByTestId("prive-welcome-name");
    expect(api.access).toHaveBeenLastCalledWith("accept_invitation", {});
  });

  it.each([
    ["sin PRO", baseStatus({ is_pro: false }), "Privé es parte de IATOS PRO"],
    ["sin 90 días", baseStatus({ tenure_days: 30 }), "Aún no es momento"],
    ["ya activa", activeStatus(), "Tu membresía ya está activa"],
  ])("%s: mensaje calmado, sin ceremonia", async (_n, s, heading) => {
    state.status = s;
    happyServer();
    renderAt("/prive/invitacion");
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OPEN INVITATION" })).toBeNull();
    if (heading === "Tu membresía ya está activa") expect(screen.getByRole("link", { name: "Ir a IATOS Privé" })).toHaveAttribute("href", "/prive");
  });

  it("frase generada: se muestra una vez, nunca se guarda y la tarjeta no muestra credenciales", async () => {
    state.status = baseStatus({ eligible: true, membership_status: "invited" });
    happyServer();
    renderAt("/prive/invitacion");
    fireEvent.click(await goToEnvelope());
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Generar una por mí" }));
    fireEvent.click(screen.getByRole("button", { name: "Generar mi contraseña" }));
    const out = await screen.findByLabelText("Contraseña Privé generada");
    expect(out).toHaveTextContent(PASSPHRASE);
    expect(screen.getByText(/Solo la verás esta vez/)).toBeInTheDocument();
    // La primera sesión la abrió el servidor; la frase no queda en ningún almacenamiento.
    await waitFor(() => expect(localStorage.getItem(PRIVE_SESSION_KEY)).not.toBeNull());
    expect(api.access).not.toHaveBeenCalledWith("unlock", expect.anything());
    const everything = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(everything).not.toContain(PASSPHRASE);
    expect(JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!).token).toBe(SESSION_TOKEN);
    fireEvent.click(screen.getByRole("button", { name: "La guardé" }));
    const card = await screen.findByTestId("prive-member-card");
    // Ya no está en pantalla ni en el DOM.
    expect(document.body.textContent).not.toContain(PASSPHRASE);
    expect(card.textContent).not.toContain(SESSION_TOKEN);
    expect(card).toHaveTextContent("IP-7KQM-X4TD");
    expect(screen.getByText(/Código ceremonial: es solo un adorno/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "ENTER IATOS PRIVÉ" }));
    expect(await screen.findByText("HUB")).toBeInTheDocument();
  });

  it("contraseña elegida: guía de fuerza, sin enviar hasta cumplir; error del servidor visible", async () => {
    state.status = activeStatus({ has_password: false, password_status: null });
    happyServer({ set_password: { ok: false, code: "PASSWORD_BREACHED" } });
    renderAt("/prive/invitacion");
    // Membresía activa sin contraseña: reanuda directo en el paso 4.
    expect(await screen.findByText("Continúa donde te quedaste")).toBeInTheDocument();
    const pw = screen.getByLabelText("Contraseña Privé", { selector: "input" });
    const submit = screen.getByRole("button", { name: "Crear mi contraseña" });
    fireEvent.change(pw, { target: { value: "corta" } });
    expect(submit).toBeDisabled();
    fireEvent.change(pw, { target: { value: "faro lento sobre bahía 1987" } });
    fireEvent.change(screen.getByLabelText("Repítela"), { target: { value: "faro lento sobre bahía 1987" } });
    expect(screen.getByTestId("prive-pw-strength")).toHaveTextContent(/Fuerte|Excelente/);
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("filtraciones públicas");
    expect(api.access).toHaveBeenCalledWith("set_password", { password: "faro lento sobre bahía 1987" });
    expect(api.access).not.toHaveBeenCalledWith("unlock", expect.anything());
  });

  it("si el servidor no abre la sesión al crear la contraseña, se abre con unlock (sin guardar la contraseña)", async () => {
    state.status = activeStatus({ has_password: false, password_status: null });
    happyServer();
    renderAt("/prive/invitacion");
    fireEvent.change(await screen.findByLabelText("Contraseña Privé", { selector: "input" }), { target: { value: "faro lento sobre bahía 1987" } });
    fireEvent.change(screen.getByLabelText("Repítela"), { target: { value: "faro lento sobre bahía 1987" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear mi contraseña" }));
    expect(await screen.findByTestId("prive-member-card")).toBeInTheDocument();
    expect(api.access).toHaveBeenCalledWith("unlock", { password: "faro lento sobre bahía 1987" });
    expect(JSON.parse(localStorage.getItem(PRIVE_SESSION_KEY)!).token).toBe(SESSION_TOKEN);
    expect(JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage })).not.toContain("faro lento");
  });

  it("MemberCard no recibe ni muestra contraseña o token (solo datos públicos)", () => {
    const { container } = render(<MemberCard firstName="Valentina" status="active" activatedAt="2026-10-22T18:30:00Z" memberCode="IP-7KQM-X4TD" />);
    expect(container).toHaveTextContent("Valentina");
    expect(container).toHaveTextContent("Miembro activo");
    expect(container).toHaveTextContent("IP-7KQM-X4TD");
    expect(container).toHaveTextContent("XXII · X · MMXXVI");
    expect(container.textContent).toMatch(/No es una contraseña ni da acceso a nada/);
    expect(container.querySelector("input")).toBeNull();
  });
});

describe("/prive/restablecer", () => {
  it("sin token: pide el enlace por correo", async () => {
    state.status = activeStatus();
    happyServer();
    renderAt("/prive/restablecer");
    fireEvent.click(await screen.findByRole("button", { name: "Enviarme el enlace" }));
    expect(await screen.findByText(/te enviamos el enlace a tu correo/)).toBeInTheDocument();
    expect(api.access).toHaveBeenCalledWith("request_reset", {});
  });

  it("con token (#t=): lo quita de la URL, guarda la nueva y cierra la sesión local", async () => {
    state.status = activeStatus();
    happyServer();
    localStorage.setItem(PRIVE_SESSION_KEY, JSON.stringify({ token: SESSION_TOKEN, expiresAt: futureIso(), userId: "u1" }));
    window.history.replaceState(null, "", "/prive/restablecer#t=resetTOKEN_0123456789abc");
    renderAt("/prive/restablecer");
    await waitFor(() => expect(window.location.hash).toBe(""));
    fireEvent.change(await screen.findByLabelText("Contraseña Privé", { selector: "input" }), { target: { value: "otra frase muy segura 2026" } });
    fireEvent.change(screen.getByLabelText("Repítela"), { target: { value: "otra frase muy segura 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña nueva" }));
    expect(await screen.findByText(/Tu contraseña Privé cambió/)).toBeInTheDocument();
    expect(api.access).toHaveBeenCalledWith("complete_reset", { token: "resetTOKEN_0123456789abc", new_password: "otra frase muy segura 2026" });
    expect(localStorage.getItem(PRIVE_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(PRIVE_RESET_TOKEN_KEY)).toBeNull();
  });

  it("enlace vencido: lo dice y ofrece pedir otro", async () => {
    state.status = activeStatus();
    happyServer({ complete_reset: { ok: false, code: "RESET_INVALID" } });
    sessionStorage.setItem(PRIVE_RESET_TOKEN_KEY, "resetTOKEN_0123456789abc");
    renderAt("/prive/restablecer");
    fireEvent.change(await screen.findByLabelText("Contraseña Privé", { selector: "input" }), { target: { value: "otra frase muy segura 2026" } });
    fireEvent.change(screen.getByLabelText("Repítela"), { target: { value: "otra frase muy segura 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña nueva" }));
    expect(await screen.findByRole("button", { name: "Pedir un enlace nuevo" })).toBeInTheDocument();
  });
});

// R10 Privé (ensayo en producción, 22-oct-2026): la cuenta gratuita A abrió el enlace reenviado de
// otra persona y vio "Privé es parte de IATOS PRO" (sin preguntar al servidor), en vez de "Esta
// invitación es para otra cuenta". El servidor ya respondía INVITATION_OTHER_ACCOUNT.
describe("/prive/invitacion · enlace reenviado a una cuenta sin PRO", () => {
  it("con token de otra cuenta muestra 'para otra cuenta' y olvida el token", async () => {
    state.status = baseStatus({ is_pro: false, eligible: false, membership_status: "none" });
    happyServer({ accept_invitation: { ok: false, code: "INVITATION_OTHER_ACCOUNT" } });
    sessionStorage.setItem(PRIVE_INVITE_TOKEN_KEY, TOKEN);
    renderAt("/prive/invitacion");
    expect(await screen.findByTestId("prive-invite-msg-INVITATION_OTHER_ACCOUNT")).toBeTruthy();
    expect(screen.queryByText(/Valentina/i)).toBeNull();
    expect(api.access).toHaveBeenCalledWith("accept_invitation", { token: TOKEN });
    expect(sessionStorage.getItem(PRIVE_INVITE_TOKEN_KEY)).toBeNull();
  });

  it("la dueña sin PRO vigente sigue viendo 'Privé es parte de IATOS PRO'", async () => {
    state.status = baseStatus({ is_pro: false, eligible: false, membership_status: "invited" });
    happyServer({ accept_invitation: { ok: false, code: "NOT_PRO" } });
    sessionStorage.setItem(PRIVE_INVITE_TOKEN_KEY, TOKEN);
    renderAt("/prive/invitacion");
    expect(await screen.findByTestId("prive-invite-msg-NOT_PRO")).toBeTruthy();
  });

  it("sin token no se llama a accept_invitation", async () => {
    state.status = baseStatus({ is_pro: false, eligible: false, membership_status: "none" });
    happyServer();
    renderAt("/prive/invitacion");
    expect(await screen.findByTestId("prive-invite-msg-NOT_PRO")).toBeTruthy();
    expect(api.access).not.toHaveBeenCalledWith("accept_invitation", expect.anything());
  });
});
