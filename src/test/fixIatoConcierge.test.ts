// Auditoría 10 (producción, 28-oct-2026) — Concierge PRO / Iato. Cada prueba nombra su defecto (#n del
// REPORTE_concierge). Las respuestas reales que transmitió producción están en
// fixtures/auditoria10Respuestas.json (texto que llegó en vivo y texto final que dejó el servidor).
import { describe, expect, it } from "vitest";
import RESPUESTAS from "./fixtures/auditoria10Respuestas.json";
import { compactReply, countLines, LiveAdviceFilter, REPLY_LIMITS } from "../../supabase/functions/concierge-chat/brevity";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import { CircuitBreaker, DEFAULT_MODEL_CONFIG, routeTurn } from "../../supabase/functions/concierge-chat/router";
import type { ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { DATA_SENTINEL } from "../../supabase/functions/concierge-chat/stream";
import { slimToolResult } from "../../supabase/functions/concierge-chat/tools";
import { prepareToolResultForModel, isTourDuplicate, tourTitlesOf } from "../../supabase/functions/concierge-chat/cards";
import { enforceNoFakeBooking, enforceNoFakeRequest } from "../../supabase/functions/concierge-chat/guard";
import { applyToolPolicy, detectIntents, planTurn, toolOutcome } from "../../supabase/functions/concierge-chat/planner";
import { EXPENSE_CATEGORIES as IATO_CATEGORIES, validateAction } from "../../supabase/functions/concierge-chat/actions";
import { EXPENSE_CATEGORIES } from "@/lib/expenseCategories";
import { resolveTurnPlace } from "../../supabase/functions/concierge-chat/turnPlace";
import { datesInText, resolveActiveTrip } from "../../supabase/functions/_shared/activeTrip";
import { runEventSearch } from "../../supabase/functions/concierge-chat/events";
import { flightStatusUnavailableBody } from "../../supabase/functions/_shared/flight-serpapi";
import { finalizeSearchResponse } from "../../supabase/functions/_shared/liveSearch";
import { scrubProviders } from "../../supabase/functions/_shared/providerNames";
import { buildContextMessage, SYSTEM, FIXER_RULE } from "../../supabase/functions/concierge-chat/prompt";
import { reservationGuardInput } from "../../supabase/functions/concierge-chat/context";
import { nearbySearchBody } from "../../supabase/functions/places-nearby/rank";

type Fixture = { exigente: boolean; streamed: string; final_prod: string };
const FIX = RESPUESTAS as Record<string, Fixture>;
const HOY = "2026-10-28";
const ACTX = { todayISO: HOY, trips: [], activeTripId: null };

/** Un turno real (turn.ts) con el modelo que transmite `text` en trozos de 7 letras. */
async function liveTurn(text: string, opts: { exigente?: boolean; avoidVuelo?: boolean; message?: string; openRequests?: { title: string; label: string }[] } = {}) {
  const shown: string[] = [];
  const message = opts.message ?? "pregunta";
  const caller: ModelCaller = async (step, _input, h) => {
    for (const chunk of text.match(/[\s\S]{1,7}/g) ?? []) h.onText(chunk);
    return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
  const out = await runConciergeTurn({
    plan: { intents: [], prefetch: [], notes: [], toolHints: [], suggestedActions: [], cards: [], ...(opts.avoidVuelo ? { avoidTopics: ["vuelo"] as Array<"vuelo"> } : {}) },
    route: routeTurn({ message, intents: [], exigente: !!opts.exigente, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(),
    callModel: caller, execTool: async () => ({}), toolTimeout: () => 1000,
    send: (ev) => { if (ev.type === "delta") shown.push(ev.data.text); else if (ev.type === "reset") shown.length = 0; },
    meta: {}, stableSystem: "s", dynamicSystem: "d", contextMessage: null, history: [{ role: "user", content: message }], userMessage: message,
    exigente: !!opts.exigente, hasAnthropicKey: true, hasLovableKey: false, actionCtx: ACTX, openRequests: opts.openRequests,
  });
  return { final: out.final, shown: shown.join("") };
}

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("#1 (P0) y #2: lo que el usuario vio nunca se borra al final (respuestas reales de producción)", () => {
  it.each(Object.keys(FIX))("%s: el texto final contiene todo lo transmitido y no termina colgando", async (k) => {
    const f = FIX[k];
    const { final, shown } = await liveTurn(f.streamed, { exigente: f.exigente });
    // Se vio exactamente lo que el modelo escribió…
    expect(shown.trim()).toBe(f.streamed.trim());
    // …y el texto final lo conserva completo (solo los guardarraíles de honestidad pueden corregir una frase).
    const corrected = final.guards.some((g) => ["sin_solicitud_falsa", "sin_reserva_falsa", "sin_nombres_tecnicos", "sin_verificar", "motivo_corregido"].includes(g));
    if (!corrected) expect(final.text).toBe(f.streamed.trim());
    else for (const l of lines(f.streamed)) if (!/solicitad|SerpApi|reserv/i.test(l)) expect(final.text.toLowerCase()).toContain(l.toLowerCase());
    expect(final.text).not.toMatch(/:\**\s*$/);
    expect(final.guards).not.toContain("respuesta_recortada");
  });

  it("los casos del reporte: Tailandia, 'Lo que falta', clima con fuente, modo exigente con 'Siguiente paso'", async () => {
    // Antes (producción): el final quedaba en "…dirigidos a sus ciudadanos:" y en "- **Lo que falta:**".
    expect(FIX.t02_avisos_1.final_prod.trim()).toMatch(/ciudadanos:$/);
    expect(FIX.c6_viaje_1.final_prod.trim()).toMatch(/Lo que falta:\*\*$/);
    const t02 = await liveTurn(FIX.t02_avisos_1.streamed);
    expect(t02.final.text).toMatch(/Frontera con Camboya/);
    expect(t02.final.text).toMatch(/guía de la SRE antes de comprar el vuelo/);
    const clima = await liveTurn(FIX.t01_clima_2.streamed);
    expect(clima.final.text).toMatch(/Fuente: MET Norway, consultado hoy 28 oct 2026 a las 16:01/);
    const g1 = await liveTurn(FIX.g1_exigente_1.streamed, { exigente: true });
    expect(g1.final.text).toMatch(/Siguiente paso: reservar la comida/);
    expect(g1.final.text).toMatch(/Después de comer/);
  });

  it("#19: la lista de empaque se queda completa en el texto (9 cosas, no 5)", async () => {
    const { final } = await liveTurn(FIX.x3_empaque_1.streamed);
    expect(final.text.split("\n").filter((l) => l.startsWith("- ")).length).toBe(9);
  });

  it("sin streaming (JSON): el recorte es por bloques completos, sin frases colgando y sin quitar fuente ni siguiente paso", () => {
    for (const [k, f] of Object.entries(FIX)) {
      const r = compactReply(f.streamed, { exigente: f.exigente });
      expect(r.text, k).not.toMatch(/:\**\s*$/);
      for (const l of lines(r.text)) expect(f.streamed, k).toContain(l);
      if (/Fuente:/.test(f.streamed)) expect(r.text, k).toMatch(/Fuente:/);
      if (/Siguiente paso/.test(f.streamed)) expect(r.text, k).toMatch(/Siguiente paso/);
    }
    const t02 = compactReply(FIX.t02_avisos_1.streamed);
    expect(t02.trimmed).toBe(true);
    expect(t02.text).not.toMatch(/ciudadanos:$/);
    // "Lo que falta:" se queda con su lista completa (antes quedaba solo el encabezado).
    const c6 = compactReply(FIX.c6_viaje_1.streamed);
    expect(c6.text).toMatch(/Lo que falta:\*\*\n {2}- \*\*Hotel:\*\*/);
    expect(c6.text).toMatch(/Siguiente paso/);
    // Un texto corto no se toca.
    expect(compactReply("Dos opciones:\n- A\n- B")).toEqual({ text: "Dos opciones:\n- A\n- B", trimmed: false });
  });

  it("la respuesta en JSON (nadie la vio) sí se recorta al tope del modo", () => {
    const long = Array.from({ length: 12 }, (_, i) => `- Opción ${i + 1}: un lugar con su porqué, según Google Maps.`).join("\n");
    const f = finalizeTurn({ raw: long, toolRuns: [], plan: { cards: [], suggestedActions: [] }, actionCtx: ACTX });
    expect(countLines(f.text)).toBeLessThanOrEqual(REPLY_LIMITS.normal.lines);
    expect(f.guards).toContain("respuesta_recortada");
  });

  it("el consejo del vuelo que no pidió se filtra EN VIVO (nunca se muestra) y el final es lo mostrado", async () => {
    const text = "Te recomiendo **La Mesa** (★4.6), según Google Maps. Recuerda que tu vuelo sale hoy: haz check-in en línea.\n- Llega al aeropuerto 3 horas antes.\n- **Cocina Ejemplo** (★4.4).\n\nFuente: Google Maps, consultado hoy.";
    const { final, shown } = await liveTurn(text, { avoidVuelo: true, message: "¿dónde ceno?" });
    expect(shown).not.toMatch(/check-in|aeropuerto/);
    expect(final.text).toBe(shown.trim());
    expect(final.text).toBe("Te recomiendo **La Mesa** (★4.6), según Google Maps. \n- **Cocina Ejemplo** (★4.4).\n\nFuente: Google Maps, consultado hoy.".replace(" \n", " \n"));
    expect(final.guards).toContain("sin_consejo_no_pedido");
    // Si preguntó por el vuelo, no se filtra nada (y sin retraso: pasa tal cual).
    const f = new LiveAdviceFilter({ avoidFlight: true, userMessage: "¿a qué hora salgo al aeropuerto?" });
    expect(f.active).toBe(false);
    expect(f.push("Haz check-in")).toBe("Haz check-in");
  });
});

describe("#3: atracciones — se adelgazan los resultados antes de quitar lugares", () => {
  const ref = (i: number, j: number) => `places/ChIJ${String(i).padStart(23, "0")}/photos/${"A".repeat(360)}${j}`;
  const place = (i: number) => ({
    id: `ChIJ${String(i).padStart(23, "0")}`, place_id: `ChIJ${String(i).padStart(23, "0")}`, name: `Atracción ${i} de Lisboa`, address: `Rua Augusta ${i}, 1100-053 Lisboa, Portugal`,
    rating: 4.6, num_reviews: 12000 + i, price_level: null, price_level_label: null, ranking: null, web_url: `https://maps.google.com/?cid=${1000 + i}`,
    phone: "+351 21 000 0000", website: "https://www.visitlisboa.com/", latitude: 38.71, longitude: -9.13,
    description: "Plaza monumental junto al río Tajo, con arcadas, el Arco de la Rua Augusta y cafés históricos.",
    photos: [], photo_ref: ref(i, 0), photo_refs: Array.from({ length: 10 }, (_, j) => ref(i, j)),
    category: "Atracción turística", open_now: true, hours_today: "abierto 24 horas", fuente: "google_places", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-28T16:04:00Z",
  });
  const raw = { ok: true, source: "google_places", consulted_at: "2026-10-28T16:04:00Z", atribucion: "Google Maps", results: Array.from({ length: 10 }, (_, i) => place(i)) };

  it("antes: 10 lugares de ~4 KB y el tope de 6000 dejaba 1 (\"solo me devolvió un resultado\")", () => {
    expect(JSON.stringify(raw.results[0]).length).toBeGreaterThan(4000);
  });
  it("ahora caben ≥6 lugares, con su foto (photo_ref entero) y sin las listas de fotos", () => {
    const p = prepareToolResultForModel("search_attractions", raw);
    const results = p.results as Record<string, unknown>[];
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(results[0].photo_refs).toBeUndefined();
    expect(results[0].photo_ref).toBe(ref(0, 0));
    expect(results[0].name).toBe("Atracción 0 de Lisboa");
  });
  it("slimToolResult no quita nada si ya cabe", () => {
    const small = { results: [{ name: "A", photo_refs: ["x"] }] };
    expect(slimToolResult(small)).toEqual(small);
  });
});

describe("#4: tours de Roma sin duplicados", () => {
  const tours = { name: "search_tours", args: { city: "Roma" }, result: { disponible: true, results: [
    { title: "Experiencia de hacer pizza y gelato con vino italiano fino en Roma", url: "https://www.viator.com/es-MX/tours/Rome/x/d511-1" },
    { title: "Roma: Sesión de fotos en el Coliseo: experiencia privada y personalizada", url: "https://www.viator.com/es-MX/tours/Rome/y/d511-2" },
    { title: "Clase de cocina Roma Pasta, Ravioli y Tiramisu con vino Premium", url: "https://www.viator.com/es-MX/tours/Rome/z/d511-3" },
    { title: "Clase de pasta y tiramisú con vino italiano fino", url: "https://www.viator.com/es-MX/tours/Rome/w/d511-4" },
  ] } };
  it("las 'atracciones' que el modelo reescribió con los mismos tours se quitan (y sin 'Boletos oficiales')", () => {
    const raw = `Tours de Roma.\n${DATA_SENTINEL}\n${JSON.stringify({ cards: [
      { type: "attraction", title: "Clase de pasta y tiramisú con vino italiano fino", subtitle: "Roma · 3 h · desde $2,106 MXN" },
      { type: "attraction", title: "Pizza y gelato con vino italiano fino", subtitle: "Roma" },
      { type: "attraction", title: "Sesión de fotos en el Coliseo (privada)", subtitle: "Roma" },
      { type: "attraction", title: "Museos Vaticanos", subtitle: "Roma" },
    ] })}`;
    const f = finalizeTurn({ raw, toolRuns: [tours as any], plan: { cards: [], suggestedActions: [] }, actionCtx: ACTX, city: "Roma" });
    const attractions = f.cards.filter((c) => c.type === "attraction");
    expect(attractions.map((c) => c.title)).toEqual(["Museos Vaticanos"]);
    expect(f.cards.filter((c) => c.type === "tour").length).toBe(4);
    expect(JSON.stringify(f.cards.filter((c) => /Coliseo/.test(c.title)))).not.toMatch(/Boletos oficiales|nominativo/);
    expect(f.dropped.cards.filter((d) => d.reason === "tour_repetido").length).toBe(3);
  });
  it("sin tours en el turno nada cambia", () => {
    expect(isTourDuplicate({ type: "attraction", title: "Coliseo" }, tourTitlesOf([]), [])).toBe(false);
  });
});

describe("#5 y #6: tope diario de SerpApi dicho con honestidad", () => {
  it("flight-status en pausa responde el motivo (no 'no respondió') y Iato lo dice como límite de hoy", () => {
    expect(flightStatusUnavailableBody("budget", { flight: "AM2" })).toMatchObject({ error: "busquedas_en_pausa", pausa: "budget", flight: "AM2" });
    expect(flightStatusUnavailableBody(null)).toEqual({ error: "flight_status_unavailable" });
    const p = prepareToolResultForModel("check_flight_status", flightStatusUnavailableBody("budget", { flight: "AM2" }));
    expect(p).toMatchObject({ disponible: false, estado: "limite_diario" });
    expect(String(p.motivo)).toMatch(/Hoy alcanzamos el límite de búsquedas en vivo/);
    expect(toolOutcome(p)).toEqual({ state: "error", suffix: "límite de búsquedas en vivo de hoy" });
    expect(SYSTEM).toMatch(/"limite_diario": "Hoy alcanzamos el límite de búsquedas en vivo de IATOS"/);
  });
  it("vuelos u hoteles sin resultados por la pausa: tampoco es 'sin resultados'", () => {
    const out = finalizeSearchResponse({ status: 200, body: { ok: true, source: "serpapi", results: [] } }, { live: 0, hits: 0, stale: 0, denied: null, oldestFetchedAt: null, paused: "budget" });
    expect(out.body).toMatchObject({ busquedas_en_pausa: true, pausa: "budget" });
    expect(prepareToolResultForModel("search_flights", out.body)).toMatchObject({ estado: "limite_diario" });
  });
  it("eventos: Ticketmaster (gratis) primero, también por ciudad si no hubo nada cerca, y el respaldo pausado se dice", async () => {
    const tmCalls: unknown[] = [];
    const ticketmaster = async (q: any) => { tmCalls.push(q); return { ok: true as const, results: [], consulted_at: "2026-10-28T16:00:00Z" }; };
    const r = await runEventSearch({ city: "Ciudad de México", date_from: "2026-10-31", date_to: "2026-11-01" }, {
      fetchImpl: (async () => { throw new Error("no debe llamar a SerpApi"); }) as any, serpKey: "k", ticketmaster: ticketmaster as any,
      nearCoords: { lat: 19.43, lng: -99.13 }, brake: { paused: async () => "budget", tripQuota: async () => {} },
    });
    expect(tmCalls.length).toBe(2);
    expect((tmCalls[1] as any).coords).toBeNull();
    expect(r).toMatchObject({ ok: true, source: "ticketmaster", results: [], respaldo_en_pausa: "budget" });
    const p = prepareToolResultForModel("search_events", r);
    expect(p).toMatchObject({ disponible: false, estado: "limite_diario" });
    expect(String(p.motivo)).toMatch(/Ticketmaster no trajo eventos.*hoy alcanzamos el límite de búsquedas en vivo/i);
  });
});

describe("#7: la fecha decide entre dos viajes al mismo destino", () => {
  const trips = [
    { id: "vb1", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" },
    { id: "vb2", destino: "Valle de Bravo", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-23" },
  ];
  it("'mi viaje a Valle de Bravo del 30 de octubre' → el del 30 oct, sin preguntar '¿a cuál?'", () => {
    const r = resolveActiveTrip(trips, { todayLocal: HOY, mentionedText: "¿Qué clima hará en mi viaje a Valle de Bravo del 30 de octubre?" });
    expect(r).toMatchObject({ reason: "mentioned" });
    expect(r.trip?.id).toBe("vb1");
    expect(resolveActiveTrip(trips, { todayLocal: HOY, mentionedText: "mi viaje a Valle de Bravo del 21 nov" }).trip?.id).toBe("vb2");
    expect(resolveActiveTrip(trips, { todayLocal: HOY, mentionedText: "mi viaje a Valle de Bravo" }).reason).toBe("ambiguous");
  });
  it("lee fechas en español", () => {
    expect(datesInText("del 30 de octubre", HOY)).toEqual(["2026-10-30"]);
    expect(datesInText("20 nov al 23 nov", HOY)).toEqual(["2026-11-20", "2026-11-23"]);
    expect(datesInText("el 5 de enero", HOY)).toEqual(["2027-01-05"]);
    expect(datesInText("para 2 personas", HOY)).toEqual([]);
  });
});

describe("#8: sin nombres técnicos de proveedores", () => {
  it("el texto final y el contexto del viaje que lee el modelo no dicen SerpApi", () => {
    const f = finalizeTurn({ raw: FIX.c6_viaje_1.streamed, toolRuns: [], plan: { cards: [], suggestedActions: [] }, actionCtx: ACTX, liveText: FIX.c6_viaje_1.streamed });
    expect(FIX.c6_viaje_1.streamed).toMatch(/según Google Hotels vía SerpApi/);
    expect(f.text).not.toMatch(/SerpApi/i);
    expect(f.text).toMatch(/según Google Hotels\./);
    const ctx = buildContextMessage({ viajeEnContexto: { hospedaje: [{ nombre: "Múbú", fuente: "Google Hotels vía SerpApi" }], analisis: "Precios de SerpApi / Google Flights" } });
    expect(ctx!.content).not.toMatch(/serp ?api/i);
    expect(scrubProviders("Sin proveedores.\n\nDos líneas.")).toBe("Sin proveedores.\n\nDos líneas.");
  });
});

describe("#9: no propone vigilar el precio del vuelo en un viaje por tierra", () => {
  const VB = "9b0e7c1a-0000-4000-8000-0000000000b1";
  const coche = { id: VB, destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", vuelos_json: [{ modo: "auto", aerolinea: "En coche" }] };
  it("planeador y validación", () => {
    const msg = "Ayúdame a revisar mi viaje a Valle de Bravo";
    const p = planTurn({ message: msg, intents: detectIntents(msg, "trip_overview"), trip: coche, todayISO: HOY, coords: null, hasPriveSession: false, exigente: false });
    expect(p.suggestedActions.map((a) => a.type)).not.toContain("create_price_alert");
    expect(validateAction("create_price_alert", { trip_id: VB }, { todayISO: HOY, trips: [coche], activeTripId: VB })).toEqual({ ok: false, reason: "viaje_sin_vuelo" });
    const avion = { ...coche, vuelos_json: [{ modo: "vuelo", numero_vuelo: "AM2" }] };
    expect(validateAction("create_price_alert", { trip_id: VB }, { todayISO: HOY, trips: [avion], activeTripId: VB }).ok).toBe(true);
  });
});

describe("#10: Iato no dice que algo 'ya está solicitado' si no existe", () => {
  it("la frase real de producción se corrige; una solicitud real no se toca", () => {
    const line = "  - **Equipaje:** la cotización de Equipaje Invisible ya está solicitada, sin precio confirmado.";
    expect(FIX.c6_viaje_1.streamed).toContain(line.trim());
    const fixed = enforceNoFakeRequest(FIX.c6_viaje_1.streamed, { openRequests: [{ title: "Contramar" }] });
    expect(fixed).toMatch(/la cotización de Equipaje Invisible aún no se ha pedido \(te dejo el botón para pedirlo\), sin precio confirmado\./);
    expect(fixed).toMatch(/Tu solicitud de Contramar sigue pendiente/);
    expect(enforceNoFakeRequest("Tu cotización de Equipaje Invisible ya está solicitada.", { openRequests: [{ title: "Equipaje Invisible · cotización" }] }))
      .toBe("Tu cotización de Equipaje Invisible ya está solicitada.");
    // En el turno: guardarraíl con las solicitudes reales (de cualquier estado).
    expect(reservationGuardInput([{ title: "Contramar", canonical_state: "READY_TO_BOOK" } as any]).knownRequests).toEqual([{ title: "Contramar" }]);
    expect(SYSTEM).toMatch(/nunca digas que algo "ya está solicitado"/);
  });
  it("quitar una reserva falsa ya no junta las viñetas en un solo renglón", () => {
    const t = "Opciones:\n- Te reservé mesa en La Mesa.\n- **Cocina Ejemplo** (★4.4).";
    expect(enforceNoFakeBooking(t)).toBe("Aún no está reservado: Iato no puede reservar directamente. Te dejo el camino más corto para hacerlo o pedírselo a una persona del equipo IATOS. Opciones:\n- **Cocina Ejemplo** (★4.4).");
  });
});

describe("#12: emergencias solo con el tipo principal", () => {
  it("hospital usa includedPrimaryTypes; restaurantes siguen con includedTypes", () => {
    expect(nearbySearchBody({ lat: 19.43, lng: -99.13, kind: "hospital" }, "hospital")).toMatchObject({ includedPrimaryTypes: ["hospital"], rankPreference: "DISTANCE" });
    expect(nearbySearchBody({ lat: 19.43, lng: -99.13, kind: "hospital" }, "hospital")).not.toHaveProperty("includedTypes");
    expect(nearbySearchBody({ lat: 19.43, lng: -99.13, kind: "restaurant" }, "restaurant")).toMatchObject({ includedTypes: ["restaurant"], rankPreference: "POPULARITY" });
  });
});

describe("#13: la reserva queda en el viaje de su fecha", () => {
  const trips = [
    { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" },
    { id: "cdmx", destino: "Ciudad de México", fecha_salida: "2026-11-12", fecha_regreso: "2026-11-15" },
  ];
  const ctx = (activeTripId: string | null) => ({ todayISO: HOY, trips, activeTripId, places: [{ placeId: "ChIJcontramar000000000001", name: "Contramar", city: "Ciudad de México" }] });
  const p = { place_id: "ChIJcontramar000000000001", nombre: "Contramar", fecha: "2026-11-13", hora: "14:30", personas: 2 };
  it("Contramar el 13 de noviembre con Valle de Bravo fijado: va al viaje de CDMX, no al fijado", () => {
    const v = validateAction("ai_reservation_request", p, ctx("vb"));
    expect(v.ok && v.action.params.trip_id).toBe("cdmx");
    const f = validateAction("fixer_request", { tipo: "reservation", titulo: "Mesa", fecha: "2026-11-13" }, ctx("vb"));
    expect(f.ok && f.action.params.trip_id).toBe("cdmx");
  });
  it("sin viaje en esas fechas: sin viaje (no el fijado)", () => {
    const v = validateAction("ai_reservation_request", { ...p, fecha: "2026-12-20" }, ctx("vb"));
    expect(v.ok && v.action.params.trip_id).toBeUndefined();
  });
});

describe("#16: frase inicial y búsquedas que no vienen al caso", () => {
  it("registrar un gasto 'en comida' no busca restaurantes", () => {
    const msg = "Registra un gasto de 150 pesos en comida, descripción: PRUEBA AUDITORÍA café, en mi viaje a Valle de Bravo";
    expect(detectIntents(msg)).toEqual(["expense"]);
  });
  it("una pregunta de propinas no busca restaurantes en Japón", () => {
    expect(detectIntents("¿Cuánta propina se acostumbra dejar en restaurantes en Japón?")).toEqual([]);
    expect(detectIntents("Recomiéndame restaurantes en Japón")).toContain("dining");
  });
  it("Tailandia no consulta el clima de Valle de Bravo (sí el de Bangkok)", () => {
    const msg = "¿Qué debo saber antes de ir a Tailandia?";
    expect(applyToolPolicy("get_weather", { city: "Valle de Bravo" }, msg)).toMatchObject({ blocked: "clima_de_otro_lugar" });
    expect(applyToolPolicy("get_weather", { city: "Bangkok" }, msg).blocked).toBeUndefined();
    expect(applyToolPolicy("get_weather", { city: "Valle de Bravo" }, "¿qué clima hará en mi viaje?").blocked).toBeUndefined();
  });
});

describe("#17: la etiqueta de lugar", () => {
  const vb = { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", vuelos_json: [] };
  const user = { coords: { lat: 19.43, lng: -99.13 }, place: "Ciudad de México" };
  it("un vuelo que no es del viaje no dice 'sobre Valle de Bravo'", () => {
    const tp = resolveTurnPlace({ message: "¿Cómo va el vuelo AM 2 de hoy de Aeroméxico?", trips: [vb], explicitId: "vb", todayISO: HOY, user });
    expect(tp.scope).toBe("none");
    expect(tp.label).toBeNull();
  });
  it("'Pedir transporte' con el viaje aún por empezar es de donde está", () => {
    const tp = resolveTurnPlace({ message: "Pedir transporte", trips: [vb], explicitId: "vb", todayISO: HOY, user });
    expect(tp).toMatchObject({ scope: "here", label: "Ciudad de México" });
  });
});

describe("#18 y #19: acciones con las categorías de Gastos y la maleta completa", () => {
  it("Iato usa las mismas categorías que la pantalla Gastos", () => {
    expect([...IATO_CATEGORIES]).toEqual(EXPENSE_CATEGORIES.map((c) => c.value));
    const v = validateAction("add_expense", { monto: 150, moneda: "MXN", categoria: "Gastronomía", descripcion: "café" }, ACTX);
    expect(v.ok && v.action.params.categoria).toBe("Restaurantes");
  });
  it("el resumen de la maleta nombra las 9 cosas (antes '… y 4 más')", () => {
    const items = ["Chamarra", "Playera", "Pantalón", "Tenis", "Impermeable", "Gorra", "Traje de baño", "Cargador", "Medicamentos"];
    const id = "9b0e7c1a-0000-4000-8000-0000000000b2";
    const v = validateAction("add_packing_items", { trip_id: id, items }, { todayISO: HOY, trips: [{ id, destino: "Valle de Bravo" }], activeTripId: id });
    expect(v.ok && v.action.summary).toBe(`Agregar a la maleta de tu viaje a Valle de Bravo (9 cosas): ${items.join(", ")}`);
  });
});

describe("Members Only P1-5: sin 'acceso preferente' en el prompt de Iato", () => {
  it("el prompt no promete prioridad", () => {
    expect(FIXER_RULE).not.toMatch(/preferente/);
  });
});
