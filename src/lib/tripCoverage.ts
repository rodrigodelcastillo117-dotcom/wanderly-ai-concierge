// Cobertura de lo escrito en el planeador: cada lugar (ciudad, país, región o algo que no reconocemos)
// se conserva EN SU ORDEN y se resuelve uno por uno. Caso del dueño (28-oct-2026): "Hungría, atenas y
// paris" mostraba "Entendimos: Atenas → París · ruta de 2 ciudades" y Hungría desaparecía.
//
// - Ciudad: va tal cual.
// - País o región: Iato PROPONE ciudades (Hungría → Budapest; Toscana → sus bases), pero queda pendiente
//   hasta que la persona confirma, elige otras o lo quita (exclusión aprobada).
// - Lo que no reconocemos: pendiente con "¿qué ciudad es?" (candidatos de place-resolve si los hay).
// - Nada se genera mientras haya pendientes. Nada se descarta en silencio.
// Puro (sin red): lo prueba src/test/viajeComplejo.test.ts.
import type { PlaceItem } from "@/lib/multiCityText";
import { countryRouteFor } from "@/lib/countryRoutes";
import { COUNTRIES as PICKER_COUNTRIES } from "@/lib/countriesCities";
import { CITIES as AIRPORT_CITIES } from "../../supabase/functions/_shared/airports.ts";
import { basesForNights, findRegion, normPlace, type Region } from "../../supabase/functions/_shared/regions.ts";

export type RefAnswer = { cities: string[] } | { excluir: true };

export type RouteItem = {
  /** Llave estable (tipo + texto normalizado). */
  key: string;
  kind: PlaceItem["kind"];
  /** Como lo escribió la persona ("Hungría"). */
  text: string;
  /** Ciudades que aporta a la ruta (confirmadas o propuestas). */
  cities: string[];
  /** Propuesta de Iato (aún no confirmada). */
  suggested: string[];
  pending: boolean;
  excluded: boolean;
};

export const itemKey = (it: Pick<PlaceItem, "kind" | "name">) => `${it.kind}:${normPlace(it.name)}`;

/** Ciudad principal de un país: la ruta curada, el catálogo de aeropuertos o el selector de origen. */
export function mainCityOf(country: string): string | null {
  const curated = countryRouteFor(country);
  if (curated?.stops[0]) return curated.stops[0].city;
  const k = normPlace(country);
  const ap = AIRPORT_CITIES.find((c) => normPlace(c.country) === k);
  if (ap) return ap.name;
  const pk = PICKER_COUNTRIES.find((c) => normPlace(c.name) === k);
  return pk?.cities[0] ?? null;
}

export type CoverageResult = {
  items: RouteItem[];
  /** Ciudades de la ruta en el orden escrito (incluye las propuestas pendientes, para mostrarlas). */
  cities: string[];
  /** Etiqueta por ciudad: "Budapest (Hungría)". */
  labels: string[];
  pending: RouteItem[];
  /** Validador: lugares escritos que no terminaron en ciudad, pendiente o exclusión (debe ser []). */
  missing: string[];
};

/**
 * Ruta a partir de lo escrito, en orden. `lookup`: regiones dinámicas de place-resolve (Wikidata) para
 * países/regiones que no están en las tablas. `nights`: noches del viaje (más noches → más bases por región).
 */
export function routeFromItems(items: PlaceItem[], answers: Record<string, RefAnswer>, opts: { nights?: number | null; lookup?: ((d: string) => Region | null) | null } = {}): CoverageResult {
  const written = new Set(items.filter((i) => i.kind === "city").map((i) => normPlace(i.name)));
  const used = new Set<string>(written);
  const multi = items.length > 1;
  const out: RouteItem[] = items.map((it) => {
    const key = itemKey(it);
    const base = { key, kind: it.kind, text: it.text || it.name, suggested: [] as string[], pending: false, excluded: false };
    if (it.kind === "city") return { ...base, cities: [it.name] };
    const ans = answers[key];
    if (ans && "excluir" in ans) return { ...base, cities: [], excluded: true };
    if (ans && "cities" in ans && ans.cities.length) {
      ans.cities.forEach((c) => used.add(normPlace(c)));
      return { ...base, cities: ans.cities };
    }
    let suggested: string[] = [];
    if (it.kind === "region") {
      const r = findRegion(it.name) ?? opts.lookup?.(it.name) ?? null;
      const free = (r?.bases ?? []).filter((b) => !b.some((n) => used.has(normPlace(n)))).map((b) => b[0]);
      suggested = free.slice(0, basesForNights(opts.nights ?? null));
    } else if (it.kind === "country") {
      // Con más lugares en la frase, el país aporta su ciudad principal (Hungría → Budapest) y se pregunta;
      // solo, la ruta curada del país (la propuesta de siempre).
      const curated = countryRouteFor(it.name);
      if (!multi && curated) suggested = [...new Set(curated.stops.map((s) => s.city))];
      else {
        const main = mainCityOf(it.name) ?? opts.lookup?.(it.name)?.bases[0]?.[0] ?? null;
        suggested = main && !used.has(normPlace(main)) ? [main] : [];
      }
    } else {
      const r = opts.lookup?.(it.name);
      suggested = r ? r.bases.slice(0, 1).map((b) => b[0]) : [];
    }
    suggested.forEach((c) => used.add(normPlace(c)));
    return { ...base, cities: suggested, suggested, pending: true };
  });
  const cities: string[] = [];
  const labels: string[] = [];
  for (const it of out) {
    for (const c of it.cities) {
      cities.push(c);
      labels.push(it.kind === "country" || it.kind === "region" ? `${c} (${it.text})` : c);
    }
  }
  const missing = out.filter((it) => !it.cities.length && !it.pending && !it.excluded).map((it) => it.text);
  return { items: out, cities, labels, pending: out.filter((it) => it.pending), missing };
}

/** ¿Hay algo escrito que no es una ciudad conocida? (entonces hay que confirmar antes de armar). */
export const needsReview = (items: PlaceItem[]) => items.some((i) => i.kind !== "city");
