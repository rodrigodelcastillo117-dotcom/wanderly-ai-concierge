// Recorrido en producción (9-nov-2026): «Valle de Bravo (30 oct–1 nov)» seguía fijado y ya había terminado; el selector
// del Inicio, Cerca de ti y el chat lo mostraban como «viaje activo» mientras las herramientas hablaban de Puerto
// Escondido. Un viaje fijado que ya terminó deja de contar en todas las pantallas.
import { describe, expect, it } from "vitest";
import { pinVigente, resolveActiveTrip } from "@/lib/activeTrip";

const HOY = "2026-11-09";
const VALLE = { id: "valle", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" };
const PUERTO = { id: "puerto", destino: "Puerto Escondido", fecha_salida: "2026-11-12", fecha_regreso: "2026-11-16" };
const ROMA = { id: "roma", destino: "Roma", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-20" };

describe("pinVigente", () => {
  it("un viaje fijado que ya terminó no cuenta", () => {
    expect(pinVigente([VALLE, PUERTO, ROMA], "valle", HOY)).toBeNull();
  });
  it("un viaje fijado vigente sí cuenta", () => {
    expect(pinVigente([VALLE, PUERTO, ROMA], "roma", HOY)).toBe("roma");
    expect(pinVigente([VALLE, PUERTO, ROMA], "puerto", HOY)).toBe("puerto");
  });
  it("un fijado que ya no existe no cuenta; sin viajes cargados todavía se respeta", () => {
    expect(pinVigente([PUERTO], "borrado", HOY)).toBeNull();
    expect(pinVigente([], "valle", HOY)).toBe("valle");
    expect(pinVigente([PUERTO], null, HOY)).toBeNull();
  });
  it("con el fijado vencido, el viaje activo es el mismo que eligen las herramientas", () => {
    const trips = [VALLE, PUERTO];
    const pin = pinVigente(trips, "valle", HOY);
    expect(resolveActiveTrip(trips, { pinnedId: pin, todayLocal: HOY }).trip?.id).toBe("puerto");
  });
});
