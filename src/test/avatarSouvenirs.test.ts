// Recuerdos del avatar por destino (grupo avatar-viajes): catálogo, resolución por viaje y reglas
// de diseño (nada en la cabeza o la cara).
import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_VISIBLE, catalogCities, GENERIC_SOUVENIR, matchCity, matchCountry, matchIata, norm, resolveSouvenir,
  SOUVENIR_CATALOG_SIZE, visibleSouvenirs,
} from "../../supabase/functions/_shared/souvenirs.ts";

describe("catálogo de recuerdos", () => {
  it("cubre al menos 60 destinos frecuentes de viajeros mexicanos y un respaldo por país", () => {
    expect(SOUVENIR_CATALOG_SIZE.ciudades).toBeGreaterThanOrEqual(60);
    expect(SOUVENIR_CATALOG_SIZE.paises).toBeGreaterThanOrEqual(60);
    const ids = catalogCities().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of catalogCities()) for (const a of c.aliases) expect(norm(a)).toBe(a);
  });

  it("los ejemplos del dueño: CDMX, Nueva York, París, Tokio", () => {
    expect(resolveSouvenir({ destino: "Ciudad de México" }).nombre).toMatch(/Ángel de la Independencia/);
    expect(resolveSouvenir({ destino: "NYC" }).nombre).toMatch(/taxi amarillo/);
    expect(resolveSouvenir({ destino: "París, Francia" }).nombre).toMatch(/Torre Eiffel/);
    expect(resolveSouvenir({ destino: "Tokyo" }).nombre).toMatch(/Omamori/);
  });

  it("acentos, mayúsculas y el alias más largo ('Colonia Roma, CDMX' es CDMX, no Roma)", () => {
    expect(matchCity("CANCÚN")?.id).toBe("cancun");
    expect(matchCity("Colonia Roma, CDMX")?.id).toBe("cdmx");
    expect(matchCity("Roma, Italia")?.id).toBe("roma");
  });

  it("aeropuerto de llegada del boleto (IATA) cuando el destino no lo dice", () => {
    expect(matchIata("jfk")?.id).toBe("nueva-york");
    expect(resolveSouvenir({ destino: "Viaje de trabajo", vuelos_json: [{ to_iata: "CDG" }] }).key).toBe("ciudad:paris");
  });

  it("ciudad fuera del catálogo: pin con los colores del país; sin país: etiqueta genérica", () => {
    const pt = resolveSouvenir({ destino: "Évora", pais_destino: "Portugal" });
    expect(pt.key).toBe("pais:PT");
    expect(pt.prompt).toMatch(/flag colors of Portugal \(green and red\)/);
    expect(matchCountry("JP")?.[0]).toBe("JP");
    expect(resolveSouvenir({ destino: "Un pueblito" })).toEqual(GENERIC_SOUVENIR);
  });

  it("multidestino: el primer destino que aún no tiene; sin contar la ciudad de origen", () => {
    const trip = { destino: "Europa", ciudad_origen: "CDMX", itinerario_json: { destinations: ["Ciudad de México", "Madrid", "París"] } };
    expect(resolveSouvenir(trip).key).toBe("ciudad:madrid");
    expect(resolveSouvenir(trip, ["ciudad:madrid"]).key).toBe("ciudad:paris");
    // Ya tiene todas las ciudades → el país (si es nuevo) y si no, se repite (el servidor lo marca "repetido").
    expect(resolveSouvenir({ destino: "Madrid", pais_destino: "España" }, ["ciudad:madrid"]).key).toBe("pais:ES");
    expect(resolveSouvenir({ destino: "Madrid", pais_destino: "España" }, ["ciudad:madrid", "pais:ES"]).key).toBe("ciudad:madrid");
  });

  it("nada en la cabeza ni en la cara (sombreros, boinas, lentes cambian la identidad)", () => {
    const all = catalogCities().map((c) => resolveSouvenir({ destino: c.aliases[0] }));
    for (const s of all) {
      // Un pin CON FORMA de sombrero vale; ponerse un sombrero, boina o lentes no.
      expect(s.prompt).not.toMatch(/\b(wearing|worn on the head|on the head|over the eyes)\b|^a (hat|beret|cap|pair of (sun)?glasses|headband|tiara)\b/i);
      expect(s.prompt).toMatch(/lapel pin|charm|bracelet|necklace|pendant|pocket square|lei/);
      expect(["pin", "dije", "accesorio"]).toContain(s.slot);
      expect(s.nombre).not.toMatch(/[A-Z]{2,}\b.*\b(Pin|Charm)\b/); // nombres en español
    }
  });

  it("máximo 3 visibles (los más nuevos) y sin repetir", () => {
    const items = ["a", "b", "c", "b", "d"].map((key) => ({ key }));
    expect(AVATAR_MAX_VISIBLE).toBe(3);
    expect(visibleSouvenirs(items).map((x) => x.key)).toEqual(["b", "c", "d"]);
  });
});
