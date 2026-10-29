// Incidentes en la app (mínimo indispensable): «Tengo un problema» discreto en el menú «Más», en el menú lateral y
// dentro del viaje; el formulario corto con sus estados; la Mesa (filtro «Incidentes», severidad, semáforo,
// tomar/resolver con nota/escalar, bitácora) y «Mis solicitudes» (siguiente paso, ¿quedó resuelto?).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const rpc = vi.fn();
const invoke = vi.fn();
const qb: any = { select: () => qb, eq: () => qb, order: () => qb, maybeSingle: async () => ({ data: null, error: null }),
  limit: async () => ({ data: [{ id: "77777777-7777-4777-8777-777777777777", destino: "Cancún", fecha_salida: "2026-10-28" }], error: null }) };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => qb },
}));
const auth = { user: { id: "u1", email: "ana@correo.mx" }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import { DashboardLayout } from "@/components/DashboardLayout";
import { IncidentDialog } from "@/components/incident/IncidentDialog";
import { IncidentHost, IncidentTripLink } from "@/components/incident/IncidentEntry";
import { MyTeamRequests } from "@/components/concierge/MyTeamRequests";
import { __resetMyTeamRequestsCache } from "@/lib/opsDesk";

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); __resetMyTeamRequestsCache(); });

const SENT = {
  ok: true, id: "88888888-8888-4888-8888-888888888888", folio: "88888888", categoria: "traslado_no_llego", categoria_label: "El traslado no llegó",
  severidad: "critica", team_notified: true, siguiente_paso: "Una persona del equipo IATOS revisa tu caso y te escribe con el siguiente paso",
  siguiente_paso_hora: "2026-10-30T03:50:00Z",
  guia: { ahora: ["Revisa en tu confirmación el punto exacto de encuentro.", "Quédate dentro de la terminal."], emergencia: "Si hay peligro o es una emergencia médica, llama ya al 911.", equipo: "El equipo IATOS contacta al proveedor del traslado." },
};

describe("entradas discretas a «Tengo un problema»", () => {
  it("está en «Más» y en el menú lateral, sin botón flotante; abre el formulario", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/viajes"]}><DashboardLayout><div>PAGINA</div></DashboardLayout></MemoryRouter>);
    expect(screen.getByTestId("sidebar-incident")).toHaveTextContent("Tengo un problema");
    expect(screen.getByTestId("sidebar-incident").className).toContain("text-muted-foreground");
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId("more-incident"));
    expect(await screen.findByTestId("incident-dialog")).toBeInTheDocument();
  });

  it("dentro del viaje: enlace pequeño que abre el formulario con ese viaje", async () => {
    render(<MemoryRouter><IncidentTripLink tripId="77777777-7777-4777-8777-777777777777" /><IncidentHost /></MemoryRouter>);
    const link = screen.getByTestId("trip-incident-link");
    expect(link).toHaveTextContent("Tengo un problema en este viaje");
    expect(link.className).toContain("text-xs");
    await act(async () => { fireEvent.click(link); });
    expect(await screen.findByTestId("incident-dialog")).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText("Viaje (opcional)") as HTMLSelectElement).value).toBe("77777777-7777-4777-8777-777777777777"));
  });
});

describe("formulario corto", () => {
  it("pide tipo y qué pasó; envía con la zona horaria y muestra qué hacer ahora, el folio y la hora prometida", async () => {
    invoke.mockResolvedValue({ data: SENT, error: null });
    render(<MemoryRouter><IncidentDialog open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Enviar al equipo" }));
    expect(await screen.findByText("Elige qué tipo de problema es.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("¿Qué pasó?"), { target: { value: "traslado_no_llego" } });
    fireEvent.change(screen.getByLabelText("Cuéntanos"), { target: { value: "Llegué a Cancún y el chofer no está en la salida 3" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar al equipo" })); });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const [fn, { body }] = invoke.mock.calls[0];
    expect(fn).toBe("incidente");
    expect(body).toMatchObject({ categoria: "traslado_no_llego", descripcion: "Llegué a Cancún y el chofer no está en la salida 3", ubicacion: { zona_horaria: expect.any(String) } });
    expect(body.idempotency_key).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    const ok = await screen.findByTestId("incident-sent");
    expect(ok).toHaveTextContent("Tu caso está abierto");
    expect(ok).toHaveTextContent("Folio 88888888");
    expect(ok).toHaveTextContent("el equipo ya fue avisado");
    expect(screen.getByTestId("incident-emergency")).toHaveTextContent("911");
    expect(screen.getByTestId("incident-next")).toHaveTextContent(/a más tardar a las \d{2}:\d{2}/);
  });

  it("sin conexión no se pierde lo escrito y se recuerda el número de emergencias", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<MemoryRouter><IncidentDialog open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("¿Qué pasó?"), { target: { value: "robo" } });
    fireEvent.change(screen.getByLabelText("Cuéntanos"), { target: { value: "Me robaron la cartera" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar al equipo" })); });
    expect(await screen.findByTestId("incident-error")).toHaveTextContent(/sin conexión.*911/);
    expect((screen.getByLabelText("Cuéntanos") as HTMLTextAreaElement).value).toBe("Me robaron la cartera");
    expect(invoke).not.toHaveBeenCalled();
    onLine.mockRestore();
  });
});

describe("Mesa de operaciones: incidentes", () => {
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const incident = {
    source: "concierge_request", id: "99999999-9999-4999-8999-999999999999", type: "incidente", title: "El traslado no llegó: …", status: "solicitado",
    stage: "nueva", created_at: ago(25), user: { name: "Ana Viajera", email: "ana@correo.mx" }, owner: null, history: [], replies: [],
    payload: { categoria: "traslado_no_llego", severidad: "critica", descripcion: "El chofer no está en la salida 3", origen: "usuario",
      ubicacion: { ciudad: "Cancún", pais: "MX", lat: 21.03, lng: -86.87, zona_horaria: "America/Cancun" }, acciones_tomadas: ["Iato le dio la guía inmediata (qué hacer ahora)"] },
    incident: { category: "traslado_no_llego", severity: "critica", semaforo: "rojo", minutes_unattended: 25, take_minutes: 10, assignee: "humano", escalation_level: 2,
      next_step: "Una persona del equipo IATOS revisa tu caso", next_step_due_at: ago(15), events_count: 9 },
  };
  const reserva = { source: "concierge_request", id: "7e300000-0000-0000-0000-000000000001", type: "reservation", title: "Mesa en Contramar", status: "solicitado",
    stage: "nueva", created_at: ago(120), place: "Contramar", payload: {}, user: { name: "Beto", email: "b@correo.mx" }, history: [], replies: [] };
  const list = { generated_at: new Date().toISOString(), counts: { nueva: 2 }, items: [reserva, incident] };

  it("filtro «Incidentes» con severidad y semáforo; resolver exige nota; escalar avisa ya; bitácora", async () => {
    const { default: AdminOperations } = await import("@/pages/AdminOperations");
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "admin_ops_list") return { data: list, error: null };
      if (fn === "admin_incident_resolve") return { data: { ok: true, reply_id: "rep1" }, error: null };
      if (fn === "admin_incident_escalate") return { data: { ok: true, alert_id: "al1", escalation_level: 3 }, error: null };
      if (fn === "admin_incident_log") return { data: { events: [{ id: 1, at: ago(25), kind: "creado", actor: "usuario", channel: "app", direction: "entrante", body: "El chofer no está" }] }, error: null };
      return { data: null, error: null };
    });
    invoke.mockResolvedValue({ data: { email_status: "enviado", sent: 1 }, error: null });
    render(<MemoryRouter initialEntries={["/admin/operaciones"]}><AdminOperations /></MemoryRouter>);
    expect(await screen.findAllByTestId("ops-item")).toHaveLength(2);
    const filter = screen.getByTestId("filter-incidents");
    expect(filter).toHaveTextContent("Incidentes 1");
    fireEvent.click(filter);
    const cards = screen.getAllByTestId("ops-item");
    expect(cards).toHaveLength(1);
    const card = within(cards[0]);
    expect(card.getByTestId("incident-severity")).toHaveTextContent("Crítica");
    expect(card.getByTestId("incident-light")).toHaveTextContent("25 min sin atender (meta 10 min)");
    expect(card.getByText(/America\/Cancun/)).toBeInTheDocument();
    expect(card.getByText(/Cancún, MX/)).toBeInTheDocument();
    expect(card.getByText(/Iato le dio la guía inmediata/)).toBeInTheDocument();
    // Resolver: sin nota de al menos 10 caracteres no se puede.
    fireEvent.click(card.getByRole("button", { name: /Marcar resuelto/ }));
    const resolveBtn = card.getByRole("button", { name: "Marcar resuelto" });
    expect(resolveBtn).toBeDisabled();
    fireEvent.change(card.getByLabelText(/Nota de resolución/), { target: { value: "El chofer llegó a las 21:58; Ana ya va al hotel." } });
    await act(async () => { fireEvent.click(resolveBtn); });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_incident_resolve", expect.objectContaining({ _id: incident.id, _note: "El chofer llegó a las 21:58; Ana ya va al hotel." })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ops-desk", { body: { reply_id: "rep1" } }));
    expect(await screen.findByText(/Resuelto con nota/)).toBeInTheDocument();
    // Escalar: sube nivel y reparte el aviso al momento.
    const card2 = within(screen.getAllByTestId("ops-item")[0]);
    fireEvent.click(card2.getByRole("button", { name: /^Escalar/ }));
    await act(async () => { fireEvent.click(card2.getByRole("button", { name: "Escalar ahora" })); });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ops-desk", { body: { incident_id: incident.id } }));
    // Bitácora bajo demanda.
    await act(async () => { fireEvent.click(card2.getByTestId("incident-log-toggle")); });
    expect(await card2.findByTestId("incident-log")).toHaveTextContent("Viajero · app ← · El chofer no está");
  });
});

describe("«Mis solicitudes»: el incidente", () => {
  it("muestra estado, siguiente paso con hora y «¿Quedó resuelto?»; «No» lo reabre", async () => {
    rpc.mockImplementation(async (fn: string) => fn === "my_team_requests" ? { data: [{
      source: "concierge_request", id: "55555555-5555-4555-8555-555555555555", type: "incidente", title: "Queja: me cobraron doble", status: "pendiente_confirmacion",
      stage: "en_proceso", created_at: new Date().toISOString(), history: [], replies: [{ id: "q1", kind: "respuesta", body: "Ya pedimos el reembolso al banco.", at: new Date().toISOString() }],
      incident: { category_label: "Queja", next_step: "Te confirmamos el reembolso", next_step_due_at: "2026-10-30T18:00:00Z", can_confirm: true, is_open: true,
        messages: [{ at: new Date().toISOString(), from: "usuario", actor: "usuario", body: "Sigue apareciendo el cargo" }] },
    }], error: null } : { data: { ok: true, status: "reabierto" }, error: null });
    render(<MyTeamRequests />);
    const item = within(await screen.findByTestId("team-request"));
    expect(item.getByText("Incidente")).toBeInTheDocument();
    expect(item.getByText("En atención · el equipo IATOS lo está atendiendo")).toBeInTheDocument();
    expect(item.queryByText(/aún no es una reserva/)).toBeNull();
    expect(item.getByTestId("incident-panel")).toHaveTextContent(/Siguiente paso: Te confirmamos el reembolso, a más tardar a las \d{2}:\d{2}/);
    expect(item.getByText(/Sigue apareciendo el cargo/)).toBeInTheDocument();
    const confirm = within(item.getByTestId("incident-confirm"));
    await act(async () => { fireEvent.click(confirm.getByRole("button", { name: "No, sigue el problema" })); });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_incident_confirm", { _id: "55555555-5555-4555-8555-555555555555", _resolved: false, _comment: null }));
    expect(await screen.findByText("Lo reabrimos con prioridad; el equipo ya fue avisado.")).toBeInTheDocument();
  });
});
