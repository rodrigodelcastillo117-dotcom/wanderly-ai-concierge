// Alertas de la Bóveda: vigencias y requisitos de entrada para tus próximos viajes.
// Reglas con fuente: solo las que se revisaron en un sitio oficial (`sourceUrl`) para pasaporte
// MEXICANO. Cualquier otro caso es un aviso genérico "verifica requisitos" con la Guía del Viajero
// de la SRE. Nada de esto sustituye la consulta oficial: los requisitos cambian.
import { diffLocalDays, formatLocalDate, localISODate, parseLocalDate } from "@/lib/localDate";
import type { VaultItem } from "./types";
import { shortTripName } from "@/lib/tripName";
import { SRE_GUIA_LABEL, SRE_GUIA_URL } from "../../../supabase/functions/_shared/sre.ts";

export type TripLite = {
  id: string;
  destino: string;
  pais_destino?: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  status?: string | null;
};

export type AlertLevel = "critica" | "aviso" | "info";

export type VaultAlert = {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  itemId?: string;
  tripId?: string;
  sourceUrl?: string;
  sourceLabel?: string;
};

export const SRE_GUIDE = { url: SRE_GUIA_URL, label: SRE_GUIA_LABEL };

export { COUNTRY_NAME, countryFromText, ENTRY_RULES_MX, SCHENGEN } from "../../../supabase/functions/_shared/entryRulesMx.ts";
import { countryFromText, ENTRY_RULES_MX, SCHENGEN } from "../../../supabase/functions/_shared/entryRulesMx.ts";

export function countryOfTrip(trip: Pick<TripLite, "destino" | "pais_destino">): string | null {
  return countryFromText(trip.pais_destino) ?? countryFromText(trip.destino);
}

export type ExpiryState = "vencido" | "pronto" | "vigente" | "sin_fecha";

/** Estado de vigencia: "pronto" = vence en 90 días o menos. */
export function expiryStatus(expires: string | null | undefined, today = localISODate()): { state: ExpiryState; days: number | null } {
  if (!expires || !parseLocalDate(expires)) return { state: "sin_fecha", days: null };
  const days = diffLocalDays(today, expires);
  if (days < 0) return { state: "vencido", days };
  if (days <= 90) return { state: "pronto", days };
  return { state: "vigente", days };
}

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
};

export const fmtDate = (iso: string) => formatLocalDate(iso, { day: "numeric", month: "short", year: "numeric" });
const fmt = fmtDate;

const listJoin = (xs: string[]) => {
  const u = Array.from(new Set(xs));
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} y ${u[u.length - 1]}`;
};

const tripEnd = (t: TripLite) => t.fecha_regreso || t.fecha_salida;

/** Viajes por venir (o en curso) con fechas, ordenados por salida. */
export function upcomingTrips(trips: TripLite[], today = localISODate()): TripLite[] {
  return trips
    .filter((t) => !!t.fecha_salida && (tripEnd(t) ?? "") >= today && !/cancel/i.test(t.status ?? ""))
    .sort((a, b) => (a.fecha_salida ?? "").localeCompare(b.fecha_salida ?? ""));
}

const validThrough = (item: VaultItem, date: string) => !item.expires_on || item.expires_on >= date;

const LEVEL_ORDER: Record<AlertLevel, number> = { critica: 0, aviso: 1, info: 2 };

export function buildAlerts(items: VaultItem[], trips: TripLite[], today = localISODate()): VaultAlert[] {
  const alerts: VaultAlert[] = [];
  const passports = items.filter((i) => i.kind === "pasaporte").sort((a, b) => (b.expires_on ?? "9999").localeCompare(a.expires_on ?? "9999"));
  const passport = passports[0] ?? null;
  const nationality = passport?.country_code ?? null;
  const ppNone: TripLite[] = [], ppExp: TripLite[] = [], pp6m: TripLite[] = [];

  // Primero se descartan los viajes nacionales y DESPUÉS se toman los 6 más próximos: antes se recortaba
  // primero y, con seis viajes por México antes, el de Tokio nunca se revisaba (auditoría 10/10, P1-2).
  const isDomestic = (t: TripLite) => countryOfTrip(t) === "MX" && (nationality === "MX" || nationality === null);
  for (const trip of upcomingTrips(trips, today).filter((t) => !isDomestic(t)).slice(0, 6)) {
    const country = countryOfTrip(trip);
    const start = trip.fecha_salida as string;
    const end = tripEnd(trip) as string;
    const where = shortTripName(trip);

    // Pasaporte: se junta en UNA alerta por problema con todos los destinos afectados.
    if (!passport) ppNone.push(trip);
    else if (passport.expires_on && passport.expires_on < end) ppExp.push(trip);
    else if (passport.expires_on && passport.expires_on < addMonths(end, 6)) pp6m.push(trip);

    // Visas guardadas para ese destino que vencen antes del viaje (cualquier nacionalidad).
    const visaKey = country && SCHENGEN.has(country) ? ["EU", country] : country ? [country] : [];
    const destVisas = items.filter((i) => (i.kind === "visa" || i.kind === "autorizacion") && i.country_code && visaKey.includes(i.country_code));
    for (const v of destVisas) {
      if (v.expires_on && v.expires_on < end) {
        alerts.push({ id: `visa-exp-${v.id}-${trip.id}`, level: "critica", tripId: trip.id, itemId: v.id,
          title: `${v.title} vence antes de tu viaje a ${where}`,
          detail: `Vence el ${fmt(v.expires_on)} y regresas el ${fmt(end)}.` });
      }
    }

    // Requisitos de entrada (solo reglas con fuente, pasaporte mexicano).
    const ruleKey = country && SCHENGEN.has(country) ? "SCHENGEN" : country;
    const rule = nationality === "MX" && ruleKey ? ENTRY_RULES_MX[ruleKey] : undefined;
    if (rule) {
      const covered = (kinds: string[]) => destVisas.some((v) => kinds.includes(v.kind) && validThrough(v, end));
      const ok = rule.needs === null ? false
        : rule.needs === "visa" ? covered(["visa"])
        : covered(["visa", "autorizacion"]);
      if (!ok) {
        alerts.push({ id: `entry-${trip.id}`, level: rule.level, tripId: trip.id, title: `${rule.title} · ${where}`,
          detail: rule.detail, sourceUrl: rule.sourceUrl, sourceLabel: rule.sourceLabel });
      }
    } else {
      alerts.push({ id: `entry-${trip.id}`, level: "info", tripId: trip.id, title: `Verifica requisitos de entrada · ${where}`,
        detail: nationality && nationality !== "MX"
          ? "Los requisitos dependen de tu nacionalidad y de tu destino; revísalos en el sitio oficial."
          : "No tenemos una regla revisada para este destino; consulta visa, vacunas y vigencia del pasaporte en la fuente oficial.",
        sourceUrl: SRE_GUIDE.url, sourceLabel: SRE_GUIDE.label });
    }

    // Seguro de viaje que no cubre todo el viaje.
    const insurances = items.filter((i) => i.kind === "seguro_viaje" || i.kind === "asistencia");
    if (insurances.length && !insurances.some((i) => validThrough(i, end) && (!i.valid_from || i.valid_from <= start))) {
      alerts.push({ id: `ins-${trip.id}`, level: "aviso", tripId: trip.id, title: `Tu seguro de viaje no cubre todo tu viaje a ${where}`,
        detail: "Revisa las fechas de tu póliza o agrega la de este viaje." });
    }
  }

  const places = (ts: TripLite[]) => listJoin(ts.map((t) => shortTripName(t)));
  if (ppNone.length) {
    alerts.push({ id: `pp-none-${ppNone[0].id}`, level: "aviso", tripId: ppNone[0].id, title: `Agrega tu pasaporte para ${places(ppNone)}`,
      detail: "Así revisamos su vigencia contra las fechas de tus viajes." });
  }
  if (passport?.expires_on && ppExp.length) {
    // Dos casos distintos: vence ya en camino ("vence el 15 feb y viajas del 10 al 20") o vence antes de
    // salir. Cada uno con su alerta y sus destinos (antes todo decía "antes de tu viaje").
    const exp = passport.expires_on;
    const during = ppExp.filter((t) => exp >= (t.fecha_salida as string));
    const before = ppExp.filter((t) => exp < (t.fecha_salida as string));
    for (const [group, kind] of [[during, "durante"], [before, "antes"]] as const) {
      if (!group.length) continue;
      const end = tripEnd(group[0]) as string;
      // Con varios viajes, la fecha de CADA uno (R2: «…tu viaje a Tokio y Lima… regresas el 20 feb», y Lima
      // regresa el 16 feb).
      const each = (pick: (t: TripLite) => string) => listJoin(group.map((t) => `${kind === "durante" ? "de" : "a"} ${shortTripName(t)} el ${fmt(pick(t))}`));
      alerts.push({ id: `pp-exp-${kind}-${group[0].id}`, level: "critica", tripId: group[0].id, itemId: passport.id,
        title: kind === "durante" ? `Tu pasaporte vence durante tu viaje a ${places(group)}` : `Tu pasaporte vence antes de tu viaje a ${places(group)}`,
        detail: kind === "durante"
          ? group.length > 1
            ? `Vence el ${fmt(exp)} y regresas ${each((t) => tripEnd(t) as string)}. Renuévalo antes de viajar.`
            : `Vence el ${fmt(exp)} y regresas el ${fmt(end)}. Renuévalo antes de viajar.`
          : group.length > 1
            ? `Vence el ${fmt(exp)}, antes de que salgas ${each((t) => t.fecha_salida as string)}. Renuévalo antes de viajar.`
            : `Vence el ${fmt(exp)}, antes de que salgas el ${fmt(group[0].fecha_salida as string)}. Renuévalo antes de viajar.`,
        sourceUrl: "https://www.gob.mx/sre", sourceLabel: "SRE" });
    }
  }
  if (passport?.expires_on && pp6m.length) {
    alerts.push({ id: `pp-6m-${pp6m[0].id}`, level: "aviso", tripId: pp6m[0].id, itemId: passport.id,
      title: `Pasaporte con menos de 6 meses de vigencia para ${places(pp6m)}`,
      detail: `Vence el ${fmt(passport.expires_on)}. Muchos países piden 6 meses de vigencia al entrar: confirma el requisito de tu destino.`,
      sourceUrl: SRE_GUIDE.url, sourceLabel: SRE_GUIDE.label });
  }

  // Vigencias generales.
  for (const item of items) {
    if (item.section === "tarjeta") continue;
    const { state, days } = expiryStatus(item.expires_on, today);
    if (state === "vencido") {
      alerts.push({ id: `exp-${item.id}`, level: item.kind === "pasaporte" ? "critica" : "aviso", itemId: item.id,
        title: `${item.title} venció`, detail: `Venció el ${fmt(item.expires_on as string)}.` });
    } else if (state === "pronto" && days !== null && days <= 60) {
      alerts.push({ id: `exp-${item.id}`, level: "info", itemId: item.id,
        title: `${item.title} vence ${days === 0 ? "hoy" : `en ${days} día${days === 1 ? "" : "s"}`}`,
        detail: `Vence el ${fmt(item.expires_on as string)}.` });
    }
  }

  const seen = new Set<string>();
  return alerts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
