// Cálculos del road trip (grupo roadtrip). Lógica pura, sin Deno ni red: la usan logistics-plan
// (con la distancia real de Google Routes), la pantalla (vista previa ESTIMADA, sin costo de API),
// Iato y las pruebas.
//
// Reglas de honestidad:
//  * Distancia y tiempo: CONSULTADO solo si vienen de Google Routes en esta cotización; si no, la
//    aproximación por línea recta × 1.3 a 70 km/h, SIEMPRE etiquetada ESTIMADO; sin coordenadas,
//    SIN_DATOS (no se inventa).
//  * Combustible: ESTIMADO = km × consumo supuesto × precio oficial del país (fuente y fecha).
//  * Viñetas: precio oficial publicado (CONSULTADO, con fuente y fecha).
//  * Renta, cargo por devolver en otro lugar, peajes y estacionamiento: sin tarifa verificable →
//    POR_COTIZAR / POR_CONFIRMAR, sin monto.
import { haversineKm } from "../geo-distance.ts";
import { type City, CITIES, COUNTRIES, type CuratedRoute, CURATED_ROUTES, type Iso, type Notice, NOTICES } from "./data.ts";
import { type Source, SOURCES } from "./sources.ts";

export const ROAD_FACTOR = 1.3;
export const AVG_KMH = 70;
export const DEFAULT_L_PER_100 = 7;
/** Compute Routes Essentials, USD por llamada (5 USD por 1,000; 10,000 gratis al mes). */
export const ROUTES_USD_PER_CALL = 0.005;
export const ROUTES_SKU = "Compute Routes Essentials";

export type LegMode = "avion" | "tren" | "coche";
export type TransportMode = LegMode | "mixto";
export type DataState = "CONSULTADO" | "ESTIMADO" | "POR_CONFIRMAR" | "POR_COTIZAR" | "SIN_DATOS";

export const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Ciudad conocida en el texto (el alias más largo gana). */
export function findCity(text: unknown): City | null {
  const t = ` ${norm(text)} `;
  if (!t.trim()) return null;
  let best: { c: City; len: number } | null = null;
  for (const c of CITIES) {
    for (const a of [c.key.replace(/_/g, " "), norm(c.name), ...c.aliases]) {
      if (a && t.includes(` ${a} `) && (!best || a.length > best.len)) best = { c, len: a.length };
    }
  }
  return best?.c ?? null;
}

const COUNTRY_WORDS: Array<[Iso, string[]]> = [
  ["IT", ["italia", "italy"]], ["FR", ["francia", "france"]], ["ES", ["espana", "spain"]], ["PT", ["portugal"]],
  ["DE", ["alemania", "germany", "deutschland"]], ["AT", ["austria", "osterreich"]], ["CH", ["suiza", "switzerland", "schweiz"]],
  ["CZ", ["chequia", "republica checa", "czechia", "czech republic"]], ["SI", ["eslovenia", "slovenia"]], ["HR", ["croacia", "croatia"]],
  ["GB", ["reino unido", "inglaterra", "escocia", "gales", "united kingdom", "england", "scotland", "wales"]],
  ["IE", ["irlanda", "ireland"]], ["IS", ["islandia", "iceland"]], ["BE", ["belgica", "belgium"]], ["NL", ["paises bajos", "holanda", "netherlands"]],
  ["SK", ["eslovaquia", "slovakia"]], ["HU", ["hungria", "hungary"]],
];

/** País de una parada: por la ciudad conocida o por el nombre del país en el texto. */
export function countryOf(text: unknown): Iso | null {
  const c = findCity(text);
  if (c) return c.iso;
  const t = ` ${norm(text)} `;
  for (const [iso, words] of COUNTRY_WORDS) if (words.some((w) => t.includes(` ${w} `))) return iso;
  return null;
}

export type LegEstimate = { distance_km: number; duration_min: number } | null;

/** Línea recta × factor de carretera a velocidad media. null sin coordenadas de ambas paradas. */
export function estimateLeg(from: unknown, to: unknown): LegEstimate {
  const a = findCity(from);
  const b = findCity(to);
  if (!a || !b) return null;
  const km = Math.round(haversineKm(a, b) * ROAD_FACTOR);
  return { distance_km: km, duration_min: Math.round((km / AVG_KMH) * 60) };
}

const LEG_MODES: LegMode[] = ["avion", "tren", "coche"];

/**
 * Modo de cada tramo entre paradas consecutivas (stops.length - 1 tramos). "mixto" usa lo que eligió
 * el usuario por tramo; un modo único aplica a todos. Lo desconocido cae en `fallback`.
 */
export function resolveLegModes(stopsCount: number, mode?: unknown, legModes?: unknown, fallback: LegMode = "tren"): LegMode[] {
  const n = Math.max(0, stopsCount - 1);
  const single = LEG_MODES.includes(mode as LegMode) ? (mode as LegMode) : null;
  const list = Array.isArray(legModes) ? legModes : [];
  return Array.from({ length: n }, (_, i) => {
    if (mode === "mixto" && LEG_MODES.includes(list[i] as LegMode)) return list[i] as LegMode;
    return single ?? (LEG_MODES.includes(list[i] as LegMode) ? (list[i] as LegMode) : fallback);
  });
}

export type LiveLeg = { ok: boolean; distance_meters?: number | null; duration_seconds?: number | null; consultado_at?: string | null } | null | undefined;

export type CostItem = {
  id: string;
  concepto: string;
  monto: number | null;
  moneda: string | null;
  estado: DataState;
  fuente: Source | null;
  detalle: string;
};

export type SuggestedStop = { name: string; why: string; source: Source };

export type RoadLeg = {
  index: number;
  from: string;
  to: string;
  from_iso: Iso | null;
  to_iso: Iso | null;
  distance_km: number | null;
  duration_min: number | null;
  estado: "CONSULTADO" | "ESTIMADO" | "SIN_DATOS";
  fuente: "google_routes" | "estimado_linea_recta" | null;
  consultado_at: string | null;
  maps_url: string;
  crosses_border: boolean;
  date: string | null;
  suggested_stops: SuggestedStop[];
  fuel: CostItem;
};

export type Rental = {
  pickup_city: string;
  dropoff_city: string;
  pickup_date: string | null;
  dropoff_date: string | null;
  pickup_iso: Iso | null;
  dropoff_iso: Iso | null;
  one_way: boolean;
  cross_border: boolean;
  countries: Iso[];
  leg_indexes: number[];
  warnings: string[];
};

export type RoadTripPlan = {
  version: 1;
  legs: RoadLeg[];
  rentals: Rental[];
  costs: CostItem[];
  /** Suma de lo que sí tiene monto (estimado o consultado), por moneda. Es PARCIAL: faltan renta, peajes, estacionamiento. */
  totals_by_currency: Record<string, number>;
  notices: Notice[];
  assumptions: string[];
  api: { provider: "google_routes"; sku: string; calls: number; list_price_usd: number; free_per_month: number; source: Source };
  generated_at: string;
};

const fmtNum = (n: number, d = 2) => n.toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Ciudad para buscadores y Google Maps: nombre en inglés + país (evita homónimos: Lagos, Córdoba). */
export function placeQuery(text: string): string {
  const c = findCity(text);
  if (!c) return text.trim();
  return `${c.en}, ${COUNTRY_EN[c.iso]}`;
}

const COUNTRY_EN: Record<Iso, string> = {
  IT: "Italy", FR: "France", ES: "Spain", PT: "Portugal", DE: "Germany", AT: "Austria", CH: "Switzerland", CZ: "Czechia", SI: "Slovenia",
  HR: "Croatia", GB: "United Kingdom", IE: "Ireland", IS: "Iceland", BE: "Belgium", NL: "Netherlands", SK: "Slovakia", HU: "Hungary",
};

/** Google Maps (ruta en coche; la abre el usuario, sin costo para IATOS). Hasta 9 paradas intermedias. */
export function mapsDrivingUrl(stops: string[]): string {
  const s = stops.map((x) => placeQuery(x)).filter(Boolean);
  const p = new URLSearchParams({ api: "1", origin: s[0] ?? "", destination: s[s.length - 1] ?? "", travelmode: "driving" });
  const mid = s.slice(1, -1).slice(0, 9);
  if (mid.length) p.set("waypoints", mid.join("|"));
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

function fuelCost(leg: { distance_km: number | null; from_iso: Iso | null; from: string }, fuelType: "petrol" | "diesel", lPer100: number, id: string): CostItem {
  const country = leg.from_iso ? COUNTRIES[leg.from_iso] : null;
  const label = fuelType === "diesel" ? "diésel" : "gasolina";
  if (leg.distance_km === null) {
    return { id, concepto: `Combustible (${label})`, monto: null, moneda: null, estado: "SIN_DATOS", fuente: null, detalle: "Sin distancia de este tramo: no se puede estimar." };
  }
  if (!country?.fuel) {
    return {
      id, concepto: `Combustible (${label})`, monto: null, moneda: country?.currency ?? null, estado: "POR_CONFIRMAR", fuente: null,
      detalle: `IATOS no tiene un precio oficial verificado del combustible en ${country?.name ?? leg.from}.`,
    };
  }
  const price = fuelType === "diesel" ? country.fuel.diesel : country.fuel.petrol;
  const liters = (leg.distance_km * lPer100) / 100;
  const monto = Math.round(liters * price * 100) / 100;
  return {
    id, concepto: `Combustible (${label})`, monto, moneda: country.fuel.currency, estado: "ESTIMADO", fuente: country.fuel.source,
    detalle: `${leg.distance_km} km × ${lPer100} L/100 km (supuesto) × ${fmtNum(price, 3)} ${country.fuel.currency}/L, precio promedio en ${country.name} (semana del ${country.fuel.source.data_date}).`,
  };
}

/** Paradas curadas (de rutas oficiales) que quedan de camino: rodeo ≤ 20 % del tramo o ≤ 15 km. */
export function suggestedStopsFor(from: string, to: string, max = 3): SuggestedStop[] {
  const a = findCity(from);
  const b = findCity(to);
  if (!a || !b || a.key === b.key) return [];
  const direct = haversineKm(a, b);
  const out: Array<SuggestedStop & { detour: number }> = [];
  const seen = new Set<string>([a.key, b.key]);
  for (const r of CURATED_ROUTES) {
    for (const name of r.stops) {
      const s = findCity(name);
      if (!s || seen.has(s.key)) continue;
      const detour = haversineKm(a, s) + haversineKm(s, b) - direct;
      if (detour <= Math.max(15, direct * 0.2)) {
        seen.add(s.key);
        out.push({ name: s.name, why: `De camino (rodeo aprox. ${Math.round(detour * ROAD_FACTOR)} km). Parada de la ruta "${r.name}".`, source: r.source, detour });
      }
    }
  }
  return out.sort((x, y) => x.detour - y.detour).slice(0, max).map(({ detour: _d, ...s }) => s);
}

const VIGNETTE_NOTICES = NOTICES.filter((n) => n.kind === "vineta" && n.prices);

function vignetteCost(iso: Iso, days: number): CostItem | null {
  const n = VIGNETTE_NOTICES.find((x) => x.iso === iso);
  if (!n?.prices) return null;
  const tier = n.prices.tiers.find((t) => t.days >= days) ?? n.prices.tiers[n.prices.tiers.length - 1];
  return {
    id: `vineta-${iso}`, concepto: `${n.prices.label} · ${tier.name}`, monto: tier.amount, moneda: n.prices.currency, estado: "CONSULTADO",
    fuente: n.sources[0], detalle: `Precio oficial publicado para ${days} día(s) de auto en ${COUNTRIES[iso].name}. Puede haber peajes por tramo aparte.`,
  };
}

export type BuildInput = {
  stops: string[];
  legModes: LegMode[];
  /** Fecha (YYYY-MM-DD) de cada tramo, si se conoce. */
  legDates?: Array<string | null>;
  /** Resultado de Google Routes por tramo (mismo índice), solo para los tramos en coche. */
  live?: LiveLeg[];
  /** Cuántas llamadas a Routes se hicieron (para el costo de API). */
  apiCalls?: number;
  fuelType?: "petrol" | "diesel";
  litersPer100?: number;
  now?: string;
};

const isIso = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const daysBetween = (a: string | null, b: string | null) =>
  isIso(a) && isIso(b) ? Math.max(1, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1) : null;

/** null si ningún tramo va en coche. */
export function buildRoadTripPlan(input: BuildInput): RoadTripPlan | null {
  const stops = input.stops.map((s) => String(s ?? "").trim()).filter(Boolean);
  const fuelType = input.fuelType ?? "petrol";
  const lPer100 = Number(input.litersPer100) > 0 ? Number(input.litersPer100) : DEFAULT_L_PER_100;
  const legs: RoadLeg[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    if (input.legModes[i] !== "coche") continue;
    const from = stops[i];
    const to = stops[i + 1];
    const live = input.live?.[i];
    const sec = live?.ok ? Number(live.duration_seconds) : NaN;
    const m = live?.ok ? Number(live.distance_meters) : NaN;
    const from_iso = countryOf(from);
    const to_iso = countryOf(to);
    let distance_km: number | null = null;
    let duration_min: number | null = null;
    let estado: RoadLeg["estado"] = "SIN_DATOS";
    let fuente: RoadLeg["fuente"] = null;
    let consultado_at: string | null = null;
    if (Number.isFinite(sec) && sec > 0 && Number.isFinite(m) && m > 0) {
      distance_km = Math.round(m / 1000);
      duration_min = Math.round(sec / 60);
      estado = "CONSULTADO";
      fuente = "google_routes";
      consultado_at = live?.consultado_at ?? null;
    } else {
      const est = estimateLeg(from, to);
      if (est) {
        distance_km = est.distance_km;
        duration_min = est.duration_min;
        estado = "ESTIMADO";
        fuente = "estimado_linea_recta";
      }
    }
    const base = { distance_km, from_iso, from };
    legs.push({
      index: i, from, to, from_iso, to_iso, distance_km, duration_min, estado, fuente, consultado_at,
      maps_url: mapsDrivingUrl([from, to]),
      crosses_border: !!(from_iso && to_iso && from_iso !== to_iso),
      date: input.legDates?.[i] ?? null,
      suggested_stops: suggestedStopsFor(from, to),
      fuel: fuelCost(base, fuelType, lPer100, `combustible-${i}`),
    });
  }
  if (!legs.length) return null;

  // Rentas: tramos en coche consecutivos = un mismo auto.
  const rentals: Rental[] = [];
  let group: RoadLeg[] = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0];
    const last = group[group.length - 1];
    const countries = [...new Set(group.flatMap((l) => [l.from_iso, l.to_iso]).filter((x): x is Iso => !!x))];
    const one_way = norm(first.from) !== norm(last.to);
    const cross_border = countries.length > 1;
    const warnings: string[] = [];
    if (one_way) {
      warnings.push(`Recoges en ${first.from} y devuelves en ${last.to}: la mayoría de las arrendadoras cobra un cargo por devolver el auto en otro lugar. El monto lo da la arrendadora al cotizar; IATOS no lo estima.`);
    }
    if (first.from_iso && last.to_iso && first.from_iso !== last.to_iso) {
      warnings.push(`Devolver en otro país (${COUNTRIES[last.to_iso].name}) suele tener un cargo mayor o no estar permitido: confírmalo antes de reservar.`);
    }
    if (cross_border) warnings.push(`Cruzas ${countries.length} países (${countries.map((c) => COUNTRIES[c].name).join(", ")}): confirma por escrito que el contrato lo permite.`);
    rentals.push({
      pickup_city: first.from, dropoff_city: last.to, pickup_date: first.date, dropoff_date: last.date ?? first.date,
      pickup_iso: first.from_iso, dropoff_iso: last.to_iso, one_way, cross_border, countries, leg_indexes: group.map((l) => l.index), warnings,
    });
    group = [];
  };
  for (const l of legs) {
    if (group.length && group[group.length - 1].index !== l.index - 1) flush();
    group.push(l);
  }
  flush();

  const carCountries = [...new Set(legs.flatMap((l) => [l.from_iso, l.to_iso]).filter((x): x is Iso => !!x))];
  const costs: CostItem[] = [];
  // Combustible por moneda (suma de tramos con estimación).
  const fuelBy = new Map<string, { monto: number; km: number; sources: Source[] }>();
  for (const l of legs) {
    if (l.fuel.monto === null || !l.fuel.moneda) continue;
    const cur = fuelBy.get(l.fuel.moneda) ?? { monto: 0, km: 0, sources: [] };
    cur.monto += l.fuel.monto;
    cur.km += l.distance_km ?? 0;
    if (l.fuel.fuente && !cur.sources.includes(l.fuel.fuente)) cur.sources.push(l.fuel.fuente);
    fuelBy.set(l.fuel.moneda, cur);
  }
  for (const [moneda, f] of fuelBy) {
    costs.push({
      id: `combustible-total-${moneda}`, concepto: `Combustible (${fuelType === "diesel" ? "diésel" : "gasolina"})`, monto: Math.round(f.monto * 100) / 100, moneda,
      estado: "ESTIMADO", fuente: f.sources[0] ?? null,
      detalle: `${f.km} km con consumo supuesto de ${lPer100} L/100 km y el precio promedio oficial de cada país. El consumo real depende del auto y de cómo manejes.`,
    });
  }
  const noFuel = legs.filter((l) => l.fuel.estado === "POR_CONFIRMAR" || l.fuel.estado === "SIN_DATOS");
  if (noFuel.length) {
    costs.push({
      id: "combustible-sin-precio", concepto: "Combustible de otros tramos", monto: null, moneda: null, estado: "POR_CONFIRMAR", fuente: null,
      detalle: `Sin precio oficial verificado o sin distancia para: ${noFuel.map((l) => `${l.from} → ${l.to}`).join("; ")}.`,
    });
  }
  // Viñetas (precio oficial) según los días con auto.
  for (const r of rentals) {
    const days = daysBetween(r.pickup_date, r.dropoff_date) ?? 10;
    for (const iso of r.countries) {
      const v = vignetteCost(iso, days);
      if (v && !costs.some((c) => c.id === v.id)) costs.push(v);
    }
  }
  for (const r of rentals) {
    costs.push({
      id: `renta-${r.leg_indexes[0]}`, concepto: `Renta del auto (${r.pickup_city} → ${r.dropoff_city})`, monto: null, moneda: null, estado: "POR_COTIZAR", fuente: null,
      detalle: "IATOS no tiene tarifas de renta en vivo: cotízala con el botón de reserva (el precio final lo da la arrendadora).",
    });
    if (r.one_way) {
      costs.push({
        id: `devolucion-${r.leg_indexes[0]}`, concepto: "Cargo por devolver en otro lugar", monto: null, moneda: null, estado: "POR_COTIZAR", fuente: null,
        detalle: "Lo fija cada arrendadora y aparece al cotizar; IATOS no lo estima.",
      });
    }
  }
  costs.push({
    id: "peajes", concepto: "Casetas / peajes", monto: null, moneda: null, estado: "POR_CONFIRMAR", fuente: null,
    detalle: "IATOS no tiene la tarifa por tramo; confírmala en el sitio de la autopista de cada país o en la ruta de Google Maps.",
  });
  costs.push({
    id: "estacionamiento", concepto: "Estacionamiento", monto: null, moneda: null, estado: "POR_CONFIRMAR", fuente: null,
    detalle: "Depende del hotel y de cada ciudad; pregunta al hotel si tiene estacionamiento (y si está dentro de una zona restringida).",
  });

  const totals_by_currency: Record<string, number> = {};
  for (const c of costs) {
    if (c.monto === null || !c.moneda) continue;
    totals_by_currency[c.moneda] = Math.round(((totals_by_currency[c.moneda] ?? 0) + c.monto) * 100) / 100;
  }

  const anyCross = rentals.some((r) => r.cross_border || (r.pickup_iso && r.dropoff_iso && r.pickup_iso !== r.dropoff_iso));
  const notices = NOTICES.filter((n) => (n.iso === "*" ? anyCross : carCountries.includes(n.iso)));

  const calls = Math.max(0, Number(input.apiCalls) || 0);
  return {
    version: 1,
    legs,
    rentals,
    costs,
    totals_by_currency,
    notices,
    assumptions: [
      `Consumo supuesto: ${lPer100} L/100 km (${fuelType === "diesel" ? "diésel" : "gasolina"}).`,
      `Tramos sin datos de Google: distancia en línea recta × ${ROAD_FACTOR} a ${AVG_KMH} km/h (ESTIMADO).`,
      "Los costos del auto se muestran aparte y no se suman al total del viaje.",
    ],
    api: {
      provider: "google_routes", sku: ROUTES_SKU, calls, list_price_usd: Math.round(calls * ROUTES_USD_PER_CALL * 1000) / 1000,
      free_per_month: 10000, source: SOURCES.GOOGLE_PRICING,
    },
    generated_at: input.now ?? new Date().toISOString(),
  };
}

// ─── Iato y "Ideas de road trips" ───

const ROADTRIP_WORDS = /\b(road ?trip|roadtrip|roadtrips|en (coche|auto|carro)|manejando|rentar (un )?(coche|auto|carro)|ruta en (coche|auto|carro)|viaje en (coche|auto|carro))\b/;

export type RoadTripIntent = { isRoadTrip: boolean; route: CuratedRoute | null; days: number | null };

export function findCuratedRoute(text: unknown): CuratedRoute | null {
  const t = ` ${norm(text)} `;
  let best: { r: CuratedRoute; len: number } | null = null;
  for (const r of CURATED_ROUTES) {
    for (const a of r.aliases) if (t.includes(` ${a} `) && (!best || a.length > best.len)) best = { r, len: a.length };
  }
  return best?.r ?? null;
}

/** "quiero hacer un road trip por la Toscana en 7 días" → { isRoadTrip, route: toscana, days: 7 }. */
export function detectRoadTrip(text: unknown): RoadTripIntent {
  const t = norm(text);
  const isRoadTrip = ROADTRIP_WORDS.test(t);
  const route = findCuratedRoute(t);
  const d = /\b(\d{1,2})\s*(dias|dia|noches|noche)\b/.exec(t);
  const w = /\b(una|1|dos|2)\s*semanas?\b/.exec(t);
  const days = d ? Number(d[1]) : w ? (/(dos|2)/.test(w[1]) ? 14 : 7) : null;
  return { isRoadTrip, route, days: days && days > 0 && days <= 60 ? days : null };
}

/** Paradas sin repetir la vuelta al inicio (los circuitos terminan donde empiezan). */
export const uniqueStops = (r: CuratedRoute) => r.stops.filter((s, i) => r.stops.indexOf(s) === i);

/** Reparte los días entre las paradas (el sobrante a las primeras); con menos días que paradas, agrupa. */
export function splitDays(r: CuratedRoute, days?: number | null): Array<{ day: number; stops: string[] }> {
  const stops = uniqueStops(r);
  const n = Math.max(1, Math.round(Number(days) || r.days_suggested));
  const out: Array<{ day: number; stops: string[] }> = [];
  if (n >= stops.length) {
    const base = Math.floor(n / stops.length);
    let extra = n - base * stops.length;
    let day = 1;
    for (const s of stops) {
      const k = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      for (let j = 0; j < k; j++) out.push({ day: day++, stops: [s] });
    }
    return out;
  }
  const per = Math.ceil(stops.length / n);
  for (let i = 0; i < n; i++) {
    const chunk = stops.slice(i * per, (i + 1) * per);
    if (chunk.length) out.push({ day: i + 1, stops: chunk });
  }
  return out;
}

/** Enlace a la ruta de varios destinos de IATOS con las paradas y el coche ya elegidos. */
export function routePlannerPath(r: CuratedRoute, days?: number | null): string {
  const p = new URLSearchParams({ destinos: r.stops.join("|"), modo: "coche", ruta: r.id });
  if (days) p.set("dias", String(days));
  return `/dashboard/ruta?${p.toString()}`;
}
