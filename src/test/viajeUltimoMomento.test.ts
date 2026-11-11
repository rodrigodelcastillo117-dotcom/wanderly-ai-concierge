// Recorrido 11-nov-2026: «Viaje de último momento: este viernes 13 de noviembre me voy a Oaxaca desde CDMX con mi
// pareja, regreso el domingo 15. Algo bonito sin gastar tanto» pedía resolver 6 «ciudades» («voy», «último
// momento: este viernes», «regreso el domingo 15 Algo bonito…»). Solo hay una parada: Oaxaca.
import { describe, expect, it } from "vitest";
import { isNotPlace, stripTimingAndVibe } from "../../supabase/functions/_shared/notPlace";
import { parseMultiCityText } from "@/lib/multiCityText";
import { buildLocalSpec } from "@/lib/tripSpecLocal";
import { ensureCoverage, validateTripSpec } from "../../supabase/functions/_shared/tripSpec";

const T = "Viaje de último momento: este viernes 13 de noviembre me voy a Oaxaca desde CDMX con mi pareja, regreso el domingo 15. Algo bonito sin gastar tanto";

describe("viaje de último momento: lo que dice cuándo o cómo no es una ciudad", () => {
  it("el lector local solo encuentra Oaxaca (y CDMX de salida)", () => {
    const p = parseMultiCityText(T);
    expect(p.cities).toEqual(["Oaxaca"]);
    expect(p.unknown).toEqual([]);
    const spec = buildLocalSpec(T, {});
    expect(spec.paradas.map((s) => s.ciudad)).toEqual(["Oaxaca"]);
    expect(spec.preguntas.filter((q) => q.tipo === "lugar_desconocido")).toEqual([]);
  });

  it.each([
    "voy", "me voy", "último momento: este viernes", "este viernes 13 de noviembre", "viernes 13 de noviembre",
    "regreso el domingo 15 Algo bonito sin gastar tanto", "de último minuto", "el próximo sábado", "este fin de semana",
    "algo tranquilo", "sin gastar mucho", "lo antes posible", "mañana",
  ])("«%s» no es lugar", (t) => expect(isNotPlace(t)).toBe(true));

  it.each(["Santo Domingo", "Oaxaca", "Valle de Guadalupe", "Isla Mujeres", "Puerto Escondido", "Real de Catorce", "Bacalar", "Mañana de Oaxaca hotel"])(
    "«%s» sí puede ser lugar", (t) => expect(isNotPlace(t)).toBe(false));

  it("«3 noches en cada una» no es una ciudad (Roma y Florencia)", () => {
    const t = "Roma y Florencia, 3 noches en cada una, del 10 al 16 de marzo de 2027, somos 2 desde Ciudad de México";
    const p = parseMultiCityText(t);
    expect(p.cities).toEqual(["Roma", "Florencia"]);
    expect(p.unknown).toEqual([]);
    expect(buildLocalSpec(t, {}).preguntas.filter((q) => q.tipo === "lugar_desconocido")).toEqual([]);
    for (const x of ["cada", "en cada una", "cada ciudad", "por ciudad"]) expect(isNotPlace(x)).toBe(true);
  });

  it.each([
    ["Llévame a Japón en abril para ver los cerezos, Tokio y Kioto", ["Tokio", "Kioto"]],
    ["Un fin de semana largo en San Miguel de Allende, saliendo de Querétaro", ["San Miguel de Allende"]],
    ["Recorrido por la Riviera Maya: Tulum, Playa del Carmen y Bacalar, una noche en cada lugar", ["Tulum", "Playa del Carmen", "Bacalar"]],
    ["Necesito ir a Guadalajara mañana temprano y volver el viernes", ["Guadalajara"]],
    ["Oaxaca para el Día de Muertos, 5 días, me encanta la comida", ["Oaxaca"]],
    ["Mochilero por Europa 3 semanas: Madrid, París, Ámsterdam y Berlín, lo más barato posible", ["Madrid", "París", "Ámsterdam", "Berlín"]],
    ["Viajo solo a Medellín y Cartagena dos semanas, primera vez en Colombia", ["Medellín", "Cartagena"]],
  ])("«%s»: solo lugares, nada que preguntar de más", (t, cities) => {
    const p = parseMultiCityText(t, { origin: "Ciudad de México" });
    expect(p.cities).toEqual(cities);
    expect(p.unknown).toEqual([]);
  });

  it("no rompe «Santo Domingo» ni las rutas con «regresa a»", () => {
    expect(stripTimingAndVibe("Santo Domingo y Punta Cana")).toContain("Santo Domingo");
    expect(parseMultiCityText("Santo Domingo y Punta Cana 7 días").cities).toEqual(["Santo Domingo", "Punta Cana"]);
    expect(parseMultiCityText("Crucero que sale de Miami y regresa a Miami").cities).toContain("Miami");
  });

  it("el servidor tampoco pregunta por «voy» ni por «este viernes 13 de noviembre» (menciones de la IA y del cliente)", () => {
    const r = validateTripSpec(JSON.stringify({
      origen: "Ciudad de México",
      paradas: [{ id: "p1", ciudad: "Oaxaca", rol: "estancia", noches: 2, texto: "Oaxaca" }],
      fecha_salida: "2026-11-13", fecha_regreso: "2026-11-15", viajeros: 2,
      menciones: [
        { texto: "viernes 13 de noviembre", tipo: "otro", estado: "fecha" },
        { texto: "Oaxaca", tipo: "ciudad", estado: "parada", ref: "p1" },
      ],
      preguntas: [{ id: "q1", tipo: "lugar_desconocido", texto: "voy", pregunta: "¿Qué ciudad es voy?" }],
    }), T);
    if (!r.ok) throw new Error("spec inválido");
    const out = ensureCoverage(r.spec, [
      { texto: "último momento: este viernes", tipo: "otro" }, { texto: "voy", tipo: "otro" },
      { texto: "regreso el domingo 15 Algo bonito sin gastar tanto", tipo: "otro" },
    ]);
    expect(out.preguntas.filter((q) => q.tipo === "lugar_desconocido" && !q.resuelta)).toEqual([]);
    expect(out.paradas.map((s) => s.ciudad)).toEqual(["Oaxaca"]);
  });
});
