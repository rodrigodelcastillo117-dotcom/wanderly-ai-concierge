#!/usr/bin/env node
// Verificación NO destructiva de enlaces del Booking Bridge (Fase 11 / complemento, punto 10).
//
// Uso:  node --experimental-strip-types scripts/booking/verify_links.mjs [--only flights,hotels,...] [--out docs/iatos/evidencia/bridge]
//
// Arma los enlaces con los MISMOS constructores que la app (supabase/functions/_shared/booking) y con
// los enlaces curados del catálogo Privé, los abre con Chromium sin hacer clic en nada (no se inicia
// ningún checkout, no se reserva, no se paga), guarda una captura y registra si la página final
// corresponde al producto, las fechas y los viajeros. Las URLs de afiliado (tp.media) se abren UNA vez
// para comprobar el destino; el resto se verifica sobre el destino desenvuelto para no inflar clics.
// No llama a SerpApi ni a ninguna API de pago.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  aviasalesSearchUrl, bookingSearchUrl, getYourGuideSearchUrl, mapsListingUrl, viatorSearchUrl,
} from "../../supabase/functions/_shared/booking/links.ts";
import { checkAllowlisted, checkTrustedSource } from "../../supabase/functions/_shared/booking/allowlist.ts";
import { whatsappLink, whatsappNumberFromUrl } from "../../supabase/functions/_shared/booking/channels.ts";
import { draftRequest } from "../../supabase/functions/_shared/booking/messages.ts";

const req = createRequire("/tmp/claude-0/-home-user-reto/8647f9df-5459-5399-a533-ae256c643445/scratchpad/ux10/");
const { chromium, devices } = req("playwright-core");

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/iatos/evidencia/bridge";
const ONLY = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
mkdirSync(OUT, { recursive: true });

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function dateTokens(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0");
  return [iso, `${dd}/${mm}/${y}`, `${d} ${MES_ES[m - 1]}`, `${d} de ${MES_ES[m - 1]}`, `${MES_EN[m - 1]} ${d}`, `${d} ${MES_EN[m - 1]}`,
    `${MES_ES[m - 1]} ${d}`, `${dd}.${mm}`, `${mm}/${dd}/${y}`].map(norm);
}

// ───────────────────────────── Casos ─────────────────────────────
const cases = [];
const add = (c) => { if (!ONLY || ONLY.has(c.category)) cases.push(c); };

// Vuelos: Aviasales (formato documentado), Google Flights (?q=) y sitios oficiales (página general).
const FL = [
  ["MEX", "MAD", "2026-12-05", "2026-12-12", 2, ["Madrid", "MAD"]],
  ["GDL", "LAX", "2026-11-20", null, 1, ["Los Angeles", "LAX", "Los Ángeles"]],
  ["CUN", "JFK", "2027-01-10", "2027-01-17", 3, ["New York", "Nueva York", "JFK"]],
  ["MTY", "BOG", "2026-12-18", "2027-01-04", 2, ["Bogot", "BOG"]],
  ["MEX", "NRT", "2027-03-02", "2027-03-16", 1, ["Tokyo", "Tokio", "NRT"]],
  ["MEX", "CUN", "2026-12-20", null, 1, ["Cancun", "Cancún", "CUN"]],
  ["BOG", "MEX", "2027-02-01", "2027-02-10", 2, ["Mexico City", "Ciudad de México", "MEX"]],
];
FL.forEach(([o, d, dep, ret, pax, tokens], i) => add({
  id: `F${i + 1}`, category: "flights", label: `Aviasales ${o}→${d} ${dep}${ret ? `/${ret}` : ""} ${pax} pax`, mode: "PROVIDER_SEARCH",
  url: aviasalesSearchUrl({ origin: o, destination: d, depart: dep, ret, adults: pax }), product: tokens, dates: [dep, ret].filter(Boolean), pax,
}));
// F8: formato que la app usaba (googleFlightsLink, ?q=) — se prueba para documentar por qué se descartó.
add({ id: "F8", category: "flights", label: "DESCARTADO · Google Flights ?q= (formato de affiliateLinks.ts)", mode: "PROVIDER_SEARCH",
  url: `https://www.google.com/travel/flights?q=${encodeURIComponent("flights from Ciudad de México to Madrid on 2026-12-05 returning 2026-12-12 for 2 adults")}`,
  product: ["Madrid"], dates: ["2026-12-05"], pax: 2 });
add({ id: "F9", category: "flights", label: "Aeroméxico (sitio oficial, página general)", mode: "UNAVAILABLE", url: "https://aeromexico.com", product: ["aeromexico", "aeroméxico"], dates: [] });
add({ id: "F10", category: "flights", label: "Cambio de fechas: misma ruta MEX→MAD con fechas nuevas", mode: "PROVIDER_SEARCH",
  url: aviasalesSearchUrl({ origin: "MEX", destination: "MAD", depart: "2027-01-08", ret: "2027-01-15", adults: 2 }), product: ["Madrid", "MAD"], dates: ["2027-01-08", "2027-01-15"], pax: 2 });

// Hoteles: búsqueda de Booking.com por nombre + ciudad con fechas y huéspedes (se abre el destino;
// H1 abre además el redirect de afiliado una vez).
const HO = [
  ["Hotel Urban Madrid", "2026-12-05", "2026-12-08", 2, ["Urban"]],
  ["Hotel Carlota Ciudad de México", "2026-11-27", "2026-11-29", 2, ["Carlota"]],
  ["Nizuc Resort Cancún", "2027-01-15", "2027-01-19", 2, ["Nizuc"]],
  ["Hotel de Russie Roma", "2027-04-10", "2027-04-13", 2, ["Russie"]],
  ["Le Bristol Paris", "2027-05-02", "2027-05-04", 2, ["Bristol"]],
  ["Park Hyatt Tokyo", "2027-03-03", "2027-03-07", 1, ["Park Hyatt"]],
  ["The Plaza New York", "2026-12-28", "2026-12-31", 4, ["Plaza"]],
  ["Bairro Alto Hotel Lisboa", "2027-02-05", "2027-02-08", 2, ["Bairro Alto"]],
  ["Hotel Arts Barcelona", "2027-06-12", "2027-06-15", 3, ["Hotel Arts"]],
  ["Casa Antigua Oaxaca", "2026-12-20", "2026-12-23", 2, ["Casa Antigua", "Oaxaca"]],
];
HO.forEach(([q, ci, co, ad, tokens], i) => {
  const wrapped = bookingSearchUrl({ query: q, checkin: ci, checkout: co, adults: ad });
  if (i === 0) {
    // El redirect de afiliado que la app usaba hasta hoy (tp.media/click), para documentar su estado.
    add({ id: "H0", category: "hotels", label: "Redirect de afiliado existente tp.media/click → Booking.com", mode: "PROVIDER_SEARCH",
      url: "https://tp.media/click?" + new URLSearchParams({ marker: "533299.hotels", u: wrapped }).toString(), product: tokens, dates: [ci, co], pax: ad });
  }
  add({ id: `H${i + 1}`, category: "hotels", label: `Booking.com · ${q} · ${ci}→${co} · ${ad} adultos`, mode: "PROVIDER_SEARCH",
    url: wrapped, product: tokens, dates: [ci, co], pax: ad });
});

// Restaurantes: página pública de reservas del catálogo Privé (OpenTable, Tock, Resy, SevenRooms,
// sitio oficial), WhatsApp del catálogo y ficha de Google Maps.
const catalog = JSON.parse(readFileSync("data/prive/import/curaduria_2026-10.json", "utf8"));
const byName = (n) => catalog.find((x) => x.name === n);
const R = ["Contramar", "Licorería Limantour", "Kin Toh (AZULIK)", "Quintonil", "Masala y Maíz", "Eleven Madison Park", "Boia De", "Rules", "Gitano Jungle", "Rosetta"];
R.forEach((n, i) => {
  const x = byName(n);
  if (!x) return;
  const words = n.replace(/\(.*\)/, "").split(/\s+/).filter((w) => w.length > 3);
  add({ id: `R${i + 1}`, category: "restaurants", label: `${n} · ${x.booking_method} · ${new URL(x.booking_url).hostname}`, mode: "PROVIDER_SEARCH",
    url: x.booking_url, product: words.length ? words : [n], dates: [], trust: "curated_catalog" });
});

// Experiencias: páginas oficiales del catálogo (boletos, operadores, chárter) y búsquedas de tours.
const E = ["Casa Luis Barragán", "Vagalume Tulum", "Barco privado Ibiza–Formentera con patrón (Click&Boat)", "ALMA, Rhythms of the Night (Las Caletas)",
  "Private Luxury Whale Watching (Cabo Adventures)", "Lucha libre en la Arena México (CMLL)", "Casa Jacaranda – clase de cocina con visita al mercado"];
E.forEach((n, i) => {
  const x = byName(n);
  if (!x) return;
  const words = n.split(/[\s–(),]+/).filter((w) => w.length > 4).slice(0, 3);
  add({ id: `E${i + 1}`, category: "experiences", label: `${n} · ${new URL(x.booking_url).hostname}`, mode: "PROVIDER_SEARCH", url: x.booking_url,
    product: words, dates: [], trust: "curated_catalog" });
});
add({ id: "E8", category: "experiences", label: "GetYourGuide · búsqueda Museo del Prado Madrid", mode: "PROVIDER_SEARCH",
  url: getYourGuideSearchUrl("Madrid", "Museo del Prado"), product: ["Prado"], dates: [] });
add({ id: "E9", category: "experiences", label: "Viator · búsqueda Chichén Itzá", mode: "PROVIDER_SEARCH",
  url: viatorSearchUrl("Cancún", "Chichén Itzá"), product: ["Chichen", "Chichén"], dates: [] });
{
  const x = byName("Mar Adentro – Islas Palomino");
  const digits = x ? whatsappNumberFromUrl(x.booking_url) : null;
  const text = draftRequest({ venue: "Mar Adentro – Islas Palomino", product_type: "experience", date: "2027-01-09", time: "10:00", party_size: 4 }, "es").body;
  if (digits) add({ id: "E10", category: "experiences", label: "WhatsApp del operador (catálogo) con mensaje prellenado", mode: "REQUEST",
    url: whatsappLink(digits, text), product: [digits.slice(-6)], dates: [] });
}

// Casos límite: enlace roto, ficha de Maps (homónimos), móvil.
add({ id: "X1", category: "edge", label: "Enlace roto (Resy, restaurante inexistente)", mode: "PROVIDER_SEARCH", url: "https://resy.com/cities/new-york-ny/venues/iatos-restaurante-que-no-existe", product: [], dates: [], expectBroken: true });
add({ id: "X2", category: "edge", label: "Google Maps: búsqueda por nombre + ciudad (homónimos: 'Botín, Madrid')", mode: "UNAVAILABLE",
  url: mapsListingUrl("Restaurante Botín, Madrid"), product: ["Botin", "Botín"], dates: [] });
add({ id: "X3", category: "edge", label: "Móvil (iPhone): Aviasales MEX→MAD", mode: "PROVIDER_SEARCH", url: aviasalesSearchUrl({ origin: "MEX", destination: "MAD", depart: "2026-12-05", ret: "2026-12-12", adults: 2 }),
  product: ["Madrid", "MAD"], dates: ["2026-12-05"], pax: 2, mobile: true });
add({ id: "X4", category: "edge", label: "Móvil (iPhone): Tock Quintonil", mode: "PROVIDER_SEARCH", url: "https://www.exploretock.com/quintonil", product: ["Quintonil"], dates: [], mobile: true });
add({ id: "X5", category: "edge", label: "Móvil (iPhone): Booking.com Hotel Urban", mode: "PROVIDER_SEARCH",
  url: bookingSearchUrl({ query: "Hotel Urban Madrid", checkin: "2026-12-05", checkout: "2026-12-08", adults: 2 }), product: ["Urban"], dates: ["2026-12-05"], pax: 2, mobile: true });

// Redirecciones peligrosas: se validan SIN abrirlas (deben quedar bloqueadas por la lista blanca).
const DANGEROUS = [
  "https://tp.media/click?marker=533299.hotels&u=" + encodeURIComponent("https://evil.example/login"),
  "https://booking.com.reservas-seguras.io/hotel", "https://www.google.com/url?q=https://evil.example", "http://www.booking.com/searchresults.html",
  "javascript:alert(document.cookie)", "https://user:pass@www.opentable.com/r/x", "https://xn--bking-gra.com/", "https://127.0.0.1:8080/admin",
  "https://opentable-mx-reservas.com/r/quintonil",
];

// ───────────────────────────── Ejecución ─────────────────────────────
const SOFT_404 = /page not found|pagina no encontrada|we can.?t find (that|this) page|no podemos encontrar (esa|la) pagina|this page (does not|doesn.?t) exist|esta pagina no existe/;
function verdict(c, r) {
  // Solo lo que la PÁGINA muestra (título y texto), no la URL: que la URL lleve las fechas no prueba
  // que el sitio las haya aplicado.
  const hay = norm(`${r.title} ${r.text}`);
  const blocked = [403, 429].includes(r.status) || /captcha|access denied|are you a robot|verify you are human|unusual traffic|acceso denegado|pardon our interruption/.test(hay);
  // Error 404 real o "soft 404" (la página responde 200 pero dice que no existe).
  const broken = [404, 410].includes(r.status) || SOFT_404.test(norm(`${r.title} ${r.text.slice(0, 3000)}`));
  const product = c.product.length === 0 ? null : c.product.some((t) => hay.includes(norm(t)));
  const dates = c.dates.length === 0 ? null : c.dates.every((d) => dateTokens(d).some((t) => hay.includes(t)));
  const pax = !c.pax ? null : new RegExp(`\\b${c.pax}\\s*(adult|adulto|pasajer|passenger|viajer|traveler|huesped|guest|persona)`).test(hay)
    || new RegExp(`\\b${c.pax}\\s*(adultos?|adults?)\\b`).test(hay);
  return { blocked, broken, product, dates, pax };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--headless=new"] });
const desktop = await browser.newContext({ locale: "es-MX", viewport: { width: 1280, height: 860 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });
const mobile = await browser.newContext({ ...devices["iPhone 13"], locale: "es-MX" });
const results = [];
for (const c of cases) {
  const safe = c.trust === "curated_catalog" ? checkTrustedSource(c.url) : checkAllowlisted(c.url);
  const row = { id: c.id, category: c.category, label: c.label, mode: c.mode, url: c.url, allowlist: safe.ok ? safe.trust : `rechazada:${safe.reason}` };
  if (!safe.ok) { results.push({ ...row, status: null, note: "no se abrió: la lista blanca la rechaza" }); continue; }
  const page = await (c.mobile ? mobile : desktop).newPage();
  let status = null, final = c.url, title = "", text = "", error = null;
  try {
    const resp = await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(7000);
    final = page.url();
    title = await page.title();
    text = (await page.evaluate(() => document.body?.innerText ?? "")).replace(/\s+/g, " ").slice(0, 12000);
    await page.screenshot({ path: join(OUT, `${c.id}.jpg`), type: "jpeg", quality: 45 });
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 200);
  }
  await page.close();
  const v = verdict(c, { status, final, title, text });
  const r = { ...row, status, final_url: final, final_host: (() => { try { return new URL(final).hostname; } catch { return null; } })(), title: title.slice(0, 140),
    ...v, error, screenshot: error ? null : `${c.id}.jpg`, checked_at: new Date().toISOString() };
  results.push(r);
  console.log(`${c.id}\t${status}\t${r.final_host}\tproducto=${v.product}\tfechas=${v.dates}\tpax=${v.pax}\tbloqueado=${v.blocked}\troto=${v.broken}\t${c.label}`);
}
await browser.close();
const dangerous = DANGEROUS.map((u) => ({ url: u, strict: checkAllowlisted(u).ok, trusted: checkTrustedSource(u).ok }));
dangerous.forEach((d) => console.log(`PELIGROSA\tpermitida=${d.strict || d.trusted}\t${d.url}`));
const file = join(OUT, `verify_links_${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), note: "Solo carga de páginas públicas; sin clics, sin checkout, sin pagos ni reservas.", results, dangerous }, null, 1));
console.log(`\nResultados: ${file}`);
