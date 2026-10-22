// Traduce los argumentos que la IA usa en cada herramienta a los que espera la función del
// servidor. Sin esto, search_flights mandaba `departure_date`/`adults` a flights-search (que lee
// `depart`/`travelers`): la búsqueda llegaba sin fecha, volvía vacía y la IA inventaba una excusa.
export function toolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "search_flights") {
    const ret = args.return_date || undefined;
    return {
      origin: args.origin,
      destination: args.destination,
      depart: args.departure_date ?? args.depart,
      return_date: ret,
      travelers: args.adults ?? args.travelers ?? 1,
      type: ret ? "round" : "oneway",
    };
  }
  return args;
}

/** Línea de contexto con la fecha de hoy, para que la IA no tome fechas pasadas por futuras. */
export function todayLine(todayISO: string): string {
  const d = new Date(`${todayISO}T12:00:00Z`);
  const larga = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `FECHA DE HOY: ${larga} (${todayISO}). Toda fecha anterior ya pasó. Las aerolíneas venden vuelos hasta ~11 meses adelante: si el usuario pide fechas dentro de ese rango, busca y muestra los resultados; si una búsqueda no trae resultados, dilo tal cual, sin inventar el motivo.`;
}

const MAX_STRING = 400;

/**
 * Reduce el resultado de una herramienta para que quepa en el contexto sin romper el JSON.
 * Antes se cortaba el texto a 6000 caracteres y se volvía a parsear: con más de ~8 vuelos el
 * JSON quedaba inválido y la IA recibía un error en lugar de los resultados. Ahora se recortan
 * textos largos y, si aún no cabe, se quitan elementos del final de la lista más larga.
 */
export function slimToolResult(value: unknown, maxChars = 6000): unknown {
  const shorten = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
    if (Array.isArray(v)) return v.map(shorten);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)]));
    return v;
  };
  const out = shorten(value);
  const size = () => JSON.stringify(out).length;

  const longestArray = (v: unknown): unknown[] | null => {
    let best: unknown[] | null = null;
    const visit = (x: unknown) => {
      if (Array.isArray(x)) {
        if (x.length > 1 && (!best || JSON.stringify(x).length > JSON.stringify(best).length)) best = x;
        x.forEach(visit);
      } else if (x && typeof x === "object") Object.values(x).forEach(visit);
    };
    visit(v);
    return best;
  };

  let trimmed = false;
  while (size() > maxChars) {
    const arr = longestArray(out);
    if (!arr) break;
    arr.pop();
    trimmed = true;
  }
  if (size() > maxChars) return { error: "resultado demasiado grande", truncated: true };
  if (trimmed && out && typeof out === "object" && !Array.isArray(out)) (out as Record<string, unknown>).truncated = true;
  return out;
}
