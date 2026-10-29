// CANDADO · Iato y sus herramientas (29-oct-2026). Falla si desaparece una herramienta del servidor
// (vuelos, hoteles, lugares, cerca de mí, clima, hora, avisos, eventos, tours, ranking, miembros, Privé), si
// una deja de aceptar una entrada válida o de llegar al modelo, si se pierde un atajo del chat, o si la
// pantalla de Iato pierde el cuadro de mensaje o una de sus pestañas (chat, Solo para miembros, Mis
// solicitudes = mesa de operaciones). Nada sale a la red: el chat está simulado.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { HUIXQUILUCAN, VIAJE } from "./fixtures/conciergeHuixquilucan";
import { localISODate } from "@/lib/localDate";
import { TOOL_DEFS, toAnthropicTools, toOpenAiTools, validateToolInput, type JsonSchema } from "../../supabase/functions/concierge-chat/toolDefs";
import { buildChips } from "@/lib/conciergeChips";
import { HERRAMIENTAS_IATO, PESTANAS_IATO } from "./candadoInventario";

// ─── Herramientas del servidor ───────────────────────────────────────────────────────────────────────────
/** Una entrada mínima válida, construida desde el esquema de la herramienta (no a mano). */
function sample(schema: JsonSchema): unknown {
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case "number": case "integer": return schema.minimum ?? 1;
    case "boolean": return true;
    case "array": return [schema.items ? sample(schema.items) : "x"];
    case "object": return {};
    default: return "Roma";
  }
}

describe("CANDADO · herramientas de Iato (servidor)", () => {
  const nombres = TOOL_DEFS.map((t) => t.name);

  it.each(HERRAMIENTAS_IATO.map((n) => [n]))("Iato conserva la herramienta %s", (name) => {
    expect(nombres, `Iato perdió ${name}`).toContain(name);
  });

  it.each(HERRAMIENTAS_IATO.map((n) => [n]))("%s acepta una entrada válida y la rechaza si falta lo obligatorio", (name) => {
    const def = TOOL_DEFS.find((t) => t.name === name)!;
    const req = def.input_schema.required ?? [];
    const input = Object.fromEntries(req.map((k) => [k, sample(def.input_schema.properties[k])]));
    expect(validateToolInput(name, input).ok, `${name} rechaza ${JSON.stringify(input)}`).toBe(true);
    if (req.length) expect(validateToolInput(name, {}).ok).toBe(false);
    expect(def.description.length).toBeGreaterThan(20); // el modelo elige la herramienta por su descripción
  });

  it("todas llegan al modelo principal (Claude) y al de respaldo, sin nombres repetidos", () => {
    const claude = toAnthropicTools().map((t) => t.name);
    const respaldo = toOpenAiTools().map((t) => t.function.name);
    for (const n of HERRAMIENTAS_IATO) {
      expect(claude).toContain(n);
      expect(respaldo).toContain(n);
    }
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});

// ─── Atajos del chat ─────────────────────────────────────────────────────────────────────────────────────
describe("CANDADO · atajos del chat de Iato", () => {
  it("sin viaje: cena cerca, transporte, emergencia y equipaje", () => {
    const ids = buildChips(null, "2026-10-29").map((c) => c.id);
    for (const id of ["dining", "transport", "emergency", "luggage"]) expect(ids).toContain(id);
  });
  it("con viaje en curso (con vuelo): además ¿mi vuelo va a tiempo?, el plan de hoy, el clima, los gastos y «Mi viaje»", () => {
    const hoy = "2026-10-29";
    const ids = buildChips({ ...VIAJE, fecha_salida: hoy, fecha_regreso: "2026-11-05" } as any, hoy).map((c) => c.id);
    for (const id of ["flight", "day_plan", "weather", "expenses", "dining", "transport", "emergency", "luggage", "trip"]) expect(ids).toContain(id);
  });
  it("cada atajo hace algo: manda un mensaje con intención o abre una pantalla", () => {
    const hoy = "2026-10-29";
    for (const c of buildChips({ id: "t1", destino: "Roma", fecha_salida: hoy, fecha_regreso: "2026-11-05" }, hoy)) {
      expect(!!(c.text && c.intent) || !!c.opens || c.intent === "flight_status", `atajo sin acción: ${c.id}`).toBe(true);
    }
  });
});

// ─── La pantalla de Iato ────────────────────────────────────────────────────────────────────────────────
const stream = vi.fn();
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ConciergeActions", () => ({ ConciergeActions: ({ open, kind }: any) => (open ? <div data-testid="candado-accion">{kind}</div> : null) }));
vi.mock("@/components/FlightStatusDialog", () => ({ FlightStatusDialog: ({ open }: any) => (open ? <div data-testid="candado-vuelo" /> : null) }));
vi.mock("@/components/TravelerAvatar", () => ({ TravelerAvatar: () => null }));
vi.mock("@/components/MembersOnlyPanel", () => ({ MembersOnlyPanel: () => <div data-testid="candado-miembros" /> }));
vi.mock("@/components/concierge/MyTeamRequests", () => ({ MyTeamRequests: () => <div data-testid="candado-solicitudes" /> }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => <button type="button">Fixer</button> }));
const AUTH = { user: { id: "u1" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ loading: false, isPro: true, isTrialing: false, trialDaysLeft: null, access: null }),
  notifyAccessChanged: () => {},
}));
vi.mock("@/lib/profileActiveTrip", () => ({ readPinnedTrip: async () => undefined, savePinnedTrip: async () => null }));
vi.mock("@/lib/conciergeHistory", async (importOriginal) => ({ ...(await importOriginal<object>()), loadConversation: async () => [], loadRecentConversations: async () => [] }));
vi.mock("@/lib/conciergeStream", () => ({
  streamConcierge: (...a: any[]) => stream(...a),
  incompleteReplyText: (t: string, m: string) => t || m,
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain, order: () => chain, eq: () => chain, is: () => chain, in: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    limit: () => Promise.resolve({ data: [{ ...(globalThis as any).__trip }], error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }), signOut: async () => {} },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: vi.fn(async (name: string) => (name === "geocode" ? { data: { city: "Huixquilucan", country_code: "MX" }, error: null } : { data: { ok: false }, error: null })) },
    },
  };
});

import Concierge from "@/pages/Concierge";

let where = "";
const Where = () => { const l = useLocation(); where = l.search; return null; };

beforeEach(() => {
  (globalThis as any).__trip = { ...VIAJE, fecha_salida: localISODate() };
  stream.mockReset();
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: any) => void) => ok({ coords: { latitude: HUIXQUILUCAN.lat, longitude: HUIXQUILUCAN.lng } }) },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).includes("api.met.no")
      ? { properties: { meta: { updated_at: new Date().toISOString() }, timeseries: [{ time: new Date().toISOString(), data: { instant: { details: { air_temperature: 17 } } } }] } }
      : { city: "Huixquilucan" },
  ))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("CANDADO · pantalla de Iato", () => {
  it("cuadro de mensaje, atajos completos y cada atajo responde (mensaje a Iato o su pantalla)", async () => {
    stream.mockImplementation(async (_req: any, h: any) => { h.onFinal({ text: "Listo." }); });
    render(<MemoryRouter><Where /><Concierge /></MemoryRouter>);
    const list = await screen.findByRole("list", { name: "Atajos" });
    const botones = within(list).getAllByRole("button");
    // Los mismos atajos que arma buildChips para ese viaje (no se esconde ninguno).
    expect(botones.length).toBe(buildChips({ ...VIAJE, fecha_salida: localISODate() } as any, localISODate(), { away: true }).length);
    expect(botones.length).toBeGreaterThanOrEqual(9);
    // El cuadro para escribirle a Iato.
    expect(document.querySelector("textarea, input[type=text]")).not.toBeNull();
    // Emergencia abre su panel (sin mandar nada a Iato).
    const emergencia = botones.find((b) => /emergencia/i.test(b.textContent ?? ""))!;
    fireEvent.click(emergencia);
    expect(await screen.findByTestId("candado-accion")).toHaveTextContent("emergency");
    expect(stream).not.toHaveBeenCalled();
  });

  it.each(PESTANAS_IATO.map((t) => [t]))("la pestaña «%s» sigue existiendo y muestra lo suyo", async (tab) => {
    render(<MemoryRouter initialEntries={[tab === "chat" ? "/dashboard/concierge" : `/dashboard/concierge?tab=${tab}`]}><Where /><Concierge /></MemoryRouter>);
    if (tab === "chat") expect(await screen.findByRole("list", { name: "Atajos" })).toBeInTheDocument();
    if (tab === "members") expect(await screen.findByTestId("candado-miembros")).toBeInTheDocument();
    if (tab === "solicitudes") expect(await screen.findByTestId("candado-solicitudes")).toBeInTheDocument();
    await waitFor(() => expect(where).toBe(tab === "chat" ? "" : `?tab=${tab}`));
  });
});
