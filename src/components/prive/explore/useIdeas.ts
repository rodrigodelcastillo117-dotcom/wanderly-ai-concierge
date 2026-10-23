// Ideas de la ruleta (servidor, con sesión Privé: prive_ideas / prive_idea_save). Módulo aparte para que
// "Para ti" las muestre sin cargar el mapa ni los datos de clima.
import { useCallback, useEffect, useState } from "react";
import { usePriveCatalog, type PriveIdea, type PriveUniverse } from "@/lib/priveCatalogApi";

/** Ideas de la ruleta (servidor, con sesión Privé). */
export function useIdeas() {
  const api = usePriveCatalog();
  const [ideas, setIdeas] = useState<PriveIdea[] | null>(null);
  const load = useCallback(() => {
    api.ideas().then((d) => setIdeas(Array.isArray(d) ? d : [])).catch(() => setIdeas([]));
  }, [api]);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (slug: string, saved: boolean, opts: { universe?: PriveUniverse | null; month?: number | null; budget?: string | null; source?: "ruleta" | "mapa" } = {}) => {
    const r = await api.saveIdea(slug, saved, opts);
    if (!r?.ok) throw new Error(r?.code ?? "SAVE_FAILED");
    load();
    return r;
  }, [api, load]);
  return { ideas, save, reload: load };
}
