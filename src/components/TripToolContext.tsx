import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plane, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateOnly } from "@/lib/dateUtils";
import { readTripParam } from "@/lib/tripLink";
import { trackBookingClick, type TrackBookingInput } from "@/lib/trackBooking";

export type ToolTrip = {
  id: string;
  destino: string | null;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  num_viajeros?: number | null;
  ciudad_origen?: string | null;
};

export type TripTool = {
  /** Viaje de ?trip=<id>, solo si el usuario tiene acceso (RLS lo devolvió). */
  trip: ToolTrip | null;
  tripId: string | null;
  loading: boolean;
  /** trackBookingClick con el trip_id del viaje en contexto. */
  track: (b: TrackBookingInput) => void;
  clear: () => void;
};

/**
 * Herramienta del viaje ligada a un viaje (E-22). Lee ?trip=<id>, carga el viaje (RLS: solo si es
 * tuyo o eres colaborador aceptado) y registra cada clic con ese trip_id. Un id ajeno o inválido
 * se ignora: el clic se registra sin viaje, como antes.
 */
export function useTripTool(): TripTool {
  const [params, setParams] = useSearchParams();
  const requested = readTripParam(params);
  const [trip, setTrip] = useState<ToolTrip | null>(null);
  const [loading, setLoading] = useState(!!requested);

  useEffect(() => {
    if (!requested) { setTrip(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.resolve(
      supabase.from("trips")
        .select("id, destino, pais_destino, fecha_salida, fecha_regreso, num_viajeros, ciudad_origen")
        .eq("id", requested)
        .maybeSingle(),
    ).then(({ data }) => { if (!cancelled) setTrip((data as ToolTrip | null) ?? null); })
      .catch(() => { if (!cancelled) setTrip(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requested]);

  const tripId = trip?.id ?? null;
  const track = useCallback((b: TrackBookingInput) => trackBookingClick({ ...b, tripId: b.tripId ?? tripId }), [tripId]);
  const clear = useCallback(() => {
    const sp = new URLSearchParams(params);
    sp.delete("trip");
    setParams(sp, { replace: true });
  }, [params, setParams]);

  return { trip, tripId, loading, track, clear };
}

/** "Agregando a tu viaje: París · 12 oct – 20 oct". No se muestra sin viaje en contexto. */
export function TripToolBanner({ tool }: { tool: TripTool }) {
  const t = tool.trip;
  if (!t) return null;
  const fechas = t.fecha_salida
    ? `${formatDateOnly(t.fecha_salida, { day: "numeric", month: "short" })}${t.fecha_regreso ? ` – ${formatDateOnly(t.fecha_regreso, { day: "numeric", month: "short", year: "numeric" })}` : ""}`
    : null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 text-sm">
      <Plane className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="text-muted-foreground">Agregando a tu viaje: </span>
        <Link to={`/dashboard/viajes/${t.id}`} className="font-medium text-foreground hover:text-primary">{t.destino ?? "Mi viaje"}</Link>
        {fechas && <span className="text-muted-foreground"> · {fechas}</span>}
        <span className="block text-[11px] text-muted-foreground">Lo que abras aquí queda ligado a este viaje en "Mis reservas" (es un clic al socio, no una reserva confirmada).</span>
      </p>
      <button type="button" onClick={tool.clear} aria-label="Quitar el viaje en contexto" className="p-1.5 -m-1.5 text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
