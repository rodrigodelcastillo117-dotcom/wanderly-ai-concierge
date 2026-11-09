// Restaurante que no toma reservaciones (Google reservable=false): no se ofrece «Buscar en OpenTable/TheFork»
// (recorrido Japón 9-nov-2026: salía «No toma reservaciones (llega directo)» junto a «Buscar en OpenTable»).
import { describe, expect, it } from "vitest";
import { offerFromTripRestaurant, venueFromTripPlace } from "../../supabase/functions/_shared/booking/offers.ts";

const trip = { id: "t1", destino: "Tokio", pais_destino: "Japón", fecha_salida: "2027-03-15", fecha_regreso: "2027-03-26" };
const urls = (o: { actions: Array<{ url?: string | null }> }) => o.actions.map((a) => String(a.url ?? "")).join(" ");

describe("restaurante sin reservaciones", () => {
  const base = { nombre: "Ichiran Shibuya", ciudad: "Tokio", rango_precio: "JPY 2,000–4,000", fuente: "google_places", place_id: "ChIJ1", telefono: "+81 3-1234-5678" };
  it("reservable=false: sin OpenTable, con teléfono o Maps", () => {
    const r = { ...base, reservable: false };
    const o = offerFromTripRestaurant(r, { trip: trip as never, city: "Tokio", country: "JP", venue: venueFromTripPlace(r, "Tokio", "JP") });
    expect(urls(o)).not.toMatch(/opentable|thefork/i);
    expect(o.actions.length).toBeGreaterThan(0);
  });
  it("sin dato de Google o reservable=true: sí se ofrece la búsqueda", () => {
    const o = offerFromTripRestaurant(base, { trip: trip as never, city: "Tokio", country: "JP", venue: venueFromTripPlace(base, "Tokio", "JP") });
    expect(urls(o)).toMatch(/opentable/i);
  });
  it("sin ficha de Google (solo el nombre) y reservable=false: tampoco", () => {
    const o = offerFromTripRestaurant({ nombre: "Ichiran", reservable: false }, { trip: trip as never, city: "Tokio", country: "JP" });
    expect(urls(o)).not.toMatch(/opentable|thefork/i);
  });
});
