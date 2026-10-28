// Concierge PRO (reporte del dueño, 23-oct-2026):
//   "Estoy en CDMX y me dice 'agregar a tu viaje'. ¿Por qué?"
//   "Es demasiado texto para lo que pedí."
// Caso exacto: usuario en Huixquilucan, viaje Roma → Florencia → Venecia que empieza hoy (22 oct),
// pide "Cena cerca" → recomendaciones locales cortas, sin "Agregar a tu viaje", y el viaje "por salir".
import { describe, it, expect } from "vitest";
import {
  itineraryActionScope, tripPhase, tripPhaseLabel, tripSituation, userTripPosition, situationLine, tripDestinationPoints, userAskedToAddToTrip,
} from "../../supabase/functions/concierge-chat/location";
import { compactReply, countLines, dropUnaskedFlightAdvice, REPLY_LIMITS } from "../../supabase/functions/concierge-chat/brevity";
import { detectIntents, planTurn, leadSentence } from "../../supabase/functions/concierge-chat/planner";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import { DEFAULT_MODEL_CONFIG, CircuitBreaker, routeTurn } from "../../supabase/functions/concierge-chat/router";
import type { ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { buildContextMessage, buildDynamicSystem, buildStableSystem, EXIGENTE_LINE, NORMAL_LINE, SYSTEM, GAP_RULES, tripResolutionLine } from "../../supabase/functions/concierge-chat/prompt";
import { compactTripForPrompt, tripBookingContext } from "../../supabase/functions/concierge-chat/context";
import { todayLine } from "../../supabase/functions/concierge-chat/tools";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { DATA_SENTINEL } from "../../supabase/functions/concierge-chat/stream";
import { resolveActiveTrip } from "../../supabase/functions/_shared/activeTrip";
import { buildChips } from "@/lib/conciergeChips";
import { gradeReply } from "../../scripts/concierge/rubric.mjs";
import {
  CENA_CERCA, HOY, HUIXQUILUCAN, LUGAR, LUGARES_LOCALES, LUGARES_ROMA, ROMA_CENTRO, VIAJE, VIAJE_CON_VUELO_HOY, respuestaLargaDelModelo,
} from "./fixtures/conciergeHuixquilucan";

const MANANA = "2026-10-23";

// ═══ Turno completo (mismo código que producción: turn.ts) con modelo y herramientas simulados ═══
async function turnoCenaCerca(p: { trip: any; coords: { lat: number; lng: number } | null; place: string | null; reply: (tripId: string) => string; exigente?: boolean; message?: string; tools?: Record<string, unknown> }) {
  const message = p.message ?? CENA_CERCA;
  const tagged = tripBookingContext(p.trip, []);
  const trip = { ...p.trip, vuelos: tagged.vuelos, hospedaje: tagged.hospedaje };
  const resolution = resolveActiveTrip([p.trip], { todayLocal: HOY, mentionedText: message });
  const situation = tripSituation(p.trip, HOY, { coords: p.coords, place: p.place });
  const intents = detectIntents(message, "dining_near_hotel");
  const plan = planTurn({ message, intents, trip, todayISO: HOY, coords: p.coords, hasPriveSession: false, exigente: !!p.exigente, position: situation?.position, place: p.place });
  const executed: { name: string; args: Record<string, unknown> }[] = [];
  const tools: Record<string, unknown> = { search_nearby: LUGARES_LOCALES, search_places: LUGARES_LOCALES, search_attractions: { ok: true, source: "tripadvisor", results: [] }, ...p.tools };
  const dynamicSystem = buildDynamicSystem({ todayLine: todayLine(HOY), tripReason: resolution.reason, hasTrip: true, godMode: !!p.exigente, toolHints: plan.toolHints, situation });
  const seenSystem: string[] = [];
  const caller: ModelCaller = async (step, input, h) => {
    seenSystem.push(input.dynamicSystem);
    const text = p.reply(p.trip.id);
    h.onText(text);
    return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
  const out = await runConciergeTurn({
    plan, route: routeTurn({ message, intents, exigente: !!p.exigente, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(),
    callModel: caller, execTool: async (name, args) => { executed.push({ name, args }); return tools[name] ?? { error: "sin_fixture" }; },
    toolTimeout: () => 5000, send: () => {}, meta: {}, stableSystem: buildStableSystem(""), dynamicSystem,
    contextMessage: buildContextMessage({ viajeEnContexto: compactTripForPrompt(trip, { todayISO: HOY, vuelos: trip.vuelos, hospedaje: trip.hospedaje }), notas: plan.notes }),
    history: [{ role: "user", content: message }], userMessage: message, exigente: !!p.exigente, hasAnthropicKey: true, hasLovableKey: false,
    actionCtx: { todayISO: HOY, trips: [{ id: p.trip.id, destino: p.trip.destino, fecha_salida: p.trip.fecha_salida, fecha_regreso: p.trip.fecha_regreso }], activeTripId: p.trip.id, hasPriveSession: false },
    tripScope: { trip: p.trip, position: situation?.position ?? "unknown", user: { coords: p.coords, place: p.place } },
    city: situation?.position === "away" ? p.place ?? undefined : "Roma", party: 2,
  });
  return { out, plan, situation, executed, seenSystem, resolution };
}

describe("caso Huixquilucan: 'Cena cerca' el día que sale a Roma → Florencia → Venecia", () => {
  it("el usuario está fuera de los destinos del viaje y el viaje está 'por salir' (no 'en curso en Roma')", () => {
    expect(tripDestinationPoints(VIAJE).map((p) => p.name)).toEqual(["Roma", "Florencia", "Venecia"]);
    expect(userTripPosition(VIAJE, { coords: HUIXQUILUCAN, place: LUGAR })).toBe("away");
    // Por fechas sigue siendo "en curso" (el selector usa resolveActiveTrip)...
    expect(resolveActiveTrip([VIAJE], { todayLocal: HOY }).reason).toBe("in_progress");
    // ...pero con la ubicación es "por salir" y la etiqueta dice "sale hoy".
    const s = tripSituation(VIAJE, HOY, { coords: HUIXQUILUCAN, place: LUGAR })!;
    expect(s).toMatchObject({ phase: "por_salir", position: "away", place: "Huixquilucan", firstDestination: "Roma" });
    expect(tripPhaseLabel(s.phase, VIAJE, HOY)).toBe("sale hoy");
    expect(situationLine(s)).toMatch(/por salir.*Huixquilucan.*todavía no está en Roma/);
  });

  it("el turno completo: recomendaciones locales cortas, sin 'Agregar a tu viaje' y con 'Guardar en favoritos'", async () => {
    const { out, plan, executed, seenSystem } = await turnoCenaCerca({ trip: VIAJE, coords: HUIXQUILUCAN, place: LUGAR, reply: respuestaLargaDelModelo });
    // Busca alrededor de donde está, no del hotel de Roma.
    expect(executed).toEqual([{ name: "search_nearby", args: { lat: HUIXQUILUCAN.lat, lng: HUIXQUILUCAN.lng, kind: "restaurant" } }]);
    expect(plan.suggestedActions.map((a) => a.type)).not.toContain("add_itinerary_item");
    expect(plan.notes.join(" ")).toMatch(/Huixquilucan, fuera de los destinos de su viaje/);
    expect(seenSystem[0]).toMatch(/ESTADO DEL VIAJE: por salir/);
    expect(seenSystem[0]).not.toMatch(/único viaje en curso hoy/);

    const reply = out.final;
    // Nada de "Agregar a tu viaje…" para un restaurante de CDMX.
    expect(reply.actions.map((a) => a.type)).not.toContain("add_itinerary_item");
    expect(reply.actions.some((a) => /Agregar a tu viaje/.test(a.summary))).toBe(false);
    expect(reply.dropped.actions).toContainEqual({ type: "add_itinerary_item", reason: "lugar_fuera_del_viaje" });
    // Guardar en favoritos sí tiene sentido (con los datos reales del lugar).
    const save = reply.actions.find((a) => a.type === "save_place")!;
    expect(save).toMatchObject({ summary: "Guardar La Mesa de Prueba en tus favoritos", confirm_label: "Guardar", runs: "server" });
    expect(save.params).toMatchObject({ nombre: "La Mesa de Prueba", maps_url: "https://maps.google.com/?cid=101", lat: 19.3986, lng: -99.2746 });
    // Respuesta corta, sin consejos que no pidió.
    expect(countLines(reply.text)).toBeLessThanOrEqual(4);
    expect(reply.text.length).toBeLessThanOrEqual(REPLY_LIMITS.normal.chars);
    expect(reply.text).not.toMatch(/check-in|aeropuerto|mariscos|Roma → Florencia/i);
    expect(reply.text).toMatch(/La Mesa de Prueba/);
    expect(reply.guards).toEqual(expect.arrayContaining(["agregar_al_viaje_fuera_de_destino", "respuesta_recortada"]));
    // Las cards son las locales, con enlaces de reserva por la ciudad donde está (no "Roma").
    const rest = reply.cards.filter((c) => c.type === "restaurant");
    expect(rest.map((c) => c.title)).toEqual(["La Mesa de Prueba", "Cocina Ejemplo", "Bistró Simulado"]);
    // Huixquilucan (México): OpenTable no cubre el lugar, así que no hay búsqueda de reservas (defecto 16);
    // ningún enlace apunta a "Roma" (la ciudad del viaje en contexto).
    expect(rest[0].links!.some((l) => l.kind === "booking")).toBe(false);
    expect(JSON.stringify(rest[0].links)).not.toMatch(/Roma/);
    expect(rest[0].links!.find((l) => l.kind === "maps")).toBeTruthy();
    expect(gradeReply(reply, { mustMention: ["La Mesa de Prueba", "Google Maps"], actionTypes: ["save_place"], maxLines: 4 }).fails).toEqual([]);
  });

  it("con un vuelo de hoy en el viaje: no consulta el vuelo ni deja 'haz check-in' cuando pidió una cena", async () => {
    const { out, plan, executed } = await turnoCenaCerca({ trip: VIAJE_CON_VUELO_HOY, coords: HUIXQUILUCAN, place: LUGAR, reply: respuestaLargaDelModelo });
    expect(executed.map((e) => e.name)).toEqual(["search_nearby"]);
    expect(plan.avoidTopics).toEqual(["vuelo"]);
    expect(plan.notes.join(" ")).toMatch(/No agregues consejos del vuelo/);
    expect(plan.notes.join(" ")).not.toMatch(/Regla general/);
    expect(out.final.text).not.toMatch(/check-in|tu vuelo/i);
  });

  it("los botones rápidos con el usuario fuera: 'Cena cerca' y 'Pedir transporte' son de donde está, no del hotel de Roma", () => {
    const hotelRoma = { ...VIAJE, hospedaje_json: [{ nombre: "Hotel Eden", ciudad: "Roma", estado_reserva: "reservado" }] };
    const away = Object.fromEntries(buildChips(hotelRoma, HOY, { away: true }).map((c) => [c.id, c]));
    expect(away.dining.text).toBe(CENA_CERCA);
    expect(away.transport.text).not.toMatch(/Hotel Eden/);
    const there = Object.fromEntries(buildChips(hotelRoma, HOY).map((c) => [c.id, c]));
    expect(there.dining.text).toMatch(/Hotel Eden/);
  });
});

describe("regla de 'Agregar a tu viaje'", () => {
  const params = (lugar: string) => ({ trip_id: VIAJE.id, fecha: HOY, hora: "20:30", titulo: `Cena en ${lugar}`, lugar });
  const local = LUGARES_LOCALES.places.map((p) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng }));
  const roma = LUGARES_ROMA.results.map((p) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng }));

  it("lugar en CDMX con el usuario en CDMX: no", () => {
    expect(itineraryActionScope({ trip: VIAJE, params: params("La Mesa de Prueba"), places: local, position: "away", userMessage: CENA_CERCA }))
      .toMatchObject({ keep: false, why: "lugar_fuera_del_viaje" });
  });
  it("lugar en Roma (coordenadas): sí, aunque el usuario todavía esté en CDMX (planea una cena del viaje)", () => {
    expect(itineraryActionScope({ trip: VIAJE, params: params("Trattoria de Prueba"), places: roma, position: "away", userMessage: "¿dónde ceno en Roma el sábado?" }))
      .toMatchObject({ keep: true, why: "lugar_en_destino" });
  });
  it("lugar sin coordenadas: decide la dirección; sin lugar identificable y el usuario fuera, no", () => {
    const sinCoords = [{ name: "Osteria Ejemplo", address: "Via Ejemplo 3, Firenze, Italia" }];
    expect(itineraryActionScope({ trip: VIAJE, params: params("Osteria Ejemplo"), places: sinCoords, position: "away", userMessage: "" })).toMatchObject({ keep: true, why: "direccion_en_destino" });
    expect(itineraryActionScope({ trip: VIAJE, params: { titulo: "Cena", fecha: HOY }, places: [], position: "away", userMessage: CENA_CERCA })).toMatchObject({ keep: false, why: "usuario_fuera_del_viaje" });
    // Sin saber dónde está (sin permiso de ubicación), como antes: se ofrece.
    expect(itineraryActionScope({ trip: VIAJE, params: { titulo: "Cena", fecha: HOY }, places: [], position: "unknown", userMessage: CENA_CERCA }).keep).toBe(true);
  });
  it("si el usuario lo pide, sí", () => {
    expect(userAskedToAddToTrip("agrégalo a mi viaje")).toBe(true);
    expect(userAskedToAddToTrip("ponlo en el itinerario del sábado")).toBe(true);
    expect(userAskedToAddToTrip("cena cerca")).toBe(false);
    expect(itineraryActionScope({ trip: VIAJE, params: params("La Mesa de Prueba"), places: local, position: "away", userMessage: "agrega La Mesa de Prueba a mi viaje" }))
      .toMatchObject({ keep: true, why: "lo_pidio" });
  });
  it("en Roma, cena cerca del hotel: el planeador sí ofrece agregarla y finalize la conserva", async () => {
    const { out, plan, situation } = await turnoCenaCerca({
      trip: VIAJE, coords: ROMA_CENTRO, place: "Roma", tools: { search_nearby: LUGARES_ROMA },
      reply: (id) => `En Roma, abierta ahora según Google Maps: **Trattoria de Prueba** (★4.7).\n${DATA_SENTINEL}\n${JSON.stringify({
        cards: [{ type: "restaurant", title: "Trattoria de Prueba", subtitle: "Via di Prova 12, Roma", rating: 4.7 }],
        actions: [{ type: "add_itinerary_item", params: { trip_id: id, fecha: HOY, hora: "20:30", titulo: "Cena en Trattoria de Prueba", lugar: "Trattoria de Prueba" } }],
      })}`,
    });
    expect(situation).toMatchObject({ position: "at_destination", phase: "en_curso" });
    expect(plan.suggestedActions.map((a) => a.type)).toContain("add_itinerary_item");
    expect(out.final.actions[0]).toMatchObject({ type: "add_itinerary_item", summary: expect.stringMatching(/^Agregar a tu viaje a Roma → Florencia → Venecia: Cena en Trattoria de Prueba/) });
    expect(out.final.actions.map((a) => a.type)).not.toContain("save_place");
  });
  it("finalize: otro viaje del usuario (sin hoteles) también se revisa con su destino", () => {
    const TOKIO = { id: "aaaaaaaa-0000-4000-8000-0000000000aa", destino: "Tokio", fecha_salida: "2027-03-20", fecha_regreso: "2027-03-30" };
    const raw = `Opciones cerca.\n${DATA_SENTINEL}\n${JSON.stringify({ actions: [{ type: "add_itinerary_item", params: { trip_id: TOKIO.id, fecha: "2027-03-21", titulo: "Cena en La Mesa de Prueba", lugar: "La Mesa de Prueba" } }] })}`;
    const f = finalizeTurn({
      raw, toolRuns: [{ name: "search_nearby", args: {}, result: LUGARES_LOCALES as any }], plan: { cards: [], suggestedActions: [] },
      actionCtx: { todayISO: HOY, trips: [TOKIO], activeTripId: null }, userMessage: CENA_CERCA,
      tripScope: { trip: null, position: "unknown", user: { coords: HUIXQUILUCAN, place: LUGAR } }, makeId: () => "a1",
    });
    expect(f.actions.map((a) => a.type)).toEqual(["save_place"]);
  });
});

describe("fase del viaje: en curso vs. por salir", () => {
  it("día de salida en casa = por salir; en Roma = en curso; sin ubicación = en curso (como antes)", () => {
    expect(tripPhase(VIAJE, HOY, "away")).toBe("por_salir");
    expect(tripPhase(VIAJE, HOY, "at_destination")).toBe("en_curso");
    expect(tripPhase(VIAJE, HOY, "unknown")).toBe("en_curso");
  });
  it("al día siguiente (vuelo de noche, aún en tránsito o en casa) sigue 'por salir'; después, 'en curso'", () => {
    expect(tripPhase(VIAJE, MANANA, "away")).toBe("por_salir");
    expect(tripPhaseLabel("por_salir", VIAJE, MANANA)).toBe("por salir");
    expect(tripPhase(VIAJE, "2026-10-25", "away")).toBe("en_curso");
  });
  it("próximo, terminado y sin fechas", () => {
    expect(tripPhase(VIAJE, "2026-10-20", "away")).toBe("proximo");
    expect(tripPhaseLabel("proximo", VIAJE, "2026-10-21")).toBe("sale mañana");
    expect(tripPhase(VIAJE, "2026-11-02", "unknown")).toBe("terminado");
    expect(tripPhase({ id: "x", destino: "Roma" }, HOY, "away")).toBe("sin_fechas");
  });
  it("sin coordenadas, por el nombre del lugar: 'Ciudad de México' = fuera; 'Florencia' = en el viaje; desconocido = no se sabe", () => {
    expect(userTripPosition(VIAJE, { place: "Ciudad de México" })).toBe("away");
    expect(userTripPosition(VIAJE, { place: "Florencia" })).toBe("at_destination");
    expect(userTripPosition(VIAJE, { place: "Firenze" })).toBe("at_destination");
    expect(userTripPosition(VIAJE, { place: "Huixquilucan" })).toBe("unknown");
    expect(userTripPosition(VIAJE, { coords: { lat: 43.7696, lng: 11.2558 } })).toBe("at_destination"); // Florencia centro
  });
  it("el sistema dice 'aún no sale' en vez de 'el único viaje en curso hoy'", () => {
    const s = tripSituation(VIAJE, HOY, { coords: HUIXQUILUCAN, place: LUGAR });
    const line = tripResolutionLine("in_progress", true, s);
    expect(line).toMatch(/empieza hoy; aún no sale/);
    expect(line).not.toMatch(/único viaje en curso hoy/);
    expect(tripResolutionLine("in_progress", true, tripSituation(VIAJE, HOY, { coords: ROMA_CENTRO }))).toMatch(/único viaje en curso hoy/);
    // Sin ubicación no se agrega nada (mismo texto que antes).
    expect(tripResolutionLine("in_progress", true, tripSituation(VIAJE, HOY, null))).toBe("VIAJE EN CONTEXTO: el de <viaje_en_contexto> (es el único viaje en curso hoy).");
  });
});

describe("respuestas cortas (prompt y post-proceso)", () => {
  it("el prompt pide 2 a 4 líneas, solo lo que pidió y sin consejos no pedidos; exigente más profundo pero conciso", () => {
    expect(SYSTEM).toMatch(/Breve por defecto: 2 a 4 líneas/);
    expect(SYSTEM).toMatch(/Responde SOLO lo que pidió/);
    expect(SYSTEM).toMatch(/No agregues consejos que no pidió \(check-in/);
    expect(SYSTEM).toMatch(/Si quiere más detalle, te lo pide/);
    expect(SYSTEM).toMatch(/add_itinerary_item solo para lugares en una ciudad del viaje, o si el usuario pide agregarlo/);
    expect(NORMAL_LINE).toMatch(/2–4 líneas/);
    expect(EXIGENTE_LINE).toMatch(/Conciso: hasta 8–10 líneas/);
    expect(SYSTEM).toMatch(/hasta 8–10 líneas en total/);
    expect(SYSTEM).not.toMatch(/Puedes usar 6–12 líneas/);
    expect(GAP_RULES).toMatch(/SOLO si tiene que ver con lo que preguntó/);
    // La honestidad y las fuentes siguen intactas.
    expect(SYSTEM).toMatch(/HONESTIDAD \(no negociable\)/);
    expect(SYSTEM).toMatch(/Cita la fuente en corto/);
    expect(SYSTEM).toMatch(/Aún no está reservado/);
  });
  it("recorta por líneas completas al tope del modo (normal 6 líneas/520 caracteres; exigente 10/1100)", () => {
    const long = Array.from({ length: 12 }, (_, i) => `- Opción ${i + 1}: un lugar con su porqué, según Google Maps.`).join("\n");
    const n = compactReply(long);
    expect(n.trimmed).toBe(true);
    expect(countLines(n.text)).toBe(6);
    expect(n.text.endsWith("según Google Maps.")).toBe(true);
    const x = compactReply(long, { exigente: true });
    expect(countLines(x.text)).toBe(10);
    // Lo corto no se toca.
    expect(compactReply("Dos opciones:\n- A\n- B")).toEqual({ text: "Dos opciones:\n- A\n- B", trimmed: false });
  });
  it("un solo párrafo enorme se corta en oraciones completas, nunca a la mitad de una", () => {
    const s = "Primera oración con su fuente, según Google Maps. ".repeat(30).trim();
    const r = compactReply(s);
    expect(r.text.length).toBeLessThanOrEqual(REPLY_LIMITS.normal.chars);
    expect(r.text.endsWith("según Google Maps.")).toBe(true);
  });
  it("quita el consejo de check-in cuando pidió una cena, pero no si preguntó por el vuelo", () => {
    const t = "Te recomiendo **La Mesa de Prueba** (★4.6), según Google Maps. Recuerda que tu vuelo sale hoy: haz check-in en línea.\n- Llega al aeropuerto 3 horas antes.";
    expect(dropUnaskedFlightAdvice(t, CENA_CERCA)).toBe("Te recomiendo **La Mesa de Prueba** (★4.6), según Google Maps.");
    expect(dropUnaskedFlightAdvice(t, "¿a qué hora salgo al aeropuerto?")).toBe(t);
  });
  it("las etiquetas de honestidad se aplican sobre el texto ya recortado (no se pierden)", () => {
    const raw = ["Listo, reservé tu mesa en La Mesa de Prueba.", ...Array.from({ length: 8 }, (_, i) => `Línea extra ${i}.`)].join("\n");
    const f = finalizeTurn({ raw, toolRuns: [], plan: { cards: [], suggestedActions: [] }, actionCtx: { todayISO: HOY, trips: [], activeTripId: null }, userMessage: CENA_CERCA });
    expect(f.text).toMatch(/Aún no está reservado/);
    expect(f.guards).toEqual(expect.arrayContaining(["respuesta_recortada", "sin_reserva_falsa"]));
  });
  it("la frase de inicio de una búsqueda local no dice 'cerca de tu hotel'", () => {
    const tagged = tripBookingContext(VIAJE, []);
    const p = planTurn({ message: CENA_CERCA, intents: detectIntents(CENA_CERCA, "dining_near_hotel"), trip: { ...VIAJE, vuelos: tagged.vuelos, hospedaje: tagged.hospedaje }, todayISO: HOY, coords: null, hasPriveSession: false, exigente: false, position: "away", place: "Ciudad de México" });
    expect(p.prefetch).toEqual([expect.objectContaining({ name: "search_places", args: { query: "restaurantes en Ciudad de México" } })]);
    expect(leadSentence(p)).toBe("Busco restaurantes cerca de ti en Google Maps.");
  });
});
