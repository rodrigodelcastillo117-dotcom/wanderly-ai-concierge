// Road trips (grupo roadtrip): Iato entiende "road trip por la Toscana en 7 días" con el modo
// existente del concierge (planeador del turno), sin otro chatbot.
import { describe, expect, it } from "vitest";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { roadTripTurn } from "../../supabase/functions/concierge-chat/roadtrip";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";

const base = { trip: null, todayISO: "2026-10-22", coords: null, hasPriveSession: false, exigente: false };

describe("intención road_trip", () => {
  it("se detecta en frases comunes", () => {
    expect(detectIntents("quiero hacer un road trip por la Toscana en 7 días")).toContain("road_trip");
    expect(detectIntents("armame una ruta por Escocia")).toContain("road_trip");
    expect(detectIntents("quiero recorrer Andalucía en coche")).toContain("road_trip");
    expect(detectIntents("¿dónde ceno cerca de mi hotel?")).not.toContain("road_trip");
  });
});

describe("plan del turno para la Toscana en 7 días", () => {
  const message = "quiero hacer un road trip por la Toscana en 7 días";
  const plan = planTurn({ ...base, message, intents: detectIntents(message) });

  it("agrega la ruta curada con su fuente, días, tramos ESTIMADOS y costos honestos", () => {
    const notes = plan.notes.join("\n");
    expect(notes).toMatch(/ruta curada "Toscana: Chianti y Val d'Orcia"/);
    expect(notes).toMatch(/visittuscany\.com/);
    expect(notes).toMatch(/Días: 7 \(los pidió el usuario\)/);
    expect(notes).toMatch(/Día 1: San Gimignano/);
    expect(notes).toMatch(/\(ESTIMADO\)/);
    expect(notes).toMatch(/renta POR COTIZAR/);
    expect(notes).toMatch(/casetas y estacionamiento POR CONFIRMAR/);
    expect(notes).toMatch(/ZTL/);
    expect(notes).toMatch(/normattiva/);
    expect(notes).toMatch(/cargo por devolución en otro lugar/);
  });

  it("ofrece una card con enlaces de IATOS y Google Maps (sin precio)", () => {
    const card = plan.cards.find((c) => String(c.title).startsWith("Road trip")) as any;
    expect(card.type).toBe("transport");
    expect(card.price).toBeUndefined();
    const links = card.links.map((l: any) => new URL(l.url));
    expect(links[0].hostname).toBe("traveliatos.life");
    expect(links[0].pathname).toBe("/dashboard/ruta");
    expect(links[0].searchParams.get("modo")).toBe("coche");
    expect(links[0].searchParams.get("dias")).toBe("7");
    expect(links[1].hostname).toBe("www.google.com");
    expect(links[1].searchParams.get("travelmode")).toBe("driving");
  });

  it("la card sobrevive la validación final del turno con sus enlaces", () => {
    const final = finalizeTurn({
      raw: "Te propongo esta ruta.", toolRuns: [], plan, actionCtx: { todayISO: "2026-10-22", trips: [], activeTripId: null },
      hasConfirmedBookings: false, party: 2, makeId: () => "id-1",
    } as any);
    const card = final.cards.find((c) => c.title.startsWith("Road trip"))!;
    expect(card.links?.map((l) => l.label)).toEqual(["Planear en IATOS", "Ruta en Google Maps", "Fuente oficial"]);
  });
});

describe("road trip sin región", () => {
  it("pregunta la región y ofrece las rutas curadas (sin inventar una ruta)", () => {
    const rt = roadTripTurn("quiero hacer un road trip en coche")!;
    expect(rt.cards).toHaveLength(0);
    expect(rt.notes[0]).toMatch(/no dijo la región/);
    expect(rt.notes[0]).toMatch(/Islandia: Ring Road/);
  });
  it("mensaje sin road trip: nada", () => {
    expect(roadTripTurn("¿a qué hora sale mi vuelo?")).toBeNull();
  });
});
