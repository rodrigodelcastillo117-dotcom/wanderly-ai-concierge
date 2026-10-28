// Mesa de operaciones (/admin/operaciones) con datos simulados: lista unificada, filtros, acciones
// (Tomar, Responder → correo vía ops-desk, Marcar resuelta con evidencia, No se pudo con motivo) y el
// bloqueo para quien no es admin. Y "Mis solicitudes" del usuario: estado real y respuesta del equipo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminOperations from "@/pages/AdminOperations";
import { MyTeamRequests } from "@/components/concierge/MyTeamRequests";

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const ADMIN = { id: "d", name: "Rodrigo Dueño", email: "dueno@iatos.mx" };
const items = [
  {
    source: "concierge_request", id: "7e300000-0000-0000-0000-000000000001", type: "reservation", title: "Mesa en Contramar", status: "solicitado",
    stage: "nueva", created_at: ago(1), requested_for: "2026-11-02T20:30", party_size: 4, place: "Contramar",
    payload: { fecha: "2026-11-02", hora: "20:30", personas: 4, lugar: "Contramar", detalle: "Aniversario, terraza si se puede" },
    trip: { id: "t1", destino: "Ciudad de México", fecha_salida: "2026-11-01", fecha_regreso: "2026-11-05" },
    user: { id: "a", name: "Ana Viajera", email: "ana@correo.mx" }, owner: null, evidence: null,
    alert: { status: "fallido", attempts: 1, error: "resend_500" }, history: [], replies: [],
  },
  {
    source: "ai_reservation", id: "7e400000-0000-0000-0000-000000000001", type: "ai_reservation", title: "Reserva IA · Pujol", status: "needs_user",
    stage: "en_proceso", reason: "no_contact", ref_code: "R-MESA01", created_at: ago(3), requested_for: "2026-11-03T21:00", party_size: 2, place: "Pujol",
    experience: { name: "Pujol", city: "Ciudad de México", country: "MX" }, venue: { phone: "+52 55 5545 4111" },
    user: { id: "a", name: "Ana Viajera", email: "ana@correo.mx" }, owner: ADMIN, evidence: null, alert: null,
    history: [{ at: ago(2), kind: "note", action: "tomar", actor: "equipo", by: ADMIN }],
    replies: [{ id: "r0", kind: "respuesta", body: "Estamos llamando a Pujol.", at: ago(2), admin: ADMIN, email_status: "enviado" }],
  },
];
const list = { generated_at: new Date().toISOString(), counts: { nueva: 1, en_proceso: 1, resuelta: 3 }, items };

const renderPage = (path = "/admin/operaciones") => render(<MemoryRouter initialEntries={[path]}><AdminOperations /></MemoryRouter>);

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

describe("Mesa de operaciones", () => {
  it("lista quién, qué pidió (texto completo y datos), cuándo y estado, más reciente primero", async () => {
    rpc.mockResolvedValue({ data: list, error: null });
    renderPage();
    expect(await screen.findByText("Mesa de operaciones")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_ops_list", { _stage: "abiertas" });
    const cards = screen.getAllByTestId("ops-item");
    expect(cards).toHaveLength(2);
    const first = within(cards[0]);
    expect(first.getByText("Reserva de mesa")).toBeInTheDocument();
    expect(first.getByText("Contramar", { selector: "h3" })).toBeInTheDocument();
    expect(first.getByText(/Ana Viajera/)).toBeInTheDocument();
    expect(first.getByText("ana@correo.mx")).toHaveAttribute("href", "mailto:ana@correo.mx");
    expect(first.getByText("Aniversario, terraza si se puede")).toBeInTheDocument();
    expect(first.getByText("4")).toBeInTheDocument();
    expect(first.getByText(/2 nov.*20:30 h/)).toBeInTheDocument();
    expect(first.getByText(/Ciudad de México/)).toBeInTheDocument();
    expect(first.getByText(/hace 1 h · Folio 7E300000/)).toBeInTheDocument();
    expect(first.getByText("Nueva")).toBeInTheDocument();
    expect(first.getByText(/El correo de aviso falló; se reintenta solo/)).toBeInTheDocument();
    const second = within(cards[1]);
    expect(second.getByText("Reserva IA")).toBeInTheDocument();
    expect(second.getByText(/No encontramos correo del lugar/)).toBeInTheDocument();
    expect(second.getByText(/La atiende Rodrigo Dueño/)).toBeInTheDocument();
    expect(second.getByText("Estamos llamando a Pujol.")).toBeInTheDocument();
    // Ya tomada: no vuelve a ofrecer "Tomar".
    expect(second.queryByRole("button", { name: /Tomar/ })).toBeNull();
    // Conteos en los filtros.
    expect(screen.getByRole("tab", { name: /Abiertas 2/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Resueltas 3/ })).toBeInTheDocument();
    // Sin inglés en la pantalla.
    expect(document.body.textContent).not.toMatch(/\b(pending|needs_user|reservation|request)\b/);
  });

  it("filtrar por estado pide esa etapa a la base", async () => {
    rpc.mockResolvedValue({ data: list, error: null });
    renderPage();
    await screen.findAllByTestId("ops-item");
    fireEvent.click(screen.getByRole("tab", { name: /Resueltas/ }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("admin_ops_list", { _stage: "resuelta" }));
    fireEvent.click(screen.getByRole("tab", { name: /Todas/ }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("admin_ops_list", { _stage: null }));
  });

  it("Tomar llama a admin_ops_act y recarga", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "admin_ops_list" ? { data: list, error: null } : { data: { ok: true, reply_id: null }, error: null }));
    renderPage();
    const card = within((await screen.findAllByTestId("ops-item"))[0]);
    fireEvent.click(card.getByRole("button", { name: /Tomar/ }));
    expect(await screen.findByText(/La tomaste: queda en proceso a tu nombre/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_ops_act", { _source: "concierge_request", _id: items[0].id, _action: "tomar", _message: null, _evidence: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Responder al usuario guarda el mensaje y pide a ops-desk el correo de ESA respuesta", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "admin_ops_list" ? { data: list, error: null } : { data: { ok: true, reply_id: "rep-1" }, error: null }));
    invoke.mockResolvedValue({ data: { ok: true, email_status: "enviado" }, error: null });
    renderPage();
    const card = within((await screen.findAllByTestId("ops-item"))[0]);
    fireEvent.click(card.getByRole("button", { name: /Responder al usuario/ }));
    fireEvent.change(card.getByLabelText("Mensaje para el usuario"), { target: { value: "Hola Ana, ¿te aparto la terraza?" } });
    fireEvent.click(card.getByRole("button", { name: "Enviar al usuario" }));
    expect(await screen.findByText(/Respuesta enviada al usuario\. Le mandamos el correo\./)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_ops_act", expect.objectContaining({ _action: "responder", _message: "Hola Ana, ¿te aparto la terraza?" }));
    expect(invoke).toHaveBeenCalledWith("ops-desk", { body: { reply_id: "rep-1" } });
  });

  it("Marcar resuelta manda la evidencia; si la base la exige y falta, lo explica en español", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "admin_ops_list" ? { data: list, error: null } : { data: { ok: false, code: "EVIDENCE_REQUIRED" }, error: null }));
    renderPage();
    const card = within((await screen.findAllByTestId("ops-item"))[1]);
    fireEvent.click(card.getByRole("button", { name: /Marcar resuelta/ }));
    expect(card.getByText(/obligatoria: crea la reserva confirmada/)).toBeInTheDocument();
    fireEvent.change(card.getByPlaceholderText(/Número de confirmación/), { target: { value: "ok" } });
    fireEvent.click(card.getByRole("button", { name: "Marcar resuelta" }));
    expect(await card.findByRole("alert")).toHaveTextContent(/la evidencia es obligatoria/);
    expect(rpc).toHaveBeenCalledWith("admin_ops_act", expect.objectContaining({ _source: "ai_reservation", _action: "resolver", _evidence: "ok" }));
  });

  it("No se pudo pide el motivo y dice si el correo quedó pendiente", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "admin_ops_list" ? { data: list, error: null } : { data: { ok: true, reply_id: "rep-2" }, error: null }));
    invoke.mockResolvedValue({ data: null, error: new Error("network") });
    renderPage();
    const card = within((await screen.findAllByTestId("ops-item"))[0]);
    fireEvent.click(card.getByRole("button", { name: /No se pudo/ }));
    fireEvent.change(card.getByLabelText("Motivo (el usuario lo verá)"), { target: { value: "No tienen mesa ese día" } });
    fireEvent.click(card.getByRole("button", { name: "Confirmar: no se pudo" }));
    expect(await screen.findByText(/El correo quedó pendiente; se reintenta solo/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_ops_act", expect.objectContaining({ _action: "no_se_pudo", _message: "No tienen mesa ese día" }));
  });

  it("desde el enlace del correo (?id=) abre todas y marca esa solicitud", async () => {
    rpc.mockResolvedValue({ data: list, error: null });
    renderPage(`/admin/operaciones?id=${items[0].id}`);
    const cards = await screen.findAllByTestId("ops-item");
    expect(rpc).toHaveBeenCalledWith("admin_ops_list", { _stage: null });
    expect(cards[0].className).toMatch(/ring-1/);
  });

  it("quien no es admin ve el aviso y ninguna solicitud", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "mesa de operaciones: solo administradores" } });
    renderPage();
    expect(await screen.findByText("Acceso solo para administradores")).toBeInTheDocument();
    expect(screen.queryAllByTestId("ops-item")).toHaveLength(0);
  });
});

describe("Mis solicitudes (usuario)", () => {
  const mine = [
    {
      source: "concierge_request", id: "7e300000-0000-0000-0000-000000000001", type: "reservation", title: "Mesa en Contramar", status: "resuelto", stage: "resuelta",
      created_at: ago(5), requested_for: "2026-11-02T20:30", party_size: 4, place: "Contramar", evidence: "Confirmación Contramar #4471",
      replies: [{ id: "q1", kind: "resuelta", body: "Listo: terraza a las 20:30 para 4.", at: ago(1) }], history: [],
    },
    {
      source: "concierge_request", id: "7e300000-0000-0000-0000-000000000003", type: "pickup", title: "Equipaje Invisible · cotización", status: "pendiente_confirmacion",
      stage: "en_proceso", created_at: ago(2), replies: [], history: [],
    },
  ];

  it("muestra el estado real, la respuesta del equipo y el comprobante; abierta = aún no es una reserva", async () => {
    rpc.mockResolvedValue({ data: mine, error: null });
    render(<MyTeamRequests />);
    const rows = await screen.findAllByTestId("team-request");
    expect(rpc).toHaveBeenCalledWith("my_team_requests");
    expect(within(rows[0]).getByText("Resuelta por el equipo IATOS")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Listo: terraza a las 20:30 para 4.")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Confirmación Contramar #4471")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Contramar · 2 nov.*20:30 h · 4 personas/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("En proceso · una persona del equipo IATOS la está atendiendo · aún no es una reserva")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/te avisamos aquí y por correo cuando haya respuesta/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d+\s*minutos\b|en breve/);
  });

  it("sin solicitudes lo dice; si falla la carga ofrece reintentar", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const { unmount } = render(<MyTeamRequests />);
    expect(await screen.findByText(/Aún no le has pedido nada a una persona del equipo/)).toBeInTheDocument();
    unmount();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    render(<MyTeamRequests />);
    expect(await screen.findByText(/No pudimos cargar tus solicitudes/)).toBeInTheDocument();
  });
});
