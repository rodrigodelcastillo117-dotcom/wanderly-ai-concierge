// THE WORLD BRIEF: hechos recientes, fechados y con fuente (los vencidos salen solos, en el servidor).
import { useEffect, useState } from "react";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { BriefItem } from "@/components/prive/edition/Magazine";
import { PriveLocked } from "@/components/prive/catalog/PriveLocked";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import type { BriefPayload } from "@/lib/priveEditionApi";
import { formatDate } from "@/lib/priveEdition";
import { editionText } from "@/lib/priveEditionI18n";

export default function WorldBriefPage() {
  const { api, lang, prefs } = useEdition();
  const T = editionText(lang);
  const [data, setData] = useState<BriefPayload | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.worldBrief().then((d) => { if (alive) setData(d); })
      .catch((e) => { if (!alive) return; if (e instanceof PriveLockedError) setLocked(e.code); else setFailed(true); });
    return () => { alive = false; };
  }, [api]);
  if (locked) return <PriveLocked code={locked as never} />;
  const items = (data?.items ?? []).filter((a) => !a.topics.some((t) => prefs.excluded.includes(t)));
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-8 py-10">
      <p className="ped-kicker">{T.brief.sub}</p>
      <h1 className="ped-display text-5xl sm:text-6xl mt-2">{T.brief.title}</h1>
      <p className="ped-dek mt-4">{T.brief.intro}</p>
      {data && <p className="ped-meta mt-3">{T.factAsOf(formatDate(data.today, lang))}{data.expired_count ? ` · ${T.brief.expired(data.expired_count)}` : ""}</p>}
      <div className="ped-rule mt-6" />
      {failed && <p role="alert" className="mt-6 text-amber-300">{T.loadError}</p>}
      {data && items.length === 0 && <p className="ped-dek mt-8" data-testid="brief-empty">{T.brief.empty}</p>}
      {items.map((a) => <BriefItem key={a.slug} article={a} lang={lang} hrefFor={(s) => `/prive/edicion/articulo/${s}`} />)}
    </div>
  );
}
