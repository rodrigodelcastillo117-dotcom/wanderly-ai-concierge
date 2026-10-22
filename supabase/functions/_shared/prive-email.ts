// Correos de IATOS Privé: la invitación cinematográfica (texto del dueño, contrato §6) y los avisos
// de seguridad (contraseña creada/cambiada/restablecida, bloqueo, sesiones cerradas, nuevo acceso) y
// el enlace de restablecimiento. Funciones puras (HTML + texto), probadas en src/test/priveEmail.test.ts.
//
// Reglas:
//   * Ningún correo lleva una contraseña. Ningún enlace lleva el correo ni datos personales: el token
//     va solo en el FRAGMENTO (#t=…), que el navegador no manda a servidores, bitácoras ni Referer.
//   * Todo texto variable (el nombre) pasa por escapeHtml.
//   * Maqueta de tablas de 600 px con estilos en línea (Gmail, Outlook, Apple Mail), monograma en
//     texto vivo dentro de un anillo dorado (se ve aunque se bloqueen las imágenes: no hay imágenes),
//     botón "a prueba de balas" (tabla + VML para Outlook), color-scheme oscuro declarado.
import { escapeHtml } from "./email.ts";

export const PRIVE_COLORS = {
  black: "#0A0A0B",
  panel: "#111113",
  gold: "#C8B48A",
  goldSoft: "#A8976F",
  ivory: "#F2EDE4",
  muted: "#9C968B",
  line: "#2A2722",
} as const;

const SERIF = "'Cormorant Garamond', 'Playfair Display', Didot, 'Bodoni 72', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const DEFAULT_SITE_URL = "https://traveliatos.life";
export const DEFAULT_SUPPORT_EMAIL = "hola@traveliatos.life";

export type PriveEmail = { subject: string; preheader: string; html: string; text: string };

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

// Relleno invisible tras el preencabezado para que el cliente no muestre el cuerpo como vista previa.
const PREHEADER_PAD = "&#8199;&#65279;&#847; ".repeat(60);

function monogram(): string {
  // Anillo dorado con "P" en texto vivo. Outlook (Word) no hace border-radius: usa el óvalo VML.
  return `
  <!--[if mso]>
  <v:oval xmlns:v="urn:schemas-microsoft-com:vml" style="width:84px;height:84px;" strokecolor="${PRIVE_COLORS.gold}" strokeweight="1px" fillcolor="${PRIVE_COLORS.black}">
    <v:textbox inset="0,14px,0,0"><center style="font-family:Georgia,serif;font-size:34px;color:${PRIVE_COLORS.gold};font-style:italic;">P</center></v:textbox>
  </v:oval>
  <![endif]-->
  <!--[if !mso]><!-->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;border-collapse:separate;">
    <tr><td width="82" height="82" align="center" valign="middle" class="pv-mono"
      style="width:82px;height:82px;border:1px solid ${PRIVE_COLORS.gold};border-radius:50%;text-align:center;vertical-align:middle;
             font-family:${SERIF};font-size:36px;line-height:82px;font-style:italic;color:${PRIVE_COLORS.gold};mso-line-height-rule:exactly;">P</td></tr>
  </table>
  <!--<![endif]-->`;
}

function button(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr><td align="center" bgcolor="${PRIVE_COLORS.gold}" style="background-color:${PRIVE_COLORS.gold};border-radius:2px;">
      <!--[if mso]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}"
        style="height:52px;v-text-anchor:middle;width:340px;" stroke="f" fillcolor="${PRIVE_COLORS.gold}">
        <w:anchorlock/><center style="color:${PRIVE_COLORS.black};font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;font-weight:bold;">${safeLabel}</center>
      </v:rect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${safeHref}" target="_blank" rel="noopener" class="pv-btn"
        style="display:inline-block;padding:18px 34px;font-family:${SANS};font-size:13px;line-height:16px;font-weight:600;letter-spacing:0.22em;
               color:${PRIVE_COLORS.black};text-decoration:none;text-transform:uppercase;border-radius:2px;mso-hide:all;">${safeLabel}</a>
      <!--<![endif]-->
    </td></tr>
  </table>`;
}

function rule(width = 48): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr><td width="${width}" height="1" style="width:${width}px;height:1px;line-height:1px;font-size:1px;background-color:${PRIVE_COLORS.gold};">&nbsp;</td></tr></table>`;
}

type ShellOpts = {
  title: string;
  preheader: string;
  inner: string;
  footerReason: string;
  supportEmail: string;
  siteUrl: string;
};

function shell(o: ShellOpts): string {
  const support = escapeHtml(o.supportEmail);
  const site = escapeHtml(o.siteUrl);
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
  html, body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${PRIVE_COLORS.black}; }
  * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  a { color:${PRIVE_COLORS.gold}; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  u + #body a { color:inherit; text-decoration:none; }
  @media (prefers-color-scheme: dark) {
    .pv-bg { background-color:${PRIVE_COLORS.black} !important; }
  }
  @media screen and (max-width: 620px) {
    .pv-container { width:100% !important; }
    .pv-pad { padding-left:28px !important; padding-right:28px !important; }
    .pv-hero { font-size:28px !important; line-height:36px !important; }
    .pv-body { font-size:16px !important; line-height:27px !important; }
    .pv-btn { padding:17px 22px !important; letter-spacing:0.16em !important; }
    .pv-space-xl { height:56px !important; }
  }
</style>
</head>
<body id="body" class="pv-bg" style="margin:0;padding:0;background-color:${PRIVE_COLORS.black};" bgcolor="${PRIVE_COLORS.black}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${PRIVE_COLORS.black};">${escapeHtml(o.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PRIVE_COLORS.black}" class="pv-bg" style="background-color:${PRIVE_COLORS.black};">
<tr><td align="center" style="padding:0;">
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
  <table role="presentation" class="pv-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;margin:0 auto;">
    <tr><td class="pv-space-xl" height="72" style="height:72px;line-height:72px;font-size:1px;">&nbsp;</td></tr>
    <tr><td align="center" class="pv-pad" style="padding:0 56px;font-family:${SANS};font-size:12px;line-height:16px;letter-spacing:0.42em;color:${PRIVE_COLORS.gold};text-transform:uppercase;">IATOS PRIVÉ</td></tr>
    <tr><td height="40" style="height:40px;line-height:40px;font-size:1px;">&nbsp;</td></tr>
    <tr><td align="center">${monogram()}</td></tr>
    ${o.inner}
    <tr><td height="64" style="height:64px;line-height:64px;font-size:1px;">&nbsp;</td></tr>
    <tr><td class="pv-pad" style="padding:0 56px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td height="1" style="height:1px;line-height:1px;font-size:1px;border-top:1px solid ${PRIVE_COLORS.line};">&nbsp;</td></tr></table></td></tr>
    <tr><td align="center" class="pv-pad" style="padding:28px 56px 0;font-family:${SANS};font-size:12px;line-height:20px;color:${PRIVE_COLORS.muted};">
      <span style="letter-spacing:0.2em;text-transform:uppercase;color:${PRIVE_COLORS.goldSoft};">IATOS AI</span><br>
      ${escapeHtml(o.footerReason)}<br>
      ¿Dudas? Escríbenos a <a href="mailto:${support}" style="color:${PRIVE_COLORS.gold};text-decoration:none;">${support}</a>
      · <a href="${site}" style="color:${PRIVE_COLORS.gold};text-decoration:none;">${escapeHtml(o.siteUrl.replace(/^https?:\/\//, ""))}</a><br>
      Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.
    </td></tr>
    <tr><td class="pv-space-xl" height="72" style="height:72px;line-height:72px;font-size:1px;">&nbsp;</td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
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
};

/** La invitación cinematográfica (texto del dueño, contrato §6, sin cambios). */
export function priveInvitationEmail(o: InvitationEmailOpts): PriveEmail {
  const siteUrl = normalizeSiteUrl(o.siteUrl);
  const link = fragmentLink(siteUrl, "/prive/invitacion", o.token);
  const name = displayFirstName(o.firstName);
  const support = o.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const subject = "A private invitation awaits you.";
  const preheader = "90 days. A new world opens.";
  const tenure = o.basis !== "grant";
  const intro = tenure
    ? "Después de 90 días como miembro de IATOS PRO, tu acceso personal a IATOS Privé está listo."
    : "Tu acceso personal a IATOS Privé está listo.";
  const reason = tenure
    ? "Recibes este correo porque tu membresía IATOS PRO cumplió 90 días pagados. La invitación es personal: solo se abre con tu cuenta."
    : "Recibes este correo porque el equipo de IATOS te concedió acceso a IATOS Privé. La invitación es personal: solo se abre con tu cuenta.";

  const inner = [
    gap(44),
    name ? p(`Para ${escapeHtml(name)}`, `font-size:15px;line-height:22px;font-style:italic;letter-spacing:0.04em;color:${PRIVE_COLORS.gold};`) + gap(28) : "",
    `<tr><td align="center" class="pv-pad pv-hero" style="padding:0 56px;font-family:${SERIF};font-size:34px;line-height:44px;font-weight:400;color:${PRIVE_COLORS.ivory};">There are places you visit.<br>And there are worlds you enter.</td></tr>`,
    gap(36),
    `<tr><td align="center" class="pv-pad">${rule(48)}</td></tr>`,
    gap(36),
    p(escapeHtml(intro)),
    gap(20),
    p("Una colección de experiencias extraordinarias, destinos excepcionales y recomendaciones elegidas para ti.", `color:${PRIVE_COLORS.muted};`),
    gap(40),
    p("Your invitation is ready.", `font-size:22px;line-height:30px;font-style:italic;color:${PRIVE_COLORS.gold};`),
    gap(40),
    `<tr><td align="center" class="pv-pad" style="padding:0 40px;">${button(link, "OPEN YOUR PRIVATE INVITATION")}</td></tr>`,
    gap(28),
    `<tr><td align="center" class="pv-pad" style="padding:0 56px;font-family:${SANS};font-size:12px;line-height:19px;color:${PRIVE_COLORS.muted};">
      Si el botón no abre, copia este enlace en tu navegador e inicia sesión con tu cuenta de IATOS:<br>
      <a href="${escapeHtml(link)}" style="color:${PRIVE_COLORS.goldSoft};word-break:break-all;text-decoration:underline;">${escapeHtml(link)}</a><br>
      El enlace vence en 30 días; también puedes abrir tu invitación desde Privé en la app.</td></tr>`,
    gap(56),
    p("The World, Beyond Ordinary.", `font-size:16px;line-height:24px;font-style:italic;letter-spacing:0.06em;color:${PRIVE_COLORS.gold};`),
  ].join("\n");

  const html = shell({ title: subject, preheader, inner, footerReason: reason, supportEmail: support, siteUrl });
  const text = [
    "IATOS PRIVÉ",
    "",
    name ? `Para ${name}` : null,
    name ? "" : null,
    "There are places you visit.",
    "And there are worlds you enter.",
    "",
    intro,
    "",
    "Una colección de experiencias extraordinarias, destinos excepcionales y recomendaciones elegidas para ti.",
    "",
    "Your invitation is ready.",
    "",
    "OPEN YOUR PRIVATE INVITATION:",
    link,
    "",
    "El enlace vence en 30 días y solo se abre con tu cuenta de IATOS. También puedes abrir tu invitación desde Privé en la app.",
    "",
    "The World, Beyond Ordinary.",
    "",
    "—",
    "IATOS AI",
    reason,
    `¿Dudas? Escríbenos a ${support} · ${siteUrl.replace(/^https?:\/\//, "")}`,
    "Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.",
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
  const html = shell({ title: copy.subject, preheader, inner, footerReason: reason, supportEmail: support, siteUrl });
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
    `¿Dudas? Escríbenos a ${support}`,
    "Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.",
  ].filter((l) => l !== null).join("\n");
  return { subject: copy.subject, preheader, html, text };
}

/** Enlace para restablecer la contraseña Privé (pedido por la persona desde la app). */
export function priveResetEmail(o: { firstName?: string | null; token: string; siteUrl?: string | null; supportEmail?: string | null }): PriveEmail {
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
  const html = shell({ title: subject, preheader, inner, footerReason: reason, supportEmail: support, siteUrl });
  const text = [
    "IATOS PRIVÉ", "", name ? `${name}:` : null, "Crea una nueva contraseña Privé.", "",
    "Pediste restablecer tu contraseña de IATOS Privé. Ábrelo con la misma cuenta de IATOS.",
    "El enlace vence en 30 minutos y solo sirve una vez. Si no lo pediste, ignora este correo: tu contraseña no cambia.", "",
    `RESTABLECER MI CONTRASEÑA: ${link}`, "", "—", "IATOS AI", reason, `¿Dudas? Escríbenos a ${support}`,
    "Nunca te pediremos tu contraseña por correo, mensaje ni teléfono.",
  ].filter((l) => l !== null).join("\n");
  return { subject, preheader, html, text };
}
