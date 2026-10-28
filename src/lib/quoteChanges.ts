/**
 * Qué cambió del viaje desde que se cotizó (puro, sin dependencias pesadas).
 *
 * Regla del dueño (E2E 28-oct-2026): elegir otro vuelo, hotel o experiencia de la MISMA cotización
 * NO la invalida (el total se recalcula al momento con esa opción). Solo la invalidan los cambios
 * de viajeros, fechas, ciudad de origen o destino, que piden precios nuevos.
 *
 * trips.quote_basis guarda con qué se cotizó: num_viajeros, fecha_salida, fecha_regreso y, desde
 * 20261028140000_cotizacion_sin_seleccion.sql, ciudad_origen y destino. Una base sin esas llaves
 * (cotizada antes) no compara origen ni destino: no se inventa un cambio que no se puede saber.
 */
export type QuoteChange = "viajeros" | "fechas" | "origen" | "destino";

type BasisOverride = { travelers?: number | null; dateFrom?: string | null; dateTo?: string | null } | null | undefined;

// Igual que el trigger (lower(btrim(...))): mayúsculas y espacios de más no son un cambio.
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Cambios desde la cotización. `null` = no se sabe con qué se cotizó (sin base): el que llama decide
 * (normalmente respeta trips.quote_needs_update). `override` (snapshot de trip_quotes) manda en
 * viajeros y fechas.
 */
export function quoteChanges(trip: any, override?: BasisOverride): QuoteChange[] | null {
  const b = trip?.quote_basis;
  const hasBasis = !!(b && typeof b === "object" && b.num_viajeros != null);
  if (!hasBasis && !override) return null;
  const travelers = override?.travelers ?? (hasBasis ? Number(b.num_viajeros) : null);
  const dateFrom = override ? override.dateFrom ?? null : b?.fecha_salida ?? null;
  const dateTo = override ? override.dateTo ?? null : b?.fecha_regreso ?? null;
  const out: QuoteChange[] = [];
  if (travelers != null && (Number(trip?.num_viajeros || 1) !== (Number(travelers) || 1))) out.push("viajeros");
  if ((trip?.fecha_salida ?? null) !== dateFrom || (trip?.fecha_regreso ?? null) !== dateTo) out.push("fechas");
  if (hasBasis && "ciudad_origen" in b && norm(b.ciudad_origen) !== norm(trip?.ciudad_origen)) out.push("origen");
  if (hasBasis && "destino" in b && norm(b.destino) !== norm(trip?.destino)) out.push("destino");
  return out;
}

/**
 * ¿Hay que actualizar la cotización? Con base conocida se calcula aquí (ignora un
 * quote_needs_update viejo que el servidor marcó solo por cambiar la selección); sin base se
 * respeta la marca del servidor.
 */
export function quoteNeedsUpdate(trip: any, override?: BasisOverride): boolean {
  const c = quoteChanges(trip, override);
  return c === null ? trip?.quote_needs_update === true : c.length > 0;
}

const LABEL: Record<QuoteChange, string> = {
  viajeros: "el número de viajeros",
  fechas: "las fechas",
  origen: "la ciudad de origen",
  destino: "el destino",
};
const ORDER: QuoteChange[] = ["fechas", "viajeros", "origen", "destino"];

/** "Cambiaste las fechas y el número de viajeros" (solo lo que de verdad cambió). */
export function describeQuoteChanges(changes: QuoteChange[] | null | undefined): string | null {
  const list = ORDER.filter((c) => changes?.includes(c)).map((c) => LABEL[c]);
  if (!list.length) return null;
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
  return `Cambiaste ${joined}`;
}
