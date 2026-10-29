/**
 * "Ahorro para tu viaje": cuánto apartar cada mes para llegar a la meta. Funciona SIN viaje
 * planeado: destino, fecha, costo y lo ahorrado los escribe la persona (o vienen de un viaje suyo).
 * Todo en pesos (MXN). Pura, para probarla.
 */
import { parseLocalDate } from "@/lib/localDate";

/**
 * Meses completos entre hoy y la fecha (misma regla que la calculadora anterior): si el día del
 * mes de salida es anterior al de hoy, ese mes no cuenta completo. Nunca negativo.
 */
export function monthsUntil(target: Date, now: Date): number {
  let m = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  if (target.getDate() < now.getDate()) m -= 1;
  return Math.max(0, m);
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type GoalState = "sin_costo" | "sin_fecha" | "fecha_pasada" | "cubierto" | "ok";

export type GoalInput = {
  /** Costo total del viaje en MXN. */
  costMxn: number;
  /** Lo que ya tiene ahorrado para el viaje, en MXN. */
  savedMxn: number;
  /** Fecha de salida YYYY-MM-DD. */
  dateISO: string | null | undefined;
  now?: Date;
};

export type GoalResult = {
  estado: GoalState;
  costo: number;
  ahorrado: number;
  faltante: number;
  /** Meses completos hasta la salida (0 = sale este mes). */
  meses: number;
  /** Meses en que se reparte el ahorro (mínimo 1: si sale este mes, hay que tenerlo ya). */
  mesesAhorro: number;
  mensual: number;
  /** Lo mismo que `mensual`, por semana (mensual × 12 / 52). */
  semanal: number;
  /** Avance de 0 a 1 (ahorrado / costo). */
  avance: number;
  /** Calendario acumulado (como mucho 24 meses; si hay más, se resume). */
  calendario: { mes: string; acumulado: number }[];
};

const pos = (v: unknown) => Math.max(0, Number(v) || 0);

export function computeGoal({ costMxn, savedMxn, dateISO, now = new Date() }: GoalInput): GoalResult {
  const costo = pos(costMxn);
  const ahorrado = pos(savedMxn);
  const faltante = Math.max(0, costo - ahorrado);
  const avance = costo > 0 ? Math.min(1, ahorrado / costo) : 0;
  const base = { costo, ahorrado, faltante, avance, meses: 0, mesesAhorro: 1, mensual: 0, semanal: 0, calendario: [] as GoalResult["calendario"] };

  if (costo === 0) return { ...base, estado: "sin_costo" };
  if (faltante === 0) return { ...base, estado: "cubierto" };
  const fecha = parseLocalDate(dateISO);
  if (!fecha) return { ...base, estado: "sin_fecha" };
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (fecha < hoy) return { ...base, estado: "fecha_pasada" };

  const meses = monthsUntil(fecha, now);
  const mesesAhorro = Math.max(1, meses);
  const mensual = faltante / mesesAhorro;
  // Mismo plan que el mensual, contado por semana (un mes = 52/12 semanas). Antes se dividía el faltante
  // entre las semanas hasta la salida y no cuadraba con "X al mes durante N meses" (auditoría 10/10, P2-9).
  const semanal = (mensual * 12) / 52;

  const calendario: GoalResult["calendario"] = [];
  for (let i = 1; i <= Math.min(mesesAhorro, 24); i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i - 1, 1);
    calendario.push({ mes: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, acumulado: ahorrado + mensual * i });
  }
  return { ...base, estado: "ok", meses, mesesAhorro, mensual, semanal, calendario };
}
