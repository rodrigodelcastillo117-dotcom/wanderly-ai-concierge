// Itinerario día por día con su fecha y sin huecos (auditoría 28-oct-2026: 16 de 19 viajes viejos
// sin fecha por día y con un día de menos; Madrid 10–17 mar = 8 días con 7 en el itinerario).
//  - La fecha de cada día sale de fecha_salida + (día − 1) cuando el día no la trae (los viajes nuevos ya
//    la guardan). El día N del viaje es esa fecha aunque el plan de ese día no cuadre con una ciudad.
//  - Un día del calendario sin plan no se esconde: aparece como "Día libre" (o "Día de regreso") marcado
//    como pendiente, para que la persona vea que falta y lo pueda llenar.
// Puro: lo usan la pestaña Destinos (TripDetail) y el PDF (tripPdfModel).
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export type CalendarDay = Record<string, any> & {
  dia: number;
  fecha: string | null;
  /** Día del calendario sin plan en el itinerario guardado. */
  pendiente?: boolean;
};

/** ¿Es el día en que se sale de regreso? (tipo "regreso"/"salida" o un título como «Salida de Madrid»). */
export function isDepartureDay(d: Record<string, any>): boolean {
  const tipo = String(d?.tipo ?? "").toLowerCase();
  if (tipo === "regreso" || tipo === "salida" || tipo === "partida") return true;
  const t = String(d?.titulo ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /^(salida de|regreso a|vuelta a|vuelo de regreso|dia de regreso|despedida de)\b/.test(t);
}

export const FREE_DAY_TITLE = "Día libre · sin plan todavía";
export const RETURN_DAY_TITLE = "Día de regreso · sin plan todavía";

/**
 * Días del itinerario con fecha y con los días faltantes como pendientes. `trip` necesita fecha_salida,
 * fecha_regreso e itinerario_json (arreglo o { days, multi, destinations }).
 */
export function calendarDays(trip: any): CalendarDay[] {
  const it = trip?.itinerario_json;
  const raw: any[] = Array.isArray(it) ? it : Array.isArray(it?.days) ? it.days : [];
  const start = isIso(trip?.fecha_salida) ? trip.fecha_salida : null;
  const end = isIso(trip?.fecha_regreso) ? trip.fecha_regreso : null;
  const days: CalendarDay[] = raw.filter((d) => d && typeof d === "object").map((d, i) => {
    const dia = Number(d.dia) > 0 ? Math.round(Number(d.dia)) : i + 1;
    const fecha = isIso(d.fecha) ? d.fecha : start ? addDays(start, dia - 1) : null;
    return { ...d, dia, fecha };
  });
  if (!start || !end || end < start) return days;
  const total = nightsBetween(start, end) + 1;
  if (total > 120) return days;
  const have = new Set(days.map((d) => d.dia));
  // Numeración repetida (días por ciudad que reinician en 1): no se adivina qué falta.
  if (have.size !== days.length) return days;
  // El día de salida del plan va el día del regreso (R2, Madrid 10–17 mar: el día 7 decía «Salida de Madrid…
  // traslado a Barajas» el 16 y el 8, «Día de regreso · sin plan todavía» el 17). Si el último día con plan es
  // la salida y después no hay nada, se mueve al día del regreso y el que deja libre queda como día libre.
  const last = days.reduce<CalendarDay | null>((a, d) => (!a || d.dia > a.dia ? d : a), null);
  if (last && last.dia < total && isDepartureDay(last)) {
    const idx = days.indexOf(last);
    days[idx] = { ...last, dia: total, fecha: end };
    have.delete(last.dia);
    have.add(total);
  }
  const multi = !!(it && !Array.isArray(it) && it.multi);
  const stays = multi ? cityStays(trip) : [];
  const out = [...days];
  for (let n = 1; n <= total; n++) {
    if (have.has(n)) continue;
    const fecha = addDays(start, n - 1);
    // En un viaje de varias ciudades, el día faltante va a la ciudad donde se duerme (o se sale) ese día.
    const stay = stays.find((s) => fecha >= s.checkin && fecha < s.checkout) ?? (fecha >= end ? stays[stays.length - 1] : null);
    out.push({ dia: n, fecha, pendiente: true, titulo: n === total ? RETURN_DAY_TITLE : FREE_DAY_TITLE, ...(stay ? { ciudad: stay.city } : {}) });
  }
  return out.sort((a, b) => a.dia - b.dia);
}
