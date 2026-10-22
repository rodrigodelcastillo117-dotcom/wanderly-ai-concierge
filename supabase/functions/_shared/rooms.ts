// Habitaciones de una cotización, sin dependencias de Deno (se prueba con Vitest). Lo usan
// analizar-viaje (budget.ts) y logistics-plan; src/lib/quote.ts repite el mismo criterio.

/** Una habitación doble por cada 2 viajeros (mismo criterio que logistics-plan). */
export const roomsFor = (travelers: number) => Math.max(1, Math.ceil((Number(travelers) || 1) / 2));

/**
 * Habitaciones por las que se multiplica el precio por noche de UN hotel.
 * - Precio en vivo (Google Hotels vía hotels-search): se pidió con adults = todos los viajeros, así
 *   que ya es el precio por noche del grupo completo → 1. Antes se multiplicaba otra vez por
 *   ceil(viajeros/2) y una familia de 4 en Cancún salía con el hospedaje al doble (R10, prod).
 * - Precio estimado (sin consulta en vivo): es por habitación doble → ceil(viajeros/2).
 * Mismo criterio en src/lib/quote.ts (hotelPriceRooms).
 */
export function hotelPriceRooms(hotel: any, travelers: number): number {
  const fuente = String(hotel?.fuente_precio ?? hotel?.fuente ?? "").toLowerCase();
  const estado = String(hotel?.estado_dato ?? "").toUpperCase();
  const live = fuente === "serpapi" || estado === "CONSULTADO_EN_VIVO" || estado === "VERIFICADO";
  return live ? 1 : roomsFor(travelers);
}
