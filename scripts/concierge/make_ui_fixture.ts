// Fixture para las capturas del Concierge estilo WhatsApp (SOLO PRUEBAS, sin red ni modelo real).
// Corre el MISMO turno que producción (turn.ts: planeador → herramientas → modelo → finalize) con el
// caso Huixquilucan: herramientas simuladas y el texto largo que dio el modelo en producción. Lo que
// sale (texto recortado, cards locales, "Guardar en favoritos" en vez de "Agregar a tu viaje") es lo
// que dibuja la pantalla en las capturas.
//
// Uso: npx vite-node scripts/concierge/make_ui_fixture.ts <salida.json>
import { writeFileSync } from "node:fs";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import { DEFAULT_MODEL_CONFIG, CircuitBreaker, routeTurn } from "../../supabase/functions/concierge-chat/router";
import { buildContextMessage, buildDynamicSystem, buildStableSystem } from "../../supabase/functions/concierge-chat/prompt";
import { compactTripForPrompt, tripBookingContext } from "../../supabase/functions/concierge-chat/context";
import { todayLine } from "../../supabase/functions/concierge-chat/tools";
import { tripSituation } from "../../supabase/functions/concierge-chat/location";
import { resolveActiveTrip } from "../../supabase/functions/_shared/activeTrip";
import { CENA_CERCA, HOY, HUIXQUILUCAN, LUGAR, LUGARES_LOCALES, VIAJE, respuestaLargaDelModelo } from "../../src/test/fixtures/conciergeHuixquilucan";

const out = process.argv[2] ?? "/tmp/concierge_ui_fixture.json";
const tagged = tripBookingContext(VIAJE, []);
const trip = { ...VIAJE, vuelos: tagged.vuelos, hospedaje: tagged.hospedaje };
const resolution = resolveActiveTrip([VIAJE], { todayLocal: HOY, mentionedText: CENA_CERCA });
const situation = tripSituation(VIAJE, HOY, { coords: HUIXQUILUCAN, place: LUGAR });
const intents = detectIntents(CENA_CERCA, "dining_near_hotel");
const plan = planTurn({ message: CENA_CERCA, intents, trip, todayISO: HOY, coords: HUIXQUILUCAN, hasPriveSession: false, exigente: false, position: situation?.position, place: LUGAR });
const r = await runConciergeTurn({
  plan, route: routeTurn({ message: CENA_CERCA, intents, exigente: false, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(),
  callModel: async (step, _input, h) => {
    const text = respuestaLargaDelModelo(VIAJE.id);
    h.onText(text);
    return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  },
  execTool: async (name) => (name === "search_nearby" ? LUGARES_LOCALES : { error: "sin_fixture" }),
  toolTimeout: () => 5000, send: () => {}, meta: {}, stableSystem: buildStableSystem(""),
  dynamicSystem: buildDynamicSystem({ todayLine: todayLine(HOY), tripReason: resolution.reason, hasTrip: true, toolHints: plan.toolHints, situation }),
  contextMessage: buildContextMessage({ viajeEnContexto: compactTripForPrompt(trip, { todayISO: HOY, vuelos: trip.vuelos, hospedaje: trip.hospedaje }), notas: plan.notes }),
  history: [{ role: "user", content: CENA_CERCA }], userMessage: CENA_CERCA, exigente: false, hasAnthropicKey: true, hasLovableKey: false,
  actionCtx: { todayISO: HOY, trips: [{ id: VIAJE.id, destino: VIAJE.destino, fecha_salida: VIAJE.fecha_salida, fecha_regreso: VIAJE.fecha_regreso }], activeTripId: VIAJE.id, hasPriveSession: false },
  tripScope: { trip: VIAJE, position: situation?.position ?? "unknown", user: { coords: HUIXQUILUCAN, place: LUGAR } },
  city: LUGAR, party: 2,
});
const reply = {
  text: r.final.text, cards: r.final.cards, actions: r.final.actions,
  _trip_id: VIAJE.id, _trip_reason: resolution.reason, _trip_phase: situation?.phase, _user_position: situation?.position, _today: HOY, _tools_used: plan.prefetch.map((p) => p.name), _gaps: [],
};
writeFileSync(out, JSON.stringify({ trip: VIAJE, reply, guards: r.final.guards, dropped: r.final.dropped }, null, 2));
console.log(out, "guards:", r.final.guards.join(","), "actions:", r.final.actions.map((a) => a.summary).join(" | "));
