#!/usr/bin/env node
// Verificación REAL de los botones externos de compra (cierre 2, grupo enlaces).
//
// Uso:  node --experimental-strip-types scripts/enlaces/verify_enlaces.mjs <raíz-del-código-ANTES> [--only A,D] [--out docs/iatos/evidencia/enlaces]
//
// Arma cada enlace con los MISMOS generadores que la app — los de antes (otra copia del repo, p. ej. el
// commit base 3db952a) y los de ahora (este repo) — para la cotización de ejemplo del dueño:
//   CDMX→Madrid, del 12 al 19 de diciembre de 2026, 2 adultos, 1 habitación; MEX→CUN en Aeroméxico.
// Abre cada URL con Chromium SIN hacer clic en nada (no se reserva, no se paga, no se inicia sesión),
// guarda una captura y decide con lo que la PÁGINA muestra (título y texto), no con la URL:
//   EXACTA     abre la búsqueda con la ruta/lugar, las fechas y las personas;
//   PARCIAL    abre la búsqueda con parte de los datos;
//   SIN_DATOS  abre el sitio, sin los datos;
//   ROTO       error, 404/410 o redirección a otra cosa;
//   BLOQUEADO  403/429/captcha a navegadores automáticos: NO se da por bueno.
// Google limita el tráfico automático: sus casos van en serie con pausas.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const req = createRequire(process.env.PW_FROM ?? "/tmp/claude-0/-home-user-reto/8647f9df-5459-5399-a533-ae256c643445/scratchpad/ux10/");
const { chromium } = req("playwright-core");
const args = process.argv.slice(2);
const BEFORE_ROOT = resolve(args[0]);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/iatos/evidencia/enlaces";
const ONLY = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
// --ids A-VTG,A-HS: vuelve a abrir solo esos casos y los reemplaza en el JSON del día.
const IDS = args.includes("--ids") ? new Set(args[args.indexOf("--ids") + 1].split(",")) : null;
const GAP_GOOGLE = Number(process.env.GAP_GOOGLE ?? 35000);
mkdirSync(OUT, { recursive: true });

const OLD = await import(join(BEFORE_ROOT, "src/lib/affiliateLinks.ts"));
const OLD_GROUND = await import(join(BEFORE_ROOT, "supabase/functions/analizar-viaje/groundTransport.ts"));
const OLD_HS = await import(join(BEFORE_ROOT, "supabase/functions/hotels-search/search.ts"));
const NEW = await import(resolve("src/lib/affiliateLinks.ts"));
const NEW_GROUND = await import(resolve("supabase/functions/analizar-viaje/groundTransport.ts"));
const NEW_HS = await import(resolve("supabase/functions/hotels-search/search.ts"));
const LINKS = await import(resolve("supabase/functions/_shared/booking/links.ts"));

const IDA = "2026-12-12", VUELTA = "2026-12-19";
const D_ES = /12\s*(–|-|al|a)\s*19\s*(de\s*)?dic|12 dic|sáb[,.]? 12 dic|12\/12|dec(ember)? 12|12 de dic|sat,? december 12|dom\.,? 13 dic/i;
const PAX2 = /\b2\s*(adult|adulto|pasajer|passenger|viajer|traveler|huésped|huesped|guest|persona|clientes)/i;
const MAD = /madrid|\bMAD\b/i;

// id · etapa (A antes, D después) · categoría · etiqueta · URL · qué debe mostrar la página.
const cases = [];
const add = (id, stage, cat, label, url, expect, opts = {}) => { if ((!ONLY || ONLY.has(stage)) && (!IDS || IDS.has(`${stage}-${id}`))) cases.push({ id: `${stage}-${id}`, stage, cat, label, url, expect, ...opts }); };
const both = (id, cat, label, oldUrl, newUrl, expect, opts = {}) => { add(id, "A", cat, label, oldUrl, expect, opts); add(id, "D", cat, label, newUrl, expect, opts); };

// ── Vuelos ──
// TripFlights armaba Google Flights con el texto que escribe el usuario (origen "CDMX").
both("GF", "vuelos", "Google Flights · CDMX→Madrid 12–19 dic, 2 adultos",
  OLD.googleFlightsLink("CDMX", "Madrid", IDA, VUELTA, 2), NEW.googleFlightsLink("MEX", "MAD", IDA, VUELTA, 2),
  { route: MAD, dates: D_ES, pax: /\b2\s+Turista|\b2 adultos|para 2 adultos/i }, { google: true });
// Aeroméxico: antes el botón llevaba a su portada (airlineSite de flights-search / IA); ahora Google Flights
// con la ruta, fechas, pasajeros y SOLO Aeroméxico (y su portada sigue como "Sitio de Aeroméxico").
add("GF-AM", "D", "vuelos", "Google Flights · MEX→CUN 12–19 dic, 2 adultos, solo Aeroméxico",
  NEW.googleFlightsLink("MEX", "CUN", IDA, VUELTA, 2, { airline: "AM" }), { route: /canc[uú]n|\bCUN\b/i, dates: D_ES, pax: /\b2\s+Turista|para 2 adultos/i, extra: /aerom[eé]xico/i }, { google: true });
add("GF-NINOS", "D", "vuelos", "Google Flights · CDMX→Madrid, 2 adultos + 1 niño",
  NEW.googleFlightsLink("MEX", "MAD", IDA, VUELTA, 2, { children: 1 }), { route: MAD, dates: D_ES, pax: /\b3\s+Turista/i }, { google: true });
both("AM", "vuelos", "Aeroméxico · sitio oficial", "https://aeromexico.com", "https://aeromexico.com", { route: /canc[uú]n|madrid/i, dates: D_ES });
both("AVIA", "vuelos", "Aviasales · MEX→MAD 12–19 dic, 2 adultos",
  OLD.aviasalesLink("MEX", "MAD", IDA, VUELTA, 2), NEW.aviasalesLink("MEX", "MAD", IDA, VUELTA, 2), { route: /MAD|madrid/i, dates: /december 12|dec 12|12 dic/i, pax: /2 passengers|2 pasajeros/i });
add("AVIA-NINOS", "D", "vuelos", "Aviasales · 2 adultos + 1 niño", NEW.aviasalesLink("MEX", "MAD", IDA, VUELTA, 2, 1), { route: /MAD|madrid/i, dates: /december 12|dec 12/i, pax: /3 passengers|3 pasajeros/i });
both("KAYAK", "vuelos", "Kayak · MEX→MAD 12–19 dic, 2 adultos",
  OLD.kayakFlightsLink("MEX", "MAD", IDA, VUELTA, 2), NEW.kayakFlightsLink("MEX", "MAD", IDA, VUELTA, 2),
  { route: /MAD|madrid/i, dates: /12\/12/, pax: /12\/19\s+2\b|19\/12\s+2\b|\b2 (adults|adultos)/i });
add("KAYAK-NINOS", "D", "vuelos", "Kayak · 2 adultos + 1 niño (8)", NEW.kayakFlightsLink("MEX", "MAD", IDA, VUELTA, 2, [8]), { route: /MAD|madrid/i, dates: /12\/12/, pax: /12\/19\s+3\b|19\/12\s+3\b/i });
both("SKY", "vuelos", "Skyscanner · MEX→MAD", OLD.skyscannerLink("MEX", "MAD", IDA, VUELTA, 2), NEW.skyscannerLink("MEX", "MAD", IDA, VUELTA, 2), { route: MAD, dates: D_ES, pax: PAX2 });

// ── Hoteles ──
both("BK", "hoteles", "Booking.com · Madrid 12–19 dic, 2 adultos, 1 habitación",
  OLD.bookingLink("Madrid", IDA, VUELTA, 2), NEW.bookingLink("Madrid", IDA, VUELTA, 2), { route: MAD, dates: /12 (de )?dic/i, pax: /2 adultos/i, extra: /1 habitaci/i });
add("BK-HOTEL", "D", "hoteles", "Booking.com · Hotel Urban Madrid (hotel por nombre)",
  LINKS.bookingSearchUrl({ query: "Hotel Urban Madrid", checkin: IDA, checkout: VUELTA, adults: 2 }), { route: /urban/i, dates: /12 (de )?dic/i, pax: /2 adultos/i, extra: /1 habitaci/i });
add("BK-NINOS", "D", "hoteles", "Booking.com · 2 adultos + 1 niño de 8", NEW.bookingLink("Madrid", IDA, VUELTA, 2, { childAges: [8] }), { route: MAD, dates: /12 (de )?dic/i, pax: /2 adultos · 1 niño/i });
both("HS", "hoteles", "hotels-search sin búsqueda en vivo · 'Buscar en Booking.com'",
  OLD_HS.bookingUrl("Madrid", IDA, VUELTA, 2, "533299"), NEW_HS.bookingUrl("Madrid", IDA, VUELTA, 2, "533299"), { route: MAD, dates: /12 (de )?dic/i, pax: /2 adultos/i });
both("AIRBNB", "hoteles", "Airbnb · Madrid 12–19 dic, 2 huéspedes", OLD.airbnbLink("Madrid", IDA, VUELTA, 2), NEW.airbnbLink("Madrid", IDA, VUELTA, 2), { route: MAD, dates: /12[–-]19 de dic|12 – 19 de dic/i, pax: /2 huéspedes|2 guests/i });
add("EXPEDIA", "D", "hoteles", "Expedia (la app NO lo usa: referencia)", "https://www.expedia.com/Hotel-Search?destination=Madrid&startDate=2026-12-12&endDate=2026-12-19&adults=2&rooms=1", { route: MAD, dates: D_ES, pax: PAX2 }, { ref: true });
add("HOTELSCOM", "D", "hoteles", "Hotels.com (la app NO lo usa: referencia)", "https://www.hotels.com/Hotel-Search?destination=Madrid&startDate=2026-12-12&endDate=2026-12-19&adults=2&rooms=1", { route: MAD, dates: D_ES, pax: PAX2 }, { ref: true });
add("GHOTELS", "D", "hoteles", "Google Hotels por texto (la app NO lo arma: referencia)", "https://www.google.com/travel/search?q=Hotel%20Urban%20Madrid&checkin=2026-12-12&checkout=2026-12-19&adults=2&hl=es-419", { route: /urban/i, dates: /12 dic|sáb, 12/i, pax: PAX2 }, { ref: true, google: true });

// ── Restaurantes ──
both("OT", "restaurantes", "OpenTable · Sobrino de Botín Madrid", OLD.openTableLink("Madrid", "Sobrino de Botín"), NEW.openTableLink("Madrid", "Sobrino de Botín"), { route: /bot[ií]n/i });
both("RESY", "restaurantes", "Resy · Eleven Madison Park (catálogo) 13 dic, 2 personas",
  "https://resy.com/cities/new-york-ny/venues/eleven-madison-park", LINKS.resyWithDate("https://resy.com/cities/new-york-ny/venues/eleven-madison-park", "2026-12-13", 2),
  { route: /eleven madison/i, dates: /dom\.,? 13 dic|13 dic|dec 13/i, pax: /2 clientes|2 guests/i });
both("FORK", "restaurantes", "TheFork · Madrid", OLD.theforkLink("Madrid", "Botín"), NEW.theforkLink("Madrid", "Botín"), { route: /madrid|bot[ií]n/i });
both("YELP", "restaurantes", "Yelp · Madrid", OLD.yelpLink("Madrid"), NEW.yelpLink("Madrid"), { route: MAD });
both("MAPS", "restaurantes", "Google Maps · Sobrino de Botín, Madrid", OLD.googleMapsSearchLink("Sobrino de Botín", "Madrid"), LINKS.mapsListingUrl("Sobrino de Botín, Madrid"), { route: /bot[ií]n/i }, { google: true });

// ── Actividades ──
both("GYG", "actividades", "GetYourGuide · Madrid con fechas del viaje", OLD.getYourGuideLink("Madrid"), NEW.getYourGuideLink("Madrid", undefined, { from: IDA, to: VUELTA }), { route: MAD, dates: /12[–-]19 dic/i });
both("VIATOR", "actividades", "Viator · Madrid", OLD.viatorLink("Madrid"), NEW.viatorLink("Madrid"), { route: MAD });
both("TRIPADV", "actividades", "Tripadvisor · Madrid", OLD.tripadvisorLink("Madrid"), NEW.tripadvisorLink("Madrid"), { route: MAD });

// ── Trenes y autobús ──
both("OMIO", "trenes", "Omio · Madrid→Barcelona 15 dic", OLD.omioLink("Madrid", "Barcelona", "2026-12-15"), NEW.omioLink("Madrid", "Barcelona", "2026-12-15"), { route: /barcelona/i, dates: /15 dic|dec 15/i });
both("TRAINLINE", "trenes", "Trainline · Madrid→Barcelona 15 dic", OLD.trainlineLink("Madrid", "Barcelona", "2026-12-15"), NEW.trainlineLink("Madrid", "Barcelona", "2026-12-15"), { route: /barcelona/i, dates: /15 dic|dec 15/i });
both("RAILEU", "trenes", "Rail Europe · Madrid→Barcelona", OLD.raileuropeLink("Madrid", "Barcelona", "2026-12-15"), NEW.raileuropeLink("Madrid", "Barcelona", "2026-12-15"), { route: /barcelona/i, dates: /15 dic|dec 15/i });
both("BUS", "trenes", "Autobús CDMX→Puebla (trayecto corto de analizar-viaje)",
  OLD_GROUND.groundSearchLinks("Ciudad de México", "Puebla", IDA).bus, NEW_GROUND.groundSearchLinks("Ciudad de México", "Puebla", IDA).bus, { route: /puebla/i }, { google: true });

// ── Autos ──
both("KAYAK-CARS", "autos", "Kayak autos · Madrid 12–19 dic", OLD.kayakCarsLink("Madrid", IDA, VUELTA), NEW.kayakCarsLink("Madrid", IDA, VUELTA), { route: MAD, dates: /12\/12|12 dic/i });
both("DISCOVER", "autos", "Discover Cars · Madrid 12–19 dic", OLD.discoverCarsLink("Madrid", IDA, VUELTA), NEW.discoverCarsLink("Madrid", IDA, VUELTA), { route: MAD, dates: /dec 12|12 dic/i });
both("RENTALCARS", "autos", "Rentalcars · Madrid 12–19 dic", OLD.rentalcarsLink("Madrid", IDA, VUELTA), NEW.rentalcarsLink("Madrid", IDA, VUELTA), { route: MAD, dates: /12 dic|dec 12/i });

// ── eSIM y seguros ──
both("AIRALO", "esim", "Airalo · España (como lo guarda el viaje)", OLD.airaloLink("España"), NEW.airaloLink("España"), { route: /spain|españa/i });
both("HOLAFLY", "esim", "Holafly · España", OLD.holaflyLink("España"), NEW.holaflyLink("España"), { route: /spain|españa/i });
both("HEYMONDO", "seguros", "Heymondo (página de seguros)", "https://www.heymondo.com/?agencia_id=23021", "https://www.heymondo.com/?agencia_id=23021", { route: /heymondo/i, dates: D_ES });
both("AXA", "seguros", "AXA Assistance (página de seguros)", "https://www.axa-assistance.com/", "https://www.axatravelinsurance.com/", { route: /travel insurance|seguro de viaje/i, dates: D_ES });
both("CHAPKA", "seguros", "Chapka", "https://www.chapkadirect.es/", "https://www.chapkadirect.es/", { route: /chapka/i, dates: D_ES });
both("WN", "seguros", "World Nomads", "https://www.worldnomads.com/", "https://www.worldnomads.com/", { route: /world nomads/i, dates: D_ES });

// ── Ferries, cruceros y traslados ──
both("FERRYHOPPER", "ferries", "Ferryhopper · Pireo→Santorini 15 dic", OLD.ferryhopperLink("Piraeus", "Santorini", "2026-12-15", 2), NEW.ferryhopperLink("Piraeus", "Santorini", "2026-12-15", 2), { route: /santorini/i, dates: /15 dic|dec 15/i });
both("DIRECTFERRIES", "ferries", "Direct Ferries · Pireo→Santorini", OLD.directFerriesLink("Piraeus", "Santorini", "2026-12-15", 2), NEW.directFerriesLink("Piraeus", "Santorini", "2026-12-15", 2), { route: /santorini/i, dates: /15 dic|dec 15/i });
both("VTG", "cruceros", "Vacations To Go · Mediterráneo dic 2026", OLD.vacationsToGoLink("Mediterranean", "2026-12"), NEW.vacationsToGoLink("Mediterranean", "2026-12"), { route: /mediterranean/i, dates: /results?.{0,40}dec(ember)? 2026|dic(iembre)? 2026.{0,40}result/i });
both("CRUISEDIRECT", "cruceros", "CruiseDirect · Mediterráneo", OLD.cruiseDirectLink("Mediterranean", IDA, VUELTA), NEW.cruiseDirectLink("Mediterranean", IDA, VUELTA), { route: /mediterranean/i, dates: /dec(ember)? 12|12\/12\/2026/i });
both("CRUISECRITIC", "cruceros", "Cruise Critic · Mediterráneo", OLD.cruiseCriticLink("Mediterranean"), NEW.cruiseCriticLink("Mediterranean"), { route: /mediterranean/i, dates: /dec(ember)? 2026/i });
both("WELCOME", "traslados", "Welcome Pickups · MAD→Hotel Urban 12 dic 14:00, 2 pax",
  OLD.welcomePickupsLink({ origen: "Aeropuerto Madrid-Barajas", destino: "Hotel Urban", fecha: IDA, hora: "14:00", pax: 2, ciudad: "Madrid" }),
  NEW.welcomePickupsLink({ origen: "Aeropuerto Madrid-Barajas", destino: "Hotel Urban", fecha: IDA, hora: "14:00", pax: 2, ciudad: "Madrid" }), { route: /barajas|urban/i, dates: /12 dic|dec 12/i });

// ───────────────────────────── Ejecución ─────────────────────────────
const norm = (s) => String(s ?? "").normalize("NFC");
const BLOCK = /access denied|human verification|are you a robot|are you a person or a robot|verify you are human|unusual traffic|tráfico inusual|acceso denegado|pardon our interruption|bot or not|please enable js and disable any ad blocker/i;
const BROKEN = /page not found|this page doesn.?t exist|page you requested has moved|something went wrong|algo no ha salido según lo previsto|oops! it looks like you.?ve lost your way|no longer exists/i;
function verdict(c, r) {
  const hay = norm(`${r.title} ${r.text}`);
  // Chromium no muestra la página cuando la respuesta es un error HTTP sin cuerpo (Yelp: 403 también con curl).
  if (r.error && /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(r.error)) return { estado: "BLOQUEADO", motivo: "respuesta HTTP de error al navegador automático (403 con curl)" };
  if (r.error) return { estado: "ROTO", motivo: r.error.slice(0, 80) };
  if ([403, 429].includes(r.status) || BLOCK.test(norm(`${r.title} ${r.text.slice(0, 800)}`)) || /captcha/i.test(r.final ?? "")) return { estado: "BLOQUEADO", motivo: `HTTP ${r.status} / página anti-robot` };
  if ([400, 404, 410].includes(r.status) || BROKEN.test(hay)) return { estado: "ROTO", motivo: `HTTP ${r.status} / página de error` };
  const checks = Object.entries(c.expect).map(([k, re]) => [k, re.test(hay)]);
  const okN = checks.filter(([, v]) => v).length;
  const detalle = Object.fromEntries(checks);
  // EXACTA = la página muestra TODO lo que se le pidió (ruta/lugar, fechas, personas… según el caso).
  if (okN === checks.length) return { estado: "EXACTA", detalle };
  if (okN > 0 && checks.length > 1 && (detalle.dates || detalle.pax)) return { estado: "PARCIAL", detalle };
  return { estado: "SIN_DATOS", detalle };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--headless=new"] });
const ctx = await browser.newContext({ locale: "es-MX", viewport: { width: 1366, height: 900 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });
async function open(c) {
  const page = await ctx.newPage();
  let status = null, title = "", text = "", error = null;
  try {
    const resp = await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(c.google ? 9000 : 8000);
    title = await page.title();
    // Texto visible + valores de los campos del buscador (origen/destino suelen ir en <input>).
    // También el texto de los marcos (algunos sitios pintan el contenido dentro de un iframe).
    // Dos lecturas separadas 3 s (algunos buscadores vuelven a pintar la cabecera al cargar resultados).
    const read = async () => (await Promise.all(page.frames().map((f) => f.evaluate(() => `${document.body?.innerText ?? ""} ${[...document.querySelectorAll("input")].map((i) => i.value).join(" ")}`).catch(() => "")))).join(" ");
    const first = await read();
    await page.waitForTimeout(3000);
    text = `${first} ${await read()}`.replace(/\s+/g, " ").slice(0, 600000);
    await page.screenshot({ path: join(OUT, `${c.id}.jpg`), type: "jpeg", quality: 50 });
  } catch (e) {
    error = String(e?.message ?? e).split("\n")[0].slice(0, 160);
  }
  const final = page.url();
  await page.close();
  const v = verdict(c, { status, title, text, error, final: page.url() });
  const row = { id: c.id, stage: c.stage, cat: c.cat, label: c.label, url: c.url, ref: !!c.ref, status, final_url: final, title: title.slice(0, 120), ...v,
    screenshot: error ? null : `${c.id}.jpg`, checked_at: new Date().toISOString() };
  console.log(`${row.id}\t${row.estado}\t${status}\t${row.final_url.slice(0, 90)}\t${c.label}`);
  return row;
}
const results = [];
const google = cases.filter((c) => c.google);
const rest = cases.filter((c) => !c.google);
// Sitios no Google: de 3 en 3 (más en paralelo, el proxy corta conexiones).
for (let i = 0; i < rest.length; i += 3) results.push(...await Promise.all(rest.slice(i, i + 3).map(open)));
// Google: en serie con pausa (si no, responde "tráfico inusual" y el resultado no sirve).
for (const c of google) { results.push(await open(c)); await new Promise((r) => setTimeout(r, GAP_GOOGLE)); }
await browser.close();
const file = join(OUT, `verify_enlaces_${new Date().toISOString().slice(0, 10)}.json`);
if (IDS && existsSync(file)) {
  const prev = JSON.parse(readFileSync(file, "utf8")).results.filter((r) => !IDS.has(r.id));
  results.push(...prev.map((r) => r));
}
results.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), before_root: BEFORE_ROOT,
  ejemplo: "CDMX→Madrid 12–19 dic 2026, 2 adultos, 1 habitación; MEX→CUN Aeroméxico",
  nota: "Solo se cargan páginas públicas, sin clics: no se reserva, no se paga, no se inicia sesión. BLOQUEADO = el sitio no deja verificar.", results }, null, 1));
console.log(`\n${file}`);
