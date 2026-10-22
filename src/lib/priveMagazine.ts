/**
 * THE PRIVATE EDITION · modo revista (lógica pura, sin React ni red).
 *
 * Convierte un número (ya personalizado con personalizeIssue) en una revista paginada: portada, índice,
 * apertura de cada reportaje (foto a sangre + página de título), cuerpo en columnas, página de fuentes y
 * «Del artículo a la experiencia», contraportada. La paginación es por bloques del cuerpo con un
 * presupuesto de altura MEDIDO (Measurer): los párrafos se parten por palabras en un límite de línea y las
 * listas por filas, así nunca se corta texto. Sin DOM (pruebas), un medidor estimado da el mismo resultado
 * determinista.
 */
import { blockText, imageAllowed, resolveAction, txt, upcomingAgenda, type EditionArticle, type EditionImage, type EditionSource, type Lang, type PersonalizedEdition } from "@/lib/priveEdition";

// ───────────────────────────── piezas y elementos del flujo ─────────────────────────────
export type PieceKind = "letter" | "feature" | "article" | "briefs";
export interface Piece { key: string; kind: PieceKind; section: string; articles: EditionArticle[]; hero: string | null }

type Base = { id: number; span: boolean; kind: "text" | "list" | "atomic"; keep?: boolean; slug?: string; est: number };
export type FlowItem = Base & (
  | { t: "head"; a: EditionArticle; variant: "opener" | "compact" | "letter" }
  | { t: "heroImg"; image: string; a: EditionArticle }
  | { t: "notice"; a: EditionArticle; notice: "untranslated" | "correction" }
  | { t: "p"; words: string[]; first: boolean; lead: boolean }
  | { t: "h"; text: string }
  | { t: "quote"; text: string; cite: string }
  | { t: "note"; note: "analysis" | "context" | "disclaimer"; text: string }
  | { t: "facts"; title: string; rows: { label: string; value: string }[] }
  | { t: "img"; image: string; size: "full" | "half" }
  | { t: "agenda"; rows: { date: string; end?: string; text: string }[]; past: number }
  | { t: "meta"; a: EditionArticle }
  | { t: "sec" }
  | { t: "briefHead"; a: EditionArticle }
  | { t: "briefSrc"; a: EditionArticle }
  | { t: "srcHead" }
  | { t: "srcSub"; a: EditionArticle }
  | { t: "src"; s: EditionSource }
  | { t: "actions"; a: EditionArticle }
  | { t: "tocHead" }
  | { t: "tocNote" }
  | { t: "tocSec"; title: string }
  | { t: "tocEntry"; a: EditionArticle; n: number | null }
  | { t: "tocOpp" }
);
type Draft = FlowItem extends infer F ? F extends FlowItem ? Omit<F, "id"> : never : never;

/** Separa en palabras sin romper espacios duros (U+00A0). */
export const words = (s: string) => s.split(/[ \t\r\n]+/).filter(Boolean);
const len = (s: string | undefined | null) => (s ?? "").length;

/** Orden de lectura: secciones del miembro (sin Opportunities) y luego «si tienes más tiempo»; breves juntos. */
export function buildPieces(ed: PersonalizedEdition, images: Record<string, EditionImage>, preview = false): Piece[] {
  const list: { a: EditionArticle; section: string }[] = [
    ...ed.sections.filter((s) => s.key !== "oportunidades").flatMap((s) => s.articles.map((a) => ({ a, section: s.key as string }))),
    ...ed.moreTime.map((a) => ({ a, section: a.section as string })),
  ];
  const out: Piece[] = [];
  for (const { a, section } of list) {
    if (a.format === "brief") {
      const last = out[out.length - 1];
      if (last?.kind === "briefs") { last.articles.push(a); continue; }
      out.push({ key: `briefs:${a.slug}`, kind: "briefs", section: "world_brief", articles: [a], hero: null });
      continue;
    }
    const heroOk = !!a.hero_image && imageAllowed(images[a.hero_image], "online", preview);
    const kind: PieceKind = a.format === "letter" ? "letter" : a.format === "feature" && heroOk ? "feature" : "article";
    out.push({ key: a.slug, kind, section, articles: [a], hero: kind === "feature" ? a.hero_image! : null });
  }
  return out;
}

const untranslatedIn = (a: EditionArticle, lang: Lang) =>
  lang === "en" && (!a.title.en || (a.body ?? []).some((b) => "es" in b && !(b as { en?: string }).en));

/** Elementos del cuerpo de una pieza (cabecera, bloques, nota de IA). */
export function bodyFlow(piece: Piece, lang: Lang, images: Record<string, EditionImage>, preview = false): FlowItem[] {
  const d: Draft[] = [];
  const allowed = (k: string) => imageAllowed(images[k], "online", preview);
  if (piece.kind === "briefs") {
    d.push({ t: "sec", span: true, kind: "atomic", est: 150, keep: true, slug: piece.articles[0].slug });
    for (const a of piece.articles) {
      d.push({ t: "briefHead", a, span: false, kind: "atomic", keep: true, slug: a.slug, est: 40 + len(txt(a.title, lang)) * 1.4 });
      for (const b of a.body ?? []) {
        if (b.t === "p") d.push({ t: "p", words: words(blockText(b, lang)), first: false, lead: true, span: false, kind: "text", est: 0 });
        else if (b.t === "note") d.push({ t: "note", note: b.kind, text: blockText(b, lang), span: false, kind: "atomic", est: 40 + len(blockText(b, lang)) });
      }
      d.push({ t: "briefSrc", a, span: false, kind: "atomic", est: 40 });
    }
    return d.map((x, id) => ({ ...x, id }) as FlowItem);
  }
  const a = piece.articles[0];
  const variant = piece.kind === "feature" ? "opener" : piece.kind === "letter" ? "letter" : "compact";
  d.push({ t: "head", a, variant, span: true, kind: "atomic", keep: true, slug: piece.kind === "feature" ? undefined : a.slug, est: variant === "opener" ? 300 : 220 });
  if (piece.kind === "article" && a.hero_image && allowed(a.hero_image)) d.push({ t: "heroImg", image: a.hero_image, a, span: true, kind: "atomic", est: 320 });
  if (untranslatedIn(a, lang)) d.push({ t: "notice", a, notice: "untranslated", span: false, kind: "atomic", est: 90 });
  if (a.correction) d.push({ t: "notice", a, notice: "correction", span: false, kind: "atomic", est: 60 + len(a.correction.note) });
  let first = true;
  let prev = "";
  for (const b of a.body ?? []) {
    const lead = prev !== "p";
    prev = b.t;
    switch (b.t) {
      case "p": d.push({ t: "p", words: words(blockText(b, lang)), first, lead, span: false, kind: "text", est: 0 }); first = false; break;
      case "h": d.push({ t: "h", text: blockText(b, lang), span: false, kind: "atomic", keep: true, est: 60 }); break;
      case "quote": d.push({ t: "quote", text: blockText(b, lang), cite: txt(b.cite, lang), span: true, kind: "atomic", est: 90 + len(blockText(b, lang)) * 0.6 }); break;
      case "note": d.push({ t: "note", note: b.kind, text: blockText(b, lang), span: false, kind: "atomic", est: 50 + len(blockText(b, lang)) }); break;
      case "facts": d.push({ t: "facts", title: txt(b.title, lang), rows: b.items.map((it) => ({ label: txt(it.label, lang), value: txt(it.value, lang) })), span: false, kind: "list", est: 50 }); break;
      case "img": if (allowed(b.image)) d.push({ t: "img", image: b.image, size: b.size === "full" ? "full" : "half", span: b.size === "full", kind: "atomic", est: b.size === "full" ? 340 : 260 }); break;
      case "agenda": {
        const ag = upcomingAgenda(b.items);
        d.push({ t: "agenda", rows: ag.items.map((it) => ({ date: it.date, end: it.end, text: blockText(it, lang) })), past: ag.past, span: false, kind: "list", est: 30 });
        break;
      }
      default: break;
    }
  }
  if (a.drafted_by === "claude" || a.drafted_by === "human") d.push({ t: "meta", a, span: false, kind: "atomic", est: 50 });
  return d.map((x, id) => ({ ...x, id }) as FlowItem);
}

const hasActions = (a: EditionArticle, lang: Lang) => (a.actions ?? []).some((x) => !!resolveAction(x, lang));

/** Página final de la pieza: fuentes y «Del artículo a la experiencia». Vacía si la pieza no tiene ninguna. */
export function endFlow(piece: Piece, lang: Lang): FlowItem[] {
  const withSomething = piece.articles.filter((a) => (a.sources ?? []).length || hasActions(a, lang));
  if (!withSomething.length) return [];
  const d: Draft[] = [{ t: "srcHead", span: true, kind: "atomic", keep: true, est: 90 }];
  const grouped = piece.articles.length > 1;
  for (const a of withSomething) {
    if (grouped) d.push({ t: "srcSub", a, span: false, kind: "atomic", keep: true, est: 40 });
    for (const s of a.sources ?? []) d.push({ t: "src", s, span: false, kind: "list", est: 70 + (len(s.data_used) + len(s.reuse_rights) + len(s.title)) * 0.55 });
    if (hasActions(a, lang)) d.push({ t: "actions", a, span: !grouped, kind: "atomic", est: 150 });
  }
  return d.map((x, id) => ({ ...x, id }) as FlowItem);
}

/** Índice: cabecera, línea de personalización, secciones con sus piezas (número de entrada) y Opportunities. */
export function tocFlow(ed: PersonalizedEdition, sectionTitle: (k: string) => string, moreTimeTitle: string, withOpportunities: boolean): FlowItem[] {
  const d: Draft[] = [{ t: "tocHead", span: true, kind: "atomic", est: 120 }, { t: "tocNote", span: true, kind: "atomic", est: 70 }];
  let n = 0;
  for (const s of ed.sections) {
    if (s.key === "oportunidades" || !s.articles.length) continue;
    d.push({ t: "tocSec", title: sectionTitle(s.key), span: false, kind: "atomic", keep: true, est: 34 });
    for (const a of s.articles) d.push({ t: "tocEntry", a, n: ++n, span: false, kind: "atomic", est: 64 + len(txt(a.dek, "es")) * 0.35 });
  }
  if (ed.moreTime.length) {
    d.push({ t: "tocSec", title: moreTimeTitle, span: false, kind: "atomic", keep: true, est: 34 });
    for (const a of ed.moreTime) d.push({ t: "tocEntry", a, n: null, span: false, kind: "atomic", est: 50 });
  }
  if (withOpportunities) d.push({ t: "tocOpp", span: false, kind: "atomic", est: 70 });
  return d.map((x, id) => ({ ...x, id }) as FlowItem);
}

// ───────────────────────────── paginación ─────────────────────────────
/** Mide alturas reales (o estimadas) en px del ancho que corresponda (columna o todo el ancho). */
export interface Measurer {
  h(id: number): number;
  textH(id: number, from: number): number;
  /** Cuántas palabras desde `from` caben en `limit` px (0 si no caben 2 líneas) y su altura. */
  textFit(id: number, from: number, limit: number): { n: number; h: number };
  listH(id: number, from: number): number;
  listFit(id: number, from: number, limit: number): { n: number; h: number };
}
export interface Part { id: number; from?: number; to?: number; /** alto medido de este tramo (px) */ h?: number }
export type Segment = { span: Part } | { cols: Part[][] };
export interface FlowPage { segments: Segment[] }
export interface PaginateOpts { cols: 1 | 2; height: number; lineH: number }

type Cur = { i: number; from: number };
const EPS = 0.5;

function minNeed(it: FlowItem | undefined, m: Measurer, lineH: number): number {
  if (!it) return 0;
  if (it.kind === "text") return Math.min(m.textH(it.id, 0), 2 * lineH + 6);
  if (it.kind === "list") return Math.min(m.listH(it.id, 0), 4 * lineH);
  return m.h(it.id);
}
const rowsOf = (it: FlowItem) => (it.t === "facts" || it.t === "agenda" ? it.rows.length : it.t === "src" ? 4 : 1);

function fillColumn(items: FlowItem[], cur: Cur, limit: number, m: Measurer, lineH: number, force = false): { parts: Part[]; used: number; cur: Cur; full: boolean } {
  const parts: Part[] = [];
  let used = 0;
  let c = { ...cur };
  while (c.i < items.length) {
    const it = items[c.i];
    if (it.span) break;
    const rem = limit - used;
    if (it.kind === "text" || it.kind === "list") {
      const full = it.kind === "text" ? m.textH(it.id, c.from) : m.listH(it.id, c.from);
      if (full <= rem + EPS) { parts.push({ id: it.id, from: c.from, h: full }); used += full; c = { i: c.i + 1, from: 0 }; continue; }
      const f = it.kind === "text" ? m.textFit(it.id, c.from, rem) : m.listFit(it.id, c.from, rem);
      if (f.n > 0) { parts.push({ id: it.id, from: c.from, to: c.from + f.n, h: f.h }); used += f.h; c = { i: c.i, from: c.from + f.n }; }
      else if (used === 0 && force) { parts.push({ id: it.id, from: c.from, h: full }); used += full; c = { i: c.i + 1, from: 0 }; }
      return { parts, used, cur: c, full: true };
    }
    const h = m.h(it.id);
    if (h > rem + EPS) {
      if (used === 0 && force) { parts.push({ id: it.id, h }); used += h; c = { i: c.i + 1, from: 0 }; }
      return { parts, used, cur: c, full: true };
    }
    if (it.keep && used > 0) {
      const nx = items[c.i + 1];
      if (nx && !nx.span && h + minNeed(nx, m, lineH) > rem + EPS) return { parts, used, cur: c, full: true };
    }
    parts.push({ id: it.id, h });
    used += h;
    c = { i: c.i + 1, from: 0 };
  }
  return { parts, used, cur: c, full: false };
}

function runHeight(items: FlowItem[], cur: Cur, m: Measurer): number {
  let s = 0;
  for (let i = cur.i; i < items.length && !items[i].span; i++) {
    const it = items[i];
    const from = i === cur.i ? cur.from : 0;
    s += it.kind === "text" ? m.textH(it.id, from) : it.kind === "list" ? m.listH(it.id, from) : m.h(it.id);
  }
  return s;
}

/**
 * Reparte un flujo en páginas de `cols` columnas y `height` px. Los elementos «span» ocupan todo el ancho
 * (cabecera, cita destacada, foto grande); el texto entre ellos se equilibra en dos columnas cuando cabe.
 */
export function paginateFlow(items: FlowItem[], opts: PaginateOpts, m: Measurer): FlowPage[] {
  const { cols, height: H, lineH } = opts;
  const pages: FlowPage[] = [];
  let c: Cur = { i: 0, from: 0 };
  let guard = 0;
  while (c.i < items.length && guard++ < 2000) {
    const segs: Segment[] = [];
    let y = 0;
    const start = { ...c };
    while (c.i < items.length) {
      const it = items[c.i];
      if (it.span) {
        const h = m.h(it.id);
        if (y > 0 && y + h > H + EPS) break;
        const nx = items[c.i + 1];
        if (it.keep && y > 0 && nx && y + h + minNeed(nx, m, lineH) > H + EPS) break;
        segs.push({ span: { id: it.id, h } });
        y += h;
        c = { i: c.i + 1, from: 0 };
        continue;
      }
      const avail = H - y;
      if (y > 0 && avail < minNeed(it, m, lineH) - EPS) break;
      if (cols === 1) {
        const r = fillColumn(items, c, avail, m, lineH, y === 0);
        if (!r.parts.length) break;
        segs.push({ cols: [r.parts] });
        y += r.used;
        c = r.cur;
        if (r.full) break;
        continue;
      }
      const total = runHeight(items, c, m);
      let a = null as ReturnType<typeof fillColumn> | null;
      let b = null as ReturnType<typeof fillColumn> | null;
      if (total <= 2 * avail) {
        const target = Math.min(avail, Math.ceil(total / 2) + lineH * 0.5);
        const a1 = fillColumn(items, c, target, m, lineH, y === 0);
        const b1 = fillColumn(items, a1.cur, avail, m, lineH);
        if (!b1.full && a1.parts.length) { a = a1; b = b1; }
      }
      if (!a || !b) { a = fillColumn(items, c, avail, m, lineH, y === 0); b = fillColumn(items, a.cur, avail, m, lineH); }
      if (!a.parts.length && !b.parts.length) break;
      segs.push({ cols: [a.parts, b.parts] });
      y += Math.max(a.used, b.used);
      c = b.cur;
      if (b.full || (a.full && !b.parts.length)) break;
    }
    if (c.i === start.i && c.from === start.from) {
      // Nada cupo (página demasiado baja): se coloca el elemento solo para no entrar en bucle.
      const it = items[c.i];
      segs.push(it.span ? { span: { id: it.id } } : { cols: [[{ id: it.id, from: c.from }]] });
      c = { i: c.i + 1, from: 0 };
    }
    pages.push({ segments: segs });
  }
  return pages;
}

// ───────────────────────────── medidor estimado (sin DOM) ─────────────────────────────
/** Estimación determinista por caracteres: la usan las pruebas (jsdom no maqueta) y es el respaldo. */
export function estimateMeasurer(items: FlowItem[], opts: { colW: number; fullW: number; fontPx: number; lineH: number }): Measurer {
  const cpl = (w: number) => Math.max(18, Math.floor(w / (opts.fontPx * 0.5)));
  const byId = new Map(items.map((it) => [it.id, it]));
  const width = (it: FlowItem) => (it.span ? opts.fullW : opts.colW);
  const textLines = (ws: string[], w: number) => {
    let lines = 1; let col = 0; const max = cpl(w);
    for (const x of ws) { const l = x.length + (col ? 1 : 0); if (col + l > max && col > 0) { lines++; col = x.length; } else col += l; }
    return lines;
  };
  const PAD = opts.lineH * 0.4;
  const rowH = (it: FlowItem, r: number) => {
    if (it.t === "facts") return (Math.ceil((it.rows[r].label.length + it.rows[r].value.length) / cpl(opts.colW)) + 0.4) * opts.lineH;
    if (it.t === "agenda") return (Math.ceil(it.rows[r].text.length / cpl(opts.colW)) + 1.2) * opts.lineH;
    if (it.t === "src") {
      const s = it.s;
      const t = [`${s.entity} ${s.author ?? ""} ${s.title}`, `${s.published_at ?? ""} ${s.consulted_at} ${s.used_for ?? ""}`, s.data_used, s.reuse_rights][r] ?? "";
      return Math.max(1, Math.ceil(t.length / cpl(opts.colW))) * opts.lineH * 0.85;
    }
    return opts.lineH;
  };
  const chrome = (it: FlowItem) => (it.t === "facts" ? 2.2 * opts.lineH : it.t === "agenda" ? (it.past ? 2 : 0.6) * opts.lineH : it.t === "src" ? 0.8 * opts.lineH : 0);
  const m: Measurer = {
    h(id) {
      const it = byId.get(id)!;
      if (it.kind === "text") return m.textH(id, 0);
      if (it.kind === "list") return m.listH(id, 0);
      return Math.max(opts.lineH, it.est * (opts.lineH / 26));
    },
    textH(id, from) {
      const it = byId.get(id)!;
      if (it.t !== "p") return m.h(id);
      return textLines(it.words.slice(from), width(it)) * opts.lineH + PAD;
    },
    textFit(id, from, limit) {
      const it = byId.get(id)!;
      if (it.t !== "p") return { n: 0, h: 0 };
      const maxLines = Math.floor((limit - PAD) / opts.lineH);
      if (maxLines < 2) return { n: 0, h: 0 };
      const ws = it.words.slice(from);
      let lo = 0;
      for (let k = 1; k <= ws.length; k++) { if (textLines(ws.slice(0, k), width(it)) <= maxLines) lo = k; else break; }
      return lo > 0 && lo < ws.length ? { n: lo, h: textLines(ws.slice(0, lo), width(it)) * opts.lineH + PAD } : { n: 0, h: 0 };
    },
    listH(id, from) {
      const it = byId.get(id)!;
      let s = chrome(it);
      for (let r = from; r < rowsOf(it); r++) s += rowH(it, r);
      return s;
    },
    listFit(id, from, limit) {
      const it = byId.get(id)!;
      let s = chrome(it); let n = 0;
      for (let r = from; r < rowsOf(it); r++) { if (s + rowH(it, r) > limit) break; s += rowH(it, r); n++; }
      return n > 0 && from + n < rowsOf(it) ? { n, h: s } : { n: 0, h: 0 };
    },
  };
  return m;
}

// ───────────────────────────── páginas de la revista ─────────────────────────────
export type HouseAd = "mine" | "flight" | "library" | "brand";
export type MagPage =
  | { kind: "cover"; piece: "cover" }
  | { kind: "toc"; piece: "toc"; flow: FlowPage }
  | { kind: "photo"; piece: string; slug: string; image: string }
  | { kind: "body"; piece: string; flow: FlowPage; first: boolean }
  | { kind: "end"; piece: string; flow: FlowPage }
  | { kind: "ad"; piece: string; ad: HouseAd }
  | { kind: "back"; piece: "back" };

export interface PieceFlows { piece: Piece; body: FlowPage[]; end: FlowPage[] }

/**
 * Secuencia de páginas. En pliego (dos páginas), la foto de apertura cae siempre en página par (izquierda)
 * y el título en la impar de enfrente; si no, se intercala una página de la casa (como en la revista impresa).
 */
export function assemblePages(opts: { cover: boolean; toc: FlowPage[]; pieces: PieceFlows[]; back: boolean; spread: boolean; offline?: boolean }): MagPage[] {
  const out: MagPage[] = [];
  if (opts.cover) out.push({ kind: "cover", piece: "cover" });
  for (const f of opts.toc) out.push({ kind: "toc", piece: "toc", flow: f });
  const ads: HouseAd[] = opts.offline ? ["brand"] : ["mine", "flight", "library"];
  let adN = 0;
  const filler = (piece: string) => { out.push({ kind: "ad", piece: `ad:${piece}`, ad: ads[adN++ % ads.length] }); };
  // Con portada sola, las páginas izquierdas son los índices impares (2, 4… en número de página).
  const isLeft = (i: number) => (opts.cover ? i % 2 === 1 : i % 2 === 0);
  for (const pf of opts.pieces) {
    const { piece } = pf;
    if (piece.kind === "feature" && piece.hero) {
      if (opts.spread && !isLeft(out.length)) filler(piece.key);
      out.push({ kind: "photo", piece: piece.key, slug: piece.articles[0].slug, image: piece.hero });
    }
    pf.body.forEach((flow, i) => out.push({ kind: "body", piece: piece.key, flow, first: i === 0 }));
    pf.end.forEach((flow) => out.push({ kind: "end", piece: piece.key, flow }));
  }
  if (opts.back) {
    // La contraportada va sola: el último pliego interior se completa con una página de la casa.
    if (opts.spread && !isLeft(out.length)) filler("back");
    out.push({ kind: "back", piece: "back" });
  }
  return out;
}

/** Unidades de lectura: una página (celular) o pliegos [portada], [2,3], [4,5]…, [contraportada] (computadora). */
export function spreadsOf(count: number, spread: boolean, coverAlone: boolean, backAlone = false): number[][] {
  const units: number[][] = [];
  if (!spread) { for (let i = 0; i < count; i++) units.push([i]); return units; }
  let i = 0;
  const end = backAlone ? count - 1 : count;
  if (coverAlone && count) { units.push([0]); i = 1; }
  for (; i < end; i += 2) units.push(i + 1 < end ? [i, i + 1] : [i]);
  if (backAlone && count > 1) units.push([count - 1]);
  return units;
}

/** Primera página de cada artículo (para el índice y para abrir un artículo). */
export function pageOfSlug(pages: MagPage[], flowsById: (piece: string) => FlowItem[] | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  pages.forEach((p, idx) => {
    if (p.kind === "photo") { map[p.slug] ??= idx; return; }
    if (p.kind !== "body") return;
    const items = flowsById(p.piece);
    if (!items) return;
    for (const s of p.flow.segments) {
      const parts = "span" in s ? [s.span] : s.cols.flat();
      for (const part of parts) { const it = items[part.id]; if (it?.slug && (part.from ?? 0) === 0) map[it.slug] ??= idx; }
    }
  });
  return map;
}

// ───────────────────────────── última página leída ─────────────────────────────
export const PAGE_KEY = (issue: string) => `iatos_edition_page:${issue}`;
export interface PageMark { piece: string; offset: number }
export function readPageMark(issue: string): PageMark | null {
  try {
    const raw = localStorage.getItem(PAGE_KEY(issue));
    if (!raw) return null;
    const v = JSON.parse(raw) as PageMark;
    return v && typeof v.piece === "string" && Number.isFinite(v.offset) ? v : null;
  } catch { return null; }
}
export function writePageMark(issue: string, mark: PageMark) {
  try { localStorage.setItem(PAGE_KEY(issue), JSON.stringify(mark)); } catch { /* modo privado o sin espacio */ }
}
/** La marca (pieza + desplazamiento) sobrevive a otro tamaño de pantalla: se busca la misma pieza. */
export function markOf(pages: MagPage[], idx: number): PageMark {
  const p = pages[idx];
  if (!p) return { piece: "cover", offset: 0 };
  const first = pages.findIndex((x) => x.piece === p.piece);
  return { piece: p.piece, offset: Math.max(0, idx - first) };
}
export function pageOfMark(pages: MagPage[], mark: PageMark | null): number {
  if (!mark) return 0;
  const first = pages.findIndex((x) => x.piece === mark.piece);
  if (first < 0) return 0;
  let last = first;
  while (last + 1 < pages.length && pages[last + 1].piece === mark.piece) last++;
  return Math.min(last, first + mark.offset);
}

// ───────────────────────────── vista: revista o continua ─────────────────────────────
export type EditionView = "magazine" | "continuous";
const VIEW_KEY = "iatos_edition_view";
/** La revista es lo predeterminado; la vista continua se recuerda solo durante la visita (sessionStorage). */
export function readView(): EditionView {
  try { return sessionStorage.getItem(VIEW_KEY) === "continuous" ? "continuous" : "magazine"; } catch { return "magazine"; }
}
export function writeView(v: EditionView) {
  try { if (v === "continuous") sessionStorage.setItem(VIEW_KEY, v); else sessionStorage.removeItem(VIEW_KEY); } catch { /* modo privado */ }
}
