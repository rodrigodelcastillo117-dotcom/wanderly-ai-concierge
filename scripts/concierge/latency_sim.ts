// Perfil de latencia del turno COMPLETO de Iato (Rendimiento, cierre 2026-10): corre el index.ts REAL de
// concierge-chat en Deno con fetch simulado (Supabase Auth/REST/RPC, funciones de herramientas, SerpApi y
// la Messages API en streaming) y latencias fijas (LAT, abajo). No toca red ni producción: todo fetch
// se responde aquí. Mide desde que entra la petición: encabezados, primer paso (status), primer texto
// (delta, incluida la frase de inicio), primer texto del MODELO, final y cierre del stream.
//
// Uso (Deno 2.1, el runtime de Supabase):
//   deno run -A --no-lock scripts/concierge/latency_sim.ts supabase/functions/concierge-chat/index.ts [corridas]
// Para comparar con otra versión, pasa la ruta a su index.ts (p. ej. un worktree del commit anterior).
// No incluye la red app ↔ Supabase ni el arranque en frío (en vivo suman ~1–1.3 s al primer evento).
const INDEX = new URL(Deno.args[0], `file://${Deno.cwd()}/`).href;
const RUNS = Number(Deno.args[1] ?? 3);
const SCALE = Number(Deno.env.get("SIM_SCALE") ?? 1);
for (const [k, v] of Object.entries({
  SUPABASE_URL: "https://sim.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_PUBLISHABLE_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc",
  ANTHROPIC_API_KEY: "sk-sim", LOVABLE_API_KEY: "lv-sim", SERPAPI_PRIVATE_KEY: "serp-sim", MASTER_PROMPT_IATOS: "",
})) Deno.env.set(k, v);

// ═══ Latencias (ms, servidor de la función → servicio) ═══
export const LAT = {
  auth: 120, rest: 70, rpc: 80, insert: 80,
  tool: { "flight-status": 2200, "flights-search": 6500, "places-search": 1600, "place-details": 700, "places-nearby": 1300, "tripadvisor-search": 2500 } as Record<string, number>,
  serp: 2200,
  model: {
    headers: 300,
    ttft: { "claude-haiku-5-5": 900, "claude-sonnet-5-5": 1700 } as Record<string, number>,
    charsPerSec: { "claude-haiku-5-5": 600, "claude-sonnet-5-5": 280 } as Record<string, number>,
  },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / SCALE));
const U = "11111111-2222-4333-8444-555555555555";
const iso = (k: number) => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);
const TOKIO = { id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: U, destino: "Tokio", pais_destino: "Japón", ciudad_origen: "CDMX", fecha_salida: iso(150), fecha_regreso: iso(160), num_viajeros: 2, created_at: "2026-10-01T00:00:00Z",
  vuelos_json: [{ aerolinea: "ANA", numero_vuelo: "NH179", fecha: iso(150), from: "MEX", to: "NRT", hora_salida: "01:20" }], hospedaje_json: [{ nombre: "Park Hyatt Tokyo", ciudad: "Tokio", direccion: "3-7-1-2 Nishi-Shinjuku" }], itinerario_json: [] };
const PARIS = { id: "aaaaaaaa-0000-4000-8000-000000000002", user_id: U, destino: "París", pais_destino: "Francia", ciudad_origen: "CDMX", fecha_salida: iso(0), fecha_regreso: iso(7), num_viajeros: 2, created_at: "2026-10-02T00:00:00Z",
  vuelos_json: [{ aerolinea: "Air France", numero_vuelo: "AF179", fecha: iso(0), from: "MEX", to: "CDG", hora_salida: "23:55", desde_pdf: true }], hospedaje_json: [{ nombre: "Hôtel Le Marais", ciudad: "París", direccion: "Rue de Rivoli 10", check_in: iso(0), check_out: iso(7), desde_pdf: true }], itinerario_json: [] };
const TRIPS = [PARIS, TOKIO];

const counts: Record<string, number> = {};
const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

function toolData(fn: string, body: any): unknown {
  switch (fn) {
    case "flight-status": return { flight: body.flight, date: body.date, status: "cancelado", terminal: "1", gate: "34", source: "serpapi" };
    case "flights-search": return { ok: true, source: "serpapi", results: [1, 2, 3, 4, 5].map((i) => ({ airline: ["Air France", "Aeroméxico", "Iberia", "KLM", "Lufthansa"][i - 1], price_usd: 800 + i * 90, duration: `${10 + i}h`, stops: i % 2, departure: { id: "MEX", time: `${iso(1)} 1${i}:10` }, buy_url: "https://www.google.com/travel/flights" })) };
    case "places-search": return { results: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `Lugar ${i}`, address: `Calle ${i}`, rating: 4.5, lat: 48.85, lng: 2.35, maps_url: `https://maps.google.com/?cid=${i}` })) };
    case "place-details": return { result: { id: "p1", name: "Lugar 1", opening_hours: ["lunes: 9–22"], phone: "+33 1" } };
    case "places-nearby": return { ok: true, places: [{ name: "Hôpital", address: "Parvis", lat: 48.85, lng: 2.34 }] };
    default: return { ok: true, results: [] };
  }
}

function modelStream(body: any): Response {
  const model = String(body.model);
  const ttft = LAT.model.ttft[model] ?? 1200;
  const cps = LAT.model.charsPerSec[model] ?? 300;
  const visible = "Revisé lo que encontré para tu viaje. " + "Aquí va la recomendación concreta con horarios, precios y la fuente de cada dato. ".repeat(10);
  const data = "\n<<<IATO_DATA>>>\n" + JSON.stringify({ cards: [{ type: "alert", title: "Dato", body: "x".repeat(900) }], actions: [] });
  const text = visible + data;
  const enc = new TextEncoder();
  const ev = (type: string, d: unknown) => enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...(d as object) })}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(ev("message_start", { message: { model, usage: { input_tokens: 5000, output_tokens: 1 } } }));
      await sleep(ttft - LAT.model.headers);
      c.enqueue(ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
      const chunk = 40;
      for (let i = 0; i < text.length; i += chunk) {
        c.enqueue(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + chunk) } }));
        await sleep((chunk / cps) * 1000);
      }
      c.enqueue(ev("content_block_stop", { index: 0 }));
      c.enqueue(ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: Math.round(text.length / 4) } }));
      c.enqueue(ev("message_stop", {}));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const rawBody = init?.body ?? null;
  const body = typeof rawBody === "string" ? (() => { try { return JSON.parse(rawBody); } catch { return null; } })() : null;
  const accept = new Headers(init?.headers ?? {}).get("accept") ?? "";
  if (url.host === "sim.supabase.co") {
    const p = url.pathname;
    if (p === "/auth/v1/user") { bump("auth"); await sleep(LAT.auth); return json({ id: U, aud: "authenticated", role: "authenticated", email: "sim@example.com" }); }
    if (p.startsWith("/rest/v1/rpc/")) {
      const fn = p.slice(13); bump(`rpc:${fn}`); await sleep(LAT.rpc);
      switch (fn) {
        case "check_rate_limit": return json({ allowed: true });
        case "concierge_runtime_config": return json({ models: null, exigente: { limit: null, used: 0 } });
        case "reserve_quota": return json({ allowed: true, reason: "pro", remaining: null, reservation_id: crypto.randomUUID() });
        case "live_search_take": return json({ allowed: true, plan: "pro" });
        case "serp_cache_get": return json(null);
        default: return json(null);
      }
    }
    if (p.startsWith("/rest/v1/")) {
      const t = p.slice(9); bump(`${method}:${t}`); await sleep(method === "GET" ? LAT.rest : LAT.insert);
      if (method !== "GET") return json(null, 201);
      let rows: any[] = [];
      if (t === "trips") { const id = url.searchParams.get("id"); rows = id ? TRIPS.filter((x) => `eq.${x.id}` === id) : TRIPS; }
      if (t === "profiles") rows = [{ full_name: "Ana", ciudad_origen: "CDMX", active_trip_id: null }];
      const single = accept.includes("vnd.pgrst.object");
      return single ? json(rows[0] ?? null) : json(rows);
    }
    if (p.startsWith("/functions/v1/")) {
      const fn = p.slice(14); bump(`fn:${fn}`); await sleep(LAT.tool[fn] ?? 1500);
      return json(toolData(fn, body));
    }
  }
  if (url.host === "serpapi.com") { bump("serpapi"); await sleep(LAT.serp); return json({ organic_results: [{ title: "Resultado", link: "https://ejemplo.com", snippet: "Dato con fuente", source: "Ejemplo" }] }); }
  if (url.host === "api.anthropic.com") { bump(`model:${body?.model}`); await sleep(LAT.model.headers); return modelStream(body); }
  if (url.host === "es.wikipedia.org") { await sleep(800); return json({ pages: [] }); }
  return json({ error: "sim_unknown_host" }, 404);
}) as typeof fetch;

let handler: ((req: Request) => Promise<Response>) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: any) => { handler = typeof h === "function" ? h : h.handler; return { finished: Promise.resolve(), shutdown: async () => {} }; };
const quiet = Deno.env.get("SIM_VERBOSE") ? null : (() => { const o = { log: console.log, warn: console.warn, error: console.error }; console.log = () => {}; console.warn = () => {}; console.error = () => {}; return o; })();
const out = quiet?.log ?? console.log;
await import(INDEX);
if (!handler) throw new Error("index.ts no llamó a Deno.serve");

const SCEN = [
  { id: "1", message: "ayúdame con mi viaje a Japón", trip: TOKIO.id },
  { id: "2", message: "¿qué vuelo me conviene más?", trip: TOKIO.id },
  { id: "3", message: "mi vuelo se canceló", trip: PARIS.id },
  { id: "4", message: "perdí mi conexión", trip: PARIS.id },
  { id: "5", message: "quiero cenar cerca de mi hotel", trip: PARIS.id },
  { id: "7", message: "ya cambié de hotel", trip: PARIS.id },
  { id: "8", message: "necesito ayuda urgente", trip: PARIS.id, coords: { lat: 48.8566, lng: 2.3522 } },
  { id: "centurion", message: "dónde está la centurion dentro de la T1 DE CDMX", trip: null },
];

async function ask(s: typeof SCEN[number]) {
  const t0 = performance.now();
  const res = await handler!(new Request("https://fn.sim/concierge-chat", {
    method: "POST", headers: { Authorization: "Bearer sim", "Content-Type": "application/json", Accept: "text/event-stream", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify({ messages: [{ role: "user", content: s.message }], trip_id: s.trip, stream: true, client_date: iso(0), tz: "America/Mexico_City", context: { coords: s.coords ?? null } }),
  }));
  const headersAt = performance.now() - t0;
  let firstStatus: number | null = null, firstText: number | null = null, finalAt: number | null = null, closedAt = 0;
  let firstTextValue = ""; let firstModelText: number | null = null;
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const type = /event: (\w+)/.exec(raw)?.[1]; const at = performance.now() - t0;
      if (type === "status") firstStatus ??= at;
      if (type === "delta") {
        let t = ""; try { t = JSON.parse(/data: (.*)/s.exec(raw)![1]).text; } catch { /* */ }
        if (firstText === null) { firstText = at; firstTextValue = t; }
        // El modelo simulado siempre empieza con "Revisé lo que": así se separa de la frase de inicio.
        if (firstModelText === null && t.includes("Revisé lo que")) firstModelText = at;
      }
      if (type === "final") finalAt = at;
    }
  }
  closedAt = performance.now() - t0;
  const r = (x: number | null) => (x === null ? null : Math.round(x * SCALE));
  return { headers: r(headersAt), firstStatus: r(firstStatus), firstText: r(firstText), firstModelText: r(firstModelText), final: r(finalAt), closed: r(closedAt), lead: firstTextValue.slice(0, 70) };
}

const rows: Record<string, any[]> = {};
for (let k = 0; k < RUNS; k++) for (const s of SCEN) (rows[s.id] ??= []).push(await ask(s));
const med = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const summary = Object.fromEntries(Object.entries(rows).map(([id, rs]) => [id, { headers: med(rs.map((x) => x.headers)), firstStatus: med(rs.map((x) => x.firstStatus)), firstText: med(rs.map((x) => x.firstText)), firstModelText: med(rs.map((x) => x.firstModelText)), final: med(rs.map((x) => x.final)), closed: med(rs.map((x) => x.closed)), lead: rs[0].lead }]));
out(JSON.stringify({ summary, calls_per_turn: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(v / (RUNS * SCEN.length)).toFixed(2)])) }, null, 1));
Deno.exit(0);
