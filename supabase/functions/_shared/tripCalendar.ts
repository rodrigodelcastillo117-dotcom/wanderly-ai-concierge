// Calendario real del itinerario de un viaje de un destino (caso Madrid, E2E 28-oct-2026). Sin Deno:
// lo usan analizar-viaje (al generar el viaje) y la app (clockOf en src/lib/experiencias.ts); se prueba
// con Vitest.
//
// El defecto: viaje del 10 al 17 de marzo con vuelo CDMX → Madrid que sale 11:00 y llega 05:00 del 11.
// El modelo escribió 7 días sin fecha (son 8 días de calendario) y el "Día 01" decía "TARDE Llegada a
// Barajas… NOCHE cena en Gloria Bendita": imposible el día 10, ese día se está en el avión.
//
// Reglas deterministas (el servidor manda, no el modelo):
//  * Día i = fecha de salida + (i − 1); el itinerario cubre TODOS los días del calendario (noches + 1).
//  * Con la hora real del vuelo elegido (Google Flights da la hora local de cada aeropuerto): los días
//    antes de la llegada son "Vuelo" (en tránsito); el día de llegada solo lleva actividades después de
//    la hora de llegada + el traslado al hotel; el último día se deja libre desde que hay que ir al
//    aeropuerto para el vuelo de regreso (si se sabe su hora).
//  * Sin vuelo (coche, autobús) solo se ponen las fechas y se completa el número de días.
//  * Nunca se inventa una actividad: un día que falta queda "Día libre"; una franja imposible se
//    reemplaza por lo que de verdad pasa (vuelo, llegada, traslado al aeropuerto).

export type FlightTimes = {
  /** "YYYY-MM-DD HH:MM", hora local del aeropuerto de salida (ida). */
  salida?: string | null;
  /** "YYYY-MM-DD HH:MM", hora local del destino (ida). */
  llegada?: string | null;
  /** "YYYY-MM-DD HH:MM", hora local del destino a la que sale el vuelo de regreso. */
  regreso_salida?: string | null;
};

export type CalendarOptions = {
  fechaSalida: string;
  fechaRegreso: string;
  destino: string;
  origen?: string | null;
  /** Vuelo elegido (tier equilibrio) con sus horas reales; null en coche o sin horas. */
  flight?: FlightTimes | null;
  internacional?: boolean | null;
  /** Minutos del aeropuerto al hotel (supuesto, se dice "aprox."). */
  transferMin?: number;
};

export type ItineraryDay = Record<string, unknown> & { dia: number; fecha: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

/** "2026-03-10" + n días, sin zona horaria. */
export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Días de calendario del viaje, de la salida al regreso, ambos incluidos (máx. 60). */
export function calendarDates(salida: unknown, regreso: unknown): string[] {
  if (!isIso(salida) || !isIso(regreso) || regreso < salida) return [];
  const out: string[] = [];
  for (let d = salida; d <= regreso && out.length < 60; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** "HH:MM" de "2026-11-11 12:45", "12:45" o "7:05"; null si no hay hora. */
export function clockOf(v: unknown): string | null {
  const all = [...String(v ?? "").matchAll(/(\d{1,2}):(\d{2})/g)];
  const m = all[all.length - 1];
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

const dateOf = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "").trim());
  return m && isIso(m[1]) ? m[1] : null;
};
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "mié 10 mar" (sin zona horaria). */
export function fmtDia(iso: string): string {
  // Sin Intl: el texto es el mismo en Deno, en Node y en cualquier navegador.
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const fmtHoras = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; };

/** "7 noches y 8 días" (lo mismo que cuenta la app: noches = días entre fechas; días = noches + 1). */
export function nightsDaysText(salida: unknown, regreso: unknown): string | null {
  const d = calendarDates(salida, regreso).length;
  if (!d) return null;
  const n = d - 1;
  return `${n} ${n === 1 ? "noche" : "noches"} y ${d} ${d === 1 ? "día" : "días"}`;
}

/** Llegada del vuelo elegido: fecha y hora local del destino. Solo si la salida es la del viaje. */
export function arrivalFromFlight(f: FlightTimes | null | undefined, fechaSalida: string): { fecha: string; hora: string; salidaHora: string | null } | null {
  const dep = dateOf(f?.salida), arr = dateOf(f?.llegada), hora = clockOf(f?.llegada);
  // Una tarifa de fechas aproximadas (otro día del mes) no dice nada del día de llegada.
  if (!f || dep !== fechaSalida || !arr || !hora || arr < dep) return null;
  return { fecha: arr, hora, salidaHora: clockOf(f.salida) };
}

/** Salida del vuelo de regreso (hora local del destino), solo si es el último día del viaje. */
export function returnFromFlight(f: FlightTimes | null | undefined, fechaRegreso: string): string | null {
  return f && dateOf(f.regreso_salida) === fechaRegreso ? clockOf(f.regreso_salida) : null;
}

// ─── Lo que el modelo necesita saber ANTES de escribir el itinerario ───

/**
 * Resumen de las llegadas de los vuelos de la lista en vivo (Google Flights: hora local de cada
 * aeropuerto). La llamada del itinerario corre al mismo tiempo que la que elige el vuelo, así que se le
 * da el rango real de la lista; después el servidor ajusta con el vuelo elegido.
 */
export function arrivalSummary(rows: FlightTimes[], fechaSalida: string, destino: string, transferMin = 90): string {
  const arr = rows.map((r) => arrivalFromFlight(r, fechaSalida)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!arr.length) {
    return `LLEGADA: el servidor ajusta el día de llegada con la hora real del vuelo elegido. No pongas actividades en ${destino} antes de que el vuelo llegue: si el vuelo es nocturno o largo, el Día 1 puede ser solo de vuelo.`;
  }
  const offsets = [...new Set(arr.map((a) => daysBetween(fechaSalida, a.fecha)))];
  const horas = arr.map((a) => a.hora).sort();
  const rango = horas[0] === horas[horas.length - 1] ? `a las ${horas[0]}` : `entre las ${horas[0]} y las ${horas[horas.length - 1]}`;
  const traslado = `el traslado al hotel (~${fmtHoras(transferMin)})`;
  if (offsets.every((o) => o >= 1) && offsets.length === 1) {
    const dia = offsets[0] + 1;
    return `LLEGADA: los vuelos de la lista salen el ${fmtDia(fechaSalida)} y llegan a ${destino} el ${fmtDia(arr[0].fecha)} ${rango} (hora local). ` +
      `${offsets[0] === 1 ? "El Día 1 es de VUELO" : `Los días 1 a ${offsets[0]} son de VUELO`}: sin actividades, comidas ni cenas en ${destino}. ` +
      `Las actividades empiezan el Día ${dia}, después de la llegada y ${traslado}.`;
  }
  if (offsets.every((o) => o === 0)) {
    return `LLEGADA: los vuelos de la lista llegan a ${destino} el mismo día ${rango} (hora local). El Día 1 solo lleva actividades después de la llegada y ${traslado}.`;
  }
  return `LLEGADA: según el vuelo se llega el mismo día o el siguiente (${rango}, hora local). No pongas actividades en ${destino} el Día 1 antes de la noche; el servidor ajusta el día de llegada con el vuelo elegido.`;
}

/** Bloque "CALENDARIO DEL VIAJE" del prompt (mismo texto para las dos llamadas). */
export function calendarPromptBlock(o: { fechaSalida: string; fechaRegreso: string; destino: string; llegada: string; regresoEnAvion: boolean }): string {
  const dates = calendarDates(o.fechaSalida, o.fechaRegreso);
  if (!dates.length) return "";
  const nd = nightsDaysText(o.fechaSalida, o.fechaRegreso)!;
  const lista = dates.map((d, i) => `Día ${i + 1} = ${fmtDia(d)}`).join(" · ");
  return [
    "CALENDARIO DEL VIAJE (lo calcula el servidor; el itinerario DEBE seguirlo):",
    `- ${nd}: del ${fmtDia(dates[0])} al ${fmtDia(dates[dates.length - 1])}. El itinerario lleva EXACTAMENTE ${dates.length} días, uno por fecha: ${lista}.`,
    `- ${o.llegada}`,
    `- Último día (${fmtDia(dates[dates.length - 1])}): ${o.regresoEnAvion ? "día de regreso; deja tiempo para ir al aeropuerto (3 h antes en internacional, 2 h en nacional) y nada después de la hora del vuelo." : "día de regreso; termina con tiempo para el trayecto de vuelta."}`,
    `- Al hablar de la duración di "${nd}" tal cual. No digas que cambiaste o reinterpretaste la duración ("aunque marcaste…", "lo armé como…").`,
  ].join("\n");
}

// ─── Ajuste determinista del itinerario que escribió el modelo ───

const SLOTS = [
  { key: "mañana", start: 6 * 60, end: 13 * 60 },
  { key: "tarde", start: 13 * 60, end: 19 * 60 },
  { key: "noche", start: 19 * 60, end: 24 * 60 },
] as const;

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slotText = (d: Record<string, unknown>, k: string) => String(d[k] ?? (k === "mañana" ? d.manana ?? "" : "")).trim();

/** ¿El modelo ya escribió el día como día de vuelo? */
function looksTransit(d: Record<string, unknown> | null | undefined): boolean {
  if (!d) return false;
  const t = norm(d.titulo);
  if (/^\s*(vuelo|dia de vuelo|en vuelo|en transito|rumbo a|salida (de|hacia)|vuelas)/.test(t)) return true;
  const hits = SLOTS.filter((s) => /\b(vuelo|a bordo|en transito|en el aire|despega\w*)\b/.test(norm(slotText(d, s.key)))).length;
  return hits >= 2;
}

/** Lo que el modelo escribió del vuelo o de la llegada: ya no aplica en el día de llegada real. */
const TRAVEL_WORDS = /\b(llegada|llegas|llegamos|aterriz\w*|aeropuerto|barajas|vuelo|vuelas|volar|a bordo|en transito|check[- ]?in)\b/;

function freeDay(destino: string): Record<string, unknown> {
  return { titulo: `Día libre en ${destino}`, mañana: `Libre para recorrer ${destino} a tu ritmo.`, tarde: "Tarde libre.", noche: "Noche libre.", tipo: "libre" };
}

/**
 * Pone fecha real a cada día, completa el calendario y corrige lo imposible según el vuelo elegido.
 * Devuelve los días y una lista corta de lo que se ajustó (para los logs).
 */
export function applyTripCalendar(days: unknown, o: CalendarOptions): { days: ItineraryDay[]; ajustes: string[] } {
  const dates = calendarDates(o.fechaSalida, o.fechaRegreso);
  const src = (Array.isArray(days) ? days : []).filter((d) => d && typeof d === "object") as Record<string, unknown>[];
  const ajustes: string[] = [];
  if (!dates.length) return { days: src as ItineraryDay[], ajustes };
  const N = dates.length;
  const destino = String(o.destino ?? "").trim() || "tu destino";
  const origen = String(o.origen ?? "").trim() || "tu ciudad";
  const transfer = Math.max(30, Math.round(Number(o.transferMin) || 90));
  const margin = o.internacional === false ? 120 : 180;

  const arrival = arrivalFromFlight(o.flight, dates[0]);
  const transit = arrival ? daysBetween(dates[0], arrival.fecha) : 0;
  const arrivalOk = !!arrival && transit >= 0 && transit < N;
  const tDays = arrivalOk ? transit : 0;

  const sorted = [...src].sort((a, b) => (Number(a.dia) || 0) - (Number(b.dia) || 0));
  // El modelo armó el Día 1 como día de llegada pero se llega después: sus días se recorren.
  let list: Array<Record<string, unknown> | null> = [...sorted];
  if (tDays > 0 && sorted.length && !looksTransit(sorted[0])) {
    list = [...new Array(tDays).fill(null), ...sorted];
    ajustes.push(`recorridos ${tDays} día(s): el vuelo llega el ${arrival!.fecha}`);
  }
  if (list.length > N) {
    ajustes.push(`${list.length - N} día(s) de más`);
    list = [...list.slice(0, N - 1), list[list.length - 1]];
  } else if (list.length < N) {
    ajustes.push(`${N - list.length} día(s) libres agregados`);
    const free = new Array(N - list.length).fill(null).map(() => freeDay(destino));
    list = list.length ? [...list.slice(0, -1), ...free, list[list.length - 1]] : free;
  }

  const depMin = arrivalOk && arrival!.salidaHora ? toMin(arrival!.salidaHora) : null;
  const arrAbs = arrivalOk ? tDays * 1440 + toMin(arrival!.hora) : null;
  const readyAbs = arrAbs !== null ? arrAbs + transfer : null;
  const llegaTxt = arrivalOk ? `Llegas a ${destino} a las ${arrival!.hora} (hora local) y te trasladas a tu hotel (aprox. ${fmtHoras(transfer)}).` : "";
  const ret = returnFromFlight(o.flight, dates[N - 1]);

  const out: ItineraryDay[] = list.map((raw, i) => {
    const d: Record<string, unknown> = { ...(raw ?? {}) };
    if ("manana" in d && !("mañana" in d)) { d["mañana"] = d.manana; delete d.manana; }
    for (const s of SLOTS) d[s.key] = slotText(d, s.key);
    d.dia = i + 1;
    d.fecha = dates[i];

    if (arrivalOk && i <= tDays) {
      let arrivalSaid = false;
      let touched = false;
      for (const s of SLOTS) {
        const sStart = i * 1440 + s.start, sEnd = i * 1440 + s.end;
        let txt: string | null = null;
        if (i === 0 && depMin !== null && sEnd <= depMin - margin) txt = `Tiempo libre en ${origen} antes de ir al aeropuerto.`;
        else if (i === 0 && depMin !== null && sStart < depMin) txt = `Traslado al aeropuerto: tu vuelo a ${destino} sale a las ${fromMin(depMin)} (hora de ${origen}).`;
        else if (sEnd <= arrAbs!) txt = `En vuelo hacia ${destino}${sEnd + 360 > arrAbs! || s.key === "noche" ? ` (llegas el ${fmtDia(arrival!.fecha)} a las ${arrival!.hora}, hora local)` : ""}.`;
        else if (readyAbs! > sEnd - 60) { txt = llegaTxt; arrivalSaid = true; }
        else if (!arrivalSaid && sStart >= arrAbs! - 360) {
          // Primera franja útil: se dice la llegada y sigue lo que planeó el modelo (si no era otra llegada).
          const own = slotText(d, s.key);
          txt = own && !TRAVEL_WORDS.test(norm(own)) ? `${llegaTxt} Después: ${own}` : llegaTxt;
          arrivalSaid = true;
        } else if (arrivalSaid && i === tDays && TRAVEL_WORDS.test(norm(slotText(d, s.key)))) {
          txt = "Check-in y descanso en tu hotel.";
        }
        if (txt !== null && txt !== d[s.key]) { d[s.key] = txt; touched = true; }
      }
      if (i < tDays) {
        d.titulo = `Vuelo a ${destino}`;
        d.tipo = "vuelo";
        delete d.costo_aprox_dia;
      } else {
        d.tipo = "llegada";
        if (!/llegad/.test(norm(d.titulo))) d.titulo = `Llegada a ${destino}${d.titulo ? ` · ${String(d.titulo)}` : ""}`;
      }
      if (touched) ajustes.push(`día ${i + 1} ajustado al vuelo`);
    } else if (i === N - 1 && ret && N > 1) {
      const retMin = toMin(ret);
      const leave = Math.max(0, retMin - margin);
      let flying = false;
      for (const s of SLOTS) {
        let txt: string | null = null;
        const own = slotText(d, s.key);
        if (s.start >= retMin) { txt = flying ? "En vuelo de regreso." : `Vuelo de regreso a ${origen}.`; flying = true; }
        else if (s.end > leave) {
          // Franja en la que hay que salir al aeropuerto: lo planeado solo si queda al menos una hora.
          txt = s.start >= leave ? `En el aeropuerto: tu vuelo de regreso sale a las ${ret}.`
            : leave - s.start >= 60 && own
            ? `${own} Sal al aeropuerto a las ${fromMin(leave)}: tu vuelo de regreso sale a las ${ret}.`
            : `Traslado al aeropuerto: tu vuelo de regreso sale a las ${ret}.`;
        }
        if (txt !== null && txt !== own) { d[s.key] = txt; ajustes.push(`último día ajustado al vuelo de regreso (${s.key})`); }
      }
      d.tipo = "salida";
    }
    if (!String(d.titulo ?? "").trim()) d.titulo = i === N - 1 ? `Regreso desde ${destino}` : `Día ${i + 1} en ${destino}`;
    return d as ItineraryDay;
  });
  return { days: out, ajustes };
}
