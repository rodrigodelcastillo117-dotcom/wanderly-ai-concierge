import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePriveCatalog, type PriveUniverse } from "@/lib/priveCatalogApi";
import { COVERAGE_TEXT, UNIVERSES } from "@/lib/priveCatalogView";
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
  const { slug = "" } = useParams();
  const { data, loading, locked, setLocked, error, reload } = usePriveLoad(() => api.destination(slug), [slug]);
  const [filter, setFilter] = useState<PriveUniverse | "all">("all");
  const exps = useMemo(() => data?.experiences ?? [], [data]);
  const present = UNIVERSES.filter((u) => exps.some((e) => e.universe === u.key));
  const shown = filter === "all" ? exps : exps.filter((e) => e.universe === filter);
  const d = data?.destination;
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}>
      {!data?.found || !d ? (
        <p className={PRIVE.muted} role="status">No encontramos ese destino en el catálogo de IATOS Privé.</p>
      ) : (
        <div className="space-y-6">
          <header className="space-y-3">
            <PriveImage queries={[d.cover_query ?? `${d.name_en ?? d.name} skyline`]} alt={d.name} className="aspect-[21/9] rounded-2xl" />
            <p className={`text-[11px] tracking-[0.2em] ${PRIVE.gold}`}>{d.parent ? `${d.parent.name} · ` : ""}{d.admin_area ?? ""}</p>
            <h1 className={`${PRIVE.serif} text-4xl`}>{d.name}</h1>
            <p className={`text-sm ${PRIVE.muted}`} data-testid="prive-coverage">{data.coverage ? COVERAGE_TEXT[data.coverage.level] : ""}</p>
            {d.neighborhoods?.length ? (
              <p className={`text-xs ${PRIVE.muted}`}>Barrios: {d.neighborhoods.map((n, i) => (
                <span key={n.slug}>{i ? " · " : ""}<Link className="underline-offset-2 hover:underline" to={`/prive/destino/${n.slug}`}>{n.name}</Link></span>))}</p>
            ) : null}
          </header>
          <AgeGate count={data.age_locked_count ?? 0} termsVersion={(data as { adult_terms_version?: string }).adult_terms_version ?? ""} onConfirmed={reload} />
          {exps.length === 0 ? (
            <p className={`${PRIVE.card} p-5 text-sm ${PRIVE.muted}`} role="status">
              Aún no tenemos experiencias verificadas en {d.name}. No mostramos lugares sin fuente: cuando la curaduría termine, aparecerán aquí.
            </p>
          ) : (
            <>
              <nav aria-label="Universos" className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setFilter("all")} aria-pressed={filter === "all"} className={`rounded-full px-3 py-1 text-xs ${filter === "all" ? PRIVE.button : PRIVE.ghost}`}>Todo</button>
                {present.map((u) => (
                  <button type="button" key={u.key} onClick={() => setFilter(u.key)} aria-pressed={filter === u.key}
                    className={`rounded-full px-3 py-1 text-xs ${filter === u.key ? PRIVE.button : PRIVE.ghost}`}>{u.title}</button>
                ))}
              </nav>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((e) => <ExperienceCard key={e.id} e={e} />)}
              </div>
              <ExperiencePlanner experiences={exps} timeZone={d.timezone} onLocked={setLocked} />
            </>
          )}
        </div>
      )}
    </PriveCatalogShell>
  );
}
