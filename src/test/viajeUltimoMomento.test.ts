// Recorrido 11-nov-2026: «Viaje de último momento: este viernes 13 de noviembre me voy a Oaxaca desde CDMX con mi
// pareja, regreso el domingo 15. Algo bonito sin gastar tanto» pedía resolver 6 «ciudades» («voy», «último
// momento: este viernes», «regreso el domingo 15 Algo bonito…»). Solo hay una parada: Oaxaca.
import { describe, expect, it } from "vitest";
import { isNotPlace, stripTimingAndVibe } from "../../supabase/functions/_shared/notPlace";
import { parseMultiCityText } from "@/lib/multiCityText";
import { buildLocalSpec } from "@/lib/tripSpecLocal";
import { parseTripFallback } from "@/lib/parseTripFallback";
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
    ["Machu Picchu y Cusco", ["Machu Picchu", "Cusco"]],
    ["Sedona y el Gran Cañón desde Las Vegas", ["Sedona", "Gran Cañón"]],
    ["Capadocia y Estambul 8 días", ["Capadocia", "Estambul"]],
    ["Quiero ir a Disney en Orlando con mis hijos", ["Orlando"]],
    ["Banff y Vancouver en verano", ["Banff", "Vancouver"]],
    ["Me quiero escapar este puente, algo cerca de CDMX", []],
  ])("«%s»: solo lugares, nada que preguntar de más", (t, cities) => {
    const p = parseMultiCityText(t, { origin: "Ciudad de México" });
    expect(p.cities).toEqual(cities);
    expect(p.unknown).toEqual([]);
  });

  it("lee las fechas: «viernes 13 de noviembre … regreso el domingo 15» (sin preguntar «¿Qué fechas?»)", () => {
    const hoy = new Date(2026, 10, 11);
    expect(parseTripFallback(T, hoy)).toMatchObject({ fechaSalida: "2026-11-13", fechaRegreso: "2026-11-15" });
    const spec = buildLocalSpec(T, { today: hoy });
    expect([spec.fecha_salida, spec.fecha_regreso]).toEqual(["2026-11-13", "2026-11-15"]);
    expect(spec.preguntas.filter((q) => q.tipo === "fechas" && !q.resuelta)).toEqual([]);
    // Variantes: solo el día de la semana, otro mes, «hasta el».
    expect(parseTripFallback("Salgo el 28 de noviembre a Mérida y regreso el domingo", hoy)).toMatchObject({ fechaSalida: "2026-11-28", fechaRegreso: "2026-11-29" });
    expect(parseTripFallback("Me voy a Cancún el 29 de diciembre y vuelvo el 3 de enero", hoy)).toMatchObject({ fechaSalida: "2026-12-29", fechaRegreso: "2027-01-03" });
    expect(parseTripFallback("Mérida desde el 20 de noviembre hasta el 24", hoy)).toMatchObject({ fechaSalida: "2026-11-20", fechaRegreso: "2026-11-24" });
    expect(parseTripFallback("Me voy el 28 de noviembre y regreso el 2", hoy)).toMatchObject({ fechaSalida: "2026-11-28", fechaRegreso: "2026-12-02" });
    // Día de la semana que no cuadra con la fecha: no se adivina.
    expect(parseTripFallback("Salgo el 13 de noviembre y regreso el lunes 15", hoy).fechaRegreso).toBeNull();
    // Solo la salida: no se inventa el regreso.
    expect(parseTripFallback("Oaxaca el 13 de noviembre", hoy).fechaRegreso).toBeNull();
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

  it("«a Bacalar» es la parada Bacalar: no pregunta «¿dónde va en tu viaje?» (mochilero, 11-nov-2026)", () => {
    const t = "Viaje de mochilero a Bacalar 4 noches del 15 al 19 de enero de 2027, voy solo, lo más barato posible, hostales y transporte en autobús";
    const r = validateTripSpec(JSON.stringify({
      origen: "Ciudad de México", paradas: [{ id: "p1", ciudad: "Bacalar", rol: "estancia", noches: 4, texto: "Bacalar" }],
      fecha_salida: "2027-01-15", fecha_regreso: "2027-01-19", viajeros: 1,
      menciones: [{ texto: "a Bacalar", tipo: "ciudad", estado: "parada", ref: "x9" }, { texto: "hacia la Riviera", tipo: "region", estado: "parada" }],
    }), t);
    if (!r.ok) throw new Error("spec inválido");
    const qs = r.spec.preguntas.filter((q) => q.tipo === "lugar_desconocido" && !q.resuelta).map((q) => q.texto);
    expect(qs).not.toContain("a Bacalar");
    const out = ensureCoverage(r.spec, [{ texto: "a Bacalar", tipo: "ciudad" }]);
    expect(out.preguntas.filter((q) => !q.resuelta && /Bacalar/.test(q.texto))).toEqual([]);
    expect(parseMultiCityText(t).cities).toEqual(["Bacalar"]);
  });

  it("viaje de trabajo: «salgo el 17 de noviembre», «a Monterrey» y «hotel en San Pedro» no se preguntan como ciudades", () => {
    const t = "Viaje de trabajo a Monterrey, salgo el 17 de noviembre y regreso el 19, voy solo, hotel en San Pedro";
    const local = buildLocalSpec(t, { today: new Date(2026, 10, 11) });
    expect(local.paradas.map((p) => p.ciudad)).toEqual(["Monterrey"]);
    expect(local.preguntas.filter((q) => q.tipo === "lugar_desconocido")).toEqual([]);
    expect([local.fecha_salida, local.fecha_regreso]).toEqual(["2026-11-17", "2026-11-19"]);
    const r = validateTripSpec(JSON.stringify({
      origen: "Ciudad de México", paradas: [{ id: "p1", ciudad: "Monterrey", rol: "estancia", noches: 2, texto: "Monterrey" }],
      fecha_salida: "2026-11-17", fecha_regreso: "2026-11-19", viajeros: 1,
      menciones: [
        { texto: "salgo el 17 de noviembre", tipo: "tramo", estado: "tramo" },
        { texto: "a Monterrey", tipo: "ciudad", estado: "parada" },
        { texto: "San Pedro", tipo: "ciudad", estado: "parada" },
      ],
    }), t);
    if (!r.ok) throw new Error("spec inválido");
    const out = ensureCoverage(r.spec, local.menciones.map((m) => ({ texto: m.texto, tipo: m.tipo })));
    expect(out.preguntas.filter((q) => !q.resuelta && q.tipo === "lugar_desconocido").map((q) => q.texto)).toEqual([]);
  });

  it("isLodgingArea: la zona del hotel sí; una ciudad del viaje escrita sola no", async () => {
    const { isLodgingArea } = await import("../../supabase/functions/_shared/notPlace");
    expect(isLodgingArea("San Pedro", "viaje a Monterrey, hotel en San Pedro")).toBe(true);
    expect(isLodgingArea("Polanco", "CDMX 3 días, hospedaje cerca de Polanco")).toBe(true);
    expect(isLodgingArea("Monterrey", "viaje a Monterrey, hotel en San Pedro")).toBe(false);
  });
});
