// Cuando no hay oportunidades verificables: contenido editorial que SÍ sirve (consejos del Insider's
// Notebook con fuente) en lugar de inventar una promoción.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { topFive, type InsiderPage } from "@/lib/priveValueModel";
import type { PriveValueApi } from "@/lib/priveValueApi";
import type { ValueText } from "@/lib/priveValueI18n";
import { InsiderTipCard } from "./InsiderTipCard";

export function EditorialFallback({ api, t, destination }: { api: PriveValueApi; t: ValueText; destination?: string | null }) {
  const [page, setPage] = useState<InsiderPage | null>(null);
  const [slugs, setSlugs] = useState<{ slug: string; es: string; en: string }[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (destination) {
          const p = await api.insider(destination);
          if (alive && p.found && (p.tips?.length ?? 0) > 0) { setPage(p); return; }
        }
        const idx = await api.insiderIndex();
        if (!alive) return;
        setSlugs(idx.destinations.slice(0, 8));
        const first = idx.trips.find((tr) => tr.destination_slug && idx.destinations.some((d) => d.slug === tr.destination_slug))?.destination_slug
          ?? idx.destinations[0]?.slug;
        if (first) { const p = await api.insider(first); if (alive) setPage(p); }
      } catch { /* sin contenido editorial: solo queda el mensaje honesto */ }
    })();
    return () => { alive = false; };
  }, [api, destination]);
  const tips = topFive(page?.tips).slice(0, 3);
  return (
    <section className="space-y-4" data-testid="prive-editorial-fallback" aria-label={t.brand.insider.name}>
      <p className="text-sm prive-champagne">{t.drops.emptyLead}</p>
      {tips.length ? (
        <div className="grid gap-4 md:grid-cols-3">
          {tips.map((tip) => <InsiderTipCard key={tip.id} tip={tip} trips={page?.trips ?? []} api={api} lang={t.lang} t={t} />)}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {slugs.map((d) => (
          <Link key={d.slug} to={`/prive/insider/${d.slug}`} className="prive-btn prive-btn-ghost !min-h-[44px] !px-4 !tracking-[0.12em] !text-[11px]">
            {t.lang === "en" ? d.en : d.es}
          </Link>
        ))}
        <Link to="/prive/insider" className="prive-link inline-flex min-h-[44px] items-center text-sm">{t.brand.insider.name}</Link>
      </div>
    </section>
  );
}
