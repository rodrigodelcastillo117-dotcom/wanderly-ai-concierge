// Ola "9.5 en TODO" (29-oct-2026) — chat de Iato, lado del servidor. Las respuestas son REALES de
// producción (fixtures/ola95Chat.json: 7 mensajes a Iato con la cuenta demo, main 7d5b2c4); todo lo demás
// es simulado: sin red ni mensajes a Iato.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { detectIntents, leadSentence, planTurn, isTheftOrLoss, thinkingText, EXPENSE_QUERY_NOTE, toolStatusText } from "../../supabase/functions/concierge-chat/planner";
import { summarizeExpenses } from "../../supabase/functions/concierge-chat/expenses";
import { applyHonesty, processBoilerplate, spanishRating, unsourcedForecast, type HonestyCtx } from "../../supabase/functions/concierge-chat/honesty";
import { resolveTurnPlace } from "../../supabase/functions/concierge-chat/turnPlace";
import { dayskyLabel } from "../../supabase/functions/_shared/weather";
import { FIXER_RULE, SYSTEM } from "../../supabase/functions/concierge-chat/prompt";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import { CircuitBreaker, DEFAULT_MODEL_CONFIG, routeTurn } from "../../supabase/functions/concierge-chat/router";
import type { ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { THINK_STEP_ID, type ConciergeStreamEvent } from "../../supabase/functions/concierge-chat/stream";
import { computeTripGaps } from "../../supabase/functions/concierge-chat/context";
import { isDomesticTrip } from "../../supabase/functions/concierge-chat/honesty";

const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "ola95Chat.json"), "utf8"));
const ROOT = join(__dirname, "..", "..");
const HOY = "2026-10-29";
const CDMX = { lat: 19.4326, lng: -99.1332 };
const VB = {
  id: "b5feaa3f-1bd8-4839-8ba4-b40919c81b67", destino: "Valle de Bravo", pais_destino: "México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01",
  num_viajeros: 2, ciudad_origen: "Ciudad de México", vuelos_json: [{ modo: "autobus", from: "CDMX", to: "Valle de Bravo" }], hospedaje_json: [],
};
const plan = (message: string, extra: Record<string, unknown> = {}) => planTurn({
  message, intents: detectIntents(message), trip: VB, todayISO: HOY, coords: CDMX, hasPriveSession: false, exigente: false, position: "away", ...extra,
});
const ctx = (userMessage: string, tools: string[] = []): HonestyCtx => ({ trips: [VB] as any, userMessage, todayISO: HOY, toolsWithData: () => new Set(tools) });

describe("Gastos: '¿cuánto llevo gastado?' con los gastos registrados (antes: 'no tengo un registro de gastos')", () => {
  it("se detecta como consulta, no como registrar un gasto", () => {
    expect(detectIntents("¿Cuánto llevo gastado en mi viaje a Valle de Bravo?")).toContain("expense_query");
    expect(detectIntents("¿Cuánto hemos gastado en Oaxaca?")).toContain("expense_query");
    expect(detectIntents("muéstrame mis gastos del viaje")).toContain("expense_query");
    const reg = detectIntents("Registra un gasto de 120 pesos en café hoy en mi viaje a Valle de Bravo");
    expect(reg).toContain("expense");
    expect(reg).not.toContain("expense_query");
    expect(detectIntents("¿Dónde ceno hoy cerca de aquí?")).not.toContain("expense_query");
  });
  it("el plan consulta get_trip_expenses del viaje antes del modelo, con su paso en vivo", () => {
    const p = plan("¿Cuánto llevo gastado en mi viaje a Valle de Bravo?");
    expect(p.prefetch).toContainEqual({ name: "get_trip_expenses", args: { trip_id: VB.id }, reason: "gastos registrados" });
    expect(p.notes).toContain(EXPENSE_QUERY_NOTE);
    expect(EXPENSE_QUERY_NOTE).toMatch(/no sumes monedas distintas/);
    expect(EXPENSE_QUERY_NOTE).toMatch(/según tus gastos registrados en IATOS/);
    expect(toolStatusText("get_trip_expenses", {})).toBe("Revisando tus gastos registrados…");
    const index = readFileSync(join(ROOT, "supabase/functions/concierge-chat/index.ts"), "utf8");
    expect(index).toMatch(/if \(name === "get_trip_expenses"\)/);
    expect(index).toMatch(/from\("expenses"\)\.select\("amount, currency, category, description, expense_date, trip_id"\)\.eq\("user_id", c\.userId\)/);
  });
  it("resumen con los 6 gastos reales de la cuenta demo: por moneda, sin sumar MXN con USD", () => {
    const rows = [
      { amount: "50", currency: "USD", category: "Restaurantes", description: "PRUEBA AUDITORÍA cena en dólares", expense_date: "2026-10-28" },
      { amount: "600", currency: "MXN", category: "Restaurantes", description: "PRUEBA AUDITORÍA comida compartida", expense_date: "2026-10-28" },
      { amount: "150", currency: "MXN", category: "Gastronomía", description: "PRUEBA AUDITORÍA café", expense_date: "2026-10-28" },
      { amount: "150", currency: "MXN", category: "Restaurantes", description: "PRUEBA AUDITORÍA R2 café", expense_date: "2026-10-28" },
      { amount: "95", currency: "MXN", category: "Restaurantes", description: "PRUEBA AUDITORÍA R3 tacos", expense_date: "2026-10-28" },
      { amount: "120", currency: "MXN", category: "Restaurantes", description: "Café (PRUEBA AUDITORÍA R4)", expense_date: "2026-10-29" },
    ];
    const s = summarizeExpenses(rows, { tripLabel: "Valle de Bravo" });
    expect(s.numero_de_gastos).toBe(6);
    expect(s.total_por_moneda).toEqual([{ moneda: "MXN", total: 1115, gastos: 5 }, { moneda: "USD", total: 50, gastos: 1 }]);
    expect(s.por_categoria[0]).toEqual({ categoria: "Restaurantes", moneda: "MXN", total: 965 });
    expect(s.ultimos[0]).toMatchObject({ fecha: "2026-10-29", monto: 120, moneda: "MXN" });
    expect(s.alcance).toBe("viaje a Valle de Bravo");
    expect(s.fuente).toMatch(/Gastos registrados en IATOS/);
    expect(summarizeExpenses([]).nota).toMatch(/No hay gastos registrados/);
  });
  it("la respuesta real de producción era falsa: decía que no había registro e inventaba 'un café de 150 MXN en tus notas'", () => {
    expect(FX.d_gasto_1.text).toMatch(/No tengo un registro de gastos/);
    expect(FX.d_gasto_1.tools).not.toContain("get_trip_expenses");
  });
});

describe("Plan de un día: itinerario del día + clima consultado (antes: 7 s en blanco y 'el pronóstico marca chubascos' sin fuente)", () => {
  it("'Ármame el plan del sábado 31' es un plan del día, con get_weather de ese día y la nota de formato", () => {
    const msg = "Ármame el plan del sábado 31 en Valle de Bravo";
    expect(detectIntents(msg)).toContain("day_plan");
    expect(detectIntents("¿Qué hago mañana en Oaxaca?")).toContain("day_plan");
    expect(detectIntents("plan de luna de miel en París")).not.toContain("day_plan");
    const p = plan(msg, { requested: null });
    expect(p.prefetch).toContainEqual({ name: "get_weather", args: { city: "Valle de Bravo", date_from: "2026-10-31", date_to: "2026-10-31" }, reason: "clima del día" });
    const note = p.notes.find((n) => n.startsWith("Plan del día"))!;
    expect(note).toMatch(/\(sáb 31 oct\)/);
    expect(note).toMatch(/máximo 6 viñetas de una línea/);
    expect(note).toMatch(/si no se consultó, no hables del clima/);
    expect(note).toContain(`export_calendar {trip_id: "${VB.id}", fecha: "2026-10-31"}`);
    // La respuesta real no consultó nada.
    expect(FX.a_plan_1.tools).toEqual([]);
  });
  it("fuera del pronóstico (más de 9 días) no se consulta el clima", () => {
    const p = plan("Ármame el plan del 20 de noviembre en Valle de Bravo");
    expect(p.prefetch.some((x) => x.name === "get_weather")).toBe(false);
  });
  it("'chubascos' con 0.1 mm en el día ahora es 'chubascos aislados' (respuesta real: 'chubascos… lluvia de apenas 0.1 mm')", () => {
    expect(FX.a_plan_2.text).toMatch(/chubascos\*\*?, con máxima[\s\S]*0\.1 mm/);
    expect(dayskyLabel(80, 0.1)).toBe("chubascos aislados");
    expect(dayskyLabel(80, 0.7)).toBe("chubascos aislados");
    expect(dayskyLabel(80, 3.2)).toBe("chubascos");
    expect(dayskyLabel(61, 0)).toBe("chubascos aislados");
    expect(dayskyLabel(0, 0)).toBe("despejado");
  });
});

describe("Robo o pérdida: policía y pasos, no hospital (antes: 'Busco el hospital… Si estás herida, el Hospital de Jesús')", () => {
  it("se distingue de una urgencia médica", () => {
    expect(isTheftOrLoss("Me robaron la cartera en la calle, ¿qué hago?")).toBe(true);
    expect(isTheftOrLoss("Perdí mi pasaporte")).toBe(true);
    expect(isTheftOrLoss("Me asaltaron y estoy herido")).toBe(false);
    expect(isTheftOrLoss("Me siento mal, ¿cuál es el hospital más cercano?")).toBe(false);
  });
  it("busca la policía más cercana; la tarjeta dice 911 y la nota pide los pasos en orden", () => {
    const p = plan("Me robaron la cartera en la calle, ¿qué hago?");
    expect(p.prefetch).toContainEqual({ name: "search_nearby", args: { lat: CDMX.lat, lng: CDMX.lng, kind: "police" }, reason: "policía más cercana" });
    expect(p.prefetch.some((x) => x.args.kind === "hospital")).toBe(false);
    expect((p.cards[0] as any).body).toMatch(/911 en México/);
    expect(p.notes.join(" ")).toMatch(/NO hables de hospitales/);
    expect(leadSentence(p, { message: "Me robaron la cartera" })).toBe("Busco la policía más cercana a tu ubicación.");
    // Urgencia médica: igual que antes.
    const m = plan("Me siento mal, ¿cuál es el hospital más cercano a mí ahora?");
    expect(m.prefetch).toContainEqual(expect.objectContaining({ name: "search_nearby", args: expect.objectContaining({ kind: "hospital" }) }));
    expect(FX.f_robo_1.tools).toEqual(["search_nearby"]);
    expect(FX.f_robo_1.text).toMatch(/^Busco el hospital más cercano/);
  });
  it("la respuesta es de donde está el usuario ('cerca de ti, Ciudad de México'), no 'sobre Valle de Bravo'", () => {
    expect(FX.f_robo_1.place_label).toBe("Valle de Bravo");
    const r = resolveTurnPlace({ message: "Me robaron la cartera en la calle, ¿qué hago?", trips: [VB], pinnedId: VB.id, todayISO: HOY, user: { coords: CDMX, place: "Ciudad de México" }, position: "away" });
    expect(r.scope).toBe("here");
    expect(r.label).toBe("Ciudad de México");
  });
});

describe("Menos relleno: lo que ya dice la tarjeta no se repite en el texto", () => {
  it("chofer: se quita 'Te respondemos en la app (Concierge › Mis solicitudes) y por correo.'", () => {
    const out = applyHonesty(FX.e_chofer_1.text, ctx("Necesito un chofer que nos lleve de la CDMX a Valle de Bravo el viernes en la mañana")).text;
    expect(FX.e_chofer_1.text).toMatch(/Te respondemos en la app \(Concierge › Mis solicitudes\) y por correo\./);
    expect(out).not.toMatch(/Mis solicitudes/);
    expect(out).toMatch(/lo atiende una persona del equipo IATOS, sujeta a disponibilidad\./);
    expect(out).toMatch(/El precio lo cotiza el equipo; no tengo una cifra\./);
    expect(out).toMatch(/dímelo y lo incluyo en la solicitud\.$/);
    // La tarjeta de la acción sí lo dice.
    expect(FX.e_chofer_1.actions[0].note).toMatch(/verás su respuesta en la app y por correo/);
  });
  it("robo: se quita 'La solicitud la verás en Concierge › Mis solicitudes y por correo.'", () => {
    const out = applyHonesty(FX.f_robo_1.text, ctx("Me robaron la cartera en la calle, ¿qué hago?", ["search_nearby"])).text;
    expect(out).not.toMatch(/La solicitud la verás/);
    expect(out).toMatch(/Te dejo el botón para que una persona del equipo IATOS te acompañe/);
  });
  it("mesa (Modo exigente, ronda 4): se quita 'Primero verás a quién y qué se le escribirá…' y se queda 'Aún no está reservado.'", () => {
    const text = "Te dejo el botón para preparar la solicitud a El Mesón. Primero verás a quién y qué se le escribirá, y nada se envía sin tu confirmación. Aún no está reservado.";
    const out = applyHonesty(text, ctx("Recomiéndame dónde y apártame mesa", ["search_places"])).text;
    expect(out).toBe("Te dejo el botón para preparar la solicitud a El Mesón. Aún no está reservado.");
  });
  it("si el usuario pregunta justo eso (dónde ve la respuesta), sí se dice", () => {
    expect(processBoilerplate("Te respondemos en la app (Concierge › Mis solicitudes) y por correo.", { userMessage: "¿Dónde veo la respuesta de mi solicitud?" })).toBe(false);
    expect(processBoilerplate("Te respondemos en la app (Concierge › Mis solicitudes) y por correo.", { userMessage: "Necesito un chofer" })).toBe(true);
  });
  it("el prompt ya no pide repetirlo y pide formato de celular", () => {
    expect(FIXER_RULE).toMatch(/NO lo repitas en el texto/);
    expect(SYSTEM).toMatch(/Formato para celular/);
    expect(SYSTEM).toMatch(/No repitas lo que ya dicen las tarjetas y los botones/);
    expect(SYSTEM).toMatch(/"calificación" \(no "rating"\)/);
  });
});

describe("Nada de clima sin fuente y todo en español", () => {
  it("plan del día: 'El pronóstico marca chubascos…' sin get_weather en el turno se quita; lo demás queda", () => {
    const out = applyHonesty(FX.a_plan_1.text, ctx("Ármame el plan del sábado 31 en Valle de Bravo")).text;
    expect(FX.a_plan_1.text).toMatch(/El pronóstico marca chubascos para el sábado/);
    expect(out).not.toMatch(/pronóstico/);
    expect(out).toMatch(/Si quieres que revise horarios de Soleado, Bocatto o el paseo en lancha, lo busco\./);
    expect(out).toMatch(/- \*\*17:00:\*\* Mirador La Peña/);
  });
  it("con get_weather en el turno, o si preguntó por el clima, el pronóstico se queda", () => {
    expect(unsourcedForecast("El pronóstico marca chubascos aislados para el sábado.", ctx("Ármame el plan del sábado", ["get_weather"]))).toBe(false);
    expect(unsourcedForecast("Se esperan chubascos.", ctx("¿Va a llover ese día?"))).toBe(false);
    expect(unsourcedForecast("No puedo darte el pronóstico ahora.", ctx("Ármame el plan"))).toBe(false);
    expect(applyHonesty(FX.a_plan_2.text, ctx("¿Va a llover ese día?", ["get_weather"])).text).toBe(FX.a_plan_2.text);
  });
  it("'rating 4.7' → 'calificación 4.7' (respuesta real de la cena)", () => {
    const out = applyHonesty(FX.b_cena_1.text, ctx("¿Dónde ceno rico hoy cerca de aquí?", ["search_places"])).text;
    expect(FX.b_cena_1.text).toMatch(/rating 4\.7/);
    expect(out).not.toMatch(/rating/i);
    expect(out).toMatch(/\*\*Terraza Umbral\*\*, calificación 4\.7, acepta reservación\./);
    expect(spanishRating("Rating de 4.5")).toBe("Calificación de 4.5");
  });
});

describe("Velocidad percibida: paso en vivo cuando no hay nada que consultar (antes: 4–7.5 s de 'escribiendo…')", () => {
  it("el plan trae el texto del paso según la pregunta", () => {
    expect(plan("¿Qué me falta para mi viaje a Valle de Bravo?").thinking).toBe("Revisando tu viaje a Valle de Bravo…");
    expect(plan("¿Cuál es la capital de Portugal?").thinking).toBe("Preparando tu respuesta…");
    expect(plan("Ayúdame con mi viaje a Valle de Bravo: qué tengo y qué me falta").thinking).toBe("Revisando tu viaje a Valle de Bravo…");
    expect(thinkingText(["day_plan"], VB)).toBe("Revisando tu itinerario de Valle de Bravo…");
    // Con consultas previas (gastos, clima) el paso es el de la herramienta.
    expect(plan("¿Cuánto llevo gastado en mi viaje a Valle de Bravo?").thinking).toBeUndefined();
  });
  it("el turno manda el paso 'running' antes del primer texto y lo cierra al llegar el texto", async () => {
    const events: ConciergeStreamEvent[] = [];
    const text = "Para Valle de Bravo te falta reservar el hospedaje.";
    const caller: ModelCaller = async (step, _i, h) => {
      for (const chunk of text.match(/[\s\S]{1,9}/g) ?? []) h.onText(chunk);
      return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    };
    const message = "Ayúdame con mi viaje a Valle de Bravo";
    await runConciergeTurn({
      plan: { intents: ["trip_overview"], prefetch: [], notes: [], toolHints: [], suggestedActions: [], cards: [], thinking: "Revisando tu viaje a Valle de Bravo…" },
      route: routeTurn({ message, intents: [], exigente: false, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(),
      callModel: caller, execTool: async () => ({}), toolTimeout: () => 1000, send: (ev) => events.push(ev),
      meta: {}, stableSystem: "s", dynamicSystem: "d", contextMessage: null, history: [{ role: "user", content: message }], userMessage: message,
      exigente: false, hasAnthropicKey: true, hasLovableKey: false, actionCtx: { todayISO: HOY, trips: [], activeTripId: null },
    });
    const kinds = events.map((e) => (e.type === "status" ? `status:${(e.data as any).state}` : e.type));
    expect(kinds.slice(0, 3)).toEqual(["meta", "status:running", "status:done"]);
    expect(kinds[3]).toBe("delta");
    expect(events[1].data).toEqual({ id: THINK_STEP_ID, text: "Revisando tu viaje a Valle de Bravo…", state: "running" });
    expect(events.filter((e) => e.type === "status")).toHaveLength(2);
  });
});

describe("Lo que falta: sin 'plan de datos internacional' en un viaje nacional", () => {
  it("Valle de Bravo desde CDMX no pide eSIM (respuesta real: 'eSIM. Sirve para llegar conectado')", () => {
    expect(FX.c_falta_1.text).toMatch(/\*\*eSIM\.\*\*/);
    expect(isDomesticTrip(VB as any, "Ciudad de México")).toBe(true);
    const ids = (o?: { domestic?: boolean }) => computeTripGaps(VB, [], HOY, o).map((g) => g.id);
    expect(ids()).toContain("esim");
    expect(ids({ domestic: true })).not.toContain("esim");
    expect(ids({ domestic: true })).toContain("seguro");
    const index = readFileSync(join(ROOT, "supabase/functions/concierge-chat/index.ts"), "utf8");
    expect(index).toMatch(/computeTripGaps\(trip, confirmedBookings, todayISO, \{ domestic: isDomesticTrip\(trip, profile\?\.ciudad_origen \?\? null\) \}\)/);
  });
});
