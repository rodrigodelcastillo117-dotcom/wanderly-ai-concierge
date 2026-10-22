// Validación y mapeo de la curaduría de IATOS Privé (content_g1…g13.json) a filas del catálogo.
// Lógica pura (sin red ni base de datos): la usan load_curation.mjs y las pruebas de Vitest.
//
// Acepta las dos formas de los curadores:
//  * ola 1 (g1–g6): {city_key, city_display, country, category_group, universe?, subcategory, name, …,
//    status, verified_at, notes, keep_existing?, original_name?, replaces_existing_name?, image_query?,
//    google_query?, image?}
//  * ola 2 (g7–g13): lo mismo + locality_type (city|neighborhood|region|island|resort_area|country) y
//    parent_destination; city_key en kebab-case.
// Reglas (docs/iatos/IATOS_PRIVE_CURATION_STANDARD.md):
//  * "verificado" → CURADO con la fecha de verificación (pasa a VERIFICADO solo con el muestreo humano);
//    "no_confirmado" → PENDIENTE (oculto) siempre, aunque traiga premios.
//  * Un sitio con apuestas inyectadas o dominio secuestrado/estacionado: se quita el enlace y la fila
//    queda PENDIENTE (el dueño prohíbe mandar usuarios a sitios de juego).
//  * Casino sin autoridad de licencia con fuente, o aventura sin operador y requisitos de seguridad:
//    PENDIENTE con aviso (la base no lo dejaría publicar).
//  * El cargador nunca pone PARTNER VERIFICADO ni BENEFICIO EXCLUSIVO: IATOS no tiene acuerdos. Los
//    marketplaces (Click&Boat, GetYourGuide, Viator…) son canal externo ("partner_ota"), nunca socio.
//  * La imagen del curador (Wikimedia/Google) se ignora: decisión Pexels; se conserva image_query.
//  * Temporada: "until 25 October", "reabre el 6 de mayo de 2027", "abril a septiembre", "until next
//    spring" → dimensión de temporada con fuente; un lugar cerrado por temporada nunca sale como abierto.
import { aliasMap, allDestinations, priveNorm } from "./destinations.mjs";

export const UNIVERSES = ["the_table", "after_dark", "casino_grand_nights", "yacht_sea", "private_stays", "iconic_events",
  "culture_access", "wellness_escape", "adventure_elite", "sport_leisure", "celebrations", "signature_mexico"];
const BOOKING = new Set(["web", "resy", "opentable", "sevenrooms", "tock", "phone", "email", "walk_in", "concierge_request", "partner_ota"]);
const BOOKING_SYNONYMS = { website: "web", online: "web", telefono: "phone", "teléfono": "phone", correo: "email", whatsapp: "phone",
  zenchef: "web", thefork: "web", "the_fork": "web", walkin: "walk_in", "walk-in": "walk_in", concierge: "concierge_request" };
const MARKETPLACES = /(^|\.)(clickandboat|samboat|getyourguide|viator|tripadvisor|klook|airbnb|musement|civitatis|headout|tiqets|boatsetter|yachtico)\./i;
// Señales de un sitio contaminado (no basta la palabra "apuestas": "sin apuestas" es lo correcto).
const GAMBLING_NOTE = /(secuestrad|hijack|estacionad|parked domain|dominio en venta|inyectad|injected|ajen[oa]s? de apuestas|de apuestas ajen|contenido de apuestas|spam de apuestas|(sitio|p[aá]gina|web) de apuestas|gambling (links?|spam|content|redirect)|betting (links?|spam|content))/i;
const FORBIDDEN = /(socio iatos|beneficio iatos|acceso garantizado|garantizad[oa]s?\b|guaranteed access)/i;
const SOFT_FORBIDDEN = /\b(vip|exclusiv[oa]s?|el mejor|la mejor|el más|la más|legendari[oa]|#1|número uno|best in the world)\b/i;
const GUESTS_ONLY = /(solo|s[oó]lo|únicamente|exclusivamente)\s+(para\s+)?(los\s+)?hu[eé]sped|hotel guests only|guests only|residents? only|solo residentes|solo socios del club|members and their guests/i;
const NIGHT_UNIVERSES = new Set(["after_dark", "casino_grand_nights"]);
const TODAY = () => new Date().toISOString().slice(0, 10);

const MONTHS = {
  enero: 1, january: 1, jan: 1, febrero: 2, february: 2, feb: 2, marzo: 3, march: 3, mar: 3, abril: 4, april: 4, apr: 4,
  mayo: 5, may: 5, junio: 6, june: 6, jun: 6, julio: 7, july: 7, jul: 7, agosto: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, september: 9, sep: 9, sept: 9, octubre: 10, october: 10, oct: 10,
  noviembre: 11, november: 11, nov: 11, diciembre: 12, december: 12, dec: 12,
};
const MONTH_RE = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)";

const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s/]+\.[^\s]+$/i.test(u.trim());
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Llave de duplicado idéntica a public.prive_dedupe_key(). */
export function dedupeKey(name) {
  const base = priveNorm(String(name ?? "").replace(/\s+[-–—]\s+.*$/, "").replace(/\([^)]*\)/g, " "));
  const s = base.replace(/\b(the|el|la|los|las|le|les|il|lo|bar|restaurante|restaurant|ristorante|club)\b/g, " ").replace(/\s+/g, " ").trim();
  return s || base;
}

export const slugify = (t) => priveNorm(t).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");

/** Etiqueta del dominio sin www ni TLD (igual que public.prive_site_label). */
export const siteLabel = (u) => (hostOf(u) ? hostOf(u).split(".")[0] : null);

let _aliases = null;
let _dest = null;
function catalog() {
  if (!_aliases) {
    _aliases = aliasMap();
    _dest = new Map(allDestinations().map((d) => [d.slug, d]));
  }
  return { aliases: _aliases, dest: _dest };
}

/**
 * Destino de una entrada: city_key (kebab, snake o texto), city_display, y parent_destination para
 * barrios (Polanco → Ciudad de México). Devuelve {destination, neighborhood} o null.
 */
export function resolveCity(e, ctxCoords = null) {
  const { aliases, dest } = catalog();
  const tries = [e.city_key, e.city_display, e.locality, e.destination].map((v) => (v == null ? null : priveNorm(String(v).replace(/[_-]/g, " ")))).filter(Boolean);
  let slug = null;
  for (const t of tries) { if (aliases.has(t)) { slug = aliases.get(t); break; } }
  if (!slug) {
    // city_key exacto como slug (ola 2: "st-moritz", "san-jose-del-cabo").
    const k = String(e.city_key ?? "").toLowerCase().replace(/_/g, "-");
    if (dest.has(k) && dest.get(k).dest) slug = k;
  }
  if (!slug) return null;
  let d = dest.get(slug);
  if (!d || !d.dest) return null;
  if (d.kind === "neighborhood") return { destination: d.parent, neighborhood: d.slug };
  // Localidad más precisa según el barrio o la dirección del curador: una entrada archivada en
  // "Riviera Nayarit" con dirección en Punta de Mita va a Punta Mita; una en "Puerto Vallarta, Jal."
  // va a Puerto Vallarta (Jalisco, no Nayarit); en Omán, lo de Mascate va a Mascate. Solo se mueve a un
  // destino hijo, o desde una región/país a una localidad del mismo país, y solo si coincide UNO.
  const text = ` ${priveNorm(`${e.neighborhood ?? ""} ${e.address ?? ""}`)} `;
  if (text.trim()) {
    const isDesc = (slug, anc) => { let c = dest.get(slug); while (c?.parent) { if (c.parent === anc) return true; c = dest.get(c.parent); } return false; };
    const hits = new Set();
    for (const [alias, s] of aliases) {
      const cand = dest.get(s);
      if (!cand?.dest || s === d.slug || cand.kind === "neighborhood" || cand.iso !== d.iso || alias.length < 4) continue;
      // Fuera de la jerarquía solo con coordenadas que lo confirmen (a < ~30 km del centro de esa
      // localidad): "Southampton, New York" no manda un lugar de los Hamptons a la ciudad de Nueva York.
      const near = ctxCoords && Number.isFinite(Number(e.lat)) && ctxCoords[s]?.lat != null
        && Math.abs(ctxCoords[s].lat - Number(e.lat)) < 0.3 && Math.abs(ctxCoords[s].lng - Number(e.lng)) < 0.3;
      // …o con la dirección en OTRO estado o provincia ("Puerto Vallarta, Jal." archivado en Riviera Nayarit).
      const area = priveNorm(cand.admin_area ?? "");
      const otherState = !!area && area !== priveNorm(d.admin_area ?? "")
        && (text.includes(` ${area} `) || text.includes(` ${area.slice(0, 3)} `));
      if (!(isDesc(s, d.slug) || ((d.kind === "region" || d.kind === "country") && cand.kind === "locality" && !isDesc(d.slug, s) && (near || otherState)))) continue;
      if (text.includes(` ${alias} `)) hits.add(s);
    }
    if (hits.size === 1) d = dest.get([...hits][0]);
  }
  // Barrio del curador (neighborhood) que coincide con un barrio del catálogo de ese destino.
  let neighborhood = null;
  const n = priveNorm(e.neighborhood ?? "");
  if (n) {
    for (const [alias, s] of aliases) {
      const cand = dest.get(s);
      if (cand?.kind === "neighborhood" && cand.parent === d.slug && (n === alias || ` ${n} `.includes(` ${alias} `))) { neighborhood = s; break; }
    }
  }
  return { destination: d.slug, neighborhood };
}

/** Política de edad del texto del curador → enum de la base + nota con el texto original. */
export function mapAge(raw, universe) {
  const t = String(raw ?? "").toLowerCase();
  let policy = "todas";
  let note = null;
  if (/21\s*\+|21 años|mayores de 21|over 21|21 and over/.test(t)) policy = "21+";
  else if (/18\s*\+|18 años|mayores de 18|solo adultos|adults only|sólo adultos|over 18/.test(t)) policy = "18+";
  else if (/20\s*\+|20 años/.test(t)) { policy = "18+"; note = `Edad mínima según el lugar: ${raw}`; }
  else if (t && !/todas las edades|all ages|^todas$/.test(t)) note = `Edad: ${raw}`;
  if (NIGHT_UNIVERSES.has(universe) && policy === "todas") {
    policy = "18+";
    note = note ?? (t ? `Edad según la fuente: ${raw}` : null);
  }
  if (policy !== "todas" && t && !/^(18|21)\+$/.test(t.trim())) note = note ?? `Según la fuente: ${raw}`;
  return { policy, note };
}

function yearFrom(text, fallback) {
  const m = String(text).match(/\b(20[2-3][0-9])\b/);
  return m ? Number(m[1]) : fallback;
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Temporada a partir de las notas del curador. Solo lo que el texto dice; nada se supone. */
export function parseSeason(notes, refDate = TODAY()) {
  const text = String(notes ?? "");
  if (!text) return null;
  const refYear = Number(refDate.slice(0, 4));
  const out = { months: null, reopens_on: null, closes_on: null, closed_now: false, note: null };
  const sentence = (re) => (text.match(new RegExp(`[^.;]*${re.source}[^.;]*`, "i"))?.[0] ?? "").trim();
  let hit = false;
  // "reabre el 6 de mayo de 2027", "reopens 6 May 2027", "reopening on 6 May 2027"
  const re1 = new RegExp(`(reabre(?:n)?|reapertura|reopens?|reopening)\\D{0,12}?(\\d{1,2})\\s+(?:de\\s+)?${MONTH_RE}(?:\\s+(?:de\\s+)?(\\d{4}))?`, "i");
  const m1 = text.match(re1);
  if (m1) {
    const y = m1[4] ? Number(m1[4]) : yearFrom(text, refYear);
    out.reopens_on = iso(y, MONTHS[m1[3].toLowerCase()], Number(m1[2]));
    out.note = sentence(re1);
    hit = true;
  }
  // "until 25 October", "hasta el 1 de noviembre de 2026", "open for the season until 25 October (2026)"
  const re2 = new RegExp(`(until|hasta(?: el)?|through)\\s+(\\d{1,2})\\s+(?:de\\s+)?${MONTH_RE}(?:\\s+(?:de\\s+)?(\\d{4}))?`, "i");
  const re2b = new RegExp(`(until|hasta(?: el)?|through)\\s+${MONTH_RE}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, "i");
  const m2 = text.match(re2);
  const m2b = m2 ? null : text.match(re2b);
  if (m2 || m2b) {
    const [day, mon, yr] = m2 ? [m2[2], m2[3], m2[4]] : [m2b[3], m2b[2], m2b[4]];
    const y = yr ? Number(yr) : yearFrom(text, refYear);
    out.closes_on = iso(y, MONTHS[mon.toLowerCase()], Number(day));
    out.note = out.note ?? sentence(m2 ? re2 : re2b);
    hit = true;
  }
  // "de abril a septiembre", "open May–September", "May to October"
  const re3 = new RegExp(`${MONTH_RE}\\s*(?:–|—|-|a|al|to|hasta)\\s*${MONTH_RE}`, "i");
  const m3 = text.match(re3);
  if (m3 && /(temporada|season|abierto|open|opera|operates|solo)/i.test(sentence(re3))) {
    const a = MONTHS[m3[1].toLowerCase()];
    const b = MONTHS[m3[2].toLowerCase()];
    const months = [];
    for (let k = a; ; k = (k % 12) + 1) { months.push(k); if (k === b || months.length > 12) break; }
    out.months = months;
    out.note = out.note ?? sentence(re3);
    hit = true;
  }
  // "until next spring", "cerrado ahora", "closed for the season", "fuera de temporada"
  const re4 = /(until next (spring|summer|season)|hasta (la )?(próxima )?(primavera|temporada)|cerrad[oa] (ahora|por temporada|hasta)|closed for the season|fuera de temporada|off[- ]season)/i;
  if (re4.test(text)) {
    out.note = out.note ?? sentence(re4);
    if (!out.reopens_on) out.closed_now = /(until next|hasta (la )?(próxima )?(primavera|temporada)|cerrad[oa] (ahora|por temporada|hasta)|closed for the season)/i.test(text);
    hit = true;
  }
  if (!hit) return null;
  if (out.closes_on && out.closes_on < refDate && !(out.reopens_on && out.reopens_on > out.closes_on)) out.closed_now = true;
  if (out.reopens_on && out.reopens_on > refDate) out.closed_now = true;
  if (out.months && !out.months.includes(Number(refDate.slice(5, 7)))) out.closed_now = true;
  return out;
}

function sourcesOf(e, errors) {
  const raw = Array.isArray(e.sources) ? e.sources : [];
  const urls = [];
  for (const s of raw) {
    const u = typeof s === "string" ? s : s?.url;
    if (isHttps(u)) urls.push(u.trim());
    else errors.push(`fuente inválida (se requiere https): ${String(u).slice(0, 80)}`);
  }
  return [...new Set(urls)];
}

function accoladesOf(e, errors) {
  const list = Array.isArray(e.accolades) ? e.accolades : [];
  const out = [];
  for (const a of list) {
    const y = Number(a?.year);
    if (!str(a?.name) || !Number.isInteger(y) || y < 1950 || y > 2099 || !isHttps(a?.url)) {
      errors.push(`premio sin nombre, año o URL https: ${JSON.stringify(a).slice(0, 120)}`);
      continue;
    }
    out.push({ name: a.name.trim(), year: y, url: a.url.trim(), ...(a.rank != null ? { rank: a.rank } : {}) });
  }
  return out;
}

/**
 * Valida una entrada y la convierte en fila para prive_import_batch.
 * Devuelve {ok, row?, errors[], warnings[], destination?}.
 */
export function mapEntry(entry, ctx = {}) {
  let e = entry;
  const errors = [];
  const warnings = [];
  const today = ctx.today ?? TODAY();
  if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, errors: ["la entrada no es un objeto"], warnings };
  const name = str(e.name);
  if (!name || name.length > 160) errors.push("falta el nombre (o pasa de 160 caracteres)");

  let universe = str(e.universe);
  if (!universe) {
    universe = { the_table: "the_table", after_dark: "after_dark", extraordinary: "culture_access" }[e.category_group] ?? null;
    if (universe) warnings.push(`sin universe: se usa ${universe} por category_group=${e.category_group}`);
  }
  if (!UNIVERSES.includes(universe)) errors.push(`universo inválido: ${e.universe ?? e.category_group}`);

  const subcategory = String(e.subcategory ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (subcategory.length < 2) errors.push("falta subcategory");

  const where = resolveCity(e, ctx.destinationCoords ?? null);
  if (!where) errors.push(`destino no está en el catálogo: ${e.city_key ?? e.city_display}`);

  const status = String(e.status ?? "").toLowerCase();
  if (!["verificado", "no_confirmado"].includes(status)) errors.push(`status inválido: ${e.status}`);
  const verifiedAt = str(e.verified_at);
  if (!verifiedAt || !/^\d{4}-\d{2}-\d{2}/.test(verifiedAt) || verifiedAt.slice(0, 10) > today) errors.push(`verified_at inválido: ${e.verified_at}`);

  const sources = sourcesOf(e, errors);
  const accolades = accoladesOf(e, errors);
  const why = str(e.why_fact);
  if (!why) errors.push("falta why_fact");
  if (why && FORBIDDEN.test(why)) errors.push(`why_fact usa lenguaje prohibido sin contrato: "${why.match(FORBIDDEN)[0]}"`);
  if (why && SOFT_FORBIDDEN.test(why) && !accolades.length) warnings.push(`why_fact con "${why.match(SOFT_FORBIDDEN)[0]}" sin premio citado: revisar`);
  if (SOFT_FORBIDDEN.test(name ?? "") ) warnings.push(`el nombre contiene "${(name ?? "").match(SOFT_FORBIDDEN)[0]}": solo si es el nombre oficial`);

  let website = str(e.website);
  let bookingUrl = str(e.booking_url);
  // Un enlace que no es https no se publica (no se "arregla" a https sin comprobarlo); la entrada sigue.
  if (website && !isHttps(website)) { warnings.push(`website no es https, se omite: ${website}`); website = null; }
  if (bookingUrl && /^mailto:/i.test(bookingUrl) && !str(e.booking_method)) e = { ...e, booking_method: "email" };
  if (bookingUrl && !isHttps(bookingUrl)) { warnings.push(`booking_url no es https, se omite: ${bookingUrl}`); bookingUrl = null; }

  let bm = str(e.booking_method)?.toLowerCase() ?? null;
  if (bm && !BOOKING.has(bm)) bm = BOOKING_SYNONYMS[bm] ?? bm;
  if (bm && !BOOKING.has(bm)) errors.push(`booking_method inválido: ${e.booking_method}`);
  if (!bm) { bm = "concierge_request"; warnings.push("sin booking_method: se usa concierge_request"); }

  const pl = e.price_level == null ? null : Number(e.price_level);
  if (pl != null && !(Number.isInteger(pl) && pl >= 1 && pl <= 4)) errors.push(`price_level fuera de 1–4: ${e.price_level}`);

  let lat = e.lat == null ? null : Number(e.lat);
  let lng = e.lng == null ? null : Number(e.lng);
  if ((lat == null) !== (lng == null) || (lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180))) {
    warnings.push("coordenadas inválidas o incompletas: se omiten");
    lat = null; lng = null;
  }
  if (lat != null && ctx.destinationCoords && where) {
    // Control de cordura: una coordenada lejísimos del destino es un error de geocodificación.
    const c = ctx.destinationCoords[where.destination];
    const kind = catalog().dest.get(where.destination)?.kind;
    const maxDeg = kind === "region" ? 2.5 : kind === "locality" ? 1.0 : null;
    if (maxDeg && c?.lat != null && (Math.abs(c.lat - lat) > maxDeg || Math.abs(c.lng - lng) > maxDeg)) {
      warnings.push(`coordenadas lejos del destino ${where.destination} (> ${maxDeg}°): se omiten`);
      lat = null; lng = null;
    }
  }

  if (errors.length) return { ok: false, errors, warnings, destination: where?.destination ?? null };

  const notes = String(e.notes ?? "");
  let dataState = status === "verificado" ? "CURADO" : "PENDIENTE";
  if (status === "no_confirmado") warnings.push("no_confirmado: entra PENDIENTE y queda oculto hasta revisión humana");
  if (!sources.length && dataState === "CURADO") { dataState = "PENDIENTE"; warnings.push("sin fuentes con URL: PENDIENTE"); }

  // Sitio con apuestas inyectadas o dominio secuestrado. Si las notas nombran el dominio, solo se
  // quitan los enlaces y fuentes de ESE dominio; si no lo nombran, el contaminado es el sitio de la
  // ficha: se quita y la fila queda PENDIENTE. Nunca se manda a un usuario a un sitio de juego.
  let cleanSources = sources;
  if (GAMBLING_NOTE.test(notes)) {
    const named = new Set((notes.match(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|info|biz|co|br|mx|es|fr|it|io|online|site|xyz)(?:\.[a-z]{2})?\b/gi) ?? [])
      .map((h) => h.toLowerCase().replace(/^www\./, "")));
    const bad = named.size ? named : new Set([hostOf(website), hostOf(bookingUrl)].filter(Boolean));
    const isBad = (u) => !!u && bad.has(hostOf(u));
    if (!named.size || isBad(website) || isBad(bookingUrl)) {
      warnings.push(`notas reportan sitio con apuestas/secuestrado (${[...bad].join(", ") || "sin sitio"}): se quita el enlace y queda PENDIENTE`);
      dataState = "PENDIENTE";
    } else {
      warnings.push(`notas reportan un dominio ajeno con apuestas (${[...named].join(", ")}): ningún enlace a ese dominio se publica`);
    }
    if (isBad(website)) website = null;
    if (isBad(bookingUrl)) bookingUrl = null;
    cleanSources = sources.filter((u) => !isBad(u));
    if (!cleanSources.length) { warnings.push("todas las fuentes estaban en el dominio reportado: sin fuentes publicables"); dataState = "PENDIENTE"; }
  }

  const age = mapAge(e.age_policy, universe);
  let restrictions = age.note;
  if (GUESTS_ONLY.test(`${notes} ${e.booking_method ?? ""} ${why ?? ""}`)) {
    restrictions = [restrictions, "Según la fuente, el acceso es solo para huéspedes, socios o invitados: solicitar no garantiza acceso."].filter(Boolean).join(" ");
  }

  if (universe === "casino_grand_nights" && dataState !== "PENDIENTE" && !(str(e.license_authority) && isHttps(e.license_source))) {
    dataState = "PENDIENTE";
    warnings.push("casino sin autoridad de licencia con fuente (license_authority + license_source): PENDIENTE hasta que una persona la agregue");
  }
  if (universe === "adventure_elite" && dataState !== "PENDIENTE" && !(str(e.safety_requirements) && str(e.operator_name ?? e.operator))) {
    dataState = "PENDIENTE";
    warnings.push("aventura sin operador y requisitos de seguridad: PENDIENTE");
  }

  // Marketplaces: canal externo, nunca socio.
  if ((bookingUrl && MARKETPLACES.test(`.${hostOf(bookingUrl)}`)) || (website && MARKETPLACES.test(`.${hostOf(website)}`)) || /oferta de socio/i.test(notes)) {
    if (bm !== "partner_ota") warnings.push("marketplace / oferta de socio: canal externo (partner_ota), nunca PARTNER VERIFICADO");
    bm = "partner_ota";
  }

  const season = parseSeason(notes, today);
  const seasonSource = website ?? cleanSources[0] ?? null;
  let operating = dataState === "PENDIENTE" ? "desconocido" : "abierto";
  if (season?.closed_now && dataState !== "PENDIENTE") operating = "cerrado_temporal";
  if (/cerrad[oa] (definitivamente|permanentemente)|permanently closed|cerró en 20/i.test(notes)) {
    operating = "cerrado_permanente";
    warnings.push("notas indican cierre permanente: NO DISPONIBLE");
  }

  if (e.image && typeof e.image === "object") warnings.push("image del curador ignorada (decisión Pexels); se usa image_query");
  const imageQuery = str(e.image_query) ?? `${e.subcategory ?? universe} ${e.city_display ?? ""}`.trim();

  const destSlug = where.destination;
  const row = {
    destination_slug: destSlug,
    neighborhood_slug: where.neighborhood,
    slug: `${destSlug}-${slugify(dedupeKey(name)) || "lugar"}`.slice(0, 120),
    universe, subcategory, name,
    address: str(e.address), lat, lng,
    geo_precision: lat != null ? "aproximada" : null,
    geo_source: lat != null ? (/(nominatim|openstreetmap)/i.test(notes) ? "osm_nominatim" : "curaduria") : null,
    website, booking_url: bookingUrl, booking_method: bm,
    description_es: null, why_fact_es: why,
    dress_code_es: str(e.dress_code), dress_code_source: str(e.dress_code) ? (website ?? cleanSources[0] ?? null) : null,
    age_policy: age.policy, age_policy_source: str(e.age_policy) ? (website ?? cleanSources[0] ?? null) : null,
    restrictions_es: restrictions,
    safety_requirements_es: str(e.safety_requirements), operator_name: str(e.operator_name ?? e.operator),
    operator_url: isHttps(e.operator_url) ? e.operator_url : null, operator_license: str(e.operator_license),
    license_authority: str(e.license_authority), license_ref: str(e.license_ref), license_source: isHttps(e.license_source) ? e.license_source : null,
    price_level: pl, price_note_es: str(e.price_note),
    // Montos solo con fuente explícita del curador (price_min/price_source_url); la nota no se convierte en cifra.
    price_currency: str(e.price_currency), price_min: e.price_min ?? null, price_max: e.price_max ?? null,
    price_basis: str(e.price_basis), price_source_url: isHttps(e.price_source_url) ? e.price_source_url : null,
    price_checked_at: isHttps(e.price_source_url) ? verifiedAt : null,
    opening_hours: e.opening_hours && isHttps(e.opening_hours_source) ? e.opening_hours : null,
    opening_hours_source: e.opening_hours && isHttps(e.opening_hours_source) ? e.opening_hours_source : null,
    opening_hours_checked_at: e.opening_hours && isHttps(e.opening_hours_source) ? verifiedAt : null,
    season_note_es: season?.note ?? null,
    season_months: season?.months ?? null,
    season_reopens_on: season?.reopens_on ?? null,
    season_closes_on: season?.closes_on ?? null,
    season_source: season && (season.months || season.reopens_on || season.closes_on || season.note) ? seasonSource : null,
    data_state: dataState,
    operating_status: operating,
    operating_checked_at: operating === "desconocido" ? null : verifiedAt,
    verified_at: dataState === "PENDIENTE" ? null : verifiedAt,
    verified_by: dataState === "PENDIENTE" ? null : `curaduria_asistida:${ctx.file ?? "lote"}`,
    accolades, sources: cleanSources,
    commercial_label: dataState === "CURADO" ? "EXPERIENCIA_CURADA" : "NINGUNA",
    image_query: imageQuery.slice(0, 120),
    tags: [],
    curation_notes: notes ? notes.slice(0, 2000) : null,
    keep_existing: e.keep_existing === true,
    original_name: str(e.original_name),
    replaces_existing_name: str(e.replaces_existing_name),
  };
  if (row.season_note_es && !row.season_source) { row.season_note_es = null; row.season_months = null; row.season_reopens_on = null; row.season_closes_on = null; }
  // Sin fecha legible ni nota con fuente, "cerrado por temporada" no se puede publicar como tal: se oculta.
  if (operating === "cerrado_temporal" && !row.season_note_es && !row.season_reopens_on) row.operating_status = "desconocido";
  if (google(e)) row.google_query = google(e);
  return { ok: true, row, errors, warnings, destination: destSlug };
}
const google = (e) => str(e.google_query);

/** Destino raíz de una familia: Los Cabos para San José del Cabo, Riviera Nayarit para Punta Mita. */
export function familyRoot(slug) {
  const { dest } = catalog();
  let cur = dest.get(slug);
  while (cur?.parent && dest.get(cur.parent)?.dest && dest.get(cur.parent).kind !== "area") cur = dest.get(cur.parent);
  return cur?.slug ?? slug;
}
function depthOf(slug) {
  const { dest } = catalog();
  let d = 0; let cur = dest.get(slug);
  while (cur?.parent) { d++; cur = dest.get(cur.parent); }
  return d;
}
const STATE_PREF = { CURADO: 2, PENDIENTE: 1 };

/**
 * Valida y mapea un lote completo. Duplicados: misma llave de nombre dentro de la misma FAMILIA de
 * destinos (Pujol en "CDMX" y en "Polanco"; Cocina de Autor en "Los Cabos" y en "San José del Cabo").
 * Se queda la entrada con mejor estado y, a igual estado, la más específica (localidad o barrio); la
 * otra se reporta como duplicado.
 */
export function mapBatch(entries, ctx = {}) {
  let accepted = [];
  const rejected = [];
  const warnings = [];
  const seen = new Map();   // familia|llave → índice en accepted
  entries.forEach((e, i) => {
    const r = mapEntry(e, ctx);
    const ref = { file: e?._file ?? ctx.file ?? null, index: e?._index ?? i, name: e?.name ?? null, city: e?.city_key ?? null };
    if (!r.ok) { rejected.push({ ...ref, destination: r.destination, errors: r.errors }); return; }
    const key = `${familyRoot(r.row.destination_slug)}|${dedupeKey(r.row.name)}`;
    const rank = (row) => [STATE_PREF[row.data_state] ?? 0, depthOf(row.destination_slug) + (row.neighborhood_slug ? 1 : 0)];
    if (seen.has(key)) {
      const j = seen.get(key);
      const old = accepted[j];
      const [s1, d1] = rank(r.row); const [s0, d0] = rank(old.row);
      const better = s1 > s0 || (s1 === s0 && d1 > d0);
      const loser = better ? old : { row: r.row, ref, warnings: r.warnings };
      const winner = better ? { row: r.row, ref, warnings: r.warnings } : old;
      rejected.push({ ...loser.ref, destination: loser.row.destination_slug,
        errors: [`duplicado de "${winner.row.name}" (${winner.row.destination_slug}${winner.row.neighborhood_slug ? ` / ${winner.row.neighborhood_slug}` : ""}, ${winner.ref.file ?? "lote"}) en la misma jerarquía de destinos; si son productos distintos, la curaduría debe darles nombres distintos`] });
      accepted[j] = winner;
      return;
    }
    seen.set(key, accepted.length);
    accepted.push({ row: r.row, ref, warnings: r.warnings });
  });
  // Avisos de dominio y slugs únicos, ya con los ganadores.
  const domains = new Map();
  const slugs = new Set();
  accepted = accepted.map(({ row, ref, warnings: w }) => {
    const lbl = siteLabel(row.website);
    if (lbl) {
      const dk = `${familyRoot(row.destination_slug)}|${lbl}`;
      if (domains.has(dk)) warnings.push({ ...ref, warning: `mismo dominio que "${domains.get(dk)}" (${lbl}): revisar si es el mismo lugar` });
      else domains.set(dk, row.name);
    }
    let slug = row.slug; let n = 2;
    while (slugs.has(slug)) slug = `${row.slug}-${n++}`;
    slugs.add(slug);
    for (const x of w) warnings.push({ ...ref, warning: x });
    return { ...row, slug };
  });
  return { accepted, rejected, warnings };
}

/** Resumen por destino y por estado (para el reporte del ensayo). */
export function summarize(result) {
  const byDest = {};
  for (const r of result.accepted) {
    const d = (byDest[r.destination_slug] ??= { total: 0, CURADO: 0, PENDIENTE: 0, universes: new Set(), seasonal_closed: 0 });
    d.total++; d[r.data_state] = (d[r.data_state] ?? 0) + 1; d.universes.add(r.universe);
    if (r.operating_status === "cerrado_temporal") d.seasonal_closed++;
  }
  for (const r of result.rejected) {
    const k = r.destination ?? `(sin destino: ${r.city})`;
    const d = (byDest[k] ??= { total: 0, CURADO: 0, PENDIENTE: 0, universes: new Set(), seasonal_closed: 0 });
    d.rejected = (d.rejected ?? 0) + 1;
  }
  const out = {};
  for (const [k, v] of Object.entries(byDest)) {
    // Cobertura que tendría al cargar (todo CURADO todavía): nunca PILOTO sin muestreo humano.
    const coverage = v.CURADO > 0 ? "COBERTURA_PARCIAL" : "SIN_COBERTURA_VERIFICADA";
    out[k] = { ...v, universes: [...v.universes].sort(), coverage_after_load: coverage };
  }
  return out;
}
