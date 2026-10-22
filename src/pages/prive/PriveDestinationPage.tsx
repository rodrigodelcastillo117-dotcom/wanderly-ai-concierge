import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { KeyRound, Sparkles } from "lucide-react";
import { usePriveCatalog, type PriveUniverse } from "@/lib/priveCatalogApi";
import { universesView } from "@/lib/priveCatalogView";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { displayName, placeLine } from "@/lib/priveBrowse";
import { askIatoHref } from "@/lib/priveLinks";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { ShowMore } from "@/components/prive/catalog/ShowMore";
import { AgeGate } from "@/components/prive/catalog/AgeGate";
import { ExperienceCard } from "@/components/prive/catalog/ExperienceCard";
import { ExperiencePlanner } from "@/components/prive/catalog/ExperiencePlanner";
import { MoreInDestination } from "@/components/prive/catalog/MoreInDestination";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /prive/destino/:slug — portada del destino con su foto, relación geográfica y accesos a Iato y a
 * The Privé Key; "Para tus fechas" (prive_for_you con ?desde/&hasta del viaje); selección por universo
 * con el filtro en la URL (?u=…) para volver al mismo punto; planificador. Cobertura solo si advierte.
 */
export default function PriveDestinationPage() {
  const api = usePriveCatalog();
  const t = usePriveT();
  const lang = usePriveLang();
  const C = t.catalog;
  const { slug = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const { data, loading, locked, setLocked, error, reload } = usePriveLoad(() => api.destination(slug), [slug]);
  const exps = useMemo(() => data?.experiences ?? [], [data]);
  const present = universesView(lang).filter((u) => exps.some((e) => e.universe === u.key));
  const filter = (present.some((u) => u.key === sp.get("u")) ? sp.get("u") : "all") as PriveUniverse | "all";
  const setFilter = (u: PriveUniverse | "all") => {
    const n = new URLSearchParams(sp);
    if (u === "all") n.delete("u"); else n.set("u", u);
    setSp(n, { replace: true });
  };
  const shown = filter === "all" ? exps : exps.filter((e) => e.universe === filter);
  const d = data?.destination;
  const from = ISO.test(sp.get("desde") ?? "") ? sp.get("desde") : null;
  const to = ISO.test(sp.get("hasta") ?? "") ? sp.get("hasta") : null;
  const name = d ? (lang === "en" ? d.name_en ?? d.name : d.name) : "";
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error} back="/prive/explorar" backLabel={t.shell.explore}>
      {!data?.found || !d ? (
        <p className={PRIVE.muted} role="status">{C.destNotFound}</p>
      ) : (
        <div className="space-y-10">
          <header className="prive-dest-hero" data-testid="prive-dest-hero">
            {/* Portada: la consulta curada del destino primero; "<name_en> skyline" del servidor queda de último
                recurso (para islas, valles o barrios no traía nada útil). */}
            <PrivePhoto queries={[...destinationPhotoQueries(d.slug, d.name), d.cover_query ?? `${d.name_en ?? d.name} skyline`]}
              alt={t.common.photoAlt(name)} label={name} eager className="prive-veil prive-dest-hero-photo" creditLinks creditClassName="is-hero">
              <div className="absolute inset-x-0 bottom-0 z-[2] p-6 sm:p-10">
                <p className={`text-[11px] tracking-[0.24em] uppercase ${PRIVE.gold}`}>{placeLine(d.slug, lang) || d.admin_area}</p>
                <h1 className="prive-display text-5xl sm:text-7xl mt-2">{name}</h1>
                {d.intro && <p className="prive-champagne max-w-2xl mt-3 text-sm sm:text-base">{d.intro}</p>}
              </div>
            </PrivePhoto>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/prive/key?destino=${d.slug}`} className="prive-btn prive-btn-gold"><KeyRound className="w-4 h-4" aria-hidden="true" />{t.home.nextNight}</Link>
            <Link to={askIatoHref(t.exp.askAbout(name, null))} className="prive-btn prive-btn-ghost"><Sparkles className="w-4 h-4" aria-hidden="true" />{t.home.askIato}</Link>
          </div>
          {data.coverage && (data.coverage.level === "SIN_COBERTURA_VERIFICADA" || data.coverage.level === "DESCUBRIMIENTO_BAJO_DEMANDA") && (
            <p className={`text-sm ${PRIVE.muted}`} data-testid="prive-coverage">{t.browse.coverage[data.coverage.level]}</p>
          )}
          {d.neighborhoods?.length ? (
            <p className={`text-xs ${PRIVE.muted}`}>{C.neighborhoods}: {d.neighborhoods.map((n, i) => (
              <span key={n.slug}>{i ? " · " : ""}<Link className="underline-offset-2 hover:underline" to={`/prive/destino/${n.slug}`}>{displayName(n, lang)}</Link></span>))}</p>
          ) : null}
          {(from || to) && exps.length > 0 && (
            <MoreInDestination id="para-tus-fechas" slug={d.slug} city={name} from={from} to={to} title={t.home.nextForDates} />
          )}
          <AgeGate count={data.age_locked_count ?? 0} termsVersion={(data as { adult_terms_version?: string }).adult_terms_version ?? ""} onConfirmed={reload} />
          {exps.length === 0 ? (
            <p className={`${PRIVE.card} p-5 text-sm ${PRIVE.muted}`} role="status">{C.destEmpty(name)}</p>
          ) : (
            <>
              <nav aria-label={C.universesAria} className="prive-chip-row">
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
