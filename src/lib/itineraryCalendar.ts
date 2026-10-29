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
import { timeZoneFor, utcOffsetMinutes } from "../../supabase/functions/_shared/worldClock.ts";
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

/** "11h 0m", "18h 5m", "26h", "13h 15m (ida) / 11h 30m (vuelta)" → minutos; null con rangos ("18h - 21h"). */
function durationMinutes(v: unknown): number | null {
  const t = String(v ?? "").toLowerCase().trim();
  const m = /^(\d{1,2})\s*h(?:oras?)?(?:\s*(\d{1,2})\s*m(?:in)?)?\b/.exec(t);
  if (!m) return null;
  // Lo que sigue no puede ser otra duración de la ida (rango): «18h - 21h», «10-11h».
  const tail = t.slice(m[0].length);
  if (/^\s*(?:-|–|a\s+\d)/.test(tail)) return null;
  const min = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  return min >= 30 && min <= 40 * 60 ? min : null;
}

/** Hora local de llegada = salida (zona del origen) + duración, en la zona del destino. null sin zonas. */
function arrivalByDuration(salida: string, minutes: number, origen: unknown, destino: unknown): string | null {
  const tzO = timeZoneFor(origen), tzD = timeZoneFor(destino);
  if (!tzO || !tzD) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(salida);
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Hora de la salida en UTC (el desfase del origen en ese momento, con horario de verano).
  let dep = asUtc - utcOffsetMinutes(new Date(asUtc), tzO) * 60_000;
  dep = asUtc - utcOffsetMinutes(new Date(dep), tzO) * 60_000;
  const arr = dep + minutes * 60_000;
  const local = new Date(arr + utcOffsetMinutes(new Date(arr), tzD) * 60_000).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)}`;
}

/**
 * Horas de la ida de una fila de vuelos_json, en el formato de _shared/tripCalendar ("YYYY-MM-DD HH:MM"):
 * de la tarifa en vivo (salida / llegada) o, en viajes viejos, de las notas si ahí están escritas
 * ("salida 10-mar 22:00, llegada 11-mar 22:40 (+1)"). Si solo hay salida y duración (R4 viajes P2-1:
 * Madrid «Sale 11:00 · Directo 11h», Tokio «Sale 05:45 · 18h 5m»), la llegada se calcula con la zona
 * horaria del origen y del destino (`ctx`) y se marca `calculada`. Nunca se inventa una hora: sin zona
 * horaria conocida, sin duración clara o con un rango, no hay llegada.
 */
export function flightTimesOfRow(v: any, fechaSalida: string, ctx: { origen?: unknown; destino?: unknown } = {}): FlightTimes | null {
  if (!v) return null;
  const full = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(x.trim());
  if (full(v.salida) && full(v.llegada)) return { salida: String(v.salida).trim().replace("T", " "), llegada: String(v.llegada).trim().replace("T", " ") };
  // Una tarifa de otro día (fechas aproximadas) no dice nada de la llegada.
  if (v.approximate_dates === true) return null;
  const t = String(v.notas ?? "").toLowerCase();
  const depM = new RegExp(`\\b(?:sale|salida|despega)\\s*${DATE_RE}${TIME_RE}`).exec(t);
  const arr = new RegExp(`\\b(?:llega|llegada|aterriza)\\s*${DATE_RE}${TIME_RE}(\\s*\\(?\\+\\s*(\\d)\\s*(?:d[ií]as?)?\\)?)?`).exec(t);
  // Salida: la de la tarifa (con fecha del viaje) o la escrita en las notas.
  let salida: string | null = null;
  if (full(v.salida)) {
    const s = String(v.salida).trim().replace("T", " ");
    salida = s.slice(0, 10) === fechaSalida ? `${fechaSalida} ${clockOf(s)}` : null;
    if (!salida) return null;
  } else if (depM) {
    if (depM[1] && dateNear(fechaSalida, Number(depM[1]), depM[2]) !== fechaSalida) return null;
    salida = `${fechaSalida} ${clockOf(`${depM[3]}:${depM[4]}`)}`;
  }
  if (!salida) return null;
  if (!arr) {
    const min = durationMinutes(v.duracion ?? v.duration);
    const llegada = min != null ? arrivalByDuration(salida, min, ctx.origen, ctx.destino) : null;
    return llegada ? { salida, llegada, calculada: true } : null;
  }
  let llegaDia: string | null;
  if (arr[6]) llegaDia = addDays(fechaSalida, Number(arr[6]));
  else if (arr[1]) llegaDia = dateNear(fechaSalida, Number(arr[1]), arr[2]);
  else llegaDia = fechaSalida;
  if (!llegaDia) return null;
  return { salida, llegada: `${llegaDia} ${clockOf(`${arr[3]}:${arr[4]}`)}` };
}

/** Vuelo de ida que manda en el itinerario: el elegido, uno de la persona, el equilibrado o el primero. */
function idaRows(trip: any, firstCity: string): any[] {
  const all: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const flights = all.filter((v) => v && typeof v === "object" && !isGroundTripOption(v));
  // En varias ciudades, la ida es el tramo que llega a la primera (o sale de tu ciudad).
  const ida = flights.filter((v) => !v.to || sameCity(v.to, firstCity) || (trip?.ciudad_origen && v.from && sameCity(v.from, trip.ciudad_origen)));
  return ida.length ? ida : flights;
}

function outboundFlight(trip: any, firstCity: string): any | null {
  const all: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const rows = idaRows(trip, firstCity);
  if (!rows.length) return null;
  const si = Number(trip?.selections?.vuelo?.i);
  const sel = Number.isInteger(si) && si >= 0 ? all[si] : null;
  if (sel && rows.includes(sel)) return sel;
  return rows.find((v) => v.ya_lo_tengo === true || v.desde_pdf === true)
    ?? rows.find((v) => String(v.tier ?? "").toLowerCase() === "equilibrio")
    ?? rows[0];
}

/**
 * El vuelo de ida que usa el itinerario (el mismo con que se alinea el día 1) y sus horas, si se conocen:
 * el chip «Vuelo Ciudad de México → Roma · sale 19:50» del itinerario dice lo mismo que el texto del día.
 */
export function tripOutbound(trip: any): { row: any; times: FlightTimes | null; firstCity: string } | null {
  const it = trip?.itinerario_json;
  const raw: any[] = Array.isArray(it) ? it : Array.isArray(it?.days) ? it.days : [];
  const start = isIso(trip?.fecha_salida) ? trip.fecha_salida : null;
  const firstCity = String(raw.find((d) => d && Number(d.dia) === 1)?.ciudad ?? (Array.isArray(it?.destinations) ? it.destinations[0] : "") ?? "").trim() || String(trip?.destino ?? "");
  const row = outboundFlight(trip, firstCity);
  if (!row) return null;
  const times = start ? flightTimesOfRow(row, start, { origen: trip?.ciudad_origen, destino: firstCity }) : null;
  return { row, times, firstCity };
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
    const ctx = { origen: trip?.ciudad_origen, destino: firstCity };
    const flight = flightTimesOfRow(vuelo, start, ctx);
    // ¿Alguna opción de la lista llega el día 1? Si ninguna (o no se sabe), el título no dice «llegada».
    const llegaElDia1 = idaRows(trip, firstCity).some((r) => flightTimesOfRow(r, start, ctx)?.llegada?.slice(0, 10) === start);
    // Sin horas, solo se neutraliza un vuelo que puede llegar al día siguiente o de noche: internacional o
    // largo. Un vuelo nacional corto (CDMX → Oaxaca) llega el mismo día; el día 1 no se contradice.
    const horas = durationHours(vuelo?.duracion);
    const puedeLlegarTarde = internacional !== false || (horas != null && horas >= 5);
    const aligned = alignStoredArrival(days, {
      fechaSalida: start, fechaRegreso: end, destino: firstCity, origen: trip?.ciudad_origen ?? null,
      enAvion: !!flight || puedeLlegarTarde, flight, internacional, totalDays: total, llegaElDia1,
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
