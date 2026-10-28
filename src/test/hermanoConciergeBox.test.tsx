// Defecto 1 (E2E 28-oct-2026, hermano del dueño en su celular): en Inicio, la caja "CONCIERGE IATO" con
// "¿qué clima hará en mi viaje a Madrid?" abría el planificador ("Tu viaje, como lo entendimos…"). Ahora
// las preguntas abren el chat de Iato con el mensaje YA enviado; solo lo que pide armar un viaje va al
// planificador.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { conciergeBoxHref, routeConciergeBox } from "@/lib/conciergeBoxRoute";
import { VIAJE } from "./fixtures/conciergeHuixquilucan";
import { localISODate } from "@/lib/localDate";

describe("routeConciergeBox", () => {
  it.each([
    "¿qué clima hará en mi viaje a Madrid?",
    "qué clima hará en mi viaje a Madrid",
    "¿Dónde ceno hoy en Roma?",
    "recomiéndame un restaurante cerca del hotel",
    "qué hago el sábado en Valle de Bravo",
    "¿Cuánto cuesta el metro en Madrid?",
    "hola",
    "Madrid",
  ])("pregunta o duda → chat de Iato: %s", (t) => {
    expect(routeConciergeBox(t)).toBe("chat");
  });

  it.each([
    "Quiero ir a Oaxaca en diciembre",
    "arma un viaje a Roma y Florencia",
    "Ármame un viaje de 5 días a Lisboa",
    "¿Me armas un viaje a Tokio?",
    "Oaxaca 4 días en diciembre, 2 personas",
    "planea mi luna de miel en Grecia",
  ])("pide armar un viaje → planificador: %s", (t) => {
    expect(routeConciergeBox(t)).toBe("plan");
  });

  it("la ruta del chat lleva el mensaje para enviarlo; la del planificador, el texto a interpretar", () => {
    expect(conciergeBoxHref("¿qué clima hará en mi viaje a Madrid?")).toBe(`/dashboard/concierge?enviar=${encodeURIComponent("¿qué clima hará en mi viaje a Madrid?")}`);
    expect(conciergeBoxHref("Quiero ir a Oaxaca")).toBe(`/dashboard/planear?q=${encodeURIComponent("Quiero ir a Oaxaca")}`);
  });
});

// ── El chat recibe ?enviar=… y lo manda solo (una vez) ──
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
const stream = vi.hoisted(() => ({ fn: vi.fn(async (_req: any, cb: any) => { cb.onFinal?.({ text: "En Madrid se esperan 14 °C." }); }) }));
vi.mock("@/lib/conciergeStream", () => ({ streamConcierge: stream.fn, incompleteReplyText: (t: string, m: string) => t || m }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, order: () => chain, eq: () => chain, is: () => chain,
      limit: () => (table === "concierge_conversations" ? chain : Promise.resolve({ data: [{ ...(globalThis as any).__trip }], error: null })),
      maybeSingle: async () => ({ data: null, error: null }),
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

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

beforeEach(() => {
  (globalThis as any).__trip = { ...VIAJE, fecha_salida: localISODate() };
  stream.fn.mockClear();
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: any, err: any) => err?.({ code: 1 }) } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Concierge con ?enviar=", () => {
  it("envía la pregunta de Inicio sola, una vez, y la quita de la URL", async () => {
    const q = "¿qué clima hará en mi viaje a Madrid?";
    render(
      <MemoryRouter initialEntries={[`/dashboard/concierge?enviar=${encodeURIComponent(q)}`]}>
        <Routes><Route path="/dashboard/concierge" element={<><Concierge /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(stream.fn).toHaveBeenCalledTimes(1));
    const body = (stream.fn.mock.calls[0][0] as any).body;
    expect(body.messages.at(-1)).toEqual({ role: "user", content: q });
    expect(await screen.findByText("En Madrid se esperan 14 °C.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard/concierge"));
    expect(stream.fn).toHaveBeenCalledTimes(1);
  });

  it("?ask= (Privé) sigue sin enviarse solo: solo prellena", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/concierge?ask=Hola"]}><Concierge /></MemoryRouter>);
    await screen.findByDisplayValue("Hola");
    await new Promise((r) => setTimeout(r, 50));
    expect(stream.fn).not.toHaveBeenCalled();
  });
});
