// PRIVÉ OPPORTUNITIES = PRIVÉ DROPS (equipo privevalor). Solo oportunidades verificables, con fuente y
// vigencia; las vencidas no se muestran. Sin datos: cero honesto.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { useOnline } from "@/components/prive/edition/Magazine";
import { PriveLocked } from "@/components/prive/catalog/PriveLocked";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { effectiveWeights, formatDate, liveOpportunities, txt, type Opportunity } from "@/lib/priveEdition";
import type { OpportunitiesPayload } from "@/lib/priveEditionApi";
import { editionText } from "@/lib/priveEditionI18n";

export function OpportunityCard({ o, lang, offline }: { o: Opportunity; lang: "es" | "en"; offline: boolean }) {
  const T = editionText(lang);
  return (
    <article className="ped-panel" data-testid="opportunity" data-slug={o.slug}>
      <p className="ped-kicker">{o.provider.name}{o.destination ? ` · ${lang === "en" ? o.destination.en ?? o.destination.es : o.destination.es}` : ""}</p>
      <h3 className="ped-display text-2xl mt-2">{txt(o.title, lang)}</h3>
      <p className="mt-2" style={{ fontFamily: "var(--ped-text)" }}>{txt(o.benefit, lang)}</p>
      {o.conditions?.es && <p className="ped-meta mt-2"><strong>{T.opp.conditions}:</strong> {txt(o.conditions, lang)}</p>}
      {o.eligibility?.es && <p className="ped-meta mt-1"><strong>{T.opp.eligibility}:</strong> {txt(o.eligibility, lang)}</p>}
      <p className="ped-meta mt-2">
        {o.valid_until ? `${T.opp.validUntil} ${formatDate(o.valid_until, lang)} · ` : ""}{T.opp.verified} {formatDate(o.last_verified_at, lang)}
        {o.relationship ? ` · ${T.opp.relationship[o.relationship] ?? o.relationship}` : ""}
      </p>
      <p className="ped-meta mt-1">{T.opp.source}: <a className="ped-link" href={o.source.url} target="_blank" rel="noopener noreferrer">{o.source.name ?? new URL(o.source.url).hostname}</a></p>
      <a className="ped-act mt-4" href={offline ? undefined : o.link} target="_blank" rel="noopener noreferrer" aria-disabled={offline || undefined}>
        {T.opp.provider}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </article>
  );
}

export default function OpportunitiesPage() {
  const { api, lang, prefs } = useEdition();
  const online = useOnline();
  const T = editionText(lang);
  const [data, setData] = useState<OpportunitiesPayload | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    // Sin filtrar por intereses en el servidor: un interés no elegido no debe esconder una oferta real.
    // Los intereses solo ordenan (primero lo que coincide con tu edición).
    api.opportunities({}).then((d) => { if (alive) setData(d); })
      .catch((e) => { if (!alive) return; if (e instanceof PriveLockedError) setLocked(e.code); else setFailed(true); });
    return () => { alive = false; };
  }, [api, prefs]);
  if (locked) return <PriveLocked code={locked as never} />;
  const weights = effectiveWeights(prefs);
  const rel = (o: Opportunity) => (o.interests ?? []).reduce((n, k) => n + (weights[k] ?? 0), 0);
  const items = liveOpportunities(data?.items).map((o, i) => ({ o, i })).sort((a, b) => rel(b.o) - rel(a.o) || a.i - b.i).map((x) => x.o);
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-8 py-10">
      <p className="ped-kicker">{T.opp.sub}</p>
      <h1 className="ped-display text-5xl sm:text-6xl mt-2">{T.opp.title}</h1>
      <p className="ped-dek mt-4 max-w-3xl">{T.opp.intro}</p>
      {data?.generated_at && <p className="ped-meta mt-3">{T.opp.asOf(formatDate(data.generated_at, lang))}</p>}
      <div className="ped-rule mt-6" />
      {failed && <p role="alert" className="mt-6 text-amber-300">{T.loadError}</p>}
      {data && !data.available && <p className="ped-dek mt-8" data-testid="opp-unavailable">{T.opp.unavailable}</p>}
      {data?.available && items.length === 0 && <p className="ped-dek mt-8" data-testid="opp-none">{T.opp.none}</p>}
      <div className="grid gap-5 sm:grid-cols-2 mt-8">
        {items.map((o) => <OpportunityCard key={o.id} o={o} lang={lang} offline={!online} />)}
      </div>
    </div>
  );
}
