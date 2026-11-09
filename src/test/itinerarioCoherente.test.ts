// Recorrido en producción (9-nov-2026, Puerto Escondido 12–16 nov): el día 4 decía «Vuelo directo de retorno a Ciudad de
// México» (el regreso es el día 5) y el día 1 «Vuelo directo matutino» con un vuelo que sale a las 20:25.
import { describe, expect, it } from "vitest";
import { calendarDays, coherenciaConVuelos } from "@/lib/itineraryCalendar";

describe("coherenciaConVuelos", () => {
  it("un «vuelo de regreso» antes del último día queda como última noche / tiempo libre", () => {
    const days: any[] = [
      { dia: 3, ciudad: "Puerto Escondido", tarde: "Vuelo de regreso a casa por la tarde" },
      { dia: 4, ciudad: "Puerto Escondido", "mañana": "Playa Carrizalillo", noche: "Vuelo directo de retorno a Ciudad de México" },
      { dia: 5, ciudad: "Puerto Escondido", "mañana": "Vuelo de regreso a Ciudad de México" },
    ];
    coherenciaConVuelos(days, { total: 5, salidaIda: null });
    expect(days[0].tarde).toBe("Tiempo libre en Puerto Escondido.");
    expect(days[1].noche).toMatch(/^Última noche en Puerto Escondido/);
    expect(days[1]["mañana"]).toBe("Playa Carrizalillo");
    expect(days[2]["mañana"]).toBe("Vuelo de regreso a Ciudad de México"); // el último día sí es el regreso
  });

  it("«regresas al hotel» no es un vuelo de regreso", () => {
    const days: any[] = [{ dia: 2, noche: "Cena y regresas al hotel" }];
    coherenciaConVuelos(days, { total: 5, salidaIda: null });
    expect(days[0].noche).toBe("Cena y regresas al hotel");
  });

  it("día 1: «vuelo matutino» con un vuelo de las 20:25 dice la hora real; si cuadra, no se toca", () => {
    const a: any[] = [{ dia: 1, "mañana": "Vuelo directo matutino a Puerto Escondido y check-in" }];
    coherenciaConVuelos(a, { total: 5, salidaIda: "20:25" });
    expect(a[0]["mañana"]).toBe("Vuelo directo (sale 20:25) a Puerto Escondido y check-in");
    expect(a[0]["mañana"]).toMatch(/sale 20:25/);
    expect(a[0]["mañana"]).not.toMatch(/matutino/);
    const b: any[] = [{ dia: 1, "mañana": "Vuelo directo matutino a Puerto Escondido" }];
    coherenciaConVuelos(b, { total: 5, salidaIda: "07:10" });
    expect(b[0]["mañana"]).toBe("Vuelo directo matutino a Puerto Escondido");
  });
});

describe("en la página del viaje (calendarDays)", () => {
  it("un viaje guardado con el regreso un día antes se muestra coherente", () => {
    const trip = {
      destino: "Puerto Escondido", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-12", fecha_regreso: "2026-11-16",
      itinerario_json: [
        { dia: 1, ciudad: "Puerto Escondido", "mañana": "Llegada", tarde: "Playa", noche: "Cena" },
        { dia: 2, ciudad: "Puerto Escondido", "mañana": "Snorkel", tarde: "Comida", noche: "Atardecer" },
        { dia: 3, ciudad: "Puerto Escondido", "mañana": "Laguna", tarde: "Siesta", noche: "Bioluminiscencia" },
        { dia: 4, ciudad: "Puerto Escondido", "mañana": "Tortugas", tarde: "Mercado", noche: "Vuelo directo de retorno a Ciudad de México" },
      ],
    };
    const d4 = calendarDays(trip).find((d) => d.dia === 4)!;
    expect(d4.noche).toMatch(/^Última noche en Puerto Escondido/);
    expect(calendarDays(trip).find((d) => d.dia === 5)).toMatchObject({ pendiente: true });
  });
});
