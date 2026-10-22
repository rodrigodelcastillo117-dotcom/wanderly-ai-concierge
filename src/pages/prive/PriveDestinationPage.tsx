import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePriveCatalog, type PriveUniverse } from "@/lib/priveCatalogApi";
import { universesView } from "@/lib/priveCatalogView";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { displayName } from "@/lib/priveBrowse";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { ShowMore } from "@/components/prive/catalog/ShowMore";
import { AgeGate } from "@/components/prive/catalog/AgeGate";
import { ExperienceCard } from "@/components/prive/catalog/ExperienceCard";
import { ExperiencePlanner } from "@/components/prive/catalog/ExperiencePlanner";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PriveImage } from "@/components/prive/catalog/PriveImage";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";

/** /prive/destino/:slug — selección de un destino por universo, con cobertura calculada y planner. */
export default function PriveDestinationPage() {
  const api = usePriveCatalog();
  const t = usePriveT();
  const lang = usePriveLang();
  const C = t.catalog;
  const { slug = "" } = useParams();
  const { data, loading, locked, setLocked, error, reload } = usePriveLoad(() => api.destination(slug), [slug]);
  const [filter, setFilter] = useState<PriveUniverse | "all">("all");
  const exps = useMemo(() => data?.experiences ?? [], [data]);
  const present = universesView(lang).filter((u) => exps.some((e) => e.universe === u.key));
  const shown = filter === "all" ? exps : exps.filter((e) => e.universe === filter);
  const d = data?.destination;
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}>
      {!data?.found || !d ? (
        <p className={PRIVE.muted} role="status">{C.destNotFound}</p>
      ) : (
        <div className="space-y-6">
          <header className="space-y-3">
            {/* Portada: la consulta curada del destino primero; "<name_en> skyline" del servidor queda de último
                recurso (para islas, valles o barrios no traía nada útil). */}
            <PriveImage queries={[...destinationPhotoQueries(d.slug, d.name), d.cover_query ?? `${d.name_en ?? d.name} skyline`]}
              alt={t.common.photoAlt(lang === "en" ? d.name_en ?? d.name : d.name)} label={lang === "en" ? d.name_en ?? d.name : d.name}
              className="aspect-[4/3] sm:aspect-[21/9] rounded-2xl" eager />
            <p className={`text-[11px] tracking-[0.2em] ${PRIVE.gold}`}>{d.parent ? `${displayName(d.parent, lang)} · ` : ""}{d.admin_area ?? ""}</p>
            <h1 className={`${PRIVE.serif} text-4xl`}>{lang === "en" ? d.name_en ?? d.name : d.name}</h1>
            <p className={`text-sm ${PRIVE.muted}`} data-testid="prive-coverage">{data.coverage ? t.browse.coverage[data.coverage.level] : ""}</p>
            {d.neighborhoods?.length ? (
              <p className={`text-xs ${PRIVE.muted}`}>{C.neighborhoods}: {d.neighborhoods.map((n, i) => (
                <span key={n.slug}>{i ? " · " : ""}<Link className="underline-offset-2 hover:underline" to={`/prive/destino/${n.slug}`}>{n.name}</Link></span>))}</p>
            ) : null}
          </header>
          <AgeGate count={data.age_locked_count ?? 0} termsVersion={(data as { adult_terms_version?: string }).adult_terms_version ?? ""} onConfirmed={reload} />
          {exps.length === 0 ? (
            <p className={`${PRIVE.card} p-5 text-sm ${PRIVE.muted}`} role="status">
              {C.destEmpty(lang === "en" ? d.name_en ?? d.name : d.name)}
            </p>
          ) : (
            <>
              <nav aria-label={C.universesAria} className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setFilter("all")} aria-pressed={filter === "all"} className={`rounded-full px-3 py-1 text-xs ${filter === "all" ? PRIVE.button : PRIVE.ghost}`}>{C.all}</button>
                {present.map((u) => (
                  <button type="button" key={u.key} onClick={() => setFilter(u.key)} aria-pressed={filter === u.key}
                    className={`rounded-full px-3 py-1 text-xs ${filter === u.key ? PRIVE.button : PRIVE.ghost}`}>{u.title}</button>
                ))}
              </nav>
              <ShowMore items={shown} resetKey={`${slug}|${filter}`} render={(e) => <ExperienceCard key={e.id} e={e} />} />
              <ExperiencePlanner experiences={exps} timeZone={d.timezone} onLocked={setLocked} />
            </>
          )}
        </div>
      )}
    </PriveCatalogShell>
  );
}
