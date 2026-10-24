// Vista previa de lugares que la tabla curada no conoce (país, región, carretera, pueblo): llama a la
// función place-resolve SOLO con lo que la persona escribió, con espera (debounce) y memoria por sesión.
// Lo que ya conocen la tabla de regiones o el catálogo de ciudades no se consulta.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cityAirports } from "../../supabase/functions/_shared/airports";
import { findRegion, placeKey, placeLookup, type Region } from "../../supabase/functions/_shared/regions";
import type { PlaceResolution } from "../../supabase/functions/_shared/placeResolve";
import { PLACES } from "@/lib/exploreFlights";

export type { PlaceResolution };

const KNOWN_CITIES = new Set(PLACES.filter((p) => p.kind === "city").map((p) => placeKey(p.value)));

const KNOWN_KEYS = [...new Set(PLACES.map((p) => placeKey(p.value)))];

/**
 * ¿Vale la pena consultar este destino? No, si es una región curada, una ciudad conocida o el principio
 * de un lugar del catálogo (la persona sigue escribiendo "Pari…" → París).
 */
export function shouldPreview(s: unknown): boolean {
  const t = String(s ?? "").trim();
  if (t.length < 3) return false;
  const k = placeKey(t);
  if (findRegion(t) || cityAirports(t) || KNOWN_CITIES.has(k)) return false;
  if (KNOWN_KEYS.some((l) => l !== k && l.startsWith(k))) return false;
  return true;
}

const CACHE = new Map<string, PlaceResolution>();
export function __resetPlaceResolveCache() { CACHE.clear(); }

export async function fetchPlaceResolutions(destinations: string[]): Promise<PlaceResolution[]> {
  const { data, error } = await supabase.functions.invoke("place-resolve", { body: { destinations } });
  if (error) throw error;
  const results = Array.isArray((data as { results?: unknown })?.results) ? (data as { results: PlaceResolution[] }).results : [];
  for (const r of results) if (r && typeof r.input === "string") CACHE.set(placeKey(r.input), r);
  return results;
}

/**
 * Resoluciones de los destinos (escritos por la persona) que la tabla no conoce. `enabled` = false no
 * consulta nada (p. ej., destinos que llegaron por la URL al abrir la pantalla).
 */
export function usePlaceResolve(texts: string[], opts: { enabled?: boolean; delayMs?: number } = {}) {
  const enabled = opts.enabled ?? true;
  const want = useMemo(
    () => [...new Map(texts.filter(shouldPreview).map((t) => [placeKey(t), t.trim()])).values()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texts.join("|")],
  );
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const missing = want.filter((t) => !CACHE.has(placeKey(t)));
    if (!missing.length) return;
    const timer = setTimeout(() => {
      setLoading(true);
      // Sin red o con error: no se muestra nada y el destino queda como está (el servidor vuelve a intentar).
      fetchPlaceResolutions(missing.slice(0, 8))
        .catch(() => [])
        .finally(() => { setLoading(false); setTick((n) => n + 1); });
    }, opts.delayMs ?? 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, want.join("|")]);
  const places = useMemo(
    () => want.map((t) => CACHE.get(placeKey(t))).filter((p): p is PlaceResolution => !!p),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [want.join("|"), tick],
  );
  const lookup = useMemo(() => placeLookup(places), [places]);
  return { places, loading, lookup: lookup as (d: string) => Region | null };
}
