#!/usr/bin/env node
// CANDADO VISUAL: compara las 15 pantallas más usadas (390x844, celular) contra sus capturas de referencia.
//
//   npm run candado:visual                 → compara; termina con error si alguna pantalla cambió más del umbral
//   npm run candado:visual -- --actualizar → toma capturas nuevas de referencia (SOLO con aprobación del dueño)
//   npm run candado:visual -- --solo inicio,viajes   → solo esas pantallas
//   npm run candado:visual -- --umbral 0.01          → fracción de píxeles distintos permitida (por omisión 0.01 = 1 %)
//   npm run candado:visual -- --base http://127.0.0.1:5173  → usa un servidor ya levantado (con VITE_SUPABASE_URL simulado)
//
// Levanta su propio servidor de desarrollo (vite) apuntando a datos SIMULADOS (scripts/candado/simulador.cjs):
// no toca producción ni gasta nada. Referencias: docs/iatos/candado-visual/referencia/*.png.
// Resultado (capturas actuales y mapas de diferencias): docs/iatos/candado-visual/ultima-corrida/ (no se sube).
// No corre dentro de vitest: tarda ~1–2 min. Ver docs/iatos/LO_QUE_NO_SE_TOCA.md.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { MOCK_ORIGIN, FECHA_FIJA, ITALIA, nuevoContexto } = require("./simulador.cjs");

const ROOT = path.resolve(__dirname, "../..");
const REF = path.join(ROOT, "docs/iatos/candado-visual/referencia");
const OUT = path.join(ROOT, "docs/iatos/candado-visual/ultima-corrida");

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(p); } catch { /* siguiente */ }
  }
  console.error("Falta Playwright: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const ACTUALIZAR = process.argv.includes("--actualizar");
const UMBRAL = Number(arg("--umbral", "0.01"));
const SOLO = (arg("--solo", "") || "").split(",").filter(Boolean);
const PUERTO = Number(arg("--puerto", "8417"));
let BASE = arg("--base", "");

const ruta = encodeURIComponent;
// Las 15 pantallas más usadas. `listo`: lo que debe verse antes de capturar. `ocultar`: zonas que se mueven
// solas (el globo gira): se tapan en la captura, pero se exige que existan.
const PANTALLAS = [
  { id: "01-landing", url: "/", sesion: false, listo: "main, h1" },
  { id: "02-auth", url: "/auth", sesion: false, listo: "input[type=email]" },
  { id: "03-ayuda", url: "/ayuda", sesion: false, listo: "h1" },
  { id: "04-inicio", url: "/dashboard", listo: 'a[href^="/dashboard/viajes/"]' },
  { id: "05-mis-viajes", url: "/dashboard/viajes", listo: '[data-testid="trip-card-dates"]' },
  { id: "06-viaje-resumen", url: `/dashboard/viajes/${ITALIA.id}`, listo: '[data-testid="trip-dashboard"]' },
  { id: "07-viaje-comprar", url: `/dashboard/viajes/${ITALIA.id}#comprar`, listo: '[data-trip-panel="comprar"]:not([hidden])', bajar: '[data-trip-panel="comprar"]' },
  { id: "08-viaje-itinerario", url: `/dashboard/viajes/${ITALIA.id}#destinos`, listo: '[data-trip-panel="destinos"]:not([hidden])', bajar: '[data-trip-panel="destinos"]' },
  { id: "09-planear", url: "/dashboard/planear", listo: "textarea, input" },
  { id: "10-ruta-globo", url: `/dashboard/ruta?origin=${ruta("Ciudad de México")}&destinos=${ruta("Roma|Florencia|Venecia")}&fecha_salida=2027-05-10&fecha_regreso=2027-05-20&viajeros=2`,
    listo: "canvas", bajar: "canvas", ocultar: ["canvas"], exige: "canvas" },
  { id: "11-iato", url: "/dashboard/concierge", listo: "textarea" },
  { id: "12-perfil", url: "/dashboard/perfil", listo: "h1, h2" },
  { id: "13-gastos", url: "/dashboard/gastos", listo: "h1" },
  { id: "14-prive", url: "/prive", listo: ".prive-root" },
  { id: "15-mesa", url: "/dashboard/admin/operaciones", listo: '[data-testid="ops-item"]' },
].filter((p) => !SOLO.length || SOLO.some((s) => p.id.includes(s)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function levantarServidor() {
  const env = { ...process.env, VITE_SUPABASE_URL: MOCK_ORIGIN, VITE_SUPABASE_PUBLISHABLE_KEY: "clave-simulada", VITE_SUPABASE_PROJECT_ID: "simulado", BROWSER: "none" };
  const proc = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PUERTO), "--strictPort"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${PUERTO}`;
  for (let i = 0; i < 120; i++) {
    if (/ready in/i.test(log)) return { proc, base };
    if (proc.exitCode != null) break;
    await sleep(500);
  }
  proc.kill();
  throw new Error(`No arrancó el servidor de desarrollo:\n${log.slice(-2000)}`);
}

/** Compara dos PNG en el navegador (canvas): fracción de píxeles distintos y un mapa de diferencias. */
async function comparar(page, refPng, nuevoPng) {
  return page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { ratio: 1, tam: `${ia.width}x${ia.height} → ${ib.width}x${ib.height}`, diff: null };
    const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height;
    const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height);
    const out = x.createImageData(c.width, c.height);
    let n = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      const g = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 12;
      if (d > 40) { n++; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255; }
      else { out.data[i] = g; out.data[i + 1] = g; out.data[i + 2] = g; out.data[i + 3] = 255; }
    }
    x.putImageData(out, 0, 0);
    return { ratio: n / (da.data.length / 4), diff: c.toDataURL("image/png") };
  }, [`data:image/png;base64,${refPng.toString("base64")}`, `data:image/png;base64,${nuevoPng.toString("base64")}`]);
}

async function capturar(browser, base, p) {
  const ctx = await nuevoContexto(browser, { sesion: p.sesion !== false });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FECHA_FIJA));
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto(base + p.url, { waitUntil: "domcontentloaded" });
  let ok = true;
  try { await page.locator(p.listo).first().waitFor({ state: "visible", timeout: 45_000 }); } catch { ok = false; }
  await sleep(2500); // fotos simuladas, fuentes y esqueletos
  if (p.bajar) await page.locator(p.bajar).first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(800);
  const falta = p.exige && !(await page.locator(p.exige).count()) ? p.exige : null;
  const png = await page.screenshot({ animations: "disabled", caret: "hide", mask: (p.ocultar || []).map((s) => page.locator(s)), maskColor: "#202020" });
  await ctx.close();
  return { png, ok, falta, errores };
}

(async () => {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(REF, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  let server = null;
  if (!BASE) { server = await levantarServidor(); BASE = server.base; }
  const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--font-render-hinting=none"] });
  const cmp = await (await browser.newContext()).newPage();
  const filas = [];
  let fallas = 0;
  try {
    // Una vuelta en blanco para que vite compile todo antes de medir (la primera carga tarda más).
    if (server) { const w = await nuevoContexto(browser); const pg = await w.newPage(); await pg.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" }).catch(() => {}); await sleep(8000); await w.close(); }
    for (const p of PANTALLAS) {
      const r = await capturar(browser, BASE, p);
      fs.writeFileSync(path.join(OUT, `${p.id}.png`), r.png);
      const refFile = path.join(REF, `${p.id}.png`);
      if (!r.ok || r.falta) {
        fallas++;
        filas.push(`FALLA  ${p.id}: ${!r.ok ? `no apareció "${p.listo}"` : `falta "${r.falta}"`}${r.errores.length ? ` · error: ${r.errores[0].slice(0, 120)}` : ""}`);
        continue;
      }
      if (ACTUALIZAR || !fs.existsSync(refFile)) {
        fs.writeFileSync(refFile, r.png);
        filas.push(`NUEVA  ${p.id}: referencia guardada`);
        continue;
      }
      const c = await comparar(cmp, fs.readFileSync(refFile), r.png);
      const pct = (c.ratio * 100).toFixed(2);
      if (c.diff) fs.writeFileSync(path.join(OUT, `${p.id}.diferencias.png`), Buffer.from(c.diff.split(",")[1], "base64"));
      if (c.ratio > UMBRAL) { fallas++; filas.push(`FALLA  ${p.id}: ${pct} % de la pantalla cambió${c.tam ? ` (tamaño ${c.tam})` : ""} → ${path.relative(ROOT, path.join(OUT, `${p.id}.diferencias.png`))}`); }
      else filas.push(`OK     ${p.id}: ${pct} % distinto`);
    }
  } finally {
    await browser.close();
    if (server) server.proc.kill();
  }
  const resumen = `${fallas ? "FALLA" : "OK"} · candado visual · ${PANTALLAS.length} pantallas · umbral ${(UMBRAL * 100).toFixed(1)} %\n${filas.join("\n")}\n`;
  fs.writeFileSync(path.join(OUT, "resultado.txt"), resumen);
  console.log(resumen);
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
