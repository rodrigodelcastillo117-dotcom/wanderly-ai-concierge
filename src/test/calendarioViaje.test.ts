// Defectos 2, 4 y 12 del E2E en producción (28-oct-2026): itinerario con fechas reales y día de llegada
// según el vuelo, horas del vuelo copiadas de la fuente y texto del análisis coherente.
import { describe, expect, it } from "vitest";
import { applyTripCalendar, arrivalSummary, calendarDates, calendarPromptBlock, nightsDaysText } from "../../supabase/functions/_shared/tripCalendar";
import { applyFlightTimes, enforceSources, stampInZone } from "../../supabase/functions/analizar-viaje/sources";
import { cleanNarrative, tasteLabels } from "../../supabase/functions/analizar-viaje/narrative";
import { flightScheduleLabel } from "@/lib/flightDisplay";
import { clockOf } from "@/lib/experiencias";

const FX = 18.6;
// Itinerario como lo escribió el modelo en producción: 7 días, el Día 1 con llegada por la tarde y cena.
const madridModelo = () => [
  { dia: 1, titulo: "Llegada a Madrid y primer paseo", mañana: "Vuelo desde CDMX.", tarde: "Llegada a Barajas, traslado y check-in en tu hotel.", noche: "Cena en Gloria Bendita." },
  { dia: 2, titulo: "Madrid de los Austrias", mañana: "Plaza Mayor y Mercado de San Miguel.", tarde: "Palacio Real.", noche: "Tapas en La Latina." },
  { dia: 3, titulo: "Museos", mañana: "Museo del Prado.", tarde: "Parque de El Retiro.", noche: "Cena en CEBO Madrid." },
  { dia: 4, titulo: "Toledo", mañana: "Excursión a Toledo.", tarde: "Catedral de Toledo.", noche: "Regreso a Madrid." },
  { dia: 5, titulo: "Malasaña", mañana: "Mercado de San Fernando.", tarde: "Malasaña.", noche: "Raza Madrid Barquillo." },
  { dia: 6, titulo: "Salamanca y compras", mañana: "Barrio de Salamanca.", tarde: "Compras.", noche: "Rosi La Loca." },
  { dia: 7, titulo: "Último día", mañana: "Desayuno con churros.", tarde: "Últimas compras.", noche: "Vuelo de regreso." },
];

describe("calendario del viaje (defecto 2)", () => {
  it("cuenta noches y días como la app y lista cada fecha", () => {
    expect(calendarDates("2027-03-10", "2027-03-17")).toHaveLength(8);
    expect(nightsDaysText("2026-11-20", "2026-11-23")).toBe("3 noches y 4 días");
    const block = calendarPromptBlock({ fechaSalida: "2026-11-20", fechaRegreso: "2026-11-23", destino: "Valle de Bravo", llegada: "LLEGADA: por carretera.", regresoEnAvion: false });
    expect(block).toContain("3 noches y 4 días");
    expect(block).toContain("EXACTAMENTE 4 días");
    expect(block).toMatch(/Día 1 = vie 20 nov/);
    expect(block).toMatch(/Día 4 = lun 23 nov/);
  });

  it("Madrid: vuelo 11:00 que llega 05:00 del día siguiente → Día 1 es de vuelo y la cena pasa al día de llegada", () => {
    const flight = { salida: "2027-03-10 11:00", llegada: "2027-03-11 05:00" };
    const { days, ajustes } = applyTripCalendar(madridModelo(), { fechaSalida: "2027-03-10", fechaRegreso: "2027-03-17", destino: "Madrid", origen: "Ciudad de México", flight, internacional: true });
    expect(days).toHaveLength(8);
    expect(days.map((d) => d.fecha)).toEqual(calendarDates("2027-03-10", "2027-03-17"));
    expect(days.map((d) => d.dia)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const d1 = days[0];
    expect(d1).toMatchObject({ tipo: "vuelo", titulo: "Vuelo a Madrid" });
    expect(JSON.stringify(d1)).not.toMatch(/Gloria Bendita|Barajas/);
    expect(d1["mañana"]).toMatch(/aeropuerto.*11:00/);
    expect(d1.noche).toMatch(/En vuelo hacia Madrid.*05:00/);
    const d2 = days[1];
    expect(d2.fecha).toBe("2027-03-11");
    expect(d2.tipo).toBe("llegada");
    expect(String(d2["mañana"])).toMatch(/^Llegas a Madrid a las 05:00 \(hora local\)/);
    // Lo que el modelo escribió del vuelo ("Vuelo desde CDMX.") ya no se arrastra al día de llegada.
    expect(String(d2["mañana"])).not.toMatch(/Vuelo desde CDMX/);
    expect(d2.tarde).toBe("Check-in y descanso en tu hotel.");
    expect(d2.noche).toBe("Cena en Gloria Bendita.");
    // El último día del modelo sigue siendo el último del calendario.
    expect(days[7]).toMatchObject({ fecha: "2027-03-17", titulo: "Último día" });
    expect(ajustes.join(" ")).toMatch(/recorridos 1 día/);
  });

  it("con la hora del vuelo de regreso, el último día no lleva nada después de ir al aeropuerto", () => {
    const flight = { salida: "2027-03-10 11:00", llegada: "2027-03-11 05:00", regreso_salida: "2027-03-17 12:30" };
    const { days } = applyTripCalendar(madridModelo(), { fechaSalida: "2027-03-10", fechaRegreso: "2027-03-17", destino: "Madrid", origen: "Ciudad de México", flight, internacional: true });
    const last = days[7];
    expect(last.tipo).toBe("salida");
    expect(last["mañana"]).toBe("Desayuno con churros. Sal al aeropuerto a las 09:30: tu vuelo de regreso sale a las 12:30.");
    expect(last.tarde).toBe("Vuelo de regreso a Ciudad de México.");
    expect(last.noche).toBe("En vuelo de regreso.");
  });

  it("si el modelo ya escribió el Día 1 como vuelo, no se recorre nada", () => {
    const modelo = [{ dia: 1, titulo: "Vuelo a Madrid", mañana: "Vuelo desde CDMX.", tarde: "En vuelo.", noche: "Noche a bordo." }, ...madridModelo().slice(0, 6).map((d, i) => ({ ...d, dia: i + 2 })), { dia: 8, titulo: "Regreso", mañana: "Desayuno.", tarde: "Aeropuerto.", noche: "Vuelo." }];
    const { days, ajustes } = applyTripCalendar(modelo, { fechaSalida: "2027-03-10", fechaRegreso: "2027-03-17", destino: "Madrid", flight: { salida: "2027-03-10 11:00", llegada: "2027-03-11 05:00" } });
    expect(days).toHaveLength(8);
    expect(ajustes.join(" ")).not.toMatch(/recorridos/);
    expect(days[1].noche).toBe("Cena en Gloria Bendita.");
  });

  it("vuelo que llega el mismo día por la tarde: la mañana es de vuelo y la llegada va en la tarde", () => {
    const modelo = [{ dia: 1, titulo: "Roma", mañana: "Coliseo.", tarde: "Foro.", noche: "Cena en Trastevere." }, { dia: 2, titulo: "Vaticano", mañana: "Museos Vaticanos.", tarde: "San Pedro.", noche: "Cena." }];
    const { days } = applyTripCalendar(modelo, { fechaSalida: "2027-05-10", fechaRegreso: "2027-05-11", destino: "Roma", flight: { salida: "2027-05-10 07:00", llegada: "2027-05-10 15:30" } });
    expect(days[0]["mañana"]).toMatch(/aeropuerto.*07:00/);
    expect(days[0].tarde).toMatch(/^Llegas a Roma a las 15:30/);
    expect(days[0].noche).toBe("Cena en Trastevere.");
  });

  it("viaje en coche (sin vuelo): solo fechas y todos los días del calendario", () => {
    const modelo = [
      { dia: 1, titulo: "Llegada y centro", mañana: "Salida de CDMX.", tarde: "Comida en Bocatto Gourmet.", noche: "Bistró Isabel." },
      { dia: 2, titulo: "Miradores", mañana: "Mirador La Peña.", tarde: "Cascada.", noche: "Soleado." },
      { dia: 3, titulo: "Regreso", mañana: "Stupa.", tarde: "Regreso a CDMX.", noche: "Llegada a CDMX." },
    ];
    const { days } = applyTripCalendar(modelo, { fechaSalida: "2026-11-20", fechaRegreso: "2026-11-23", destino: "Valle de Bravo", origen: "Ciudad de México", flight: null });
    expect(days.map((d) => d.fecha)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(days[0].titulo).toBe("Llegada y centro");
    expect(days[2]).toMatchObject({ titulo: "Día libre en Valle de Bravo", tipo: "libre" });
    expect(days[3].titulo).toBe("Regreso");
    expect(days.some((d) => d.tipo === "vuelo")).toBe(false);
  });

  it("resume la llegada real de la lista para la llamada del itinerario", () => {
    const rows = [{ salida: "2027-03-10 11:00", llegada: "2027-03-11 05:00" }, { salida: "2027-03-10 21:40", llegada: "2027-03-11 15:10" }];
    const s = arrivalSummary(rows, "2027-03-10", "Madrid");
    expect(s).toMatch(/llegan a Madrid el jue 11 mar entre las 05:00 y las 15:10/);
    expect(s).toMatch(/El Día 1 es de VUELO/);
    expect(arrivalSummary([], "2027-03-10", "Madrid")).toMatch(/servidor ajusta el día de llegada/);
  });

  it("la app y el servidor leen la hora igual (clockOf compartido)", () => {
    expect(clockOf("2027-03-11 05:00")).toBe("05:00");
    expect(clockOf("7:05")).toBe("07:05");
  });
});

describe("horas del vuelo elegido copiadas de la fuente (defecto 4)", () => {
  const gf = [
    { airline: "Iberia", price_per_person_usd: 1390, departure: { id: "MEX", time: "2027-03-10 11:00" }, arrival: { id: "MAD", time: "2027-03-11 05:00" } },
    { airline: "Aeromexico", price_per_person_usd: 1600, departure: { id: "MEX", time: "2027-03-10 21:40" }, arrival: { id: "MAD", time: "2027-03-11 15:10" } },
  ];
  const tp = [{ airline: "IB", price: 1200, booking_link: "https://www.aviasales.com/search/MEX1003MAD17031?t=abc&marker=533299", departure_at: "2027-03-10T11:00:00-06:00", return_at: "2027-03-17T12:30:00+01:00", duration_to_minutes: 600 }];

  it("Google Flights: empata precio y aerolínea → 'Sale 11:00 · llega 05:00 +1'", () => {
    const a: any = { vuelos: [{ tier: "equilibrio", aerolinea: "Iberia", precio_por_persona: 1390 * FX, fuente_precio: "serpapi" }] };
    enforceSources(a, [], [], "google_places", { fxUsd: FX, googleFlights: gf });
    expect(a.vuelos[0]).toMatchObject({ salida: "2027-03-10 11:00", llegada: "2027-03-11 05:00", fuente_precio: "serpapi" });
    expect(flightScheduleLabel(a.vuelos[0])).toBe("Sale 11:00 · llega 05:00 +1");
  });

  it("nunca inventa horas: sin empate, con aerolínea distinta o con empates ambiguos, sin hora", () => {
    const noMatch: any = { vuelos: [{ tier: "ahorro", aerolinea: "Iberia", precio_por_persona: 999 * FX, fuente_precio: "serpapi", salida: "2027-03-10 09:00", llegada: "2027-03-10 23:00" }] };
    enforceSources(noMatch, [], [], "google_places", { fxUsd: FX, googleFlights: gf });
    expect(noMatch.vuelos[0].salida).toBeUndefined();
    expect(noMatch.vuelos[0].llegada).toBeUndefined();
    expect(flightScheduleLabel(noMatch.vuelos[0])).toBeNull();

    const otraAerolinea: any = { tier: "equilibrio", aerolinea: "Lufthansa", precio_por_persona: 1390 * FX };
    applyFlightTimes(otraAerolinea, "serpapi", { fxUsd: FX, googleFlights: gf });
    expect(otraAerolinea.salida).toBeUndefined();

    const dos = [gf[0], { ...gf[0], departure: { time: "2027-03-10 23:55" }, arrival: { time: "2027-03-11 18:30" } }];
    const ambiguo: any = { tier: "equilibrio", aerolinea: "Iberia", precio_por_persona: 1390 * FX };
    applyFlightTimes(ambiguo, "serpapi", { fxUsd: FX, googleFlights: dos });
    expect(ambiguo.salida).toBeUndefined();
  });

  it("Aviasales: hora de salida de la tarifa y llegada = salida + duración en la zona del destino", () => {
    expect(stampInZone(Date.parse("2027-03-11T03:00:00Z"), "Europe/Madrid")).toBe("2027-03-11 04:00");
    const a: any = { vuelos: [{ tier: "equilibrio", aerolinea: "Iberia", precio_por_persona: 1200 * FX, fuente_precio: "travelpayouts", booking_link: tp[0].booking_link }] };
    enforceSources(a, [], [], "google_places", { fxUsd: FX, tpFlights: tp, destTimeZone: "Europe/Madrid" });
    expect(a.vuelos[0]).toMatchObject({ salida: "2027-03-10 11:00", llegada: "2027-03-11 04:00", regreso_salida: "2027-03-17 12:30" });
    // Sin zona horaria del destino no se calcula la llegada.
    const b: any = { tier: "equilibrio", aerolinea: "Iberia", precio_por_persona: 1200 * FX, booking_link: tp[0].booking_link };
    applyFlightTimes(b, "travelpayouts", { fxUsd: FX, tpFlights: tp });
    expect(b.salida).toBe("2027-03-10 11:00");
    expect(b.llegada).toBeUndefined();
  });

  it("opciones por carretera no llevan horas", () => {
    const a: any = { vuelos: [{ tier: "equilibrio", modo: "auto", aerolinea: "En tu coche", precio_por_persona: 800, fuente_precio: "estimado" }] };
    enforceSources(a, [], [], "google_places", { fxUsd: FX, googleFlights: gf });
    expect(a.vuelos[0].salida).toBeUndefined();
  });
});

describe("texto del análisis coherente (defecto 12)", () => {
  const ctx = { destino: "Valle de Bravo", pais: "México", enCoche: true, otherPlaces: ["Madrid", "Kioto"] };
  it("quita 'por persona' del coche, la reinterpretación de días y el favorito ajeno", () => {
    const a: any = {
      analisis_narrativo: "Sofía, Valle de Bravo está a 139 km. Las opciones terrestres son estimaciones por persona en viaje redondo. " +
        "Aunque marcaste 3 días en fechas (20 al 23 de noviembre, 3 noches), lo armé como una escapada de 4 días. " +
        "Como Madrid es tu favorito, te sugiero hoteles con carácter de pueblo. Noviembre es temporada de la Mariposa Monarca.",
      tips_personalizados: ["Como en tu viaje a Kioto, madruga.", "Lleva efectivo para las casetas."],
      hospedaje: [{ nombre: "Rodavento", por_que: "Porque te encantó Madrid. Tiene vista al lago." }],
    };
    const r = cleanNarrative(a, ctx);
    expect(a.analisis_narrativo).toBe("Sofía, Valle de Bravo está a 139 km. Noviembre es temporada de la Mariposa Monarca.");
    expect(a.tips_personalizados).toEqual(["Lleva efectivo para las casetas."]);
    expect(a.hospedaje[0].por_que).toBe("Tiene vista al lago.");
    expect(r.quitadas).toHaveLength(5);
  });
  it("conserva el gusto del mismo destino y 'por persona' fuera del coche", () => {
    const a: any = { analisis_narrativo: "Como Valle de Bravo está en tus favoritos, repetimos el lago. El autobús cuesta por persona lo que dice ADO." };
    cleanNarrative(a, { ...ctx, enCoche: false, otherPlaces: ["Valle de Bravo", "Madrid"] });
    expect(a.analisis_narrativo).toBe("Como Valle de Bravo está en tus favoritos, repetimos el lago. El autobús cuesta por persona lo que dice ADO.");
  });
  it("lee los destinos del perfil de gustos", () => {
    const p: any = { encanta: [{ label: "Madrid" }], viajes_pasados: [{ destino: "Kioto" }], ya_visitados: ["Roma"], proximos: [], deseos: ["Lima"] };
    expect(tasteLabels(p)).toEqual(["Madrid", "Kioto", "Roma", "Lima"]);
  });
});

describe("casetas CDMX → Valle de Bravo (defecto 12): el monto es el de Google, de ida, × 2 para el regreso", () => {
  it("un solo precio en MXN de la ruta, sin sumar los tramos ni convertir", async () => {
    const { quoteFromRoute } = await import("../../supabase/functions/_shared/google-tolls");
    const { carCost } = await import("../../supabase/functions/_shared/carCost");
    const route = {
      travelAdvisory: { tollInfo: { estimatedPrice: [{ currencyCode: "MXN", units: "612" }] } },
      legs: [{ travelAdvisory: { tollInfo: { estimatedPrice: [{ currencyCode: "MXN", units: "612" }] } } }],
    };
    const q = await quoteFromRoute(route, { rate: async () => { throw new Error("no debe convertir MXN"); } });
    expect(q).toMatchObject({ estado: "CON_MONTO", monto_mxn: 612, montos: [{ moneda: "MXN", monto: 612 }], pase: null });
    const c = carCost({ kmIda: 139, kmFuente: "google_routes", tolls: q });
    expect(c.casetas).toMatchObject({ ida_mxn: 612, total_mxn: 1224, fuente: "google_routes" });
  });
});
