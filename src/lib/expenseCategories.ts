/**
 * Categorías de gasto de viaje (Gastos, Smart Spend y el resumen del inicio).
 *
 * El valor que se guarda en expenses.category es la etiqueta en español (como siempre). La
 * columna es texto libre (sin CHECK en la base), así que las filas viejas siguen siendo válidas:
 * al leerlas se traducen a la categoría nueva equivalente con `canonicalCategory`, sin migrar
 * datos. Una categoría desconocida se muestra tal cual (nunca se pierde un gasto) y en las
 * gráficas cae en "Otros".
 */

export type ExpenseCategory = {
  /** Lo que se guarda en la base y se muestra. */
  value: string;
  /** Ayuda corta en el selector. */
  hint: string;
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { value: "Vuelos", hint: "Boletos de avión, equipaje, asientos" },
  { value: "Hospedaje", hint: "Hotel, renta vacacional, hostal" },
  { value: "Restaurantes", hint: "Comidas, cafés, súper" },
  { value: "Bares y vida nocturna", hint: "Bares, antros, conciertos de noche" },
  { value: "Tours y experiencias", hint: "Tours, museos, entradas, actividades" },
  { value: "Transporte local", hint: "Taxi, metro, tren, renta de auto, gasolina" },
  { value: "Compras", hint: "Ropa, souvenirs, duty free" },
  { value: "Salud y farmacia", hint: "Medicinas, consultas" },
  { value: "Seguros", hint: "Seguro de viaje o de auto" },
  { value: "Visas y trámites", hint: "Visas, ETA/ESTA, pasaporte, impuestos de salida" },
  { value: "Conectividad / eSIM", hint: "eSIM, roaming, wifi" },
  { value: "Propinas", hint: "Propinas y servicio" },
  { value: "Comisiones bancarias", hint: "Comisiones por cambio, retiros en cajero" },
  { value: "Regalos", hint: "Regalos para otros" },
  { value: "Otros", hint: "Todo lo demás" },
];

export const DEFAULT_EXPENSE_CATEGORY = "Restaurantes";
export const OTHER_CATEGORY = "Otros";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Valores viejos (y sinónimos frecuentes) → categoría nueva. Claves sin acentos, en minúsculas. */
const LEGACY: Record<string, string> = {
  // Las 5 categorías anteriores del formulario.
  alojamiento: "Hospedaje",
  gastronomia: "Restaurantes",
  experiencias: "Tours y experiencias",
  transporte: "Transporte local",
  otros: "Otros",
  // Sinónimos que aparecen en datos viejos o importados.
  hotel: "Hospedaje",
  hoteles: "Hospedaje",
  comida: "Restaurantes",
  comidas: "Restaurantes",
  restaurante: "Restaurantes",
  vuelo: "Vuelos",
  avion: "Vuelos",
  tours: "Tours y experiencias",
  tour: "Tours y experiencias",
  actividades: "Tours y experiencias",
  bares: "Bares y vida nocturna",
  "vida nocturna": "Bares y vida nocturna",
  salud: "Salud y farmacia",
  farmacia: "Salud y farmacia",
  seguro: "Seguros",
  visas: "Visas y trámites",
  visa: "Visas y trámites",
  esim: "Conectividad / eSIM",
  conectividad: "Conectividad / eSIM",
  propina: "Propinas",
  comisiones: "Comisiones bancarias",
  regalo: "Regalos",
};

const BY_NORM = new Map(EXPENSE_CATEGORIES.map((c) => [norm(c.value), c.value]));

/** Categoría vigente para un valor guardado. Desconocido → el mismo texto (no se inventa). */
export function canonicalCategory(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t) return OTHER_CATEGORY;
  const k = norm(t);
  return BY_NORM.get(k) ?? LEGACY[k] ?? t;
}

export function isKnownCategory(raw: string | null | undefined): boolean {
  return BY_NORM.has(norm(canonicalCategory(raw)));
}

/**
 * Colores de las gráficas. Paleta categórica validada (contraste, daltonismo y distancia entre
 * vecinos) sobre la superficie oscura de la app, en orden fijo: el color sigue a la categoría, no a
 * su lugar en el ranking. Solo las 7 categorías más comunes tienen color propio; las demás van en
 * gris y en la dona se agrupan como "Otras categorías" (más de 7 colores ya no se distinguen).
 */
export const CATEGORY_COLORS: Record<string, string> = {
  Hospedaje: "#3987e5",
  Vuelos: "#d95926",
  Restaurantes: "#199e70",
  "Tours y experiencias": "#c98500",
  Compras: "#d55181",
  "Transporte local": "#008300",
  "Bares y vida nocturna": "#9085e9",
};
export const OTHER_COLOR = "#6b6b6b";
export const OTHER_GROUP_LABEL = "Otras categorías";

export function categoryColor(cat: string): string {
  return CATEGORY_COLORS[canonicalCategory(cat)] ?? OTHER_COLOR;
}

/** Suma por categoría vigente (las filas viejas caen en su categoría nueva). */
export function regroupByCategory(byCat: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(byCat)) {
    const c = canonicalCategory(k);
    out[c] = (out[c] ?? 0) + v;
  }
  return out;
}

export type CategorySlice = { name: string; value: number; color: string };

/**
 * Rebanadas de la dona en el orden fijo de la paleta (así los vecinos son los validados) y el
 * resto sumado en "Otras categorías", al final y en gris.
 */
export function donutSlices(byCat: Record<string, number>): CategorySlice[] {
  const g = regroupByCategory(byCat);
  const slices: CategorySlice[] = [];
  let other = 0;
  for (const [name, color] of Object.entries(CATEGORY_COLORS)) {
    if ((g[name] ?? 0) > 0) slices.push({ name, value: g[name], color });
  }
  for (const [name, v] of Object.entries(g)) {
    if (!(name in CATEGORY_COLORS) && v > 0) other += v;
  }
  if (other > 0) slices.push({ name: OTHER_GROUP_LABEL, value: other, color: OTHER_COLOR });
  return slices;
}

/** Desglose completo: cada categoría con gasto, de mayor a menor. */
export function categoryBreakdown(byCat: Record<string, number>): { name: string; value: number; pct: number; color: string }[] {
  const g = regroupByCategory(byCat);
  const total = Object.values(g).reduce((a, b) => a + b, 0);
  return Object.entries(g)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, pct: total > 0 ? (value / total) * 100 : 0, color: categoryColor(name) }));
}
