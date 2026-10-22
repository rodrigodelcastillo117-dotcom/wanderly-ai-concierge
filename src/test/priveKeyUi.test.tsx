// Pantalla de THE PRIVÉ KEY (/prive/key) de punta a punta en jsdom: la UI llama a concierge-chat (mode
// prive_key) y aquí ese "servidor" es el runPriveKey real con el catálogo de la curaduría (fixture). Sin IA.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import fixture from "./fixtures/priveKeyCatalog.json";
import { memoryCache, runPriveKey } from "../../supabase/functions/concierge-chat/priveKeyMode";
import { findKeyClaims } from "../../supabase/functions/_shared/priveKey";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
const TRIP = { id: "11111111-1111-4111-8111-111111111111", destino: "Ciudad de México", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-24" };
vi.mock("@/hooks/useActiveTrip", () => ({ useActiveTrip: () => ({ trips: [TRIP], trip: TRIP, resolved: { trip: TRIP, reason: "single_upcoming", candidates: [TRIP] }, loading: false }) }));
const content = vi.fn();
const access = { session: { token: "ps-token" }, content, unlocked: true, view: "unlocked", loading: false, status: { first_name: "Ana", onboarding: {} } };
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => access }));

import PriveKeyPage from "@/pages/prive/PriveKeyPage";

const TODAY = "2026-10-22";
let cache = memoryCache();
let serverCalls = 0;
function server() {
  invoke.mockImplementation(async (name: string, opts: { body: any; headers?: Record<string, string> }) => {
    if (name === "pexels-image") return { data: null, error: { message: "sin red" } }; // servicio de fotos caído: respaldo editorial
    if (name !== "concierge-chat") return { data: null, error: { message: "inesperado" } };
    serverCalls++;
    const out = await runPriveKey(opts.body, {
      userId: "u1", priveSession: opts.headers?.["x-prive-session"], trips: [], pinnedId: null, todayISO: TODAY, cache, hitDaily: async () => true,
      rpc: async () => ({ data: { available: true, cities: [{ resolved: true, city: (fixture as any).cities.cdmx.city, coverage: "COBERTURA_PARCIAL", items: (fixture as any).cities.cdmx.items }] }, error: null }),
    });
    return out.status === 200 ? { data: out.body, error: null } : { data: null, error: { context: { status: out.status, json: async () => out.body, clone() { return this; } } } };
  });
}

const renderPage = (path = "/prive/key") => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/prive/key" element={<PriveKeyPage />} /><Route path="/prive" element={<p>candado</p>} /></Routes></MemoryRouter>,
);

const setLang = (l: string) => { Object.defineProperty(window.navigator, "languages", { value: [l], configurable: true }); Object.defineProperty(window.navigator, "language", { value: l, configurable: true }); };
beforeEach(() => {
  setLang("es-MX");
  invoke.mockReset(); content.mockReset(); cache = memoryCache(); serverCalls = 0; server();
  content.mockImplementation(async (fn: string) => {
    if (fn === "prive_key_save") return { ok: true, data: { ok: true, id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" } };
    if (fn === "prive_key_add_to_trip") return { ok: true, data: { ok: true, added: 2 } };
    if (fn === "prive_key_plans") return { ok: true, data: [] };
    return { ok: true, data: true };
  });
});

describe("/prive/key", () => {
  it("escribir no llama a nadie (ni IA ni servidor por tecla); solo al enviar", async () => {
    renderPage();
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Quiero una noche inolvidable con mi pareja" } });
    fireEvent.change(box, { target: { value: "Quiero una noche inolvidable con mi pareja en" } });
    expect(serverCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Abrir con The Key" }));
    await screen.findByTestId("pk-questions");
    expect(serverCalls).toBe(1);
  });

  it("pregunta solo lo que falta y con las respuestas muestra THE SIGNATURE, THE INSIDER y THE UNEXPECTED sin afirmar reservas", async () => {
    renderPage();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Quiero una noche inolvidable con mi pareja" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir con The Key" }));
    const q = await screen.findByTestId("pk-questions");
    expect([...q.querySelectorAll("[data-question]")].map((x) => x.getAttribute("data-question"))).toEqual(["destination", "date", "budget"]);
    fireEvent.click(within(q).getByRole("radio", { name: "Ciudad de México" }));
    fireEvent.click(within(q).getByRole("radio", { name: "Mañana" }));
    fireEvent.click(within(q).getByRole("radio", { name: "Sin tope fijo" }));
    fireEvent.click(within(q).getByRole("button", { name: "Ver propuestas" }));
    const results = await screen.findByTestId("pk-results");
    for (const tier of ["signature", "insider", "unexpected"]) expect(within(results).getByTestId(`pk-proposal-${tier}`)).toBeInTheDocument();
    expect(within(results).getByText("THE SIGNATURE")).toBeInTheDocument();
    expect(within(results).getAllByText(/Disponibilidad no consultada/).length).toBeGreaterThan(0);
    expect(findKeyClaims(results.textContent ?? "")).toEqual([]);
    // primera opción útil medida
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_key_track", expect.objectContaining({ _event: "first_option", _props: expect.objectContaining({ ms: expect.any(Number) }) })));
  });

  it("guardar manda solo referencias; agregar al viaje usa el viaje correcto y el itinerario existente", async () => {
    renderPage("/prive/key?w=" + encodeURIComponent("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado"));
    const sig = await screen.findByTestId("pk-proposal-signature");
    fireEvent.click(within(sig).getByRole("button", { name: /Guardar plan/ }));
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_key_save", expect.anything()));
    const payload = content.mock.calls.find((c) => c[0] === "prive_key_save")![1]._plan;
    expect(payload.tier).toBe("signature");
    const allowed = new Set(["date", "end", "experience_id", "intent", "start", "start_iso", "time_status", "transfer_min"]);
    expect(Object.keys(payload.steps[0]).every((k) => allowed.has(k))).toBe(true);
    expect(payload.steps[0].experience_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(payload)).not.toMatch(/"name"/);
    await within(sig).findByRole("button", { name: /Plan guardado/ });
    fireEvent.click(within(sig).getByRole("button", { name: /Agregar al viaje/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio")).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Agregar a este viaje" }));
    await waitFor(() => expect(content).toHaveBeenCalledWith("prive_key_add_to_trip", { _plan_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", _trip_id: TRIP.id }));
    await within(sig).findByRole("button", { name: /En tu viaje · sin reservar/ });
  });

  it("enlaces reales de reserva por el Booking Bridge (página oficial del lugar), sin 'Comprar esta oferta'", async () => {
    renderPage("/prive/key?w=" + encodeURIComponent("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado"));
    const sig = await screen.findByTestId("pk-proposal-signature");
    fireEvent.click(within(sig).getAllByRole("button", { name: /Cómo reservar/ })[0]);
    const box = await within(sig).findByTestId("pk-booking");
    expect(box.textContent).not.toMatch(/Comprar esta oferta/);
    expect(within(box).getAllByRole("button").length + within(box).queryAllByRole("link").length).toBeGreaterThan(0);
  });

  it("Pregúntale a Iato abre el Concierge de siempre con la pregunta lista (no otro chatbot, no la envía)", async () => {
    renderPage("/prive/key?w=" + encodeURIComponent("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado"));
    const sig = await screen.findByTestId("pk-proposal-signature");
    const link = within(sig).getByRole("link", { name: /Pregúntale a Iato/ });
    expect(link.getAttribute("href")).toMatch(/^\/dashboard\/concierge\?ask=/);
  });

  it("Sorpréndeme: una sola experiencia y 'Otra sorpresa' excluye la anterior", async () => {
    renderPage("/prive/key?w=" + encodeURIComponent("Sorpréndeme en CDMX esta noche"));
    await screen.findByTestId("pk-proposal-unexpected");
    expect(screen.getByText("SURPRISE ME")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Otra sorpresa/ }));
    await waitFor(() => expect(serverCalls).toBe(2));
    const body = invoke.mock.calls.filter((c) => c[0] === "concierge-chat")[1][1].body;
    expect(body.exclude.length).toBe(1);
  });

  it("límite diario: mensaje claro, sin propuestas", async () => {
    invoke.mockImplementation(async (name: string) => name === "concierge-chat"
      ? { data: null, error: { context: { status: 429, json: async () => ({ ok: false, code: "KEY_DAILY_LIMIT" }), clone() { return this; } } } }
      : { data: null, error: { message: "x" } });
    renderPage("/prive/key?w=" + encodeURIComponent("Aniversario en CDMX el sábado para 2 sin tope"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/límite de planes nuevos/);
  });

  it("en inglés si el navegador está en inglés (marca en inglés, interfaz en inglés)", async () => {
    setLang("en-US");
    renderPage();
    expect(screen.getByRole("button", { name: "Open with The Key" })).toBeInTheDocument();
    expect(screen.getByText("THE PRIVÉ KEY")).toBeInTheDocument();
  });

  it("sin Privé desbloqueado, vuelve a /prive", async () => {
    access.view = "locked";
    renderPage();
    expect(await screen.findByText("candado")).toBeInTheDocument();
    access.view = "unlocked";
  });
});
