// THE PRIVATE EDITION · evidencia E2E con Playwright. SOLO PRUEBAS: nada llama a producción ni inicia sesión
// con usuarios reales.
//
// · Un servidor HTTP local (127.0.0.1:54399) hace de Supabase simulado para la app Y para su Service Worker
//   (Chromium resuelve *.localhost a la máquina local): prive_status de un miembro activo, las RPC de la
//   edición con el Nº 01 (data/prive/edition/issue-01.json, como si el editor lo hubiera aprobado) y el panel.
// · Las fotos son las REALES con licencia Pexels (descargadas antes a una carpeta local) servidas en
//   images.pexels.com por page.route, con CORS como el CDN real.
// · La app se sirve con `vite preview` (build de producción) para que el Service Worker y el modo avión sean
//   los de verdad: context.setOffline(true).
//
// Uso:
//   VITE_SUPABASE_URL=http://supabase-mock.localhost:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock npx vite build
//   npx vite preview --port 8095 --strictPort &
//   node scripts/edition/e2e.mjs http://localhost:8095 docs/iatos/evidencia/edition <carpeta_fotos>
import http from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { payloadFromDoc } from "./payload.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const BASE = process.argv[2] || "http://localhost:8095";
const OUT = process.argv[3] || "docs/iatos/evidencia/edition";
const PHOTOS = process.argv[4] || "/tmp/edition-photos";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/edition-font-cache";
mkdirSync(OUT, { recursive: true });
mkdirSync(FONT_CACHE, { recursive: true });

const doc = JSON.parse(readFileSync("data/prive/edition/issue-01.json", "utf8"));
const PUB = payloadFromDoc(doc, { publishedAt: "2026-11-01T12:00:00Z", generatedAt: new Date().toISOString() });
const PREVIEW = payloadFromDoc(doc, { preview: true, approvedImages: ["img_cdmx_angel_noche", "img_merida_catedral", "img_monaco_puerto", "img_cabo_costa"] });

const USER_ID = "00000000-0000-4000-8000-0000000000e1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp, role: "authenticated", session_id: "sess-mock", aud: "authenticated" })}.mock`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "miembro.prueba@example.com", user_metadata: { full_name: "Valentina Prueba" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const AUTH_SESSION = { access_token: JWT, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER };
const PRIVE_SESSION = { token: "pv_mock_session_token_0123456789abcdef0123", expiresAt: new Date(Date.now() + 11 * 3600e3).toISOString(), userId: USER_ID };
const STATUS = { is_pro: true, tenure_days: 124, required_days: 90, eligible: true, basis: "tenure", membership_status: "active", has_password: true,
  password_status: "active", locked_until: null, activated_at: "2026-10-22T18:30:00Z", member_code: "IP-7KQM-X4TD", first_name: "Valentina",
  welcome_version_seen: 1, onboarding: { version: 1, step: 5, completed_at: "2026-10-22T18:40:00Z" }, invitation_pending: false, members_requires_prive: false };

const state = { prefs: { saved: true, edition_kind: "mi_mezcla", interests: { yates_y_embarcaciones: 3, gastronomia: 2, formula_1: 2 }, excluded: [], language: "es",
  reading_minutes: 30, section_order: [], show_name_on_cover: true, personalization_consent: true, first_name: "Valentina" }, saved: new Set(["merida-guadalajara-mesa-mexicana"]), calls: [] };

const briefs = () => PUB.articles.filter((a) => a.format === "brief");
function rpc(fn, body) {
  state.calls.push(fn);
  switch (fn) {
    case "prive_status": return STATUS;
    case "prive_edition_prefs": return state.prefs;
    case "prive_edition_prefs_save": state.prefs = { ...state.prefs, ...body._prefs, saved: true }; return state.prefs;
    case "prive_edition_issue": return { ...PUB, saved: [...state.saved] };
    case "prive_edition_article": {
      const a = PUB.articles.find((x) => x.slug === body._slug);
      return a ? { found: true, article: a, images: PUB.images, saved: state.saved.has(a.slug), generated_at: new Date().toISOString() } : { found: false };
    }
    case "prive_edition_world_brief": return { items: briefs(), expired_count: 0, today: "2026-11-01", generated_at: new Date().toISOString() };
    case "prive_edition_library": return { issues: [{ ...PUB.issue, article_count: PUB.articles.length }], images: { [PUB.issue.cover_image]: PUB.images[PUB.issue.cover_image] }, saved_count: state.saved.size, generated_at: new Date().toISOString() };
    case "prive_edition_saved": return { items: PUB.articles.filter((a) => state.saved.has(a.slug)).map((a) => ({ ...a, body: undefined, saved_at: "2026-11-02T10:00:00Z" })), images: {}, generated_at: new Date().toISOString() };
    case "prive_edition_save": if (body._saved) state.saved.add(body._slug); else state.saved.delete(body._slug); return { ok: true, saved: body._saved };
    case "prive_edition_log_download": return true;
    case "edition_admin_preview": return PREVIEW;
    case "edition_admin_overview": return {
      issues: [{ ...PREVIEW.issue, checks: { blocking: ["not_enough_content:0", "cover_article_not_approved"], warnings: ["articles_pending_review:16"] } }],
      articles: PREVIEW.articles.map((a) => ({ ...a, body: undefined, actions: undefined, sources: undefined, source_count: doc.articles.find((x) => x.slug === a.slug).sources.length,
        checks: { blocking: (a.image_keys ?? []).filter((k) => !["img_cdmx_angel_noche", "img_merida_catedral", "img_monaco_puerto", "img_cabo_costa"].includes(k)).map((k) => `image_not_licensed:${k}`),
          warnings: ["ai_draft_needs_human_read", ...(a.sources ?? []).slice(0, 1).map((s) => `unchecked_source:${s.key}`)] } })),
      sources: doc.sources.map((s) => ({ ...s, link_status: "unchecked", used_by: doc.articles.filter((a) => a.sources.some((x) => x.key === s.key)).map((a) => a.slug) })),
      images: doc.images.map((i) => ({ ...PREVIEW.images[i.key], license_status: PREVIEW.images[i.key].license_status, verification: i.verification })),
      reviews: [{ entity: "issue", key: PREVIEW.issue.slug, action: "seed", note: "Número sembrado en pending_review.", at: "2026-10-22T20:00:00Z", by_me: false }],
      downloads: { pdf_30d: 0, offline_30d: 0, avg_pdf_bytes: null, avg_pdf_ms: null }, generated_at: new Date().toISOString(),
    };
    case "prive_drops": return { __error: { status: 404, body: { code: "PGRST202", message: "Could not find the function public.prive_drops" } } };
    default: return null;
  }
}

const server = http.createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-expose-headers": "content-range" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let raw = "";
  for await (const ch of req) raw += ch;
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
  const u = new URL(req.url, "http://x");
  const send = (code, v) => { res.writeHead(code, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(v)); };
  if (u.pathname === "/auth/v1/user") return send(200, USER);
  if (u.pathname.startsWith("/auth/v1/logout")) return send(204, {});
  if (u.pathname.startsWith("/auth/v1/token")) return send(200, AUTH_SESSION);
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
  if (m) {
    const r = rpc(m[1], body);
    if (r && r.__error) return send(r.__error.status, r.__error.body);
    return send(200, r);
  }
  const single = (req.headers.accept || "").includes("vnd.pgrst.object");
  if (u.pathname === "/rest/v1/user_onboarding_state") {
    const row = { user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, tooltips_shown: [] };
    return send(200, single ? row : [row]);
  }
  if (u.pathname === "/rest/v1/admins") return send(200, single ? { user_id: USER_ID } : [{ user_id: USER_ID }]);
  if (u.pathname === "/rest/v1/profiles") { const p = { id: USER_ID, full_name: "Valentina Prueba", avatar_url: null, invite_code: "AB12CD34" }; return send(200, single ? p : [p]); }
  if (u.pathname === "/rest/v1/trips") {
    const t = [{ id: "11111111-2222-4333-8444-555555555555", user_id: USER_ID, destino: "Ciudad de México, México", pais_destino: "México", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-02", status: "planning" }];
    return send(200, single ? t[0] : t);
  }
  if (u.pathname.startsWith("/rest/v1/")) return send(200, single ? null : []);
  if (u.pathname.startsWith("/functions/v1/")) return send(200, {});
  return send(404, {});
});
await new Promise((r) => server.listen(54399, "127.0.0.1", r));

function fetchFont(url) {
  const key = join(FONT_CACHE, Buffer.from(url).toString("base64url").slice(0, 120));
  if (!existsSync(key)) {
    try { execFileSync("curl", ["-sSfL", "--max-time", "20", "-A", "Mozilla/5.0 Chrome/124", "-o", key, url]); } catch { return null; }
  }
  return { body: readFileSync(key), type: url.includes("fonts.googleapis.com") ? "text/css" : "font/woff2" };
}
const photoFile = (u) => { const id = /photos\/(\d+)\//.exec(u)?.[1]; return id ? join(PHOTOS, `p${id}.jpg`) : null; };

async function newContext(browser, vp, extra = {}) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: vp.mobile,
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "allow", ...extra });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const h = new URL(url).host;
    if (h === "images.pexels.com") {
      const f = photoFile(url);
      if (f && existsSync(f)) return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=31536000" }, body: readFileSync(f) });
      return route.fulfill({ status: 404, body: "" });
    }
    if (h === "fonts.googleapis.com" || h === "fonts.gstatic.com") {
      const f = fetchFont(url);
      return f ? route.fulfill({ status: 200, contentType: f.type, headers: { "access-control-allow-origin": "*" }, body: f.body }) : route.abort();
    }
    if (/^(localhost|127\.0\.0\.1|supabase-mock\.localhost)(:\d+)?$/.test(h)) return route.continue();
    return route.abort();   // nada sale a internet
  });
  await context.addInitScript(([sess, ps]) => {
    try {
      if (!localStorage.getItem("__edi_init")) {
        localStorage.setItem("sb-supabase-mock-auth-token", JSON.stringify(sess));
        localStorage.setItem("iatos.prive.session", JSON.stringify(ps));
        localStorage.setItem("iatos_cookie_consent_v2", "essential");
        localStorage.setItem("iatos_cookie_notice_v1", "1");
        localStorage.setItem("__edi_init", "1");
      }
    } catch { /* noop */ }
  }, [AUTH_SESSION, PRIVE_SESSION]);
  return context;
}

const VPS = [
  { name: "390", width: 390, height: 844, dsf: 2, mobile: true },
  { name: "1440", width: 1440, height: 900, dsf: 1, mobile: false },
];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "OK" : "FALLA"} ${name}${detail ? " · " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
async function shot(page, name, full = false) { const f = join(OUT, `${name}.jpg`); await page.screenshot({ path: f, fullPage: full, type: "jpeg", quality: 78 }); return f; }

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
try {
  for (const vp of VPS) {
    const ctx = await newContext(browser, vp);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // 1 · Portada
    await page.goto(`${BASE}/prive/edicion`, { waitUntil: "networkidle" });
    await page.getByTestId("edition-cover").waitFor({ timeout: 20000 });
    await sleep(800);
    await shot(page, `01-portada__${vp.name}`);
    check(`portada visible (${vp.name})`, await page.getByTestId("edition-cover").isVisible());
    check(`portada personal con nombre y nota honesta (${vp.name})`, await page.getByText("La edición de Valentina").isVisible() && await page.getByText(/No es una investigación individual/).count() > 0);
    check(`sin scroll horizontal en portada (${vp.name})`, await noHScroll(page));
    // 2 · Índice
    await page.locator("#indice").scrollIntoViewIfNeeded();
    await sleep(400);
    await shot(page, `02-indice__${vp.name}`);
    check(`índice con piezas (${vp.name})`, (await page.getByTestId("toc-item").count()) >= 8);
    // 3 · Artículo (doble página en escritorio / lectura móvil)
    await page.goto(`${BASE}/prive/edicion/articulo/monaco-yacht-show-2026`, { waitUntil: "networkidle" });
    await page.getByTestId("edition-article").waitFor();
    await sleep(800);
    await shot(page, `03-articulo-apertura__${vp.name}`);
    if (vp.name === "1440") {
      const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".ped-opener")).gridTemplateColumns.split(" ").length);
      check("doble página en escritorio (foto | título)", cols === 2, `columnas=${cols}`);
    }
    await page.evaluate(() => window.scrollTo(0, document.querySelector(".ped-pull")?.getBoundingClientRect().top + window.scrollY - 200));
    await sleep(500);
    await shot(page, `04-articulo-lectura__${vp.name}`);
    await page.getByTestId("sources").scrollIntoViewIfNeeded();
    await sleep(300);
    await shot(page, `05-articulo-fuentes-y-acciones__${vp.name}`);
    check(`fuentes y acciones del artículo (${vp.name})`, (await page.getByTestId("sources").locator("li").count()) === 3 && await page.getByTestId("actions").isVisible());
    check(`sin scroll horizontal en artículo (${vp.name})`, await noHScroll(page));
    // 4 · My Edition, World Brief, Opportunities, Library
    for (const [path, name] of [["mi-edicion", "06-my-edition"], ["briefing", "07-world-brief"], ["oportunidades", "08-opportunities"], ["biblioteca", "09-library"]]) {
      await page.goto(`${BASE}/prive/edicion/${path}`, { waitUntil: "networkidle" });
      await sleep(700);
      await shot(page, `${name}__${vp.name}`);
      check(`sin scroll horizontal en ${path} (${vp.name})`, await noHScroll(page));
    }
    await page.goto(`${BASE}/prive/edicion/briefing`, { waitUntil: "networkidle" });
    await page.getByTestId("brief-item").first().waitFor();
    check(`World Brief con breves fechados y con fuente (${vp.name})`, (await page.getByTestId("brief-item").count()) === 6 && (await page.locator("[data-testid=brief-item] time").count()) === 6);
    // 5 · Flight Edition
    await page.goto(`${BASE}/prive/edicion/vuelo`, { waitUntil: "networkidle" });
    await sleep(700);
    await page.getByTestId("flight-trip").selectOption({ index: 1 }).catch(() => {});
    await sleep(400);
    await shot(page, `10-flight-edition__${vp.name}`);
    check(`Flight Edition con el viaje a CDMX (${vp.name})`, (await page.getByTestId("flight-selection").locator("li").allTextContents()).some((t) => /La ciudad acelera/.test(t)));
    check(`sin errores de JavaScript (${vp.name})`, errors.length === 0, errors.slice(0, 2).join(" | "));
    // 6 · Panel editorial
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=revision&a=cdmx-fin-de-semana-gran-premio`, { waitUntil: "networkidle" });
    await page.getByTestId("article-editor").waitFor({ timeout: 20000 });
    await sleep(600);
    await shot(page, `11-panel-revision__${vp.name}`);
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=preview`, { waitUntil: "networkidle" });
    await page.getByTestId("preview-banner").waitFor();
    await sleep(800);
    await shot(page, `12-panel-vista-previa__${vp.name}`);
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=imagenes`, { waitUntil: "networkidle" });
    await sleep(800);
    await shot(page, `13-panel-licencias__${vp.name}`);
    check(`panel: licencias con su estado (${vp.name})`, (await page.getByTestId("admin-image").count()) === 12);
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=preview`, { waitUntil: "networkidle" });
    check(`panel: vista previa marcada como demostración (${vp.name})`, /MODO DEMOSTRACIÓN/.test(await page.getByTestId("preview-banner").textContent()));
    await ctx.close();
  }

  // ───────── Modo avión real (390, móvil) ─────────
  {
    const vp = VPS[0];
    const ctx = await newContext(browser, vp);
    const page = await ctx.newPage();
    const swErrors = [];
    page.on("pageerror", (e) => swErrors.push(e.message));
    await page.goto(`${BASE}/prive/edicion/vuelo`, { waitUntil: "networkidle" });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload({ waitUntil: "networkidle" }); }
    check("Service Worker activo y controlando la página", await page.evaluate(() => !!navigator.serviceWorker.controller));
    await page.getByTestId("flight-destination").selectOption("cdmx");
    await page.getByTestId("flight-offline").click();
    await page.getByText(/Lista para modo avión/).waitFor({ timeout: 60000 });
    const status = await page.getByTestId("flight-status").textContent();
    check("copia offline guardada (artículos + imágenes)", /Lista para modo avión/.test(status), status);
    const stored = await page.evaluate(async () => { const c = await caches.open("iatos-edition-v1"); return (await c.keys()).length; });
    check("Cache Storage contiene la edición", stored >= 3, `entradas=${stored}`);
    // ✈︎ sin red
    await ctx.setOffline(true);
    const pdfBtnDisabled = await page.getByTestId("flight-pdf").isDisabled();
    check("sin red no se descarga ni se reserva (botones deshabilitados)", pdfBtnDisabled);
    await page.goto(`${BASE}/prive/edicion/sin-conexion`, { waitUntil: "load" }).catch(() => {});
    await page.getByTestId("edition-offline").waitFor({ timeout: 20000 });
    await sleep(1200);
    await shot(page, "14-offline-portada__390");
    check("modo avión: la app abre la copia sin red", await page.getByText("Sin conexión · leyendo la copia guardada").isVisible());
    const tocCount = await page.getByTestId("toc-item").count();
    check("modo avión: índice de la copia", tocCount >= 3, `piezas=${tocCount}`);
    await page.getByTestId("toc-item").filter({ hasText: "La ciudad acelera" }).first().click();
    await page.getByTestId("edition-article").waitFor();
    await sleep(1000);
    await shot(page, "15-offline-articulo__390");
    // Recorre el artículo para que carguen las fotos diferidas (loading="lazy").
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await sleep(800);
    const imgs = await page.evaluate(() => [...document.querySelectorAll("[data-testid=edition-article] img")].map((i) => ({ src: (i.currentSrc || i.src).slice(0, 5), w: i.naturalWidth })));
    check("modo avión: las fotos se ven (blob: local, naturalWidth > 0)", imgs.length > 0 && imgs.every((i) => i.src === "blob:" && i.w > 0), JSON.stringify(imgs));
    const actionsDisabled = await page.getByTestId("actions").locator("button").evaluateAll((bs) => bs.every((b) => b.disabled));
    check("modo avión: From Page to Experience deshabilitado (no reservar sin red)", actionsDisabled);
    check("modo avión: fecha de generación visible", await page.getByText(/Copia generada el/).isVisible());
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(400);
    await shot(page, "16-offline-articulo-final__390");
    // Recarga completa sin red (shell desde el SW).
    await page.reload({ waitUntil: "load" }).catch(() => {});
    await page.getByTestId("edition-offline").waitFor({ timeout: 20000 });
    check("modo avión: recargar la app sin red sigue funcionando", await page.getByTestId("edition-offline").isVisible());
    // ↺ vuelve la red
    await ctx.setOffline(false);
    await sleep(1500);
    check("al volver la red: aviso de conexión", await page.getByText("Con conexión").isVisible());
    // ⎋ cerrar sesión borra las copias
    await page.goto(`${BASE}/dashboard/perfil`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Cerrar sesión/ }).first().click();
    await sleep(2000);
    const left = await page.evaluate(async () => (await caches.keys()).includes("iatos-edition-v1") ? (await (await caches.open("iatos-edition-v1")).keys()).length : 0);
    check("cerrar sesión borra las ediciones guardadas del dispositivo", left === 0, `entradas=${left}`);
    check("sin errores de JavaScript en el piloto offline", swErrors.length === 0, swErrors.slice(0, 2).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(OUT, "resultados.json"), JSON.stringify({ when: new Date().toISOString(), base: BASE, results, rpc_calls: state.calls.length }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
