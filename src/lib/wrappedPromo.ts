// Aviso de IATOS Wrapped en el inicio y el perfil (sin dependencias pesadas: va en el chunk del
// dashboard). En diciembre y enero es destacado ("Tu año en viajes 2026 ya está listo"; en enero se
// refiere al año que acaba de terminar). El resto del año, un acceso discreto al año en curso.
// Solo aparece si ese año tiene al menos un viaje que ya empezó.

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** Día absoluto (días desde 1970-01-01) de "YYYY-MM-DD…", o null. Sin new Date("YYYY-MM-DD"). */
export function dayNumber(s: string | null | undefined): number | null {
  const m = ISO.exec(String(s ?? ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
}

export const yearOf = (s: string | null | undefined): number | null => {
  const m = ISO.exec(String(s ?? ""));
  return m ? Number(m[1]) : null;
};

type DatedTrip = { fecha_salida?: string | null };

/** Años (descendente) con al menos un viaje que ya empezó. */
export function yearsWithTrips(trips: DatedTrip[], today: string): number[] {
  const t0 = dayNumber(today);
  const set = new Set<number>();
  for (const t of trips) {
    const s = dayNumber(t.fecha_salida);
    const y = yearOf(t.fecha_salida);
    if (s != null && y != null && t0 != null && s <= t0) set.add(y);
  }
  return [...set].sort((a, b) => b - a);
}

/** Año que /wrapped abre por defecto: en enero, el que terminó (si tiene viajes); si no, el actual. */
export function defaultWrappedYear(today: string, years: number[]): number {
  const y = yearOf(today) ?? new Date().getFullYear();
  const month = Number(ISO.exec(today)?.[2] ?? 0);
  if (month === 1 && years.includes(y - 1)) return y - 1;
  if (years.includes(y)) return y;
  return years[0] ?? y;
}

export type WrappedPromo = { year: number; featured: boolean; title: string; subtitle: string; href: string };

/** Acceso a Wrapped según la fecha (el perfil lo muestra siempre; la página explica si no hay datos). */
export function wrappedEntry(today: string): WrappedPromo | null {
  const y = yearOf(today);
  const month = Number(ISO.exec(today)?.[2] ?? 0);
  if (!y || !month) return null;
  const featured = month === 12 || month === 1;
  const year = month === 1 ? y - 1 : y;
  return featured
    ? { year, featured, title: `Tu año en viajes ${year} ya está listo`, subtitle: "Tus viajes, países, kilómetros y mejores momentos, en tarjetas para compartir.", href: `/wrapped/${year}` }
    : { year, featured, title: `Tu ${year} en viajes, hasta hoy`, subtitle: "Tu resumen del año: viajes, lugares y momentos.", href: `/wrapped/${year}` };
}

/** Aviso del inicio: solo si ese año ya tiene al menos un viaje que empezó. */
export function wrappedPromo(today: string, trips: DatedTrip[]): WrappedPromo | null {
  const entry = wrappedEntry(today);
  if (!entry || !yearsWithTrips(trips, today).includes(entry.year)) return null;
  return entry;
}
