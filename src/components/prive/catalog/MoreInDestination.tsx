import { useEffect, useState } from "react";
import { usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { usePriveT } from "@/components/prive/PriveLang";
import { FeaturedExperienceCard } from "@/components/prive/home/defaults";
import { Rail } from "./Rail";

/** "Más en <ciudad>" (Fase 7): otras experiencias publicables del destino, ordenadas por el servidor. */
export function MoreInDestination({ slug, city, excludeId, from, to, id, title }: {
  slug: string; city: string; excludeId?: string; from?: string | null; to?: string | null; id?: string; title?: string;
}) {
  const api = usePriveCatalog();
  const t = usePriveT();
  const [items, setItems] = useState<PriveExperience[] | null>(null);
  useEffect(() => {
    let alive = true;
    api.forYou(slug, from ?? null, to ?? null, 10).then((r) => { if (alive) setItems(r); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, from, to]);
  const list = (items ?? []).filter((e) => e.id !== excludeId && e.state !== "DESACTUALIZADO");
  if (!list.length) return null;
  return (
    <section id={id} aria-labelledby={`${id ?? "more"}-title`} className="scroll-mt-24" data-testid="prive-more-in">
      <Rail label={title ?? t.exp.more(city)} large heading={<h2 id={`${id ?? "more"}-title`} className="text-3xl">{title ?? t.exp.more(city)}</h2>}>
        {list.map((e) => <li key={e.id}><FeaturedExperienceCard e={e} size="md" /></li>)}
      </Rail>
    </section>
  );
}
