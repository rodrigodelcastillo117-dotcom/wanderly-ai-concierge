// Evidencia visual del road trip (grupo roadtrip). SOLO PRUEBAS: nada aquí llama a producción.
//
// · Vite corre con VITE_SUPABASE_URL apuntando a un host simulado y este script responde TODAS las
//   llamadas a ese host con datos ficticios (scripts/roadtrip/make_fixtures.ts: lógica real de IATOS
//   con una respuesta de Google Routes SIMULADA y un texto de Iato SIMULADO). Toda otra petición
//   externa se bloquea (fotos de Pexels incluidas: se ve el respaldo sin foto), salvo Google Fonts.
// · Cada captura lleva la franja "DATOS SIMULADOS".
//
// Uso:
//   npx vite-node scripts/roadtrip/make_fixtures.ts /tmp/rt_fixture.json
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock npx vite --host 127.0.0.1 --port 8093 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules/playwright FIXTURE=/tmp/rt_fixture.json node scripts/roadtrip/ui_evidence.mjs http://127.0.0.1:8093 docs/iatos/evidencia/roadtrip
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8093";
const OUT = process.argv[3] || "docs/iatos/evidencia/roadtrip";
const FIX = JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
const MOCK_HOST = "supabase-mock.localhost:54399";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/roadtrip-ui-font-cache";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
].filter((v) => !process.env.VP || v.name === process.env.VP);

const USER_ID = "00000000-0000-4000-8000-0000000000c1";
const TRIP_ID = "00000000-0000-4000-8000-0000000000d1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "viajera.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };

const STOPS = ["Florencia", "San Gimignano", "Siena", "Montalcino", "Pienza", "Roma"];
const TRIP = {
  id: TRIP_ID, user_id: USER_ID, destino: STOPS.join(" → "), pais_destino: "Roma", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-11-09", fecha_regreso: "2026-11-16", num_viajeros: 2, total_estimado: 98500, moneda: "MXN", status: "listo",
  desglose_presupuesto: { vuelos: 52000, hospedaje: 28000, comida: 12000, tours: 3500, transporte_local: 2000, extras: 1000 },
  vuelos_json: [], hospedaje_json: [], restaurantes_json: [], tours_json: [],
  itinerario_json: { multi: true, destinations: STOPS, days: [], logistics: { road_trip: FIX.plan, leg_modes: ["coche", "coche", "coche", "coche", "coche"] } },
  created_at: "2026-10-22T18:00:00Z", updated_at: "2026-10-22T18:00:00Z", analisis_ai: "Road trip por la Toscana (datos simulados).",
};

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

const CALLS = [];
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  CALLS.push(`${req.method()} ${url.pathname}${url.search.slice(0, 160)}`);
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (p === "/functions/v1/concierge-chat") {
    const meta = { _trip_id: null, _trip_reason: "none", _today: "2026-10-22", _intents: ["road_trip"] };
    return sse(route, [{ type: "meta", data: meta }, { type: "final", data: { ...FIX.iato, _tools_used: [], _gaps: [], ...meta } }]);
  }
  if (p === "/functions/v1/booking-bridge") return json(route, { ok: false, unavailable: true, code: "BRIDGE_UNAVAILABLE" });
  if (p === "/functions/v1/pexels-image") return json(route, { photo: null });
  // Sin cotización en vivo en la evidencia: la pantalla muestra su estimación (servicio "no disponible").
  if (p === "/functions/v1/serpapi-quote") return json(route, { error: "no disponible en la evidencia" }, 503);
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/trips")) return json(route, single ? (url.search.includes(TRIP_ID) ? TRIP : null) : [TRIP]);
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: USER_ID, full_name: "Valentina Prueba", avatar_url: null, ciudad_origen: "Ciudad de México" };
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
  });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return handle(route).catch((e) => { console.log("HANDLE ERROR", u.pathname, e.message); return route.abort(); });
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
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
    // Franja visible: toda la captura usa datos simulados.
    const tag = () => {
      if (document.getElementById("rt-sim")) return;
      const d = document.createElement("div");
      d.id = "rt-sim";
      d.textContent = "DATOS SIMULADOS · evidencia de pruebas";
      d.setAttribute("style", "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:6px;background:#b91c1c;color:#fff;font:600 11px system-ui;padding:3px 10px;border-radius:999px;pointer-events:none;opacity:.92");
      document.body?.appendChild(d);
    };
    document.addEventListener("DOMContentLoaded", tag);
    setInterval(tag, 500);
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  return { context, page: await context.newPage() };
}

const results = [];
const overflow = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name, vp, fullPage = false) {
  const file = join(OUT, `${name}__${vp.name}.png`);
  await page.screenshot({ path: file, fullPage });
  results.push(file);
  // Sin desplazamiento horizontal de la página (390 px).
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) overflow.push(`${name}__${vp.name}: +${over}px`);
}
async function scrollTo(page, testId) {
  await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
  await page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (el) window.scrollBy(0, el.getBoundingClientRect().top - 70); }, testId);
  await sleep(500);
}

async function run(browser, vp) {
  const { context, page } = await newPage(browser, vp);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e.message}\n${(e.stack || "").slice(0, 600)}`));

  // 1) Ruta de varios destinos con el coche elegido: selector y vista previa ESTIMADA.
  const qs = new URLSearchParams({ destinos: STOPS.join("|"), modo: "coche", origin: "Ciudad de México", fecha_salida: "2026-11-09", fecha_regreso: "2026-11-16" });
  await page.goto(`${BASE}/dashboard/ruta?${qs}`);
  await page.getByTestId("transport-mode-picker").waitFor({ timeout: 30000 });
  await scrollTo(page, "transport-mode-picker");
  await shot(page, "01-ruta-modo-coche", vp);
  await page.getByRole("radio", { name: /Mezclar por tramo/ }).click();
  await page.getByRole("radiogroup", { name: /Tramo 5: Pienza a Roma/ }).getByRole("radio", { name: "Tren" }).click();
  await sleep(400);
  await scrollTo(page, "transport-mode-picker");
  await shot(page, "02-ruta-mezcla-por-tramo", vp);
  await scrollTo(page, "roadtrip-panel");
  await shot(page, "03-ruta-vista-previa-estimada", vp);

  // 2) Viaje generado: panel del road trip (tramos, costos, renta, avisos).
  await page.goto(`${BASE}/dashboard/viajes/${TRIP_ID}`);
  await page.getByTestId("roadtrip-panel").waitFor({ timeout: 30000 }).catch(async (e) => {
    console.log("PAGEERRORS", errors.join("\n---\n").slice(0, 3000)); throw e;
  });
  await scrollTo(page, "roadtrip-panel");
  await shot(page, "04-viaje-tramos-en-coche", vp);
  await scrollTo(page, "roadtrip-costs");
  await shot(page, "05-viaje-costos-etiquetados", vp);
  await scrollTo(page, "roadtrip-rentals");
  await shot(page, "06-viaje-renta-recogida-devolucion", vp);
  await page.getByTestId("roadtrip-rentals").getByRole("button", { name: /Buscar auto de renta/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await sleep(500);
  await shot(page, "07-viaje-reservar-auto-bridge", vp);
  await page.keyboard.press("Escape");
  await sleep(300);
  await scrollTo(page, "roadtrip-notices");
  await shot(page, "08-viaje-avisos-por-pais", vp);

  // 3) Ideas de road trips en Planear y en Descubre.
  await page.goto(`${BASE}/dashboard/planear`);
  await page.getByTestId("plan-roadtrip-ideas-toggle").waitFor({ timeout: 30000 });
  await page.getByTestId("plan-roadtrip-ideas-toggle").click();
  await scrollTo(page, "roadtrip-ideas");
  await shot(page, "09-planear-ideas-road-trips", vp);
  await page.goto(`${BASE}/dashboard/descubre`);
  await page.getByTestId("roadtrip-ideas").waitFor({ timeout: 30000 });
  await scrollTo(page, "roadtrip-ideas");
  await shot(page, "10-descubre-road-trips", vp);

  // 4) Iato: "quiero hacer un road trip por la Toscana en 7 días" (respuesta SIMULADA, card real del planeador).
  await page.goto(`${BASE}/dashboard/concierge`);
  const box = page.getByLabel("Mensaje para Iato");
  await box.waitFor({ timeout: 30000 });
  await box.fill("quiero hacer un road trip por la Toscana en 7 días");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await page.locator('[data-card-type="transport"]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-card-type="transport"]').first().scrollIntoViewIfNeeded();
  await sleep(600);
  await shot(page, "11-iato-road-trip-toscana", vp);

  // 5) Renta de auto con devolución en otra ciudad.
  await page.goto(`${BASE}/dashboard/autos?city=Florencia&dropoff=Roma&pickup=2026-11-10&return=2026-11-14`);
  await page.getByTestId("tripcars-one-way").waitFor({ timeout: 30000 });
  await sleep(400);
  await shot(page, "12-autos-devolucion-otra-ciudad", vp);

  await context.close();
  return errors;
}

const browser = await chromium.launch();
const allErrors = {};
for (const vp of VIEWPORTS) allErrors[vp.name] = await run(browser, vp);
await browser.close();
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, files: results, horizontal_overflow: overflow, blocked_hosts: [...blocked].sort(), page_errors: allErrors }, null, 2));
console.log(results.join("\n"));
console.log("bloqueados:", [...blocked].join(", "));
console.log("desbordes:", JSON.stringify(overflow));
