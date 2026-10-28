// "Armar mi itinerario" (Experiencias) respeta la llegada, la salida y lo que el itinerario ya tiene
// (pendientes del E2E en producción, 28-oct-2026):
//   * el día de llegada tras un vuelo largo (> 8 h, o internacional sin duración) no lleva tours ni
//     museos por la mañana: "Llegada y descanso" y una cena cerca del hotel si cabe;
//   * con la hora de llegada del vuelo no se pone nada antes de llegar;
//   * no se repite una comida que el itinerario del viaje ya tiene ese día;
//   * el último día se deja tiempo para ir al aeropuerto si se sabe la hora del vuelo.
import { describe, expect, it } from "vitest";
import {
  applyPlanToItinerary, arrivalFor, buildItinerary, departureFor, existingMeals, type ExpItem, itineraryContext, stayDays, type TripCity,
} from "@/lib/experiencias";

const R = (key: string, km: number, serves = { desayuno: true, brunch: false, comida: true, cena: true }): ExpItem => ({
  key, kind: "restaurante", city: "Roma", title: key, lat: null, lng: null, distanceKm: km, rating: 4.7, reviews: 900, serves,
});
const M = (key: string, km: number): ExpItem => ({ key, kind: "museo", city: "Roma", title: key, lat: null, lng: null, distanceKm: km, rating: 4.8, reviews: 5000 });
const T = (key: string): ExpItem => ({ key, kind: "tour", city: "Roma", title: key, lat: null, lng: null, distanceKm: null, rating: 4.9, reviews: 3000 });
const W = (key: string): ExpItem => ({ key, kind: "wow", city: "Roma", title: key, lat: null, lng: null, distanceKm: null, rating: 4.9, reviews: 800 });

const ITEMS = [
  R("Trattoria Cerca", 0.2), R("Osteria Media", 0.8), R("Ristorante Lejos", 2.5), R("Caffè Uno", 0.3), R("Bar Dos", 1.1), R("Pizzeria Tres", 1.4),
  M("Museos Vaticanos", 2.0), M("Galería Borghese", 1.5), T("Coliseo guiado"), T("Trastevere a pie"), W("Vespa al atardecer"),
];
const ROMA: TripCity = { label: "Roma", key: "Roma", checkin: "2026-11-10", checkout: "2026-11-13" };
const baseTrip = (over: Record<string, unknown> = {}) => ({
  id: "t1", destino: "Roma", pais_destino: "Italia", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-13",
  vuelos_json: [
    { tier: "equilibrio", mode: "vuelo", aerolinea: "Aeroméxico", duracion: "12h 45m", escalas: "Directo", precio_por_persona: 24765,
      fuente_precio: "serpapi", from: "Ciudad de México", to: "Roma", ciudad: "Roma" },
  ],
  itinerario_json: [], hospedaje_json: [], ...over,
});
const slotsOf = (plan: ReturnType<typeof buildItinerary>, i: number) => plan.days[i].slots;
const kinds = (plan: ReturnType<typeof buildItinerary>, i: number) => slotsOf(plan, i).filter((s) => s.item).map((s) => `${s.slot}:${s.item!.kind}`);

describe("día de llegada tras un vuelo largo", () => {
  it("vuelo de 12 h 45 min sin hora de llegada: 'Llegada y descanso', sin tours ni museos, y solo una cena cerca del hotel", () => {
    const trip = baseTrip();
    const ctx = itineraryContext(trip, ROMA, [ROMA], false);
    expect(ctx.arrival).toMatchObject({ largo: true, hora: null, internacional: true });
    const plan = buildItinerary(ITEMS, stayDays(ROMA.checkin, ROMA.checkout), "del hotel", ctx);
    const d1 = slotsOf(plan, 0);
    expect(d1[0]).toMatchObject({ slot: "llegada", texto: "Llegada y descanso" });
    expect(d1[0].nota).toMatch(/Vuelo de 12 h 45 min: sin tours ni museos por la mañana/);
    // Ni desayuno ni mañana ni tarde; ningún museo, tour o experiencia ese día.
    expect(d1.some((s) => s.slot === "manana" || s.slot === "desayuno" || s.slot === "tarde")).toBe(false);
    expect(kinds(plan, 0)).toEqual(["cena:restaurante"]);
    // La cena es la más cercana al hotel.
    expect(d1.find((s) => s.slot === "cena")!.item!.title).toBe("Trattoria Cerca");
    // Los demás días siguen normales (museo o tour por la mañana).
    expect(["museo", "tour"]).toContain(slotsOf(plan, 1).find((s) => s.slot === "manana")!.item!.kind);
  });

  it("sin duración: un vuelo internacional cuenta como largo; uno nacional no", () => {
    const sinDur = baseTrip({ vuelos_json: [{ tier: "equilibrio", mode: "vuelo", from: "Ciudad de México", to: "Roma", ciudad: "Roma" }] });
    expect(arrivalFor(sinDur, ROMA, true)).toMatchObject({ largo: true, horas: null, internacional: true });
    const cun: TripCity = { label: "Cancún", key: "Cancún", checkin: "2026-11-10", checkout: "2026-11-12" };
    const nac = baseTrip({ destino: "Cancún", pais_destino: "México", vuelos_json: [{ tier: "equilibrio", mode: "vuelo", from: "Ciudad de México", to: "Cancún", ciudad: "Cancún" }] });
    expect(arrivalFor(nac, cun, true)).toMatchObject({ largo: false, internacional: false });
    const plan = buildItinerary(ITEMS, stayDays(cun.checkin, cun.checkout), "del hotel", itineraryContext(nac, cun, [cun], false));
    expect(slotsOf(plan, 0).find((s) => s.slot === "manana")!.item).not.toBeNull();
  });

  it("con la hora de llegada del vuelo (Google Flights): llega al día siguiente → ese día 'En camino'; al llegar, nada antes de la hora", () => {
    const trip = baseTrip({ vuelos_json: [{ tier: "equilibrio", mode: "vuelo", duracion: "11h 40m", fuente_precio: "en_vivo", from: "Ciudad de México", to: "Roma",
      ciudad: "Roma", salida: "2026-11-10 18:05", llegada: "2026-11-11 12:45" }] });
    const ctx = itineraryContext(trip, ROMA, [ROMA], false);
    expect(ctx.arrival).toMatchObject({ fecha: "2026-11-11", hora: "12:45", largo: true });
    const plan = buildItinerary(ITEMS, stayDays(ROMA.checkin, ROMA.checkout), "del hotel", ctx);
    expect(slotsOf(plan, 0)).toEqual([expect.objectContaining({ slot: "en_camino", texto: "Día de vuelo" })]);
    const d2 = slotsOf(plan, 1);
    expect(d2[0]).toMatchObject({ slot: "llegada", hora: "12:45", texto: "Llegada y descanso" });
    expect(d2[0].nota).toMatch(/llegas a las 12:45/);
    // 12:45 + descanso: no cabe la comida de las 14:00; sí la cena.
    expect(kinds(plan, 1)).toEqual(["cena:restaurante"]);
  });

  it("vuelo corto con hora de llegada: nada antes de llegar (más el traslado)", () => {
    const cun: TripCity = { label: "Cancún", key: "Cancún", checkin: "2026-11-10", checkout: "2026-11-12" };
    const trip = baseTrip({ destino: "Cancún", pais_destino: "México", vuelos_json: [{ tier: "equilibrio", mode: "vuelo", duracion: "2h 20m", fuente_precio: "en_vivo",
      from: "Ciudad de México", to: "Cancún", salida: "2026-11-10 10:00", llegada: "2026-11-10 13:20" }] });
    const plan = buildItinerary(ITEMS, stayDays(cun.checkin, cun.checkout), "del hotel", itineraryContext(trip, cun, [cun], false));
    const d1 = slotsOf(plan, 0);
    expect(d1[0]).toMatchObject({ slot: "llegada", hora: "13:20", texto: "Llegada al hotel" });
    expect(d1.map((s) => s.slot)).toEqual(["llegada", "tarde", "cena"]);
  });

  it("por tierra (sin vuelo) no hay 'Llegada y descanso'", () => {
    const trip = baseTrip({ vuelos_json: [{ tier: "equilibrio", mode: "autobus", duracion: "14h", from: "Ciudad de México", to: "Roma" }] });
    expect(arrivalFor(trip, ROMA, true)).toBeNull();
    const plan = buildItinerary(ITEMS, stayDays(ROMA.checkin, ROMA.checkout), "del hotel", itineraryContext(trip, ROMA, [ROMA], false));
    expect(slotsOf(plan, 0).some((s) => s.slot === "llegada")).toBe(false);
  });
});

describe("no duplica comidas que el itinerario del viaje ya tiene", () => {
  it("una cena ya puesta en itinerario_json ese día se respeta y no se agrega otra", () => {
    const trip = baseTrip({
      vuelos_json: [],
      itinerario_json: [
        { dia: 1, titulo: "Llegada", "mañana": "Llegada a Roma", tarde: "Paseo por el centro", noche: "Cena en Da Enzo al 29, en Trastevere" },
        { dia: 2, fecha: "2026-11-11", titulo: "Vaticano", "mañana": "Vaticano", tarde: "Libre", noche: "Paseo nocturno",
          agregados: [{ fecha: "2026-11-11", hora: "14:00", titulo: "Comida: Roscioli (reserva)", agregado_por: "iato" }] },
      ],
    });
    const meals = existingMeals(trip, "Roma", false);
    expect(meals["2026-11-10"]).toEqual([{ slot: "cena", titulo: "Cena en Da Enzo al 29, en Trastevere" }]);
    expect(meals["2026-11-11"]).toEqual([{ slot: "comida", titulo: "Comida: Roscioli (reserva)" }]);
    const plan = buildItinerary(ITEMS, stayDays(ROMA.checkin, ROMA.checkout), "del hotel", itineraryContext(trip, ROMA, [ROMA], false));
    const cena1 = slotsOf(plan, 0).find((s) => s.slot === "cena")!;
    expect(cena1).toMatchObject({ item: null, texto: "Cena en Da Enzo al 29, en Trastevere" });
    expect(cena1.nota).toMatch(/no agregamos otra/);
    const comida2 = slotsOf(plan, 1).find((s) => s.slot === "comida")!;
    expect(comida2).toMatchObject({ item: null, texto: "Comida: Roscioli (reserva)" });
    // Al guardar no se agrega otra cena ese día (solo los espacios con lugar).
    const saved: any = applyPlanToItinerary(trip.itinerario_json, trip, "Roma", plan, false);
    const day1 = saved.find((d: any) => d.dia === 1);
    expect((day1.agregados ?? []).filter((a: any) => /^Cena:/.test(a.titulo))).toHaveLength(0);
    expect((saved.find((d: any) => d.fecha === "2026-11-11").agregados ?? []).filter((a: any) => /^Comida:/.test(a.titulo))).toHaveLength(1);
  });

  it("los agregados de Experiencias de esa ciudad no cuentan (se reemplazan al guardar)", () => {
    const trip = baseTrip({ itinerario_json: [{ dia: 1, fecha: "2026-11-10", agregados: [{ hora: "20:30", titulo: "Cena: Viejo", fuente: "experiencias", ciudad: "Roma" }] }] });
    expect(existingMeals(trip, "Roma", false)["2026-11-10"]).toBeUndefined();
  });
});

describe("último día: tiempo para salir al aeropuerto", () => {
  it("vuelo de regreso a las 15:10 (traído en PDF): el día de salida solo lleva el desayuno y 'Salida al aeropuerto' a las 11:10", () => {
    const trip = baseTrip({ vuelos_json: [
      { mode: "vuelo", numero_vuelo: "AM 2", from: "Ciudad de México", to: "Roma", fecha: "2026-11-10", hora_salida: "00:30", desde_pdf: true },
      { mode: "vuelo", numero_vuelo: "AM 3", from: "Roma", to: "Ciudad de México", fecha: "2026-11-13", hora_salida: "15:10", desde_pdf: true },
    ] });
    const ctx = itineraryContext(trip, ROMA, [ROMA], false);
    expect(departureFor(trip, ROMA, true)).toEqual({ fecha: "2026-11-13", hora: "15:10", internacional: true });
    const plan = buildItinerary(ITEMS, stayDays(ROMA.checkin, ROMA.checkout), "del hotel", ctx);
    const last = plan.days[plan.days.length - 1];
    expect(last.fecha).toBe("2026-11-13");
    expect(last.slots.map((s) => s.slot)).toEqual(["desayuno", "salida"]);
    expect(last.slots[1]).toMatchObject({ hora: "11:10", texto: "Salida al aeropuerto" });
    expect(last.slots[1].nota).toMatch(/sale a las 15:10: llega al aeropuerto 3 h antes/);
  });

  it("sin hora del vuelo de regreso: el plan no cambia (no inventa una hora)", () => {
    const trip = baseTrip({ vuelos_json: [] });
    const plan = buildItinerary(ITEMS, stayDays(ROMA.checkin, ROMA.checkout), "del hotel", itineraryContext(trip, ROMA, [ROMA], false));
    expect(plan.days.map((d) => d.fecha)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(plan.days.some((d) => d.slots.some((s) => s.slot === "salida"))).toBe(false);
  });
});
