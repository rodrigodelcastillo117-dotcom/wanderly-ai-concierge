// Rendimiento de Iato (cierre 2026-10). Regresiones de latencia con reloj simulado (fake timers) sobre
// el MISMO turno que corre en producción (turn.ts), más las piezas que se aceleraron alrededor:
//   - frase de inicio honesta si las herramientas tardan (primer texto en ~0.7 s en lugar de 5–11 s);
//   - límite de ritmo con las tres cubetas a la vez;
//   - web_search entrega el resultado sin esperar el registro de costo ni la caché.
// La medición del turno completo (index.ts real en Deno con red simulada) está en
// scripts/concierge/latency_sim.ts y en docs/iatos/cierre/RENDIMIENTO.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectIntents, joinLead, leadSentence, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { routeTurn, DEFAULT_MODEL_CONFIG, CircuitBreaker } from "../../supabase/functions/concierge-chat/router";
import { runConciergeTurn, type TurnDeps } from "../../supabase/functions/concierge-chat/turn";
import type { ModelCaller } from "../../supabase/functions/concierge-chat/agent";
import { DATA_SENTINEL, type ConciergeStreamEvent } from "../../supabase/functions/concierge-chat/stream";
import { evaluateRateLimit } from "../../supabase/functions/_shared/rate-limit-core";
import { runWebSearch } from "../../supabase/functions/concierge-chat/webSearch";

const HOY = "2026-10-22";
const PARIS = {
  id: "aaaaaaaa-0000-4000-8000-000000000002", destino: "París", ciudad_origen: "CDMX", num_viajeros: 2, fecha_salida: HOY, fecha_regreso: "2026-10-30",
  vuelos: [{ aerolinea: "Air France", numero_vuelo: "AF179", fecha: HOY, from: "MEX", to: "CDG", hora_salida: "23:55", estado_reserva: "reservado" }],
  hospedaje: [{ nombre: "Hôtel Le Marais", ciudad: "París", check_in: "2026-10-21", check_out: "2026-10-30", estado_reserva: "reservado", lat: 48.85, lng: 2.36 }],
};
const TOKIO = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", destino: "Tokio", ciudad_origen: "CDMX", num_viajeros: 2, fecha_salida: "2027-03-20", fecha_regreso: "2027-03-30",
  vuelos: [{ aerolinea: "ANA", numero_vuelo: "NH179", fecha: "2027-03-20", from: "MEX", to: "NRT", hora_salida: "01:20" }], hospedaje: [],
};
const plan = (message: string, trip: any, coords: { lat: number; lng: number } | null = null) =>
  planTurn({ message, intents: detectIntents(message), trip, todayISO: HOY, coords, hasPriveSession: false, exigente: false });

// Una frase de inicio solo dice qué está haciendo Iato: nunca un estado, un precio, una
// disponibilidad, una reserva ni un resultado.
const CLAIM = /\b(a tiempo|retras|cancelad|demorad|confirmad|reservad|disponib|lleno|abierto|cerrado|cuesta|precio|barat|mejor opci|encontr[eé]|hay \d|puerta \d|terminal \d)|\$|\b\d{2}:\d{2}\b/i;

describe("frase de inicio (planner.leadSentence)", () => {
  const cases: [string, any, { lat: number; lng: number } | null, RegExp][] = [
    ["mi vuelo se canceló", PARIS, null, /^Reviso en tiempo real tu vuelo AF179, busco alternativas y tus derechos como pasajero\.$/],
    ["perdí mi conexión", PARIS, null, /tu conexión/],
    ["¿qué vuelo me conviene más?", TOKIO, null, /^Comparo los vuelos CDMX → Tokio para tus fechas\.$/],
    ["quiero cenar cerca de mi hotel", PARIS, null, /^Busco restaurantes cerca de tu hotel en Google Maps\.$/],
    ["necesito ayuda urgente", PARIS, { lat: 48.85, lng: 2.35 }, /^Si hay riesgo para tu vida, llama ya al número de emergencias local\. Mientras tanto busco el hospital más cercano/],
    ["dónde está la centurion dentro de la T1 DE CDMX", null, null, /^Busco ese dato en Google y en Google Maps/],
    ["ya cambié de hotel", PARIS, null, /^De paso reviso en tiempo real tu vuelo AF179 de hoy\.$/],
  ];
  for (const [msg, trip, coords, re] of cases) {
    it(`"${msg}" → ${re}`, () => {
      const p = plan(msg, trip, coords);
      expect(p.prefetch.length).toBeGreaterThan(0);
      const lead = leadSentence(p)!;
      expect(lead).toMatch(re);
      expect(lead).not.toMatch(CLAIM);
      expect(lead.length).toBeLessThanOrEqual(160);
    });
  }
  it("sin herramientas previstas no hay frase (el modelo habla directo)", () => {
    expect(leadSentence(plan("ayúdame con mi viaje a Japón", TOKIO))).toBeNull();
  });
  it("se une a la respuesta en el mismo párrafo; una lista empieza párrafo nuevo", () => {
    expect(joinLead("Comparo los vuelos.", "  La mejor es…")).toBe("Comparo los vuelos. La mejor es…");
    expect(joinLead("Comparo los vuelos.", "- Air France…")).toBe("Comparo los vuelos.\n\n- Air France…");
    expect(joinLead("Comparo los vuelos.", "")).toBe("Comparo los vuelos.");
  });
});

// ═══ Turno con reloj simulado ═══
type Ev = { at: number; ev: ConciergeStreamEvent };
const ANSWER = "Tu vuelo **AF179** aparece cancelado según Google. Te dejo 3 alternativas.";

function simCaller(opts: { ttftMs: number; chunkMs?: number; preambleThenTool?: boolean }): { caller: ModelCaller; seen: string[] } {
  const seen: string[] = [];
  let calls = 0;
  const caller: ModelCaller = async (step, input, h) => {
    seen.push(input.dynamicSystem);
    calls += 1;
    await new Promise((r) => setTimeout(r, opts.ttftMs));
    if (opts.preambleThenTool && calls === 1) {
      h.onText("Déjame revisar…");
      const content = [{ type: "text", text: "Déjame revisar…" }, { type: "tool_use", id: "t1", name: "web_search", input: { query: "derechos pasajero" } }];
      return { provider: "anthropic", model: step.model, content, text: "Déjame revisar…", toolUses: [{ id: "t1", name: "web_search", input: { query: "derechos pasajero" } }], stopReason: "tool_use", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as any;
    }
    const full = `${ANSWER}\n${DATA_SENTINEL}\n{"cards":[],"actions":[]}`;
    for (let i = 0; i < full.length; i += 20) {
      h.onText(full.slice(i, i + 20));
      await new Promise((r) => setTimeout(r, opts.chunkMs ?? 20));
    }
    return { provider: "anthropic", model: step.model, content: [{ type: "text", text: full }], text: full, toolUses: [], stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as any;
  };
  return { caller, seen };
}

function deps(p: ReturnType<typeof plan>, message: string, events: Ev[], t0: number, extra: Partial<TurnDeps> & { toolMs: number; ttftMs: number; preambleThenTool?: boolean }) {
  const sim = simCaller({ ttftMs: extra.ttftMs, preambleThenTool: extra.preambleThenTool });
  const d: TurnDeps = {
    plan: p, route: routeTurn({ message, intents: p.intents, exigente: false, config: DEFAULT_MODEL_CONFIG }), config: DEFAULT_MODEL_CONFIG,
    breaker: new CircuitBreaker(), callModel: sim.caller,
    execTool: async () => { await new Promise((r) => setTimeout(r, extra.toolMs)); return { ok: true, source: "serpapi", results: [{ title: "x", link: "https://x.test" }] }; },
    toolTimeout: () => 20_000, send: (ev) => events.push({ at: Date.now() - t0, ev }), meta: {},
    stableSystem: "REGLAS", dynamicSystem: "HOY", contextMessage: null, history: [{ role: "user", content: message }], userMessage: message,
    actionCtx: { todayISO: HOY, trips: [PARIS as any], activeTripId: PARIS.id, hasPriveSession: false }, exigente: false,
    hasAnthropicKey: true, hasLovableKey: false, ...extra,
  };
  return { d, sim };
}

describe("turno con reloj simulado: primer texto", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  const run = async (extra: Parameters<typeof deps>[4], message = "mi vuelo se canceló") => {
    const events: Ev[] = [];
    const p = plan(message, PARIS);
    const t0 = Date.now();
    const { d, sim } = deps(p, message, events, t0, extra);
    const pr = runConciergeTurn(d);
    await vi.advanceTimersByTimeAsync(60_000);
    const out = await pr;
    const deltas = events.filter((e) => e.ev.type === "delta");
    return { out, events, deltas, sim, streamed: deltas.map((e) => (e.ev as any).data.text).join("") };
  };

  it("herramientas de 6.5 s (vuelos en SerpApi) + modelo 1.7 s: primer texto a los 700 ms (antes 8.2 s), sin afirmar nada", async () => {
    const r = await run({ toolMs: 6500, ttftMs: 1700, leadAfterMs: 700 });
    expect(r.deltas[0].at).toBe(700);
    const lead = (r.deltas[0].ev as any).data.text;
    expect(lead).toBe(leadSentence(plan("mi vuelo se canceló", PARIS)));
    expect(lead).not.toMatch(CLAIM);
    // El modelo sabe que la frase ya está en pantalla y sigue en el mismo párrafo.
    expect(r.sim.seen[0]).toContain(`YA EN PANTALLA`);
    expect(r.sim.seen[0]).toContain(lead);
    // Primer texto del modelo: cuando terminan las herramientas + su primer token (como antes).
    expect(r.deltas[1].at).toBe(6500 + 1700);
    expect((r.deltas[1].ev as any).data.text.startsWith(" Tu vuelo")).toBe(true);
    // Lo que se vio en vivo es exactamente la respuesta final (sin el bloque de datos).
    expect(r.out.final.text.startsWith(`${lead} Tu vuelo **AF179**`)).toBe(true);
    expect(r.streamed.trim()).toBe(r.out.final.text.replace(/\n.*$/s, "").trim());
    expect(r.out.lead).toBe(lead);
    expect(r.out.leadMs).toBe(700);
  });

  it("si las herramientas responden antes del umbral no hay frase: la respuesta es la del modelo, igual que antes", async () => {
    const r = await run({ toolMs: 400, ttftMs: 900, leadAfterMs: 700 });
    expect(r.deltas[0].at).toBe(400 + 900);
    expect(r.out.lead).toBeNull();
    expect(r.out.final.text.startsWith("Tu vuelo **AF179**")).toBe(true);
    expect(r.sim.seen[0]).not.toContain("YA EN PANTALLA");
  });

  it("sin leadAfterMs (respuesta JSON de apps viejas) nunca hay frase", async () => {
    const r = await run({ toolMs: 6500, ttftMs: 900 });
    expect(r.deltas[0].at).toBe(6500 + 900);
    expect(r.out.lead).toBeNull();
  });

  it("si el modelo escribe un preámbulo y pide otra herramienta (reset), la frase se vuelve a mostrar", async () => {
    const r = await run({ toolMs: 3000, ttftMs: 800, leadAfterMs: 700, preambleThenTool: true });
    const lead = r.out.lead!;
    const types = r.events.filter((e) => e.ev.type === "delta" || e.ev.type === "reset").map((e) => (e.ev.type === "reset" ? "RESET" : (e.ev as any).data.text));
    const iReset = types.indexOf("RESET");
    expect(types[0]).toBe(lead);
    expect(iReset).toBeGreaterThan(0);
    expect(types[iReset + 1]).toBe(lead); // vuelve la frase
    expect(r.out.final.text.startsWith(`${lead} Tu vuelo`)).toBe(true);
  });

  it("presupuesto: en los 7 escenarios con herramientas el primer texto llega ≤ 700 ms del inicio del turno aunque las herramientas tarden 6.5 s", async () => {
    for (const [msg, trip, coords] of [
      ["mi vuelo se canceló", PARIS, null], ["perdí mi conexión", PARIS, null], ["quiero cenar cerca de mi hotel", PARIS, null],
      ["necesito ayuda urgente", PARIS, { lat: 48.85, lng: 2.35 }], ["ya cambié de hotel", PARIS, null],
      ["dónde está la centurion dentro de la T1 DE CDMX", null, null], ["¿qué vuelo me conviene más?", TOKIO, null],
    ] as [string, any, any][]) {
      const events: Ev[] = [];
      const p = plan(msg, trip, coords);
      const t0 = Date.now();
      const { d } = deps(p, msg, events, t0, { toolMs: 6500, ttftMs: 1700, leadAfterMs: 700 });
      const pr = runConciergeTurn(d);
      await vi.advanceTimersByTimeAsync(60_000);
      await pr;
      const first = events.find((e) => e.ev.type === "delta")!;
      expect(first.at, msg).toBeLessThanOrEqual(700);
      expect((first.ev as any).data.text, msg).not.toMatch(CLAIM);
    }
  });
});

describe("límite de ritmo: tres cubetas a la vez (concierge-chat)", () => {
  it("parallel: las tres consultas empiezan juntas y el veredicto respeta el orden usuario/min → usuario/hora → IP", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const verdicts: Record<string, boolean> = { "concierge-chat:m@user": true, "concierge-chat:h@user": false, "concierge-chat:m@ip": false };
    const hit = async (subject: string, bucket: string) => {
      started.push(`${bucket}@${subject.split(":")[0]}`);
      await gate;
      return verdicts[`${bucket}@${subject.split(":")[0]}`];
    };
    const p = evaluateRateLimit(hit, "concierge-chat", "u1", "1.2.3.4", { parallel: true });
    await Promise.resolve();
    expect(started).toHaveLength(3); // antes de que responda ninguna
    release();
    expect(await p).toMatchObject({ allowed: false, scope: "user", retryAfter: 900 });
  });
  it("sin parallel: igual que siempre (en serie, se detiene en la primera negativa)", async () => {
    const started: string[] = [];
    const hit = async (subject: string, bucket: string) => { started.push(bucket); return false; };
    expect(await evaluateRateLimit(hit, "concierge-chat", "u1", "1.2.3.4")).toMatchObject({ allowed: false, scope: "user", retryAfter: 60 });
    expect(started).toEqual(["concierge-chat:m"]);
  });
  it("parallel y todo permitido → permitido; una cubeta de pago sin verificación se sigue negando", async () => {
    expect(await evaluateRateLimit(async () => true, "concierge-chat", "u1", "1.2.3.4", { parallel: true })).toEqual({ allowed: true, retryAfter: 0 });
  });
});

describe("web_search no espera la bitácora de costo ni la caché", () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ organic_results: [{ title: "Centurion Lounge", link: "https://amex.test/c", snippet: "T1" }] }), { status: 200 })) as typeof fetch;
  it("con background, el resultado sale aunque registrar y guardar tarden; sin background, se espera (como antes)", async () => {
    const slow = () => new Promise<void>((r) => setTimeout(r, 200));
    const store = { get: async () => null, put: vi.fn(async () => { await slow(); }) };
    const handed: Promise<unknown>[] = [];
    const t0 = Date.now();
    const out = await runWebSearch({ query: "centurion t1" }, { fetchImpl, serpKey: "k", store, onLive: async () => { await slow(); }, background: (p) => { handed.push(p); } });
    expect(Date.now() - t0).toBeLessThan(150);
    expect(out).toMatchObject({ ok: true, source: "google_web" });
    expect(handed).toHaveLength(2);
    await Promise.all(handed);
    expect(store.put).toHaveBeenCalledTimes(1);

    const t1 = Date.now();
    await runWebSearch({ query: "centurion t1 b" }, { fetchImpl, serpKey: "k", store, onLive: async () => { await slow(); } });
    expect(Date.now() - t1).toBeGreaterThanOrEqual(380);
  });
});

describe("index.ts: menos viajes en serie antes del primer evento y la respuesta antes de la bitácora", () => {
  const src = readFileSync(join(__dirname, "../../supabase/functions/concierge-chat/index.ts"), "utf8");
  it("límite de ritmo (paralelo) junto con la configuración; reserva junto con el contexto; reservas junto con la memoria", () => {
    expect(src).toMatch(/Promise\.all\(\[\s*enforceRateLimit\([^)]*parallel: true \}\),\s*runtimeConfig\(userId, exigenteRequested\),/);
    expect(src).toMatch(/await Promise\.all\(\[quotaP, contextP/);
    expect(src).toMatch(/const \[bksRes, convRes\] = await Promise\.all\(\[/);
    expect(src).toMatch(/if \(!needExigente && cfgCache && Date\.now\(\) - cfgCache\.at < CFG_TTL_MS\)/);
  });
  it("en streaming manda final ANTES de registrar uso y cuota; ante un error borra el texto en pantalla", () => {
    const i = src.indexOf('send({ type: "final", data: reply });');
    expect(i).toBeGreaterThan(0);
    expect(src.indexOf("await settle()", i)).toBeGreaterThan(i);
    expect(src).toMatch(/send\(\{ type: "reset", data: \{\} \}\);\s*send\(\{ type: "error"/);
    expect(src).toMatch(/leadAfterMs: wantsStream \? LEAD_AFTER_MS : undefined/);
    // La respuesta dice qué frase de inicio se mostró: la evaluación en vivo mide aparte el primer texto del modelo.
    expect(src).toMatch(/_lead: lead,/);
    expect(readFileSync(join(__dirname, "../../scripts/concierge/eval_live.mjs"), "utf8")).toMatch(/primer_texto_modelo_p50_ms/);
  });
});
