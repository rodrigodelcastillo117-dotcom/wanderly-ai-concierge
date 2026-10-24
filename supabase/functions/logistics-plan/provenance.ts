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
export function labelExperiences(items: unknown, attractions: Array<{ name?: string; place_id?: string | null; web_url?: string | null; rating?: number | null; num_reviews?: number | null }> | null, source = "tripadvisor"): any[] {
  return (Array.isArray(items) ? items : []).map((e: any) => {
    const match = attractions?.length && PLACE_SOURCES.has(e?.fuente) ? attractions.find((a) => samePlace(a?.name, e?.nombre ?? e?.name)) : null;
    const real = !!match;
    const out = { ...e, fuente: real ? source : "estimado", estado_dato: "ESTIMADO" };
    // Sin la lista del proveedor la calificación es del modelo: nunca se muestra (auditoría 23-oct-2026).
    if (!real) out.rating = null;
    else {
      // Calificación, place_id y ficha de Maps del proveedor (antes se perdían en el multidestino).
      out.rating = typeof match.rating === "number" ? match.rating : null;
      if (typeof match.num_reviews === "number") out.num_reviews = match.num_reviews;
      if (typeof match.place_id === "string" && match.place_id) out.place_id = match.place_id;
      if (source !== "tripadvisor" && typeof match.web_url === "string" && match.web_url) out.maps_url = match.web_url;
    }
    return out;
  });
}

/** Resumen de fuentes por categoría, calculado DESPUÉS de etiquetar. */
export function pricingSources(flights: any[], perDestination: any[]) {
  return {
    vuelos: flights.some((f) => f?.fuente_precio === "en_vivo") ? "google_flights" : flights.some((f) => f?.fuente_precio === "travelpayouts") ? "travelpayouts" : "estimado",
    hospedaje: perDestination.some((pd) => (pd?.hospedaje ?? []).some((h: any) => h?.fuente_precio === "serpapi")) ? "serpapi" : "estimado",
    experiencias: (() => {
      for (const pd of perDestination) for (const e of pd?.experiencias ?? []) if (PLACE_SOURCES.has(e?.fuente)) return e.fuente;
      return "estimado";
    })(),
  };
}

/**
 * Vuelo estimado por el modelo (sin tarifa de un proveedor): no se afirma aerolínea ni "Directo".
 * Caso 22-oct-2026: "Iberia · Directo · 15h 20m" MEX→Roma, inventado y presentado como dato.
 */
export function scrubEstimatedFlight<T extends Record<string, any>>(f: T): T {
  const out: Record<string, any> = { ...f, fuente_precio: "estimado", estado_dato: "ESTIMADO" };
  if ("mode" in out) out.provider = "Aerolínea por confirmar"; // arrival_options (vuelo interno)
  else out.airline_suggested = "Aerolínea por confirmar"; // flights (internacional)
  out.stops = "Escalas por confirmar";
  delete out.scenic;
  return out as T;
}

const sameOrigin = (from: unknown, origin: unknown) => {
  const strip = (s: unknown) => norm(String(s ?? "").replace(/\(.*?\)/g, " ").split(",")[0]);
  return !!strip(from) && strip(from) === strip(origin);
};

/**
 * Formas de llegar a la PRIMERA ciudad: el vuelo internacional ya va en `flights`, y desde la ciudad
 * de origen (otro continente) no se llega en coche ni en tren. Se quitan los vuelos y lo que "sale"
 * del origen (p. ej. "Sixt / Hertz desde Ciudad de México (vía Aeropuerto FCO)").
 */
export function firstCityArrivals<T extends Record<string, any>>(options: T[] | unknown, origin: string): T[] {
  return (Array.isArray(options) ? options : []).filter((o: any) => String(o?.mode ?? "") !== "vuelo" && !sameOrigin(o?.from, origin));
}
