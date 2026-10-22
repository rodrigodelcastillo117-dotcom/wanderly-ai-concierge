// Latest Issue: portada, índice configurable (doble página en escritorio) y reportajes del número vigente.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { BriefItem, Cover, FeatureGrid, IssueIndex, useOnline } from "@/components/prive/edition/Magazine";
import { MagazineReader } from "@/components/prive/edition/MagazineReader";
import { PriveLocked } from "@/components/prive/catalog/PriveLocked";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { hasEnoughContent, interestLabel, personalizeIssue, txt, type IssuePayload } from "@/lib/priveEdition";
import { editionText } from "@/lib/priveEditionI18n";

export function IssueView({ payload, lang, prefs, hrefFor, preview = false, memberName }: {
  payload: IssuePayload; lang: "es" | "en"; prefs: Parameters<typeof personalizeIssue>[1]; hrefFor: (slug: string) => string; preview?: boolean; memberName?: string | null;
}) {
  const T = editionText(lang);
  const ed = useMemo(() => personalizeIssue(payload, prefs), [payload, prefs]);
  const images = payload.images ?? {};
  const issue = payload.issue!;
  const letter = ed.sections.find((s) => s.key === "carta")?.articles[0];
  const features = ed.sections.filter((s) => ["portada", "reportajes", "agenda", "explicadores"].includes(s.key)).flatMap((s) => s.articles);
  const briefs = ed.sections.find((s) => s.key === "world_brief")?.articles ?? [];
  return (
    <div>
      <Cover issue={issue} images={images} lang={lang} coverImage={ed.coverImage} coverArticle={ed.cover} memberName={memberName}
        personalized={ed.personalized} preview={preview} readHref={ed.cover ? hrefFor(ed.cover.slug) : undefined} />
      <div className="mx-auto max-w-7xl px-4 sm:px-8 py-14">
        <div className="ped-spread">
          <div>
            {letter && (
              <section aria-labelledby="ped-letter">
                <p className="ped-kicker">{T.sections.carta}</p>
                <h2 id="ped-letter" className="ped-display text-4xl sm:text-5xl mt-2">{txt(letter.title, lang)}</h2>
                <p className="ped-dek mt-4">{txt(letter.dek, lang)}</p>
                <p className="mt-5 text-[1.12rem] leading-[1.7]" style={{ fontFamily: "var(--ped-text)", color: "var(--ped-body)" }}>
                  {(letter.body?.find((b) => b.t === "p") as { es: string; en?: string } | undefined)?.[lang === "en" ? "en" : "es"]}
                </p>
                <Link to={hrefFor(letter.slug)} className="ped-btn ghost mt-6">{T.continueReading}</Link>
              </section>
            )}
            {ed.uncovered.length > 0 && (
              <p className="ped-note context mt-8" role="note"><span className="lbl">My Edition</span>
                {T.mine.uncovered(ed.uncovered.map((k) => interestLabel(k, lang)).join(", "))}</p>
            )}
            <p className="ped-meta mt-8">
              {T.brand} · {T.issueNo(issue.number)} · {txt(issue.period_label, lang)}
              {issue.research_closed_at ? ` · ${lang === "en" ? "Research closed" : "Investigación cerrada"}: ${issue.research_closed_at}` : ""}
            </p>
          </div>
          <IssueIndex sections={ed.sections.filter((s) => s.key !== "oportunidades")} lang={lang} hrefFor={hrefFor} readingMinutes={ed.readingMinutes}
            moreTime={ed.moreTime} hiddenCount={ed.hidden.length}
            extra={!preview ? (
              <section className="mt-6" aria-label={T.sections.oportunidades}>
                <h3 className="ped-kicker">{T.sections.oportunidades}</h3>
                <Link to="/prive/edicion/oportunidades" className="ped-toc-item"><span className="n" aria-hidden="true">◆</span>
                  <span><span className="t">{T.opp.title}</span><span className="d">{T.opp.sub}</span></span><span /></Link>
              </section>
            ) : undefined} />
        </div>
        {features.length > 0 && (
          <section className="mt-16" aria-label={T.sections.reportajes}>
            <div className="ped-rule-c mb-8" />
            <FeatureGrid articles={features} images={images} lang={lang} hrefFor={hrefFor} preview={preview} />
          </section>
        )}
        {briefs.length > 0 && (
          <section className="mt-16 max-w-3xl" aria-labelledby="ped-wb">
            <p className="ped-kicker">{T.brief.sub}</p>
            <h2 id="ped-wb" className="ped-display text-4xl mt-2">{T.brief.title}</h2>
            {briefs.slice(0, 4).map((b) => <BriefItem key={b.slug} article={b} lang={lang} hrefFor={hrefFor} />)}
            {!preview && <Link to="/prive/edicion/briefing" className="ped-btn ghost mt-6">{T.nav.brief.brand}</Link>}
          </section>
        )}
      </div>
    </div>
  );
}

/** Vuelve de la vista continua al modo revista (predeterminado). */
export function MagazineSwitch({ lang, onClick }: { lang: "es" | "en"; onClick: () => void }) {
  const T = editionText(lang);
  return (
    <div className="flex justify-end px-4 sm:px-8 pt-3">
      <button type="button" className="ped-btn ghost !min-h-[44px] !px-4 !text-[0.66rem]" onClick={onClick} data-testid="mz-enter">
        <BookOpen className="h-4 w-4" aria-hidden="true" />{T.mz.magazine}
      </button>
    </div>
  );
}

/** El número en modo revista (portada, índice, pliegos…). */
export function IssueMagazine({ payload, startSlug, hrefFor, memberName }: {
  payload: IssuePayload; startSlug?: string | null; hrefFor: (slug: string) => string; memberName?: string | null;
}) {
  const { lang, prefs, saved, toggleSave, setView } = useEdition();
  const online = useOnline();
  const navigate = useNavigate();
  const ed = useMemo(() => personalizeIssue(payload, prefs), [payload, prefs]);
  return (
    <MagazineReader issue={payload.issue ?? null} ed={ed} images={payload.images ?? {}} lang={lang} startSlug={startSlug} offline={!online}
      isSaved={(s) => saved.has(s)} onToggleSave={(s) => void toggleSave(s)} memberName={memberName}
      personalizeHref="/prive/edicion/mi-edicion" opportunitiesHref="/prive/edicion/oportunidades"
      onExit={(slug) => { setView("continuous"); if (slug) navigate(hrefFor(slug)); }} />
  );
}

export default function LatestIssuePage() {
  const { issue: issueSlug } = useParams();
  const { issue: latest, lang, prefs, api, view, setView } = useEdition();
  const [other, setOther] = useState<IssuePayload | null>(null);
  const [locked, setLocked] = useState<null | string>(null);
  useEffect(() => {
    if (!issueSlug || issueSlug === latest?.issue?.slug) { setOther(null); return; }
    let alive = true;
    api.issue(issueSlug).then((p) => { if (alive) setOther(p); })
      .catch((e) => { if (alive && e instanceof PriveLockedError) setLocked(e.code); });
    return () => { alive = false; };
  }, [issueSlug, latest, api]);
  const T = editionText(lang);
  if (locked) return <PriveLocked code={locked as never} />;
  const payload = other ?? latest;
  if (!payload?.found || !payload.issue || !hasEnoughContent(payload)) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-24 text-center" data-testid="edition-empty">
        <p className="ped-masthead text-3xl text-[color:var(--ped-champagne)]">{T.brand}</p>
        <p className="ped-dek mt-6">{T.emptyIssue}</p>
      </section>
    );
  }
  const name = prefs.show_name_on_cover && prefs.first_name ? prefs.first_name : null;
  const hrefFor = (slug: string) => `/prive/edicion/articulo/${slug}${other ? `?numero=${payload.issue!.slug}` : ""}`;
  if (view === "magazine") return <IssueMagazine key={payload.issue.slug} payload={payload} hrefFor={hrefFor} memberName={name} />;
  return (
    <>
      <MagazineSwitch lang={lang} onClick={() => setView("magazine")} />
      <IssueView payload={payload} lang={lang} prefs={prefs} memberName={name} hrefFor={hrefFor} />
    </>
  );
}
