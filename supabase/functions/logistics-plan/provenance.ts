// Origen de los precios de logistics-plan (sin Deno, para probarlo).
//
// El modelo NO decide si un precio es "en vivo": solo lo es lo que este request trajo de un
// proveedor. Antes, en la rama sin datos en vivo se hacía `fuente_precio ?? "estimado"`, así que
// si el modelo escribía "travelpayouts" o "serpapi" la etiqueta se quedaba y se mostraba
// "Precio verificado en vivo".

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mismo lugar: nombres iguales o el corto (de 2+ palabras) dentro del largo. */
export function samePlace(a: unknown, b: unknown): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.split(" ").length >= 2 && ` ${long} `.includes(` ${short} `);
}

/** Marca como estimado todo lo que el modelo produjo sin datos en vivo. */
export function forceEstimated<T extends Record<string, any>>(items: T[] | unknown, field = "fuente_precio"): T[] {
  return (Array.isArray(items) ? items : []).map((x: any) => {
    const out = { ...x, [field]: "estimado", estado_dato: "ESTIMADO" };
    delete out.consultado_at;
    return out;
  });
}

/** Marca como consultado en vivo lo que se armó con la lista del proveedor de este request. */
export function markLive<T extends Record<string, any>>(items: T[], field: string, source: string, consultadoAt: string, approximate = false): T[] {
  return items.map((x: any) => ({
    ...x,
    [field]: source,
    consultado_at: consultadoAt,
    ...(approximate ? { approximate_dates: true, estado_dato: "ESTIMADO" } : { estado_dato: "CONSULTADO_EN_VIVO" }),
  }));
}

/**
 * Experiencias: el nombre y rating solo cuentan como TripAdvisor si el lugar está en la lista de
 * atracciones que TripAdvisor devolvió en este request. El precio siempre es una estimación.
 */
export function labelExperiences(items: unknown, attractions: Array<{ name?: string }> | null): any[] {
  return (Array.isArray(items) ? items : []).map((e: any) => {
    const real = !!attractions?.length && e?.fuente === "tripadvisor" && attractions.some((a) => samePlace(a?.name, e?.nombre ?? e?.name));
    const out = { ...e, fuente: real ? "tripadvisor" : "estimado", estado_dato: "ESTIMADO" };
    if (!real) { out.rating = e?.fuente === "tripadvisor" ? null : e?.rating ?? null; }
    return out;
  });
}

/** Resumen de fuentes por categoría, calculado DESPUÉS de etiquetar. */
export function pricingSources(flights: any[], perDestination: any[]) {
  return {
    vuelos: flights.some((f) => f?.fuente_precio === "travelpayouts") ? "travelpayouts" : "estimado",
    hospedaje: perDestination.some((pd) => (pd?.hospedaje ?? []).some((h: any) => h?.fuente_precio === "serpapi")) ? "serpapi" : "estimado",
    experiencias: perDestination.some((pd) => (pd?.experiencias ?? []).some((e: any) => e?.fuente === "tripadvisor")) ? "tripadvisor" : "estimado",
  };
}
