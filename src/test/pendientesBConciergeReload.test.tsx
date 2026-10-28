// Pendiente E2E 28-oct-2026: recargar el chat de Iato borraba las tarjetas. Se dibuja la pantalla
// real (Concierge.tsx) con el historial guardado (cards incluidas) y se revisa que las tarjetas
// vuelvan con sus botones y que el precio de hace horas salga como "precio guardado", no "en vivo".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VIAJE } from "./fixtures/conciergeHuixquilucan";
import { localISODate } from "@/lib/localDate";
import { cardsForStorage } from "../../supabase/functions/concierge-chat/storedCards.ts";

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
vi.mock("@/lib/conciergeStream", () => ({ streamConcierge: vi.fn(), incompleteReplyText: (t: string, m: string) => t || m }));

// Fila de concierge_conversations tal como la deja concierge-chat (messages jsonb con cards).
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const stored = () => [
  { role: "user", content: "¿Dónde ceno hoy y qué vuelo hay a Madrid?", timestamp: hace(181) },
  {
    role: "assistant", content: "Esto es lo que encontré:", timestamp: hace(180),
    cards: cardsForStorage([
      { type: "flight", title: "Aeroméxico", subtitle: "MEX → MAD", price: 937, price_usd: 937, currency: "USD", fuente: "serpapi",
        estado_dato: "CONSULTADO_EN_VIVO", consultado_at: hace(180), cta_label: "Comprar", cta_action: "https://www.google.com/travel/flights/booking?tfs=abc" },
      { type: "restaurant", title: "Contramar", subtitle: "Roma Norte", fuente: "google_maps",
        links: [{ kind: "call", label: "Llamar", url: "tel:+525555143169" }, { kind: "website", label: "Reservar en su sitio", url: "https://contramar.com.mx/" }] },
    ], hace(180)),
  },
];
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
      from,
      auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }), signOut: async () => {} },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
      functions: { invoke: vi.fn() },
    },
  };
});

import Concierge from "@/pages/Concierge";

beforeEach(() => {
  (globalThis as any).__trip = { ...VIAJE, fecha_salida: localISODate() };
  conv.rows = stored();
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: any, err: any) => err?.({ code: 1 }) } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Concierge: al recargar vuelven las tarjetas", () => {
  it("las cards del historial se pintan con sus botones; el precio de hace 3 h dice 'Precio guardado', no 'en vivo'", async () => {
    render(<MemoryRouter><Concierge /></MemoryRouter>);
    const cards = await screen.findByTestId("bubble-cards");
    expect(within(cards).getByText("Aeroméxico")).toBeInTheDocument();
    expect(within(cards).getByText("Contramar")).toBeInTheDocument();
    expect(within(cards).getByText(/Precio guardado/)).toBeInTheDocument();
    expect(cards.textContent).not.toMatch(/en vivo/i);
    const hrefs = [...cards.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["tel:+525555143169", "https://contramar.com.mx/"]));
    // El texto del turno también sigue ahí.
    expect(screen.getByText("Esto es lo que encontré:")).toBeInTheDocument();
  });
});
