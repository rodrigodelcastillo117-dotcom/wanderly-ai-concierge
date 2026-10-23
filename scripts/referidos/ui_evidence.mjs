// Evidencia visual de la promoción "Invita 5 amigos y gana 1 mes de PRO". SOLO PRUEBAS: nada aquí llama
// a producción. Vite corre con VITE_SUPABASE_URL apuntando a un host simulado y este script responde
// TODAS las llamadas a ese host con datos ficticios; cualquier otra petición externa se bloquea.
//
// Uso:
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock \
//     npx vite --host 127.0.0.1 --port 8094 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules CHROMIUM=/opt/pw-browsers/chromium \
//     node scripts/referidos/ui_evidence.mjs http://127.0.0.1:8094 /ruta/salida
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8094";
const OUT = process.argv[3] || "/tmp/referidos-evidence";
const MOCK_HOST = "supabase-mock.localhost:54399";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "viajera.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };
const PROFILE = { id: USER_ID, full_name: "Valentina Prueba", email: USER.email, invite_code: "B6E3201E", ciudad_origen: "Ciudad de México", tier: "free", food_dna: null, loyalty_programs: [], username: "valentina" };

// Personas ficticias (solo nombre de pila e inicial, como devuelve el servidor).
const P = (name, status, d) => ({ name, status, joined_at: `2026-10-${String(d).padStart(2, "0")}` });
const COUNT = ["Bea R.", "Carla N.", "Dani", "Eva P.", "Fer G.", "Gabo L.", "Hugo M."].map((n, i) => P(n, "cuenta", 20 - i));
const base = { goal: 5, days_per_reward: 30, counting: 0, rewards: 0, pending_rewards: 0, last_reward: null, comped_until: null, stripe_apply_enabled: false, joined: [] };
const comp = { status: "applied", route: "comp", days: 30, created_at: "2026-10-22T18:00:00Z", applied_at: "2026-10-22T18:00:00Z", comped_until: "2026-11-21T18:00:00Z" };
const SCENARIOS = {
  "0-referidos": base,
  "3-referidos-estados": { ...base, counting: 3, joined: [...COUNT.slice(0, 3), P("Iris S.", "falta_correo", 10), P("Juan P.", "falta_viaje", 9), P(null, "no_cuenta", 8)] },
  "5-referidos-premio": { ...base, rewards: 1, last_reward: comp, comped_until: comp.comped_until, joined: COUNT.slice(0, 5) },
  "7-referidos": { ...base, counting: 2, rewards: 1, last_reward: comp, comped_until: comp.comped_until, joined: COUNT },
  "5-referidos-paga-stripe-flag-apagado": { ...base, rewards: 1, pending_rewards: 1, last_reward: { ...comp, status: "pending", route: "stripe", applied_at: null, comped_until: null }, joined: COUNT.slice(0, 5) },
};
let scenario = "0-referidos";

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" }, body: JSON.stringify(body) });
async function handle(route) {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p === "/rest/v1/rpc/referral_progress") return json(route, SCENARIOS[scenario]);
  if (p === "/rest/v1/rpc/get_access_state") return json(route, { is_pro: false, plan: "free", concierge_used: 0, concierge_limit: 3, concierge_remaining: 3, trips_used: 0, trips_limit: 1, trips_remaining: 1 });
  if (p.startsWith("/rest/v1/rpc/")) return json(route, null);
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) return json(route, single ? PROFILE : [PROFILE]);
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/")) return json(route, single ? null : []);
  return json(route, {});
}

async function newPage(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "block", reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return handle(route).catch(() => route.abort());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
try {
  for (const vp of VIEWPORTS) {
    for (const name of Object.keys(SCENARIOS)) {
      scenario = name;
      const { context, page } = await newPage(browser, vp);
      await page.goto(`${BASE}/dashboard/perfil`, { waitUntil: "domcontentloaded", timeout: 180000 });
      const card = page.locator("section[aria-labelledby='invite-promo-title']");
      await card.waitFor({ timeout: 180000 }).catch(async (e) => {
        await page.screenshot({ path: join(OUT, `debug-${name}-${vp.name}.png`) });
        console.log("URL", page.url());
        throw e;
      });
      await card.scrollIntoViewIfNeeded(); await sleep(600);
      await card.screenshot({ path: join(OUT, `tarjeta-${name}-${vp.name}.png`) });
      await page.screenshot({ path: join(OUT, `pagina-${name}-${vp.name}.png`) });
      console.log("ok", name, vp.name);
      await context.close();
    }
    const { context, page } = await newPage(browser, vp);
    await page.goto(`${BASE}/terminos#promo-referidos`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.locator("#promo-referidos").waitFor({ timeout: 180000 }); await sleep(800);
    await page.screenshot({ path: join(OUT, `terminos-promo-${vp.name}.png`) });
    console.log("ok terminos", vp.name);
    await context.close();
  }
} finally {
  await browser.close();
}
