/**
 * Valores por defecto inteligentes para planear (puros, para probarlos).
 *
 * - Atajos de fechas: el formulario pedía escribir dos fechas a mano en el celular; con un toque
 *   se elige "este fin de semana", "en 2 semanas" o "en un mes" y se pueden ajustar después.
 * - Frase natural: si el usuario escribe "Oaxaca del 12 al 16 de diciembre, 2 personas" en el
 *   campo de destino, antes esa frase completa viajaba como destino al análisis. Ahora se
 *   interpreta en el dispositivo (sin IA y sin costo) y se prellenan destino, fechas y viajeros.
 */
import { formatLocalDate, localISODate } from "@/lib/localDate";
import { parseTripFallback } from "@/lib/parseTripFallback";
import { parseMultiCityText } from "@/lib/multiCityText";
import { tripDayDate } from "@/lib/tripDayDate";

export type DatePreset = { key: "finde" | "dos_semanas" | "un_mes"; label: string; hint: string; salida: string; regreso: string };

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function datePresets(today: Date = new Date()): DatePreset[] {
  const base = addDays(today, 0);
  // Próximo viernes (si hoy es viernes o sábado, el de la siguiente semana: no da tiempo de cotizar).
  const toFriday = ((5 - base.getDay() + 7) % 7) || 7;
  const viernes = addDays(base, base.getDay() === 6 ? 6 : toFriday);
  const dos = addDays(base, 14);
  const mes = addDays(base, 30);
  return [
    { key: "finde", label: "Fin de semana", hint: "viernes a domingo", salida: localISODate(viernes), regreso: localISODate(addDays(viernes, 2)) },
    { key: "dos_semanas", label: "En 2 semanas", hint: "5 noches", salida: localISODate(dos), regreso: localISODate(addDays(dos, 5)) },
    { key: "un_mes", label: "En un mes", hint: "1 semana", salida: localISODate(mes), regreso: localISODate(addDays(mes, 7)) },
  ];
}

/** ¿Escribió una frase (fechas, viajeros, varias palabras) en vez de solo un destino? */
export function looksLikeSentence(text: string): boolean {
  const t = text.trim();
  if (!t || /→|->|\s-\s|\|/.test(t)) return false; // las travesías "Roma → Florencia" van al builder de ruta
  const words = t.split(/\s+/).length;
  return /\d/.test(t) || words > 4 || /\b(personas?|viajeros?|pareja|familia|amigos|fin de semana)\b/i.test(t);
}

export type Understood = {
  destino: string | null;
  fechaSalida: string | null;
  fechaRegreso: string | null;
  viajeros: number | null;
  /** Noches que dice la frase ("Roma 5 días" → 4), para proponer el regreso. */
  nights?: number | null;
};

/** Interpretación local de la frase del paso 1; null si no es una frase o no se entendió el destino. */
export function understandPlanText(text: string, today: Date = new Date()): Understood | null {
  if (!looksLikeSentence(text)) return null;
  const r = parseTripFallback(text, today);
  // Una sola ciudad conocida y nada más que duración/fechas ("Roma 5 días"): el destino es la ciudad,
  // no "Roma 5 Días".
  const mc = parseMultiCityText(text);
  const destino = mc.cities.length === 1 && !mc.unknown.length && !mc.countries.length ? mc.cities[0] : r.destino;
  if (!destino) return null;
  const viajeros = r.viajeros && r.viajeros >= 1 && r.viajeros <= 20 ? r.viajeros : null;
  return { destino, fechaSalida: r.fechaSalida, fechaRegreso: r.fechaRegreso, viajeros, ...(mc.nights ? { nights: mc.nights } : {}) };
}

/** Ejemplos que se pueden tocar para empezar (no son ofertas ni precios). */
export const EXAMPLE_PROMPTS = [
  "Oaxaca un fin de semana, 2 personas",
  "Roma → Florencia → Venecia",
  "Cancún en diciembre con mi familia",
] as const;

/** "Desde Ciudad de México · 12 dic – 16 dic · 2 viajeros" para la pantalla de análisis. */
export function analysisSummaryOf(a: { ciudad_origen?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null; num_viajeros?: number | null }): string {
  const parts: string[] = [];
  if (a.ciudad_origen) parts.push(`Desde ${a.ciudad_origen}`);
  if (a.fecha_salida && a.fecha_regreso) {
    parts.push(`${formatLocalDate(a.fecha_salida, { day: "numeric", month: "short" })} – ${formatLocalDate(a.fecha_regreso, { day: "numeric", month: "short" })}`);
  } else {
    parts.push("fechas sugeridas por IATOS");
  }
  if (a.num_viajeros) parts.push(`${a.num_viajeros} ${a.num_viajeros === 1 ? "viajero" : "viajeros"}`);
  return parts.join(" · ");
}


/** Domingo de Pascua (calendario gregoriano, algoritmo anónimo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Temporadas festivas que encarecen y llenan vuelos y hoteles (se evitan al sugerir fechas). */
export function holidayPeriods(year: number): { label: string; from: string; to: string }[] {
  const easter = easterSunday(year);
  return [
    { label: "Navidad y Año Nuevo", from: `${year - 1}-12-18`, to: `${year}-01-07` },
    { label: "Semana Santa y Pascua", from: localISODate(addDays(easter, -8)), to: localISODate(addDays(easter, 7)) },
    { label: "Navidad y Año Nuevo", from: `${year}-12-18`, to: `${year + 1}-01-07` },
  ];
}

export type SuggestedDates = { salida: string; regreso: string; nights: number; avoided: string[] };

/**
 * Fechas SUGERIDAS para una idea de destino (tarjetas de Inicio): martes a martes (7 noches) a unos
 * 60 días. Si la ventana cae en Navidad/Año Nuevo o Semana Santa se recorre al siguiente martes libre
 * y se dice qué se evitó. Solo prellenan el formulario: nada se cotiza hasta que la persona confirma.
 */
export function suggestTripDates(today: Date = new Date(), nights = 7): SuggestedDates {
  let out = addDays(today, 60);
  while (out.getDay() !== 2) out = addDays(out, 1);
  const avoided = new Set<string>();
  for (let guard = 0; guard < 20; guard++) {
    const s = localISODate(out), r = localISODate(addDays(out, nights));
    const hit = [...holidayPeriods(out.getFullYear()), ...holidayPeriods(out.getFullYear() + 1)]
      .find((p) => s <= p.to && r >= p.from);
    if (!hit) return { salida: s, regreso: r, nights, avoided: [...avoided] };
    avoided.add(hit.label);
    out = addDays(out, 7);
  }
  return { salida: localISODate(out), regreso: localISODate(addDays(out, nights)), nights, avoided: [...avoided] };
}

/** Aviso visible de las fechas sugeridas: de dónde salen y que se pueden cambiar. */
export function suggestedDatesNotice(destino: string, s: SuggestedDates, hasOrigin: boolean): string {
  // "mar 12 ene 2027" (mismo estilo que el itinerario).
  const f = (v: string) => `${tripDayDate(v) ?? formatLocalDate(v)} ${v.slice(0, 4)}`;
  const evit = s.avoided.length ? ` Evitamos ${s.avoided.join(" y ")} (temporada alta).` : "";
  const pre = hasOrigin ? "" : `Para cotizar ${destino} necesitamos tu ciudad de salida. Elígela y revisa las fechas. `;
  return `${pre}Fechas sugeridas para ${destino}: ${f(s.salida)} → ${f(s.regreso)} (${s.nights} noches, martes a martes, que suelen ser más baratos).${evit} Cámbialas si quieres: nada se cotiza hasta que pulses «Armar mi viaje».`;
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Mes (y año) que dice la frase sin fechas exactas ("Toscana 5 días en abril 2027" → abril de 2027). Sin año,
 * el próximo abril. Se muestra en "Entendimos…" y se pide la salida en ese mes: no se inventa el día.
 */
export function monthOfText(text: string, today: Date = new Date()): { month: number; year: number; label: string } | null {
  const t = String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const m = new RegExp(`\\b(?:en|para|de|a finales de|a principios de|a mediados de)?\\s*(${MONTH_NAMES.join("|")}|setiembre)(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b`).exec(t);
  if (!m) return null;
  // "del 12 al 16 de diciembre": eso son fechas exactas, no solo un mes.
  if (/\b\d{1,2}\s*(?:al|-|a)\s*\d{1,2}\s+de\b/.test(t) || new RegExp(`\\b\\d{1,2}\\s+de\\s+${m[1]}`).test(t)) return null;
  const month = m[1] === "setiembre" ? 8 : MONTH_NAMES.indexOf(m[1]);
  let year = m[2] ? Number(m[2]) : today.getFullYear();
  if (!m[2] && (month < today.getMonth())) year += 1;
  return { month, year, label: `${MONTH_NAMES[month]} de ${year}` };
}
