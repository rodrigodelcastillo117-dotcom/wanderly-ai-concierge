// Reservado vs. cotizado (lógica pura, sin Deno: la usan el cliente, el concierge y las pruebas).
//
// trips.status vale "listo" tanto para una cotización recién hecha como para un viaje con todo
// pagado, así que no dice nada de lo reservado. El estado se DERIVA de la tabla bookings: solo una
// reserva confirmada (estado confirmado o con folio/referencia del socio) cuenta como reservada.
// Un clic hacia un socio (status "pending") NO es una reserva. Lo que vino del PDF del usuario
// (desde_pdf) es "según tu archivo", sin verificar.

const CONFIRMED_STATUSES = new Set(["confirmed", "booked", "completed", "paid"]);

export interface BookingLike {
  status?: string | null;
  confirmation_code?: string | null;
  partner_reference?: string | null;
  category?: string | null;
  title?: string | null;
  subtitle?: string | null;
  trip_id?: string | null;
}

/** true solo si hay evidencia de una reserva real (estado confirmado o código del socio). */
export function isConfirmedBooking(b: BookingLike): boolean {
  if (b.confirmation_code && String(b.confirmation_code).trim()) return true;
  if (b.partner_reference && String(b.partner_reference).trim()) return true;
  return CONFIRMED_STATUSES.has(String(b.status ?? "").toLowerCase());
}

export type ItemKind = "vuelo" | "hospedaje" | "tour" | "crucero" | "auto" | "tren" | "ferry" | "restaurante" | "esim" | "seguro" | "otro";

/** Categoría de bookings → tipo de elemento del viaje. */
export const BOOKING_KIND: Record<string, ItemKind> = {
  flight: "vuelo", hotel: "hospedaje", activity: "tour", car: "auto", train: "tren", ferry: "ferry",
  restaurant: "restaurante", esim: "esim", insurance: "seguro", other: "otro", cruise: "crucero",
};

export type ItemState = "reservado" | "segun_tu_archivo" | "cotizado";
export type TripBookingState = "reservado" | "parcialmente_reservado" | "cotizado" | "sin_cotizacion";

export const TRIP_STATE_LABEL: Record<TripBookingState, string> = {
  reservado: "Reservado",
  parcialmente_reservado: "Parcialmente reservado",
  cotizado: "Cotizado · sin reservar",
  sin_cotizacion: "Borrador",
};

export const ITEM_STATE_LABEL: Record<ItemState, string> = {
  reservado: "Reservado",
  segun_tu_archivo: "Según tu archivo (sin verificar)",
  cotizado: "Cotizado · no reservado",
};

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Nombre con que se compara un elemento del viaje contra el título de una reserva. */
function itemName(kind: ItemKind, item: any): string {
  if (kind === "vuelo") return norm([item?.aerolinea, item?.numero_vuelo ?? item?.numero].filter(Boolean).join(" "));
  if (kind === "crucero") return norm([item?.naviera, item?.barco].filter(Boolean).join(" "));
  return norm(item?.nombre ?? item?.titulo ?? item?.name);
}

function bookingMatches(kind: ItemKind, item: any, b: BookingLike): boolean {
  const name = itemName(kind, item);
  if (!name || name.length < 3) return false;
  const hay = ` ${norm(`${b.title ?? ""} ${b.subtitle ?? ""}`)} `;
  if (kind === "vuelo") {
    const num = norm(item?.numero_vuelo ?? item?.numero).replace(/\s+/g, "");
    if (num.length >= 4 && hay.replace(/\s+/g, "").includes(num)) return true;
  }
  return hay.includes(` ${name} `);
}

/**
 * Estado de UN elemento del viaje (un vuelo, un hotel…). Reservado si una reserva confirmada de su
 * categoría lo nombra, o si es el único elemento de esa categoría y hay una reserva confirmada de
 * ella. Del PDF del usuario: "según tu archivo". Lo demás es una opción cotizada.
 */
export function itemBookingState(kind: ItemKind, item: any, siblings: any[], confirmed: BookingLike[]): ItemState {
  const sameKind = confirmed.filter((b) => BOOKING_KIND[String(b.category ?? "other")] === kind);
  if (sameKind.some((b) => bookingMatches(kind, item, b))) return "reservado";
  if (sameKind.length > 0 && siblings.length === 1) return "reservado";
  // desde_usuario: dato que el usuario dio en el chat (p. ej. "ya cambié de hotel"), sin verificar.
  if (item?.desde_pdf || item?.desde_usuario) return "segun_tu_archivo";
  return "cotizado";
}

export type TripBookingSummary = {
  estado: TripBookingState;
  label: string;
  /** Por tipo de elemento presente en el viaje o en las reservas confirmadas. */
  por_tipo: Partial<Record<ItemKind, ItemState>>;
  reservas_confirmadas: number;
  /** Clics a socios sin confirmación (no son reservas). */
  clics_sin_confirmar: number;
};

const TRIP_KINDS: Array<[ItemKind, string]> = [
  ["vuelo", "vuelos_json"], ["hospedaje", "hospedaje_json"], ["tour", "tours_json"], ["crucero", "cruceros_json"],
];

/** Estado del viaje completo, derivado de sus reservas (no de trips.status). */
export function deriveTripBookingState(trip: any, bookings: BookingLike[]): TripBookingSummary {
  const all = arr(bookings).filter((b) => !b?.trip_id || !trip?.id || b.trip_id === trip.id);
  const confirmed = all.filter(isConfirmedBooking);
  const por_tipo: TripBookingSummary["por_tipo"] = {};
  // Solo vuelos y hospedaje deciden si el viaje está "reservado" completo: tours y cruceros son
  // opciones sugeridas que el usuario puede no tomar.
  const core: ItemKind[] = [];
  const present: ItemKind[] = [];
  for (const [kind, col] of TRIP_KINDS) {
    const items = arr(trip?.[col]);
    if (!items.length) continue;
    const states = items.map((it) => itemBookingState(kind, it, items, confirmed));
    por_tipo[kind] = states.includes("reservado") ? "reservado" : states.includes("segun_tu_archivo") ? "segun_tu_archivo" : "cotizado";
    present.push(kind);
    if (kind === "vuelo" || kind === "hospedaje") core.push(kind);
  }
  for (const b of confirmed) {
    const kind = BOOKING_KIND[String(b.category ?? "other")] ?? "otro";
    por_tipo[kind] = "reservado";
  }
  const hasQuote = Number(trip?.total_estimado) > 0 || core.length > 0 || Object.keys(por_tipo).length > 0;
  let estado: TripBookingState;
  if (confirmed.length === 0) estado = hasQuote ? "cotizado" : "sin_cotizacion";
  else {
    const decide = core.length > 0 ? core : present;
    estado = decide.every((k) => por_tipo[k] === "reservado") ? "reservado" : "parcialmente_reservado";
  }
  return {
    estado,
    label: TRIP_STATE_LABEL[estado],
    por_tipo,
    reservas_confirmadas: confirmed.length,
    clics_sin_confirmar: all.length - confirmed.length,
  };
}

/** Agrupa reservas por viaje (para la lista de viajes). */
export function bookingsByTrip<T extends BookingLike>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of arr(rows) as T[]) {
    if (!r?.trip_id) continue;
    out.set(r.trip_id, [...(out.get(r.trip_id) ?? []), r]);
  }
  return out;
}
