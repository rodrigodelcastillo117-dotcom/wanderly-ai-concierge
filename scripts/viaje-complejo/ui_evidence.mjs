// Evidencia visual del intérprete de viaje completo (caso Diego): resumen "Entendí…" editable y el botón
// "¿No entendimos bien tu viaje?". SOLO PRUEBAS: Vite corre con VITE_SUPABASE_URL a un host simulado y este
// script responde todo con datos ficticios (la IA simulada devuelve la interpretación de un fixture);
// cualquier otra petición externa se bloquea.
//
// Uso:
//   VITE_SUPABASE_URL=https://supabase-mock.localhost VITE_SUPABASE_PUBLISHABLE_KEY=mock \
//     npx vite --host 127.0.0.1 --port 8097 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules CHROMIUM=/opt/pw-browsers/chromium \
//     node scripts/viaje-complejo/ui_evidence.mjs http://127.0.0.1:8097 /ruta/salida /ruta/diego_spec.json
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8097";
const OUT = process.argv[3] || "/tmp/viaje-complejo";
const FIXTURE = JSON.parse(readFileSync(process.argv[4], "utf8")); // { text, spec } (salida validada de la IA simulada)
const MOCK_HOST = "supabase-mock.localhost";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];
const ME = "00000000-0000-4000-8000-0000000000a1";
const TRIP = "00000000-0000-4000-8000-00000000d1e9";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: ME, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: ME, aud: "authenticated", role: "authenticated", email: "diego.prueba@example.com", user_metadata: { full_name: "Diego Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };

// El viaje que la app generó para Diego: un solo destino ("Arabia Saudita"), sin su texto.
const DIEGO_TRIP = {
  id: TRIP, user_id: ME, destino: "Arabia Saudita", pais_destino: "Arabia Saudita", ciudad_origen: "Ciudad de México",
  fecha_salida: "2027-11-15", fecha_regreso: "2027-12-19", num_viajeros: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  total_estimado: null, status: "listo", desglose_presupuesto: null, moneda: "MXN", fuente: "plan",
  vuelos_json: [], hospedaje_json: [], restaurantes_json: [], tours_json: [], itinerario_json: [{ dia: 1, titulo: "Riad", "mañana": "", tarde: "", noche: "" }],
  quote_basis: null, quote_needs_update: false, selections: null, cruceros_json: [], tips_personalizados: [], analisis_ai: null,
};

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" }, body: JSON.stringify(body) });
const paid = [];

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (p === "/functions/v1/interpretar-viaje") {
    const body = JSON.parse(req.postData() || "{}");
    await new Promise((r) => setTimeout(r, 300));
    return json(route, { ok: true, spec: { ...FIXTURE.spec, consulta_original: body.texto }, texto_recortado_para_ia: false });
  }
  if (p === "/functions/v1/logistics-plan" || p === "/functions/v1/analizar-viaje") { paid.push(p); return json(route, { error: "simulado" }, 503); }
  if (p.startsWith("/functions/v1/")) return json(route, { ok: false, error: "simulado" }, 503);
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/rpc/")) return json(route, null);
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: ME, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null, tooltips_shown: ["social", "perfil", "profile", "dna", "avatar", "trip", "viaje"] };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: ME, full_name: "Diego Prueba", ciudad_origen: "Ciudad de México", avatar_url: null, invite_code: "A3K9PQ7M", active_trip_id: null, tier: "special" };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/trips")) return json(route, single ? DIEGO_TRIP : [DIEGO_TRIP]);
  if (p.startsWith("/rest/v1/")) return json(route, single ? null : []);
  return json(route, {});
}

const blocked = new Set();
async function newPage(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "block", reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === MOCK_HOST) return handle(route).catch((e) => { console.log("HANDLE ERROR", u.pathname, e.message); return route.abort(); });
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    blocked.add(u.host);
    return route.abort();
  });
  await context.addInitScript(([key, sess]) => {
    try { localStorage.setItem(key, JSON.stringify(sess)); localStorage.setItem("iatos_cookie_consent_v2", "essential"); } catch { /* noop */ }
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  return { context, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const checks = [];
async function shot(page, name, vp, fullPage = false) {
  const file = join(OUT, `${name}__${vp.name}.png`);
  await sleep(400);
  await page.screenshot({ path: file, fullPage });
  results.push(file);
  checks.push({ name: `${name}__${vp.name}`, hscroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1) });
}

async function run(browser, vp) {
  // 1. Planear con la frase completa → "Entendí…" (IA simulada), con sus pendientes.
  let { context, page } = await newPage(browser, vp);
  await page.goto(`${BASE}/dashboard/planear?q=${encodeURIComponent(FIXTURE.text)}&viajeros=2&origen=${encodeURIComponent("Ciudad de México")}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByTestId("spec-review").waitFor({ timeout: 120000 });
  await shot(page, "01-entendi-diego", vp);
  await shot(page, "02-entendi-diego-completo", vp, true);
  // Resolver: ciudades de Arabia, puertos y noches del crucero, Londres como estancia.
  const preg = (t) => page.locator(`[data-testid='spec-pregunta'][data-tipo='${t}']`);
  await preg("ciudades_de_pais").getByTestId("spec-aceptar").click();
  await preg("crucero").getByLabel("Puerto de salida").fill("Yeda");
  await preg("crucero").getByLabel("Sale", { exact: true }).fill("2027-11-25");
  await preg("crucero").getByLabel("Llega", { exact: true }).fill("2027-12-09");
  await preg("conexion_o_estancia").getByTestId("spec-estancia").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='spec-pregunta']").length === 0, null, { timeout: 10000 }).catch(() => console.log("quedan pendientes", vp.name));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "03-entendi-resuelto", vp);
  await shot(page, "04-entendi-resuelto-completo", vp, true);
  await context.close();

  // 2. Detalle del viaje que la app generó: botón "¿No entendimos bien tu viaje?" y su ventana.
  ({ context, page } = await newPage(browser, vp));
  await page.goto(`${BASE}/dashboard/viajes/${TRIP}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByTestId("no-entendimos").waitFor({ timeout: 120000 });
  await shot(page, "05-detalle-boton", vp);
  await page.getByTestId("no-entendimos").click();
  await page.getByTestId("no-entendimos-dialog").waitFor();
  await page.getByTestId("ne-textarea").fill(FIXTURE.text);
  await page.getByTestId("ne-interpretar").click();
  await page.getByText("crucero (Yeda → Ciudad del Cabo)").first().waitFor({ timeout: 15000 });
  await shot(page, "06-no-entendimos-ventana", vp);
  await context.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
try {
  for (const vp of VIEWPORTS) await run(browser, vp);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "checks.json"), JSON.stringify({ results, checks, blocked: [...blocked], paid }, null, 2));
console.log(JSON.stringify({ shots: results.length, hscroll: checks.filter((c) => c.hscroll).map((c) => c.name), blocked: [...blocked], paid }, null, 2));
