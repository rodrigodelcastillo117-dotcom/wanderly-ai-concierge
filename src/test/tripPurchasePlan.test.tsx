// "Comprar mi viaje" (cierre 2, grupo enlaces): lista de lo cotizado con el sitio al que lleva cada
// botón, lo que va precargado EN la URL y el estado "Ya lo reservé" guardado en bookings (pending,
// nunca "confirmed": eso exige evidencia del proveedor). Datos simulados; sin red.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const insertMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t: string) => ({
      insert: (row: any) => {
        insertMock(t, row);
        return { select: () => ({ single: async () => ({ data: { id: "b-new", ...row }, error: null }) }), then: (r: any) => r({ error: null }) };
      },
      delete: () => ({ eq: async (_c: string, id: string) => { deleteMock(t, id); return { error: null }; } }),
    }),
  },
}));

import { buildPurchasePlan, describePrefill, itemPurchaseState, markRow } from "@/lib/purchasePlan";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";

const TRIP = {
  id: "11111111-1111-4111-8111-111111111111", user_id: "u1", destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-12-12", fecha_regreso: "2026-12-19", num_viajeros: 2, created_at: "2026-10-22T10:00:00Z",
  vuelos_json: [
    { tier: "ahorro", aerolinea: "Iberia", duracion: "11h", escalas: "Directo", precio_por_persona: 21000, fuente_precio: "travelpayouts",
      consultado_at: "2026-10-22T10:00:00Z", booking_link: "https://www.aviasales.com/search/MEX1212MAD19122?marker=533299" },
    { tier: "premium", aerolinea: "Aeroméxico", duracion: "10h 40m", escalas: "Directo", precio_por_persona: 30000, fuente_precio: "travelpayouts",
      booking_link: "https://www.aviasales.com/search/MEX1212MAD19122?marker=533299" },
  ],
  hospedaje_json: [{ nombre: "Hotel Urban", barrio: "Centro", rating: 4.5, precio_por_noche: 4000, fuente_precio: "serpapi", consultado_at: "2026-10-22T10:00:00Z" }],
  tours_json: [{ nombre: "Museo del Prado", precio_por_persona: 400, fuente: "estimado", estado_dato: "ESTIMADO" }],
  restaurantes_json: [{ nombre: "Sobrino de Botín", cocina: "Castellana", rango_precio: "$$$" }],
};

describe("buildPurchasePlan", () => {
  it("vuelo, hotel, auto opcional, actividades elegidas y restaurantes, con lo que va precargado en cada URL", () => {
    const items = buildPurchasePlan(TRIP, { selVuelo: 1, selHospedaje: -1, selTours: new Set([0]) });
    expect(items.map((i) => i.kind)).toEqual(["vuelo", "hospedaje", "auto", "actividad", "restaurante"]);
    const [vuelo, hotel, auto, tour, rest] = items;
    // Vuelo elegido (Aeroméxico): Google Flights con la ruta, las fechas, 2 adultos y solo Aeroméxico.
    expect(vuelo.site).toBe("Google Flights");
    expect(parseGoogleFlightsSearch(vuelo.url!)).toEqual({ origin: "MEX", destination: "MAD", depart: "2026-12-12", ret: "2026-12-19", adults: 2, children: 0, airlines: ["AM"], one_way: false });
    expect(vuelo.lleva).toEqual(["MEX → MAD", "12–19 dic 2026", "2 adultos", "solo Aeroméxico"]);
    expect(vuelo.price).toBe(60000);
    // Hotel: Booking.com con el hotel, fechas, 2 adultos y 1 habitación; 7 noches.
    expect(hotel.site).toBe("Booking.com");
    expect(hotel.url).toBe("https://www.booking.com/searchresults.html?ss=Hotel+Urban+Madrid&checkin=2026-12-12&checkout=2026-12-19&group_adults=2&no_rooms=1");
    expect(hotel.lleva).toEqual(["“Hotel Urban Madrid”", "12–19 dic 2026", "2 adultos", "1 habitación"]);
    expect(hotel.price).toBe(4000 * 7);
    // Auto: no cotizado, Kayak con ciudad y fechas, opcional.
    expect(auto).toMatchObject({ optional: true, site: "Kayak", url: "https://www.kayak.com.mx/cars/Madrid/2026-12-12/2026-12-19", price: null });
    // Actividad: GetYourGuide con las fechas del viaje; precio estimado.
    expect(tour.url).toContain("date_from=2026-12-12&date_to=2026-12-19");
    expect(tour.estimate).toBe(true);
    expect(rest.optional).toBe(true);
  });
  it("'Ya tengo vuelo' (-2) lo quita de la lista; sin selección se toma la primera opción", () => {
    expect(buildPurchasePlan(TRIP, { selVuelo: -2, selHospedaje: -2, selTours: [] }).map((i) => i.kind)).toEqual(["auto", "restaurante"]);
    expect(buildPurchasePlan(TRIP, { selVuelo: -1, selHospedaje: -1, selTours: [] })[0].title).toBe("Vuelo · Iberia");
  });
  it("una URL que el sitio no puede precargar lo dice (Aeroméxico no recibe ruta ni fechas)", () => {
    expect(describePrefill("https://aeromexico.com/", "Aeroméxico")).toEqual({ lleva: [], completa: expect.stringMatching(/no recibe ruta ni fechas/) });
  });
  it("'Ya lo reservé' se guarda como pending con la clave del elemento (nunca como confirmada)", () => {
    const [vuelo] = buildPurchasePlan(TRIP, { selVuelo: 0, selHospedaje: -1, selTours: [] });
    const row = markRow(vuelo, TRIP, "u1", new Date("2026-10-22T12:00:00Z"));
    expect(row).toMatchObject({ status: "pending", category: "flight", trip_id: TRIP.id, raw_payload: { compra_item: vuelo.key, marcado_por_usuario: true } });
    expect(itemPurchaseState(vuelo, [])).toBe("pendiente");
    expect(itemPurchaseState(vuelo, [row as any])).toBe("marcado");
    expect(itemPurchaseState(vuelo, [{ category: "flight", status: "confirmed", title: "Iberia MEX-MAD" }])).toBe("confirmado");
  });
});

describe("TripPurchasePlan (UI)", () => {
  beforeEach(() => { insertMock.mockReset(); deleteMock.mockReset(); });
  const ui = (bookings: any[] = []) => render(
    <MemoryRouter>
      <TripPurchasePlan trip={TRIP} selVuelo={1} selHospedaje={0} selTours={new Set([0])} bookings={bookings} userId="u1" />
    </MemoryRouter>,
  );

  it("muestra los 3 pasos, los avisos honestos y, por elemento, el sitio, lo precargado y un enlace real", () => {
    ui();
    expect(screen.getByRole("heading", { name: "Comprar mi viaje" })).toBeInTheDocument();
    expect(screen.getByTestId("trip-comprar-avisos").textContent).toMatch(/IATOS no cobra.*El precio puede cambiar en el sitio; confirma/);
    const vuelo = screen.getByTestId("comprar-vuelo");
    expect(within(vuelo).getByText("Google Flights")).toBeInTheDocument();
    expect(screen.getByTestId("comprar-vuelo-lleva").textContent).toContain("MEX → MAD · 12–19 dic 2026 · 2 adultos · solo Aeroméxico");
    const a = screen.getByTestId("comprar-vuelo-abrir");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(parseGoogleFlightsSearch(a.getAttribute("href")!)).toMatchObject({ origin: "MEX", destination: "MAD", adults: 2, airlines: ["AM"] });
    expect(screen.getByTestId("trip-comprar-progreso").textContent).toBe("0 de 3 reservados");
  });

  it("'Ya lo reservé' guarda la marca en bookings y cambia el estado; 'Deshacer' la quita", async () => {
    ui();
    fireEvent.click(screen.getByTestId("comprar-vuelo-marcar"));
    await waitFor(() => expect(screen.getByTestId("comprar-vuelo")).toHaveAttribute("data-state", "marcado"));
    expect(insertMock).toHaveBeenCalledWith("bookings", expect.objectContaining({ status: "pending", category: "flight", raw_payload: expect.objectContaining({ compra_item: expect.stringMatching(/^vuelo:1:/) }) }));
    expect(screen.getByTestId("trip-comprar-progreso").textContent).toBe("1 de 3 reservados");
    expect(within(screen.getByTestId("comprar-vuelo")).getByText("Marcado por ti · sin verificar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Marcar .* como pendiente/ }));
    await waitFor(() => expect(screen.getByTestId("comprar-vuelo")).toHaveAttribute("data-state", "pendiente"));
    expect(deleteMock).toHaveBeenCalledWith("bookings", "b-new");
  });
});
