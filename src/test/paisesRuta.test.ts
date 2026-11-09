// Recorrido en producción (9-nov-2026): «Madrid → París → Roma» decía solo «ESPAÑA» en el viaje y en Mis viajes.
import { describe, expect, it } from "vitest";
import { tripCountryLabel } from "../../supabase/functions/_shared/booking/tripRoute";

describe("país que se muestra de un viaje", () => {
  it("ruta por varios países: todos, en orden", () => {
    expect(tripCountryLabel({ destino: "Madrid → París → Roma", pais_destino: "España" })).toBe("España · Francia · Italia");
  });
  it("ruta por un solo país: ese país", () => {
    expect(tripCountryLabel({ destino: "Roma → Florencia → Venecia", pais_destino: "Italia" })).toBe("Italia");
  });
  it("un solo destino: como antes", () => {
    expect(tripCountryLabel({ destino: "Puerto Escondido", pais_destino: "México" })).toBe("México");
  });
  it("si alguna ciudad no se reconoce, no se adivina: como antes", () => {
    const r = tripCountryLabel({ destino: "Madrid → Pueblito Desconocido", pais_destino: "España" });
    expect(r).toBe("España");
  });
});
