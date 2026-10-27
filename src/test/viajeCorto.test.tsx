// Viaje nacional corto por tierra (caso real del dueño, 27-oct-2026): CDMX → Tepoztlán, 30 oct – 1 nov,
// 2 viajeros. Datos simulados a partir de lo guardado (fixtures/casoTepoztlan.ts); sin red ni correos.
//  1. Sin vuelo lógico el paso es "Cómo llegar" (no "Vuelo"), con casetas reales y sin el $1,800 de la IA.
//  2. Precio de hotel: total_rate contra rate_per_night.
//  3. Tres niveles de hotel reales (económico, medio, premium) y el medio por defecto en el total.
//  4. Sin tarjetas vacías en restaurantes/experiencias y sin precios inventados de experiencias.
//  5. Total con precios reales y gastos estimados, separados.
//  6. "Tu selección por correo": dice qué falta junto al botón y, con todo elegido, el servidor lo acepta.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }), then: (r: any) => r({ data: [], error: null }) }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}));

import liveSearch from "./fixtures/ghotels/tepoztlan_search.json";
import { TEPOZ_FX, TEPOZ_GUARDADO, TEPOZ_TOLLS, tepozLiveHotels, tepozNuevo } from "./fixtures/casoTepoztlan";
import { arrivalByLand, arrivalStepTitle, carCostFor, groundGroupPrice } from "@/lib/groundTrip";
import { buildBuyFlow } from "@/lib/buyFlow";
import { buildPurchasePlan, quotedHotelIndex } from "@/lib/purchasePlan";
import { computeTripDesglose } from "@/lib/quote";
import { splitTripTotal } from "@/lib/totalSplit";
import { tripTotalSummary } from "@/lib/tripTotal";
import { buildSelectionRequest, notReadyLabel } from "@/lib/selectionEmail";
import { buildPickCards, missingTiersLine } from "@/lib/tripPicks";
import { tripTotals } from "@/components/RealTripTotal";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { TripPicksCarousel } from "@/components/booking/TripPicksCarousel";
import { totalAsNightlyRate } from "../../supabase/functions/hotels-search/search";
import { buildHotelTiers, preferredHotelTier, tierIndices } from "../../supabase/functions/analizar-viaje/hotelTiers";
import { capShortTripEstimates } from "../../supabase/functions/analizar-viaje/groundTransport";
import { carCost, MX_GASOLINA } from "../../supabase/functions/_shared/carCost";
import { validateSelectionRequest } from "../../supabase/functions/_shared/selection-email";
import { placeDistanceKm } from "../../supabase/functions/_shared/airports";

const NONE = { selVuelo: -1, selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} as Record<string, number> };
const desgloseOf = (trip: any, sel = NONE) => computeTripDesglose(trip, { ...sel, nochesHospedaje: 2 }, 2);

describe("1 · trayecto corto por tierra: 'Cómo llegar', casetas reales y sin precio inventado", () => {
  it("CDMX → Tepoztlán no tiene vuelo lógico (≈ 50 km en línea recta, sin aeropuerto propio)", () => {
    expect(placeDistanceKm("Ciudad de México", "Tepoztlán")).toBeLessThan(80);
    expect(arrivalByLand(TEPOZ_GUARDADO)).toBe(true);
    expect(arrivalStepTitle(TEPOZ_GUARDADO)).toBe("Cómo llegar");
    // Un viaje con vuelo lógico sigue diciendo "Vuelo".
    expect(arrivalStepTitle({ ciudad_origen: "Ciudad de México", destino: "Madrid", vuelos_json: [{ aerolinea: "Iberia", precio_por_persona: 20000 }] })).toBe("Vuelo");
    const flow = buildBuyFlow(TEPOZ_GUARDADO, NONE);
    expect(flow.steps[0]).toMatchObject({ kind: "vuelo", title: "Cómo llegar", ground: true });
  });

  it("el análisis guarda el coche con casetas REALES (Google, ida × 2) + gasolina estimada con fórmula; el autobús sin precio", async () => {
    const t = await tepozNuevo();
    const car = t.vuelos_json.find((v: any) => v.modo === "auto");
    const bus = t.vuelos_json.find((v: any) => v.modo === "autobus");
    expect(t.vuelos_json.filter((v: any) => v.modo === "auto")).toHaveLength(1); // el "chofer privado" de la IA ya no está
    expect(car.costo_auto.casetas).toMatchObject({ estado: "CON_MONTO", ida_mxn: 196, total_mxn: 392, fuente: "google_routes" });
    expect(car.costo_auto.gasolina).toMatchObject({ estado: "ESTIMADO", km_total: 164, litros_100km: 7, precio_litro: MX_GASOLINA.precio_litro });
    expect(car.costo_auto.gasolina.formula).toBe("164 km (ida y vuelta) × 7 L/100 km × $23.69/L");
    expect(car.costo_auto.gasolina.total_mxn).toBe(Math.round(164 * 0.07 * 23.69));
    expect(car.costo_auto.total_mxn).toBe(392 + 272);
    // Nunca el $1,800 (900 por persona) de la IA.
    expect(Math.round(car.precio_por_persona * 2)).toBe(664);
    expect(t.desglose_presupuesto.vuelos).toBe(664);
    expect(bus).toMatchObject({ precio_por_persona: 0, fuente_precio: "estimado" });
    expect(bus.booking_link).toBe("https://international.ado.com.mx/ado-bus/mexico-city-to-tepoztlan?locale=es-MX&currency=MXN");
  });

  it("en el viaje ya guardado, el coche tampoco suma el $1,800 de la IA: gasolina estimada y casetas por consultar", () => {
    const car = TEPOZ_GUARDADO.vuelos_json[1];
    const cost = carCostFor(TEPOZ_GUARDADO, car)!;
    expect(cost.casetas.estado).toBe("SIN_CONSULTAR");
    expect(cost.casetas.total_mxn).toBeNull();
    expect(cost.gasolina.total_mxn).toBeGreaterThan(0);
    expect(cost.gasolina.total_mxn).toBeLessThan(600);
    expect(groundGroupPrice(car, TEPOZ_GUARDADO)).toBe(cost.total_mxn);
    expect(groundGroupPrice(TEPOZ_GUARDADO.vuelos_json[0], TEPOZ_GUARDADO)).toBeNull(); // autobús: precio en ADO
    // Sin elegir: el renglón de la cotización (el coche de $1,800) se recalcula con el costo real del coche.
    expect(desgloseOf(TEPOZ_GUARDADO).vuelos).toBe(cost.total_mxn);
    expect(desgloseOf(TEPOZ_GUARDADO, { ...NONE, selVuelo: 0 }).vuelos).toBe(0);
  });

  it("Comprar: 'Cómo llegar', 'Te falta: cómo llegar · hotel', coche 'Ver ruta en Google Maps' y autobús 'Ver horarios y precio en ADO'", async () => {
    const t = await tepozNuevo();
    render(<MemoryRouter><TripPurchasePlan trip={t} selVuelo={-1} selHospedaje={-1} selTours={new Set()} bookings={[]} userId={null} marksState={{ rows: [], marks: new Map(), mark: async () => ({ ok: true }), unmark: async () => ({ ok: true }) } as any} /></MemoryRouter>);
    const step = screen.getByTestId("comprar-vuelo");
    expect(within(step).getByRole("heading", { level: 3 })).toHaveTextContent("Cómo llegar");
    expect(within(step).queryByText(/^Vuelo$/)).toBeNull();
    expect(screen.getByTestId("trip-comprar-falta")).toHaveTextContent("Te falta: cómo llegar · hotel");
    const opts = within(step).getAllByTestId("vuelo-opcion");
    expect(opts.map((o) => within(o).getByTestId("vuelo-opcion-precio").textContent)).toEqual(["Precio en el sitio", "$664 MXN"]);
    expect(step.textContent).not.toMatch(/1,800|3,400|Estimado por IA/);
    // Por defecto el coche (el renglón del total): casetas reales y gasolina estimada con su fórmula.
    expect(within(step).getByTestId("ground-casetas")).toHaveTextContent("Casetas: $392 MXN ida y vuelta ($196 MXN de ida × 2)");
    expect(within(step).getByTestId("ground-gasolina")).toHaveTextContent("estimado");
    expect(within(step).getByTestId("ground-formula")).toHaveTextContent("164 km (ida y vuelta) × 7 L/100 km × $23.69/L");
    const buy = within(step).getByTestId("comprar-vuelo-abrir");
    expect(buy).toHaveTextContent("Ver ruta en Google Maps");
    expect(buy.textContent).not.toMatch(/Comprar en Google Maps/);
    // Autobús elegido: ADO precargado, sin precio.
    const items = buildPurchasePlan(t, { selVuelo: 0, selHospedaje: -1, selTours: new Set() });
    expect(items[0]).toMatchObject({ title: "Autobús ADO", price: null, site: "ADO", buttonLabel: "Ver horarios y precio en ADO" });
    expect(items[0].url).toContain("international.ado.com.mx/ado-bus/mexico-city-to-tepoztlan");
  });
});

describe("2 · precio del hotel: total_rate contra rate_per_night", () => {
  it("si Google pone el total de la estancia como 'por noche', se divide entre las noches", () => {
    expect(totalAsNightlyRate(725, 725, 2)).toBe(true);
    expect(totalAsNightlyRate(168, 336, 2)).toBe(false);
    expect(totalAsNightlyRate(210, 210, 1)).toBe(false); // una noche: por noche y total son iguales de verdad
  });

  it("hotels-search (fixture SerpApi): rate_per_night es por noche y total_rate la estancia; nunca total × noches", async () => {
    const res = await tepozLiveHotels();
    const red = res.find((h) => h.name === "The Red Tree House")!;
    expect(red).toMatchObject({ nightly_usd: 363, total_usd: 725, nights: 2 }); // 725 / 2 (antes: 725 por noche → $26,694 por 2 noches)
    const posada = res.find((h) => h.name === "Posada del Tepozteco")!;
    expect(posada).toMatchObject({ nightly_usd: 168, total_usd: 336, nightly_before_taxes_usd: 145, total_before_taxes_usd: 290 });
    expect(res.some((h) => h.name === "Sin calificación")).toBe(false); // < 4.0 fuera cuando hay 3 o más bien calificados
    expect(res.map((h) => h.nightly_usd)).toEqual([...res.map((h) => h.nightly_usd)].sort((a, b) => a - b));
    expect(liveSearch.properties.length).toBe(7);
  });
});

describe("3 · tres niveles de hotel reales y el medio por defecto", () => {
  it("con lista en vivo se guardan económico, medio y premium (no solo el que eligió la IA)", async () => {
    const t = await tepozNuevo();
    expect(t.hospedaje_json.map((h: any) => [h.tier, h.nombre])).toEqual([
      ["ahorro", "Hotel Tepoztlán Centro"], ["equilibrio", "Posada del Tepozteco"], ["premium", "The Red Tree House"],
    ]);
    for (const h of t.hospedaje_json) {
      expect(h).toMatchObject({ fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" });
      expect(h.property_token).toBeTruthy(); // "Ver ofertas reales" (HotelOffersButton) aparece con el token
    }
    expect(t.hospedaje_json[1].precio_por_noche).toBe(Math.round(168 * TEPOZ_FX));
    // El total suma el MEDIO (2 noches; el precio en vivo ya es del grupo), no el premium.
    expect(t.desglose_presupuesto.hospedaje).toBe(Math.round(168 * TEPOZ_FX) * 2);
    expect(t.hospedaje_json[quotedHotelIndex(t)].tier).toBe("equilibrio");
    // Y en Comprar se ven los tres.
    const flow = buildBuyFlow(t, NONE);
    const hotel = flow.steps.find((s) => s.kind === "hospedaje")!;
    expect(hotel.kind === "hospedaje" && hotel.options.length).toBe(3);
  });

  it("niveles: más barato, el del medio y el percentil ~85 (no un outlier); preferencia del perfil", () => {
    expect(tierIndices(3)).toEqual({ ahorro: 0, equilibrio: 1, premium: 2 });
    expect(tierIndices(10)).toEqual({ ahorro: 0, equilibrio: 4, premium: 8 });
    expect(preferredHotelTier("Lujo")).toBe("premium");
    expect(preferredHotelTier("económico")).toBe("ahorro");
    expect(preferredHotelTier(null)).toBe("equilibrio");
    // Sin lista en vivo se deja lo de la IA con su nivel; si el cliente excluyó el hotel, nada se agrega.
    expect(buildHotelTiers([{ nombre: "X", precio_por_noche: 2000 }], [], { fxUsd: 18, consultedAt: "x" })).toHaveLength(1);
    expect(buildHotelTiers([], [{ name: "Y", nightly_usd: 100 }], { fxUsd: 18, consultedAt: "x", exclude: true })).toEqual([]);
  });
});

describe("4 · restaurantes y experiencias: sin tarjetas vacías ni precios inventados", () => {
  it("un nivel sin opción no ocupa tarjeta: se dice en una línea pequeña", () => {
    const cards = buildPickCards(TEPOZ_GUARDADO.restaurantes_json, [0, 1], "restaurante", null);
    expect(missingTiersLine(cards)).toBe("No encontramos opciones verificadas de nivel alto aquí.");
    render(<MemoryRouter><TripPicksCarousel kind="restaurante" city="Tepoztlán" list={TEPOZ_GUARDADO.restaurantes_json} indices={[0, 1]} taste={null} trip={TEPOZ_GUARDADO}
      actionFor={() => null} isChosen={() => false} /></MemoryRouter>);
    expect(screen.queryAllByTestId("pick-card-vacia")).toHaveLength(0);
    expect(screen.queryByText(/Sin opción (cara|de precio medio) verificada/)).toBeNull();
    expect(screen.getByTestId("picks-restaurante-sin-nivel")).toHaveTextContent("nivel alto");
  });

  it("experiencias con precio de la IA: 'Precio en el sitio' (nunca '$50 MXN por persona · estimado') y todas se muestran", () => {
    render(<MemoryRouter><TripPicksCarousel kind="experiencia" city="Tepoztlán" list={TEPOZ_GUARDADO.tours_json} indices={[0, 1, 2, 3]} taste={null} trip={TEPOZ_GUARDADO}
      actionFor={() => null} isChosen={() => false} /></MemoryRouter>);
    const cards = screen.getAllByTestId("pick-card");
    expect(cards).toHaveLength(4);
    expect(document.body.textContent).not.toMatch(/\$50 MXN|\$120 MXN/);
    for (const c of cards) expect(within(c).getByTestId("pick-price")).toHaveTextContent(/Precio en el sitio|Entrada libre/);
    expect(screen.queryAllByTestId("pick-card-vacia")).toHaveLength(0);
    // Sin foto real: placeholder de marca (o foto), nunca un hueco.
    for (const c of cards) expect(within(c).getByTestId("smart-image")).toBeInTheDocument();
    // En "Comprar", la experiencia elegida no muestra el precio de la IA.
    const items = buildPurchasePlan(TEPOZ_GUARDADO, { selVuelo: -1, selHospedaje: -1, selTours: new Set([2]) });
    expect(items.find((i) => i.kind === "actividad")).toMatchObject({ price: null, priceNote: "Precio en el sitio: sin precio verificado." });
  });
});

describe("5 · total con precios reales y gastos estimados, separados", () => {
  it("caso guardado: antes $37,350; ahora el hotel caro y el coche de la IA no se suman como reales", async () => {
    const t = await tepozNuevo();
    const sel = { ...NONE, selVuelo: 1, selHospedaje: 1 }; // coche y hotel medio elegidos
    const d = desgloseOf(t, sel);
    const items = buildBuyFlow(t, sel).items;
    const sp = splitTripTotal({ trip: t, sel, desglose: d, items });
    expect(sp.total).toBe(Object.values(d).reduce((s, v) => s + v, 0));
    expect(sp.realParts.map((p) => p.label)).toEqual(["casetas", "hotel"]);
    expect(sp.real).toBe(392 + Math.round(168 * TEPOZ_FX) * 2);
    expect(sp.estParts.map((p) => p.label)).toEqual(["gasolina", "comida", "experiencias", "transporte local", "extras"]);
    expect(sp.total).toBeLessThan(20000);
    expect(TEPOZ_GUARDADO.total_estimado).toBe(37350);
  });

  it("estimados acotados para una escapada nacional corta (días = noches + 1)", () => {
    const { desglose, acotados } = capShortTripEstimates(TEPOZ_GUARDADO.desglose_presupuesto, { noches: 2, viajeros: 2, enCoche: true });
    expect(acotados).toEqual(["transporte_local"]);
    expect(desglose).toMatchObject({ comida: 5200, tours: 1500, transporte_local: 600, extras: 956, hospedaje: 26694, vuelos: 1800 });
    expect(capShortTripEstimates({ comida: 20000, extras: 9000 }, { noches: 2, viajeros: 2, enCoche: false }).desglose).toMatchObject({ comida: 5400, extras: 1500 });
  });

  it("la cifra grande de la página lleva el mismo reparto (RealTripTotal) y la barra dice 'cómo llegar'", async () => {
    const t = await tepozNuevo();
    const items = buildBuyFlow(t, NONE).items;
    const s = tripTotalSummary({ trip: t, sel: NONE, desglose: desgloseOf(t), items });
    expect(s.missing).toEqual(["cómo llegar", "hotel"]);
    expect(s.hint).toMatch(/^Elige cómo llegar y hotel para ver el total real\./);
  });
});

describe("6 · 'Tu selección por correo' dice por qué está apagado y, con todo elegido, el servidor lo acepta", () => {
  it("sin hotel elegido: 'Elige tu hotel para enviarte la selección' (no 'tu vuelo' en un viaje por carretera)", async () => {
    const t = await tepozNuevo();
    const sel = { ...NONE, selVuelo: 1 };
    const d = desgloseOf(t, sel);
    const r = buildSelectionRequest(t, sel, { travelers: 2, nights: 2, desglose: d, total: tripTotals(t, 2, d).total });
    expect(r).toMatchObject({ ready: false, missing: ["tu hotel"], payload: null });
    expect(notReadyLabel(r.missing)).toBe("Elige tu hotel para enviarte la selección");
    const none = buildSelectionRequest(t, NONE, { travelers: 2, nights: 2, desglose: desgloseOf(t), total: tripTotals(t, 2, desgloseOf(t)).total });
    expect(none.missing).toEqual(["cómo llegar", "tu hotel"]);
    expect(notReadyLabel(none.missing)).toBe("Elige cómo llegar y tu hotel para enviarte la selección");
  });

  it("coche y hotel elegidos: la petición pasa la validación del servidor (mismo precio del coche); no se manda ningún correo", async () => {
    for (const trip of [await tepozNuevo(), TEPOZ_GUARDADO]) {
      const sel = { ...NONE, selVuelo: 1, selHospedaje: 0 };
      const d = desgloseOf(trip, sel);
      const r = buildSelectionRequest(trip, sel, { travelers: 2, nights: 2, desglose: d, total: tripTotals(trip, 2, d).total });
      expect(r.ready).toBe(true);
      const v = validateSelectionRequest({ ...r.payload, trip_id: trip.id }, { trip, now: new Date("2026-10-27T16:00:00Z") });
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.input.flight).toMatchObject({ ground: true, price: groundGroupPrice(trip.vuelos_json[1], trip) });
    }
  });

  it("un viaje con casetas en el desglose ya no se rechaza con 'El desglose cambió'", async () => {
    const t = { ...(await tepozNuevo()) };
    t.desglose_presupuesto = { ...t.desglose_presupuesto, casetas: 392 };
    const sel = { ...NONE, selVuelo: 1, selHospedaje: 0 };
    const d = desgloseOf(t, sel);
    expect(d.casetas).toBe(392);
    const r = buildSelectionRequest(t, sel, { travelers: 2, nights: 2, desglose: d, total: tripTotals(t, 2, d).total });
    const v = validateSelectionRequest({ ...r.payload, trip_id: t.id }, { trip: t, now: new Date("2026-10-27T16:00:00Z") });
    expect(v).toMatchObject({ ok: true });
  });
});

describe("costo del coche (puro)", () => {
  it("sin casetas de Google: no se inventan; con 'SIN_MONTO' tampoco se suman", () => {
    expect(carCost({ kmIda: 100, tolls: null }).casetas).toMatchObject({ estado: "SIN_CONSULTAR", total_mxn: null });
    expect(carCost({ kmIda: 100, tolls: null, tollsFailed: true }).casetas.estado).toBe("NO_DISPONIBLE");
    const sin = carCost({ kmIda: 100, tolls: { ...TEPOZ_TOLLS, estado: "SIN_MONTO", montos: [], monto_mxn: null } });
    expect(sin.casetas).toMatchObject({ estado: "SIN_MONTO", total_mxn: null });
    expect(sin.real_mxn).toBe(0);
    expect(sin.total_mxn).toBe(sin.gasolina.total_mxn);
  });
});
