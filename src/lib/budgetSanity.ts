// Cotizaciones guardadas que no son creíbles (auditoría 28-oct-2026, Budapest y Liubliana): el modelo
// devolvió desglose_presupuesto como TEXTO y el servidor guardó claves "0".."30" con un dígito cada
// una → "Total para 2 personas $7 MXN". analizar-viaje ya lo valida (budget.ts: coerceDesglose y piso
// de cordura); los viajes que ya quedaron así se muestran "Por recotizar" en vez de $7.
import { countryOfCity } from "../../supabase/functions/_shared/airports.ts";

export type InvalidQuote = "desglose_invalido" | "total_absurdo";

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** ¿Origen y destino en países distintos? null si no se sabe. */
export function isInternationalTrip(trip: any): boolean | null {
  const o = countryOfCity(trip?.ciudad_origen);
  const d = countryOfCity(trip?.destino) ?? (trip?.pais_destino ? String(trip.pais_destino) : null);
  if (!o || !d) return trip?.pais_destino && o ? norm(o) !== norm(trip.pais_destino) : null;
  return norm(o) !== norm(d);
}

/** Piso de cordura (MXN), el mismo que analizar-viaje: internacional $500 por viajero; nacional $100. */
export function quoteFloor(trip: any): number {
  const T = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
  return isInternationalTrip(trip) ? 500 * T : 100;
}

/**
 * Por qué la cotización guardada no se puede mostrar como total (null = está bien o no hay cotización).
 * - desglose_presupuesto que no es un objeto de rubros (texto, arreglo, claves "0","1"…);
 * - total por debajo del piso de cordura.
 */
export function invalidQuoteReason(trip: any): InvalidQuote | null {
  if (!trip) return null;
  const quoted = (trip.vuelos_json?.length ?? 0) > 0 || (trip.hospedaje_json?.length ?? 0) > 0;
  if (!quoted) return null;
  const raw = trip.desglose_presupuesto;
  if (raw != null) {
    if (typeof raw !== "object" || Array.isArray(raw)) return "desglose_invalido";
    const keys = Object.keys(raw);
    if (keys.some((k) => /^\d+$/.test(k))) return "desglose_invalido";
  }
  const total = Number(trip.total_estimado) || 0;
  if (total > 0 && total < quoteFloor(trip)) return "total_absurdo";
  return null;
}

export const REQUOTE_LABEL = "Por recotizar";
export const REQUOTE_DETAIL = "La cotización guardada de este viaje tiene un error y su total no es confiable. Vuelve a cotizar para ver precios reales.";
