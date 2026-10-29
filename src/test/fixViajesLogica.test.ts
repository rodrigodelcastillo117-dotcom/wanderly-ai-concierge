// Auditoría de Inicio, Planear y Viajes (traveliatos.life, 28-oct-2026), claude/fix-viajes. Cada bloque
// lleva el número del defecto del reporte; todas fallaban antes del arreglo.
import { describe, it, expect } from "vitest";
import { recoPlanHref, sortRecosByMatch } from "@/lib/homeRecos";
import { holidayPeriods, monthOfText, suggestedDatesNotice, suggestTripDates } from "@/lib/planDefaults";
import { coerceDesglose, reconcileBudget, totalFloor } from "../../supabase/functions/analizar-viaje/budget";
import { invalidQuoteReason, quoteFloor } from "@/lib/budgetSanity";
import { displayedTripTotal } from "@/lib/tripPageTotal";
import { canonicalQuestions, openQuestions, acceptSuggestion, validateTripSpec } from "../../supabase/functions/_shared/tripSpec";
import { draftNote, draftSpec, mergeDraftWithAi } from "@/lib/tripSpecDraft";
import { finalizeSpec } from "@/lib/tripSpecLocal";
import { regionOnly, parseMultiCityText } from "@/lib/multiCityText";
import { proposeRegionRoute } from "@/lib/countryRoutes";
import { calendarDays, FREE_DAY_TITLE, RETURN_DAY_TITLE } from "@/lib/itineraryCalendar";
import { buildTripPdfModel } from "@/lib/tripPdfModel";
import { plainProviderText } from "@/lib/provenance";
import { fxSourceName } from "@/lib/fx";
import { isPlaceholderHotel, placeholderHotelLabel } from "../../supabase/functions/_shared/booking/placeholderHotel";
import { buildPurchasePlan } from "@/lib/purchasePlan";
import { hotelForCity } from "@/lib/experiencias";
import { flightDurationLabel, flightScheduleLabel, scheduleFromNotes } from "@/lib/flightDisplay";
import { trainDateParam, trainPrefillFromTrip } from "@/lib/trainPrefill";
import { formatLocalDate } from "@/lib/localDate";
import { groundOptionsForCity } from "@/lib/multiDestTrip";
import { noLinkText } from "../../supabase/functions/_shared/booking/railOperators";
import { buildTranslationPrompt } from "../../supabase/functions/_shared/travelAdvisories";
import { quoteTrust } from "@/lib/quoteTrust";
import { buildBuyFlow } from "@/lib/buyFlow";
import { editSuggestions } from "@/lib/editSuggestions";
import { hotelMatches, resolveHotels } from "@/lib/broughtTrip";
import { buildCityWeather } from "@/lib/tripWeather";
import { dailyCostMxn, destinationPhotoQuery, parseUsdRange } from "@/lib/compareCost";
import { FX_FALLBACK_TABLE } from "@/lib/fx";
import { PREFILL } from "@/lib/affiliateLinks";
import { liveSearchesPausedRecently, noteLiveSearchState } from "@/lib/livePause";

const TODAY = new Date(2026, 9, 28, 12); // 28 oct 2026, día de la auditoría

// ─── P0-1 · Inicio: una recomendación NUNCA genera un viaje ───
describe("P0-1 · tarjetas de Inicio → Planear con sugerencia, sin autoCheapest", () => {
  it("el enlace no lleva autoCheapest (que disparaba analizar-viaje) sino sugerencia=1", () => {
    const href = recoPlanHref({ name: "Budapest", country: "Hungría" });
    expect(href).not.toMatch(/autoCheapest/);
    const u = new URL(href, "https://x.test");
    expect(u.pathname).toBe("/dashboard/planear");
    expect(u.searchParams.get("destino")).toBe("Budapest");
    expect(u.searchParams.get("pais")).toBe("Hungría");
    expect(u.searchParams.get("sugerencia")).toBe("1");
  });

  it("las fechas sugeridas no caen sobre Año Nuevo sin avisar (antes 29 dic → 5 ene)", () => {
    const s = suggestTripDates(TODAY);
    expect(new Date(`${s.salida}T12:00:00`).getDay()).toBe(2); // martes
    expect(s.nights).toBe(7);
    const peaks = [...holidayPeriods(2026), ...holidayPeriods(2027)];
    expect(peaks.some((p) => s.salida <= p.to && s.regreso >= p.from)).toBe(false);
    expect(s.salida > "2027-01-07").toBe(true);
    expect(s.avoided).toContain("Navidad y Año Nuevo");
    const notice = suggestedDatesNotice("Budapest", s, true);
    expect(notice).toMatch(/Evitamos Navidad y Año Nuevo/);
    expect(notice).toMatch(/Cámbialas/);
    expect(notice).toMatch(/Armar mi viaje/);
  });

  it("sin festivos de por medio no se recorre ni se dice nada de más", () => {
    const s = suggestTripDates(new Date(2027, 1, 1, 12)); // 1 feb 2027 → ~2 abr; Pascua 2027 es el 28 mar
    expect(s.avoided.length === 0 || s.avoided.includes("Semana Santa y Pascua")).toBe(true);
    expect(suggestedDatesNotice("Lisboa", s, false)).toMatch(/^Para cotizar Lisboa necesitamos tu ciudad de salida/);
  });
});

// ─── P0-2 · desglose como texto → total $7 MXN ───
describe("P0-2 · analizar-viaje valida el desglose y nunca guarda un total absurdo", () => {
  const vuelos = [
    { tier: "ahorro", precio_por_persona: 14000 },
    { tier: "equilibrio", precio_por_persona: 16000 },
    { tier: "premium", precio_por_persona: 22000 },
  ];
  const hospedaje = [{ precio_por_noche: 2000 }, { precio_por_noche: 3000 }, { precio_por_noche: 5000 }];
  const texto = "vuelos: 32000, hospedaje: 21000, comida: 8400, tours: 5000, transporte_local: 1500, extras: 2000";

  it("coerceDesglose: objeto de rubros sí; texto libre, arreglo o claves '0'.. no", () => {
    expect(coerceDesglose({ vuelos: 1000, hospedaje: "2,500" })).toEqual({ vuelos: 1000, hospedaje: 2500 });
    expect(coerceDesglose('{"vuelos": 100, "comida": 50}')).toEqual({ vuelos: 100, comida: 50 });
    expect(coerceDesglose(texto)).toBeNull();
    expect(coerceDesglose([1, 2])).toBeNull();
    expect(coerceDesglose({ 0: "5", 1: "2" })).toBeNull();
    expect(coerceDesglose(null)).toBeNull();
  });

  it("caso Budapest: el desglose llega como TEXTO → se reconstruye con las opciones (no $7)", () => {
    const r = reconcileBudget({ desglose_presupuesto: texto, vuelos, hospedaje }, { dias: 7, viajeros: 2, internacional: true });
    expect(r.reconstruido).toBe(true);
    expect(Object.keys(r.desglose).some((k) => /^\d+$/.test(k))).toBe(false);
    expect(r.desglose.vuelos).toBe(32000); // equilibrio × 2
    expect(r.desglose.hospedaje).toBe(21000); // hotel medio × 7 noches × 1 habitación
    expect(r.total).toBeGreaterThan(50000);
    expect(r.valido).toBe(true);
  });

  it("piso de cordura: un viaje internacional de $7 MXN no es válido (no se guarda ni se cobra)", () => {
    expect(totalFloor({ internacional: true, viajeros: 2 })).toBe(1000);
    const r = reconcileBudget({ desglose_presupuesto: { comida: 5, extras: 2 }, vuelos: [], hospedaje: [] }, { dias: 7, viajeros: 2, internacional: true });
    expect(r.total).toBe(7);
    expect(r.valido).toBe(false);
    expect(r.motivoInvalido).toBe("total_absurdo");
  });

  it("en pantalla, un viaje viejo con claves '0'..'30' dice 'Por recotizar' (displayedTripTotal = 0)", () => {
    const desglose = Object.fromEntries("5 2".split("").map((c, i) => [String(i), Number(c) || 0]));
    const budapest = { id: "056689e6", destino: "Budapest", pais_destino: "Hungría", ciudad_origen: "Ciudad de México", num_viajeros: 2,
      fecha_salida: "2026-12-29", fecha_regreso: "2027-01-05", total_estimado: 7, desglose_presupuesto: desglose, vuelos_json: vuelos, hospedaje_json: hospedaje };
    expect(invalidQuoteReason(budapest)).toBe("desglose_invalido");
    expect(displayedTripTotal(budapest)).toBe(0);
    expect(quoteFloor(budapest)).toBe(1000);
    expect(invalidQuoteReason({ ...budapest, desglose_presupuesto: { vuelos: 7 }, total_estimado: 14 })).toBe("total_absurdo");
    expect(invalidQuoteReason({ ...budapest, desglose_presupuesto: { vuelos: 32000, hospedaje: 21000 }, total_estimado: 53000 })).toBeNull();
  });
});

// ─── P1-3 · Toscana: pregunta duplicada y aviso roto ───
describe("P1-3 · región (Toscana): una sola pregunta y aviso legible", () => {
  const TEXT = "Toscana 5 días en abril 2027, 2 personas";
  const aiRaw = {
    intencion: "viaje_futuro", origen: "Ciudad de México", viajeros: 2, noches_total: 4,
    paradas: [
      { id: "p1", ciudad: "Florencia", de_region: "Toscana", sugerida: true, texto: "Toscana" },
      { id: "p2", ciudad: "Siena", de_region: "Toscana", sugerida: true, texto: "Toscana" },
    ],
    preguntas: [{ id: "q1", tipo: "ciudades_de_pais", texto: "Toscana es una región, no una ciudad. Propuse Florencia y Siena como base.", pregunta: "¿Te parecen bien Florencia y Siena como base para la Toscana?", opciones: ["Sí, Florencia y Siena"], parada: "p1" }],
    menciones: [{ texto: "Toscana", tipo: "region", estado: "parada", ref: "p1" }],
  };

  it("validateTripSpec lleva la frase de la IA a la mención: una sola pregunta de 'Toscana'", () => {
    const v = validateTripSpec(aiRaw, TEXT);
    expect(v.ok).toBe(true);
    const qs = (v as any).spec.preguntas.filter((q: any) => q.tipo === "ciudades_de_pais");
    expect(qs).toHaveLength(1);
    expect(qs[0].texto).toBe("Toscana");
  });

  it("el aviso de Iato no dice 'las ciudades de Toscana es una región…' ni termina en '..'", () => {
    const base = draftSpec(TEXT, { origen: "Ciudad de México" });
    const ai = finalizeSpec((validateTripSpec(aiRaw, TEXT) as any).spec, TEXT, { origen: "Ciudad de México" });
    const m = mergeDraftWithAi(base, base, ai, { origen: "Ciudad de México" });
    expect(m.nota).not.toMatch(/es una región/);
    expect(m.nota).not.toMatch(/\.\.$/);
    expect(openQuestions(m.spec).filter((q) => q.tipo === "ciudades_de_pais")).toHaveLength(1);
    // Aceptar con "Sí, …" ya no deja otra pendiente de la misma región.
    const q = openQuestions(m.spec).find((x) => x.tipo === "ciudades_de_pais")!;
    expect(openQuestions(acceptSuggestion(m.spec, q.id)).filter((x) => x.tipo === "ciudades_de_pais")).toHaveLength(0);
    expect(draftNote([], ["las ciudades de Toscana."])).toBe("Iato completó tu viaje: preguntó por las ciudades de Toscana.");
  });

  it("dos preguntas de la misma región (una ya respondida) quedan en una, la respondida", () => {
    const spec = { ...draftSpec(TEXT), preguntas: [
      { id: "a", tipo: "otro", texto: "Toscana es una región", pregunta: "Toscana: ¿qué ciudades?", opciones: [], parada: null, resuelta: false },
      { id: "b", tipo: "ciudades_de_pais", texto: "Toscana", pregunta: "¿Florencia y Siena?", opciones: [], parada: null, resuelta: true },
    ] } as any;
    const out = canonicalQuestions(spec);
    expect(out.filter((q) => q.tipo === "ciudades_de_pais")).toHaveLength(1);
    expect(out.find((q) => q.tipo === "ciudades_de_pais")!.resuelta).toBe(true);
  });
});

// ─── P1-4 · Planear (página): no pierde días ni mes ───
describe("P1-4 · 'Toscana 5 días en abril 2027' en la página Planear", () => {
  it("la región se propone por sus bases y el mes se entiende", () => {
    const p = parseMultiCityText("Toscana 5 días en abril 2027, 2 personas");
    expect(regionOnly(p)).toBe("Toscana");
    expect(p.days).toBe(5);
    expect(proposeRegionRoute("Toscana", 4)?.cities).toEqual(["Florencia", "Siena"]);
    expect(monthOfText("Toscana 5 días en abril 2027, 2 personas", TODAY)).toEqual({ month: 3, year: 2027, label: "abril de 2027" });
    expect(monthOfText("Oaxaca del 12 al 16 de diciembre", TODAY)).toBeNull();
    expect(monthOfText("Cancún en diciembre con mi familia", TODAY)?.label).toBe("diciembre de 2026");
  });
});

// ─── P1-5 · itinerario sin fechas y con un día de menos ───
describe("P1-5 · itinerario con fecha por día y días faltantes visibles", () => {
  const madrid = {
    destino: "Madrid", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-17", num_viajeros: 2,
    itinerario_json: Array.from({ length: 7 }, (_, i) => ({ dia: i + 1, titulo: `Día ${i + 1} en Madrid`, "mañana": "Paseo", tarde: "Museo", noche: "Cena" })),
  };

  it("Madrid 10–17 mar con 7 días guardados → 8 días, cada uno con su fecha; el 8 'Día de regreso'", () => {
    const days = calendarDays(madrid);
    expect(days).toHaveLength(8);
    expect(days[0]).toMatchObject({ dia: 1, fecha: "2027-03-10" });
    expect(days[6]).toMatchObject({ dia: 7, fecha: "2027-03-16" });
    expect(days[7]).toMatchObject({ dia: 8, fecha: "2027-03-17", pendiente: true, titulo: RETURN_DAY_TITLE });
  });

  it("un día faltante en medio se muestra como 'Día libre' (no se esconde) y el que trae fecha la conserva", () => {
    const t = { ...madrid, itinerario_json: [{ dia: 1, fecha: "2027-03-10", titulo: "Llegada" }, { dia: 3, titulo: "Toledo" }] };
    const days = calendarDays({ ...t, fecha_regreso: "2027-03-12" });
    expect(days.map((d) => [d.dia, d.fecha, !!d.pendiente])).toEqual([[1, "2027-03-10", false], [2, "2027-03-11", true], [3, "2027-03-12", false]]);
    expect(days[1].titulo).toBe(FREE_DAY_TITLE);
  });

  it("el PDF también trae la fecha de cada día y el día faltante", () => {
    const m = buildTripPdfModel(madrid, { sel: { selVuelo: -1, selHospedaje: -1, selTours: new Set(), nochesHospedaje: 7 } } as any);
    const days = m.cities[0].days;
    expect(days).toHaveLength(8);
    expect(days[0].date).toBe("mié 10 mar");
    expect(days[7].pendiente).toBe(true);
  });
});

// ─── P1-6 · "vía SerpApi", "(," y "frankfurter" ───
describe("P1-6 · texto técnico de proveedores", () => {
  const madrid = "El vuelo equilibrado según Google Flights (vía SerpApi, tarifas consultadas el 28 oct) cuesta $16,190.";
  it("la app no deja '(,' al quitar 'vía SerpApi'", () => {
    expect(plainProviderText(madrid)).toBe("El vuelo equilibrado según Google Flights (tarifas consultadas el 28 oct) cuesta $16,190.");
    expect(plainProviderText("Hoteles de Google Hotels (vía SerpApi).")).toBe("Hoteles de Google Hotels.");
  });
  it("el PDF usa el mismo filtro (antes imprimía '(vía SerpApi, tarifas…')", () => {
    const m = buildTripPdfModel({ destino: "Madrid", analisis_ai: madrid, itinerario_json: [], tips_personalizados: ["Datos vía SerpApi."] }, { sel: { selVuelo: -1, selHospedaje: -1, selTours: new Set() } } as any);
    expect(m.summary).not.toMatch(/serp ?api|\(,/i);
    expect(m.tips.join(" ")).not.toMatch(/serp ?api/i);
  });
  it("'frankfurter' se dice 'Banco Central Europeo (Frankfurter)'", () => {
    expect(fxSourceName("frankfurter")).toBe("Banco Central Europeo (Frankfurter)");
    expect(fxSourceName("frankfurter", true)).toBe("de respaldo");
  });
});

// ─── P1-9 · hoteles inventados ───
describe("P1-9 · hotel 'de referencia' de la IA: sin botón de compra ni origen de distancias", () => {
  const bogota = {
    id: "4c918b9e", destino: "Bogotá", pais_destino: "Colombia", ciudad_origen: "Ciudad de México", num_viajeros: 2,
    fecha_salida: "2026-12-04", fecha_regreso: "2026-12-08", desglose_presupuesto: { hospedaje: 22400 },
    hospedaje_json: [
      { tier: "ahorro", nombre: "Hotel boutique en Chapinero / Zona G (por confirmar)", precio_por_noche: 3700, fuente_precio: "estimado" },
      { tier: "equilibrio", nombre: "Hotel 5★ clásico en Zona T / Chicó (por confirmar)", precio_por_noche: 5600, fuente_precio: "estimado" },
      { tier: "premium", nombre: "Hotel de lujo en Usaquén / Zona Rosa (por confirmar)", precio_por_noche: 8400, fuente_precio: "estimado" },
    ],
    vuelos_json: [], itinerario_json: [],
  };

  it("se reconocen (y un hotel real no)", () => {
    expect(isPlaceholderHotel(bogota.hospedaje_json[1])).toBe(true);
    expect(isPlaceholderHotel({ nombre: "Boutique hotel en el Centro Histórico (por confirmar en Google Hotels)" })).toBe(true);
    expect(isPlaceholderHotel({ nombre: "Hotel Montera Madrid, Curio Collection by Hilton", fuente_precio: "serpapi" })).toBe(false);
    expect(isPlaceholderHotel({ nombre: "Rodavento", fuente_precio: "estimado" })).toBe(false);
    expect(placeholderHotelLabel(bogota.hospedaje_json[1])).toBe("Hotel 5★ clásico en Zona T / Chicó");
  });

  it("Comprar: 'Elegir hotel en Bogotá' con la búsqueda real del destino y fechas (no la frase literal)", () => {
    const items = buildPurchasePlan(bogota, { selVuelo: -1, selHospedaje: -1, selTours: new Set() } as any);
    const h = items.find((i) => i.kind === "hospedaje")!;
    expect(h.title).toBe("Hospedaje · Elegir hotel en Bogotá");
    expect(h.buttonLabel).toBe("Elegir hotel en Booking.com");
    expect(h.placeholder).toBe(true);
    const u = new URL(h.url!);
    expect(u.searchParams.get("ss")).toBe("Bogotá");
    expect(u.searchParams.get("checkin")).toBe("2026-12-04");
    expect(u.searchParams.get("group_adults")).toBe("2");
    expect(h.priceNote).toMatch(/no es un hotel real/);
    expect(h.price).toBe(22400); // precio de referencia (5,600 × 4 noches), no "Sin precio"
    expect(Number((h.offer?.details as any)?.nights)).toBe(4);
  });

  it("Experiencias no mide distancias desde un hotel inventado", () => {
    expect(hotelForCity(bogota, "Bogotá", false)).toBeNull();
  });
});

// ─── P1-10 · vuelos sin horario en viajes viejos ───
describe("P1-10 · horario de las notas, solo si está escrito", () => {
  it("'salida 10-mar 11:00, llegada 11-mar 05:30 (+1)' → Sale 11:00 · llega 05:30 +1", () => {
    expect(scheduleFromNotes("Aeroméxico directo, salida 10-mar 11:00, llegada 11-mar 05:30 (+1)")).toEqual({ sale: "11:00", llega: "05:30", plus: 1 });
    expect(flightScheduleLabel({ aerolinea: "Aeroméxico", notas: "Directo, salida 10-mar 11:00" })).toBe("Sale 11:00");
  });
  it("sin hora escrita no se inventa", () => {
    expect(flightScheduleLabel({ aerolinea: "Iberia", notas: "Tarifa económica, 10h 10m" })).toBeNull();
    expect(flightScheduleLabel({ aerolinea: "Iberia" })).toBeNull();
  });
});

// ─── P1-11 · Trenes con el viaje puesto ───
describe("P1-11 · Trenes precarga ruta, fecha y personas del viaje", () => {
  it("acepta el formato de buyFlow (AAAAMMDD) y el ISO", () => {
    expect(trainDateParam("20270514")).toBe("2027-05-14");
    expect(trainDateParam("2027-05-14")).toBe("2027-05-14");
    expect(trainDateParam("20271345")).toBeNull();
    expect(trainDateParam(null)).toBeNull();
  });
  it("Roma → Florencia → Venecia, 2 viajeros: primer tramo, el día que se deja Roma", () => {
    const p = trainPrefillFromTrip({ destino: "Roma → Florencia → Venecia", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-21", num_viajeros: 2 });
    expect(p).toMatchObject({ origin: "Roma", destination: "Florencia", pax: 2 });
    expect(p!.date! > "2027-05-10" && p!.date! < "2027-05-21").toBe(true);
  });
});

// ─── P2-14 · recomendaciones ordenadas por match ───
it("P2-14 · las recomendaciones van de mayor a menor match (76% ya no antes que 96%)", () => {
  expect(sortRecosByMatch([{ name: "A", score: 76 }, { name: "B", score: 96 }, { name: "C", score: 88 }]).map((r) => r.name)).toEqual(["B", "C", "A"]);
});

// ─── P2-15 · formato de fecha único ───
it("P2-15 · formato único '10 mar 2027' (antes '10/3/2027')", () => {
  expect(formatLocalDate("2027-03-10")).toBe("10 mar 2027");
  expect(formatLocalDate("2026-11-13")).toBe("13 nov 2026");
  expect(formatLocalDate("2026-10-01", { day: "numeric", month: "long" })).toBe("1 de octubre");
});

// ─── P2-16 · Destinos ───
describe("P2-16 · Destinos: trenes repetidos, texto de enlace y tuteo de avisos", () => {
  it("'Trenitalia (Frecciarossa) / Italo' y 'Trenitalia / Frecciarossa' al mismo precio son una opción", () => {
    const trip = { destino: "Roma → Florencia", ciudad_origen: "Ciudad de México", itinerario_json: { multi: true, destinations: ["Roma", "Florencia"], logistics: { fx_usd_mxn: 18,
      per_destination: [{ city: "Roma", arrival_options: [] }, { city: "Florencia", arrival_options: [
        { mode: "tren", provider: "Trenitalia (Frecciarossa) / Italo", duration: "1h 36m", price_per_person_usd: 57, from: "Roma" },
        { mode: "tren", provider: "Trenitalia / Frecciarossa", duration: "1h 35m", price_per_person_usd: 57, from: "Roma" },
        { mode: "tren", provider: "Italo Treno", duration: "1h 36m", price_per_person_usd: 50, from: "Roma" },
      ] }] } } };
    // R2: dedupe por operador — «Italo Treno» ya está en «Trenitalia (Frecciarossa) / Italo».
    expect(groundOptionsForCity(trip, "Florencia").map((o) => o.aerolinea)).toEqual(["Trenitalia (Frecciarossa) / Italo"]);
  });
  it("sin enlace del operador no se dice 'aún no tiene un enlace precargado'", () => {
    expect(noLinkText("tren", "Trenitalia")).not.toMatch(/precargado/);
  });
  it("la traducción de avisos oficiales tutea", () => {
    const { system } = buildTranslationPrompt([], { iso2: "IT", nombre: "Italia", nombre_en: "Italy" } as any);
    expect(system).toMatch(/de TÚ/);
    expect(system).toMatch(/nunca de usted/);
  });
});

// ─── P2-17 · orden del desglose ───
it("P2-17 · los renglones de la cotización salen en el orden del desglose (Vuelos primero)", () => {
  const t = quoteTrust({ line_items: [
    { category: "tours", amount: 7527, state: "ESTIMADO" }, { category: "comida", amount: 35399, state: "ESTIMADO" },
    { category: "extras", amount: 3708, state: "ESTIMADO" }, { category: "vuelos", amount: 34932, state: "COTIZADO" },
    { category: "hospedaje", amount: 67315, state: "COTIZADO" }, { category: "transporte_local", amount: 4285, state: "ESTIMADO" },
  ] }, new Date("2026-10-28T12:00:00Z"));
  expect(t.lines.map((l) => l.category)).toEqual(["vuelos", "hospedaje", "comida", "tours", "transporte_local", "extras"]);
});

// ─── P2-18 · Comprar ───
describe("P2-18 · Comprar", () => {
  it("'Directo · Directo': una duración sin número no se muestra", () => {
    expect(flightDurationLabel({ duracion: "Directo", fuente_precio: "serpapi" })).toBeNull();
    expect(flightDurationLabel({ duracion: "11h 0m", fuente_precio: "serpapi" })).toBe("11h 0m");
  });
  it("la opción de la cotización no cuenta como elegida (coincide con 'Falta elegir')", () => {
    const trip = { destino: "San Miguel de Allende", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-13", fecha_regreso: "2026-11-15", num_viajeros: 2,
      vuelos_json: [{ tier: "equilibrio", modo: "auto", aerolinea: "En tu coche", precio_por_persona: 900, fuente_precio: "estimado" }], hospedaje_json: [], itinerario_json: [] };
    const f = buildBuyFlow(trip, { selVuelo: -1, selHospedaje: -1, selTours: new Set() } as any);
    const step = f.steps.find((s) => s.kind === "vuelo") as any;
    expect(step.userChosen).toBe(false);
    const f2 = buildBuyFlow(trip, { selVuelo: 0, selHospedaje: -1, selTours: new Set() } as any);
    expect((f2.steps.find((s) => s.kind === "vuelo") as any).userChosen).toBe(true);
  });
});

// ─── P2-20 · Editar con IA en un viaje en coche ───
it("P2-20 · en un viaje en coche 'Editar con IA' no sugiere 'vuelos económicos'", () => {
  const car = { destino: "Valle de Bravo", ciudad_origen: "Ciudad de México", vuelos_json: [{ modo: "auto", aerolinea: "En tu coche" }] };
  expect(editSuggestions(car).ejemplos.join(" ")).not.toMatch(/vuelos/);
  expect(editSuggestions({ destino: "Madrid", ciudad_origen: "Ciudad de México" }).ejemplos.join(" ")).toMatch(/vuelos económicos/);
});

// ─── P2-22 · "Ya tengo vuelos y hotel": no cambia el hotel en silencio ───
describe("P2-22 · el hotel escrito no se cambia por otro sin decirlo", () => {
  it("hotelMatches", () => {
    expect(hotelMatches("Hotel PRUEBA AUDITORÍA", "Otro Oaxaca", "Macedonio Alcalá 505, Centro, Oaxaca")).toBe(false);
    expect(hotelMatches("Casa Oaxaca", "Casa Oaxaca Hotel Boutique", null)).toBe(true);
    expect(hotelMatches("Macedonio Alcalá 505", "Otro Oaxaca", "Macedonio Alcalá 505, Centro")).toBe(true);
  });
  it("si Google devuelve otro lugar, se dice 'No encontramos…' y no se guarda ese", async () => {
    const client: any = { functions: { invoke: async () => ({ data: { lat: 17.06, lng: -96.72, name: "Otro Oaxaca", label: "Macedonio Alcalá 505, Centro" }, error: null }) } };
    const resolved: Record<string, any> = {};
    const r = await resolveHotels(client, [{ ciudad: "Oaxaca", llegada: "2026-12-01", salida: "2026-12-04", hotel: "Hotel PRUEBA AUDITORÍA" }], resolved);
    expect(r.list).toEqual([null]);
    expect(r.errors[0].mensaje).toMatch(/No encontramos «Hotel PRUEBA AUDITORÍA»/);
    expect(r.errors[0].mensaje).toMatch(/Otro Oaxaca/);
    expect(Object.keys(resolved)).toHaveLength(0);
  });
});

// ─── P2-23 · Clima ───
describe("P2-23 · clima: centro de la ciudad (no el aeropuerto) y sin '15° / 15°'", () => {
  it("pide el centro a la geocodificación y no repite la misma cifra como máxima y mínima", async () => {
    const asked: string[] = [];
    const geocoder = async (a: string) => { asked.push(a); return [{ lat: 41.9028, lng: 12.4964 }]; };
    const now = new Date("2026-10-28T18:00:00Z");
    const met = { properties: { timeseries: [{ time: "2026-10-28T18:00:00Z", data: { instant: { details: { air_temperature: 15, wind_speed: 2 } }, next_1_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: 0 } } } }] } };
    const fetchImpl: any = async () => ({ ok: true, status: 200, json: async () => met, headers: new Headers() });
    const b = await buildCityWeather({ city: "Roma", start: "2027-05-10", end: "2027-05-14" } as any, { geocoder, fetchImpl, now });
    expect(asked).toEqual(["Roma"]);
    expect(b!.lat).toBeCloseTo(41.9028, 3); // no 41.8 / 12.239 (Fiumicino)
    if (b!.today) {
      expect(b!.today.now).toBe(15);
      expect(b!.today.tmax === 15 && b!.today.tmin === 15).toBe(false);
    }
  });
});

// ─── P2-25 · Comparar ───
describe("P2-25 · Comparar en MXN y foto de Lisboa", () => {
  it("el costo diario de la IA en USD se muestra en MXN con el tipo de cambio y de dónde sale", () => {
    expect(parseUsdRange("$80-120")).toEqual({ min: 80, max: 120 });
    const fx = { ...FX_FALLBACK_TABLE, rates: { ...FX_FALLBACK_TABLE.rates, MXN: 18.5 } };
    const r = dailyCostMxn("$80-120", fx);
    expect(r.text).toBe("$1,480–2,220 MXN por día");
    expect(r.note).toMatch(/De USD 80–120 \(estimado de la IA\) · 1 USD = 18\.50 MXN/);
    expect(dailyCostMxn("varía", fx).text).toBe("varía");
  });
  it("la foto de Lisboa se busca por su nombre en inglés", () => {
    expect(destinationPhotoQuery("Lisboa, Portugal")).toBe("lisbon portugal city travel");
  });
});

// ─── P2-26 · texto técnico en Trenes ───
it("P2-26 · Trenes no dice 'bloquea nuestra verificación automática'", () => {
  for (const k of ["raileurope", "db", "skyscanner", "viator", "tripadvisor", "thefork", "yelp"]) {
    expect(PREFILL[k]?.completa ?? "").not.toMatch(/verificación automática/);
  }
});

// ─── P1-7 · pantalla de carga: "en vivo" solo si se sabe ───
it("P1-7 · se recuerda que las búsquedas en vivo están en pausa (para no decir 'en vivo')", () => {
  sessionStorage.clear();
  expect(liveSearchesPausedRecently()).toBe(false);
  noteLiveSearchState({ ok: false, busquedas_en_pausa: true });
  expect(liveSearchesPausedRecently()).toBe(true);
  expect(liveSearchesPausedRecently(Date.now() + 31 * 60_000)).toBe(false);
});
