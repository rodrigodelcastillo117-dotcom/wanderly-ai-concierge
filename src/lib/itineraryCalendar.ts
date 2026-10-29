// Itinerario día por día con su fecha y sin huecos (auditoría 28-oct-2026: 16 de 19 viajes viejos
// sin fecha por día y con un día de menos; Madrid 10–17 mar = 8 días con 7 en el itinerario).
//  - La fecha de cada día sale de fecha_salida + (día − 1) cuando el día no la trae (los viajes nuevos ya
//    la guardan). El día N del viaje es esa fecha aunque el plan de ese día no cuadre con una ciudad.
//  - Un día del calendario sin plan no se esconde: aparece como "Día libre" (o "Día de regreso") marcado
//    como pendiente, para que la persona vea que falta y lo pueda llenar.
// Puro: lo usan la pestaña Destinos (TripDetail) y el PDF (tripPdfModel).
import { cityStays, sameCity } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { alignStoredArrival, clockOf, type FlightTimes } from "../../supabase/functions/_shared/tripCalendar.ts";
import { countryOfCity } from "../../supabase/functions/_shared/airports.ts";
import { durationHours, isGroundTripOption } from "@/lib/booking";

const normPais = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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
  const n = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const t = n(d?.titulo);
  if (/^(salida de|regreso a|vuelta a|vuelo de regreso|dia de regreso|despedida de)\b/.test(t)) return true;
  // \u00abCascada, Stupa y despedida\u00bb (R3 viajes P2-10, Valle de Bravo): la despedida al final del t\u00edtulo.
  if (/(^|[,\u00b7\-\u2013\u2014]\s*|\by\s+)despedida(\s+de\s+[^,\u00b7]+)?$/.test(t)) return true;
  // La tarde o la noche empiezan con el regreso a casa (\u00abRegreso a CDMX por la tarde\u2026\u00bb).
  return [d?.tarde, d?.noche].some((x) => /^(regreso a (casa|cdmx|la cdmx|ciudad de mexico|tu ciudad)|vuelo de regreso|traslado al aeropuerto)\b/.test(n(x)));
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DATE_RE = "(?:el\\s+)?(?:(\\d{1,2})[-/\\s]?(?:de\\s+)?([a-záéíóú]{3,10})\\.?\\s*)?";
const TIME_RE = "(?:a las\\s*)?([01]?\\d|2[0-3])[:h.]([0-5]\\d)";

/** Fecha ISO del día `dom` (y mes escrito, si viene) entre la salida y 3 días después; null si no cuadra. */
function dateNear(start: string, dom: number, mes: string | undefined): string | null {
  const m = mes ? MESES.indexOf(mes.normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3)) : -1;
  for (let k = 0; k <= 3; k++) {
    const d = addDays(start, k);
    if (Number(d.slice(8, 10)) === dom && (m < 0 || Number(d.slice(5, 7)) === m + 1)) return d;
  }
  return null;
}

/**
 * Horas de la ida de una fila de vuelos_json, en el formato de _shared/tripCalendar ("YYYY-MM-DD HH:MM"):
 * de la tarifa en vivo (salida / llegada) o, en viajes viejos, de las notas si ahí están escritas
 * ("salida 10-mar 22:00, llegada 11-mar 22:40 (+1)"). Nunca se inventa una hora.
 */
export function flightTimesOfRow(v: any, fechaSalida: string): FlightTimes | null {
  if (!v) return null;
  const full = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(x.trim());
  if (full(v.salida) && full(v.llegada)) return { salida: String(v.salida).trim().replace("T", " "), llegada: String(v.llegada).trim().replace("T", " ") };
  const t = String(v.notas ?? "").toLowerCase();
  const dep = new RegExp(`\\b(?:sale|salida|despega)\\s*${DATE_RE}${TIME_RE}`).exec(t);
  const arr = new RegExp(`\\b(?:llega|llegada|aterriza)\\s*${DATE_RE}${TIME_RE}(\\s*\\(?\\+\\s*(\\d)\\s*(?:d[ií]as?)?\\)?)?`).exec(t);
  if (!dep || !arr) return null;
  // Una tarifa de otro día (fechas aproximadas) no dice nada de la llegada.
  if (v.approximate_dates === true) return null;
  if (dep[1] && dateNear(fechaSalida, Number(dep[1]), dep[2]) !== fechaSalida) return null;
  let llegaDia: string | null;
  if (arr[6]) llegaDia = addDays(fechaSalida, Number(arr[6]));
  else if (arr[1]) llegaDia = dateNear(fechaSalida, Number(arr[1]), arr[2]);
  else llegaDia = fechaSalida;
  if (!llegaDia) return null;
  return { salida: `${fechaSalida} ${clockOf(`${dep[3]}:${dep[4]}`)}`, llegada: `${llegaDia} ${clockOf(`${arr[3]}:${arr[4]}`)}` };
}

/** Vuelo de ida que manda en el itinerario: el elegido, uno de la persona, el equilibrado o el primero. */
function outboundFlight(trip: any, firstCity: string): any | null {
  const all: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const flights = all.filter((v) => v && typeof v === "object" && !isGroundTripOption(v));
  if (!flights.length) return null;
  // En varias ciudades, la ida es el tramo que llega a la primera (o sale de tu ciudad).
  const ida = flights.filter((v) => !v.to || sameCity(v.to, firstCity) || (trip?.ciudad_origen && v.from && sameCity(v.from, trip.ciudad_origen)));
  const rows = ida.length ? ida : flights;
  const si = Number(trip?.selections?.vuelo?.i);
  const sel = Number.isInteger(si) && si >= 0 ? all[si] : null;
  if (sel && rows.includes(sel)) return sel;
  return rows.find((v) => v.ya_lo_tengo === true || v.desde_pdf === true)
    ?? rows.find((v) => String(v.tier ?? "").toLowerCase() === "equilibrio")
    ?? rows[0];
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
  // Día 1 contra el vuelo (R3 viajes P1-1): los viajes guardados antes del ajuste del servidor decían
  // «Llegada… cena en Trastevere» el día que se está en el avión. Se alinea aquí, sin regenerar.
  const firstCity = String(days.find((d) => d.dia === 1)?.ciudad ?? (Array.isArray(it?.destinations) ? it.destinations[0] : "") ?? "").trim() || String(trip?.destino ?? "");
  const vuelo = outboundFlight(trip, firstCity);
  if (vuelo) {
    const po = countryOfCity(trip?.ciudad_origen), pd = countryOfCity(firstCity) ?? (trip?.pais_destino ? String(trip.pais_destino) : null);
    const internacional = po && pd ? normPais(po) !== normPais(pd) : null;
    const flight = flightTimesOfRow(vuelo, start);
    // Sin horas, solo se neutraliza un vuelo que puede llegar al día siguiente o de noche: internacional o
    // largo. Un vuelo nacional corto (CDMX → Oaxaca) llega el mismo día; el día 1 no se contradice.
    const horas = durationHours(vuelo?.duracion);
    const puedeLlegarTarde = internacional !== false || (horas != null && horas >= 5);
    const aligned = alignStoredArrival(days, {
      fechaSalida: start, fechaRegreso: end, destino: firstCity, origen: trip?.ciudad_origen ?? null,
      enAvion: !!flight || puedeLlegarTarde, flight, internacional, totalDays: total,
    });
    if (aligned.ajuste) {
      days.splice(0, days.length, ...(aligned.days as CalendarDay[]).map((d) => ({ ...d, dia: Number(d.dia), fecha: isIso(d.fecha) ? d.fecha : addDays(start, Number(d.dia) - 1) })));
      have.clear();
      for (const d of days) have.add(d.dia);
    }
  }
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
