// Recorrido del dueño (Las Vegas, 10-nov-2026, familia de 5): Google Hotels con adults=5 buscaba UNA habitación para 5 y
// solo salían suites y tiempos compartidos (Residence Inn del aeropuerto, Marriott's Grand Chateau). Ahora se busca por
// habitación y el precio es el de todas las habitaciones.
import { describe, expect, it, vi } from "vitest";
import hotelsFixture from "./fixtures/googlemax/serp_hotels.json";
import { groupRooms, searchHotels } from "../../supabase/functions/hotels-search/search";

describe("hoteles para grupos", () => {
  it("hasta 4 personas: una habitación con todos; 5 o más: por habitación", () => {
    expect(groupRooms(2)).toEqual({ rooms: 1, adults: 2, childAges: [] });
    expect(groupRooms(2, [6, 9])).toEqual({ rooms: 1, adults: 2, childAges: [6, 9] });
    expect(groupRooms(5)).toEqual({ rooms: 3, adults: 2, childAges: [] });
    expect(groupRooms(2, [4, 7, 10])).toEqual({ rooms: 2, adults: 1, childAges: [4, 7] });
    expect(groupRooms(8)).toEqual({ rooms: 4, adults: 2, childAges: [] });
  });

  it("familia de 5 en Las Vegas: Google Hotels recibe 2 adultos y el precio es × 3 habitaciones", async () => {
    const urls: string[] = [];
    const serpFetch = vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(hotelsFixture)); });
    const r = await searchHotels({ city: "Las Vegas", checkin: "2026-12-10", checkout: "2026-12-20", adults: 5 }, { serpKey: "s", serpFetch: serpFetch as any });
    expect(new URL(urls[0]).searchParams.get("adults")).toBe("2");
    const results = (r.body as any).results as any[];
    expect(results.length).toBeGreaterThan(0);
    const one = await searchHotels({ city: "Las Vegas", checkin: "2026-12-10", checkout: "2026-12-20", adults: 2 }, { serpKey: "s", serpFetch: vi.fn(async () => new Response(JSON.stringify(hotelsFixture))) as any });
    const base = ((one.body as any).results as any[]).find((x) => x.name === results[0].name);
    expect(results[0].nightly_usd).toBe(base.nightly_usd * 3);
    expect(results[0].precio_para.habitaciones).toBe(3);
    expect(results[0].nota_precio).toMatch(/3 habitaciones/);
    expect(results[0].booking_url).toMatch(/group_adults=5/);
    expect(results[0].booking_url).toMatch(/no_rooms=3/);
  });
});
