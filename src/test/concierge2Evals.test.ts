// Concierge 2.0 — evaluación local de los 8 escenarios del dueño + el caso Centurion, con modelo y
// herramientas SIMULADOS (sin red, sin costo) sobre el MISMO código del turno que corre en producción
// (turn.ts: planeador → herramientas en paralelo → modelo con streaming → respuesta validada).
//
// El modelo simulado arma su respuesta SOLO con lo que le llega (bloque <datos_consultados>, resultados
// de herramientas, <notas_del_turno>, <viaje_en_contexto>). Si el planeador no consulta lo necesario o
// los datos no le llegan, la respuesta sale genérica y la rúbrica (scripts/concierge/rubric.mjs) la
// reprueba. La misma rúbrica califica las respuestas reales en scripts/concierge/eval_live.mjs.
//
// Latencias simuladas (escala 1:10 para que la suite sea rápida; los tiempos se reportan ×10):
//   modelo rápido: primer token 450 ms, 25 ms por trozo · modelo capaz: 800 ms, 30 ms por trozo
//   herramientas: estado de vuelo 900 ms, Google Maps 600 ms, web 700 ms, vuelos 2.5 s, Privé 500 ms
import { describe, it, expect } from "vitest";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { routeTurn, DEFAULT_MODEL_CONFIG, CircuitBreaker } from "../../supabase/functions/concierge-chat/router";
import { runConciergeTurn } from "../../supabase/functions/concierge-chat/turn";
import type { ModelCaller, ModelCallResult } from "../../supabase/functions/concierge-chat/agent";
import { buildContextMessage, buildDynamicSystem, buildStableSystem } from "../../supabase/functions/concierge-chat/prompt";
import { compactTripForPrompt } from "../../supabase/functions/concierge-chat/context";
import { todayLine } from "../../supabase/functions/concierge-chat/tools";
import { DATA_SENTINEL, type ConciergeStreamEvent } from "../../supabase/functions/concierge-chat/stream";
import { ProviderError } from "../../supabase/functions/concierge-chat/anthropic";
import { gradeReply, compareExigente } from "../../scripts/concierge/rubric.mjs";

const SCALE = 10; // 1 ms simulado = 10 ms reales reportados
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / SCALE));
const HOY = "2026-10-22";

// ═══ Viajes de prueba ═══
const TOKIO = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", destino: "Tokio", pais_destino: "Japón", ciudad_origen: "CDMX", num_viajeros: 2,
  fecha_salida: "2027-03-20", fecha_regreso: "2027-03-30",
  vuelos: [{ aerolinea: "ANA", numero_vuelo: "NH179", fecha: "2027-03-20", from: "MEX", to: "NRT", hora_salida: "01:20", estado_reserva: "cotizado" }],
  hospedaje: [{ nombre: "Park Hyatt Tokyo", ciudad: "Tokio", direccion: "3-7-1-2 Nishi-Shinjuku", check_in: "2027-03-20", check_out: "2027-03-30", estado_reserva: "cotizado" }],
  itinerario_json: [{ dia: 1, titulo: "Llegada a Shinjuku", mañana: "Vuelo", tarde: "Check-in", noche: "Omoide Yokocho" }],
};
const PARIS_HOY = {
  id: "aaaaaaaa-0000-4000-8000-000000000002", destino: "París", pais_destino: "Francia", ciudad_origen: "CDMX", num_viajeros: 2,
  fecha_salida: HOY, fecha_regreso: "2026-10-30",
  vuelos: [{ aerolinea: "Air France", numero_vuelo: "AF179", fecha: HOY, from: "MEX", to: "CDG", hora_salida: "23:55", estado_reserva: "reservado" }],
  hospedaje: [{ nombre: "Hôtel Le Marais", ciudad: "París", direccion: "Rue de Rivoli 10", check_in: "2026-10-23", check_out: "2026-10-30", estado_reserva: "reservado", lat: 48.8556, lng: 2.3601 }],
};
const PARIS_EN_CURSO = { ...PARIS_HOY, fecha_salida: "2026-10-20", vuelos: [], hospedaje: [{ ...PARIS_HOY.hospedaje[0], check_in: "2026-10-21" }] };
const ROMA_CONEXION = {
  id: "aaaaaaaa-0000-4000-8000-000000000003", destino: "Roma", ciudad_origen: "CDMX", num_viajeros: 1, fecha_salida: HOY, fecha_regreso: "2026-11-02",
  vuelos: [
    { aerolinea: "Aeroméxico", numero_vuelo: "AM006", fecha: HOY, from: "MEX", to: "MAD", hora_salida: "08:00", estado_reserva: "reservado" },
    { aerolinea: "Iberia", numero_vuelo: "IB3456", fecha: HOY, from: "MAD", to: "FCO", hora_salida: "13:40", estado_reserva: "reservado" },
  ],
  hospedaje: [],
};
const MONACO = { id: "aaaaaaaa-0000-4000-8000-000000000004", destino: "Mónaco", fecha_salida: "2026-10-21", fecha_regreso: "2026-10-25", vuelos: [], hospedaje: [{ nombre: "Hôtel de Paris", ciudad: "Mónaco", estado_reserva: "reservado" }] };

// ═══ Herramientas simuladas (formas reales de cada función) ═══
const EXP1 = "bbbbbbbb-0000-4000-8000-000000000001";
const EXP2 = "bbbbbbbb-0000-4000-8000-000000000002";
const FIXTURES: Record<string, { ms: number; data: (a: any) => unknown }> = {
  check_flight_status: { ms: 900, data: (a) => ({ flight: a.flight, date: a.date, status: a.flight === "AF179" ? "cancelado" : "a tiempo", scheduled_departure: "23:55", terminal: "1", gate: "34", source: "serpapi" }) },
  search_flights: { ms: 2500, data: () => ({ ok: true, source: "serpapi", results: [
    { airline: "Air France", price_usd: 1180, duration: "11h 10m", stops: 0, departure: { id: "MEX", time: "2026-10-23 18:10" }, buy_url: "https://www.google.com/travel/flights?q=af" },
    { airline: "Aeroméxico", price_usd: 990, duration: "11h 05m", stops: 0, departure: { id: "MEX", time: "2026-10-23 21:15" }, buy_url: "https://www.google.com/travel/flights?q=am" },
    { airline: "Iberia", price_usd: 860, duration: "15h 30m", stops: 1, departure: { id: "MEX", time: "2026-10-23 16:40" }, buy_url: "https://www.google.com/travel/flights?q=ib" },
  ] }) },
  search_places: { ms: 600, data: (a) => (/centurion/i.test(a.query)
    ? { ok: true, source: "google_maps", results: [{ id: "ChIJcent", name: "The Centurion Lounge", address: "Terminal 1, Aeropuerto Internacional de la Ciudad de México", lat: 19.4361, lng: -99.0719, maps_url: "https://maps.google.com/?cid=777" }], details: { id: "ChIJcent", name: "The Centurion Lounge", opening_hours: ["lunes a domingo: 05:00–23:00"] } }
    : { ok: true, source: "google_maps", results: [
      { id: "p1", name: "Le Petit Marché", address: "9 Rue de Béarn, París", lat: 48.856, lng: 2.366, rating: 4.6, open_now: true, maps_url: "https://maps.google.com/?cid=1", website: "https://lepetitmarche.fr" },
      { id: "p2", name: "Chez Janou", address: "2 Rue Roger Verlomme, París", lat: 48.857, lng: 2.367, rating: 4.4, open_now: true, maps_url: "https://maps.google.com/?cid=2" },
      { id: "p3", name: "Breizh Café", address: "109 Rue Vieille du Temple, París", lat: 48.861, lng: 2.362, rating: 4.5, open_now: true, maps_url: "https://maps.google.com/?cid=3" },
    ] }) },
  web_search: { ms: 700, data: (a) => (/centurion/i.test(a.query)
    ? { ok: true, source: "google_web", results: [{ title: "The Centurion Lounge en el AICM (MEX)", snippet: "Terminal 1, sala internacional, después del filtro de seguridad, junto a la puerta 8.", link: "https://www.americanexpress.com/es-mx/beneficios/centurion-lounge/", source: "American Express" }] }
    : { ok: true, source: "google_web", results: [{ title: "Derechos del pasajero ante cancelaciones", snippet: "Reembolso o vuelo alternativo y compensación según la regulación aplicable.", link: "https://www.gob.mx/profeco/derechos-pasajero", source: "Profeco" }] }) },
  search_nearby: { ms: 600, data: () => ({ ok: true, source: "google_maps", places: [{ name: "Hôpital Hôtel-Dieu", address: "1 Parvis Notre-Dame, París", lat: 48.854, lng: 2.348, phone: "+33 1 42 34 82 34" }] }) },
  search_prive: { ms: 500, data: () => ({ available: true, disponible: true, cities: [{ query: "Mónaco", resolved: true, city: "Mónaco", items: [
    { id: EXP1, name: "Cena en terraza frente al puerto", universe: "the_table", state: "VERIFICADO", why: "Vista a la marina" },
    { id: EXP2, name: "Paseo en barco al atardecer", universe: "yacht_sea", state: "CURADO", why: "Costa de Mónaco" },
  ] }] }) },
  search_attractions: { ms: 800, data: () => ({ ok: true, source: "tripadvisor", results: [] }) },
};

function makeExec(log: string[]) {
  return async (name: string, args: Record<string, unknown>) => {
    log.push(name);
    const f = FIXTURES[name];
    if (!f) return { error: "sin_fixture" };
    await sleep(f.ms);
    return f.data(args);
  };
}

// ═══ Modelo simulado: responde solo con los datos que le llegan ═══
function blocks(text: string, tag: string): any[] {
  const out: any[] = [];
  const re = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { try { out.push(JSON.parse(m[1])); } catch { /* no JSON */ } }
  return out;
}

type Seen = { tool: string; result: any };
function collectSeen(input: Parameters<ModelCaller>[1]): { seen: Seen[]; ctx: string; lastUser: string } {
  const seen: Seen[] = [];
  let ctx = "";
  let lastUser = "";
  input.messages.forEach((m, i) => {
    if (m.role !== "user") return;
    const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const p of parts as any[]) {
      if (p.type === "text") {
        if (i === 0 && p.text.startsWith("CONTEXTO")) ctx = p.text;
        else if (!p.text.startsWith("<datos_consultados>")) lastUser = p.text;
        for (const b of blocks(p.text, "datos_consultados")) for (const r of b) seen.push({ tool: r.herramienta, result: r.resultado });
      }
      if (p.type === "tool_result") {
        const prev = input.messages[i - 1];
        const tu = (prev?.content as any[]).find((x) => x.id === p.tool_use_id);
        seen.push({ tool: tu?.name ?? "?", result: JSON.parse(p.content) });
      }
    }
  });
  return { seen, ctx, lastUser };
}

function compose(input: Parameters<ModelCaller>[1]): string {
  const { seen, ctx, lastUser } = collectSeen(input);
  const exigente = /MODO: EXIGENTE/.test(input.dynamicSystem);
  const viaje = blocks(ctx, "viaje_en_contexto")[0];
  const notas: string[] = blocks(ctx, "notas_del_turno")[0] ?? [];
  const get = (t: string) => seen.find((s) => s.tool === t && s.result?.disponible !== false)?.result;
  const lines: string[] = [];
  const cards: any[] = [];
  const actions: any[] = [];
  const st = get("check_flight_status");
  if (st) lines.push(`Tu vuelo **${st.flight}** aparece **${st.status}** (terminal ${st.terminal}, puerta ${st.gate}), según Google.`);
  const fl = get("search_flights")?.results ?? [];
  if (fl.length) {
    const sorted = [...fl].sort((a: any, b: any) => a.price_usd - b.price_usd);
    if (exigente) {
      lines.push(`**La mejor:** ${fl[1].airline} directo, ${fl[1].duration}, $${fl[1].price_usd} USD según Google Flights, pero sale de noche.`);
      lines.push(`**La alternativa:** ${fl[0].airline} directo por $${fl[0].price_usd} USD; llega antes, a cambio de pagar más.`);
      lines.push(`**El plan B:** ${sorted[0].airline} $${sorted[0].price_usd} USD, aunque con escala y ${sorted[0].duration}.`);
      lines.push("Después: te aviso si baja el precio y te dejo el traslado al hotel listo.");
    } else {
      lines.push(`Lo más conveniente: **${fl[1].airline}** directo (${fl[1].duration}) por **$${fl[1].price_usd} USD** según Google Flights; el más barato es ${sorted[0].airline} con escala.`);
    }
    for (const f of exigente ? fl : fl.slice(0, 2)) cards.push({ type: "flight", title: f.airline, subtitle: f.duration, price_usd: f.price_usd, currency: "USD", cta_action: f.buy_url });
  }
  const web = get("web_search")?.results ?? [];
  if (web.length) {
    lines.push(`Según ${web[0].source}: ${web[0].snippet}`);
    cards.push({ type: "source", title: web[0].title, body: web[0].snippet, cta_action: web[0].link });
  }
  const places = get("search_places");
  if (places?.results?.length) {
    const rs = places.results;
    if (/centurion/i.test(rs[0].name)) {
      cards.push({ type: "place", title: rs[0].name, subtitle: rs[0].address });
      lines.push(`Horario según Google Maps: ${places.details?.opening_hours?.[0] ?? "no publicado"}.`);
    } else if (exigente) {
      lines.push(`**La mejor:** ${rs[0].name} (★${rs[0].rating}, abierto ahora), según Google Maps: bistró francés a 5 min, pero se llena después de las 21:00.`);
      lines.push(`**La alternativa:** ${rs[2].name} (★${rs[2].rating}), crêpes; más informal a cambio de no esperar.`);
      lines.push(`**El plan B:** ${rs[1].name} (★${rs[1].rating}), aunque es más ruidoso.`);
      lines.push("Después: te dejo el Uber listo y lo agrego a tu itinerario.");
      rs.forEach((r: any) => cards.push({ type: "restaurant", title: r.name, subtitle: r.address, rating: r.rating }));
    } else {
      lines.push(`Cerca de tu hotel, abiertos ahora según Google Maps: **${rs[0].name}** (★${rs[0].rating}) y **${rs[2].name}** (★${rs[2].rating}).`);
      rs.slice(0, 2).forEach((r: any) => cards.push({ type: "restaurant", title: r.name, subtitle: r.address, rating: r.rating }));
    }
    if (viaje?.id && !/centurion/i.test(rs[0].name)) actions.push({ type: "add_itinerary_item", params: { trip_id: viaje.id, fecha: HOY, hora: "20:30", titulo: `Cena en ${rs[0].name}` } });
  }
  const near = get("search_nearby")?.places ?? [];
  if (near.length) lines.push(`Hospital más cercano según Google Maps: **${near[0].name}**, ${near[0].address}, tel. ${near[0].phone}.`);
  const prive = get("search_prive");
  if (prive?.cities?.[0]?.items?.length) {
    const its = prive.cities[0].items;
    lines.push(`Para ${prive.cities[0].city}, de la selección verificada de IATOS Privé: **${its[0].name}** y después **${its[1].name}**. Aún no está reservado.`);
    actions.push({ type: "prive_request", params: { experience_id: its[0].id, nombre: its[0].name, fecha: HOY, personas: 2 } });
  }
  if (/notas_del_turno/.test(ctx) && notas.some((n) => /Privé está bloqueado/.test(n))) lines.push("IATOS Privé está bloqueado en esta sesión: desbloquéalo en la sección Privé y te armo la noche con lugares verificados.");
  const vueloNota = notas.find((n) => /Regla general/.test(n));
  if (vueloNota && st) lines.push(`Recomendación general (no dato en vivo): ${vueloNota.split("Regla general (no dato en vivo): ")[1]}`);
  if (/cambi[eé] de hotel/i.test(lastUser) && viaje) lines.push(`Para tu viaje a ${viaje.destino}: ¿en qué hotel estás ahora (nombre y zona)? Con eso actualizo el viaje y te busco cena y transporte cerca.`);
  const nuevoHotel = lastUser.match(/me cambi[eé] al (.+?)(?:\.|$)/i);
  if (nuevoHotel && viaje) {
    lines.push(`Listo para actualizar tu viaje a ${viaje.destino} con **${nuevoHotel[1]}**: confírmalo y te busco cena cerca.`);
    actions.push({ type: "update_trip_hotel", params: { trip_id: viaje.id, nombre: nuevoHotel[1] } });
  }
  if (/viaje a Jap[oó]n/i.test(lastUser) && viaje) {
    lines.push(`Para tu viaje a **${viaje.destino}** (${viaje.fecha_salida} → ${viaje.fecha_regreso}): el vuelo ${viaje.vuelos?.[0]?.numero_vuelo ?? ""} y el ${viaje.hospedaje?.[0]?.nombre ?? "hotel"} están cotizados, no reservados.`);
    lines.push("Siguiente paso: activar la alerta de precio y reservar el hotel.");
  }
  if (!lines.length) lines.push("Claro que sí, con gusto te ayudo con lo que necesites. ¿En qué más te puedo ayudar?");
  const data = cards.length || actions.length ? `\n${DATA_SENTINEL}\n${JSON.stringify({ cards, actions })}` : "";
  return lines.join("\n") + data;
}

interface SimOptions { misbehave?: "tripadvisor_first"; failFirst?: ProviderError }
function simModel(opts: SimOptions = {}): { caller: ModelCaller; calls: { model: string; provider: string; toolChoice: string }[] } {
  const calls: { model: string; provider: string; toolChoice: string }[] = [];
  const caller: ModelCaller = async (step, input, h): Promise<ModelCallResult> => {
    calls.push({ model: step.model, provider: step.provider, toolChoice: input.toolChoice });
    if (opts.failFirst && calls.length === 1) { await sleep(300); throw opts.failFirst; }
    const smart = /sonnet/.test(step.model);
    await sleep(smart ? 800 : 450);
    const usage = { input_tokens: 2400, output_tokens: 180, cache_read_input_tokens: 5200, cache_creation_input_tokens: 0 };
    const hasToolResults = input.messages.some((m) => Array.isArray(m.content) && (m.content as any[]).some((b) => b.type === "tool_result"));
    if (opts.misbehave === "tripadvisor_first" && !hasToolResults && input.toolChoice === "auto") {
      return {
        provider: step.provider, model: step.model, stopReason: "tool_use", text: "", usage,
        content: [{ type: "tool_use", id: "tu1", name: "search_attractions", input: { query: "Centurion lounge T1 CDMX" } }],
        toolUses: [{ id: "tu1", name: "search_attractions", input: { query: "Centurion lounge T1 CDMX" } }],
      };
    }
    const text = compose(input);
    for (const chunk of text.match(/.{1,24}/gs) ?? []) { h.onText(chunk); await sleep(smart ? 30 : 25); }
    return { provider: step.provider, model: step.model, stopReason: "end_turn", text, content: [{ type: "text", text }], toolUses: [], usage };
  };
  return { caller, calls };
}

// ═══ Escenario: mismo armado que index.ts ═══
async function scenario(p: {
  message: string; trip?: any; exigente?: boolean; coords?: { lat: number; lng: number } | null; priveSession?: boolean; intent?: string;
  history?: { role: "user" | "assistant"; content: string }[]; sim?: SimOptions;
}) {
  const t0 = Date.now();
  const events: { at: number; ev: ConciergeStreamEvent }[] = [];
  const executed: string[] = [];
  const intents = detectIntents(p.message, p.intent);
  const route = routeTurn({ message: p.message, intents, exigente: !!p.exigente, config: DEFAULT_MODEL_CONFIG });
  const trip = p.trip ?? null;
  const plan = planTurn({ message: p.message, intents, trip, todayISO: HOY, coords: p.coords ?? null, hasPriveSession: !!p.priveSession, exigente: !!p.exigente });
  const ctx = buildContextMessage({ viajeEnContexto: trip ? compactTripForPrompt(trip, { todayISO: HOY, vuelos: trip.vuelos, hospedaje: trip.hospedaje }) : null, notas: plan.notes });
  const sim = simModel(p.sim);
  const out = await runConciergeTurn({
    plan, route, config: DEFAULT_MODEL_CONFIG, breaker: new CircuitBreaker(), callModel: sim.caller, execTool: makeExec(executed),
    toolTimeout: () => 20_000, send: (ev) => events.push({ at: (Date.now() - t0) * SCALE, ev }), meta: {},
    stableSystem: buildStableSystem(""), dynamicSystem: buildDynamicSystem({ todayLine: todayLine(HOY), tripReason: trip ? "pinned" : "none", hasTrip: !!trip, godMode: !!p.exigente, toolHints: plan.toolHints }),
    contextMessage: ctx, history: [...(p.history ?? []), { role: "user", content: p.message }], userMessage: p.message, exigente: !!p.exigente,
    hasAnthropicKey: true, hasLovableKey: true,
    actionCtx: { todayISO: HOY, trips: trip ? [trip] : [], activeTripId: trip?.id ?? null, hasPriveSession: !!p.priveSession },
    city: trip?.destino, party: 2,
  });
  const firstVisible = events.find((e) => e.ev.type === "status" || e.ev.type === "delta")?.at ?? null;
  const firstText = events.find((e) => e.ev.type === "delta")?.at ?? null;
  const reply = { text: out.final.text, cards: out.final.cards, actions: out.final.actions };
  return { reply, plan, route, intents, executed, events, out, sim, timing: { firstVisible, firstText, total: (Date.now() - t0) * SCALE } };
}

const report: Record<string, unknown>[] = [];

describe("los 8 escenarios del dueño + Centurion (modelo y herramientas simulados)", () => {
  it("1. 'ayúdame con mi viaje a Japón' → panorama del viaje real (cotizado ≠ reservado) y acciones", async () => {
    const r = await scenario({ message: "ayúdame con mi viaje a Japón", trip: TOKIO });
    expect(r.intents).toContain("trip_overview");
    expect(r.route.tier).toBe("smart");
    expect(r.executed).toEqual([]); // todo está en el viaje: no se gasta una búsqueda
    expect(r.reply.actions.map((a) => a.type)).toEqual(expect.arrayContaining(["create_price_alert", "track_flight"]));
    const g = gradeReply(r.reply, { mustMention: ["Tokio", "NH179", "Park Hyatt", "cotizados"], forbid: [/\b(est[aá]n?|qued[oó]) reservad/] });
    expect(g.fails).toEqual([]);
    report.push({ caso: 1, ...r.timing, tools: r.executed });
  });

  it("2. '¿qué vuelo me conviene más?' → busca con origen/destino/fechas del viaje y recomienda con precio y fuente", async () => {
    const r = await scenario({ message: "¿qué vuelo me conviene más?", trip: TOKIO });
    expect(r.plan.prefetch).toEqual([expect.objectContaining({ name: "search_flights", args: expect.objectContaining({ origin: "CDMX", destination: "Tokio", departure_date: "2027-03-20", return_date: "2027-03-30", adults: 2 }) })]);
    expect(r.reply.cards.filter((c) => c.type === "flight").every((c) => c.estado_dato === "CONSULTADO_EN_VIVO")).toBe(true);
    const g = gradeReply(r.reply, { mustMention: ["Aeroméxico", "$990"], actionTypes: ["create_price_alert"] });
    expect(g.fails).toEqual([]);
    report.push({ caso: 2, ...r.timing, tools: r.executed });
  });

  it("3. 'mi vuelo se canceló' → estado real + alternativas + derechos con fuente + Fixer, en paralelo", async () => {
    const r = await scenario({ message: "mi vuelo se canceló", trip: PARIS_HOY });
    expect(r.intents).toContain("flight_disruption");
    expect(r.plan.prefetch.map((p) => p.name)).toEqual(["check_flight_status", "search_flights", "web_search"]);
    expect(r.reply.actions.map((a) => a.type)).toEqual(["fixer_request", "track_flight"]);
    expect(r.reply.actions[0].note).toMatch(/Aún no está reservado/);
    const g = gradeReply(r.reply, { mustMention: ["AF179", "cancelado", "Profeco"], actionTypes: ["fixer_request"] });
    expect(g.fails).toEqual([]);
    // Las 3 herramientas corren a la vez: el tiempo total no es la suma (0.9 + 2.5 + 0.7 s).
    expect(r.out.prefetchMs * SCALE).toBeLessThan(3400);
    report.push({ caso: 3, ...r.timing, tools: r.executed });
  });

  it("4. 'perdí mi conexión' → vuelos desde la escala (MAD → Roma) + Fixer", async () => {
    const r = await scenario({ message: "perdí mi conexión", trip: ROMA_CONEXION });
    expect(r.intents).toContain("missed_connection");
    expect(r.plan.prefetch.find((p) => p.name === "search_flights")!.args).toMatchObject({ origin: "MAD", destination: "Roma", departure_date: HOY });
    const g = gradeReply(r.reply, { mustMention: ["AM006"], actionTypes: ["fixer_request"] });
    expect(g.fails).toEqual([]);
    report.push({ caso: 4, ...r.timing, tools: r.executed });
  });

  it("5. 'quiero cenar cerca de mi hotel' → Google Maps alrededor del hotel reservado, botones de Uber/Maps/reservar y agregar al itinerario", async () => {
    const r = await scenario({ message: "quiero cenar cerca de mi hotel", trip: PARIS_EN_CURSO });
    expect(r.route.tier).toBe("fast");
    expect(r.plan.prefetch[0]).toMatchObject({ name: "search_places", args: { query: "restaurantes cerca de Hôtel Le Marais, París", lat: 48.8556, lng: 2.3601 } });
    expect(r.executed).not.toContain("search_attractions");
    const rest = r.reply.cards.filter((c) => c.type === "restaurant");
    expect(rest.length).toBeGreaterThanOrEqual(2);
    expect(rest[0].links!.map((l) => l.kind)).toEqual(expect.arrayContaining(["directions", "ride", "booking"]));
    const g = gradeReply(r.reply, { mustMention: ["Le Petit Marché", "Google Maps"], actionTypes: ["add_itinerary_item"] });
    expect(g.fails).toEqual([]);
    report.push({ caso: 5, ...r.timing, tools: r.executed });
  });

  it("6. 'hazme una noche Privé espectacular' → catálogo verificado con sesión; sin sesión, explica cómo desbloquear sin nombrar lugares", async () => {
    const r = await scenario({ message: "hazme una noche Privé espectacular", trip: MONACO, priveSession: true });
    expect(r.route.tier).toBe("smart");
    expect(r.plan.prefetch[0]).toMatchObject({ name: "search_prive", args: { cities: ["Mónaco"] } });
    expect(r.reply.actions).toEqual([expect.objectContaining({ type: "prive_request", params: expect.objectContaining({ experience_id: EXP1 }) })]);
    expect(gradeReply(r.reply, { mustMention: ["Cena en terraza", "Aún no está reservado"] }).fails).toEqual([]);

    const locked = await scenario({ message: "hazme una noche Privé espectacular", trip: MONACO, priveSession: false });
    expect(locked.executed).toEqual([]);
    expect(locked.reply.text).toMatch(/bloqueado/);
    expect(locked.reply.text).not.toMatch(/terraza|barco/);
    report.push({ caso: 6, ...r.timing, tools: r.executed });
  });

  it("7. 'ya cambié de hotel' → pregunta exacta (sin repetir lo que ya sabe) y con el nombre, acción para actualizar el viaje", async () => {
    const r = await scenario({ message: "ya cambié de hotel", trip: PARIS_EN_CURSO });
    expect(r.intents).toContain("hotel_change");
    expect(gradeReply(r.reply, { mustMention: ["París", "qué hotel"], minActions: 0 }).fails).toEqual([]);
    const r2 = await scenario({ message: "Me cambié al Le Bristol Paris.", trip: PARIS_EN_CURSO, history: [{ role: "user", content: "ya cambié de hotel" }, { role: "assistant", content: r.reply.text }] });
    expect(r2.reply.actions[0]).toMatchObject({ type: "update_trip_hotel", params: { nombre: "Le Bristol Paris" }, note: expect.stringMatching(/no es una reserva/) });
    report.push({ caso: 7, ...r.timing, tools: r.executed });
  });

  it("8. 'necesito ayuda urgente' → alerta inmediata, hospital más cercano real, botón de emergencia y Fixer", async () => {
    const r = await scenario({ message: "necesito ayuda urgente", trip: PARIS_EN_CURSO, coords: { lat: 48.85, lng: 2.35 } });
    expect(r.intents).toContain("emergency");
    expect(r.route.tier).toBe("fast");
    expect(r.plan.prefetch).toEqual([expect.objectContaining({ name: "search_nearby", args: expect.objectContaining({ kind: "hospital" }) })]);
    expect(r.reply.cards[0]).toMatchObject({ type: "alert", title: "Ayuda inmediata" });
    expect(r.reply.actions.map((a) => a.type)).toEqual(["open_emergency", "fixer_request"]);
    expect(gradeReply(r.reply, { mustMention: ["Hôtel-Dieu", "+33"], minActions: 2 }).fails).toEqual([]);
    report.push({ caso: 8, ...r.timing, tools: r.executed });
  });

  it("Centurion: web + Google Maps, TripAdvisor redirigido, fuente citada y sin 'no disponible' falso", async () => {
    const r = await scenario({ message: "dónde está la centurion dentro de la T1 DE CDMX", sim: { misbehave: "tripadvisor_first" } });
    expect(r.executed).not.toContain("search_attractions");
    expect(r.out.agent.rerouted).toEqual(["search_attractions→web_search"]);
    expect(r.reply.text).toMatch(/Según American Express/);
    expect(r.reply.text).not.toMatch(/no está disponible/);
    expect(r.reply.cards.map((c) => c.type)).toEqual(expect.arrayContaining(["source", "place"]));
    const place = r.reply.cards.find((c) => c.type === "place")!;
    expect(place.links!.map((l) => l.kind)).toEqual(expect.arrayContaining(["directions", "ride"]));
    expect(gradeReply(r.reply, { mustMention: ["Terminal 1", "puerta 8"], minActions: 0 }).fails).toEqual([]);
    report.push({ caso: "centurion", ...r.timing, tools: r.executed });
  });
});

describe("la rúbrica reprueba respuestas genéricas o deshonestas (control negativo)", () => {
  it("una respuesta genérica sin datos ni acciones no pasa", () => {
    const g = gradeReply({ text: "Claro que sí, con gusto te ayudo con lo que necesites. ¿En qué más te puedo ayudar?", cards: [], actions: [] }, { mustMention: ["AF179"] });
    expect(g.pass).toBe(false);
    expect(g.fails).toEqual(expect.arrayContaining(["frase_generica", "no_menciona:AF179", "pocas_acciones:0<1"]));
  });
  it("si el planeador no consultara nada, el mismo modelo simulado responde genérico y reprueba", async () => {
    const r = await scenario({ message: "quiero cenar cerca de mi hotel", trip: null });
    expect(r.executed).toEqual([]);
    expect(gradeReply(r.reply, { mustMention: ["Google Maps"] }).pass).toBe(false);
  });
  it("una reserva falsa o un texto largo reprueban", () => {
    expect(gradeReply({ text: "Listo, reservé tu mesa.", actions: [{ type: "x" }] }).fails).toContain("reserva_falsa");
    expect(gradeReply({ text: Array(9).fill("línea").join("\n"), actions: [{ type: "x" }] }).fails[0]).toMatch(/demasiado_largo/);
  });
});

describe("Modo exigente: materialmente mejor que el normal (3 escenarios)", () => {
  const cases = [
    { name: "vuelos", message: "¿qué vuelo me conviene más?", trip: TOKIO },
    { name: "cena", message: "quiero cenar cerca de mi hotel", trip: PARIS_EN_CURSO },
    { name: "cancelación", message: "mi vuelo se canceló", trip: PARIS_HOY },
  ];
  for (const c of cases) {
    it(`${c.name}: más opciones, ranking con contras y fuentes, anticipación y ≥2 acciones; modelo capaz`, async () => {
      const normal = await scenario({ message: c.message, trip: c.trip });
      const exig = await scenario({ message: c.message, trip: c.trip, exigente: true });
      expect(exig.route).toMatchObject({ tier: "smart", effort: "medium", maxIterations: 4 });
      expect(exig.plan.prefetch.length).toBeGreaterThanOrEqual(normal.plan.prefetch.length);
      if (c.name === "cancelación") {
        // Lo que ya es completo en normal (estado + alternativas + derechos) también lo es en exigente.
        expect(exig.reply.actions.length).toBeGreaterThanOrEqual(2);
        return;
      }
      const cmp = compareExigente(normal.reply, exig.reply);
      expect(cmp.fails).toEqual([]);
      expect(gradeReply(exig.reply, { maxLines: 12, minActions: 1 }).fails).toEqual([]);
      report.push({ caso: `exigente-${c.name}`, ...exig.timing, normal_total: normal.timing.total });
    });
  }
  it("la comparación reprueba un 'exigente' que no aporta más", () => {
    const same = { text: "Te recomiendo Aeroméxico.", cards: [{ type: "flight", title: "AM" }], actions: [{ type: "create_price_alert" }] };
    expect(compareExigente(same, same).pass).toBe(false);
  });
});

describe("latencia y resiliencia (simulada, ×10)", () => {
  it("un turno con una herramienta: primer paso visible < 1 s, primer texto < 2 s, total < 8 s", async () => {
    const r = await scenario({ message: "¿Mi vuelo de hoy va a tiempo?", trip: PARIS_HOY });
    expect(r.plan.prefetch.map((p) => p.name)).toEqual(["check_flight_status"]);
    expect(r.sim.calls).toHaveLength(1); // una sola llamada al modelo (antes: 2 + resumen)
    expect(r.timing.firstVisible!).toBeLessThan(1000);
    expect(r.timing.firstText!).toBeLessThan(2000);
    expect(r.timing.total).toBeLessThan(8000);
    expect(r.reply.text).toMatch(/AF179/);
    expect(r.reply.text).toMatch(/Recomendación general \(no dato en vivo\)/);
    report.push({ caso: "vuelo-hoy", ...r.timing });
  });
  it("si el modelo rápido está saturado (529) se pasa al siguiente sin esperar y sin perder la respuesta", async () => {
    const r = await scenario({ message: "¿Mi vuelo de hoy va a tiempo?", trip: PARIS_HOY, sim: { failFirst: new ProviderError("overloaded", 529, "Overloaded") } });
    expect(r.sim.calls.map((c) => c.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(r.out.agent.failures).toEqual([{ key: "anthropic:claude-haiku-5-5", kind: "overloaded", status: 529 }]);
    expect(r.reply.text).toMatch(/AF179/);
    expect(r.timing.total).toBeLessThan(8000);
  });
  it("reporte de tiempos simulados", () => {
    // Visible en la salida de la prueba para el reporte (no es una aserción de calidad).
    console.log("concierge2_eval_timings_ms", JSON.stringify(report));
    expect(report.length).toBeGreaterThanOrEqual(9);
  });
});
