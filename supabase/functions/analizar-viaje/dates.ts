// Fechas del análisis de viaje (AUD-Q-07). Sin dependencias de Deno: se prueba con Vitest.
//
// Antes analizar-viaje aceptaba cualquier fecha: una salida en el pasado (o "2026-13-40") apartaba el
// análisis, consultaba Google Flights/Hotels (que no cotizan fechas pasadas), el modelo llenaba los
// huecos con estimaciones y el análisis se cobraba. Ahora se rechaza antes de apartar la cuota.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (v: string) => {
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const present = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Mensaje para el usuario si las fechas no sirven para cotizar, o null si están bien (o faltan: se
 * resuelven después con resolver-fechas). "Hoy" se calcula para la zona más atrasada (UTC−12): así
 * nadie en México ve "ya pasó" por la noche cuando en UTC ya es mañana.
 */
export function tripDatesProblem(b: { fecha_salida?: unknown; fecha_regreso?: unknown }, now: Date = new Date()): string | null {
  for (const [v, que] of [[b.fecha_salida, "salida"], [b.fecha_regreso, "regreso"]] as const) {
    if (present(v) && !isRealDate(v.trim())) return `La fecha de ${que} no es válida. Elige otra en el calendario.`;
  }
  const salida = present(b.fecha_salida) ? b.fecha_salida.trim() : null;
  const regreso = present(b.fecha_regreso) ? b.fecha_regreso.trim() : null;
  const earliestToday = new Date(now.getTime() - 12 * 3600_000).toISOString().slice(0, 10);
  if (salida && salida < earliestToday) return "La fecha de salida ya pasó: no podemos cotizar vuelos ni hoteles para fechas pasadas. Elige una fecha a partir de hoy.";
  if (salida && regreso && regreso < salida) return "La fecha de regreso es antes de la salida. Revisa las fechas.";
  return null;
}
