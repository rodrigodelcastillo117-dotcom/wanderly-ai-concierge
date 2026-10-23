// Frescura de un precio, determinista y sin Deno (la usan el frontend, flights-search/hotels-search y
// Iato). Una sola regla para decir "en vivo":
//   en_vivo  → consultado con el proveedor hace ≤ EN_VIVO_MAX_MINUTES (consulta nueva, no de caché vieja).
//   cache    → guardado y aún vigente: se muestra su antigüedad ("consultado hace 3 h"), nunca "en vivo".
//   obsoleto → pasó la vigencia (o no sabemos cuándo se consultó): hay que actualizarlo antes de comprar.
//   estimado → no salió de una consulta al proveedor (IA, referencia, web).
// Antes una respuesta de la caché compartida de hace 5 h se pintaba "consultado en vivo · 09:12".

export type FrescuraPrecio = "en_vivo" | "cache" | "obsoleto" | "estimado";

/** Hasta aquí una consulta se presenta como "en vivo". */
export const EN_VIVO_MAX_MINUTES = 15;
/** Vigencia por defecto de un precio consultado (igual que LIVE_TTL_HOURS de src/lib/provenance.ts). */
export const VIGENCIA_DEFAULT_HOURS = 24;

/** "hace 3 h", "hace 2 días"… */
export function formatAge(from: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const min = Math.floor(ms / 60000);
  if (min < 60) return min <= 1 ? "hace un momento" : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `hace ${d} días`;
  return `hace ${Math.floor(d / 30)} meses`;
}

export type FrescuraInput = {
  /** estado_dato del servidor (OBSOLETO / ESTIMADO mandan sobre la edad). */
  estado?: string | null;
  consultadoAt?: string | Date | null;
  /** Vigencia del precio en horas (TTL de la caché o de la oferta). */
  vigenciaHoras?: number | null;
  /** El precio no salió de una consulta al proveedor. */
  estimado?: boolean | null;
};

export type Frescura = { frescura: FrescuraPrecio; etiqueta: string; edad: string | null; edad_min: number | null };

export function frescuraPrecio(i: FrescuraInput, now: Date | number = Date.now()): Frescura {
  const n = typeof now === "number" ? now : now.getTime();
  const estado = String(i.estado ?? "").trim().toUpperCase();
  if (i.estimado || estado === "ESTIMADO") return { frescura: "estimado", etiqueta: "Estimado", edad: null, edad_min: null };
  const at = i.consultadoAt instanceof Date ? i.consultadoAt : i.consultadoAt ? new Date(i.consultadoAt) : null;
  const t = at?.getTime();
  if (!at || !Number.isFinite(t)) {
    return { frescura: "obsoleto", etiqueta: "Sin fecha de consulta · actualízalo antes de comprar", edad: null, edad_min: null };
  }
  const edad = formatAge(at, new Date(n));
  const edadMin = Math.max(0, Math.floor((n - t!) / 60000));
  const vigH = Number(i.vigenciaHoras) > 0 ? Number(i.vigenciaHoras) : VIGENCIA_DEFAULT_HOURS;
  // Fecha en el futuro (reloj adelantado más de 5 min) o vencido: no se puede afirmar que está vigente.
  if (estado === "OBSOLETO" || t! > n + 5 * 60_000 || n - t! > vigH * 3600_000) {
    return { frescura: "obsoleto", etiqueta: `Precio de ${edad} · actualízalo antes de comprar`, edad, edad_min: edadMin };
  }
  if (edadMin <= EN_VIVO_MAX_MINUTES) return { frescura: "en_vivo", etiqueta: "Consultado en vivo", edad, edad_min: edadMin };
  return { frescura: "cache", etiqueta: `Consultado ${edad}`, edad, edad_min: edadMin };
}
