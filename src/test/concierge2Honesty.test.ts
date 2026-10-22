// Concierge 2.0 — honestidad. Incluye el caso real de producción (la Centurion de la T1).
import { describe, it, expect } from "vitest";
import {
  correctFailureClaims, enforceNoFakeBooking, labelUnverifiedFacts, NOT_BOOKED_LINE, UNVERIFIED_PREFIX,
} from "../../supabase/functions/concierge-chat/guard";
import { collectEvidence, enforceAvailabilityHonesty, enrichCardLinks, matchPlace, prepareToolResultForModel, validateCards } from "../../supabase/functions/concierge-chat/cards";
import { applyToolPolicy, detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { DATA_SENTINEL } from "../../supabase/functions/concierge-chat/stream";

// Transcript del dueño (producción, 22 oct 2026).
const CENTURION_Q = "dónde está la centurion dentro de la T1 DE CDMX";
const CENTURION_A = "La búsqueda en vivo de lugares no está disponible en este momento, así que no te muestro opciones como si fueran reales. " +
  "En la Terminal 1 del AICM hay dos salas Centurion; la principal está en la zona internacional, entre las puertas 8 y 11, después del filtro de seguridad.";
const TA_EMPTY = { ok: true, source: "tripadvisor", results: [] };

describe("caso Centurion (producción)", () => {
  it("la pregunta es un dato práctico: se consulta web_search + Google Maps antes del modelo, nunca TripAdvisor", () => {
    const intents = detectIntents(CENTURION_Q);
    expect(intents).toContain("place_fact");
    const plan = planTurn({ message: CENTURION_Q, intents, trip: null, todayISO: "2026-10-22", coords: null, hasPriveSession: false, exigente: false });
    expect(plan.prefetch.map((p) => p.name)).toEqual(["web_search", "search_places"]);
    expect(plan.prefetch.map((p) => p.name)).not.toContain("search_attractions");
    expect(String(plan.prefetch[0].args.query)).toMatch(/centurion/i);
    expect(String(plan.prefetch[0].args.query)).toMatch(/T1/i);
  });
  it("si el modelo pide TripAdvisor para eso, se redirige a web_search", () => {
    const r = applyToolPolicy("search_attractions", { query: "Centurion lounge T1 CDMX" }, CENTURION_Q);
    expect(r).toMatchObject({ name: "web_search", rerouted: "search_attractions→web_search" });
    // Para recomendaciones de restaurantes TripAdvisor sigue sirviendo.
    expect(applyToolPolicy("search_attractions", { query: "mejores restaurantes Roma Norte" }, "recomiéndame restaurantes en la Roma").name).toBe("search_attractions");
  });
  it("la respuesta original se corrige: 'no encontró resultados' (no 'no disponible') y los datos exactos se marcan sin verificar", () => {
    const runs = [{ name: "search_attractions", args: { query: "centurion" }, result: prepareToolResultForModel("search_attractions", TA_EMPTY) }];
    const ev = collectEvidence(runs);
    expect(ev.unavailableState).toEqual({ search_attractions: "sin_resultados" });
    const fixed = correctFailureClaims(CENTURION_A, ev.unavailableState);
    expect(fixed).not.toMatch(/no está disponible/);
    expect(fixed).toMatch(/La búsqueda de lugares no encontró resultados/);
    const labelled = labelUnverifiedFacts(fixed, ev.available);
    expect(labelled.startsWith(UNVERIFIED_PREFIX)).toBe(true);
    expect(labelled).toMatch(/puertas 8 y 11/); // el dato queda, pero marcado
  });
  it("turno completo con el transcript: honestidad aplicada de punta a punta", () => {
    const runs = [{ name: "search_attractions", args: { query: "centurion" }, result: prepareToolResultForModel("search_attractions", TA_EMPTY) }];
    const out = finalizeTurn({
      raw: CENTURION_A, toolRuns: runs, plan: { cards: [], suggestedActions: [] },
      actionCtx: { todayISO: "2026-10-22", trips: [], activeTripId: null },
    });
    expect(out.text).toMatch(/^Según información general, sin verificar en vivo:/);
    expect(out.text).not.toMatch(/no está disponible/);
    expect(out.guards).toEqual(expect.arrayContaining(["motivo_corregido", "sin_verificar"]));
  });
  it("con web_search de este turno el dato tiene fuente y NO se etiqueta", () => {
    const runs = [{ name: "web_search", args: { query: "centurion" }, result: prepareToolResultForModel("web_search", {
      ok: true, source: "google_web", results: [{ title: "Centurion MEX", snippet: "Terminal 1, puerta 8", link: "https://www.americanexpress.com/x", source: "American Express" }],
    }) }];
    const text = "Según American Express, la Centurion de la T1 está después del filtro, cerca de la puerta 8.";
    expect(labelUnverifiedFacts(text, collectEvidence(runs).available)).toBe(text);
  });
});

describe("motivo exacto de cada falla", () => {
  const ev = (raw: unknown, name = "search_flights") => collectEvidence([{ name, result: prepareToolResultForModel(name, raw) }]);
  it("sin resultados ≠ servicio caído ≠ límite del plan", () => {
    expect(enforceAvailabilityHonesty("Te dejo opciones.", ev({ ok: true, source: "serpapi", results: [] }))).toMatch(/no encontró resultados/);
    expect(enforceAvailabilityHonesty("Te dejo opciones.", ev({ error: "http_500" }))).toMatch(/no respondió en este momento/);
    expect(enforceAvailabilityHonesty("Te dejo opciones.", ev({ code: "FREE_LIMIT_REACHED", message: "x" }))).toMatch(/límite de búsquedas en vivo/);
    expect(enforceAvailabilityHonesty("Hola", ev({ code: "MEMBERS_PRO_REQUIRED" }, "search_members_venues"))).toMatch(/parte de IATOS PRO/);
  });
  it("el resultado para el modelo trae el estado explícito", () => {
    expect(prepareToolResultForModel("web_search", { ok: true, results: [] })).toMatchObject({ disponible: false, estado: "sin_resultados" });
    expect(prepareToolResultForModel("web_search", { error: "timeout" })).toMatchObject({ estado: "no_respondio" });
    expect(prepareToolResultForModel("web_search", { ok: true, results: [{ title: "x", link: "https://a.b" }] })).toMatchObject({ disponible: true, estado: "ok" });
  });
  it("si una herramienta sí falló, no se reescribe 'no respondió'", () => {
    const t = "El servicio de vuelos no respondió en este momento.";
    expect(correctFailureClaims(t, { search_flights: "no_respondio" })).toBe(t);
  });
});

describe("nunca reservas falsas", () => {
  it("quita 'te reservé' y 'tu mesa está confirmada' y dice 'Aún no está reservado'", () => {
    const out = enforceNoFakeBooking("¡Listo! Te reservé una mesa en Pujol a las 20:30. Tu mesa está confirmada. Lleva saco.");
    expect(out.startsWith(NOT_BOOKED_LINE)).toBe(true);
    expect(out).not.toMatch(/Te reservé|está confirmada/);
    expect(out).toMatch(/Lleva saco/);
  });
  it("no toca frases honestas ni el subjuntivo ('te sugiero que reserves')", () => {
    const t = "Te sugiero que reserves con 2 semanas. Aún no está reservado: usa el enlace.";
    expect(enforceNoFakeBooking(t)).toBe(t);
  });
  it("con reservas confirmadas reales 'tu habitación está confirmada' es válido; 'reservé' nunca", () => {
    expect(enforceNoFakeBooking("Tu habitación está confirmada en el Four Seasons.", { hasConfirmedBookings: true })).toMatch(/^Tu habitación/);
    expect(enforceNoFakeBooking("Ya reservé el spa.", { hasConfirmedBookings: true }).startsWith(NOT_BOOKED_LINE)).toBe(true);
  });
});

describe("cards con botones a partir de la evidencia", () => {
  const places = prepareToolResultForModel("search_places", {
    ok: true, source: "google_maps",
    results: [{ id: "ChIJ1", name: "Contramar", address: "Durango 200, Roma Nte., CDMX", lat: 19.419, lng: -99.165, rating: 4.6, maps_url: "https://maps.google.com/?cid=1", website: "https://contramar.com.mx" }],
    details: { id: "ChIJ1", name: "Contramar", phone: "55 5514 9217", opening_hours: ["lunes: 13:00–18:30"] },
  });
  const ev = collectEvidence([{ name: "search_places", result: places }]);
  const builders = {
    directions: (t: any) => `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`,
    ride: (t: any) => `https://m.uber.com/ul/?dropoff[latitude]=${t.lat}`,
    booking: (v: any) => [{ kind: "booking" as const, label: "Buscar mesa en OpenTable", url: `https://www.opentable.com/s?term=${encodeURIComponent(v.name)}` }],
  };
  it("restaurante: cómo llegar, Uber, llamar y reservar (búsqueda); nada inventado por el modelo", () => {
    expect(matchPlace("Contramar", ev.places)?.lat).toBe(19.419);
    const cards = validateCards([{ type: "restaurant", title: "Contramar", subtitle: "Roma", links: [{ kind: "booking", label: "x", url: "javascript:alert(1)" }] }], ev).cards;
    const [card] = enrichCardLinks(cards, ev, builders);
    expect(card.links!.map((l) => l.kind)).toEqual(["directions", "ride", "call", "booking"]);
    expect(card.links!.find((l) => l.kind === "call")!.url).toBe("tel:5555149217");
    expect(JSON.stringify(card.links)).not.toMatch(/javascript/);
  });
  it("una card 'source' solo con un enlace que devolvió web_search", () => {
    const evWeb = collectEvidence([{ name: "web_search", result: prepareToolResultForModel("web_search", { ok: true, results: [{ title: "A", link: "https://aicm.com.mx/salas", snippet: "s" }] }) }]);
    const out = validateCards([
      { type: "source", title: "AICM salas", cta_action: "https://aicm.com.mx/salas" },
      { type: "source", title: "Inventada", cta_action: "https://inventado.example/x" },
    ], evWeb);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]).toMatchObject({ subtitle: "aicm.com.mx" });
    expect(out.dropped).toEqual([{ type: "source", reason: "fuente_sin_respaldo" }]);
  });
  it("finalizeTurn junta texto, cards con botones y acciones validadas", () => {
    const raw = `**Contramar** está a 6 min de tu hotel, según Google Maps.\n${DATA_SENTINEL}\n${JSON.stringify({
      cards: [{ type: "restaurant", title: "Contramar", subtitle: "Roma · Mariscos", rating: 4.6 }],
      actions: [{ type: "add_itinerary_item", params: { fecha: "2026-10-22", hora: "20:30", titulo: "Cena en Contramar" } }],
    })}`;
    const out = finalizeTurn({
      raw, toolRuns: [{ name: "search_places", args: {}, result: places }], plan: { cards: [], suggestedActions: [] },
      actionCtx: { todayISO: "2026-10-22", trips: [{ id: "00000000-0000-4000-8000-000000000001", destino: "CDMX", fecha_salida: "2026-10-20" }], activeTripId: "00000000-0000-4000-8000-000000000001" },
      makeId: () => "a1",
    });
    expect(out.text).toBe("**Contramar** está a 6 min de tu hotel, según Google Maps.");
    expect(out.cards[0]).toMatchObject({ type: "restaurant", rating: 4.6 });
    expect(out.cards[0].links?.length).toBeGreaterThanOrEqual(3);
    expect(out.actions).toEqual([expect.objectContaining({ id: "a1", type: "add_itinerary_item", runs: "server", summary: expect.stringMatching(/Cena en Contramar/) })]);
  });
});
