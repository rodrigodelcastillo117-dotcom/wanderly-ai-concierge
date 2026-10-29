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
  /**
   * La llegada no venía guardada: se calculó con la hora de salida y la duración del vuelo, con la zona
   * horaria de cada ciudad (R4 viajes P2-1). Se dice «hacia las…» en vez de «a las…».
   */
  calculada?: boolean;
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
  /**
   * Se llega en avión (no en coche ni autobús). Sin hora de llegada conocida, el Día 1 no afirma nada de
   * la llegada (R3 viajes P1-1: Madrid «Tarde: Llegada, traslado a tu hotel y check-in» con un vuelo que
   * llega al día siguiente y sin horas guardadas).
   */
  enAvion?: boolean;
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
export function arrivalFromFlight(
  f: FlightTimes | null | undefined,
  fechaSalida: string,
): { fecha: string; hora: string; salidaHora: string | null; calculada: boolean } | null {
  const dep = dateOf(f?.salida), arr = dateOf(f?.llegada), hora = clockOf(f?.llegada);
  // Una tarifa de fechas aproximadas (otro día del mes) no dice nada del día de llegada.
  if (!f || dep !== fechaSalida || !arr || !hora || arr < dep) return null;
  return { fecha: arr, hora, salidaHora: clockOf(f.salida), calculada: f.calculada === true };
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

/**
 * Día 1 de un viaje en avión cuando no se sabe a qué hora llega el vuelo: lo que el modelo escribió de la
 * llegada (llegada, aeropuerto, check-in) se cambia por lo que sí se sabe, y lo planeado después se marca
 * como condicionado a la hora del vuelo. Nunca se inventa una hora. Si mañana, tarde y noche no hablan de
 * la llegada, no se toca.
 */
export function neutralArrivalDay(
  day: Record<string, unknown>,
  destino: string,
  o: { llegaElDia1?: boolean } = {},
): { day: Record<string, unknown>; changed: boolean } {
  const d: Record<string, unknown> = { ...day };
  if ("manana" in d && !("mañana" in d)) { d["mañana"] = d.manana; delete d.manana; }
  // Solo cuentan las actividades (mañana, tarde, noche): un título «Llegada» sin hora no afirma nada.
  const mentions = SLOTS.some((s) => TRAVEL_WORDS.test(norm(slotText(d, s.key))));
  if (!mentions || looksTransit(d)) return { day, changed: false };
  const cond = (t: string) => `${t.replace(/[.\s]+$/, "")} (si tu vuelo llega a tiempo).`;
  let flightSaid = false;
  for (const s of SLOTS) {
    const own = slotText(d, s.key);
    if (!own) continue;
    if (!TRAVEL_WORDS.test(norm(own))) {
      if (flightSaid) d[s.key] = cond(own);
      continue;
    }
    // Frase por frase: lo del vuelo o la llegada se cambia; lo demás se queda, condicionado.
    const kept = own.split(/(?<=[.;])\s+/).filter((f) => f.trim() && !TRAVEL_WORDS.test(norm(f))).join(" ").trim();
    const rest = kept ? kept.charAt(0).toUpperCase() + kept.slice(1) : "";
    if (flightSaid) {
      // El traslado también depende de la hora del vuelo (R4 viajes P2-1: «Traslado… al llegar» iba sin salvedad).
      const traslado = "Traslado a tu hotel y check-in al llegar";
      d[s.key] = rest ? `${traslado}; después, ${cond(rest.charAt(0).toLowerCase() + rest.slice(1))}` : `${traslado} (si tu vuelo llega a tiempo).`;
    } else {
      const head = `Vuelo a ${destino}: la hora de llegada depende de tu vuelo; revísala en Comprar.`;
      d[s.key] = rest ? `${head} ${cond(rest)}` : head;
    }
    flightSaid = true;
  }
  // «Llegada» en el título solo si alguna opción de vuelo llega ese mismo día (R4 viajes P2-1: Madrid sale
  // 11:00 con 11 h de vuelo y Tokio 05:45 con 18 h; ninguna llega el día 1).
  d.titulo = o.llegaElDia1 ? `Vuelo y llegada a ${destino}` : `Vuelo a ${destino}`;
  d.tipo = "llegada_sin_hora";
  return { day: d, changed: true };
}

/** Misma ciudad sin acentos ni país ("Roma" = "roma, Italia"); sin ciudad no hay tramo. */
const cityKey = (v: unknown) => norm(v).split(",")[0].trim();

/**
 * Viajes guardados antes de que el servidor ajustara el día de llegada (R3 viajes P1-1: Italia «Sale 22:00 ·
 * llega 22:40 +1» con el Día 1 «Llegada a Fiumicino · Piazza Navona · cena en Trastevere»). Se alinea al
 * mostrar, sin regenerar, con la misma regla que al generar (applyTripCalendar):
 *  - el vuelo llega N días después → los días 1…N son de vuelo y el día de llegada solo lleva lo posterior a
 *    la hora de llegada y el traslado;
 *     · una sola ciudad: lo planeado se recorre N días (si sobra un día al final, se quita el penúltimo, como
 *       al generar);
 *     · varias ciudades (R4 viajes N-P1, Italia 2230848b): SOLO se recorre el tramo de la primera ciudad,
 *       dentro de sus días; lo que no cabe se recorta (los últimos días de esa ciudad). Las demás ciudades
 *       se quedan en sus fechas, que son las de los hoteles y trenes de Comprar (cityStays), y el último día
 *       sigue siendo el de salida. Si la primera ciudad no alcanza ni para el vuelo y la llegada, no se mueve
 *       nada y el día 1 queda sin afirmar la llegada (como sin hora);
 *  - llega el mismo día → las franjas antes de la llegada se cambian por el vuelo;
 *  - sin hora de llegada → neutralArrivalDay (no se afirma nada de la llegada).
 * `days` con numeración única 1…; un itinerario que el servidor ya ajustó (tipo vuelo/llegada) no se toca.
 */
export function alignStoredArrival(
  days: Array<Record<string, unknown>>,
  o: CalendarOptions & { totalDays: number; /** Alguna opción de vuelo de la lista llega el día 1. */ llegaElDia1?: boolean },
): { days: Array<Record<string, unknown>>; ajuste: "recorrido" | "llegada" | "sin_hora" | null } {
  const sorted = [...days].sort((a, b) => Number(a.dia) - Number(b.dia));
  const first = sorted[0];
  if (!o.enAvion || !first || Number(first.dia) !== 1 || !isIso(o.fechaSalida)) return { days, ajuste: null };
  if (sorted.some((d) => /^(vuelo|llegada|llegada_sin_hora)$/.test(String(d.tipo ?? "")))) return { days, ajuste: null };
  const destino = String(o.destino ?? "").trim() || "tu destino";
  const ciudad = first.ciudad != null ? { ciudad: first.ciudad } : {};
  const arrival = arrivalFromFlight(o.flight, o.fechaSalida);
  const t = arrival ? daysBetween(o.fechaSalida, arrival.fecha) : -1;
  const neutral = () => {
    const n = neutralArrivalDay(first, destino, { llegaElDia1: o.llegaElDia1 || (!!arrival && t === 0) });
    if (!n.changed) return { days, ajuste: null };
    return { days: sorted.map((d) => (d === first ? n.day : d)), ajuste: "sin_hora" as const };
  };
  if (!arrival || t < 0 || t >= o.totalDays) return neutral();
  if (t > 0 && looksTransit(first)) return { days, ajuste: null };
  // Tramo de la primera ciudad: hasta el día antes de que empiece otra ciudad en el plan.
  const c0 = cityKey(first.ciudad);
  const nextIdx = c0 ? sorted.findIndex((d) => { const c = cityKey(d.ciudad); return !!c && c !== c0; }) : -1;
  const multi = nextIdx > 0;
  const cap = multi ? Number(sorted[nextIdx].dia) - 1 : o.totalDays;
  if (multi && t > 0 && t + 1 > cap) return neutral();
  // La misma regla de la generación, en una ventana de t + 1 días (vuelo… llegada) sin vuelo de regreso.
  const flight = { salida: o.flight?.salida ?? null, llegada: o.flight?.llegada ?? null, calculada: o.flight?.calculada === true };
  const win = applyTripCalendar([first], {
    fechaSalida: o.fechaSalida, fechaRegreso: addDaysIso(o.fechaSalida, t), destino, origen: o.origen, flight,
    internacional: o.internacional, transferMin: o.transferMin,
  }).days.map((d): Record<string, unknown> => ({ ...ciudad, ...d }));
  const changed = t > 0 || SLOTS.some((s) => win[0][s.key] !== slotText(first, s.key));
  if (!changed) return { days, ajuste: null };
  // Llega de noche y no queda nada de lo planeado ese día: el título no promete «Primeros pasos…».
  const arrDay = win[win.length - 1];
  if (t > 0 && !SLOTS.some((s) => { const own = slotText(first, s.key); return !!own && String(arrDay[s.key] ?? "").includes(own); })) {
    arrDay.titulo = `Llegada a ${destino}`;
  }
  const shift = (d: Record<string, unknown>) => ({ ...d, dia: Number(d.dia) + t, fecha: addDaysIso(o.fechaSalida, Number(d.dia) + t - 1) });
  if (multi) {
    // Solo la primera ciudad se recorre, sin pasar a los días de la siguiente.
    const block = sorted.slice(1, nextIdx).map(shift).filter((d) => d.dia <= cap);
    return { days: [...win, ...block, ...sorted.slice(nextIdx)], ajuste: t > 0 ? "recorrido" : "llegada" };
  }
  const rest = sorted.slice(1).map(shift);
  let out: Array<Record<string, unknown>> = [...win, ...rest];
  const last = out[out.length - 1];
  if (t > 0 && Number(last.dia) > o.totalDays) {
    // Sobran días al final: el último (regreso) queda en el último día del calendario y se quita lo que no cabe.
    out = [...out.slice(0, -1).filter((d) => Number(d.dia) < o.totalDays), { ...last, dia: o.totalDays, fecha: addDaysIso(o.fechaSalida, o.totalDays - 1) }];
  }
  return { days: out, ajuste: t > 0 ? "recorrido" : "llegada" };
}

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
  // Llegada calculada (salida + duración, R4 viajes P2-1): «hacia las», y se dice de dónde sale la hora.
  const aLas = arrival?.calculada ? "hacia las" : "a las";
  const horaLocal = arrival?.calculada ? "hora local, calculada con la salida y la duración del vuelo" : "hora local";
  const llegaTxt = arrivalOk ? `Llegas a ${destino} ${aLas} ${arrival!.hora} (${horaLocal}) y te trasladas a tu hotel (aprox. ${fmtHoras(transfer)}).` : "";
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
        else if (sEnd <= arrAbs!) txt = `En vuelo hacia ${destino}${sEnd + 360 > arrAbs! || s.key === "noche" ? ` (llegas el ${fmtDia(arrival!.fecha)} ${aLas} ${arrival!.hora}, hora local)` : ""}.`;
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
    if (i === 0 && !arrivalOk && o.enAvion && N > 1) {
      // En avión sin hora de llegada (tarifa estimada): el Día 1 no afirma nada de la llegada.
      const n = neutralArrivalDay(d, destino);
      if (n.changed) { Object.assign(d, n.day); ajustes.push("día 1 sin hora de llegada"); }
    }
    if (!String(d.titulo ?? "").trim()) d.titulo = i === N - 1 ? `Regreso desde ${destino}` : `Día ${i + 1} en ${destino}`;
    return d as ItineraryDay;
  });
  return { days: out, ajustes };
}
