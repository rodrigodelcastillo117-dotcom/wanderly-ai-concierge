// R4 viajes N-P1 y P2-1. Italia 2230848b (fixture armado con SELECT de producción, 29-oct-2026): el ajuste
// del día 1 recorría TODOS los días +1 y Florencia y Venecia quedaban un día tarde frente a Comprar (hoteles
// 14–17 y 17–20, trenes del 14 y del 17); el 20 may, día del vuelo VCE→MEX, quedaba como día de paseo.
// P2-1: sin hora de llegada guardada pero con salida y duración, la llegada se calcula (con la zona horaria
// de cada ciudad); el título del día 1 ya no dice «llegada» si nada llega ese día.
import { describe, it, expect } from "vitest";
import { calendarDays, flightTimesOfRow, RETURN_DAY_TITLE } from "@/lib/itineraryCalendar";
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute";
import { alignStoredArrival, neutralArrivalDay } from "../../supabase/functions/_shared/tripCalendar";
import ITALIA_RAW from "./fixtures/italia2230848b.json";

const ITALIA: any = ITALIA_RAW;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const byDia = (days: any[]) => new Map(days.map((d) => [d.dia, d]));

/** Cada día con plan cae dentro de la estancia de su ciudad (el último puede ser el día de salida). */
function assertMatchesStays(trip: any, days: any[]) {
  const stays = cityStays(trip);
  expect(stays.map((s) => [s.city, s.checkin, s.checkout])).toEqual([
    ["Roma", "2027-05-10", "2027-05-14"], ["Florencia", "2027-05-14", "2027-05-17"], ["Venecia", "2027-05-17", "2027-05-20"],
  ]);
  for (const d of days) {
    const s = stays.find((x) => x.city === d.ciudad);
    expect(s, `día ${d.dia} sin ciudad`).toBeTruthy();
    const ok = d.fecha >= s!.checkin && (d.fecha < s!.checkout || (d.fecha === trip.fecha_regreso && s === stays[stays.length - 1]));
    expect(ok, `día ${d.dia} (${d.fecha}) fuera de ${s!.city} ${s!.checkin}–${s!.checkout}`).toBe(true);
  }
}

describe("N-P1: Italia 2230848b, varias ciudades — el ajuste del día 1 solo mueve la primera ciudad", () => {
  it("vuelo equilibrio (sale 22:00, llega 22:40 +1): Roma absorbe el día de vuelo; Florencia y Venecia no se mueven", () => {
    const days = calendarDays(clone(ITALIA));
    expect(days).toHaveLength(11);
    expect(days.map((d) => d.fecha)).toEqual(Array.from({ length: 11 }, (_, i) => `2027-05-${String(10 + i).padStart(2, "0")}`));
    const m = byDia(days);
    // Roma: vuelo, llegada y lo que cabe del plan (Coliseo, Vaticano) hasta el 13.
    expect(m.get(1)).toMatchObject({ ciudad: "Roma", tipo: "vuelo", titulo: "Vuelo a Roma" });
    expect(m.get(1)!.noche).toMatch(/22:00/);
    expect(m.get(2)).toMatchObject({ ciudad: "Roma", tipo: "llegada", fecha: "2027-05-11" });
    expect(m.get(2)!.noche).toMatch(/Llegas a Roma a las 22:40/);
    // Llega 22:40: no queda nada de «Primeros pasos en la Ciudad Eterna», el título solo dice la llegada.
    expect(m.get(2)!.titulo).toBe("Llegada a Roma");
    expect(m.get(3)!.titulo).toMatch(/Roma imperial/);
    expect(m.get(4)!.titulo).toMatch(/Vaticano/);
    expect(days.filter((d) => d.ciudad === "Roma").map((d) => d.fecha)).toEqual(["2027-05-10", "2027-05-11", "2027-05-12", "2027-05-13"]);
    // Florencia el 14 (tren del 14, hotel 14–17), como en Comprar y en el plan guardado.
    expect(m.get(5)).toMatchObject({ ciudad: "Florencia", fecha: "2027-05-14" });
    expect(String(m.get(5)!["mañana"])).toMatch(/Tren de alta velocidad.*Florencia/);
    expect(days.filter((d) => d.ciudad === "Florencia").map((d) => d.fecha)).toEqual(["2027-05-14", "2027-05-15", "2027-05-16"]);
    // Venecia el 17 (tren del 17, hotel 17–20).
    expect(m.get(8)).toMatchObject({ ciudad: "Venecia", fecha: "2027-05-17" });
    expect(String(m.get(8)!["mañana"])).toMatch(/Florencia SMN hacia la estación Venezia/);
    expect(m.get(10)).toMatchObject({ ciudad: "Venecia", fecha: "2027-05-19" });
    expect(String(m.get(10)!["mañana"])).toMatch(/Excursión en barco/);
    // El último día sigue siendo el de salida (vuelo VCE→MEX), no un día de paseo.
    expect(m.get(11)).toMatchObject({ fecha: "2027-05-20", pendiente: true, titulo: RETURN_DAY_TITLE, ciudad: "Venecia" });
    expect(JSON.stringify(m.get(11))).not.toMatch(/Excursión|Gran Canal/);
    assertMatchesStays(ITALIA, days.filter((d) => !d.pendiente));
  });

  it("con el vuelo directo elegido (llega 15:30 +1) también cuadra con Comprar", () => {
    const t = { ...clone(ITALIA), selections: { vuelo: { i: 2 } } };
    const days = calendarDays(t);
    const m = byDia(days);
    expect(m.get(1)!.tipo).toBe("vuelo");
    expect(m.get(2)!.tipo).toBe("llegada");
    expect(`${m.get(2)!.tarde} ${m.get(2)!.noche}`).toMatch(/15:30/);
    expect(m.get(5)).toMatchObject({ ciudad: "Florencia", fecha: "2027-05-14" });
    expect(m.get(8)).toMatchObject({ ciudad: "Venecia", fecha: "2027-05-17" });
    expect(m.get(11)).toMatchObject({ pendiente: true, titulo: RETURN_DAY_TITLE });
    assertMatchesStays(t, days.filter((d) => !d.pendiente));
  });

  it("alignStoredArrival: solo cambia el tramo de la primera ciudad (el resto queda idéntico)", () => {
    const src = ITALIA.itinerario_json.days.map((d: any) => ({ ...d }));
    const out = alignStoredArrival(src, {
      fechaSalida: "2027-05-10", fechaRegreso: "2027-05-20", destino: "Roma", origen: "Ciudad de México", enAvion: true, totalDays: 11,
      flight: { salida: "2027-05-10 22:00", llegada: "2027-05-11 22:40" },
    });
    expect(out.ajuste).toBe("recorrido");
    const after = out.days.filter((d) => d.ciudad !== "Roma");
    expect(after).toEqual(src.filter((d: any) => d.ciudad !== "Roma"));
    expect(out.days.filter((d) => d.ciudad === "Roma").map((d) => d.dia)).toEqual([1, 2, 3, 4]);
  });

  it("si la primera ciudad no alcanza para el vuelo y la llegada, no se mueve nada: el día 1 no afirma la llegada", () => {
    const t = clone(ITALIA);
    // Roma con un solo día en el plan (Florencia empieza el día 2).
    t.itinerario_json.days = [t.itinerario_json.days[0], ...t.itinerario_json.days.slice(4).map((d: any, i: number) => ({ ...d, dia: i + 2 }))];
    const days = calendarDays(t);
    const m = byDia(days);
    expect(m.get(1)!.tipo).toBe("llegada_sin_hora");
    expect(m.get(2)).toMatchObject({ ciudad: "Florencia", fecha: "2027-05-11" });
  });
});

describe("Una sola ciudad: se sigue recorriendo el plan completo", () => {
  it("Roma 10–14 may con vuelo que llega al día siguiente: vuelo, llegada y el regreso en el último día", () => {
    const t = {
      destino: "Roma", ciudad_origen: "Ciudad de México", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-14",
      vuelos_json: [{ aerolinea: "British Airways", tier: "equilibrio", salida: "2027-05-10 22:00", llegada: "2027-05-11 22:40", to: "Roma" }],
      itinerario_json: [
        { dia: 1, ciudad: "Roma", titulo: "Llegada", "mañana": "Llegada a Fiumicino.", tarde: "Piazza Navona.", noche: "Trastevere." },
        { dia: 2, ciudad: "Roma", titulo: "Coliseo", "mañana": "Coliseo.", tarde: "Foro.", noche: "Monti." },
        { dia: 3, ciudad: "Roma", titulo: "Vaticano", "mañana": "Museos Vaticanos.", tarde: "San Pedro.", noche: "Prati." },
        { dia: 4, ciudad: "Roma", titulo: "Borghese", "mañana": "Borghese.", tarde: "Monti.", noche: "Giolitti." },
        { dia: 5, ciudad: "Roma", titulo: "Salida de Roma", "mañana": "Desayuno.", tarde: "Traslado a Fiumicino.", noche: "Vuelo de regreso." },
      ],
    };
    const d = calendarDays(t);
    expect(d.map((x) => [x.dia, x.fecha, x.titulo])).toEqual([
      [1, "2027-05-10", "Vuelo a Roma"], [2, "2027-05-11", "Llegada a Roma"], [3, "2027-05-12", "Coliseo"],
      [4, "2027-05-13", "Vaticano"], [5, "2027-05-14", "Salida de Roma"],
    ]);
  });
});

describe("P2-1: llegada calculada con la salida y la duración (viajes viejos sin hora de llegada)", () => {
  it("Madrid: sale 11:00 (CDMX) y dura 11 h → llega el 11 mar 05:00 (hora de Madrid)", () => {
    expect(flightTimesOfRow({ notas: "Redondo, clase turista. Directo, sale 10 mar 11:00, horario cómodo.", duracion: "11h 0m" }, "2027-03-10",
      { origen: "Ciudad de México", destino: "Madrid" }))
      .toEqual({ salida: "2027-03-10 11:00", llegada: "2027-03-11 05:00", calculada: true });
  });

  it("Tokio: sale 05:45 y dura 18 h 5 min → llega el 11 feb 14:50 (hora de Tokio); sin zona horaria no se calcula", () => {
    const v = { notas: "Sale 10 feb 05:45, viaje redondo, tarifa turista.", duracion: "18h 5m" };
    expect(flightTimesOfRow(v, "2027-02-10", { origen: "Ciudad de México", destino: "Tokio" }))
      .toEqual({ salida: "2027-02-10 05:45", llegada: "2027-02-11 14:50", calculada: true });
    expect(flightTimesOfRow(v, "2027-02-10", { origen: "Ciudad de México", destino: "Ciudad Inventada" })).toBeNull();
    expect(flightTimesOfRow(v, "2027-02-10")).toBeNull();
    // Rangos o duraciones raras: no se adivina.
    expect(flightTimesOfRow({ ...v, duracion: "18h - 21h" }, "2027-02-10", { origen: "Ciudad de México", destino: "Tokio" })).toBeNull();
  });

  it("Tokio en el itinerario: día 1 de vuelo, el día 2 empieza al aterrizar (nada de Ueno en la mañana)", () => {
    const t = {
      destino: "Tokio", ciudad_origen: "Ciudad de México", fecha_salida: "2027-02-10", fecha_regreso: "2027-02-13",
      vuelos_json: [{ aerolinea: "ANA", tier: "equilibrio", duracion: "18h 5m", notas: "Sale 10 feb 05:45, viaje redondo, tarifa turista. Llega a Haneda." }],
      itinerario_json: [
        { dia: 1, titulo: "Llegada a Tokio", "mañana": "Vuelo a Tokio.", tarde: "Llegada a Haneda, traslado a tu hotel y check-in.", noche: "Cena en Shinjuku." },
        { dia: 2, titulo: "Ueno y Asakusa", "mañana": "Parque de Ueno.", tarde: "Asakusa.", noche: "Akihabara." },
        { dia: 3, titulo: "Shibuya", "mañana": "Meiji.", tarde: "Shibuya.", noche: "Golden Gai." },
        { dia: 4, titulo: "Salida de Tokio", "mañana": "Desayuno.", tarde: "Traslado a Haneda.", noche: "Vuelo de regreso." },
      ],
    };
    const [d1, d2, d3] = calendarDays(t);
    expect(d1).toMatchObject({ titulo: "Vuelo a Tokio", tipo: "vuelo" });
    expect(d2.tipo).toBe("llegada");
    expect(d2["mañana"]).toMatch(/^En vuelo hacia Tokio/);
    expect(d2["mañana"]).not.toMatch(/Ueno/);
    expect(d2.tarde).toMatch(/hacia las 14:50/);
    expect(d3.titulo).toBe("Ueno y Asakusa");
  });

  it("sin forma de saber la hora: el título no dice «llegada» y la tarde lleva la salvedad", () => {
    const t = {
      destino: "Lisboa", ciudad_origen: "Ciudad de México", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-12",
      vuelos_json: [{ aerolinea: "Iberia", tier: "equilibrio", notas: "Precio estimado redondo por persona, salida 19:55 con una sola escala.", duracion: "15h - 17h" }],
      itinerario_json: [
        { dia: 1, titulo: "Llegada a Lisboa", "mañana": "Vuelo a Lisboa en tránsito.", tarde: "Llegada, traslado a tu hotel y check-in. Paseo por Alfama.", noche: "Cena en Bairro Alto." },
        { dia: 2, titulo: "Belém", "mañana": "Belém.", tarde: "LX Factory.", noche: "Fado." },
        { dia: 3, titulo: "Salida de Lisboa", "mañana": "Desayuno.", tarde: "Traslado al aeropuerto.", noche: "Vuelo." },
      ],
    };
    const [d1] = calendarDays(t);
    expect(d1.tipo).toBe("llegada_sin_hora");
    expect(d1.titulo).toBe("Vuelo a Lisboa");
    expect(d1.titulo).not.toMatch(/llegada/i);
    expect(d1.tarde).toMatch(/^Traslado a tu hotel y check-in al llegar.*\(si tu vuelo llega a tiempo\)\.$/);
  });

  it("la salvedad también va cuando la tarde solo dice el traslado", () => {
    const n = neutralArrivalDay({ titulo: "Llegada", "mañana": "Llegada a Madrid.", tarde: "Llegada al hotel y check-in.", noche: "Cena." }, "Madrid");
    expect(n.day.tarde).toBe("Traslado a tu hotel y check-in al llegar (si tu vuelo llega a tiempo).");
  });

  it("si alguna opción de la lista sí llega el día 1, el título puede decir «Vuelo y llegada»", () => {
    const n = neutralArrivalDay({ titulo: "Llegada", "mañana": "Llegada a Madrid.", tarde: "Paseo.", noche: "Cena." }, "Madrid", { llegaElDia1: true });
    expect(n.day.titulo).toBe("Vuelo y llegada a Madrid");
  });
});
