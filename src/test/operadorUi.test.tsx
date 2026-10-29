// Operador IATOS en la app (mínimo indispensable): vincular Telegram en Perfil → Ajustes, la bitácora del operador en
// la Mesa (resumen: acciones, gasto, si pasó a una persona; cada acción con su nombre) y que un mensaje del viajero
// despierte al operador.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { TelegramLink } from "@/components/canales/TelegramLink";
import { messageIncident, operatorSummary } from "@/lib/incident";
import { IncidentOpsCard } from "@/components/incident/IncidentOpsCard";

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

describe("Perfil → Ajustes → Telegram", () => {
  it("apagado (sin token del bot): lo dice y no ofrece vincular", async () => {
    invoke.mockResolvedValue({ data: { ok: true, telegram: { activo: false, bot: null, vinculado: false, usuario: null } }, error: null });
    render(<TelegramLink />);
    expect(await screen.findByText(/Todavía no está activo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vincular Telegram" })).toBeNull();
  });

  it("vincular: pide un código de un solo uso y abre el bot con él", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: { accion: string } }) => o.body.accion === "estado"
      ? { data: { ok: true, telegram: { activo: true, bot: "IatosBot", vinculado: false, usuario: null } }, error: null }
      : { data: { ok: true, codigo: "K7P2QX9M", enlace: "https://t.me/IatosBot?start=K7P2QX9M", expira: "2026-10-29T15:15:00Z", bot: "IatosBot" }, error: null });
    render(<TelegramLink />);
    const btn = await screen.findByRole("button", { name: "Vincular Telegram" });
    await act(async () => { fireEvent.click(btn); });
    const code = await screen.findByTestId("telegram-code");
    expect(code).toHaveTextContent("K7P2QX9M");
    expect(within(code).getByRole("link", { name: "Abrir @IatosBot" })).toHaveAttribute("href", "https://t.me/IatosBot?start=K7P2QX9M");
    expect(invoke).toHaveBeenCalledWith("canales", { body: { accion: "codigo" } });
  });

  it("vinculado: muestra la cuenta y permite desvincular; solo un administrador ve «Conectar el bot»", async () => {
    invoke.mockResolvedValue({ data: { ok: true, telegram: { activo: true, bot: "IatosBot", vinculado: true, usuario: "ana_viaja" } }, error: null });
    const { rerender } = render(<TelegramLink />);
    expect(await screen.findByText(/Vinculado como @ana_viaja/)).toBeInTheDocument();
    expect(screen.queryByText(/Conectar el bot/)).toBeNull();
    rerender(<TelegramLink isAdmin />);
    expect(screen.getByText(/Conectar el bot/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desvincular" })); });
    expect(invoke).toHaveBeenCalledWith("canales", { body: { accion: "desvincular" } });
  });
});

const EVENTS = [
  { id: 1, at: "2026-10-29T15:00:00Z", kind: "creado", actor: "usuario", channel: "app", direction: "entrante", body: "Estoy en Roma y el hotel dice que no tengo reserva" },
  { id: 2, at: "2026-10-29T15:01:00Z", kind: "accion", actor: "iato_ops", direction: "interno", body: "buscar_contacto_proveedor: hecho", data: { operador: { herramienta: "buscar_contacto_proveedor", ok: true, gasto_usd: 0.012 } } },
  { id: 3, at: "2026-10-29T15:01:10Z", kind: "accion", actor: "iato_ops", direction: "interno", body: "escribir_proveedor: sale ahora", data: { operador: { herramienta: "escribir_proveedor", ok: true, gasto_usd: 0.024 } } },
  { id: 4, at: "2026-10-29T15:01:20Z", kind: "mensaje", actor: "iato_ops", channel: "app", direction: "saliente", body: "Le escribí al hotel.", data: { operador: { herramienta: "escribir_viajero" } } },
  { id: 5, at: "2026-10-29T15:01:30Z", kind: "accion", actor: "iato_ops", direction: "interno", body: "escribir_viajero: hecho", data: { operador: { herramienta: "escribir_viajero", ok: true, gasto_usd: 0.031 } } },
  { id: 6, at: "2026-10-29T15:02:00Z", kind: "decision", actor: "iato_ops", direction: "interno", body: "Pasa a una persona: Tope de acciones del caso", data: { operador: { escalado: true, motivo: "Tope de acciones del caso", gasto_usd: 0.031 } } },
];

describe("Mesa: bitácora del operador", () => {
  it("resumen del operador (acciones, gasto, si pasó a una persona) y cada acción con su nombre en español", async () => {
    expect(operatorSummary(EVENTS)).toMatchObject({ acciones: 3, gastoUsd: 0.031, escalado: true, motivo: "Tope de acciones del caso" });
    rpc.mockImplementation(async (fn: string) => fn === "admin_incident_log" ? { data: { events: EVENTS }, error: null } : { data: null, error: null });
    const it = {
      source: "concierge_request", id: "99999999-9999-4999-8999-999999999999", type: "incidente", title: "Problema con el hotel", status: "solicitado", stage: "nueva",
      created_at: "2026-10-29T15:00:00Z", user: { name: "Ana Viajera", email: "ana@correo.mx" }, owner: null, history: [], replies: [],
      payload: { categoria: "hotel_problema", severidad: "alta", descripcion: "El hotel dice que no tengo reserva", ubicacion: { ciudad: "Roma", zona_horaria: "Europe/Rome" } },
      incident: { category: "hotel_problema", severity: "alta", semaforo: "verde", assignee: "iato_ops", escalation_level: 0, events_count: 6 },
    };
    render(<MemoryRouter><IncidentOpsCard it={it as never} highlight={false} onDone={() => {}} /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByTestId("incident-log-toggle")); });
    const resumen = await screen.findByTestId("operator-summary");
    expect(resumen).toHaveTextContent("Operador IA · 3 acciones · gasto en IA US$0.031");
    expect(resumen).toHaveTextContent("Pasó a una persona: Tope de acciones del caso");
    const log = screen.getByTestId("incident-log");
    expect(log).toHaveTextContent("Operador IA · Escribió al proveedor · sale ahora");
    expect(log).toHaveTextContent("Operador IA · app → · Le escribí al hotel.");
  });
});

describe("el mensaje del viajero despierta al operador", () => {
  it("después de guardar el mensaje, llama a la función operador con su caso (sin esperarla)", async () => {
    rpc.mockResolvedValue({ data: { ok: true, event_id: 9 }, error: null });
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const r = await messageIncident("99999999-9999-4999-8999-999999999999", "  ¿Hay noticias?  ");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("my_incident_message", { _id: "99999999-9999-4999-8999-999999999999", _text: "¿Hay noticias?" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("operador", { body: { incident_id: "99999999-9999-4999-8999-999999999999" } }));
    // Si no se guardó, no se despierta a nadie.
    invoke.mockClear();
    rpc.mockResolvedValue({ data: { ok: false, code: "RATE_LIMITED" }, error: null });
    expect((await messageIncident("99999999-9999-4999-8999-999999999999", "hola")).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
