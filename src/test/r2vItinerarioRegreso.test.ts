// R2 viajes P2-10: itinerario de Madrid (10–17 mar, regreso el 17): el día 7 (16 mar) decía «Salida de
// Madrid… traslado a Barajas para tu vuelo» y el día 8 (17 mar), «Día de regreso · sin plan todavía».
import { describe, it, expect } from "vitest";
import { calendarDays, FREE_DAY_TITLE, isDepartureDay } from "@/lib/itineraryCalendar";

const day = (dia: number, titulo: string, extra: any = {}) => ({ dia, titulo, "mañana": "…", tarde: "…", noche: "…", ...extra });
const MADRID = {
  fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17",
  itinerario_json: [1, 2, 3, 4, 5, 6].map((n) => day(n, `Día ${n} en Madrid`)).concat([day(7, "Salida de Madrid", { tarde: "Traslado a Barajas con 3 horas de margen para tu vuelo internacional" })]),
};

describe("el día de salida cae el día del regreso", () => {
  it("Madrid: día 7 libre (16 mar) y «Salida de Madrid» el día 8 (17 mar)", () => {
    const d = calendarDays(MADRID);
    expect(d.map((x) => [x.dia, x.fecha, x.titulo])).toEqual([
      [1, "2027-03-10", "Día 1 en Madrid"], [2, "2027-03-11", "Día 2 en Madrid"], [3, "2027-03-12", "Día 3 en Madrid"],
      [4, "2027-03-13", "Día 4 en Madrid"], [5, "2027-03-14", "Día 5 en Madrid"], [6, "2027-03-15", "Día 6 en Madrid"],
      [7, "2027-03-16", FREE_DAY_TITLE], [8, "2027-03-17", "Salida de Madrid"],
    ]);
    expect(d[6].pendiente).toBe(true);
    expect(d[7].pendiente).toBeUndefined();
  });

  it("aunque el día de salida traiga su fecha guardada", () => {
    const t = { ...MADRID, itinerario_json: { days: MADRID.itinerario_json.map((x, i) => ({ ...x, fecha: `2027-03-${String(10 + i).padStart(2, "0")}` })) } };
    expect(calendarDays(t).at(-1)).toMatchObject({ dia: 8, fecha: "2027-03-17", titulo: "Salida de Madrid" });
  });

  it("un último día que no es la salida no se mueve", () => {
    const t = { ...MADRID, itinerario_json: [1, 2, 3, 4, 5, 6, 7].map((n) => day(n, `Día ${n} en Madrid`)) };
    expect(calendarDays(t).at(-1)).toMatchObject({ dia: 8, pendiente: true });
    expect(isDepartureDay({ titulo: "Día 7 en Madrid" })).toBe(false);
    expect(isDepartureDay({ tipo: "regreso", titulo: "Último día" })).toBe(true);
  });
});
