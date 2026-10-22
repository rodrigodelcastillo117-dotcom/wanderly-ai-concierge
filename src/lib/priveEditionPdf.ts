/**
 * PDF premium de THE PRIVATE EDITION (número completo o Flight Edition), generado en el navegador con la
 * librería que la app ya usa (jsPDF, chunk vendor-pdf). Se carga con import() solo al pulsar "Descargar
 * PDF": no pesa en el paquete inicial ni en las páginas de lectura.
 *
 * Maquetación: portada a sangre con la foto con licencia, índice con páginas, apertura de cada artículo
 * (antetítulo, título, entradilla, firma, foto con crédito), cuerpo a dos columnas, citas destacadas,
 * recuadros de datos, notas de análisis/aviso, fuentes al final de cada pieza, oportunidades con su fecha,
 * página de créditos y licencias, y pie con número de página y fecha de generación.
 * Solo se incrustan imágenes con licencia aprobada que PERMITEN uso en PDF (allow_pdf). Si una no carga,
 * la pieza sale sin ella (nunca un hueco ni una foto sin crédito).
 */
import type jsPDFType from "jspdf";
import {
  blockText, formatDate, imageAllowed, imageCredit, txt, type Block, type EditionArticle, type EditionImage, type IssuePayload, type Lang,
  type Opportunity, type PracticalGuide, resolveAction, todayInMexicoCity, upcomingAgenda,
} from "@/lib/priveEdition";
import { editionText } from "@/lib/priveEditionI18n";

export interface PdfInput {
  payload: IssuePayload;
  articles: EditionArticle[];          // selección y orden ya decididos (edición del miembro o Flight Edition)
  lang: Lang;
  kind: "issue" | "flight";
  memberName?: string | null;          // solo si el miembro pidió su nombre en la portada
  destinationLabel?: string | null;    // Flight Edition: destino o viaje
  opportunities?: Opportunity[] | null;
  opportunitiesAsOf?: string | null;
  guide?: PracticalGuide | null;       // Flight Edition: guía práctica del destino (Insider), con fuentes
  appOrigin?: string;                  // para enlaces "Abrir en IATOS"
  now?: Date;
}
export interface PdfDeps {
  jsPDF?: typeof jsPDFType;
  loadImage?: (url: string) => Promise<Uint8Array | null>;
}
export interface PdfResult { bytes: Uint8Array; pages: number; imagesEmbedded: number; ms: number; filename: string }

type RGB = [number, number, number];
const GOLD: RGB = [176, 141, 72];
const GOLD_LIGHT: RGB = [232, 220, 194];
const INK: RGB = [24, 22, 20];
const GREY: RGB = [112, 106, 98];
const PAPER_TINT: RGB = [246, 242, 233];
const BLACK: RGB = [9, 9, 9];

/** Las fuentes estándar del PDF solo cubren Latin-1: se sustituyen los signos tipográficos que no lo están. */
export function pdfSafe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[‒–—―−]/g, "-")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, "...")
    .replace(/[→➔]/g, "->")
    .replace(/€/g, "EUR")
    .replace(/\u00A0/g, " ")
    .split("").filter((ch) => { const c = ch.charCodeAt(0); return c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff); }).join("");
}

async function defaultLoadImage(url: string): Promise<Uint8Array | null> {
  try {
    if (typeof caches !== "undefined") {
      const hit = await caches.match(url, { cacheName: "iatos-edition-v1" });
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    const r = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

const imageFormat = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 ? "PNG" : "JPEG");

export async function buildEditionPdf(input: PdfInput, deps: PdfDeps = {}): Promise<PdfResult> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const JsPDF = deps.jsPDF ?? (await import("jspdf")).default;
  const loadImage = deps.loadImage ?? defaultLoadImage;
  const { payload, lang } = input;
  const T = editionText(lang);
  const issue = payload.issue!;
  const images = payload.images ?? {};
  const now = input.now ?? new Date();
  const generated = `${formatDate(now.toISOString(), lang)} · ${now.toLocaleTimeString(lang === "en" ? "en-GB" : "es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })} (CDMX)`;

  const doc = new JsPDF({ unit: "pt", format: "letter", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  const TOP = 64;
  const BOTTOM = H - 58;
  const GAP = 20;
  const COLW = (W - 2 * M - GAP) / 2;
  let embedded = 0;
  const usedImages = new Map<string, EditionImage>();

  // Imágenes: se descargan una vez.
  const bytesCache = new Map<string, Promise<Uint8Array | null>>();
  const getBytes = (img: EditionImage) => {
    if (!bytesCache.has(img.url)) bytesCache.set(img.url, loadImage(img.url));
    return bytesCache.get(img.url)!;
  };

  const setFill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const setText = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const setDraw = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const font = (family: "times" | "helvetica", style: "normal" | "bold" | "italic" | "bolditalic", size: number) => {
    doc.setFont(family, style);
    doc.setFontSize(size);
  };
  const opacity = (o: number) => {
    const G = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
    (doc as unknown as { setGState: (g: unknown) => void }).setGState(new G({ opacity: o }));
  };

  /** Foto recortada tipo "cover" dentro de un rectángulo. Devuelve false si no se pudo incrustar. */
  async function drawImage(img: EditionImage | undefined, x: number, y: number, w: number, h: number): Promise<boolean> {
    if (!imageAllowed(img, "pdf")) return false;
    const bytes = await getBytes(img);
    if (!bytes || bytes.length < 100) return false;
    try {
      const fmt = imageFormat(bytes);
      const props = doc.getImageProperties(bytes);
      const scale = Math.max(w / props.width, h / props.height);
      const dw = props.width * scale;
      const dh = props.height * scale;
      const [fx, fy] = (img.focal ?? "50% 50%").split(" ").map((p) => Math.min(100, Math.max(0, parseFloat(p))) / 100);
      const dx = x - (dw - w) * (Number.isFinite(fx) ? fx : 0.5);
      const dy = y - (dh - h) * (Number.isFinite(fy) ? fy : 0.5);
      doc.saveGraphicsState();
      doc.rect(x, y, w, h, null as unknown as string);
      doc.clip();
      doc.discardPath();
      doc.addImage(bytes, fmt, dx, dy, dw, dh, img.url, "FAST");
      doc.restoreGraphicsState();
      embedded++;
      usedImages.set(img.key, img);
      return true;
    } catch {
      return false;
    }
  }

  // ───────────── portada ─────────────
  const coverKey = input.kind === "flight"
    ? (input.articles.find((a) => a.hero_image && imageAllowed(images[a.hero_image], "pdf"))?.hero_image ?? issue.cover_image)
    : issue.cover_image;
  setFill(BLACK);
  doc.rect(0, 0, W, H, "F");
  const hasCover = await drawImage(coverKey ? images[coverKey] : undefined, 0, 0, W, H);
  if (hasCover) {
    // Velo para que el texto se lea sobre cualquier foto.
    setFill(BLACK);
    opacity(0.35); doc.rect(0, 0, W, H, "F");
    for (let i = 0; i < 12; i++) { opacity(0.05); doc.rect(0, H * 0.45 + i * (H * 0.55 / 12), W, H, "F"); }
    for (let i = 0; i < 6; i++) { opacity(0.07); doc.rect(0, 0, W, 150 - i * 22, "F"); }
    opacity(1);
  }
  setText(GOLD_LIGHT);
  font("times", "normal", 30);
  doc.text(pdfSafe(T.brand), W / 2, 78, { align: "center", charSpace: 2.2 });
  setDraw(GOLD); doc.setLineWidth(0.6); doc.line(W / 2 - 90, 92, W / 2 + 90, 92);
  font("times", "italic", 12);
  doc.text(pdfSafe(T.tagline), W / 2, 110, { align: "center" });
  font("helvetica", "bold", 8);
  setText(GOLD_LIGHT);
  const issueLine = `${T.issueNo(issue.number)} · ${txt(issue.period_label, lang).toUpperCase()}`;
  doc.text(pdfSafe(issueLine), W / 2, 128, { align: "center", charSpace: 1.4 });
  if (input.kind === "flight") {
    font("helvetica", "bold", 9);
    setText(GOLD);
    doc.text(pdfSafe(`FLIGHT EDITION${input.destinationLabel ? " · " + input.destinationLabel.toUpperCase() : ""}`), W / 2, 146, { align: "center", charSpace: 1.6 });
  }
  setText([255, 255, 255]);
  font("times", "normal", 44);
  const coverTitle = input.kind === "flight" && input.destinationLabel ? input.destinationLabel : txt(issue.title, lang);
  const titleLines = doc.splitTextToSize(pdfSafe(coverTitle), W - 2 * M) as string[];
  let cy = H - 170 - (titleLines.length - 1) * 46;
  doc.text(titleLines, M, cy);
  cy += titleLines.length * 46 - 16;
  font("times", "italic", 13);
  setText(GOLD_LIGHT);
  const coverLines = doc.splitTextToSize(pdfSafe(txt(issue.cover_line, lang)), W - 2 * M) as string[];
  doc.text(coverLines.slice(0, 3), M, cy);
  font("helvetica", "normal", 7.5);
  setText([220, 214, 200]);
  const nameLine = input.memberName ? `${T.coverFor(input.memberName)} · ` : "";
  doc.text(pdfSafe(`${nameLine}${T.flight.generated} ${generated}`), M, H - 40);
  if (hasCover && coverKey && images[coverKey]) {
    doc.text(pdfSafe(imageCredit(images[coverKey], lang)), W - M, H - 40, { align: "right" });
  }

  // ───────────── índice (se dibuja al final, cuando se conocen las páginas) ─────────────
  doc.addPage();
  const indexPage = doc.getNumberOfPages();
  const startPage = new Map<string, number>();

  // ───────────── motor de columnas ─────────────
  let col = 0;
  let y = TOP;
  let colTop = TOP;
  const colX = () => M + col * (COLW + GAP);
  const newPage = () => { doc.addPage(); col = 0; y = TOP; colTop = TOP; };
  const nextColumn = () => { if (col === 0) { col = 1; y = colTop; } else newPage(); };
  const ensure = (h: number) => { if (y + h > BOTTOM) nextColumn(); };

  const writeLines = (text: string, size: number, lh: number, style: "normal" | "italic" | "bold" = "normal", color: RGB = INK, fam: "times" | "helvetica" = "times", width = COLW, x0?: () => number) => {
    font(fam, style, size);
    setText(color);
    const lines = doc.splitTextToSize(pdfSafe(text), width) as string[];
    for (const ln of lines) {
      ensure(lh);
      doc.text(ln, (x0 ?? colX)(), y + size);
      y += lh;
    }
  };

  async function writeBlock(b: Block) {
    switch (b.t) {
      case "p":
        writeLines(blockText(b, lang), 10.2, 14.2);
        y += 7;
        return;
      case "h":
        ensure(40);
        y += 6;
        writeLines(blockText(b, lang), 13, 16, "bold");
        y += 4;
        return;
      case "quote": {
        ensure(70);
        setDraw(GOLD); doc.setLineWidth(0.8);
        doc.line(colX(), y + 2, colX() + 40, y + 2);
        y += 12;
        writeLines(`«${blockText(b, lang)}»`, 15, 19, "italic", GOLD);
        if (b.cite) writeLines(`— ${txt(b.cite, lang)}`, 8, 11, "normal", GREY, "helvetica");
        y += 12;
        return;
      }
      case "note": {
        const label = (T.noteKind[b.kind] ?? "").toUpperCase();
        font("times", "italic", 9.5);
        const lines = doc.splitTextToSize(pdfSafe(blockText(b, lang)), COLW - 16) as string[];
        const h = 22 + lines.length * 13;
        ensure(Math.min(h, BOTTOM - TOP));
        setFill(PAPER_TINT); doc.rect(colX(), y, COLW, h, "F");
        setFill(GOLD); doc.rect(colX(), y, 2, h, "F");
        font("helvetica", "bold", 6.8); setText(GOLD);
        doc.text(pdfSafe(label), colX() + 9, y + 12, { charSpace: 1 });
        font("times", "italic", 9.5); setText(INK);
        doc.text(lines, colX() + 9, y + 25);
        y += h + 10;
        return;
      }
      case "facts": {
        const rows = b.items.map((it) => ({ l: pdfSafe(txt(it.label, lang)), v: doc.splitTextToSize(pdfSafe(txt(it.value, lang)), COLW - 16) as string[] }));
        const h = 24 + rows.reduce((s, r) => s + 12 + r.v.length * 11.5, 0);
        ensure(Math.min(h, BOTTOM - TOP));
        setDraw(GOLD); doc.setLineWidth(0.6); doc.rect(colX(), y, COLW, h, "S");
        font("helvetica", "bold", 7); setText(GOLD);
        doc.text(pdfSafe(txt(b.title, lang).toUpperCase()), colX() + 8, y + 14, { charSpace: 0.8 });
        let yy = y + 26;
        for (const r of rows) {
          font("helvetica", "bold", 7.5); setText(GREY); doc.text(r.l, colX() + 8, yy + 2);
          font("times", "normal", 9.5); setText(INK); doc.text(r.v, colX() + 8, yy + 13);
          yy += 12 + r.v.length * 11.5;
        }
        y += h + 10;
        return;
      }
      case "img": {
        const img = images[b.image];
        if (!imageAllowed(img, "pdf")) return;
        const h = b.size === "full" ? COLW * 0.75 : COLW * 0.62;
        ensure(h + 30);
        const ok = await drawImage(img, colX(), y, COLW, h);
        if (!ok) return;
        y += h + 4;
        writeLines(imageCredit(img, lang), 6.5, 8.5, "normal", GREY, "helvetica");
        writeLines(txt(img.depicts, lang), 6.5, 8.5, "italic", GREY, "helvetica");
        y += 8;
        return;
      }
      case "agenda":
        // Solo fechas que no han terminado a la fecha de generación.
        for (const it of upcomingAgenda(b.items, todayInMexicoCity(input.now ?? new Date())).items) {
          const when = it.end ? `${formatDate(it.date, lang, { day: "numeric", month: "short" })} - ${formatDate(it.end, lang, { day: "numeric", month: "short", year: "numeric" })}`
            : formatDate(it.date, lang, { day: "numeric", month: "short", year: "numeric" });
          ensure(30);
          writeLines(when.toUpperCase(), 7.5, 10, "bold", GOLD, "helvetica");
          writeLines(blockText(it, lang), 10, 13.5);
          y += 6;
        }
        return;
    }
  }

  // ───────────── artículos ─────────────
  for (const a of input.articles) {
    newPage();
    startPage.set(a.slug, doc.getNumberOfPages());
    // Apertura a todo el ancho.
    font("helvetica", "bold", 7.5); setText(GOLD);
    doc.text(pdfSafe(txt(a.kicker, lang).toUpperCase()), M, y, { charSpace: 1.2 });
    y += 14;
    font("times", "normal", a.format === "brief" ? 22 : 30); setText(INK);
    const tl = doc.splitTextToSize(pdfSafe(txt(a.title, lang)), W - 2 * M) as string[];
    const tlh = a.format === "brief" ? 25 : 33;
    doc.text(tl, M, y + tlh - 6);
    y += tl.length * tlh + 4;
    if (txt(a.dek, lang)) {
      font("times", "italic", 13); setText(GREY);
      const dl = doc.splitTextToSize(pdfSafe(txt(a.dek, lang)), W - 2 * M) as string[];
      doc.text(dl, M, y + 10);
      y += dl.length * 16 + 6;
    }
    font("helvetica", "normal", 7.5); setText(GREY);
    const meta = [txt(a.byline, lang), T.readingTime(a.reading_minutes), T.factStatus[a.fact_status] ?? "",
      a.fact_date ? T.factAsOf(formatDate(a.fact_date, lang)) : ""].filter(Boolean).join("  ·  ");
    doc.text(pdfSafe(meta), M, y + 6);
    y += 14;
    setDraw(GOLD); doc.setLineWidth(0.5); doc.line(M, y, W - M, y);
    y += 14;
    const hero = a.hero_image ? images[a.hero_image] : undefined;
    if (hero && imageAllowed(hero, "pdf")) {
      const hh = Math.min(250, BOTTOM - y - 160);
      if (hh > 120 && await drawImage(hero, M, y, W - 2 * M, hh)) {
        y += hh + 4;
        font("helvetica", "normal", 6.5); setText(GREY);
        doc.text(pdfSafe(`${imageCredit(hero, lang)} — ${txt(hero.depicts, lang)}`), M, y + 6, { maxWidth: W - 2 * M });
        y += 18;
      }
    }
    colTop = y; col = 0;
    for (const b of a.body ?? []) await writeBlock(b);
    if (a.correction) writeLines(`${T.correction} (${formatDate(a.correction.at, lang)}): ${a.correction.note}`, 8.5, 11, "italic", GREY);
    // Fuentes de la pieza.
    if (a.sources?.length) {
      ensure(40); y += 6;
      writeLines(T.sources.toUpperCase(), 7, 10, "bold", GOLD, "helvetica");
      for (const s of a.sources) {
        const dates = [s.published_at ? `${T.published} ${formatDate(s.published_at, lang)}` : "", `${T.consulted} ${formatDate(s.consulted_at, lang)}`].filter(Boolean).join("; ");
        writeLines(`${s.entity} — ${s.title}. ${s.url} (${dates}).${s.used_for ? " " + s.used_for + "." : ""}`, 6.8, 8.8, "normal", GREY, "helvetica");
        y += 2;
      }
    }
    // From Page to Experience: rutas reales de la app y enlaces oficiales.
    const acts = (a.actions ?? []).map((x) => resolveAction(x, lang)).filter(Boolean);
    if (acts.length) {
      ensure(30); y += 6;
      writeLines(`${T.fromPage.toUpperCase()} · ${T.fromPageSub}`, 7, 10, "bold", GOLD, "helvetica");
      for (const act of acts) {
        const href = act!.kind === "external" ? act!.href : `${input.appOrigin ?? ""}${act!.to}`;
        ensure(11);
        font("helvetica", "normal", 7.5); setText(INK);
        if (/^https:\/\//.test(href)) doc.textWithLink(pdfSafe(`> ${act!.label}`), colX(), y + 7.5, { url: href });
        else doc.text(pdfSafe(`> ${act!.label}`), colX(), y + 7.5);
        y += 11;
      }
      writeLines(T.offlineNoBooking, 6.5, 8.5, "italic", GREY, "helvetica");
    }
  }

  // ───────────── Guía práctica del destino (Insider's Notebook, con fuente y fecha) ─────────────
  if (input.guide && input.guide.tips.length) {
    newPage();
    font("helvetica", "bold", 7.5); setText(GOLD);
    doc.text(pdfSafe(T.flight.guideKicker.toUpperCase()), M, y, { charSpace: 1.2 });
    y += 26;
    font("times", "normal", 24); setText(INK);
    doc.text(pdfSafe(T.flight.guideTitle(input.guide.destination)), M, y);
    y += 22;
    writeLines(T.flight.guideNote(formatDate(input.guide.as_of, lang)), 8, 11, "italic", GREY, "helvetica", W - 2 * M, () => M);
    y += 6; colTop = y;
    for (const tip of input.guide.tips) {
      writeLines(txt(tip.title, lang), 11.5, 14.5, "bold");
      writeLines(txt(tip.body, lang), 9.4, 13);
      writeLines(`${T.opp.source}: ${tip.source.name} · ${tip.source.url} · ${T.flight.checked} ${formatDate(tip.source.checked_at, lang)}`, 6.8, 9, "normal", GREY, "helvetica");
      y += 9;
    }
  }

  // ───────────── Privé Opportunities (con su fecha) ─────────────
  if (input.opportunities) {
    newPage();
    font("helvetica", "bold", 7.5); setText(GOLD);
    doc.text("PRIVÉ OPPORTUNITIES", M, y, { charSpace: 1.2 });
    y += 26;
    font("times", "normal", 24); setText(INK);
    doc.text(pdfSafe(T.opp.sub), M, y);
    y += 22;
    writeLines(T.opp.asOf(input.opportunitiesAsOf ? formatDate(input.opportunitiesAsOf, lang) : generated), 8, 11, "italic", GREY, "helvetica", W - 2 * M, () => M);
    y += 6; colTop = y;
    if (input.opportunities.length === 0) writeLines(T.opp.none, 10.2, 14.2);
    for (const o of input.opportunities) {
      writeLines(txt(o.title, lang), 12, 15, "bold");
      writeLines(`${o.provider.name} · ${txt(o.benefit, lang)}`, 9.5, 13);
      if (o.conditions) writeLines(`${T.opp.conditions}: ${txt(o.conditions, lang)}`, 8.5, 11.5, "normal", GREY);
      if (o.valid_until) writeLines(`${T.opp.validUntil} ${formatDate(o.valid_until, lang)} · ${T.opp.verified} ${formatDate(o.last_verified_at, lang)}`, 8, 11, "normal", GREY, "helvetica");
      writeLines(`${T.opp.source}: ${o.source.url}`, 7, 9.5, "normal", GREY, "helvetica");
      y += 10;
    }
  }

  // ───────────── créditos y licencias ─────────────
  newPage();
  font("helvetica", "bold", 7.5); setText(GOLD);
  doc.text(pdfSafe(T.credits.toUpperCase()), M, y, { charSpace: 1.2 });
  y += 26; font("times", "normal", 24); setText(INK);
  doc.text(pdfSafe(T.brand), M, y);
  y += 20; colTop = y;
  const fullW = W - 2 * M;
  const at = () => M;
  writeLines(`${T.flight.generated} ${generated}.${issue.research_closed_at ? ` ${lang === "en" ? "Research closed on" : "Investigación cerrada el"} ${formatDate(issue.research_closed_at, lang)}.` : ""}`, 9, 12.5, "normal", INK, "helvetica", fullW, at);
  writeLines(T.flight.privacy, 9, 12.5, "normal", INK, "helvetica", fullW, at);
  writeLines(lang === "en"
    ? "Original IATOS texts, prepared with AI assistance and reviewed by the editorial team. Facts are attributed to the sources listed after each story; links lead to the originals."
    : "Textos originales de IATOS, preparados con asistencia de IA y revisados por la dirección editorial. Los hechos se atribuyen a las fuentes listadas tras cada pieza; los enlaces llevan a los originales.", 9, 12.5, "normal", INK, "helvetica", fullW, at);
  y += 8;
  writeLines(lang === "en" ? "PHOTOGRAPHY" : "FOTOGRAFÍA", 7.5, 10, "bold", GOLD, "helvetica", fullW, at);
  for (const img of usedImages.values()) {
    writeLines(`${imageCredit(img, lang)}. ${txt(img.depicts, lang)} ${img.page_url ?? ""} — ${img.license_url ?? ""}`, 7.5, 10, "normal", GREY, "helvetica", fullW, at);
    y += 2;
  }
  if (usedImages.size === 0) writeLines(lang === "en" ? "This edition has no photographs." : "Esta edición no lleva fotografías.", 8, 11, "italic", GREY, "helvetica", fullW, at);
  y += 6;
  writeLines(lang === "en" ? "Personal copy for the member. Do not redistribute." : "Copia personal del miembro. No redistribuir.", 8, 11, "italic", GREY, "helvetica", fullW, at);

  // ───────────── índice ─────────────
  doc.setPage(indexPage);
  y = TOP;
  font("helvetica", "bold", 7.5); setText(GOLD);
  doc.text(pdfSafe(T.contentsSub.toUpperCase()), M, y, { charSpace: 1.2 });
  y += 34; font("times", "normal", 34); setText(INK);
  doc.text(pdfSafe(T.contents), M, y);
  y += 18; setDraw(GOLD); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 22;
  let lastSection = "";
  for (const a of input.articles) {
    if (y > BOTTOM - 40) break;
    if (a.section !== lastSection) {
      lastSection = a.section;
      font("helvetica", "bold", 7); setText(GOLD);
      doc.text(pdfSafe((T.sections[a.section] ?? a.section).toUpperCase()), M, y, { charSpace: 1 });
      y += 15;
    }
    font("times", "normal", 13); setText(INK);
    const pg = String(startPage.get(a.slug) ?? "");
    const tl = (doc.splitTextToSize(pdfSafe(txt(a.title, lang)), W - 2 * M - 80) as string[])[0];
    doc.text(tl, M, y);
    font("helvetica", "normal", 8); setText(GREY);
    doc.text(pdfSafe(`${a.reading_minutes} min`), W - M - 34, y, { align: "right" });
    font("times", "bold", 12); setText(GOLD);
    doc.text(pg, W - M, y, { align: "right" });
    y += 19;
  }

  // ───────────── pies de página ─────────────
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    setDraw(GOLD); doc.setLineWidth(0.4); doc.line(M, H - 40, W - M, H - 40);
    font("helvetica", "normal", 6.8); setText(GREY);
    doc.text(pdfSafe(`${T.brand} · ${T.issueNo(issue.number)} · ${txt(issue.period_label, lang)}${input.kind === "flight" ? " · Flight Edition" : ""}`), M, H - 28);
    doc.text(pdfSafe(`${T.flight.generated} ${generated}`), W / 2, H - 28, { align: "center" });
    doc.text(`${p} / ${total}`, W - M, H - 28, { align: "right" });
  }

  doc.setProperties({
    title: pdfSafe(`${T.brand} ${T.issueNo(issue.number)} - ${txt(issue.period_label, lang)}`),
    subject: pdfSafe(T.tagline), author: "IATOS Privé", creator: "IATOS · The Private Edition",
  });
  const buf = doc.output("arraybuffer") as ArrayBuffer;
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const filename = `the-private-edition-${String(issue.number).padStart(2, "0")}${input.kind === "flight" ? "-flight" : ""}-${lang}.pdf`;
  return { bytes: new Uint8Array(buf), pages: total, imagesEmbedded: embedded, ms: Math.round(t1 - t0), filename };
}

/** Descarga el PDF en el navegador. */
export function downloadPdf(result: PdfResult) {
  const blob = new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * iPhone/iPad: además de la descarga (Safari abre el visor del PDF), ofrece la hoja de compartir para
 * "Guardar en Archivos" o AirDrop. Debe llamarse desde un toque del usuario. Devuelve false si no se puede.
 */
export async function sharePdf(result: PdfResult): Promise<boolean> {
  try {
    const file = new File([result.bytes as Uint8Array<ArrayBuffer>], result.filename, { type: "application/pdf" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!nav.share || !nav.canShare?.({ files: [file] })) return false;
    await nav.share({ files: [file], title: result.filename });
    return true;
  } catch { return false; }
}
