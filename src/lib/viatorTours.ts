// Tours reales de Viator bajo demanda (Edge Function viator-search, Partner API v2 de afiliado). Solo se
// llama tras el botón explícito "Ver tours reales en Viator". La llave vive en el servidor; aquí solo
// llegan título, foto, calificación, duración, precio "desde" con su moneda y el productUrl con el
// afiliado de IATOS. "Ver en Viator" abre la ficha en viator.com: no es una reserva.
// Términos de Viator: estas pantallas son internas y con sesión; el contenido no se indexa.
import { readFunctionError } from "@/lib/functionErrors";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist.ts";
import { FREE_TOUR_NOTE } from "../../supabase/functions/_shared/viator.ts";

export type Invoke = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: any; error: any }>;

export type ViatorQuery = { city: string; query?: string | null; dateFrom?: string | null; dateTo?: string | null; currency?: string };

export type ViatorTourView = {
  code: string;
  title: string;
  photo: string | null;
  rating: number | null;
  reviews: number | null;
  duration: string | null;
  /** "desde $1,234 MXN" (moneda de Viator), o null si Viator no publicó precio. */
  priceText: string | null;
  /** "≈ $1,234 MXN · tipo de cambio Banco Central Europeo (frankfurter.app) 2026-10-22" si el precio no venía en MXN. */
  mxnNote: string | null;
  url: string;
};

export type ViatorSummary =
  | { ok: true; tours: ViatorTourView[]; time: string | null; consultedAt: string | null; message?: undefined }
  | { ok: false; message: string; tours?: undefined };

export const VIATOR_NO_DISPONIBLE = "Los tours de Viator aún no están disponibles en IATOS. Puedes buscar directo en Viator.";

const hhmm = (at: string | null) => {
  const t = at ? new Date(at) : null;
  return t && Number.isFinite(t.getTime()) ? t.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
};

export function formatFromPrice(monto: unknown, moneda: unknown): string | null {
  const n = Number(monto);
  const cur = typeof moneda === "string" && /^[A-Z]{3}$/.test(moneda) ? moneda : null;
  if (!Number.isFinite(n) || n <= 0 || !cur) return null;
  const digits = n >= 100 || Number.isInteger(n) ? 0 : 2;
  return `desde $${n.toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${cur}`;
}

/** Solo fichas de producto de viator.com que dio el servidor (lista blanca: viator.com/tours/… es de servidor). */
function viatorProductUrl(u: unknown): string | null {
  const v = checkAllowlisted(u);
  return v.ok && v.provider?.provider === "viator" && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tours\//.test(new URL(v.url).pathname) ? v.url : null;
}

export function summarizeViator(data: any): ViatorSummary {
  if (!data || data.ok !== true) {
    if (data?.code === "viator_no_disponible") return { ok: false, message: VIATOR_NO_DISPONIBLE };
    if (typeof data?.motivo === "string" && data.motivo) return { ok: false, message: data.motivo };
    if (typeof data?.message === "string" && data.message) return { ok: false, message: data.message };
    return { ok: false, message: "Viator no respondió; intenta más tarde o busca directo en Viator." };
  }
  const tours: ViatorTourView[] = [];
  for (const t of Array.isArray(data.results) ? data.results : []) {
    const url = viatorProductUrl(t?.url);
    if (!url || typeof t?.title !== "string" || !t.title.trim()) continue;
    const mx = t?.desde_mxn;
    tours.push({
      code: String(t.codigo ?? url),
      title: t.title.trim(),
      photo: typeof t.foto === "string" && /^https:\/\//.test(t.foto) ? t.foto : null,
      rating: Number(t.rating) > 0 ? Number(t.rating) : null,
      reviews: Number(t.resenas) > 0 ? Number(t.resenas) : null,
      duration: typeof t.duracion === "string" ? t.duracion : null,
      priceText: formatFromPrice(t?.desde?.monto, t?.desde?.moneda),
      mxnNote: t?.free_tour === true ? FREE_TOUR_NOTE
        : t?.desde?.moneda !== "MXN" && Number(mx?.monto) > 0
          ? `≈ $${Math.round(Number(mx.monto)).toLocaleString("es-MX")} MXN · tipo de cambio ${String(mx.fx_fuente ?? "")} ${String(mx.fx_fecha ?? "")}`.trim()
          : null,
      url,
    });
  }
  if (!tours.length) return { ok: false, message: "Viator no publicó tours para esta búsqueda." };
  const at = typeof data.consultado_at === "string" ? data.consultado_at : null;
  return { ok: true, tours, consultedAt: at, time: hhmm(at) };
}

/** Card "tour" de Iato (armada por el servidor con search_tours) → la misma tarjeta de Comprar. */
export function tourViewFromCard(card: { title?: string; image_url?: string; rating?: number; meta?: string; subtitle?: string; price?: number; currency?: string; price_note?: string; cta_action?: string }): ViatorTourView | null {
  const url = viatorProductUrl(card?.cta_action);
  if (!url || !card?.title) return null;
  const reviews = Number(String(card.meta ?? "").replace(/[^\d]/g, ""));
  return {
    code: url, title: card.title, photo: typeof card.image_url === "string" && /^https:\/\//.test(card.image_url) ? card.image_url : null,
    rating: Number(card.rating) > 0 ? Number(card.rating) : null, reviews: reviews > 0 ? reviews : null, duration: card.subtitle ?? null,
    priceText: formatFromPrice(card.price, card.currency), mxnNote: card.price_note ?? null, url,
  };
}

export async function requestViatorTours(invoke: Invoke, q: ViatorQuery): Promise<ViatorSummary> {
  const body: Record<string, unknown> = { city: q.city, currency: q.currency ?? "MXN" };
  if (q.query) body.query = q.query;
  if (q.dateFrom) body.date_from = q.dateFrom;
  if (q.dateTo) body.date_to = q.dateTo;
  try {
    const { data, error } = await invoke("viator-search", { body });
    if (error) return { ok: false, message: (await readFunctionError(error, "No pudimos consultar Viator. Intenta de nuevo.")).message };
    return summarizeViator(data);
  } catch (e) {
    return { ok: false, message: (await readFunctionError(e, "No pudimos consultar Viator. Intenta de nuevo.")).message };
  }
}
