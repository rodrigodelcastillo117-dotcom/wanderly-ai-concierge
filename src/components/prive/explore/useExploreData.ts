// Datos compartidos de Explorar: eventos con fecha del catálogo, ciudad de salida de la persona e ideas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { indexDestinations } from "@/lib/priveBrowse";
import { tripDestination } from "@/components/prive/home/context";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";
import { PRIVE_GEO } from "@/lib/priveExploreGeo";
import type { Coord } from "@/lib/priveExplore";
import type { PriveLang } from "@/lib/priveI18n";

/** Eventos con fecha del catálogo (universo Iconic Events; cada uno con su ficha y fuente). */
export function useCatalogEvents(): PriveExperience[] {
  const api = usePriveCatalog();
  const [items, setItems] = useState<PriveExperience[]>([]);
  useEffect(() => {
    let alive = true;
    api.universe("iconic_events", null, 200)
      .then((r) => { if (alive) setItems((r?.experiences ?? []).filter((e) => !!e.event_start)); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [api]);
  return items;
}

export type Origin = { key: string; label: string; coord: Coord };
const ORIGIN_KEY = "iatos_prive_origin_v1";
const readStored = (): string | null => { try { return localStorage.getItem(ORIGIN_KEY); } catch { return null; } };
const store = (v: string) => { try { localStorage.setItem(ORIGIN_KEY, v); } catch { /* modo privado */ } };

const nameOf = (slug: string, lang: PriveLang) => (lang === "en" ? PRIVE_DESTINATION_INDEX[slug]?.en : PRIVE_DESTINATION_INDEX[slug]?.es) ?? slug;

/**
 * Ciudad de salida para estimar horas de vuelo: la que la persona eligió aquí (se recuerda en este
 * navegador), si no la de su perfil (profiles.ciudad_origen) cuando coincide con un destino con coordenada, y
 * si no se pide elegir. Nunca se supone una ciudad.
 */
export function useOrigin(lang: PriveLang) {
  const { user } = useAuth();
  const [profileCity, setProfileCity] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => readStored());
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase.from("profiles").select("ciudad_origen").eq("id", user.id).maybeSingle();
        const city = (data as { ciudad_origen?: string | null } | null)?.ciudad_origen ?? null;
        if (alive) setProfileCity(city && city.trim() ? city.trim() : null);
      } catch { /* sin perfil: se pide elegir */ }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const options = useMemo(() => Object.keys(PRIVE_GEO)
    .filter((s) => PRIVE_DESTINATION_INDEX[s]?.kind !== "neighborhood")
    .map((s) => ({ key: s, label: nameOf(s, lang) }))
    .sort((a, b) => a.label.localeCompare(b.label, lang)), [lang]);
  const profileSlug = useMemo(() => {
    if (!profileCity) return null;
    const d = tripDestination(profileCity, indexDestinations());
    return d && PRIVE_GEO[d.slug] ? d.slug : null;
  }, [profileCity]);

  const key = chosen && PRIVE_GEO[chosen] ? chosen : profileSlug;
  const origin: Origin | null = key ? { key, label: nameOf(key, lang), coord: { lat: PRIVE_GEO[key].lat, lng: PRIVE_GEO[key].lng } } : null;
  const choose = useCallback((k: string) => { setChosen(k || null); if (k) store(k); }, []);
  return { origin, options, choose, profileCity };
}

export { useIdeas } from "./useIdeas";
