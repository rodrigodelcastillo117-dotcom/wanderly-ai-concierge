// THE PRIVATE EDITION · E2E con RPC REALES (segunda tanda). SOLO PRUEBAS LOCALES: nada sale a internet.
//
// Qué es real y qué es simulado (se escribe tal cual en resultados.json):
//  REAL      · Postgres local con TODAS las migraciones del repo + la siembra del Nº 01 (pending_review) +
//              la corrección 20261025110000; todas las RPC (prive_status, prive_edition_*, prive_drops,
//              prive_insider, edition_admin_*) y las tablas (trips, profiles…) con RLS, vía pgrest-shim.mjs.
//              Sesión Privé real (prive_unlock) atada a una fila de auth.sessions, como supabase/tests/prive_key.
//              Build de producción de la app (vite build + vite preview), Service Worker real y
//              context.setOffline(true) de Chromium.
//  SIMULADO  · Auth (GoTrue): JWT sin firma que el shim decodifica (el usuario sí sale de auth.users).
//              Edge functions (/functions/v1/*): {}. CDN de Pexels: las 12 fotos reales descargadas antes,
//              servidas por page.route con CORS. Fuentes de Google: caché local.
//
// Uso: ver scripts/edition/README-e2e-real.txt (o el encabezado de EDITION.md).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createShim, makeJwt } from "./pgrest-shim.mjs";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const { chromium, devices } = pw;
const BASE = process.argv[2] || "http://127.0.0.1:8095";
const OUT = process.argv[3] || "docs/iatos/evidencia/edition2";
const PHOTOS = process.argv[4] || "/tmp/edition-photos";
const DL = process.argv[5] || "/tmp/edition-downloads";
const DB = process.env.E2E_DB || "edi_e2e";
const PGPATH = process.env.PGSOCKET || "/tmp/pgsec/.s.PGSQL.55440";
const FONT_CACHE = process.env.FONT_CACHE || "/tmp/edition-font-cache";
for (const d of [OUT, DL, FONT_CACHE]) mkdirSync(d, { recursive: true });

const shim = createShim({ path: PGPATH, database: DB });
await shim.listen(54399);
const sql = shim.sql;
const one = async (q) => (await sql.unsafe(q))[0];
const ids = {};
for (const n of [1, 2, 3, 90]) ids[n] = await one(`SELECT e2e.u(${n})::text AS u, e2e.sid(${n})::text AS s`);
const tok3 = await one("SELECT token, expires_at FROM e2e.tokens WHERE who = 3");

function authFor(n) {
  const { u, s } = ids[n];
  const j = makeJwt(u, s);
  return { access_token: j.token, refresh_token: `e2e-refresh:${u}:${s}`, token_type: "bearer", expires_in: 86400, expires_at: j.exp,
    user: { id: u, aud: "authenticated", role: "authenticated", email: `e2e${n}@example.test`, user_metadata: {}, app_metadata: {} } };
}
const priveSession = { token: tok3.token, expiresAt: new Date(tok3.expires_at).toISOString(), userId: ids[3].u, remember: true };

const results = [];
const check = (name, ok, detail = "", kind = "SQL real + Chromium") => {
  results.push({ name, ok: !!ok, detail, kind });
  console.log(`${ok ? "OK" : "FALLA"} [${kind}] ${name}${detail ? " · " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = async (page, name, full = false) => page.screenshot({ path: join(OUT, `${name}.jpg`), fullPage: full, type: "jpeg", quality: 76 });

function fetchFont(url) {
  const key = join(FONT_CACHE, Buffer.from(url).toString("base64url").slice(0, 120));
  if (!existsSync(key)) { try { execFileSync("curl", ["-sSfL", "--max-time", "20", "-A", "Mozilla/5.0 Chrome/124", "-o", key, url]); } catch { return null; } }
  return { body: readFileSync(key), type: url.includes("fonts.googleapis.com") ? "text/css" : "font/woff2" };
}
const photoFile = (u) => { const id = /photos\/(\d+)\//.exec(u)?.[1]; return id ? join(PHOTOS, `p${id}.jpg`) : null; };
const blocked = new Set();

async function newContext(browser, vp, who, extra = {}) {
  const opts = vp.device ? { ...devices[vp.device] } : { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: vp.mobile };
  const context = await browser.newContext({ ...opts, locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "allow", acceptDownloads: true, ...extra });
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
    blocked.add(h);
    return route.abort();   // nada sale a internet (ni a producción)
  });
  await context.addInitScript(([sess, ps]) => {
    try {
      if (!localStorage.getItem("__e2e_init")) {
        localStorage.setItem("sb-supabase-mock-auth-token", JSON.stringify(sess));
        if (ps) localStorage.setItem("iatos.prive.session", JSON.stringify(ps));
        localStorage.setItem("iatos_cookie_consent_v2", "essential");
        localStorage.setItem("iatos_cookie_notice_v1", "1");
        localStorage.setItem("__e2e_init", "1");
      }
    } catch { /* noop */ }
  }, [authFor(who), who === 3 ? priveSession : null]);
  return context;
}

const VPS = [
  { name: "390", width: 390, height: 844, dsf: 2, mobile: true },
  { name: "1440", width: 1440, height: 900, dsf: 1, mobile: false },
  { name: "android", device: "Pixel 7" },
];
const ARTICLE_TITLES = ["La ciudad acelera", "Port Hercule", "El sureste entra al mapa", "Una revista que se puede comprobar", "Ginebra ya marcó la hora"];
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const pdfReport = [];
try {
  // ───────── 0 · Antes de aprobar: estado honesto y nada protegido ─────────
  for (const vp of [VPS[0], VPS[1]]) {
    const ctx = await newContext(browser, vp, 3);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/prive`, { waitUntil: "networkidle" });
    const sec = page.getByTestId("private-edition-section");
    await sec.waitFor({ timeout: 30000 });
    await page.locator('[data-testid=private-edition-section][data-state=review]').waitFor({ timeout: 20000 });
    await sec.scrollIntoViewIfNeeded(); await sleep(600);
    await shot(page, `01-foryou-revista-en-revision__${vp.name}`);
    const text = await page.locator("body").innerText();
    check(`FOR YOU sin número aprobado: «primer número en revisión editorial» (${vp.name})`, /Primer número en revisión editorial/.test(text));
    check(`FOR YOU sin número aprobado: ningún título de pieza pendiente en la página (${vp.name})`, !ARTICLE_TITLES.some((t) => text.includes(t)) && !/Fórmula|Yacht Show/.test(await sec.innerText()));
    check(`acceso «Revista» visible en la cabecera Privé (${vp.name})`, await page.getByTestId("prive-edition-nav").filter({ visible: true }).count() >= 1);
    check(`sin scroll horizontal en FOR YOU (${vp.name})`, await noHScroll(page));
    await ctx.close();
  }
  for (const [who, label, code] of [[1, "FREE", "PRIVE_NOT_PRO"], [2, "PRO sin Privé", "PRIVE_NOT_ELIGIBLE"]]) {
    const ctx = await newContext(browser, VPS[1], who);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/prive`, { waitUntil: "networkidle" });
    await sleep(1500);
    await shot(page, `02-${who === 1 ? "free" : "pro-sin-prive"}-sin-revista__1440`);
    const text = await page.locator("body").innerText();
    check(`${label}: /prive no muestra la revista ni títulos`, (await page.getByTestId("private-edition-section").count()) === 0 && !ARTICLE_TITLES.some((t) => text.includes(t)));
    const api = await page.evaluate(async ([token]) => {
      const r = await fetch("http://supabase-mock.localhost:54399/rest/v1/rpc/prive_edition_status", { method: "POST", headers: { "content-type": "application/json", apikey: "mock", authorization: `Bearer ${token}` }, body: JSON.stringify({ _ps: "a".repeat(43) }) });
      return [r.status, await r.text()];
    }, [authFor(who).access_token]);
    check(`${label}: la RPC prive_edition_status por API directa responde ${code}`, api[0] === 400 && api[1].includes(code), api.join(" "));
    await ctx.close();
  }

  // ───────── 1 · El editor aprueba y publica desde /dashboard/admin/edicion (UI real, RPC reales) ─────────
  {
    const ctx = await newContext(browser, VPS[1], 90);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept(d.message().includes("Firma") ? "Dirección editorial (prueba local)" : "Prueba local"));
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=imagenes`, { waitUntil: "networkidle" });
    await page.getByTestId("edition-admin").waitFor({ timeout: 30000 });
    await sleep(800);
    await shot(page, "03-panel-licencias-pendientes__1440");
    // Una por una, como lo haría el editor (el botón desaparece cuando la licencia queda aprobada).
    for (let i = 0; i < 14; i++) {
      const btns = page.getByRole("button", { name: "Aprobar licencia" });
      const before = await btns.count();
      if (!before) break;
      await btns.first().click();
      await page.waitForFunction((n) => [...document.querySelectorAll("button")].filter((b) => b.textContent === "Aprobar licencia").length < n, before, { timeout: 15000 });
      await sleep(200);
    }
    const lic = await one("SELECT count(*) FILTER (WHERE license_status = 'approved')::int AS a, count(*)::int AS n FROM public.edition_images");
    check("panel: las 12 licencias aprobadas desde la UI quedan en la base", lic.a === 12, `${lic.a}/${lic.n}`);
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=revision`, { waitUntil: "networkidle" });
    const slugs = (await sql`SELECT slug FROM public.edition_articles ORDER BY sort_order`).map((r) => r.slug);
    for (const slug of slugs) {
      await page.goto(`${BASE}/dashboard/admin/edicion?vista=revision&a=${slug}`, { waitUntil: "networkidle" });
      await page.getByTestId("article-editor").waitFor({ timeout: 15000 });
      if (slug === "cdmx-fin-de-semana-gran-premio") { await sleep(400); await shot(page, "04-panel-revision-articulo__1440"); }
      await page.getByTestId("article-editor").getByRole("button", { name: "Aprobar", exact: true }).click();
      await page.getByRole("status").filter({ hasText: new RegExp(`approve ${slug}`) }).waitFor({ timeout: 15000 });
    }
    const art = await one("SELECT count(*) FILTER (WHERE status = 'approved')::int AS a FROM public.edition_articles");
    check("panel: las 16 piezas aprobadas desde la UI (reglas de la base cumplidas)", art.a === 16, `aprobadas=${art.a}`);
    await page.goto(`${BASE}/dashboard/admin/edicion?vista=numero`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Aprobar número" }).click();
    await page.getByRole("status").filter({ hasText: /aprobar número: hecho/ }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Publicar ahora" }).click();
    await page.getByRole("status").filter({ hasText: /publicar número: hecho/ }).waitFor({ timeout: 15000 });
    await sleep(600);
    await shot(page, "05-panel-numero-publicado__1440");
    const iss = await one("SELECT status, published_at IS NOT NULL AS p, approved_by_label FROM public.edition_issues WHERE slug = 'n01-noviembre-2026'");
    const pub = await one("SELECT count(*) FILTER (WHERE status = 'published')::int AS n FROM public.edition_articles");
    check("panel: número aprobado y publicado (16 piezas publicadas, firma registrada)", iss.status === "published" && iss.p && pub.n === 16, `${iss.status} · ${pub.n} · ${iss.approved_by_label}`);
    await ctx.close();
  }

  // ───────── 2 · Recorrido del miembro en 390, 1440 y Android (Pixel 7) ─────────
  for (const vp of VPS) {
    const ctx = await newContext(browser, vp, 3);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // a · FOR YOU → la revista
    await page.goto(`${BASE}/prive`, { waitUntil: "networkidle" });
    await page.locator('[data-testid=private-edition-section][data-state=live]').waitFor({ timeout: 30000 });
    const sec = page.getByTestId("private-edition-section");
    await sec.scrollIntoViewIfNeeded(); await sleep(900);
    await shot(page, `06-foryou-revista-publicada__${vp.name}`);
    const actions = await sec.getByTestId("edition-section-actions").locator("a").allTextContents();
    check(`FOR YOU: portada + Leer revista · Elegir intereses · Descargar para un vuelo · Biblioteca (${vp.name})`,
      (await sec.getByTestId("edition-cover-thumb").count()) === 1 && ["Leer revista", "Elegir intereses", "Descargar para un vuelo", "Biblioteca"].every((l) => actions.some((a) => a.includes(l))), actions.join(" | "));
    check(`FOR YOU: «Mi edición personalizada» con selección del número (${vp.name})`, (await sec.getByTestId("edition-section-picks").locator("li").count()) === 3);
    // b · Elegir intereses
    await sec.getByRole("link", { name: /Elegir intereses/ }).click();
    await page.waitForURL(/mi-edicion/);
    await page.getByText("Tus intereses").first().waitFor();
    // Intensidad "Mucho" en tres temas (no los botones de "Temas que no quieres ver", que excluyen).
    for (const label of ["Yates y embarcaciones", "Fórmula 1", "Gastronomía"]) {
      const b = page.getByRole("button", { name: `${label}: Mucho`, exact: true });
      if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
    }
    const consentBox = page.getByTestId("consent");
    if (!(await consentBox.isChecked())) await consentBox.check();
    await page.getByRole("button", { name: "Guardar mi edición" }).click();
    await page.getByText("Tu edición quedó guardada.").waitFor({ timeout: 15000 });
    await sleep(400);
    await shot(page, `07-elegir-intereses__${vp.name}`);
    const prefs = await one(`SELECT interests::text AS i, personalization_consent AS c FROM public.edition_member_prefs WHERE user_id = '${ids[3].u}'`);
    check(`intereses guardados en la base por la RPC real (${vp.name})`, !!prefs && prefs.c && /yates_y_embarcaciones/.test(prefs.i) && /formula_1/.test(prefs.i), prefs?.i);
    // c · Volver a FOR YOU: selección personalizada (la caché se invalida al guardar)
    await page.goto(`${BASE}/prive`, { waitUntil: "networkidle" });
    await page.locator('[data-testid=private-edition-section][data-state=live]').waitFor({ timeout: 20000 });
    check(`FOR YOU reconoce la personalización (${vp.name})`, /Selección y orden automáticos/.test(await page.getByTestId("private-edition-section").innerText()));
    // d · Leer revista → portada, índice, artículo
    await page.getByTestId("private-edition-section").getByRole("link", { name: /Leer revista/ }).first().click();
    await page.getByTestId("edition-cover").waitFor({ timeout: 20000 });
    await sleep(900);
    await shot(page, `08-revista-portada__${vp.name}`);
    await page.locator("#indice").scrollIntoViewIfNeeded(); await sleep(400);
    await shot(page, `09-revista-indice__${vp.name}`);
    check(`índice navegable con piezas publicadas (${vp.name})`, (await page.getByTestId("toc-item").count()) >= 8);
    await page.getByTestId("toc-item").filter({ hasText: "Port Hercule" }).first().click();
    await page.getByTestId("edition-article").waitFor();
    await sleep(900);
    await shot(page, `10-articulo__${vp.name}`);
    check(`artículo con fuentes y From Page to Experience (${vp.name})`, (await page.getByTestId("sources").locator("li").count()) >= 2 && await page.getByTestId("actions").isVisible());
    if (vp.name === "1440") {
      await page.getByTestId("reading-mode").click(); await sleep(500);
      await page.evaluate(() => window.scrollTo(0, (document.querySelector(".ped-pull")?.getBoundingClientRect().top ?? 900) + window.scrollY - 200)); await sleep(400);
      await shot(page, "11-articulo-modo-papel__1440");
      check("modo lectura «papel» activo", (await page.locator(".ped[data-reading=paper]").count()) === 1);
      await page.getByTestId("reading-mode").click();
    }
    check(`sin scroll horizontal en el artículo (${vp.name})`, await noHScroll(page));
    // e · Flight Edition desde FOR YOU
    await page.goto(`${BASE}/prive`, { waitUntil: "networkidle" });
    await page.locator('[data-testid=private-edition-section][data-state=live]').waitFor({ timeout: 20000 });
    await page.getByTestId("private-edition-section").getByRole("link", { name: /Descargar para un vuelo/ }).click();
    await page.getByTestId("flight-trip").waitFor();
    await page.getByTestId("flight-guide-status").filter({ hasText: /consejo/ }).waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(600);
    const tripSel = await page.getByTestId("flight-trip").evaluate((s) => s.options[s.selectedIndex]?.textContent ?? "");
    check(`Flight Edition: el próximo viaje viene elegido (${vp.name})`, /Ciudad de México/.test(tripSel) && /próximo viaje/.test(tripSel), tripSel);
    const guideTxt = (await page.getByTestId("flight-guide-status").textContent().catch(() => "")) ?? "";
    check(`Flight Edition: guía práctica del Insider con fuentes (RPC prive_insider real) (${vp.name})`, /\d+ consejos? prácticos con fuente/.test(guideTxt), guideTxt);
    const est = (await page.getByTestId("flight-estimate").textContent().catch(() => "")) ?? "";
    check(`Flight Edition: dice cuánto ocupará antes de guardar (${vp.name})`, /Ocupará aproximadamente/.test(est), est);
    const labels = [await page.getByTestId("flight-pdf").textContent(), await page.getByTestId("flight-offline").textContent()];
    check(`dos botones distintos: DESCARGAR REVISTA PDF / GUARDAR PARA LEER SIN INTERNET (${vp.name})`, /DESCARGAR REVISTA PDF/.test(labels[0]) && /GUARDAR PARA LEER SIN INTERNET/.test(labels[1]), labels.join(" | "));
    await page.getByTestId("flight-guide").scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, `12-flight-edition__${vp.name}`, vp.name === "1440");
    // f · PDF
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("flight-pdf").click()]);
    const pdfPath = join(DL, `${vp.name}-${download.suggestedFilename()}`);
    await download.saveAs(pdfPath);
    const info = execFileSync("pdfinfo", [pdfPath]).toString();
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
    const imgs = execFileSync("pdfimages", ["-list", pdfPath]).toString().trim().split("\n").slice(2).length;
    const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"]).toString();
    const okText = /THE PRIVATE EDITION/.test(text) && /Antes de llegar a/.test(text) && /La ciudad acelera/.test(text.replace(/\s+/g, " "));
    pdfReport.push({ vp: vp.name, file: pdfPath, pages, images: imgs, bytes: readFileSync(pdfPath).length, guide: /Antes de llegar a/.test(text) });
    check(`PDF descargado: ${pages} páginas, ${imgs} fotos, texto con portada, artículo y guía práctica (${vp.name})`, pages >= 8 && imgs >= 3 && okText, `${pages} p · ${imgs} img`, "SQL real + Chromium + pdfinfo/pdfimages/pdftotext");
    // g · Guardar para leer sin internet
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload({ waitUntil: "networkidle" }); await page.getByTestId("flight-trip").waitFor(); }
    await page.getByTestId("flight-offline").click();
    await page.getByText(/Lista para modo avión/).waitFor({ timeout: 90000 });
    const saved = await page.getByTestId("flight-saved").innerText();
    check(`copia sin internet guardada y dice cuánto ocupa (${vp.name})`, /Ocupa .* en este dispositivo/.test(saved), saved.split("\n")[0]);
    await shot(page, `13-flight-guardada__${vp.name}`);
    // h · ✈︎ modo avión: recargar y leer portada, índice, artículos, fotos y guía
    await ctx.setOffline(true);
    await page.goto(`${BASE}/prive/edicion/sin-conexion`, { waitUntil: "load" }).catch(() => {});
    await page.getByTestId("edition-offline").waitFor({ timeout: 20000 });
    await page.reload({ waitUntil: "load" }).catch(() => {});
    await page.getByTestId("edition-offline").waitFor({ timeout: 20000 });
    await sleep(1200);
    await shot(page, `14-sin-red-portada__${vp.name}`);
    check(`sin red: recargar abre la portada guardada (${vp.name})`, await page.getByText("Sin conexión · leyendo la copia guardada").isVisible() && (await page.getByTestId("edition-cover").count()) === 1);
    const coverImg = await page.evaluate(() => { const i = document.querySelector("[data-testid=edition-cover] img"); return i ? [i.src.slice(0, 5), i.naturalWidth] : null; });
    check(`sin red: la foto de portada sale de la copia local (${vp.name})`, coverImg && coverImg[0] === "blob:" && coverImg[1] > 0, JSON.stringify(coverImg));
    const toc = await page.getByTestId("toc-item").count();
    check(`sin red: índice de la copia (${vp.name})`, toc >= 3, `piezas=${toc}`);
    await page.getByTestId("offline-guide").scrollIntoViewIfNeeded().catch(() => {});
    check(`sin red: la guía práctica del destino viene en la copia (${vp.name})`, (await page.getByTestId("offline-guide").locator("li").count()) >= 1);
    await shot(page, `15-sin-red-indice-y-guia__${vp.name}`);
    await page.getByTestId("toc-item").filter({ hasText: "La ciudad acelera" }).first().click();
    await page.getByTestId("edition-article").waitFor();
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await sleep(800);
    await shot(page, `16-sin-red-articulo__${vp.name}`);
    const aimgs = await page.evaluate(() => [...document.querySelectorAll("[data-testid=edition-article] img")].map((i) => [(i.currentSrc || i.src).slice(0, 5), i.naturalWidth]));
    check(`sin red: artículo con sus fotos locales (${vp.name})`, aimgs.length > 0 && aimgs.every(([s, w]) => s === "blob:" && w > 0), JSON.stringify(aimgs));
    // Sin red, FOR YOU no queda en blanco.
    await page.goto(`${BASE}/prive`, { waitUntil: "load" }).catch(() => {});
    await sleep(2500);
    const prvTxt = (await page.locator("body").innerText().catch(() => "")).trim();
    await shot(page, `17-sin-red-prive__${vp.name}`);
    check(`sin red: /prive no queda en blanco y ofrece la copia guardada (${vp.name})`, prvTxt.length > 20 && (await page.getByTestId("prive-offline-editions").count()) === 1, prvTxt.slice(0, 120).replace(/\s+/g, " "));
    // i · vuelve la red
    await ctx.setOffline(false);
    await page.goto(`${BASE}/prive/edicion/sin-conexion`, { waitUntil: "networkidle" });
    await page.getByText("Con conexión").waitFor({ timeout: 15000 }).catch(() => {});
    check(`al volver la red: la copia sigue y avisa conexión (${vp.name})`, await page.getByText("Con conexión").isVisible());
    await page.goto(`${BASE}/prive`, { waitUntil: "networkidle" });
    check(`al volver la red: FOR YOU vuelve con la revista (${vp.name})`, await page.locator('[data-testid=private-edition-section][data-state=live]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
    check(`sin errores de JavaScript (${vp.name})`, errors.length === 0, errors.slice(0, 3).join(" | "));
    // j · cerrar sesión borra las copias (una vez)
    if (vp.name === "390") {
      await page.goto(`${BASE}/dashboard/perfil`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Cerrar sesión/ }).first().click();
      await sleep(2000);
      const left = await page.evaluate(async () => (await caches.keys()).includes("iatos-edition-v1") ? (await (await caches.open("iatos-edition-v1")).keys()).length : 0);
      check("cerrar sesión borra las ediciones guardadas del dispositivo", left === 0, `entradas=${left}`);
    }
    await ctx.close();
  }
  // INSIDER (CDMX) con el número publicado.
  {
    const ctx = await newContext(browser, VPS[1], 3);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/prive/insider/cdmx`, { waitUntil: "networkidle" });
    const s = page.locator('[data-testid=private-edition-section][data-variant=insider]');
    const ok = await s.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    if (ok) { await s.scrollIntoViewIfNeeded(); await sleep(600); }
    await shot(page, "18-insider-cdmx-revista__1440");
    check("INSIDER (CDMX): piezas del número sobre ese destino", ok && /La ciudad acelera/.test(await s.innerText()));
    await ctx.close();
  }
} finally {
  await browser.close();
  await shim.close();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, "resultados.json"), JSON.stringify({
  when: new Date().toISOString(), base: BASE, db: DB,
  real: "Postgres local con todas las migraciones + siembra Nº 01 + corrección 20261025110000; RPC y tablas con RLS vía pgrest-shim; sesión Privé real (prive_unlock) atada a auth.sessions; build de producción + Service Worker + setOffline de Chromium",
  simulado: "Auth/GoTrue (JWT sin firma), edge functions (/functions/v1 → {}), CDN de Pexels (fotos reales locales), Google Fonts (caché local)",
  results, pdf: pdfReport, rpc_calls: shim.stats.rpc, tables: shim.stats.tables, unsupported: shim.stats.unsupported,
  functions: [...new Set(shim.stats.functions)], server_errors: shim.stats.errors.slice(0, 40), blocked_hosts: [...blocked],
}, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
