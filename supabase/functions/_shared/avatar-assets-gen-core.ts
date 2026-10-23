// Validación del cuerpo de avatar-assets-gen (sin Deno: se prueba en Vitest).
export const MAX_IDS_POR_LLAMADA = 3;
/** Tope por llamada por defecto (3 imágenes × 0.134 = 0.40 USD caben). */
export const MAX_USD_POR_LLAMADA = 1;
/** Tope acumulado del inventario completo (396 × 0.134 = 53.06 USD) con margen para reintentos. */
export const TOPE_TOTAL_USD = 60;

export type GenBody = { ok: true; ids: string[]; maxUsd: number; forzar: boolean } | { ok: false; error: string };

export function parseGenBody(b: unknown): GenBody {
  const o = b as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return { ok: false, error: "Cuerpo inválido" };
  const ids = Array.isArray(o.ids) ? [...new Set(o.ids.map((x) => String(x ?? "").trim()).filter(Boolean))] : [];
  if (!ids.length) return { ok: false, error: "Faltan ids" };
  if (ids.length > MAX_IDS_POR_LLAMADA) return { ok: false, error: `Máximo ${MAX_IDS_POR_LLAMADA} ids por llamada` };
  if (ids.some((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 60)) return { ok: false, error: "Id inválido" };
  const m = o.max_usd === undefined ? MAX_USD_POR_LLAMADA : Number(o.max_usd);
  if (!Number.isFinite(m) || m < 0 || m > 10) return { ok: false, error: "max_usd inválido (0 a 10)" };
  return { ok: true, ids, maxUsd: m, forzar: o.forzar === true };
}
