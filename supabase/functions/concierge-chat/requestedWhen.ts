// Fecha y hora que el usuario PIDIÓ en su mensaje (auditoría 10, ronda 3, N-P1-3). En Modo exigente,
// "Plan para una tarde en Valle de Bravo el sábado 31 de octubre" proponía "Reservar mesa en la opción
// elegida" con la fecha de HOY y las 20:30 (planner.ts fijaba todayISO y una hora inventada). Aquí solo
// se lee lo que el mensaje dice: sin fecha escrita no hay fecha (se pide), sin hora escrita no hay hora.
// Lógica pura (Vitest).

import { datesInText } from "../_shared/activeTrip.ts";
import { mealFromText } from "../_shared/restaurantBooking.ts";

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const addDays = (iso: string, k: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/** YYYY-MM-DD que nombra el mensaje, o null (nunca se adivina). */
export function requestedDate(message: unknown, todayISO: string): string | null {
  const m = norm(message);
  const explicit = datesInText(String(message ?? ""), todayISO).filter((d) => d >= todayISO);
  if (explicit.length) return explicit[0];
  if (/\bpasado manana\b/.test(m)) return addDays(todayISO, 2);
  // "mañana" como día (no "por la mañana", "en la mañana", "de la mañana").
  if (/\bmanana\b/.test(m) && !/\b(la|las|en la|por la|de la|esta)\s+manana\b/.test(m)) return addDays(todayISO, 1);
  if (/\b(hoy|esta noche|hoy en la noche|esta tarde)\b/.test(m)) return todayISO;
  const dow = new Date(`${todayISO}T12:00:00Z`).getUTCDay();
  for (const [name, n] of Object.entries(WEEKDAYS)) {
    const wd = m.match(new RegExp(`\\b${name}(?:\\s+(\\d{1,2}))?\\b`));
    if (!wd) continue;
    // "el sábado 31": el próximo sábado; si el número no coincide con ese sábado, manda el número.
    let d = addDays(todayISO, (n - dow + 7) % 7);
    if (wd[1]) {
      const day = Number(wd[1]);
      for (let k = 0; k < 6 * 7 && Number(d.slice(8, 10)) !== day; k += 7) d = addDays(d, 7);
    }
    return d;
  }
  // "el 31" (sin mes): este mes o el siguiente si ya pasó.
  const solo = m.match(/\bel (\d{1,2})\b(?!\s*(?:de\s+)?[a-z]{3,}\b)(?!\s*(?:personas|pax|hrs?|horas|:))/);
  if (solo) {
    const day = Number(solo[1]);
    if (day >= 1 && day <= 31) {
      const [y, mo] = todayISO.split("-").map(Number);
      for (let k = 0; k < 2; k++) {
        const yy = mo + k > 12 ? y + 1 : y;
        const mm = ((mo + k - 1) % 12) + 1;
        const iso = `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T12:00:00Z`).getUTCDate() === day && iso >= todayISO) return iso;
      }
    }
  }
  return null;
}

/** HH:MM que nombra el mensaje ("a las 9 de la noche", "21:30", "8 pm"), o null. */
export function requestedTime(message: unknown): string | null {
  const m = norm(message);
  if (/\bmedio ?dia\b/.test(m)) return "12:00";
  const hit = m.match(/\b(?:a las|para las|tipo|como a las|alrededor de las)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.? ?m\.?|p\.? ?m\.?|hrs?|horas|de la (?:noche|tarde|manana))?/)
    ?? m.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|hrs?|horas)?\b/)
    ?? m.match(/\b(\d{1,2})\s*(?:)(am|pm)\b/);
  if (!hit) return null;
  let h = Number(hit[1]);
  const min = hit[2] && /^\d{2}$/.test(hit[2]) ? Number(hit[2]) : 0;
  const suf = (hit[3] ?? (hit[2] && !/^\d{2}$/.test(hit[2]) ? hit[2] : "")).replace(/[.\s]/g, "");
  if (h > 23 || min > 59) return null;
  if (/^(pm|delanoche|delatarde)$/.test(suf) && h < 12) h += 12;
  if (/^(am|delamanana)$/.test(suf) && h === 12) h = 0;
  if (!suf && h >= 1 && h <= 11) {
    // Sin am/pm: la comida o la cena dicen la mitad del día ("cena a las 9" = 21:00; "comer a las 2" = 14:00).
    const meal = mealFromText(message);
    if (meal === "cena" || (meal === "comida" && h <= 6)) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export interface RequestedWhen { fecha: string | null; hora: string | null }

export function requestedWhen(message: unknown, todayISO: string): RequestedWhen {
  return { fecha: requestedDate(message, todayISO), hora: requestedTime(message) };
}

const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-10-31" → "sáb 31 oct". */
export function whenLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? `${DIA[d.getUTCDay()]} ${d.getUTCDate()} ${MES[d.getUTCMonth()]}` : iso;
}
