// Correos de IATOS Privé: la invitación (tarjeta negra "entregada en mano") y los avisos de seguridad
// (contraseña creada/cambiada/restablecida, bloqueo, sesiones cerradas, nuevo acceso) y el enlace de
// restablecimiento. Funciones puras (HTML + texto), probadas en src/test/priveEmail*.test.ts.
// Diseño y entregabilidad: docs/iatos/IATOS_PRIVE_EMAIL_DESIGN.md e IATOS_ENTREGABILIDAD_CORREO.md.
//
// Reglas:
//   * Ningún correo lleva una contraseña. Ningún enlace lleva el correo ni datos personales: el token
//     va solo en el FRAGMENTO (#t=…), que el navegador no manda a servidores, bitácoras ni Referer.
//   * Todo texto variable (nombre, código de miembro) pasa por escapeHtml.
//   * Maqueta de tablas de 600 px con estilos en línea (Gmail, Outlook, Apple Mail). CERO imágenes y
//     cero recursos remotos (ni fuentes web): el monograma es texto vivo dentro de un doble anillo, así
//     que se ve igual con las imágenes bloqueadas. Botón "a prueba de balas" (tabla + VML para Outlook).
//   * Entregabilidad: idioma de la persona (español por defecto), asunto personal y sereno, sin
//     palabras de promoción, sin texto oculto de relleno, todos los enlaces en el dominio propio y una
//     parte de texto plano completa.
import { escapeHtml } from "./email-format.ts";

export const PRIVE_COLORS = {
  black: "#0A0A0B",
  card: "#0E0E10",
  panel: "#111113",
  gold: "#C8B48A",
  goldFoil: "#DCCB9F",
  goldDeep: "#7A6A4C",
  goldSoft: "#A8976F",
  ivory: "#F2EDE4",
  muted: "#9C968B",
  quiet: "#77726A",
  line: "#2A2722",
  cardLine: "#26231E",
  frame: "#3A3226",
} as const;

// Pilas tipográficas seguras (sin fuentes web: Gmail no las carga y son una petición remota más).
// Display: Didot/Bodoni en Apple, Georgia en el resto. Texto: Baskerville/Palatino, Georgia de respaldo.
const DISPLAY = "Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, 'Times New Roman', serif";
const SERIF = "Baskerville, 'Baskerville Old Face', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const DEFAULT_SITE_URL = "https://traveliatos.life";
export const DEFAULT_SUPPORT_EMAIL = "hola@traveliatos.life";
/** Remitente de Privé: mismo buzón y dominio que el resto (la reputación es del dominio), otro nombre visible. */
export const PRIVE_FROM = "IATOS Privé <hola@traveliatos.life>";
/** Presupuesto de tamaño: Gmail recorta ("Mensaje recortado") los HTML de más de 102 KB. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export type PriveLocale = "es" | "en";
export type PriveEmail = { subject: string; preheader: string; html: string; text: string };

/** Idioma principal de la persona: inglés solo si el perfil dice inglés ("en", "en-US"…); si no, español. */
export function resolvePriveLocale(value: string | null | undefined): PriveLocale {
  return /^en(?:[-_][A-Za-z]{2,4})?$/i.test(String(value ?? "").trim()) ? "en" : "es";
}

/** Reply-To configurado (env PRIVE_REPLY_TO) solo si parece un buzón válido; si no, no se manda. */
export function priveReplyTo(raw: string | null | undefined): string | undefined {
  const v = String(raw ?? "").trim();
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v) && v.length <= 254 ? v : undefined;
}

/** Encabezado X-Entity-Ref-ID estable por invitación: Gmail no agrupa invitaciones distintas en un hilo. */
export function priveEntityRefId(invitationId: string): string {
  return `prive-invitacion-${String(invitationId).replace(/[^A-Za-z0-9-]/g, "").slice(0, 64)}`;
}

/** Origen del sitio sin barra final; solo https (o http://localhost para pruebas locales). */
export function normalizeSiteUrl(siteUrl: string | null | undefined): string {
  const raw = (siteUrl ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) {
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    // cae al valor por defecto
  }
  return DEFAULT_SITE_URL;
}

/** Enlace con el token SOLO en el fragmento. Nunca acepta un token con forma rara. */
export function fragmentLink(siteUrl: string, path: "/prive/invitacion" | "/prive/restablecer", token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("token inválido para el enlace");
  return `${normalizeSiteUrl(siteUrl)}${path}#t=${token}`;
}

/** Primer nombre presentable (máx. 40 caracteres) o null. El escape se hace al pintarlo. */
export function displayFirstName(name: string | null | undefined): string | null {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  // deno-lint-ignore no-control-regex
  const clean = first.replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, 40);
  return clean ? clean.charAt(0).toLocaleUpperCase("es-MX") + clean.slice(1) : null;
}

/** Código de miembro ("IP-7KQM-X4TD") solo si tiene la forma esperada. */
function cleanMemberCode(code: string | null | undefined): string | null {
  const c = String(code ?? "").trim().toUpperCase();
  return /^IP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c) ? c : null;
}

function monogram(): string {
  // Sello: doble anillo (exterior en oro profundo, interior en oro champaña) con una "P" de texto vivo
  // en serif de alto contraste. Outlook (Word) no redondea: dibuja dos óvalos VML con el mismo texto.
  const C = PRIVE_COLORS;
  return `
  <!--[if mso]>
  <v:group xmlns:v="urn:schemas-microsoft-com:vml" style="width:104px;height:104px;" coordsize="104,104">
    <v:oval style="position:absolute;left:0;top:0;width:104px;height:104px;" strokecolor="${C.goldDeep}" strokeweight="1px" filled="f"/>
    <v:oval style="position:absolute;left:6px;top:6px;width:92px;height:92px;" strokecolor="${C.gold}" strokeweight="1px" fillcolor="${C.card}">
      <v:textbox inset="0,16px,0,0"><center style="font-family:Georgia,serif;font-size:42px;color:${C.goldFoil};">P</center></v:textbox>
    </v:oval>
  </v:group>
  <![endif]-->
  <!--[if !mso]><!-->
  <table role="presentation" aria-hidden="true" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;border-collapse:separate;">
    <tr><td align="center" valign="middle" style="padding:5px;border:1px solid ${C.goldDeep};border-radius:50%;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:separate;">
        <tr><td width="92" height="92" align="center" valign="middle" class="pv-mono"
          style="border:1px solid ${C.gold};border-radius:50%;width:92px;height:92px;text-align:center;vertical-align:middle;font-family:${DISPLAY};font-size:46px;line-height:92px;font-weight:400;color:${C.goldFoil};text-shadow:0 1px 0 #3A3122;mso-line-height-rule:exactly;">P</td></tr>
      </table>
    </td></tr>
  </table>
  <!--<![endif]-->`;
}

function button(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  const C = PRIVE_COLORS;
  // El texto del botón va en minúsculas en el código (los filtros leen la fuente, no el CSS) y se
  // muestra en versalitas con text-transform. Outlook no aplica text-transform: se le da ya en mayúsculas.
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr><td align="center" bgcolor="${C.gold}" style="background-color:${C.gold};border-radius:1px;">
      <!--[if mso]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}"
        style="height:54px;v-text-anchor:middle;width:300px;" stroke="f" fillcolor="${C.gold}">
        <w:anchorlock/><center style="color:${C.black};font-family:Arial,sans-serif;font-size:12px;letter-spacing:3px;font-weight:bold;">${escapeHtml(label.toLocaleUpperCase("es-MX"))}</center>
      </v:rect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${safeHref}" target="_blank" rel="noopener" class="pv-btn"
        style="display:inline-block;padding:19px 44px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.26em;
               color:${C.black};text-decoration:none;text-transform:uppercase;border-radius:1px;mso-hide:all;">${safeLabel}</a>
      <!--<![endif]-->
    </td></tr>
  </table>`;
}

/** Texto escapado sin viudas: une las dos últimas palabras con un espacio duro. */
function typeset(v: string): string {
  return escapeHtml(v).replace(/ (\S+)$/, "&nbsp;$1");
}

function rule(width = 48, color: string = PRIVE_COLORS.gold): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr><td width="${width}" height="1" style="width:${width}px;height:1px;line-height:1px;font-size:1px;background-color:${color};">&nbsp;</td></tr></table>`;
}

type ShellOpts = {
  title: string;
  preheader: string;
  inner: string;
  footerReason: string;
  supportEmail: string;
  siteUrl: string;
  locale?: PriveLocale;
  /** Si hay un Reply-To que sí recibe, el pie invita a responder en lugar de mostrar un buzón. */
  replyTo?: string;
  /** HTML (ya escapado) que va fuera de la tarjeta, antes del pie: p. ej. el enlace de respaldo. */
  afterCard?: string;
};

const FOOTER_COPY = {
  es: {
    replyHint: "¿Alguna pregunta? Basta con responder a este correo; lo lee una persona del equipo.",
    writeUs: "¿Dudas? Escríbenos a",
    never: "Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.",
  },
  en: {
    replyHint: "Any questions? Simply reply to this email; a person on our team reads it.",
    writeUs: "Questions? Write to us at",
    never: "We will never ask for your password by email, message or phone.",
  },
} as const;

function footerContactHtml(o: { locale: PriveLocale; replyTo?: string; supportEmail: string }): string {
  const f = FOOTER_COPY[o.locale];
  if (o.replyTo) return typeset(f.replyHint);
  const support = escapeHtml(o.supportEmail);
  return `${escapeHtml(f.writeUs)} <a href="mailto:${support}" style="color:${PRIVE_COLORS.goldSoft};text-decoration:none;">${support}</a>`;
}

function footerContactText(o: { locale: PriveLocale; replyTo?: string; supportEmail: string }): string {
  const f = FOOTER_COPY[o.locale];
  return o.replyTo ? f.replyHint : `${f.writeUs} ${o.supportEmail}`;
}

function shell(o: ShellOpts): string {
  const C = PRIVE_COLORS;
  const locale = o.locale ?? "es";
  const site = escapeHtml(o.siteUrl);
  const siteLabel = escapeHtml(o.siteUrl.replace(/^https?:\/\//, ""));
  return `<!doctype html>
<html lang="${locale}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
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
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  html, body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${C.black}; }
  * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  h1 { margin:0; }
  a { color:${C.gold}; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  u + #body a { color:inherit; text-decoration:none; }
  @media (prefers-color-scheme: dark) {
    .pv-bg { background-color:${C.black} !important; }
    .pv-card { background-color:${C.card} !important; }
  }
  @media screen and (max-width: 620px) {
    .pv-container { width:100% !important; }
    .pv-outer { padding-left:12px !important; padding-right:12px !important; }
    .pv-pad { padding-left:22px !important; padding-right:22px !important; }
    .pv-frame { padding:6px !important; }
    .pv-name { font-size:38px !important; line-height:46px !important; }
    .pv-hero { font-size:23px !important; line-height:33px !important; }
    .pv-body { font-size:16px !important; line-height:27px !important; }
    .pv-btn { padding:18px 24px !important; letter-spacing:0.16em !important; }
    .pv-space-xl { height:48px !important; line-height:48px !important; }
  }
</style>
</head>
<body id="body" class="pv-bg" style="margin:0;padding:0;background-color:${C.black};word-spacing:normal;" bgcolor="${C.black}">
<div role="article" aria-roledescription="email" aria-label="${escapeHtml(o.title)}" lang="${locale}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.black}" class="pv-bg" style="background-color:${C.black};">
<tr><td align="center" class="pv-outer" style="padding:0;">
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
  <table role="presentation" class="pv-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;margin:0 auto;">
    <tr><td class="pv-space-xl" height="56" style="height:56px;line-height:56px;font-size:1px;">&nbsp;</td></tr>
    <tr><td class="pv-card pv-frame" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.cardLine};padding:9px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.frame};">
        <tr><td class="pv-space-xl" height="64" style="height:64px;line-height:64px;font-size:1px;">&nbsp;</td></tr>
        <tr><td align="center">${monogram()}</td></tr>
        <tr><td height="26" style="height:26px;line-height:26px;font-size:1px;">&nbsp;</td></tr>
        <tr><td align="center" class="pv-pad" style="padding:0 56px;font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.5em;color:${C.gold};text-transform:uppercase;">IATOS PRIVÉ</td></tr>
        ${o.inner}
        <tr><td class="pv-space-xl" height="64" style="height:64px;line-height:64px;font-size:1px;">&nbsp;</td></tr>
      </table>
    </td></tr>
    ${o.afterCard ?? ""}
    <tr><td align="center" class="pv-pad" style="padding:36px 48px 0;font-family:${SANS};font-size:11px;line-height:19px;color:${C.quiet};">
      <span style="letter-spacing:0.32em;text-transform:uppercase;color:${C.goldSoft};">IATOS AI</span>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${site}" style="color:${C.goldSoft};text-decoration:none;">${siteLabel}</a><br><br>
      ${typeset(o.footerReason)}<br>
      ${footerContactHtml({ locale, replyTo: o.replyTo, supportEmail: o.supportEmail })}<br>
      ${typeset(FOOTER_COPY[locale].never)}
    </td></tr>
    <tr><td class="pv-space-xl" height="64" style="height:64px;line-height:64px;font-size:1px;">&nbsp;</td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
}

const p = (html: string, style = "") =>
  `<tr><td align="center" class="pv-pad pv-body" style="padding:0 56px;font-family:${SERIF};font-size:18px;line-height:30px;color:${PRIVE_COLORS.ivory};${style}">${html}</td></tr>`;
const gap = (h: number) => `<tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</td></tr>`;

export type InvitationEmailOpts = {
  firstName?: string | null;
  token: string;
  siteUrl?: string | null;
  supportEmail?: string | null;
  /** 'tenure' = cumplió 90 días de PRO pagado; 'grant' = el equipo le concedió el acceso. */
  basis?: "tenure" | "grant";
  /** Idioma del perfil ("es", "en", "en-US"…). Sin dato: español. */
  locale?: string | null;
  /** Código de miembro (IP-XXXX-XXXX). Opcional: hoy la app lo revela al aceptar, no en el correo. */
  memberCode?: string | null;
  /** Buzón que SÍ recibe (env PRIVE_REPLY_TO). Si existe, el pie invita a responder. */
  replyTo?: string | null;
};

type InvitationCopy = {
  subjectNamed: (name: string) => string;
  subjectPlain: string;
  preheader: string;
  salutation: string;
  hero: [string, string];
  bodyTenure: string;
  bodyGrant: string;
  ceremony: string;
  cta: string;
  note: string;
  fallback: string;
  memberLabel: string;
  tagline: string;
  reasonTenure: string;
  reasonGrant: string;
};

const INVITATION_COPY: Record<PriveLocale, InvitationCopy> = {
  es: {
    subjectNamed: (n) => `${n}, tu invitación a IATOS Privé`,
    subjectPlain: "Tu invitación a IATOS Privé",
    preheader: "Una invitación personal, a tu nombre.",
    salutation: "Para",
    hero: ["Hay lugares que se visitan.", "Y hay mundos a los que se entra."],
    bodyTenure:
      "Llevas noventa días recorriendo el mundo con IATOS. Desde hoy, IATOS Privé te abre sus puertas: destinos, mesas y experiencias elegidos uno a uno, pensados para ti.",
    bodyGrant:
      "El equipo de IATOS ha guardado tu lugar en IATOS Privé: destinos, mesas y experiencias elegidos uno a uno, pensados para ti.",
    ceremony: "Esta puerta ahora es tuya.",
    cta: "Abrir mi invitación",
    note: "Es personal y se abre solo con tu cuenta de IATOS. Te esperará 30 días; también la encontrarás en Privé, dentro de la app.",
    fallback: "¿El botón no responde? Copia esta dirección en tu navegador:",
    memberLabel: "Miembro",
    tagline: "El mundo, más allá de lo ordinario.",
    reasonTenure:
      "Recibes este correo porque tu membresía IATOS PRO cumplió 90 días pagados. La invitación es personal: solo se abre con tu cuenta.",
    reasonGrant:
      "Recibes este correo porque el equipo de IATOS te concedió acceso a IATOS Privé. La invitación es personal: solo se abre con tu cuenta.",
  },
  en: {
    subjectNamed: (n) => `${n}, your invitation to IATOS Privé`,
    subjectPlain: "Your invitation to IATOS Privé",
    preheader: "A personal invitation, in your name.",
    salutation: "For",
    hero: ["There are places you visit.", "And there are worlds you enter."],
    bodyTenure:
      "For ninety days you have travelled the world with IATOS. From today, IATOS Privé opens its doors to you: destinations, tables and experiences chosen one by one, with you in mind.",
    bodyGrant:
      "The IATOS team has kept a place for you in IATOS Privé: destinations, tables and experiences chosen one by one, with you in mind.",
    ceremony: "This door is now yours.",
    cta: "Open my invitation",
    note: "It is personal and opens only with your IATOS account. It will wait for you for 30 days; you will also find it in Privé, inside the app.",
    fallback: "Button not responding? Copy this address into your browser:",
    memberLabel: "Member",
    tagline: "The World, Beyond Ordinary.",
    reasonTenure:
      "You are receiving this email because your IATOS PRO membership reached 90 paid days. The invitation is personal: it opens only with your account.",
    reasonGrant:
      "You are receiving this email because the IATOS team granted you access to IATOS Privé. The invitation is personal: it opens only with your account.",
  },
};

/** Asunto: personal y sereno, ≤ 45 caracteres (si el nombre no cabe, sin nombre). */
function invitationSubject(copy: InvitationCopy, name: string | null): string {
  const named = name ? copy.subjectNamed(name) : null;
  return named && named.length <= 45 ? named : copy.subjectPlain;
}

/** La invitación a IATOS Privé: tarjeta negra, monograma dorado, el nombre de la persona y un botón. */
export function priveInvitationEmail(o: InvitationEmailOpts): PriveEmail {
  const C = PRIVE_COLORS;
  const siteUrl = normalizeSiteUrl(o.siteUrl);
  const link = fragmentLink(siteUrl, "/prive/invitacion", o.token);
  const locale = resolvePriveLocale(o.locale);
  const copy = INVITATION_COPY[locale];
  const name = displayFirstName(o.firstName);
  const memberCode = cleanMemberCode(o.memberCode);
  const replyTo = priveReplyTo(o.replyTo);
  const support = o.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const subject = invitationSubject(copy, name);
  const preheader = copy.preheader;
  const tenure = o.basis !== "grant";
  const body = tenure ? copy.bodyTenure : copy.bodyGrant;
  const reason = tenure ? copy.reasonTenure : copy.reasonGrant;

  const inner = [
    gap(48),
    // "Para Rodrigo" en una sola línea, como se escribe a mano en un sobre.
    name
      ? `<tr><td align="center" class="pv-pad pv-name" style="padding:0 40px;font-family:${DISPLAY};font-size:40px;line-height:50px;font-style:italic;font-weight:400;letter-spacing:0.01em;color:${C.ivory};word-break:break-word;">${escapeHtml(copy.salutation)} ${escapeHtml(name)}</td></tr>` + gap(36)
      : "",
    `<tr><td align="center" class="pv-pad">${rule(40, C.goldDeep)}</td></tr>`,
    gap(36),
    `<tr><td align="center" class="pv-pad" style="padding:0 56px;"><h1 class="pv-hero" style="margin:0;font-family:${DISPLAY};font-size:27px;line-height:38px;font-weight:400;color:${C.ivory};">${escapeHtml(copy.hero[0])}<br>${escapeHtml(copy.hero[1])}</h1></td></tr>`,
    gap(26),
    p(typeset(body), `padding:0 76px;font-size:17px;line-height:29px;color:${C.muted};`),
    gap(30),
    p(typeset(copy.ceremony), `font-family:${DISPLAY};font-size:21px;line-height:30px;font-style:italic;color:${C.gold};`),
    gap(44),
    `<tr><td align="center" class="pv-pad" style="padding:0 40px;">${button(link, copy.cta)}</td></tr>`,
    gap(26),
    `<tr><td align="center" class="pv-pad" style="padding:0 64px;font-family:${SANS};font-size:12px;line-height:20px;color:${C.muted};">${typeset(copy.note)}</td></tr>`,
    memberCode
      ? gap(36) +
        `<tr><td align="center" class="pv-pad" style="padding:0 56px;font-family:${SANS};font-size:10px;line-height:16px;letter-spacing:0.42em;text-transform:uppercase;color:${C.goldSoft};">${escapeHtml(copy.memberLabel)}</td></tr>` +
        gap(6) +
        `<tr><td align="center" class="pv-pad" style="padding:0 56px;font-family:${DISPLAY};font-size:17px;line-height:24px;letter-spacing:0.22em;color:${C.ivory};">${escapeHtml(memberCode)}</td></tr>`
      : "",
    gap(48),
    `<tr><td align="center" class="pv-pad">${rule(24, C.goldDeep)}</td></tr>`,
    gap(22),
    p(escapeHtml(copy.tagline), `font-family:${DISPLAY};font-size:15px;line-height:22px;font-style:italic;letter-spacing:0.08em;color:${C.goldSoft};`),
  ].join("\n");

  const afterCard = `<tr><td align="center" class="pv-pad" style="padding:32px 48px 0;font-family:${SANS};font-size:11px;line-height:18px;color:${C.quiet};">
      ${typeset(copy.fallback)}<br>
      <a href="${escapeHtml(link)}" style="color:${C.goldSoft};word-break:break-all;text-decoration:underline;">${escapeHtml(link)}</a></td></tr>`;
  const html = shell({ title: subject, preheader, inner, footerReason: reason, supportEmail: support, siteUrl, locale, replyTo, afterCard });
  const text = [
    "IATOS PRIVÉ",
    "",
    name ? `${copy.salutation} ${name}` : null,
    name ? "" : null,
    copy.hero[0],
    copy.hero[1],
    "",
    body,
    "",
    copy.ceremony,
    "",
    `${copy.cta}:`,
    link,
    "",
    copy.note,
    memberCode ? "" : null,
    memberCode ? `${copy.memberLabel}: ${memberCode}` : null,
    "",
    copy.tagline,
    "",
    "—",
    "IATOS AI · " + siteUrl.replace(/^https?:\/\//, ""),
    reason,
    footerContactText({ locale, replyTo, supportEmail: support }),
    FOOTER_COPY[locale].never,
  ].filter((l) => l !== null).join("\n");
  return { subject, preheader, html, text };
}

export type NoticeKind =
  | "password_set" | "password_changed" | "password_reset" | "sessions_revoked" | "new_access" | "hard_lock" | "compromised";

type NoticeCopy = { subject: string; title: string; lines: string[]; action?: "reset" | "membership" };

const NOTICE_COPY: Record<NoticeKind, NoticeCopy> = {
  password_set: {
    subject: "Creaste tu contraseña de IATOS Privé",
    title: "Tu contraseña Privé quedó lista.",
    lines: ["Desde ahora, Privé te la pedirá en cada dispositivo nuevo.", "Si no fuiste tú, restablécela de inmediato desde Privé › Membresía."],
    action: "membership",
  },
  password_changed: {
    subject: "Tu contraseña de IATOS Privé cambió",
    title: "Cambiaste tu contraseña Privé.",
    lines: ["Cerramos las demás sesiones de Privé por seguridad.", "Si no fuiste tú, restablécela de inmediato desde Privé › Membresía."],
    action: "membership",
  },
  password_reset: {
    subject: "Restableciste tu contraseña de IATOS Privé",
    title: "Tu nueva contraseña Privé quedó lista.",
    lines: ["Cerramos todas las sesiones anteriores de Privé.", "Si no fuiste tú, escríbenos de inmediato."],
    action: "membership",
  },
  sessions_revoked: {
    subject: "Cerraste todas tus sesiones de IATOS Privé",
    title: "Cerraste todas tus sesiones de Privé.",
    lines: ["Para volver a entrar tendrás que escribir tu contraseña Privé en cada dispositivo."],
  },
  new_access: {
    subject: "Nuevo acceso a tu IATOS Privé",
    title: "Alguien entró a tu Privé después de varios intentos fallidos.",
    lines: ["Si fuiste tú, no tienes que hacer nada.", "Si no fuiste tú, cambia tu contraseña Privé y cierra todas las sesiones desde Privé › Membresía."],
    action: "membership",
  },
  hard_lock: {
    subject: "Bloqueamos tu contraseña de IATOS Privé",
    title: "Bloqueamos tu contraseña Privé.",
    lines: ["Hubo demasiados intentos fallidos y cerramos todas las sesiones de Privé.", "Para volver a entrar, pide un enlace para restablecerla desde Privé en la app."],
    action: "membership",
  },
  compromised: {
    subject: "Protegimos tu IATOS Privé: restablece tu contraseña",
    title: "Protegimos tu Privé.",
    lines: ["Cerramos todas las sesiones de Privé y tu contraseña anterior ya no sirve.", "Crea una nueva con el botón de abajo. El enlace vence en 30 minutos y solo sirve una vez."],
    action: "reset",
  },
};

export type NoticeEmailOpts = {
  kind: NoticeKind;
  firstName?: string | null;
  at?: Date;
  siteUrl?: string | null;
  supportEmail?: string | null;
  /** Solo para 'compromised': token de restablecimiento (va en el fragmento). */
  resetToken?: string | null;
  /** Buzón que sí recibe (env PRIVE_REPLY_TO): el pie invita a responder en vez de a un buzón sin MX. */
  replyTo?: string | null;
};

const formatWhen = (d: Date) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "America/Mexico_City" }).format(d) +
  " (hora del centro de México)";

/** Avisos de seguridad de la cuenta Privé. Nunca incluyen la contraseña. */
export function priveNoticeEmail(o: NoticeEmailOpts): PriveEmail {
  const copy = NOTICE_COPY[o.kind];
  if (!copy) throw new Error(`aviso desconocido: ${o.kind}`);
  const siteUrl = normalizeSiteUrl(o.siteUrl);
  const support = o.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const name = displayFirstName(o.firstName);
  const when = formatWhen(o.at ?? new Date());
  let href: string | null = null;
  let label = "";
  if (copy.action === "reset") {
    if (!o.resetToken) throw new Error("el aviso 'compromised' necesita el token de restablecimiento");
    href = fragmentLink(siteUrl, "/prive/restablecer", o.resetToken);
    label = "RESTABLECER MI CONTRASEÑA";
  } else if (copy.action === "membership") {
    href = `${siteUrl}/prive/membresia`;
    label = "REVISAR MI MEMBRESÍA";
  }
  const preheader = copy.title;
  const inner = [
    gap(44),
    name ? p(`${escapeHtml(name)}:`, `font-size:15px;font-style:italic;color:${PRIVE_COLORS.gold};`) + gap(16) : "",
    `<tr><td align="center" class="pv-pad pv-hero" style="padding:0 56px;font-family:${SERIF};font-size:28px;line-height:38px;color:${PRIVE_COLORS.ivory};">${escapeHtml(copy.title)}</td></tr>`,
    gap(28),
    ...copy.lines.map((l) => p(escapeHtml(l), `font-size:17px;line-height:28px;color:${PRIVE_COLORS.muted};`) + gap(10)),
    p(`Fecha: ${escapeHtml(when)}`, `font-family:${SANS};font-size:12px;line-height:18px;color:${PRIVE_COLORS.muted};`),
    href ? gap(36) + `<tr><td align="center" class="pv-pad" style="padding:0 40px;">${button(href, label)}</td></tr>` : "",
  ].join("\n");
  const reason = "Recibes este aviso de seguridad porque tienes una membresía de IATOS Privé con este correo.";
  const replyTo = priveReplyTo(o.replyTo);
  const html = shell({ title: copy.subject, preheader, inner, footerReason: reason, supportEmail: support, siteUrl, replyTo });
  const text = [
    "IATOS PRIVÉ",
    "",
    name ? `${name}:` : null,
    copy.title,
    "",
    ...copy.lines,
    "",
    `Fecha: ${when}`,
    href ? `\n${label}: ${href}` : null,
    "",
    "—",
    "IATOS AI",
    reason,
    footerContactText({ locale: "es", replyTo, supportEmail: support }),
    "Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.",
  ].filter((l) => l !== null).join("\n");
  return { subject: copy.subject, preheader, html, text };
}

/** Enlace para restablecer la contraseña Privé (pedido por la persona desde la app). */
export function priveResetEmail(o: { firstName?: string | null; token: string; siteUrl?: string | null; supportEmail?: string | null; replyTo?: string | null }): PriveEmail {
  const replyTo = priveReplyTo(o.replyTo);
  const siteUrl = normalizeSiteUrl(o.siteUrl);
  const support = o.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const link = fragmentLink(siteUrl, "/prive/restablecer", o.token);
  const name = displayFirstName(o.firstName);
  const subject = "Restablece tu contraseña de IATOS Privé";
  const preheader = "Tu enlace vence en 30 minutos y solo sirve una vez.";
  const inner = [
    gap(44),
    name ? p(`${escapeHtml(name)}:`, `font-size:15px;font-style:italic;color:${PRIVE_COLORS.gold};`) + gap(16) : "",
    `<tr><td align="center" class="pv-pad pv-hero" style="padding:0 56px;font-family:${SERIF};font-size:28px;line-height:38px;color:${PRIVE_COLORS.ivory};">Crea una nueva contraseña Privé.</td></tr>`,
    gap(28),
    p("Pediste restablecer tu contraseña de IATOS Privé. Ábrelo con la misma cuenta de IATOS.", `font-size:17px;line-height:28px;color:${PRIVE_COLORS.muted};`),
    gap(10),
    p("El enlace vence en 30 minutos y solo sirve una vez. Si no lo pediste, ignora este correo: tu contraseña no cambia.", `font-size:17px;line-height:28px;color:${PRIVE_COLORS.muted};`),
    gap(36),
    `<tr><td align="center" class="pv-pad" style="padding:0 40px;">${button(link, "RESTABLECER MI CONTRASEÑA")}</td></tr>`,
    gap(24),
    `<tr><td align="center" class="pv-pad" style="padding:0 56px;font-family:${SANS};font-size:12px;line-height:19px;color:${PRIVE_COLORS.muted};">
      Si el botón no abre, copia este enlace en tu navegador:<br>
      <a href="${escapeHtml(link)}" style="color:${PRIVE_COLORS.goldSoft};word-break:break-all;text-decoration:underline;">${escapeHtml(link)}</a></td></tr>`,
  ].join("\n");
  const reason = "Recibes este correo porque alguien con tu sesión de IATOS pidió restablecer la contraseña de Privé.";
  const html = shell({ title: subject, preheader, inner, footerReason: reason, supportEmail: support, siteUrl, replyTo });
  const text = [
    "IATOS PRIVÉ", "", name ? `${name}:` : null, "Crea una nueva contraseña Privé.", "",
    "Pediste restablecer tu contraseña de IATOS Privé. Ábrelo con la misma cuenta de IATOS.",
    "El enlace vence en 30 minutos y solo sirve una vez. Si no lo pediste, ignora este correo: tu contraseña no cambia.", "",
    `RESTABLECER MI CONTRASEÑA: ${link}`, "", "—", "IATOS AI", reason, footerContactText({ locale: "es", replyTo, supportEmail: support }),
    "Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.",
  ].filter((l) => l !== null).join("\n");
  return { subject, preheader, html, text };
}
