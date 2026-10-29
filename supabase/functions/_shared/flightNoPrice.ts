// Por qué un vuelo quedó sin precio en vivo, dicho en español simple (sin Deno: lo usan flights-search,
// analizar-viaje y la pantalla del viaje). Caso Álvaro (28-oct-2026): todo decía "checa en Google
// Flights" sin explicar que se habían acabado las búsquedas del día o que no se reconoció "beijin".
import type { ReferenceFare } from "./tpReference.ts";

export type NoPriceCode =
  | "busquedas_agotadas_hoy"
  | "busquedas_en_pausa"
  | "limite_de_tu_plan"
  | "ciudad_no_reconocida"
  | "sin_resultados"
  | "sin_respuesta";

export type NoPriceReason = { codigo: NoPriceCode; texto: string };

export const NO_PRICE_TEXT: Record<Exclude<NoPriceCode, "ciudad_no_reconocida">, string> = {
  busquedas_agotadas_hoy: "Hoy ya se usaron las búsquedas de precios en vivo disponibles. Vuelve a intentar mañana con «Consultar precio en vivo».",
  busquedas_en_pausa: "Las búsquedas de precios en vivo están en pausa un rato. Intenta de nuevo en una hora con «Consultar precio en vivo».",
  limite_de_tu_plan: "Ya usaste las búsquedas en vivo de tu plan por hoy. Mañana puedes consultar de nuevo.",
  sin_resultados: "Google Flights no devolvió vuelos para esa ruta y esas fechas. Prueba otras fechas o un aeropuerto cercano.",
  sin_respuesta: "La búsqueda en vivo no respondió esta vez. Intenta de nuevo en unos minutos.",
};

/**
 * Motivo a partir de la respuesta de flights-search (ya cerrada por finalizeSearchResponse): fallas,
 * pausa de la cuenta (budget/quota), destino sin aeropuerto (no_iata). null si sí hubo vuelos.
 */
export function noLivePriceReason(body: Record<string, any> | null | undefined): NoPriceReason | null {
  const b = body ?? {};
  if (b.error === "no_iata") {
    return { codigo: "ciudad_no_reconocida", texto: typeof b.motivo_detalle === "string" && b.motivo_detalle ? b.motivo_detalle
      : `No reconocimos "${String(b.destination ?? b.origin ?? "tu destino").slice(0, 40)}" como ciudad con aeropuerto. Escribe la ciudad y lo cotizamos.` };
  }
  const live = b.source === "serpapi" && Array.isArray(b.results) && b.results.length > 0;
  if (live) return null;
  const fallas: string[] = Array.isArray(b.fallas) ? b.fallas.map(String) : [];
  if (b.pausa === "budget") return { codigo: "busquedas_agotadas_hoy", texto: NO_PRICE_TEXT.busquedas_agotadas_hoy };
  if (b.pausa === "quota" || b.busquedas_en_pausa === true || fallas.includes("google_flights_busquedas_en_pausa")) {
    return { codigo: "busquedas_en_pausa", texto: NO_PRICE_TEXT.busquedas_en_pausa };
  }
  if (b.limite_uso_justo === true || fallas.includes("google_flights_limite_del_plan")) return { codigo: "limite_de_tu_plan", texto: NO_PRICE_TEXT.limite_de_tu_plan };
  if (fallas.includes("google_flights_sin_resultados")) return { codigo: "sin_resultados", texto: NO_PRICE_TEXT.sin_resultados };
  return { codigo: "sin_respuesta", texto: NO_PRICE_TEXT.sin_respuesta };
}

const isGround = (v: any) => ["auto", "autobus", "bus", "coche", "tren", "ferry"].includes(String(v?.modo ?? v?.mode ?? "").toLowerCase());
const isEstimated = (v: any) => String(v?.fuente_precio ?? "").toLowerCase() === "estimado" || String(v?.estado_dato ?? "").toUpperCase() === "ESTIMADO";

/**
 * Marca los vuelos ESTIMADOS de un análisis sin precio en vivo con el motivo, la tarifa de referencia
 * (si la hubo, con su fecha y fuente) y la nota del destino interpretado ("India" → Delhi). No cambia
 * precios ni fuentes: el estimado sigue siendo estimado.
 */
export function annotateNoLivePrice(vuelos: any[], info: { reason: NoPriceReason | null; reference?: ReferenceFare | null; destinoNota?: string | null }): any[] {
  if (!Array.isArray(vuelos) || !info.reason) return vuelos;
  return vuelos.map((v) => {
    if (!v || typeof v !== "object" || isGround(v) || !isEstimated(v)) return v;
    return {
      ...v,
      sin_precio_vivo: { codigo: info.reason!.codigo, texto: info.reason!.texto },
      ...(info.reference ? { tarifa_referencia: info.reference } : {}),
      ...(info.destinoNota ? { destino_nota: info.destinoNota } : {}),
    };
  });
}
