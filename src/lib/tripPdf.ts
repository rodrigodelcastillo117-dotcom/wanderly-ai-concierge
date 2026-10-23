/**
 * PDF del viaje ("Compartir PDF" en la página del viaje). Se carga con import() solo al tocar el botón:
 * jsPDF (chunk vendor-pdf), este módulo y las fuentes (public/fonts/pdf/*.ttf, ~190 KB) no pesan al
 * abrir el viaje.
 *
 * Qué dice cada página lo decide tripPdfModel.ts con la misma lógica que la página (total, "Comprar",
 * hotel elegido por ciudad, filtros de tarifas, road trip). Aquí solo se maqueta:
 *  - Fraunces (títulos) y Manrope (texto) incrustadas, con → ★ ✓ dibujados en la propia fuente: el texto
 *    se lee y se copia bien (antes la fuente estándar del PDF convertía "→" en "!'" y espaciaba letras).
 *  - Portada con foto (la del viaje o una ilustrativa de Pexels, con crédito), índice, resumen de ruta y
 *    total, lista "Comprar y reservar" con enlaces clicables, una sección por ciudad con foto pequeña e
 *    itinerario por Mañana/Tarde/Noche, "Antes de manejar" y datos útiles. Pie con número de página.
 *  - Sin títulos huérfanos: cada título reserva sitio para lo que sigue; las tarjetas no se parten.
 *  - Dos temas: oscuro (marca) e "Imprimir en blanco".
 */
import type jsPDFType from "jspdf";
import { buildTripPdfModel, kmLabel, hoursLabel, type BuyRow, type PdfCity, type PdfDay, type PdfLink, type TripPdfModel, type TripPdfOptions } from "@/lib/tripPdfModel";

export type { TripPdfOptions, TripPdfModel } from "@/lib/tripPdfModel";
export { buildTripPdfModel, pageTotalsFor, SITE_DOMAIN } from "@/lib/tripPdfModel";

export type PdfTheme = "dark" | "light";
export type PdfPhoto = { bytes: Uint8Array; credit: string | null };
export type PhotoRequest = { kind: "cover" | "city"; url: string | null; query: string; city?: string };
export type TripPdfDeps = {
  jsPDF?: typeof jsPDFType;
  /** Bytes de cada fuente (nombre de archivo en public/fonts/pdf). null = fuente estándar (sin Unicode). */
  loadFont?: (file: string) => Promise<Uint8Array | null>;
  /** Foto de portada / de cada ciudad, con su crédito. null = sin foto (la página se ve bien sin ella). */
  loadPhoto?: (req: PhotoRequest) => Promise<PdfPhoto | null>;
};
export type TripPdfResult = { bytes: Uint8Array; pages: number; filename: string; model: TripPdfModel; fontsEmbedded: boolean; photos: number };

type RGB = [number, number, number];
type Palette = { bg: RGB; surface: RGB; line: RGB; ink: RGB; body: RGB; muted: RGB; gold: RGB; goldSoft: RGB; ok: RGB; onGold: RGB };
const PALETTES: Record<PdfTheme, Palette> = {
  dark: { bg: [11, 11, 12], surface: [24, 23, 21], line: [56, 52, 46], ink: [246, 241, 232], body: [216, 209, 197], muted: [152, 145, 134], gold: [201, 169, 97], goldSoft: [222, 199, 146], ok: [118, 199, 152], onGold: [14, 12, 10] },
  light: { bg: [255, 255, 255], surface: [247, 244, 238], line: [226, 219, 205], ink: [22, 20, 18], body: [52, 48, 44], muted: [108, 101, 92], gold: [146, 112, 44], goldSoft: [150, 116, 50], ok: [32, 122, 80], onGold: [255, 255, 255] },
};

export const PDF_FONTS = {
  display: "fraunces-display.ttf",
  serif: "fraunces-semibold.ttf",
  regular: "manrope-regular.ttf",
  semibold: "manrope-semibold.ttf",
  bold: "manrope-extrabold.ttf",
} as const;
type Role = keyof typeof PDF_FONTS;
const FAMILY: Record<Role, string> = { display: "IatosDisplay", serif: "IatosSerif", regular: "IatosSans", semibold: "IatosSansSemi", bold: "IatosSansBold" };
const FALLBACK: Record<Role, [string, string]> = { display: ["times", "normal"], serif: ["times", "bold"], regular: ["helvetica", "normal"], semibold: ["helvetica", "bold"], bold: ["helvetica", "bold"] };

// Carta (612 × 792 pt).
const W = 612;
const H = 792;
const M = 54;
const CW = W - M * 2;
const TOP = 64;
const BOTTOM = H - 62;

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;
const nightsLabel = (n: number | null | undefined) => (n == null ? null : `${n} ${n === 1 ? "noche" : "noches"}`);

/** Solo Latin-1 (fuente estándar del PDF), por si no se pudieron cargar las fuentes. */
export function latin1Safe(s: string): string {
  return s
    .replace(/[‒–—―−]/g, "-").replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/…/g, "...")
    .replace(/[→➔]/g, "->").replace(/[★☆]/g, "*").replace(/✓/g, "v").replace(/↗/g, "").replace(/€/g, "EUR").replace(/ /g, " ")
    .split("").filter((ch) => { const c = ch.charCodeAt(0); return c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff); }).join("");
}

class Writer {
  doc: jsPDFType;
  p: Palette;
  y = TOP;
  fonts: boolean;
  role: Role = "regular";
  sectionPages: Array<{ label: string; page: number }> = [];

  constructor(doc: jsPDFType, theme: PdfTheme, fonts: boolean) {
    this.doc = doc;
    this.p = PALETTES[theme];
    this.fonts = fonts;
  }

  // ── Texto ──
  font(role: Role, size: number, color: RGB = this.p.body) {
    this.role = role;
    if (this.fonts) this.doc.setFont(FAMILY[role], "normal");
    else this.doc.setFont(FALLBACK[role][0], FALLBACK[role][1]);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }
  private has(cp: number): boolean {
    const meta = (this.doc.getFont() as any)?.metadata;
    return !!meta?.characterToGlyph && meta.characterToGlyph(cp) > 0;
  }
  /** Texto listo para la fuente actual: si un título trae una letra que Fraunces no tiene, va con Manrope. */
  t(text: string): string {
    const s = String(text ?? "").normalize("NFC").replace(/ /g, " ").replace(/[​-‍﻿]/g, "");
    if (!this.fonts) return latin1Safe(s);
    const missing = Array.from(s).some((ch) => ch !== "\n" && !this.has(ch.codePointAt(0)!));
    if (!missing) return s;
    if (this.role === "display" || this.role === "serif") {
      const size = this.doc.getFontSize();
      const color = this.doc.getTextColor();
      this.font("semibold", size);
      this.doc.setTextColor(color);
      return this.t(s);
    }
    // Manrope tampoco lo tiene (emoji, otros alfabetos): se omite en vez de dibujar un cuadro.
    return Array.from(s).filter((ch) => ch === "\n" || this.has(ch.codePointAt(0)!)).join("").replace(/ {2,}/g, " ");
  }
  width(text: string, charSpace = 0) {
    const s = this.t(text);
    return this.doc.getTextWidth(s) + charSpace * Math.max(0, s.length - 1);
  }
  lines(text: string, w: number): string[] {
    return this.doc.splitTextToSize(this.t(text), w) as string[];
  }
  text(text: string, x: number, y: number, opts: { align?: "left" | "right" | "center"; charSpace?: number; url?: string } = {}) {
    const s = this.t(text);
    const cs = opts.charSpace ?? 0;
    const w = this.doc.getTextWidth(s) + cs * Math.max(0, s.length - 1);
    const tx = opts.align === "right" ? x - w : opts.align === "center" ? x - w / 2 : x;
    if (cs) this.doc.setCharSpace(cs);
    this.doc.text(s, tx, y);
    if (cs) this.doc.setCharSpace(0);
    if (opts.url) this.doc.link(tx, y - this.doc.getFontSize() * 0.8, w, this.doc.getFontSize(), { url: opts.url });
    return w;
  }
  /** Párrafo con salto de línea; devuelve la altura usada. */
  para(text: string, x: number, y: number, w: number, lh: number): number {
    const ls = this.lines(text, w);
    ls.forEach((l, i) => this.doc.text(l, x, y + i * lh));
    return ls.length * lh;
  }
  paraHeight(text: string, w: number, lh: number) {
    return this.lines(text, w).length * lh;
  }
  eyebrow(text: string, x: number, y: number, color: RGB = this.p.gold, size = 7.5, align: "left" | "right" = "left") {
    this.font("bold", size, color);
    return this.text(text.toUpperCase(), x, y, { charSpace: 1.3, align });
  }

  // ── Formas ──
  fill(c: RGB) { this.doc.setFillColor(...c); }
  stroke(c: RGB, w = 0.6) { this.doc.setDrawColor(...c); this.doc.setLineWidth(w); }
  rule(x1: number, y: number, x2: number, c: RGB = this.p.line, w = 0.5) { this.stroke(c, w); this.doc.line(x1, y, x2, y); }
  card(x: number, y: number, w: number, h: number) { this.fill(this.p.surface); this.doc.roundedRect(x, y, w, h, 8, 8, "F"); }
  dash(on: boolean, pattern: number[] = [1.5, 2.5]) { (this.doc as any).setLineDashPattern?.(on ? pattern : [], 0); }
  opacity(o: number) {
    const G = (this.doc as any).GState;
    if (G) (this.doc as any).setGState(new G({ opacity: o }));
  }
  pillWidth(l: PdfLink) {
    this.font("semibold", 8.2);
    return this.width(`${l.label}  ↗`) + 20;
  }
  /** Botón-enlace clicable: "Comprar en Booking ↗". */
  linkPill(l: PdfLink, x: number, y: number, primary: boolean): number {
    const w = this.pillWidth(l);
    const h = 19;
    if (primary) { this.fill(this.p.gold); this.doc.roundedRect(x, y, w, h, 9.5, 9.5, "F"); }
    else { this.stroke(this.p.gold, 0.7); this.doc.roundedRect(x, y, w, h, 9.5, 9.5, "S"); }
    this.font("semibold", 8.2, primary ? this.p.onGold : this.p.gold);
    this.text(`${l.label}  ↗`, x + 10, y + 12.6);
    this.doc.link(x, y, w, h, { url: l.url });
    return w;
  }
  /** Fila de botones que pasa a otra línea si no cabe. Devuelve la altura. */
  linkRow(links: PdfLink[], x: number, y: number, maxW: number, draw = true): number {
    if (!links.length) return 0;
    let cx = x;
    let rows = 1;
    links.forEach((l, i) => {
      const w = this.pillWidth(l);
      if (cx + w > x + maxW && cx > x) { rows++; cx = x; }
      if (draw) this.linkPill(l, cx, y + (rows - 1) * 25, i === 0);
      cx += w + 8;
    });
    return rows * 25 - 6;
  }

  // ── Páginas ──
  background() {
    this.fill(this.p.bg);
    this.doc.rect(0, 0, W, H, "F");
  }
  newPage() {
    this.doc.addPage();
    this.background();
    this.y = TOP;
  }
  /** Abre un capítulo: en página nueva, salvo que la actual esté casi vacía (nunca una página con una sola tarjeta). */
  chapter(minSpace: number) {
    if (this.y - TOP > (BOTTOM - TOP) * 0.3 || BOTTOM - this.y < minSpace) this.newPage();
    else if (this.y > TOP) { this.y += 24; this.rule(M, this.y - 10, W - M, this.p.line, 0.5); }
  }
  /** Garantiza `h` puntos libres; si no caben, página nueva. */
  ensure(h: number) {
    if (this.y + h > BOTTOM) this.newPage();
  }
  /** Título de sección. `keep` = altura mínima de lo que sigue (el título nunca queda solo al pie). */
  section(label: string, opts: { keep?: number; index?: string; newPage?: boolean } = {}) {
    if (opts.newPage) this.newPage();
    else {
      if (this.y > TOP) this.y += 22;
      this.ensure(52 + (opts.keep ?? 80));
    }
    if (opts.index) this.sectionPages.push({ label: opts.index, page: this.doc.getNumberOfPages() });
    this.font("display", 26, this.p.ink);
    this.text(label, M, this.y + 18);
    this.y += 30;
    this.rule(M, this.y, M + 36, this.p.gold, 1);
    this.y += 22;
  }
  /** Subtítulo pequeño en dorado; reserva sitio para lo que sigue. */
  sub(label: string, keep = 60) {
    this.ensure(22 + keep);
    this.eyebrow(label, M, this.y + 8);
    this.y += 20;
  }
}

// ───────────────────────────── Imágenes ─────────────────────────────

const imageFormat = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 ? "PNG" : "JPEG");

/** Foto recortada para llenar el marco (como object-fit: cover). */
function drawCover(w: Writer, bytes: Uint8Array, x: number, y: number, bw: number, bh: number, radius = 0): boolean {
  const doc = w.doc as any;
  try {
    const props = doc.getImageProperties(bytes);
    const scale = Math.max(bw / props.width, bh / props.height);
    const iw = props.width * scale;
    const ih = props.height * scale;
    doc.saveGraphicsState();
    if (radius) doc.roundedRect(x, y, bw, bh, radius, radius, null);
    else doc.rect(x, y, bw, bh, null);
    doc.clip();
    doc.discardPath();
    doc.addImage(bytes, imageFormat(bytes), x + (bw - iw) / 2, y + (bh - ih) / 2, iw, ih, undefined, "MEDIUM");
    doc.restoreGraphicsState();
    return true;
  } catch {
    try { doc.restoreGraphicsState(); } catch { /* sin estado guardado */ }
    return false;
  }
}

// ───────────────────────────── Portada ─────────────────────────────

/** Lo más grande que quepa en 3 líneas, partiendo antes de cada "→" (la flecha va con la ciudad). */
export function titleWords(title: string): string[] {
  if (!title.includes("→")) return title.split(/\s+/).filter(Boolean);
  return title.split(/\s*→\s*/).filter(Boolean).map((part, i) => (i ? `→ ${part}` : part));
}

function fitTitle(w: Writer, title: string, maxW: number, maxH = Infinity): { size: number; lines: string[] } {
  const words = titleWords(title);
  for (let size = 54; size >= 26; size -= 2) {
    w.font("display", size);
    const ls: string[] = [];
    let cur = "";
    let ok = true;
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (w.width(next) <= maxW) { cur = next; continue; }
      if (cur) ls.push(cur);
      cur = word;
      if (w.width(word) > maxW) { ok = false; break; }
    }
    if (cur) ls.push(cur);
    if (ok && ls.length <= 3 && size * 0.9 + (ls.length - 1) * size * 1.04 <= maxH) return { size, lines: ls };
  }
  w.font("display", 26);
  return { size: 26, lines: w.lines(title, maxW).slice(0, 4) };
}

function drawCoverPage(w: Writer, m: TripPdfModel, photo: PdfPhoto | null) {
  const { p } = w;
  w.background();
  const photoH = 372;
  const hasPhoto = !!photo && drawCover(w, photo.bytes, 0, 0, W, photoH);
  if (hasPhoto) {
    // Marca sobre la foto, en una pastilla oscura (legible sobre cualquier foto).
    w.font("display", 15);
    const brandW = w.width("IATOS") + 14 + w.width("·") + 10;
    w.font("bold", 6.8);
    const tagW = w.width("TU CONCIERGE DE VIAJES", 1.3);
    w.fill([8, 8, 8]);
    w.opacity(0.62);
    w.doc.roundedRect(M - 14, 38, brandW + tagW + 28, 32, 16, 16, "F");
    w.opacity(1);
    w.font("display", 15, [255, 255, 255]);
    const bw = w.text("IATOS", M, 59);
    w.font("regular", 9, [220, 210, 190]);
    w.text("·", M + bw + 7, 58);
    w.eyebrow("Tu concierge de viajes", M + bw + 18, 57, [236, 222, 190], 6.8);
    w.rule(0, photoH, W, p.gold, 1.2);
    if (photo?.credit) { w.font("regular", 6.5, p.muted); w.text(photo.credit, W - M, photoH + 14, { align: "right" }); }
  } else {
    // Sin foto: arcos dorados muy tenues (nunca un hueco).
    w.stroke(p.gold, 0.5);
    for (let i = 0; i < 8; i++) { w.opacity(0.26 - i * 0.028); w.doc.circle(W - 40, 150, 70 + i * 34, "S"); }
    w.opacity(1);
    w.font("display", 22, p.ink);
    w.text("IATOS", M, 72);
    w.eyebrow("Tu concierge de viajes", M, 88, p.gold, 7);
  }

  // Título: se ajusta de tamaño y se parte en líneas; fechas y viajeros siempre debajo.
  // Sin foto el título sube; con foto va debajo. Lo que queda abajo (fechas y total) nunca se encima.
  let y = hasPhoto ? photoH + 42 : 300;
  if (m.country) { w.eyebrow(m.country, M, y, p.gold, 9.5); y += 12; }
  const cardH = 112;
  const below = 28 + (m.origin ? 17 : 0) + 28 + cardH + 60;
  const fit = fitTitle(w, m.title, CW, H - y - below);
  const lh = fit.size * 1.04;
  w.font("display", fit.size, p.ink);
  fit.lines.forEach((l, i) => w.text(l, M, y + fit.size * 0.9 + i * lh));
  y += fit.size * 0.9 + (fit.lines.length - 1) * lh + 28;
  w.font("semibold", 11.5, p.body);
  w.text([m.datesLabel, nightsLabel(m.nights || null), `${m.travelers} ${m.travelers === 1 ? "viajero" : "viajeros"}`].filter(Boolean).join("   ·   "), M, y);
  if (m.origin) { y += 17; w.font("regular", 10, p.muted); w.text(`Desde ${m.origin}`, M, y); }

  // Total: las mismas cifras y textos que la página.
  const cardY = Math.max(y + 28, H - 78 - cardH);
  w.card(M, cardY, CW, cardH);
  w.stroke(p.gold, 0.6);
  w.doc.roundedRect(M, cardY, CW, cardH, 8, 8, "S");
  w.eyebrow(m.travelers > 1 ? `Total para ${m.travelers} personas` : "Total para 1 persona", M + 22, cardY + 26);
  w.font("display", 34, p.ink);
  w.text(money(m.totals.total), M + 22, cardY + 62);
  w.font("semibold", 10.5, p.goldSoft);
  w.text([m.travelers > 1 ? `${money(m.totals.porPersona)} por persona` : null, nightsLabel(m.nights || null)].filter(Boolean).join("   ·   "), M + 22, cardY + 81);
  w.font("regular", 7.5, p.muted);
  w.para(m.totalNote, M + 22, cardY + 97, CW - 44, 9);

  w.font("regular", 7.5, p.muted);
  w.text(`Generado el ${m.generatedAt}`, M, H - 34);
  w.font("semibold", 8, p.gold);
  w.text(m.domain, W - M, H - 34, { align: "right", url: m.siteUrl });
}

// ───────────────────────────── Un vistazo ─────────────────────────────

function drawOverview(w: Writer, m: TripPdfModel, indexEntries: string[]): { indexY: number; indexPage: number } {
  const { p } = w;
  w.newPage();
  w.section("Tu viaje de un vistazo");

  // Resumen del concierge, como entrada (una sola vez: no se repite como "tips").
  if (m.summary) {
    w.font("regular", 10.5, p.body);
    w.y += w.para(m.summary, M, w.y + 4, CW, 14.8) + 14;
  }

  // Índice en dos columnas: los números de página se escriben al final.
  w.eyebrow("Contenido", M, w.y);
  const indexY = w.y + 18;
  const indexPage = w.doc.getNumberOfPages();
  w.y = indexY + Math.ceil(indexEntries.length / 2) * 18 + 14;

  // Ruta
  w.sub("La ruta", 110);
  const first = m.route.cities[0]?.city;
  const last = m.route.cities[m.route.cities.length - 1]?.city;
  if (m.origin && first) {
    w.font("regular", 9.5, p.muted);
    w.text(`Vuelo desde ${m.origin} a ${first}${last && last !== first ? `, regreso desde ${last}` : ""}.`, M, w.y + 4);
    w.y += 20;
  }
  const lineX = M + 6;
  m.route.cities.forEach((c, i) => {
    const next = m.route.cities[i + 1];
    const leg = next ? m.route.legs.find((l) => l.to === next.city) ?? null : null;
    w.ensure(30 + (leg ? 26 : 0));
    w.fill(p.gold);
    w.doc.circle(lineX, w.y + 7, 4, "F");
    w.font("serif", 14.5, p.ink);
    w.text(c.city, M + 22, w.y + 12);
    w.font("semibold", 9, p.body);
    w.text([nightsLabel(c.nights), c.range].filter(Boolean).join("   ·   "), W - M, w.y + 11, { align: "right" });
    w.y += 22;
    if (next) {
      w.stroke(p.gold, 0.8);
      w.dash(true);
      w.doc.line(lineX, w.y - 8, lineX, w.y + 20);
      w.dash(false);
      if (leg) {
        w.font("semibold", 8.5, p.gold);
        const lw = w.text([leg.mode, kmLabel(leg.km), hoursLabel(leg.minutes)].filter(Boolean).join(" · "), M + 22, w.y + 9);
        const extra = [leg.state, leg.note].filter(Boolean).join(" · ");
        if (extra) { w.font("regular", 8, p.muted); w.text(extra, M + 22 + lw + 8, w.y + 9); }
      }
      w.y += 26;
    }
  });
  if (m.route.totalKm != null) {
    w.font("regular", 8.5, p.muted);
    w.text(`En coche: ${kmLabel(m.route.totalKm)} y ${hoursLabel(m.route.totalMinutes)} de manejo en total (${m.route.drivingState}).`, M, w.y + 10);
    w.y += 18;
  }
  w.y += 8;

  // Total y desglose (las cifras de la página) y, si hubo, el aviso de tarifas descartadas.
  const rows = m.desglose.length;
  w.font("regular", 7.5);
  const noteLines = w.lines(m.totalNote, CW - 220);
  // Tarifas descartadas: el aviso va en la tarjeta del vuelo ("Comprar y reservar") y aquí una línea.
  const discarded = m.discardedFares > 0 ? "El renglón Vuelos viene de la cotización guardada, pero esa tarifa no era de tu ruta: el vuelo queda por cotizar (ver Comprar y reservar)." : null;
  w.font("semibold", 8);
  const discLines = discarded ? w.lines(discarded, CW - 36) : [];
  const boxH = 22 + rows * 18 + 20 + Math.max(noteLines.length * 9, 12) + (m.trustSummary ? 11 : 0) + (discLines.length ? 10 + discLines.length * 10.5 : 0) + 12;
  w.sub(m.travelers > 1 ? `Total para ${m.travelers} personas` : "Total para 1 persona", boxH);
  const boxY = w.y;
  w.card(M, boxY, CW, boxH);
  let ry = boxY + 22;
  for (const r of m.desglose) {
    w.font("regular", 9.5, p.body);
    w.text(r.label, M + 18, ry);
    w.text(money(r.amount), W - M - 18, ry, { align: "right" });
    w.rule(M + 18, ry + 6, W - M - 18, p.line, 0.4);
    ry += 18;
  }
  ry += 4;
  w.font("bold", 11, p.gold);
  w.text("Total", M + 18, ry);
  w.text(money(m.totals.total), W - M - 18, ry, { align: "right" });
  ry += 16;
  if (m.travelers > 1) { w.font("semibold", 9, p.body); w.text(`${money(m.totals.porPersona)} por persona`, W - M - 18, ry, { align: "right" }); }
  w.font("regular", 7.5, p.muted);
  noteLines.forEach((l, i) => w.doc.text(l, M + 18, ry + i * 9));
  ry += Math.max(noteLines.length * 9, 12);
  if (m.trustSummary) { w.text(m.trustSummary, M + 18, ry + 2); ry += 11; }
  if (discLines.length) {
    // El mismo aviso que la página: una tarifa de otra ruta no se presenta como vuelo del viaje.
    w.rule(M + 18, ry, W - M - 18, p.line, 0.4);
    w.font("semibold", 8, p.goldSoft);
    discLines.forEach((l, i) => w.doc.text(l, M + 18, ry + 12 + i * 10.5));
  }
  w.y = boxY + boxH + 18;

  return { indexY, indexPage };
}

// ───────────────────────────── Comprar y reservar ─────────────────────────────

const RIGHT_COL = 176;

/** Tarjeta de una compra. Con draw=false solo mide (la misma cuenta que al dibujar). */
function buyCard(w: Writer, b: BuyRow, y0: number, draw: boolean): number {
  const { p } = w;
  const leftW = CW - 32 - RIGHT_COL - 18;
  const R = W - M - 16;
  const X = M + 16;
  // Izquierda: qué es, para cuándo, estado del precio y qué va precargado.
  if (draw) w.eyebrow(b.group + (b.optional && !/opcional/i.test(b.group) ? " · opcional" : ""), X, y0 + 18);
  let y = y0 + 35;
  let last = y;
  w.font("semibold", 11.5, p.ink);
  for (const l of w.lines(b.title, leftW)) { if (draw) w.doc.text(l, X, y); last = y; y += 14; }
  y -= 2;
  w.font("regular", 8.5, p.muted);
  if (b.subtitle) for (const l of w.lines(b.subtitle, leftW)) { if (draw) w.doc.text(l, X, y); last = y; y += 11; }
  if (b.provenance) { w.font("semibold", 7.6, p.goldSoft); if (draw) w.text(b.provenance, X, y + 1); last = y + 1; y += 12; }
  if (b.warning) { w.font("semibold", 7.8, p.goldSoft); for (const l of w.lines(b.warning, leftW)) { if (draw) w.doc.text(l, X, y + 1); last = y + 1; y += 10; } y += 2; }
  w.font("regular", 7.6, p.muted);
  const small = [...(b.lleva.length ? w.lines(`Va precargado: ${b.lleva.join(" · ")}`, leftW) : []), ...(b.completa ? w.lines(b.completa, leftW) : [])];
  if (small.length) { y += 4; for (const l of small) { if (draw) w.doc.text(l, X, y); last = y; y += 10; } }
  // Derecha: estado, precio y botones.
  if (draw) { w.font("semibold", 8, b.done ? p.ok : p.muted); w.text(b.done ? `✓ ${b.status}` : b.status, R, y0 + 18, { align: "right" }); }
  let ry = y0 + 35;
  let rlast = ry;
  if (b.price) { w.font("serif", 13.5, p.ink); if (draw) w.text(b.price, R, ry + 1, { align: "right" }); rlast = ry; ry += 15; }
  if (b.priceNote) {
    w.font("regular", 7.6, p.muted);
    for (const l of w.lines(b.priceNote, RIGHT_COL)) { if (draw) w.text(l, R, ry, { align: "right" }); rlast = ry; ry += 9; }
  }
  if (b.links.length) {
    ry += 2;
    b.links.forEach((l, i) => { if (draw) w.linkPill(l, R - w.pillWidth(l), ry + i * 25, i === 0); });
    rlast = ry + (b.links.length - 1) * 25 + 19 - 4;
  }
  return Math.max(last, rlast) - y0 + 18;
}

function drawBuy(w: Writer, m: TripPdfModel) {
  const { p } = w;
  if (!m.buy.length) return;
  w.chapter(360);
  w.section("Comprar y reservar", { index: "Comprar y reservar" });
  w.font("semibold", 11, p.ink);
  w.text(`${m.buyDone} de ${m.buyTotal} comprado${m.buyTotal === 1 ? "" : "s"}`, M, w.y);
  w.y += 8;
  w.font("regular", 8.5, p.muted);
  w.y += w.para("IATOS no cobra ni emite boletos: pagas directo en cada sitio. Cada botón abre la búsqueda con tus fechas y personas; el precio puede cambiar ahí, confírmalo antes de pagar.", M, w.y + 9, CW, 11.5) + 14;

  for (const b of m.buy) {
    const h = buyCard(w, b, 0, false);
    w.ensure(h + 8);
    const y0 = w.y;
    w.card(M, y0, CW, h);
    if (b.done) { w.stroke(p.ok, 0.8); w.doc.roundedRect(M, y0, CW, h, 8, 8, "S"); }
    buyCard(w, b, y0, true);
    w.y = y0 + h + 8;
  }

  // Cómo leer los precios
  w.font("regular", 7.6);
  const legend = "Cada precio lleva la misma etiqueta que en la app (consultado en vivo, precio de referencia o estimado): las referencias y los estimados se confirman en el sitio de compra. \"Ya lo compré\" lo marca quien viaja; IATOS no lo verifica con el proveedor.";
  w.ensure(w.paraHeight(legend, CW, 10) + 20);
  w.y += 6;
  w.font("regular", 7.6, p.muted);
  w.y += w.para(legend, M, w.y + 8, CW, 10);
}

// ───────────────────────────── Ciudades ─────────────────────────────

const SLOT_W = 64;

function dayLayout(w: Writer, d: PdfDay) {
  const textW = CW - 32 - SLOT_W;
  w.font("serif", 13);
  const title = w.lines(d.title, CW - 32);
  w.font("regular", 9.3);
  const slots = d.slots.map((s) => ({ label: s.label, lines: w.lines(s.text, textW), h: 0 }));
  slots.forEach((s) => { s.h = s.lines.length * 12.4 + 6; });
  const head = 54 + (title.length - 1) * 16;
  const h = head + slots.reduce((s, sl) => s + sl.h, 0) + 8;
  return { title, slots, h, head, textW };
}

/** Un día en su tarjeta. Si no cabe entero, se parte entre Mañana/Tarde/Noche (nunca a media frase). */
function drawDay(w: Writer, d: PdfDay) {
  const { p } = w;
  const L = dayLayout(w, d);
  const free = BOTTOM - w.y - 10;
  let slots = L.slots;
  let continued = false;
  if (L.h > free) {
    // ¿Cabe el encabezado y al menos un bloque? Entonces se parte; si no, el día empieza en otra página.
    let fit = 0;
    let used = L.head + 8;
    while (fit < slots.length && used + slots[fit].h <= free) { used += slots[fit].h; fit++; }
    // Un día normal (~200 pt) pasa entero a la página siguiente; solo uno muy largo se parte.
    if (fit < 2 || fit === slots.length || L.h < (BOTTOM - TOP) * 0.45) w.ensure(L.h + 8);
    else {
      drawDayCard(w, d, L, slots.slice(0, fit), false);
      w.newPage();
      slots = slots.slice(fit);
      continued = true;
    }
  }
  drawDayCard(w, d, L, slots, continued);
  void p;
}

function drawDayCard(w: Writer, d: PdfDay, L: ReturnType<typeof dayLayout>, slots: ReturnType<typeof dayLayout>["slots"], continued: boolean) {
  const { p } = w;
  const head = continued ? 30 : L.head;
  const h = head + slots.reduce((s, sl) => s + sl.h, 0) + 8;
  const y0 = w.y;
  w.card(M, y0, CW, h);
  w.fill(p.gold);
  w.doc.rect(M, y0 + 12, 2.2, continued ? 11 : 30, "F");
  w.eyebrow(`Día ${String(d.n).padStart(2, "0")}${continued ? "   ·   continúa" : ""}`, M + 16, y0 + 19);
  let y = y0 + head;
  if (!continued) {
    w.font("serif", 13, p.ink);
    L.title.forEach((l, i) => w.doc.text(l, M + 16, y0 + 37 + i * 16));
    w.rule(M + 16, y0 + 46 + (L.title.length - 1) * 16, W - M - 16, p.line, 0.4);
  }
  for (const sl of slots) {
    w.font("bold", 6.8, p.gold);
    w.text(sl.label.toUpperCase(), M + 16, y + 6.5, { charSpace: 0.9 });
    w.font("regular", 9.3, p.body);
    sl.lines.forEach((l, i) => w.doc.text(l, M + 16 + SLOT_W, y + 7 + i * 12.4));
    y += sl.h;
  }
  w.y = y0 + h + 8;
}

function drawCity(w: Writer, c: PdfCity, total: number, photo: PdfPhoto | null) {
  const { p } = w;
  w.chapter(420);
  w.sectionPages.push({ label: c.city, page: w.doc.getNumberOfPages() });
  const headY = w.y - 10;
  const imgW = 188;
  const imgH = 124;
  const hasPhoto = !!photo && drawCover(w, photo.bytes, W - M - imgW, headY, imgW, imgH, 8);
  const textW = hasPhoto ? CW - imgW - 22 : CW;
  w.eyebrow(total > 1 ? `Destino ${c.index + 1} de ${total}` : "Destino", M, headY + 14);
  w.font("display", 38, p.ink);
  const nameLines = w.lines(c.city, textW);
  nameLines.forEach((l, i) => w.doc.text(l, M, headY + 54 + i * 40));
  let y = headY + 54 + (nameLines.length - 1) * 40 + 22;
  w.font("semibold", 10.5, p.body);
  w.text([c.range, nightsLabel(c.nights)].filter(Boolean).join("   ·   "), M, y);
  y += 14;
  w.rule(M, y, M + 36, p.gold, 1);
  if (hasPhoto && photo?.credit) {
    w.font("regular", 6, p.muted);
    w.lines(photo.credit, imgW).slice(0, 2).forEach((l, i) => w.text(l, W - M, headY + imgH + 9 + i * 7, { align: "right" }));
  }
  w.y = Math.max(y + 26, hasPhoto ? headY + imgH + 30 : 0);

  // Cómo llegar (por tierra: road trip o la opción guardada)
  if (c.arrival) {
    const a = c.arrival;
    w.sub("Cómo llegar", 44);
    w.font("serif", 12, p.ink);
    w.text([`${a.mode} desde ${a.from}`, kmLabel(a.km), hoursLabel(a.minutes)].filter(Boolean).join(" · "), M, w.y + 6);
    const extra = [a.state, a.note, a.date ? `el ${a.date}` : null].filter(Boolean).join(" · ");
    w.y += 10;
    if (extra) { w.font("regular", 8.5, p.muted); w.text(extra, M, w.y + 9); w.y += 13; }
    if (a.mapsUrl) { w.y += 6; w.linkPill({ label: "Ver ruta en Google Maps", url: a.mapsUrl }, M, w.y, false); w.y += 20; }
    w.y += 18;
  }

  // Hotel elegido (el mismo que en "Comprar"): nombre y total arriba, detalle, estado del precio y de la compra.
  if (c.hotel) {
    const hasLinks = c.hotel.links.length > 0;
    const hcard = 50 + (c.hotel.provenance || c.hotel.status ? 13 : 0) + (hasLinks ? 30 : 0);
    w.sub(c.hotel.skipped ? "Hospedaje" : "Tu hotel", hcard);
    const y0 = w.y;
    const R = W - M - 16;
    w.card(M, y0, CW, hcard);
    w.font("serif", 13.5, p.ink);
    w.text(c.hotel.name, M + 16, y0 + 24);
    if (c.hotel.total) {
      w.text(c.hotel.total, R, y0 + 24, { align: "right" });
      w.font("regular", 7.5, p.muted);
      w.text("total de la estancia", R, y0 + 37, { align: "right" });
    }
    w.font("regular", 8.5, p.muted);
    w.text(c.hotel.detail, M + 16, y0 + 38);
    const row = y0 + 51;
    if (c.hotel.provenance) { w.font("semibold", 7.6, p.goldSoft); w.text(c.hotel.provenance, M + 16, row); }
    if (c.hotel.status) {
      w.font("semibold", 8, c.hotel.done ? p.ok : p.muted);
      w.text(c.hotel.done ? `✓ ${c.hotel.status}` : c.hotel.status, R, row, { align: "right" });
    }
    if (hasLinks) w.linkRow(c.hotel.links, M + 16, row + 9, CW - 32 - 120);
    w.y = y0 + hcard + 22;
  }

  if (c.days.length) {
    w.sub("Itinerario día por día", dayLayout(w, c.days[0]).h);
    for (const d of c.days) drawDay(w, d);
    w.y += 8;
  }

  if (c.tours.length) {
    w.sub("Experiencias elegidas", 44);
    for (const t of c.tours) {
      w.ensure(40);
      w.font("semibold", 10.5, p.ink);
      w.text(t.name, M, w.y + 6);
      w.font("regular", 8.5, p.muted);
      w.text([t.detail, t.status].filter(Boolean).join(" · "), M, w.y + 19);
      if (t.links[0]) w.linkPill(t.links[0], W - M - w.pillWidth(t.links[0]), w.y - 4, false);
      w.y += 34;
    }
  }

  // Restaurantes: recomendaciones, nada está reservado. Dos columnas.
  if (c.restaurants.length) {
    const colW = (CW - 24) / 2;
    const cellH = 46;
    w.sub("Restaurantes recomendados", 14 + cellH);
    w.font("regular", 8, p.muted);
    w.text("Sugerencias de tu concierge: ninguna mesa está reservada todavía.", M, w.y + 2);
    w.y += 14;
    const one = (t: string, width: number) => { const ls = w.lines(t, width); return ls.length > 1 ? `${ls[0].replace(/[\s,.;·/-]+$/, "")}…` : ls[0] ?? ""; };
    for (let i = 0; i < c.restaurants.length; i += 2) {
      w.ensure(cellH + 2);
      const y = w.y;
      c.restaurants.slice(i, i + 2).forEach((r, k) => {
        const x = M + k * (colW + 24);
        w.font("semibold", 10.5, p.ink);
        w.text(one(r.name, colW), x, y + 13);
        w.font("regular", 8.2, p.muted);
        if (r.cuisine) w.text(one(r.cuisine, colW), x, y + 25.5);
        let lx = x;
        if (r.price) { w.font("semibold", 7.8, p.goldSoft); lx += w.text(r.price, x, y + 38) + 10; }
        if (r.links[0]) { w.font("semibold", 7.8, p.gold); w.text(`${r.links[0].label} ↗`, lx, y + 38, { url: r.links[0].url }); }
      });
      w.rule(M, y + cellH, W - M, p.line, 0.4);
      w.y += cellH + 4;
    }
  }
}

// ───────────────────────────── Antes de manejar · datos útiles ─────────────────────────────

function drawUseful(w: Writer, m: TripPdfModel) {
  const { p } = w;
  if (!m.useful.length) return;
  const cols = m.useful.length;
  const colW = (CW - 32 - (cols - 1) * 18) / cols;
  w.font("semibold", 10.5);
  const valueLines = m.useful.map((u) => w.lines(u.value, colW));
  const h = 30 + Math.max(...valueLines.map((l) => l.length)) * 13 + 12;
  const notes = m.useful.map((u) => u.note).filter(Boolean) as string[];
  w.font("regular", 7.5);
  const notesH = notes.reduce((s, n) => s + w.paraHeight(n, CW, 9.5), 0);
  w.section("Datos útiles", { index: "Datos útiles", keep: h + notesH + 10 });
  const y0 = w.y;
  w.card(M, y0, CW, h);
  m.useful.forEach((u, i) => {
    const x = M + 16 + i * (colW + 18);
    w.eyebrow(u.label, x, y0 + 19);
    w.font("semibold", 10.5, p.ink);
    valueLines[i].forEach((l, k) => w.doc.text(l, x, y0 + 36 + k * 13));
  });
  w.y = y0 + h + 6;
  w.font("regular", 7.5, p.muted);
  for (const n of notes) w.y += w.para(n, M, w.y + 8, CW, 9.5);
  w.y += 8;
}

function drawDriving(w: Writer, m: TripPdfModel) {
  const { p } = w;
  if (!m.notices.length) return;
  w.section("Antes de manejar", { index: "Antes de manejar", keep: 150 });
  for (const n of m.notices) {
    w.font("semibold", 11);
    const titleH = w.paraHeight(n.title, CW - 32, 14);
    w.font("regular", 9);
    const bodyH = w.paraHeight(n.body, CW - 32, 12.4);
    const h = 22 + titleH + bodyH + 12 + n.sources.length * 11 + (n.consulted ? 11 : 0) + 8;
    w.ensure(h + 10);
    const y0 = w.y;
    w.card(M, y0, CW, h);
    w.font("semibold", 11, p.ink);
    let y = y0 + 24 + w.para(n.title, M + 16, y0 + 24, CW - 32, 14);
    w.font("regular", 9, p.body);
    y += w.para(n.body, M + 16, y + 1, CW - 32, 12.4);
    y += 4;
    for (const s of n.sources) { w.font("semibold", 7.6, p.gold); y += 11; w.text(`Fuente: ${w.lines(s.label, CW - 60)[0]} ↗`, M + 16, y, { url: s.url }); }
    if (n.consulted) { w.font("regular", 7.6, p.muted); y += 11; w.text(`Consultada el ${n.consulted}`, M + 16, y); }
    w.y = y0 + h + 10;
  }
}

function drawTips(w: Writer, m: TripPdfModel) {
  const { p } = w;
  if (m.tips.length) {
    w.section("Tips de tu concierge", { index: "Tips de tu concierge", keep: 60 });
    m.tips.forEach((tip, i) => {
      w.font("regular", 9.5);
      const h = w.paraHeight(tip, CW - 36, 13.5);
      w.ensure(h + 8);
      w.font("serif", 13, p.gold);
      w.text(String(i + 1).padStart(2, "0"), M, w.y + 11);
      w.font("regular", 9.5, p.body);
      w.para(tip, M + 36, w.y + 10, CW - 36, 13.5);
      w.y += h + 12;
    });
  }

}

// ───────────────────────────── Pie e índice ─────────────────────────────

function drawFooters(w: Writer, m: TripPdfModel) {
  const pages = w.doc.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    w.doc.setPage(i);
    w.rule(M, H - 46, W - M, w.p.line, 0.4);
    w.font("semibold", 7.5, w.p.muted);
    const right = `${i} / ${pages}`;
    const nw = w.text(right, W - M, H - 31, { align: "right" });
    w.font("semibold", 7.5, w.p.gold);
    const dw = w.text(m.domain, W - M - nw - 14, H - 31, { align: "right", url: m.siteUrl });
    w.font("semibold", 7.5, w.p.muted);
    const maxLeft = CW - nw - dw - 40;
    let left = `IATOS  ·  ${m.title}`;
    while (left.length > 12 && w.width(left) > maxLeft) left = `${left.slice(0, -2).trimEnd()}…`;
    w.text(left, M, H - 31);
  }
}

function drawIndex(w: Writer, entries: Array<{ label: string; page: number }>, at: { indexY: number; indexPage: number }) {
  w.doc.setPage(at.indexPage);
  const rows = Math.ceil(entries.length / 2);
  const colW = (CW - 32) / 2;
  entries.forEach((e, i) => {
    const x = M + (i < rows ? 0 : colW + 32);
    const y = at.indexY + (i % rows) * 18;
    w.font("semibold", 10.5, w.p.ink);
    const lw = w.text(e.label, x, y + 6);
    w.font("serif", 10.5, w.p.gold);
    const pw = w.text(String(e.page), x + colW, y + 6, { align: "right" });
    w.stroke(w.p.line, 0.6);
    w.dash(true, [0.6, 2.6]);
    w.doc.line(x + lw + 8, y + 5, x + colW - pw - 8, y + 5);
    w.dash(false);
    w.doc.link(x, y - 7, colW, 16, { pageNumber: e.page });
  });
}

// ───────────────────────────── Armado ─────────────────────────────

async function registerFonts(doc: jsPDFType, loadFont: TripPdfDeps["loadFont"]): Promise<boolean> {
  if (!loadFont) return false;
  try {
    const roles = Object.keys(PDF_FONTS) as Role[];
    const files = await Promise.all(roles.map(async (r) => [r, await loadFont(PDF_FONTS[r])] as const));
    if (files.some(([, b]) => !b || !b.length)) return false;
    for (const [role, bytes] of files) {
      doc.addFileToVFS(PDF_FONTS[role], bytesToBase64(bytes!));
      doc.addFont(PDF_FONTS[role], FAMILY[role], "normal");
    }
    return true;
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(s);
}

/** Arma el PDF completo y devuelve sus bytes (sin descargarlo). */
export async function buildTripPdf(trip: any, opts: TripPdfOptions & { theme?: PdfTheme }, deps: TripPdfDeps = {}): Promise<TripPdfResult> {
  const JsPDF = deps.jsPDF ?? (await import("jspdf")).default;
  const model = buildTripPdfModel(trip, opts);
  const doc = new JsPDF({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({ title: `IATOS · ${model.title}`, subject: "Itinerario y cotización del viaje", creator: `IATOS · ${model.domain}`, author: "IATOS" });
  const fonts = await registerFonts(doc, deps.loadFont);
  const w = new Writer(doc, opts.theme ?? "dark", fonts);
  const load = deps.loadPhoto ?? (async () => null);
  const safe = async (req: PhotoRequest) => { try { return await load(req); } catch { return null; } };
  const [cover, ...cityPhotos] = await Promise.all([
    safe({ kind: "cover", url: model.coverImageUrl, query: model.coverQuery }),
    ...model.cities.map((c) => safe({ kind: "city", url: null, query: c.photoQuery, city: c.city })),
  ]);

  drawCoverPage(w, model, cover);
  const indexLabels = [
    ...(model.buy.length ? ["Comprar y reservar"] : []),
    ...(model.useful.length ? ["Datos útiles"] : []),
    ...(model.notices.length ? ["Antes de manejar"] : []),
    ...model.cities.map((c) => c.city),
    ...(model.tips.length ? ["Tips de tu concierge"] : []),
  ];
  const at = drawOverview(w, model, indexLabels);
  drawBuy(w, model);
  drawUseful(w, model);
  drawDriving(w, model);
  model.cities.forEach((c, i) => drawCity(w, c, model.cities.length, cityPhotos[i] ?? null));
  drawTips(w, model);
  drawFooters(w, model);
  const order = new Map(indexLabels.map((l, i) => [l, i]));
  const entries = w.sectionPages.filter((s) => order.has(s.label)).sort((a, b) => order.get(a.label)! - order.get(b.label)!);
  drawIndex(w, entries, at);

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  const filename = opts.theme === "light" ? model.filename.replace(/\.pdf$/, "-imprimir.pdf") : model.filename;
  return { bytes, pages: doc.getNumberOfPages(), filename, model, fontsEmbedded: fonts, photos: [cover, ...cityPhotos].filter(Boolean).length };
}

// ───────────────────────────── En el navegador ─────────────────────────────

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Reduce la foto (lado mayor `max`) y la vuelve JPEG para que el PDF pese poco. */
async function shrinkJpeg(bytes: Uint8Array, max: number): Promise<Uint8Array> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return bytes;
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.84));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : bytes;
  } catch {
    return bytes;
  }
}

/** Foto del viaje (cover_image_url) o ilustrativa de Pexels con crédito: la misma fuente que la app. */
export async function browserPhoto(req: PhotoRequest): Promise<PdfPhoto | null> {
  const max = req.kind === "cover" ? 1600 : 720;
  if (req.url) {
    const b = await fetchBytes(req.url);
    if (b) return { bytes: await shrinkJpeg(b, max), credit: /googleusercontent\.com/.test(req.url) ? "Foto: Google" : null };
  }
  const { getStockPhoto } = await import("@/lib/stockPhoto");
  const photo = await getStockPhoto(req.query);
  if (!photo) return null;
  const b = await fetchBytes(photo.image);
  if (!b) return null;
  return { bytes: await shrinkJpeg(b, max), credit: `Foto ilustrativa${photo.photographer ? `: ${photo.photographer}` : ""} / Pexels` };
}

/** Marcas "Ya lo compré" del viaje, como en "Comprar": las del grupo y, si la tabla no responde, las propias. */
async function loadMarks(trip: any, bookings: TripPdfOptions["bookings"], userId: string | null): Promise<TripPdfOptions["marks"]> {
  const { MARKS_COLUMNS, marksFromBookings, marksFromGroup } = await import("@/lib/purchaseMarks");
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const res: any = await supabase.from("trip_purchase_marks").select(MARKS_COLUMNS).eq("trip_id", trip.id);
    if (!res?.error && Array.isArray(res?.data)) return marksFromGroup(res.data);
  } catch { /* sin la tabla: modo anterior */ }
  return marksFromBookings(bookings ?? [], userId);
}

/** "Compartir PDF": arma el PDF y lo descarga. */
export async function generateTripPDF(trip: any, opts: TripPdfOptions & { theme?: PdfTheme }) {
  const marks = opts.marks !== undefined ? opts.marks : await loadMarks(trip, opts.bookings, opts.userId ?? null);
  const res = await buildTripPdf(trip, { ...opts, marks }, {
    loadFont: (f) => fetchBytes(`/fonts/pdf/${f}`),
    loadPhoto: browserPhoto,
  });
  const blob = new Blob([new Uint8Array(res.bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = res.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return res;
}
