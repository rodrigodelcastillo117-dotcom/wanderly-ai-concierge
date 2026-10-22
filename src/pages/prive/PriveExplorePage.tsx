// /prive/explorar — EXPLORE (Documento A Fase 3, Documento B §4): búsqueda universal, destinos por
// región (una a la vez, en carrusel, con índice compacto) y los doce universos. La región y la
// búsqueda viven en la URL (?region=europa&q=…): al volver de un destino se conserva el contexto.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
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
  const onRegion = (k: string) => { const n = new URLSearchParams(sp); n.set("region", k); setSp(n, { replace: true }); };
  return (
    <PriveTripProvider>
      <PriveCatalogShell loading={loading} locked={locked} error={error} back="/prive" backLabel={t.shell.forYou}>
        <div className="space-y-14 sm:space-y-20" data-testid="prive-explore">
          <header className="space-y-5">
            <BrandTitle as="h1" brand={t.explore.brand} sub={t.explore.title !== t.explore.brand ? t.explore.title : ""} note={t.explore.intro} />
            <UniversalSearch destinations={all} fallbackCities={fallback} variant="plain" />
          </header>
          {groups.length > 0 && (
            <section aria-labelledby="prive-regions" className="space-y-5">
              <BrandTitle id="prive-regions" brand={t.home.destinationsBrand} sub={t.browse.destinations !== t.home.destinationsBrand ? t.browse.destinations : ""} />
              <RegionTabs groups={groups} initialKey={sp.get("region")} onSelect={onRegion} />
            </section>
          )}
          <TwelveUniverses universes={data?.universes ?? []} />
        </div>
      </PriveCatalogShell>
    </PriveTripProvider>
  );
}
