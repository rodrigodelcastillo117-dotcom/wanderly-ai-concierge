// Punto 4 del caso Roma → Florencia → Venecia: pais_destino se guardó como "Venecia" (la última
// ciudad). Quien lo usa espera un país: moneda (currencies.destinationCurrency), eSIM (airaloLink),
// teléfono e idioma de restaurantes (channels.countryIso), alertas de la bóveda y el encabezado.
import { describe, expect, it } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { countryForStops, tripCountryLabel } from "../../supabase/functions/_shared/booking/tripRoute";
import { countryIso } from "../../supabase/functions/_shared/booking/channels";
import { destinationCurrency } from "@/lib/currencies";
import { esimSlugs } from "@/lib/affiliateLinks";

describe("pais_destino de un viaje multi-destino", () => {
  it("es el país de la primera ciudad, nunca el nombre de una ciudad", () => {
    expect(countryForStops(["Roma", "Florencia", "Venecia"])).toBe("Italia");
    expect(countryForStops(["Madrid", "París"])).toBe("España");
    expect(countryForStops(["Xyzópolis", "Roma"])).toBeNull();
  });
  it("con 'Italia' funcionan moneda, eSIM y teléfono (con 'Venecia' no)", () => {
    expect(countryIso("Italia")).toBe("IT");
    expect(countryIso("Venecia")).toBeNull();
    expect(destinationCurrency({ destino: "Roma → Florencia → Venecia", pais_destino: "Italia" })).toBe("EUR");
    expect(esimSlugs("Italia")?.airalo).toBe("italy");
  });
  it("los viajes ya guardados con 'Venecia' se muestran como Italia", () => {
    expect(tripCountryLabel(CASO_TRIP)).toBe("Italia");
    expect(tripCountryLabel({ destino: "Cancún", pais_destino: "México" })).toBe("México");
  });
});
