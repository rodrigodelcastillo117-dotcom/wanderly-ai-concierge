// Datos de FOR YOU para las ranuras de privekey (CuratedForYou, YourNextJourney, YourWorldIsReady): el viaje
// activo (misma regla que Iato), los destinos con contenido (prive_home) y "Para ti" del destino correcto
// (prive_for_you, que ordena por viaje y, solo con permiso, por Travel DNA). Una sola carga compartida.
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { useActiveTrip } from "@/hooks/useActiveTrip";
import type { PriveExperience } from "@/lib/priveCatalogApi";
import { forYouSource, personalization, type ForYouSource, type HomeDestination } from "@/lib/priveKeyForYou";

type Home = { destinations: HomeDestination[]; total: number };
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
const TTL = 60_000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
  const p = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), p });
  return p;
}
export const __resetForYouCache = () => memo.clear();

export interface ForYouData {
  loading: boolean;
  source: ForYouSource | null;
  items: PriveExperience[];
  kind: ReturnType<typeof personalization> | null;
  home: HomeDestination[];
  error: boolean;
  choose: (slug: string | null) => void;
  chooseTrip: (id: string | null) => void;
  dnaConsent: boolean;
}

export function useForYouData(opts: { limit?: number } = {}): ForYouData {
  const { content, unlocked, session, status } = usePriveAccess();
  const { resolved, loading: tripsLoading } = useActiveTrip({ enabled: unlocked });
  const [home, setHome] = useState<HomeDestination[] | null>(null);
  const [items, setItems] = useState<PriveExperience[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState(false);
  const [chosenSlug, setChosenSlug] = useState<string | null>(null);
  const [chosenTripId, setChosenTripId] = useState<string | null>(null);
  const token = session?.token ?? "";

  useEffect(() => {
    if (!unlocked) return;
    let alive = true;
    cached(`home:${token}`, async () => {
      const r = await content<Home>("prive_home");
      if (!r.ok) throw new Error(r.code);
      return r.data;
    }).then((d) => { if (alive) setHome(Array.isArray(d?.destinations) ? d.destinations : []); })
      .catch(() => { if (alive) { setHome([]); setError(true); } });
    return () => { alive = false; };
  }, [unlocked, content, token]);

  const source = useMemo(() => (home && !tripsLoading ? forYouSource(resolved, home, { chosenSlug, chosenTripId }) : null), [home, tripsLoading, resolved, chosenSlug, chosenTripId]);
  const target = source ? (source.kind === "trip" || source.kind === "chosen" ? source.destination : source.kind === "editorial" ? source.destination : source.fallback) : null;
  const from = source?.kind === "trip" ? source.from : null;
  const to = source?.kind === "trip" ? source.to : null;

  useEffect(() => {
    if (!unlocked || !target) { setItems([]); return; }
    let alive = true;
    setLoadingItems(true);
    cached(`fy:${token}:${target.slug}:${from}:${to}:${opts.limit ?? 6}`, async () => {
      const r = await content<PriveExperience[]>("prive_for_you", { _destination: target.slug, _from: from, _to: to, _limit: opts.limit ?? 6 });
      if (!r.ok) throw new Error(r.code);
      return Array.isArray(r.data) ? r.data : [];
    }).then((d) => { if (alive) setItems(d as PriveExperience[]); })
      .catch(() => { if (alive) { setItems([]); setError(true); } })
      .finally(() => { if (alive) setLoadingItems(false); });
    return () => { alive = false; };
  }, [unlocked, content, token, target?.slug, from, to, opts.limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((slug: string | null) => setChosenSlug(slug), []);
  const chooseTrip = useCallback((id: string | null) => setChosenTripId(id), []);
  return {
    loading: !home || tripsLoading || loadingItems, source, items, kind: source ? personalization(source, items) : null, home: home ?? [], error, choose, chooseTrip,
    dnaConsent: status?.onboarding?.dna_consent === true,
  };
}
