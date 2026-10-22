// Ranura de FOR YOU: la oportunidad real más relevante (por el viaje, los guardados o la Bóveda). Si no hay
// ninguna verificable, una línea honesta hacia el Insider's Notebook. Sin sesión Privé no pinta nada.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { localToday, visibleDrops, type PriveDrop } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { useValueText, type ValueLang } from "@/lib/priveValueI18n";
import { BrandTitle } from "./ValueUi";
import { DropCard } from "./DropCard";

export function DropsTeaser({ destination = null, lang, max = 2 }: { destination?: string | null; lang?: ValueLang; max?: number } = {}) {
  const api = usePriveValue();
  const t = useValueText(lang);
  const [items, setItems] = useState<PriveDrop[] | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let alive = true;
    api.drops({ destination, limit: 12 })
      .then((r) => { if (alive) setItems(visibleDrops(r.items, localToday())); })
      .catch((e) => { if (!alive) return; if (e instanceof PriveLockedError) setLocked(true); else setItems([]); });
    return () => { alive = false; };
  }, [api, destination]);
  if (locked || items === null) return null;
  // Primero lo que tiene una razón personal real; una editorial solo si no hay otra cosa.
  const real = items.filter((d) => d.type !== "editorial");
  const pool = real.length ? real : items;
  const shown = [...pool].sort((a, b) => (b.reasons?.length ?? 0) - (a.reasons?.length ?? 0)).slice(0, max);
  return (
    <section aria-labelledby="prive-drops-teaser" className="space-y-4" data-testid="prive-drops-teaser">
      <BrandTitle id="prive-drops-teaser" name={t.brand.drops.name} sub={shown.length ? t.drops.teaserTitle : t.brand.drops.sub} />
      {shown.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((d) => (
            <DropCard key={d.id} drop={d} lang={t.lang} t={t} compact onOpenLink={(x) => void api.track("drop_link_open", { ref: x.id, surface: "for_you" })} />
          ))}
        </div>
      ) : (
        <p className="text-sm prive-muted" role="status">{t.drops.teaserNone} <Link to="/prive/insider" className="prive-link">{t.brand.insider.name}</Link></p>
      )}
      <Link to="/prive/drops" className="prive-link inline-flex min-h-[44px] items-center text-sm">{t.drops.seeAll}</Link>
    </section>
  );
}
