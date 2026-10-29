// R3 viajes P1-1 y P2-10: el día 1 de los viajes guardados antes del ajuste del servidor contradecía el
// vuelo de la misma página (Italia «Sale 22:00 · llega 22:40 +1» con «Llegada a Fiumicino · Piazza Navona ·
// cena en Trastevere»; Madrid (2) sin horas guardadas con «Tarde: Llegada, traslado a tu hotel y check-in»),
// y Valle de Bravo repetía el regreso («Cascada, Stupa y despedida» el día 2 y «Día de regreso» el día 3).
import { describe, it, expect } from "vitest";
import { calendarDays, flightTimesOfRow, FREE_DAY_TITLE, isDepartureDay } from "@/lib/itineraryCalendar";
import { applyTripCalendar } from "../../supabase/functions/_shared/tripCalendar";
import { daySummaryLine } from "@/lib/tripGlance";

const dayOf = (dia: number, titulo: string, m: string, t: string, n: string, extra: any = {}) => ({ dia, titulo, "mañana": m, tarde: t, noche: n, ...extra });

const ITALIA = {
  destino: "Roma", ciudad_origen: "Ciudad de México", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-14",
  vuelos_json: [
    { aerolinea: "ITA Airways", tier: "equilibrio", fuente_precio: "en_vivo", salida: "2027-05-10 22:00", llegada: "2027-05-11 22:40", from: "Ciudad de México", to: "Roma" },
  ],
  itinerario_json: [
    dayOf(1, "Llegada a Roma", "Llegada al Aeropuerto de Fiumicino y traslado al hotel.", "Paseo por Piazza Navona.", "Cena en Trastevere."),
    dayOf(2, "Roma antigua", "Coliseo.", "Foro Romano.", "Cena en Monti."),
    dayOf(3, "Vaticano", "Museos Vaticanos.", "Basílica de San Pedro.", "Cena en Prati."),
    dayOf(4, "Barroco", "Fontana di Trevi.", "Panteón.", "Cena en Campo de' Fiori."),
    dayOf(5, "Salida de Roma", "Desayuno.", "Traslado a Fiumicino.", "Vuelo de regreso."),
  ],
};

describe("P1-1: el día 1 sigue al vuelo de ida (viajes ya guardados)", () => {
  it("Italia: el vuelo llega el día 2 → el día 1 es de vuelo y lo planeado se recorre", () => {
    const d = calendarDays(ITALIA);
    expect(d.map((x) => [x.dia, x.fecha])).toEqual([[1, "2027-05-10"], [2, "2027-05-11"], [3, "2027-05-12"], [4, "2027-05-13"], [5, "2027-05-14"]]);
    expect(d[0]).toMatchObject({ titulo: "Vuelo a Roma", tipo: "vuelo" });
    expect(JSON.stringify(d[0])).not.toMatch(/Piazza Navona|Trastevere|Fiumicino/);
    expect(d[0].noche).toMatch(/22:00/);
    // Día de llegada: llega 22:40; nada de Piazza Navona por la tarde.
    expect(d[1].tipo).toBe("llegada");
    expect(d[1].tarde).toMatch(/En vuelo hacia Roma/);
    expect(d[1].noche).toMatch(/Llegas a Roma a las 22:40/);
    // El regreso se queda en el último día del calendario.
    expect(d[4]).toMatchObject({ dia: 5, titulo: "Salida de Roma" });
    expect(d.some((x) => x.dia > 5)).toBe(false);
  });

  it("sin horas en vuelos_json (Madrid 2): el día 1 no afirma la llegada", () => {
    const t = {
      destino: "Madrid", ciudad_origen: "Ciudad de México", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-12",
      // Sin duración (R4 P2-1: con salida y duración la llegada ya se calcula; ver r4vItinerario).
      vuelos_json: [{ aerolinea: "Aeroméxico", tier: "equilibrio", notas: "Directo, sale 11:00" }],
      itinerario_json: [
        dayOf(1, "Llegada a Madrid y primer paseo por el centro", "Vuelo CDMX→Madrid en tránsito; descanso a bordo para llegar con energía.",
          "Llegada, traslado a tu hotel y check-in. Paseo tranquilo por Plaza Mayor y las calles aledañas.", "Cena ligera en La Latina."),
        dayOf(2, "Museos", "Prado.", "Retiro.", "Tapas."),
        dayOf(3, "Salida de Madrid", "Desayuno.", "Traslado a Barajas.", "Vuelo."),
      ],
    };
    const [d1, d2] = calendarDays(t);
    // R4 P2-1: ninguna opción llega el día 1 (o no se sabe): el título ya no dice «llegada».
    expect(d1.titulo).toBe("Vuelo a Madrid");
    expect(d1["mañana"]).toMatch(/^Vuelo a Madrid: la hora de llegada depende de tu vuelo/);
    expect(d1.tarde).not.toMatch(/^Llegada/);
    expect(d1.tarde).toMatch(/Plaza Mayor.*\(si tu vuelo llega a tiempo\)\.$/);
    expect(d1.noche).toBe("Cena ligera en La Latina (si tu vuelo llega a tiempo).");
    // El resumen del día tampoco dice «Llegada»; los demás días no cambian.
    expect(daySummaryLine(d1)).not.toMatch(/Llegada/);
    expect(d2).toMatchObject({ dia: 2, titulo: "Museos", tarde: "Retiro." });
  });

  it("horas en las notas de viajes viejos («salida 10-mar 11:00, llegada 11-mar 05:30 (+1)»)", () => {
    expect(flightTimesOfRow({ notas: "Aeroméxico directo, salida 10-mar 11:00, llegada 11-mar 05:30 (+1)" }, "2027-03-10"))
      .toEqual({ salida: "2027-03-10 11:00", llegada: "2027-03-11 05:30" });
    expect(flightTimesOfRow({ notas: "salida 11:00, llegada 11 de marzo a las 05:30" }, "2027-03-10"))
      .toEqual({ salida: "2027-03-10 11:00", llegada: "2027-03-11 05:30" });
    // Tarifa de otro día: no dice nada de la llegada.
    expect(flightTimesOfRow({ notas: "salida 14-mar 11:00, llegada 15-mar 05:30" }, "2027-03-10")).toBeNull();
    expect(flightTimesOfRow({ notas: "Directo, sale 11:00" }, "2027-03-10")).toBeNull();
  });

  it("un itinerario que el servidor ya ajustó, un viaje en coche o un día 1 sin llegada no se tocan", () => {
    const nuevo = { ...ITALIA, itinerario_json: [dayOf(1, "Vuelo a Roma", "Libre.", "Libre.", "Traslado al aeropuerto.", { tipo: "vuelo" }), ...ITALIA.itinerario_json.slice(1)] };
    expect(calendarDays(nuevo)[0]).toMatchObject({ titulo: "Vuelo a Roma", "mañana": "Libre." });
    const coche = { ...ITALIA, vuelos_json: [{ modo: "auto", aerolinea: "En coche" }] };
    expect(calendarDays(coche)[0]).toMatchObject({ titulo: "Llegada a Roma", tarde: "Paseo por Piazza Navona." });
    const sinLlegada = { ...ITALIA, vuelos_json: [{ aerolinea: "ITA", tier: "equilibrio" }], itinerario_json: [dayOf(1, "Roma", "Coliseo.", "Foro.", "Cena.")] };
    expect(calendarDays(sinLlegada)[0]).toMatchObject({ titulo: "Roma", "mañana": "Coliseo." });
    // Vuelo nacional corto sin horas (CDMX → Oaxaca): llega el mismo día, el día 1 no se contradice.
    const oaxaca = { destino: "Oaxaca de Juárez", ciudad_origen: "Ciudad de México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01",
      vuelos_json: [{ aerolinea: "Volaris", tier: "equilibrio", duracion: "1h 10m" }],
      itinerario_json: [dayOf(1, "Llegada y centro", "Vuelo de la Ciudad de México a Oaxaca y traslado al hotel.", "Santo Domingo.", "Casa Oaxaca.")] };
    expect(calendarDays(oaxaca)[0]).toMatchObject({ titulo: "Llegada y centro", "mañana": "Vuelo de la Ciudad de México a Oaxaca y traslado al hotel." });
  });

  it("al generar sin hora de llegada (tarifa estimada), el día 1 tampoco afirma la llegada", () => {
    const { days } = applyTripCalendar([
      dayOf(1, "Llegada a Madrid", "Vuelo desde CDMX.", "Llegada a Barajas y check-in.", "Cena en Gloria Bendita."),
      dayOf(2, "Salida", "Desayuno.", "Traslado al aeropuerto.", "Vuelo."),
    ], { fechaSalida: "2027-03-10", fechaRegreso: "2027-03-11", destino: "Madrid", origen: "Ciudad de México", flight: null, enAvion: true });
    expect(days[0].titulo).toBe("Vuelo a Madrid");
    expect(days[0].tipo).toBe("llegada_sin_hora");
    expect(days[0].noche).toBe("Cena en Gloria Bendita (si tu vuelo llega a tiempo).");
    // En coche (enAvion sin marcar) no cambia.
    const coche = applyTripCalendar([dayOf(1, "Llegada a Valle", "Salida en coche.", "Check-in.", "Cena.")], { fechaSalida: "2026-10-30", fechaRegreso: "2026-11-01", destino: "Valle de Bravo", flight: null });
    expect(coche.days.map((x) => x.titulo)).toContain("Llegada a Valle");
    expect(JSON.stringify(coche.days)).not.toMatch(/si tu vuelo/);
  });
});

describe("P2-10: «…y despedida» es el día de regreso", () => {
  it("Valle de Bravo 30 oct–1 nov: «Cascada, Stupa y despedida» va el 1 nov y el 31 queda libre", () => {
    const vb = {
      destino: "Valle de Bravo", ciudad_origen: "Ciudad de México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01",
      vuelos_json: [{ modo: "auto", aerolinea: "En coche" }],
      itinerario_json: [
        dayOf(1, "Llegada, centro y atardecer", "Benicio Casa de Pan.", "Mirador La Peña.", "Tinto by Choklat."),
        dayOf(2, "Cascada, Stupa y despedida", "La Cascada de Avándaro.", "Soleado Cocina del mundo.", "Regreso a CDMX por la tarde o cena temprana."),
      ],
    };
    const d = calendarDays(vb);
    expect(d.map((x) => [x.dia, x.fecha, x.titulo])).toEqual([
      [1, "2026-10-30", "Llegada, centro y atardecer"], [2, "2026-10-31", FREE_DAY_TITLE], [3, "2026-11-01", "Cascada, Stupa y despedida"],
    ]);
    expect(d.filter((x) => /regreso/i.test(String(x.titulo)))).toHaveLength(0);
  });

  it("reconoce la despedida o el regreso a casa, y no un día cualquiera", () => {
    expect(isDepartureDay({ titulo: "Cascada, Stupa y despedida" })).toBe(true);
    expect(isDepartureDay({ titulo: "Mercado y despedida de Oaxaca" })).toBe(true);
    expect(isDepartureDay({ titulo: "Último paseo", noche: "Regreso a CDMX por la noche." })).toBe(true);
    expect(isDepartureDay({ titulo: "Toledo", noche: "Regreso a Madrid." })).toBe(false);
    expect(isDepartureDay({ titulo: "Cena de despedidas en el hotel" })).toBe(false);
  });
});
