// Evidencia visual de la Bóveda (grupo boveda). SOLO PRUEBAS: nada aquí llama a producción.
//
// · Vite corre con VITE_SUPABASE_URL apuntando a un host simulado y este script responde TODAS
//   las llamadas a ese host con datos ficticios (persona de prueba, números inventados). Cualquier
//   otra petición externa se bloquea, salvo Google Fonts (tipografía).
// · La "foto" del pasaporte es un SVG generado aquí con la leyenda "foto simulada".
// · Viewports emulados en Chromium (no son dispositivos reales).
//
// Uso:
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock \
//     npx vite --host 127.0.0.1 --port 8091 --strictPort &
//   PLAYWRIGHT_DIR=/ruta/con/node_modules/playwright node scripts/boveda/ui_evidence.mjs http://127.0.0.1:8091 docs/iatos/evidencia/boveda
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8091";
const OUT = process.argv[3] || "docs/iatos/evidencia/boveda";
const ROUND = process.env.ROUND || "";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const MOCK_HOST = "supabase-mock.localhost:54399";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/boveda-ui-font-cache";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
].filter((v) => !process.env.VP || v.name === process.env.VP);

const USER_ID = "00000000-0000-4000-8000-0000000000b7";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "viajera.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const base = { user_id: USER_ID, program_id: null, tier_id: null, issuer: null, tier: null, number: null, holder_name: null, country_code: null,
  visa_type: null, entries: null, valid_from: null, expires_on: null, contact_phone: null, benefits: [], benefits_unverified: false, notes: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
const it = (o) => ({ ...base, id: id(), ...o });

// Datos ficticios (números inventados, persona de prueba).
const PASSPORT = it({ section: "documento", kind: "pasaporte", title: "Pasaporte mexicano", number: "G48213907", country_code: "MX", holder_name: "VALENTINA PRUEBA", valid_from: "2021-03-10", expires_on: "2027-03-10" });
const VISA = it({ section: "documento", kind: "visa", title: "Visa EUA", number: "V30441218", country_code: "US", visa_type: "B1/B2 turista", entries: "multiple", holder_name: "VALENTINA PRUEBA", valid_from: "2019-05-02", expires_on: "2029-05-01" });
const INE = it({ section: "documento", kind: "ine", title: "INE", number: "PRBVLN90010109M100", holder_name: "VALENTINA PRUEBA", expires_on: "2031-12-31" });
const LIC = it({ section: "documento", kind: "licencia", title: "Licencia de manejo", issuer: "Ciudad de México", number: "A0912384", holder_name: "VALENTINA PRUEBA", expires_on: "2026-12-04" });
const AM = it({ section: "membresia", kind: "aerolinea", title: "Aeroméxico Rewards", program_id: "aeromexico-rewards", tier_id: "skyteam-elite-plus", tier: "Platino", number: "00412887351" });
const MAR = it({ section: "membresia", kind: "hotel", title: "Marriott Bonvoy", program_id: "marriott-bonvoy", tier_id: "titanium", tier: "Titanium Elite", number: "889012345" });
const HZ = it({ section: "membresia", kind: "auto", title: "Hertz Gold Plus Rewards", program_id: "hertz-gold-plus", tier_id: "presidents-circle", tier: "President's Circle", number: "77821033" });
const PP = it({ section: "membresia", kind: "sala", title: "Priority Pass", program_id: "priority-pass", tier_id: "prestige", tier: "Prestige", number: "1124 9900 3311 4502", expires_on: "2027-08-31" });
const RC = it({ section: "membresia", kind: "crucero", title: "Royal Caribbean Crown & Anchor Society", program_id: "royal-caribbean-cas", tier_id: "diamond", tier: "Diamond", number: "381992004" });
const GE = it({ section: "membresia", kind: "viajero_confiable", title: "Global Entry", program_id: "global-entry", tier_id: "miembro", tier: "Miembro", number: "158723094", expires_on: "2026-11-30" });
const VOL = it({ section: "membresia", kind: "aerolinea", title: "Volaris (v.club / Altitude)", program_id: "volaris", number: "VC209384" });
const PLAT = it({ section: "tarjeta", kind: "tarjeta", title: "The Platinum Card® American Express (México)", program_id: "amex-platinum-mx", tier_id: "titular", tier: "Platino", issuer: "American Express", number: "1005" });
const CEN = it({ section: "tarjeta", kind: "tarjeta", title: "Centurion® American Express", program_id: "amex-centurion", tier: "Centurion", issuer: "American Express", number: "3007", benefits: ["Escribe aquí los beneficios que te dio tu ejecutivo"] });
const BBVA = it({ section: "tarjeta", kind: "tarjeta", title: "Visa Infinite", program_id: "bbva-mx", tier: "Infinite", issuer: "BBVA México", number: "4410" });
const AXA = it({ section: "seguro", kind: "seguro_viaje", title: "Asistencia en viaje anual", issuer: "AXA", number: "POL-5520-77812", contact_phone: "+52 55 5169 2700", valid_from: "2026-01-15", expires_on: "2027-01-14",
  benefits: ["Gastos médicos por accidente o enfermedad", "Cancelación de viaje", "Pérdida de equipaje"] });

const FULL = [PASSPORT, VISA, INE, LIC, AM, MAR, HZ, PP, RC, GE, VOL, PLAT, CEN, BBVA, AXA];
const FILES = [
  { id: id(), user_id: USER_ID, item_id: PASSPORT.id, side: "frente", storage_path: `${USER_ID}/${PASSPORT.id}/${id()}.jpg`, mime: "image/jpeg", size: 412000, created_at: "2026-09-01T00:00:00Z" },
  { id: id(), user_id: USER_ID, item_id: VISA.id, side: "frente", storage_path: `${USER_ID}/${VISA.id}/${id()}.jpg`, mime: "image/jpeg", size: 380000, created_at: "2026-09-01T00:00:00Z" },
  { id: id(), user_id: USER_ID, item_id: AXA.id, side: "pdf", storage_path: `${USER_ID}/${AXA.id}/${id()}.pdf`, mime: "application/pdf", size: 812000, created_at: "2026-09-01T00:00:00Z" },
];
const TRIPS = [
  { id: id(), destino: "Londres", pais_destino: "Reino Unido", fecha_salida: "2027-01-08", fecha_regreso: "2027-01-16", status: "planeado" },
  { id: id(), destino: "Nueva York", pais_destino: "Estados Unidos", fecha_salida: "2026-12-03", fecha_regreso: "2026-12-08", status: "planeado" },
];
const SUMMARY = `Aeropuerto (CDMX y JFK)
• Priority Pass Prestige: visitas ilimitadas a salas para ti (los invitados se cobran).
• Aeroméxico Rewards con SkyTeam Elite Plus: documentación y abordaje prioritarios, sala SkyTeam con un acompañante del mismo vuelo y 1 pieza o 20 kg extra.
• Global Entry: entrada agilizada a EUA; tu KTN te da TSA PreCheck si lo agregas a la reservación.

Hotel
• Marriott Bonvoy Titanium Elite: 75% de puntos extra, habitación garantizada reservando con 48 h y mejora sujeta a disponibilidad.

Auto
• Hertz President's Circle: mejora garantizada de una categoría (en EUA, hasta tamaño completo).

Seguro
• AXA Asistencia en viaje anual: gastos médicos, cancelación y pérdida de equipaje; cubre tus fechas.

Confirma condiciones con cada programa antes de viajar.`;

let server = { items: FULL, files: FILES, trips: TRIPS, calls: [] };

const svgPassport = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="840" viewBox="0 0 1200 840">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9e3d2"/><stop offset="1" stop-color="#cfc6ae"/></linearGradient></defs>
<rect width="1200" height="840" fill="url(#g)"/><rect x="60" y="180" width="300" height="380" rx="12" fill="#b9ae93"/>
<g fill="#6b6250">${Array.from({ length: 8 }, (_, i) => `<rect x="420" y="${200 + i * 48}" width="${520 - (i % 3) * 90}" height="18" rx="4"/>`).join("")}</g>
<rect x="60" y="640" width="1080" height="34" fill="#8d846c" opacity=".6"/><rect x="60" y="700" width="1080" height="34" fill="#8d846c" opacity=".6"/>
<text x="600" y="110" text-anchor="middle" font-family="serif" font-size="46" fill="#5a5240">PASAPORTE · FOTO SIMULADA</text>
<text x="600" y="800" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#5a5240">imagen de prueba, sin datos reales</text></svg>`;

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

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  server.calls.push({ p, method: req.method() });
  if (p === "/functions/v1/ai-tool") return json(route, { ok: true, text: SUMMARY });
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/storage/v1/object/sign/") && req.method() === "POST") {
    const path = decodeURIComponent(p.replace("/storage/v1/object/sign/travel-vault/", ""));
    return json(route, { signedURL: `/object/sign/travel-vault/${path}?token=mock` });
  }
  if (p.startsWith("/storage/v1/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svgPassport() });
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/vault_items")) return json(route, single ? server.items[0] ?? null : server.items);
  if (p.startsWith("/rest/v1/vault_files")) return json(route, single ? null : server.files);
  if (p.startsWith("/rest/v1/trips")) return json(route, single ? null : server.trips);
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: USER_ID, full_name: "Valentina Prueba", avatar_url: null };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/")) return json(route, single ? null : []);
  return json(route, {});
}

const blocked = new Set();
async function newPage(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    locale: "es-MX", timezoneId: "America/Mexico_City",
  });
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
  await context.addInitScript(([key, sess]) => {
    try {
      localStorage.setItem(key, JSON.stringify(sess));
      localStorage.setItem("iatos_cookie_consent_v2", "essential");
      localStorage.removeItem("iatos.boveda.tab");
    } catch { /* noop */ }
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  return { context, page: await context.newPage() };
}

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name, vp, fullPage = false) {
  if (ONLY && !ONLY.test(name)) return;
  const file = join(OUT, `${ROUND ? ROUND + "-" : ""}${name}__${vp.name}.png`);
  await page.screenshot({ path: file, fullPage });
  results.push(file);
}

async function openVault(page) {
  await page.goto(`${BASE}/dashboard/beneficios`);
  await page.getByText("Todo tu viaje, a la mano").waitFor({ timeout: 20000 });
  await sleep(1200);
}
const tab = (page, name) => page.getByRole("tablist", { name: "Secciones de tu bóveda" }).getByRole("tab", { name: new RegExp(name) }).click();

async function run(browser, vp) {
  const mobile = vp.isMobile;
  server = { items: FULL, files: FILES, trips: TRIPS, calls: [] };
  let { context, page } = await newPage(browser, vp);
  await openVault(page);
  await shot(page, "01-documentos", vp);
  await shot(page, "01b-documentos-pagina-completa", vp, true);

  await tab(page, "Membresías"); await sleep(500);
  await shot(page, "02-membresias", vp);
  await tab(page, "Tarjetas"); await sleep(500);
  await shot(page, "03-tarjetas", vp);
  await tab(page, "Seguros"); await sleep(500);
  await shot(page, "04-seguros", vp);

  // Detalle de una membresía con beneficios curados y fuente.
  await tab(page, "Membresías"); await sleep(400);
  await page.getByRole("button", { name: "Abrir Marriott Bonvoy" }).click();
  await page.getByText("Beneficios de Marriott Bonvoy").waitFor();
  await sleep(700);
  await shot(page, "05-detalle-marriott-beneficios-verificados", vp);
  await page.keyboard.press("Escape"); await sleep(500);

  // Programa sin beneficios curados: no se inventan.
  await page.getByRole("button", { name: /Abrir Volaris/ }).click();
  await page.getByTestId("no-benefits").waitFor();
  await sleep(600);
  await shot(page, "06-detalle-sin-beneficios-curados", vp);
  await page.keyboard.press("Escape"); await sleep(500);

  // Pasaporte: número oculto, mostrar y foto protegida → revelada (enlace firmado simulado).
  await tab(page, "Documentos"); await sleep(400);
  await page.getByRole("button", { name: "Abrir Pasaporte mexicano" }).click();
  await page.getByRole("dialog").getByText("Fotos del documento").waitFor();
  await sleep(600);
  await shot(page, "07-pasaporte-detalle-oculto", vp);
  await page.getByRole("dialog").getByRole("button", { name: "Mostrar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Ver foto/ }).click();
  await page.getByRole("dialog").getByRole("img", { name: /Foto del documento/ }).waitFor();
  await page.getByRole("dialog").getByRole("img", { name: /Foto del documento/ }).scrollIntoViewIfNeeded();
  await sleep(600);
  await shot(page, "08-pasaporte-numero-y-foto-revelados", vp);
  await page.keyboard.press("Escape"); await sleep(500);

  // Agregar: selector de tipo y formulario de pasaporte con cámara.
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByText("Agregar a tu bóveda").waitFor(); await sleep(600);
  await shot(page, "09-agregar-tipo", vp);
  await page.getByRole("dialog").getByRole("button", { name: "Pasaporte" }).click(); await sleep(500);
  await shot(page, "10-agregar-pasaporte-camara", vp);
  await page.keyboard.press("Escape"); await sleep(400);

  await page.getByRole("button", { name: "Agregar", exact: true }).click(); await sleep(300);
  await page.getByRole("dialog").getByRole("tab", { name: "Membresías" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Hotel" }).click(); await sleep(300);
  await page.getByLabel("Programa").selectOption("hilton-honors");
  await page.getByLabel("Nivel", { exact: true }).selectOption("diamond"); await sleep(500);
  await shot(page, "11-agregar-hilton-diamond-beneficios", vp);
  await page.keyboard.press("Escape"); await sleep(400);

  // Iato, resúmeme (respuesta simulada).
  await page.getByRole("button", { name: /Iato, resúmeme/ }).click();
  await page.getByRole("button", { name: /Resumir/ }).click();
  await page.getByTestId("vault-summary").waitFor(); await sleep(600);
  await shot(page, "12-iato-resumeme", vp);
  const ai = server.calls.filter((c) => c.p === "/functions/v1/ai-tool");
  if (ai.length !== 1) throw new Error("ai-tool debía llamarse una vez");
  await context.close();

  // Bóveda vacía (cuenta nueva).
  server = { items: [], files: [], trips: [], calls: [] };
  ({ context, page } = await newPage(browser, vp));
  await openVault(page);
  await shot(page, "13-vacia", vp);
  await context.close();
  if (!mobile) return;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--headless=new"] });
try {
  for (const vp of VIEWPORTS) await run(browser, vp);
} finally {
  await browser.close();
}
console.log(results.join("\n"));
if (blocked.size) console.log("Bloqueado (sin red externa):", [...blocked].join(", "));
