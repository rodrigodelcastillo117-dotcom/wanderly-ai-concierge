// Abre con Chromium (solo lectura, sin clics) las búsquedas de vuelo del caso Roma → Florencia → Venecia
// y guarda capturas: Google Flights y Kayak open-jaw (MEX→FCO, VCE→MEX, 23–30 oct, 2 pasajeros) y, para
// comparar, la búsqueda de antes (MEX→BUH), que Google Flights abre sin destino.
// Uso: node --experimental-strip-types scripts/booking/verify_multidest_links.mjs [carpeta]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const req = createRequire("/opt/node-tools/node_modules/");
const { chromium } = req("playwright");
const WT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { tripFlightSearches } = await import(`${WT}/supabase/functions/_shared/booking/tripRoute.ts`);
const { googleFlightsSearchUrl } = await import(`${WT}/supabase/functions/_shared/booking/links.ts`);
const OUT = process.argv[2] ?? "docs/iatos/evidencia/multidest";
const trip = { destino: "Roma → Florencia → Venecia", ciudad_origen: "Ciudad de México ", fecha_salida: "2026-10-23", fecha_regreso: "2026-10-30", num_viajeros: 2,
  itinerario_json: { destinations: ["Roma", "Florencia", "Venecia"] } };
const s = tripFlightSearches(trip);
const cases = [
  ["GF-OPENJAW", s.google],
  ["KAYAK-OPENJAW", s.kayak],
  ["GF-ANTES-MEX-BUH", googleFlightsSearchUrl({ origin: "MEX", destination: "BUH", depart: "2026-10-22", ret: "2026-11-01", adults: 2 })],
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ locale: "es-MX", timezoneId: "America/Mexico_City", viewport: { width: 1366, height: 1000 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
const res = [];
for (const [id, url] of cases.filter(([i]) => !ONLY || ONLY.includes(i))) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(7000);
    if (page.url().includes("/sorry/")) { await page.waitForTimeout(20000); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(8000); }
    // Consentimiento de cookies (solo lectura: aceptar no compra nada).
    const t = await page.evaluate(() => document.body.innerText.slice(0, 4000));
    await page.screenshot({ path: `${OUT}/${id}.png`, fullPage: false });
    const inputs = await page.evaluate(() => Array.from(document.querySelectorAll("input")).map((i) => i.value || i.getAttribute("aria-label") || "").filter(Boolean).slice(0, 40));
    res.push({ id, url, final: page.url(), inputs, text: t.slice(0, 1500) });
  } catch (e) { res.push({ id, url, error: String(e) }); }
  await page.close();
}
await browser.close();
writeFileSync(`${OUT}/verify.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res.map((r) => ({ id: r.id, url: r.url, final: r.final, inputs: r.inputs, err: r.error })), null, 2));
