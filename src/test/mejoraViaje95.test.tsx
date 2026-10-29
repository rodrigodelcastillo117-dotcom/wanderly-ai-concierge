// Ola «9.5 en todo» (29-oct-2026) · página del viaje. Pedido del dueño: «mejora el itinerario y el resumen»;
// Álvaro (usuario real): «confusa», «demasiado texto», «me tomó entender qué pasaba en cada sección».
//  - Resumen = tablero: una tarjeta con lo imperdible, cuánto cuesta (UNA cifra), qué falta (los mismos pasos
//    y la misma cuenta que Comprar) y qué sigue. Sin repetir la portada, la fecha de cotización ni el total.
//  - Itinerario escaneable: mañana · tarde · noche con el lugar del plan, chips de transporte del día (vuelo
//    con sus horas, tren a la siguiente ciudad, regreso), ficha de Google Maps del lugar y «Ruta del día».
//    Las opciones por tierra quedan plegadas en una línea. Un viaje sin plan dice qué hacer.
// Datos: viajes REALES de la cuenta demo (Italia 2230848b y Lima df6c89d3, leídos con SELECT).
import React from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import ITALIA_RAW from "./fixtures/italia2230848bCompleto.json";
import LIMA_RAW from "./fixtures/limaDf6c89d3.json";
import { buildBuyFlow } from "@/lib/buyFlow";
import { calendarDays } from "@/lib/itineraryCalendar";
import { purchaseProgress } from "@/lib/purchaseProgress";
import { dayRouteUrl, daySlots, groundSummary, itineraryTransport, placeMapsUrl, shortDuration, tripPlaces } from "@/lib/itineraryDay";
import { tripSectionHelp } from "@/lib/tripSectionHelp";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ITALIA = () => ({
  ...clone(ITALIA_RAW as any), user_id: "u1", total_estimado: 153166, current_quote_id: null,
  desglose_presupuesto: { comida: 35399, extras: 3708, hospedaje: 67315, tours: 7527, transporte_local: 4285, vuelos: 34932 },
});
const LIMA = () => ({ ...clone(LIMA_RAW as any), user_id: "u1", current_quote_id: null });
const SEL0 = { selVuelo: -1, selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} };

describe("Qué falta (purchaseProgress): los mismos pasos y la misma cuenta que «Comprar»", () => {
  it("Italia sin elegir nada: 6 pasos (vuelo, 3 hoteles, 2 trenes), 0 de 6 reservados", () => {
    const p = purchaseProgress(buildBuyFlow(ITALIA(), SEL0), () => "pendiente");
    expect(p.total).toBe(6);
    expect(p.done).toBe(0);
    expect(p.rows.map((r) => [r.label, r.status])).toEqual([
      ["Vuelo de ida y regreso", "por_elegir"],
      ["Hotel en Roma", "por_elegir"],
      ["Tren Roma → Florencia", "por_comprar"],
      ["Hotel en Florencia", "por_elegir"],
      ["Tren Florencia → Venecia", "por_comprar"],
      ["Hotel en Venecia", "por_elegir"],
    ]);
    // El tren dice su duración del plan, marcada como aproximada; el auto opcional no es un pendiente.
    expect(p.rows[2].detail).toBe("1h 36m aprox.");
    expect(p.rows.some((r) => r.kind === "auto")).toBe(false);
    expect(p.falta).toEqual(["vuelo de ida y regreso", "hotel en Roma", "Roma → Florencia", "hotel en Florencia", "Florencia → Venecia", "hotel en Venecia"]);
  });

  it("elegido, comprado, reservado y «ya lo tengo» se distinguen; el nombre de lo elegido se ve", () => {
    const t = ITALIA();
    const flow = buildBuyFlow(t, { ...SEL0, selVuelo: 0, selHoteles: { Roma: 1, Florencia: -2 } });
    const roma = flow.items.find((i) => i.kind === "hospedaje" && /Roma/.test(i.subtitle ?? ""))!;
    const tren = flow.steps.find((s) => s.kind === "traslado")!.item;
    const p = purchaseProgress(flow, (it) => (it.key === roma.key ? "confirmado" : it.key === tren.key ? "marcado" : "pendiente"));
    const by = Object.fromEntries(p.rows.map((r) => [r.label, r]));
    expect(by["Vuelo de ida y regreso"].status).toBe("elegido");
    expect(by["Vuelo de ida y regreso"].detail).toBe("Lufthansa");
    expect(by["Hotel en Roma"].status).toBe("reservado");
    expect(by["Tren Roma → Florencia"].status).toBe("comprado");
    expect(by["Hotel en Florencia"].status).toBe("ya_lo_tienes");
    expect(by["Hotel en Venecia"].status).toBe("por_elegir");
    expect(p.done).toBe(2);
  });
});

describe("Itinerario escaneable (itineraryDay)", () => {
  it("mañana · tarde · noche con el lugar del plan; la ficha de Maps solo con place_id o maps_url", () => {
    const t = LIMA();
    const places = tripPlaces(t);
    const d2 = calendarDays(t).find((d) => d.dia === 2)!;
    const slots = daySlots(d2, places);
    expect(slots.map((s) => [s.label, s.headline])).toEqual([
      ["Mañana", "Plaza Mayor de Lima"],
      ["Tarde", "Museo del Convento de San Francisco y Catacumbas"],
      ["Noche", "Panchita - Miraflores"],
    ]);
    // El texto completo del día no cambia.
    expect(slots[0].text).toBe(d2["mañana"]);
    for (const s of slots) expect(s.place!.mapsUrl).toMatch(/^https:\/\/maps\.google\.com\/\?cid=/);
    expect(placeMapsUrl({ name: "Sin ficha", placeId: null, mapsUrl: null })).toBeNull();
    expect(placeMapsUrl({ name: "Otro sitio", placeId: null, mapsUrl: "https://example.com/mapa" })).toBeNull();
    expect(placeMapsUrl({ name: "Coliseo", placeId: "ChIJrRMgU7ZhLxMRxAOFkC7I8Sg" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Coliseo&query_place_id=ChIJrRMgU7ZhLxMRxAOFkC7I8Sg");
    // Ruta del día: los lugares con ficha, en orden (Google calcula ahí los tiempos reales).
    const route = new URL(dayRouteUrl(slots)!);
    expect(route.origin + route.pathname).toBe("https://www.google.com/maps/dir/");
    expect(route.searchParams.get("origin")).toBe("Plaza Mayor de Lima");
    expect(route.searchParams.get("destination")).toBe("Panchita - Miraflores");
    expect(route.searchParams.get("waypoints")).toBe("Museo del Convento de San Francisco y Catacumbas");
    expect(route.searchParams.get("origin_place_id")).toBe(places.find((p) => p.name === "Plaza Mayor de Lima")!.placeId);
    // Con menos de 2 lugares con ficha no hay ruta.
    expect(dayRouteUrl(slots.slice(0, 1))).toBeNull();
  });

  it("una franja que repite a la anterior («En vuelo hacia Tokio» mañana y tarde) no se repite en el resumen", () => {
    const slots = daySlots({ dia: 2, "mañana": "En vuelo hacia Tokio.", tarde: "En vuelo hacia Tokio.", noche: "Llegas a Tokio hacia las 14:50." }, []);
    expect(slots.map((s) => [s.headline, !!s.repeated])).toEqual([["En vuelo hacia Tokio", false], ["En vuelo hacia Tokio", true], ["Llegas a Tokio hacia las 14:50", false]]);
    // Si el texto tiene otra frase, se usa esa.
    const s2 = daySlots({ dia: 1, "mañana": "Tiempo libre en la ciudad.", tarde: "Tiempo libre en la ciudad. Traslado al aeropuerto.", noche: "" }, []);
    expect(s2.map((s) => s.headline)).toEqual(["Tiempo libre en la ciudad", "Traslado al aeropuerto"]);
  });

  it("en varias ciudades solo cuentan los lugares de la ciudad del día", () => {
    const places = [
      { name: "Museo Nacional", kind: "experiencia" as const, ciudad: "Florencia", placeId: null, mapsUrl: null, rating: null, porQue: null },
    ];
    expect(daySlots({ dia: 2, ciudad: "Roma", "mañana": "Museo Nacional de Roma." }, places)[0].place).toBeNull();
    expect(daySlots({ dia: 6, ciudad: "Florencia", "mañana": "Museo Nacional y paseo." }, places)[0].place?.name).toBe("Museo Nacional");
  });

  it("chips de transporte de Italia: el vuelo de ida con sus horas, cada tren el día que se llega y el regreso", () => {
    const t = ITALIA();
    const days = calendarDays(t);
    const flow = buildBuyFlow(t, SEL0);
    const chips = itineraryTransport(t, days, flow.steps);
    expect(chips[1]).toEqual([{ kind: "vuelo", mode: "vuelo", text: "Vuelo Ciudad de México → Roma", sub: "Sale 22:00 · llega mar 11 may, 22:40 (hora local)", target: "paso-1" }]);
    // El día 1 del itinerario dice lo mismo (mismo vuelo).
    expect(days[0].noche).toContain("22:00");
    const d5 = days.find((d) => d.fecha === "2027-05-14")!;
    expect(chips[d5.dia].map((c) => c.text)).toEqual(["Tren Roma → Florencia"]);
    expect(chips[d5.dia][0].sub).toBe("1h 36m aprox. · Trenitalia (Frecciarossa) / Italo");
    const d8 = days.find((d) => d.fecha === "2027-05-17")!;
    expect(chips[d8.dia].map((c) => c.text)).toEqual(["Tren Florencia → Venecia"]);
    // Día de regreso (sin plan): el vuelo VCE → MEX que dice Comprar, sin inventar la hora.
    const last = days[days.length - 1];
    expect(last.fecha).toBe("2027-05-20");
    expect(chips[last.dia]).toEqual([{ kind: "regreso", mode: "vuelo", text: "Vuelo de regreso Venecia → Ciudad de México", sub: "Horario: elígelo en Comprar", target: "paso-1" }]);
  });

  it("Lima: el chip del vuelo usa las horas de la tarifa (sale 16:00 · llega 23:00)", () => {
    const t = LIMA();
    const chips = itineraryTransport(t, calendarDays(t), buildBuyFlow(t, SEL0).steps);
    expect(chips[1][0].sub).toBe("Sale 16:00 · llega 23:00 (hora local)");
    expect(chips[6]).toEqual([{ kind: "regreso", mode: "vuelo", text: "Vuelo de regreso Lima → Ciudad de México", sub: "Horario: elígelo en Comprar", target: "paso-1" }]);
  });

  it("por tierra (Valle de Bravo): cómo llegar con la duración de cada opción; un viaje traído no inventa vuelos", () => {
    const vb: any = { id: "vb", destino: "Valle de Bravo", pais_destino: "México", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-23", num_viajeros: 2,
      vuelos_json: [{ modo: "autobus", aerolinea: "Autobús", duracion: "Unas 3.3 h puerta a puerta (aprox., incluye terminal)" }, { modo: "auto", aerolinea: "En tu coche", duracion: "2.2 h de manejo según Google Maps (sin tráfico)" }],
      hospedaje_json: [], itinerario_json: [{ dia: 1, titulo: "Llegada", "mañana": "Salida." }] };
    const days = calendarDays(vb);
    const chips = itineraryTransport(vb, days, buildBuyFlow(vb, SEL0).steps, { byLand: true });
    expect(chips[1][0]).toMatchObject({ mode: "coche", text: "Cómo llegar: Ciudad de México → Valle de Bravo", sub: "Autobús 3.3 h aprox. · Coche 2.2 h aprox." });
    expect(chips[4][0]).toMatchObject({ kind: "regreso", text: "Regreso a Ciudad de México" });
    expect(itineraryTransport(LIMA(), calendarDays(LIMA()), [], { brought: true })).toEqual({});
  });

  it("duraciones cortas y honestas («aprox.»), con rangos completos", () => {
    expect(shortDuration("Unas 3.3 h puerta a puerta (aprox., incluye terminal)")).toBe("3.3 h aprox.");
    expect(shortDuration("1h 36m")).toBe("1 h 36 min aprox.");
    expect(shortDuration("32 min")).toBe("32 min aprox.");
    expect(shortDuration("45-60 min")).toBe("45-60 min aprox.");
    expect(shortDuration("sin dato")).toBeNull();
    expect(groundSummary([{ modo: "TREN", duracion: "32 min" }, { modo: "Taxi", duracion: "45-60 min" }])).toBe("Tren · 32 min aprox. · 2 opciones");
  });
});

// ─── La página (TripDetail) con datos simulados ─────────────────────────────────────────────────────────────
const db = { trip: null as any, bookings: [] as any[] };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: () => { kind = "update"; return api; }, insert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "update") return Promise.resolve({ data: [db.trip], error: null }).then(res, rej);
        return Promise.resolve({ data: table === "bookings" ? db.bookings : [], error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children, city }: any) => <div data-city-box={city}>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/components/trip/BeforeYouTravelCard", () => ({ BeforeYouTravelCard: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";
import { TripExperiencias } from "@/components/trip/TripExperiencias";

const renderTrip = (t: any) => {
  db.trip = t;
  return render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${t.id}`]}>
      <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  db.bookings = [];
  try { localStorage.clear(); localStorage.setItem("iatos_trip_tour_v1", "done"); } catch { /* noop */ }
  window.history.replaceState(null, "", "/");
});

describe("Resumen como tablero (Italia, datos reales)", () => {
  it("una sola tarjeta: lo imperdible → total → qué falta → qué sigue; la cifra sale UNA vez", async () => {
    renderTrip(ITALIA());
    const dash = await screen.findByTestId("trip-dashboard");
    const panel = dash.closest("[data-trip-panel]") as HTMLElement;
    expect(panel.getAttribute("data-trip-panel")).toBe("resumen");
    const order = Array.from(dash.querySelectorAll("[data-testid='trip-glance'],[data-testid='trip-total-amount'],[data-testid='trip-falta'],[data-testid='trip-next-card'],[data-testid='trip-desglose']"))
      .map((e) => e.getAttribute("data-testid"));
    // Lo plegado (desglose, análisis) va al final, después de la acción.
    expect(order).toEqual(["trip-glance", "trip-total-amount", "trip-falta", "trip-next-card", "trip-desglose"]);
    const amount = within(dash).getByTestId("trip-total-amount").textContent!;
    expect(amount).toBe("$153,166 MXN");
    expect(panel.textContent!.split(amount).length - 1).toBe(1);
    // Ni la portada ni la fecha de la cotización se repiten en el tablero.
    expect(screen.queryByTestId("trip-glance-viaje")).toBeNull();
    expect(screen.queryByTestId("trip-glance-costo")).toBeNull();
    expect(within(screen.getByTestId("trip-next-card")).queryByText(/^Cotizado hace/)).toBeNull();
    expect(within(panel).getByTestId("trip-seccion-ayuda")).toHaveTextContent("Tu viaje de un vistazo: cuánto cuesta, qué falta y qué sigue.");
  });

  it("«Qué falta» cuenta igual que «Comprar» y tocar un renglón abre ese paso de Comprar", async () => {
    renderTrip(ITALIA());
    const falta = await screen.findByTestId("trip-falta");
    expect(within(falta).getByTestId("trip-falta-progreso")).toHaveTextContent("0 de 6 reservados");
    expect(screen.getByTestId("trip-comprar-progreso")).toHaveTextContent("0 de 6 reservados");
    const items = within(falta).getAllByTestId("trip-falta-item");
    expect(items.map((b) => b.getAttribute("data-status"))).toEqual(["por_elegir", "por_elegir", "por_comprar", "por_elegir", "por_comprar", "por_elegir"]);
    expect(items[1]).toHaveTextContent("Hotel en Roma");
    fireEvent.click(items[1]);
    await waitFor(() => expect(screen.getByTestId("tab-comprar")).toHaveAttribute("aria-selected", "true"));
    expect(document.getElementById("paso-2")).toHaveAttribute("data-testid", "comprar-hospedaje");
  });

  it("«Por recotizar»: el aviso y «Volver a cotizar» salen una vez (antes también en «Qué sigue»)", async () => {
    renderTrip({ ...ITALIA(), desglose_presupuesto: "Total $7 MXN", total_estimado: 7 });
    await screen.findByTestId("trip-total-recotizar");
    const panel = document.querySelector("[data-trip-panel='resumen']") as HTMLElement;
    expect(within(panel).getAllByRole("button", { name: "Volver a cotizar" })).toHaveLength(1);
    expect(screen.queryByTestId("trip-dashboard")).toBeNull();
  });
});

describe("Itinerario escaneable en la página", () => {
  it("Italia: cada día con sus franjas, chips del vuelo y del tren; lo de tierra plegado en una línea", async () => {
    renderTrip(ITALIA());
    await screen.findByTestId("trip-dashboard");
    fireEvent.click(screen.getByTestId("tab-destinos"));
    const roma = document.querySelector("[data-city-box='Roma']") as HTMLElement;
    const tierra = within(roma).getByTestId("itinerario-tierra");
    expect(tierra.tagName).toBe("DETAILS");
    expect(tierra).not.toHaveAttribute("open");
    expect(tierra.querySelector("summary")!.textContent).toContain("Tren · 32 min aprox. · 2 opciones");
    const days = within(roma).getAllByTestId("itinerario-dia");
    expect(within(days[0]).getByTestId("itinerario-chip")).toHaveTextContent("Vuelo Ciudad de México → RomaSale 22:00 · llega mar 11 may, 22:40 (hora local)");
    const flor = document.querySelector("[data-city-box='Florencia']") as HTMLElement;
    const d5 = within(flor).getAllByTestId("itinerario-dia")[0];
    expect(within(d5).getByTestId("itinerario-chip")).toHaveTextContent(/^Tren Roma → Florencia/);
    // El día de regreso (sin plan) muestra el vuelo y lleva a Comprar.
    const venecia = document.querySelector("[data-city-box='Venecia']") as HTMLElement;
    const regreso = within(venecia).getByTestId("itinerario-dia-pendiente");
    const chip = within(regreso).getByTestId("itinerario-chip");
    expect(chip).toHaveTextContent("Vuelo de regreso Venecia → Ciudad de México");
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("tab-comprar")).toHaveAttribute("aria-selected", "true"));
  });

  it("Lima: el detalle del día trae la ficha del lugar (Google Maps, calificación, por qué) y la ruta del día", async () => {
    renderTrip(LIMA());
    await screen.findByTestId("trip-dashboard");
    fireEvent.click(screen.getByTestId("tab-destinos"));
    const d2 = screen.getAllByTestId("itinerario-dia")[1] as HTMLDetailsElement;
    // Plegado: la ficha del lugar se arma al abrir el día.
    expect(within(d2).queryByTestId("itinerario-lugar")).toBeNull();
    d2.open = true;
    fireEvent(d2, new Event("toggle"));
    const lugares = await within(d2).findAllByTestId("itinerario-lugar");
    expect(lugares[0]).toHaveTextContent("Plaza Mayor de Lima");
    expect(within(lugares[0]).getByTestId("itinerario-lugar-mapa")).toHaveAttribute("href", expect.stringMatching(/^https:\/\/maps\.google\.com\//));
    expect(lugares[0]).toHaveTextContent(/Por qué: /);
    const ruta = within(d2).getByTestId("itinerario-ruta-dia");
    expect(ruta).toHaveAttribute("target", "_blank");
    expect(ruta.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
  });

  it("un viaje sin plan día por día dice qué hacer (y lleva a Experiencias)", async () => {
    const t = { ...LIMA(), itinerario_json: { days: [] } };
    renderTrip(t);
    await screen.findByTestId("trip-dashboard");
    fireEvent.click(screen.getByTestId("tab-destinos"));
    const vacio = screen.getByTestId("itinerario-vacio");
    expect(vacio).toHaveTextContent("Aún no hay plan para tus días");
    expect(screen.getAllByTestId("itinerario-dia-pendiente")).toHaveLength(6);
    fireEvent.click(within(vacio).getByRole("button", { name: /Ver restaurantes y experiencias/ }));
    await waitFor(() => expect(screen.getByTestId("tab-experiencias")).toHaveAttribute("aria-selected", "true"));
  });
});

describe("Comprar y Experiencias", () => {
  it("en Comprar, la barra del celular lleva al siguiente paso pendiente (no «Ir a Comprar» estando ahí)", async () => {
    // Cotizado hace un momento: la acción es «Elige y reserva» (no «Revisa los precios»).
    renderTrip({ ...ITALIA(), created_at: new Date().toISOString() });
    await screen.findByTestId("trip-dashboard");
    expect(screen.getByTestId("trip-next-bar-cta")).toHaveTextContent("Ir a Comprar");
    fireEvent.click(screen.getByTestId("tab-comprar"));
    const cta = screen.getByTestId("trip-next-bar-cta");
    expect(cta).toHaveTextContent("Siguiente paso");
    expect(cta).toHaveAttribute("aria-label", "Ir al siguiente paso pendiente");
    // Lleva al primer paso pendiente que queda debajo de lo que se ve (aquí, en jsdom, todo mide 0: el primero).
    const paso1 = document.getElementById("paso-1")!;
    const spy = vi.fn();
    paso1.scrollIntoView = spy;
    fireEvent.click(cta);
    expect(spy).toHaveBeenCalled();
    // Pasos 2 (hotel en Roma) «debajo» de la pantalla: va a ese.
    const paso2 = document.getElementById("paso-2")!;
    paso2.getBoundingClientRect = () => ({ top: 600, bottom: 900, left: 0, right: 0, width: 0, height: 300, x: 0, y: 600, toJSON: () => ({}) }) as DOMRect;
    const spy2 = vi.fn();
    paso2.scrollIntoView = spy2;
    fireEvent.click(cta);
    expect(spy2).toHaveBeenCalled();
  });

  it("Experiencias antes de buscar: los lugares de tu plan con su ficha de Maps, sin llamar a nada ni mostrar museos vacíos", () => {
    const t = LIMA();
    const invoke = vi.fn();
    const marks: any = { marks: new Map(), rows: [], mark: async () => ({ ok: true }), unmark: async () => ({ ok: true }) };
    render(<MemoryRouter><TripExperiencias trip={t} cities={[{ label: "Lima", key: "Lima", checkin: t.fecha_salida, checkout: t.fecha_regreso }]} multi={false} marks={marks} userId="u1" invoke={invoke as any} /></MemoryRouter>);
    const plan = screen.getByTestId("exp-de-tu-plan");
    const lugares = within(plan).getAllByTestId("exp-plan-lugar");
    expect(lugares.length).toBe(8);
    expect(lugares[0]).toHaveTextContent("Malecón de Miraflores");
    expect(lugares[0]).toHaveAttribute("href", expect.stringMatching(/^https:\/\/maps\.google\.com\//));
    expect(screen.queryByTestId("exp-museos")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Ayuda por pestaña", () => {
  it("Resumen de un viaje traído no habla de «cuánto cuesta»", () => {
    expect(tripSectionHelp("resumen", { brought: true })).toBe("Tu viaje de un vistazo: lo que ya tienes y qué sigue.");
  });
});
