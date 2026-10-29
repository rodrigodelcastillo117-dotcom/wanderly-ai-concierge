// Modo viaje en vivo: en qué momento del viaje estás y qué plan toca (auditoría 10/10, P1-6).
//
// Antes: antes de empezar decía "Día 1 de 3" y "HOY · Tu día está libre" aunque el día 1 sí tenía plan
// de mañana, tarde y noche en itinerario_json (solo se leían `actividades` o `plan`).
// Ahora: antes de empezar no hay "Día N" ni "Hoy": se muestra "Empieza en N días" y el plan del primer
// día como adelanto; durante el viaje, "Día N de M" y el plan de hoy; al terminar, ningún "hoy".
import { diffLocalDays, localISODate } from "@/lib/localDate";

export type LivePhase = "antes" | "en_curso" | "terminado";
export type LiveSlot = { label: string; text: string; hora?: string | null };
export type LiveDay = {
  phase: LivePhase;
  /** Día del viaje (1…total) solo en curso; null antes y después. */
  dayNumber: number | null;
  totalDays: number;
  /** Días que faltan para salir (solo antes). */
  daysUntil: number | null;
  /** Índice del día que se muestra: hoy (en curso) o el primero (antes, como adelanto). null al terminar. */
  shownIndex: number | null;
  title: string | null;
  slots: LiveSlot[];
  /** Hay un día del itinerario para ese índice (aunque no traiga actividades). */
  hasPlan: boolean;
};

type Trip = { fecha_salida?: string | null; fecha_regreso?: string | null; itinerario_json?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Días del itinerario: lista (destino único) u objeto { days } (multidestino o con consulta). */
export function itineraryDays(itin: unknown): any[] {
  if (Array.isArray(itin)) return itin;
  if (itin && typeof itin === "object" && Array.isArray((itin as { days?: unknown }).days)) return (itin as { days: any[] }).days;
  return [];
}

/** Lo que hay que hacer ese día, en el formato que tenga: mañana/tarde/noche, actividades o plan. */
export function daySlots(day: any): LiveSlot[] {
  if (!day || typeof day !== "object") return [];
  const out: LiveSlot[] = [];
  for (const [label, v] of [["Mañana", day["mañana"] ?? day.manana], ["Tarde", day.tarde], ["Noche", day.noche]] as const) {
    const t = str(v);
    if (t) out.push({ label, text: t });
  }
  const list: unknown[] = Array.isArray(day.actividades) ? day.actividades : Array.isArray(day.plan) ? day.plan : [];
  for (const a of list) {
    if (typeof a === "string") { if (str(a)) out.push({ label: "", text: str(a) }); continue; }
    const o = (a ?? {}) as Record<string, unknown>;
    const t = str(o.actividad) || str(o.titulo) || str(o.descripcion) || str(o.nombre);
    if (t) out.push({ label: "", text: t, hora: str(o.hora) || str(o.horario) || null });
  }
  if (Array.isArray(day.agregados)) {
    for (const a of day.agregados) {
      const t = str(a?.titulo);
      if (t) out.push({ label: "Agregado por ti", text: a?.lugar ? `${t} — ${str(a.lugar)}` : t, hora: str(a?.hora) || null });
    }
  }
  return out;
}

export function liveDay(trip: Trip | null | undefined, today: string = localISODate()): LiveDay {
  const start = trip?.fecha_salida ?? null;
  const end = trip?.fecha_regreso ?? start;
  const totalDays = start && end ? Math.max(1, diffLocalDays(start, end) + 1) : 1;
  const days = itineraryDays(trip?.itinerario_json);
  const pick = (i: number) => {
    const d = days[i] ?? null;
    return { title: str(d?.titulo) || null, slots: daySlots(d), hasPlan: !!d };
  };
  if (!start) return { phase: "en_curso", dayNumber: null, totalDays, daysUntil: null, shownIndex: 0, ...pick(0) };
  const sinceStart = diffLocalDays(start, today);
  if (sinceStart < 0) {
    return { phase: "antes", dayNumber: null, totalDays, daysUntil: -sinceStart, shownIndex: 0, ...pick(0) };
  }
  if (end && diffLocalDays(end, today) > 0) {
    return { phase: "terminado", dayNumber: null, totalDays, daysUntil: null, shownIndex: null, title: null, slots: [], hasPlan: false };
  }
  const idx = Math.min(sinceStart, totalDays - 1);
  return { phase: "en_curso", dayNumber: idx + 1, totalDays, daysUntil: null, shownIndex: idx, ...pick(idx) };
}

/** "Empieza mañana", "Empieza en 2 días". */
export function startsInLabel(days: number): string {
  return days <= 0 ? "Empieza hoy" : days === 1 ? "Empieza mañana" : `Empieza en ${days} días`;
}
