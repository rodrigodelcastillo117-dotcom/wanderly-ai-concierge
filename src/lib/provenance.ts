/**
 * Origen del dato (procedencia) de un precio que ve el usuario.
 *
 * Una sola regla para todas las pantallas: un precio solo se presenta como "consultado en vivo"
 * si vino de un proveedor en vivo Y se consultó hace menos de 24 h. Antes, la insignia decía
 * "Precio verificado en vivo · Aviasales" para tarifas de la caché de Travelpayouts (búsquedas
 * de hasta 48 h) y para precios guardados hace semanas, y no decía nada si faltaba la fuente.
 */

import { formatAge, frescuraPrecio, type FrescuraPrecio } from "../../supabase/functions/_shared/priceFreshness.ts";

export type { FrescuraPrecio };

export type EstadoDato =
  | "CONFIRMADO"
  | "CONSULTADO_EN_VIVO"
  | "ESTIMADO"
  | "PENDIENTE_DE_VERIFICACION"
  | "NO_DISPONIBLE"
  | "OBSOLETO";

export const ESTADOS_DATO: EstadoDato[] = [
  "CONFIRMADO",
  "CONSULTADO_EN_VIVO",
  "ESTIMADO",
  "PENDIENTE_DE_VERIFICACION",
  "NO_DISPONIBLE",
  "OBSOLETO",
];

/** Pasado este plazo un precio en vivo ya no se presenta como vigente. */
export const LIVE_TTL_HOURS = 24;

/** Proveedores que consultamos en el momento (inventario real). */
const LIVE_PROVIDERS: Record<string, string> = {
  serpapi: "Google",
  "serpapi-hotels": "Google Hotels",
  google_hotels: "Google Hotels",
  google_flights: "Google Flights",
  // Vuelo internacional del multidestino consultado por logistics-plan en Google Flights (openJaw.ts).
  en_vivo: "Google Flights",
};

/** Caché de búsquedas de Aviasales (Travelpayouts): precios reales, pero de hasta 48 h. */
const CACHED_PROVIDERS = new Set(["travelpayouts", "aviasales"]);

/** Lugares reales con reseñas; el precio que los acompaña es una estimación. */
const CURATED_PROVIDERS: Record<string, string> = { tripadvisor: "TripAdvisor", google_maps: "Google", google_places: "Google Maps" };

const AI_SOURCES = new Set(["estimado", "ai-fallback", "ai-estimate", "ia", "ai", "gemini", "claude"]);

export type ProvenanceInput = {
  /** fuente_precio / fuente / source tal como se guardó. */
  source?: string | null;
  /** estado_dato explícito, si el servidor ya lo asignó. */
  estado?: string | null;
  /** Cuándo se consultó el precio (ISO). Sin esto no se puede afirmar que está vigente. */
  consultadoAt?: string | Date | null;
  /** Travelpayouts sin la fecha exacta (se usó el mes): es una aproximación. */
  approximateDates?: boolean | null;
  /** El elemento vino de un PDF o imagen del usuario y nadie lo verificó. */
  desdePdf?: boolean | null;
};

export type Provenance = {
  state: EstadoDato;
  /** Texto corto para la insignia. */
  label: string;
  /** Explicación para el tooltip. */
  detail: string;
  /** Proveedor legible ("Google Flights"), si se conoce. */
  provider: string | null;
  /** Solo true para CONSULTADO_EN_VIVO o CONFIRMADO. */
  trusted: boolean;
  /**
   * en_vivo (≤ 15 min) · cache (vigente, con su antigüedad) · obsoleto · estimado. null si no aplica
   * (reserva confirmada o sin precio). "en vivo" solo se dice con frescura en_vivo.
   */
  frescura?: FrescuraPrecio | null;
};

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** "hace 3 h", "hace 2 días"… (para mostrar la antigüedad de un precio). Misma regla que el servidor. */
export { formatAge };

function obsolete(provider: string | null, at: Date | null, now: Date): Provenance {
  const age = at ? formatAge(at, now) : null;
  return {
    state: "OBSOLETO",
    label: age ? `Precio de ${age}; verifica antes de reservar` : "Precio sin fecha de consulta; verifica antes de reservar",
    detail: age
      ? `Este precio se consultó${provider ? ` en ${provider}` : ""} ${age}. Las tarifas cambian: confírmalo con el proveedor antes de reservar.`
      : `No sabemos cuándo se consultó este precio${provider ? ` en ${provider}` : ""}. Confírmalo con el proveedor antes de reservar.`,
    provider,
    trusted: false,
    frescura: "obsoleto",
  };
}

/**
 * Estado y texto del origen de un precio. Pura y determinista (recibe `now`) para poder probar
 * cada caso.
 */
export function provenanceOf(input: ProvenanceInput, now: Date = new Date()): Provenance {
  const source = String(input.source ?? "").trim().toLowerCase();
  const estado = String(input.estado ?? "").trim().toUpperCase() as EstadoDato;
  const at = toDate(input.consultadoAt);
  const fresh = !!at && now.getTime() - at.getTime() <= LIVE_TTL_HOURS * 3600_000 && at.getTime() <= now.getTime() + 5 * 60_000;

  // 1) Estados explícitos que el servidor ya decidió.
  if (estado === "CONFIRMADO") {
    return { state: "CONFIRMADO", label: "Reserva confirmada", detail: "Confirmado con el proveedor.", provider: null, trusted: true };
  }
  if (estado === "NO_DISPONIBLE" || source === "none" || source === "no_disponible") {
    return {
      state: "NO_DISPONIBLE",
      label: "No disponible ahora",
      detail: "No pudimos consultar al proveedor en este momento. Intenta más tarde.",
      provider: null,
      trusted: false,
    };
  }
  if (estado === "PENDIENTE_DE_VERIFICACION" || input.desdePdf || source === "pdf") {
    return {
      state: "PENDIENTE_DE_VERIFICACION",
      label: input.desdePdf || source === "pdf" ? "Según tu archivo (sin verificar)" : "Pendiente de verificar",
      detail: "Este precio no se ha vuelto a consultar con el proveedor después del último cambio. Verifícalo antes de reservar.",
      provider: null,
      trusted: false,
    };
  }

  // 2) Sin fuente: se dice explícitamente (antes la insignia simplemente no aparecía).
  if (!source) {
    return {
      state: "ESTIMADO",
      label: "Sin fuente",
      detail: "No sabemos de dónde salió este precio. Tómalo como una aproximación.",
      provider: null,
      trusted: false,
    };
  }

  // 3) Proveedores en vivo.
  if (LIVE_PROVIDERS[source]) {
    const provider = LIVE_PROVIDERS[source];
    if (!fresh || estado === "OBSOLETO") return obsolete(provider, at, now);
    // Vigente, pero "en vivo" solo si la consulta es de hace ≤ 15 min; si salió de la caché de hace
    // horas se dice su antigüedad ("Consultado hace 3 h · Google Flights").
    const f = frescuraPrecio({ consultadoAt: at, vigenciaHoras: LIVE_TTL_HOURS }, now);
    return {
      state: "CONSULTADO_EN_VIVO",
      label: f.frescura === "en_vivo" ? `Consultado en vivo · ${provider}` : `Consultado ${formatAge(at!, now)} · ${provider}`,
      detail: `Tarifa consultada con ${provider} ${formatAge(at!, now)}. Puede cambiar al reservar.`,
      provider,
      trusted: true,
      frescura: f.frescura === "en_vivo" ? "en_vivo" : "cache",
    };
  }
  if (CACHED_PROVIDERS.has(source)) {
    const provider = "Aviasales";
    if (input.approximateDates) {
      return {
        state: "ESTIMADO",
        label: "Tarifa aproximada (fechas cercanas)",
        detail: "Aviasales no tenía tarifa para tu fecha exacta; es la más cercana del mismo mes.",
        provider,
        trusted: false,
      };
    }
    if (!fresh || estado === "OBSOLETO") return obsolete(provider, at, now);
    // Es caché de búsquedas de otros viajeros, no una consulta nuestra en vivo: se presenta como
    // precio de referencia (ESTIMADO), nunca como verificado.
    return {
      state: "ESTIMADO",
      label: "Precio de referencia de los últimos 2 días · puede cambiar",
      detail: "Tarifa que otros viajeros encontraron en Aviasales durante las últimas 48 h. No la consultamos en vivo: el precio final se confirma al reservar.",
      provider,
      trusted: false,
    };
  }

  // 4) Lugares reales con reseñas: el lugar es real, el precio no se consultó.
  if (CURATED_PROVIDERS[source]) {
    const provider = CURATED_PROVIDERS[source];
    return {
      state: "ESTIMADO",
      label: `Reseñas reales · ${provider} · precio estimado`,
      detail: `Lugar real con reseñas verificadas en ${provider}; el precio es una aproximación.`,
      provider,
      trusted: false,
    };
  }

  // 5) Estimaciones.
  if (source === "perplexity") {
    return {
      state: "ESTIMADO",
      label: "Estimado con investigación web",
      detail: "Precio tomado de una investigación en la web, no de una consulta al proveedor. Puede variar al reservar.",
      provider: null,
      trusted: false,
    };
  }
  if (AI_SOURCES.has(source)) {
    return {
      state: "ESTIMADO",
      label: "Estimado por IA",
      detail: "Aproximación generada por IA; puede variar al reservar.",
      provider: null,
      trusted: false,
    };
  }

  // 6) Cualquier otra etiqueta desconocida: nunca se presenta como verificada.
  return {
    state: "ESTIMADO",
    label: "Estimado",
    detail: "Precio aproximado; confírmalo con el proveedor antes de reservar.",
    provider: null,
    trusted: false,
  };
}
