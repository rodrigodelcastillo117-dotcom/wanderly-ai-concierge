// /prive/insider y /prive/insider/:destino — THE INSIDER'S NOTEBOOK. El índice abre con BEFORE YOU GO del
// próximo viaje real (si existe) y los cuadernos por destino; cada consejo con fuente y fecha de revisión.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";
import { BeforeYouGo } from "@/components/prive/value/BeforeYouGo";
import { InsiderTipCard } from "@/components/prive/value/InsiderTipCard";
import { BrandTitle } from "@/components/prive/value/ValueUi";
import { groupByCategory, localToday, type InsiderIndex, type InsiderPage, type TipCategory } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { formatValueDate, useValueText } from "@/lib/priveValueI18n";

export default function PriveInsiderPage() {
  const { destino } = useParams();
  return destino ? <Notebook slug={destino} /> : <Index />;
}

function Index() {
  const api = usePriveValue();
  const t = useValueText();
  const { data, loading, locked, error } = usePriveLoad<InsiderIndex>(() => api.insiderIndex(), [api]);
  useEffect(() => { if (data) void api.track("insider_view", { surface: "insider" }); }, [api, data]);
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error ? t.common.error : null} backLabel={t.common.back}>
      <div className="space-y-10">
        <BrandTitle as="h1" name={t.brand.insider.name} sub={t.brand.insider.sub} />
        <p className="max-w-3xl text-sm prive-muted">{t.insider.intro}</p>
        <BeforeYouGo />
        <section aria-labelledby="prive-insider-dests" className="space-y-4">
          <h2 id="prive-insider-dests" className="prive-serif text-2xl">{t.insider.destinations}</h2>
          {data?.destinations.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="prive-insider-index">
              {data.destinations.map((d) => (
                <li key={d.slug}>
                  <Link to={`/prive/insider/${d.slug}`} className="prive-panel flex min-h-[132px] flex-col justify-between gap-3 p-5 transition-colors hover:border-[color:var(--pv-line-strong)]">
                    <span className="prive-serif text-2xl">{t.lang === "en" ? d.en : d.es}</span>
                    <span className="text-xs prive-muted">{t.insider.tips(d.tips)} · {t.common.checked(formatValueDate(d.last_checked, t.lang))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm prive-muted" role="status">{t.insider.empty}</p>}
        </section>
      </div>
    </PriveCatalogShell>
  );
}

function Notebook({ slug }: { slug: string }) {
  const api = usePriveValue();
  const t = useValueText();
  const { data, loading, locked, error } = usePriveLoad<InsiderPage>(() => api.insider(slug), [api, slug]);
  useEffect(() => { if (data?.found) void api.track("insider_view", { destination: slug, surface: "insider" }); }, [api, data, slug]);
  const today = localToday();
  const tips = (data?.tips ?? []).filter((x) => !x.valid_until || x.valid_until >= today);
  // Una sola rejilla (en escritorio no se desperdicia el ancho); las categorías filtran, no apilan secciones.
  const groups = groupByCategory(tips);
  const cats = groups.map(([c]) => c);
  const [cat, setCat] = useState<TipCategory | null>(null);
  const shown = groups.filter(([c]) => !cat || c === cat).flatMap(([, list]) => list);
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error ? t.common.error : null} back="/prive/insider" backLabel={t.brand.insider.name}>
      {!data?.found || !data.destination ? (
        <p className="text-sm prive-muted" role="status">{t.insider.notFound}</p>
      ) : (
        <div className="space-y-8">
          <BrandTitle as="h1" eyebrow={t.brand.insider.name} name={t.lang === "en" ? data.destination.en : data.destination.es} sub={t.brand.insider.sub} />
          {tips.length === 0 ? <p className="prive-panel p-5 text-sm prive-muted" role="status">{t.insider.empty}</p> : null}
          {cats.length > 1 ? (
            <nav aria-label={t.brand.insider.name} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              <CatChip on={!cat} onClick={() => setCat(null)}>{t.common.all}</CatChip>
              {cats.map((c) => <CatChip key={c} on={cat === c} onClick={() => setCat(c)}>{t.tipCategory[c]}</CatChip>)}
            </nav>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="prive-insider-tips">
            {shown.map((tip) => <InsiderTipCard key={tip.id} tip={tip} trips={data.trips ?? []} api={api} lang={t.lang} t={t} />)}
          </div>
        </div>
      )}
    </PriveCatalogShell>
  );
}

function CatChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-xs tracking-[0.06em] transition-colors ${
        on ? "border-[color:var(--pv-gold)] bg-[color:var(--pv-gold)] text-[#0a0906] font-semibold" : "border-[color:var(--pv-line-strong)] prive-champagne hover:bg-[rgba(201,169,97,0.08)]"}`}>
      {children}
    </button>
  );
}
