#!/usr/bin/env node
// Evaluación EN VIVO de Iato (Concierge 2.0) después del despliegue. La corre el líder con una cuenta
// SINTÉTICA (nunca una cuenta real): crea viajes de prueba en esa cuenta, manda los 8 escenarios del
// dueño + el caso Centurion + 3 comparaciones normal vs Modo exigente, califica cada respuesta con la
// misma rúbrica de la evaluación local (rubric.mjs), mide tiempos (primer paso, primer texto, total)
// y borra los viajes de prueba al final.
//
// Cuesta dinero real (modelo + búsquedas en vivo) y gasta mensajes del plan de esa cuenta: ~15 mensajes.
//
// Uso:
//   SUPABASE_URL=https://<proyecto>.supabase.co SUPABASE_ANON_KEY=<publishable> \
//   EVAL_EMAIL=iato-eval@ejemplo.com EVAL_PASSWORD=*** node scripts/concierge/eval_live.mjs [--only=3,centurion] [--json]
//
// Requisitos: Node 18+ (fetch y ReadableStream nativos). La cuenta sintética debe tener PRO (o prueba)
// para no topar con el límite gratuito de 3 mensajes; Privé (escenario 6) solo si se pasa EVAL_PRIVE_SESSION.

import { gradeReply, compareExigente } from "./rubric.mjs";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.EVAL_EMAIL;
const PASSWORD = process.env.EVAL_PASSWORD;
const PRIVE = process.env.EVAL_PRIVE_SESSION ?? "";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const ONLY = typeof args.only === "string" ? new Set(args.only.split(",")) : null;

if (!URL_BASE || !ANON || !EMAIL || !PASSWORD) {
  console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_EMAIL o EVAL_PASSWORD.");
  process.exit(2);
}
if (/@(traveliatos\.life|gmail\.com|hotmail\.com|outlook\.com)$/i.test(EMAIL) && !process.env.EVAL_I_KNOW) {
  console.error("Usa una cuenta sintética dedicada a evaluaciones (o exporta EVAL_I_KNOW=1 si lo es).");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const addDays = (k) => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);

async function login() {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`login ${r.status}: ${j.error_description ?? j.msg ?? "sin token"}`);
  return { token: j.access_token, userId: j.user.id };
}

async function rest(token, method, path, body) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method, headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

/** Manda un mensaje en streaming y devuelve la respuesta final + tiempos. */
async function ask(token, { message, tripId, exigente = false, coords = null, intent, history = [] }) {
  const t0 = performance.now();
  let firstStatus = null, firstText = null;
  const deltas = [];
  const steps = [];
  const res = await fetch(`${URL_BASE}/functions/v1/concierge-chat`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream", ...(PRIVE ? { "x-prive-session": PRIVE } : {}) },
    body: JSON.stringify({ messages: [...history, { role: "user", content: message }], trip_id: tripId ?? null, god_mode: exigente, stream: true, intent, client_date: today, tz: "America/Mexico_City", context: { coords } }),
  });
  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}`, ms: performance.now() - t0 };
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return { reply: await res.json(), legacy: true, timing: { total: Math.round(performance.now() - t0) } };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", final = null, error = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const type = /event: (\w+)/.exec(raw)?.[1];
      const data = JSON.parse(/data: (.*)/s.exec(raw)?.[1] ?? "{}");
      const at = Math.round(performance.now() - t0);
      if (type === "status") { firstStatus ??= at; steps.push(`${data.state}: ${data.text}`); }
      if (type === "delta") { firstText ??= at; deltas.push({ at, text: data.text }); }
      if (type === "final") final = data;
      if (type === "error") error = data;
    }
  }
  // Primer texto del MODELO: si hubo frase de inicio (final._lead), el primer delta que no es ella.
  const lead = final?._lead ?? null;
  const firstModelText = (lead ? deltas.find((d, i) => !(i === 0 && d.text === lead) && d.text !== lead) : deltas[0])?.at ?? null;
  return { reply: final, error, steps, timing: { firstStatus, firstText, firstModelText, total: Math.round(performance.now() - t0) } };
}

const SCENARIOS = (ids) => [
  { id: "1", message: "ayúdame con mi viaje a Japón", tripId: ids.tokio, expect: { mustMention: ["Tokio"] } },
  { id: "2", message: "¿qué vuelo me conviene más?", tripId: ids.tokio, expect: { actionTypes: ["create_price_alert", "fixer_request", "track_flight"] } },
  { id: "3", message: "mi vuelo se canceló", tripId: ids.paris, expect: { mustMention: ["AF179"], actionTypes: ["fixer_request"] } },
  { id: "4", message: "perdí mi conexión", tripId: ids.paris, expect: { actionTypes: ["fixer_request"] } },
  { id: "5", message: "quiero cenar cerca de mi hotel", tripId: ids.paris, expect: { actionTypes: ["add_itinerary_item", "fixer_request", "save_place"] } },
  { id: "6", message: "hazme una noche Privé espectacular", tripId: ids.paris, expect: { minActions: 0 } },
  { id: "7", message: "ya cambié de hotel", tripId: ids.paris, expect: { minActions: 0, mustMention: ["hotel"] } },
  { id: "8", message: "necesito ayuda urgente", tripId: ids.paris, coords: { lat: 48.8566, lng: 2.3522 }, expect: { minActions: 2 } },
  { id: "centurion", message: "dónde está la centurion dentro de la T1 DE CDMX", tripId: null, expect: { minActions: 0, mustMention: ["Terminal 1"], forbid: [/no est[aá] disponible/i] } },
];

async function main() {
  const { token, userId } = await login();
  console.log("Cuenta sintética lista. Creando viajes de prueba…");
  const created = [];
  try {
    const [tokio] = await rest(token, "POST", "trips", {
      user_id: userId, destino: "Tokio", pais_destino: "Japón", ciudad_origen: "CDMX", fecha_salida: addDays(150), fecha_regreso: addDays(160), num_viajeros: 2, status: "listo",
      vuelos_json: [{ aerolinea: "ANA", numero_vuelo: "NH179", fecha: addDays(150), from: "MEX", to: "NRT", hora_salida: "01:20" }],
      hospedaje_json: [{ nombre: "Park Hyatt Tokyo", ciudad: "Tokio", direccion: "3-7-1-2 Nishi-Shinjuku" }],
    });
    created.push(tokio.id);
    const [paris] = await rest(token, "POST", "trips", {
      user_id: userId, destino: "París", pais_destino: "Francia", ciudad_origen: "CDMX", fecha_salida: today, fecha_regreso: addDays(7), num_viajeros: 2, status: "listo",
      vuelos_json: [{ aerolinea: "Air France", numero_vuelo: "AF179", fecha: today, from: "MEX", to: "CDG", hora_salida: "23:55", desde_pdf: true }],
      hospedaje_json: [{ nombre: "Hôtel Le Marais", ciudad: "París", direccion: "Rue de Rivoli 10", check_in: today, check_out: addDays(7), desde_pdf: true }],
    });
    created.push(paris.id);
    const ids = { tokio: tokio.id, paris: paris.id };
    const results = [];
    for (const s of SCENARIOS(ids)) {
      if (ONLY && !ONLY.has(s.id)) continue;
      const r = await ask(token, s);
      const grade = r.reply ? gradeReply(r.reply, s.expect) : { pass: false, fails: [r.error ?? "sin respuesta"] };
      results.push({ id: s.id, pass: grade.pass, fails: grade.fails, timing: r.timing, tools: r.reply?._tools_used, tier: r.reply?._model_tier, provider: r.reply?._provider, steps: r.steps });
      console.log(`${grade.pass ? "PASA" : "FALLA"} ${s.id} · ${JSON.stringify(r.timing)} · ${grade.fails.join(", ")}`);
      if (args.json) console.log(JSON.stringify(r.reply, null, 1));
    }
    for (const s of SCENARIOS(ids).filter((x) => ["2", "5", "3"].includes(x.id))) {
      if (ONLY && !ONLY.has(`x${s.id}`)) continue;
      const normal = await ask(token, s);
      const exig = await ask(token, { ...s, exigente: true });
      const cmp = normal.reply && exig.reply ? compareExigente(normal.reply, exig.reply) : { pass: false, fails: ["sin respuesta"] };
      results.push({ id: `exigente-${s.id}`, pass: cmp.pass, fails: cmp.fails, timing: exig.timing, normal_timing: normal.timing });
      console.log(`${cmp.pass ? "PASA" : "FALLA"} exigente-${s.id} · ${cmp.fails.join(", ")}`);
    }
    const p50 = (xs) => { const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const p95 = (xs) => { const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)] : null; };
    console.log("\nResumen:", JSON.stringify({
      pasan: results.filter((r) => r.pass).length, total: results.length,
      primer_paso_p50_ms: p50(results.map((r) => r.timing?.firstStatus)), primer_texto_p50_ms: p50(results.map((r) => r.timing?.firstText)),
      primer_texto_p95_ms: p95(results.map((r) => r.timing?.firstText)), primer_texto_modelo_p50_ms: p50(results.map((r) => r.timing?.firstModelText)),
      total_p95_ms: p95(results.map((r) => r.timing?.total)),
    }));
    process.exitCode = results.every((r) => r.pass) ? 0 : 1;
  } finally {
    for (const id of created) await rest(token, "DELETE", `trips?id=eq.${id}`).catch((e) => console.warn("no se pudo borrar", id, e.message));
    console.log("Viajes de prueba borrados.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
