// Evidencia visual de la página del viaje del caso Roma → Florencia → Venecia. SOLO PRUEBAS: nada
// aquí llama a producción. Vite corre con VITE_SUPABASE_URL apuntando a un host simulado y este script
// responde TODAS las llamadas a ese host con el viaje del caso (scripts/multidest/make_fixture.ts);
// toda otra petición externa se bloquea (salvo Google Fonts). Cada captura lleva "DATOS SIMULADOS".
//
// Mide, a 1440×900 y 390×844: la altura total de la página (px) y el recorrido "quiero comprar el
// vuelo y los hoteles" (toques y desplazamiento). MODE=before usa la página de origin/main; MODE=after,
// la nueva (pestañas y "Comprar").
//
// Uso:
//   npx vite-node scripts/multidest/make_fixture.ts /tmp/md_fixture.json
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock npx vite --host 127.0.0.1 --port 8094 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules/playwright FIXTURE=/tmp/md_fixture.json MODE=after node scripts/multidest/ui_evidence.mjs http://127.0.0.1:8094 docs/iatos/evidencia/multidest
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8094";
const OUT = process.argv[3] || "docs/iatos/evidencia/multidest";
const MODE = process.env.MODE || "after";
const FIX = JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
const TRIP = FIX.trip;
const MOCK_HOST = "supabase-mock.localhost:54399";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/multidest-ui-font-cache";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
].filter((v) => !process.env.VP || v.name === process.env.VP);

const USER_ID = TRIP.user_id;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "dueno.prueba@example.com", user_metadata: { full_name: "Dueño Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };

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

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (p === "/functions/v1/booking-bridge") return json(route, { ok: false, unavailable: true, code: "BRIDGE_UNAVAILABLE" });
  if (p === "/functions/v1/pexels-image") return json(route, { photo: null });
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/trips")) {
    if (req.method() === "PATCH") return json(route, [TRIP]);
    return json(route, single ? (url.search.includes(TRIP.id) ? TRIP : null) : [TRIP]);
  }
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: USER_ID, full_name: "Dueño Prueba", avatar_url: null, ciudad_origen: "Ciudad de México" };
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
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "block", reducedMotion: "reduce",
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
    const tag = () => {
      if (document.getElementById("md-sim")) return;
      const d = document.createElement("div");
      d.id = "md-sim";
      d.textContent = "DATOS SIMULADOS · caso Roma → Florencia → Venecia";
      d.setAttribute("style", "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);top:4px;background:#b91c1c;color:#fff;font:600 11px system-ui;padding:3px 10px;border-radius:999px;pointer-events:none;opacity:.92");
      document.body?.appendChild(d);
    };
    document.addEventListener("DOMContentLoaded", tag);
    setInterval(tag, 500);
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  return { context, page: await context.newPage() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = [];

/** Recorrido "quiero comprar el vuelo y los hoteles": cada paso es un toque; se suma el desplazamiento. */
async function walk(page, vp, steps) {
  let taps = 0;
  let scroll = 0;
  const log = [];
  for (const [i, s] of steps.entries()) {
    const el = await s.find(page);
    const y0 = await page.evaluate(() => window.scrollY);
    await el.scrollIntoViewIfNeeded();
    await sleep(250);
    const y1 = await page.evaluate(() => window.scrollY);
    scroll += Math.abs(y1 - y0);
    taps += 1;
    const label = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 60);
    log.push({ paso: s.name, toque: label, desplazamiento_px: Math.abs(y1 - y0) });
    const file = join(OUT, `${MODE}-recorrido-${String(i + 1).padStart(2, "0")}__${vp.name}.png`);
    await page.screenshot({ path: file });
    files.push(file);
    if (s.click) { await el.click(); await sleep(500); }
    if (s.after) await s.after(page);
  }
  return { taps, scroll, log };
}

const BEFORE_STEPS = [
  { name: "Vuelo (Comprar mi viaje)", find: (p) => p.getByTestId("comprar-vuelo-abrir").first() },
  { name: "Hotel (Comprar mi viaje: solo Roma, 10 noches)", find: (p) => p.getByTestId("comprar-hospedaje-abrir").first() },
  ...["Florencia", "Venecia"].flatMap((city) => {
    const hotel = city === "Florencia" ? "Four Seasons Firenze" : "Aman Venice";
    return [
      { name: `Abrir ${city} (Tu viaje por destino)`, find: (p) => p.locator("#trip-destinos button", { hasText: city }).first(), click: true },
      { name: `Botón de reserva del hotel en ${city}`, find: (p) => p.locator("div.group.relative.rounded-xl", { hasText: hotel }).first().locator("button").first(), click: true },
      { name: `Confirmar salida a Booking (${city})`, find: (p) => p.getByRole("dialog").getByRole("link").or(p.getByRole("dialog").getByRole("button", { name: /Abrir|Continuar|Ir a/ })).first(),
        after: async (p) => { await p.keyboard.press("Escape"); await sleep(300); } },
    ];
  }),
];

const AFTER_STEPS = [
  { name: "Pestaña Comprar", find: (p) => p.getByTestId("tab-comprar").first(), click: true },
  { name: "Comprar el vuelo (Google Flights)", find: (p) => p.getByTestId("comprar-vuelo-abrir").first() },
  ...["Roma", "Florencia", "Venecia"].map((city) => ({ name: `Comprar hotel en ${city}`, find: (p) => p.getByTestId(`comprar-hotel-${city}-abrir`).first() })),
];

async function run(browser, vp) {
  const { context, page } = await newPage(browser, vp);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/dashboard/viajes/${TRIP.id}`);
  await page.locator("#trip-total").first().waitFor({ timeout: 45000 }).catch(async (e) => { console.log("ERRORES", errors.join("\n")); throw e; });
  await sleep(2500);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const file = join(OUT, `${MODE}-pagina-completa__${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  files.push(file);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // Altura de cada pestaña (después): la página muestra solo la sección elegida.
  const tabs = {};
  if (MODE === "after") {
    for (const t of ["resumen", "comprar", "ruta", "destinos", "documentos"]) {
      const tab = page.getByTestId(`tab-${t}`);
      if (!(await tab.count())) continue;
      await tab.first().click();
      await sleep(600);
      await page.evaluate(() => window.scrollTo(0, 0));
      tabs[t] = await page.evaluate(() => document.documentElement.scrollHeight);
      const f = join(OUT, `${MODE}-seccion-${t}__${vp.name}.png`);
      await page.screenshot({ path: f, fullPage: true });
      files.push(f);
    }
    await page.getByTestId("tab-resumen").first().click();
    await sleep(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const w = await walk(page, vp, MODE === "before" ? BEFORE_STEPS : AFTER_STEPS);
  await context.close();
  return { viewport: vp.name, altura_px: height, alturas_por_seccion_px: tabs, desborde_horizontal_px: Math.max(0, over), recorrido: w, errores: errors };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const out = [];
for (const vp of VIEWPORTS) out.push(await run(browser, vp));
await browser.close();
writeFileSync(join(OUT, `${MODE}-medidas.json`), JSON.stringify({ generated_at: new Date().toISOString(), mode: MODE, base: BASE, resultados: out, archivos: files, bloqueados: [...blocked].sort() }, null, 2));
console.log(JSON.stringify(out.map((r) => ({ vp: r.viewport, altura: r.altura_px, secciones: r.alturas_por_seccion_px, toques: r.recorrido.taps, desplazamiento: r.recorrido.scroll, errores: r.errores.length })), null, 1));
