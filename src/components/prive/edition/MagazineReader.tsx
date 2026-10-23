/**
 * THE PRIVATE EDITION · modo revista: lector paginado con portada, índice con números de página, aperturas
 * a doble página, cuerpo en columnas, fuentes y «Del artículo a la experiencia» en su propia página y
 * contraportada. En el celular una página a la vez (deslizar con imán); en la computadora, pliegos de dos
 * páginas con flechas, teclado ← → y clic en los bordes. Componente puro: recibe el número y no llama a la red
 * (lo usan la lectura en línea y la copia sin conexión).
 *
 * Paginación: cada pieza se mide en una sonda oculta con la misma tipografía y anchos que la página real y
 * se reparte por bloques con un presupuesto de altura (los párrafos se parten por palabras en un límite de
 * línea); nunca se recorta texto. Si la página real aún desborda (fuente que llegó tarde), esa página hace
 * scroll vertical en vez de cortar, y se vuelve a paginar al terminar de cargar las fuentes.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, ExternalLink, List, ScrollText, WifiOff } from "lucide-react";
import {
  formatDate, imageAllowed, resolveAction, tr, txt, type EditionArticle, type EditionImage, type EditionIssue, type Lang,
  type PersonalizedEdition,
} from "@/lib/priveEdition";
import {
  assemblePages, bodyFlow, buildPieces, endFlow, estimateMeasurer, markOf, pageOfMark, pageOfSlug, paginateFlow, readPageMark, spreadsOf,
  tocFlow, writePageMark, type FlowItem, type FlowPage, type MagPage, type Measurer, type Part, type Piece, type PieceFlows,
} from "@/lib/priveMagazine";
import { editionText } from "@/lib/priveEditionI18n";
import { Monogram } from "@/components/prive/Monogram";
import "./magazine.css";

type T_ = ReturnType<typeof editionText>;
const HIGH = { fetchpriority: "high" } as Record<string, string>;
const INERT = { inert: "" } as Record<string, string>;

export interface MagazineReaderProps {
  issue: EditionIssue | null;
  /** Número personalizado (portada, índice y orden). Sin él: un solo artículo, sin portada ni índice. */
  ed: PersonalizedEdition | null;
  single?: EditionArticle | null;
  images: Record<string, EditionImage>;
  lang: Lang;
  /** Artículo con el que abre (desde el índice o un enlace); si no, la última página leída del número. */
  startSlug?: string | null;
  offline?: boolean;
  preview?: boolean;
  isSaved?: (slug: string) => boolean;
  onToggleSave?: (slug: string) => void;
  /** Sale a la vista continua; recibe el artículo en pantalla (o null en portada, índice, contraportada). */
  onExit: (slug: string | null) => void;
  personalizeHref?: string | null;
  opportunitiesHref?: string | null;
  memberName?: string | null;
}

// ───────────────────────────── geometría ─────────────────────────────
interface Geo {
  W: number; H: number; layout: "phone" | "single" | "spread"; ctrlH: number; stageH: number; pageW: number; pageH: number;
  padX: number; padTop: number; folioH: number; contentW: number; contentH: number; cols: 1 | 2; gap: number; colW: number;
  font: number; lineH: number;
}
function geometry(W: number, H: number): Geo {
  const phone = W < 640;
  const ctrlH = phone ? 56 : 60;
  const stageH = H - ctrlH;
  const spread = W >= 1000 && stageH >= 520;
  let pageW: number; let pageH: number;
  if (phone) { pageW = W; pageH = stageH; }
  else if (spread) { pageH = stageH - 20; pageW = Math.floor(Math.min((W - 2 * 76) / 2, pageH * 0.9)); }
  else { pageH = stageH - 20; pageW = Math.floor(Math.min(W - 2 * 64, pageH * 0.8)); }
  const padX = phone ? 22 : 38;
  const padTop = phone ? 46 : 60;
  const folioH = phone ? 36 : 44;
  const contentW = pageW - 2 * padX;
  const contentH = pageH - padTop - folioH;
  const cols: 1 | 2 = contentW >= 440 ? 2 : 1;
  const gap = 26;
  const colW = cols === 2 ? (contentW - gap) / 2 : contentW;
  const font = cols === 2 ? 14.5 : phone ? 16.5 : 17;
  const lineH = Math.round(font * (cols === 2 ? 1.5 : 1.55) * 10) / 10;
  return { W, H, layout: phone ? "phone" : spread ? "spread" : "single", ctrlH, stageH, pageW, pageH, padX, padTop, folioH, contentW, contentH, cols, gap, colW, font, lineH };
}

function availableBox(el: HTMLElement | null): { W: number; H: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth || 1024 : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight || 768 : 768;
  if (!el) return { W: vw, H: vh };
  const r = el.getBoundingClientRect();
  const W = Math.round(r.width) || vw;
  const top = r.width ? r.top + (window.scrollY || 0) : 0;
  let navH = 0;
  const nav = document.querySelector(".prive-bottom-nav") as HTMLElement | null;
  if (nav && r.width) { const s = getComputedStyle(nav); if (s.display !== "none" && s.position === "fixed") navH = nav.getBoundingClientRect().height; }
  const H = Math.max(W < 640 ? 500 : 560, Math.floor(vh - top - navH - 6));
  return { W, H };
}

// ───────────────────────────── medición en la sonda ─────────────────────────────
function domMeasurer(root: HTMLElement, flowKey: string, items: FlowItem[], dropMin: number, lineH: number): Measurer {
  const el = (id: number) => root.querySelector(`[data-mid="${flowKey}:${id}"]`) as HTMLElement | null;
  const hOf = (n: Element | null) => (n ? n.getBoundingClientRect().height : 0);
  const clones = new Map<string, HTMLElement>();
  const host = (id: number, from: number): HTMLElement | null => {
    const base = el(id);
    if (!base || from === 0) return base;
    const k = `${id}:${from}`;
    let c = clones.get(k);
    if (!c) {
      const it = items[id];
      c = base.cloneNode(true) as HTMLElement;
      c.removeAttribute("data-mid");
      c.setAttribute("data-clone", "");
      const p = c.querySelector("p");
      if (p && it.t === "p") { p.textContent = it.words.slice(from).join(" "); p.classList.remove("first", "lead"); p.classList.add("cont"); }
      base.parentElement!.appendChild(c);
      clones.set(k, c);
    }
    return c;
  };
  const rowTops = (id: number) => {
    const w = el(id);
    const rows = w ? [...w.querySelectorAll("[data-row]")] as HTMLElement[] : [];
    const top = w ? w.getBoundingClientRect().top : 0;
    const rects = rows.map((r) => r.getBoundingClientRect());
    return { total: hOf(w), top, rects };
  };
  const listSpan = (id: number, from: number, to: number) => {
    const { total, rects } = rowTops(id);
    if (!rects.length) return total;
    // Un tramo que continúa repite el título con «continúa», que puede ocupar una línea más.
    const chrome = total - (rects[rects.length - 1].bottom - rects[0].top) + (from > 0 && items[id].t === "facts" ? lineH : 0);
    if (to <= from) return chrome;
    return chrome + (rects[to - 1].bottom - rects[from].top);
  };
  const m: Measurer = {
    h: (id) => hOf(el(id)),
    textH(id, from) {
      const h = hOf(host(id, from));
      const it = items[id];
      return it.t === "p" && it.first && from === 0 ? Math.max(h, dropMin) : h;
    },
    textFit(id, from, limit) {
      const it = items[id];
      const w = host(id, from);
      const p = w?.querySelector("p");
      const tn = p?.firstChild;
      if (!w || !p || !tn || tn.nodeType !== 3 || it.t !== "p") return { n: 0, h: 0 };
      const ws = it.words.slice(from);
      const ends: number[] = [];
      let pos = 0;
      for (let i = 0; i < ws.length; i++) { pos += (i ? 1 : 0) + ws[i].length; ends.push(pos); }
      const top = w.getBoundingClientRect().top;
      const total = w.getBoundingClientRect().height;
      const range = document.createRange();
      const bottomAt = (k: number) => { range.setStart(tn, 0); range.setEnd(tn, Math.min(ends[k - 1], (tn.textContent ?? "").length)); return range.getBoundingClientRect().bottom - top; };
      const tail = Math.max(0, total - bottomAt(ws.length));
      const drop = it.first && from === 0 ? dropMin : 0;
      const fits = (k: number) => Math.max(bottomAt(k) + tail, drop) <= limit;
      let lo = 0; let hi = ws.length - 1;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
      if (lo < 1) return { n: 0, h: 0 };
      // Al menos dos líneas de texto en esta columna (tres junto a la capitular): sin líneas huérfanas.
      const pTop = p.getBoundingClientRect().top - top;
      const lh = parseFloat(getComputedStyle(p).lineHeight) || 20;
      range.setStart(tn, Math.max(0, ends[lo - 1] - ws[lo - 1].length)); range.setEnd(tn, ends[lo - 1]);
      const lastBottom = range.getBoundingClientRect().bottom - top;
      if (lastBottom - pTop < (drop ? 3 : 2) * lh - 2) return { n: 0, h: 0 };
      return { n: lo, h: Math.max(bottomAt(lo) + tail, drop) };
    },
    listH: (id, from) => listSpan(id, from, rowTops(id).rects.length),
    listFit(id, from, limit) {
      const n = rowTops(id).rects.length;
      let k = 0;
      while (from + k < n && listSpan(id, from, from + k + 1) <= limit) k++;
      return k > 0 && from + k < n ? { n: k, h: listSpan(id, from, from + k) } : { n: 0, h: 0 };
    },
  };
  return m;
}

// ───────────────────────────── piezas visuales ─────────────────────────────
interface Ctx {
  lang: Lang; T: T_; images: Record<string, EditionImage>; issue: EditionIssue | null; ed: PersonalizedEdition | null; offline: boolean; preview: boolean;
  isSaved?: (slug: string) => boolean; onToggleSave?: (slug: string) => void; jump: (slug: string) => void; pageOf: (slug: string) => number | null;
  personalizeHref: string | null; opportunitiesHref: string | null; probe: boolean;
}

function Credit({ img, lang, depicts = true }: { img: EditionImage; lang: Lang; depicts?: boolean }) {
  const T = editionText(lang);
  return (
    <>
      {img.illustrative && <span className="ill">{T.illustrative}. </span>}
      {depicts && <>{txt(img.depicts, lang)} </>}
      <span>
        {T.photo}: {img.photographer_url ? <a href={img.photographer_url} target="_blank" rel="noopener noreferrer">{img.photographer}</a> : img.photographer}
        {" / "}{img.page_url ? <a href={img.page_url} target="_blank" rel="noopener noreferrer">{img.provider === "pexels" ? "Pexels" : img.provider}</a> : img.provider}
        {" · "}{img.license_url ? <a href={img.license_url} target="_blank" rel="noopener noreferrer">{img.license}</a> : img.license}
      </span>
    </>
  );
}

function Figure({ imgKey, ctx, ratio }: { imgKey: string; ctx: Ctx; ratio: "wide" | "std" }) {
  const img = ctx.images[imgKey];
  const [failed, setFailed] = useState(false);
  if (!img || !imageAllowed(img, "online", ctx.preview)) return null;
  return (
    <figure className={`mz-fig ${ratio}`} data-image={img.key}>
      <div className="ph">
        {!ctx.probe && !failed && (
          <img src={img.url} alt={txt(img.alt, ctx.lang)} loading="lazy" decoding="async" style={{ objectPosition: img.focal ?? "50% 50%" }} onError={() => setFailed(true)} />
        )}
        {img.license_status === "pending" && <span className="ped-pending">{ctx.T.licensePending}</span>}
      </div>
      <figcaption className="mz-cap"><Credit img={img} lang={ctx.lang} /></figcaption>
    </figure>
  );
}

function ActionsBlock({ a, ctx }: { a: EditionArticle; ctx: Ctx }) {
  const navigate = useNavigate();
  const { T, lang, offline, probe } = ctx;
  const acts = (a.actions ?? []).map((x) => resolveAction(x, lang)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!acts.length) return null;
  return (
    <section className="mz-actions" aria-label={T.mz.fromPage}>
      <p className="ped-kicker">{T.mz.fromPage}</p>
      {offline && <p className="ped-meta mt-2 flex items-center gap-2" role="note"><WifiOff className="h-4 w-4" aria-hidden="true" />{T.offlineNoBooking}</p>}
      <div className="ped-actions mt-3" data-testid={probe ? undefined : "mz-actions"}>
        {acts.map((x, i) => x.kind === "external" ? (
          <a key={i} className="ped-act" href={offline || probe ? undefined : x.href} target="_blank" rel="noopener noreferrer" aria-disabled={offline || undefined}>
            {x.label}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{offline && <span className="sr-only"> ({T.needsNetwork})</span>}
          </a>
        ) : (
          <button key={i} type="button" className="ped-act" disabled={offline || probe} aria-disabled={offline || undefined}
            onClick={() => navigate(x.to, x.state ? { state: x.state } : undefined)}>
            {x.label}{offline && <span className="sr-only"> ({T.needsNetwork})</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function Head({ a, variant, ctx }: { a: EditionArticle; variant: "opener" | "compact" | "letter"; ctx: Ctx }) {
  const { T, lang, preview, offline, probe } = ctx;
  const title = tr(a.title, lang);
  const saved = ctx.isSaved?.(a.slug) ?? false;
  return (
    <header className={`mz-head ${variant}`}>
      <p className="ped-kicker">{txt(a.kicker, lang)}</p>
      <h2 className="mz-title">{title.text}</h2>
      {txt(a.dek, lang) && <p className="mz-dek">{txt(a.dek, lang)}</p>}
      <div className="mz-rule" />
      <p className="mz-byline">
        {txt(a.byline, lang)} · {T.readingTime(a.reading_minutes)}
        {a.fact_date ? ` · ${T.factAsOf(formatDate(a.fact_date, lang))}` : ""}
      </p>
      {variant !== "letter" && (
        <div className="mz-chips">
          <span className="ped-chip">{T.factStatus[a.fact_status]}</span>
          {a.expired && a.valid_until && <span className="ped-chip warn">{T.expired(formatDate(a.valid_until, lang))}</span>}
          {preview && a.drafted_by === "claude" && <span className="ped-chip warn">{T.aiDraft}</span>}
          {preview && a.status && <span className="ped-chip warn">{a.status}</span>}
          {ctx.onToggleSave && !preview && (
            <button type="button" className="mz-save" disabled={offline || probe} aria-pressed={saved} onClick={() => ctx.onToggleSave?.(a.slug)}>
              {saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
              {saved ? T.saved : T.save}
            </button>
          )}
        </div>
      )}
    </header>
  );
}

function ItemView({ it, part, ctx, piece }: { it: FlowItem; part: Part; ctx: Ctx; piece?: Piece }) {
  const { T, lang } = ctx;
  const from = part.from ?? 0;
  switch (it.t) {
    case "head": return <Head a={it.a} variant={it.variant} ctx={ctx} />;
    case "heroImg": return <Figure imgKey={it.image} ctx={ctx} ratio="wide" />;
    case "notice":
      return it.notice === "untranslated"
        ? <p className="mz-note context" role="note"><span className="lbl">EN</span>{T.onlySpanish}</p>
        : <aside className="mz-note" role="note"><span className="lbl">{T.correction} · {formatDate(it.a.correction!.at, lang)}</span>{it.a.correction!.note}</aside>;
    case "p": {
      const to = part.to;
      const cls = ["mz-p", it.first && from === 0 ? "first" : "", it.lead && from === 0 ? "lead" : "", from > 0 ? "cont" : "", to !== undefined ? "split" : ""].filter(Boolean).join(" ");
      return <p className={cls}>{it.words.slice(from, to).join(" ")}</p>;
    }
    case "h": return <h3 className="mz-h">{it.text}</h3>;
    case "quote":
      return (
        <figure className="mz-pull">
          <blockquote>«{it.text}»</blockquote>
          {it.cite && <figcaption>{it.cite}</figcaption>}
        </figure>
      );
    case "note":
      return <aside className={`mz-note ${it.note}`} aria-label={T.noteKind[it.note]}><span className="lbl">{T.noteKind[it.note]}</span>{it.text}</aside>;
    case "facts": {
      const rows = it.rows.slice(from, part.to);
      return (
        <section className="mz-facts" aria-label={it.title}>
          <h4>{it.title}{from > 0 ? ` · ${T.mz.continued}` : ""}</h4>
          <dl>{rows.map((r, j) => <div key={j} className="row" data-row=""><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
        </section>
      );
    }
    case "img": return <Figure imgKey={it.image} ctx={ctx} ratio={it.size === "full" ? "wide" : "std"} />;
    case "agenda": {
      const rows = it.rows.slice(from, part.to);
      return (
        <div className="mz-agenda">
          {it.past > 0 && from === 0 && <p className="ped-meta">{lang === "en" ? `${it.past} date${it.past === 1 ? " has" : "s have"} already passed and ${it.past === 1 ? "is" : "are"} not shown.` : `${it.past} fecha${it.past === 1 ? " ya pasó y no se muestra" : "s ya pasaron y no se muestran"}.`}</p>}
          <ul>
            {rows.map((r, j) => (
              <li key={j} data-row="">
                <span className="dt">{formatDate(r.date, lang, { day: "numeric", month: "short", year: "numeric" })}{r.end ? ` – ${formatDate(r.end, lang, { day: "numeric", month: "short" })}` : ""}</span>
                <span className="ev">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "meta":
      return (
        <p className="ped-meta mz-meta">
          {ctx.preview ? T.aiDraft : T.aiReviewed(it.a.approved_by_label ?? "la dirección editorial")}
          {ctx.issue ? ` · ${T.brand} ${T.issueNo(ctx.issue.number)} · ${txt(ctx.issue.period_label, lang)}` : ""}
        </p>
      );
    case "sec":
      return (
        <header className="mz-head compact">
          <p className="ped-kicker">{T.brief.sub}</p>
          <h2 className="mz-title">{T.brief.title}</h2>
          <p className="mz-dek">{T.brief.intro}</p>
          <div className="mz-rule" />
        </header>
      );
    case "briefHead":
      return (
        <header className="mz-brief-head">
          <p className="ped-kicker">{txt(it.a.kicker, lang)} · <time dateTime={it.a.fact_date}>{formatDate(it.a.fact_date, lang)}</time></p>
          <h3>{txt(it.a.title, lang)}</h3>
        </header>
      );
    case "briefSrc":
      return (
        <p className="ped-meta mz-brief-src">
          {T.sources}: {(it.a.sources ?? []).map((s, i) => <Fragment key={s.key}>{i ? " · " : ""}<a className="ped-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.entity}</a></Fragment>)}
        </p>
      );
    case "srcHead": {
      const n = piece ? piece.articles.reduce((s, a) => s + (a.sources ?? []).length, 0) : 0;
      const title = piece ? (piece.kind === "briefs" ? T.brief.title : txt(piece.articles[0].title, lang)) : "";
      return (
        <header className="mz-src-head">
          <p className="ped-kicker">{T.sources}{n ? ` · ${T.mz.sources(n)}` : ""}</p>
          <h2 className="mz-title">{title}</h2>
          <p className="ped-meta">{T.sourcesSub}</p>
          <div className="mz-rule" />
        </header>
      );
    }
    case "srcSub": return <h3 className="mz-src-sub">{txt(it.a.title, lang)}</h3>;
    case "src": {
      // Cuatro renglones (fuente, fechas, dato usado, derechos): una fuente larga puede seguir en la otra columna.
      const s = it.s;
      const rows = [
        <><span className="ent">{s.entity}</span>{s.author ? ` · ${s.author}` : ""} — <a className="ped-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></>,
        <>{s.published_at ? `${T.published} ${formatDate(s.published_at, lang)} · ` : ""}{T.consulted} {formatDate(s.consulted_at, lang)}{s.used_for ? ` · ${s.used_for}` : ""}</>,
        <span className="opacity-80">{s.data_used}</span>,
        <span className="opacity-70">{s.reuse_rights}</span>,
      ];
      const to = part.to ?? rows.length;
      return (
        <div className={`mz-src ${from > 0 ? "cont" : ""}`} data-src={s.key} data-src-start={from === 0 ? "" : undefined}>
          {rows.slice(from, to).map((r, j) => <span key={j} className="r" data-row="">{r}</span>)}
        </div>
      );
    }
    case "actions": return <ActionsBlock a={it.a} ctx={ctx} />;
    case "tocHead":
      return (
        <header className="mz-toc-head">
          <p className="ped-kicker">{T.mz.contentsSub}</p>
          <h2 className="mz-toc-title">{T.mz.contents}</h2>
          {ctx.ed && <p className="ped-meta">{T.readingTotal(ctx.ed.readingMinutes)}{ctx.ed.hidden.length ? ` · ${T.hiddenByYou(ctx.ed.hidden.length)}` : ""}</p>}
        </header>
      );
    case "tocNote":
      return (
        <div className="mz-toc-note" data-testid={ctx.probe ? undefined : "mz-toc-note"}>
          <p>{ctx.ed?.personalized ? T.personalizedNote : T.mz.commonLine}</p>
          {ctx.personalizeHref && (
            ctx.probe ? <span className="mz-personalize">{T.mz.personalize}</span>
              : <Link to={ctx.personalizeHref} className="mz-personalize" data-testid="mz-personalize-toc">{T.mz.personalize}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
          )}
        </div>
      );
    case "tocSec": return <h3 className="mz-toc-sec">{it.title}</h3>;
    case "tocEntry": {
      const pg = ctx.pageOf(it.a.slug);
      const inner = (
        <>
          <span className="n" aria-hidden="true">{it.n === null ? "+" : String(it.n).padStart(2, "0")}</span>
          <span className="tx"><span className="t">{txt(it.a.title, lang)}</span>{it.n !== null && (it.a.format === "feature" || it.a.format === "letter") && txt(it.a.dek, lang) && <span className="d">{txt(it.a.dek, lang)}</span>}</span>
          <span className="pg">{ctx.probe ? "00" : pg ?? ""}</span>
        </>
      );
      if (ctx.probe) return <div className="mz-toc-entry">{inner}</div>;
      return (
        <button type="button" className="mz-toc-entry" data-testid="mz-toc-entry" onClick={() => ctx.jump(it.a.slug)}
          aria-label={pg ? T.mz.goTo(txt(it.a.title, lang), pg) : txt(it.a.title, lang)}>{inner}</button>
      );
    }
    case "tocOpp": {
      const inner = (
        <>
          <span className="n" aria-hidden="true">◆</span>
          <span className="tx"><span className="t">{T.opp.title}</span><span className="d">{T.opp.sub}</span></span>
          <span className="pg" aria-hidden="true">›</span>
        </>
      );
      if (ctx.probe || !ctx.opportunitiesHref) return <div className="mz-toc-entry">{inner}</div>;
      return <Link to={ctx.opportunitiesHref} className="mz-toc-entry">{inner}</Link>;
    }
    default: return null;
  }
}

function FlowBody({ flow, items, ctx, piece }: { flow: FlowPage; items: FlowItem[]; ctx: Ctx; piece?: Piece }) {
  return (
    <div className="mz-body mz-flow">
      {flow.segments.map((s, i) => "span" in s ? (
        <div key={i} className="mz-it span"><ItemView it={items[s.span.id]} part={s.span} ctx={ctx} piece={piece} /></div>
      ) : (
        <div key={i} className="mz-cols" data-n={s.cols.length}>
          {s.cols.map((col, j) => (
            <div key={j} className="mz-col">
              {col.map((p) => <div key={`${p.id}:${p.from ?? 0}`} className="mz-it"><ItemView it={items[p.id]} part={p} ctx={ctx} piece={piece} /></div>)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}


// ───────────────────────────── lector ─────────────────────────────
export function MagazineReader(props: MagazineReaderProps) {
  const { issue, ed, single, images, lang, startSlug = null, offline = false, preview = false, onExit, memberName } = props;
  const personalizeHref = offline ? null : props.personalizeHref ?? null;
  const opportunitiesHref = offline ? null : props.opportunitiesHref ?? null;
  const T = editionText(lang);
  const rootRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ W: number; H: number }>(() => availableBox(null));
  const [fontTick, setFontTick] = useState(0);
  const geo = useMemo(() => geometry(box.W, box.H), [box.W, box.H]);
  const spread = geo.layout === "spread";
  const issueKey = issue?.slug ?? null;
  const persist = !!ed && !!issueKey;

  // Piezas y flujos (dependen del idioma y del número; no del tamaño).
  const pieces = useMemo<Piece[]>(() => {
    if (ed) return buildPieces(ed, images, preview);
    if (!single) return [];
    const heroOk = !!single.hero_image && imageAllowed(images[single.hero_image], "online", preview);
    const kind = single.format === "brief" ? "briefs" : single.format === "letter" ? "letter" : single.format === "feature" && heroOk ? "feature" : "article";
    return [{ key: single.slug, kind, section: single.section, articles: [single], hero: kind === "feature" ? single.hero_image! : null }];
  }, [ed, single, images, preview]);
  const flows = useMemo(() => {
    const m = new Map<string, FlowItem[]>();
    if (ed) m.set("toc", tocFlow(ed, (k) => T.sections[k] ?? k, T.moreTime, !!opportunitiesHref && ed.sections.some((s) => s.key === "oportunidades")));
    for (const p of pieces) { m.set(`b:${p.key}`, bodyFlow(p, lang, images, preview)); m.set(`e:${p.key}`, endFlow(p, lang)); }
    return m;
  }, [ed, pieces, lang, images, preview, T, opportunitiesHref]);
  const pieceByKey = useMemo(() => new Map(pieces.map((p) => [p.key, p])), [pieces]);

  // Paginación: la sonda se monta, se mide y se desmonta (antes de pintar).
  const sig = `${geo.pageW}x${geo.pageH}:${geo.cols}:${lang}:${fontTick}:${pieces.length}:${flows.size}`;
  const [plan, setPlan] = useState<{ sig: string; pages: MagPage[] } | null>(null);
  const measuring = plan?.sig !== sig;
  const pages = useMemo(() => plan?.pages ?? [], [plan]);
  const units = useMemo(() => spreadsOf(pages.length, spread, !!ed, !!ed), [pages.length, spread, ed]);
  const unitOfPage = useCallback((p: number) => Math.max(0, units.findIndex((u) => u.includes(p))), [units]);
  const slugPages = useMemo(() => pageOfSlug(pages, (k) => flows.get(`b:${k}`)), [pages, flows]);
  const [cur, setCur] = useState(0);
  const curRef = useRef(0);
  curRef.current = cur;
  const pagesRef = useRef<MagPage[]>([]);
  const unitsRef = useRef<number[][]>([]);
  pagesRef.current = pages;
  unitsRef.current = units;
  const started = useRef(false);
  const anchor = useRef<ReturnType<typeof markOf> | null>(null);
  const [announce, setAnnounce] = useState(false);

  // Tamaño disponible: al montar, al girar o cambiar de ancho (no por la barra de Safari que aparece).
  useLayoutEffect(() => {
    const read = () => setBox((prev) => {
      const nx = availableBox(rootRef.current);
      return nx.W !== prev.W || Math.abs(nx.H - prev.H) > 90 ? nx : prev;
    });
    setBox(availableBox(rootRef.current));
    let tm: ReturnType<typeof setTimeout> | undefined;
    const on = () => { clearTimeout(tm); tm = setTimeout(read, 160); };
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { clearTimeout(tm); window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);

  useLayoutEffect(() => {
    if (!measuring) return;
    const probe = probeRef.current;
    const real = !!probe && probe.getBoundingClientRect().width > 0;
    const dropEl = probe?.querySelector("[data-drop]") as HTMLElement | null;
    const dropMin = real && dropEl ? dropEl.getBoundingClientRect().height : 3 * geo.lineH;
    const paginate = (key: string): FlowPage[] => {
      const items = flows.get(key) ?? [];
      if (!items.length) return [];
      const m = real ? domMeasurer(probe!, key, items, dropMin, geo.lineH)
        : estimateMeasurer(items, { colW: geo.colW, fullW: geo.contentW, fontPx: geo.font, lineH: geo.lineH });
      // 4 px de margen por si una fuente cambia mínimamente al pintar.
      return paginateFlow(items, { cols: geo.cols, height: geo.contentH - 4, lineH: geo.lineH }, m);
    };
    const toc = ed ? paginate("toc") : [];
    const pf: PieceFlows[] = pieces.map((piece) => ({ piece, body: paginate(`b:${piece.key}`), end: paginate(`e:${piece.key}`) }));
    probe?.querySelectorAll("[data-clone]").forEach((n) => n.remove());
    const next = assemblePages({ cover: !!ed, toc, pieces: pf, back: !!ed, spread, offline });
    // Posición: la misma pieza que se estaba leyendo; al abrir, el artículo pedido o la última página leída.
    let target = 0;
    if (!started.current) {
      const slugMap = pageOfSlug(next, (k) => flows.get(`b:${k}`));
      if (startSlug && slugMap[startSlug] !== undefined) target = slugMap[startSlug];
      else if (persist) target = pageOfMark(next, readPageMark(issueKey!));
    } else if (anchor.current) target = pageOfMark(next, anchor.current);
    const nextUnits = spreadsOf(next.length, spread, !!ed, !!ed);
    const u = Math.max(0, nextUnits.findIndex((x) => x.includes(target)));
    anchor.current = markOf(next, nextUnits[u]?.[0] ?? 0);
    setPlan({ sig, pages: next });
    setCur(u);
    started.current = true;
  }, [measuring, sig, flows, pieces, geo, ed, spread, offline, startSlug, persist, issueKey]);

  // Colocar la pista en la unidad actual sin animación tras paginar o cambiar de tamaño.
  useLayoutEffect(() => {
    const t = trackRef.current;
    if (!t || !units.length) return;
    t.scrollLeft = cur * (t.clientWidth || geo.W);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, geo.W]);

  // Las fuentes de Privé llegan después: al terminar, se vuelve a paginar (misma pieza en pantalla).
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let alive = true;
    const bump = () => { if (alive) setFontTick((t) => t + 1); };
    void fonts.ready?.then(() => { if (alive && fonts.status === "loaded") bump(); });
    fonts.addEventListener?.("loadingdone", bump);
    return () => { alive = false; fonts.removeEventListener?.("loadingdone", bump); };
  }, []);

  // Recordar la página (por número; pieza + desplazamiento, así sirve en otra pantalla).
  useEffect(() => {
    if (!pages.length || !units[cur]) return;
    anchor.current = markOf(pages, units[cur][0]);
    if (persist) writePageMark(issueKey!, anchor.current);
  }, [cur, pages, units, persist, issueKey]);

  // Si una página real desborda (no debería), hace scroll vertical en vez de cortar el texto.
  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const id = requestAnimationFrame(() => {
      t.querySelectorAll<HTMLElement>(".mz-body").forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 2) el.dataset.overflow = "1"; else delete el.dataset.overflow;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [plan, cur]);

  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const programmatic = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRef = useRef<() => void>(() => {});
  const focusAfter = useRef(false);
  const go = useCallback((u: number, opts: { focus?: boolean } = {}) => {
    const n = unitsRef.current.length;
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, u));
    setAnnounce(true);
    focusAfter.current = !!opts.focus;
    setCur(i);
    const t = trackRef.current;
    if (!t) return;
    const left = i * (t.clientWidth || 0);
    if (programmatic.current) clearTimeout(programmatic.current);
    programmatic.current = setTimeout(() => { programmatic.current = null; syncRef.current(); }, reduce ? 80 : 750);
    if (typeof t.scrollTo === "function") t.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
    else t.scrollLeft = left;
  }, [reduce]);
  const prev = useCallback(() => go(curRef.current - 1), [go]);
  const next = useCallback(() => go(curRef.current + 1), [go]);
  const jump = useCallback((slug: string) => {
    const p = slugPages[slug];
    if (p !== undefined) go(unitOfPage(p), { focus: true });
  }, [slugPages, unitOfPage, go]);

  // Deslizar (celular) o desplazamiento con el trackpad: la unidad más cercana al soltar.
  const scrollTm = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncFromScroll = useCallback(() => {
    if (programmatic.current) return;
    const t = trackRef.current;
    if (!t || !t.clientWidth) return;
    const i = Math.round(t.scrollLeft / t.clientWidth);
    if (i !== curRef.current && i >= 0 && i < unitsRef.current.length) { setAnnounce(true); setCur(i); }
  }, []);
  syncRef.current = syncFromScroll;
  const onScroll = () => {
    if (scrollTm.current) clearTimeout(scrollTm.current);
    scrollTm.current = setTimeout(syncFromScroll, 110);
  };
  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const end = () => { if (programmatic.current) { clearTimeout(programmatic.current); programmatic.current = null; } syncFromScroll(); };
    t.addEventListener("scrollend", end);
    return () => t.removeEventListener("scrollend", end);
  }, [syncFromScroll, plan]);

  // Teclado: ← → (y Re Pág / Av Pág, Inicio, Fin) mientras el lector está en pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (el && el.closest?.('[role="dialog"]')) return;
      const k = e.key;
      // Inicio/Fin solo con el foco en la revista (o en ninguna parte): en otro lado desplazan la página.
      const inside = !(el instanceof Node) || el === document.body || !!rootRef.current?.contains(el);
      if (k === "ArrowRight" || k === "PageDown") { e.preventDefault(); next(); }
      else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); prev(); }
      else if (k === "Home" && inside) { e.preventDefault(); go(0); }
      else if (k === "End" && inside) { e.preventDefault(); go(unitsRef.current.length - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go]);

  // Foco: si quedó en una página que ya no está en pantalla (o se saltó desde el índice), pasa a la nueva.
  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const unit = t.querySelector(`[data-unit="${cur}"]`) as HTMLElement | null;
    const active = document.activeElement as HTMLElement | null;
    if (unit && (focusAfter.current || (active && t.contains(active) && !unit.contains(active)))) unit.focus({ preventScroll: true });
    focusAfter.current = false;
  }, [cur]);

  const total = pages.length;
  const unit = units[cur] ?? [];
  const label = (u: number[]) => (u.length > 1 ? T.mz.pages(u[0] + 1, u[1] + 1, total) : T.mz.page((u[0] ?? 0) + 1, total));
  const curPage = pages[unit[0] ?? 0];
  const slugOfPage = (p: MagPage | undefined): string | null => {
    if (!p) return null;
    if (p.kind === "photo") return p.slug;
    if (p.kind === "body" || p.kind === "end") return pieceByKey.get(p.piece)?.articles[0]?.slug ?? null;
    return null;
  };

  const ctx: Ctx = {
    lang, T, images, issue, ed, offline, preview, isSaved: props.isSaved, onToggleSave: props.onToggleSave, jump,
    pageOf: (s) => (slugPages[s] !== undefined ? slugPages[s] + 1 : null), personalizeHref, opportunitiesHref, probe: false,
  };
  const period = issue ? txt(issue.period_label, lang) : "";
  const folio = (n: number) => [String(n), T.brand, period].filter(Boolean).join(" · ");

  const renderPage = (idx: number, side: "left" | "right" | "solo", live: boolean): ReactNode => {
    const p = pages[idx];
    const common = { "data-testid": "mz-page", "data-kind": p.kind, "data-page": idx + 1, "data-side": side } as const;
    if (!live) return <div key={idx} {...common} className={`mz-page ${side}`} />;
    const piece = "piece" in p ? pieceByKey.get(p.piece) : undefined;
    const runhead = (text: string) => <p className="mz-runhead" aria-hidden="true"><span>{text}</span></p>;
    const foot = <p className="mz-folio" data-testid="mz-folio">{folio(idx + 1)}</p>;
    switch (p.kind) {
      case "cover": return <div key={idx} {...common} className={`mz-page ${side} cover`}><CoverPage ctx={ctx} memberName={memberName ?? null} /></div>;
      case "back": return <div key={idx} {...common} className={`mz-page ${side} back`}><BackPage ctx={ctx} onCover={() => go(0, { focus: true })} /></div>;
      case "photo": {
        const img = images[p.image];
        return (
          <div key={idx} {...common} className={`mz-page ${side} photo`}>
            {runhead(piece ? T.sections[piece.section] ?? "" : "")}
            {img && <PhotoPage img={img} ctx={ctx} />}
            {foot}
          </div>
        );
      }
      case "ad": return <div key={idx} {...common} className={`mz-page ${side} ad`}><HousePage ad={p.ad} ctx={ctx} />{foot}</div>;
      case "toc":
        return (
          <div key={idx} {...common} className={`mz-page ${side} flow`}>
            {runhead(issue ? `${T.issueNo(issue.number)} · ${period}` : T.mz.contents)}
            <FlowBody flow={p.flow} items={flows.get("toc") ?? []} ctx={ctx} />
            {foot}
          </div>
        );
      default: {
        const key = p.kind === "end" ? `e:${p.piece}` : `b:${p.piece}`;
        const head = piece ? (piece.kind === "briefs" ? T.brief.title : T.sections[piece.section] ?? "") : "";
        return (
          <div key={idx} {...common} className={`mz-page ${side} flow ${p.kind === "end" ? "end" : ""}`} data-slug={piece?.articles[0]?.slug}>
            {runhead(p.kind === "end" ? T.sources : head)}
            <FlowBody flow={p.flow} items={flows.get(key) ?? []} ctx={ctx} piece={piece} />
            {foot}
          </div>
        );
      }
    }
  };

  const style = {
    "--mz-page-w": `${geo.pageW}px`, "--mz-page-h": `${geo.pageH}px`, "--mz-pad-x": `${geo.padX}px`, "--mz-pad-top": `${geo.padTop}px`,
    "--mz-folio": `${geo.folioH}px`, "--mz-content-h": `${geo.contentH}px`, "--mz-font": `${geo.font}px`, "--mz-lh": `${geo.lineH}px`,
    "--mz-gap": `${geo.gap}px`, height: `${geo.H}px`,
  } as CSSProperties;
  const statusText = total ? label(unit) : "";
  const atStart = cur <= 0;
  const atEnd = cur >= units.length - 1;

  return (
    <section ref={rootRef} className="mz" data-layout={geo.layout} data-cols={geo.cols} data-testid="mz-reader" style={style}
      aria-roledescription={T.mz.carousel} aria-label={[T.brand, issue ? T.issueNo(issue.number) : "", period].filter(Boolean).join(" · ")}>
      <div className="mz-stage" style={{ height: geo.stageH }}>
        {geo.layout !== "phone" && (
          <button type="button" className="mz-edge prev" onClick={prev} disabled={atStart} aria-label={T.mz.prev} data-testid="mz-edge-prev">
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
          </button>
        )}
        <div className="mz-track" ref={trackRef} onScroll={onScroll} aria-label={T.mz.reader}>
          {units.map((u, ui) => {
            const live = Math.abs(ui - cur) <= 2;
            const isCur = ui === cur;
            return (
              <div key={ui} className="mz-unit" role="group" aria-roledescription={u.length > 1 ? T.mz.spread : T.mz.slide} aria-label={label(u)}
                data-unit={ui} data-current={isCur || undefined} tabIndex={-1} aria-hidden={!isCur || undefined} {...(!isCur ? INERT : {})}>
                <div className={`mz-sheet n${u.length}`}>
                  {u.map((pi, k) => renderPage(pi, u.length === 1 ? "solo" : k === 0 ? "left" : "right", live))}
                </div>
              </div>
            );
          })}
        </div>
        {geo.layout !== "phone" && (
          <button type="button" className="mz-edge next" onClick={next} disabled={atEnd} aria-label={T.mz.next} data-testid="mz-edge-next">
            <ChevronRight className="h-7 w-7" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mz-controls" style={{ height: geo.ctrlH }}>
        <button type="button" className="mz-ctl arrow" onClick={prev} disabled={atStart} aria-label={T.mz.prev} data-testid="mz-prev"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
        {ed && (
          <button type="button" className="mz-ctl wide index" onClick={() => go(unitOfPage(pages.findIndex((p) => p.kind === "toc")), { focus: true })} data-testid="mz-contents">
            <List className="h-4 w-4" aria-hidden="true" /><span>{T.mz.contents}</span>
          </button>
        )}
        <div className="mz-status">
          <p role="status" aria-live={announce ? "polite" : "off"} aria-atomic="true" data-testid="mz-status">{statusText}</p>
          <div className="mz-progress" aria-hidden="true"><span style={{ transform: `scaleX(${units.length > 1 ? cur / (units.length - 1) : 1})` }} /></div>
        </div>
        <button type="button" className="mz-ctl wide exit" onClick={() => onExit(slugOfPage(curPage))} title={T.mz.continuousHint} aria-label={T.mz.continuous} data-testid="mz-exit">
          <ScrollText className="h-4 w-4" aria-hidden="true" /><span>{T.mz.continuous}</span>
        </button>
        <button type="button" className="mz-ctl arrow" onClick={next} disabled={atEnd} aria-label={T.mz.next} data-testid="mz-next"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {measuring && (
        <div className="mz-probe" ref={probeRef} aria-hidden="true" {...INERT}>
          <div className="mz-flow" style={{ width: geo.colW }}><div className="mz-it" data-drop=""><p className="mz-p first lead">M</p></div></div>
          {[...flows.entries()].map(([key, items]) => (
            <div key={key} className="mz-flow">
              {items.map((it) => (
                <div key={it.id} className={`mz-it ${it.span ? "span" : ""}`} data-mid={`${key}:${it.id}`} style={{ width: it.span ? geo.contentW : geo.colW }}>
                  <ItemView it={it} part={{ id: it.id }} ctx={{ ...ctx, probe: true }} piece={pieceByKey.get(key.slice(2))} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ───────────────────────────── páginas especiales ─────────────────────────────
function CoverPage({ ctx, memberName }: { ctx: Ctx; memberName: string | null }) {
  const { T, lang, ed, issue, images } = ctx;
  if (!issue || !ed) return null;
  const img = ed.coverImage ? images[ed.coverImage] : undefined;
  const show = imageAllowed(img, "online", ctx.preview);
  const coverArticle = ed.cover;
  const title = coverArticle && ed.personalized ? txt(coverArticle.title, lang) : txt(issue.title, lang);
  const lines = txt(issue.cover_line, lang).split(/\s+·\s+/).filter(Boolean);
  return (
    <div className="mz-cover" data-testid="mz-cover">
      {show && <img className="bg" src={img.url} alt={txt(img.alt, lang)} style={{ objectPosition: img.focal ?? "50% 40%" }} {...HIGH} />}
      <div className="shade" aria-hidden="true" />
      <header className="top">
        <p className="mast">{T.brand}</p>
        <p className="issue"><span>{T.issueNo(issue.number)} · {txt(issue.period_label, lang)}</span></p>
      </header>
      <div className="bottom">
        {memberName && <p className="ped-kicker">{T.coverFor(memberName)}</p>}
        {coverArticle && <p className="ped-kicker">{txt(coverArticle.kicker, lang)}</p>}
        <h1 className="title">
          {coverArticle ? <button type="button" onClick={() => ctx.jump(coverArticle.slug)} aria-label={`${title}. ${T.mz.coverStory}`}>{title}</button> : title}
        </h1>
        {lines.length > 0 && <ul className="lines">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        {ctx.personalizeHref && (
          <Link to={ctx.personalizeHref} className="mz-personalize on-photo" data-testid="mz-personalize-cover">{T.mz.personalize}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        )}
        {show && (
          <p className="credit">{img.illustrative ? `${T.illustrative} · ` : ""}{T.photo}: <a href={img.page_url} target="_blank" rel="noopener noreferrer">{img.photographer} / Pexels</a> · {img.license}</p>
        )}
        <p className="hint" aria-hidden="true"><span className="phone-only">{T.mz.swipe}</span><span className="wide-only">{T.mz.keys}</span></p>
      </div>
    </div>
  );
}

function PhotoPage({ img, ctx }: { img: EditionImage; ctx: Ctx }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="mz-photo" data-image={img.key}>
      {!failed && <img src={img.url} alt={txt(img.alt, ctx.lang)} loading="lazy" decoding="async" style={{ objectPosition: img.focal ?? "50% 50%" }} onError={() => setFailed(true)} />}
      {img.license_status === "pending" && <span className="ped-pending">{ctx.T.licensePending}</span>}
      <figcaption className="mz-photo-cap"><Credit img={img} lang={ctx.lang} /></figcaption>
    </figure>
  );
}

function HousePage({ ad, ctx }: { ad: "mine" | "flight" | "library" | "brand"; ctx: Ctx }) {
  const { T } = ctx;
  const data = {
    mine: { k: T.nav.mine, t: T.mz.houseMine, d: T.section.chooseToPersonalize, cta: T.mz.personalize, to: "/prive/edicion/mi-edicion" },
    flight: { k: T.nav.flight, t: T.mz.houseFlight, d: T.flight.intro, cta: T.section.flight, to: "/prive/edicion/vuelo" },
    library: { k: T.nav.library, t: T.mz.houseLibrary, d: T.library.sub, cta: T.section.library, to: "/prive/edicion/biblioteca" },
    brand: { k: null, t: T.mz.houseBrand, d: T.section.pitch, cta: null, to: null },
  }[ad];
  return (
    <div className="mz-house" data-ad={ad}>
      <Monogram size={64} />
      {data.k ? <p className="ped-kicker">{data.k.brand} · {data.k.sub}</p> : <p className="ped-kicker">{T.brand}</p>}
      <p className="t">{data.t}</p>
      <p className="d">{data.d}</p>
      {data.cta && data.to && !ctx.offline && <Link to={data.to} className="ped-btn ghost">{data.cta}</Link>}
    </div>
  );
}

function BackPage({ ctx, onCover }: { ctx: Ctx; onCover: () => void }) {
  const { T, lang, issue } = ctx;
  return (
    <div className="mz-back" data-testid="mz-back">
      <p className="ped-kicker">{T.mz.endOfIssue}</p>
      <Monogram size={92} />
      <p className="mast">{T.brand}</p>
      <p className="tag">{lang === "en" ? T.tagline : T.taglineSub}</p>
      {issue && <p className="ped-meta">IATOS Privé · {T.issueNo(issue.number)} · {txt(issue.period_label, lang)}</p>}
      {issue?.research_closed_at && <p className="ped-meta">{T.mz.researchClosed(formatDate(issue.research_closed_at, lang))}</p>}
      <div className="acts">
        <button type="button" className="ped-btn ghost" onClick={onCover}>{T.mz.backToCover}</button>
        {ctx.personalizeHref && <Link to={ctx.personalizeHref} className="ped-btn">{T.mz.personalize}</Link>}
      </div>
    </div>
  );
}

