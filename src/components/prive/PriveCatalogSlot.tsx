// Punto de integración del catálogo Privé (grupo "catalog"). Aquí se conectan las RPC de contenido
// `prive_*(_ps text, …)`; cada una empieza con prive_require en el servidor. Mientras no haya
// ninguna registrada, el hub muestra "en curaduría" sin llamar a nada.
//
// Cómo registrar una sección: agregar a PRIVE_HUB_SECTIONS { id, title, rpc, args?, render }.
// La llamada pasa por usePriveAccess().content, que NO llama sin sesión Privé y que, ante un código
// PRIVE_*, borra la sesión y regresa al candado.
import { useEffect, useState } from "react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { messageFor } from "@/lib/priveCopy";
import type { PriveText } from "@/lib/priveI18n";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import type { PriveErrorCode } from "@/lib/priveApi";
import { CATALOG_HUB_SECTIONS } from "@/components/prive/catalog/hubSections";

export type PriveHubSection = {
  id: string;
  /** Título fijo o según el idioma. */
  title: string | ((t: PriveText) => string);
  rpc: string;
  args?: Record<string, unknown>;
  /** Devuelve null si los datos vienen vacíos (entonces se muestra "en curaduría"). */
  render: (data: unknown) => React.ReactNode | null;
};

// Secciones del grupo catalog (destinos con contenido y universos), registradas aquí.
export const PRIVE_HUB_SECTIONS: PriveHubSection[] = [...CATALOG_HUB_SECTIONS];

type Loaded = { id: string; node: React.ReactNode | null } | { id: string; error: PriveErrorCode };

export function PriveCatalogSlot({ sections = PRIVE_HUB_SECTIONS, onContent }: {
  sections?: PriveHubSection[];
  /** Avisa si hay contenido publicable (el hub oculta entonces las fichas estáticas de universos). */
  onContent?: (has: boolean) => void;
}) {
  const { content, unlocked } = usePriveAccess();
  const t = usePriveT();
  const lang = usePriveLang();
  const [loaded, setLoaded] = useState<Loaded[] | null>(sections.length ? null : []);

  useEffect(() => {
    if (!unlocked || sections.length === 0) return;
    let alive = true;
    void Promise.all(
      sections.map(async (s): Promise<Loaded> => {
        const r = await content(s.rpc, s.args ?? {});
        return r.ok ? { id: s.id, node: s.render(r.data) } : { id: s.id, error: r.code };
      }),
    ).then((res) => { if (alive) setLoaded(res); });
    return () => { alive = false; };
  }, [unlocked, sections, content]);

  const visible = (loaded ?? []).filter((l) => ("node" in l ? l.node != null : l.error !== "NOT_AVAILABLE"));
  const has = visible.some((l) => "node" in l);
  useEffect(() => { if (loaded !== null) onContent?.(has); }, [loaded, has, onContent]);

  if (loaded === null) {
    return <p role="status" className="text-sm prive-muted">{t.hub.loadingSelection}</p>;
  }
  if (visible.length === 0) {
    return (
      <div className="prive-panel p-6 sm:p-8" data-testid="prive-curating">
        <p className="prive-eyebrow mb-3">{t.hub.forYou}</p>
        <h2 className="text-2xl sm:text-3xl mb-3">{t.hub.curatingTitle}</h2>
        <p className="text-sm prive-muted max-w-prose">{t.hub.curatingBody}</p>
      </div>
    );
  }
  return (
    <div className="space-y-10">
      {visible.map((l) => {
        const s = sections.find((x) => x.id === l.id)!;
        return (
          <section key={l.id} aria-labelledby={`prive-sec-${l.id}`}>
            <h2 id={`prive-sec-${l.id}`} className="text-3xl sm:text-4xl mb-6">{typeof s.title === "function" ? s.title(t) : s.title}</h2>
            {"node" in l ? l.node : <p role="alert" className="text-sm prive-muted">{messageFor(l.error, lang)}</p>}
          </section>
        );
      })}
    </div>
  );
}
