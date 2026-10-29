// Auditoría 10, ronda 3 de Iato / Concierge (producción, 29-oct-2026): defectos del servidor.
// Textos, tarjetas y acciones reales de las respuestas grabadas (r3-concierge/out/*.sse.txt, copiadas en
// fixtures/auditoriaR3.json). Sin red ni modelo: todo lo que se prueba aquí es determinista.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { compactTripForPrompt, computeTripGaps, savedHotelQuoteStamp } from "../../supabase/functions/concierge-chat/context";
import { detectIntents, leadSentence, planTurn, toolStatusText } from "../../supabase/functions/concierge-chat/planner";
import { requestedDate, requestedTime } from "../../supabase/functions/concierge-chat/requestedWhen";
import { applyHonesty, type HonestyCtx, withoutAiReservationMirrors } from "../../supabase/functions/concierge-chat/honesty";
import { mentionIndex } from "../../supabase/functions/concierge-chat/cards";
import { TOOL_DEFS, validateToolInput } from "../../supabase/functions/concierge-chat/toolDefs";
import { SYSTEM } from "../../supabase/functions/concierge-chat/prompt";
import { cardsForStorage, HISTORY_KEEP, HISTORY_SUMMARIZE_OVER, restoreStoredCards } from "../../supabase/functions/concierge-chat/storedCards";
import { clockIn, runLocalTime, timeRequested, timeZoneFor, userClockLine } from "../../supabase/functions/_shared/worldClock";
import { emergencyTier, rankEmergencyPlaces } from "../../supabase/functions/places-nearby/rank";

const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "auditoriaR3.json"), "utf8"));
const HOY = "2026-10-28";
// 29-oct 05:44 UTC = 28-oct 23:44 en CDMX: la hora de la ronda 3.
const NOW = new Date("2026-10-29T05:44:00Z");

/** El viaje de la cuenta demo (b5feaa3f): Valle de Bravo en autobús, hotel cotizado el 28-oct 05:37 UTC. */
const VALLE = {
  id: "b5feaa3f-1bd8-4839-8ba4-b40919c81b67", destino: "Valle de Bravo", pais_destino: "México", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", num_viajeros: 2,
  vuelos_json: [{ modo: "autobus", aerolinea: "Autobús ADO", tier: "ahorro", precio_por_persona: 380 }],
  hospedaje_json: [{ nombre: "Múbú Hotel Boutique", ciudad: "Valle de Bravo", precio_por_noche: 2684, fuente_precio: "serpapi", consultado_at: "2026-10-28T05:37:00Z" }],
};
const ACTX = { todayISO: HOY, trips: [VALLE], activeTripId: VALLE.id };
const PLAN0 = { cards: [], suggestedActions: [] };

describe("N-P1-1 · no se propone guardar en el viaje un evento de otra ciudad", () => {
  const run = (results: unknown[], city = "Ciudad de México") => ({ name: "search_events", args: { city, date_from: "2026-10-31", date_to: "2026-11-01" }, result: { disponible: true, consulted_at: "2026-10-29T05:44:12.991Z", results } });
  const text = FX.t01_eventos.final_text as string;
  it("Sexteto Místico (Bellas Artes, CDMX) ya no se ofrece para el viaje a Valle de Bravo", () => {
    const f = finalizeTurn({ raw: text, liveText: text, toolRuns: [run(FX.t01_eventos.tm_results) as any], plan: PLAN0, actionCtx: ACTX, tripScope: { trip: VALLE, position: "away" }, makeId: () => "a1" });
    expect(f.cards.filter((c) => c.type === "event").length).toBeGreaterThan(0);
    expect(f.actions.filter((a) => a.type === "add_itinerary_item")).toEqual([]);
  });
  it("un evento en Valle de Bravo, dentro de las fechas del viaje, sí se ofrece", () => {
    const local = [{ ...FX.t01_eventos.tm_results[0], title: "Festival de Almas", recinto: "Teatro Municipal", direccion: "Centro, Valle de Bravo, Méx.", lat: undefined, lng: undefined }];
    const f = finalizeTurn({ raw: text, liveText: text, toolRuns: [run(local, "Valle de Bravo") as any], plan: PLAN0, actionCtx: ACTX, tripScope: { trip: VALLE, position: "away" }, makeId: () => "a1" });
    expect(f.actions.find((a) => a.type === "add_itinerary_item")?.params).toMatchObject({ trip_id: VALLE.id, fecha: "2026-10-31", titulo: "Festival de Almas" });
  });
});

describe("N-P1-2 · sin check-in de vuelo en un viaje en autobús", () => {
  it("los faltantes no piden check-in, vuelo de regreso ni transfer de aeropuerto", () => {
    const ids = computeTripGaps(VALLE, [], HOY).map((g) => g.id);
    expect(ids).not.toContain("checkin");
    expect(ids).not.toContain("vuelo_regreso");
    expect(ids).not.toContain("transfer");
    // Con avión, sí (el aviso sigue funcionando donde aplica).
    const avion = { ...VALLE, vuelos_json: [{ aerolinea: "Aeroméxico", numero_vuelo: "AM 123", fecha: "2026-10-30" }] };
    expect(computeTripGaps(avion, [], HOY).map((g) => g.id)).toContain("checkin");
  });
  it("compactTripForPrompt pasa el modo y dice que el viaje es por tierra", () => {
    const c = compactTripForPrompt(VALLE, { todayISO: HOY }) as any;
    expect(c.vuelos[0].modo).toBe("autobús");
    expect(c.transporte).toMatch(/NO en avión/);
    expect(c.transporte).toMatch(/check-in/);
    expect(SYSTEM).toMatch(/viaje por tierra/);
  });
});

describe("N-P1-3 · mesa en Modo exigente con la fecha y la hora pedidas", () => {
  const msg = FX.g1_exigente.message as string; // "Plan para una tarde en Valle de Bravo el sábado 31 de octubre: qué hacer y dónde comer"
  const plan = (message: string, extra: Record<string, unknown> = {}) => planTurn({
    message, intents: detectIntents(message), trip: VALLE, todayISO: HOY, coords: null, hasPriveSession: false, exigente: true,
    position: "away", requested: "Valle de Bravo", ...extra,
  } as any);
  it("la acción va al sábado 31 (no a hoy), sin hora inventada y con un título concreto", () => {
    const fx = plan(msg).suggestedActions.find((a) => a.type === "fixer_request")!;
    expect(fx.params.fecha).toBe("2026-10-31");
    expect(fx.params.hora).toBeUndefined();
    expect(fx.params.titulo).toBe("Mesa para comer en Valle de Bravo · sáb 31 oct");
    expect(plan(msg).notes.join(" ")).toMatch(/falta la hora/);
  });
  it("con hora en el mensaje la usa; sin fecha no deja botón y pide la fecha", () => {
    expect(plan("Cena en Valle de Bravo el sábado 31 a las 9").suggestedActions.find((a) => a.type === "fixer_request")!.params)
      .toMatchObject({ fecha: "2026-10-31", hora: "21:00", titulo: "Mesa para cenar en Valle de Bravo · sáb 31 oct 21:00" });
    const p = plan("¿Dónde cenar rico en Valle de Bravo?");
    expect(p.suggestedActions.some((a) => a.type === "fixer_request")).toBe(false);
    expect(p.notes.join(" ")).toMatch(/para qué fecha y hora/);
  });
  it("lee fechas y horas como las escribe la gente (sin adivinar)", () => {
    expect(requestedDate("el sábado 31 de octubre", HOY)).toBe("2026-10-31");
    expect(requestedDate("el sábado", HOY)).toBe("2026-10-31");
    expect(requestedDate("mañana en la noche", HOY)).toBe("2026-10-29");
    expect(requestedDate("por la mañana", HOY)).toBeNull();
    expect(requestedDate("el 2 de noviembre", HOY)).toBe("2026-11-02");
    expect(requestedDate("dónde comer", HOY)).toBeNull();
    expect(requestedTime("cena a las 9")).toBe("21:00");
    expect(requestedTime("a las 14:30")).toBe("14:30");
    expect(requestedTime("8 pm")).toBe("20:00");
    expect(requestedTime("para 4 personas")).toBeNull();
  });
  it("la acción del equipo lleva las opciones que Iato mostró", () => {
    const fx = plan(msg).suggestedActions.find((a) => a.type === "fixer_request")!;
    const places = { name: "search_places", args: { query: "restaurantes en Valle de Bravo" }, result: { ok: true, results: FX.g1_exigente.restaurants } };
    const text = FX.g1_exigente.final_text as string;
    const f = finalizeTurn({
      raw: `${text}\n<<<IATO_DATA>>>\n${JSON.stringify({ cards: FX.g1_exigente.restaurants.map((r: any) => ({ type: "restaurant", title: r.name })) })}`,
      liveText: text, toolRuns: [places as any], plan: { cards: [], suggestedActions: [fx] }, actionCtx: ACTX, tripScope: { trip: VALLE, position: "away" }, makeId: () => "a1",
    });
    const a = f.actions.find((x) => x.type === "fixer_request")!;
    expect(a.params).toMatchObject({ fecha: "2026-10-31", titulo: "Mesa para comer en Valle de Bravo · sáb 31 oct" });
    expect(String(a.params.detalle)).toMatch(/Opciones de Iato: Bocatto Gourmet, Soleado Cocina del mundo, Restaurante Los Pericos\./);
  });
});

describe("N-P1-6 · Iato sabe qué hora es en cualquier ciudad", () => {
  it("la pregunta de la ronda 3 se detecta y se consulta el reloj de IATOS (sin red)", () => {
    const m = FX.t03_japon.message as string; // "¿Qué hora es ahora en Tokio?"
    expect(timeRequested(m)).toBe(true);
    const p = planTurn({ message: m, intents: detectIntents(m), trip: null, todayISO: HOY, coords: null, hasPriveSession: false, exigente: false, requested: "Tokio" } as any);
    expect(p.prefetch).toContainEqual({ name: "get_local_time", args: { city: "Tokio" }, reason: "hora local" });
    expect(toolStatusText("get_local_time", { city: "Tokio" })).toBe("Consultando la hora en Tokio…");
    expect(TOOL_DEFS.some((t) => t.name === "get_local_time")).toBe(true);
    expect(validateToolInput("get_local_time", { city: "Tokio" }).ok).toBe(true);
    expect(timeRequested("¿a qué hora abre el museo?")).toBe(false);
  });
  it("hora de Tokio a las 23:44 de CDMX: 14:44 del día siguiente, +15 h", () => {
    const r = runLocalTime({ city: "Tokio" }, { now: NOW, userTz: "America/Mexico_City" });
    expect(r).toMatchObject({ ok: true, zona: "Asia/Tokyo", fecha: "2026-10-29", hora: "14:44", utc_offset: "UTC+9", diferencia_con_el_usuario: "+15 h respecto al usuario" });
    expect(r.texto).toBe("jueves 29 oct 2026, 14:44 (hora de Tokio)");
    expect(r.hora_del_usuario).toBe("miércoles 28 oct 2026, 23:44 (hora CDMX)");
  });
  it("zonas IANA con horario de verano y lugares que no reconoce (sin inventar)", () => {
    expect(clockIn(NOW, "Europe/Madrid")!.hora).toBe("06:44"); // ya en horario de invierno (UTC+1)
    expect(clockIn(new Date("2026-07-01T12:00:00Z"), "Europe/Madrid")!.hora).toBe("14:00"); // verano UTC+2
    expect(timeZoneFor("Lisboa, Portugal")).toBe("Europe/Lisbon");
    expect(timeZoneFor("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(timeZoneFor("Japón")).toBe("Asia/Tokyo");
    const nada = runLocalTime({ city: "Zzyzx" }, { now: NOW });
    expect(nada).toMatchObject({ ok: false, estado: "sin_resultados" });
    expect(String(nada.motivo)).toMatch(/no digas que no tienes reloj/);
  });
  it("el sistema recibe la hora actual del usuario y la regla de nunca decir 'no tengo reloj'", () => {
    expect(userClockLine(NOW, "America/Mexico_City")).toBe("HORA ACTUAL DEL USUARIO: miércoles 28 oct 2026, 23:44 (hora CDMX), UTC−6. Para la hora de otra ciudad usa la herramienta get_local_time; nunca digas que no tienes reloj.");
    expect(userClockLine(NOW, null)).toBe("");
    expect(SYSTEM).toMatch(/get_local_time/);
    expect(SYSTEM).toMatch(/Nunca digas que no tienes reloj/);
  });
});

describe("#12 · Emergencia local sin tiendas (nombres de la captura de la ronda 3)", () => {
  const Z = { lat: 19.4326, lng: -99.1332 };
  const at = (d: number) => ({ lat: Z.lat + d, lng: Z.lng });
  it("Hospital: fuera 'Batas De Hospital Baratas'", () => {
    const r = rankEmergencyPlaces("hospital", [
      { name: "Hospital de Jesús", primary_type: "general_hospital", ratings_count: 382, ...at(0.0037) },
      { name: "Hospital General Gregorio Salas Flores", primary_type: "general_hospital", ratings_count: 231, ...at(0.005) },
      { name: "Batas De Hospital Baratas", primary_type: "hospital", ratings_count: 2, ...at(0.004) },
    ], Z);
    expect(r.map((p) => p.name)).toEqual(["Hospital de Jesús", "Hospital General Gregorio Salas Flores"]);
  });
  it("Policía: fuera 'Accesorios Policiales'; un módulo real con pocas reseñas queda al final", () => {
    const r = rankEmergencyPlaces("police", [
      { name: "MODULO DE POLICIA", primary_type: "police", ratings_count: 0, ...at(0.009) },
      { name: "Agrupación de policía San Salvador el Verde", primary_type: "police", ratings_count: 14, ...at(0.01) },
      { name: "Accesorios Policiales", primary_type: "police", ratings_count: 3, ...at(0.012) },
    ], Z);
    expect(r.map((p) => p.name)).toEqual(["Agrupación de policía San Salvador el Verde", "MODULO DE POLICIA"]);
  });
  it("Farmacia: fuera 'Venta de sillas de ruedas' y 'Pin'", () => {
    const r = rankEmergencyPlaces("pharmacy", [
      { name: "Farmacias Benavides", primary_type: "pharmacy", ratings_count: 44, ...at(0.0014) },
      { name: "FHN Similia Centro", primary_type: "drugstore", ratings_count: 206, ...at(0.0025) },
      { name: "Venta de sillas de ruedas", primary_type: "pharmacy", ratings_count: 1, ...at(0.002) },
      { name: "Pin", primary_type: "pharmacy", ratings_count: 0, ...at(0.003) },
      { name: "Farmacia San Pablo Centro", primary_type: "pharmacy", ratings_count: 481, ...at(0.0031) },
    ], Z);
    expect(r.map((p) => p.name)).toEqual(["Farmacias Benavides", "FHN Similia Centro", "Farmacia San Pablo Centro"]);
  });
  it("nivel 2 exige reseñas mínimas (con 2 reseñas un hospital baja al final, nivel 4)", () => {
    expect(emergencyTier("hospital", { name: "Hospital San Rafael", primary_type: "hospital", ratings_count: 2 })).toBe(4);
    expect(emergencyTier("hospital", { name: "Hospital San Rafael", primary_type: "hospital", ratings_count: 8 })).toBe(2);
    expect(emergencyTier("hospital", { name: "Hospital San Rafael", primary_type: "doctor", ratings_count: 2 })).toBeNull();
  });
});

describe("N-P2-1 · precio del hotel guardado: en hora del usuario y sin 'en vivo'", () => {
  it("el contexto lleva cuándo se cotizó, en hora CDMX (27 oct, no 'hoy 28')", () => {
    const c = compactTripForPrompt(VALLE, { todayISO: HOY, tz: "America/Mexico_City" }) as any;
    expect(c.hospedaje[0]).toMatchObject({ precio_fuente: "Google Hotels", precio_consultado: "27 oct 2026, 23:37 (hora CDMX)" });
    expect(c.hospedaje[0].precio_nota).toMatch(/no es en vivo/);
    expect(savedHotelQuoteStamp(VALLE, "America/Mexico_City")).toBe("27 oct 2026, 23:37 (hora CDMX)");
  });
  it("la frase real 'según Google Hotels en vivo, consultado hoy 28 oct' se corrige en vivo", () => {
    const ctx: HonestyCtx = { trips: [VALLE], userMessage: "Mi viaje a Valle de Bravo", todayISO: HOY, toolsWithData: () => new Set(), hotelQuoteStamp: "27 oct 2026, 23:37 (hora CDMX)" };
    const out = applyHonesty(FX.c1_viaje.final_text, ctx).text;
    expect(out).not.toMatch(/en vivo/);
    expect(out).not.toMatch(/consultado hoy/);
    expect(out).toMatch(/Google Hotels \(cotización guardada\), consultado el 27 oct 2026, 23:37 \(hora CDMX\)/);
    // Si este turno sí buscó hoteles, "en vivo" puede ser cierto y no se toca.
    expect(applyHonesty(FX.c1_viaje.final_text, { ...ctx, toolsWithData: () => new Set(["search_hotels"]) }).text).toMatch(/en vivo/);
  });
});

describe("N-P2-2 · Modo exigente: sin tarjetas repetidas, paso bien nombrado y sin 'ajusto los horarios'", () => {
  const text = FX.g1_exigente.final_text as string;
  const runs = [
    { name: "search_places", args: { query: "restaurantes en Valle de Bravo" }, result: { ok: true, results: FX.g1_exigente.restaurants } },
    { name: "search_attractions", args: { query: "mejores restaurantes en Valle de Bravo", category: "restaurants" }, result: { ok: true, results: FX.g1_exigente.attractions } },
  ];
  const raw = `${text}\n<<<IATO_DATA>>>\n${JSON.stringify({ cards: FX.g1_exigente.model_cards })}`;
  it("Bocatto Gourmet sale una vez (como restaurante) y 'Restaurante La Herencia', que el texto no nombra, no sale", () => {
    const f = finalizeTurn({ raw, liveText: text, toolRuns: runs as any, plan: PLAN0, actionCtx: ACTX, exigente: true });
    const titles = f.cards.map((c) => `${c.type}:${c.title}`);
    expect(titles.filter((t) => /Bocatto/.test(t))).toEqual(["restaurant:Bocatto Gourmet"]);
    expect(titles.some((t) => /La Herencia/.test(t))).toBe(false);
    expect(mentionIndex(text, "Restaurante La Herencia")).toBe(-1);
  });
  it("el paso del ranking de restaurantes no dice 'atracciones'", () => {
    expect(toolStatusText("search_attractions", { query: "mejores restaurantes en Valle de Bravo", category: "restaurants" })).toBe("Buscando en Google Maps: mejores restaurantes en Valle de Bravo…");
    expect(toolStatusText("search_attractions", { query: "museos en Roma" })).toMatch(/^Buscando atracciones/);
  });
  it("'así que ajusto los horarios para que no choquen' (sin acción que lo haga) se vuelve un consejo honesto", () => {
    const ctx: HonestyCtx = { trips: [VALLE], userMessage: FX.g1_exigente.message, todayISO: HOY, toolsWithData: () => new Set(["search_places"]) };
    const out = applyHonesty(text, ctx).text;
    expect(out).not.toMatch(/ajusto los horarios/);
    expect(out).toMatch(/a las 17:00: revisa que los horarios no choquen; yo no muevo lo que ya tienes en el itinerario\./);
    expect(applyHonesty("Si quieres, ajusto los horarios del plan.", ctx).text).toBe("Si quieres, ajusto los horarios del plan.");
    expect(SYSTEM).toMatch(/No digas que ajustas, mueves/);
  });
});

describe("N-P2-3 · la reserva espejo no se cuenta dos veces", () => {
  it("la mesa de Contramar de Reservas IA sale solo en <reservas_ia_usuario>", () => {
    const ai = [
      { id: "886929f4-0000-4000-8000-000000000001", venue_name: "Contramar", requested_local: "2026-11-06T14:30", status: "sent", sent_at: "2026-10-28T10:00:00Z" },
      { id: "8fbcd8b7-0000-4000-8000-000000000002", venue_name: "Contramar", requested_local: "2026-11-13T14:30", status: "awaiting_user_ok" },
    ];
    const canon = [
      { source_table: "ai_reservations", source_id: "886929f4-0000-4000-8000-000000000001", title: "Contramar", kind: "restaurant", canonical_state: "REQUESTED" },
      { source_table: "concierge_requests", source_id: "dc11b014-0000-4000-8000-000000000003", title: "Contramar", kind: "reservation", canonical_state: "REQUESTED" },
      { source_table: "concierge_requests", source_id: "aa", title: "Chofer privado en Oaxaca", kind: "transport", canonical_state: "REQUESTED" },
    ];
    expect(withoutAiReservationMirrors(canon, ai).map((r) => r.title)).toEqual(["Chofer privado en Oaxaca"]);
    expect(withoutAiReservationMirrors(canon, [])).toHaveLength(3);
  });
});

describe("N-P2-4 · historial: se guardan los mismos 20 mensajes que el chat restaura", () => {
  it("se resume pasando 40 turnos y se conservan 20 (antes 30 y 10)", () => {
    expect(HISTORY_SUMMARIZE_OVER).toBe(40);
    expect(HISTORY_KEEP).toBe(20);
  });
  it("las tarjetas guardadas conservan su foto (photo_ref y place_id de Google)", () => {
    const stored = cardsForStorage(FX.k1_lisboa.cards, "2026-10-29T05:50:00Z")!;
    const back = restoreStoredCards(stored, Date.parse("2026-10-29T06:00:00Z"));
    expect(back.length).toBe(FX.k1_lisboa.cards.length);
    for (const c of back) { expect(c.photo_ref).toMatch(/^places\//); expect(c.place_id).toMatch(/^ChIJ/); }
  });
});

describe("#16 · sin frase de relleno del clima", () => {
  it("el clima ya no abre con 'Consulto el clima de … en MET Norway, la misma fuente de tu pantalla Clima.'", () => {
    const m = FX.t02_clima.message as string;
    const p = planTurn({ message: m, intents: detectIntents(m), trip: VALLE, todayISO: HOY, coords: null, hasPriveSession: false, exigente: false } as any);
    expect(p.prefetch.some((s) => s.name === "get_weather")).toBe(true);
    expect(leadSentence(p, { message: m })).toBeNull();
  });
});
