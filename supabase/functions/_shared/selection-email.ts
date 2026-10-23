// "Enviarme mi selección por correo": el correo con SOLO lo que la persona eligió en su viaje (vuelo,
// hotel de cada ciudad, experiencias, restaurantes y auto que marcó), cada cosa con su precio, su
// estado (en vivo / referencia / estimado), su botón de compra precargado (el mismo de "Comprar") y si
// ya la compró. Se manda solo cuando la persona lo pide (enviar-seleccion); al crear el viaje ya no
// sale ningún correo.
//
// Funciones puras (sin Deno ni red), probadas en src/test/selectionEmail.test.ts:
//   * priceStatusOf: estado del precio de una fila guardada (mismo criterio que src/lib/provenance.ts).
//   * validateSelectionRequest: el cliente arma la selección con las funciones de la página (buyFlow,
//     purchasePlan, cityHotels, computeTripDesglose) y aquí se comprueba contra la fila del viaje: cada
//     cosa existe, su precio sale de la tarifa guardada, los enlaces pasan la lista blanca del Booking
//     Bridge, "Ya lo compré" tiene marca y el total cuadra. Los nombres los pone el servidor.
//   * selectionEmail: HTML (estilos en línea, tablas, VML para Outlook) y texto plano.
//   * tripSendQuota: límite de envíos por viaje y por hora.
//
// Reglas: no hay filas "NO DISPONIBLE". Lo que no tiene precio no aparece; comida y transporte local
// sin precio van en una línea "Por cotizar". Un estimado nunca se presenta como precio en vivo.
import {
  button, callout, chip, type Email, eyebrow, gap, GLYPH, headline, hero, icon, masthead, normalizeSite, para,
  type Provenance, provenanceText, richCard, shell, signature, textFooter, joinText, totalBlock, tripPass, EK, LNUM, SANS, SERIF,
} from "./email-kit.ts";
import {
  escapeHtml, firstNameOf, formatAmount, formatDateMx, formatDateRange, formatMoney, formatTime, nightsBetween, oneLine,
  plural, safeUrl, sourceLabel,
} from "./email-format.ts";
import { checkAllowlisted } from "./booking/allowlist.ts";
import { isEstimatedTripFlight, isGroundTripOption } from "./booking/offers.ts";
import { cityStays, sameCity, tripDestinations } from "./booking/tripRoute.ts";
import { hotelPriceRooms } from "./rooms.ts";
import type { HitFn } from "./rate-limit-core.ts";

// ───────────────────────────── estado del precio ─────────────────────────────────────────────────

export type PriceStatus = "live" | "reference" | "estimate";
export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = { live: "en vivo", reference: "referencia", estimate: "estimado" };

/** Pasado este plazo un precio en vivo ya es de referencia (igual que LIVE_TTL_HOURS de la página). */
export const LIVE_TTL_H = 24;
const LIVE_SOURCES = new Set(["serpapi", "serpapi-hotels", "google_hotels", "google_flights"]);
const CACHED_SOURCES = new Set(["travelpayouts", "aviasales"]);

/**
 * Estado del precio de una fila de trips.*_json, con el mismo criterio que provenanceOf
 * (src/lib/provenance.ts): "en vivo" solo de un proveedor en vivo consultado hace menos de 24 h;
 * precio real de un proveedor que no es en vivo (caché de Aviasales o en vivo ya vencido) →
 * "referencia"; lo demás → "estimado".
 */
export function priceStatusOf(row: any, category: "vuelos" | "hospedaje" | "tours", fallbackAt: string | null | undefined, now: Date = new Date()): { status: PriceStatus; provenance: Provenance } {
  const src = String(row?.fuente_precio ?? row?.fuente ?? "").trim().toLowerCase();
  const estado = String(row?.estado_dato ?? "").trim().toUpperCase();
  const atRaw = row?.consultado_at ?? fallbackAt ?? null;
  const at = atRaw ? new Date(atRaw) : null;
  const fresh = !!at && Number.isFinite(at.getTime()) && now.getTime() - at.getTime() <= LIVE_TTL_H * 3600_000 && at.getTime() <= now.getTime() + 5 * 60_000;
  if (estado === "CONFIRMADO") return { status: "live", provenance: { kind: "confirmed" } };
  const provider = sourceLabel(src, category);
  if (estado === "NO_DISPONIBLE" || estado === "PENDIENTE_DE_VERIFICACION" || src === "pdf" || src === "none" || !src) {
    return { status: "estimate", provenance: { kind: "estimate", source: src === "pdf" ? "según tu archivo" : null } };
  }
  if (LIVE_SOURCES.has(src)) {
    if (fresh && estado !== "OBSOLETO") return { status: "live", provenance: { kind: "live", source: provider, at: at!.toISOString() } };
    const day = at && Number.isFinite(at.getTime()) ? formatDateMx(at.toISOString().slice(0, 10)) : null;
    return { status: "reference", provenance: { kind: "reference", source: day ? `${provider} · consultado el ${day}` : provider } };
  }
  if (CACHED_SOURCES.has(src)) {
    return { status: "reference", provenance: { kind: "reference", source: row?.approximate_dates ? "Aviasales · fechas cercanas" : "Aviasales" } };
  }
  return { status: "estimate", provenance: { kind: "estimate", source: provider } };
}

// ───────────────────────────── petición del cliente ──────────────────────────────────────────────

export type SelectionKind = "vuelo" | "hospedaje" | "actividad" | "restaurante" | "auto";

export type SelectionRequestItem = {
  kind: SelectionKind;
  /** Posición en trips.vuelos_json / hospedaje_json / tours_json / restaurantes_json; -1 para el auto. */
  index: number;
  /** PurchaseItem.key de "Comprar" (para saber si está marcado como comprado). */
  key: string;
  /** Total para el grupo, tal como lo suma la página (null si no tiene precio). */
  price?: number | null;
  /** Noches (hoteles). */
  nights?: number | null;
  /** Escalas y duración como las muestra la página ("Escalas: Madrid", "12h 45m"). */
  facts?: string[];
  subtitle?: string | null;
  /** Botón de compra precargado de "Comprar" (se vuelve a validar con la lista blanca). */
  url?: string | null;
  site?: string | null;
  /** Lo que va precargado en el enlace ("MEX → CDG", "6–15 nov 2026", "1 adulto"). */
  lleva?: string[];
  bought?: boolean;
};

export type SelectionRequest = {
  trip_id: string;
  to?: "me" | "members";
  member_ids?: string[];
  /** Viajeros con que la página calculó el total. */
  travelers: number;
  /** Total que muestra la página. */
  total: number;
  items: SelectionRequestItem[];
  /** Renglones de la cotización que suman al total de la página sin ser algo elegido (comida estimada…). */
  estimates?: Array<{ category: string; amount: number }>;
  /** "Ya tengo vuelo" / "ya tengo dónde quedarme en Roma". */
  skipped?: Array<{ kind: "vuelo" | "hospedaje"; city?: string | null }>;
};

export type SelectionLine = {
  kind: SelectionKind;
  key: string;
  title: string;
  city: string | null;
  subtitle: string | null;
  facts: string[];
  times: { from: { code: string | null; time: string | null }; to: { code: string | null; time: string | null } } | null;
  nights: number | null;
  price: number | null;
  priceBasis: string | null;
  status: PriceStatus | null;
  provenance: Provenance | null;
  url: string | null;
  site: string | null;
  buttonLabel: string | null;
  lleva: string[];
  bought: boolean;
  /** Trayecto por carretera en lugar de vuelo. */
  ground?: boolean;
};

export type SelectionEstimate = { category: string; label: string; amount: number };

export type SelectionEmailInput = {
  tripId: string;
  destination: string;
  origin: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  travelers: number;
  currency: string;
  flight: SelectionLine | null;
  hotels: SelectionLine[];
  activities: SelectionLine[];
  restaurants: SelectionLine[];
  car: SelectionLine | null;
  estimates: SelectionEstimate[];
  /** "comida y transporte local" sin precio. */
  porCotizar: string[];
  /** El vuelo no tiene tarifa real todavía. */
  flightToQuote: boolean;
  /** "vuelo", "hotel en Roma" ("ya lo tengo"). */
  skipped: string[];
  total: number;
  firstName?: string | null;
  /** Quién lo manda, si no es la propia persona (envío a los del viaje). */
  senderName?: string | null;
  siteUrl?: string | null;
  supportEmail?: string | null;
  now?: Date;
};

/** Marcas "Ya lo compré" del viaje: claves de "Comprar" y reservas confirmadas (categoría y texto). */
export type SelectionMarks = { keys: Set<string>; confirmed: Array<{ category: string; text: string }> };

export type ValidationError = { ok: false; status: number; code: string; message: string };
export type ValidationOk = { ok: true; input: SelectionEmailInput };

const ESTIMATE_LABEL: Record<string, string> = {
  vuelos: "Vuelo (estimado de la cotización)", hospedaje: "Hospedaje (estimado de la cotización)",
  tours: "Experiencias (estimado de la cotización)", comida: "Comida", transporte_local: "Transporte local", extras: "Extras",
};
const ESTIMATE_GLYPH: Record<string, string> = { vuelos: GLYPH.vuelos, hospedaje: GLYPH.hospedaje, tours: GLYPH.tours, comida: GLYPH.comida, transporte_local: GLYPH.transporte_local, extras: GLYPH.extras };
const COL: Record<SelectionKind, string | null> = { vuelo: "vuelos_json", hospedaje: "hospedaje_json", actividad: "tours_json", restaurante: "restaurantes_json", auto: null };
const MARK_CATEGORY: Record<SelectionKind, string> = { vuelo: "flight", hospedaje: "hotel", actividad: "activity", restaurante: "restaurant", auto: "car" };
const MAX_ITEMS = 60;

const err = (status: number, code: string, message: string): ValidationError => ({ ok: false, status, code, message });
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const money = (n: number) => formatMoney(Math.round(n), "MXN")!;
const clean = (v: unknown, max: number) => oneLine(v, max) || null;
const cleanList = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map((x) => oneLine(x, max)).filter(Boolean).slice(0, n);
const close = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const isIso = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Hora "HH:MM" de una fila importada (hora_salida / hora_llegada), si la trae. */
function clock(v: unknown): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[1].padStart(2, "0")}:${m[2]} h` : null;
}

function buyVerb(kind: SelectionKind): string {
  if (kind === "auto") return "Buscar en";
  if (kind === "restaurante") return "Reservar en";
  return "Comprar en";
}

/**
 * Comprueba la selección contra la fila del viaje y devuelve lo que va en el correo. Nunca confía en
 * nombres ni precios del cliente: el nombre sale de la fila; el precio, de la tarifa guardada por las
 * personas y noches (con el mismo reparto de habitaciones que la página).
 */
export function validateSelectionRequest(
  raw: unknown,
  ctx: { trip: any; marks?: SelectionMarks; now?: Date },
): ValidationOk | ValidationError {
  const b = (raw && typeof raw === "object" ? raw : {}) as Partial<SelectionRequest>;
  const trip = ctx.trip;
  if (!trip || typeof trip !== "object") return err(404, "viaje_no_encontrado", "No encontramos este viaje.");
  const now = ctx.now ?? new Date();
  const T = Number(b.travelers);
  if (!Number.isInteger(T) || T < 1 || T > 30) return err(400, "viajeros_invalidos", "Número de viajeros no válido.");
  const items: SelectionRequestItem[] = Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS + 1) : [];
  if (items.length > MAX_ITEMS) return err(400, "demasiados_elementos", "La selección tiene demasiados elementos.");
  const marks: SelectionMarks = ctx.marks ?? { keys: new Set<string>(), confirmed: [] };
  const stays = cityStays(trip);
  const multi = stays.length > 1;
  const tripNights = isIso(trip.fecha_salida) && isIso(trip.fecha_regreso) ? nightsBetween(trip.fecha_salida, trip.fecha_regreso) : 0;
  const desglose = (trip.desglose_presupuesto && typeof trip.desglose_presupuesto === "object") ? trip.desglose_presupuesto : {};
  const createdAt = trip.created_at ?? null;

  let flight: SelectionLine | null = null;
  let car: SelectionLine | null = null;
  const hotels: SelectionLine[] = [], activities: SelectionLine[] = [], restaurants: SelectionLine[] = [];
  const seen = new Set<string>();

  for (const it of items) {
    if (!it || typeof it !== "object" || !(it.kind in COL)) return err(400, "elemento_invalido", "Hay un elemento de la selección que no reconocemos.");
    const kind = it.kind as SelectionKind;
    const index = Number(it.index);
    const col = COL[kind];
    const list: any[] = col && Array.isArray(trip[col]) ? trip[col] : [];
    const row = col ? (Number.isInteger(index) && index >= 0 ? list[index] : undefined) : null;
    if (col && (!row || typeof row !== "object")) return err(400, "elemento_invalido", "Una opción elegida ya no está en el viaje. Recarga la página.");
    if (!col && index !== -1) return err(400, "elemento_invalido", "Elemento no válido.");
    const dedupe = `${kind}:${index}`;
    if (seen.has(dedupe)) return err(400, "elemento_repetido", "Hay un elemento repetido en la selección.");
    seen.add(dedupe);

    const key = oneLine(it.key, 200);
    const verdict = it.url ? checkAllowlisted(it.url) : null;
    const url = verdict && verdict.ok ? verdict.url! : null;
    const site = url ? clean(it.site, 40) : null;
    const base: Omit<SelectionLine, "title" | "price" | "priceBasis" | "status" | "provenance" | "city" | "nights"> = {
      kind, key, subtitle: clean(it.subtitle, 140), facts: cleanList(it.facts, 4, 60), times: null,
      url, site, buttonLabel: url && site ? `${buyVerb(kind)} ${site}` : url ? "Abrir el enlace de compra" : null,
      lleva: url ? cleanList(it.lleva, 6, 80) : [],
      // Se verifica al final, con el nombre que pone el servidor (marca del grupo o reserva confirmada).
      bought: !!it.bought,
    };
    const given = it.price === null || it.price === undefined ? null : Number(it.price);
    if (given !== null && !Number.isFinite(given)) return err(400, "precio_invalido", "Precio no válido.");

    if (kind === "vuelo") {
      if (flight) return err(400, "elemento_repetido", "Solo puede ir un vuelo.");
      const pp = num(row.precio_por_persona);
      const expected = pp ? pp * T : null;
      if (given !== null && (expected === null || !close(given, expected))) return err(409, "precio_no_coincide", "El precio del vuelo cambió. Recarga la página.");
      const ground = isGroundTripOption(row);
      const st = priceStatusOf(row, "vuelos", createdAt, now);
      const dep = clock(row.hora_salida), arr = clock(row.hora_llegada);
      flight = {
        ...base, city: null, nights: null, ground,
        title: ground ? oneLine(row.aerolinea ?? "Por carretera", 60) : isEstimatedTripFlight(row) ? "Aerolínea por confirmar" : oneLine(row.aerolinea, 60) || "Aerolínea por confirmar",
        times: dep || arr ? { from: { code: clean(row.from_iata ?? row.dep_iata ?? row.aeropuerto_origen, 4), time: dep }, to: { code: clean(row.to_iata ?? row.arr_iata ?? row.aeropuerto_destino, 4), time: arr } } : null,
        price: given !== null && expected !== null ? Math.round(expected) : null,
        priceBasis: pp ? (T > 1 ? `${plural(T, "persona", "personas")} · ${money(pp)} c/u` : "1 persona") : null,
        status: given !== null ? st.status : null, provenance: given !== null ? st.provenance : null,
      };
    } else if (kind === "hospedaje") {
      const pn = num(row.precio_por_noche);
      let city: string | null = clean(row.ciudad, 60);
      let nights = Number(it.nights);
      if (multi) {
        const stay = stays.find((s) => sameCity(row.ciudad, s.city));
        if (!stay) return err(400, "elemento_invalido", "Ese hotel no es de ninguna ciudad del viaje.");
        if (hotels.some((h) => h.city && sameCity(h.city, stay.city))) return err(400, "elemento_repetido", `Solo puede ir un hotel en ${stay.city}.`);
        city = stay.city;
        nights = stay.nights;
      } else {
        if (hotels.length) return err(400, "elemento_repetido", "Solo puede ir un hotel.");
        // Un solo destino: la ciudad solo si la fila la trae (el destino puede ser el texto que escribió la persona).
        city = city ?? null;
        if (!Number.isInteger(nights) || nights < 0 || nights > Math.max(1, tripNights)) return err(400, "noches_invalidas", "Número de noches no válido.");
      }
      const expected = pn && nights > 0 ? Math.round(pn * nights * hotelPriceRooms(row, T)) : null;
      if (given !== null && (expected === null || !close(given, expected))) return err(409, "precio_no_coincide", "El precio del hotel cambió. Recarga la página.");
      const st = priceStatusOf(row, "hospedaje", createdAt, now);
      const rooms = hotelPriceRooms(row, T);
      hotels.push({
        ...base, city, nights: nights > 0 ? nights : null,
        title: oneLine(row.nombre, 80) || "Hotel",
        price: given !== null ? expected : null,
        priceBasis: pn && nights > 0 ? `${plural(nights, "noche", "noches")} · ${money(pn)} por noche${rooms > 1 ? ` · ${plural(rooms, "habitación", "habitaciones")}` : ""}` : null,
        status: given !== null ? st.status : null, provenance: given !== null ? st.provenance : null,
      });
    } else if (kind === "actividad") {
      const pp = num(row.precio_por_persona);
      const expected = pp ? pp * T : null;
      if (given !== null && (expected === null || !close(given, expected))) return err(409, "precio_no_coincide", "El precio de una experiencia cambió. Recarga la página.");
      const st = priceStatusOf(row, "tours", createdAt, now);
      activities.push({
        ...base, city: clean(row.ciudad, 60), nights: null,
        title: oneLine(row.nombre, 90) || "Experiencia",
        price: given !== null && expected !== null ? Math.round(expected) : null,
        priceBasis: pp ? (T > 1 ? `${plural(T, "persona", "personas")} · ${money(pp)} c/u` : "1 persona") : null,
        status: given !== null ? st.status : null, provenance: given !== null ? st.provenance : null,
      });
    } else if (kind === "restaurante") {
      // No se cotiza mesa: sin precio (el rango va en el subtítulo).
      const rCity = clean(row.ciudad, 60);
      const name = String(row.nombre ?? "").replace(rCity ? ` · ${rCity}` : "", "").trim();
      restaurants.push({
        ...base, city: rCity, nights: null, title: oneLine(name, 90) || "Restaurante",
        subtitle: [clean(row.cocina, 40), rCity, row.rango_precio ? `Rango ${oneLine(row.rango_precio, 12)}` : null].filter(Boolean).join(" · ") || null,
        price: null, priceBasis: null, status: null, provenance: null,
      });
    } else {
      if (car) return err(400, "elemento_repetido", "Solo puede ir un auto.");
      const first = tripDestinations(trip)[0] ?? clean(trip.destino, 60);
      car = { ...base, city: first, nights: null, title: `Renta de auto${first ? ` · ${oneLine(first, 60)}` : ""}`, price: null, priceBasis: null, status: null, provenance: null };
    }
  }

  // "Ya lo compré" solo si hay marca de ese elemento o una reserva confirmada con su nombre.
  const normText = (v: unknown) => ` ${String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (const l of [flight, car, ...hotels, ...activities, ...restaurants]) {
    if (!l || !l.bought) continue;
    const name = normText(l.title).trim();
    l.bought = marks.keys.has(l.key) || (name.length >= 3 && marks.confirmed.some((c) => c.category === MARK_CATEGORY[l.kind] && normText(c.text).includes(` ${name} `)));
  }

  // "Si todavía no eligió nada, no se envía nada": hace falta un vuelo o un hotel elegido.
  if (!flight && !hotels.length) return err(409, "sin_seleccion", "Elige tu vuelo y hotel para enviarte el resumen.");

  const covered: Record<string, boolean> = { vuelos: !!flight, hospedaje: hotels.length > 0, tours: activities.length > 0 };
  const estimates: SelectionEstimate[] = [];
  for (const e of Array.isArray(b.estimates) ? b.estimates.slice(0, 8) : []) {
    const cat = String(e?.category ?? "");
    const amount = Math.round(Number(e?.amount));
    if (!(cat in ESTIMATE_LABEL) || covered[cat] || estimates.some((x) => x.category === cat)) return err(409, "estimado_no_coincide", "El desglose cambió. Recarga la página.");
    if (!(amount > 0) || amount > Math.round(Number(desglose[cat]) || 0) + 1) return err(409, "estimado_no_coincide", "El desglose cambió. Recarga la página.");
    estimates.push({ category: cat, label: ESTIMATE_LABEL[cat], amount });
  }

  const lines = [flight, ...hotels, ...activities].filter((x): x is SelectionLine => !!x);
  const sum = lines.reduce((s, l) => s + (l.price ?? 0), 0) + estimates.reduce((s, e) => s + e.amount, 0);
  const total = Math.round(Number(b.total));
  // Tolerancia de redondeo: medio peso por renglón (la página suma sin redondear y muestra redondeado).
  if (!Number.isFinite(total) || !close(sum, total, Math.max(2, Math.ceil((lines.length + estimates.length) / 2)))) return err(409, "total_no_coincide", "El total cambió. Recarga la página y vuelve a enviarlo.");

  const skipped: string[] = [];
  for (const s of Array.isArray(b.skipped) ? b.skipped.slice(0, 12) : []) {
    if (s?.kind === "vuelo" && !flight && !skipped.includes("vuelo")) skipped.push("vuelo");
    if (s?.kind === "hospedaje") {
      const stay = multi ? stays.find((x) => sameCity(s.city, x.city)) : null;
      const label = stay ? `hotel en ${stay.city}` : "hotel";
      if ((!multi || stay) && !skipped.includes(label)) skipped.push(label);
    }
  }
  const porCotizar = ["comida", "transporte_local"].filter((c) => !estimates.some((e) => e.category === c)).map((c) => (c === "comida" ? "comida" : "transporte local"));
  const flightToQuote = !flight && !skipped.includes("vuelo") && !estimates.some((e) => e.category === "vuelos");

  const destination = tripDestinations(trip).length > 1 ? tripDestinations(trip).join(" → ") : oneLine(trip.destino, 80) || "tu destino";
  return {
    ok: true,
    input: {
      tripId: String(trip.id), destination, origin: clean(trip.ciudad_origen, 60),
      dateFrom: isIso(trip.fecha_salida) ? trip.fecha_salida : null, dateTo: isIso(trip.fecha_regreso) ? trip.fecha_regreso : null,
      travelers: T, currency: "MXN", flight, hotels, activities, restaurants, car, estimates, porCotizar, flightToQuote, skipped,
      total, now,
    },
  };
}

// ───────────────────────────── límite por viaje ──────────────────────────────────────────────────

/** Envíos por viaje y por hora (todos los miembros juntos). */
export const TRIP_SENDS_PER_HOUR = 5;

/**
 * Cuenta un envío del viaje en la ventana de una hora (check_rate_limit, atómica). Si no se puede
 * verificar, se niega: es un correo.
 */
export async function tripSendQuota(hit: HitFn, tripId: string, limit = TRIP_SENDS_PER_HOUR): Promise<{ allowed: boolean; retryAfter: number; unavailable?: boolean }> {
  const r = await hit(`trip:${tripId}`, "enviar-seleccion:viaje:h", { limit, windowSeconds: 3600 });
  if (r === true) return { allowed: true, retryAfter: 0 };
  if (r === null) return { allowed: false, retryAfter: 60, unavailable: true };
  return { allowed: false, retryAfter: 900 };
}

// ───────────────────────────── el correo ─────────────────────────────────────────────────────────

const timeOnly = (at: string) => formatTime(at);

const statusText = (l: SelectionLine) => (l.provenance ? provenanceText(l.provenance, timeOnly) : null);

/** "✓ Ya lo compré" o "Pendiente de comprar". */
function boughtChip(bought: boolean, kind: SelectionKind): string {
  const text = bought ? (kind === "restaurante" ? "Ya lo reservé" : "Ya lo compré") : kind === "restaurante" ? "Pendiente de reservar" : "Pendiente de comprar";
  return `<span style="display:inline-block;font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${bought ? EK.live : EK.muted};white-space:nowrap;">${bought ? "&#10003;&nbsp;" : ""}${escapeHtml(text)}</span>`;
}

/** Botón secundario (borde dorado) del enlace de compra precargado; funciona igual en Outlook. */
function buyRow(l: SelectionLine): string {
  const url = l.url ? safeUrl(l.url) : null;
  const btn = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
        <td align="center" style="border:1px solid ${EK.gold};border-radius:1px;padding:0;">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:11px 18px;font-family:${SANS};font-size:11px;line-height:14px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${EK.gold};text-decoration:none;">${escapeHtml(l.buttonLabel ?? "Comprar")}&nbsp;&#8599;</a>
        </td></tr></table>`
    : `<span style="font-family:${SANS};font-size:12px;line-height:18px;color:${EK.muted};">Sin enlace de compra confiable: búscalo en “Comprar” de tu viaje.</span>`;
  const lleva = l.lleva.length
    ? `<div style="padding-top:8px;font-family:${SANS};font-size:11px;line-height:17px;color:${EK.muted};">Va precargado: ${l.lleva.map(escapeHtml).join(" · ")}</div>` : "";
  return `<tr><td style="padding:20px 0 0;"><div style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${EK.line};">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding:14px 0 0;">${btn}${lleva}</td>
    <td valign="middle" align="right" style="padding:14px 0 0 12px;">${boughtChip(l.bought, l.kind)}</td>
  </tr></table></td></tr>`;
}

/** Tarjeta de un elemento elegido: richCard (mismo sistema) + fila de compra. */
function itemCard(l: SelectionLine, eyebrowText: string, glyph: string): string {
  const facts = [...l.facts, l.subtitle && l.kind !== "vuelo" ? l.subtitle : null].filter((x): x is string => !!x);
  const card = richCard({
    glyph, eyebrow: eyebrowText, title: l.title, facts,
    times: l.times,
    price: l.price !== null ? { amount: money(l.price), basis: l.priceBasis } : null,
    provenance: l.price !== null ? l.provenance : null,
    note: l.kind === "vuelo" && l.subtitle ? l.subtitle : null,
    footer: buyRow(l),
  }, timeOnly);
  return card;
}

/** Renglón compacto para lo estimado que también suma al total de la página. */
function estimateRows(es: SelectionEstimate[]): string {
  const rows = es.map((e, i) => `<tr><td style="padding:${i ? 14 : 0}px 0 14px;border-bottom:1px solid ${EK.line};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="40" valign="top">${icon(ESTIMATE_GLYPH[e.category] ?? GLYPH.extras, 30)}</td>
      <td valign="top" style="padding:0 10px;"><div style="font-family:${SERIF};font-size:18px;line-height:22px;color:${EK.ivory};">${escapeHtml(e.label)}</div>
        <div style="padding-top:5px;">${chip({ kind: "estimate", source: "cálculo de IATOS" })}</div></td>
      <td align="right" valign="top" style="white-space:nowrap;font-family:${SERIF};font-size:19px;line-height:22px;color:${EK.ivory};${LNUM}">${escapeHtml(money(e.amount))}</td>
    </tr></table></td></tr>`).join("");
  return `<tr><td class="ek-pad" style="padding:0 56px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function joinEs(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Línea "Por cotizar: comida y transporte local (los pagas allá)." */
export function porCotizarLine(parts: string[]): string | null {
  return parts.length ? `Por cotizar: ${joinEs(parts)} (los pagas allá).` : null;
}

export function selectionEmail(i: SelectionEmailInput): Email {
  const site = normalizeSite(i.siteUrl);
  const destination = oneLine(i.destination, 120) || "tu destino";
  const name = firstNameOf(i.firstName);
  const sender = firstNameOf(i.senderName);
  const T = Math.max(1, Math.round(Number(i.travelers) || 1));
  const nights = nightsBetween(i.dateFrom, i.dateTo);
  const dates = formatDateRange(i.dateFrom, i.dateTo);
  const total = Math.round(Number(i.total) || 0);
  const totalLabel = T > 1 ? `Total para ${T} personas` : "Total para 1 persona";
  const perPerson = T > 1 ? `${money(total / T)} por persona` : "Es la cifra por persona";
  const tripLink = `${site}/dashboard/viajes/${encodeURIComponent(i.tripId)}#comprar`;
  const cotizar = porCotizarLine(i.porCotizar);
  const yaTienes = i.skipped.length ? `Ya lo tienes (no suma): ${joinEs(i.skipped)}.` : null;
  const lines = [i.flight, ...i.hotels, ...i.activities].filter((x): x is SelectionLine => !!x);
  const estimated = lines.some((l) => l.price !== null && l.status !== "live") || i.estimates.length > 0;

  let n = 0;
  const section = (t: string) => eyebrow(`${ROMAN[n++]} · ${t}`);
  const body: string[] = [
    masthead("Tu selección"),
    gap(28),
    hero({ image: null, eyebrow: sender ? `La selección de ${sender} para` : "Tu selección para", title: destination,
      subtitle: [dates, nights ? plural(nights, "noche", "noches") : null, plural(T, "persona", "personas")].filter(Boolean).join("  ·  ") || null }),
    gap(44),
    name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
    headline(sender ? `${escapeHtml(sender)} te comparte lo que eligió.` : "Esto es lo que elegiste."),
    gap(14),
    para(escapeHtml("Solo va lo que elegiste en IATOS, cada cosa con su precio, de dónde sale y su botón de compra precargado. Nada está comprado hasta que lo compras en cada sitio.")),
    gap(40),
    section("El viaje"),
    gap(16),
    tripPass({
      origin: i.origin ? { city: i.origin } : null,
      destination: { city: destination },
      cells: [
        { label: "Salida", value: formatDateMx(i.dateFrom) ?? "Por definir" },
        { label: "Regreso", value: formatDateMx(i.dateTo) ?? "Por definir" },
        { label: "Viajeros", value: plural(T, "persona", "personas") },
        { label: "Noches", value: nights ? String(nights) : "Por definir" },
      ],
    }),
  ];
  if (i.flight) {
    body.push(gap(44), section(i.flight.ground ? "Tu traslado" : "Tu vuelo"), gap(16),
      itemCard(i.flight, i.flight.ground ? "Traslado elegido" : "Vuelo elegido", i.flight.ground ? GLYPH.transporte_local : GLYPH.vuelos));
  }
  if (i.hotels.length) {
    body.push(gap(44), section(i.hotels.length > 1 ? "Tus hoteles" : "Tu hotel"), gap(16),
      i.hotels.map((h) => itemCard(h, [h.city ? `Hotel en ${h.city}` : "Hotel elegido", h.nights ? plural(h.nights, "noche", "noches") : null].filter(Boolean).join(" · "), GLYPH.hospedaje)).join(gap(16)));
  }
  const extras = [
    ...i.activities.map((a) => itemCard(a, a.city ? `Experiencia · ${a.city}` : "Experiencia", GLYPH.tours)),
    ...i.restaurants.map((r) => itemCard(r, "Restaurante", GLYPH.comida)),
    ...(i.car ? [itemCard(i.car, "Auto (opcional)", GLYPH.transporte_local)] : []),
  ];
  if (extras.length) body.push(gap(44), section("Experiencias y reservas"), gap(16), extras.join(gap(16)));

  body.push(gap(52), section("El total"), gap(16));
  if (i.estimates.length) {
    body.push(para(escapeHtml("También suma lo estimado de tu cotización que no se elige:"), { size: 13, color: EK.body }), gap(12), estimateRows(i.estimates), gap(28));
  }
  body.push(totalBlock({
    label: totalLabel,
    amount: formatAmount(total, "MXN"),
    currency: "MXN",
    sub: perPerson,
    foot: estimated ? "Igual que en tu viaje en IATOS. Lo que no es «en vivo» puede cambiar al comprar." : "Igual que en tu viaje en IATOS.",
  }));
  const notes = [cotizar, i.flightToQuote ? "Vuelo por cotizar: aún no hay una tarifa real para tu ruta; búscalo en “Comprar”." : null, yaTienes].filter((x): x is string => !!x);
  if (notes.length) body.push(gap(28), callout(notes.map(escapeHtml).join("<br><br>")));
  body.push(gap(40), button(tripLink, "Ver mi viaje"), gap(18),
    para("«En vivo» es una tarifa consultada con el proveedor hace menos de 24 h; «Referencia», un precio real que no se consultó en vivo; «Estimado», un cálculo de IATOS.", { align: "center", size: 12, color: EK.muted }),
    gap(56), signature());

  const reason = sender
    ? `Recibes este correo porque ${sender} lo envió desde un viaje de IATOS en el que participas.`
    : "Recibes este correo porque pediste tu selección desde tu viaje en IATOS.";
  const subject = sender ? `${sender} te comparte su selección: ${destination}` : `Tu selección: ${destination}`;
  const what = [i.flight ? "vuelo" : null, i.hotels.length ? plural(i.hotels.length, "hotel", "hoteles") : null,
    i.activities.length ? plural(i.activities.length, "experiencia", "experiencias") : null].filter(Boolean).join(", ");
  const preheader = `${totalLabel}: ${money(total)}${what ? ` · ${what}` : ""}${dates ? ` · ${dates}` : ""}`;
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: i.supportEmail });

  const textItem = (l: SelectionLine, head: string) => [
    `${head}: ${l.title}`,
    ...[...l.facts, l.subtitle].filter(Boolean).map((f) => `  ${f}`),
    l.times && (l.times.from.time || l.times.to.time) ? `  Horario: ${l.times.from.time ?? "—"} → ${l.times.to.time ?? "—"}` : null,
    l.price !== null ? `  ${money(l.price)}${l.priceBasis ? ` (${l.priceBasis})` : ""} [${statusText(l)}]` : null,
    l.url ? `  ${l.buttonLabel ?? "Comprar"}: ${l.url}` : "  Sin enlace de compra confiable: búscalo en “Comprar” de tu viaje.",
    l.url && l.lleva.length ? `  Va precargado: ${l.lleva.join(" · ")}` : null,
    `  ${l.bought ? (l.kind === "restaurante" ? "Ya lo reservé" : "Ya lo compré") : l.kind === "restaurante" ? "Pendiente de reservar" : "Pendiente de comprar"}`,
    "",
  ];
  const text = joinText([
    "IATOS",
    "",
    name ? `${name},` : null,
    sender ? `${sender} te comparte lo que eligió para ${destination}.` : `Esto es lo que elegiste para ${destination}.`,
    "Solo va lo que elegiste, con su precio, de dónde sale y su enlace de compra precargado. Nada está comprado hasta que lo compras en cada sitio.",
    "",
    `Ruta: ${i.origin ?? "Origen por definir"} → ${destination}`,
    `Fechas: ${dates ?? "por definir"}${nights ? ` (${plural(nights, "noche", "noches")})` : ""}`,
    `Viajeros: ${plural(T, "persona", "personas")}`,
    "",
    ...(i.flight ? textItem(i.flight, "VUELO") : []),
    ...i.hotels.flatMap((h) => textItem(h, `HOTEL${h.city ? ` EN ${h.city.toUpperCase()}` : ""}${h.nights ? ` · ${plural(h.nights, "noche", "noches")}` : ""}`)),
    ...i.activities.flatMap((a) => textItem(a, "EXPERIENCIA")),
    ...i.restaurants.flatMap((r) => textItem(r, "RESTAURANTE")),
    ...(i.car ? textItem(i.car, "AUTO (OPCIONAL)") : []),
    ...(i.estimates.length ? ["También suma lo estimado de tu cotización:", ...i.estimates.map((e) => `- ${e.label}: ${money(e.amount)} [ESTIMADO · cálculo de IATOS]`), ""] : []),
    `${totalLabel.toUpperCase()}: ${money(total)}`,
    perPerson,
    "Igual que en tu viaje en IATOS.",
    "",
    ...notes,
    notes.length ? "" : null,
    `Ver mi viaje: ${tripLink}`,
    "",
    "Tu concierge, Iato",
    "",
    ...textFooter({ reason, siteUrl: site, supportEmail: i.supportEmail }),
  ]);
  return { subject, preheader, html, text };
}
