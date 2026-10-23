// Un artículo de la revista. Primero del número ya cargado; si no está (otro número, enlace guardado), del
// servidor (prive_edition_article), que también avisa si fue retirado.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { ArticleView, useOnline } from "@/components/prive/edition/Magazine";
import { MagazineReader } from "@/components/prive/edition/MagazineReader";
import { IssueMagazine, MagazineSwitch } from "./LatestIssuePage";
import { PriveLocked } from "@/components/prive/catalog/PriveLocked";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { formatDate, personalizeIssue, txt, type EditionArticle, type EditionImage } from "@/lib/priveEdition";
import type { ArticlePayload } from "@/lib/priveEditionApi";
import { editionText } from "@/lib/priveEditionI18n";

export default function ArticlePage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const { issue, lang, prefs, api, saved, toggleSave, view, setView } = useEdition();
  const online = useOnline();
  const T = editionText(lang);
  const inIssue = !params.get("numero") ? issue?.articles?.find((a) => a.slug === slug) : undefined;
  const [remote, setRemote] = useState<ArticlePayload | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    window.scrollTo?.(0, 0);
    if (inIssue) return;
    let alive = true;
    setRemote(null); setFailed(false);
    api.article(slug).then((r) => { if (alive) setRemote(r); })
      .catch((e) => { if (!alive) return; if (e instanceof PriveLockedError) setLocked(e.code); else setFailed(true); });
    return () => { alive = false; };
  }, [slug, inIssue, api]);

  const order = useMemo(() => {
    if (!issue?.found) return [] as EditionArticle[];
    const ed = personalizeIssue(issue, prefs);
    return [...ed.sections.flatMap((s) => s.articles), ...ed.moreTime];
  }, [issue, prefs]);

  if (locked) return <PriveLocked code={locked as never} />;
  const article = inIssue ?? remote?.article;
  const images: Record<string, EditionImage> = inIssue ? issue?.images ?? {} : remote?.images ?? {};
  if (!article) {
    if (remote?.retracted) {
      return (
        <section className="mx-auto max-w-2xl px-4 py-20" data-testid="edition-retracted">
          <p className="ped-kicker">{T.retracted} · {formatDate(remote.retracted.at, lang)}</p>
          <h1 className="ped-display text-4xl mt-3">{txt(remote.retracted.title, lang)}</h1>
          <p className="ped-note mt-6">{remote.retracted.note}</p>
          <Link to="/prive/edicion" className="ped-btn ghost mt-6">{T.teaser.cta}</Link>
        </section>
      );
    }
    if (remote || failed) {
      return (
        <section className="mx-auto max-w-2xl px-4 py-20 text-center" data-testid="edition-not-found">
          <p className="ped-dek">{failed ? T.loadError : T.notFound}</p>
          <Link to="/prive/edicion" className="ped-btn ghost mt-6">{T.teaser.cta}</Link>
        </section>
      );
    }
    return <div className="min-h-[50vh]" role="status" aria-label={lang === "en" ? "Loading" : "Cargando"} />;
  }
  if (view === "magazine") {
    // Del índice o de un enlace: la revista abre en la apertura de este artículo (todo el número alrededor).
    if (inIssue && issue?.found && order.some((a) => a.slug === article.slug)) {
      const name = prefs.show_name_on_cover && prefs.first_name ? prefs.first_name : null;
      return <IssueMagazine key={article.slug} payload={issue} startSlug={article.slug} memberName={name} hrefFor={(s) => `/prive/edicion/articulo/${s}`} />;
    }
    // Otro número o una pieza fuera de tu selección: el artículo solo, con la misma maquetación.
    return (
      <MagazineReader key={article.slug} issue={null} ed={null} single={article} images={images} lang={lang} offline={!online}
        isSaved={(s) => saved.has(s) || (s === article.slug && !!remote?.saved)} onToggleSave={(s) => void toggleSave(s)}
        onExit={() => setView("continuous")} />
    );
  }
  const idx = order.findIndex((a) => a.slug === article.slug);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  return (
    <>
    <MagazineSwitch lang={lang} onClick={() => setView("magazine")} />
    <ArticleView article={article} images={images} lang={lang} issue={issue?.issue} offline={!online}
      saved={saved.has(article.slug) || !!remote?.saved} onToggleSave={() => void toggleSave(article.slug)}
      prevNext={(prev || next) ? (
        <nav className="mt-12 grid gap-4 sm:grid-cols-2" aria-label={lang === "en" ? "More stories" : "Más piezas"}>
          {prev ? <Link to={`/prive/edicion/articulo/${prev.slug}`} className="ped-panel block"><span className="ped-kicker">← {T.prev}</span><span className="block ped-display text-2xl mt-1">{txt(prev.title, lang)}</span></Link> : <span />}
          {next ? <Link to={`/prive/edicion/articulo/${next.slug}`} className="ped-panel block text-right"><span className="ped-kicker">{T.next} →</span><span className="block ped-display text-2xl mt-1">{txt(next.title, lang)}</span></Link> : <span />}
        </nav>
      ) : null} />
    </>
  );
}
