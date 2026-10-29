// Ferris en vivo (Edge Function ferry-search → servidor MCP público de Ferryhopper). Solo se llama tras el
// botón "Ver salidas y precio en vivo". Cada salida trae naviera, hora (del puerto, según Ferryhopper), el
// "desde" en euros para 1 pasajero (precio indicativo de Ferryhopper) y su enlace de compra; nunca
// "Reservado". El equivalente en pesos no se calcula aquí (no se inventa un tipo de cambio).
import { readFunctionError } from "@/lib/functionErrors";
import { checkAllowlisted } from "@/lib/bookingAllowlist";

export type Invoke = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: any; error: any }>;
export type FerryQuery = { from: string; to: string; date: string; passengers?: number };

export type FerryRow = { id: string; naviera: string; barco: string | null; sale: string; llega: string; llegaOtroDia: boolean;
  priceText: string | null; url: string; cabina: boolean; vehiculos: boolean };

export type FerrySummary =
  | { ok: true; rows: FerryRow[]; consultedLabel: string; routeUrl: string | null; note: string; ports: string | null; message?: undefined }
  | { ok: false; message: string; rows?: undefined };

/** Solo enlaces de Ferryhopper que pasan la lista blanca (resultados con puertos y fecha). */
const ferryUrl = (u: unknown): string | null => {
  const v = checkAllowlisted(u);
  return v.ok && v.provider?.provider === "ferryhopper" ? v.url : null;
};

export function ferryPrice(desde: any): string | null {
  const n = Number(desde?.monto);
  if (!Number.isFinite(n) || n <= 0 || desde?.moneda !== "EUR") return null;
  return `desde €${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por persona`;
}

/** "en vivo · consultado 14:05" (o "guardado · consultado …" si vino de la caché de 30 min). */
export function consultedText(at: unknown, fromCache: unknown): string {
  const t = typeof at === "string" ? new Date(at) : null;
  if (!t || Number.isNaN(t.getTime())) return "";
  const hhmm = t.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fromCache ? "guardado" : "en vivo"} · consultado ${hhmm}`;
}

export function summarizeFerries(data: any): FerrySummary {
  if (!data || data.ok !== true) {
    if (typeof data?.motivo === "string" && data.motivo) return { ok: false, message: data.motivo };
    if (typeof data?.message === "string" && data.message) return { ok: false, message: data.message };
    return { ok: false, message: "Ferryhopper no respondió; intenta más tarde o busca directo en Ferryhopper." };
  }
  const rows: FerryRow[] = [];
  for (const r of Array.isArray(data.results) ? data.results : []) {
    const url = ferryUrl(r?.url);
    if (!url || typeof r?.naviera !== "string" || !/^\d{2}:\d{2}$/.test(String(r?.sale)) || !/^\d{2}:\d{2}$/.test(String(r?.llega))) continue;
    rows.push({ id: String(r.id ?? url), naviera: r.naviera, barco: typeof r.barco === "string" ? r.barco : null, sale: r.sale, llega: r.llega,
      llegaOtroDia: !!r.llega_fecha, priceText: ferryPrice(r.desde), url, cabina: !!r.cabina, vehiculos: !!r.vehiculos });
  }
  const o = data.origen?.nombre, d = data.destino?.nombre;
  return { ok: true, rows, consultedLabel: consultedText(data.consultado_at, data.from_cache), routeUrl: ferryUrl(data.url_ruta),
    note: typeof data.nota === "string" ? data.nota : "", ports: o && d ? `${o} → ${d}` : null };
}

export async function requestFerries(invoke: Invoke, q: FerryQuery): Promise<FerrySummary> {
  try {
    const { data, error } = await invoke("ferry-search", { body: { from: q.from, to: q.to, date: q.date, passengers: q.passengers ?? 1 } });
    if (error) return { ok: false, message: (await readFunctionError(error, "No pudimos consultar Ferryhopper. Intenta de nuevo.")).message };
    return summarizeFerries(data);
  } catch (e) {
    return { ok: false, message: (await readFunctionError(e, "No pudimos consultar Ferryhopper. Intenta de nuevo.")).message };
  }
}
