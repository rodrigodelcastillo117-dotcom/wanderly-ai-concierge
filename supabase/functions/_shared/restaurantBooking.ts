// Botones de reserva de un restaurante a partir de los campos REALES de Google Places (New):
// websiteUri, reservable, nationalPhoneNumber / internationalPhoneNumber y la ciudad. Sin dependencias
// de Deno: lo usan concierge-chat (cards de Iato), experiencias-top y la pantalla (pestaña Experiencias,
// carrusel del viaje). Se prueba con Vitest.
//
// Orden de confianza (pedido del dueño, caso luna de miel en Italia, 27-oct-2026):
//   1. "Reservar en su sitio" (websiteUri), si Google lo publica.
//   2. "Reservar en TheFork": TheFork es el estándar en Italia (y en buena parte de Europa). Es una
//      BÚSQUEDA por nombre y ciudad (/search?cityName=…&searchText=…): el lugar puede no estar ahí.
//      Formato: el mismo que ya usa src/lib/affiliateLinks.ts (theforkLink); /search existe en
//      thefork.it y thefork.com (su robots.txt lo lista, consultado 2026-10-27). TheFork bloquea la
//      verificación automática (403 anti-robot), así que no se pudo abrir la búsqueda con un navegador
//      automático: la app lo dice ("Búsqueda en TheFork").
//      En los mercados de OpenTable (EE. UU., Canadá…) su búsqueda; en México y donde ninguno cubre el
//      país, solo el sitio y el teléfono del lugar (OPENTABLE_MARKETS).
//   3. "Llamar" (tel:) y "WhatsApp" (wa.me) SOLO si Google trae un número; WhatsApp solo con el
//      número internacional (wa.me exige el código de país) y si es celular (isMobileNumber).
//   4. "Llévame": lo arma la pantalla con place_id o coordenadas (TakeMeThereButton).
// Si Google dice reservable === false: "No toma reservaciones (llega directo)" y sin TheFork.
// Nada aquí reserva: abrir un enlace no es una reserva.
import { cityAirports } from "./airports.ts";
import { cleanPlaceName } from "./placeName.ts";
import { isMobileNumber } from "./booking/channels.ts";

export type RestaurantActionKind = "website" | "thefork" | "opentable" | "call" | "whatsapp";
export type RestaurantAction = { kind: RestaurantActionKind; label: string; url: string; provider: string };

export type RestaurantInput = {
  name: string | null | undefined;
  city?: string | null;
  address?: string | null;
  website?: string | null;
  /** Número tal como lo da Google (internacional o nacional). */
  phone?: string | null;
  /** internationalPhoneNumber de Google ("+39 055 123 4567"). */
  phoneInternational?: string | null;
  reservable?: boolean | null;
  /** ISO-2 si ya se sabe (si no, sale de la ciudad o de la dirección). */
  country?: string | null;
};

export type RestaurantBooking = {
  actions: RestaurantAction[];
  /** "No toma reservaciones (llega directo)" / "Acepta reservaciones (según Google)" / null. */
  note: string | null;
  reservable: boolean | null;
};

export const NO_RESERVATIONS_NOTE = "No toma reservaciones (llega directo)";
export const ACCEPTS_RESERVATIONS_NOTE = "Acepta reservaciones (según Google)";

/** Mercados de TheFork con dominio propio en la lista blanca; los demás de TheFork van a thefork.com. */
const FORK_DOMAIN: Record<string, string> = { IT: "www.thefork.it", ES: "www.thefork.es", FR: "www.thefork.fr", PT: "www.thefork.pt" };
export const FORK_MARKETS = new Set(["IT", "ES", "FR", "PT", "CH", "NL", "BE", "AT", "DK", "SE", "MC", "GB"]);
/**
 * Países donde la búsqueda de OpenTable sirve (E2E 28-oct-2026: "Buscar en OpenTable" salía para Madrid y
 * Valle de Bravo). En España manda TheFork; en México, el sitio y el teléfono del lugar (las páginas
 * curadas de OpenTable México del catálogo Privé siguen como página de reservas del lugar). País
 * desconocido: sin búsqueda en una plataforma que quizá no cubre ese lugar.
 */
export const OPENTABLE_MARKETS = new Set(["US", "CA", "IE", "DE", "AU", "NZ", "JP", "AE", "SG", "HK"]);
/**
 * En México OpenTable solo cubre las ciudades grandes y turísticas (las páginas de OpenTable México del
 * catálogo Privé son de CDMX); en un pueblo como Valle de Bravo la búsqueda no lleva a nada: ahí, el
 * sitio y el teléfono del lugar.
 */
const MX_OPENTABLE_CITIES = new Set(["ciudad de mexico", "cdmx", "mexico city", "guadalajara", "monterrey", "cancun", "tulum", "playa del carmen",
  "los cabos", "cabo san lucas", "san jose del cabo", "puerto vallarta"]);

/** Búsqueda de reservas del país: TheFork en sus mercados, OpenTable en los suyos, ninguna en los demás. */
export function restaurantSearchFor(name: string, city: string | null | undefined, country: string | null): { kind: "thefork" | "opentable"; url: string } | null {
  if (!country) return null;
  if (FORK_MARKETS.has(country)) { const url = theforkSearchUrl(name, city, country); return url ? { kind: "thefork", url } : null; }
  if (OPENTABLE_MARKETS.has(country) || (country === "MX" && MX_OPENTABLE_CITIES.has(norm(city)))) {
    const url = opentableSearchUrl(name, city);
    return url ? { kind: "opentable", url } : null;
  }
  return null;
}

const COUNTRY_WORDS: Array<[RegExp, string]> = [
  [/\b(italia|italy)\b/, "IT"], [/\b(espana|spain)\b/, "ES"], [/\b(francia|france)\b/, "FR"], [/\bportugal\b/, "PT"],
  [/\b(suiza|switzerland|schweiz|suisse|svizzera)\b/, "CH"], [/\b(paises bajos|netherlands|nederland|holanda)\b/, "NL"],
  [/\b(belgica|belgium|belgique|belgie)\b/, "BE"], [/\b(austria|osterreich)\b/, "AT"], [/\b(dinamarca|denmark|danmark)\b/, "DK"],
  [/\b(suecia|sweden|sverige)\b/, "SE"], [/\b(monaco)\b/, "MC"], [/\b(reino unido|united kingdom|uk|england|inglaterra)\b/, "GB"],
  [/\b(mexico)\b/, "MX"], [/\b(estados unidos|united states|usa)\b/, "US"], [/\b(canada)\b/, "CA"],
];

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Nombre local de ciudades frecuentes (TheFork Italia busca "Firenze", no "Florencia"). */
const LOCAL_CITY: Record<string, string> = {
  florencia: "Firenze", florence: "Firenze", venecia: "Venezia", venice: "Venezia", roma: "Roma", rome: "Roma", milan: "Milano",
  napoles: "Napoli", naples: "Napoli", turin: "Torino", genova: "Genova", genoa: "Genova", pisa: "Pisa", siena: "Siena", lucca: "Lucca",
  bolonia: "Bologna", bologna: "Bologna", verona: "Verona", paris: "Paris", madrid: "Madrid", barcelona: "Barcelona", lisboa: "Lisboa",
  oporto: "Porto", sevilla: "Sevilla", granada: "Granada",
};

/** País ISO-2 del restaurante: el dado, el de la ciudad (tabla de ciudades) o el de la dirección de Google. */
export function restaurantCountry(r: Pick<RestaurantInput, "country" | "city" | "address">): string | null {
  const given = String(r.country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(given)) return given;
  const byCity = (cityAirports(r.city) as { iso2?: string } | null)?.iso2;
  if (byCity) return byCity;
  const tail = norm(String(r.address ?? "").split(",").slice(-2).join(" "));
  for (const [re, iso] of COUNTRY_WORDS) if (re.test(tail)) return iso;
  return null;
}

const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
};

/** "+39 055 123 4567" → "+390551234567"; null si no tiene al menos 7 dígitos. */
export function telDigits(phone: unknown): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const plus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${plus ? "+" : ""}${digits}`;
}

/**
 * wa.me solo con número internacional (+código de país) Y celular según el plan de numeración del país
 * (WhatsApp no funciona en un fijo: wa.me/34915326681 era el fijo de Rosi La Loca en Madrid). Donde el
 * número no dice si es celular (México, EE. UU.), no se ofrece: Google no publica si el lugar usa WhatsApp.
 */
export function whatsappUrl(international: unknown): string | null {
  const t = telDigits(international);
  return t && t.startsWith("+") && isMobileNumber(t.slice(1)) === true ? `https://wa.me/${t.slice(1)}` : null;
}

/**
 * Ciudad de una dirección de Google ("Via dei Neri, 2, 50122 Firenze FI, Italia" → "Firenze"): el tramo
 * antes del país, sin código postal ni sigla de provincia. null si no se puede leer.
 */
export function cityFromAddress(address: unknown): string | null {
  const parts = String(address ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const seg = parts[parts.length - 2].replace(/\b\d{3,6}(-\d{3,4})?\b/g, " ").replace(/\b[A-Z]{2}\b/g, " ").replace(/\s+/g, " ").trim();
  return seg && /\p{L}{3,}/u.test(seg) ? seg.slice(0, 60) : null;
}

/** Búsqueda de TheFork por nombre y ciudad (mismo formato que theforkLink de la app). */
export function theforkSearchUrl(name: string, city: string | null | undefined, country: string | null): string | null {
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const c = String(city ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!n || !c) return null;
  const host = (country && FORK_DOMAIN[country]) || "www.thefork.com";
  const local = country && FORK_DOMAIN[country] ? LOCAL_CITY[norm(c)] ?? c : c;
  const u = new URL(`https://${host}/search`);
  u.searchParams.set("cityName", local);
  u.searchParams.set("searchText", n);
  return u.toString();
}

/** Búsqueda de OpenTable (fuera de los mercados de TheFork), igual que restaurantBookingLinks de Iato. */
export function opentableSearchUrl(name: string, city: string | null | undefined): string | null {
  const term = [name, city].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ").slice(0, 160);
  if (!term) return null;
  const u = new URL("https://www.opentable.com/s");
  u.searchParams.set("term", term);
  return u.toString();
}

/**
 * Botones de reserva en orden de confianza. Sin número no hay "Llamar" ni "WhatsApp"; sin sitio no hay
 * "Reservar en su sitio"; con reservable === false no se ofrece TheFork ni OpenTable.
 */
export function restaurantBooking(r: RestaurantInput): RestaurantBooking {
  const name = cleanPlaceName(r.name);
  const reservable = typeof r.reservable === "boolean" ? r.reservable : null;
  const actions: RestaurantAction[] = [];
  if (!name) return { actions, note: null, reservable };
  const site = httpsUrl(r.website);
  if (site) {
    let host = "su sitio";
    try { host = new URL(site).hostname.replace(/^www\./, ""); } catch { /* ya validada */ }
    actions.push({ kind: "website", label: reservable === false ? "Ver su sitio" : "Reservar en su sitio", url: site, provider: host });
  }
  const country = restaurantCountry(r);
  const city = String(r.city ?? "").trim() || cityFromAddress(r.address);
  if (reservable !== false && city) {
    const s = restaurantSearchFor(name, city, country);
    if (s?.kind === "thefork") actions.push({ kind: "thefork", label: "Reservar en TheFork", url: s.url, provider: "TheFork" });
    else if (s?.kind === "opentable") actions.push({ kind: "opentable", label: "Buscar en OpenTable", url: s.url, provider: "OpenTable" });
  }
  const tel = telDigits(r.phoneInternational ?? r.phone);
  if (tel) actions.push({ kind: "call", label: "Llamar", url: `tel:${tel}`, provider: "Teléfono" });
  const wa = whatsappUrl(r.phoneInternational ?? (String(r.phone ?? "").trim().startsWith("+") ? r.phone : null));
  if (wa) actions.push({ kind: "whatsapp", label: "WhatsApp", url: wa, provider: "WhatsApp" });
  const note = reservable === false ? NO_RESERVATIONS_NOTE : reservable === true ? ACCEPTS_RESERVATIONS_NOTE : null;
  return { actions, note, reservable };
}

// ─── Comidas del día (campos serves* de Google) ───

export type Meal = "desayuno" | "brunch" | "comida" | "cena";
export const MEALS: Meal[] = ["desayuno", "brunch", "comida", "cena"];
export const MEAL_LABEL: Record<Meal, string> = { desayuno: "Desayuno", brunch: "Brunch", comida: "Comida", cena: "Cena" };
const MEAL_FIELD: Record<Meal, "breakfast" | "brunch" | "lunch" | "dinner"> = { desayuno: "breakfast", brunch: "brunch", comida: "lunch", cena: "dinner" };

type ServesLike = { serves?: Partial<Record<"breakfast" | "brunch" | "lunch" | "dinner", boolean | null>> | null };

/** true / false / null (Google no lo dice) para esa comida. */
export function servesMeal(p: ServesLike | null | undefined, meal: Meal): boolean | null {
  const v = p?.serves?.[MEAL_FIELD[meal]];
  return typeof v === "boolean" ? v : null;
}

/** Solo los que Google marca que SÍ sirven esa comida (sin dato no entra: no se adivina). */
export function filterByMeal<T extends ServesLike>(places: T[], meal: Meal | null | undefined): T[] {
  if (!meal) return places;
  return places.filter((p) => servesMeal(p, meal) === true);
}

/** "desayuno", "brunch", "comer", "cenar"… en un texto → la comida. */
export function mealFromText(text: unknown): Meal | null {
  const t = norm(text);
  if (/\bbrunch\b/.test(t)) return "brunch";
  if (/\b(desayun\w*|breakfast)\b/.test(t)) return "desayuno";
  if (/\b(cena\w*|cenar|dinner)\b/.test(t)) return "cena";
  if (/\b(comida|comer|almuerzo|almorzar|lunch)\b/.test(t)) return "comida";
  return null;
}

// ─── Criterio TOP (visible y con números reales) ───

export type TopCriterion = { min_rating: number; min_reviews: number };
export const TOP_GOOGLE: TopCriterion = { min_rating: 4.5, min_reviews: 500 };
export const TOP_GOOGLE_RELAXED: TopCriterion = { min_rating: 4.3, min_reviews: 200 };
export const TOP_VIATOR: TopCriterion = { min_rating: 4.6, min_reviews: 300 };

export type TopResult<T> = {
  items: T[];
  criterio: TopCriterion;
  /** true si con el criterio estricto quedaban menos de `minCount` y se usó el relajado. */
  relajado: boolean;
  /** Texto para la pantalla: el criterio usado y, si aplica, que se bajó o que no alcanzó. */
  aviso: string;
};

const fmtN = (n: number) => n.toLocaleString("es-MX");
export const criterionText = (c: TopCriterion, source: string) => `${c.min_rating.toFixed(1)}★ o más con ${fmtN(c.min_reviews)} reseñas o más en ${source}`;

/**
 * Los mejores por calificación y número de reseñas (sin opinión: solo los números del proveedor).
 * Orden: calificación ↓ y, a igual calificación, más reseñas primero.
 */
export function topByRating<T>(
  items: T[], get: (x: T) => { rating: number | null | undefined; reviews: number | null | undefined },
  opts: { strict: TopCriterion; relaxed?: TopCriterion | null; minCount?: number; source: string },
): TopResult<T> {
  const minCount = opts.minCount ?? 3;
  const pass = (c: TopCriterion) => items.filter((x) => {
    const { rating, reviews } = get(x);
    return typeof rating === "number" && typeof reviews === "number" && rating >= c.min_rating && reviews >= c.min_reviews;
  }).sort((a, b) => {
    const A = get(a), B = get(b);
    return (Number(B.rating) - Number(A.rating)) || (Number(B.reviews) - Number(A.reviews));
  });
  let criterio = opts.strict;
  let list = pass(criterio);
  let relajado = false;
  if (list.length < minCount && opts.relaxed) {
    const more = pass(opts.relaxed);
    if (more.length > list.length) { list = more; criterio = opts.relaxed; relajado = true; }
  }
  let aviso = `Criterio: ${criterionText(criterio, opts.source)}.`;
  if (relajado) aviso = `Con ${criterionText(opts.strict, opts.source)} quedaban menos de ${minCount}; bajamos a ${criterionText(criterio, opts.source)}.`;
  if (list.length < minCount) aviso += ` Solo ${list.length === 1 ? "1 lugar cumple" : `${list.length} cumplen`} el criterio en esta búsqueda.`;
  return { items: list, criterio, relajado, aviso };
}
