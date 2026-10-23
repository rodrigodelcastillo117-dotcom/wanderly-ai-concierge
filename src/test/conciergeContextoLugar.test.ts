// Regresión del bug real Interlomas → India (23-oct-2026): ubicación física, viaje seleccionado,
// destino pedido y viaje futuro van por separado, y la etiqueta de la respuesta dice el lugar real.
// Mismo camino que producción (index.ts): resolveTurnPlace → tripSituation → planTurn → turn.ts.
import { describe, it, expect } from "vitest";
import { answerPlaceLabel, asksNearMe, requestedDestination, resolveTurnPlace, turnPlaceNote } from "../../supabase/functions/concierge-chat/turnPlace";
import { tripSituation } from "../../supabase/functions/concierge-chat/location";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import { DEFAULT_MODEL_CONFIG, CircuitBreaker, routeTurn } from "../../supabase/functions/concierge-chat/router";
import type { ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { buildContextMessage, buildDynamicSystem, buildStableSystem } from "../../supabase/functions/concierge-chat/prompt";
import { compactTripForPrompt } from "../../supabase/functions/concierge-chat/context";
import { todayLine } from "../../supabase/functions/concierge-chat/tools";
import { HOY, INTERLOMAS, LUGAR, LUGARES_DELHI, LUGARES_INTERLOMAS, VIAJE_INDIA, VIAJE_ROMA, respuestaLocal } from "./fixtures/conciergeInterlomasIndia";

type User = { coords: { lat: number; lng: number } | null; place: string | null } | null;

/** Lo mismo que hace index.ts para armar el contexto del turno. */
function contexto(p: { message: string; trips: any[]; user: User; pinnedId?: string | null; explicitId?: string | null }) {
  const userLoc = p.user ?? { coords: null, place: null };
  const first = resolveTurnPlace({ message: p.message, trips: p.trips, pinnedId: p.pinnedId ?? null, explicitId: p.explicitId ?? null, todayISO: HOY, user: userLoc });
  const trip = first.resolution.trip;
  const situation = tripSituation(trip, HOY, userLoc);
  const tp = situation?.position === "away"
    ? resolveTurnPlace({ message: p.message, trips: p.trips, pinnedId: p.pinnedId ?? null, explicitId: p.explicitId ?? null, todayISO: HOY, user: userLoc, position: "away" })
    : first;
  const intents = detectIntents(p.message);
  const plan = planTurn({
    message: p.message, intents, trip, todayISO: HOY, coords: userLoc.coords, hasPriveSession: false, exigente: false,
    position: situation?.position ?? "unknown", place: userLoc.place, requested: tp.requested, nearMe: tp.nearMe,
  });
  plan.notes.push(turnPlaceNote(tp));
  const meta = { _trip_id: trip?.id ?? null, _user_position: situation?.position ?? "unknown", _place_scope: tp.scope, _place_label: tp.label };
  // Lo que hace la pantalla del Concierge con la respuesta (Concierge.tsx → answerPlaceLabel).
  const label = answerPlaceLabel({ tripId: meta._trip_id, local: meta._user_position === "away", placeScope: meta._place_scope, placeLabel: meta._place_label }, p.trips);
  return { tp, trip, situation, intents, plan, meta, label };
}

const allText = (plan: { notes: string[]; prefetch: { args: Record<string, unknown> }[] }) =>
  [...plan.notes, ...plan.prefetch.map((x) => JSON.stringify(x.args))].join(" ");

describe("caso 1: 'restaurantes cercanos' en Interlomas con un viaje FUTURO a India", () => {
  const msg = "Restaurantes cercanos";

  it("separa ubicación física, viaje seleccionado y viaje futuro", () => {
    const { tp, situation } = contexto({ message: msg, trips: [VIAJE_INDIA], user: { coords: INTERLOMAS, place: LUGAR } });
    expect(tp.physical).toEqual({ coords: INTERLOMAS, place: "Interlomas" });
    expect(tp.selectedTrip?.id).toBe(VIAJE_INDIA.id);
    expect(tp.futureTrip?.id).toBe(VIAJE_INDIA.id);
    expect(tp.requested).toBeNull();
    expect(tp.nearMe).toBe(true);
    expect(tp.scope).toBe("here");
    expect(tp.label).toBe("Interlomas");
    expect(situation?.position).toBe("away");
  });

  it("busca alrededor de Interlomas, nunca del hotel de India, y no propone agregarlo al viaje", () => {
    const { plan } = contexto({ message: msg, trips: [VIAJE_INDIA], user: { coords: INTERLOMAS, place: LUGAR } });
    expect(plan.prefetch).toEqual([{ name: "search_nearby", args: { lat: INTERLOMAS.lat, lng: INTERLOMAS.lng, kind: "restaurant" }, reason: "restaurantes cerca" }]);
    expect(allText(plan)).not.toMatch(/Hotel de Prueba Delhi|restaurantes (en|cerca de) .*(India|Delhi)/);
    expect(plan.suggestedActions.map((a) => a.type)).not.toContain("add_itinerary_item");
    expect(plan.notes.join(" ")).toMatch(/UBICACIÓN FÍSICA: Interlomas/);
    expect(plan.notes.join(" ")).toMatch(/VIAJE SELECCIONADO: India, empieza el 2026-12-05; es futuro: el usuario NO está ahí/);
  });

  it("la etiqueta de la respuesta es Interlomas, no India", () => {
    const { label, meta } = contexto({ message: msg, trips: [VIAJE_INDIA], user: { coords: INTERLOMAS, place: LUGAR } });
    expect(meta._place_scope).toBe("here");
    expect(label).toBe("cerca de ti, Interlomas");
    expect(label).not.toMatch(/India/);
  });

  it("al corregir ('no, cerca de mí, estoy en Interlomas') sigue siendo Interlomas en la etiqueta", () => {
    const { label, plan, tp } = contexto({ message: "No, quiero restaurantes cerca de mí, estoy en Interlomas", trips: [VIAJE_INDIA], user: { coords: INTERLOMAS, place: LUGAR } });
    expect(tp.selectedTrip?.id).toBe(VIAJE_INDIA.id);
    expect(label).toMatch(/Interlomas/);
    expect(label).not.toMatch(/India/);
    expect(label).toBe("cerca de ti, Interlomas");
    expect(plan.prefetch).toEqual([{ name: "search_nearby", args: { lat: INTERLOMAS.lat, lng: INTERLOMAS.lng, kind: "restaurant" }, reason: "restaurantes cerca" }]);
    expect(allText(plan)).not.toMatch(/Hotel de Prueba Delhi/);
  });

  it("el turno completo: herramienta local, cards con coordenadas y sin 'Agregar a tu viaje' a India", async () => {
    const { plan, trip, situation, intents, meta } = contexto({ message: msg, trips: [VIAJE_INDIA], user: { coords: INTERLOMAS, place: LUGAR } });
    const executed: string[] = [];
    const caller: ModelCaller = async (step, _input, h) => {
      const text = respuestaLocal(VIAJE_INDIA.id);
      h.onText(text);
      return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    };
    const out = await runConciergeTurn({
      plan, route: routeTurn({ message: msg, intents, exigente: false, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(),
      callModel: caller, execTool: async (name, args) => { executed.push(`${name}:${JSON.stringify(args)}`); return name === "search_nearby" ? LUGARES_INTERLOMAS : { error: "sin_fixture" }; },
      toolTimeout: () => 5000, send: () => {}, meta, stableSystem: buildStableSystem(""),
      dynamicSystem: buildDynamicSystem({ todayLine: todayLine(HOY), tripReason: "single_upcoming", hasTrip: true, godMode: false, toolHints: plan.toolHints, situation }),
      contextMessage: buildContextMessage({ viajeEnContexto: compactTripForPrompt(trip, { todayISO: HOY }), notas: plan.notes }),
      history: [{ role: "user", content: msg }], userMessage: msg, exigente: false, hasAnthropicKey: true, hasLovableKey: false,
      actionCtx: { todayISO: HOY, trips: [{ id: VIAJE_INDIA.id, destino: VIAJE_INDIA.destino, fecha_salida: VIAJE_INDIA.fecha_salida, fecha_regreso: VIAJE_INDIA.fecha_regreso }], activeTripId: VIAJE_INDIA.id, hasPriveSession: false },
      tripScope: { trip, position: situation?.position ?? "unknown", user: { coords: INTERLOMAS, place: LUGAR } },
      city: "Interlomas", party: 2,
    });
    expect(executed).toEqual([`search_nearby:${JSON.stringify({ lat: INTERLOMAS.lat, lng: INTERLOMAS.lng, kind: "restaurant" })}`]);
    expect(out.final.actions.map((a) => a.type)).not.toContain("add_itinerary_item");
    const card = out.final.cards.find((c) => c.title === "Bistró Ejemplo")!;
    expect(card).toMatchObject({ place_id: "ChIJPruebaInterlomas0002", lat: 19.3975, lng: -99.2731 });
  });
});

describe("caso 2: destino explícito ('restaurantes en Nueva Delhi')", () => {
  const msg = "Restaurantes en Nueva Delhi";

  it("busca en Delhi SIN cambiar el viaje activo (Roma fijado)", () => {
    const { tp, trip, plan, label } = contexto({ message: msg, trips: [VIAJE_ROMA, VIAJE_INDIA], pinnedId: VIAJE_ROMA.id, user: { coords: INTERLOMAS, place: LUGAR } });
    expect(tp.requested).toBe("Delhi");
    expect(tp.scope).toBe("requested");
    expect(trip?.id).toBe(VIAJE_ROMA.id);
    expect(tp.resolution.reason).toBe("pinned");
    expect(plan.prefetch).toEqual([{ name: "search_places", args: { query: "restaurantes en Delhi" }, reason: "restaurantes en el destino pedido" }]);
    expect(plan.notes.join(" ")).toMatch(/DESTINO PEDIDO: Delhi \(no cambia su viaje seleccionado\)/);
    expect(label).toBe("en Delhi");
  });

  it("con el viaje a India como único viaje: también busca en Delhi y la etiqueta es Delhi", () => {
    const { tp, plan, label } = contexto({ message: "Restaurantes en Delhi", trips: [VIAJE_INDIA], user: null });
    expect(tp.selectedTrip?.id).toBe(VIAJE_INDIA.id);
    expect(tp.physical).toBeNull();
    expect(plan.prefetch[0]).toMatchObject({ name: "search_places", args: { query: "restaurantes en Delhi" } });
    expect(label).toBe("en Delhi");
    expect(LUGARES_DELHI.results[0].address).toMatch(/Delhi/);
  });

  it("una pregunta SOBRE el viaje sigue eligiendo el viaje por mención y se etiqueta con él", () => {
    const { trip, label, tp } = contexto({ message: "¿Qué llevo para mi viaje a India?", trips: [VIAJE_ROMA, VIAJE_INDIA], pinnedId: VIAJE_ROMA.id, user: null });
    expect(trip?.id).toBe(VIAJE_INDIA.id);
    expect(tp.scope).toBe("trip");
    expect(label).toBe("sobre India");
  });
});

describe("caso 3: sin ubicación ('restaurantes cercanos' sin permiso de ubicación)", () => {
  it("no usa el viaje futuro como ubicación: pregunta la zona y no etiqueta India", () => {
    const { tp, plan, label, situation } = contexto({ message: "Restaurantes cercanos", trips: [VIAJE_INDIA], user: null });
    expect(tp.physical).toBeNull();
    expect(tp.scope).toBe("here");
    expect(tp.label).toBeNull();
    expect(situation?.position).toBe("away");
    expect(plan.prefetch).toEqual([]);
    expect(plan.notes.join(" ")).toMatch(/No hay ubicación actual del usuario/);
    expect(plan.notes.join(" ")).toMatch(/UBICACIÓN FÍSICA: desconocida/);
    expect(allText(plan)).not.toMatch(/Hotel de Prueba Delhi/);
    expect(label).toBeNull();
  });
});

describe("piezas", () => {
  it("cerca de mí / aquí / cercanos sí; cerca de mi hotel no", () => {
    for (const m of ["restaurantes cerca de mí", "¿qué hay aquí?", "cafés cercanos", "algo por aquí"]) expect(asksNearMe(m)).toBe(true);
    expect(asksNearMe("cena cerca de mi hotel")).toBe(false);
    expect(asksNearMe("restaurantes en Delhi")).toBe(false);
  });

  it("destino pedido: ciudad o país conocido, o nombre propio tras 'en'", () => {
    expect(requestedDestination("Restaurantes en Delhi")).toBe("Delhi");
    expect(requestedDestination("restaurantes en nueva delhi")).toBe("Delhi");
    expect(requestedDestination("¿qué hacer en India?")).toBe("India");
    expect(requestedDestination("Tacos en Interlomas")).toBe("Interlomas");
    expect(requestedDestination("restaurantes cerca de mí")).toBeNull();
    expect(requestedDestination("búscalo en Google Maps")).toBeNull();
  });

  it("etiquetas: respuestas viejas sin alcance se comportan como antes", () => {
    const trips = [{ id: "a", destino: "India" }];
    expect(answerPlaceLabel({ tripId: "a" }, trips)).toBe("sobre India");
    expect(answerPlaceLabel({ tripId: "a", local: true }, trips)).toBeNull();
    expect(answerPlaceLabel({ tripId: "a", placeScope: "here", placeLabel: "Tu ubicación" }, trips)).toBe("cerca de ti");
    expect(answerPlaceLabel({ tripId: "a", placeScope: "none" }, trips)).toBeNull();
  });
});
