// BEFORE YOU GO: las cinco cosas que conviene saber antes de llegar, para el próximo viaje REAL del miembro
// (o el viaje que se indique). Sin viaje con destino conocido, no se pinta nada (no se inventa un viaje).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { beforeYouGoIsNear, topFive, type BeforeYouGoData } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { useValueText, type ValueLang } from "@/lib/priveValueI18n";
import { BrandTitle } from "./ValueUi";
import { InsiderTipCard } from "./InsiderTipCard";

export function BeforeYouGo({ tripId = null, onlyWhenNear = false, lang }: { tripId?: string | null; onlyWhenNear?: boolean; lang?: ValueLang }) {
  const api = usePriveValue();
  const t = useValueText(lang);
  const [data, setData] = useState<BeforeYouGoData | null>(null);
  useEffect(() => {
    let alive = true;
    api.beforeYouGo(tripId).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive && !(e instanceof PriveLockedError)) setData(null); });
    return () => { alive = false; };
  }, [api, tripId]);
  useEffect(() => {
    if (data?.trip) void api.track("before_you_go_view", { ref: data.trip.id, destination: data.destination?.slug ?? null, surface: "insider" });
  }, [api, data?.trip, data?.destination?.slug]);
  if (!data?.trip || !data.destination) return null;
  if (onlyWhenNear && !beforeYouGoIsNear(data)) return null;
  const tips = topFive(data.tips);
  const place = t.lang === "en" ? data.destination.en : data.destination.es;
  const days = data.trip.days_until ?? 0;
  return (
    <section aria-labelledby="prive-byg" className="space-y-4" data-testid="prive-before-you-go">
      <BrandTitle id="prive-byg" name={t.brand.byg.name} sub={t.brand.byg.sub} eyebrow={t.insider.bygFor(place, days)} />
      {tips.length === 0 ? (
        <p className="prive-panel p-5 text-sm prive-muted" role="status">{t.insider.bygEmpty}</p>
      ) : (
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tips.map((tip, i) => (
            <li key={tip.id}><InsiderTipCard tip={tip} index={i} trips={[{ id: data.trip!.id, destino: data.trip!.destino, fecha_salida: data.trip!.fecha_salida, destination_slug: data.destination!.slug }]} api={api} lang={t.lang} t={t} /></li>
          ))}
        </ol>
      )}
      <Link to={`/prive/insider/${data.destination.slug}`} className="prive-link inline-flex min-h-[44px] items-center text-sm">{t.insider.bygOpen}</Link>
    </section>
  );
}
