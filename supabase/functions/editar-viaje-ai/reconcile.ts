// Reglas de origen para editar-viaje-ai (sin Deno, para probarlas).
//
// editar-viaje-ai "recotiza" con el modelo, sin volver a consultar a ningún proveedor. Por eso
// nada de lo que cambie puede conservar una etiqueta de fuente en vivo: antes, al pedir "la misma
// estructura", los precios nuevos heredaban fuente_precio "travelpayouts"/"serpapi" y se mostraban
// como "verificados en vivo".

const LIVE = new Set(["travelpayouts", "serpapi", "google_flights", "google_hotels", "aviasales", "serpapi-hotels"]);

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Kind = "vuelos_json" | "hospedaje_json" | "tours_json";
const PRICE_FIELD: Record<Kind, string> = {
  vuelos_json: "precio_por_persona",
  hospedaje_json: "precio_por_noche",
  tours_json: "precio_por_persona",
};
const keyOf = (kind: Kind, x: any) =>
  kind === "vuelos_json" ? `${norm(x?.tier)}|${norm(x?.aerolinea ?? x?.provider)}|${norm(x?.ciudad ?? x?.to)}` : `${norm(x?.nombre)}|${norm(x?.ciudad)}`;

const sourceField = (kind: Kind) => (kind === "tours_json" ? "fuente" : "fuente_precio");

/** Fechas y viajeros válidos; si el modelo devolvió algo inválido se conservan los anteriores. */
export function sanitizeTripMeta(before: any, after: any) {
  const out: Record<string, unknown> = {};
  const fs = typeof after?.fecha_salida === "string" && ISO.test(after.fecha_salida) ? after.fecha_salida : before?.fecha_salida ?? null;
  const fr = typeof after?.fecha_regreso === "string" && ISO.test(after.fecha_regreso) ? after.fecha_regreso : before?.fecha_regreso ?? null;
  if (fs && fr && fr < fs) {
    out.fecha_salida = before?.fecha_salida ?? null;
    out.fecha_regreso = before?.fecha_regreso ?? null;
  } else {
    out.fecha_salida = fs;
    out.fecha_regreso = fr;
  }
  const n = Number(after?.num_viajeros);
  out.num_viajeros = Number.isInteger(n) && n >= 1 && n <= 20 ? n : before?.num_viajeros ?? 1;
  return out as { fecha_salida: string | null; fecha_regreso: string | null; num_viajeros: number };
}

/**
 * Marca el origen de cada opción después de la edición:
 * - Sin cambios (mismo elemento, mismo precio, mismas fechas y viajeros): conserva el origen que
 *   tenía ANTES (el modelo no puede subirlo a "en vivo").
 * - Con cambios (precio distinto, elemento nuevo, o se movieron fechas/viajeros): fuente
 *   "estimado"; si antes venía de una fuente en vivo queda PENDIENTE_DE_VERIFICACION, si no ESTIMADO.
 */
export function reconcileEdit(before: any, after: any): any {
  const meta = sanitizeTripMeta(before, after);
  const basisChanged =
    meta.fecha_salida !== (before?.fecha_salida ?? null) ||
    meta.fecha_regreso !== (before?.fecha_regreso ?? null) ||
    meta.num_viajeros !== (before?.num_viajeros ?? null);

  const out = { ...after, ...meta };
  for (const kind of ["vuelos_json", "hospedaje_json", "tours_json"] as Kind[]) {
    if (!Array.isArray(after?.[kind])) continue;
    const prev: any[] = Array.isArray(before?.[kind]) ? before[kind] : [];
    const price = PRICE_FIELD[kind];
    const sf = sourceField(kind);
    out[kind] = after[kind].map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const match = prev.find((p) => keyOf(kind, p) === keyOf(kind, item));
      const samePrice = match && Math.round(Number(match[price]) || 0) === Math.round(Number(item[price]) || 0);
      const next = { ...item };
      if (match && samePrice && !basisChanged) {
        // Mismo dato que antes: mismo origen que antes.
        next[sf] = match[sf] ?? "estimado";
        if (match.estado_dato) next.estado_dato = match.estado_dato; else delete next.estado_dato;
        if (match.consultado_at) next.consultado_at = match.consultado_at; else delete next.consultado_at;
        if (match.approximate_dates) next.approximate_dates = match.approximate_dates;
        return next;
      }
      const wasLive = LIVE.has(String(match?.[sf] ?? item[sf] ?? "").toLowerCase());
      // Tours: el lugar puede seguir siendo real (tripadvisor/google_maps); el precio es estimado.
      if (kind === "tours_json" && match && ["tripadvisor", "google_maps"].includes(String(match.fuente))) {
        next.fuente = norm(match.nombre) === norm(item.nombre) ? match.fuente : "estimado";
      } else {
        next[sf] = "estimado";
      }
      next.estado_dato = wasLive ? "PENDIENTE_DE_VERIFICACION" : "ESTIMADO";
      delete next.consultado_at;
      return next;
    });
  }
  return out;
}

/** Noches entre dos fechas YYYY-MM-DD (0 si faltan). */
export function nightsBetween(a?: string | null, b?: string | null): number {
  if (!a || !b || !ISO.test(a) || !ISO.test(b)) return 0;
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
}
