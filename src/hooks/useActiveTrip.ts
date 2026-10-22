import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resolveActiveTrip, type ActiveTripResult, type TripLike } from "@/lib/activeTrip";
import { fetchPinnedTripId, savePinnedTripId, type PinResult } from "@/lib/activeTripStore";
import { localISODate } from "@/lib/localDate";

export const ACTIVE_TRIP_COLUMNS = "id, user_id, destino, pais_destino, fecha_salida, fecha_regreso, created_at";

export type UseActiveTrip<T extends TripLike> = {
  trips: T[];
  pinnedId: string | null;
  resolved: ActiveTripResult<T>;
  /** Atajo de resolved.trip (null si no hay viaje o hay empate). */
  trip: T | null;
  loading: boolean;
  pin: (id: string | null) => Promise<PinResult>;
};

/**
 * El mismo viaje activo en todas las pantallas (Dashboard, Cercanos, Gastos, Modo viaje, Fixer):
 * viajes del usuario (propios y compartidos, vía RLS) + profiles.active_trip_id, resueltos con
 * resolveActiveTrip, la función que usa el concierge en el servidor. Si hay empate, `trip` es null
 * y `resolved.candidates` trae entre cuáles elegir: nunca se adivina por fecha de creación.
 */
export function useActiveTrip<T extends TripLike = TripLike>(
  opts: { enabled?: boolean; columns?: string } = {},
): UseActiveTrip<T> {
  const { user } = useAuth();
  const enabled = opts.enabled !== false;
  const columns = opts.columns ?? ACTIVE_TRIP_COLUMNS;
  const [trips, setTrips] = useState<T[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled || !user?.id) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [tripsRes, pinned] = await Promise.all([
        Promise.resolve(
          supabase.from("trips").select(columns).order("fecha_salida", { ascending: true }).limit(50),
        ).catch(() => ({ data: null })),
        fetchPinnedTripId(supabase, user.id),
      ]);
      if (cancelled) return;
      setTrips(((tripsRes as { data: T[] | null })?.data ?? []) as T[]);
      setPinnedId(pinned.id);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [enabled, user?.id, columns]);

  const todayLocal = localISODate();
  const resolved = useMemo(() => resolveActiveTrip(trips, { pinnedId, todayLocal }), [trips, pinnedId, todayLocal]);

  const pin = useCallback(async (id: string | null) => {
    setPinnedId(id);
    if (!user?.id) return { ok: false };
    return savePinnedTripId(supabase, user.id, id);
  }, [user?.id]);

  return { trips, pinnedId, resolved, trip: resolved.trip, loading, pin };
}
