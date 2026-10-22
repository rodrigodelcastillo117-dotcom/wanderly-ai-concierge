import { Link } from "react-router-dom";
import type { PriveExperience } from "@/lib/priveCatalogApi";
import { imageQueries, priceText, seasonText, universeMeta } from "@/lib/priveCatalogView";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { LabelBadge, StateBadge } from "./Badges";
import { PriveImage } from "./PriveImage";
import { PRIVE } from "./theme";

export function ExperienceCard({ e }: { e: PriveExperience }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const stale = e.state === "DESACTUALIZADO";
  const season = seasonText(e, lang);
  return (
    <article className={`${PRIVE.card} overflow-hidden ${stale ? "opacity-60" : ""}`} data-testid="prive-card">
      <Link to={`/prive/experiencia/${e.slug}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pv-gold)]">
        <PriveImage queries={imageQueries(e)} illustrative={e.image?.illustrative !== false} alt={e.name} className="aspect-[16/10]" linkCredit={false} />
        <div className="space-y-2 p-4">
          <p className={`text-[11px] tracking-[0.18em] ${PRIVE.gold}`}>{universeMeta(e.universe, lang)?.title}{e.neighborhood ? ` · ${e.neighborhood}` : ""}</p>
          <h3 className={`${PRIVE.serif} text-lg leading-tight`}>{e.name}</h3>
          {e.why && <p className={`line-clamp-2 text-sm ${PRIVE.muted}`}>{e.why}</p>}
          <div className="flex flex-wrap gap-1.5">
            <StateBadge state={e.state} verifiedAt={e.verified_at} />
            <LabelBadge e={e} />
            {e.age_policy && e.age_policy !== "todas" && <span className="rounded-full border border-[color:var(--pv-line)] px-2 py-0.5 text-[11px] text-[color:var(--pv-muted)]">{e.age_policy}</span>}
          </div>
          <p className={`text-xs ${PRIVE.muted}`}>{priceText(e, lang)}</p>
          {season && <p className="text-xs text-amber-300">{season}</p>}
          {stale && <p className="text-xs text-[color:var(--pv-muted)]">{t.catalog.stale}</p>}
        </div>
      </Link>
    </article>
  );
}
