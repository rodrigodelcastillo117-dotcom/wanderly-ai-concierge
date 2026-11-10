// Recorrido 9-nov-2026: abrir Iato desde el viaje familiar a Cancún contestaba del viaje fijado a Japón.
// /dashboard/concierge?viaje=<id> fija ESE viaje (si es uno de los del usuario) sin cambiar nada visible.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VIAJE } from "./fixtures/conciergeHuixquilucan";
import { localISODate } from "@/lib/localDate";

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
const pin = vi.hoisted(() => ({ save: vi.fn(async () => null) }));
vi.mock("@/lib/profileActiveTrip", () => ({ readPinnedTrip: async () => "japon", savePinnedTrip: pin.save }));
vi.mock("@/lib/conciergeStream", () => ({ streamConcierge: vi.fn(), incompleteReplyText: (t: string, m: string) => t || m }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, order: () => chain, eq: () => chain, is: () => chain,
      limit: () => (table === "concierge_conversations" ? chain : Promise.resolve({ data: (globalThis as any).__trips, error: null })),
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

beforeEach(() => {
  const hoy = localISODate();
  (globalThis as any).__trips = [
    { ...VIAJE, id: "japon", destino: "Tokio", fecha_salida: hoy },
    { ...VIAJE, id: "cancun", destino: "Cancún", fecha_salida: hoy },
  ];
  pin.save.mockClear();
  localStorage.setItem("iatos_concierge_trip", "japon");
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: any, err: any) => err?.({ code: 1 }) } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

describe("Concierge ?viaje=", () => {
  it("fija el viaje del enlace aunque había otro fijado", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/concierge?viaje=cancun"]}><Concierge /></MemoryRouter>);
    await waitFor(() => expect(pin.save).toHaveBeenCalledWith("u1", "cancun"));
    expect(localStorage.getItem("iatos_concierge_trip")).toBe("cancun");
  });

  it("un id que no es del usuario no cambia nada", async () => {
    render(<MemoryRouter initialEntries={["/dashboard/concierge?viaje=ajeno"]}><Concierge /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 300));
    expect(pin.save).not.toHaveBeenCalled();
    expect(localStorage.getItem("iatos_concierge_trip")).toBe("japon");
  });
});
