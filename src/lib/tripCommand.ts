/**
 * "Centro de mando" del viaje (Inicio y detalle del viaje): en qué fase está, cuánto falta y cuál
 * es la SIGUIENTE acción útil. Puro y determinista (recibe `today`/`now`) para probar cada caso.
 *
 * Por qué existe: Inicio era una revista (video, destinos, herramientas) y el viaje activo era
 * un renglón más; el detalle del viaje no decía qué hacer después de cotizar. Aquí se decide una
 * sola acción principal con reglas explícitas, sin inventar nada: si no hay cotización se pide
 * cotizar, si el precio es viejo se pide revisarlo, y nunca se dice "reservado" sin reserva.
 */
import { arrivalByLand } from "@/lib/groundTrip";
import { diffLocalDays } from "@/lib/localDate";
import { LIVE_TTL_HOURS } from "@/lib/provenance";

export type TripPhase = "sin_fecha" | "proximo" | "en_curso" | "terminado";

export type TripTiming = {
  phase: TripPhase;
  /** Días hasta la salida (0 = hoy). null sin fecha. */
  daysToStart: number | null;
  /** Día del viaje en curso (1 = primer día). */
  dayOfTrip: number | null;
  /** Días totales del viaje (salida a regreso, inclusive). */
  totalDays: number | null;
  /** "Faltan 12 días", "Sales mañana", "Día 2 de 5", "Terminó hace 3 días". */
  label: string;
};

type TripDates = { fecha_salida?: string | null; fecha_regreso?: string | null };

export function tripTiming(trip: TripDates | null | undefined, today: string): TripTiming {
  const start = trip?.fecha_salida ?? null;
  const end = trip?.fecha_regreso ?? start;
  if (!start) return { phase: "sin_fecha", daysToStart: null, dayOfTrip: null, totalDays: null, label: "Sin fechas todavía" };
  const daysToStart = diffLocalDays(today, start);
  const daysToEnd = diffLocalDays(today, end);
  const totalDays = Math.max(1, diffLocalDays(start, end) + 1);
  if (daysToStart > 0) {
    const label = daysToStart === 1 ? "Sales mañana" : `Faltan ${daysToStart} días`;
    return { phase: "proximo", daysToStart, dayOfTrip: null, totalDays, label };
  }
  if (daysToEnd >= 0) {
    const dayOfTrip = 1 - daysToStart;
    const label = daysToStart === 0 ? `Sales hoy · día 1 de ${totalDays}` : `Día ${dayOfTrip} de ${totalDays}`;
    return { phase: "en_curso", daysToStart, dayOfTrip, totalDays, label };
  }
  const ago = -daysToEnd;
  return { phase: "terminado", daysToStart, dayOfTrip: null, totalDays, label: ago === 1 ? "Terminó ayer" : `Terminó hace ${ago} días` };
}

export type QuoteFreshness = {
  /** "sin_cotizacion" = borrador; "vigente" = dentro de la vigencia; "por_revisar" = vencida o cambió algo. */
  status: "sin_cotizacion" | "vigente" | "por_revisar";
  label: string;
};

type QuoteLike = { created_at?: string | null; valid_until?: string | null } | null | undefined;

/**
 * Frescura de la cotización. Con snapshot manda su `valid_until`; sin él (viajes anteriores) solo
 * se sabe cuándo se guardó el viaje y pasadas 24 h se pide revisar (mismo criterio que quote.ts).
 */
export function quoteFreshness(
  trip: { total_estimado?: number | string | null; quote_needs_update?: boolean | null; created_at?: string | null } | null | undefined,
  quote: QuoteLike,
  now: Date = new Date(),
): QuoteFreshness {
  const total = Number(trip?.total_estimado) || 0;
  if (!(total > 0) && !quote) return { status: "sin_cotizacion", label: "Aún sin cotización" };
  if (trip?.quote_needs_update) return { status: "por_revisar", label: "Cambiaste el viaje: actualiza la cotización" };
  const quotedRaw = quote?.created_at ?? trip?.created_at ?? null;
  const quotedAt = quotedRaw ? new Date(quotedRaw) : null;
  const q = quotedAt && Number.isFinite(quotedAt.getTime()) ? quotedAt : null;
  const vuRaw = quote?.valid_until ? new Date(quote.valid_until) : q ? new Date(q.getTime() + LIVE_TTL_HOURS * 3600_000) : null;
  const validUntil = vuRaw && Number.isFinite(vuRaw.getTime()) ? vuRaw : null;
  if (!q || !validUntil) return { status: "por_revisar", label: "Sin fecha de cotización: revisa los precios" };
  if (now.getTime() > validUntil.getTime()) return { status: "por_revisar", label: `Precios de ${ageText(q, now)}: revísalos antes de reservar` };
  return { status: "vigente", label: `Cotizado ${ageText(q, now)}` };
}

function ageText(from: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60000));
  if (min < 60) return min <= 1 ? "hace un momento" : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

export type NextActionKey =
  | "cotizar" | "actualizar" | "revisar_precios" | "reservar" | "preparar" | "modo_viaje" | "recuerdos" | "poner_fechas" | "experiencias";

export type NextAction = {
  key: NextActionKey;
  /** Qué hacer, en una frase. */
  title: string;
  /** Por qué ahora. */
  detail: string;
  /** Texto del botón principal. */
  cta: string;
  /** Ruta interna del botón. */
  to: string;
};

export type NextActionInput = {
  id: string;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  total_estimado?: number | string | null;
  quote_needs_update?: boolean | null;
  created_at?: string | null;
  /** Un viaje traído ("Ya tengo mi viaje") lleva itinerario_json.traido = true. */
  itinerario_json?: unknown;
};

/**
 * La siguiente acción principal del viaje. Orden de prioridad:
 * en curso → Modo viaje; terminado → diario; sin fechas → ponerlas; sin cotización → cotizar;
 * cotización desactualizada → actualizarla; precios vencidos → revisarlos; faltan ≤3 días →
 * preparar maleta; si no, elegir y reservar con el proveedor (IATOS no reserva por ti).
 */
export function nextTripAction(trip: NextActionInput, opts: { today: string; now?: Date; quote?: QuoteLike }): NextAction {
  const base = `/dashboard/viajes/${trip.id}`;
  const timing = tripTiming(trip, opts.today);
  if (timing.phase === "en_curso") {
    return { key: "modo_viaje", title: "Todo tu día en un lugar", detail: "El Modo viaje junta tu día, el mapa y lo que tienes cerca.", cta: "Abrir Modo viaje", to: `${base}/live` };
  }
  if (timing.phase === "terminado") {
    return { key: "recuerdos", title: "Guarda tus recuerdos", detail: "Escribe en el diario lo mejor del viaje mientras lo tienes fresco.", cta: "Abrir diario", to: `${base}/diario` };
  }
  if (timing.phase === "sin_fecha") {
    return { key: "poner_fechas", title: "Elige tus fechas", detail: "Sin fechas no podemos consultar vuelos ni hoteles.", cta: "Poner fechas", to: `${base}/editar` };
  }
  // Ya tiene vuelos y hotel: no hay nada que cotizar; lo que sigue es armar sus días.
  const it = trip.itinerario_json as { traido?: unknown } | null | undefined;
  if (it && typeof it === "object" && !Array.isArray(it) && it.traido === true) {
    if ((timing.daysToStart ?? 99) <= 3) {
      return { key: "preparar", title: timing.daysToStart === 0 ? "Hoy sales de viaje" : "Prepara tu maleta", detail: "Revisa tu lista de equipaje y el clima del destino.", cta: "Abrir lista de equipaje", to: `${base}/packing` };
    }
    return { key: "experiencias", title: "Arma tus días", detail: "Vuelos y hotel ya los tienes. Elige restaurantes, museos, tours y experiencias.", cta: "Ver restaurantes y experiencias", to: base };
  }
  const fresh = quoteFreshness(trip, opts.quote, opts.now);
  if (fresh.status === "sin_cotizacion") {
    return { key: "cotizar", title: "Cotiza tu viaje", detail: "Aún no hay precios de vuelo ni hospedaje para este viaje.", cta: "Ver opciones y cotizar", to: base };
  }
  if (trip.quote_needs_update) {
    return { key: "actualizar", title: "Actualiza tu cotización", detail: "Cambiaste fechas, viajeros o tu selección después de cotizar.", cta: "Actualizar cotización", to: `${base}/editar` };
  }
  if (fresh.status === "por_revisar" && (timing.daysToStart ?? 0) > 3) {
    return { key: "revisar_precios", title: "Revisa los precios", detail: "Las tarifas cambian; confírmalas con el proveedor antes de reservar.", cta: "Revisar cotización", to: base };
  }
  if ((timing.daysToStart ?? 99) <= 3) {
    return { key: "preparar", title: timing.daysToStart === 0 ? "Hoy sales de viaje" : "Prepara tu maleta", detail: "Revisa tu lista de equipaje y el clima del destino.", cta: "Abrir lista de equipaje", to: `${base}/packing` };
  }
  // Viaje corto por tierra (CDMX → Tepoztlán): "cómo llegar", no "vuelo" (claude/viaje-corto).
  if (arrivalByLand(trip as any)) return { key: "reservar", title: "Elige y reserva", detail: "Escoge cómo llegar y tu hotel en tu cotización; reservas directo con el proveedor.", cta: "Elegir cómo llegar y hotel", to: base };
  return { key: "reservar", title: "Elige y reserva", detail: "Escoge vuelo y hotel en tu cotización; reservas directo con el proveedor.", cta: "Elegir vuelo y hotel", to: base };
}

export type TrackedFlightLike = {
  flight: string;
  flight_date?: string | null;
  last_status?: string | null;
  last_checked_at?: string | null;
};

/**
 * Renglón de estado de un vuelo seguido, con lo último que el servidor guardó (tracked_flights).
 * Sin lectura todavía se dice así; nunca se supone "a tiempo".
 */
export function flightStatusLine(f: TrackedFlightLike, now: Date = new Date()): string {
  const status = String(f.last_status ?? "").trim();
  const at = f.last_checked_at ? new Date(f.last_checked_at) : null;
  const when = at && Number.isFinite(at.getTime()) ? ` · revisado ${ageText(at, now)}` : "";
  if (!status || status === "desconocido") return `Vuelo ${f.flight} · aún sin estado del proveedor${when}`;
  return `Vuelo ${f.flight} · ${status}${when}`;
}
