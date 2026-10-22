// THE PRIVATE EDITION dentro de IATOS Privé: sección editorial PROTAGONISTA de FOR YOU (y versión de INSIDER).
// No es un teaser chico: portada de la revista, "Mi edición personalizada" y los cuatro accesos (Leer revista,
// Elegir intereses, Descargar para un vuelo, Biblioteca).
//
// Honestidad y acceso:
//  · Sin sesión Privé (o el servidor responde PRIVE_*) → presentación estática de la revista, sin un solo
//    título ni foto de una pieza: nada protegido sale sin prive_require.
//  · Miembro sin número publicado → "primer número en revisión editorial" (prive_edition_status solo dice
//    sí/no y la fecha programada), sin mostrar artículos pendientes. Elegir intereses ya funciona.
//  · Miembro con número publicado → portada real y su selección personal (la misma función pura que la revista).
//  · Si prive_edition_status aún no existe en el servidor (migración sin aplicar), se usa prive_edition_library.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Download, Library, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { priveApi } from "@/lib/priveApi";
import { readPriveSession } from "@/lib/priveSession";
import { usePriveLang } from "@/components/prive/PriveLang";
import {
  DEFAULT_PREFS, formatDate, imageAllowed, matchDestination, personalizeIssue, txt,
  type EditionArticle, type EditionIssue, type EditionPrefs, type IssuePayload, type Lang,
} from "@/lib/priveEdition";
import type { EditionStatus } from "@/lib/priveEditionApi";
import { editionText } from "@/lib/priveEditionI18n";

type Prefs = EditionPrefs & { first_name?: string | null };
type Loaded =
  | { kind: "static" }
  | { kind: "review"; status: EditionStatus | null }
  | { kind: "live"; issue: IssuePayload; prefs: Prefs };

// Una carga por minuto y por cuenta: volver a FOR YOU no repite las llamadas.
let memo: { uid: string; at: number; data: Loaded } | null = null;
export const __resetEditionSectionCache = () => { memo = null; };
/** Tras guardar intereses o publicar, la sección vuelve a pedir el estado. */
export const invalidateEditionSection = () => { memo = null; };

const deniedCode = (code: string) => code.startsWith("PRIVE_") || code === "UNAUTHENTICATED";

async function load(uid: string, token: string): Promise<Loaded> {
  if (memo && memo.uid === uid && Date.now() - memo.at < 60_000) return memo.data;
  let latestSlug: string | null = null;
  let status: EditionStatus | null = null;
  const st = await priveApi.content<EditionStatus>("prive_edition_status", token);
  if (st.ok) { status = st.data; latestSlug = st.data.latest?.slug ?? null; }
  else if (deniedCode(st.code)) return { kind: "static" };
  else {
    // Servidor sin prive_edition_status: la biblioteca solo lista números publicados.
    const lib = await priveApi.content<{ issues: EditionIssue[] }>("prive_edition_library", token);
    if (!lib.ok) return { kind: deniedCode(lib.code) ? "static" : "review", status: null } as Loaded;
    latestSlug = lib.data.issues?.[0]?.slug ?? null;
  }
  let data: Loaded = { kind: "review", status };
  if (latestSlug) {
    const [iss, pr] = await Promise.all([
      priveApi.content<IssuePayload>("prive_edition_issue", token, { _slug: latestSlug }),
      priveApi.content<Prefs>("prive_edition_prefs", token),
    ]);
    if (iss.ok && iss.data?.found && iss.data.issue) data = { kind: "live", issue: iss.data, prefs: pr.ok ? { ...DEFAULT_PREFS, ...pr.data } : DEFAULT_PREFS };
  }
  memo = { uid, at: Date.now(), data };
  return data;
}

function CoverThumb({ issue, lang, coverImage }: { issue: IssuePayload; lang: Lang; coverImage: string | null }) {
  const T = editionText(lang);
  const img = coverImage ? issue.images?.[coverImage] : undefined;
  const meta = issue.issue!;
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#0b0b0b] shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)] ring-1 ring-[rgba(201,169,97,.25)]" data-testid="edition-cover-thumb">
      {imageAllowed(img, "online") && <img src={img.url} alt={txt(img.alt, lang)} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: img.focal }} loading="lazy" />}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.72)_0%,rgba(0,0,0,.08)_28%,rgba(0,0,0,.1)_55%,rgba(0,0,0,.9)_100%)]" />
      <div className="absolute inset-x-0 top-0 p-4 text-center">
        <p className="prive-serif uppercase tracking-[0.16em] text-[clamp(1.05rem,3.4vw,1.6rem)] leading-none text-[color:var(--pv-champagne,#e8dcc2)]">{T.brand}</p>
        <p className="mt-1 text-[0.62rem] tracking-[0.28em] uppercase text-[color:var(--pv-champagne,#e8dcc2)]">{T.issueNo(meta.number)} · {txt(meta.period_label, lang)}</p>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="prive-serif text-white text-[clamp(1.6rem,4.6vw,2.4rem)] leading-[1.02]">{txt(meta.title, lang)}</p>
        <p className="mt-2 text-[0.72rem] italic text-[color:var(--pv-champagne,#e8dcc2)] line-clamp-3">{txt(meta.cover_line, lang)}</p>
        {img?.illustrative && <p className="mt-2 text-[0.58rem] text-[color:var(--pv-muted,#a8a299)]">{T.illustrative} · {img.photographer} / Pexels</p>}
      </div>
    </div>
  );
}

/** Portada tipográfica mientras no hay número publicado (sin foto ni títulos de piezas pendientes). */
function ReviewCover({ lang, review }: { lang: Lang; review: boolean }) {
  const T = editionText(lang);
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,#2a2214,#0b0b0b_70%)] ring-1 ring-[rgba(201,169,97,.25)] flex flex-col items-center justify-between p-6 text-center" data-testid="edition-review-cover">
      <p className="prive-serif uppercase tracking-[0.16em] text-[clamp(1.05rem,3.4vw,1.6rem)] text-[color:var(--pv-champagne,#e8dcc2)]">{T.brand}</p>
      <div>
        <p className="prive-serif text-[clamp(3rem,10vw,5rem)] leading-none text-[color:var(--pv-gold,#c9a961)]">{T.issueNo(1)}</p>
        {review && <p className="mt-3 text-[0.7rem] tracking-[0.28em] uppercase text-[color:var(--pv-champagne,#e8dcc2)]">{T.section.reviewBadge}</p>}
      </div>
      <p className="prive-serif italic text-[color:var(--pv-muted,#a8a299)]">{T.tagline}</p>
    </div>
  );
}

function Actions({ lang, live, readTo }: { lang: Lang; live: boolean; readTo: string }) {
  const T = editionText(lang);
  const items = [
    { to: readTo, icon: BookOpen, label: T.section.read, primary: true, show: live },
    { to: "/prive/edicion/mi-edicion", icon: SlidersHorizontal, label: T.section.interests, primary: !live, show: true },
    { to: "/prive/edicion/vuelo", icon: Download, label: T.section.flight, show: live },
    { to: "/prive/edicion/biblioteca", icon: Library, label: T.section.library, show: live },
  ].filter((x) => x.show);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="edition-section-actions">
      {items.map((a) => (
        <Link key={a.label} to={a.to}
          className={`inline-flex min-h-[52px] items-center justify-between gap-3 rounded-full px-5 text-[0.72rem] font-semibold tracking-[0.18em] uppercase transition-colors ${a.primary
            ? "text-[#0a0906] bg-[linear-gradient(135deg,#b8975a_0%,#e3cc95_48%,#c9a961_100%)]"
            : "border border-[color:var(--pv-line-strong,rgba(201,169,97,.42))] text-[color:var(--pv-champagne,#e8dcc2)] hover:bg-[rgba(201,169,97,.08)]"}`}>
          <span className="inline-flex items-center gap-2"><a.icon className="h-4 w-4" aria-hidden="true" />{a.label}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

function Picks({ picks, lang }: { picks: EditionArticle[]; lang: Lang }) {
  return (
    <ol className="list-none p-0 m-0 divide-y divide-[rgba(201,169,97,.14)] border-y border-[rgba(201,169,97,.14)]" data-testid="edition-section-picks">
      {picks.map((a, i) => (
        <li key={a.slug}>
          <Link to={`/prive/edicion/articulo/${a.slug}`} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 py-3 group">
            <span className="prive-serif text-lg text-[color:var(--pv-gold,#c9a961)]">{String(i + 1).padStart(2, "0")}</span>
            <span>
              <span className="block text-[0.62rem] tracking-[0.24em] uppercase text-[color:var(--pv-gold,#c9a961)]">{txt(a.kicker, lang)}</span>
              <span className="block prive-serif text-xl leading-snug text-[color:var(--pv-text,#f5f2ea)] group-hover:text-[color:var(--pv-champagne,#e8dcc2)]">{txt(a.title, lang)}</span>
            </span>
            <span className="text-xs text-[color:var(--pv-muted,#a8a299)] whitespace-nowrap">{a.reading_minutes} min</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** La ranura puede montarse en una página suelta sin AuthProvider (pruebas de otros equipos): sin proveedor, sin
 *  usuario → presentación estática. useAuth llama siempre a useContext, así que el orden de hooks no cambia. */
function useUserOrNull() {
  try { return useAuth().user ?? null; } catch { return null; }
}

export function PrivateEditionSection({ destination = null, variant = "for-you" }: { destination?: string | null; variant?: "for-you" | "insider" } = {}) {
  const user = useUserOrNull();
  const lang = usePriveLang() as Lang;
  const T = editionText(lang);
  const [data, setData] = useState<Loaded | null>(null);
  const uid = user?.id ?? null;
  useEffect(() => {
    const s = uid ? readPriveSession(uid) : null;
    if (!uid || !s) { setData({ kind: "static" }); return; }
    let alive = true;
    load(uid, s.token).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData({ kind: "static" }); });
    return () => { alive = false; };
  }, [uid]);

  const live = data?.kind === "live" ? data : null;
  const ed = useMemo(() => (live ? personalizeIssue(live.issue, live.prefs) : null), [live]);
  // `destination` puede ser un slug del número ("cdmx") o el nombre de un destino del Insider ("Ciudad de México").
  const destSlug = useMemo(() => (live && destination ? matchDestination(destination, live.issue.articles ?? []) : null), [live, destination]);
  const picks = useMemo(() => {
    if (!ed) return [];
    // La portada personal primero (la que mejor coincide con sus intereses) y luego el orden de su edición.
    const flat = [...ed.sections.flatMap((x) => x.articles), ...ed.moreTime];
    const all = [...(ed.cover ? [ed.cover] : []), ...flat.filter((a) => a !== ed.cover)].filter((a) => a.format !== "letter" && a.format !== "brief");
    const local = destSlug ? all.filter((a) => a.destinations.includes(destSlug)) : [];
    return [...local, ...all.filter((a) => !local.includes(a))].slice(0, variant === "insider" ? 2 : 3);
  }, [ed, destSlug, variant]);

  if (!data) return <section aria-busy="true" aria-label={T.brand} className="min-h-[320px]" data-testid="private-edition-section" data-state="loading" />;
  // INSIDER: solo con número publicado y, si hay destino, con piezas de ese lugar (nunca una tarjeta vacía).
  if (variant === "insider" && (!live || (destination && (!destSlug || !picks.some((a) => a.destinations.includes(destSlug)))))) return null;

  const name = live?.prefs.show_name_on_cover && live.prefs.first_name ? live.prefs.first_name : null;
  const review = data.kind === "review" ? data.status : null;
  const reviewText = data.kind !== "review" ? "" : review?.next_scheduled_for ? T.section.scheduled(formatDate(review.next_scheduled_for, lang))
    : review?.in_review ? T.section.inReview : (review?.published_count ?? 0) > 0 ? T.section.inPreparation : T.section.firstInPreparation;
  const readTo = variant === "insider" && picks[0] ? `/prive/edicion/articulo/${picks[0].slug}` : "/prive/edicion";
  return (
    <section aria-labelledby="pe-title" data-testid="private-edition-section" data-state={data.kind} data-variant={variant}
      className="mx-auto w-full max-w-6xl">
      <div className={`grid items-center gap-8 ${variant === "insider" ? "md:grid-cols-[minmax(0,14rem)_1fr]" : "md:grid-cols-[minmax(0,21rem)_1fr] lg:gap-14"}`}>
        <div className={variant === "insider" ? "w-full max-w-[14rem]" : `w-full ${live ? "max-w-[21rem]" : "max-w-[15rem] sm:max-w-[21rem]"} mx-auto md:mx-0`}>
          {live
            ? <Link to="/prive/edicion" aria-label={`${T.section.read} · ${txt(live.issue.issue!.title, lang)}`}><CoverThumb issue={live.issue} lang={lang} coverImage={ed?.coverImage ?? null} /></Link>
            : <ReviewCover lang={lang} review={!!review?.in_review} />}
        </div>
        <div className="min-w-0 space-y-5">
          <p className="text-[0.68rem] tracking-[0.3em] uppercase text-[color:var(--pv-gold,#c9a961)]">
            {T.brand}{live ? ` · ${T.issueNo(live.issue.issue!.number)} · ${txt(live.issue.issue!.period_label, lang)}` : ""}
          </p>
          <h2 id="pe-title" className="prive-serif text-[clamp(2rem,5vw,3.3rem)] leading-[1.05] text-[color:var(--pv-text,#f5f2ea)]">
            {variant === "insider" ? T.section.insiderTitle : T.tagline}
          </h2>
          {variant !== "insider" && <p className="max-w-xl text-[0.95rem] leading-relaxed text-[color:var(--pv-champagne,#e8dcc2)]">{T.section.pitch}</p>}
          {live ? (
            <div className="space-y-3">
              <p className="text-[0.68rem] tracking-[0.26em] uppercase text-[color:var(--pv-muted,#a8a299)]">{name ? T.coverFor(name) : T.section.myEdition}</p>
              <Picks picks={picks} lang={lang} />
              <p className="text-xs text-[color:var(--pv-muted,#a8a299)]">{ed?.personalized ? T.personalizedNote : T.section.chooseToPersonalize}</p>
            </div>
          ) : data.kind === "review" ? (
            <p className="max-w-xl text-sm leading-relaxed text-[color:var(--pv-muted,#a8a299)]" role="status" data-testid="edition-section-review">{reviewText}</p>
          ) : (
            <p className="max-w-xl text-sm text-[color:var(--pv-muted,#a8a299)]">{T.section.membersOnly}</p>
          )}
          {data.kind !== "static" && <Actions lang={lang} live={!!live} readTo={readTo} />}
        </div>
      </div>
    </section>
  );
}

/** Banda de FOR YOU: la sección con su marco (la usan ForYouHome y el hub mientras el catálogo está en curaduría). */
export function PrivateEditionBand() {
  return (
    <div id="the-private-edition" className="border border-[color:var(--pv-line,rgba(201,169,97,.18))] bg-[linear-gradient(160deg,rgba(201,169,97,.07),rgba(10,9,6,0)_55%)] p-5 py-10 sm:p-10 lg:p-14 scroll-mt-24">
      <PrivateEditionSection />
    </div>
  );
}

/** Nombre del contrato con prive-ux y privevalor (ranura): ahora es la sección completa. */
export const PrivateEditionTeaser = PrivateEditionSection;
