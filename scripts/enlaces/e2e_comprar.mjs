#!/usr/bin/env node
// E2E "Comprar mi viaje" con datos SIMULADOS (cierre 2, grupo enlaces).
//
// Uso:  node scripts/enlaces/e2e_comprar.mjs <BASE_URL> <antes|despues> [outDir]
//
// Qué es simulado: TODO lo de Supabase (sesión, viaje, cotización, bookings, funciones) se responde
// aquí con route(): no se toca producción ni ninguna base. Los sitios externos (Google Flights,
// Booking…) tampoco se abren: la pestaña nueva se intercepta y solo se lee su URL de salida.
// Qué es real: la app compilada por Vite (el mismo código que se despliega) en Chromium, a 390 y 1440 px.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const req = createRequire(process.env.PW_FROM ?? "/tmp/claude-0/-home-user-reto/8647f9df-5459-5399-a533-ae256c643445/scratchpad/ux10/");
const { chromium } = req("playwright-core");
const [BASE, TAG = "despues", OUT = "docs/iatos/evidencia/enlaces"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const env = readFileSync(".env", "utf8");
const SUPA = /VITE_SUPABASE_URL="?([^"\n]+)/.exec(env)[1];
const REF = new URL(SUPA).hostname.split(".")[0];

const USER = { id: "00000000-0000-4000-8000-0000000000e2", email: "e2e@ejemplo.test", aud: "authenticated", role: "authenticated",
  app_metadata: { provider: "email" }, user_metadata: { nombre: "Prueba" }, created_at: "2026-10-01T00:00:00Z" };
const TRIP_ID = "e2e00000-0000-4000-8000-00000000c0de";
const TRIP = {
  id: TRIP_ID, user_id: USER.id, destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México", status: "listo",
  fecha_salida: "2026-12-12", fecha_regreso: "2026-12-19", num_viajeros: 2, created_at: "2026-10-22T10:00:00Z", updated_at: "2026-10-22T10:00:00Z",
  total_estimado: 160000, presupuesto_total: 160000, cover_image_url: null, selections: null, quote_needs_update: false, current_quote_id: null,
  vuelos_json: [
    { tier: "ahorro", aerolinea: "Iberia", duracion: "11h 05m", escalas: "Directo", precio_por_persona: 21000, fuente_precio: "travelpayouts",
      consultado_at: "2026-10-22T10:00:00Z", booking_link: "https://www.aviasales.com/search/MEX1212MAD19122?marker=533299" },
    { tier: "premium", aerolinea: "Aeroméxico", duracion: "10h 40m", escalas: "Directo", precio_por_persona: 30000, fuente_precio: "travelpayouts",
      consultado_at: "2026-10-22T10:00:00Z", booking_link: "https://www.aviasales.com/search/MEX1212MAD19122?marker=533299" },
  ],
  hospedaje_json: [{ nombre: "Hotel Urban", tipo: "Hotel", tier: "equilibrio", barrio: "Barrio de las Letras", rating: 4.5, precio_por_noche: 4000,
    fuente_precio: "serpapi", consultado_at: "2026-10-22T10:00:00Z", por_que: "Céntrico." }],
  tours_json: [{ nombre: "Museo del Prado", duracion: "3 h", precio_por_persona: 400, fuente: "estimado", estado_dato: "ESTIMADO", por_que: "Imprescindible." }],
  restaurantes_json: [{ nombre: "Sobrino de Botín", cocina: "Castellana", rango_precio: "$$$", por_que: "El más antiguo." }],
  itinerario_json: [{ dia: 1, titulo: "Llegada", "mañana": "Vuelo", tarde: "Centro", noche: "Cena" }],
  desglose_presupuesto: { vuelos: 60000, hospedaje: 28000, actividades: 800 }, tips_personalizados: [],
};

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" };
const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { ...CORS, ...headers }, body: JSON.stringify(body) });

async function mock(ctx, log, store) {
  await ctx.route("**/*", async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    const m = r.method();
    if (u.origin === SUPA) {
      if (m === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "" });
      if (u.pathname.startsWith("/auth/v1/user")) return json(route, 200, USER);
      if (u.pathname.startsWith("/auth/v1/")) return json(route, 200, {});
      if (u.pathname.startsWith("/functions/v1/")) { log.push(`fn ${u.pathname.slice(14)}`); return json(route, 503, { ok: false, code: "SERVICE_UNAVAILABLE" }); }
      if (u.pathname.startsWith("/storage/")) return route.fulfill({ status: 404, headers: CORS, body: "" });
      const table = u.pathname.replace("/rest/v1/", "");
      const one = /vnd\.pgrst\.object/.test(r.headers()["accept"] ?? "");
      if (table === "trips" && m === "GET") return json(route, 200, one ? TRIP : [TRIP]);
      if (table === "bookings" && m === "GET") return json(route, 200, store.bookings);
      if (table === "bookings" && m === "POST") {
        const row = { id: `b-${store.bookings.length + 1}`, created_at: new Date().toISOString(), ...JSON.parse(r.postData() ?? "{}") };
        store.bookings.push(row); log.push(`POST bookings ${JSON.stringify(row.raw_payload ?? {})}`);
        return json(route, 201, one ? row : [row]);
      }
      if (table === "bookings" && m === "DELETE") { store.bookings = []; log.push("DELETE bookings"); return route.fulfill({ status: 204, headers: CORS, body: "" }); }
      if (table === "user_onboarding_state" && m === "GET") {
        const st = { user_id: USER.id, completed_onboarding: true, current_step: 5, completed_at: "2026-10-01T00:00:00Z", tooltips_shown: [] };
        return json(route, 200, one ? st : [st]);
      }
      if (table === "profiles" && m === "GET") return json(route, 200, one ? { id: USER.id, nombre: "Prueba", onboarding_completed: true, ciudad_origen: "Ciudad de México" } : [{ id: USER.id, nombre: "Prueba", onboarding_completed: true }]);
      if (table.startsWith("rpc/")) return json(route, 200, null);
      if (m !== "GET") { log.push(`${m} ${table}`); return json(route, 200, one ? {} : []); }
      return one ? json(route, 406, { code: "PGRST116", message: "0 rows" }) : json(route, 200, []);
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    // Sitios externos: no se abren (solo se registra la URL de salida).
    if (/google\.com|booking\.com|kayak|getyourguide|opentable|aviasales/.test(u.hostname) && r.resourceType() === "document") {
      log.push(`salida ${r.url()}`);
      return route.fulfill({ status: 200, contentType: "text/html", body: "<title>salida simulada</title><p>Destino externo (simulado)</p>" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
}

const results = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--headless=new"] });
for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  const log = [];
  const store = { bookings: [] };
  const mobile = vp.w < 768;
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: mobile, hasTouch: mobile, locale: "es-MX", timezoneId: "America/Mexico_City",
    reducedMotion: "reduce", serviceWorkers: "block" });
  const session = { access_token: "e2e.simulado.token", token_type: "bearer", expires_in: 3600 * 24, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
    refresh_token: "e2e-refresh", user: USER };
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); localStorage.setItem("iatos_cookie_consent_v2", "essential"); localStorage.setItem("iatos_cookie_notice_v1", "1"); } catch {} },
    [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await mock(ctx, log, store);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await p.goto(`${BASE}/dashboard/viajes/${TRIP_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.getByRole("heading", { name: "Madrid" }).first().waitFor({ timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const row = { viewport: vp.w, tag: TAG, steps: [] };
  const comprar = p.getByTestId("trip-comprar");
  const has = await comprar.count();
  row.steps.push({ paso: "ver 'Comprar mi viaje'", ok: has > 0 });
  if (!has) {
    await p.screenshot({ path: join(OUT, `E2E-${TAG}-${vp.w}-viaje.jpg`), type: "jpeg", quality: 55, fullPage: false });
    // Antes de "Comprar mi viaje": los botones de compra estaban dentro de cada tarjeta del destino.
    await p.getByText("Vuelos sugeridos").first().scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(800);
    await p.screenshot({ path: join(OUT, `E2E-${TAG}-${vp.w}-viaje-abajo.jpg`), type: "jpeg", quality: 55 });
  } else {
    await comprar.scrollIntoViewIfNeeded();
    await p.waitForTimeout(600);
    await comprar.screenshot({ path: join(OUT, `E2E-${TAG}-${vp.w}-comprar.jpg`), type: "jpeg", quality: 60 });
    // Tocar el vuelo: la URL de salida (lo que abre la pestaña nueva) debe llevar ruta, fechas y viajeros.
    const a = p.getByTestId("comprar-vuelo-abrir");
    const href = await a.getAttribute("href");
    const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null), a.click()]);
    if (popup) await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const salida = popup?.url() ?? null;
    row.steps.push({ paso: "tocar vuelo → URL de salida", href, salida, lleva: await p.getByTestId("comprar-vuelo-lleva").innerText() });
    if (popup) await popup.close();
    // "Ya lo reservé"
    await p.getByTestId("comprar-vuelo-marcar").click();
    await p.waitForFunction(() => document.querySelector('[data-testid="comprar-vuelo"]')?.getAttribute("data-state") === "marcado", null, { timeout: 10000 }).catch(() => {});
    row.steps.push({ paso: "marcar 'Ya lo reservé'", estado: await p.getByTestId("comprar-vuelo").getAttribute("data-state"),
      progreso: await p.getByTestId("trip-comprar-progreso").innerText(), guardado: store.bookings.map((x) => ({ status: x.status, category: x.category, raw_payload: x.raw_payload })) });
    await comprar.screenshot({ path: join(OUT, `E2E-${TAG}-${vp.w}-comprar-marcado.jpg`), type: "jpeg", quality: 60 });
    // Desbordes horizontales a este ancho.
    row.overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  }
  row.errors = errors;
  row.log = log;
  results.push(row);
  console.log(JSON.stringify(row, null, 1));
  await ctx.close();
}
await b.close();
writeFileSync(join(OUT, `e2e_comprar_${TAG}.json`), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE,
  nota: "Supabase y sitios externos simulados con route(); app real compilada por Vite en Chromium.", results }, null, 1));
