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

/**
 * Marca lo que se armó con la lista del proveedor de este request. Travelpayouts es caché de
 * búsquedas de otros viajeros (hasta 48 h): queda como precio de referencia ESTIMADO, nunca "en vivo".
 */
export function markLive<T extends Record<string, any>>(items: T[], field: string, source: string, consultadoAt: string, approximate = false): T[] {
  const reference = source === "travelpayouts";
  return items.map((x: any) => ({
    ...x,
    [field]: source,
    consultado_at: consultadoAt,
    ...(approximate ? { approximate_dates: true } : {}),
    estado_dato: approximate || reference ? "ESTIMADO" : "CONSULTADO_EN_VIVO",
  }));
}

const PLACE_SOURCES = new Set(["tripadvisor", "google_places", "google_maps"]);

/**
 * Experiencias: el nombre y rating solo cuentan como reales si el lugar está en la lista de
 * atracciones que tripadvisor-search devolvió en este request (TripAdvisor o, si no responde,
 * Google Places / Google Maps: `source`). El precio siempre es una estimación.
 */
export function labelExperiences(items: unknown, attractions: Array<{ name?: string }> | null, source = "tripadvisor"): any[] {
  return (Array.isArray(items) ? items : []).map((e: any) => {
    const real = !!attractions?.length && PLACE_SOURCES.has(e?.fuente) && attractions.some((a) => samePlace(a?.name, e?.nombre ?? e?.name));
    const out = { ...e, fuente: real ? source : "estimado", estado_dato: "ESTIMADO" };
    if (!real) { out.rating = PLACE_SOURCES.has(e?.fuente) ? null : e?.rating ?? null; }
    return out;
  });
}

/** Resumen de fuentes por categoría, calculado DESPUÉS de etiquetar. */
export function pricingSources(flights: any[], perDestination: any[]) {
  return {
    vuelos: flights.some((f) => f?.fuente_precio === "travelpayouts") ? "travelpayouts" : "estimado",
    hospedaje: perDestination.some((pd) => (pd?.hospedaje ?? []).some((h: any) => h?.fuente_precio === "serpapi")) ? "serpapi" : "estimado",
    experiencias: (() => {
      for (const pd of perDestination) for (const e of pd?.experiencias ?? []) if (PLACE_SOURCES.has(e?.fuente)) return e.fuente;
      return "estimado";
    })(),
  };
}
