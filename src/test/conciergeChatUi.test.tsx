// Concierge PRO estilo WhatsApp (reporte del dueño, 23-oct-2026): "me gustaría que fuera vertical
// estilo WhatsApp" y los atajos "igual de arriba a abajo". Se dibuja la pantalla real (Concierge.tsx)
// con el caso Huixquilucan: ubicación simulada en Huixquilucan y el viaje Roma → Florencia → Venecia
// que empieza hoy. Las capturas a 390 y 1440 px están en scripts/concierge/ui_evidence.mjs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HUIXQUILUCAN, VIAJE } from "./fixtures/conciergeHuixquilucan";
import { localISODate } from "@/lib/localDate";

const stream = vi.fn();
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ConciergeActions", () => ({ ConciergeActions: () => null }));
vi.mock("@/components/FlightStatusDialog", () => ({ FlightStatusDialog: () => null }));
vi.mock("@/components/TravelerAvatar", () => ({ TravelerAvatar: () => null }));
vi.mock("@/components/MembersOnlyPanel", () => ({ MembersOnlyPanel: () => null }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => <button type="button">Fixer</button> }));
// Usuario estable (como el AuthContext real): un objeto nuevo en cada render re-dispararía los efectos.
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
    select: () => chain, order: () => chain, eq: () => chain, is: () => chain,
    limit: () => Promise.resolve({ data: [{ ...(globalThis as any).__trip }], error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }), signOut: async () => {} },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
      // Ronda 2 (#15): el nombre de la ciudad sale de la función geocode de IATOS, ya no de BigDataCloud.
      functions: { invoke: vi.fn(async (name: string) => (name === "geocode" ? { data: { city: "Huixquilucan", country_code: "MX" }, error: null } : undefined)) },
    },
  };
});

import Concierge from "@/pages/Concierge";

beforeEach(() => {
  // El viaje empieza HOY (fecha local de la prueba), como en el caso del 22 de octubre.
  (globalThis as any).__trip = { ...VIAJE, fecha_salida: localISODate() };
  stream.mockReset();
  Element.prototype.scrollTo = vi.fn() as any;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: any) => void) => ok({ coords: { latitude: HUIXQUILUCAN.lat, longitude: HUIXQUILUCAN.lng } }) },
  });
  // Clima de MET Norway (claude/total-clima quitó Open-Meteo del Concierge).
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).includes("api.met.no")
      ? { properties: { meta: { updated_at: new Date().toISOString() }, timeseries: [{ time: new Date().toISOString(), data: { instant: { details: { air_temperature: 17 } } } }] } }
      : { city: "Huixquilucan" },
  ))));
});
afterEach(() => { vi.unstubAllGlobals(); });

const renderPage = () => render(<MemoryRouter><Concierge /></MemoryRouter>);

describe("Concierge estilo WhatsApp", () => {
  it("encabezado compacto: ubicación, viaje 'sale hoy' (no 'en curso') y sin 'Noche disponible' ni 'Auto-refresh 60s'", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Huixquilucan · 17°C")).toBeInTheDocument());
    const ctx = screen.getByTestId("concierge-context");
    await waitFor(() => expect(within(ctx).getByTestId("trip-phase")).toHaveTextContent("sale hoy"));
    expect(within(ctx).getByRole("combobox", { name: "Viaje en contexto" })).toHaveDisplayValue("Automático · Roma → Florencia → Venecia");
    expect(ctx.textContent).not.toMatch(/en curso|Noche disponible|Tarde libre|Auto-refresh/);
    expect(within(ctx).getByRole("button", { name: /Actualizar ubicación y viajes/ })).toBeInTheDocument();
    expect(within(ctx).getByRole("button", { name: "Lo que Iato recuerda" })).toBeInTheDocument();
  });

  // Ola 9.5: en dos columnas (con el viaje en curso hay 9 atajos: plan de hoy, clima y gastos se suman).
  it("chat vacío: los atajos van en el hilo, en dos columnas y todos completos", async () => {
    renderPage();
    const list = await screen.findByRole("list", { name: "Atajos" });
    expect(list.className).toMatch(/grid grid-cols-2/);
    const labels = within(list).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["¿Mi vuelo va a tiempo?", "Mi plan de hoy", "¿Qué clima hará?", "¿Cuánto llevo gastado?", "Cena cerca", "Pedir transporte", "Emergencia local", "Equipaje Invisible", "Mi viaje a Roma"]);
    for (const b of within(list).getAllByRole("button")) expect(b.className).toMatch(/w-full/);
    // Sin conversación no hay botón "Atajos" (ya están a la vista).
    expect(screen.queryByRole("button", { name: "Atajos" })).toBeNull();
  });

  it("'Cena cerca': tu burbuja a la derecha, la de Iato a la izquierda con hora, cards y acción compactas; 'Atajos' abre la lista vertical", async () => {
    stream.mockImplementation(async (req: any, h: any) => {
      // Lo que manda la app: el texto local (no "cerca de mi hotel") y la ubicación real.
      expect(req.body.messages.at(-1).content).toBe("¿Dónde ceno hoy cerca de donde estoy? Dame 3 opciones abiertas con cómo llegar.");
      expect(req.body.context).toEqual({ coords: HUIXQUILUCAN, place: "Huixquilucan" });
      h.onMeta({ _trip_id: VIAJE.id });
      h.onFinal({
        text: "Cerca de ti, abiertos ahora según Google Maps: **La Mesa de Prueba** (★4.6) y **Bistró Simulado** (★4.5).",
        cards: [{ type: "restaurant", title: "La Mesa de Prueba", subtitle: "Interlomas, Huixquilucan", rating: 4.6 }],
        actions: [{ id: "a1", type: "save_place", params: { nombre: "La Mesa de Prueba" }, summary: "Guardar La Mesa de Prueba en tus favoritos", confirm_label: "Guardar", runs: "server" }],
        _trip_id: VIAJE.id, _trip_reason: "in_progress",
      });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Huixquilucan · 17°C")).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "Cena cerca" }));
    await screen.findByText(/abiertos ahora según Google Maps/);

    const users = screen.getAllByTestId("bubble-user");
    const iato = screen.getAllByTestId("bubble-iato");
    expect(users).toHaveLength(1);
    expect(users[0].className).toMatch(/justify-end/);
    expect(iato.at(-1)!.className).toMatch(/justify-start/);
    expect(users[0].querySelector("time")!.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(iato.at(-1)!.querySelector("time")!.textContent).toMatch(/^\d{2}:\d{2}$/);
    // Card y acción dentro de la burbuja de Iato (no bloques de ancho completo con foto de 160 px).
    const card = within(iato.at(-1)!).getByTestId("bubble-cards").querySelector('[data-card-type="restaurant"]')!;
    expect(card.className).toMatch(/rounded-tl-md/);
    expect(card.querySelector(".h-40")).toBeNull();
    const action = within(iato.at(-1)!).getByTestId("bubble-actions");
    expect(action.textContent).toMatch(/Guardar La Mesa de Prueba en tus favoritos/);
    expect(action.textContent).not.toMatch(/Agregar a tu viaje/);

    // Con conversación los atajos ya no ocupan el hilo: "Atajos" abre la lista vertical completa.
    expect(screen.queryByRole("list", { name: "Atajos" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Atajos" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Atajos" });
    expect(within(list).getAllByRole("button")).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar atajos" }));
    expect(screen.queryByRole("list", { name: "Atajos" })).toBeNull();
    // El hilo se desplaza solo al último mensaje.
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
  });

  it("ola 9.5: el paso 'Revisando tu viaje…' se ve mientras Iato piensa y se quita en cuanto llega el texto", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stream.mockImplementation(async (_req: any, h: any) => {
      h.onMeta({ _trip_id: VIAJE.id });
      h.onStatus({ id: "think", text: "Revisando tu viaje a Roma…", state: "running" });
      await gate;
      h.onStatus({ id: "think", text: "Revisando tu viaje a Roma", state: "done" });
      h.onDelta("Para Roma te falta el seguro de viaje.");
      h.onFinal({ text: "Para Roma te falta el seguro de viaje.", cards: [], actions: [], _trip_id: VIAJE.id, _trip_reason: "in_progress" });
    });
    renderPage();
    const box = await screen.findByLabelText("Mensaje para Iato");
    fireEvent.change(box, { target: { value: "¿Qué me falta para mi viaje a Roma?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    const steps = await screen.findByTestId("iato-steps");
    expect(steps).toHaveTextContent("Revisando tu viaje a Roma…");
    release();
    await screen.findByText("Para Roma te falta el seguro de viaje.");
    const last = screen.getAllByTestId("bubble-iato").at(-1)!;
    expect(last.textContent).not.toMatch(/Revisando tu viaje/);
    expect(within(last).queryByTestId("iato-steps")).toBeNull();
  });

  it("la caja de escribir queda fija abajo con micrófono y enviar", async () => {
    renderPage();
    const box = await screen.findByLabelText("Mensaje para Iato");
    const composer = screen.getByTestId("composer-tools").parentElement!;
    expect(within(composer).getByRole("button", { name: "Dictar por voz" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Enviar mensaje" })).toBeInTheDocument();
    expect(composer.contains(box)).toBe(true);
    // El hilo es la única parte que se desplaza (el compositor no está dentro de él).
    const thread = screen.getByRole("region", { name: "Conversación con Iato" });
    expect(thread.className).toMatch(/flex-1 min-h-0 overflow-y-auto/);
    expect(thread.contains(box)).toBe(false);
  });
});
