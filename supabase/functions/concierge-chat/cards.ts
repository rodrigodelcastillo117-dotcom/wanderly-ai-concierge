// Contrato y validación de las "cards" del concierge (hallazgos B-02, B-03, B-04 y B-10).
// Lógica pura, importable desde Vitest y desde el cliente (los tipos de card).
//
// Antes el servidor devolvía tal cual lo que escribía el modelo: precios que no venían de
// ninguna búsqueda, jets con "$24,000" de ejemplo, enlaces javascript: y cards de tipos que la
// pantalla no sabía dibujar. Ahora cada card pasa por validateCards() después del modelo.

import { PLACE_LIST_MAX_CHARS, slimToolResult } from "./tools.ts";

const PLACE_LIST_TOOLS = new Set(["search_attractions", "search_places", "search_nearby"]);
import { isGooglePlaceId } from "./actions.ts";
import { neutralizeDeep } from "./guard.ts";
import { isPhotoRef } from "../_shared/placePhotoRef.ts";
import { checkAllowlisted } from "../_shared/booking/allowlist.ts";
import { NO_RESERVATIONS_NOTE } from "../_shared/restaurantBooking.ts";
import { matchOfficialTicket, viatorAlternativeUrl } from "../_shared/officialTickets.ts";

export const CARD_TYPES = ["flight", "hotel", "attraction", "restaurant", "place", "source", "transport", "alert", "luggage", "jet", "event", "tour"] as const;
export type CardType = typeof CARD_TYPES[number];

/**
 * Estado del dato que muestra la card (diseño C-1). Lo asigna SOLO el servidor.
 * - CONSULTADO_EN_VIVO: el precio coincide con un resultado de herramienta de este turno.
 * - NO_VERIFICADO: el modelo puso un precio que no aparece en ningún resultado; se quita.
 * - SOLICITUD_HUMANA: jet/equipaje — no hay proveedor conectado; es una solicitud de cotización.
 * - OBSOLETO: el precio coincide con un resultado, pero es un precio GUARDADO (pasó el tiempo de la
 *   caché y el plan llegó a su uso justo de búsquedas en vivo): se muestra con su fecha, nunca como
 *   "en vivo".
 */
export type EstadoDato = "CONSULTADO_EN_VIVO" | "NO_VERIFICADO" | "SOLICITUD_HUMANA" | "OBSOLETO";

/** Botón de una card: cómo llegar, pedir un Uber, llamar, sitio o reservar. Solo https: o tel:. */
/** "tickets" = sitio de venta de boletos de un evento (Google Events o Ticketmaster): abrirlo no es una compra. */
/** "whatsapp" = click to chat oficial (wa.me) con el número internacional que dio Google. */
export interface CardLink { kind: "directions" | "ride" | "call" | "website" | "maps" | "booking" | "tickets" | "whatsapp"; label: string; url: string }

export interface ConciergeCard {
  type: CardType;
  title: string;
  subtitle?: string;
  meta?: string;
  body?: string;
  cta_label?: string;
  cta_action?: string;
  image_url?: string;
  provider?: string;
  from?: string;
  to?: string;
  route?: string;
  fbo?: string;
  status?: string;
  rating?: number;
  price?: number;
  price_usd?: number;
  currency?: string;
  fuente?: string;
  estado_dato?: EstadoDato;
  consultado_at?: string;
  price_note?: string;
  /**
   * Base del precio, la pone SOLO el servidor según el campo del resultado que coincidió
   * (AUD-IATO-05): "por persona", "total", "por noche · con impuestos", "total de la estancia · sin
   * impuestos"… Antes la pantalla decía "total" aunque el modelo hubiera copiado el precio por persona.
   */
  price_basis?: string;
  links?: CardLink[];
  /** Foto real del lugar (Google Places), tomada de la herramienta de este turno, no del modelo. */
  photo_ref?: string;
  /** place_id de Google del lugar (de la herramienta): la app pide su foto real con él. */
  place_id?: string;
  /** Coordenadas del lugar (de la herramienta, nunca del modelo): botón "Llévame". */
  lat?: number;
  lng?: number;
  /** Evento: dirección del recinto (de Google Events) para "Llévame" con la URL oficial de Maps. */
  address?: string;
  /** Evento: fecha (YYYY-MM-DD) y hora (HH:MM) leídas de Google Events, si venían. */
  event_date?: string;
  event_time?: string;
  /**
   * Restaurante: "No toma reservaciones (llega directo)" si Google dice reservable=false.
   * Museo de la tabla oficial: su nota oficial ("Reserva obligatoria…"). Lo pone SOLO el servidor.
   */
  booking_note?: string;
}

/** Solo https: (nada de javascript:, data:, http:, ni URLs con usuario/contraseña). */
export function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s || s.length > 2048) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

// ═══ Resultados de herramientas → lo que ve el modelo (B-03) ═══

const AI_SOURCE = /^(ai|ia|ai[-_ ]?fallback|ia[-_ ]?fallback|estimad[oa]|estimate[ds]?|llm|gemini|modelo)$/i;
export const isAiSource = (v: unknown) => typeof v === "string" && AI_SOURCE.test(v.trim());

const ESTIMATE_KEYS = new Set(["estimate", "estimates", "estimado", "estimados", "ai_estimate", "estimacion"]);

const itemSource = (x: any) => x?.source ?? x?.fuente ?? x?.fuente_precio ?? x?.provider;

/** Quita de listas los elementos marcados como estimación de IA y las llaves de estimado. */
function dropAiItems(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((x) => !(x && typeof x === "object" && isAiSource(itemSource(x)))).map(dropAiItems);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !ESTIMATE_KEYS.has(k.toLowerCase()))
      .map(([k, v]) => [k, dropAiItems(v)]));
  }
  return value;
}

const SEARCH_TOOLS = new Set(["search_flights", "search_hotels", "search_attractions", "search_nearby", "search_places", "web_search", "search_members_venues", "search_events", "search_tours"]);

export interface ToolUnavailable { disponible: false; motivo: string; fuente?: string; error?: string }

/**
 * Prepara un resultado de herramienta para el modelo: si vino de la estimación de IA
 * (source "ai-fallback") o vacío, el modelo recibe una nota explícita {disponible:false, motivo}
 * y NUNCA las opciones inventadas. Los textos de terceros se neutralizan.
 */
/** Por qué no hubo búsqueda en vivo, en palabras honestas para el usuario. */
export function pauseMotivo(pausa: string): string {
  if (pausa === "plan") return "Se alcanzó el límite de búsquedas en vivo del plan del usuario: dilo así.";
  if (pausa === "quota") return "Alcanzamos el límite de búsquedas en vivo de IATOS por ahora: dilo así (no digas que el servicio no respondió) y sugiere intentarlo más tarde, el enlace directo de la fuente o una persona del equipo.";
  return "Hoy alcanzamos el límite de búsquedas en vivo de IATOS: dilo así (no digas que el servicio no respondió) y sugiere intentarlo mañana, el enlace directo de la fuente o una persona del equipo.";
}

export const LIMIT_MOTIVO_PREFIX = "Límite de búsquedas en vivo del plan del usuario";

export function prepareToolResultForModel(name: string, raw: unknown): Record<string, unknown> {
  const r = raw as any;
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    return { disponible: false, motivo: "El proveedor no devolvió datos." } satisfies ToolUnavailable;
  }
  // El plan del usuario ya no permite búsquedas en vivo (tope duro o uso justo sin precio guardado):
  // se le dice tal cual, sin presentarlo como falla del proveedor.
  if (r.code === "FREE_LIMIT_REACHED" || r.limite_uso_justo === true) {
    const detalle = typeof r.message === "string" ? r.message : typeof r.motivo === "string" ? r.motivo : "";
    return { disponible: false, estado: "limite_del_plan", error: "limite_del_plan", motivo: `${LIMIT_MOTIVO_PREFIX}. ${detalle}`.trim().slice(0, 400) };
  }
  if (r.code === "MEMBERS_PRO_REQUIRED") {
    return { disponible: false, estado: "sin_acceso", motivo: "Members Only es de IATOS PRO: dilo así y no menciones lugares de esa selección." };
  }
  // Viator sin llave o con la llave aún no habilitada (401/403): se dice tal cual, sin inventar tours.
  if (r.code === "viator_no_disponible") {
    return { disponible: false, estado: "no_disponible", error: "viator_no_disponible", motivo: "Los tours de Viator aún no están disponibles en IATOS: dilo así y sugiere buscar directo en Viator. No inventes tours ni precios." };
  }
  if (r.error === "timeout") {
    return { disponible: false, estado: "no_respondio", error: "timeout", motivo: "El servicio tardó demasiado en responder; no hay datos en vivo ahora." };
  }
  // Tope de búsquedas en vivo de IATOS (SERPAPI_DAILY_BUDGET) o cuota de la cuenta agotada: no es que
  // el servicio "no respondió" (auditoría 10 #5 y #6). Se dice tal cual.
  const pausa = r.error === "busquedas_en_pausa" || r.error === "serpapi_paused" ? String(r.pausa ?? r.reason ?? "budget")
    : r.busquedas_en_pausa === true && !Object.values(r).some((v) => Array.isArray(v) && v.length > 0) ? String(r.pausa ?? "budget")
    : null;
  if (pausa) return { disponible: false, estado: "limite_diario", error: "busquedas_en_pausa", motivo: pauseMotivo(pausa) };
  if (name === "search_events" && Array.isArray(r.results) && r.results.length === 0 && typeof r.respaldo_en_pausa === "string") {
    return {
      disponible: false, estado: "limite_diario", fuente: "ticketmaster",
      motivo: `Ticketmaster no trajo eventos para esas fechas y la búsqueda de respaldo (Google Events) no se hizo: ${pauseMotivo(r.respaldo_en_pausa).charAt(0).toLowerCase()}${pauseMotivo(r.respaldo_en_pausa).slice(1)}`,
    };
  }
  if (r.error === "no_configurado") {
    return { disponible: false, estado: "no_respondio", error: "no_configurado", motivo: "Esta búsqueda no está disponible en este momento." };
  }
  if (r.error || r.ok === false) {
    // Clima y búsqueda web: sin datos no hay cifras (E2E 28-oct-2026: "no respondió" y luego "13–15 °C").
    const noGuess = name === "get_weather" || name === "web_search";
    const motivo = noGuess
      ? `${typeof r.motivo === "string" && r.motivo ? r.motivo.slice(0, 300) : "El servicio no respondió; no hay datos en vivo ahora."} No des cifras ni datos de memoria: dilo así.`
      : "El servicio no respondió; no hay datos en vivo ahora.";
    return { disponible: false, estado: "no_respondio", error: String(r.error ?? "error").slice(0, 160), motivo };
  }
  if (isAiSource(r.source) || isAiSource(r.provider)) {
    return {
      disponible: false,
      estado: "no_respondio",
      fuente: "ai-fallback",
      motivo: "La búsqueda en vivo no está disponible ahora. El proveedor solo devolvió estimaciones de IA y no se pueden mostrar como opciones reales.",
    };
  }
  const cleaned = dropAiItems(r) as Record<string, unknown>;
  if (SEARCH_TOOLS.has(name)) {
    const lists = Object.values(cleaned).filter(Array.isArray) as unknown[][];
    if (!lists.some((l) => l.length > 0)) {
      return { disponible: false, estado: "sin_resultados", fuente: typeof r.source === "string" ? r.source : undefined, motivo: "La búsqueda funcionó pero no trajo resultados para esos datos." };
    }
  }
  const out: Record<string, unknown> = {
    disponible: true,
    estado: "ok",
    // Listas de lugares: más espacio (≥6 lugares con su foto; auditoría 10 #3).
    ...(slimToolResult(neutralizeDeep(cleaned, 400), PLACE_LIST_TOOLS.has(name) ? PLACE_LIST_MAX_CHARS : undefined) as Record<string, unknown>),
  };
  if (name === "web_search" && r.source === "wikipedia") {
    out.nota_fuente = typeof r.nota_fuente === "string" ? r.nota_fuente : "Respaldo de Wikipedia: información general, dilo así.";
  } else if ((r.precio_guardado === true || r.estado_dato === "OBSOLETO") && name === "web_search") {
    out.nota_fuente = `Resultados guardados (consultados ${typeof r.consulted_at === "string" ? r.consulted_at : "antes"}), no de este momento: dilo así.`;
  } else if (r.precio_guardado === true || r.estado_dato === "OBSOLETO") {
    const at = typeof r.consulted_at === "string" ? r.consulted_at : "fecha desconocida";
    out.nota_fuente = `Precios GUARDADOS (consultados ${at}), no en vivo, por el uso justo de búsquedas del plan: dilo así y sugiere verificarlos antes de reservar.`;
  } else if (r.frescura === "cache" && typeof r.etiqueta_frescura === "string") {
    // Vigente, pero de la caché: nunca "en vivo" (E2E 23-oct).
    out.nota_fuente = `Precios de una búsqueda reciente guardada (${r.etiqueta_frescura.toLowerCase()}), no de este momento: no digas "en vivo"; di cuándo se consultaron.`;
  }
  // Eventos: solo los primeros por fecha (events.ts → partialNote); la nota es nuestra, no de terceros.
  if (name === "search_events" && r.parcial === true && typeof r.nota === "string") out.nota_resultados = r.nota.slice(0, 400);
  if (name === "check_flight_status" && (r.provider === "perplexity" || r?.data?.fuente === "perplexity")) {
    out.nota_fuente = "Dato obtenido de una búsqueda web, no del sistema de la aerolínea: dilo así y sugiere confirmar con la aerolínea.";
  }
  return out;
}

// ═══ Evidencia de este turno ═══

export interface ToolRun { name: string; args?: Record<string, unknown>; result: Record<string, unknown> }

export interface Evidence {
  /** at = cuándo se consultó de verdad (caché incluida); stale = precio guardado (OBSOLETO). */
  prices: {
    tool: string; value: number; currency: string; source: string; at?: string; stale?: boolean;
    /** Campo del resultado (price_per_person_usd, nightly_usd…): de ahí sale la base del precio. */
    key?: string;
    /** Opción a la que pertenece el precio (nombre del hotel, aerolínea), normalizada (AUD-IATO-04). */
    item?: string;
    /** Vuelos: enlace de compra de ESA opción en la fuente que dio el precio (buy_url de flights-search). */
    buyUrl?: string;
    /** Vuelos: ¿la búsqueda fue ida y vuelta? (false = solo se consultó la ida). */
    roundTrip?: boolean;
  }[];
  ratings: { tool: string; value: number }[];
  available: Record<string, boolean>;
  unavailable: Record<string, string>;
  /** estado de cada herramienta que no trajo datos: sin_resultados | no_respondio | limite_del_plan. */
  unavailableState: Record<string, string>;
  /** Lugares devueltos por Google Maps / cercanos (para enlaces de cómo llegar, Uber y llamar). */
  places: EvidencePlace[];
  /** Enlaces devueltos por web_search (solo esos pueden ir en una card "source"). */
  webLinks: Set<string>;
  /** Experiencias Privé mostradas en este turno (solo esas se pueden solicitar). */
  priveIds: Set<string>;
  /** Nombres del catálogo Privé (curado, con fuente) que trajo search_prive en este turno. */
  priveNames?: string[];
  /** Dominios de los enlaces https que trajeron las herramientas de este turno (sin "www."). */
  hosts: string[];
}

/** Dominios propios de IATOS: un enlace a ellos no necesita respaldo de una herramienta. */
export const FIRST_PARTY_HOSTS = ["traveliatos.life"];

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * Un enlace del modelo solo se muestra si su dominio salió de una herramienta de este turno (o es
 * de IATOS). Evita que el modelo invente un dominio parecido a la marca (p. ej. "iatos.ai", que ni
 * existe y cualquiera podría registrar) y lo ponga como botón "Solicitar".
 */
export function hostBacked(url: string, ev: Pick<Evidence, "hosts">): boolean {
  let host: string;
  try { host = bareHost(new URL(url).hostname); } catch { return false; }
  const known = [...FIRST_PARTY_HOSTS, ...(ev.hosts ?? [])].map(bareHost);
  return known.some((k) => host === k || host.endsWith(`.${k}`));
}

export interface EvidencePlace {
  name: string; address?: string; lat?: number; lng?: number; placeId?: string; phone?: string;
  website?: string; mapsUrl?: string; rating?: number; openNow?: boolean | null; hours?: string[];
  /** Nombre de la primera foto de Google Places ("places/…/photos/…"). */
  photoRef?: string;
  /** internationalPhoneNumber de Google (WhatsApp solo con él). */
  phoneIntl?: string;
  /** reservable de Google (true / false / sin dato). */
  reservable?: boolean | null;
  /** Ciudad con la que se buscó (argumento city de search_places): TheFork y taquilla oficial. */
  city?: string;
}

const normName = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function collectPlaces(tool: string, res: Record<string, unknown>, out: EvidencePlace[], city?: string) {
  if (!["search_places", "search_nearby", "search_attractions", "search_members_venues"].includes(tool)) return;
  const lists: unknown[] = [];
  for (const v of Object.values(res)) if (Array.isArray(v)) lists.push(...v);
  if (res.details && typeof res.details === "object") lists.unshift(res.details);
  for (const x of lists) {
    const o = x as Record<string, any>;
    const name = typeof o?.name === "string" ? o.name : typeof o?.nombre === "string" ? o.nombre : "";
    if (!name) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const lat = num(o.lat ?? o.latitude ?? o.gps_coordinates?.latitude);
    const lng = num(o.lng ?? o.longitude ?? o.gps_coordinates?.longitude);
    const entry: EvidencePlace = {
      name, address: typeof (o.address ?? o.formatted_address) === "string" ? (o.address ?? o.formatted_address) : undefined,
      lat, lng, placeId: typeof (o.id ?? o.place_id) === "string" ? (o.id ?? o.place_id) : undefined,
      phone: typeof o.phone === "string" ? o.phone : undefined,
      website: safeHttpsUrl(o.website), mapsUrl: safeHttpsUrl(o.maps_url ?? o.google_maps_url ?? o.web_url ?? o.url),
      rating: num(o.rating), openNow: typeof o.open_now === "boolean" ? o.open_now : null,
      hours: Array.isArray(o.opening_hours) ? o.opening_hours.map(String).slice(0, 7) : undefined,
      photoRef: isPhotoRef(o.photo_ref) ? o.photo_ref : undefined,
      phoneIntl: typeof o.phone_international === "string" ? o.phone_international : undefined,
      reservable: typeof o.reservable === "boolean" ? o.reservable : undefined,
      city,
    };
    // El mismo lugar en la búsqueda y en el detalle: se combinan (el detalle trae teléfono y horario).
    const same = out.find((x) => normName(x.name) === normName(name));
    if (same) {
      for (const [k, v] of Object.entries(entry)) if (v !== undefined && v !== null && (same as any)[k] == null) (same as any)[k] = v;
    } else out.push(entry);
  }
}

/** Lugar de la evidencia que corresponde al título de una card (mismo nombre normalizado o contenido). */
export function matchPlace(title: string, places: EvidencePlace[]): EvidencePlace | null {
  const t = normName(title);
  if (t.length < 3) return null;
  return places.find((p) => normName(p.name) === t)
    ?? places.find((p) => { const n = normName(p.name); return n.length >= 4 && (t.includes(n) || n.includes(t)); })
    ?? null;
}

/** Campos que nombran una opción de un resultado (en orden de preferencia). */
const ITEM_LABEL_KEYS = ["name", "nombre", "title", "airline", "aerolinea", "hotel"];

/** ¿El título de la card nombra esa opción? (mismo nombre normalizado o uno contiene al otro). */
export function sameItemName(title: string, item: string): boolean {
  const t = normName(title);
  if (!t || !item) return false;
  return t === item || (item.length >= 3 && t.includes(item)) || (t.length >= 3 && item.includes(t));
}

/**
 * Base del precio según el campo del resultado que coincidió (AUD-IATO-05). Google Hotels da la
 * tarifa con impuestos y cargos; *_before_taxes_* es antes de impuestos. Google Flights da el total
 * del grupo (price_usd) y el precio por persona (price_per_person_usd).
 */
export function priceBasis(tool: string, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const k = key.toLowerCase();
  const sinImpuestos = /before_tax|antes_de_impuestos|sin_impuestos/.test(k);
  const taxes = sinImpuestos ? " · sin impuestos" : tool === "search_hotels" ? " · con impuestos" : "";
  if (/per_person|por_persona|(^|_)pp(_|$)/.test(k)) return `por persona${taxes}`;
  if (/nightly|per_night|por_noche/.test(k)) return `por noche${taxes}`;
  if (tool === "search_hotels" && /total/.test(k)) return `total de la estancia${taxes}`;
  if (tool === "search_flights") return `total${taxes}`;
  return undefined;
}

const PRICE_KEY = /(^|_)(price|precio|nightly|total|amount|rate|tarifa|costo|cost)(_|$)|_usd$/i;
const RATING_KEY = /^(rating|overall_rating|calificacion)$/i;

const DEFAULT_SOURCE: Record<string, string> = {
  search_flights: "serpapi",
  search_hotels: "serpapi",
  search_attractions: "tripadvisor",
  search_nearby: "google_maps",
  check_flight_status: "serpapi",
};

export function collectEvidence(runs: ToolRun[]): Evidence {
  const ev: Evidence = { prices: [], ratings: [], available: {}, unavailable: {}, hosts: [], unavailableState: {}, places: [], webLinks: new Set(), priveIds: new Set() };
  const hosts = new Set<string>();
  const addHost = (v: string) => {
    if (!/^https:\/\//i.test(v)) return;
    const u = safeHttpsUrl(v);
    if (u) hosts.add(bareHost(new URL(u).hostname));
  };
  for (const run of runs) {
    const res = run.result ?? {};
    if (res.disponible === false) {
      if (!ev.available[run.name]) {
        ev.unavailable[run.name] = String(res.motivo ?? "no disponible");
        ev.unavailableState[run.name] = String(res.estado ?? (/no trajo resultados/.test(String(res.motivo ?? "")) ? "sin_resultados" : "no_respondio"));
      }
      continue;
    }
    ev.available[run.name] = true;
    delete ev.unavailable[run.name];
    delete ev.unavailableState[run.name];
    collectPlaces(run.name, res, ev.places, typeof run.args?.city === "string" && run.args.city.trim() ? run.args.city.trim().slice(0, 80) : undefined);
    if (run.name === "web_search") {
      for (const r of Array.isArray(res.results) ? res.results : []) { const u = safeHttpsUrl((r as any)?.link); if (u) ev.webLinks.add(u); }
      const al = safeHttpsUrl((res.answer as any)?.link);
      if (al) ev.webLinks.add(al);
    }
    if (run.name === "search_prive") {
      for (const c of Array.isArray(res.cities) ? res.cities : []) for (const it of (c as any)?.items ?? []) if (typeof it?.id === "string") ev.priveIds.add(it.id);
      const names = (ev.priveNames ??= []);
      const items = [...(Array.isArray(res.results) ? res.results : []), ...(Array.isArray(res.cities) ? res.cities.flatMap((c: any) => c?.items ?? []) : [])];
      for (const it of items) { const n = (it as any)?.name ?? (it as any)?.nombre; if (typeof n === "string" && n.trim()) names.push(n); }
    }
    const topSource = typeof res.source === "string" ? res.source : DEFAULT_SOURCE[run.name] ?? run.name;
    const at = typeof res.consulted_at === "string" && Number.isFinite(Date.parse(res.consulted_at)) ? res.consulted_at : undefined;
    const stale = res.precio_guardado === true || res.estado_dato === "OBSOLETO";
    // Sentido de la búsqueda de vuelos: lo que dice flights-search (meta) o lo que pidió el modelo.
    const roundTrip = run.name === "search_flights" && (res.meta || run.args) ? !!((res.meta as any)?.return_date ?? run.args?.return_date) : undefined;
    const visit = (node: unknown, currency: string, source: string, depth: number, item?: string) => {
      if (depth > 8 || !node) return;
      if (typeof node === "string") { addHost(node); return; }
      if (typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((n) => visit(n, currency, source, depth + 1, item)); return; }
      const obj = node as Record<string, unknown>;
      const cur = typeof obj.currency === "string" ? obj.currency.toUpperCase() : currency;
      const src = typeof obj.source === "string" && !isAiSource(obj.source) ? obj.source : source;
      // El precio pertenece a la opción más cercana que tiene nombre (hotel, aerolínea, lugar).
      const label = ITEM_LABEL_KEYS.map((k) => obj[k]).find((v) => typeof v === "string" && v.trim());
      const own = typeof label === "string" ? normName(label) || item : item;
      const buyUrl = run.name === "search_flights" ? safeHttpsUrl(obj.buy_url) : undefined;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          if (PRICE_KEY.test(k)) ev.prices.push({ tool: run.name, value: v, currency: /_usd$/i.test(k) ? "USD" : cur, source: src, key: k, ...(own ? { item: own } : {}), ...(at ? { at } : {}), ...(stale ? { stale } : {}),
            ...(buyUrl ? { buyUrl } : {}), ...(roundTrip !== undefined ? { roundTrip } : {}) });
          else if (RATING_KEY.test(k)) ev.ratings.push({ tool: run.name, value: v });
        } else if (typeof v === "string" && /^https:\/\//i.test(v)) {
          addHost(v);
        } else if (typeof v === "string" && RATING_KEY.test(k) && Number.isFinite(Number(v)) && Number(v) > 0) {
          // TripAdvisor devuelve el rating como texto ("4.5").
          ev.ratings.push({ tool: run.name, value: Number(v) });
        } else if (v && typeof v === "object") visit(v, cur, src, depth + 1, own);
      }
    };
    visit(res, "USD", topSource, 0);
  }
  ev.hosts = [...hosts];
  return ev;
}

// Qué herramienta puede respaldar el precio de cada tipo de card.
const PRICE_TOOLS: Partial<Record<CardType, string[]>> = {
  flight: ["search_flights"],
  hotel: ["search_hotels"],
  attraction: ["search_attractions"],
  restaurant: ["search_attractions", "search_nearby", "search_places"],
  place: ["search_places", "search_nearby"],
  transport: [],
};

// Cards que muestran opciones de compra: sin una búsqueda disponible en este turno, eran inventadas.
const REQUIRES_TOOL: Partial<Record<CardType, string>> = { flight: "search_flights", hotel: "search_hotels" };

const str = (v: unknown, max: number) => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) ? n : undefined;
}

const approxEq = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);

const normCurrency = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(s) ? s : undefined;
};

export interface ValidationOutcome { cards: ConciergeCard[]; dropped: { type: string; reason: string }[] }

export const MAX_CARDS = 8;

/**
 * Valida y limpia las cards del modelo contra la evidencia de herramientas de ESTE turno.
 * - Descarta cards mal formadas o de tipos desconocidos.
 * - Solo deja URLs https.
 * - Un precio solo se muestra si coincide (±1 %) con un resultado real de la herramienta que
 *   corresponde, y entonces lleva su fuente. Si no, se quita y queda "precio no verificado".
 * - Jet y equipaje no tienen proveedor: nunca llevan precio; son solicitudes de cotización.
 * - Vuelo/hotel sin una búsqueda disponible en este turno se descarta (sería inventado).
 */
export function validateCards(raw: unknown, ev: Evidence, consultadoAt: string = new Date().toISOString()): ValidationOutcome {
  const out: ValidationOutcome = { cards: [], dropped: [] };
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (out.cards.length >= MAX_CARDS) { out.dropped.push({ type: "?", reason: "demasiadas" }); continue; }
    if (!item || typeof item !== "object" || Array.isArray(item)) { out.dropped.push({ type: "?", reason: "mal_formada" }); continue; }
    const r = item as Record<string, unknown>;
    const type = String(r.type ?? "").toLowerCase() as CardType;
    if (!CARD_TYPES.includes(type)) { out.dropped.push({ type: String(r.type ?? "?"), reason: "tipo_desconocido" }); continue; }
    const title = str(r.title, 140);
    if (!title) { out.dropped.push({ type, reason: "sin_titulo" }); continue; }
    // Eventos: solo los arma IATOS con los resultados de search_events (eventCards); uno escrito por el
    // modelo podría ser inventado.
    if (type === "event") { out.dropped.push({ type, reason: "evento_solo_de_la_busqueda" }); continue; }
    // Tours de Viator: igual, solo los arma IATOS con search_tours (tourCards).
    if (type === "tour") { out.dropped.push({ type, reason: "tour_solo_de_la_busqueda" }); continue; }
    const needTool = REQUIRES_TOOL[type];
    if (needTool && !ev.available[needTool]) { out.dropped.push({ type, reason: "sin_respaldo_de_busqueda" }); continue; }
    // Restaurante: el nombre tiene que salir de una búsqueda de lugares de ESTE turno (Google Maps,
    // cercanos, atracciones, Members Only o el catálogo Privé). Si no, era un nombre escrito por el modelo: no se muestra
    // (auditoría de lugares reales, 23-oct-2026).
    if (type === "restaurant" && !matchPlace(title, ev.places) && !matchPlace(title, (ev.priveNames ?? []).map((name) => ({ name })))) {
      out.dropped.push({ type, reason: "lugar_sin_respaldo" }); continue;
    }

    const card: ConciergeCard = { type, title };
    const opt = (key: keyof ConciergeCard, max: number) => {
      const v = str(r[key as string], max);
      if (v) (card as any)[key] = v;
    };
    opt("subtitle", 160); opt("meta", 200); opt("cta_label", 40); opt("provider", 60);
    opt("from", 120); opt("to", 120); opt("route", 120); opt("fbo", 120); opt("status", 160);
    if (type === "alert") {
      const body = str(r.body, 600);
      if (!body) { out.dropped.push({ type, reason: "alerta_sin_texto" }); continue; }
      card.body = body;
    }
    if (type === "place" || type === "source") {
      const body = str(r.body ?? r.snippet, 500);
      if (body) card.body = body;
    }
    // Enlaces: https y con un dominio que salió de una herramienta de este turno (o de IATOS).
    const cta = safeHttpsUrl(r.cta_action);
    if (cta && hostBacked(cta, ev)) card.cta_action = cta;
    // Fuente web: el enlace tiene que ser uno de los resultados de web_search de este turno.
    if (type === "source") {
      if (!cta || !ev.webLinks.has(cta)) { out.dropped.push({ type, reason: "fuente_sin_respaldo" }); continue; }
      try { card.subtitle = card.subtitle ?? new URL(cta).hostname.replace(/^www\./, ""); } catch { /* ya validada */ }
    }
    const img = safeHttpsUrl(r.image_url);
    if (img && hostBacked(img, ev)) card.image_url = img;

    const rating = toNumber(r.rating);
    if (rating !== undefined && rating > 0 && rating <= 10 && ev.ratings.some((x) => Math.abs(x.value - rating) < 0.05)) {
      card.rating = rating;
    }

    if (type === "jet" || type === "luggage") {
      // No existe proveedor de jets ni de equipaje conectado: es una solicitud a un humano.
      card.estado_dato = "SOLICITUD_HUMANA";
      card.cta_label = "Solicitar cotización";
      delete card.cta_action;
      out.cards.push(card);
      continue;
    }

    const price = toNumber(r.price ?? r.price_usd);
    if (price !== undefined && price > 0) {
      const currency = normCurrency(r.currency) ?? "USD";
      const tools = PRICE_TOOLS[type] ?? [];
      // AUD-IATO-04: el precio tiene que ser de LA opción que nombra la card, no de otra del mismo
      // resultado (antes "Air France" con el precio de Iberia salía "consultado en vivo"). Un precio
      // sin opción con nombre (nivel superior del resultado) se sigue aceptando.
      const match = ev.prices.find((p) => tools.includes(p.tool) && p.currency === currency && approxEq(p.value, price)
        && (!p.item || sameItemName(title, p.item)));
      if (match) {
        card.price = price;
        if (currency === "USD") card.price_usd = price;
        card.currency = currency;
        card.fuente = match.source;
        // Fecha real de la consulta (si salió de la caché compartida, la de esa consulta).
        card.estado_dato = match.stale ? "OBSOLETO" : "CONSULTADO_EN_VIVO";
        card.consultado_at = match.at ?? consultadoAt;
        if (match.stale) card.price_note = "precio guardado";
        const basis = priceBasis(match.tool, match.key);
        if (basis) card.price_basis = basis;
        if (type === "flight") flightFromSameSource(card, match);
      } else {
        card.estado_dato = "NO_VERIFICADO";
        card.price_note = "precio no verificado";
      }
    }
    out.cards.push(card);
  }
  return out;
}

/**
 * Vuelo con precio de una búsqueda (caso CDMX → Tokio, 23-oct-2026): el precio era de Google Flights y
 * el botón llevaba a una búsqueda genérica de Aviasales, y la card decía "ida y vuelta" sin que se
 * consultara el regreso. El botón es el de la MISMA fuente y opción que dio el precio; "ida y vuelta"
 * no se afirma: solo ida → "solo ida"; ida y vuelta → el precio es ida y vuelta pero los horarios son
 * de la ida (lo dice la base del precio, no el itinerario).
 */
function flightFromSameSource(card: ConciergeCard, match: Evidence["prices"][number]) {
  if (match.buyUrl) card.cta_action = match.buyUrl;
  const claims = /\b(?:ida y vuelta|redondo)\b/i;
  if (match.roundTrip === undefined || !(claims.test(card.subtitle ?? "") || claims.test(card.meta ?? ""))) return;
  const fix = (v: string | undefined) => {
    if (!v) return v;
    const out = match.roundTrip ? v.replace(/\b(?:ida y vuelta|redondo)\b\s*/gi, "") : v.replace(/\b(?:ida y vuelta|redondo)\b/gi, "solo ida");
    return out.replace(/\s{2,}/g, " ").replace(/\s*·\s*$/, "").trim() || undefined;
  };
  card.subtitle = fix(card.subtitle);
  card.meta = fix(card.meta);
  if (!card.subtitle) delete card.subtitle;
  if (!card.meta) delete card.meta;
  const basis = card.price_basis ?? "total";
  card.price_basis = match.roundTrip ? `${basis} ida y vuelta · horarios de la ida` : `${basis} · solo ida`;
}

/**
 * Texto de Iato: si el precio de un vuelo salió de Google Flights y el texto manda a comprar a
 * Aviasales, se dice que es otra búsqueda y que el precio puede variar; si solo se buscó la ida, el
 * texto no dice "ida y vuelta".
 */
export function enforceFlightSellerHonesty(text: string, ev: Pick<Evidence, "prices">): string {
  const flights = ev.prices.filter((p) => p.tool === "search_flights");
  if (!flights.length) return text;
  let out = text;
  if (flights.every((p) => p.roundTrip === false)) out = out.replace(/\bida y vuelta\b/gi, "solo ida");
  const fromGoogle = flights.some((p) => p.buyUrl && /(^|\.)google\.com$/.test(new URL(p.buyUrl).hostname.replace(/^www\./, "")));
  if (fromGoogle && /aviasales/i.test(out) && !/precio puede variar/i.test(out)) {
    out = `${out.trim()}\n\nEl precio es de Google Flights y el botón te lleva ahí. Aviasales es una búsqueda alternativa: el precio puede variar.`;
  }
  return out;
}

const TOOL_LABEL: Record<string, string> = {
  search_flights: "vuelos",
  search_hotels: "hoteles",
  search_attractions: "lugares",
  search_nearby: "lugares cercanos",
  search_places: "Google Maps",
  web_search: "Google",
  check_flight_status: "estado del vuelo",
  search_members_venues: "Members Only",
  get_weather: "clima",
};

const ALREADY_HONEST = /no (est[aá]|esta) disponible|no disponible|no (pude|pudimos|logr[eé]|tengo|hay)|sin resultados|no (encontr|tra)|no (me )?respondi|fuera de servicio|no se pudo|l[ií]mite de b[uú]squedas/i;

/**
 * Si una búsqueda de este turno no trajo datos y el texto del modelo no lo dice, se antepone una frase
 * honesta que distingue los casos: no encontró resultados / el servicio no respondió / límite del plan.
 */
export function enforceAvailabilityHonesty(text: string, ev: Evidence): string {
  const missing = Object.keys(ev.unavailable).filter((t) => TOOL_LABEL[t] && !ev.available[t]);
  if (!missing.length || ALREADY_HONEST.test(text)) return text;
  const state = (t: string) => ev.unavailableState?.[t] ?? (/no trajo resultados/.test(ev.unavailable[t]) ? "sin_resultados" : "no_respondio");
  const names = (list: string[]) => list.map((t) => TOOL_LABEL[t]).join(" y ");
  const limit = missing.filter((t) => state(t) === "limite_del_plan" || ev.unavailable[t].startsWith(LIMIT_MOTIVO_PREFIX));
  const empty = missing.filter((t) => !limit.includes(t) && state(t) === "sin_resultados");
  const estimate = missing.filter((t) => !limit.includes(t) && !empty.includes(t) && /estimaciones/.test(ev.unavailable[t]));
  const noAccess = missing.filter((t) => state(t) === "sin_acceso");
  const down = missing.filter((t) => !limit.includes(t) && !empty.includes(t) && !estimate.includes(t) && !noAccess.includes(t));
  const lines: string[] = [];
  if (noAccess.length) lines.push(`${names(noAccess)} es parte de IATOS PRO, así que no te muestro esa selección.`);
  if (estimate.length) lines.push(`La búsqueda en vivo de ${names(estimate)} no está disponible en este momento (solo hubo estimaciones), así que no te muestro opciones como si fueran reales.`);
  if (limit.length) lines.push(`Llegaste al límite de búsquedas en vivo de tu plan para ${names(limit)}, así que no te muestro opciones como si fueran reales.`);
  if (empty.length) lines.push(`La búsqueda de ${names(empty)} no encontró resultados, así que no te muestro opciones inventadas.`);
  if (down.length) lines.push(`El servicio de ${names(down)} no respondió en este momento, así que no te muestro datos como si fueran reales.`);
  return `${lines.join(" ")} ${text}`.trim();
}

/** place_id de Google ("ChIJ…"); los id de Members Only son UUID y no sirven para pedir su foto. */
export { isGooglePlaceId };

const telUrl = (phone: string | undefined) => {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : undefined;
};

/** Enlace seguro de una card: https (sin usuario/contraseña) o tel:. */
export function safeCardLink(l: unknown): CardLink | null {
  const o = l as Partial<CardLink> | null;
  const kinds: CardLink["kind"][] = ["directions", "ride", "call", "website", "maps", "booking", "tickets", "whatsapp"];
  if (!o || !kinds.includes(o.kind as CardLink["kind"]) || typeof o.label !== "string") return null;
  const url = o.kind === "call" ? (typeof o.url === "string" && /^tel:\+?\d{7,15}$/.test(o.url) ? o.url : undefined)
    : o.kind === "whatsapp" ? (typeof o.url === "string" && /^https:\/\/wa\.me\/\d{7,15}$/.test(o.url) ? o.url : undefined)
    : safeHttpsUrl(o.url);
  if (!url) return null;
  return { kind: o.kind as CardLink["kind"], label: o.label.slice(0, 40), url };
}

/**
 * Botones de cada card a partir de la EVIDENCIA (nunca del texto del modelo): cómo llegar, Uber,
 * llamar, sitio y reservar. Un restaurante sin socio conectado recibe el mejor camino honesto:
 * sitio del lugar, búsqueda prellenada en OpenTable y su ficha de Google Maps.
 */
export function enrichCardLinks(
  cards: ConciergeCard[], ev: Evidence,
  builders: {
    directions: (p: { lat?: number; lng?: number; name?: string; address?: string; placeId?: string }) => string;
    ride: (p: { lat?: number; lng?: number; name?: string; address?: string }) => string;
    booking: (v: { name: string; city?: string; website?: string; mapsUrl?: string; date?: string; party?: number; address?: string; phone?: string; phoneIntl?: string; reservable?: boolean | null }) => CardLink[];
  },
  ctx: { date?: string; party?: number; city?: string } = {},
): ConciergeCard[] {
  return cards.map((c) => {
    const keep = (c.links ?? []).map(safeCardLink).filter(Boolean) as CardLink[];
    if (!["restaurant", "attraction", "place", "hotel"].includes(c.type)) return keep.length ? { ...c, links: keep } : c;
    const p = matchPlace(c.title, ev.places);
    const links: CardLink[] = [...keep];
    const add = (l: CardLink | null) => { if (l && !links.some((x) => x.kind === l.kind)) links.push(l); };
    if (p && (p.lat !== undefined || p.address)) {
      const target = { lat: p.lat, lng: p.lng, name: p.name, address: p.address, placeId: p.placeId };
      add({ kind: "directions", label: "Cómo llegar", url: builders.directions(target) });
      add({ kind: "ride", label: "Pedir Uber", url: builders.ride(target) });
    }
    const out: ConciergeCard = { ...c };
    if (c.type === "restaurant") {
      // Orden de confianza (restaurantBooking.ts): su sitio → TheFork/OpenTable → Llamar → WhatsApp.
      // "Llévame" lo pone la pantalla con place_id o coordenadas.
      const booked = builders.booking({
        name: c.title, city: p?.city ?? ctx.city, website: p?.website, mapsUrl: p?.mapsUrl, date: ctx.date, party: ctx.party,
        address: p?.address, phone: p?.phone, phoneIntl: p?.phoneIntl, reservable: p?.reservable,
      });
      const ordered = booked.map(safeCardLink).filter(Boolean) as CardLink[];
      // "Llamar" con el número de Google aunque el armador de reservas no lo traiga.
      if (p?.phone && !ordered.some((l) => l.kind === "call")) {
        const t = telUrl(p.phone);
        if (t) ordered.splice(ordered.findIndex((l) => l.kind === "maps") >= 0 ? ordered.findIndex((l) => l.kind === "maps") : ordered.length, 0, { kind: "call", label: "Llamar", url: t });
      }
      // Los de reserva van primero (sitio, TheFork, llamar, WhatsApp); luego cómo llegar y Uber.
      links.splice(0, links.length, ...ordered, ...links.filter((l) => !ordered.some((x) => x.kind === l.kind)));
      if (p?.reservable === false) out.booking_note = NO_RESERVATIONS_NOTE;
    } else {
      if (p?.phone) { const t = telUrl(p.phone); if (t) add({ kind: "call", label: "Llamar", url: t }); }
      // Museo o monumento de la tabla oficial: "Boletos oficiales" + "Con guía o sin fila en Viator".
      const ticket = c.type === "attraction" || c.type === "place" ? matchOfficialTicket(c.title, p?.city ?? ctx.city) ?? matchOfficialTicket(c.title) ?? matchOfficialTicket(p?.name ?? "") : null;
      if (ticket) {
        links.unshift({ kind: "tickets", label: "Boletos oficiales", url: ticket.taquilla_url }, { kind: "booking", label: "Con guía o sin fila en Viator", url: viatorAlternativeUrl(ticket) });
        if (ticket.nota) out.booking_note = ticket.nota;
      }
      if (p?.website) add({ kind: "website", label: "Sitio oficial", url: p.website });
      if (p?.mapsUrl) add({ kind: "maps", label: "Ver en Google Maps", url: p.mapsUrl });
    }
    if (links.length) out.links = links.slice(0, 5);
    // Foto real del lugar: solo de la evidencia (la herramienta), nunca una que escriba el modelo.
    if (p?.photoRef && !out.image_url) out.photo_ref = p.photoRef;
    if (p?.placeId && isGooglePlaceId(p.placeId)) out.place_id = p.placeId;
    if (p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng)) { out.lat = p.lat; out.lng = p.lng; }
    if (p && c.type === "place") {
      if (!out.subtitle && p.address) out.subtitle = p.address.slice(0, 160);
      if (!out.meta && p.hours?.length) out.meta = p.hours.slice(0, 2).join(" · ").slice(0, 200);
      if (!out.cta_action && p.mapsUrl) { out.cta_action = p.mapsUrl; out.cta_label = out.cta_label ?? "Ver en Google Maps"; }
      out.fuente = out.fuente ?? "google_maps";
    }
    return out;
  });
}

// ═══ Event Radar: cards de eventos armadas con los resultados de search_events ═══

export const MAX_EVENT_CARDS = 4;

/**
 * Cards "event" deterministas: título, fecha y hora, recinto y dirección tal cual los trajo Google
 * Events en ESTE turno, con fuente y hora de consulta. Botones: "Boletos en {sitio}" (enlace de
 * ticket_info; es el sitio de boletos, no una compra). Nunca precio: Google Events no lo trae.
 * Ticketmaster (fuente primaria): "Boletos en Ticketmaster" con el `url` oficial, estado (En venta /
 * Agotado / fuera de venta), categoría, coordenadas del recinto y precio "desde" SOLO si vino priceRanges.
 */
export function eventCards(runs: ToolRun[], consultadoAt: string = new Date().toISOString()): ConciergeCard[] {
  const out: ConciergeCard[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.name !== "search_events" || run.result?.disponible === false) continue;
    const at = typeof run.result.consulted_at === "string" && Number.isFinite(Date.parse(run.result.consulted_at)) ? run.result.consulted_at : consultadoAt;
    for (const e of Array.isArray(run.result.results) ? run.result.results as Record<string, unknown>[] : []) {
      if (out.length >= MAX_EVENT_CARDS) return out;
      const title = str(e?.title, 140);
      if (!title) continue;
      const k = `${normName(title)}|${e?.fecha ?? ""}|${normName(str(e?.recinto, 120))}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const tm = e?.fuente === "ticketmaster";
      const links: CardLink[] = [];
      if (tm) {
        // Ticketmaster: el botón sale SOLO del campo `url` del evento y debe ser un dominio oficial.
        const v = checkAllowlisted(e?.url);
        if (v.ok && v.provider?.provider === "ticketmaster") links.push({ kind: "tickets", label: "Boletos en Ticketmaster", url: v.url! });
        else continue;
      } else {
        for (const t of Array.isArray(e?.boletos) ? e.boletos as Record<string, unknown>[] : []) {
          const url = safeHttpsUrl(t?.link);
          const fuente = str(t?.fuente, 28);
          if (url && fuente) links.push({ kind: "tickets", label: `Boletos en ${fuente}`, url });
        }
      }
      const card: ConciergeCard = { type: "event", title, fuente: tm ? "ticketmaster" : "google_events", consultado_at: at };
      if (tm) {
        card.status = e?.estado === "offsale" ? "Agotado / fuera de venta" : "En venta";
        const cat = str(e?.categoria, 60);
        if (cat) card.body = cat;
        const lat = Number(e?.lat), lng = Number(e?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) { card.lat = lat; card.lng = lng; }
        const p = e?.precio_desde as { amount?: unknown; currency?: unknown } | undefined;
        const amount = Number(p?.amount);
        if (p && Number.isFinite(amount) && amount > 0 && typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency)) {
          card.price = amount; card.currency = p.currency; card.price_note = "precio publicado por Ticketmaster · puede cambiar";
        }
      }
      const cuando = str(e?.cuando, 120);
      if (cuando) card.subtitle = cuando;
      const recinto = str(e?.recinto, 120);
      if (recinto) card.meta = recinto;
      const dir = str(e?.direccion, 200);
      if (dir) card.address = dir;
      if (typeof e?.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) card.event_date = e.fecha;
      if (typeof e?.hora === "string" && /^\d{2}:\d{2}$/.test(e.hora)) card.event_time = e.hora;
      const img = safeHttpsUrl(e?.miniatura);
      if (img) card.image_url = img;
      if (links.length) card.links = links;
      out.push(card);
    }
  }
  return out;
}

// ═══ Tours de Viator: cards armadas con los resultados de search_tours ═══

export const MAX_TOUR_CARDS = 4;

/**
 * Cards "tour" deterministas: título, foto, calificación, duración y precio "desde" con su moneda tal
 * cual los devolvió Viator en ESTE turno, con fuente y hora de consulta. Botón "Ver en Viator" =
 * productUrl con el afiliado de IATOS (solo viator.com/tours/… o viator.com/es-MX/tours/…, como en
 * _shared/viator.ts; caso E2E 28-oct-2026: Viator devuelve /es-MX/tours/ y se descartaban todas). No es una reserva.
 */
export function tourCards(runs: ToolRun[], consultadoAt: string = new Date().toISOString()): ConciergeCard[] {
  const out: ConciergeCard[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.name !== "search_tours" || run.result?.disponible === false) continue;
    const at = typeof run.result.consultado_at === "string" && Number.isFinite(Date.parse(run.result.consultado_at)) ? run.result.consultado_at : consultadoAt;
    for (const t of Array.isArray(run.result.results) ? run.result.results as Record<string, unknown>[] : []) {
      if (out.length >= MAX_TOUR_CARDS) return out;
      const title = str(t?.title, 140);
      const url = safeHttpsUrl(t?.url);
      let host = "";
      try { host = url ? new URL(url).hostname.toLowerCase() : ""; } catch { host = ""; }
      if (!title || !url || !(host === "viator.com" || host.endsWith(".viator.com")) || !/^https:\/\/[^/]+\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tours\//.test(url)) continue;
      const k = String(t?.codigo ?? normName(title));
      if (seen.has(k)) continue;
      seen.add(k);
      const card: ConciergeCard = { type: "tour", title, fuente: "viator", provider: "Viator", consultado_at: at, cta_label: "Ver en Viator", cta_action: url };
      const dur = str(t?.duracion, 40);
      if (dur) card.subtitle = dur;
      const rating = Number(t?.rating);
      if (Number.isFinite(rating) && rating > 0 && rating <= 5) card.rating = rating;
      const n = Number(t?.resenas);
      if (Number.isFinite(n) && n > 0) card.meta = `${Math.round(n).toLocaleString("es-MX")} reseñas`;
      const d = t?.desde as { monto?: unknown; moneda?: unknown } | undefined;
      const monto = Number(d?.monto);
      const moneda = typeof d?.moneda === "string" && /^[A-Z]{3}$/.test(d.moneda) ? d.moneda : "";
      if (Number.isFinite(monto) && monto > 0 && moneda) {
        card.price = monto;
        card.currency = moneda;
        card.price_basis = "desde";
        const mx = t?.desde_mxn as { monto?: unknown; fx_fuente?: unknown; fx_fecha?: unknown } | undefined;
        const m = Number(mx?.monto);
        if (moneda !== "MXN" && Number.isFinite(m) && m > 0) card.price_note = `≈ $${Math.round(m).toLocaleString("es-MX")} MXN · tipo de cambio ${str(mx?.fx_fuente, 60)} ${str(mx?.fx_fecha, 10)}`.trim();
      }
      const img = safeHttpsUrl(t?.foto);
      if (img) card.image_url = img;
      out.push(card);
    }
  }
  return out;
}

// ═══ Tours repetidos como "atracción" (auditoría 10 #4) ═══
// El modelo no puede escribir cards "tour" (las arma tourCards) y las reescribía como "attraction": los
// mismos tours salían dos veces y, si el título decía "Coliseo", además con "Boletos oficiales".

const TOUR_STOP = new Set(["tour", "tours", "roma", "con", "para", "privada", "privado", "experiencia", "desde", "clase", "visita", "guiada"]);
const tourWords = (v: unknown) => normName(v).split(" ").filter((w) => w.length > 3 && !TOUR_STOP.has(w));

/** Títulos de todos los tours que devolvió search_tours en este turno (no solo los que se muestran). */
export function tourTitlesOf(runs: ToolRun[]): string[] {
  const out: string[] = [];
  for (const r of runs) {
    if (r.name !== "search_tours" || r.result?.disponible === false) continue;
    for (const t of Array.isArray(r.result.results) ? r.result.results as Record<string, unknown>[] : []) {
      if (typeof t?.title === "string" && t.title.trim()) out.push(t.title);
    }
  }
  return out;
}

/** ¿Esta card "attraction"/"place" es uno de los tours de este turno? */
export function isTourDuplicate(card: Pick<ConciergeCard, "type" | "title">, tourTitles: string[], places: EvidencePlace[]): boolean {
  if (!tourTitles.length || (card.type !== "attraction" && card.type !== "place")) return false;
  // Un lugar real de Google con ese nombre no es un tour.
  const p = matchPlace(card.title, places);
  if (p && normName(p.name) === normName(card.title)) return false;
  // El museo o monumento de la tabla oficial ("Museos Vaticanos") es el lugar, no el tour que lo visita.
  const ticket = matchOfficialTicket(card.title);
  if (ticket) {
    const alias = new Set(ticket.aliases.flatMap((x) => tourWords(x)));
    if (tourWords(card.title).every((w) => alias.has(w))) return false;
  }
  const a = normName(card.title);
  const wa = tourWords(card.title);
  return tourTitles.some((t) => {
    const b = normName(t);
    if (a.length >= 8 && (b.includes(a) || a.includes(b))) return true;
    const wb = new Set(tourWords(t));
    if (!wa.length || !wb.size) return false;
    const shared = wa.filter((w) => wb.has(w)).length;
    return shared >= 2 && shared / Math.min(wa.length, wb.size) >= 0.6;
  });
}
