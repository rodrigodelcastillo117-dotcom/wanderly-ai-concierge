#!/usr/bin/env node
// SMOKE DIARIO EN PRODUCCIÓN (candado de calidad, 29-oct-2026).
//
// Entra con la cuenta demo y revisa lo que más duele si se rompe: que Mis viajes cargue con sus fotos, que la
// ruta muestre el globo 3D ("el mundito"), que un viaje abra con su foto y su total, y que Iato abra con su
// cuadro de mensaje y sus atajos. Reporta OK / FALLA por paso, con captura de cada pantalla.
//
// NO manda mensajes a Iato, NO genera ni cotiza viajes y NO gasta búsquedas: el navegador bloquea toda
// función del servidor salvo las fotos ilustrativas gratuitas (pexels-image, buscar-video) y toda escritura
// a la base (POST/PATCH/DELETE a tablas). Las lecturas son las mismas que hace cualquier persona al abrir la app.
//
// Uso:
//   IATOS_SMOKE_EMAIL=… IATOS_SMOKE_PASSWORD=… npm run candado:smoke
//   opciones: --base https://traveliatos.life   --out ./smoke-out/AAAA-MM-DD   --escritorio (1440x900)
// La contraseña SOLO se lee de la variable de entorno; nunca va en el repo ni en el reporte.
// Salida: código 0 si todo OK, 1 si algo FALLA, 2 si no se pudo correr (falta Playwright o credenciales).
const fs = require("fs");
const path = require("path");

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const BASE = (arg("--base", process.env.IATOS_SMOKE_BASE || "https://traveliatos.life")).replace(/\/$/, "");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(arg("--out", path.join(process.cwd(), "smoke-out", STAMP)));
const EMAIL = process.env.IATOS_SMOKE_EMAIL || "";
const PASSWORD = process.env.IATOS_SMOKE_PASSWORD || "";
const DESKTOP = process.argv.includes("--escritorio");

/** Funciones del servidor que sí se dejan pasar: fotos ilustrativas (Pexels, gratis y con tope propio). */
const FUNCIONES_PERMITIDAS = new Set(["pexels-image", "buscar-video"]);

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(p); } catch { /* siguiente */ }
  }
  console.error("Falta Playwright: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Faltan IATOS_SMOKE_EMAIL y/o IATOS_SMOKE_PASSWORD (variables de entorno; nunca en el repo).");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext(DESKTOP
    ? { viewport: { width: 1440, height: 900 }, locale: "es-MX", timezoneId: "America/Mexico_City" }
    : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-MX", timezoneId: "America/Mexico_City",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 IATOS-smoke" });
  // Solo cookies esenciales (el smoke no cuenta como visita en la analítica) y sin el recorrido de primer uso.
  await ctx.addInitScript(() => { try { localStorage.setItem("iatos_cookie_consent_v2", "essential"); localStorage.setItem("iatos_trip_tour_v1", "done"); } catch { /* nada */ } });

  const bloqueadas = [];
  const erroresPagina = [];
  await ctx.route("**/*", (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const fn = u.pathname.match(/\/functions\/v1\/([^/?]+)/)?.[1];
    if (fn && !FUNCIONES_PERMITIDAS.has(fn)) { bloqueadas.push(`función ${fn}`); return route.abort(); }
    if (/\/rest\/v1\/(?!rpc\/)/.test(u.pathname) && !["GET", "HEAD", "OPTIONS"].includes(req.method())) { bloqueadas.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erroresPagina.push(e.message.slice(0, 200)));

  const pasos = [];
  const paso = async (nombre, fn) => {
    const t0 = Date.now();
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detalle: `error: ${String(e && e.message || e).split("\n")[0].slice(0, 200)}` }; }
    const archivo = `${String(pasos.length + 1).padStart(2, "0")}-${nombre.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    await page.screenshot({ path: path.join(OUT, archivo) }).catch(() => {});
    pasos.push({ paso: nombre, ok: !!r.ok, detalle: r.detalle, ms: Date.now() - t0, captura: archivo, ...(r.datos ? { datos: r.datos } : {}) });
    console.log(`${r.ok ? "OK   " : "FALLA"}  ${nombre} · ${r.detalle} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    return r;
  };

  // 1. Entrar
  await paso("entrar", async () => {
    await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
    await page.locator("input[type=email]").first().fill(EMAIL);
    const pw = page.locator("input[type=password]").first();
    await pw.fill(PASSWORD);
    await pw.press("Enter");
    await page.waitForURL((u) => !/\/auth(\?|$)/.test(u.pathname + u.search) && !u.pathname.startsWith("/auth"), { timeout: 30_000 });
    return { ok: true, detalle: `sesión iniciada (${new URL(page.url()).pathname})` };
  });

  // 2. Mis viajes: cuántas tarjetas y cuántas fotos cargadas
  let primerViaje = null;
  await paso("mis viajes y fotos", async () => {
    await page.goto(`${BASE}/dashboard/viajes`, { waitUntil: "domcontentloaded" });
    await page.locator('a[href^="/dashboard/viajes/"] [data-testid="smart-image"]').first().waitFor({ timeout: 30_000 });
    // Se baja por la lista para que cada tarjeta pida su foto, y se espera a que lleguen.
    for (let y = 0; y < 12; y++) { await page.mouse.wheel(0, 700); await sleep(500); }
    await page.evaluate(() => window.scrollTo(0, 0));
    let datos = null;
    for (let i = 0; i < 30; i++) {
      datos = await page.$$eval('a[href^="/dashboard/viajes/"]', (as) => {
        const cards = as.filter((a) => /^\/dashboard\/viajes\/[^/]+$/.test(a.getAttribute("href") || "") && a.querySelector('[data-testid="smart-image"]'));
        const filas = cards.map((a) => {
          const box = a.querySelector('[data-testid="smart-image"]');
          const img = box.querySelector("img");
          return { href: a.getAttribute("href"), tipo: box.getAttribute("data-kind"), cargada: !!img && img.complete && img.naturalWidth > 0 };
        });
        return { tarjetas: filas.length, conFoto: filas.filter((f) => f.cargada).length, pendientes: filas.filter((f) => f.tipo === "pending").length, sinFoto: filas.filter((f) => !f.cargada && f.tipo !== "pending").map((f) => f.href), primera: filas[0]?.href ?? null };
      });
      if (datos.tarjetas && !datos.pendientes && datos.conFoto === datos.tarjetas) break;
      await sleep(500);
    }
    primerViaje = datos.primera;
    const pct = datos.tarjetas ? datos.conFoto / datos.tarjetas : 0;
    // OK si hay viajes y al menos 90 % de las tarjetas tienen su foto (la cuenta demo tiene portada o foto en todas).
    return { ok: datos.tarjetas > 0 && pct >= 0.9, detalle: `${datos.conFoto} de ${datos.tarjetas} tarjetas con foto cargada${datos.sinFoto.length ? ` · sin foto: ${datos.sinFoto.slice(0, 5).join(", ")}` : ""}`, datos };
  });

  // 3. La ruta con el globo ("el mundito")
  await paso("ruta con el globo", async () => {
    const q = new URLSearchParams({ origin: "Ciudad de México", destinos: "Roma|Florencia|Venecia" });
    await page.goto(`${BASE}/dashboard/ruta?${q}`, { waitUntil: "domcontentloaded" });
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "attached", timeout: 40_000 });
    await canvas.scrollIntoViewIfNeeded();
    await sleep(2500);
    const box = await canvas.boundingBox();
    const ok = !!box && box.width > 100 && box.height > 100;
    return { ok, detalle: ok ? `globo 3D montado (${Math.round(box.width)}x${Math.round(box.height)})` : "no se ve el globo" };
  });

  // 4. Abrir un viaje
  await paso("abrir un viaje", async () => {
    if (!primerViaje) return { ok: false, detalle: "no hubo viaje que abrir" };
    await page.goto(`${BASE}${primerViaje}`, { waitUntil: "domcontentloaded" });
    await page.locator('[role="tablist"], [data-trip-panel]').first().waitFor({ timeout: 30_000 });
    await sleep(3000);
    const d = await page.evaluate(() => {
      const hero = document.querySelector('[data-testid="smart-image"]');
      const img = hero?.querySelector("img");
      const total = document.querySelector('[data-testid="trip-total-amount"]')?.textContent?.trim() ?? null;
      return { titulo: document.querySelector("h1")?.textContent?.trim() ?? null, foto: !!img && img.complete && img.naturalWidth > 0, video: !!document.querySelector("video"), total };
    });
    const ok = !!d.titulo && (d.foto || d.video);
    return { ok, detalle: `${d.titulo ?? "sin título"} · ${d.foto ? "foto cargada" : d.video ? "video" : "SIN FOTO"}${d.total ? ` · total ${d.total}` : ""}`, datos: d };
  });

  // 5. Iato (sin mandarle nada)
  await paso("abrir Iato", async () => {
    await page.goto(`${BASE}/dashboard/concierge`, { waitUntil: "domcontentloaded" });
    await page.locator("textarea").first().waitFor({ timeout: 30_000 });
    await sleep(2500);
    // Con conversación previa los atajos quedan detrás del botón «Atajos» (abrirlo no manda nada a Iato).
    let atajos = await page.locator('[aria-label="Atajos"] button').count();
    if (!atajos) {
      const toggle = page.locator('button[aria-expanded]', { hasText: "Atajos" }).first();
      if (await toggle.count()) { await toggle.click(); await sleep(800); }
      atajos = await page.locator('[aria-label="Atajos"] button').count();
    }
    const ok = atajos >= 3;
    return { ok, detalle: `cuadro de mensaje listo · ${atajos} atajos${ok ? "" : " (esperados ≥ 3)"}` };
  });

  await browser.close();
  const fallas = pasos.filter((p) => !p.ok).length;
  const reporte = { cuando: new Date().toISOString(), base: BASE, resultado: fallas ? "FALLA" : "OK", pasos, bloqueadas: Array.from(new Set(bloqueadas)), erroresPagina: erroresPagina.slice(0, 20) };
  fs.writeFileSync(path.join(OUT, "reporte.json"), JSON.stringify(reporte, null, 1));
  console.log(`\n${reporte.resultado} · smoke de producción · ${pasos.length - fallas}/${pasos.length} pasos OK · capturas y reporte en ${OUT}`);
  if (reporte.bloqueadas.length) console.log(`(bloqueado a propósito, para no gastar ni escribir: ${reporte.bloqueadas.slice(0, 12).join(", ")})`);
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
