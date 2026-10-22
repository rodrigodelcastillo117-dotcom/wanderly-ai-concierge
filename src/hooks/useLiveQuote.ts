import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError, toastFunctionError } from "@/lib/functionErrors";

export type LiveQuote = {
  flight: {
    price_usd: number;
    airline: string;
    airline_logo?: string | null;
    duration: string;
    stops: number;
    departure?: string;
    arrival?: string;
  } | null;
  hotel: {
    name: string;
    rating?: number | null;
    hotel_class?: number | null;
    nightly_usd: number;
    thumbnail?: string | null;
    link?: string | null;
  } | null;
  breakdown: {
    flights_usd: number;
    hotel_nightly_usd: number;
    hotel_total_usd: number;
    nights: number;
    buffer_usd: number;
  };
  total_usd: number;
  total_mxn: number;
  fx_rate?: number;
  source?: string;
  fetched_at: string;
  /** El servidor decide el estado: OBSOLETO = precio guardado (más de 24 h), nunca "en vivo". */
  estado_dato?: string;
  precio_guardado?: boolean;
  /** true si es la cotización guardada del viaje (no se gastó ninguna búsqueda). */
  cached?: boolean;
  /** Se puede pedir una cotización en vivo nueva (la guardada ya tiene más de 24 h). */
  can_refresh?: boolean;
  refresh_available_at?: string;
  /** Aviso para el usuario (límite del plan, actualización muy seguida). */
  aviso?: string;
};

type Args = {
  /** Con el viaje, el servidor guarda la cotización 24 h y no vuelve a gastar búsquedas al abrirlo. */
  tripId?: string;
  origin?: string;
  destination?: string;
  depart?: string;
  return_date?: string;
  nights?: number;
  travelers?: number;
  enabled?: boolean;
};

export function useLiveQuote(args: Args) {
  const [data, setData] = useState<LiveQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = useCallback((refresh: boolean) => ({
    trip_id: args.tripId,
    refresh,
    origin: args.origin,
    destination: args.destination,
    depart: args.depart,
    return_date: args.return_date,
    nights: args.nights ?? 1,
    travelers: args.travelers ?? 1,
  }), [args.tripId, args.origin, args.destination, args.depart, args.return_date, args.nights, args.travelers]);

  useEffect(() => {
    if (!args.enabled) return;
    if (!args.origin || !args.destination || !args.depart || !args.return_date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase.functions
      .invoke("serpapi-quote", { body: body(false) })
      .then(async ({ data, error }) => {
        if (cancelled) return;
        // Al abrir el viaje no se interrumpe con un diálogo: se muestra el motivo en la tarjeta.
        if (error) setError((await readFunctionError(error, "No pudimos cotizar en tiempo real.")).message);
        else setData(data as LiveQuote);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [body, args.enabled, args.origin, args.destination, args.depart, args.return_date]);

  /** "Actualizar precio": acción explícita del usuario; aquí sí se muestra el aviso de límite. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("serpapi-quote", { body: body(true) });
      if (error) {
        await toastFunctionError(error, "No pudimos actualizar el precio. Intenta de nuevo.");
        return;
      }
      setError(null);
      setData(data as LiveQuote);
    } finally {
      setRefreshing(false);
    }
  }, [body]);

  return { data, loading, error, refresh, refreshing };
}
