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
};

/** Interpretación local de la frase del paso 1; null si no es una frase o no se entendió el destino. */
export function understandPlanText(text: string, today: Date = new Date()): Understood | null {
  if (!looksLikeSentence(text)) return null;
  const r = parseTripFallback(text, today);
  if (!r.destino) return null;
  const viajeros = r.viajeros && r.viajeros >= 1 && r.viajeros <= 20 ? r.viajeros : null;
  return { destino: r.destino, fechaSalida: r.fechaSalida, fechaRegreso: r.fechaRegreso, viajeros };
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

