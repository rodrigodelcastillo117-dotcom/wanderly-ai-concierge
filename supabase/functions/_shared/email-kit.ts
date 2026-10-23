// Sistema de correo premium de IATOS: una sola maqueta y piezas reutilizables para todos los correos
// (cotización, bienvenida, invitación, alertas, avisos de cuenta y correos internos del equipo).
// Funciones puras (HTML + texto plano), sin Deno, probadas en src/test/emailSystem.test.ts.
//
// Mismo lenguaje visual que la invitación de IATOS Privé (_shared/prive-email.ts): negro profundo,
// dorado champaña, serif editorial, monograma en texto vivo, mucho aire.
//
// Reglas de construcción (para que se vea bien en Gmail, Outlook, Apple Mail y con imágenes
// bloqueadas):
//   * Tablas de 600 px con estilos en línea; las clases solo afinan el móvil (≤ 620 px).
//   * Toda variable pasa por escapeHtml; los enlaces solo aceptan https (safeUrl).
//   * Las fotos son URLs alojadas (nunca adjuntos ni data:) con texto alternativo. Si el cliente
//     bloquea imágenes, el bloque conserva su color de fondo y el texto encima sigue siendo texto.
//   * Los íconos son glifos Unicode en anillos dorados (no imágenes): se ven siempre.
//   * Botón "a prueba de balas": tabla + VML para Outlook.
//   * color-scheme oscuro declarado: los clientes con modo oscuro no invierten los colores.
import { escapeHtml, safeUrl } from "./email-format.ts";

export const EK = {
  black: "#0A0A0B",
  panel: "#121214",
  panel2: "#17161A",
  heroFallback: "#16140F",
  gold: "#C8B48A",
  goldSoft: "#A8976F",
  goldDeep: "#7D6E50",
  ivory: "#F2EDE4",
  body: "#CFC8BB",
  muted: "#9C968B",
  faint: "#6F6A61",
  line: "#2A2722",
  live: "#9DC3A3",
  warn: "#D7AE78",
  bad: "#CF8A7C",
} as const;

export const SERIF = "'Cormorant Garamond', 'Playfair Display', Didot, 'Bodoni 72', Georgia, 'Times New Roman', serif";
/** Cifras alineadas (Cormorant usa números "de texto" por defecto, que se ven chicos en precios). */
export const LNUM = "font-variant-numeric:lining-nums;font-feature-settings:'lnum' 1;";
export const SANS = "'Helvetica Neue', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const DEFAULT_SITE_URL = "https://traveliatos.life";
export const DEFAULT_SUPPORT_EMAIL = "hola@traveliatos.life";

export type Email = { subject: string; preheader: string; html: string; text: string };

/** Origen del sitio sin barra final; solo https (o http://localhost en pruebas). */
export function normalizeSite(siteUrl: string | null | undefined): string {
  const u = safeUrl((siteUrl ?? "").trim().replace(/\/+$/, ""));
  if (!u) return DEFAULT_SITE_URL;
  const p = new URL(u);
  return `${p.protocol}//${p.host}`;
}

// Relleno invisible tras el preencabezado para que el cliente no muestre el cuerpo como vista previa.
const PREHEADER_PAD = "&#8199;&#65279;&#847; ".repeat(40);

// ───────────────────────────── piezas básicas (cada una es una o más <tr>) ─────────────────────────

export const gap = (h: number) =>
  `<tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>`;

/** Fila con relleno lateral estándar (56 px; 24 px en móvil). */
export const row = (inner: string, opts: { align?: "left" | "center"; pad?: number; style?: string } = {}) =>
  `<tr><td class="ek-pad" align="${opts.align ?? "left"}" style="padding:0 ${opts.pad ?? 56}px;${opts.style ?? ""}">${inner}</td></tr>`;

export const eyebrow = (text: string, opts: { align?: "left" | "center"; color?: string } = {}) =>
  row(`<span style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.32em;text-transform:uppercase;color:${opts.color ?? EK.gold};">${escapeHtml(text)}</span>`, { align: opts.align });

export const headline = (html: string, opts: { align?: "left" | "center"; size?: number } = {}) =>
  `<tr><td class="ek-pad ek-h1" align="${opts.align ?? "left"}" style="padding:0 56px;font-family:${SERIF};font-size:${opts.size ?? 34}px;line-height:${Math.round((opts.size ?? 34) * 1.22)}px;font-weight:400;color:${EK.ivory};${LNUM}">${html}</td></tr>`;

/** Párrafo de cuerpo (sans ligera). `html` ya debe venir escapado. */
export const para = (html: string, opts: { align?: "left" | "center"; color?: string; size?: number; serif?: boolean } = {}) => {
  const size = opts.size ?? 15;
  return `<tr><td class="ek-pad ek-body" align="${opts.align ?? "left"}" style="padding:0 56px;font-family:${opts.serif ? SERIF : SANS};font-size:${opts.serif ? size + 3 : size}px;line-height:${Math.round(size * (opts.serif ? 1.75 : 1.7))}px;font-weight:300;color:${opts.color ?? EK.body};${LNUM}">${html}</td></tr>`;
};

export function goldRule(width = 48, align: "left" | "center" = "left"): string {
  return row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:${align === "center" ? "0 auto" : "0"};">
    <tr><td width="${width}" height="1" style="width:${width}px;height:1px;line-height:1px;font-size:1px;background-color:${EK.gold};">&nbsp;</td></tr></table>`, { align });
}

export const hairline = (color: string = EK.line) =>
  row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${color};">&nbsp;</td></tr></table>`);

/** Monograma: anillo dorado con la letra en texto vivo (VML en Outlook). */
export function monogram(letter = "I", size = 56): string {
  const l = escapeHtml(letter.slice(0, 1));
  const font = Math.round(size * 0.44);
  return `<!--[if mso]>
  <v:oval xmlns:v="urn:schemas-microsoft-com:vml" style="width:${size}px;height:${size}px;" strokecolor="${EK.gold}" strokeweight="1px" fillcolor="${EK.black}">
    <v:textbox inset="0,${Math.round(size * 0.16)}px,0,0"><center style="font-family:Georgia,serif;font-size:${font}px;color:${EK.gold};font-style:italic;">${l}</center></v:textbox>
  </v:oval>
  <![endif]--><!--[if !mso]><!-->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;border-collapse:separate;">
    <tr><td width="${size - 2}" height="${size - 2}" align="center" valign="middle"
      style="width:${size - 2}px;height:${size - 2}px;border:1px solid ${EK.gold};border-radius:50%;text-align:center;vertical-align:middle;font-family:${SERIF};font-size:${font}px;line-height:${size - 2}px;font-style:italic;color:${EK.gold};mso-line-height-rule:exactly;">${l}</td></tr>
  </table><!--<![endif]-->`;
}

/** Cabecera: marca a la izquierda, dato corto a la derecha (folio, tipo de correo). */
export function masthead(right?: string | null): string {
  return `<tr><td class="ek-pad" style="padding:0 56px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="left" valign="middle" style="font-family:${SERIF};font-size:20px;line-height:24px;letter-spacing:0.38em;color:${EK.ivory};">IATOS</td>
    ${right ? `<td align="right" valign="middle" style="font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.26em;text-transform:uppercase;color:${EK.muted};">${escapeHtml(right)}</td>` : ""}
  </tr></table></td></tr>`;
}

export type HeroImage = {
  url: string;
  alt?: string | null;
  /** Crédito visible. Pexels: "Foto ilustrativa · Pexels · <fotógrafo>". */
  credit?: string | null;
  creditUrl?: string | null;
};

/**
 * Portada editorial a todo lo ancho: foto con degradado oscuro y el título en serif encima.
 * Sin imagen (o con imágenes bloqueadas) queda un bloque oscuro con el mismo texto: nunca un hueco.
 * Outlook de Windows (Word) no pinta fondos con CSS: ahí se ve la versión sin foto.
 */
export function hero(o: { image?: HeroImage | null; eyebrow?: string | null; title: string; subtitle?: string | null; height?: number }): string {
  const img = o.image?.url ? safeUrl(o.image.url) : null;
  // Sin foto, la portada es tipográfica y más baja: un bloque oscuro alto y vacío se ve roto.
  const h = img ? (o.height ?? 400) : Math.min(o.height ?? 400, 280);
  const titleSize = o.title.length > 18 ? 44 : 56;
  const text = `
    ${img ? "" : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="1" style="width:40px;height:1px;line-height:1px;font-size:1px;background-color:${EK.gold};">&nbsp;</td></tr></table>
    <div style="height:22px;line-height:22px;font-size:1px;">&nbsp;</div>`}
    ${o.eyebrow ? `<div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.34em;text-transform:uppercase;color:${EK.gold};text-shadow:0 1px 8px rgba(0,0,0,0.6);">${escapeHtml(o.eyebrow)}</div>
    <div style="height:14px;line-height:14px;font-size:1px;">&nbsp;</div>` : ""}
    <div class="ek-hero-title" style="font-family:${SERIF};font-size:${titleSize}px;line-height:${Math.round(titleSize * 1.05)}px;font-weight:400;color:${EK.ivory};${LNUM}text-shadow:0 2px 18px rgba(0,0,0,0.55);">${escapeHtml(o.title)}</div>
    ${o.subtitle ? `<div style="height:16px;line-height:16px;font-size:1px;">&nbsp;</div>
    <div style="font-family:${SANS};font-size:13px;line-height:20px;letter-spacing:0.08em;color:${EK.ivory};text-shadow:0 1px 8px rgba(0,0,0,0.6);">${escapeHtml(o.subtitle)}</div>` : ""}`;
  // La foto va en el fondo de la celda (atributo background + CSS). Encima, una capa oscura
  // semitransparente y un degradado: si el cliente no entiende el degradado, queda la capa plana.
  const bg = img
    ? ` background="${escapeHtml(img)}" style="background-color:${EK.heroFallback};background-image:url('${escapeHtml(img)}');background-size:cover;background-position:center center;background-repeat:no-repeat;"`
    : ` style="background-color:${EK.heroFallback};background-image:radial-gradient(ellipse at 30% 20%, #2A2416 0%, ${EK.heroFallback} 55%, ${EK.black} 100%);"`;
  const role = img && o.image?.alt ? ` role="img" aria-label="${escapeHtml(o.image.alt)}"` : "";
  return `<tr><td bgcolor="${EK.heroFallback}" valign="bottom"${bg}${role}>
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td height="${h}" valign="bottom" bgcolor="${EK.heroFallback}" style="padding:0 56px 44px;"><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td class="${img ? "ek-hero" : "ek-hero-plain"} ek-pad" height="${h}" valign="bottom"
      style="height:${h}px;padding:0 56px 44px;background-color:rgba(10,10,11,0.30);background-image:linear-gradient(180deg, rgba(10,10,11,0) 0%, rgba(10,10,11,0.15) 40%, rgba(10,10,11,0.88) 100%);">
      ${text}
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>`;
}

/** Crédito de la foto (y enlace a su página), en pequeño debajo de la portada. */
export function photoCredit(image?: HeroImage | null): string {
  if (!image?.url || !image.credit) return "";
  const href = safeUrl(image.creditUrl);
  const credit = escapeHtml(image.credit);
  return `<tr><td class="ek-pad" align="right" style="padding:10px 56px 0;font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.04em;color:${EK.faint};">${
    href ? `<a href="${escapeHtml(href)}" style="color:${EK.faint};text-decoration:none;">${credit}</a>` : credit}</td></tr>`;
}

// ───────────────────────────── procedencia de cada cifra ─────────────────────────────────────────

export type Provenance =
  | { kind: "live"; source: string; at?: string | null }
  | { kind: "estimate"; source?: string | null }
  /** Precio real de un proveedor que no se consultó en vivo (caché de Aviasales, o en vivo ya vencido). */
  | { kind: "reference"; source?: string | null }
  | { kind: "pending" }
  | { kind: "confirmed" }
  | { kind: "unavailable" }
  | { kind: "excluded" }
  | { kind: "optional" };

const CHIP: Record<Provenance["kind"], { label: string; color: string; dot: string }> = {
  live: { label: "En vivo", color: EK.live, dot: "●" },
  estimate: { label: "Estimado", color: EK.warn, dot: "◐" },
  reference: { label: "Referencia", color: EK.warn, dot: "◑" },
  pending: { label: "Por confirmar", color: EK.warn, dot: "◌" },
  confirmed: { label: "Confirmado", color: EK.live, dot: "✓" },
  unavailable: { label: "No disponible", color: EK.bad, dot: "○" },
  excluded: { label: "No incluido", color: EK.muted, dot: "–" },
  optional: { label: "Opcional", color: EK.muted, dot: "+" },
};

/** Etiqueta de texto: "EN VIVO · Google Flights · 14:05 h", "ESTIMADO", "NO DISPONIBLE"… */
export function provenanceText(p: Provenance, fmtTime?: (at: string) => string | null): string {
  const base = CHIP[p.kind].label.toUpperCase();
  if (p.kind === "live") {
    const t = p.at && fmtTime ? fmtTime(p.at) : null;
    return [base, p.source, t].filter(Boolean).join(" · ");
  }
  if ((p.kind === "estimate" || p.kind === "reference") && p.source) return `${base} · ${p.source}`;
  return base;
}

/** Chip con borde fino del color del estado. */
export function chip(p: Provenance, fmtTime?: (at: string) => string | null): string {
  const c = CHIP[p.kind];
  const [label, ...rest] = provenanceText(p, fmtTime).split(" · ");
  const extra = rest.length ? ` <span style="display:inline-block;font-family:${SANS};font-size:11px;line-height:14px;color:${EK.muted};letter-spacing:0.02em;white-space:nowrap;">·&nbsp;${escapeHtml(rest.join(" · "))}</span>` : "";
  return `<span style="display:inline-block;font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${c.color};white-space:nowrap;"><span style="font-size:9px;">${c.dot}</span>&nbsp;${escapeHtml(label)}</span>${extra}`;
}

// ───────────────────────────── bloques compuestos ────────────────────────────────────────────────

/** Panel con borde fino y filete dorado arriba. `inner` son filas <tr>. */
export function panel(inner: string, opts: { goldTop?: boolean; pad?: number } = {}): string {
  const pad = opts.pad ?? 28;
  return `<tr><td class="ek-pad-outer" style="padding:0 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EK.panel}"
    style="background-color:${EK.panel};border:1px solid ${EK.line};${opts.goldTop === false ? "" : `border-top:1px solid ${EK.goldDeep};`}">
    <tr><td class="ek-panel-pad" style="padding:${pad}px ${pad}px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${inner}</table>
    </td></tr>
  </table></td></tr>`;
}

const label = (t: string) =>
  `<div style="font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.26em;text-transform:uppercase;color:${EK.muted};">${escapeHtml(t)}</div>`;
const value = (t: string, size = 17) =>
  `<div style="font-family:${SERIF};font-size:${size}px;line-height:${Math.round(size * 1.3)}px;color:${EK.ivory};${LNUM}">${escapeHtml(t)}</div>`;

export type PassCell = { label: string; value: string };

/**
 * Resumen tipo "pase de abordar": origen → destino arriba (con códigos de aeropuerto si se
 * conocen) y debajo una rejilla de 2 columnas (fechas, viajeros, noches, habitaciones).
 */
export function tripPass(o: {
  origin?: { city: string; code?: string | null } | null;
  destination: { city: string; code?: string | null };
  cells: PassCell[];
  caption?: string | null;
}): string {
  const end = (c: { city: string; code?: string | null } | null | undefined, align: "left" | "right", lbl: string) => {
    if (!c) return `<td width="42%" align="${align}" valign="top">${label(lbl)}<div style="height:6px;font-size:1px;line-height:6px;">&nbsp;</div>${value("Por definir", 20)}</td>`;
    return `<td width="42%" align="${align}" valign="top">${label(lbl)}<div style="height:6px;font-size:1px;line-height:6px;">&nbsp;</div>
      ${c.code ? `<div class="ek-code" style="font-family:${SERIF};font-size:38px;line-height:40px;letter-spacing:0.04em;color:${EK.ivory};${LNUM}">${escapeHtml(c.code)}</div>
      ${c.city ? `<div style="font-family:${SANS};font-size:12px;line-height:18px;color:${EK.body};">${escapeHtml(c.city)}</div>` : ""}` : value(c.city, 24)}</td>`;
  };
  const route = `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${end(o.origin, "left", "Origen")}
    <td width="16%" align="center" valign="middle" style="font-family:'Segoe UI Symbol','Apple Symbols',${SANS};font-size:18px;line-height:20px;color:${EK.gold};padding-top:18px;">&#9992;&#xFE0E;</td>
    ${end(o.destination, "right", "Destino")}
  </tr></table></td></tr>`;
  const perforation = `<tr><td style="padding:22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px dashed ${EK.goldDeep};">&nbsp;</td></tr></table></td></tr>`;
  const pairs: string[] = [];
  for (let i = 0; i < o.cells.length; i += 2) {
    const [a, b] = [o.cells[i], o.cells[i + 1]];
    pairs.push(`<tr><td style="padding:${i ? 18 : 0}px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="50%" valign="top">${label(a.label)}<div style="height:5px;font-size:1px;line-height:5px;">&nbsp;</div>${value(a.value)}</td>
      <td width="50%" valign="top">${b ? `${label(b.label)}<div style="height:5px;font-size:1px;line-height:5px;">&nbsp;</div>${value(b.value)}` : "&nbsp;"}</td>
    </tr></table></td></tr>`);
  }
  const caption = o.caption
    ? `<tr><td style="padding-top:18px;font-family:${SANS};font-size:11px;line-height:17px;color:${EK.muted};">${escapeHtml(o.caption)}</td></tr>` : "";
  return panel(route + perforation + pairs.join("") + caption);
}

/** Ícono: glifo Unicode (variante de texto) dentro de un anillo dorado fino. */
export function icon(glyph: string, size = 34): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
    <td width="${size - 2}" height="${size - 2}" align="center" valign="middle"
      style="width:${size - 2}px;height:${size - 2}px;border:1px solid ${EK.goldDeep};border-radius:50%;font-family:'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2',${SANS};font-size:${Math.round(size * 0.42)}px;line-height:${size - 2}px;color:${EK.gold};text-align:center;mso-line-height-rule:exactly;">${glyph}</td>
  </tr></table>`;
}

/** Glifos por categoría (texto, no emoji: U+FE0E fuerza la versión monocroma). */
export const GLYPH: Record<string, string> = {
  vuelos: "&#9992;&#xFE0E;", // ✈
  hospedaje: "&#8962;", // ⌂
  comida: "&#9749;&#xFE0E;", // ☕
  tours: "&#10022;", // ✦
  transporte_local: "&#8644;", // ⇄
  extras: "&#10023;", // ✧
  crucero: "&#9875;&#xFE0E;", // ⚓
  precio: "&#8600;", // ↘
  puerta: "&#10148;", // ➤
  reloj: "&#9719;", // ◷
  persona: "&#9675;", // ○
  check: "&#10003;", // ✓
};

export type RichCard = {
  glyph: string;
  eyebrow: string;
  title: string;
  /** Línea de datos ("Directo · 4 h 05 min"). */
  facts?: string[];
  /** Hasta 2 tiempos con aeropuerto: salida y llegada. */
  times?: { from: { code?: string | null; time?: string | null }; to: { code?: string | null; time?: string | null } } | null;
  price?: { amount: string; basis?: string | null } | null;
  provenance?: Provenance | null;
  photo?: { url: string; alt: string } | null;
  note?: string | null;
  /** Filas <tr> extra al pie de la tarjeta (botón de compra, estado), ya escapadas. */
  footer?: string | null;
};

/** Tarjeta rica de vuelo u hotel. Solo pinta lo que viene en los datos. */
export function richCard(c: RichCard, fmtTime?: (at: string) => string | null): string {
  const photoUrl = c.photo?.url ? safeUrl(c.photo.url) : null;
  const photo = photoUrl
    ? `<tr><td style="padding:0 0 22px;"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(c.photo!.alt)}" width="490" class="ek-img"
        style="display:block;width:100%;max-width:490px;height:auto;max-height:260px;object-fit:cover;border:0;outline:none;background-color:${EK.panel2};color:${EK.muted};font-family:${SANS};font-size:12px;"></td></tr>`
    : "";
  const times = c.times && (c.times.from.time || c.times.to.time)
    ? `<tr><td style="padding:16px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="45%" valign="top">${value(c.times.from.time ?? "—", 22)}<div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.18em;color:${EK.muted};">${escapeHtml(c.times.from.code ?? "")}</div></td>
        <td width="10%" align="center" valign="middle" style="color:${EK.goldDeep};font-family:${SANS};font-size:14px;">&#8594;</td>
        <td width="45%" align="right" valign="top">${value(c.times.to.time ?? "—", 22)}<div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.18em;color:${EK.muted};">${escapeHtml(c.times.to.code ?? "")}</div></td>
      </tr></table></td></tr>` : "";
  const facts = c.facts?.filter(Boolean).length
    ? `<tr><td style="padding:8px 0 0;font-family:${SANS};font-size:13px;line-height:20px;font-weight:300;color:${EK.body};">${c.facts.filter(Boolean).map(escapeHtml).join(`<span style="color:${EK.goldDeep};">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`)}</td></tr>` : "";
  const price = c.price
    ? `<tr><td style="padding:18px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="bottom">${c.provenance ? chip(c.provenance, fmtTime) : ""}</td>
        <td align="right" valign="bottom" style="white-space:nowrap;"><span style="font-family:${SERIF};font-size:24px;line-height:28px;color:${EK.ivory};${LNUM}">${escapeHtml(c.price.amount)}</span>${
          c.price.basis ? `<div style="font-family:${SANS};font-size:11px;line-height:16px;color:${EK.muted};">${escapeHtml(c.price.basis)}</div>` : ""}</td>
      </tr></table></td></tr>`
    : c.provenance ? `<tr><td style="padding:14px 0 0;">${chip(c.provenance, fmtTime)}</td></tr>` : "";
  const note = c.note ? `<tr><td style="padding:12px 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${EK.muted};">${escapeHtml(c.note)}</td></tr>` : "";
  return panel(`${photo}
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="46" valign="top">${icon(c.glyph)}</td>
      <td valign="top" style="padding-left:12px;">${label(c.eyebrow)}<div style="height:4px;font-size:1px;line-height:4px;">&nbsp;</div>
        <div style="font-family:${SERIF};font-size:24px;line-height:29px;color:${EK.ivory};">${escapeHtml(c.title)}</div></td>
    </tr></table></td></tr>
    ${facts}${times}${price}${note}${c.footer ?? ""}`, { goldTop: false });
}

export type LedgerLine = {
  glyph: string;
  label: string;
  detail?: string | null;
  amount: string | null;
  provenance: Provenance;
  muted?: boolean;
};

/** Desglose tipo libro contable: ícono · concepto + procedencia · importe. */
export function ledger(lines: LedgerLine[], fmtTime?: (at: string) => string | null): string {
  const rows = lines.map((l, i) => `
    <tr><td style="padding:${i ? 18 : 4}px 0 18px;border-bottom:1px solid ${EK.line};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="46" valign="top" style="padding-top:2px;">${icon(l.glyph)}</td>
        <td valign="top" style="padding:0 10px 0 12px;">
          <div style="font-family:${SERIF};font-size:20px;line-height:24px;color:${l.muted ? EK.muted : EK.ivory};">${escapeHtml(l.label)}</div>
          ${l.detail ? `<div style="font-family:${SANS};font-size:12px;line-height:18px;font-weight:300;color:${EK.muted};padding-top:2px;">${escapeHtml(l.detail)}</div>` : ""}
          <div style="padding-top:7px;line-height:14px;">${chip(l.provenance, fmtTime)}</div>
        </td>
        <td align="right" valign="top" class="ek-amt" style="white-space:nowrap;font-family:${SERIF};font-size:21px;line-height:24px;color:${l.muted ? EK.muted : EK.ivory};${LNUM}">${l.amount ? escapeHtml(l.amount) : "—"}</td>
      </tr></table>
    </td></tr>`).join("");
  return `<tr><td class="ek-pad" style="padding:0 56px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

/** Bloque del total: etiqueta, cifra grande en serif con su moneda y una línea de contexto. */
export function totalBlock(o: { label: string; amount: string; currency: string; sub?: string | null; foot?: string | null }): string {
  return [
    hairline(EK.goldDeep),
    gap(30),
    eyebrow(o.label, { align: "center" }),
    gap(10),
    `<tr><td class="ek-pad" align="center" style="padding:0 56px;"><span class="ek-total" style="font-family:${SERIF};font-size:64px;line-height:68px;font-weight:400;color:${EK.ivory};${LNUM}">${escapeHtml(o.amount)}</span><span style="font-family:${SANS};font-size:13px;line-height:20px;letter-spacing:0.22em;color:${EK.gold};">&nbsp;${escapeHtml(o.currency)}</span></td></tr>`,
    o.sub ? gap(8) + para(escapeHtml(o.sub), { align: "center", size: 13, color: EK.body }) : "",
    o.foot ? gap(6) + para(o.foot.split("\n").map(escapeHtml).join("<br>"), { align: "center", size: 12, color: EK.muted }) : "",
    gap(30),
    hairline(),
  ].join("\n");
}

/** Nota con filete dorado a la izquierda. `html` ya escapado. */
export function callout(html: string, opts: { color?: string } = {}): string {
  return `<tr><td class="ek-pad" style="padding:0 56px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="2" style="width:2px;background-color:${opts.color ?? EK.goldDeep};font-size:1px;line-height:1px;">&nbsp;</td>
    <td style="padding:2px 0 2px 18px;font-family:${SANS};font-size:13px;line-height:21px;font-weight:300;color:${EK.body};">${html}</td>
  </tr></table></td></tr>`;
}

/** Botón dorado "a prueba de balas" (VML en Outlook). */
export function button(href: string, text: string, opts: { width?: number } = {}): string {
  const url = safeUrl(href);
  if (!url) return "";
  const h = escapeHtml(url), t = escapeHtml(text);
  const w = opts.width ?? 320;
  return `<tr><td class="ek-pad" align="center" style="padding:0 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr><td align="center" bgcolor="${EK.gold}" style="background-color:${EK.gold};border-radius:1px;">
      <!--[if mso]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}"
        style="height:54px;v-text-anchor:middle;width:${w}px;" stroke="f" fillcolor="${EK.gold}">
        <w:anchorlock/><center style="color:${EK.black};font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;font-weight:bold;">${t}</center>
      </v:rect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${h}" target="_blank" rel="noopener" class="ek-btn"
        style="display:inline-block;padding:19px 40px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.26em;color:${EK.black};text-decoration:none;text-transform:uppercase;border-radius:1px;mso-hide:all;">${t}</a>
      <!--<![endif]-->
    </td></tr>
  </table></td></tr>`;
}

/** Enlaces secundarios centrados, separados por "·". */
export function links(items: Array<{ href: string; label: string }>): string {
  const ok = items.map((i) => ({ url: safeUrl(i.href), label: i.label })).filter((i) => i.url);
  if (!ok.length) return "";
  return `<tr><td class="ek-pad" align="center" style="padding:0 56px;font-family:${SANS};font-size:12px;line-height:20px;letter-spacing:0.06em;color:${EK.muted};">${
    ok.map((i) => `<a href="${escapeHtml(i.url!)}" style="color:${EK.gold};text-decoration:none;border-bottom:1px solid ${EK.goldDeep};">${escapeHtml(i.label)}</a>`).join(`&nbsp;&nbsp;·&nbsp;&nbsp;`)}</td></tr>`;
}

/** Cierre firmado por el concierge. */
export function signature(): string {
  return [
    `<tr><td align="center">${monogram("I", 48)}</td></tr>`,
    gap(16),
    `<tr><td class="ek-pad" align="center" style="padding:0 56px;font-family:${SERIF};font-size:21px;line-height:28px;font-style:italic;color:${EK.gold};">Tu concierge, Iato</td></tr>`,
    gap(4),
    `<tr><td class="ek-pad" align="center" style="padding:0 56px;font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.34em;text-transform:uppercase;color:${EK.muted};">IATOS · The World, Beyond Ordinary</td></tr>`,
  ].join("\n");
}

/** Lista numerada elegante (pasos). Cada paso: título + texto + enlace opcional. */
export function steps(items: Array<{ title: string; text: string; href?: string; cta?: string }>): string {
  return `<tr><td class="ek-pad" style="padding:0 56px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${
    items.map((s, i) => {
      const url = s.href ? safeUrl(s.href) : null;
      return `<tr><td style="padding:${i ? 22 : 0}px 0 22px;${i < items.length - 1 ? `border-bottom:1px solid ${EK.line};` : ""}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="52" valign="top" style="font-family:${SERIF};font-size:34px;line-height:34px;font-style:italic;color:${EK.gold};">${String(i + 1).padStart(2, "0")}</td>
          <td valign="top">
            <div style="font-family:${SERIF};font-size:21px;line-height:26px;color:${EK.ivory};">${escapeHtml(s.title)}</div>
            <div style="padding-top:5px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:300;color:${EK.body};">${escapeHtml(s.text)}</div>
            ${url ? `<div style="padding-top:9px;"><a href="${escapeHtml(url)}" style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.22em;text-transform:uppercase;color:${EK.gold};text-decoration:none;">${escapeHtml(s.cta ?? "Abrir")}&nbsp;&#8594;</a></div>` : ""}
          </td>
        </tr></table></td></tr>`;
    }).join("")}</table></td></tr>`;
}

/** Comparación antes → ahora (alertas). */
/** "$15,960 MXN" → cifra grande + código chico (no se parte en dos renglones en el móvil). */
const splitCode = (t: string) => {
  const m = /^(.*\S)\s([A-Z]{3})$/.exec(t);
  return m ? `${escapeHtml(m[1])}<span style="font-family:${SANS};font-size:11px;letter-spacing:0.2em;color:${EK.gold};">&nbsp;${m[2]}</span>` : escapeHtml(t);
};

export function beforeAfter(o: { beforeLabel?: string; before: string; afterLabel?: string; after: string; delta?: string | null; deltaGood?: boolean }): string {
  return panel(`<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="44%" valign="bottom">${label(o.beforeLabel ?? "Antes")}<div style="height:6px;font-size:1px;line-height:6px;">&nbsp;</div>
      <div style="font-family:${SERIF};font-size:24px;line-height:30px;color:${EK.muted};text-decoration:line-through;${LNUM}">${splitCode(o.before)}</div></td>
    <td width="12%" align="center" valign="middle" style="font-family:${SANS};font-size:16px;color:${EK.goldDeep};padding-top:18px;">&#8594;</td>
    <td width="44%" align="right" valign="bottom">${label(o.afterLabel ?? "Ahora")}<div style="height:6px;font-size:1px;line-height:6px;">&nbsp;</div>
      <div class="ek-after" style="font-family:${SERIF};font-size:34px;line-height:38px;color:${EK.ivory};${LNUM}white-space:nowrap;">${splitCode(o.after)}</div></td>
  </tr></table></td></tr>
  ${o.delta ? `<tr><td align="center" style="padding-top:22px;"><span style="display:inline-block;padding:7px 14px;border:1px solid ${o.deltaGood === false ? EK.bad : EK.live};font-family:${SANS};font-size:11px;line-height:14px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${o.deltaGood === false ? EK.bad : EK.live};">${escapeHtml(o.delta)}</span></td></tr>` : ""}`);
}

/** Tabla compacta de pares dato/valor (correos internos). Valores ya escapados como HTML. */
export function kvTable(rows: Array<{ k: string; v: string } | null | undefined | false>): string {
  const ok = rows.filter((r): r is { k: string; v: string } => !!r && !!r.v);
  return `<tr><td class="ek-pad" style="padding:0 56px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${
    ok.map((r) => `<tr>
      <td class="ek-k" width="150" valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${EK.line};font-family:${SANS};font-size:10px;line-height:18px;letter-spacing:0.2em;text-transform:uppercase;color:${EK.muted};">${escapeHtml(r.k)}</td>
      <td valign="top" style="padding:10px 0;border-bottom:1px solid ${EK.line};font-family:${SANS};font-size:14px;line-height:21px;color:${EK.ivory};">${r.v}</td>
    </tr>`).join("")}</table></td></tr>`;
}

// ───────────────────────────── maqueta ───────────────────────────────────────────────────────────

export type ShellOpts = {
  title: string;
  preheader: string;
  /** Filas <tr> del cuerpo, en orden. */
  body: string[];
  /** Por qué le llega el correo a esta persona. */
  reason: string;
  siteUrl?: string | null;
  supportEmail?: string | null;
  /** Enlaces extra del pie (preferencias, dejar de recibir). */
  footerLinks?: Array<{ href: string; label: string }>;
  /** Correos internos: sin espacios grandes arriba/abajo y sin las líneas de atención a clientes. */
  compact?: boolean;
};

export function shell(o: ShellOpts): string {
  const site = normalizeSite(o.siteUrl);
  const support = o.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const extra = (o.footerLinks ?? []).map((l) => ({ url: safeUrl(l.href), label: l.label })).filter((l) => l.url);
  const top = o.compact ? 36 : 56;
  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(o.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  html, body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${EK.black}; }
  * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; }
  a { color:${EK.gold}; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  u + #body a { color:inherit; text-decoration:none; }
  @media (prefers-color-scheme: dark) { .ek-bg { background-color:${EK.black} !important; } }
  @media screen and (max-width: 620px) {
    .ek-container { width:100% !important; }
    .ek-pad { padding-left:24px !important; padding-right:24px !important; }
    .ek-pad-outer { padding-left:16px !important; padding-right:16px !important; }
    .ek-panel-pad { padding:22px 20px !important; }
    .ek-hero { height:340px !important; padding-bottom:32px !important; }
    .ek-hero-plain { height:240px !important; }
    .ek-amt { font-size:18px !important; }
    .ek-hero-title { font-size:42px !important; line-height:44px !important; }
    .ek-h1 { font-size:28px !important; line-height:35px !important; }
    .ek-body { font-size:15px !important; }
    .ek-total { font-size:46px !important; line-height:50px !important; }
    .ek-code { font-size:30px !important; line-height:34px !important; }
    .ek-after { font-size:28px !important; line-height:32px !important; }
    .ek-btn { padding:18px 26px !important; letter-spacing:0.2em !important; }
    .ek-k { width:110px !important; }
    .ek-space { height:40px !important; line-height:40px !important; }
  }
</style>
</head>
<body id="body" class="ek-bg" style="margin:0;padding:0;background-color:${EK.black};" bgcolor="${EK.black}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${EK.black};">${escapeHtml(o.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EK.black}" class="ek-bg" style="background-color:${EK.black};">
<tr><td align="center" style="padding:0;">
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
  <table role="presentation" class="ek-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;margin:0 auto;background-color:${EK.black};">
    <tr><td class="ek-space" height="${top}" style="height:${top}px;line-height:${top}px;font-size:1px;">&nbsp;</td></tr>
    ${o.body.join("\n")}
    ${gap(o.compact ? 36 : 64)}
    ${hairline()}
    <tr><td class="ek-pad" align="center" style="padding:28px 56px 0;font-family:${SANS};font-size:11px;line-height:19px;color:${EK.muted};">
      <span style="font-family:${SERIF};font-size:15px;letter-spacing:0.38em;color:${EK.goldSoft};">IATOS</span><br>
      IATOS AI · <a href="${escapeHtml(site)}" style="color:${EK.gold};text-decoration:none;">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a><br>
      ${escapeHtml(o.reason)}<br>
      ${o.compact ? "" : `¿Dudas? Responde a este correo o escríbenos a <a href="mailto:${escapeHtml(support)}" style="color:${EK.gold};text-decoration:none;">${escapeHtml(support)}</a>.<br>`}
      ${extra.length ? `${extra.map((l) => `<a href="${escapeHtml(l.url!)}" style="color:${EK.gold};text-decoration:none;">${escapeHtml(l.label)}</a>`).join(" · ")}<br>` : ""}
      ${o.compact ? "" : "Nunca te pediremos tu contraseña ni datos de tarjeta por correo."}
    </td></tr>
    <tr><td class="ek-space" height="${top}" style="height:${top}px;line-height:${top}px;font-size:1px;">&nbsp;</td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** Pie del texto plano, igual al de la versión HTML. */
export function textFooter(o: { reason: string; siteUrl?: string | null; supportEmail?: string | null; footerLinks?: Array<{ href: string; label: string }>; internal?: boolean }): string[] {
  const site = normalizeSite(o.siteUrl);
  const support = o.supportEmail || DEFAULT_SUPPORT_EMAIL;
  if (o.internal) return ["—", `IATOS AI · ${site.replace(/^https?:\/\//, "")}`, o.reason];
  return [
    "—",
    `IATOS AI · ${site.replace(/^https?:\/\//, "")}`,
    o.reason,
    `¿Dudas? Responde a este correo o escríbenos a ${support}.`,
    ...(o.footerLinks ?? []).filter((l) => safeUrl(l.href)).map((l) => `${l.label}: ${l.href}`),
    "Nunca te pediremos tu contraseña ni datos de tarjeta por correo.",
  ];
}

/** Une líneas de texto plano: quita nulos y colapsa más de una línea vacía seguida. */
export function joinText(lines: Array<string | null | undefined | false>): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l === null || l === undefined || l === false) continue;
    if (l === "" && out[out.length - 1] === "") continue;
    out.push(l);
  }
  return out.join("\n").trim() + "\n";
}
