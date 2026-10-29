// Auditoría 10, ronda 4 de Iato / Concierge (producción, main 1e3bb0f, 29-oct-2026): defectos del servidor
// y de la lógica pura. Las respuestas reales están en fixtures/auditoriaR4.json (out/*.cmp.json y *.sse.txt
// de la ronda); todo simulado, sin red ni mensajes a Iato.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rangeTripsNote, requestedRange, tripContentFacts, tripContents } from "../../supabase/functions/concierge-chat/context";
import { applyHonesty, dropSuperlativeGap, fixFalseMissing, repeatedEmergencyWarning, type HonestyCtx } from "../../supabase/functions/concierge-chat/honesty";
import { TRIP_RULES, GAP_RULES } from "../../supabase/functions/concierge-chat/prompt";
import { AnswerStreamFilter, splitAnswer, stripDanglingFence, DATA_SENTINEL } from "../../supabase/functions/concierge-chat/stream";
import { mapTicketmasterEvents, tmCategoryEs } from "../../supabase/functions/_shared/ticketmaster";
import { eventCardsForText, type ToolRun } from "../../supabase/functions/concierge-chat/cards";
import { detectIntents, leadSentence, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { validateAction } from "../../supabase/functions/concierge-chat/actions";
import { restoreConversation } from "@/lib/conciergeHistory";
import { buildChips } from "@/lib/conciergeChips";
import { fetchMembersCities, fetchMembersVenues } from "@/lib/membersVenues";

const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "auditoriaR4.json"), "utf8"));
const ROOT = join(__dirname, "..", "..");
const HOY = "2026-10-29";

// La cuenta demo de la ronda: San Miguel (971db8d5) con itinerario de 3 días; Budapest y Liubliana salen el 29-dic.
const SMA = {
  id: "971db8d5-0000-4000-8000-000000000001", destino: "San Miguel de Allende", fecha_salida: "2026-11-13", fecha_regreso: "2026-11-15",
  itinerario_json: { days: [{ dia: 1, titulo: "Centro" }, { dia: 2, titulo: "Cañada de la Virgen" }, { dia: 3, titulo: "Regreso" }] },
  vuelos_json: [{ modo: "autobus", from: "CDMX", to: "San Miguel de Allende" }, { modo: "auto", from: "CDMX", to: "San Miguel de Allende" }],
  hospedaje_json: [{ nombre: "Hotel por confirmar", ciudad: "San Miguel de Allende" }],
  selections: { v: 1, vuelo: { i: -1, key: null }, hospedaje: { i: 0, key: "x" }, noches_hospedaje: null, tours: [] },
};
const VB = { id: "b5feaa3f-0000-4000-8000-000000000002", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", itinerario_json: { days: [{ dia: 1 }, { dia: 2 }] } };
const BUD = { id: "bud00000-0000-4000-8000-000000000003", destino: "Budapest", fecha_salida: "2026-12-29", fecha_regreso: "2027-01-03" };
const LJU = { id: "lju00000-0000-4000-8000-000000000004", destino: "Liubliana", fecha_salida: "2026-12-29", fecha_regreso: "2027-01-02" };
const LEJOS = { id: "far00000-0000-4000-8000-000000000005", destino: "Madrid", fecha_salida: "2027-05-04", fecha_regreso: "2027-05-19" };

const honestyCtx = (over: Partial<HonestyCtx> = {}): HonestyCtx => ({
  trips: [SMA, VB, BUD, LJU] as any, userMessage: "¿Qué viajes tengo en los próximos 2 meses y cuál está más incompleto?", todayISO: HOY,
  toolsWithData: () => new Set(), tripFacts: [SMA, VB].map(tripContentFacts), ...over,
});

describe("N4-P1-1 · Iato no inventa que un viaje 'no tiene itinerario'", () => {
  it("<viajes_usuario> dice lo que el viaje SÍ tiene: días de itinerario, trayectos, hoteles y selección", () => {
    expect(tripContents(SMA)).toEqual({
      itinerario_dias: 3, opciones_de_vuelo: 0, opciones_por_tierra: 2, hoteles: 1,
      seleccion_del_usuario: { hotel: "elegido" },
    });
    expect(tripContents({ id: "x", destino: "Bogotá" })).toMatchObject({ itinerario_dias: 0, hoteles: 0, seleccion_del_usuario: "ninguna (usa las opciones sugeridas)" });
    const index = readFileSync(join(ROOT, "supabase/functions/concierge-chat/index.ts"), "utf8");
    expect(index).toMatch(/contenido: tripContents\(tr\)/);
  });
  it("regla del prompt: no afirmar lo que no está en los datos; itinerario_dias > 0 = sí tiene", () => {
    expect(TRIP_RULES).toMatch(/NO afirmes lo que no está en los datos/);
    expect(TRIP_RULES).toMatch(/itinerario_dias > 0 = SÍ tiene itinerario/);
    expect(TRIP_RULES).toMatch(/nunca digas que 'no tiene' algo/);
  });
  it("filtro de honestidad: la frase real de producción se corrige (el viaje se nombra en la oración anterior)", () => {
    const out = applyHonesty(FX.m10_viajes.text, honestyCtx()).text;
    expect(out).not.toMatch(/no tiene itinerario/);
    expect(out).toMatch(/un hotel por confirmar en Google Hotels y ya tiene itinerario de 3 días\./);
    // El resto del texto queda igual.
    expect(out).toMatch(/^En los próximos 2 meses/);
    expect(out).toMatch(/El más urgente es \*\*Valle de Bravo\*\*/);
  });
  it("no toca la frase si es cierta, si el viaje no está cargado completo o si no se sabe de qué viaje habla", () => {
    expect(fixFalseMissing("Bogotá no tiene itinerario.", honestyCtx({ trips: [{ id: "bog", destino: "Bogotá" }] as any, tripFacts: [tripContentFacts({ id: "bog", destino: "Bogotá" })] }))).toBeNull();
    // Budapest solo está en la lista ligera (sin itinerario cargado): no se puede comprobar.
    expect(fixFalseMissing("Budapest no tiene itinerario.", honestyCtx())).toBeNull();
    expect(fixFalseMissing("Ese viaje no tiene itinerario.", honestyCtx())).toBeNull();
    expect(fixFalseMissing("San Miguel de Allende no tiene hotel reservado.", honestyCtx())).toBeNull();
    expect(fixFalseMissing("San Miguel de Allende sin itinerario todavía.", honestyCtx())).toBe("San Miguel de Allende con itinerario de 3 días.");
  });
  it("'próximos 2 meses' incluye los que salen el último día (Budapest y Liubliana, 29-dic)", () => {
    expect(requestedRange("¿Qué viajes tengo en los próximos 2 meses?", HOY)).toEqual({ end: "2026-12-29", label: "2 meses" });
    expect(requestedRange("¿qué tengo el próximo mes?", HOY)?.end).toBe("2026-11-29");
    expect(requestedRange("¿Qué hora es en Tokio?", HOY)).toBeNull();
    const note = rangeTripsNote("¿Qué viajes tengo en los próximos dos meses y cuál está más incompleto?", HOY, [SMA, VB, BUD, LJU, LEJOS, VB])!;
    expect(note).toMatch(/de 2026-10-29 a 2026-12-29 \(inclusive\)/);
    expect(note).toMatch(/\(4\): Valle de Bravo \(sale 2026-10-30\); San Miguel de Allende \(sale 2026-11-13\); Budapest \(sale 2026-12-29\); Liubliana \(sale 2026-12-29\)/);
    expect(note).not.toMatch(/Madrid/);
    expect(TRIP_RULES).toMatch(/incluido el último día/);
  });
});

describe("N4-P2-1 · el '```' suelto al final de la respuesta del gasto", () => {
  it("en vivo: los deltas reales de producción ya no muestran la cerca antes del centinela", () => {
    const f = new AnswerStreamFilter();
    const deltas: string[] = [...FX.m08_gasto.deltas, `${DATA_SENTINEL}{"actions":[]}`];
    const shown = deltas.map((d) => f.push(d)).join("") + f.flush();
    expect(FX.m08_gasto.final).toMatch(/```$/); // así salía en producción
    expect(shown).not.toMatch(/`/);
    expect(shown.trim()).toBe("Puedo preparar el gasto de $120 MXN en Restaurantes (café, \"PRUEBA AUDITORÍA R4\") para tu viaje a Valle de Bravo. Te dejo el botón para confirmarlo; no se guarda hasta que lo apruebes.");
  });
  it("splitAnswer y el final sin centinela tampoco la dejan; un bloque de código completo sí se queda", () => {
    expect(splitAnswer(`Listo.\n\n\`\`\`json\n${DATA_SENTINEL}{"cards":[]}`).text).toBe("Listo.");
    const f = new AnswerStreamFilter();
    expect((f.push("Hola.\n\n```") + f.flush()).trimEnd()).toBe("Hola.");
    const g = new AnswerStreamFilter();
    expect(g.push("Usa esto:\n```\nabc\n```") + g.push("\nY listo.") + g.flush()).toBe("Usa esto:\n```\nabc\n```\nY listo.");
    expect(stripDanglingFence("Usa esto:\n```\nabc\n```")).toBe("Usa esto:\n```\nabc\n```");
  });
  it("en el historial: la respuesta guardada con '```' se ve limpia al recargar", () => {
    const msgs = restoreConversation([{ role: "user", content: "Registra 120 de café" }, { role: "assistant", content: FX.m08_gasto.final }], 20);
    expect(msgs[1].text).not.toMatch(/`/);
    expect(msgs[1].text).toMatch(/^Puedo preparar el gasto de \$120 MXN/);
  });
});

describe("N4-P2-3 · eventos: géneros en español y tarjetas = lo que dice el texto (N6)", () => {
  it("'Música · Latin' y 'Música · Classical' → en español; lo que no tiene traducción no se muestra", () => {
    expect(tmCategoryEs("Música", "Latin")).toBe("Música · Latina");
    expect(tmCategoryEs("Music", "Classical")).toBe("Música · Clásica");
    expect(tmCategoryEs("Arts & Theatre", "Theatre")).toBe("Arte y teatro · Teatro");
    expect(tmCategoryEs("Music", "Undefined")).toBe("Música");
    expect(tmCategoryEs("Music", "Zydeco")).toBe("Música");
    expect(tmCategoryEs("Weird Segment", "Weird Genre")).toBeUndefined();
    const json = { _embedded: { events: [{ id: "e1", name: "Concierto", url: "https://www.ticketmaster.es/event/e1", dates: { status: { code: "onsale" }, start: { localDate: "2026-10-31" } },
      classifications: [{ primary: true, segment: { name: "Música" }, genre: { name: "Latin" } }] }] } };
    expect(mapTicketmasterEvents(json)[0].categoria).toBe("Música · Latina");
  });
  it("Madrid: el texto nombra 'Piano Jazz' (5.º resultado) → tiene tarjeta; 'Experiencia Galería Inesperada Morat' no se nombra → sin tarjeta", () => {
    const ev = (id: string, title: string, fecha: string, hora: string, recinto: string) => ({
      id, title, fecha, hora, recinto, fuente: "ticketmaster", estado: "onsale", url: `https://www.ticketmaster.es/event/${id}`, cuando: `${fecha} ${hora}`,
    });
    const runs: ToolRun[] = [{ name: "search_events", args: { city: "Madrid" }, result: { consulted_at: "2026-10-29T08:58:00Z", results: [
      ev("a", "PERREO LAB X HALLOWEEN - DALMATA", "2026-10-31", "17:00", "Live Las Ventas"),
      ev("b", "Experiencia Galería Inesperada Morat", "2026-10-31", "18:00", "Galería"),
      ev("c", "Morat", "2026-10-31", "20:00", "Movistar Arena"),
      ev("d", "Una Cena Cantada", "2026-10-31", "20:30", "El Café de la Ópera"),
      ev("e", "Piano Jazz", "2026-11-01", "19:00", "El Café de la Ópera"),
    ] } } as any];
    // Producción: [Perreo, Experiencia Morat, Morat, Cena Cantada] (FX.m06_eventos.cards).
    expect(FX.m06_eventos.cards).toContain("Experiencia Galería Inesperada Morat");
    const titles = eventCardsForText(runs, FX.m06_eventos.text).map((c) => c.title);
    expect(titles).toEqual(["PERREO LAB X HALLOWEEN - DALMATA", "Morat", "Una Cena Cantada", "Piano Jazz"]);
    // Sin nombrar ninguno: las primeras por fecha, como antes.
    expect(eventCardsForText(runs, "Hay varios eventos este fin.").map((c) => c.title)).toHaveLength(4);
  });
});

describe("N4-P2-5 · emergencia con un solo aviso", () => {
  const plan = planTurn({ message: "Me siento mal, ¿cuál es el hospital más cercano a mí ahora?", intents: detectIntents("Me siento mal, ¿cuál es el hospital más cercano a mí ahora?"),
    trip: null, todayISO: HOY, coords: { lat: 19.43, lng: -99.13 }, hasPriveSession: false, exigente: false });
  it("la frase de inicio ya no repite 'llama ya'; el aviso queda solo en la tarjeta 'Ayuda inmediata'", () => {
    expect(leadSentence(plan)).toBe("Busco el hospital más cercano a tu ubicación.");
    expect(plan.cards.filter((c: any) => c.type === "alert" && c.title === "Ayuda inmediata")).toHaveLength(1);
    expect(plan.notes.join(" ")).toMatch(/NO lo repitas en el texto/);
  });
  it("el texto real ('llama ya al **911** o ve a urgencias') pierde la repetición; el dato del hospital se queda", () => {
    const text = FX.m09_hospital.text.replace(/^Si hay riesgo para tu vida, llama ya al número de emergencias local\. Mientras tanto busco el hospital más cercano a tu ubicación\. /, "");
    const out = applyHonesty(text, honestyCtx({ emergencyCard: true })).text;
    expect(out).not.toMatch(/911|llama ya/);
    expect(out).toMatch(/Hospital de Jesús/);
    expect(out).toMatch(/\+52 55 5542 6501/);
    // Sin la tarjeta (otra conversación) no se quita nada.
    expect(applyHonesty("Si te sientes muy mal, llama al 911.", honestyCtx()).text).toBe("Si te sientes muy mal, llama al 911.");
    expect(repeatedEmergencyWarning("Su teléfono es +52 55 5542 6501.")).toBe(false);
  });
  it("'Ayuda urgente' ya no termina en 'Aún no está reservado.'; una mesa o un chofer sí lo dicen", () => {
    const urgent = validateAction("fixer_request", FX.m09_hospital.actions[1].params, { todayISO: HOY, trips: [], activeTripId: null, hasPriveSession: false } as any) as any;
    expect(FX.m09_hospital.actions[1].note).toMatch(/Aún no está reservado\.$/); // producción
    expect(urgent.action.note).not.toMatch(/reservado/);
    const mesa = validateAction("fixer_request", { tipo: "reservation", titulo: "Mesa en Pujol", fecha: "2026-11-06" }, { todayISO: HOY, trips: [], activeTripId: null, hasPriveSession: false } as any) as any;
    expect(mesa.action.note).toMatch(/Aún no está reservado\./);
  });
});

describe("N4-P2-6 · 'Mi viaje a' coherente", () => {
  it("'…y es lo más importante pendiente' se quita (chocaba con 'Siguiente paso: reservar hotel')", () => {
    const line = "Tampoco veo seguro de viaje, y es lo más importante pendiente: revisa la sección Seguros de IATOS.";
    expect(FX.m03_viaje.text).toContain(line);
    expect(dropSuperlativeGap(line)).toBe("Tampoco veo seguro de viaje: revisa la sección Seguros de IATOS.");
    expect(applyHonesty(FX.m03_viaje.text, honestyCtx()).text).not.toMatch(/lo más importante pendiente/);
    expect(dropSuperlativeGap("Lo más importante es tu pasaporte.")).toBeNull();
    expect(GAP_RULES).toMatch(/el siguiente paso es UNO/);
  });
  it("la ruta /dashboard/seguros existe", () => {
    expect(readFileSync(join(ROOT, "src/App.tsx"), "utf8")).toMatch(/path="\/dashboard\/seguros"/);
  });
});

describe("N4-P2-7 · '¿Mi vuelo va a tiempo?' solo si el viaje tiene vuelo", () => {
  it("viaje por autobús (Valle de Bravo) y sin viaje: no sale; con vuelo: sí", () => {
    const bus = { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", vuelos_json: [{ modo: "autobus", from: "CDMX", to: "Valle de Bravo" }] };
    expect(buildChips(bus, HOY).map((c) => c.id)).not.toContain("flight");
    expect(buildChips(null, HOY).map((c) => c.id)).not.toContain("flight");
    const air = { ...bus, vuelos_json: [{ numero_vuelo: "AM2", fecha: "2026-10-30", from: "MEX", to: "CUN" }] };
    expect(buildChips(air, HOY).find((c) => c.id === "flight")).toMatchObject({ label: "¿AM2 va a tiempo?" });
  });
});

describe("N4-P2-8 · el chofer: la fecha que pide y el botón van juntos", () => {
  it("sin fecha, la propuesta dice que se puede enviar así y el equipo la pide", () => {
    const p = FX.m04_chofer.actions[0].params;
    expect(FX.m04_chofer.text).toMatch(/¿Qué día quieren hacer la excursión\?/);
    const v = validateAction("fixer_request", p, { todayISO: HOY, trips: [], activeTripId: null, hasPriveSession: false } as any) as any;
    expect(v.action.summary).toBe("Pedírselo a nuestro equipo: Chofer privado en Oaxaca · sin fecha");
    expect(v.action.note).toMatch(/^Sin fecha todavía: puedes enviarla así y te pedimos la fecha\./);
    const conFecha = validateAction("fixer_request", { ...p, fecha: "2027-01-16" }, { todayISO: HOY, trips: [], activeTripId: null, hasPriveSession: false } as any) as any;
    expect(conFecha.action.note).not.toMatch(/Sin fecha/);
  });
});

describe("N4-P2-11 · Solo para miembros: un 500 pasajero no deja la pantalla vacía", () => {
  it("members_venues y members_cities reintentan una vez ante un 500; un 'sin derecho' no se reintenta", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const client = { rpc: vi.fn(async (fn: string) => {
        n += 1;
        if (n === 1 || n === 3) return { data: null, error: { message: "Internal Server Error" }, status: 500 };
        return fn === "members_cities"
          ? { data: [{ ciudad: "cdmx", ciudad_display: "Ciudad de México", venues: 9 }], error: null, status: 200 }
          : { data: [{ id: "v1", nombre: "Soho House", ciudad_display: "Ciudad de México", categoria: "members_club", fuente: "curaduria" }], error: null, status: 200 };
      }) };
      const pv = fetchMembersVenues(client, "Ciudad de México");
      await vi.advanceTimersByTimeAsync(450);
      expect((await pv).error).toBe(false);
      const pc = fetchMembersCities(client);
      await vi.advanceTimersByTimeAsync(450);
      expect((await pc)?.[0]).toMatchObject({ display: "Ciudad de México", venues: 9 });
      expect(client.rpc).toHaveBeenCalledTimes(4);
      const denied = { rpc: vi.fn(async () => ({ data: null, error: { code: "42501", message: "MEMBERS_PRO_REQUIRED" }, status: 403 })) };
      expect((await fetchMembersVenues(denied, "París")).error).toBe(true);
      expect(denied.rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
