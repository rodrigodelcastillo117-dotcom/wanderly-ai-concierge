// Ranura <PrivateEditionTeaser /> para FOR YOU (prive-ux) e INSIDER (privevalor). Ligera: una sola RPC con la
// sesión Privé (prive_edition_library, o prive_edition_issue si pide un destino). Sin número publicado o sin
// pieza del destino → no se muestra nada (nunca una tarjeta vacía ni un "próximamente" decorativo).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { priveApi } from "@/lib/priveApi";
import { readPriveSession } from "@/lib/priveSession";
import { imageAllowed, resolveLanguage, txt, type EditionArticle, type EditionImage, type EditionIssue, type IssuePayload } from "@/lib/priveEdition";
import { editionText } from "@/lib/priveEditionI18n";

type Teaser = { issue: EditionIssue; image?: EditionImage; article?: EditionArticle };

export function PrivateEditionTeaser({ destination = null, variant = "for-you" }: { destination?: string | null; variant?: "for-you" | "insider" } = {}) {
  const { user } = useAuth();
  const [data, setData] = useState<Teaser | null>(null);
  const lang = resolveLanguage(null, typeof navigator !== "undefined" ? navigator.language : "es");
  const T = editionText(lang);
  useEffect(() => {
    const s = user ? readPriveSession(user.id) : null;
    if (!s) return;
    let alive = true;
    if (destination) {
      void priveApi.content<IssuePayload>("prive_edition_issue", s.token, { _slug: null }).then((r) => {
        if (!alive || !r.ok || !r.data?.found || !r.data.issue) return;
        const article = r.data.articles?.find((a) => a.destinations.includes(destination) && a.format !== "brief");
        if (!article) return;
        setData({ issue: r.data.issue, article, image: article.hero_image ? r.data.images?.[article.hero_image] : undefined });
      });
    } else {
      void priveApi.content<{ issues: EditionIssue[]; images: Record<string, EditionImage> }>("prive_edition_library", s.token).then((r) => {
        if (!alive || !r.ok || !r.data?.issues?.length) return;
        const issue = r.data.issues[0];
        setData({ issue, image: issue.cover_image ? r.data.images?.[issue.cover_image] : undefined });
      });
    }
    return () => { alive = false; };
  }, [user, destination]);
  if (!data) return null;
  const { issue, image, article } = data;
  const href = article ? `/prive/edicion/articulo/${article.slug}` : "/prive/edicion";
  return (
    <section aria-label="The Private Edition" data-testid="private-edition-teaser" data-variant={variant}
      className="relative overflow-hidden border border-[color:var(--pv-line,rgba(201,169,97,.18))] bg-[#0d0d0e]">
      <Link to={href} className="grid sm:grid-cols-[1fr_1.2fr] group">
        {imageAllowed(image, "online") && (
          <div className="aspect-[4/3] sm:aspect-auto overflow-hidden">
            <img src={image.url} alt={txt(image.alt, lang)} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" style={{ objectPosition: image.focal }} />
          </div>
        )}
        <div className="p-5 sm:p-7 flex flex-col justify-end gap-2">
          <p className="text-[0.68rem] tracking-[0.3em] uppercase text-[color:var(--pv-gold,#c9a961)]">
            THE PRIVATE EDITION · {T.issueNo(issue.number)} · {txt(issue.period_label, lang)}
          </p>
          <p className="text-[0.75rem] italic text-[color:var(--pv-muted,#a8a299)]">{variant === "insider" ? T.teaser.insider : T.taglineSub}</p>
          <h3 className="prive-serif text-3xl sm:text-4xl leading-tight text-[color:var(--pv-text,#f5f2ea)]">{article ? txt(article.title, lang) : txt(issue.title, lang)}</h3>
          <p className="text-sm text-[color:var(--pv-champagne,#e8dcc2)]">{article ? txt(article.dek, lang) : txt(issue.cover_line, lang)}</p>
          <span className="mt-2 inline-flex text-xs tracking-[0.24em] uppercase text-[color:var(--pv-gold,#c9a961)]">{T.teaser.cta} →</span>
          {image?.illustrative && <span className="text-[0.62rem] text-[color:var(--pv-muted,#a8a299)]">{T.illustrative} · {image.photographer} / Pexels</span>}
        </div>
      </Link>
    </section>
  );
}
