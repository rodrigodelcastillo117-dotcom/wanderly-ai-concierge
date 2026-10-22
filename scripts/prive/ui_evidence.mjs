// Evidencia visual de IATOS Privé (grupo ui). SOLO PRUEBAS: nada aquí llama a producción.
//
// · Levanta (aparte) el servidor de Vite con VITE_SUPABASE_URL apuntando a un host simulado
//   (http://supabase-mock.localhost:54399) y este script intercepta TODAS las llamadas a ese host
//   con page.route: prive_status, prive-access, pexels-image, auth y tablas responden con datos de
//   prueba. Cualquier otra petición externa se bloquea, salvo Google Fonts (tipografía), que se
//   descarga con curl a través del proxy del entorno y con verificación TLS normal.
// · Las fotos de la bienvenida son SVG generados aquí ("foto simulada"), no de Pexels.
// · Viewports emulados en Chromium (no son dispositivos iOS/Android reales).
//
// Uso:
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock \
//     npx vite --port 8090 --strictPort &
//   node scripts/prive/ui_evidence.mjs http://localhost:8090 docs/iatos/evidencia/prive/ui
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8090";
const OUT = process.argv[3] || "docs/iatos/evidencia/prive/ui";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const MOCK_HOST = "supabase-mock.localhost:54399";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/prive-ui-font-cache";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const ALL_VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "412x915", width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440x900", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

const VIEWPORTS = process.env.VP ? ALL_VIEWPORTS.filter((v) => v.name === process.env.VP) : ALL_VIEWPORTS;

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "miembro.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };
const PRIVE_SESSION = { token: "pv_mock_session_token_0123456789abcdef", expiresAt: new Date(Date.now() + 11 * 3600e3).toISOString(), userId: USER_ID };

const base = () => ({
  is_pro: true, tenure_days: 0, required_days: 90, eligible: false, basis: null, membership_status: "none",
  has_password: false, password_status: "none", locked_until: null, activated_at: null, member_code: null,
  first_name: "Valentina", welcome_version_seen: 0, onboarding: {}, invitation_pending: false, members_requires_prive: false,
});
const ACTIVE = { eligible: true, basis: "tenure", tenure_days: 124, membership_status: "active", has_password: true, password_status: "active", activated_at: "2026-10-22T18:30:00Z", member_code: "IP-7KQM-X4TD", welcome_version_seen: 1, onboarding: { version: 1, step: 5, completed_at: "2026-10-22T18:40:00Z" } };
const STATUSES = {
  free: { ...base(), is_pro: false },
  progress: { ...base(), tenure_days: 47 },
  preparing: { ...base(), tenure_days: 92, eligible: true, basis: "tenure" },
  invitation: { ...base(), tenure_days: 92, eligible: true, basis: "tenure", membership_status: "invited", invitation_pending: true },
  set_password: { ...base(), tenure_days: 92, eligible: true, basis: "tenure", membership_status: "active", activated_at: "2026-10-22T18:30:00Z", member_code: "IP-7KQM-X4TD" },
  paused_pro: { ...base(), ...ACTIVE, is_pro: false, eligible: false },
  paused_tenure: { ...base(), ...ACTIVE, tenure_days: 61, eligible: false },
  revoked: { ...base(), ...ACTIVE, membership_status: "revoked", member_code: null },
  must_reset: { ...base(), ...ACTIVE, password_status: "must_reset" },
  locked: { ...base(), ...ACTIVE },
  unlocked: { ...base(), ...ACTIVE },
  first_entry: { ...base(), ...ACTIVE, welcome_version_seen: 0, onboarding: {} },
  onboarding: { ...base(), ...ACTIVE, onboarding: { version: 1, step: 0 } },
};

// Estado mutable del servidor simulado.
let server = { status: STATUSES.free, accept: { ok: true }, calls: [] };

const svgPhoto = (seed) => {
  const h = createHash("sha1").update(String(seed)).digest();
  const hue = 20 + (h[0] % 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue + 190},30%,${14 + (h[1] % 10)}%)"/><stop offset="0.62" stop-color="hsl(${hue},45%,${22 + (h[2] % 10)}%)"/><stop offset="1" stop-color="#0a0806"/></linearGradient>
<radialGradient id="s" cx="${30 + (h[3] % 40)}%" cy="38%" r="40%"><stop offset="0" stop-color="hsla(40,80%,75%,.55)"/><stop offset="1" stop-color="hsla(40,80%,75%,0)"/></radialGradient></defs>
<rect width="800" height="1000" fill="url(#g)"/><rect width="800" height="1000" fill="url(#s)"/>
${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 90 + (h[i] % 30)}" y="${560 - (h[i + 4] % 260)}" width="${50 + (h[i + 2] % 40)}" height="${1000}" fill="hsla(${hue},20%,6%,.82)"/>`).join("")}
<text x="400" y="960" text-anchor="middle" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,.35)">foto simulada · prueba</text></svg>`;
};

function fetchFont(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = join(FONT_CACHE, key);
  const meta = file + ".type";
  if (!existsSync(file)) {
    try {
      const args = ["-sS", "-L", "--max-time", "20", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36", "-o", file, "-w", "%{content_type}", url];
      if (existsSync("/root/.ccr/ca-bundle.crt")) args.unshift("--cacert", "/root/.ccr/ca-bundle.crt");
      const type = execFileSync("curl", args, { encoding: "utf8" });
      writeFileSync(meta, type || "application/octet-stream");
    } catch {
      return null;
    }
  }
  return { body: readFileSync(file), type: existsSync(meta) ? readFileSync(meta, "utf8") : "application/octet-stream" };
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") {
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  }
  const p = url.pathname;
  let body = {};
  try { body = req.postDataJSON() ?? {}; } catch { body = {}; }
  server.calls.push({ p, action: body.action ?? null });
  if (p === "/rest/v1/rpc/prive_status") return json(route, server.status);
  if (p === "/functions/v1/pexels-image") return json(route, { image: `https://images.pexels.mock/${encodeURIComponent(body.query || "x")}.svg`, photographer: "Foto simulada (prueba)" });
  if (p === "/functions/v1/prive-access") {
    const s = server.status;
    switch (body.action) {
      case "accept_invitation":
        if (!server.accept.ok) return json(route, server.accept);
        server.status = { ...s, membership_status: "active", activated_at: new Date().toISOString(), member_code: "IP-7KQM-X4TD" };
        return json(route, { ok: true });
      case "set_password":
        server.status = { ...server.status, has_password: true, password_status: "active" };
        // Igual que la rama core: frase en generated_password y la primera sesión ya abierta.
        return json(route, { ok: true, ...(body.generate ? { generated_password: "lumen-orquidea-puerto-terciopelo-82" } : {}), prive_session: PRIVE_SESSION.token, expires_at: PRIVE_SESSION.expiresAt });
      case "unlock":
        if (body.password === "incorrecta") return json(route, { ok: false, code: "WRONG_PASSWORD" });
        return json(route, { ok: true, prive_session: PRIVE_SESSION.token, expires_at: PRIVE_SESSION.expiresAt });
      case "complete_reset":
        return json(route, body.token?.startsWith("vencido") ? { ok: false, code: "RESET_INVALID" } : { ok: true });
      case "resend_invitation":
        return json(route, { ok: true, email: "sent" });
      default:
        return json(route, { ok: true });
    }
  }
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, (req.headers()["accept"] || "").includes("vnd.pgrst.object") ? row : [row]);
  }
  if (p.startsWith("/rest/v1/")) return json(route, (req.headers()["accept"] || "").includes("vnd.pgrst.object") ? null : []);
  return json(route, {});
}

const blocked = new Set();
async function preparePage(context) {
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return handle(route);
    if (u.host === "images.pexels.mock") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svgPhoto(u.pathname) });
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com") {
      const f = fetchFont(u.toString());
      if (f) return route.fulfill({ status: 200, contentType: f.type, headers: { "access-control-allow-origin": "*" }, body: f.body });
      return route.abort();
    }
    blocked.add(u.host);
    return route.abort();
  });
}

async function newPage(browser, vp, { reduced = false, priveSession = false, extraSession = {} } = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    reducedMotion: reduced ? "reduce" : "no-preference",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });
  await preparePage(context);
  await context.addInitScript(([key, sess, ps, extra]) => {
    try {
      localStorage.setItem(key, JSON.stringify(sess));
      localStorage.setItem("iatos_cookie_consent_v2", "essential");
      if (ps) sessionStorage.setItem("iatos.prive.session", JSON.stringify(ps));
      for (const [k, v] of Object.entries(extra)) sessionStorage.setItem(k, v);
    } catch { /* noop */ }
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION, priveSession ? PRIVE_SESSION : null, extraSession]);
  const page = await context.newPage();
  return { context, page };
}

const results = [];
async function shot(page, name, vp, suffix = "") {
  const file = join(OUT, `${name}__${vp.name}${suffix}.png`);
  await page.screenshot({ path: file, fullPage: false });
  results.push(file);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

// ── Escenarios ──────────────────────────────────────────────────────────────────────────────
const HUB = [
  ["hub-01-teaser-free", "free", "There are places you visit."],
  ["hub-02-progreso-47-de-90", "progress", "Llevas 47 de 90"],
  ["hub-03-invitacion-preparandose", "preparing", "se está preparando"],
  ["hub-04-invitacion-lista", "invitation", "Tu invitación está lista"],
  ["hub-05-falta-contrasena", "set_password", "Falta un paso"],
  ["hub-06-pausada-pro-termino", "paused_pro", "pausa"],
  ["hub-07-pausada-antiguedad", "paused_tenure", "Tu acceso está en pausa"],
  ["hub-08-revocada", "revoked", "no está activa"],
  ["hub-09-debe-restablecer", "must_reset", "Crea una contraseña Privé nueva"],
  ["hub-10-candado", "locked", "Tu acceso personal"],
];

async function runHub(browser, vp) {
  for (const [name, key, text] of HUB) {
    if (ONLY && !ONLY.test(name)) continue;
    server = { status: STATUSES[key], accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp);
    await page.goto(`${BASE}/prive`);
    await waitText(page, text);
    await sleep(1600);
    await shot(page, name, vp);
    if (key === "locked") {
      await page.getByLabel("Contraseña Privé").fill("incorrecta");
      await page.getByRole("button", { name: "Ingresar" }).click();
      await waitText(page, "incorrecta.");
      await sleep(300);
      await shot(page, "hub-11-candado-contrasena-incorrecta", vp);
      // Prueba: sin sesión Privé no se pidió contenido del catálogo.
      const content = server.calls.filter((c) => c.p.startsWith("/rest/v1/rpc/prive_") && c.p !== "/rest/v1/rpc/prive_status");
      if (content.length) throw new Error("Se pidió contenido Privé sin sesión: " + JSON.stringify(content));
    }
    await context.close();
  }
  if (!ONLY || ONLY.test("hub-12")) {
    server = { status: STATUSES.unlocked, accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp, { priveSession: true });
    await page.goto(`${BASE}/prive`);
    await waitText(page, "The World, Beyond Ordinary.");
    await sleep(1500);
    await shot(page, "hub-12-desbloqueado", vp);
    await page.getByRole("heading", { name: "Las colecciones" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await sleep(500);
    await shot(page, "hub-13-desbloqueado-colecciones", vp);
    await context.close();
  }
}

async function runCeremony(browser, vp, reduced = false) {
  const sfx = reduced ? "__reduced-motion" : "";
  const want = (n) => !ONLY || ONLY.test(n);
  if (want("ceremonia")) {
    server = { status: STATUSES.invitation, accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp, { reduced });
    await page.goto(`${BASE}/prive/invitacion#t=mocktoken_0123456789abcdefABCDEF`);
    await page.waitForSelector('[data-scene="arrival"]', { timeout: 15000 });
    const hashGone = await page.evaluate(() => window.location.hash === "" && sessionStorage.getItem("iatos.prive.invite_token") !== null);
    if (!hashGone) throw new Error("El token #t= siguió en la URL");
    await sleep(reduced ? 200 : 2600);
    await shot(page, "ceremonia-1-llegada", vp, sfx);
    await page.waitForSelector('[data-scene="invitation"]', { timeout: 15000 });
    if (process.env.DEBUG_FRAMES) {
      for (const t of [300, 800, 1500, 3000]) { await sleep(t); await page.screenshot({ path: `${OUT}/dbg-${t}.png` }); }
      console.log(await page.evaluate(() => document.querySelector('[data-scene]').outerHTML.slice(0, 3000)));
    }
    await page.getByRole("button", { name: "OPEN INVITATION" }).waitFor({ timeout: 15000 });
    await sleep(reduced ? 300 : 2600);
    await shot(page, "ceremonia-2-invitacion", vp, sfx);
    await page.getByRole("button", { name: "OPEN INVITATION" }).click();
    await page.waitForSelector('[data-scene="reveal"]', { timeout: 15000 });
    await sleep(reduced ? 400 : 2600);
    await shot(page, "ceremonia-3-revelacion", vp, sfx);
    const accept = server.calls.find((c) => c.action === "accept_invitation");
    if (!accept) throw new Error("No se llamó accept_invitation");
    await page.getByRole("button", { name: "Continuar" }).click();
    await waitText(page, "Tu contraseña Privé");
    await sleep(900);
    await page.getByLabel("Contraseña Privé", { exact: true }).fill("faro lento sobre bahía 1987");
    await page.getByLabel("Repítela").fill("faro lento sobre bahía 1987");
    await sleep(300);
    await shot(page, "ceremonia-4a-contrasena-elegida", vp, sfx);
    await page.getByRole("tab", { name: "Generar una por mí" }).click();
    await page.getByRole("button", { name: "Generar mi contraseña" }).click();
    await waitText(page, "Solo la verás esta vez");
    await sleep(400);
    await shot(page, "ceremonia-4b-contrasena-generada-una-vez", vp, sfx);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    if (stored.includes("lumen-orquidea")) throw new Error("La frase generada quedó guardada en el navegador");
    await page.getByRole("button", { name: "La guardé" }).click();
    await page.waitForSelector('[data-testid="prive-member-card"]', { timeout: 15000 });
    await sleep(reduced ? 300 : 900);
    await shot(page, "ceremonia-4c-tarjeta-de-miembro", vp, sfx);
    await page.getByRole("button", { name: "ENTER IATOS PRIVÉ" }).waitFor({ timeout: 10000 });
    await sleep(800);
    await shot(page, "ceremonia-5-enter", vp, sfx);
    server.status = { ...STATUSES.first_entry };
    await page.getByRole("button", { name: "ENTER IATOS PRIVÉ" }).click();
    await page.waitForSelector('[data-testid="prive-grand-welcome"]', { timeout: 15000 });
    if (reduced) {
      await sleep(600);
      await shot(page, "bienvenida-estatica", vp, sfx);
    } else {
      await waitText(page, "WELCOME TO PRIVÉ");
      await sleep(1300);
      await shot(page, "bienvenida-1-welcome-to-prive", vp, sfx);
      await waitText(page, "YOUR WORLD JUST GOT BIGGER.");
      await sleep(1300);
      await shot(page, "bienvenida-2-your-world", vp, sfx);
      await page.getByRole("button", { name: "Continuar" }).waitFor({ timeout: 15000 });
      await sleep(900);
      await shot(page, "bienvenida-3-destinos", vp, sfx);
    }
    const saved = () => server.calls.filter((c) => c.action === "save_progress").length;
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForSelector('[data-testid="prive-onboarding"]', { timeout: 15000 });
    if (saved() < 1) throw new Error("La bienvenida no guardó el progreso en el servidor");
    for (let i = 1; i <= 6; i++) {
      await waitText(page, `Paso ${i} de 6`);
      await sleep(reduced ? 200 : 800);
      await shot(page, `guia-paso-${i}`, vp, sfx);
      await page.getByRole("button", { name: i === 6 ? "Terminar" : "Siguiente" }).click();
    }
    await waitText(page, "WELCOME TO YOUR WORLD.");
    await sleep(reduced ? 300 : 1200);
    await shot(page, "guia-final-welcome-to-your-world", vp, sfx);
    await context.close();
  }
  if (reduced) return;
  const messages = [
    ["ceremonia-msg-otra-cuenta", { ok: false, code: "INVITATION_OTHER_ACCOUNT" }, "otra cuenta"],
    ["ceremonia-msg-vencida", { ok: false, code: "INVITATION_EXPIRED" }, "venció"],
  ];
  for (const [name, accept, text] of messages) {
    if (!want(name)) continue;
    server = { status: STATUSES.invitation, accept, calls: [] };
    const { context, page } = await newPage(browser, vp, { reduced: true });
    await page.goto(`${BASE}/prive/invitacion`);
    await page.getByRole("button", { name: "OPEN INVITATION" }).click({ timeout: 15000 });
    await waitText(page, text);
    await sleep(300);
    await shot(page, name, vp);
    await context.close();
  }
  for (const [name, key, text] of [["ceremonia-msg-sin-pro", "free", "parte de IATOS PRO"], ["ceremonia-msg-ya-activa", "locked", "ya está activa"], ["ceremonia-msg-aun-no", "progress", "Aún no es momento"]]) {
    if (!want(name)) continue;
    server = { status: STATUSES[key], accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp);
    await page.goto(`${BASE}/prive/invitacion`);
    await waitText(page, text);
    await sleep(900);
    await shot(page, name, vp);
    await context.close();
  }
}

async function runMembership(browser, vp) {
  const want = (n) => !ONLY || ONLY.test(n);
  if (want("membresia-desbloqueada")) {
    server = { status: STATUSES.unlocked, accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp, { priveSession: true });
    await page.goto(`${BASE}/prive/membresia`);
    await waitText(page, "Tu membresía");
    await sleep(1400);
    await shot(page, "membresia-desbloqueada", vp);
    await page.getByRole("heading", { name: "Contraseña Privé" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await sleep(300);
    await shot(page, "membresia-desbloqueada-acciones", vp);
    await context.close();
  }
  if (want("membresia-pausada")) {
    server = { status: STATUSES.paused_pro, accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp);
    await page.goto(`${BASE}/prive/membresia`);
    await waitText(page, "Pausada porque tu PRO terminó");
    await sleep(1200);
    await shot(page, "membresia-pausada-pro-termino", vp);
    await context.close();
  }
  for (const [name, extra, text] of [
    ["restablecer-1-pedir-enlace", {}, "Enviarme el enlace"],
    ["restablecer-2-nueva-contrasena", { "iatos.prive.reset_token": "resettoken_0123456789abcdef" }, "Guardar contraseña nueva"],
  ]) {
    if (!want(name)) continue;
    server = { status: STATUSES.locked, accept: { ok: true }, calls: [] };
    const { context, page } = await newPage(browser, vp, { extraSession: extra });
    await page.goto(`${BASE}/prive/restablecer`);
    await waitText(page, text);
    await sleep(1000);
    await shot(page, name, vp);
    await context.close();
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const vp of VIEWPORTS) {
    await runHub(browser, vp);
    await runCeremony(browser, vp, false);
    await runMembership(browser, vp);
  }
  // Movimiento reducido (prefers-reduced-motion: reduce) en los tres tamaños.
  if (process.env.SKIP_REDUCED !== "1") for (const vp of VIEWPORTS) await runCeremony(browser, vp, true);
} finally {
  await browser.close();
}
// Peso en el repo: las capturas móviles (DSF 2) se reducen a píxeles CSS y todas pasan a PNG de
// 256 colores con ImageMagick (si está instalado). Sin esto, 165 capturas pesan ~96 MB.
if (process.env.NO_SHRINK !== "1") {
  for (const f of results) {
    const mobile = /__(390x844|412x915)/.test(f);
    try {
      execFileSync("convert", [f, ...(mobile ? ["-resize", "50%"] : []), "-colors", "256", `PNG8:${f}`]);
    } catch { /* sin ImageMagick: se quedan como están */ }
  }
}
writeFileSync(join(OUT, "INDEX.txt"), results.map((f) => f.split("/").pop()).sort().join("\n") + "\n");
console.log(JSON.stringify({ screenshots: results.length, blockedHosts: [...blocked] }, null, 2));
