// «¿Cuándo es más barato ir a X?» (pedido del dueño, 10-nov-2026: «mejores fechas para viajar al lugar por precios»).
// Datos REALES, nunca de memoria: el calendario de tarifas de Aviasales (Travelpayouts `aviasales/v3/grouped_prices`,
// el mismo endpoint de tpReference.ts):
//   1. group_by=month (sin fechas): la tarifa más barata de la ruta por mes → qué meses salen más baratos.
//   2. group_by=departure_at con un mes (AAAA-MM): la tarifa más barata por día de salida → qué días de ese mes.
// Son tarifas que otros viajeros encontraron en búsquedas recientes (caché de hasta 7 días): referencia, NO precio
// en vivo; cada cifra va con su fuente, su fecha de salida y si es ida o ida y vuelta. Sin token o sin datos de la
// ruta, se dice que no hay datos (nunca se inventa un mes «barato»). Sin Deno: se prueba con Vitest.
import { fareProblems } from "./fareGuard.ts";
import { groupedPricesUrl } from "./tpReference.ts";

export type TarifaDia = {
  /** AAAA-MM-DD de salida. */
  salida: string;
  regreso: string | null;
  ida_y_vuelta: boolean;
  /** MXN por persona, redondeado. */
  precio_mxn_pp: number;
  aerolinea: string | null;
  escalas: number | null;
};

export type TarifaMes = { mes: string; etiqueta: string; precio_mxn_pp: number; salida: string | null; ida_y_vuelta: boolean };

export type MejoresFechas = {
  ok: boolean;
  origen: string;
  destino: string;
  /** Meses de la ruta de más barato a más caro (hasta 12). */
  meses: TarifaMes[];
  /** Días más baratos del mes pedido (hasta 6), de más barato a más caro. */
  dias: TarifaDia[];
  mes_pedido: string | null;
  fuente: string;
  nota: string;
  consultado_at: string;
  /** Para comparar en vivo y comprar. */
  google_flights: string;
  motivo?: "sin_token" | "sin_datos" | "sin_ruta";
};

const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const mesLabel = (ym: string) => `${MES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

type Ticket = Record<string, unknown> & { price?: unknown; departure_at?: unknown; return_at?: unknown; airline?: unknown; transfers?: unknown; link?: unknown };

/** Filas válidas de una respuesta de grouped_prices: precio > 0 y de la ruta pedida (fareGuard). */
function filas(data: unknown, want: { origin: string; destination: string }): Array<[string, Ticket]> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, Ticket>)
    .filter(([, t]) => t && typeof t === "object" && Number(t.price) > 0)
    .filter(([, t]) => fareProblems({ ...(t as Record<string, unknown>), booking_link: (t.link as string) ?? null } as never,
      { origin: want.origin, destination: want.destination }).length === 0);
}

/** Meses de más barato a más caro, solo de hoy en adelante. */
export function mesesBaratos(data: unknown, want: { origin: string; destination: string }, usdMxn: number, hoyISO: string): TarifaMes[] {
  const hoyMes = hoyISO.slice(0, 7);
  return filas(data, want)
    .map(([key, t]) => {
      const salida = isoDay(t.departure_at);
      const mes = (salida ?? key).slice(0, 7);
      return { mes, etiqueta: mesLabel(mes), precio_mxn_pp: Math.round(Number(t.price) * usdMxn), salida, ida_y_vuelta: !!isoDay(t.return_at) };
    })
    .filter((m) => /^\d{4}-\d{2}$/.test(m.mes) && m.mes >= hoyMes && (!m.salida || m.salida >= hoyISO))
    .sort((a, b) => a.precio_mxn_pp - b.precio_mxn_pp)
    .slice(0, 12);
}

/** Días de salida más baratos de un mes. */
export function diasBaratos(data: unknown, want: { origin: string; destination: string }, usdMxn: number, hoyISO: string, n = 6): TarifaDia[] {
  return filas(data, want)
    .map(([key, t]) => ({
      salida: isoDay(t.departure_at) ?? (isoDay(key) ?? ""),
      regreso: isoDay(t.return_at),
      ida_y_vuelta: !!isoDay(t.return_at),
      precio_mxn_pp: Math.round(Number(t.price) * usdMxn),
      aerolinea: typeof t.airline === "string" && t.airline ? t.airline : null,
      escalas: Number.isInteger(Number(t.transfers)) ? Number(t.transfers) : null,
    }))
    .filter((d) => d.salida && d.salida >= hoyISO)
    .sort((a, b) => a.precio_mxn_pp - b.precio_mxn_pp || a.salida.localeCompare(b.salida))
    .slice(0, n);
}

export function googleFlightsExplore(originCode: string, destCode: string): string {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Vuelos de ${originCode} a ${destCode}`)}&hl=es-419&curr=MXN`;
}

const NOTA = "Tarifas que otros viajeros encontraron en Aviasales en los últimos días (por persona, en pesos al tipo de cambio de hoy). " +
  "Son una referencia para elegir fechas, NO precios en vivo: confirma en Google Flights o Aviasales antes de comprar.";

/**
 * Meses y días más baratos para volar de `origen` a `destino` (códigos IATA o de ciudad de Travelpayouts).
 * Nunca lanza: sin token o sin datos devuelve ok=false con el motivo.
 */
export async function mejoresFechas(
  q: { origen: string; destino: string; mes?: string | null },
  deps: { token: string; usdMxn: number; hoyISO: string; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date },
): Promise<MejoresFechas> {
  const origin = String(q.origen ?? "").toUpperCase();
  const destination = String(q.destino ?? "").toUpperCase();
  const mes = typeof q.mes === "string" && /^\d{4}-\d{2}$/.test(q.mes) ? q.mes : null;
  const base: MejoresFechas = {
    ok: false, origen: origin, destino: destination, meses: [], dias: [], mes_pedido: mes,
    fuente: "Aviasales (Travelpayouts), búsquedas recientes de otros viajeros", nota: NOTA,
    consultado_at: (deps.now ? deps.now() : new Date()).toISOString(), google_flights: googleFlightsExplore(origin, destination),
  };
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) return { ...base, motivo: "sin_ruta" };
  if (!deps.token) return { ...base, motivo: "sin_token" };
  const doFetch = deps.fetchImpl ?? fetch;
  const get = async (url: string): Promise<unknown> => {
    try {
      const r = await doFetch(url, { headers: { "X-Access-Token": deps.token, Accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 8000) });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.success === true ? j.data : null;
    } catch {
      return null;
    }
  };
  const want = { origin, destination };
  const [porMes, porDia] = await Promise.all([
    get(groupedPricesUrl({ origin, destination, groupBy: "month", token: deps.token })),
    mes ? get(groupedPricesUrl({ origin, destination, groupBy: "departure_at", departureAt: mes, token: deps.token })) : Promise.resolve(null),
  ]);
  const meses = mesesBaratos(porMes, want, deps.usdMxn, deps.hoyISO);
  const dias = mes ? diasBaratos(porDia, want, deps.usdMxn, deps.hoyISO) : [];
  if (!meses.length && !dias.length) return { ...base, motivo: "sin_datos" };
  return { ...base, ok: true, meses, dias };
}
