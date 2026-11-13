// «10 días en diciembre» (pedido del dueño, 12-nov-2026: «si dice 10 días, buscas los mejores precios del mes, y que
// el viaje dure los 10 días»). Busca en el mes pedido las salidas más baratas para un viaje de N noches con tarifas
// REALES del calendario de Aviasales (Travelpayouts `prices_for_dates`, las mismas de travelpayouts.ts):
//   1. viaje redondo con salida en ese mes cuya duración es exactamente N noches;
//   2. si no hay, ida (origen → destino) el día D + regreso (destino → origen) el día D+N, ambos de un solo sentido.
// Son tarifas que otros viajeros encontraron hace pocos días: REFERENCIA para elegir fechas, no precio en vivo (la
// cotización después busca el precio real). Sin datos → ventanas vacías: nunca se inventa una fecha «barata».
// No gasta SerpApi. Sin Deno: se prueba con Vitest.
import { fareProblems } from "./fareGuard.ts";

export type VentanaBarata = {
  salida: string;
  regreso: string;
  noches: number;
  /** MXN por persona, ida y vuelta, redondeado. */
  precio_mxn_pp: number;
  /** "redondo": una tarifa de ida y vuelta con esa duración; "dos_sencillos": ida + regreso por separado. */
  tipo: "redondo" | "dos_sencillos";
  aerolinea: string | null;
};

export type FechasBaratas = {
  ok: boolean;
  origen: string;
  destino: string;
  mes: string;
  noches: number;
  ventanas: VentanaBarata[];
  fuente: string;
  nota: string;
  consultado_at: string;
  motivo?: "sin_token" | "sin_datos" | "sin_ruta" | "mes_pasado";
};

type Row = Record<string, unknown> & { price?: unknown; departure_at?: unknown; return_at?: unknown; airline?: unknown };

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const nextMonth = (ym: string) => {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Filas válidas: precio > 0 y de la ruta pedida (fareGuard, como el resto de tarifas). */
function valid(rows: unknown, want: { origin: string; destination: string }): Row[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Row[]).filter((t) => t && typeof t === "object" && Number(t.price) > 0 && isoDay(t.departure_at))
    .filter((t) => fareProblems({ ...t, booking_link: (t.link as string) ?? null } as never, want).length === 0);
}

/** Tarifa más barata por día de salida. */
function cheapestByDay(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const d = isoDay(r.departure_at)!;
    const cur = m.get(d);
    if (!cur || Number(r.price) < Number(cur.price)) m.set(d, r);
  }
  return m;
}

/**
 * Las salidas más baratas de `mes` para un viaje de `noches` noches (hasta `n`, de más barata a más cara; sin
 * repetir salida). Puro: recibe las filas ya descargadas.
 */
export function ventanasBaratas(
  data: { redondo: unknown; ida: unknown; regreso: unknown },
  q: { origen: string; destino: string; mes: string; noches: number },
  usdMxn: number, hoyISO: string, n = 3,
): VentanaBarata[] {
  const ida = { origin: q.origen, destination: q.destino };
  const vuelta = { origin: q.destino, destination: q.origen };
  const enMes = (d: string) => d.slice(0, 7) === q.mes && d > hoyISO;
  const mxn = (usd: number) => Math.round(usd * usdMxn);
  const best = new Map<string, VentanaBarata>();
  const offer = (v: VentanaBarata) => {
    const cur = best.get(v.salida);
    if (!cur || v.precio_mxn_pp < cur.precio_mxn_pp) best.set(v.salida, v);
  };
  for (const r of valid(data.redondo, ida)) {
    const s = isoDay(r.departure_at)!, b = isoDay(r.return_at);
    if (!b || !enMes(s) || nightsBetween(s, b) !== q.noches) continue;
    offer({ salida: s, regreso: b, noches: q.noches, precio_mxn_pp: mxn(Number(r.price)), tipo: "redondo", aerolinea: typeof r.airline === "string" && r.airline ? r.airline : null });
  }
  const outs = cheapestByDay(valid(data.ida, ida).filter((r) => !isoDay(r.return_at)));
  const backs = cheapestByDay(valid(data.regreso, vuelta).filter((r) => !isoDay(r.return_at)));
  for (const [s, o] of outs) {
    if (!enMes(s)) continue;
    const b = addDays(s, q.noches);
    const r = backs.get(b);
    if (!r) continue;
    const al = typeof o.airline === "string" && o.airline && o.airline === r.airline ? o.airline : null;
    offer({ salida: s, regreso: b, noches: q.noches, precio_mxn_pp: mxn(Number(o.price) + Number(r.price)), tipo: "dos_sencillos", aerolinea: al });
  }
  return [...best.values()].sort((a, b) => a.precio_mxn_pp - b.precio_mxn_pp || a.salida.localeCompare(b.salida)).slice(0, n);
}

const NOTA = "Tarifas de vuelo que otros viajeros encontraron en Aviasales en los últimos días (por persona, ida y vuelta, en pesos " +
  "al tipo de cambio de hoy). Son una guía para elegir fechas: el precio real se busca al cotizar.";

/** Descarga las tarifas del mes y calcula las ventanas. Nunca lanza. */
export async function fechasBaratas(
  q: { origen: string; destino: string; mes: string; noches: number },
  deps: { token: string; usdMxn: number; hoyISO: string; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date },
): Promise<FechasBaratas> {
  const origen = String(q.origen ?? "").toUpperCase(), destino = String(q.destino ?? "").toUpperCase();
  const mes = /^\d{4}-\d{2}$/.test(String(q.mes)) ? q.mes : "";
  const noches = Math.round(Number(q.noches));
  const base: FechasBaratas = {
    ok: false, origen, destino, mes, noches, ventanas: [], fuente: "Aviasales (Travelpayouts), búsquedas recientes de otros viajeros",
    nota: NOTA, consultado_at: (deps.now ? deps.now() : new Date()).toISOString(),
  };
  if (!/^[A-Z]{3}$/.test(origen) || !/^[A-Z]{3}$/.test(destino) || origen === destino || !mes || !(noches >= 1 && noches <= 60)) return { ...base, motivo: "sin_ruta" };
  if (mes < deps.hoyISO.slice(0, 7)) return { ...base, motivo: "mes_pasado" };
  if (!deps.token || !(deps.usdMxn > 0)) return { ...base, motivo: "sin_token" };
  const doFetch = deps.fetchImpl ?? fetch;
  const get = async (o: string, d: string, dep: string, ret: string | null): Promise<unknown> => {
    const p = new URLSearchParams({ origin: o, destination: d, departure_at: dep, currency: "usd", sorting: "price", direct: "false", limit: "1000", one_way: ret ? "false" : "true", token: deps.token });
    if (ret) p.set("return_at", ret);
    try {
      const r = await doFetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${p}`, {
        headers: { "X-Access-Token": deps.token, Accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
      });
      if (!r.ok) return [];
      const j = await r.json();
      return j?.success && Array.isArray(j.data) ? j.data : [];
    } catch {
      return [];
    }
  };
  // El regreso puede caer en el mes siguiente («10 días» saliendo el 28).
  const sig = nextMonth(mes);
  const [redondoA, redondoB, ida, regresoA, regresoB] = await Promise.all([
    get(origen, destino, mes, mes), get(origen, destino, mes, sig), get(origen, destino, mes, null), get(destino, origen, mes, null), get(destino, origen, sig, null),
  ]);
  const cat = (a: unknown, b: unknown) => [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const ventanas = ventanasBaratas({ redondo: cat(redondoA, redondoB), ida, regreso: cat(regresoA, regresoB) }, { origen, destino, mes, noches }, deps.usdMxn, deps.hoyISO);
  return ventanas.length ? { ...base, ok: true, ventanas } : { ...base, motivo: "sin_datos" };
}
