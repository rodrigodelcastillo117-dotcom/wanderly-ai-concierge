// "Tus ideas" en Para ti: los destinos que a la persona le latieron en la ruleta de Explorar (prive_ideas, con
// sesión Privé). Es personal: sin ideas, invita a la ruleta; nunca rellena con destinos genéricos.
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { useIdeas } from "@/components/prive/explore/useIdeas";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { universeMeta } from "@/lib/priveCatalogView";
import { BrandTitle } from "./BrandTitle";

const planHref = (name: string) => `/dashboard/planear?destino=${encodeURIComponent(name)}`;

export function PersonalIdeas() {
  const t = usePriveT();
  const lang = usePriveLang();
  const { ideas, save } = useIdeas();
  if (ideas === null) return null;
  return (
    <section aria-labelledby="prive-ideas" className="space-y-4" data-testid="prive-ideas">
      <BrandTitle id="prive-ideas" brand={t.personal.ideasTitle} note={t.personal.ideasSub} small />
      {ideas.length === 0 ? (
        <div className="prive-panel p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm prive-muted max-w-md">{t.personal.ideasEmpty}</p>
          <Link to="/prive/explorar?vista=ruleta" className="prive-btn prive-btn-ghost"><Sparkles className="w-4 h-4" aria-hidden="true" />{t.personal.tryRoulette}</Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="prive-ideas-list">
          {ideas.slice(0, 8).map((i) => {
            const name = lang === "en" && i.name_en ? i.name_en : i.name;
            const mood = i.universe ? universeMeta(i.universe, lang)?.name ?? null : null;
            const month = i.month ? t.map.months[i.month - 1] : null;
            return (
              <li key={i.slug} className="relative">
                <Link to={`/prive/destino/${i.slug}`} className="prive-dest-card" aria-label={name}>
                  <PrivePhoto queries={destinationPhotoQueries(i.slug, i.name)} alt={t.common.photoAlt(name)} label={name} className="prive-veil aspect-[4/5]" creditClassName="is-inline">
                    <div className="prive-dest-meta">
                      {(mood || month) && <p className="text-[10px] tracking-[0.2em] uppercase prive-gold">{t.personal.ideaMeta(mood, month)}</p>}
                      <p className="prive-serif text-xl leading-tight mt-1">{name}</p>
                    </div>
                  </PrivePhoto>
                </Link>
                <div className="flex items-center justify-between gap-2 px-1 pt-2">
                  <Link to={planHref(name)} className="prive-chip-btn">{t.personal.planIdea}</Link>
                  <button type="button" className="prive-chip-btn" aria-label={t.personal.removeIdea(name)} onClick={() => void save(i.slug, false).catch(() => undefined)}>
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Acceso claro a Explorar desde Para ti (lo genérico vive allá). */
export function ExploreAccess() {
  const t = usePriveT();
  return (
    <Link to="/prive/explorar" className="prive-panel group flex items-center justify-between gap-4 p-5 sm:p-6 hover:border-[color:var(--pv-line-strong)]" data-testid="prive-explore-access">
      <span className="min-w-0">
        <span className="block prive-serif text-2xl sm:text-3xl leading-tight">{t.personal.exploreWorld}</span>
        <span className="block text-xs prive-muted mt-1">{t.personal.exploreWorldSub}</span>
      </span>
      <ArrowRight className="w-5 h-5 prive-gold flex-none transition-transform group-hover:translate-x-1" aria-hidden="true" />
    </Link>
  );
}
