// "Planear viaje" (ventana) y "Explorar destinos": datos, etiquetas y a dónde lleva cada botón.
//
// Gasto (regla del dueño): abrir la ventana, cambiar de origen, escribir o mover el mapa NUNCA
// gasta. `fetchExplore(origen)` pide a flights-search { action: "explore", live: false }, que solo
// lee la caché compartida. Solo `fetchExplore(origen, { live: true })` (botón "Explorar destinos" o
// "Buscar precios") puede consultar a SerpApi, y aun así un acierto de la caché de 12 h no gasta.
// En el navegador se guarda el resultado 10 min para no repetir ni la lectura.
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionErrors";
import { formatLocalDate } from "@/lib/localDate";
import { CITIES, cityAirports, normCity } from "../../supabase/functions/_shared/airports";
import { frescuraPrecio } from "../../supabase/functions/_shared/priceFreshness";
import { COUNTRIES } from "@/lib/countriesCities";
import { countryRouteFor, proposeCountryRoute } from "@/lib/countryRoutes";
import { diffLocalDays } from "@/lib/localDate";
import type { ExploreDestino } from "../../supabase/functions/flights-search/explore";

export type { ExploreDestino };

export const DEFAULT_ORIGIN = "Ciudad de México";
/** Chips de origen: el del usuario primero y luego estos (sin repetir). */
export const ORIGIN_CHIPS = ["Ciudad de México", "Cancún", "Guadalajara", "Monterrey"];

export type ExploreState =
  | { estado: "ok"; destinos: ExploreDestino[]; consultadoAt: string | null; fromCache: boolean; nota: string | null; aviso: string | null }
  /** No hay caché vigente para este origen (y no se pidió buscar). */
  | { estado: "sin_cache"; motivo: string }
  /** Se buscó y no hubo precios: cuota del plan, búsquedas en pausa, proveedor caído. */
  | { estado: "sin_precios"; motivo: string; limite: boolean };

const CLIENT_TTL_MS = 10 * 60_000;
const memo = new Map<string, { at: number; state: ExploreState }>();
const inflight = new Map<string, Promise<ExploreState>>();

/** Solo para pruebas. */
export function __resetExploreCache() {
  memo.clear();
  inflight.clear();
}

const keyOf = (origin: string, month: number) => `${normCity(origin)}|${month}`;

/** Lo último que se sabe de este origen (sin red). */
export function cachedExplore(origin: string, month = 0): ExploreState | null {
  const hit = memo.get(keyOf(origin, month));
  return hit && Date.now() - hit.at < CLIENT_TTL_MS ? hit.state : null;
}

export async function fetchExplore(origin: string, opts: { month?: number; live?: boolean } = {}): Promise<ExploreState> {
  const month = opts.month ?? 0;
  const live = opts.live === true;
  const key = keyOf(origin, month);
  const hit = cachedExplore(origin, month);
  // Con live, solo se reutiliza un resultado con precios (una lectura vacía no evita la búsqueda).
  if (hit && (!live || hit.estado === "ok")) return hit;
  const flightKey = `${key}|${live ? "live" : "cache"}`;
  const pending = inflight.get(flightKey);
  if (pending) return pending;
  const p = (async (): Promise<ExploreState> => {
    const { data, error } = await supabase.functions.invoke("flights-search", { body: { action: "explore", origin, month, live } });
    if (error) {
      const info = await readFunctionError(error, "No pudimos consultar precios ahora.");
      return { estado: "sin_precios", motivo: info.message, limite: info.code === "FREE_LIMIT_REACHED" || info.status === 402 };
    }
    const d = (data ?? {}) as Record<string, any>;
    const destinos: ExploreDestino[] = Array.isArray(d.results) ? d.results : [];
    if (d.sin_cache) return { estado: "sin_cache", motivo: String(d.motivo ?? "") };
    if (!destinos.length) {
      return { estado: "sin_precios", motivo: String(d.motivo ?? "Sin precio ahora."), limite: d.limite_uso_justo === true || d.busquedas_en_pausa === true };
    }
    return {
      estado: "ok",
      destinos,
      consultadoAt: typeof d.consulted_at === "string" ? d.consulted_at : null,
      fromCache: d.from_cache === true,
      nota: typeof d.nota_precio === "string" ? d.nota_precio : null,
      aviso: typeof d.aviso_limite === "string" ? d.aviso_limite : null,
    };
  })().finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, p);
  const state = await p;
  // Un error transitorio no se recuerda: el siguiente intento vuelve a preguntar.
  if (state.estado !== "sin_precios" || state.limite) memo.set(key, { at: Date.now(), state });
  return state;
}

// ─── Etiquetas ───

export const formatMxn = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

/** "consultado 09:12" (hora local). */
export function consultedHHMM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `consultado ${d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

/** "desde $2,130 MXN · consultado 09:12", o "Sin precio ahora". */
export function priceLabel(d: Pick<ExploreDestino, "precio_mxn">, consultadoAt: string | null): string {
  if (d.precio_mxn == null || !(d.precio_mxn > 0)) return "Sin precio ahora";
  const at = consultedHHMM(consultadoAt);
  return [`desde ${formatMxn(d.precio_mxn)}`, at].filter(Boolean).join(" · ");
}

/** Frescura del precio (misma regla que el servidor: en vivo ≤ 15 min, caché con su antigüedad). */
export function freshnessLabel(consultadoAt: string | null, now: number = Date.now()): string {
  return frescuraPrecio({ consultadoAt, vigenciaHoras: 12 }, now).etiqueta;
}

/** "14–23 ene" o "14 ene – 2 feb". */
export function dateRangeShort(a: string | null, b: string | null): string | null {
  if (!a) return null;
  const da = formatLocalDate(a, { day: "numeric", month: "short" }).replace(".", "");
  if (!b) return da;
  const db = formatLocalDate(b, { day: "numeric", month: "short" }).replace(".", "");
  if (a.slice(0, 7) === b.slice(0, 7)) return `${Number(a.slice(8, 10))}–${db}`;
  return `${da} – ${db}`;
}

export const stopsLabel = (n: number | null) => (n == null ? null : n === 0 ? "Directo" : n === 1 ? "1 escala" : `${n} escalas`);
export const durationLabel = (m: number | null) => (m == null || !(m > 0) ? null : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

/** "CDMX" para Ciudad de México; si no, el nombre. */
export function shortCity(name: string): string {
  return cityAirports(name)?.metro === "MEX" ? "CDMX" : name;
}

// ─── Catálogo para "¿A dónde?" ───

export type PlaceOption = { kind: "city" | "country"; label: string; sub: string; value: string };

const strip = (s: string) => normCity(s);

/** Ciudades (aeropuertos conocidos y la lista curada) y países, sin repetir. */
export const PLACES: PlaceOption[] = (() => {
  const out: PlaceOption[] = [];
  const seen = new Set<string>();
  const add = (o: PlaceOption) => {
    const k = `${o.kind}|${strip(o.value)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(o);
  };
  for (const c of CITIES) add({ kind: "city", label: c.name, sub: `${c.country} · ${c.airports[0]}`, value: c.name });
  for (const co of COUNTRIES) for (const city of co.cities) add({ kind: "city", label: city, sub: co.name, value: city });
  const countries = new Set<string>([...COUNTRIES.map((c) => c.name), ...CITIES.map((c) => c.country)]);
  for (const name of countries) add({ kind: "country", label: name, sub: "País · ruta por varias ciudades", value: name });
  return out;
})();

export function searchPlaces(q: string, limit = 8): PlaceOption[] {
  const k = strip(q);
  if (!k) return [];
  const starts: PlaceOption[] = [];
  const contains: PlaceOption[] = [];
  for (const p of PLACES) {
    const l = strip(p.label);
    if (l.startsWith(k)) starts.push(p);
    else if (l.includes(k) || (p.kind === "city" && strip(p.sub).startsWith(k))) contains.push(p);
  }
  // Un país que empieza igual va primero ("jap" → Japón, luego Tokio…).
  const rank = (o: PlaceOption) => (o.kind === "country" ? 0 : 1);
  return [...starts.sort((a, b) => rank(a) - rank(b)), ...contains].slice(0, limit);
}

const COUNTRY_SET = new Set(PLACES.filter((p) => p.kind === "country").map((p) => strip(p.value)));
export const isCountry = (s: string) => COUNTRY_SET.has(strip(s)) || !!countryRouteFor(s);

// ─── "Explorar": a qué flujo real lleva y con qué datos ───

export type TripKind = "redondo" | "sencillo" | "multi";
export type CabinClass = "turista" | "premium" | "business" | "primera";
export const CABIN_LABEL: Record<CabinClass, string> = { turista: "Turista", premium: "Premium", business: "Business", primera: "Primera" };
export type Leg = { from: string; to: string; date: string };

export type PlanForm = {
  kind: TripKind;
  adults: number;
  minors: number;
  cabin: CabinClass;
  origin: string;
  destination: string;
  depart: string;
  ret: string;
  legs: Leg[];
};

export type ExploreTarget = { path: string; flow: "ruta" | "planear" };

/**
 * Destino que es un país o varias ciudades → /dashboard/ruta (MultiDestRoute) con ciudades, noches,
 * fechas y viajeros. Una ciudad → /dashboard/planear (asistente) con todo lleno, en el paso de
 * fechas para revisar. Nunca se manda la frase completa como destino. Ninguno arranca solo un
 * análisis de pago: la persona revisa y confirma en el flujo.
 */
export function exploreTarget(f: PlanForm): ExploreTarget | null {
  const viajeros = Math.max(1, f.adults + f.minors);
  const origin = f.origin.trim() || DEFAULT_ORIGIN;
  if (f.kind === "multi") {
    const legs = f.legs.filter((l) => l.to.trim());
    if (!legs.length) return null;
    const start = legs[0].from.trim() || origin;
    // Las ciudades del recorrido (el regreso a casa no es una parada).
    const cities = legs.map((l) => l.to.trim()).filter((c) => strip(c) !== strip(start));
    if (!cities.length) return null;
    const fechaSalida = legs[0].date || "";
    const last = legs[legs.length - 1];
    const returnsHome = strip(last.to) === strip(start);
    const fechaRegreso = returnsHome ? last.date : "";
    // Noches = días entre un tramo y el siguiente (solo si todas las fechas están y cuadran).
    let nights: number[] | null = null;
    if (returnsHome && legs.every((l) => l.date) && legs.length === cities.length + 1) {
      const n = cities.map((_, i) => diffLocalDays(legs[i].date, legs[i + 1].date));
      nights = n.every((x) => Number.isFinite(x) && x >= 1) ? n : null;
    }
    const qs = new URLSearchParams({ origin: start, destinos: cities.join("|"), viajeros: String(viajeros) });
    if (fechaSalida) qs.set("fecha_salida", fechaSalida);
    if (fechaRegreso) qs.set("fecha_regreso", fechaRegreso);
    if (nights) qs.set("noches", nights.join("|"));
    return { path: `/dashboard/ruta?${qs.toString()}`, flow: "ruta" };
  }
  const dest = f.destination.trim();
  if (!dest) return null;
  const ret = f.kind === "redondo" ? f.ret : "";
  if (isCountry(dest) && !cityAirports(dest)) {
    const total = f.depart && ret ? diffLocalDays(f.depart, ret) : null;
    const proposal = proposeCountryRoute(dest, total && total > 0 ? total : null);
    if (proposal && proposal.cities.length >= 2) {
      const qs = new URLSearchParams({ origin, destinos: proposal.cities.join("|"), viajeros: String(viajeros) });
      if (f.depart) qs.set("fecha_salida", f.depart);
      if (ret) qs.set("fecha_regreso", ret);
      if (proposal.nights && proposal.nights.length === proposal.cities.length) qs.set("noches", proposal.nights.join("|"));
      return { path: `/dashboard/ruta?${qs.toString()}`, flow: "ruta" };
    }
    // País sin ruta curada: el asistente ya sabe proponer ciudades para un país desde su primer paso.
  }
  const qs = new URLSearchParams({ destino: dest, origen: origin, viajeros: String(viajeros), desde: "ventana" });
  if (f.depart) qs.set("fecha_salida", f.depart);
  if (ret) qs.set("fecha_regreso", ret);
  if (f.cabin !== "turista") qs.set("clase", f.cabin);
  return { path: `/dashboard/planear?${qs.toString()}`, flow: "planear" };
}

/**
 * Tarjeta → la búsqueda real de ese vuelo (TripFlights) ya llena. No arranca sola: la persona pulsa
 * "Buscar" (esa es la consulta de pago, con su cuota) y el precio se vuelve a confirmar al comprar.
 */
export function flightSearchPath(origin: string, d: Pick<ExploreDestino, "iata" | "destino" | "salida" | "regreso">, travelers = 1): string {
  const qs = new URLSearchParams({ origin, destination: d.iata || d.destino, travelers: String(Math.max(1, travelers)) });
  if (d.salida) qs.set("depart", d.salida);
  if (d.regreso) qs.set("return", d.regreso);
  return `/dashboard/vuelos?${qs.toString()}`;
}

/** Chips de origen: el del usuario primero. */
export function originChips(userOrigin: string | null | undefined): string[] {
  const first = (userOrigin ?? "").trim();
  const list = first ? [first, ...ORIGIN_CHIPS] : ORIGIN_CHIPS;
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = strip(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
