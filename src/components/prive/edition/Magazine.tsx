/**
 * Piezas de la revista THE PRIVATE EDITION (puras: reciben datos, no llaman a la red). Las usan la lectura
 * en línea, la vista previa del panel editorial y la lectura sin conexión.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bookmark, BookmarkCheck, ExternalLink, WifiOff } from "lucide-react";
import {
  blockText, formatDate, imageAllowed, imageCredit, resolveAction, tr, txt, type Block, type EditionArticle, type EditionImage,
  type EditionIssue, type EditionSource, type Lang,
} from "@/lib/priveEdition";
import { editionText } from "@/lib/priveEditionI18n";

// fetchpriority aún no está tipado en React 18: se pasa como atributo HTML.
const HIGH = { fetchpriority: "high" } as Record<string, string>;

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

/** Foto con crédito y licencia; "Foto ilustrativa" cuando no es el lugar/objeto real. Sin licencia: no se muestra. */
export function EditionImg({ img, lang, preview = false, className = "", imgClassName = "", eager = false, caption = true, depicts = true }: {
  img: EditionImage | undefined; lang: Lang; preview?: boolean; className?: string; imgClassName?: string; eager?: boolean; caption?: boolean; depicts?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!img || failed || !imageAllowed(img, "online", preview)) return null;
  const T = editionText(lang);
  const pending = img.license_status === "pending";
  return (
    <figure className={className} data-image={img.key}>
      <div style={{ position: "relative" }}>
        <img src={img.url} alt={txt(img.alt, lang)} loading={eager ? "eager" : "lazy"} decoding="async" className={imgClassName}
          style={{ objectPosition: img.focal ?? "50% 50%" }} onError={() => setFailed(true)} {...(eager ? HIGH : {})} />
        {pending && <span className="ped-pending">{T.licensePending}</span>}
      </div>
      {caption && (
        <figcaption className="ped-cap">
          {img.illustrative && <span className="ill">{T.illustrative}. </span>}
          {depicts && <>{txt(img.depicts, lang)} </>}
          <span>
            {T.photo}: {img.photographer_url ? <a href={img.photographer_url} target="_blank" rel="noopener noreferrer">{img.photographer}</a> : img.photographer}
            {" / "}{img.page_url ? <a href={img.page_url} target="_blank" rel="noopener noreferrer">{img.provider === "pexels" ? "Pexels" : img.provider}</a> : img.provider}
            {" · "}{img.license_url ? <a href={img.license_url} target="_blank" rel="noopener noreferrer">{img.license}</a> : img.license}
          </span>
        </figcaption>
      )}
    </figure>
  );
}

export function Cover({ issue, images, lang, coverImage, coverArticle, memberName, personalized, preview, readHref, indexHref = "#indice" }: {
  issue: EditionIssue; images: Record<string, EditionImage>; lang: Lang; coverImage: string | null; coverArticle: EditionArticle | null;
  memberName?: string | null; personalized: boolean; preview?: boolean; readHref?: string; indexHref?: string;
}) {
  const T = editionText(lang);
  const img = coverImage ? images[coverImage] : undefined;
  const showImg = imageAllowed(img, "online", preview);
  const title = coverArticle && personalized ? txt(coverArticle.title, lang) : txt(issue.title, lang);
  return (
    <section className="ped-cover" aria-label={`${T.brand} ${T.issueNo(issue.number)}`} data-testid="edition-cover">
      {showImg && (
        <figure><img src={img.url} alt={txt(img.alt, lang)} style={{ objectPosition: img.focal ?? "50% 40%" }} {...HIGH} /></figure>
      )}
      <div className="ped-cover-inner">
        <header className="text-center">
          <p className="ped-masthead">{T.brand}</p>
          <p className="mt-2 font-[var(--ped-display)] italic text-[color:var(--ped-champagne)] text-base sm:text-lg" style={{ fontFamily: "var(--ped-display)" }}>{T.tagline}</p>
          <p className="mt-3 ped-kicker text-[color:var(--ped-champagne)]">
            {T.issueNo(issue.number)} · {txt(issue.period_label, lang)}
          </p>
        </header>
        <div />
        <div className="space-y-4">
          {memberName && <p className="ped-kicker">{T.coverFor(memberName)}</p>}
          {coverArticle && <p className="ped-kicker">{txt(coverArticle.kicker, lang)}</p>}
          <h1 className="ped-display ped-cover-title">{title}</h1>
          <p className="ped-cover-lines">{txt(issue.cover_line, lang)}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            {readHref && <Link to={readHref} className="ped-btn">{T.read}</Link>}
            <a href={indexHref} className="ped-btn ghost">{T.contents}</a>
          </div>
          <p className="ped-meta max-w-xl">{personalized ? T.personalizedNote : T.commonNote}</p>
        </div>
      </div>
      {showImg && (
        <p className="ped-cover-credit">
          {img.illustrative ? `${T.illustrative} · ` : ""}{T.photo}: <a href={img.page_url} target="_blank" rel="noopener noreferrer">{img.photographer} / Pexels</a> · {img.license}
        </p>
      )}
    </section>
  );
}

/** Índice configurable: secciones en el orden del miembro, piezas con número de entrada y tiempo de lectura. */
export function IssueIndex({ sections, lang, hrefFor, readingMinutes, moreTime = [], hiddenCount = 0, extra }: {
  sections: { key: string; articles: EditionArticle[] }[]; lang: Lang; hrefFor: (slug: string) => string; readingMinutes: number;
  moreTime?: EditionArticle[]; hiddenCount?: number; extra?: ReactNode;
}) {
  const T = editionText(lang);
  let n = 0;
  return (
    <nav aria-labelledby="ped-toc-title" id="indice" className="scroll-mt-24">
      <p className="ped-kicker">{T.contentsSub}</p>
      <h2 id="ped-toc-title" className="ped-display text-5xl sm:text-6xl mt-2">{T.contents}</h2>
      <p className="ped-meta mt-2">{T.readingTotal(readingMinutes)}{hiddenCount ? ` · ${T.hiddenByYou(hiddenCount)}` : ""}</p>
      <div className="ped-rule mt-4" />
      {sections.filter((s) => s.articles.length).map((s) => (
        <section key={s.key} className="mt-6" aria-label={T.sections[s.key] ?? s.key}>
          <h3 className="ped-kicker">{T.sections[s.key] ?? s.key}</h3>
          <ol className="list-none p-0 m-0">
            {s.articles.map((a) => {
              n++;
              return (
                <li key={a.slug}>
                  <Link to={hrefFor(a.slug)} className="ped-toc-item" data-testid="toc-item">
                    <span className="n" aria-hidden="true">{String(n).padStart(2, "0")}</span>
                    <span><span className="t">{txt(a.title, lang)}</span><span className="d">{txt(a.dek, lang)}</span></span>
                    <span className="ped-meta whitespace-nowrap">{a.reading_minutes} min</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {extra}
      {moreTime.length > 0 && (
        <section className="mt-8" aria-label={T.moreTime}>
          <h3 className="ped-kicker">{T.moreTime}</h3>
          <ul className="list-none p-0 m-0">
            {moreTime.map((a) => (
              <li key={a.slug}><Link to={hrefFor(a.slug)} className="ped-toc-item"><span className="n" aria-hidden="true">+</span>
                <span><span className="t">{txt(a.title, lang)}</span></span><span className="ped-meta">{a.reading_minutes} min</span></Link></li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}

/** Rejilla editorial (tamaños distintos, no tarjetas repetidas). */
export function FeatureGrid({ articles, images, lang, hrefFor, preview }: {
  articles: EditionArticle[]; images: Record<string, EditionImage>; lang: Lang; hrefFor: (slug: string) => string; preview?: boolean;
}) {
  const widths = ["w4", "w2", "w3", "w3", "w2", "w2", "w2", "w6"];
  return (
    <div className="ped-grid">
      {articles.map((a, i) => {
        const img = a.hero_image ? images[a.hero_image] : undefined;
        const show = imageAllowed(img, "online", preview);
        return (
          <Link key={a.slug} to={hrefFor(a.slug)} className={`ped-card ${widths[i % widths.length]} ${show ? "" : "typo"}`}>
            {show && <div className="ph"><img src={img.url} alt={txt(img.alt, lang)} loading="lazy" style={{ objectPosition: img.focal }} /></div>}
            <div className="tx">
              <p className="ped-kicker">{txt(a.kicker, lang)}</p>
              <p className="tt">{txt(a.title, lang)}</p>
              <p className="ped-meta mt-2">{txt(a.dek, lang)}</p>
              <p className="ped-meta mt-2">{a.reading_minutes} min{show && img.illustrative ? ` · ${editionText(lang).illustrative}` : ""}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Blocks({ blocks, images, lang, preview }: { blocks: Block[]; images: Record<string, EditionImage>; lang: Lang; preview?: boolean }) {
  const T = editionText(lang);
  let firstP = true;
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p": {
            const cls = firstP ? "first" : "";
            firstP = false;
            return <p key={i} className={cls}>{blockText(b, lang)}</p>;
          }
          case "h": return <h2 key={i}>{blockText(b, lang)}</h2>;
          case "quote":
            return (
              <figure key={i} className="ped-pull">
                <blockquote>«{blockText(b, lang)}»</blockquote>
                {b.cite && <figcaption>{txt(b.cite, lang)}</figcaption>}
              </figure>
            );
          case "note":
            return (
              <aside key={i} className={`ped-note ${b.kind}`} aria-label={T.noteKind[b.kind]}>
                <span className="lbl">{T.noteKind[b.kind]}</span>{blockText(b, lang)}
              </aside>
            );
          case "facts":
            return (
              <section key={i} className="ped-facts" aria-label={txt(b.title, lang)}>
                <h3>{txt(b.title, lang)}</h3>
                <dl>{b.items.map((it, j) => <Fragment key={j}><dt>{txt(it.label, lang)}</dt><dd>{txt(it.value, lang)}</dd></Fragment>)}</dl>
              </section>
            );
          case "img":
            return <EditionImg key={i} img={images[b.image]} lang={lang} preview={preview} className={`ped-fig ${b.size === "full" ? "full" : "half"}`} />;
          case "agenda":
            return (
              <ul key={i} className="ped-agenda">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <span className="dt">{formatDate(it.date, lang, { day: "numeric", month: "short", year: "numeric" })}{it.end ? ` – ${formatDate(it.end, lang, { day: "numeric", month: "short" })}` : ""}</span>
                    <span className="ev">{blockText(it, lang)}</span>
                  </li>
                ))}
              </ul>
            );
          default: return null;
        }
      })}
      <div className="ped-clear" />
    </>
  );
}

export function SourcesList({ sources, lang }: { sources: EditionSource[]; lang: Lang }) {
  const T = editionText(lang);
  if (!sources.length) return null;
  return (
    <section aria-labelledby="ped-src" className="mt-10">
      <h2 id="ped-src" className="ped-kicker">{T.sources}</h2>
      <p className="ped-meta">{T.sourcesSub}</p>
      <ol className="ped-sources list-none p-0 mt-3" data-testid="sources">
        {sources.map((s) => (
          <li key={s.key}>
            <span className="ent">{s.entity}</span>{s.author ? ` · ${s.author}` : ""} — <a className="ped-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
            <br />
            {s.published_at ? `${T.published} ${formatDate(s.published_at, lang)} · ` : ""}{T.consulted} {formatDate(s.consulted_at, lang)}
            {s.used_for ? ` · ${s.used_for}` : ""}
            <br /><span className="opacity-80">{s.data_used}</span>
            <br /><span className="opacity-70">{s.reuse_rights}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** From Page to Experience: solo rutas reales de la app y enlaces oficiales; sin red, deshabilitado. */
export function ActionsBar({ article, lang, offline }: { article: EditionArticle; lang: Lang; offline: boolean }) {
  const T = editionText(lang);
  const navigate = useNavigate();
  const acts = (article.actions ?? []).map((a) => resolveAction(a, lang)).filter((a): a is NonNullable<typeof a> => !!a);
  if (!acts.length) return null;
  return (
    <section aria-labelledby="ped-acts" className="mt-10 ped-panel">
      <p id="ped-acts" className="ped-kicker">{T.fromPage}</p>
      <p className="ped-meta mb-3">{T.fromPageSub}</p>
      {offline && <p className="ped-meta mb-3 flex items-center gap-2" role="note"><WifiOff className="h-4 w-4" aria-hidden="true" />{T.offlineNoBooking}</p>}
      <div className="ped-actions" data-testid="actions">
        {acts.map((a, i) => a.kind === "external" ? (
          <a key={i} className="ped-act" href={offline ? undefined : a.href} target="_blank" rel="noopener noreferrer" aria-disabled={offline || undefined}>
            {a.label}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{offline && <span className="sr-only"> ({T.needsNetwork})</span>}
          </a>
        ) : (
          <button key={i} type="button" className="ped-act" disabled={offline} aria-disabled={offline || undefined}
            onClick={() => navigate(a.to, a.state ? { state: a.state } : undefined)}>
            {a.label}{offline && <span className="sr-only"> ({T.needsNetwork})</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Artículo completo con maquetación de revista (doble página en escritorio, lectura editorial en móvil). */
export function ArticleView({ article, images, lang, issue, preview = false, offline = false, saved, onToggleSave, prevNext }: {
  article: EditionArticle; images: Record<string, EditionImage>; lang: Lang; issue?: EditionIssue | null; preview?: boolean; offline?: boolean;
  saved?: boolean; onToggleSave?: () => void; prevNext?: ReactNode;
}) {
  const T = editionText(lang);
  const hero = article.hero_image ? images[article.hero_image] : undefined;
  const hasHero = imageAllowed(hero, "online", preview);
  const title = tr(article.title, lang);
  const untranslated = lang === "en" && (title.fallback || (article.body ?? []).some((b) => "es" in b && !(b as { en?: string }).en));
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const on = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <article lang={untranslated ? "es" : lang} data-testid="edition-article" data-slug={article.slug}>
      <div className="ped-progress" style={{ transform: `scaleX(${progress})`, width: "100%" }} aria-hidden="true" />
      <header className={`ped-opener ${hasHero ? "has-photo" : ""}`}>
        {hasHero && <EditionImg img={hero} lang={lang} preview={preview} className="ped-opener-photo" eager caption={false} />}
        <div className="ped-opener-text">
          <p className="ped-kicker">{txt(article.kicker, lang)}</p>
          <h1 className="ped-display ped-title mt-3">{title.text}</h1>
          {txt(article.dek, lang) && <p className="ped-dek mt-4">{txt(article.dek, lang)}</p>}
          <div className="ped-rule mt-6 max-w-xs" />
          <p className="ped-meta mt-4">
            {txt(article.byline, lang)} · {T.readingTime(article.reading_minutes)}
            {article.fact_date ? ` · ${T.factAsOf(formatDate(article.fact_date, lang))}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="ped-chip">{T.factStatus[article.fact_status]}</span>
            {article.expired && article.valid_until && <span className="ped-chip warn">{T.expired(formatDate(article.valid_until, lang))}</span>}
            {preview && article.drafted_by === "claude" && <span className="ped-chip warn">{T.aiDraft}</span>}
            {preview && article.status && <span className="ped-chip warn">{article.status}</span>}
          </div>
          {onToggleSave && !preview && (
            <button type="button" onClick={onToggleSave} disabled={offline} className="ped-btn ghost mt-5 self-start" aria-pressed={!!saved}>
              {saved ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
              {saved ? T.saved : T.save}
            </button>
          )}
        </div>
      </header>
      {hasHero && (
        <div className="ped-body mt-2">
          <p className="ped-cap">
            {hero.illustrative && <span className="ill">{T.illustrative}. </span>}{txt(hero.depicts, lang)} {T.photo}: <a href={hero.photographer_url} target="_blank" rel="noopener noreferrer">{hero.photographer}</a> / <a href={hero.page_url} target="_blank" rel="noopener noreferrer">Pexels</a> · <a href={hero.license_url} target="_blank" rel="noopener noreferrer">{hero.license}</a>
          </p>
        </div>
      )}
      <div className="ped-body mt-8">
        {untranslated && <p className="ped-note context" role="note"><span className="lbl">EN</span>{T.onlySpanish}</p>}
        {article.correction && (
          <aside className="ped-note" role="note"><span className="lbl">{T.correction} · {formatDate(article.correction.at, lang)}</span>{article.correction.note}</aside>
        )}
        <Blocks blocks={article.body ?? []} images={images} lang={lang} preview={preview} />
        <p className="ped-meta mt-8">
          {article.drafted_by === "claude" || article.drafted_by === "human"
            ? (preview ? T.aiDraft : T.aiReviewed(article.approved_by_label ?? "la dirección editorial"))
            : null}
          {issue ? ` · ${T.brand} ${T.issueNo(issue.number)} · ${txt(issue.period_label, lang)}` : ""}
        </p>
        <SourcesList sources={article.sources ?? []} lang={lang} />
        <ActionsBar article={article} lang={lang} offline={offline} />
        {prevNext}
      </div>
    </article>
  );
}

export function BriefItem({ article, lang, hrefFor }: { article: EditionArticle; lang: Lang; hrefFor?: (slug: string) => string }) {
  const T = editionText(lang);
  const body = (article.body ?? []).filter((b) => b.t === "p" || b.t === "note") as { t: "p" | "note"; es: string; en?: string; kind?: string }[];
  return (
    <article className="py-6 border-b border-[color:var(--ped-line)]" data-testid="brief-item" data-slug={article.slug}>
      <p className="ped-kicker">{txt(article.kicker, lang)} · <time dateTime={article.fact_date}>{formatDate(article.fact_date, lang)}</time></p>
      <h3 className="ped-display text-2xl sm:text-3xl mt-2">
        {hrefFor ? <Link to={hrefFor(article.slug)} className="hover:text-[color:var(--ped-champagne)]">{txt(article.title, lang)}</Link> : txt(article.title, lang)}
      </h3>
      {body.map((b, i) => b.t === "p"
        ? <p key={i} className="mt-2 text-[1.05rem] leading-relaxed" style={{ fontFamily: "var(--ped-text)", color: "var(--ped-body)" }}>{blockText(b, lang)}</p>
        : <p key={i} className="mt-2 ped-meta"><span className="ped-kicker mr-2">{T.noteKind[b.kind ?? "context"]}</span>{blockText(b, lang)}</p>)}
      <p className="ped-meta mt-2">
        {T.sources}: {(article.sources ?? []).map((s, i) => (
          <Fragment key={s.key}>{i ? " · " : ""}<a className="ped-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.entity}</a></Fragment>
        ))}
      </p>
    </article>
  );
}
