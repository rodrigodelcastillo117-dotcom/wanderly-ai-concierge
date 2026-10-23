// Evidencia visual de Social · perfil del amigo (avatar, viajes, actividad) y "Qué ven mis amigos".
// SOLO PRUEBAS: nada aquí llama a producción. Vite corre con VITE_SUPABASE_URL apuntando a un host
// simulado y este script responde TODAS las llamadas con datos ficticios; cualquier otra petición externa
// se bloquea. Avatar y fotos son SVG generados aquí con la leyenda "simulado".
//
// Uso:
//   VITE_SUPABASE_URL=https://supabase-mock.localhost VITE_SUPABASE_PUBLISHABLE_KEY=mock \
//     npx vite --host 127.0.0.1 --port 8094 --strictPort &
//   PLAYWRIGHT_DIR=/opt/node-tools/node_modules CHROMIUM=/opt/pw-browsers/chromium \
//     node scripts/social/ui_evidence.mjs http://127.0.0.1:8094 /ruta/salida
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? `${process.env.PLAYWRIGHT_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8094";
const OUT = process.argv[3] || "/tmp/social-evidence";
const MOCK_HOST = "supabase-mock.localhost";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

const ME = "00000000-0000-4000-8000-0000000000a1";
const CARLO = "00000000-0000-4000-8000-0000000000c2";
const ANA = "00000000-0000-4000-8000-0000000000d3";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: ME, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: ME, aud: "authenticated", role: "authenticated", email: "rodrigo.prueba@example.com", user_metadata: { full_name: "Rodrigo Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };

const day = (n) => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); };
const M1 = `${CARLO}/00000000-0000-4000-8000-00000000e001.jpg`;

const PERFIL = {
  ok: true,
  amigo: { id: CARLO, full_name: "Carlo Ceniceros", username: null, avatar_url: null, ciudad_origen: null, pais_origen: "México", is_prive: true },
  yo_prive: false, amigos_desde: "2026-05-04T12:00:00Z",
  dna: { estilo: "Trotamundos Intensivo", ritmo: "explorador", comida: ["foodie"], tardes: ["museos"], hospedaje: ["boutique"] },
  en_comun: { comida: ["foodie"], tardes: [], hospedaje: ["boutique"], mismo_ritmo: false, mismo_presupuesto: false, destinos: [], suenos: [], yo_tengo_dna: true, amigo_tiene_dna: true, afinidad: 62 },
  viajes_juntos: [{ id: "00000000-0000-4000-8000-00000000f001", destino: "Madrid", pais_destino: "España", fecha_salida: "2025-09-01", fecha_regreso: "2025-09-06", cover_image_url: null, status: "listo" }],
  viajes_juntos_total: 1, lugares: [{ ciudad: "Roma", pais: "Italia" }, { ciudad: "Madrid", pais: "España" }, { ciudad: "Oaxaca", pais: "México" }],
  saludos: { puedo: false, proximo: new Date(Date.now() + 23 * 3600000).toISOString(), ultimo_enviado: new Date().toISOString(), ultimo_recibido: null, gesto_recibido: null, por_devolver: false, total: 1 },
};
const VIAJES = {
  ok: true, comparte: { pasados: true, proximos: true, fechas_completas: false },
  viajes: [
    { id: null, clave: "a1", destino: "Lisboa", paises: ["Portugal"], portada: null, fase: "proximo", juntos: false, mes_salida: "2026-12", mes_regreso: "2026-12" },
    { id: null, clave: "a2", destino: "Roma", paises: ["Italia"], portada: null, fase: "pasado", juntos: false, mes_salida: "2026-03", mes_regreso: "2026-03" },
    { id: "00000000-0000-4000-8000-00000000f001", clave: "f1", destino: "Madrid", paises: ["España"], portada: null, fase: "pasado", juntos: true, mes_salida: "2025-09", mes_regreso: "2025-09", fecha_salida: "2025-09-01", fecha_regreso: "2025-09-06" },
    { id: null, clave: "a3", destino: "Oaxaca", paises: ["México"], portada: null, fase: "pasado", juntos: false, mes_salida: "2025-11", mes_regreso: "2025-11" },
  ],
};
const ITEMS = [
  { clave: "reserva:00000000-0000-4000-8000-00000000b001", tipo: "reserva", fecha: day(3), categoria: "restaurant", titulo: "Suntory (Polanco)", ciudad: "Ciudad de México", pais: "México", mi_reaccion: null, mis_preguntas: [] },
  { clave: "reco:00000000-0000-4000-8000-00000000b002", tipo: "recomendacion", fecha: day(6), categoria: "restaurant", titulo: "Cocina Las Ranitas", ciudad: "Oaxaca", estrellas: 5, nota: "Pide el mole negro y el tasajo", mi_reaccion: "corazon",
    mis_preguntas: [{ id: "q1", pregunta: "¿Hay que reservar?", respuesta: "Sí, un día antes por WhatsApp", fecha: day(5) }] },
  { clave: "fav:00000000-0000-4000-8000-00000000b003", tipo: "favorito", fecha: day(9), categoria: "hotel", titulo: "Hotel Eden, Roma", ciudad: "Roma", mis_preguntas: [] },
  { clave: "visita:00000000-0000-4000-8000-00000000b004", tipo: "visitado", fecha: day(12), categoria: "lugar", titulo: "Museo del Louvre", ciudad: "París", mis_preguntas: [] },
  { clave: "momento:00000000-0000-4000-8000-00000000e001", tipo: "momento", fecha: day(14), titulo: "Atardecer en el Trastevere", ciudad: "Roma", nota: "La mejor luz del viaje", foto_path: M1, mis_preguntas: [] },
];
const FEED = [
  { ...ITEMS[0], amigo: { id: CARLO, nombre: "Carlo" } },
  { clave: "reco:00000000-0000-4000-8000-00000000b009", tipo: "recomendacion", fecha: day(4), categoria: "restaurant", titulo: "Café de Tacuba", ciudad: "Ciudad de México", estrellas: 4, nota: "Las enchiladas", mis_preguntas: [], amigo: { id: ANA, nombre: "Ana" } },
  { ...ITEMS[1], amigo: { id: CARLO, nombre: "Carlo" } },
];
let OWN_SETTINGS = { avatar: true, viajes_pasados: true, viajes_proximos: false, fechas_completas: false, reservas: false, recomendaciones: false, favoritos: false, visitados: false, momentos: false };
const OWN = () => ({
  ok: true, ajustes: OWN_SETTINGS,
  items: [
    { clave: "reco:00000000-0000-4000-8000-00000000c001", tipo: "recomendacion", fecha: day(2), categoria: "restaurant", titulo: "Pujol", ciudad: "Ciudad de México", estrellas: 5, oculto: false, tipo_compartido: OWN_SETTINGS.recomendaciones, visible_desde: null,
      reacciones: { corazon: 2, fuego: 1, antojo: 3 }, preguntas: [{ id: "q7", de: "Carlo", pregunta: "¿Qué menú pediste?", respuesta: null, fecha: day(1) }] },
    { clave: "reserva:00000000-0000-4000-8000-00000000c002", tipo: "reserva", fecha: day(0), categoria: "hotel", titulo: "Casa Polanco", ciudad: "Ciudad de México", oculto: false, tipo_compartido: OWN_SETTINGS.reservas,
      visible_desde: new Date(Date.now() + 20 * 3600000).toISOString(), reacciones: { corazon: 0, fuego: 0, antojo: 0 }, preguntas: [] },
    { clave: "visita:00000000-0000-4000-8000-00000000c003", tipo: "visitado", fecha: day(20), categoria: "lugar", titulo: "Museo Soumaya", oculto: true, tipo_compartido: OWN_SETTINGS.visitados, visible_desde: null, reacciones: { corazon: 0, fuego: 0, antojo: 0 }, preguntas: [] },
  ],
  viajes: [
    { id: "00000000-0000-4000-8000-00000000f002", clave: "x1", destino: "Kioto", paises: ["Japón"], fase: "pasado", juntos: false, oculto: false, mes_salida: "2026-04", mes_regreso: "2026-04", fecha_salida: "2026-04-02", fecha_regreso: "2026-04-15" },
    { id: "00000000-0000-4000-8000-00000000f003", clave: "x2", destino: "Tokio", paises: ["Japón"], fase: "proximo", juntos: false, oculto: false, mes_salida: "2026-12", mes_regreso: "2026-12", fecha_salida: "2026-12-20", fecha_regreso: "2026-12-30" },
  ],
  momentos: [
    { id: "00000000-0000-4000-8000-00000000e101", foto_path: `${ME}/00000000-0000-4000-8000-00000000e101.jpg`, titulo: "Kioto", compartido: true },
    { id: "00000000-0000-4000-8000-00000000e102", foto_path: `${ME}/00000000-0000-4000-8000-00000000e102.jpg`, titulo: "Tokio", compartido: false },
  ],
});

const PALETTES = [["#f6c27a", "#e0794f", "#3b2a4a"], ["#9ad1e6", "#3f7fa6", "#1d2b3a"], ["#ffcf8a", "#d98b3a", "#2c3e50"]];
const photoSvg = (seed) => { const [a, b, c] = PALETTES[seed % PALETTES.length]; return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="900" height="700" fill="url(#s)"/><circle cx="560" cy="300" r="110" fill="#fff6dd" opacity="0.85"/><path d="M0 520 L200 380 L380 480 L600 340 L900 480 L900 700 L0 700 Z" fill="${c}" opacity="0.85"/><text x="450" y="670" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff" opacity="0.7">foto simulada</text></svg>`; };
const avatarSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#2b2416"/><circle cx="300" cy="230" r="120" fill="#d8b48a"/><path d="M60 800 Q300 360 540 800 Z" fill="#1f3b5a"/><text x="300" y="770" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#fff" opacity="0.7">avatar simulado</text></svg>`;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" }, body: JSON.stringify(body) });

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (p.startsWith("/functions/v1/")) return json(route, {});
  if (p.startsWith("/storage/v1/object/sign/") && req.method() === "POST") {
    const bucket = p.replace("/storage/v1/object/sign/", "");
    const body = JSON.parse(req.postData() || "{}");
    return json(route, (body.paths || []).map((path) => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=mock`, error: null })));
  }
  if (p.includes("/avatars/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: avatarSvg() });
  if (p.startsWith("/storage/v1/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: photoSvg(p.length) });
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  const rpc = p.startsWith("/rest/v1/rpc/") ? p.slice("/rest/v1/rpc/".length) : null;
  if (rpc) {
    const body = JSON.parse(req.postData() || "{}");
    switch (rpc) {
      case "amigo_perfil": return json(route, PERFIL);
      case "amigo_viajes": return json(route, VIAJES);
      case "amigo_actividad": return json(route, { ok: true, comparte: { reservas: true, recomendaciones: true, favoritos: true, visitados: true, momentos: true }, items: ITEMS });
      case "amigos_actividad": return json(route, FEED);
      case "amigos_avatares": return json(route, (body.p_ids || [CARLO, ANA]).map((id) => ({ id, bucket: "travel-moments", path: `avatars/${id}/v3.png` })));
      case "friend_profiles": return json(route, [{ id: CARLO, full_name: "Carlo Ceniceros", username: null, avatar_url: null }, { id: ANA, full_name: "Ana Prueba", username: null, avatar_url: null }]);
      case "amigos_resumen": return json(route, [{ amigo_id: CARLO, is_prive: true, viajes_juntos: 1, afinidad: 62, en_comun: {}, saludo_por_devolver: false }]);
      case "solicitudes_amistad": return json(route, { recibidas: [], enviadas: [], bloqueados: [] });
      case "mi_actividad_social": return json(route, OWN());
      case "guardar_privacidad_social": OWN_SETTINGS = { ...OWN_SETTINGS, ...(body.p_ajustes || {}) }; return json(route, { ok: true, ajustes: OWN_SETTINGS });
      case "reaccionar_actividad": return json(route, { ok: true, mi_reaccion: body.p_emoji });
      default: return json(route, null);
    }
  }
  if (p.startsWith("/rest/v1/user_onboarding_state")) {
    const row = { user_id: ME, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null, tooltips_shown: ["social", "perfil", "profile", "dna", "avatar"] };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/profiles")) {
    const row = { id: ME, full_name: "Rodrigo Prueba", ciudad_origen: "Ciudad de México", avatar_url: null, invite_code: "A3K9PQ7M", active_trip_id: null, tier: "free" };
    return json(route, single ? row : [row]);
  }
  if (p.startsWith("/rest/v1/badges")) return json(route, []);
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
    try {
      localStorage.setItem(key, JSON.stringify(sess)); localStorage.setItem("iatos_cookie_consent_v2", "essential");
      for (const k of ["social", "perfil", "profile"]) localStorage.setItem(`iatos_tooltip_${k}`, "1");
    } catch { /* noop */ }
  }, ["sb-supabase-mock-auth-token", AUTH_SESSION]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  return { context, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function scrollTo(locator, offset = 80) {
  await locator.evaluate((el, off) => {
    document.documentElement.style.scrollBehavior = "auto";
    el.scrollIntoView({ block: "start", behavior: "instant" });
    window.scrollBy({ top: -off, behavior: "instant" });
  }, offset);
  await sleep(500);
}
const results = [];
const checks = [];
async function shot(page, name, vp, fullPage = false) {
  const file = join(OUT, `${name}__${vp.name}.png`);
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((im) => im.complete), null, { timeout: 8000 }).catch(() => {});
  await sleep(400);
  await page.screenshot({ path: file, fullPage });
  results.push(file);
  checks.push({ name: `${name}__${vp.name}`, hscroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1) });
}

async function run(browser, vp) {
  // 1. Perfil del amigo: encabezado con su avatar firmado.
  let { context, page } = await newPage(browser, vp);
  await page.goto(`${BASE}/dashboard/social/amigo/${CARLO}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByTestId("friend-avatar").waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !!document.querySelector("[data-testid='friend-avatar'] img"), null, { timeout: 10000 }).catch(() => console.log("sin <img> de avatar", vp.name));
  await shot(page, "01-perfil-amigo-avatar", vp);
  await scrollTo(page.getByRole("heading", { name: "Viajes de Carlo" }));
  await shot(page, "02-viajes-de-carlo", vp);
  await scrollTo(page.getByRole("heading", { name: "Lo que recomienda Carlo" }));
  await shot(page, "03-actividad-de-carlo", vp);
  // Preguntarle abierto en la primera tarjeta.
  const card = page.getByTestId("activity-card").first();
  await card.getByRole("button", { name: /Preguntarle/ }).click();
  await scrollTo(card);
  await shot(page, "04-preguntarle", vp);
  await card.getByRole("button", { name: /A mi viaje/ }).click();
  await page.getByRole("dialog").waitFor();
  await shot(page, "05-agregar-a-mi-viaje", vp);
  await page.keyboard.press("Escape");
  await shot(page, "06-perfil-amigo-completo", vp, true);
  await context.close();

  // 2. Social: lista con avatares y "Lo que hacen tus amigos".
  ({ context, page } = await newPage(browser, vp));
  await page.goto(`${BASE}/dashboard/social`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByTestId("friends-feed").waitFor({ timeout: 120000 });
  await shot(page, "07-social-lista-avatares", vp);
  await scrollTo(page.getByRole("heading", { name: "Lo que hacen tus amigos" }));
  await shot(page, "08-social-feed-amigos", vp);
  await context.close();

  // 3. Perfil propio: "Qué ven mis amigos" (por defecto, con el aviso amable) y tras prender recomendaciones.
  OWN_SETTINGS = { avatar: true, viajes_pasados: true, viajes_proximos: false, fechas_completas: false, reservas: false, recomendaciones: false, favoritos: false, visitados: false, momentos: false };
  ({ context, page } = await newPage(browser, vp));
  await page.goto(`${BASE}/dashboard/perfil#que-ven-mis-amigos`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByTestId("friends-privacy").waitFor({ timeout: 120000 });
  await page.getByTestId("friends-privacy").scrollIntoViewIfNeeded();
  await sleep(600);
  await scrollTo(page.getByTestId("friends-privacy"), 70);
  await shot(page, "09-que-ven-mis-amigos-por-defecto", vp);
  await page.getByRole("switch", { name: "Recomendaciones" }).click();
  await sleep(600);
  await scrollTo(page.getByTestId("own-activity"), 120);
  await shot(page, "10-mi-actividad-reacciones-preguntas", vp);
  const sec = page.getByTestId("friends-privacy");
  const box = await sec.boundingBox();
  const file = join(OUT, `11-que-ven-mis-amigos-seccion__${vp.name}.png`);
  await sec.screenshot({ path: file }); results.push(file);
  void box;
  await context.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
for (const vp of VIEWPORTS) await run(browser, vp);
await browser.close();
writeFileSync(join(OUT, "checks.json"), JSON.stringify({ results, checks, blocked: [...blocked] }, null, 2));
console.log(JSON.stringify({ n: results.length, hscroll: checks.filter((c) => c.hscroll).map((c) => c.name), blocked: [...blocked] }, null, 2));
