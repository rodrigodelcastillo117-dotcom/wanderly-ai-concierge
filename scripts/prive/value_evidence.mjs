// Evidencia visual de privevalor (Privé Drops + Radar, Insider + Before You Go, Value of Your Privé, Passport
// y la vista previa antes del día 90). SOLO PRUEBAS: nada aquí llama a producción ni inicia sesión como una
// persona real. Mismo método que scripts/prive/ui_evidence.mjs:
//  · Vite local con VITE_SUPABASE_URL apuntando a un host simulado; page.route intercepta TODO ese host y
//    responde con datos de prueba construidos desde la curaduría verificada (data/prive/valor/2026-10).
//  · Cualquier otra petición externa se bloquea (salvo Google Fonts, descargada con curl por el proxy).
//  · Passport y Value (ranuras de MY PRIVÉ que monta prive-ux) se capturan en un arnés de prueba local
//    (scripts/prive/value_harness/index.html), que NO es parte del build.
// Uso:
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock npx vite --port 8093 --strictPort &
//   node scripts/prive/value_evidence.mjs http://localhost:8093 docs/iatos/evidencia/privevalor
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright");
const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8093";
const OUT = process.argv[3] || "docs/iatos/evidencia/privevalor";
const MOCK_HOST = "supabase-mock.localhost:54399";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/prive-ui-font-cache";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440x900", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];
const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "miembro.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };
const PRIVE_SESSION = { token: "pv_mock_session_token_0123456789abcdef", expiresAt: new Date(Date.now() + 11 * 3600e3).toISOString(), userId: USER_ID };
const base = { is_pro: true, tenure_days: 124, required_days: 90, eligible: true, basis: "tenure", membership_status: "active", has_password: true,
  password_status: "active", locked_until: null, activated_at: "2026-07-01T18:30:00Z", member_code: "IP-7KQM-X4TD", first_name: "Valentina",
  welcome_version_seen: 1, onboarding: { version: 1, step: 5, completed_at: "2026-07-01T18:40:00Z" }, invitation_pending: false, members_requires_prive: false };
const PROGRESS = { ...base, tenure_days: 47, eligible: false, basis: null, membership_status: "none", has_password: false, password_status: "none", activated_at: null, member_code: null };

// ── Datos de prueba desde la curaduría verificada ──
const DEST = { paris: ["París", "Paris"], mc: ["Mónaco", "Monaco"], cdmx: ["Ciudad de México", "Mexico City"], tokio: ["Tokio", "Tokyo"],
  "los-cabos": ["Los Cabos", "Los Cabos"], "nueva-york": ["Nueva York", "New York"], londres: ["Londres", "London"] };
const dest = (s) => (s ? { slug: s, es: DEST[s]?.[0] ?? s, en: DEST[s]?.[1] ?? s } : null);
const rawDrops = JSON.parse(readFileSync(join(here, "../../data/prive/valor/2026-10/drops.json"), "utf8"));
const rawTips = JSON.parse(readFileSync(join(here, "../../data/prive/valor/2026-10/insider.json"), "utf8"));
const drops = rawDrops.map((r, i) => ({ id: `d${i}`, slug: r.slug, type: r.type, status: "activo", title: { es: r.title_es, en: r.title_en },
  provider: { name: r.provider_name, url: r.provider_url }, destination: dest(r.destination_slug), benefit: { es: r.benefit_es, en: r.benefit_en },
  conditions: { es: r.conditions_es, en: r.conditions_en }, eligibility: { es: r.eligibility_es, en: r.eligibility_en },
  restrictions: { es: r.restrictions_es, en: r.restrictions_en }, valid_from: r.valid_from ?? null, valid_until: r.valid_until ?? null,
  price: r.offer_price != null ? { offer: r.offer_price, reference: r.reference_price ?? null, currency: r.price_currency, source: r.price_source_url, discount_pct: r.discount_pct ?? null } : null,
  source: { url: r.source_url, name: r.source_name }, link: r.link_url, last_verified_at: r.last_verified_at, relationship: "ninguna",
  reasons: r.destination_slug === "paris" ? ["viaje"] : r.slug.startsWith("marriott") ? ["boveda"] : [] }));
const tips = rawTips.map((r, i) => ({ id: `t${i}`, slug: r.slug, category: r.category, destination: dest(r.destination_slug), title: { es: r.title_es, en: r.title_en },
  body: { es: r.body_es, en: r.body_en }, before_you_go: !!r.before_you_go, rank: r.rank ?? 50, valid_until: r.valid_until ?? null, months: r.months ?? null,
  source: { url: r.source_url, name: r.source_name, checked_at: r.source_checked_at }, stale: false, saved: false }));
const inDays = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const TRIP = { id: "trip-paris", destino: "París, Francia", fecha_salida: inDays(10), fecha_regreso: inDays(15), destination_slug: "paris" };
const order = [...drops].sort((a, b) => b.reasons.length - a.reasons.length);
const byDest = (slug) => tips.filter((t) => t.destination.slug === slug);
const index = { destinations: Object.keys(DEST).map((s) => ({ slug: s, es: DEST[s][0], en: DEST[s][1], tips: byDest(s).length, before_you_go: byDest(s).filter((t) => t.before_you_go).length, last_checked: "2026-10-22" })), saved: 0, trips: [TRIP] };
const RPC = {
  prive_drops: () => ({ items: order, expired_recent: 0, destination_found: true }),
  prive_radar: () => ({ programs: [{ kind: "hotel", label: "Marriott Bonvoy", tier: "Gold Elite" }, { kind: "tarjeta", label: "Banco de prueba Platinum", tier: "Platinum" }],
    items: [{ id: "r1", program: "Banco de prueba Platinum", benefit: "Acceso a salas de aeropuerto según mi banco", state: "por_comprobar", conditions: "Lo registré yo; falta confirmarlo con el emisor." }],
    suggestions: drops.filter((d) => d.slug.startsWith("marriott")).map((d) => ({ ...d, matched_program: "Marriott Bonvoy", suggested_state: "posible" })) }),
  prive_insider_index: () => index,
  prive_insider: (b) => ({ found: true, destination: dest(b._destination), trips: [TRIP], tips: byDest(b._destination) }),
  prive_before_you_go: () => ({ trip: { ...TRIP, days_until: 10 }, destination: dest("paris"), tips: byDest("paris").filter((t) => t.before_you_go).slice(0, 5) }),
  prive_value_summary: () => ({ totals: {}, organized_plans: 1, radar: { posible: 2, por_comprobar: 1, verificado: 0, utilizado: 0 }, entries: [
    { id: "v1", kind: "comprobado", title: "Louvre, primer viernes del mes (2 personas)", currency: "EUR", reference_amount: 64, paid_amount: 0, savings_amount: 64,
      reference_source: "Tarifa oficial para visitantes de fuera del EEE (€32 por persona)", evidence_note: "Boletos con horario reservado", occurred_on: "2026-10-02" },
    { id: "v2", kind: "estimado", title: "Mejora de habitación con puntos", currency: "MXN", reference_amount: 5200, paid_amount: 4100, savings_amount: 1100,
      reference_source: "Diferencia publicada entre las dos habitaciones en el sitio del hotel" },
    { id: "v3", kind: "sin_ahorro", title: "Aniversario en la Ciudad de México", non_monetary_note: "Noche completa organizada con The Privé Key" } ] }),
  prive_passport: () => ({ member: { first_name: "Valentina", member_code: "IP-7KQM-X4TD", member_since: "2026-07-01T18:30:00Z", tenure_days: 113, status: "active", founding_member: false },
    stats: { visitado: 2, experiencia: 1, favorito: 0, deseo: 1, recuerdo: 1, countries: 2 }, entries: [
      { id: "p1", kind: "deseo", title: "Ver los cerezos en flor", happened_on: "2027-04-01", destination: dest("tokio") },
      { id: "p2", kind: "recuerdo", title: "Primer viernes en el Louvre", note: "La Victoria de Samotracia casi a solas, a las 19:30.", happened_on: "2026-10-02", destination: dest("paris") },
      { id: "p3", kind: "visitado", title: "Mónaco por primera vez", happened_on: "2025-06-14", destination: dest("mc") },
      { id: "p4", kind: "experiencia", title: "Domingo en el Museo Nacional de Antropología", happened_on: "2025-02-09", destination: dest("cdmx") } ] }),
  prive_value_track: () => true, prive_preview_track: () => true,
  prive_teaser: () => ({ universes: [], total: 0, destinations: Object.keys(DEST).map((s) => ({ slug: s, name: DEST[s][0], region_group: s === "cdmx" || s === "los-cabos" ? "mexico" : s === "tokio" ? "asia_oceania" : s === "nueva-york" ? "norteamerica" : "europa", kind: "locality", coverage: "COBERTURA_PARCIAL", count: 0 })) }),
};
let STATUS = base;

function fetchFont(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = join(FONT_CACHE, key);
  if (!existsSync(file)) {
    try {
      const args = ["-sS", "-L", "--max-time", "20", "-o", file, "-w", "%{content_type}", url];
      if (existsSync("/root/.ccr/ca-bundle.crt")) args.unshift("--cacert", "/root/.ccr/ca-bundle.crt");
      writeFileSync(file + ".type", execFileSync("curl", args, { encoding: "utf8" }) || "application/octet-stream");
    } catch { return null; }
  }
  return { body: readFileSync(file), type: existsSync(file + ".type") ? readFileSync(file + ".type", "utf8") : "application/octet-stream" };
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const blocked = new Set();
async function handle(route) {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  const p = new URL(req.url()).pathname;
  let body = {};
  try { body = req.postDataJSON() ?? {}; } catch { body = {}; }
  if (p === "/rest/v1/rpc/prive_status") return json(route, STATUS);
  const m = /^\/rest\/v1\/rpc\/(prive_[a-z_]+)$/.exec(p);
  if (m && RPC[m[1]]) return json(route, RPC[m[1]](body));
  if (m) return json(route, { code: "PGRST202", message: "no existe en el simulador" }, 404);
  if (p.startsWith("/functions/v1/")) return json(route, { ok: true });
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, (req.headers()["accept"] || "").includes("vnd.pgrst.object") ? row : [row]);
  }
  if (p.startsWith("/rest/v1/")) return json(route, (req.headers()["accept"] || "").includes("vnd.pgrst.object") ? null : []);
  return json(route, {});
}
async function newPage(browser, vp, lang = "es-MX") {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile,
    hasTouch: vp.hasTouch, locale: lang, timezoneId: "America/Mexico_City" });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return handle(route);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com") {
      const f = fetchFont(u.toString());
      return f ? route.fulfill({ status: 200, contentType: f.type, headers: { "access-control-allow-origin": "*" }, body: f.body }) : route.abort();
    }
    blocked.add(u.host);
    return route.abort();
  });
  await context.addInitScript(([sess, ps]) => {
    try {
      localStorage.setItem("sb-supabase-mock-auth-token", JSON.stringify(sess));
      localStorage.setItem("iatos_cookie_consent_v2", "essential");
      localStorage.setItem("iatos.prive.session", JSON.stringify(ps));
      sessionStorage.setItem("iatos.prive.session", JSON.stringify(ps));
    } catch { /* noop */ }
  }, [AUTH_SESSION, PRIVE_SESSION]);
  return { context, page: await context.newPage() };
}
const results = [];
const problems = [];
async function shot(page, name, vp, full = false) {
  const file = join(OUT, `${name}__${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`${name} ${vp.name}: scroll horizontal de ${overflow}px`);
  results.push(file);
}
const SCENES = [
  { name: "drops", path: "/prive/drops", wait: "PRIVÉ DROPS" },
  { name: "drops-radar", path: "/prive/drops#radar", wait: "THE PRIVILEGE RADAR", scroll: "#radar" },
  { name: "insider", path: "/prive/insider", wait: "BEFORE YOU GO" },
  { name: "insider-monaco", path: "/prive/insider/mc", wait: "Casino de Monte-Carlo" },
  { name: "my-prive-slots", path: "/scripts/prive/value_harness/index.html", wait: "THE PRIVÉ PASSPORT" },
  { name: "my-prive-value", path: "/scripts/prive/value_harness/index.html", wait: "THE VALUE OF YOUR PRIVÉ", scroll: "[data-testid=prive-value]" },
  { name: "preview-dia-47", path: "/scripts/prive/value_harness/index.html?preview=1", wait: "Llevas 47 de 90", status: PROGRESS },
  { name: "insider-en", path: "/prive/insider/paris", wait: "The Louvre is closed on Tuesdays", lang: "en-US" },
];
const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    for (const s of SCENES) {
      STATUS = s.status ?? base;
      const { context, page } = await newPage(browser, vp, s.lang);
      await page.goto(BASE + s.path, { waitUntil: "domcontentloaded" });
      try {
        await page.getByText(s.wait, { exact: false }).first().waitFor({ state: "visible", timeout: results.length ? 30000 : 120000 });
      } catch (e) {
        await page.screenshot({ path: join(OUT, `_error_${s.name}__${vp.name}.png`) });
        problems.push(`${s.name} ${vp.name}: no apareció "${s.wait}" · url=${page.url()} · texto=${(await page.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " ")}`);
        await context.close();
        continue;
      }
      await page.evaluate(() => document.fonts?.ready);
      if (s.scroll) await page.locator(s.scroll).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, s.name, vp);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, files: results, blocked_hosts: [...blocked], problems,
  note: "Datos simulados desde data/prive/valor/2026-10 (verificados). Sin producción ni sesiones reales. Chromium emulado." }, null, 2));
console.log(`capturas: ${results.length} · bloqueados: ${[...blocked].join(", ") || "ninguno"} · problemas: ${problems.join("; ") || "ninguno"}`);
