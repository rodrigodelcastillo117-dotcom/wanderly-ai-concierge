// Parámetros y marker de Travelpayouts/Aviasales compartidos (sin Deno, para poder probarlos).

/** Marker público de afiliado de IATOS en Travelpayouts. No es secreto: va en cada link. */
export const TP_PUBLIC_MARKER = "533299";

/**
 * Marker de afiliado: TRAVELPAYOUTS_MARKER si está configurado, si no el público.
 * Antes se usaban los 6 primeros caracteres del token de la API como respaldo: eso atribuía
 * los clics a un marker equivocado (sin comisión) y publicaba parte del token en cada URL.
 */
export function resolveTpMarker(configured: string | null | undefined): string {
  const m = String(configured ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,40}$/.test(m) ? m : TP_PUBLIC_MARKER;
}

export type PricesForDatesQuery = {
  origin: string;
  destination: string;
  departureAt: string; // YYYY-MM-DD o YYYY-MM
  returnAt?: string | null;
  currency?: string;
  limit?: number;
  token: string;
};

/**
 * Query de /aviasales/v3/prices_for_dates. La API supone viaje sencillo si no se le dice lo
 * contrario: un viaje redondo DEBE mandar one_way=false (si no, regresa tarifas de un solo
 * sentido o nada, y la cotización sale ~40-50 % abajo).
 */
export function pricesForDatesParams(q: PricesForDatesQuery): URLSearchParams {
  const params = new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    departure_at: q.departureAt,
    currency: (q.currency ?? "usd").toLowerCase(),
    sorting: "price",
    direct: "false",
    limit: String(q.limit ?? 30),
    one_way: q.returnAt ? "false" : "true",
    token: q.token,
  });
  if (q.returnAt) params.set("return_at", q.returnAt);
  return params;
}

export function pricesForDatesUrl(q: PricesForDatesQuery): string {
  return `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${pricesForDatesParams(q).toString()}`;
}
