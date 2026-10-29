// Avisos de viaje OFICIALES ("¿qué debo saber antes de ir a Tailandia?"). Sin dependencias de Deno: se
// prueba con Vitest (src/test/travelAdvisories.test.ts) con respuestas reales recortadas y sin red.
//
// Fuentes (gratis, sin llave; probadas el 28-oct-2026, docs/iatos/api-center/INVESTIGACION_APIS.md §I3):
//   - GOV.UK Content API (FCDO): índice de países y una ficha por país con partes (entrada, seguridad,
//     salud…), `public_updated_at` y `details.alert_status`. Licencia OGL v3: fuente y fecha visibles.
//   - US State Dept (cadataapi.state.gov): lista JSON con nivel 1–4 en el título, resumen HTML y enlace.
//   - SRE México "Guía del Viajero": no hay API → solo enlace (siempre primero, es lo que aplica a un
//     pasaporte mexicano).
//
// Reglas:
//   - Son avisos de OTROS gobiernos para SUS ciudadanos: siempre se dice para quién son.
//   - Nunca se inventa ni se extrapola: sin país reconocido no hay aviso; si una fuente falla se dice
//     cuál y se devuelve la otra; el texto se recorta, no se reescribe (la traducción es aparte, fiel y
//     validada: parseTranslation descarta lo que trae cifras que no están en el original).
//   - Caché compartida (public.serp_cache vía CacheStore): fuentes 6 h por país; traducción 7 días por
//     país + versión de las fuentes (si GOV.UK o State Dept actualizan, la traducción se rehace).
import { countryIso } from "./booking/channels.ts";
import { cityAirports } from "./airports.ts";
import { type CacheRow, type CacheStore, cacheKey, freshnessOf } from "./serpCache.ts";

const HOUR = 3600;
export const ADVISORY_TTL_SECONDS = 6 * HOUR;
/** Si una de las dos fuentes falló, se guarda menos tiempo para volver a intentar pronto. */
export const ADVISORY_PARTIAL_TTL_SECONDS = 30 * 60;
export const TRANSLATION_TTL_SECONDS = 7 * 24 * HOUR;
export const GOVUK_INDEX_TTL_SECONDS = 7 * 24 * HOUR;
export const SOURCE_TIMEOUT_MS = 6000;

export const GOVUK_API = "https://www.gov.uk/api/content/foreign-travel-advice";
export const GOVUK_WEB = "https://www.gov.uk/foreign-travel-advice";
export const STATE_API = "https://cadataapi.state.gov/api/TravelAdvisories";
/** No se encontró un patrón estable de ficha por país (el sitio no fue accesible al construir esto). */
export const SRE_URL = "https://guiadelviajero.sre.gob.mx/";

export const SRE_LINK = {
  fuente: "sre" as const,
  texto: "Para mexicanos: consulta la Guía del Viajero de la SRE",
  detalle: "Requisitos de entrada, visas y contactos consulares para pasaporte mexicano.",
  url: SRE_URL,
};
export const AVISO_LEGAL = "No sustituye asesoría migratoria, legal o consular.";

export const FUENTE_NOMBRE = {
  govuk: "GOV.UK (Foreign, Commonwealth & Development Office)",
  state_dept: "Departamento de Estado de EE. UU.",
} as const;
export const PARA_QUIEN = { govuk: "ciudadanos británicos", state_dept: "ciudadanos estadounidenses" } as const;

export type FuenteId = "govuk" | "state_dept";

// ─────────────────────────────────────────── País

export type PaisResuelto = { iso2: string; nombre: string; nombre_en: string };

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, " and ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/\bst\b/g, "saint");

/** Códigos que Intl conoce pero no son países a los que se viaja (o son parte de otro). */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "ZZ", "XA", "XB", "CP", "DG", "TA", "AC"]);
/** Territorios que Intl separa y que los avisos tratan como parte del país. */
const REMAP: Record<string, string> = { IC: "ES", EA: "ES" };
/** Formas de escribir el país que Intl no trae (y que tampoco están en booking/channels.ts). */
const EXTRA_ALIASES: Record<string, string> = {
  "ee uu": "US", eeuu: "US", eua: "US", "estados unidos de america": "US", escocia: "GB", gales: "GB",
  "irlanda del norte": "GB", birmania: "MM", "islas canarias": "ES", canarias: "ES",
};

type DN = { of(code: string): string | undefined };
const displayNames = (locale: string): DN | null => {
  try {
    return new Intl.DisplayNames([locale], { type: "region", fallback: "none" }) as unknown as DN;
  } catch {
    return null;
  }
};

type CountryIndex = { byName: Map<string, string>; es: DN | null; en: DN | null; valid: Set<string> };
let INDEX: CountryIndex | null = null;
/** Nombres de todos los países en español e inglés (Intl, la tabla del propio motor JS; no se duplica). */
function countryIndex(): CountryIndex {
  if (INDEX) return INDEX;
  const es = displayNames("es");
  const en = displayNames("en");
  const byName = new Map<string, string>();
  const valid = new Set<string>();
  for (let a = 65; a < 91; a++) {
    for (let b = 65; b < 91; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      const names = [es?.of(code), en?.of(code)].filter((n): n is string => !!n && n !== code);
      if (!names.length) continue;
      const target = REMAP[code] ?? code;
      valid.add(code);
      for (const n of names) {
        const variants = [n];
        const m = /^(.*?)\s*\((.*)\)\s*$/.exec(n); // "Myanmar (Birmania)" → "Myanmar", "Birmania"
        if (m) variants.push(m[1], m[2]);
        for (const v of variants) {
          const k = norm(v);
          if (k && !byName.has(k)) byName.set(k, target);
        }
      }
    }
  }
  for (const [k, v] of Object.entries(EXTRA_ALIASES)) byName.set(norm(k), v);
  INDEX = { byName, es, en, valid };
  return INDEX;
}

const pais = (iso2: string): PaisResuelto | null => {
  const idx = countryIndex();
  const code = REMAP[iso2] ?? iso2;
  if (!idx.valid.has(code)) return null;
  return { iso2: code, nombre: idx.es?.of(code) ?? code, nombre_en: idx.en?.of(code) ?? code };
};

function resolveOne(text: string): PaisResuelto | null {
  const t = text.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return pais(t.toUpperCase());
  const idx = countryIndex();
  const byName = idx.byName.get(norm(t));
  if (byName) return pais(byName);
  const iso = countryIso(t);
  if (iso && !/^[A-Za-z]{2}$/.test(t)) {
    const p = pais(iso);
    if (p) return p;
  }
  const city = cityAirports(t);
  if (city?.iso2) return pais(city.iso2);
  return null;
}

/**
 * País a partir de un nombre en español o inglés ("Tailandia", "Estados Unidos", "EE. UU."), un código
 * ISO-2 ("TH") o un destino ("Bangkok", "Roma, Italia"). null si no se reconoce: quien llama dice que no
 * hay país, nunca adivina.
 */
export function resolveCountry(input: unknown): PaisResuelto | null {
  const raw = String(input ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!raw) return null;
  const whole = resolveOne(raw);
  if (whole) return whole;
  // "Bangkok, Tailandia" / "Tailandia (Bangkok y Phuket)": el último trozo suele ser el país.
  const parts = raw.split(/[,;/()·|]| - /).map((s) => s.trim()).filter(Boolean);
  for (const p of [...parts].reverse()) {
    const r = resolveOne(p);
    if (r) return r;
  }
  return null;
}

// ─────────────────────────────────────────── Texto

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** HTML → texto plano (listas con viñetas, párrafos en líneas). Sin etiquetas ni scripts. */
export function htmlToText(html: unknown): string {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Recorta en un final de frase o palabra, con "…" si cortó. Nunca reescribe. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("\n"));
  if (sentence > max * 0.6) return `${cut.slice(0, sentence + 1).trim()}…`;
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).trim()}…`;
}

// ─────────────────────────────────────────── Fuentes normalizadas

export type Nivel = {
  /** State Dept: 1–4. GOV.UK: 0 (no desaconseja ninguna zona) a 4 (desaconseja todo viaje al país). */
  valor: number | null;
  /** Escala de la fuente: State Dept tiene 4 niveles; GOV.UK no numera (se ordena por gravedad). */
  escala: "1-4" | "fcdo";
  etiqueta: string;
  original: string;
};

export type AvisoFuente = {
  fuente: FuenteId;
  fuente_nombre: string;
  para_quien: string;
  nivel: Nivel;
  /** Texto plano en inglés (idioma de la fuente), recortado. */
  resumen: string;
  secciones: { entrada?: string; seguridad?: string; salud?: string };
  /** Último cambio que anunció la fuente (GOV.UK). */
  ultimo_cambio?: string | null;
  actualizado_at: string | null;
  url: string;
  consultado_at: string;
  idioma: "en";
  licencia?: string;
};

export type Falla = { fuente: FuenteId; motivo: "no_aplica" | "sin_aviso" | "error" | "timeout"; mensaje: string };

const FCDO_STATUS: Record<string, { valor: number; etiqueta: string }> = {
  avoid_all_but_essential_travel_to_parts: { valor: 1, etiqueta: "Desaconseja viajar a algunas zonas, salvo lo esencial" },
  avoid_all_travel_to_parts: { valor: 2, etiqueta: "Desaconseja todo viaje a algunas zonas" },
  avoid_all_but_essential_travel_to_whole_country: { valor: 3, etiqueta: "Desaconseja viajar a todo el país, salvo lo esencial" },
  avoid_all_travel_to_whole_country: { valor: 4, etiqueta: "Desaconseja todo viaje al país" },
};

export function govukLevel(alertStatus: unknown): Nivel {
  const list = Array.isArray(alertStatus) ? alertStatus.map(String) : [];
  const known = list.map((s) => FCDO_STATUS[s]).filter(Boolean).sort((a, b) => b.valor - a.valor);
  if (!list.length) return { valor: 0, escala: "fcdo", etiqueta: "No desaconseja viajar a ninguna zona", original: "none" };
  if (!known.length) return { valor: null, escala: "fcdo", etiqueta: "Ver aviso original", original: list.join(",") };
  return { valor: known[0].valor, escala: "fcdo", etiqueta: known[0].etiqueta, original: list.join(",") };
}

const STATE_LEVELS: Record<number, string> = {
  1: "Nivel 1 de 4: precauciones normales",
  2: "Nivel 2 de 4: mayor precaución",
  3: "Nivel 3 de 4: reconsiderar el viaje",
  4: "Nivel 4 de 4: no viajar",
};

export function stateLevel(title: unknown): Nivel {
  const t = String(title ?? "");
  const m = /Level\s*([1-4])\s*:?\s*([^-]*)$/i.exec(t);
  const valor = m ? Number(m[1]) : null;
  return { valor, escala: "1-4", etiqueta: valor ? STATE_LEVELS[valor] : "Ver aviso original", original: m ? `Level ${m[1]}: ${m[2].trim()}` : t };
}

type GovukPart = { slug?: string; title?: string; body?: string };
type GovukDoc = {
  base_path?: string; public_updated_at?: string; description?: string;
  details?: { alert_status?: unknown; change_description?: string; parts?: GovukPart[] };
};

const SECTION_MAX = 700;
const SUMMARY_MAX = 1400; // las zonas desaconsejadas y alertas en curso (inundaciones, conflictos) viven aquí

/** Ficha de GOV.UK → fuente normalizada. null si la respuesta no es una ficha de país. */
export function normalizeGovuk(doc: unknown, slug: string, consultadoAt: string): AvisoFuente | null {
  const d = doc as GovukDoc | null;
  const parts = Array.isArray(d?.details?.parts) ? d!.details!.parts! : null;
  if (!d || !parts) return null;
  const part = (s: string) => htmlToText(parts.find((p) => p?.slug === s)?.body ?? "");
  // La primera línea es genérica en todas las fichas ("Your travel insurance could be invalidated…"): se
  // quita para que quepa lo específico del país (zonas desaconsejadas, alertas en curso).
  const warnings = part("warnings-and-insurance").split("\n").filter((l) => !/travel insurance could be invalidated/i.test(l)).join("\n");
  const secciones: AvisoFuente["secciones"] = {};
  const entrada = part("entry-requirements");
  const seguridad = part("safety-and-security");
  const salud = part("health");
  if (entrada) secciones.entrada = clip(entrada, SECTION_MAX);
  if (seguridad) secciones.seguridad = clip(seguridad, SECTION_MAX);
  if (salud) secciones.salud = clip(salud, SECTION_MAX);
  return {
    fuente: "govuk",
    fuente_nombre: FUENTE_NOMBRE.govuk,
    para_quien: PARA_QUIEN.govuk,
    nivel: govukLevel(d.details?.alert_status),
    resumen: clip(warnings || htmlToText(d.description ?? ""), SUMMARY_MAX),
    secciones,
    ultimo_cambio: d.details?.change_description ? clip(htmlToText(d.details.change_description), 240) : null,
    actualizado_at: typeof d.public_updated_at === "string" ? d.public_updated_at : null,
    url: `${GOVUK_WEB}/${slug}`,
    consultado_at: consultadoAt,
    idioma: "en",
    licencia: "Open Government Licence v3.0",
  };
}

export type StateEntry = { Title?: string; Link?: string; Summary?: string; Updated?: string; Published?: string; Category?: string[] };

/** Nombre del país en el título del State Dept ("Mexico Travel Advisory - Level 2: …" → "Mexico"). */
export const stateCountryName = (title: unknown) =>
  String(title ?? "").split(/\s+-\s+Level/i)[0].replace(/\s+Travel Advisory\b/i, "").trim();

export function normalizeState(entry: StateEntry, consultadoAt: string): AvisoFuente | null {
  if (!entry?.Title || !entry.Link) return null;
  return {
    fuente: "state_dept",
    fuente_nombre: FUENTE_NOMBRE.state_dept,
    para_quien: PARA_QUIEN.state_dept,
    nivel: stateLevel(entry.Title),
    resumen: clip(htmlToText(entry.Summary ?? ""), 900),
    secciones: {},
    actualizado_at: entry.Updated ?? entry.Published ?? null,
    url: entry.Link,
    consultado_at: consultadoAt,
    idioma: "en",
  };
}

// ─────────────────────────────────────────── Qué ficha corresponde a cada país

export type GovukCountry = { name: string; slug: string };

/** Slugs de GOV.UK cuyo nombre no coincide con el de Intl (revisado con el índice real, 28-oct-2026). */
const GOVUK_SLUG: Record<string, string> = {
  US: "usa", TR: "turkey", PS: "palestine", CG: "congo", CD: "democratic-republic-of-the-congo", PN: "pitcairn-island",
  FM: "federated-states-of-micronesia", MO: "macao", HK: "hong-kong", BQ: "bonaire-st-eustatius-saba", SX: "st-maarten",
  MF: "st-martin-and-st-barthelemy", BL: "st-martin-and-st-barthelemy", VC: "st-vincent-and-the-grenadines",
  AQ: "antarctica-british-antarctic-territory", GS: "south-georgia-and-south-sandwich-islands",
  SH: "st-helena-ascension-and-tristan-da-cunha", CK: "cook-islands-tokelau-and-niue", TK: "cook-islands-tokelau-and-niue",
  NU: "cook-islands-tokelau-and-niue", MM: "myanmar",
};
/** Nombres del State Dept que no coinciden con el de Intl (revisado con la lista real, 28-oct-2026). */
const STATE_NAME: Record<string, string[]> = {
  HK: ["hong kong"], MO: ["macau"], CD: ["democratic republic of the congo"], CG: ["republic of congo"],
  FM: ["federated states of micronesia"], VC: ["saint vincent and the grenadines"], TR: ["turkey"], MM: ["burma"],
  KG: ["kyrgyz republic"], CV: ["cabo verde"], NR: ["naoero", "nauru"], MF: ["french saint martin"], BL: ["saint barthelemy"],
  BQ: ["bonaire"], PS: ["west bank", "gaza"],
};

const nameVariants = (name: string) => {
  const out = [norm(name)];
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(name);
  if (m) out.push(norm(m[1]), norm(m[2]));
  return out;
};

export function govukIndexFrom(json: unknown): GovukCountry[] {
  const children = (json as { links?: { children?: unknown[] } } | null)?.links?.children;
  if (!Array.isArray(children)) return [];
  const out: GovukCountry[] = [];
  for (const c of children as Array<{ details?: { country?: { name?: unknown; slug?: unknown } } }>) {
    const name = c?.details?.country?.name;
    const slug = c?.details?.country?.slug;
    if (typeof name === "string" && typeof slug === "string" && /^[a-z0-9-]+$/.test(slug)) out.push({ name, slug });
  }
  return out;
}

/** Slug de GOV.UK del país. Sin índice (falló) se usa la tabla de excepciones o el nombre en inglés. */
export function govukSlugFor(p: PaisResuelto, index: GovukCountry[] | null): string | null {
  if (p.iso2 === "GB") return null; // GOV.UK no publica avisos para el propio Reino Unido.
  const fixed = GOVUK_SLUG[p.iso2];
  if (fixed) return fixed;
  const wanted = new Set(nameVariants(p.nombre_en));
  if (index?.length) {
    const hit = index.find((c) => nameVariants(c.name).some((v) => wanted.has(v)));
    return hit?.slug ?? null;
  }
  const slug = norm(p.nombre_en).replace(/ /g, "-");
  return slug || null;
}

/** Entrada del State Dept del país (si hay varias, la de nivel más alto). */
export function stateEntryFor(p: PaisResuelto, list: StateEntry[]): StateEntry | null {
  if (p.iso2 === "US") return null; // El State Dept no publica avisos para EE. UU.
  const wanted = new Set([...(STATE_NAME[p.iso2] ?? []).map(norm), ...nameVariants(p.nombre_en)]);
  const hits = list.filter((e) => nameVariants(stateCountryName(e?.Title)).some((v) => wanted.has(v)));
  if (!hits.length) return null;
  return hits.sort((a, b) => (stateLevel(b.Title).valor ?? 0) - (stateLevel(a.Title).valor ?? 0))[0];
}

// ─────────────────────────────────────────── Descarga

export type Traduccion = {
  idioma: "es";
  /** 3–4 puntos clave, cada uno con la fuente de la que sale. */
  puntos: { texto: string; fuente: FuenteId }[];
  secciones: { entrada?: string; seguridad?: string; salud?: string };
  modelo: string | null;
  traducido_at: string;
};

export type Translator = (fuentes: AvisoFuente[], pais: PaisResuelto) => Promise<Traduccion | null>;

export type AdvisoryDeps = {
  fetchImpl: typeof fetch;
  store?: CacheStore | null;
  now?: () => number;
  timeoutMs?: number;
  log?: (...a: unknown[]) => void;
  /** null/omitido = no traducir (solo se usa una traducción ya guardada). */
  translate?: Translator | null;
};

export type AdvisoryFail = {
  ok: false;
  code: "pais_no_reconocido";
  mensaje: string;
  para_mexicanos: typeof SRE_LINK;
  aviso_legal: string;
  consultado_at: string;
};
export type AdvisoryOk = {
  ok: true;
  pais: PaisResuelto;
  para_mexicanos: typeof SRE_LINK;
  fuentes: AvisoFuente[];
  fallas: Falla[];
  traduccion: Traduccion | null;
  /** ok · fallo (se muestra el original en inglés con aviso) · no_solicitada · sin_fuentes. */
  traduccion_estado: "ok" | "fallo" | "no_solicitada" | "sin_fuentes";
  desde_cache: boolean;
  /** true = las fuentes no respondieron y se sirve lo último guardado (con su fecha real). */
  guardado: boolean;
  consultado_at: string;
  aviso_legal: string;
};
// (Quien lee `ok` hace cast explícito: el tsconfig de la app no estrecha uniones sin strictNullChecks.)
export type AdvisoryResult = AdvisoryOk | AdvisoryFail;

type CachedSources = { fuentes: AvisoFuente[]; fallas: Falla[]; consultado_at: string };

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  return { status: res.status, json };
}

const failOf = (fuente: FuenteId, e: unknown): Falla => {
  const name = (e as Error)?.name;
  return name === "TimeoutError" || name === "AbortError"
    ? { fuente, motivo: "timeout", mensaje: `${fuente === "govuk" ? "GOV.UK" : "El Departamento de Estado"} tardó demasiado en responder.` }
    : { fuente, motivo: "error", mensaje: `No pudimos consultar ${fuente === "govuk" ? "GOV.UK" : "al Departamento de Estado"} ahora.` };
};

// Memoria del proceso (una función Edge caliente atiende varias peticiones): la lista del State Dept
// pesa ~0.5 MB y trae todos los países; el índice de GOV.UK, ~0.3 MB.
const MEMO_MS = 10 * 60 * 1000;
let stateMemo: { at: number; list: StateEntry[] } | null = null;
let govukIndexMemo: { at: number; index: GovukCountry[] } | null = null;
/** Solo para pruebas. */
export function resetAdvisoryMemo() {
  stateMemo = null;
  govukIndexMemo = null;
}

async function safeGet(store: CacheStore | null | undefined, key: string, log: (...a: unknown[]) => void): Promise<CacheRow | null> {
  if (!store) return null;
  try { return await store.get(key); } catch (e) { log("travel advisory cache get:", (e as Error)?.message); return null; }
}
async function safePut(store: CacheStore | null | undefined, key: string, engine: string, value: unknown, ttl: number, log: (...a: unknown[]) => void) {
  if (!store) return;
  try { await store.put(key, engine, value, ttl); } catch (e) { log("travel advisory cache put:", (e as Error)?.message); }
}

async function govukIndex(deps: AdvisoryDeps, now: number, log: (...a: unknown[]) => void): Promise<GovukCountry[] | null> {
  if (govukIndexMemo && now - govukIndexMemo.at < MEMO_MS) return govukIndexMemo.index;
  const key = await cacheKey("govuk_travel_index", { v: 1 });
  const row = await safeGet(deps.store, key, log);
  if (row && freshnessOf(row, now).fresh && Array.isArray(row.response) && row.response.length) {
    govukIndexMemo = { at: now, index: row.response as GovukCountry[] };
    return govukIndexMemo.index;
  }
  try {
    const r = await getJson(deps.fetchImpl, GOVUK_API, deps.timeoutMs ?? SOURCE_TIMEOUT_MS);
    const index = r.status === 200 ? govukIndexFrom(r.json) : [];
    if (index.length) {
      govukIndexMemo = { at: now, index };
      await safePut(deps.store, key, "govuk_travel_index", index, GOVUK_INDEX_TTL_SECONDS, log);
      return index;
    }
  } catch (e) {
    log("govuk index:", (e as Error)?.message);
  }
  return row && Array.isArray(row.response) ? (row.response as GovukCountry[]) : null;
}

async function fetchGovuk(p: PaisResuelto, deps: AdvisoryDeps, now: number, at: string, log: (...a: unknown[]) => void): Promise<AvisoFuente | Falla> {
  if (p.iso2 === "GB") return { fuente: "govuk", motivo: "no_aplica", mensaje: "GOV.UK no publica avisos de viaje para el Reino Unido (es su propio país)." };
  try {
    const index = await govukIndex(deps, now, log);
    const slug = govukSlugFor(p, index);
    if (!slug) return { fuente: "govuk", motivo: "sin_aviso", mensaje: `GOV.UK no tiene una ficha de ${p.nombre}.` };
    const r = await getJson(deps.fetchImpl, `${GOVUK_API}/${slug}`, deps.timeoutMs ?? SOURCE_TIMEOUT_MS);
    if (r.status === 404) return { fuente: "govuk", motivo: "sin_aviso", mensaje: `GOV.UK no tiene una ficha de ${p.nombre}.` };
    if (r.status !== 200) return failOf("govuk", new Error(`HTTP ${r.status}`));
    return normalizeGovuk(r.json, slug, at) ?? failOf("govuk", new Error("respuesta inesperada"));
  } catch (e) {
    return failOf("govuk", e);
  }
}

async function fetchState(p: PaisResuelto, deps: AdvisoryDeps, now: number, at: string): Promise<AvisoFuente | Falla> {
  if (p.iso2 === "US") return { fuente: "state_dept", motivo: "no_aplica", mensaje: "El Departamento de Estado no publica avisos para Estados Unidos (es su propio país)." };
  try {
    let list = stateMemo && now - stateMemo.at < MEMO_MS ? stateMemo.list : null;
    if (!list) {
      const r = await getJson(deps.fetchImpl, STATE_API, deps.timeoutMs ?? SOURCE_TIMEOUT_MS);
      if (r.status !== 200 || !Array.isArray(r.json)) return failOf("state_dept", new Error(`HTTP ${r.status}`));
      list = r.json as StateEntry[];
      stateMemo = { at: now, list };
    }
    const entry = stateEntryFor(p, list);
    if (!entry) return { fuente: "state_dept", motivo: "sin_aviso", mensaje: `El Departamento de Estado no tiene un aviso de ${p.nombre}.` };
    return normalizeState(entry, at) ?? failOf("state_dept", new Error("respuesta inesperada"));
  } catch (e) {
    return failOf("state_dept", e);
  }
}

const isFalla = (x: AvisoFuente | Falla): x is Falla => "motivo" in x;

/** Versión de las fuentes: si cualquiera se actualiza, la traducción guardada deja de servir. */
export const sourcesVersion = (fuentes: AvisoFuente[]) =>
  fuentes.map((f) => `${f.fuente}:${f.actualizado_at ?? ""}:${f.nivel.original}`).sort().join("|");

/**
 * Avisos oficiales de un país (o destino). Caché compartida de 6 h por país; una fuente caída no
 * tumba a la otra; si las dos fallan se sirve lo último guardado marcado como tal (con su fecha).
 */
export async function getTravelAdvisory(input: unknown, deps: AdvisoryDeps): Promise<AdvisoryResult> {
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs).toISOString();
  const log = deps.log ?? ((...a: unknown[]) => console.warn(...a));
  const p = resolveCountry(input);
  if (!p) {
    return {
      ok: false, code: "pais_no_reconocido", para_mexicanos: SRE_LINK, aviso_legal: AVISO_LEGAL, consultado_at: at,
      mensaje: "No reconocí el país del destino, así que no puedo mostrar avisos oficiales. Escribe el país (por ejemplo, \"Tailandia\").",
    };
  }

  const key = await cacheKey("travel_advisory", { iso: p.iso2, v: 1 });
  const row = await safeGet(deps.store, key, log);
  const cached = row ? (row.response as CachedSources) : null;
  let fromCache = false;
  let guardado = false;
  let data: CachedSources;
  if (row && cached?.fuentes && freshnessOf(row, nowMs).fresh) {
    data = cached;
    fromCache = true;
  } else {
    const [g, s] = await Promise.all([fetchGovuk(p, deps, nowMs, at, log), fetchState(p, deps, nowMs, at)]);
    const fuentes = [g, s].filter((x): x is AvisoFuente => !isFalla(x));
    const fallas = [g, s].filter(isFalla);
    const realErrors = fallas.filter((f) => f.motivo === "error" || f.motivo === "timeout");
    if (!fuentes.length && realErrors.length && cached?.fuentes?.length) {
      // Las fuentes no respondieron: lo último guardado, con su fecha de consulta real.
      data = { ...cached, fallas: [...realErrors, ...(cached.fallas ?? [])] };
      fromCache = true;
      guardado = true;
    } else {
      data = { fuentes, fallas, consultado_at: at };
      if (fuentes.length) {
        await safePut(deps.store, key, "travel_advisory", data, realErrors.length ? ADVISORY_PARTIAL_TTL_SECONDS : ADVISORY_TTL_SECONDS, log);
      }
    }
  }
  let traduccion: Traduccion | null = null;
  let estado: "ok" | "fallo" | "no_solicitada" | "sin_fuentes" = data.fuentes.length ? "no_solicitada" : "sin_fuentes";
  if (data.fuentes.length) {
    // tono: "tu" = traducciones con el prompt que tutea (las guardadas antes, de usted, no se reutilizan).
    const tkey = await cacheKey("travel_advisory_es", { iso: p.iso2, v: sourcesVersion(data.fuentes), tono: "tu" });
    const trow = await safeGet(deps.store, tkey, log);
    if (trow && freshnessOf(trow, nowMs).fresh && (trow.response as Traduccion)?.puntos?.length) {
      traduccion = trow.response as Traduccion;
      estado = "ok";
    } else if (deps.translate) {
      try {
        traduccion = await deps.translate(data.fuentes, p);
      } catch (e) {
        log("travel advisory translate:", (e as Error)?.message);
        traduccion = null;
      }
      if (traduccion?.puntos?.length) {
        estado = "ok";
        await safePut(deps.store, tkey, "travel_advisory_es", traduccion, TRANSLATION_TTL_SECONDS, log);
      } else {
        traduccion = null;
        estado = "fallo";
      }
    }
  }

  return {
    ok: true, pais: p, para_mexicanos: SRE_LINK, fuentes: data.fuentes, fallas: data.fallas ?? [], traduccion,
    traduccion_estado: estado, desde_cache: fromCache, guardado, consultado_at: data.consultado_at, aviso_legal: AVISO_LEGAL,
  };
}

// ─────────────────────────────────────────── Traducción fiel (IA barata)

export const TRANSLATION_MODEL = "claude-haiku-5-5";

/** Mensajes para la IA: SOLO resumir y traducir lo que dicen las fuentes, sin agregar nada. */
export function buildTranslationPrompt(fuentes: AvisoFuente[], p: PaisResuelto): { system: string; user: string } {
  const system = [
    "Traduces al español de México avisos de viaje oficiales. Reglas estrictas:",
    "- Usa SOLO lo que dice el texto. No agregues datos, cifras, lugares, fechas ni recomendaciones que no estén.",
    "- Son avisos de otros gobiernos para SUS ciudadanos. Si un punto trata de visas, pasaporte o requisitos de entrada, di para qué pasaporte es (\"para pasaporte británico\" o \"para pasaporte estadounidense\"); nunca lo presentes como requisito para mexicanos.",
    "- Prioriza lo útil para cualquier viajero: zonas desaconsejadas, seguridad, salud, leyes locales, desastres en curso.",
    "- Frases cortas y claras, sin adornos. Conserva nombres propios como vienen.",
    "- Háblale al viajero de TÚ en todos los puntos y secciones (\"Revisa\", \"Mantente\", \"Evita\", \"Lleva\"); nunca de usted (\"Revise\", \"Manténgase\", \"Evite\") ni mezclando los dos.",
    "Responde SOLO con JSON: {\"puntos\":[{\"texto\":\"…\",\"fuente\":\"govuk\"|\"state_dept\"}],\"secciones\":{\"entrada\":\"…\",\"seguridad\":\"…\",\"salud\":\"…\"}}",
    "puntos: 3 o 4, de máximo 200 caracteres cada uno. secciones: 1 o 2 frases cada una, solo si el texto trae esa sección; si no, omítela.",
  ].join("\n");
  const blocks = fuentes.map((f) => {
    const parts = [
      `### fuente: ${f.fuente} (${f.fuente_nombre}, aviso para ${f.para_quien})`,
      `Nivel: ${f.nivel.original}`,
      `Resumen: ${f.resumen}`,
      f.secciones.entrada ? `Entry requirements: ${f.secciones.entrada}` : "",
      f.secciones.seguridad ? `Safety and security: ${f.secciones.seguridad}` : "",
      f.secciones.salud ? `Health: ${f.secciones.salud}` : "",
    ];
    return parts.filter(Boolean).join("\n");
  });
  return { system, user: `País: ${p.nombre_en} (${p.nombre}).\n\n${blocks.join("\n\n")}` };
}

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));

/** ¿Todas las cifras del texto traducido están en el original? (una cifra nueva = dato inventado). */
export function numbersFaithful(translated: string, source: string): boolean {
  const src = new Set(numbersIn(source));
  return numbersIn(translated).every((n) => src.has(n));
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? clip(v.replace(/\s+/g, " ").trim(), max) : "");

/**
 * Valida la respuesta de la IA: JSON con 1–4 puntos de fuentes que sí existen y sin cifras que no
 * estén en el original. Lo que no pasa se descarta (si no queda nada, null → se muestra el inglés).
 */
export function parseTranslation(raw: string, fuentes: AvisoFuente[], modelo: string | null, now = Date.now()): Traduccion | null {
  let j: unknown = null;
  const text = String(raw ?? "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    j = JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
  }
  const obj = j as { puntos?: unknown; secciones?: Record<string, unknown> } | null;
  if (!obj || !Array.isArray(obj.puntos)) return null;
  const sourceText = (id: FuenteId | null) => fuentes
    .filter((f) => !id || f.fuente === id)
    .map((f) => [f.nivel.original, f.resumen, f.secciones.entrada, f.secciones.seguridad, f.secciones.salud, f.ultimo_cambio].join(" "))
    .join(" ");
  const ids = new Set(fuentes.map((f) => f.fuente));
  const puntos: Traduccion["puntos"] = [];
  for (const it of obj.puntos as Array<{ texto?: unknown; fuente?: unknown }>) {
    const fuente = it?.fuente === "govuk" || it?.fuente === "state_dept" ? it.fuente : null;
    const texto = clean(it?.texto, 220);
    if (!fuente || !ids.has(fuente) || texto.length < 8) continue;
    if (!numbersFaithful(texto, sourceText(fuente))) continue;
    puntos.push({ texto, fuente });
    if (puntos.length === 4) break;
  }
  if (!puntos.length) return null;
  const secciones: Traduccion["secciones"] = {};
  const all = sourceText(null);
  for (const k of ["entrada", "seguridad", "salud"] as const) {
    const v = clean(obj.secciones?.[k], 320);
    const has = fuentes.some((f) => f.secciones[k]);
    if (v && has && numbersFaithful(v, all)) secciones[k] = v;
  }
  return { idioma: "es", puntos, secciones, modelo, traducido_at: new Date(now).toISOString() };
}

/** Lo que entrega la llamada al modelo (la conecta la función Edge con _shared/claude.ts). */
export type ModelCall = (req: { model: string; system: string; user: string; maxTokens: number }) =>
  Promise<{ ok: boolean; text: string; model: string | null }>;

/** Traductor con un modelo barato (Haiku). Cualquier falla → null (se muestra el original en inglés). */
export function makeTranslator(call: ModelCall, model = TRANSLATION_MODEL, now: () => number = Date.now): Translator {
  return async (fuentes, p) => {
    if (!fuentes.length) return null;
    const { system, user } = buildTranslationPrompt(fuentes, p);
    // 900 se quedaba corto (28-oct, Tailandia: 900 de 900 → JSON cortado → inglés). Con 2,500 cabe con holgura.
    const r = await call({ model, system, user, maxTokens: 2500 });
    if (!r.ok || !r.text) return null;
    return parseTranslation(r.text, fuentes, r.model ?? model, now());
  };
}

// ─────────────────────────────────────────── Sonda (health-check, sin IA ni caché)

export async function probeTravelAdvisories(deps: { fetchImpl: typeof fetch; timeoutMs?: number }) {
  const timeoutMs = deps.timeoutMs ?? SOURCE_TIMEOUT_MS;
  const probe = async (url: string, count: (j: unknown) => number | null) => {
    const t0 = Date.now();
    try {
      const r = await getJson(deps.fetchImpl, url, timeoutMs);
      const n = r.status === 200 ? count(r.json) : null;
      return { ok: r.status === 200 && !!n, http: r.status, registros: n, ms: Date.now() - t0, detail: null as string | null };
    } catch (e) {
      const name = (e as Error)?.name;
      return { ok: false, http: null, registros: null, ms: Date.now() - t0, detail: name === "TimeoutError" || name === "AbortError" ? "timeout" : "sin respuesta" };
    }
  };
  const [govuk, state] = await Promise.all([
    probe(GOVUK_API, (j) => govukIndexFrom(j).length || null),
    probe(STATE_API, (j) => (Array.isArray(j) ? j.filter((e) => typeof (e as StateEntry)?.Title === "string").length : null)),
  ]);
  return {
    api: "Avisos de viaje oficiales (GOV.UK FCDO + US State Dept)",
    ok: govuk.ok && state.ok,
    govuk: { ...govuk, paises: govuk.registros },
    state_dept: { ...state, avisos: state.registros },
    sre: { url: SRE_URL, nota: "Sin API: solo enlace" },
  };
}
