import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  fetched_at: string;
};

type Args = {
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!args.enabled) return;
    if (!args.origin || !args.destination || !args.depart || !args.return_date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase.functions
      .invoke("serpapi-quote", {
        body: {
          origin: args.origin,
          destination: args.destination,
          depart: args.depart,
          return_date: args.return_date,
          nights: args.nights ?? 1,
          travelers: args.travelers ?? 1,
        },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setData(data as LiveQuote);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [args.origin, args.destination, args.depart, args.return_date, args.nights, args.travelers, args.enabled]);

  return { data, loading, error };
}
