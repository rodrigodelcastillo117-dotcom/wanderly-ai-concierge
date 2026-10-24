// /prive/explorar — EXPLORE: descubrir a dónde ir (dueño, 23-oct-2026: "EXPLORE y FOR YOU hacían lo mismo";
// "Para ti" queda 100 % personal y aquí van dos cosas nuevas). Tres pestañas arriba:
//   Mapa      "¿A dónde ir en <mes>?": destinos del catálogo en un mapa con su clima típico, eventos con
//             fecha y horas de vuelo estimadas (WhenToGo, carga diferida).
//   Ruleta    la ruleta de inspiración: ánimo + presupuesto (+ mes) → destinos sorpresa; "Me late" guarda
//             en Ideas (InspirationRoulette, carga diferida).
//   Catálogo  lo de siempre, ahora secundario: búsqueda universal, destinos por región y los doce universos.
// La pestaña, la región, el mes y la búsqueda viven en la URL (?vista=mapa|ruleta|catalogo&region=…&q=…&mes=…):
// al volver de un destino se conserva el contexto. Con ?region o ?q (enlaces de antes) abre el Catálogo.
import { lazy, Suspense, useMemo, useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import "@/components/prive/explore/explore.css";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { browsable, featuredDestinations, groupByRegion } from "@/lib/priveBrowse";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";
import { RegionTabs } from "@/components/prive/catalog/DestinationBrowser";
import { UniversalSearch } from "@/components/prive/home/UniversalSearch";
import { TwelveUniverses } from "@/components/prive/home/sections";
import { BrandTitle } from "@/components/prive/home/BrandTitle";
import { PriveTripProvider } from "@/components/prive/home/context";
import { usePriveT } from "@/components/prive/PriveLang";
import { SlowLoading } from "@/components/brand/SlowLoading";

const WhenToGo = lazy(() => import("@/components/prive/explore/WhenToGo"));
const InspirationRoulette = lazy(() => import("@/components/prive/explore/InspirationRoulette"));

export type ExploreView = "mapa" | "ruleta" | "catalogo";
const VIEWS: ExploreView[] = ["mapa", "ruleta", "catalogo"];

export function exploreView(sp: URLSearchParams): ExploreView {
  const v = sp.get("vista");
  if (v === "mapa" || v === "ruleta" || v === "catalogo") return v;
  return sp.get("region") || sp.get("q") ? "catalogo" : "mapa";
}

export default function PriveExplorePage() {
  const api = usePriveCatalog();
  const t = usePriveT();
  const [sp, setSp] = useSearchParams();
  const { data, loading, locked, error } = usePriveLoad(() => api.home(), []);
  const all = useMemo(() => data?.destinations ?? [], [data]);
  const list = useMemo(() => browsable(all), [all]);
  const groups = useMemo(() => {
    const featured = featuredDestinations(list, 8);
    return [...(featured.length ? [{ key: "destacados", items: featured }] : []), ...groupByRegion(list)];
  }, [list]);
  const fallback = useMemo(() => featuredDestinations(list, 5).map((d) => d.slug), [list]);
  const view = exploreView(sp);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const setView = (v: ExploreView, focus = false) => {
    const n = new URLSearchParams(sp);
    n.set("vista", v);
    setSp(n, { replace: true });
    if (focus) tabs.current[VIEWS.indexOf(v)]?.focus();
  };
  const onRegion = (k: string) => { const n = new URLSearchParams(sp); n.set("region", k); n.set("vista", "catalogo"); setSp(n, { replace: true }); };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = VIEWS.indexOf(view);
    const to = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
    if (to < 0) return;
    e.preventDefault();
    setView(VIEWS[to], true);
  };
  const label: Record<ExploreView, [string, string]> = {
    mapa: [t.explore.tabMap, t.explore.tabMapSub], ruleta: [t.explore.tabRoulette, t.explore.tabRouletteSub], catalogo: [t.explore.tabCatalog, t.explore.tabCatalogSub],
  };
  const loadingPanel = (
    <SlowLoading active size="lg" className="min-h-[50vh] items-center" srLabel={t.common.loading}>
      <div className="min-h-[50vh]" role="status" aria-label={t.common.loading} />
    </SlowLoading>
  );

  return (
    <PriveTripProvider>
      <PriveCatalogShell loading={loading} locked={locked} error={error} back="/prive" backLabel={t.shell.forYou}>
        <div className="space-y-8 sm:space-y-10" data-testid="prive-explore" data-view={view}>
          <header className="space-y-5">
            <BrandTitle as="h1" brand={t.explore.brand} sub={t.explore.title !== t.explore.brand ? t.explore.title : ""} note={t.explore.intro} />
            <div role="tablist" aria-label={t.explore.tabsLabel} className="pv-x-tabs" data-testid="prive-explore-tabs">
              {VIEWS.map((v, i) => (
                <button key={v} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`pv-x-tab-${v}`} aria-controls={`pv-x-panel-${v}`}
                  aria-selected={view === v} tabIndex={view === v ? 0 : -1} className="pv-x-tab" onClick={() => setView(v)} onKeyDown={onTabKey}>
                  <b>{label[v][0]}</b><small>{label[v][1]}</small>
                </button>
              ))}
            </div>
          </header>
          <div role="tabpanel" id={`pv-x-panel-${view}`} aria-labelledby={`pv-x-tab-${view}`}>
            {view === "mapa" && <Suspense fallback={loadingPanel}><WhenToGo destinations={all} /></Suspense>}
            {view === "ruleta" && <Suspense fallback={loadingPanel}><InspirationRoulette /></Suspense>}
            {view === "catalogo" && (
              <div className="space-y-14 sm:space-y-20" data-testid="prive-explore-catalog">
                <UniversalSearch destinations={all} fallbackCities={fallback} variant="plain" />
                {groups.length > 0 && (
                  <section aria-labelledby="prive-regions" className="space-y-5">
                    <BrandTitle id="prive-regions" brand={t.home.destinationsBrand} sub={t.browse.destinations !== t.home.destinationsBrand ? t.browse.destinations : ""} />
                    <RegionTabs groups={groups} initialKey={sp.get("region")} onSelect={onRegion} />
                  </section>
                )}
                <TwelveUniverses universes={data?.universes ?? []} />
              </div>
            )}
          </div>
        </div>
      </PriveCatalogShell>
    </PriveTripProvider>
  );
}
