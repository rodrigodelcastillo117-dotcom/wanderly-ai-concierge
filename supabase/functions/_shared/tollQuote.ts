// Casetas: tipos y texto para el usuario (sin red ni Deno). Lo usan google-tolls.ts, get-routes,
// el plan de road trip (_shared/roadtrip/plan.ts) y la pantalla. Ver google-tolls.ts para las reglas.

export type TollAmount = { moneda: string; monto: number };

export type TollEstado = "CON_MONTO" | "SIN_MONTO" | "NO_DISPONIBLE";

export type TollFx = { moneda: string; tasa: number; fuente: string; fecha: string };

export type TollQuote = {
  estado: TollEstado;
  /** Montos tal como los publica Google (moneda original). */
  montos: TollAmount[];
  /** Suma en MXN: solo si TODOS los montos se pudieron convertir con una tasa verificable. */
  monto_mxn: number | null;
  /** Tasas usadas (fuente y fecha), para mostrarlas junto al monto. */
  fx: TollFx[];
  fuente: "google_routes";
  consultado_at: string;
  pase: string | null;
  /** Salió de la caché de 24 h (la fecha de consulta es la original). */
  from_cache: boolean;
};

const fmtMoney = (n: number, d = 0) => n.toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });

/** HH:MM de la consulta (hora local de quien mira; en el servidor, la de Ciudad de México). */
export function tollTime(iso: string | null | undefined, timeZone?: string): string | null {
  const d = iso ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime())) return null;
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) });
}

/** Lo que ve el usuario. Nunca dice "sin casetas". */
export function tollLine(q: TollQuote | null | undefined, timeZone?: string): string {
  if (!q || q.estado === "NO_DISPONIBLE") return "Información de casetas no disponible para esta ruta";
  if (q.estado === "SIN_MONTO") return "Hay casetas en la ruta; Google no publica el monto";
  const hhmm = tollTime(q.consultado_at, timeZone);
  const tail = ` · Google Maps${hhmm ? ` · consultado ${hhmm}` : ""}`;
  if (q.monto_mxn !== null) {
    const conv = q.fx.length
      ? ` (${q.montos.filter((m) => m.moneda !== "MXN").map((m) => `${fmtMoney(m.monto, 2)} ${m.moneda}`).join(" + ")}; tipo de cambio ${q.fx.map((f) => `${fmtMoney(f.tasa, 2)} MXN/${f.moneda}, BCE ${f.fecha.slice(0, 10)}`).join("; ")})`
      : "";
    return `Casetas: $${fmtMoney(q.monto_mxn)} MXN${conv}${tail}`;
  }
  return `Casetas: ${q.montos.map((m) => `${fmtMoney(m.monto, 2)} ${m.moneda}`).join(" + ")}${tail}`;
}
