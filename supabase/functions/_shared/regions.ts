// Regiones turísticas → ciudades base reales (tabla curada, sin IA). Sin Deno: lo usan logistics-plan
// y el cliente (MultiDestRoute) para que "Roma, Venecia, Florencia, Toscana" no busque hotel en
// "Toscana" ni arme el tramo "Florencia → Toscana": la Toscana se recorre por sus ciudades (Siena, Lucca…).
// Una región que no está aquí se queda como está (no se inventan pueblos), salvo que _shared/placeResolve.ts
// la reconozca con Google Geocoding y traiga sus ciudades de Wikidata: esas llegan como `lookup` a
// expandRegions (la tabla curada siempre gana).

export type Region = {
  /** Nombre que se muestra ("Toscana"). */
  name: string;
  /** Nombres con que la puede escribir la persona (es/en/it), además de name. */
  aliases: string[];
  /** Bases en orden de preferencia: [nombre, ...alias]. */
  bases: string[][];
  /** "route": carretera (sus paradas van en orden y se toman todas, hasta 4). Sin valor: región o país. */
  kind?: "route";
  /** "wikidata": bases traídas en vivo de Wikidata (placeResolve.ts); sin valor, la tabla curada. */
  source?: "wikidata";
};

export const REGIONS: Region[] = [
  { name: "Toscana", aliases: ["tuscany", "toscane"],
    // Capitales de provincia de la Toscana (Florencia primero: capital regional) + pueblos clásicos.
    bases: [["Florencia", "florence", "firenze"], ["Siena"], ["Lucca"], ["Pisa"], ["Arezzo"], ["San Gimignano"],
      ["Montepulciano"], ["Pistoia"], ["Prato"], ["Livorno"], ["Grosseto"], ["Massa-Carrara", "massa", "carrara", "massa carrara"]] },
  { name: "Costa Amalfitana", aliases: ["costa de amalfi", "amalfi coast", "costiera amalfitana"],
    bases: [["Positano"], ["Amalfi"], ["Ravello"], ["Sorrento"]] },
  { name: "Cinque Terre", aliases: ["cinco tierras"],
    bases: [["Monterosso al Mare", "monterosso"], ["Vernazza"], ["La Spezia"]] },
  { name: "Provenza", aliases: ["provence"],
    bases: [["Aix-en-Provence"], ["Aviñón", "avignon"], ["Gordes"]] },
  { name: "Andalucía", aliases: ["andalusia", "andalousie"],
    bases: [["Sevilla", "seville"], ["Granada"], ["Córdoba", "cordoba"], ["Málaga"]] },
  { name: "Normandía", aliases: ["normandy", "normandie"],
    bases: [["Bayeux"], ["Honfleur"], ["Rouen", "ruan"]] },
  { name: "Riviera Francesa", aliases: ["costa azul", "cote d azur", "french riviera", "costa azzurra"],
    bases: [["Niza", "nice", "nizza"], ["Cannes"], ["Mónaco", "monaco", "monte carlo", "montecarlo"]] },
  { name: "Dolomitas", aliases: ["dolomites", "dolomiti"],
    bases: [["Cortina d'Ampezzo", "cortina"], ["Ortisei"], ["Bolzano"]] },
  { name: "Lago de Como", aliases: ["lago di como", "lake como"],
    bases: [["Como"], ["Bellagio"], ["Varenna"]] },
  { name: "Riviera Maya", aliases: ["mayan riviera"],
    bases: [["Playa del Carmen"], ["Tulum"], ["Cancún", "cancun"]] },
  { name: "Algarve", aliases: [],
    bases: [["Lagos"], ["Faro"]] },
  { name: "Napa Valley", aliases: ["valle de napa"],
    bases: [["Napa"], ["St. Helena", "saint helena", "st helena"]] },
  { name: "Puglia", aliases: ["apulia", "pulla"],
    bases: [["Bari"], ["Alberobello"], ["Lecce"]] },
  { name: "Sicilia", aliases: ["sicily", "sicile"],
    bases: [["Palermo"], ["Taormina"], ["Siracusa", "syracuse"]] },
  { name: "Cerdeña", aliases: ["sardinia", "sardegna", "cerdena"],
    bases: [["Cagliari"], ["Alghero"], ["Olbia"]] },
  { name: "Umbría", aliases: ["umbria"],
    bases: [["Perugia"], ["Asís", "assisi"], ["Orvieto"]] },
  { name: "Costa Brava", aliases: [],
    bases: [["Girona", "gerona"], ["Cadaqués"], ["Tossa de Mar"]] },
  { name: "Valle del Loira", aliases: ["loire valley", "vallee de la loire", "loira"],
    bases: [["Tours"], ["Amboise"]] },
  { name: "Borgoña", aliases: ["burgundy", "bourgogne", "borgona"],
    bases: [["Beaune"], ["Dijon"]] },
  { name: "Alsacia", aliases: ["alsace"],
    bases: [["Estrasburgo", "strasbourg"], ["Colmar"]] },
];

/** Sin acentos, minúsculas, sin país tras la coma, sin artículo inicial ("la Toscana"). */
export function normPlace(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(",")[0]
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(la|el|los|las|the) /, "");
}

const BY_NAME = new Map<string, Region>();
for (const r of REGIONS) for (const n of [r.name, ...r.aliases]) BY_NAME.set(normPlace(n), r);

/** Región de la tabla ("tuscany" → Toscana) o null si es una ciudad o algo que no conocemos. */
export function findRegion(input: unknown): Region | null {
  return BY_NAME.get(normPlace(input)) ?? null;
}

/** Cuántas bases según las noches en la región: ≤2 → 1; 3–4 → 2; ≥5 → 3. Sin noches, 2. */
export function basesForNights(nights: number | null | undefined): number {
  if (!Number.isFinite(nights as number) || (nights as number) < 1) return 2;
  const n = nights as number;
  return n <= 2 ? 1 : n <= 4 ? 2 : 3;
}

/** Reparto como splitNights del servidor: base igual y el sobrante a las primeras. */
function split(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const arr = new Array(parts).fill(base);
  for (let i = 0; i < total - base * parts; i++) arr[i] += 1;
  return arr;
}

export type RegionExpansion = {
  region: string;
  ciudades: string[];
  /** "wikidata" si las ciudades no salen de la tabla curada sino de Wikidata (CC0). */
  fuente?: "wikidata";
  /** "carretera": las ciudades son paradas de una carretera (Ruta 66 → Chicago · Santa Mónica). */
  tipo?: "carretera";
};

/** Paradas de una carretera que se toman como máximo. */
export const MAX_ROUTE_STOPS = 4;

/** Llave de un destino escrito completo (con lo que va tras la coma: "Córdoba, Argentina"). */
export function placeKey(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9,]+/g, " ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
}

/** Lo mínimo de una resolución de placeResolve.ts que hace falta para expandir un destino. */
export type ResolvedPlace = {
  input: string;
  status: string;
  kind?: string;
  name?: string;
  bases?: string[];
};

/** Región dinámica (país, región o carretera con ciudades de Wikidata) o null si no aplica. */
export function regionFromPlace(p: ResolvedPlace | null | undefined): Region | null {
  if (!p || p.status !== "ok" || !p.name || !Array.isArray(p.bases) || !p.bases.length) return null;
  if (p.kind !== "country" && p.kind !== "region" && p.kind !== "route") return null;
  return { name: p.name, aliases: [p.input], bases: p.bases.map((b) => [b]), source: "wikidata", ...(p.kind === "route" ? { kind: "route" as const } : {}) };
}

/** Búsqueda de regiones dinámicas por lo que escribió la persona (o por su nombre canónico). */
export function placeLookup(places: Array<ResolvedPlace | null | undefined>): (d: string) => Region | null {
  const map = new Map<string, Region>();
  for (const p of places) {
    const r = regionFromPlace(p);
    if (!r) continue;
    map.set(placeKey(p!.input), r);
    if (!map.has(placeKey(r.name))) map.set(placeKey(r.name), r);
  }
  return (d) => map.get(placeKey(d)) ?? null;
}
export type ExpandResult = {
  destinations: string[];
  /** Noches por destino ya repartidas; tal cual (o undefined) si no venían una por destino. */
  nightsPerCity: number[] | undefined;
  expansions: RegionExpansion[];
  /** Índice del destino original de cada destino de salida (para remapear modos por tramo). */
  sourceIndex: number[];
};

/**
 * Cambia cada región conocida por 1 a 3 bases reales según sus noches, sin repetir ciudades que ya
 * están en la lista, repartiendo las noches de la región entre sus bases. Lo demás pasa intacto.
 * `choices` (opcional): bases que eligió la persona por región ({ "Toscana": ["Siena","Lucca"] });
 * solo se aceptan bases de la tabla (o de la lista de Wikidata de esa región dinámica).
 * `lookup` (opcional): regiones dinámicas (placeLookup); solo se consulta si la tabla no la conoce.
 */
export function expandRegions(
  destinations: string[],
  nightsPerCity?: number[] | null,
  choices?: Record<string, unknown> | null,
  lookup?: ((d: string) => Region | null) | null,
): ExpandResult {
  const regionOf = (d: string): Region | null => findRegion(d) ?? lookup?.(d) ?? null;
  const list = (Array.isArray(destinations) ? destinations : []).map((d) => String(d ?? ""));
  const nightsOk = Array.isArray(nightsPerCity) && nightsPerCity.length === list.length
    && nightsPerCity.every((n) => Number.isInteger(n) && n >= 1);
  const used = new Set(list.filter((d) => !regionOf(d)).map(normPlace));
  const outD: string[] = [];
  const outN: number[] = [];
  const sourceIndex: number[] = [];
  const expansions: RegionExpansion[] = [];

  list.forEach((d, i) => {
    const region = regionOf(d);
    const nights = nightsOk ? nightsPerCity![i] : null;
    const keep = () => { outD.push(d); if (nights != null) outN.push(nights); sourceIndex.push(i); };
    if (!region) return keep();
    const free = region.bases.filter((b) => !b.some((n) => used.has(normPlace(n))));
    const chosenRaw = choices ? (choices[region.name] ?? choices[normPlace(d)]) : null;
    const chosen = Array.isArray(chosenRaw)
      ? free.filter((b) => chosenRaw.some((c) => b.some((n) => normPlace(n) === normPlace(c))))
      : [];
    const want = region.kind === "route" ? MAX_ROUTE_STOPS : basesForNights(nights);
    let picks = chosen.length ? chosen : free.slice(0, want);
    if (nights != null) picks = picks.slice(0, nights);
    if (!picks.length) return keep();
    const names = picks.map((b) => b[0]);
    // Ciudad-estado (Singapur → Singapur): no hay nada que expandir.
    if (names.length === 1 && normPlace(names[0]) === normPlace(d)) return keep();
    const share = nights != null ? split(nights, names.length) : null;
    names.forEach((n, k) => {
      outD.push(n);
      if (share) outN.push(share[k]);
      sourceIndex.push(i);
      used.add(normPlace(n));
    });
    expansions.push({
      region: region.name, ciudades: names,
      ...(region.source ? { fuente: region.source } : {}),
      ...(region.kind === "route" ? { tipo: "carretera" as const } : {}),
    });
  });

  return {
    destinations: outD,
    nightsPerCity: nightsOk ? outN : (nightsPerCity ?? undefined),
    expansions,
    sourceIndex,
  };
}

/**
 * Modos por tramo ("mixto") de la lista original llevados a la lista expandida: el tramo que entra a
 * una región conserva su modo; entre bases de la misma región, coche (pueblos sin tren directo).
 */
export function expandLegModes(legModes: unknown, sourceIndex: number[]): unknown {
  if (!Array.isArray(legModes)) return legModes;
  return sourceIndex.slice(1).map((to, j) => (sourceIndex[j] === to ? "coche" : legModes[sourceIndex[j]]));
}

/** "Toscana: te armamos la ruta por Siena y Montepulciano". */
export function expansionLine(e: RegionExpansion, opts: { brought?: boolean } = {}): string {
  const c = e.ciudades;
  const lista = c.length > 1 ? `${c.slice(0, -1).join(", ")} y ${c[c.length - 1]}` : c[0] ?? "";
  return `${e.region}: ${opts.brought ? "tu ruta por" : "te armamos la ruta por"} ${lista}${e.fuente === "wikidata" ? " (ciudades según Wikidata)" : ""}`;
}
