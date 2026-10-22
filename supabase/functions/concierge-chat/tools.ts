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
