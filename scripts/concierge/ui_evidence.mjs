// Evidencia visual del Concierge estilo WhatsApp (caso Huixquilucan, 22-oct-2026). SOLO PRUEBAS:
// nada aquí llama a producción.
//
// · Vite corre con VITE_SUPABASE_URL apuntando a un host simulado y este script responde TODAS las
//   llamadas a ese host con datos ficticios. La respuesta de Iato es la que arma el turno real con
//   herramientas y modelo SIMULADOS (scripts/concierge/make_ui_fixture.ts). El navegador está en
//   Huixquilucan (geolocalización simulada) el 22-oct-2026 a las 20:05 (reloj fijo). Clima y lugar
//   (MET Norway / open-meteo / bigdatacloud) también son simulados. Toda otra petición externa se bloquea.
// · Cada captura lleva la franja "DATOS SIMULADOS".
// · Además de las capturas, mide: desborde horizontal, que ningún atajo quede cortado, que el renglón
//   del encabezado no se desborde y que el compositor quede arriba de la barra inferior (móvil).
//
// Uso:
//   npx vite-node scripts/concierge/make_ui_fixture.ts /tmp/concierge_fixture.json
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock npx vite --host 127.0.0.1 --port 8094 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules/playwright FIXTURE=/tmp/concierge_fixture.json node scripts/concierge/ui_evidence.mjs http://127.0.0.1:8094 <carpeta>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8094";
const OUT = process.argv[3] || "/tmp/concierge-ui";
const FIX = JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
const MOCK_HOST = "supabase-mock.localhost:54399";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/concierge-ui-font-cache";
const EXEC = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  // Pantalla baja (iPhone SE/8): el compositor debe quedar sobre la barra inferior.
  { name: "390x667", width: 390, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
].filter((v) => !process.env.VP || v.name === process.env.VP);

const USER_ID = "00000000-0000-4000-8000-0000000000c1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.parse("2026-10-23T12:00:00Z") / 1000) + 3600 * 24 * 30;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "viajero.prueba@example.com", user_metadata: { full_name: "Rodrigo Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };
const TRIP = { ...FIX.trip, user_id: USER_ID };
const NOW = new Date("2026-10-22T20:05:00-06:00");
const HUIX = { latitude: 19.3606, longitude: -99.3509 };

function fetchFont(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = join(FONT_CACHE, key);
  const meta = file + ".type";
  if (!existsSync(file)) {
    try {
      const args = ["-sS", "-L", "--max-time", "20", "-A", "Mozilla/5.0 Chrome/141", "-o", file, "-w", "%{content_type}", url];
      if (existsSync("/root/.ccr/ca-bundle.crt")) args.unshift("--cacert", "/root/.ccr/ca-bundle.crt");
      writeFileSync(meta, execFileSync("curl", args, { encoding: "utf8" }) || "application/octet-stream");
    } catch { return null; }
  }
  return { body: readFileSync(file), type: existsSync(meta) ? readFileSync(meta, "utf8") : "application/octet-stream" };
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
const sse = (route, events) => route.fulfill({ status: 200, contentType: "text/event-stream", headers: CORS,
  body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`).join("") });

const ACCESS = { is_pro: true, plan: "pro", limits_enforced: false, concierge_used: 4, concierge_limit: null, concierge_remaining: null, trips_used: 1, trips_limit: null, trips_remaining: null };
const CALLS = [];
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  CALLS.push(`${req.method()} ${url.pathname}`);
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (p === "/functions/v1/concierge-chat") {
    const body = JSON.parse(req.postData() || "{}");
    CALLS.push(`  → concierge-chat context=${JSON.stringify(body.context)} msg=${JSON.stringify(body.messages?.at(-1)?.content)}`);
    const meta = { _trip_id: TRIP.id, _trip_reason: FIX.reply._trip_reason, _today: "2026-10-22" };
    return sse(route, [
      { type: "meta", data: meta },
      { type: "status", data: { id: "pre_0", text: "Busco restaurantes cerca de ti en Google Maps · 3 resultados", state: "done" } },
      { type: "final", data: { ...FIX.reply, ...meta } },
    ]);
  }
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/rpc/get_access_state")) return json(route, ACCESS);
  if (p.startsWith("/rest/v1/subscriptions")) return json(route, single ? { status: "active", plan: "pro", trial_end: null, current_period_end: "2026-11-22T00:00:00Z", cancel_at_period_end: false, stripe_customer_id: null } : []);
  if (p.startsWith("/rest/v1/trips")) return json(route, single ? TRIP : [TRIP]);
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: USER_ID, full_name: "Rodrigo Prueba", avatar_url: null, ciudad_origen: "Ciudad de México", active_trip_id: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/rpc/")) return json(route, null);
  if (p.startsWith("/rest/v1/")) return json(route, single ? null : []);
  return json(route, {});
}

const blocked = new Set();
async function newPage(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "block",
    geolocation: HUIX, permissions: ["geolocation"],
  });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return handle(route).catch((e) => { console.log("HANDLE ERROR", u.pathname, e.message); return route.abort(); });
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    // Clima y nombre del lugar SIMULADOS (Huixquilucan, 17 °C).
    if (u.host === "api.open-meteo.com") return json(route, { current: { temperature_2m: 17.2 } });
    // El Concierge pide el clima a MET Norway desde claude/total-clima (integración ola 3).
    if (u.host === "api.met.no") return json(route, { properties: { meta: { updated_at: new Date().toISOString() },
      timeseries: [{ time: new Date().toISOString(), data: { instant: { details: { air_temperature: 17.2 } } } }] } });
    if (u.host === "api.bigdatacloud.net") return json(route, { city: "Huixquilucan", locality: "Huixquilucan", principalSubdivision: "Estado de México" });
    if (u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com") {
      const f = fetchFont(u.toString());
      return f ? route.fulfill({ status: 200, contentType: f.type, headers: { "access-control-allow-origin": "*" }, body: f.body }) : route.abort();
    }
    blocked.add(u.host);
    return route.abort();
  });
  await context.addInitScript(([key, sess]) => {
    try {
      localStorage.setItem(key, JSON.stringify(sess));
      localStorage.setItem("iatos_cookie_consent_v2", "essential");
    } catch { /* noop */ }
    const tag = () => {
      if (document.getElementById("cc-sim")) return;
      const d = document.createElement("div");
      d.id = "cc-sim";
      d.textContent = "DATOS SIMULADOS · evidencia de pruebas";
      d.setAttribute("style", "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);top:4px;background:#b91c1c;color:#fff;font:600 10px system-ui;padding:2px 8px;border-radius:999px;pointer-events:none;opacity:.9");
      document.body?.appendChild(d);
    };
    document.addEventListener("DOMContentLoaded", tag);
    setInterval(tag, 500);
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  return { context, page };
}

const results = [];
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Medidas de layout: lo que el dueño reportó (cortes, desbordes, compositor tapado). */
async function measure(page, name, vp) {
  const m = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = (el) => el && el.getBoundingClientRect();
    const box = r(document.querySelector('[aria-label="Mensaje para Iato"]'));
    const nav = r(document.querySelector('nav[aria-label="Navegación principal"] > div'));
    const ctx = document.querySelector('[data-testid="concierge-context"]');
    const shortcutsEl = document.querySelector('[data-testid="concierge-shortcuts"]');
    const shortcuts = [...(shortcutsEl?.querySelectorAll("li button") ?? [])].map((b) => {
      const x = b.getBoundingClientRect();
      return { label: b.textContent.trim(), left: Math.round(x.left), right: Math.round(x.right), top: Math.round(x.top), bottom: Math.round(x.bottom), clipped: b.scrollWidth > b.clientWidth + 1 };
    });
    const nonEmpty = shortcuts.filter((s) => s.label);
    const vertical = nonEmpty.every((s, i) => i === 0 || s.top >= nonEmpty[i - 1].bottom - 1);
    return {
      horizontalOverflow: document.documentElement.scrollWidth - vw,
      headerRowOverflow: ctx ? ctx.scrollWidth - ctx.clientWidth : null,
      composerBottom: box ? Math.round(box.bottom) : null,
      bottomNavTop: nav && nav.height > 0 ? Math.round(nav.top) : null,
      composerVisible: !!box && box.bottom <= (nav && nav.height > 0 ? nav.top : vh) + 1 && box.top >= 0,
      shortcuts: nonEmpty.length, shortcutsVertical: vertical,
      shortcutsInside: nonEmpty.every((s) => s.left >= 0 && s.right <= vw && !s.clipped),
      bubbles: { user: document.querySelectorAll('[data-testid="bubble-user"]').length, iato: document.querySelectorAll('[data-testid="bubble-iato"]').length },
    };
  });
  checks.push({ shot: `${name}__${vp.name}`, ...m });
}

async function shot(page, name, vp) {
  const file = join(OUT, `${name}__${vp.name}.png`);
  await page.screenshot({ path: file });
  results.push(file);
  await measure(page, name, vp);
}

async function run(browser, vp) {
  const { context, page } = await newPage(browser, vp);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e.message}\n${(e.stack || "").slice(0, 600)}`));

  // 1) Chat vacío: saludo + atajos en lista vertical dentro del hilo; encabezado compacto.
  await page.goto(`${BASE}/dashboard/concierge`);
  await page.getByLabel("Mensaje para Iato").waitFor({ timeout: 30000 });
  await page.getByText("Huixquilucan · 17°C").waitFor({ timeout: 15000 });
  await page.getByTestId("trip-phase").waitFor({ timeout: 15000 });
  await sleep(800);
  await shot(page, "01-chat-vacio-atajos-verticales", vp);

  // 2) "Cena cerca": burbujas, respuesta corta, cards compactas y "Guardar en favoritos".
  await page.getByRole("button", { name: "Cena cerca" }).click();
  await page.locator('[data-action-type="save_place"]').waitFor({ timeout: 20000 });
  await sleep(900);
  // Inicio del intercambio: tu burbuja (derecha) y la respuesta corta de Iato (izquierda).
  await page.evaluate(() => document.querySelector('[data-testid="bubble-user"]')?.scrollIntoView({ block: "start" }));
  await sleep(300);
  await shot(page, "02-cena-cerca-respuesta-corta", vp);
  // Final del hilo (la acción) visible: el hilo se desplazó solo.
  await page.locator('[data-action-type="save_place"]').scrollIntoViewIfNeeded();
  await sleep(300);
  await shot(page, "03-cena-cerca-final-del-hilo", vp);

  // 3) Con conversación: "Atajos" abre la lista vertical completa sobre el compositor.
  await page.getByRole("button", { name: "Atajos" }).click();
  await page.getByTestId("concierge-shortcuts").waitFor();
  await sleep(400);
  await shot(page, "04-atajos-abiertos", vp);

  await context.close();
  return errors;
}

const browser = await chromium.launch({ executablePath: EXEC });
const allErrors = {};
for (const vp of VIEWPORTS) allErrors[vp.name] = await run(browser, vp);
await browser.close();
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, files: results, checks, blocked_hosts: [...blocked].sort(), page_errors: allErrors, calls: CALLS.filter((c) => c.includes("concierge-chat")) }, null, 2));
console.log(results.join("\n"));
console.log(JSON.stringify(checks, null, 1));
console.log("bloqueados:", [...blocked].join(", "));
console.log("errores:", JSON.stringify(allErrors).slice(0, 2000));
