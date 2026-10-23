// Varias ciudades escritas en el planeador (caso del dueño 23-oct-2026: "paris roma y atenas 10 dias"
// se guardó como un solo destino con ese texto). Parseo local, sin IA.
import { describe, expect, it } from "vitest";
import {
  addIsoDays, describeMultiCity, durationOf, fitNights, isMultiCity, moveCity, nightsFromQuery, parseMultiCityText, routePlannerQuery, shiftNight,
} from "@/lib/multiCityText";
import { understandPlanText } from "@/lib/planDefaults";
import { chosenNights } from "../../supabase/functions/_shared/booking/tripRoute";

describe("parseMultiCityText: frases de varias ciudades", () => {
  it("'paris roma y atenas 10 dias' → París → Roma → Atenas · 10 días (9 noches)", () => {
    const p = parseMultiCityText("paris roma y atenas 10 dias");
    expect(p.cities).toEqual(["París", "Roma", "Atenas"]);
    expect(p.days).toBe(10);
    expect(p.nights).toBe(9);
    expect(p.unknown).toEqual([]);
    expect(isMultiCity(p)).toBe(true);
    expect(describeMultiCity(p)).toBe("París → Roma → Atenas · 10 días");
  });

  it.each([
    ["Roma, Florencia y Venecia", ["Roma", "Florencia", "Venecia"]],
    ["Roma → Florencia → Venecia", ["Roma", "Florencia", "Venecia"]],
    ["quiero ir a Madrid, luego Lisboa y después Oporto", ["Madrid", "Lisboa", "Oporto"]],
    ["London y Paris", ["Londres", "París"]],
    ["Tokio + Kioto", ["Tokio", "Kioto"]],
    ["barcelona madrid", ["Barcelona", "Madrid"]],
    ["Roma, Florencia y Roma", ["Roma", "Florencia"]],
  ])("%s", (text, cities) => {
    expect(parseMultiCityText(text).cities).toEqual(cities);
  });

  it("'CDMX → Madrid → Lisboa': CDMX es el origen, no una parada", () => {
    const p = parseMultiCityText("CDMX → Madrid → Lisboa");
    expect(p.origin).toBe("Ciudad de México");
    expect(p.cities).toEqual(["Madrid", "Lisboa"]);
  });

  it("'desde Guadalajara a Roma y Atenas' y el origen del viajero repetido al final", () => {
    expect(parseMultiCityText("desde Guadalajara a Roma y Atenas")).toMatchObject({ origin: "Guadalajara", cities: ["Roma", "Atenas"] });
    expect(parseMultiCityText("Roma y Atenas saliendo de Monterrey")).toMatchObject({ origin: "Monterrey", cities: ["Roma", "Atenas"] });
    // "Fin de semana en Puebla desde CDMX": UN destino (Puebla), no la ruta Puebla → CDMX.
    expect(parseMultiCityText("Fin de semana en Puebla desde CDMX, 2 personas, del 12 al 14 de diciembre")).toMatchObject({ origin: "Ciudad de México", cities: ["Puebla"] });
    expect(parseMultiCityText("Ciudad de México, Madrid, Lisboa, Ciudad de México", { origin: "Ciudad de México" }).cities).toEqual(["Madrid", "Lisboa"]);
    // Con origen del perfil igual a la primera ciudad de 2: tampoco es parada.
    expect(parseMultiCityText("Monterrey y Cancún", { origin: "Monterrey" }).cities).toEqual(["Cancún"]);
  });

  it("fechas y viajeros de la frase no se confunden con ciudades", () => {
    const p = parseMultiCityText("Roma y Venecia del 12 al 20 de diciembre, 2 personas");
    expect(p.cities).toEqual(["Roma", "Venecia"]);
    expect(p.unknown).toEqual([]);
  });

  it("duraciones: días, noches y semanas", () => {
    expect(durationOf("paris y roma 10 dias")).toEqual({ days: 10, nights: 9 });
    expect(durationOf("paris y roma 7 noches")).toEqual({ days: 8, nights: 7 });
    expect(durationOf("paris y roma una semana")).toEqual({ days: 7, nights: 6 });
    expect(durationOf("paris y roma 2 semanas")).toEqual({ days: 14, nights: 13 });
    expect(durationOf("paris y roma")).toEqual({ days: null, nights: null });
  });
});

describe("parseMultiCityText: lo que NO es multi-ciudad", () => {
  it.each(["Nueva York", "San Miguel de Allende", "Roma 5 días", "Oaxaca del 12 al 16 de diciembre, 2 personas", "Ciudad de México", "Buenos Aires", "Los Cabos"])("%s", (text) => {
    expect(isMultiCity(parseMultiCityText(text))).toBe(false);
  });

  it("un país no es una ciudad: 'Francia, Italia y Grecia' pide ciudades", () => {
    const p = parseMultiCityText("Francia, Italia y Grecia");
    expect(p.cities).toEqual([]);
    expect(p.countries).toEqual(["Francia", "Italia", "Grecia"]);
    expect(isMultiCity(p)).toBe(false);
  });

  it("texto sin sentido o nombres que no conocemos no se inventan ni se parten", () => {
    expect(parseMultiCityText("asdf qwer y zxcv")).toMatchObject({ cities: [], unknown: ["asdf qwer", "zxcv"] });
    // Un nombre que no conocemos no se parte para sacar una ciudad conocida de adentro.
    expect(parseMultiCityText("Tequisquiapan de Querétaro")).toMatchObject({ cities: [], unknown: ["Tequisquiapan de Querétaro"] });
    // Uno que sí está en el catálogo es UNA ciudad.
    expect(parseMultiCityText("Valle de Guadalupe").cities).toEqual(["Valle de Guadalupe"]);
    // Una ciudad desconocida en una ruta se dice; las conocidas siguen.
    expect(parseMultiCityText("Roma → Xyzópolis → Venecia")).toMatchObject({ cities: ["Roma", "Venecia"], unknown: ["Xyzópolis"] });
  });

  it("'Roma 5 días' en el planeador: el destino es Roma (no 'Roma 5 Días') y 4 noches", () => {
    expect(understandPlanText("Roma 5 días", new Date(2026, 9, 23))).toMatchObject({ destino: "Roma", nights: 4 });
  });
});

describe("Noches por ciudad", () => {
  it("reparto parejo como el servidor y validación de lo elegido", () => {
    expect(fitNights(null, 3, 9)).toEqual([3, 3, 3]);
    expect(fitNights(null, 3, 10)).toEqual([4, 3, 3]);
    expect(fitNights([4, 2, 3], 3, 9)).toEqual([4, 2, 3]);
    expect(fitNights([4, 2, 3], 3, 10)).toEqual([4, 3, 3]); // ya no suma: se vuelve a repartir
    expect(fitNights(null, 3, 2)).toBeNull(); // no alcanza 1 noche por ciudad
  });

  it("+1 / −1 nunca cambia el total ni deja una ciudad en 0", () => {
    expect(shiftNight([3, 3, 3], 0, 1)).toEqual([4, 3, 2]);
    expect(shiftNight([3, 3, 3], 2, -1)).toEqual([3, 4, 2]);
    expect(shiftNight([1, 1], 0, -1)).toEqual([1, 1]);
    expect(shiftNight([2, 1], 1, 1)).toEqual([1, 2]);
    expect(moveCity(["París", "Roma", "Atenas"], 2, -1)).toEqual(["París", "Atenas", "Roma"]);
  });

  it("servidor (logistics-plan): solo acepta noches que cuadran", () => {
    expect(chosenNights([3, 3, 3], 3, 9)).toEqual([3, 3, 3]);
    expect(chosenNights([5, 3, 3], 3, 9)).toBeNull();
    expect(chosenNights([9, 0], 2, 9)).toBeNull();
    expect(chosenNights("3|3", 2, 6)).toBeNull();
  });

  it("enlace a 'Ruta multi-destino' con noches y lectura de ?noches", () => {
    const qs = new URLSearchParams(routePlannerQuery({ origin: "Ciudad de México", cities: ["París", "Roma", "Atenas"], nights: [3, 3, 3],
      fechaSalida: "2026-11-06", fechaRegreso: "2026-11-15", viajeros: 1, fromTrip: "t1" }));
    expect(Object.fromEntries(qs)).toEqual({ origin: "Ciudad de México", destinos: "París|Roma|Atenas", fecha_salida: "2026-11-06", fecha_regreso: "2026-11-15",
      viajeros: "1", noches: "3|3|3", desde_viaje: "t1" });
    expect(nightsFromQuery("3|3|3")).toEqual([3, 3, 3]);
    expect(nightsFromQuery("3|x")).toBeNull();
    expect(addIsoDays("2026-11-06", 9)).toBe("2026-11-15");
  });
});
