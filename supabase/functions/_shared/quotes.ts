// Snapshot inmutable de cada cotización (tabla public.trip_quotes). Sin Deno, para probarlo.
//
// Cada vez que analizar-viaje o editar-viaje-ai cotizan, se guarda una fila nueva (nunca se
// actualiza) con moneda, tipo de cambio (fuente y fecha), fuentes, viajeros, noches,
// habitaciones, renglones con su estado y vigencia. trips.total_estimado/desglose_presupuesto
// quedan como caché de la cotización vigente (trips.current_quote_id).

export type LineState = "COTIZADO" | "ESTIMADO" | "PAGADO" | "PENDIENTE" | "OPCIONAL" | "EXCLUIDO";
export const LINE_STATES: LineState[] = ["COTIZADO", "ESTIMADO", "PAGADO", "PENDIENTE", "OPCIONAL", "EXCLUIDO"];
/** Estados que suman al total de la cotización. */
export const STATES_IN_TOTAL: LineState[] = ["COTIZADO", "ESTIMADO", "PENDIENTE", "PAGADO"];

/** Un precio en vivo se considera cotizado durante 24 h; una cotización solo estimada, 7 días. */
export const LIVE_TTL_H = 24;
export const ESTIMATE_TTL_H = 24 * 7;

export type QuoteOrigin = "analizar-viaje" | "editar-viaje-ai" | "logistics-plan";

export type LineItem = {
  category: string;
  label: string;
  amount: number; // en la moneda de la cotización
  qty: number;
  qty_basis: "per_person" | "per_room_night" | "per_trip" | "per_person_day";
  source: string;
  consultado_at: string | null;
  state: LineState;
  booking_url?: string | null;
};

export type FxSnapshot = { rate: number; source: string; fetched_at: string; is_fallback: boolean };

export type QuoteRow = {
  trip_id: string;
  user_id: string;
  origin: QuoteOrigin;
  currency: string;
  total: number;
  breakdown: Record<string, number>;
  line_items: LineItem[];
  travelers: number;
  nights: number;
  rooms: number;
  date_from: string | null;
  date_to: string | null;
  fx_rate: number;
  fx_source: string;
  fx_at: string;
  fx_is_fallback: boolean;
  sources: Record<string, unknown>;
  valid_until: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  vuelos: "Vuelos",
  hospedaje: "Hospedaje",
  comida: "Comida",
  tours: "Experiencias",
  transporte_local: "Transporte local",
  extras: "Extras",
};

const isFresh = (at: string | null | undefined, now: Date) => {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && now.getTime() - t <= LIVE_TTL_H * 3600_000;
};

/** Estado de un renglón según el estado_dato del elemento de referencia. */
export function lineStateFor(item: any, now: Date, fxIsFallback: boolean): LineState {
  const estado = String(item?.estado_dato ?? "").toUpperCase();
  if (estado === "CONFIRMADO") return "PAGADO";
  if (estado === "PENDIENTE_DE_VERIFICACION") return "PENDIENTE";
  if (estado === "CONSULTADO_EN_VIVO") {
    // Con tipo de cambio de respaldo el monto en MXN no está verificado aunque la tarifa sí.
    if (fxIsFallback) return "ESTIMADO";
    // Un precio en vivo que ya venció necesita volver a consultarse.
    return isFresh(item?.consultado_at, now) ? "COTIZADO" : "PENDIENTE";
  }
  return "ESTIMADO";
}

export type SnapshotInput = {
  tripId: string;
  userId: string;
  origin: QuoteOrigin;
  breakdown: Record<string, number>;
  travelers: number;
  nights: number;
  rooms: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  fx: FxSnapshot;
  /** Elemento de referencia de cada renglón (vuelo equilibrio, hotel de precio medio). */
  reference?: { vuelos?: any; hospedaje?: any };
  /** Renglones que el usuario excluyó ("ya tengo vuelo"). */
  excluded?: { vuelos?: boolean; hospedaje?: boolean | string; tours?: boolean; comida?: boolean };
  /** Alternativas que no suman al total (cruceros). */
  optional?: Array<{ category: string; label: string; amount: number; source?: string }>;
  sources?: Record<string, unknown>;
  currency?: string;
  now?: Date;
};

export function buildQuoteSnapshot(input: SnapshotInput): QuoteRow {
  const now = input.now ?? new Date();
  const travelers = Math.max(1, Math.round(Number(input.travelers) || 1));
  const nights = Math.max(0, Math.round(Number(input.nights) || 0));
  const rooms = Math.max(1, Math.round(Number(input.rooms) || 1));
  const breakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.breakdown ?? {})) breakdown[k] = Math.max(0, Math.round(Number(v) || 0));

  const lines: LineItem[] = [];
  for (const [category, amount] of Object.entries(breakdown)) {
    const ref = (input.reference as any)?.[category] ?? null;
    const excluded = !!(input.excluded as any)?.[category] && (input.excluded as any)[category] !== "partial";
    let state: LineState = excluded && amount === 0 ? "EXCLUIDO" : lineStateFor(ref, now, input.fx.is_fallback);
    if (amount === 0 && state !== "EXCLUIDO") state = "ESTIMADO";
    lines.push({
      category,
      label: CATEGORY_LABEL[category] ?? category,
      amount,
      qty: category === "hospedaje" ? nights * rooms : category === "vuelos" || category === "tours" ? travelers : 1,
      qty_basis: category === "hospedaje" ? "per_room_night" : category === "vuelos" || category === "tours" ? "per_person" : "per_trip",
      source: String(ref?.fuente_precio ?? ref?.fuente ?? "estimado"),
      consultado_at: ref?.consultado_at ?? null,
      state,
      booking_url: ref?.booking_link ?? ref?.booking_url ?? null,
    });
  }
  for (const o of input.optional ?? []) {
    const amount = Math.max(0, Math.round(Number(o.amount) || 0));
    if (!(amount > 0)) continue;
    lines.push({
      category: o.category, label: o.label, amount, qty: 1, qty_basis: "per_trip",
      source: o.source ?? "estimado", consultado_at: null, state: "OPCIONAL",
    });
  }

  const total = lines.filter((l) => STATES_IN_TOTAL.includes(l.state)).reduce((s, l) => s + l.amount, 0);

  // Vigencia: el precio en vivo más viejo + 24 h; si todo es estimado, 7 días.
  const liveTimes = lines
    .filter((l) => l.state === "COTIZADO" && l.consultado_at)
    .map((l) => new Date(l.consultado_at!).getTime() + LIVE_TTL_H * 3600_000);
  const validUntil = liveTimes.length ? Math.min(...liveTimes) : now.getTime() + ESTIMATE_TTL_H * 3600_000;

  return {
    trip_id: input.tripId,
    user_id: input.userId,
    origin: input.origin,
    currency: input.currency ?? "MXN",
    total,
    breakdown,
    line_items: lines,
    travelers,
    nights,
    rooms,
    date_from: input.dateFrom ?? null,
    date_to: input.dateTo ?? null,
    fx_rate: input.fx.rate,
    fx_source: input.fx.source,
    fx_at: input.fx.fetched_at,
    fx_is_fallback: input.fx.is_fallback,
    sources: input.sources ?? {},
    valid_until: new Date(validUntil).toISOString(),
  };
}

type MinimalClient = {
  from: (table: string) => any;
};

/**
 * Inserta el snapshot (con el cliente de service role: los usuarios no pueden escribir en
 * trip_quotes) y apunta trips.current_quote_id a él. Nunca lanza: si la tabla aún no existe
 * (migración sin aplicar) solo registra el error y la cotización sigue funcionando como antes.
 */
export async function saveQuoteSnapshot(admin: MinimalClient | null, row: QuoteRow): Promise<{ id: string; created_at: string; valid_until: string } | null> {
  if (!admin) return null;
  try {
    const { data, error } = await admin.from("trip_quotes").insert(row).select("id, created_at, valid_until").single();
    if (error || !data?.id) {
      console.error("trip_quotes insert falló:", error?.message ?? "sin id");
      return null;
    }
    const { error: upErr } = await admin.from("trips").update({ current_quote_id: data.id }).eq("id", row.trip_id);
    if (upErr) console.error("trips.current_quote_id no se actualizó:", upErr.message);
    return data;
  } catch (e) {
    console.error("trip_quotes error:", (e as Error).message);
    return null;
  }
}
