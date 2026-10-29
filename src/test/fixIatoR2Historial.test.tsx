// Auditoría 10, ronda 2: N7 (al recargar desaparecían las tarjetas de acción y quedaba "Te dejo el botón"
// sin botón ni el estado "Gasto registrado"), N5 (la etiqueta de lugar decía "sobre Valle de Bravo"
// mientras se escribía) y cuenta P2-12 (enlaces de reserva con fecha vencida en el historial).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VIAJE } from "./fixtures/conciergeHuixquilucan";
import { localISODate } from "@/lib/localDate";
import { actionsForStorage, cardsForStorage, markStoredAction, dropPastDateFromLink } from "../../supabase/functions/concierge-chat/storedCards.ts";
import { restoreConversation, withoutMissingButton, BUTTON_GONE } from "@/lib/conciergeHistory";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ConciergeActions", () => ({ ConciergeActions: () => null }));
vi.mock("@/components/FlightStatusDialog", () => ({ FlightStatusDialog: () => null }));
vi.mock("@/components/TravelerAvatar", () => ({ TravelerAvatar: () => null }));
vi.mock("@/components/MembersOnlyPanel", () => ({ MembersOnlyPanel: () => null }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => null }));
const AUTH = { user: { id: "u1" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ loading: false, isPro: true, isTrialing: false, trialDaysLeft: null, access: null }),
  notifyAccessChanged: () => {},
}));
vi.mock("@/lib/profileActiveTrip", () => ({ readPinnedTrip: async () => undefined, savePinnedTrip: async () => null }));
const stream = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/conciergeStream", () => ({ streamConcierge: (...a: unknown[]) => stream.fn(...a), incompleteReplyText: (t: string, m: string) => t || m }));

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const GASTO = { id: "08638d14-dddd-4f84-b6f5-af9c2f3e5050", type: "add_expense", params: { monto: 150, moneda: "MXN", categoria: "Restaurantes", fecha: "2026-10-28", trip_id: "t1", descripcion: "café" },
  summary: "Registrar gasto: $150.00 · Restaurantes · café", confirm_label: "Registrar gasto", runs: "server" };
const ITIN = { id: "e837f207-2e1a-4c04-9208-42b0f147377f", type: "add_itinerary_item", params: { trip_id: "t1", fecha: "2026-10-31", titulo: "Mirador La Peña", hora: "17:00" },
  summary: "Agregar a tu viaje: Mirador La Peña · sáb 31 oct 17:00", confirm_label: "Agregar", runs: "server" };

const conv = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, order: () => chain, eq: () => chain, is: () => chain,
      limit: () => (table === "concierge_conversations" ? chain : Promise.resolve({ data: [{ ...(globalThis as any).__trip }], error: null })),
      maybeSingle: async () => (table === "concierge_conversations" ? { data: { messages: conv.rows, updated_at: new Date().toISOString() }, error: null } : { data: null, error: null }),
    };
    return chain;
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
  (globalThis as any).__trip = { ...VIAJE, fecha_salida: localISODate() };
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: any, err: any) => err?.({ code: 1 }) } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  stream.fn.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("N7 · historial: las acciones vuelven con su estado", () => {
  it("se guardan con el turno; al confirmar se marca 'hecho' en el historial", () => {
    const stored = actionsForStorage([GASTO, ITIN])!;
    expect(stored.map((a) => a.id)).toEqual([GASTO.id, ITIN.id]);
    const msgs = [{ role: "assistant", content: "Te dejo el botón para confirmarlo.", actions: stored }];
    const marked = markStoredAction(msgs, GASTO.id, { message: "Gasto registrado: $150 MXN en Restaurantes.", link: "/dashboard/gastos" })!;
    expect((marked[0] as any).actions[0]).toMatchObject({ estado: "hecho", resultado: "Gasto registrado: $150 MXN en Restaurantes.", enlace: "/dashboard/gastos" });
    expect((marked[0] as any).actions[1].estado).toBeUndefined();
    expect(markStoredAction(msgs, "no-existe-0000", { message: "x" })).toBeNull();
  });
  it("al recargar: la confirmada sale hecha (sin botón) y la pendiente con su botón", async () => {
    const marked = markStoredAction([{ role: "assistant", content: "Listo para registrar el gasto. Te dejo el botón para confirmarlo; no se guarda hasta que lo apruebes.", timestamp: hace(30), actions: actionsForStorage([GASTO]) }], GASTO.id, { message: "Gasto registrado: $150 MXN en Restaurantes." })!;
    conv.rows = [
      { role: "user", content: "Registra un gasto de 150", timestamp: hace(31) }, ...marked,
      { role: "user", content: "agrega el mirador", timestamp: hace(20) },
      { role: "assistant", content: "Puedo agregar el Mirador La Peña. Te dejo el botón para confirmarlo.", timestamp: hace(19), actions: actionsForStorage([ITIN]) },
    ];
    render(<MemoryRouter><Concierge /></MemoryRouter>);
    const boxes = await screen.findAllByTestId("bubble-actions");
    expect(boxes.length).toBe(2);
    expect(within(boxes[0]).getByText("Gasto registrado: $150 MXN en Restaurantes.")).toBeInTheDocument();
    expect(within(boxes[0]).queryByRole("button", { name: /Registrar gasto/ })).toBeNull();
    expect(within(boxes[1]).getByRole("button", { name: /Agregar/ })).toBeInTheDocument();
  });
  it("una respuesta vieja sin acción guardada ya no promete un botón que no está", () => {
    const r = restoreConversation([{ role: "assistant", content: "Lo preparé para tu viaje. Te dejo el botón para confirmarlo; no se guarda hasta que lo apruebes.", timestamp: hace(5) }], 20, Date.now(), "2026-10-29");
    expect(r[0].text).toBe(`Lo preparé para tu viaje. ${BUTTON_GONE}`);
    expect(withoutMissingButton("Sin botones aquí.")).toBe("Sin botones aquí.");
  });
});

describe("Cuenta P2-12 · enlaces de reserva con fecha vencida en el historial", () => {
  it("OpenTable con dateTime pasado pierde la fecha; uno futuro se queda", () => {
    expect(dropPastDateFromLink("https://www.opentable.com/s?term=Contramar&covers=2&dateTime=2026-10-20T20%3A00", "2026-10-29")).toBe("https://www.opentable.com/s?term=Contramar&covers=2");
    const fut = "https://www.opentable.com/s?term=Contramar&covers=2&dateTime=2026-11-20T20%3A00";
    expect(dropPastDateFromLink(fut, "2026-10-29")).toBe(fut);
    const r = restoreConversation([{ role: "assistant", content: "Contramar.", timestamp: hace(60 * 24 * 9), cards: cardsForStorage([{ type: "restaurant", title: "Contramar",
      links: [{ kind: "booking", label: "Buscar en OpenTable", url: "https://www.opentable.com/s?term=Contramar&covers=2&dateTime=2026-10-20T20%3A00" }] }]) }], 20, Date.now(), "2026-10-29");
    expect(r[0].cards![0].links![0].url).not.toMatch(/dateTime/);
  });
});

describe("N5 · la etiqueta de lugar es la correcta desde el primer evento", () => {
  it("mientras Iato escribe ya dice 'en Lisboa' (no 'sobre <viaje>')", async () => {
    conv.rows = [];
    let release: () => void = () => {};
    stream.fn.mockImplementation(async (_req: unknown, h: any) => {
      h.onMeta({ _trip_id: (globalThis as any).__trip.id, _place_scope: "requested", _place_label: "Lisboa", _user_position: "away" });
      h.onDelta("Estas son");
      await new Promise<void>((r) => { release = r; });
    });
    render(<MemoryRouter><Concierge /></MemoryRouter>);
    const input = await screen.findByRole("textbox");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "¿Qué atracciones imperdibles hay en Lisboa?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(stream.fn).toHaveBeenCalled());
    const labels = await screen.findAllByTestId("answer-place");
    expect(labels.some((l) => /en Lisboa/.test(l.textContent ?? ""))).toBe(true);
    expect(labels.some((l) => /sobre /.test(l.textContent ?? ""))).toBe(false);
    release();
  });
});
