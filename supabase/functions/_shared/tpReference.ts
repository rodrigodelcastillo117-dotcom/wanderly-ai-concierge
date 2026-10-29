// Tarifa de referencia de Travelpayouts/Aviasales para rutas lejanas o fechas lejanas (sin Deno: se
// prueba con Vitest y respuestas grabadas).
//
// Caso Álvaro (28-oct-2026): con las búsquedas en vivo en pausa, Beijing (nov-2026) e India (sep-2027)
// dieron 0 tarifas: prices_for_dates solo trae lo que alguien buscó para esas fechas exactas o ese mes.
// Aquí se intenta, en este orden, con el endpoint documentado `aviasales/v3/grouped_prices`
// (https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API, consultado el
// 29-oct-2026; reemplaza a /v1/prices/calendar y /v1/prices/monthly):
//   1. group_by=departure_at con el mes del viaje (YYYY-MM): la tarifa por día del mes; se toma el día
//      más cercano a la salida.
//   2. group_by=month sin fechas: la tarifa más barata por mes de la ruta; se toma el mes del viaje o,
//      si no hay, el más cercano (dicho así).
// Son tarifas que encontraron otros viajeros en búsquedas recientes (la documentación dice "en las
// últimas 48 horas" y que la caché guarda hasta 7 días): NUNCA un precio en vivo. Cada una va con su
// fecha de salida, su fuente y "estimado" (ESTIMADO).
//
// NO VERIFICADO EN VIVO: no hubo token de Travelpayouts en este entorno. El formato de la respuesta sale
// del ejemplo de la documentación oficial (data = { "AAAA-MM-DD" | "AAAA-MM": ticket }).
import { fareProblems } from "./fareGuard.ts";

export const TP_GROUPED_PRICES = "https://api.travelpayouts.com/aviasales/v3/grouped_prices";

export type ReferenceFare = {
  /** USD por persona según Aviasales. */
  precio_usd_pp: number;
  /** Fecha de salida de esa tarifa (AAAA-MM-DD). */
  salida: string | null;
  regreso: string | null;
  ida_y_vuelta: boolean;
  /** Mes de la tarifa (AAAA-MM). */
  mes: string;
  /** true si la tarifa es del mismo mes del viaje. */
  mismo_mes: boolean;
  aerolinea: string | null;
  escalas: number | null;
  /** Búsqueda en Aviasales de esa tarifa, con el marker de afiliado. */
  link: string | null;
  origen: string;
  destino: string;
  fuente: "travelpayouts";
  estado_dato: "ESTIMADO";
  etiqueta: string;
  consultado_at: string;
};

type Ticket = Record<string, unknown> & { price?: unknown; departure_at?: unknown; return_at?: unknown };

export function groupedPricesUrl(q: {
  origin: string; destination: string; groupBy: "departure_at" | "month"; departureAt?: string | null; returnAt?: string | null;
  currency?: string; token: string;
}): string {
  const p = new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    group_by: q.groupBy,
    currency: (q.currency ?? "usd").toLowerCase(),
    direct: "false",
    token: q.token,
  });
  if (q.departureAt) p.set("departure_at", q.departureAt);
  if (q.returnAt) p.set("return_at", q.returnAt);
  return `${TP_GROUPED_PRICES}?${p.toString()}`;
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** Etiqueta honesta de una tarifa de referencia. */
export function referenceLabel(r: Pick<ReferenceFare, "ida_y_vuelta" | "salida" | "mismo_mes" | "mes">, wantMonth: string): string {
  const when = r.salida ? `salida ${dayLabel(r.salida)}` : `mes ${r.mes}`;
  const other = r.mismo_mes ? "" : ` (no hay tarifa para ${MES[Number(wantMonth.slice(5, 7)) - 1]} ${wantMonth.slice(0, 4)}: es de otro mes)`;
  return `Tarifa de referencia de búsquedas recientes en Aviasales: ${r.ida_y_vuelta ? "ida y vuelta" : "solo ida"}, ${when}${other}. No es precio en vivo; puede variar.`;
}

/**
 * Elige la tarifa de una respuesta de grouped_prices: la de la fecha (o mes) más cercana a lo pedido,
 * descartando las de otra ruta (fareGuard). null si no hay ninguna que sirva.
 */
export function pickReference(
  data: unknown,
  want: { depart: string; origin: string; destination: string; originCity?: string | null; destinationCity?: string | null },
): { key: string; t: Ticket } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const target = Date.parse(`${want.depart.slice(0, 10)}T12:00:00Z`);
  const wantMonth = want.depart.slice(0, 7);
  const rows = Object.entries(data as Record<string, Ticket>)
    .filter(([, t]) => t && typeof t === "object" && Number(t.price) > 0)
    .filter(([, t]) => fareProblems({ ...(t as Record<string, unknown>), booking_link: (t.link as string) ?? null } as never,
      { origin: want.origin, destination: want.destination, originCity: want.originCity ?? null, destinationCity: want.destinationCity ?? null }).length === 0);
  if (!rows.length) return null;
  const dist = ([key, t]: [string, Ticket]) => {
    const d = isoDay(t.departure_at) ?? (/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null);
    if (d) return Math.abs(Date.parse(`${d}T12:00:00Z`) - target);
    const ym = /^\d{4}-\d{2}/.test(key) ? key.slice(0, 7) : null;
    return ym ? Math.abs(monthIndex(ym) - monthIndex(wantMonth)) * 30 * 86400_000 : Number.POSITIVE_INFINITY;
  };
  rows.sort((a, b) => dist(a) - dist(b) || Number(a[1].price) - Number(b[1].price));
  const [key, t] = rows[0];
  return { key, t };
}

export type ReferenceQuery = {
  origin: string;
  destination: string;
  depart: string;
  ret?: string | null;
  originCity?: string | null;
  destinationCity?: string | null;
};

/**
 * Tarifa de referencia (o null). Nunca lanza: un error de la API es "sin referencia".
 * Usa el token en el encabezado X-Access-Token (y en la URL, como el resto de las llamadas de IATOS).
 */
export async function travelpayoutsReference(
  q: ReferenceQuery, token: string, marker: string,
  opts: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<ReferenceFare | null> {
  if (!token || !/^\d{4}-\d{2}-\d{2}$/.test(q.depart ?? "")) return null;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const wantMonth = q.depart.slice(0, 7);
  const get = async (url: string): Promise<unknown> => {
    try {
      const r = await doFetch(url, { headers: { "X-Access-Token": token, Accept: "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.success === true ? j.data : null;
    } catch {
      return null;
    }
  };
  const attempts = [
    groupedPricesUrl({ origin: q.origin, destination: q.destination, groupBy: "departure_at", departureAt: wantMonth, returnAt: q.ret ? q.ret.slice(0, 7) : null, token }),
    groupedPricesUrl({ origin: q.origin, destination: q.destination, groupBy: "month", token }),
  ];
  for (const url of attempts) {
    const picked = pickReference(await get(url), q);
    if (!picked) continue;
    const { key, t } = picked;
    const salida = isoDay(t.departure_at) ?? (/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null);
    const mes = (salida ?? key).slice(0, 7);
    const regreso = isoDay(t.return_at);
    const link = typeof t.link === "string" && t.link.startsWith("/")
      ? `https://www.aviasales.com${t.link}${t.link.includes("?") ? "&" : "?"}marker=${marker}` : null;
    const base = {
      precio_usd_pp: Math.round(Number(t.price)),
      salida, regreso, ida_y_vuelta: !!regreso, mes, mismo_mes: mes === wantMonth,
      aerolinea: typeof t.airline === "string" && t.airline ? t.airline : null,
      escalas: Number.isFinite(Number(t.transfers)) ? Number(t.transfers) : null,
      link, origen: q.origin, destino: q.destination,
      fuente: "travelpayouts" as const, estado_dato: "ESTIMADO" as const,
      consultado_at: new Date(now()).toISOString(),
    };
    return { ...base, etiqueta: referenceLabel(base, wantMonth) };
  }
  return null;
}
