// Evidencia visual de IATOS Wrapped. SOLO PRUEBAS: nada aquí llama a producción.
//
// · Vite corre con VITE_SUPABASE_URL apuntando a un host simulado y este script responde TODAS las
//   llamadas a ese host con datos ficticios (persona de prueba). Cualquier otra petición externa se
//   bloquea. Las "fotos" son SVG generados aquí con la leyenda "foto simulada".
// · Capturas de cada tarjeta en 390×844 y 1440×900, el diálogo de compartir, las imágenes que se
//   descargan (sin y con «Incluir mis fotos»), el estado vacío y el aviso de diciembre en el inicio.
//
// Uso:
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock \
//     npx vite --host 127.0.0.1 --port 8093 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules CHROMIUM=/opt/pw-browsers/chromium \
//     node scripts/wrapped/ui_evidence.mjs http://127.0.0.1:8093 /ruta/salida
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8093";
const OUT = process.argv[3] || "/tmp/wrapped-evidence";
const MOCK_HOST = "supabase-mock.localhost:54399";
const MOCK = `http://${MOCK_HOST}`;
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
].filter((v) => !process.env.VP || v.name === process.env.VP);

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 400; // el reloj simulado llega a diciembre
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "viajera.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };

// ── Datos ficticios ──
const T = (id, o) => ({ id: `00000000-0000-4000-8000-00000000${id}`, user_id: USER_ID, ciudad_origen: "Ciudad de México", pais_destino: null, itinerario_json: null, num_viajeros: 2, total_estimado: null, hospedaje_json: null, ...o });
const OWN = [
  T("1001", { destino: "Lisboa", pais_destino: "Portugal", fecha_salida: "2026-02-12", fecha_regreso: "2026-02-18" }),
  T("1002", { destino: "Kioto", pais_destino: "Japón", fecha_salida: "2026-04-02", fecha_regreso: "2026-04-15" }),
  T("1003", { destino: "Roma → Florencia → Venecia", itinerario_json: { multi: true, destinations: ["Roma", "Florencia", "Venecia"] }, fecha_salida: "2026-07-03", fecha_regreso: "2026-07-20" }),
  T("1004", { destino: "Oaxaca", pais_destino: "México", fecha_salida: "2026-07-28", fecha_regreso: "2026-08-02" }),
  T("1005", { destino: "Tokio", pais_destino: "Japón", fecha_salida: "2026-12-20", fecha_regreso: "2026-12-30" }),
  T("1006", { destino: "Cartagena", pais_destino: "Colombia", fecha_salida: "2025-11-10", fecha_regreso: "2025-11-15" }),
];
const SHARED = [T("2001", { user_id: "00000000-0000-4000-8000-0000000000b2", destino: "Nueva York", pais_destino: "Estados Unidos", fecha_salida: "2026-09-18", fecha_regreso: "2026-09-23" })];
const COORDS = {
  "ciudad de mexico": [19.4326, -99.1332], "lisboa, portugal": [38.7223, -9.1393], "kioto, japon": [35.0116, 135.7681],
  "roma, italia": [41.9028, 12.4964], "florencia, italia": [43.7696, 11.2558], "venecia, italia": [45.4408, 12.3155],
  "oaxaca, mexico": [17.0732, -96.7266], "nueva york, estados unidos": [40.7128, -74.006], "cartagena, colombia": [10.391, -75.4794],
};
const MOMENTS = [
  { id: "m1", trip_id: OWN[0].id, caption: "Tranvía 28 subiendo a Alfama", destino: "Lisboa", created_at: "2026-02-14T18:00:00Z", tags: ["cultura"], image_path: `${USER_ID}/m1.jpg`, image_url: null },
  { id: "m2", trip_id: OWN[1].id, caption: "Los cerezos de Philosopher's Path al amanecer, sin nadie alrededor", destino: "Kioto", created_at: "2026-04-05T06:00:00Z", tags: ["naturaleza", "cultura", "relax"], image_path: `${USER_ID}/m2.jpg`, image_url: null },
  { id: "m3", trip_id: OWN[2].id, caption: "Cacio e pepe en Trastevere", destino: "Roma", created_at: "2026-07-04T21:00:00Z", tags: ["gastronomía"], image_path: `${USER_ID}/m3.jpg`, image_url: null },
  { id: "m4", trip_id: OWN[2].id, caption: null, destino: "Venecia", created_at: "2026-07-18T19:00:00Z", tags: [], image_path: `${USER_ID}/m4.jpg`, image_url: null },
  { id: "m5", trip_id: OWN[3].id, caption: "Mezcal en Santiago Matatlán", destino: "Oaxaca", created_at: "2026-07-30T19:00:00Z", tags: ["gastronomía"], image_path: `${USER_ID}/m5.jpg`, image_url: null },
];
const JOURNAL = [{ id: "j1", trip_id: SHARED[0].id, text: "Central Park en otoño", created_at: "2026-09-19T15:00:00Z", photo_path: `${USER_ID}/${SHARED[0].id}/j1.jpg` }];
const EXPENSES = [
  { amount: 18400, currency: "MXN", category: "Hospedaje", expense_date: "2026-02-13" },
  { amount: 2600, currency: "MXN", category: "Restaurantes", expense_date: "2026-02-15" },
  { amount: 31200, currency: "MXN", category: "Hospedaje", expense_date: "2026-04-03" },
  { amount: 9800, currency: "MXN", category: "Tours y experiencias", expense_date: "2026-07-06" },
  { amount: 4100, currency: "MXN", category: "Restaurantes", expense_date: "2026-07-29" },
];
const VISITS = [{ category: "museum", visited_at: "2026-04-04T10:00:00Z" }, { category: "restaurant", visited_at: "2026-07-05T10:00:00Z" }, { category: "landmark", visited_at: "2026-07-10T10:00:00Z" }];
const PLACES = Array.from({ length: 14 }, (_, i) => ({ visited_at: `2026-0${(i % 8) + 2}-10T10:00:00Z` }));
const COMPANIONS = [{ name: "Carlos Ruiz", shared_trips: 3 }, { name: "Lía Méndez", shared_trips: 1 }, { name: "Tomás Vega", shared_trips: 1 }];
const BADGES = [{ id: "primer_viaje", nombre: "Primer sello", icono: "🛂" }, { id: "multi", nombre: "Ruta multidestino", icono: "🧭" }, { id: "fotos", nombre: "Coleccionista de momentos", icono: "📸" }];
const USER_BADGES = BADGES.map((b, i) => ({ badge_id: b.id, unlocked_at: `2026-0${i + 3}-01T00:00:00Z` }));

let scenario = "full";

const PALETTES = [["#f6c27a", "#e0794f", "#3b2a4a"], ["#ffd6e0", "#f19bb5", "#5a3d5c"], ["#ffcf8a", "#d98b3a", "#2c3e50"], ["#9ad1e6", "#3f7fa6", "#1d2b3a"], ["#f3b562", "#b6572e", "#2b1d16"], ["#c8e6c9", "#6a9f6d", "#20332a"]];
function photoSvg(seed) {
  const [a, b, c] = PALETTES[seed % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
<rect width="900" height="1200" fill="url(#s)"/><circle cx="${300 + seed * 70}" cy="520" r="120" fill="#fff6dd" opacity="0.85"/>
<path d="M0 820 L180 640 L330 760 L520 560 L700 720 L900 600 L900 1200 L0 1200 Z" fill="${c}" opacity="0.85"/>
<path d="M0 950 L240 820 L460 920 L700 800 L900 880 L900 1200 L0 1200 Z" fill="#000" opacity="0.35"/>
<text x="450" y="1150" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#fff" opacity="0.7">foto simulada</text></svg>`;
}
function avatarSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#2b2416"/>
<circle cx="300" cy="240" r="120" fill="#d8b48a"/><path d="M90 600 Q300 330 510 600 Z" fill="#7a5a3a"/><text x="300" y="560" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#fff" opacity="0.7">avatar simulado</text></svg>`;
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" }, body: JSON.stringify(body) });
const calls = [];

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  const p = url.pathname;
  const q = url.search;
  calls.push(`${req.method()} ${p}${q}`);
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  const empty = scenario === "empty";
  if (p === "/functions/v1/geocode") {
    const body = JSON.parse(req.postData() || "{}");
    const nk = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = Object.keys(COORDS).find((c) => nk(c) === nk(body.address));
    return json(route, { results: key ? [{ lat: COORDS[key][0], lng: COORDS[key][1] }] : [] });
  }
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/storage/v1/object/sign/") && req.method() === "POST") {
    const bucket = p.replace("/storage/v1/object/sign/", "");
    const body = JSON.parse(req.postData() || "{}");
    return json(route, (body.paths || []).map((path) => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=mock`, error: null })));
  }
  if (p.startsWith("/storage/v1/object/public/avatars/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: avatarSvg() });
  if (p.startsWith("/storage/v1/")) {
    const seed = Number((p.match(/m(\d)\.jpg|j(\d)\.jpg/) || [])[1] || (p.match(/j(\d)/) || [])[1] || 0);
    return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: photoSvg(seed) });
  }
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p === "/rest/v1/rpc/wrapped_companions") return json(route, empty ? [] : COMPANIONS);
  if (p.startsWith("/rest/v1/rpc/")) return json(route, null);
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: USER_ID, full_name: "Valentina Prueba", ciudad_origen: "Ciudad de México", avatar_url: `${MOCK}/storage/v1/object/public/avatars/${USER_ID}.png`, active_trip_id: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/trips")) {
    if (empty) return json(route, single ? null : []);
    if (q.includes("id=in.")) return json(route, SHARED);
    if (q.includes("user_id=eq.")) return json(route, OWN);
    return json(route, single ? null : [...OWN, ...SHARED]);
  }
  if (p.startsWith("/rest/v1/trip_collaborators")) return json(route, empty ? [] : [{ trip_id: SHARED[0].id }]);
  if (p.startsWith("/rest/v1/travel_moments")) return json(route, empty ? [] : MOMENTS);
  if (p.startsWith("/rest/v1/trip_journal_entries")) return json(route, empty ? [] : JOURNAL);
  if (p.startsWith("/rest/v1/expenses")) return json(route, empty ? [] : EXPENSES);
  if (p.startsWith("/rest/v1/user_visits")) return json(route, empty ? [] : VISITS);
  if (p.startsWith("/rest/v1/visited_places")) return json(route, empty ? [] : PLACES);
  if (p.startsWith("/rest/v1/user_badges")) return json(route, empty ? [] : USER_BADGES);
  if (p.startsWith("/rest/v1/badges")) return json(route, BADGES);
  if (p.startsWith("/rest/v1/")) return json(route, single ? null : []);
  return json(route, {});
}

const blocked = new Set();
async function newPage(browser, vp, { reduced = true, clock = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "block", acceptDownloads: true,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return handle(route).catch((e) => { console.log("HANDLE ERROR", u.pathname, e.message); return route.abort(); });
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    blocked.add(u.host);
    return route.abort();
  });
  await context.addInitScript(([key, sess]) => {
    try { localStorage.setItem(key, JSON.stringify(sess)); localStorage.setItem("iatos_cookie_consent_v2", "essential"); } catch { /* noop */ }
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  const page = await context.newPage();
  if (clock) await page.clock.setFixedTime(new Date(clock));
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  return { context, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const checks = [];
async function shot(page, name, vp) {
  const file = join(OUT, `${name}__${vp.name}.png`);
  await page.screenshot({ path: file });
  results.push(file);
  // Sin scroll horizontal ni texto desbordado dentro de la tarjeta.
  const m = await page.evaluate(() => {
    const art = document.querySelector("article[data-testid^='wrapped-card-']");
    const over = [];
    if (art) {
      const box = art.getBoundingClientRect();
      for (const el of art.querySelectorAll("h2,p,blockquote,li,dd,span,a")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1) over.push(`${el.tagName}:${(el.textContent || "").slice(0, 30)}`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "hidden" && !el.className.includes("truncate")) over.push(`clip ${el.tagName}:${(el.textContent || "").slice(0, 30)}`);
      }
    }
    return { hscroll: document.documentElement.scrollWidth > window.innerWidth, over };
  });
  checks.push({ name: `${name}__${vp.name}`, ...m });
}

async function run(browser, vp) {
  scenario = "full";
  let { context, page } = await newPage(browser, vp, { clock: "2026-10-22T12:00:00-06:00" });
  await page.goto(`${BASE}/wrapped/2026`);
  await page.getByTestId("wrapped-card-cover").waitFor({ timeout: 30000 });
  await sleep(1500);
  const total = await page.locator("[data-testid^='wrapped-progress-']").count();
  for (let i = 0; i < total; i++) {
    const kind = (await page.evaluate(() => document.querySelector("article[data-testid^='wrapped-card-']")?.getAttribute("data-testid") ?? "")).replace("wrapped-card-", "");
    await page.waitForFunction(() => [...document.querySelectorAll("article img")].every((im) => im.complete), null, { timeout: 8000 }).catch(() => {});
    await sleep(350);
    await shot(page, `${String(i + 1).padStart(2, "0")}-${kind}`, vp);
    if (kind === "photos") {
      await page.getByRole("button", { name: /Compartir/ }).click();
      await page.getByRole("dialog").waitFor(); await sleep(300);
      await shot(page, `${String(i + 1).padStart(2, "0")}-${kind}-compartir-dialogo`, vp);
      if (vp.name === "390") {
        for (const withPhotos of [false, true]) {
          if (withPhotos) { await page.getByRole("switch", { name: "Incluir mis fotos" }).click(); await sleep(200); }
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Descargar imagen/ }).click()]);
          const f = join(OUT, `imagen-compartida-fotos-${withPhotos ? "con" : "sin"}-fotos.png`);
          await dl.saveAs(f); results.push(f);
        }
      }
      await page.keyboard.press("Escape"); await sleep(300);
    }
    if (vp.name === "390" && (kind === "km" || kind === "cover" || kind === "moment")) {
      await page.getByRole("button", { name: /Compartir/ }).click();
      await page.getByRole("dialog").waitFor(); await sleep(200);
      if (kind !== "km") await page.getByRole("switch", { name: "Incluir mis fotos" }).click();
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Descargar imagen/ }).click()]);
      const f = join(OUT, `imagen-compartida-${kind}${kind !== "km" ? "-con-fotos" : ""}.png`);
      await dl.saveAs(f); results.push(f);
      if (kind !== "km") {
        await page.getByRole("switch", { name: "Incluir mis fotos" }).click();
        const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Descargar imagen/ }).click()]);
        const f2 = join(OUT, `imagen-compartida-${kind}-sin-fotos.png`);
        await dl2.saveAs(f2); results.push(f2);
      }
      await page.keyboard.press("Escape"); await sleep(300);
    }
    await page.keyboard.press("ArrowRight");
    await sleep(250);
  }
  await context.close();

  // Animación real (sin reducir movimiento): una captura a media entrada para ver el ritmo.
  ({ context, page } = await newPage(browser, vp, { reduced: false }));
  await page.goto(`${BASE}/wrapped/2026`);
  await page.getByTestId("wrapped-card-cover").waitFor({ timeout: 30000 });
  await sleep(2600);
  await shot(page, "00-portada-con-animacion-y-progreso", vp);
  await context.close();

  // Aviso destacado de diciembre en el inicio y acceso en el perfil.
  ({ context, page } = await newPage(browser, vp, { clock: "2026-12-05T12:00:00-06:00" }));
  await page.goto(`${BASE}/dashboard`);
  await page.getByTestId("wrapped-promo").waitFor({ timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: join(OUT, `debug-dashboard__${vp.name}.png`) });
    console.log(await page.evaluate(() => [Date(), document.body.innerText.slice(0, 600)]));
    throw e;
  });
  await page.getByTestId("wrapped-promo").scrollIntoViewIfNeeded(); await sleep(800);
  await shot(page, "20-inicio-aviso-diciembre", vp);
  await page.goto(`${BASE}/dashboard/perfil`);
  await page.getByTestId("wrapped-promo").waitFor({ timeout: 30000 });
  await page.getByTestId("wrapped-promo").scrollIntoViewIfNeeded(); await sleep(800);
  await shot(page, "21-perfil-acceso", vp);
  await context.close();

  // Sin viajes en el año: estado vacío (sin tarjetas de relleno).
  scenario = "empty";
  ({ context, page } = await newPage(browser, vp));
  await page.goto(`${BASE}/wrapped/2026`);
  await page.getByText("aún está por escribirse").waitFor({ timeout: 30000 }); await sleep(500);
  await shot(page, "22-sin-viajes", vp);
  await context.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
try {
  for (const vp of VIEWPORTS) await run(browser, vp);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "checks.json"), JSON.stringify({ checks, blocked: [...blocked] }, null, 2));
console.log(results.join("\n"));
const bad = checks.filter((c) => c.hscroll || c.over.length);
console.log(`\nCHECKS: ${checks.length} capturas, ${bad.length} con problemas`);
for (const b of bad) console.log("  ", b.name, b.hscroll ? "SCROLL-H" : "", b.over.join(" | "));
console.log("Hosts bloqueados:", [...blocked].join(", ") || "ninguno");
