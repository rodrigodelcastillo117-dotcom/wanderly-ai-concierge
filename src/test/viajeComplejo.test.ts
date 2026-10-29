// Intérprete de viaje completo (caso Diego, 27/28-oct-2026) y la regla universal del dueño: NUNCA descartar
// en silencio algo que el viajero escribió. Sin red: fixtures de la salida de la IA (src/test/fixtures).
import { describe, expect, it, vi } from "vitest";
import {
  acceptSuggestion, checkCoverage, describeSpec, ensureCoverage, excludeMention, MAX_SPEC_TEXT, openQuestions, routeOfSpec, setCruise,
  setReturnVia, setTripBasics, tripSpecRequestBody, validateTripSpec, withConsulta, consultaOf, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec";
import { applySeaLegs, normalizeSeaLegs, seaNights, seaPromptBlock } from "../../supabase/functions/logistics-plan/seaLegs";
import { remapLegIndex } from "../../supabase/functions/logistics-plan/regionsBody";
import { planOpenJaw } from "../../supabase/functions/logistics-plan/openJaw";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist";
import { buildLocalSpec, finalizeSpec, localMentions } from "@/lib/tripSpecLocal";
import { routeFromItems } from "@/lib/tripCoverage";
import { parseMultiCityText } from "@/lib/multiCityText";
import { logisticsPlanArgs } from "@/lib/multiDestGenerate";
import { generateFromSpec, interpretTrip, recalcSummary, specFromTrip } from "@/lib/tripSpecFlow";
import { cruiseLinks, CRUISE_PRICE_NOTE } from "@/lib/cruiseLinks";
import { AMBIGUO_AI, AMBIGUO_TEXT, DIEGO_AI, DIEGO_TEXT, ITALIA_AI, ITALIA_TEXT, TEPOZ_AI, TEPOZ_TEXT } from "./fixtures/viajeComplejo";

const TODAY = new Date("2026-10-28T12:00:00");
const ai = (raw: unknown, text: string, ctx = {}) => {
  const r = validateTripSpec(JSON.stringify(raw), text, ctx);
  if (r.ok === false) throw new Error((r as { error: string }).error);
  return finalizeSpec(r.spec, text, ctx);
};
const qOf = (s: TripSpec, tipo: string) => openQuestions(s).find((q) => q.tipo === tipo)!;

/** Diego resuelto: acepta las ciudades de Arabia, puertos y noches del crucero, y Londres como estancia o escala. */
function diegoResuelto(londres: "estancia" | "conexion") {
  let s = ai(DIEGO_AI, DIEGO_TEXT);
  s = acceptSuggestion(s, qOf(s, "ciudades_de_pais").id);
  const cabo = s.paradas.find((p) => p.ciudad === "Ciudad del Cabo")!;
  s = setCruise(s, cabo.id, { puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", fecha_salida: "2027-11-25", fecha_llegada: "2027-12-09" });
  s = setReturnVia(s, null, londres);
  return s;
}

describe("caso Diego: Arabia Saudita, crucero, Cape Town y regreso por Londres", () => {
  it("la IA no inventa: sin naviera ni precio que no dijo; las ciudades de Arabia son sugerencias y se pregunta", () => {
    const s = ai(DIEGO_AI, DIEGO_TEXT);
    const cabo = s.paradas.find((p) => p.ciudad === "Ciudad del Cabo")!;
    expect(cabo.llegada_por).toBe("crucero");
    expect(cabo.sugerida).toBe(false); // "Cape Town" sí lo escribió
    expect(cabo.crucero?.naviera).toBeNull(); // "MSC" no está en el texto
    expect(JSON.stringify(cabo.crucero)).not.toMatch(/precio|45000/);
    expect(cabo.crucero?.puertos_sugeridos).toBe(true); // Yeda no lo dijo
    expect(s.paradas.filter((p) => p.sugerida).map((p) => p.ciudad)).toEqual(["Riad", "AlUla", "Yeda"]);
    // Preguntas obligatorias aunque el modelo no las puso: crucero y "¿escala o estancia?" en Londres.
    expect(openQuestions(s).map((q) => q.tipo).sort()).toEqual(["ciudades_de_pais", "conexion_o_estancia", "crucero"]);
    expect(s.paradas.some((p) => p.ciudad === "Londres")).toBe(false); // el regreso por Londres no es estancia por sí solo
    expect(routeOfSpec(s).kind).toBe("preguntas"); // nada se genera solo
    expect(s.consulta_original).toBe(DIEGO_TEXT);
  });

  it("orden escrito y sugerencia aparte; el resumen dice crucero (Yeda → Ciudad del Cabo)", () => {
    const s = ai(DIEGO_AI, DIEGO_TEXT);
    expect(s.paradas.map((p) => p.ciudad)).toEqual(["Riad", "AlUla", "Yeda", "Ciudad del Cabo"]);
    expect(s.sugerencias[0]).toMatch(/Yeda/);
    expect(describeSpec(s)).toBe("Ciudad de México → Riad (Arabia Saudita) → AlUla (Arabia Saudita) → Yeda (Arabia Saudita) → crucero (Yeda → Ciudad del Cabo) → Ciudad del Cabo → Londres (¿escala o estancia?) → Ciudad de México");
  });

  it("resuelto con Londres como estancia → multidestino con crucero y la última ciudad Londres (open-jaw desde Londres)", () => {
    const s = diegoResuelto("estancia");
    const r = routeOfSpec(s);
    expect(r.kind).toBe("multi");
    if (r.kind !== "multi") return;
    expect(r.destinos).toEqual(["Riad", "AlUla", "Yeda", "Ciudad del Cabo", "Londres"]);
    expect(r.seaLegs).toEqual([expect.objectContaining({ index: 2, tipo: "crucero", puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", noches: 14, naviera: null })]);
    const body = logisticsPlanArgs({ userId: "u1", origin: r.origen, stops: r.destinos, fechaSalida: r.fecha_salida, fechaRegreso: r.fecha_regreso, viajeros: r.viajeros,
      prefs: {}, nightsPerCity: r.noches, seaLegs: r.seaLegs, travelerNotes: r.notas });
    expect(body.destinations[body.destinations.length - 1]).toBe("Londres");
    expect(body.sea_legs).toHaveLength(1);
    expect(body.traveler_notes).toMatch(/Lujo/);
    const oj = planOpenJaw({ origin: "Ciudad de México", destinations: body.destinations, fecha_salida: "2027-11-15", fecha_regreso: "2027-12-19", num_viajeros: 2 });
    expect(oj.ok).toBe(true);
    if (oj.ok) { expect(oj.lastCity).toBe("Londres"); expect(oj.legs[1].to).toBe(oj.origin.airport); }
    expect(describeSpec(s)).toMatch(/crucero \(Yeda → Ciudad del Cabo\) → Ciudad del Cabo → Londres → Ciudad de México$/);
    expect(checkCoverage(s)).toEqual({ ok: true, sin_cubrir: [] });
  });

  it("con Londres como escala → el regreso sale de Ciudad del Cabo y la escala va como nota (no como hotel)", () => {
    const r = routeOfSpec(diegoResuelto("conexion"));
    expect(r.kind).toBe("multi");
    if (r.kind !== "multi") return;
    expect(r.destinos[r.destinos.length - 1]).toBe("Ciudad del Cabo");
    expect(r.notas).toMatch(/Regreso con escala en Londres/);
  });

  it("cobertura: todo lo que lee el lector local (Arabia, crucero, Cape Town, Londres) queda en el viaje o en una pregunta", () => {
    const s = ai(DIEGO_AI, DIEGO_TEXT);
    const local = localMentions(DIEGO_TEXT).map((m) => m.texto);
    expect(local).toEqual(expect.arrayContaining(["Arabia Saudita", "Cape Town", "Londres"]));
    expect(local.some((t) => /crucero/i.test(t))).toBe(true);
    expect(checkCoverage(s).ok).toBe(true);
    // Si la IA hubiera olvidado Cape Town, se vuelve pregunta (no se pierde).
    const sinCabo = { ...DIEGO_AI, paradas: DIEGO_AI.paradas.slice(0, 3), menciones: DIEGO_AI.menciones.filter((m) => m.texto !== "Cape Town") };
    const s2 = ai(sinCabo, DIEGO_TEXT);
    expect(openQuestions(s2).some((q) => /Cape Town/.test(q.texto))).toBe(true);
  });

  it("sin IA (lector local): conserva cada pieza en orden y pregunta lo que no sabe", () => {
    const s = finalizeSpec(buildLocalSpec(DIEGO_TEXT, { today: TODAY }), DIEGO_TEXT);
    expect(s.origen).toBe("Ciudad de México");
    expect(s.fecha_salida).toBe("2027-11-15"); // antes la salida caía en 2026 (viaje de 13 meses)
    expect(s.fecha_regreso).toBe("2027-12-19");
    expect(s.viajeros).toBe(2);
    // Arabia Saudita → Riad propuesta (sugerida, por confirmar); Cape Town → Ciudad del Cabo, a la que se llega en crucero.
    expect(s.paradas.map((p) => [p.ciudad, p.llegada_por, p.sugerida])).toEqual([["Riad", "vuelo", true], ["Ciudad del Cabo", "crucero", false]]); // a otro continente: vuelo por defecto (R2 P1-2)
    expect(s.regreso.via).toBe("Londres");
    const tipos = openQuestions(s).map((q) => `${q.tipo}:${q.texto}`);
    expect(tipos).toEqual(expect.arrayContaining(["ciudades_de_pais:Arabia Saudita", "conexion_o_estancia:Londres"]));
    expect(tipos.some((t) => t.startsWith("crucero"))).toBe(true);
    expect(checkCoverage(s).ok).toBe(true);
  });
});

describe("crucero: sin precio inventado", () => {
  it("logistics-plan: noches a bordo sin hotel, tramo sin precio y rotulado por cotizar", () => {
    const legs = normalizeSeaLegs([{ index: 2, tipo: "crucero", puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", fecha_salida: "2027-11-25", fecha_llegada: "2027-12-09", precio: 999 }],
      ["Riad", "AlUla", "Yeda", "Ciudad del Cabo", "Londres"]);
    expect(legs).toEqual([expect.objectContaining({ index: 2, from: "Yeda", to: "Ciudad del Cabo", noches: 14, precio: null, precio_estado: "por_cotizar_con_naviera" })]);
    expect(seaNights(legs)).toBe(14);
    const norm = (x: unknown) => String(x ?? "").toLowerCase();
    const out = applySeaLegs([{ from: "Yeda", to: "Ciudad del Cabo", mode: "vuelo_interno", price_per_person_usd: 1200 }, { from: "Riad", to: "AlUla", mode: "vuelo_interno", price_per_person_usd: 150 }], legs, norm);
    const sea = out.find((t) => t.mode === "crucero")!;
    expect(sea.price_per_person_usd).toBe(0);
    expect(sea.precio).toBeNull();
    expect(sea.provider).toBe("Naviera por confirmar");
    expect(out.find((t) => t.from === "Riad")!.price_per_person_usd).toBe(150); // los vuelos normales siguen
    expect(seaPromptBlock(legs)).toMatch(/SIN precio/);
    expect(normalizeSeaLegs([{ index: 9 }], ["A", "B"])).toEqual([]);
  });

  it("enlaces reales en la lista blanca, sin precio; con naviera dicha, su sitio oficial", () => {
    const sinNaviera = cruiseLinks({ naviera: null, barco: null, puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", fecha_salida: "2027-11-25", fecha_llegada: null, noches: 14 });
    expect(sinNaviera.map((l) => l.label)).toEqual(["Cruise Critic", "Vacations To Go"]);
    const conMsc = cruiseLinks({ naviera: "MSC", barco: null, puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", fecha_salida: null, fecha_llegada: null, noches: null });
    expect(conMsc[0]).toMatchObject({ label: "MSC Cruceros", url: "https://www.msccruises.com/" });
    for (const l of [...sinNaviera, ...conMsc]) { expect(checkAllowlisted(l.url).ok).toBe(true); expect(l.nota).not.toMatch(/\$|MXN|USD/); }
    expect(CRUISE_PRICE_NOTE).toBe("Precio por cotizar con la naviera · no suma al total");
    // Google /search sigue fuera de la lista blanca (AUD-04).
    expect(checkAllowlisted("https://www.google.com/search?q=crucero").ok).toBe(false);
  });

  it("la región expandida remapea el índice del tramo por mar", () => {
    // ["Toscana", "Roma"] → ["Siena", "Lucca", "Roma"]: el tramo 0 sale de Lucca (índice 1).
    expect(remapLegIndex(0, [0, 0, 1])).toBe(1);
  });
});

describe("otros casos", () => {
  it("'Roma, Florencia, Venecia y Toscana 15 días' → multidestino con la Toscana por sus ciudades (confirmadas)", () => {
    let s = ai(ITALIA_AI, ITALIA_TEXT, { origen: "Ciudad de México" });
    expect(routeOfSpec(s).kind).toBe("preguntas");
    s = acceptSuggestion(s, qOf(s, "ciudades_de_pais").id);
    s = setTripBasics(s, { fecha_salida: "2027-05-01", fecha_regreso: "2027-05-15" });
    const r = routeOfSpec(s);
    expect(r.kind).toBe("multi");
    if (r.kind === "multi") {
      expect(r.destinos).toEqual(["Roma", "Florencia", "Venecia", "Siena", "Lucca"]);
      expect(r.noches).toEqual([4, 3, 3, 2, 2]);
      expect(r.legModes).toEqual(["tren", "tren", "tren", "coche"]);
    }
    // Local (sin IA): la Toscana ya no se pierde como "desconocida".
    const l = finalizeSpec(buildLocalSpec(ITALIA_TEXT, { origen: "Ciudad de México", today: TODAY }), ITALIA_TEXT);
    expect(l.paradas.map((p) => p.ciudad)).toEqual(["Roma", "Florencia", "Venecia", "Siena", "Lucca"]);
    expect(openQuestions(l).some((q) => q.texto === "Toscana")).toBe(true);
  });

  it("'fin de semana en Tepoztlán' → destino único", () => {
    const r = routeOfSpec(ai(TEPOZ_AI, TEPOZ_TEXT));
    expect(r).toMatchObject({ kind: "unico", destino: "Tepoztlán", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" });
    // Sin IA: Tepoztlán no está en el catálogo; queda como parada y se pregunta (no se borra).
    const l = finalizeSpec(buildLocalSpec(TEPOZ_TEXT, { origen: "Ciudad de México", today: TODAY }), TEPOZ_TEXT);
    expect(l.paradas.map((p) => p.ciudad)).toEqual(["Tepoztlán"]);
    const q = qOf(l, "lugar_desconocido");
    expect(q.pregunta).toBe("No reconocimos «Tepoztlán»: ¿qué ciudad es?");
    expect(routeOfSpec(acceptSuggestion(l, q.id)).kind).toBe("unico");
  });

  it("texto ambiguo → preguntas concretas, sin adivinar ni borrar", () => {
    const s = ai(AMBIGUO_AI, AMBIGUO_TEXT);
    const r = routeOfSpec(s);
    expect(r.kind).toBe("preguntas");
    const preguntas = openQuestions(s).map((q) => q.pregunta);
    expect(preguntas).toEqual(expect.arrayContaining(["¿Córdoba, España o Córdoba, Argentina?", expect.stringMatching(/fechas/i)]));
    expect(s.paradas.map((p) => p.ciudad)).toEqual(["Córdoba"]);
    // Quitar algo es una exclusión aprobada que queda registrada.
    const q2 = openQuestions(s).find((q) => q.texto === "algo de playa")!;
    const ex = excludeMention(s, q2.id);
    expect(ex.menciones.find((m) => m.texto === "algo de playa")?.estado).toBe("excluido");
    expect(checkCoverage(ex).ok).toBe(true);
  });

  it("'Quiero Francia y después Italia': dos países con su ciudad propuesta y confirmación", () => {
    const s = finalizeSpec(buildLocalSpec("Quiero Francia y después Italia", { origen: "Ciudad de México", today: TODAY }), "Quiero Francia y después Italia");
    expect(s.paradas.map((p) => [p.ciudad, p.de_region, p.sugerida])).toEqual([["París", "Francia", true], ["Roma", "Italia", true]]);
    expect(openQuestions(s).filter((q) => q.tipo === "ciudades_de_pais").map((q) => q.texto)).toEqual(["Francia", "Italia"]);
  });

  it("'Madrid, Sevilla, tren a Barcelona y regreso a CDMX': ciudades, tren y regreso", () => {
    const t = "Madrid, Sevilla, tren a Barcelona y regreso a CDMX";
    let s = finalizeSpec(buildLocalSpec(t, { origen: "Ciudad de México", today: TODAY }), t);
    expect(s.paradas.map((p) => [p.ciudad, p.llegada_por])).toEqual([["Madrid", "vuelo"], ["Sevilla", "por_definir"], ["Barcelona", "tren"]]); // CDMX → Madrid: vuelo por defecto (R2 P1-2)
    expect(s.regreso.a).toBe("Ciudad de México");
    s = setTripBasics(s, { fecha_salida: "2027-04-01", fecha_regreso: "2027-04-10" });
    const r = routeOfSpec(s);
    expect(r.kind).toBe("multi");
    if (r.kind === "multi") {
      expect(r.destinos).toEqual(["Madrid", "Sevilla", "Barcelona"]);
      expect(r.legModes).toBeNull(); // Madrid → Sevilla no lo dijo: no se fuerza
      expect(r.notas).toMatch(/Sevilla → Barcelona en tren/);
    }
  });

  it("'Crucero desde Barcelona, desembarco en Roma y regreso por París': puerto de salida, desembarque y pregunta por París", () => {
    const t = "Crucero desde Barcelona, desembarco en Roma y regreso por París";
    const s = finalizeSpec(buildLocalSpec(t, { origen: "Ciudad de México", today: TODAY }), t);
    expect(s.paradas.map((p) => p.ciudad)).toEqual(["Barcelona", "Roma"]);
    const roma = s.paradas[1];
    expect(roma.llegada_por).toBe("crucero");
    expect(roma.crucero).toMatchObject({ puerto_salida: "Barcelona", puerto_llegada: "Roma", naviera: null });
    expect(s.regreso.via).toBe("París");
    expect(openQuestions(s).map((q) => q.tipo)).toEqual(expect.arrayContaining(["crucero", "conexion_o_estancia"]));
    expect(describeSpec(s)).toContain("crucero (Barcelona → Roma)");
  });

  it("'Budapest, Atenas y París': 3 ciudades en el orden escrito", () => {
    const s = finalizeSpec(buildLocalSpec("Budapest, Atenas y París", { origen: "Ciudad de México", today: TODAY }), "Budapest, Atenas y París");
    expect(s.paradas.map((p) => p.ciudad)).toEqual(["Budapest", "Atenas", "París"]);
    expect(openQuestions(s).map((q) => q.tipo)).toEqual(["fechas"]);
  });

  it("nombres ambiguos, aeropuertos y regiones no catalogadas → aclaración, nunca eliminación", () => {
    const t = "Valle de Guadalupe, LHR y la Patagonia chilena";
    const s = finalizeSpec(buildLocalSpec(t, { origen: "Ciudad de México", today: TODAY }), t);
    const textos = [...s.paradas.map((p) => p.texto), ...openQuestions(s).map((q) => q.texto)].join(" | ");
    for (const x of ["Valle de Guadalupe", "LHR", "Patagonia chilena"]) expect(textos).toContain(x);
    expect(routeOfSpec(s).kind).toBe("preguntas");
    expect(checkCoverage(s).ok).toBe(true);
  });
});

describe("H1 · planeador: 'Hungría, atenas y paris' ya no pierde Hungría", () => {
  const route = (t: string, answers = {}) => routeFromItems(parseMultiCityText(t).items, answers);
  it("3 paradas con Budapest (propuesta, pendiente de confirmar) en el orden escrito", () => {
    const r = route("Hungría, atenas y paris");
    expect(r.labels).toEqual(["Budapest (Hungría)", "Atenas", "París"]);
    expect(r.pending.map((p) => p.text)).toEqual(["Hungría"]);
    expect(r.missing).toEqual([]);
    const ok = route("Hungría, atenas y paris", { [r.pending[0].key]: { cities: ["Budapest"] } });
    expect(ok.cities).toEqual(["Budapest", "Atenas", "París"]);
    expect(ok.pending).toEqual([]);
  });
  it("'Tokio' → destino único (sin pendientes)", () => {
    const r = route("Tokio");
    expect(r.cities).toEqual(["Tokio"]);
    expect(r.pending).toEqual([]);
  });
  it("un lugar inventado → pregunta (no desaparece); quitarlo es una exclusión explícita", () => {
    const r = route("Zorbalandia, Roma y Venecia");
    expect(r.pending.map((p) => p.text)).toEqual(["Zorbalandia"]);
    expect(r.cities).toEqual(["Roma", "Venecia"]);
    const ex = route("Zorbalandia, Roma y Venecia", { [r.pending[0].key]: { excluir: true } });
    expect(ex.items.find((i) => i.text === "Zorbalandia")?.excluded).toBe(true);
    expect(ex.pending).toEqual([]);
  });
  it("ningún lugar escrito se pierde (validador de cobertura)", () => {
    for (const t of ["Hungría, atenas y paris", "Francia, Italia y Grecia", "Roma, Florencia, Venecia y Toscana", "Arabia Saudita, Cape Town y Londres", "Xyz, Roma"]) {
      const p = parseMultiCityText(t);
      const r = routeFromItems(p.items, {});
      expect(r.missing).toEqual([]);
      expect(r.items).toHaveLength(p.items.length);
      expect(r.items.every((i) => i.cities.length > 0 || i.pending || i.excluded)).toBe(true);
    }
  });
  it("Cape Town es la ciudad (Ciudad del Cabo), no el país Sudáfrica", () => {
    expect(parseMultiCityText("Cape Town y Londres").cities).toEqual(["Ciudad del Cabo", "Londres"]);
  });
});

describe("texto original, límites y fallas", () => {
  it("texto de más de 500 caracteres: se guarda completo; la IA lee hasta 8,000 y se avisa", () => {
    const long = `${DIEGO_TEXT} `.repeat(30).trim();
    expect(long.length).toBeGreaterThan(5000);
    const s = ai(DIEGO_AI, long);
    expect(s.consulta_original).toBe(long);
    const huge = "Roma ".repeat(3000);
    const body = tripSpecRequestBody(huge, { hoy: "2026-10-28" });
    expect(body.messages[1].content.length).toBeLessThan(huge.length);
    expect(huge.length).toBeGreaterThan(MAX_SPEC_TEXT);
  });

  it("falla de IA o timeout: se conserva la solicitud original y se ofrece corrección manual", async () => {
    const never = { functions: { invoke: () => new Promise<never>(() => {}) }, from: () => ({}) };
    const r = await interpretTrip(never as any, DIEGO_TEXT, { origen: "Ciudad de México" }, 20);
    expect(r.spec.fuente).toBe("local");
    expect(r.spec.consulta_original).toBe(DIEGO_TEXT);
    expect(r.aviso).toMatch(/Guardamos tu texto completo/);
    const boom = { functions: { invoke: async () => ({ data: null, error: new Error("502") }) }, from: () => ({}) };
    const r2 = await interpretTrip(boom as any, DIEGO_TEXT);
    expect(r2.spec.paradas.length + openQuestions(r2.spec).length).toBeGreaterThan(0);
  });

  it("el texto original queda guardado en el viaje (multidestino y destino único) y re-armar crea una revisión sin borrar el anterior", async () => {
    const calls: any[] = [];
    const client = {
      functions: { invoke: vi.fn(async (fn: string, o: any) => {
        calls.push({ fn, body: o.body });
        if (fn === "logistics-plan" && o.body?.action === "snapshot") return { data: { ok: true }, error: null };
        if (fn === "logistics-plan") return { data: { logistics: { destinations: o.body.destinations, days: [], total_estimado_mxn: 1, sea_legs: o.body.sea_legs } }, error: null };
        if (fn === "analizar-viaje") return { data: { trip: { id: "t-unico", itinerario_json: [{ dia: 1 }] } }, error: null };
        return { data: null, error: null };
      }) },
      from: (table: string) => {
        const api: any = {
          insert: (row: any) => { calls.push({ fn: `insert:${table}`, row }); return api; },
          update: (row: any) => { calls.push({ fn: `update:${table}`, row }); return api; },
          delete: () => { calls.push({ fn: `delete:${table}` }); return api; },
          select: () => api, eq: () => api,
          single: async () => ({ data: { id: "t-multi" }, error: null }),
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return api;
      },
    };
    const multi = await generateFromSpec(client as any, diegoResuelto("estancia"), { userId: "u1", previous: { id: "t-viejo", itinerario_json: [{ dia: 1 }] } });
    expect(multi).toEqual({ tripId: "t-multi", flujo: "multi" });
    const ins = calls.find((c) => c.fn === "insert:trips")!.row;
    expect(ins.itinerario_json.consulta.consulta_original).toBe(DIEGO_TEXT);
    expect(ins.itinerario_json.consulta.revision_de).toBe("t-viejo");
    expect(ins.destino).toBe("Riad → AlUla → Yeda → Ciudad del Cabo → Londres");
    const plan = calls.find((c) => c.fn === "logistics-plan" && !c.body.action)!.body;
    expect(plan.sea_legs[0]).toMatchObject({ tipo: "crucero", noches: 14 });
    // El viaje anterior: solo se anota la revisión (no se borra nada).
    expect(calls.some((c) => c.fn.startsWith("delete"))).toBe(false);
    const old = calls.find((c) => c.fn === "update:trips")!.row;
    expect(old.itinerario_json.days).toEqual([{ dia: 1 }]);
    expect(old.itinerario_json.consulta.revisiones[0]).toMatchObject({ version: 2, trip_id: "t-multi" });

    calls.length = 0;
    const unico = await generateFromSpec(client as any, ai(TEPOZ_AI, TEPOZ_TEXT), { userId: "u1" });
    expect(unico).toEqual({ tripId: "t-unico", flujo: "unico" });
    expect(calls.find((c) => c.fn === "analizar-viaje")!.body.notas_usuario).toContain(TEPOZ_TEXT);
    const up = calls.find((c) => c.fn === "update:trips")!.row;
    expect(up.itinerario_json.days).toEqual([{ dia: 1 }]);
    expect(consultaOf({ itinerario_json: up.itinerario_json })?.consulta_original).toBe(TEPOZ_TEXT);
  });

  it("con pendientes no se genera nada (ni se llama a ninguna función de pago)", async () => {
    const invoke = vi.fn();
    await expect(generateFromSpec({ functions: { invoke }, from: () => ({}) } as any, ai(DIEGO_AI, DIEGO_TEXT), { userId: "u1" })).rejects.toThrow(/pendientes/);
    expect(invoke).not.toHaveBeenCalled();
    expect(recalcSummary(diegoResuelto("estancia"))).toMatchObject({ flujo: "multi", costo: "Armar tu viaje usa una búsqueda de tu plan." });
  });

  it("viaje viejo sin consulta: lo entendido sale del viaje (destinos, fechas, crucero del plan)", () => {
    const s = specFromTrip({ destino: "Arabia Saudita", ciudad_origen: "Ciudad de México", fecha_salida: "2027-11-15", fecha_regreso: "2027-12-19", num_viajeros: 2, itinerario_json: [{ dia: 1 }] });
    expect(s.consulta_original).toBe("");
    expect(s.paradas.map((p) => p.ciudad)).toEqual(["Arabia Saudita"]);
    expect(routeOfSpec(s).kind).toBe("unico");
    expect(withConsulta([{ dia: 1 }], { version: 1, consulta_original: "x", interpretacion: s, guardado_at: "t" })).toMatchObject({ days: [{ dia: 1 }] });
  });

  it("ensureCoverage agrega como pregunta lo que otro lector encontró y la IA no puso", () => {
    const s = ai(TEPOZ_AI, TEPOZ_TEXT);
    ensureCoverage(s, [{ texto: "Cuernavaca", tipo: "ciudad" }]);
    expect(openQuestions(s).map((q) => q.texto)).toContain("Cuernavaca");
    expect(routeOfSpec(s).kind).toBe("preguntas");
  });
});

describe("crucero sin puerto escrito (Riad no tiene puerto)", () => {
  it("no usa una parada de tierra adentro como puerto de salida", async () => {
    const { cruiseLine } = await import("../../supabase/functions/_shared/tripSpec");
    expect(cruiseLine(null, "Riad", "Ciudad del Cabo")).toContain("puerto por confirmar → Ciudad del Cabo");
    expect(cruiseLine(null, "Riad", "Ciudad del Cabo")).not.toContain("Riad");
    expect(cruiseLine({ naviera: null, barco: null, puerto_salida: "Yeda", puerto_llegada: null, fecha_salida: null, fecha_llegada: null, noches: null }, "Riad", "Ciudad del Cabo"))
      .toContain("Yeda → Ciudad del Cabo");
  });
});
