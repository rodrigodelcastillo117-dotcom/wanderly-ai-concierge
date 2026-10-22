// Contexto de FOR YOU: datos de prive_home y el viaje activo resuelto a un destino de Privé. Lo
// usan la portada, las secciones de prive-ux y las ranuras de privekey/privevalor (sin props).
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useActiveTrip } from "@/hooks/useActiveTrip";
import { indexDestinations, matchScore, normalizeQuery, type BrowseDestination } from "@/lib/priveBrowse";
import type { PriveUniverse } from "@/lib/priveCatalogApi";

export type PriveHomeData = { total: number; universes: { key: PriveUniverse; count: number }[]; destinations: BrowseDestination[] };
export type PriveTripInfo = {
  loading: boolean;
  trip: { id: string; destino: string | null; fecha_salida: string | null; fecha_regreso: string | null } | null;
  /** Destino de Privé al que va el viaje (o null si el viaje va a otro lugar). */
  dest: BrowseDestination | null;
};

/** Destino de Privé al que va el viaje ("Ciudad de México, México" → cdmx), o null. Nunca otro viaje. */
export function tripDestination(destino: string | null | undefined, list: BrowseDestination[]): BrowseDestination | null {
  const q = normalizeQuery(String(destino ?? "").split(/[,(]/)[0]);
  if (!q) return null;
  let best: BrowseDestination | null = null;
  let score = 0;
  for (const d of list) {
    const s = matchScore(d, q);
    if (s > score) { score = s; best = d; }
  }
  return score >= 65 ? best : null;
}

const TripCtx = createContext<PriveTripInfo>({ loading: false, trip: null, dest: null });
const HomeCtx = createContext<PriveHomeData | null>(null);

export function PriveTripProvider({ children }: { children: ReactNode }) {
  const { trip, loading } = useActiveTrip();
  const value = useMemo<PriveTripInfo>(() => {
    const t = trip as unknown as PriveTripInfo["trip"] | null;
    return {
      loading,
      trip: t ? { id: t.id, destino: t.destino ?? null, fecha_salida: t.fecha_salida ?? null, fecha_regreso: t.fecha_regreso ?? null } : null,
      dest: t ? tripDestination(t.destino, indexDestinations()) : null,
    };
  }, [trip, loading]);
  return <TripCtx.Provider value={value}>{children}</TripCtx.Provider>;
}

export function PriveHomeProvider({ data, children }: { data: PriveHomeData; children: ReactNode }) {
  return <HomeCtx.Provider value={data}>{children}</HomeCtx.Provider>;
}

export const usePriveTrip = () => useContext(TripCtx);
export const usePriveHome = () => useContext(HomeCtx);
