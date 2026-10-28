// Defectos 13, 14, 16, 18 y 19 del E2E en producción (28-oct-2026): nombres de lugares, WhatsApp solo
// en celulares, proveedor de reservas del país, Kayak en español, enlaces honestos de tren, coche propio
// sin renta de auto, tours de Viator en español y sugerencias de "Editar con IA" del viaje actual.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));

import { cleanPlaceName, visiblePlaceName } from "../../supabase/functions/_shared/placeName";
import { isMobileNumber } from "../../supabase/functions/_shared/booking/channels";
import { restaurantBooking } from "../../supabase/functions/_shared/restaurantBooking";
import { offerFromTripRestaurant } from "../../supabase/functions/_shared/booking/offers";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist";
import { kayakFlightsSearchUrl } from "../../supabase/functions/_shared/booking/links";
import { kayakCarsUrl } from "../../supabase/functions/_shared/booking/carRental";
import { OPERATORS, operatorAction } from "../../supabase/functions/_shared/booking/railOperators";
import { FREE_TOUR_NOTE, looksEnglish, mapViatorProducts } from "../../supabase/functions/_shared/viator";
import { enforceSources } from "../../supabase/functions/analizar-viaje/sources";
import { labelExperiences } from "../../supabase/functions/logistics-plan/provenance";
import { summarizeViator } from "@/lib/viatorTours";
import { editSuggestions } from "@/lib/editSuggestions";
import { kayakCarsLink, kayakFlightsLink } from "@/lib/affiliateLinks";
import { GroundBuyButtons } from "@/components/booking/FlightBuyButtons";
import { buildPurchasePlan } from "@/lib/purchasePlan";
import { tepozNuevo } from "./fixtures/casoTepoztlan";

const NOW = Date.parse("2026-10-28T16:00:00Z");
const MADRID = { id: "11111111-1111-4111-8111-111111111111", destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", num_viajeros: 2 };

describe("13 · nombres sin la cola de los listados web", () => {
  it("corta '| …' y '- Restaurante …' sin romper nombres reales con guion", () => {
    expect(cleanPlaceName("La Taberna de Peñalver Cava Baja | Restaurante La Latina")).toBe("La Taberna de Peñalver Cava Baja");
    expect(cleanPlaceName("Ilios | Greek restaurant in Cancun")).toBe("Ilios");
    expect(cleanPlaceName("Casa del Vin Santo - Ristorante Braceria Firenze")).toBe("Casa del Vin Santo");
    expect(cleanPlaceName("Osteria da Fortunata - Rinascimento")).toBe("Osteria da Fortunata - Rinascimento");
    expect(cleanPlaceName("Osteria del Fiore - Piazza del Duomo Firenze")).toBe("Osteria del Fiore - Piazza del Duomo Firenze");
    expect(cleanPlaceName("Santuario de la Mariposa Monarca - Piedra Herrada")).toBe("Santuario de la Mariposa Monarca - Piedra Herrada");
    expect(cleanPlaceName("Mezquita-Catedral de Córdoba")).toBe("Mezquita-Catedral de Córdoba");
    expect(cleanPlaceName("master Trevi Rome")).toBe("Master Trevi Rome");
  });
  it("el título y los enlaces de un restaurante guardado usan el nombre limpio", () => {
    const o = offerFromTripRestaurant({ nombre: "La Taberna de Peñalver Cava Baja | Restaurante La Latina" }, { trip: MADRID as any, now: NOW });
    expect(o.title).toBe("La Taberna de Peñalver Cava Baja");
    const urls = o.actions.map((a) => decodeURIComponent(String(a.url ?? "")).replace(/\+/g, " "));
    expect(urls.join(" ")).not.toMatch(/\||Restaurante La Latina/);
    expect(urls.some((u) => u.includes("La Taberna de Peñalver Cava Baja"))).toBe(true);
  });
});

describe("14 · WhatsApp solo en celulares", () => {
  it("decide por el plan de numeración del país; en México no se sabe", () => {
    expect(isMobileNumber("34915326681")).toBe(false); // fijo de Madrid (Rosi La Loca)
    expect(isMobileNumber("34640170416")).toBe(true); // celular de España
    expect(isMobileNumber("390551234567")).toBe(false); // fijo de Florencia
    expect(isMobileNumber("393331234567")).toBe(true);
    expect(isMobileNumber("447700900123")).toBe(true);
    expect(isMobileNumber("525512345678")).toBeNull();
    expect(isMobileNumber("12125551234")).toBeNull();
  });
  it("Rosi La Loca (fijo de Madrid): Llamar, sin wa.me; un celular sí lleva WhatsApp", () => {
    const fijo = restaurantBooking({ name: "Rosi La Loca", city: "Madrid", phoneInternational: "+34 915 32 66 81" });
    expect(fijo.actions.map((a) => a.kind)).toEqual(["thefork", "call"]);
    expect(JSON.stringify(fijo.actions)).not.toMatch(/wa\.me/);
    const cel = restaurantBooking({ name: "Gloria Bendita", city: "Madrid", phoneInternational: "+34 640 17 04 16" });
    expect(cel.actions.find((a) => a.kind === "whatsapp")?.url).toBe("https://wa.me/34640170416");
    const mx = restaurantBooking({ name: "Bocatto Gourmet", city: "Valle de Bravo", phoneInternational: "+52 712 239 5134" });
    expect(mx.actions.map((a) => a.kind)).toEqual(["call"]);
  });
});

describe("16 · proveedores que sí aplican", () => {
  it("restaurantes: TheFork en Madrid; en Valle de Bravo ni OpenTable ni TheFork", () => {
    const madrid = offerFromTripRestaurant({ nombre: "Gloria Bendita" }, { trip: MADRID as any, now: NOW });
    expect(madrid.actions[0]).toMatchObject({ kind: "equivalent_search", label: "Buscar en TheFork" });
    expect(new URL(madrid.actions[0].url!).hostname).toBe("www.thefork.es");
    expect(madrid.actions.some((a) => /opentable/.test(String(a.url)))).toBe(false);
    const vb = offerFromTripRestaurant({ nombre: "Bistró Isabel" }, { trip: { ...MADRID, destino: "Valle de Bravo", pais_destino: "México" } as any, now: NOW });
    expect(vb.actions.some((a) => /opentable|thefork/.test(String(a.url)))).toBe(false);
    expect(vb.actions.some((a) => a.kind === "maps_listing")).toBe(true);
  });
  it("Kayak en español (kayak.com.mx) y en la lista blanca", () => {
    const f = kayakFlightsSearchUrl({ origin: "MEX", destination: "MAD", depart: "2027-03-10", ret: "2027-03-17", adults: 2 })!;
    expect(f).toBe("https://www.kayak.com.mx/flights/MEX-MAD/2027-03-10/2027-03-17/2adults");
    expect(kayakFlightsLink("MEX", "MAD", "2027-03-10", "2027-03-17", 2)).toBe(f);
    const c = kayakCarsUrl({ pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2027-05-10", dropoff_date: "2027-05-17" })!;
    expect(c).toMatch(/^https:\/\/www\.kayak\.com\.mx\/cars\//);
    expect(kayakCarsLink("Madrid", "2027-03-10", "2027-03-17")).toBe("https://www.kayak.com.mx/cars/Madrid/2027-03-10/2027-03-17");
    for (const u of [f, c]) expect(checkAllowlisted(u).ok).toBe(true);
  });
  it("Italo y Trenitalia no reciben la ruta por enlace: el botón lo dice (y Trenitalia abre en español)", () => {
    const q = { from: "Roma", to: "Florencia", date: "2027-05-14", adults: 2 };
    expect(operatorAction(OPERATORS.italo, q)).toMatchObject({ prefilled: false, label: "Italo · busca la ruta en su sitio" });
    expect(operatorAction(OPERATORS.trenitalia, q)).toMatchObject({ url: "https://www.trenitalia.com/es.html", label: "Trenitalia · busca la ruta en su sitio" });
    expect(operatorAction(OPERATORS.renfe, { from: "Madrid", to: "Sevilla", date: "2027-03-12", adults: 2 })).toMatchObject({ prefilled: true, label: "Ver horarios y precio en Renfe" });
  });
  it("en su propio coche no hay paso ni botón de renta de auto", async () => {
    const t = await tepozNuevo();
    const carIdx = t.vuelos_json.findIndex((v: any) => v?.modo === "auto");
    const busIdx = t.vuelos_json.findIndex((v: any) => v?.modo === "autobus");
    expect(carIdx).toBeGreaterThanOrEqual(0);
    expect(buildPurchasePlan(t, { selVuelo: carIdx, selHospedaje: -1, selTours: new Set() }).some((x) => x.kind === "auto")).toBe(false);
    expect(buildPurchasePlan(t, { selVuelo: busIdx, selHospedaje: -1, selTours: new Set() }).some((x) => x.kind === "auto")).toBe(true);
    const { unmount } = render(<MemoryRouter><GroundBuyButtons option={t.vuelos_json[carIdx]} trip={t} /></MemoryRouter>);
    expect(screen.queryByText("Rentar auto")).toBeNull();
    expect(screen.getByTestId("ground-route")).toBeInTheDocument();
    unmount();
    render(<MemoryRouter><GroundBuyButtons option={{ mode: "coche", from: "Florencia", to: "Roma" }} trip={{ ...MADRID, destino: "Roma → Florencia" }} /></MemoryRouter>);
    expect(screen.getByText("Rentar auto")).toBeInTheDocument();
  });
});

describe("18 · nombres visibles de tours y atracciones", () => {
  const product = (code: string, title: string, slug: string, price = 500) => ({
    productCode: code, title, productUrl: `https://www.viator.com/es-MX/tours/Madrid/${slug}/d566-${code}?mcid=42383&pid=P00327354`,
    pricing: { summary: { fromPrice: price }, currency: "MXN" }, reviews: { combinedAverageRating: 4.9, totalReviews: 900 },
  });
  it("los títulos en inglés van al final y sobran si hay tres en español; el free tour se dice", () => {
    expect(looksEnglish("Madrid Historical Walking Tour")).toBe(true);
    expect(looksEnglish("Visita guiada a pie por la Ciudad Vieja de Madrid")).toBe(false);
    expect(looksEnglish("Tour de tapas")).toBe(false);
    const list = [
      product("227078P1", "Madrid Historical Walking Tour", "Free-Tour-Exploring-the-historical-Madrid", 63.61),
      product("1", "Visita guiada a pie por la Ciudad Vieja de Madrid", "Old-City"),
      product("2", "Excursión de un día a Toledo desde Madrid", "Toledo"),
      product("3", "Entrada al Museo del Prado con guía", "Prado"),
    ];
    const tours = mapViatorProducts(list, 12);
    expect(tours.map((t) => t.codigo)).toEqual(["1", "2", "3"]);
    const dos = mapViatorProducts(list.slice(0, 3), 12);
    expect(dos.map((t) => t.codigo)).toEqual(["1", "2", "227078P1"]);
    expect(dos[2]).toMatchObject({ free_tour: true, titulo_en_ingles: true, desde: { monto: 63.61, moneda: "MXN" } });
    const view = summarizeViator({ ok: true, results: dos, consultado_at: "2026-10-28T16:00:00Z" });
    expect(view.ok && view.tours[2].mxnNote).toBe(FREE_TOUR_NOTE);
  });
  it("acentos de Google y contexto para nombres de una palabra", () => {
    expect(visiblePlaceName("Panteon de Roma", "Panteón", "Roma")).toBe("Panteón de Roma");
    expect(visiblePlaceName("David", "David", "Florencia")).toBe("David (Florencia)");
    expect(visiblePlaceName("Coliseo de Roma", "Coliseo", "Roma")).toBe("Coliseo de Roma");
    const a: any = { tours: [{ nombre: "Panteon de Roma", fuente: "google_places" }, { nombre: "David", fuente: "google_places" }] };
    enforceSources(a, [{ name: "Panteón de Roma" }, { name: "David" }], [], "google_places", { fxUsd: 18, city: "Florencia" });
    expect(a.tours.map((t: any) => t.nombre)).toEqual(["Panteón de Roma", "David (Florencia)"]);
    const e = labelExperiences([{ nombre: "Panteon de Roma", fuente: "google_places" }], [{ name: "Panteón de Roma", rating: 4.8 }], "google_places", "Roma");
    expect(e[0].nombre).toBe("Panteón de Roma");
  });
});

describe("19 · 'Editar viaje con IA' sugiere cambios del viaje actual", () => {
  it("Madrid: nada de Florencia ni Cinque Terre", () => {
    const s = editSuggestions(MADRID);
    expect(s.ejemplos.join(" | ")).not.toMatch(/Florencia|Cinque Terre|Roma/);
    expect(s.ejemplos[0]).toBe("Agrega una noche más en Madrid");
    expect(s.ejemplos.join(" | ")).toMatch(/salgo el 17 de marzo y regreso el 24 de marzo/);
    expect(s.placeholder).toMatch(/Madrid/);
  });
  it("multidestino usa sus propias ciudades", () => {
    const s = editSuggestions({ destino: "Roma → Florencia → Venecia" });
    expect(s.ejemplos.slice(0, 2)).toEqual(["Agrega una noche más en Roma y quita una de Venecia", "Reorganiza los días para pasar más tiempo en Florencia"]);
    expect(editSuggestions(null).ejemplos.join(" ")).not.toMatch(/Florencia|Cinque Terre/);
  });
});
