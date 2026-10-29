// Catálogo de operadores OFICIALES de tren y autobús por país (compra en el sitio del operador, gratis
// y legal, sin API). Lógica pura: la usan el front (Comprar mi viaje, Destinos) y puede usarla el servidor.
//
// Reglas (decisión del dueño, 23-oct-2026, sin API de Viator/Kayak):
//   * Solo la página oficial de búsqueda/compra de cada operador. Ninguno publica un formato de enlace
//     para prellenar origen, destino y fecha, así que NO se inventan parámetros: se enlaza la portada
//     de compra y se dice "escribe {origen} → {destino} y la fecha" (`prefill: "nada"`).
//   * Nunca precio: "Precio en el sitio del operador".
//   * Horarios reales: el botón "Ver horarios en Google Maps" (Maps URLs, travelmode=transit) va aparte.
//   * Fuente: el dominio oficial del operador (portada pública). Revisado en código el 2026-10-23 sin
//     abrir los sitios (sin red en esta sesión): confirmar con un clic que cada portada sigue viva.
//   * 2026-10-24 (grupo terrestre): Renfe y Deutsche Bahn SÍ reciben ruta y fecha con un formato que se
//     comprobó abriéndolo (groundLinks.ts): `operatorAction` usa ese enlace precargado cuando la ciudad
//     está en sus tablas; si no, la portada de siempre con "escribe {origen} → {destino}". Las portadas
//     de OPERATORS no cambian.

import { cityAirports } from "../airports.ts";
import { busSearches, groundButtonLabel, groundLinkNote, multimodalSearch, railOperatorSearch, type GroundLink, type GroundQuery } from "./groundLinks.ts";

export type OperatorKind = "tren" | "bus";
export interface Operator {
  id: string;
  name: string;
  kind: OperatorKind;
  /** Portada oficial de búsqueda y compra de boletos. */
  url: string;
  /** Qué recibe el enlace: ningún operador documenta un prellenado público. */
  prefill: "nada";
  /** Solo informativo (no vende un boleto del tramo): JR Pass. */
  informativo?: boolean;
  /** Para qué sirve, en corto. */
  nota?: string;
  /** Fuente consultada (dominio oficial). */
  fuente: string;
}

const op = (id: string, name: string, kind: OperatorKind, url: string, extra: Partial<Operator> = {}): Operator =>
  ({ id, name, kind, url, prefill: "nada", fuente: new URL(url).hostname.replace(/^www\./, ""), ...extra });

export const OPERATORS: Record<string, Operator> = {
  renfe: op("renfe", "Renfe", "tren", "https://www.renfe.com/es/es", { nota: "AVE, Avant, Alvia, Avlo, Cercanías y Media Distancia" }),
  iryo: op("iryo", "iryo", "tren", "https://iryo.eu/es/home", { nota: "Alta velocidad Madrid–Barcelona, Valencia, Sevilla, Málaga y más" }),
  ouigo_es: op("ouigo_es", "OUIGO España", "tren", "https://www.ouigo.com/es/", { nota: "Alta velocidad de bajo costo en España" }),
  sncf: op("sncf", "SNCF Connect", "tren", "https://www.sncf-connect.com/", { nota: "TGV INOUI, OUIGO, Intercités y TER en Francia" }),
  // Portada en español (200 el 28-oct-2026); Trenitalia no recibe la ruta por enlace.
  trenitalia: op("trenitalia", "Trenitalia", "tren", "https://www.trenitalia.com/es.html", { nota: "Frecciarossa, Intercity y Regionale" }),
  italo: op("italo", "Italo", "tren", "https://www.italotreno.com/", { nota: "Alta velocidad en Italia" }),
  db: op("db", "Deutsche Bahn", "tren", "https://int.bahn.de/en", { nota: "ICE, IC y regionales en Alemania" }),
  nationalrail: op("nationalrail", "National Rail", "tren", "https://www.nationalrail.co.uk/", { nota: "Horarios y venta de todos los operadores del Reino Unido" }),
  lner: op("lner", "LNER", "tren", "https://www.lner.co.uk/", { nota: "Londres–York–Edimburgo (costa este)" }),
  eurostar: op("eurostar", "Eurostar", "tren", "https://www.eurostar.com/", { nota: "Londres–París/Bruselas/Ámsterdam" }),
  smartex: op("smartex", "JR SmartEX", "tren", "https://smart-ex.jp/en/", { nota: "Shinkansen Tokaido, Sanyo y Kyushu (Tokio–Kioto–Osaka–Hiroshima)" }),
  jrpass: op("jrpass", "Japan Rail Pass", "tren", "https://japanrailpass.net/en/", { informativo: true, nota: "Pase de JR para turistas: solo informativo, no es el boleto del tramo" }),
  sbb: op("sbb", "SBB", "tren", "https://www.sbb.ch/en", { nota: "Trenes en Suiza" }),
  ns: op("ns", "NS", "tren", "https://www.ns.nl/en", { nota: "Trenes en Países Bajos" }),
  cp: op("cp", "CP", "tren", "https://www.cp.pt/passageiros/en", { nota: "Alfa Pendular, Intercidades y regionales en Portugal" }),
  // Autobuses: solo si el plan nombra al operador.
  alsa: op("alsa", "ALSA", "bus", "https://www.alsa.es/", { nota: "Autobuses en España" }),
  flixbus: op("flixbus", "FlixBus", "bus", "https://global.flixbus.com/", { nota: "Autobuses en Europa y América" }),
  ado: op("ado", "ADO", "bus", "https://international.ado.com.mx/", { nota: "ADO, ADO GL, Platino, OCC y AU en México" }),
};

/** Operadores oficiales de tren por país (ISO-2), en orden de uso. */
export const RAIL_BY_COUNTRY: Record<string, string[]> = {
  ES: ["renfe", "iryo", "ouigo_es"],
  FR: ["sncf"],
  IT: ["trenitalia", "italo"],
  DE: ["db"],
  GB: ["nationalrail", "lner"],
  JP: ["smartex", "jrpass"],
  CH: ["sbb"],
  NL: ["ns"],
  PT: ["cp"],
};

/** Eurostar une Reino Unido con Francia, Bélgica y Países Bajos. */
const EUROSTAR_PAIRS = new Set(["GB-FR", "FR-GB", "GB-BE", "BE-GB", "GB-NL", "NL-GB", "FR-BE", "BE-FR", "BE-NL", "NL-BE", "FR-NL", "NL-FR"]);

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** El operador que nombra el texto del plan ("Renfe AVE", "Frecciarossa", "Shinkansen", "ALSA"). */
const NAMED: Array<[RegExp, string]> = [
  [/\b(renfe|ave|avant|alvia|avlo|cercanias)\b/, "renfe"],
  [/\biryo\b/, "iryo"],
  [/\bouigo\b/, "ouigo_es"],
  [/\b(sncf|tgv|inoui|intercites|ter)\b/, "sncf"],
  [/\b(trenitalia|frecciarossa|frecciargento|frecciabianca|freccia\w*)\b/, "trenitalia"],
  [/\b(italo|italotreno)\b/, "italo"],
  [/\b(db|deutsche bahn|ice)\b/, "db"],
  [/\blner\b/, "lner"],
  [/\beurostar\b/, "eurostar"],
  [/\b(shinkansen|nozomi|hikari|kodama|smartex|smart ex)\b/, "smartex"],
  [/\b(sbb|cff|ffs)\b/, "sbb"],
  [/\bns\b/, "ns"],
  [/\b(cp|alfa pendular|intercidades)\b/, "cp"],
  [/\balsa\b/, "alsa"],
  [/\bflix ?bus\b/, "flixbus"],
  [/\b(ado|ado gl|ado platino|occ)\b/, "ado"],
];

const COUNTRY_NAMES: Array<[RegExp, string]> = [
  [/espana|spain/, "ES"], [/francia|france/, "FR"], [/italia|italy/, "IT"], [/alemania|germany/, "DE"],
  [/reino unido|inglaterra|escocia|united kingdom|england|scotland/, "GB"], [/japon|japan/, "JP"], [/suiza|switzerland/, "CH"],
  [/paises bajos|holanda|netherlands/, "NL"], [/portugal/, "PT"], [/belgica|belgium/, "BE"], [/mexico/, "MX"],
];

/** País (ISO-2) de una ciudad del catálogo de aeropuertos o de un nombre de país ("Japón"). */
export function countryOf(cityOrCountry: unknown): string | null {
  const c = cityAirports(cityOrCountry);
  if (c?.iso2) return c.iso2;
  const n = norm(cityOrCountry);
  return COUNTRY_NAMES.find(([re]) => re.test(n))?.[1] ?? null;
}

export interface RouteOperatorsInput { from: string; to: string; provider?: string | null; country?: string | null; kind?: OperatorKind }

/**
 * Operadores oficiales para un tramo: primero el que nombra el plan, luego Eurostar si cruza el Canal,
 * luego los del país (por ciudad de origen/destino o el país del viaje). Lista vacía si no hay
 * catálogo para ese país (India, México en tren…): ahí se queda la búsqueda de siempre.
 */
export function routeOperators(i: RouteOperatorsInput): Operator[] {
  const kind = i.kind ?? "tren";
  const out: Operator[] = [];
  const add = (id: string | undefined) => {
    const o = id ? OPERATORS[id] : undefined;
    if (o && o.kind === kind && !out.some((x) => x.id === o.id)) out.push(o);
  };
  const p = norm(i.provider);
  for (const [re, id] of NAMED) if (re.test(p)) add(id);
  if (kind === "bus") return out; // autobús: solo si el texto nombra al operador
  const a = countryOf(i.from) ?? countryOf(i.country);
  const b = countryOf(i.to) ?? countryOf(i.country);
  if (a && b && EUROSTAR_PAIRS.has(`${a}-${b}`)) add("eurostar");
  for (const c of [a, b]) for (const id of RAIL_BY_COUNTRY[c ?? ""] ?? []) add(id);
  return out;
}

/** Texto honesto para el botón del operador (no recibe la ruta por enlace). */
export const operatorHint = (o: Pick<Operator, "name">, from: string, to: string, date?: string | null) =>
  `${o.name} no recibe la ruta por enlace: escribe ${from} → ${to}${date ? ` y el ${date}` : " y la fecha"}. Precio en el sitio del operador.`;

export const PRICE_AT_OPERATOR = "Precio en el sitio del operador";

/**
 * Botón de un sitio que NO recibe la ruta por enlace (E2E 28-oct-2026: "Ver horarios y precio en Italo"
 * abría la portada sin ruta ni fecha). El botón lo dice: hay que buscar la ruta ahí.
 */
export const searchOnSiteLabel = (site: string) => `${site} · busca la ruta en su sitio`;
/** Trainline necesita códigos internos de estación: su enlace es la portada (affiliateLinks.ts). */
export const TRAINLINE_LABEL = searchOnSiteLabel("Trainline");

/** Botón de un operador para un tramo: enlace precargado si existe (Renfe, DB), si no la portada. */
export type OperatorAction = { url: string; label: string; site: string; prefilled: boolean; hint: string; link: GroundLink | null };

export function operatorAction(o: Operator, q: GroundQuery, day?: string | null): OperatorAction {
  const link = o.informativo ? null : railOperatorSearch(o.id, q);
  if (link) return { url: link.url, label: groundButtonLabel(link.site), site: link.site, prefilled: true, hint: groundLinkNote(link), link };
  return { url: o.url, label: o.informativo ? `${o.name} (informativo)` : searchOnSiteLabel(o.name), site: o.name, prefilled: false, hint: operatorHint(o, q.from, q.to, day ?? null), link: null };
}

/** Tren sin operador del catálogo: buscador multimodal con ruta y fecha (12Go en Asia), si hay. */
export const multimodalAction = (q: GroundQuery): OperatorAction | null => {
  const link = multimodalSearch(q);
  return link ? { url: link.url, label: groundButtonLabel(link.site), site: link.site, prefilled: true, hint: groundLinkNote(link), link } : null;
};

/**
 * Autobús: primero los enlaces precargados (ADO por ruta, FlixBus con fecha, 12Go en Asia); si el plan
 * nombra otro operador (ALSA…), su portada. Lista vacía si no hay nada fiable.
 */
export function busActions(q: GroundQuery & { provider?: string | null }): OperatorAction[] {
  const out: OperatorAction[] = busSearches(q).map((l) => ({ url: l.url, label: groundButtonLabel(l.site), site: l.site, prefilled: true, hint: groundLinkNote(l), link: l }));
  for (const o of routeOperators({ from: q.from, to: q.to, provider: q.provider, kind: "bus" })) {
    if (out.some((x) => x.site.toLowerCase() === o.name.toLowerCase())) continue;
    out.push(operatorAction(o, q));
  }
  return out;
}

/** Sin enlace: lo que se dice en vez de inventar un precio o un enlace. */
export function noLinkText(mode: string | null | undefined, provider?: string | null): string {
  const op = provider ? ` (${provider})` : "";
  if (mode === "taxi" || mode === "traslado") return `Se paga directo al operador${op}; IATOS no lo cotiza.`;
  return `Horarios y precio con el operador${op}: IATOS no lo cotiza; búscalo en su sitio con tu ruta y fecha.`;
}
