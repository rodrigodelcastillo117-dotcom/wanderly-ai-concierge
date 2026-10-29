// Auditoría 10, ronda 4, N4-P1-4: al recargar desaparecían "¿Qué hora es en Tokio?" y "eventos en Madrid"
// (hilo sin viaje) y el chofer (hilo de Oaxaca): el chat solo cargaba el hilo del viaje fijado, y además salía
// "Conversación anterior resumida…", que hacía creer que se habían resumido. Ahora se ven los hilos
// recientes en orden, con la etiqueta del viaje en cada bloque, y al modelo solo va el hilo del viaje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { localISODate } from "@/lib/localDate";
import {
  historyForModel, loadRecentConversations, mergeThreads, restoreThread, summaryNotice, threadLabels, SUMMARY_NOTICE_TEXT,
} from "@/lib/conciergeHistory";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ConciergeActions", () => ({ ConciergeActions: () => null }));
vi.mock("@/components/FlightStatusDialog", () => ({ FlightStatusDialog: () => null }));
vi.mock("@/components/TravelerAvatar", () => ({ TravelerAvatar: () => null }));
vi.mock("@/components/MembersOnlyPanel", () => ({ MembersOnlyPanel: () => null }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => null }));
const AUTH = vi.hoisted(() => ({ user: { id: "u1" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ loading: false, isPro: true, isTrialing: false, trialDaysLeft: null, access: null }),
  notifyAccessChanged: () => {},
}));
vi.mock("@/lib/profileActiveTrip", () => ({ readPinnedTrip: async () => "vb", savePinnedTrip: async () => null }));
const stream = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/conciergeStream", () => ({ streamConcierge: (...a: unknown[]) => stream.fn(...a), incompleteReplyText: (t: string, m: string) => t || m }));

const at = (hhmm: string) => `${localISODate()}T${hhmm}:00`;
const VB = { id: "vb", destino: "Valle de Bravo", fecha_salida: "2099-10-30", fecha_regreso: "2099-11-01", vuelos_json: [], hospedaje_json: [] };
const OAX = { id: "oax", destino: "Oaxaca", fecha_salida: "2100-01-15", fecha_regreso: "2100-01-18", vuelos_json: [], hospedaje_json: [] };
// Filas de concierge_conversations como las dejó la ronda 4 (una por hilo, la más reciente primero).
const ROWS = [
  { trip_id: "vb", resumen_historico: "- Viaja a Valle de Bravo", resumen_actualizado_at: "2026-10-29T05:51:21Z", messages: [
    { role: "user", content: "Registra un café de 120", timestamp: at("03:00") },
    { role: "assistant", content: "Listo para registrar el gasto.", timestamp: at("03:00") },
  ] },
  { trip_id: null, resumen_historico: null, resumen_actualizado_at: null, messages: [
    { role: "user", content: "¿Qué hora es en Tokio?", timestamp: at("02:54") },
    { role: "assistant", content: "En Tokio son las 17:54.", timestamp: at("02:54") },
    { role: "user", content: "Eventos en Madrid este fin", timestamp: at("02:58") },
    { role: "assistant", content: "Para Madrid: Morat en Movistar Arena.", timestamp: at("02:58") },
  ] },
  { trip_id: "oax", resumen_historico: null, resumen_actualizado_at: null, messages: [
    { role: "user", content: "Quiero un chofer en Oaxaca a Hierve el Agua", timestamp: at("02:56") },
    { role: "assistant", content: "Puedo pedir un chofer privado.", timestamp: at("02:56") },
  ] },
];

const db = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const conv: any = {
      select: () => conv, order: () => conv,
      eq: (k: string, v: unknown) => { filters[k] = v; return conv; },
      is: (k: string) => { filters[k] = null; return conv; },
      limit: () => conv,
      maybeSingle: async () => ({ data: db.rows.find((r) => "trip_id" in filters ? (r.trip_id ?? null) === filters.trip_id : true) ?? null, error: null }),
      then: (ok: any, ko: any) => Promise.resolve({ data: db.rows, error: null }).then(ok, ko),
    };
    const other: any = { select: () => other, order: () => other, eq: () => other, is: () => other,
      limit: () => Promise.resolve({ data: [(globalThis as any).__vb, (globalThis as any).__oax], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
    return table === "concierge_conversations" ? conv : other;
  };
  return {
    supabase: {
      from, rpc: async () => ({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }), signOut: async () => {} },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {},
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    },
  };
});

import Concierge from "@/pages/Concierge";

beforeEach(() => {
  (globalThis as any).__vb = VB; (globalThis as any).__oax = OAX;
  db.rows = ROWS;
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: any, err: any) => err?.({ code: 1 }) } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  stream.fn.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("N4-P1-4 · los hilos recientes, juntos y en orden", () => {
  it("se mezclan por hora; cada mensaje sabe de qué hilo viene y el aviso de resumen va antes de su hilo", () => {
    const merged = mergeThreads(ROWS.map((r) => restoreThread(r)));
    expect(merged.filter((m) => !m.notice).map((m) => m.text)).toEqual([
      "¿Qué hora es en Tokio?", "En Tokio son las 17:54.",
      "Quiero un chofer en Oaxaca a Hierve el Agua", "Puedo pedir un chofer privado.",
      "Eventos en Madrid este fin", "Para Madrid: Morat en Movistar Arena.",
      "Registra un café de 120", "Listo para registrar el gasto.",
    ]);
    expect(merged.map((m) => m.thread)).toEqual([null, null, "oax", "oax", null, null, "vb", "vb", "vb"]);
    const n = merged.findIndex((m) => m.notice);
    expect(merged[n + 1].text).toBe("Registra un café de 120");
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
  });
  it("una etiqueta al empezar cada bloque de otro hilo; con un solo hilo, ninguna", () => {
    const merged = mergeThreads(ROWS.map((r) => restoreThread(r)));
    const labels = threadLabels(merged);
    expect([...labels.values()]).toEqual([null, "oax", null, "vb"]);
    expect(threadLabels(mergeThreads([restoreThread(ROWS[1])])).size).toBe(0);
    // Mensajes nuevos de la sesión: el bloque toma el viaje de la respuesta.
    const live = [...merged, { id: "u-new", role: "user" as const }, { id: "a-new", role: "assistant" as const, tripId: "vb" }];
    expect(threadLabels(live).has("u-new")).toBe(false);
  });
  it("al modelo solo van los mensajes restaurados del hilo del viaje (su memoria sigue por viaje)", () => {
    const merged = mergeThreads(ROWS.map((r) => restoreThread(r)));
    const forVb = historyForModel([...merged, { id: "new", role: "user", text: "otra" } as any], "vb");
    expect(forVb.filter((m) => !m.notice).map((m: any) => m.text)).toEqual(["Registra un café de 120", "Listo para registrar el gasto.", "otra"]);
  });
  it("'Conversación anterior resumida' solo con un resumen de verdad (fechado)", () => {
    expect(summaryNotice("- algo", null)).toBeNull();
    expect(summaryNotice("- algo", "2026-10-29T05:51:21Z")).toMatchObject({ notice: true, text: SUMMARY_NOTICE_TEXT });
    expect(mergeThreads([restoreThread({ ...ROWS[0], resumen_actualizado_at: null })]).some((m) => m.notice)).toBe(false);
  });
  it("loadRecentConversations nunca lanza: si la lista falla, queda el hilo del viaje", async () => {
    const api: any = { select: () => api, eq: () => api, is: () => api, order: () => api,
      limit: () => ({ ...api, then: (_ok: any, ko: any) => Promise.reject(new Error("boom")).then(_ok, ko) }),
      maybeSingle: async () => ({ data: ROWS[0], error: null }) };
    const msgs = await loadRecentConversations({ from: () => api }, "u1", "vb");
    expect(msgs.filter((m) => !m.notice).map((m) => m.text)).toEqual(["Registra un café de 120", "Listo para registrar el gasto."]);
  });

  it("al recargar se ven Tokio, Madrid y el chofer, con 'Sin viaje', 'Oaxaca · …' y 'Valle de Bravo · …'; el modelo recibe solo el hilo de Valle", async () => {
    render(<MemoryRouter><Concierge /></MemoryRouter>);
    expect(await screen.findByText("¿Qué hora es en Tokio?")).toBeInTheDocument();
    expect(screen.getByText("Quiero un chofer en Oaxaca a Hierve el Agua")).toBeInTheDocument();
    expect(screen.getByText("Eventos en Madrid este fin")).toBeInTheDocument();
    const labels = screen.getAllByTestId("thread-label").map((l) => l.textContent);
    expect(labels).toEqual(["Sin viaje", "Oaxaca · 15–18 ene", "Sin viaje", "Valle de Bravo · 30 oct–1 nov"]);
    expect(screen.getAllByTestId("history-summary-notice")).toHaveLength(1);
    // Al mandar, el modelo solo recibe lo del hilo de Valle de Bravo (más el mensaje nuevo).
    stream.fn.mockImplementation(async (_req: unknown, h: any) => { h.onFinal({ text: "ok", _trip_id: "vb" }); });
    const input = screen.getByRole("textbox", { name: "Mensaje para Iato" });
    fireEvent.change(input, { target: { value: "¿Y el clima?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(stream.fn).toHaveBeenCalled());
    const sent = (stream.fn.mock.calls[0][0] as any).body.messages.map((m: any) => m.content);
    expect(sent).toEqual(["Registra un café de 120", "Listo para registrar el gasto.", "¿Y el clima?"]);
  });
});
