// Interpretación local de una frase de viaje para cuando la IA no responde.
// No pretende igualar a parsear-viaje: solo evita perder lo que escribió el usuario.

export type TripFallback = {
  destino: string | null;
  fechaSalida: string | null;
  fechaRegreso: string | null;
  viajeros: number | null;
};

const DAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const titleCase = (s: string) =>
  s.split(/\s+/).map((w) => (/^(de|del|la|las|los|el|y)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(" ");

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const nextWeekday = (from: Date, day: number) => {
  const d = new Date(from);
  d.setDate(d.getDate() + (((day - d.getDay() + 7) % 7) || 7));
  return d;
};

const STOP = "a|al|en|con|de|del|desde|para|por|el|la|los|las|este|esta|proximo|proxima|unos?|unas?|hotel|hospedaje|airbnb|todo";

const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7,
  septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};
const MONTH_RE = Object.keys(MONTHS).join("|");

/** Fecha válida del calendario; sin año explícito, la próxima vez que ocurra desde hoy. */
function dateFrom(day: number, month: number, year: number | null, today: Date): Date | null {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const y = year ?? today.getFullYear();
  let d = new Date(y, month, day);
  if (d.getMonth() !== month) return null;
  if (year == null && d < base) d = new Date(y + 1, month, day);
  return d;
}

/** "del 12 al 16 de diciembre", "12 de diciembre al 3 de enero" (con o sin año). */
function explicitRange(text: string, today: Date): [string, string] | null {
  const two = text.match(new RegExp(`(\\d{1,2})\\s+de\\s+(${MONTH_RE})(?:\\s+(?:de|del)\\s+(\\d{4}))?\\s+al?\\s+(\\d{1,2})\\s+de\\s+(${MONTH_RE})(?:\\s+(?:de|del)\\s+(\\d{4}))?`));
  if (two) {
    const s = dateFrom(Number(two[1]), MONTHS[two[2]], two[3] ? Number(two[3]) : null, today);
    if (!s) return null;
    let e = dateFrom(Number(two[4]), MONTHS[two[5]], two[6] ? Number(two[6]) : s.getFullYear(), today);
    if (e && e <= s) e = dateFrom(Number(two[4]), MONTHS[two[5]], s.getFullYear() + 1, today);
    return e ? [iso(s), iso(e)] : null;
  }
  const one = text.match(new RegExp(`(\\d{1,2})\\s+al?\\s+(\\d{1,2})\\s+de\\s+(${MONTH_RE})(?:\\s+(?:de|del)\\s+(\\d{4}))?`));
  if (one) {
    const year = one[4] ? Number(one[4]) : null;
    const s = dateFrom(Number(one[1]), MONTHS[one[3]], year, today);
    if (!s) return null;
    const e = dateFrom(Number(one[2]), MONTHS[one[3]], s.getFullYear(), today);
    return e && e > s ? [iso(s), iso(e)] : null;
  }
  return null;
}

/**
 * Destino al inicio de la frase ("Oaxaca del 12 al 16…", "Ciudad de México, 2 personas"): solo si
 * empieza con mayúscula, son pocas palabras y lo que sigue es una fecha, viajeros o una coma.
 */
function leadingPlace(original: string): string | null {
  const m = original.match(/^\s*([A-ZÁÉÍÓÚÑ][\p{L}'.-]*(?:\s+(?:de|del|la|las|los|el|[A-ZÁÉÍÓÚÑ][\p{L}'.-]*)){0,3})\s*(?=,|\s+\d|\s+(?:del?|en|con|para|por|el|este|esta|un|una)\b|$)/u);
  if (!m) return null;
  const place = m[1].replace(/\s+(?:de|del|la|las|los|el)$/i, "").trim();
  return place.split(/\s+/).length <= 4 ? place : null;
}

export function parseTripFallback(query: string, today = new Date()): TripFallback {
  const text = strip(query.trim());
  const original = query.trim();

  let destino: string | null = null;
  const m = text.match(
    new RegExp(`(?:viaje|viajar|ir|irme|escapada|vacaciones|vuelo|volar)\\s+(?:a|al|en|para|hacia)\\s+(.+?)(?=\\s+(?:${STOP})\\b|[,.;!?]|$)`),
  );
  if (m) {
    // Recuperar acentos y mayúsculas del texto original en la misma posición.
    const start = text.indexOf(m[1], m.index);
    destino = titleCase(original.slice(start, start + m[1].length));
  } else if (original.split(/\s+/).length <= 3) {
    destino = titleCase(original);
  } else {
    destino = leadingPlace(original);
  }

  let fechaSalida: string | null = null;
  let fechaRegreso: string | null = null;
  const range = text.match(/de\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+a\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)/);
  const explicit = explicitRange(text, today);
  if (explicit) {
    [fechaSalida, fechaRegreso] = explicit;
  } else if (range) {
    const salida = nextWeekday(today, DAYS[range[1]]);
    fechaSalida = iso(salida);
    fechaRegreso = iso(nextWeekday(salida, DAYS[range[2]]));
  } else if (/fin de semana/.test(text)) {
    const viernes = nextWeekday(today, 5);
    fechaSalida = iso(viernes);
    fechaRegreso = iso(nextWeekday(viernes, 0));
  }

  let viajeros: number | null = null;
  const n = text.match(/(\d{1,2})\s*(?:personas|viajeros|adultos|pax)/);
  if (n) viajeros = Number(n[1]);
  else if (/\b(pareja|novi[oa]|espos[oa]|luna de miel)\b/.test(text)) viajeros = 2;
  else if (/\b(solo|sola)\b/.test(text)) viajeros = 1;

  return { destino, fechaSalida, fechaRegreso, viajeros };
}
