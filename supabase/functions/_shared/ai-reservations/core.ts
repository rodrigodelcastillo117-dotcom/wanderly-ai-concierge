// Reservas IA v1 · canal correo — reglas puras (sin Deno ni red) compartidas por las funciones
// ai-reservations, reservations-inbound y ai-reservations-cron, y probadas en
// src/test/aiReservations*.test.ts. Diseño y estados: docs/iatos/IATOS_RESERVAS_IA.md.
//
// Regla de honestidad: una reserva solo está "confirmed" cuando el restaurante lo confirmó por
// escrito (remitente verificado + cita textual + datos que coinciden). La base de datos lo vuelve a
// exigir con un CHECK; aquí se decide antes, con datos verificables, sin confiar en el modelo.

export const AI_RESERVATION_STATUSES = [
  "draft", "awaiting_user_ok", "sent", "venue_replied", "needs_user",
  "confirmed", "declined", "expired", "cancelled", "failed",
] as const;
export type AiReservationStatus = typeof AI_RESERVATION_STATUSES[number];

export const ACTIVE_STATUSES: AiReservationStatus[] = ["draft", "awaiting_user_ok", "sent", "venue_replied", "needs_user"];
export const TERMINAL_STATUSES: AiReservationStatus[] = ["declined", "expired", "cancelled", "failed"];

export type AiReservationReason =
  | "no_contact" | "alternative_offered" | "needs_info" | "payment_required"
  | "sender_unverified" | "ambiguous_reply" | "send_failed" | "declined" | "no_reply";

export type VenueLanguage = "es" | "en" | "fr";

/** Alterno propuesto por el restaurante (hora local del lugar). */
export type Alternative = {
  local: string; // YYYY-MM-DDTHH:MM
  note?: string | null;
  /** El restaurante dice que YA lo apartó (no solo que hay lugar). */
  held?: boolean;
  verified_sender?: boolean;
  inbound_email_id?: string;
  quote?: string;
  code?: string | null;
  from_domain?: string;
  /** AUD-03/AUD-06: id del correo recibido en ai_reservation_inbound y cómo quedó aceptada cada condición. */
  inbound_id?: string;
  conditions?: Record<string, unknown>;
  contradictions?: string[];
  stated_party_size?: number | null;
};

/** Fila tal como la devuelven las funciones internas (ai_reservation_json_internal). */
export type AiReservationRow = {
  id: string;
  user_id: string;
  trip_id: string | null;
  ref_code: string;
  reply_token?: string;
  venue_name: string;
  venue_place_id: string | null;
  venue_experience_id: string | null;
  venue_address: string | null;
  venue_city: string | null;
  venue_country: string | null;
  venue_timezone: string;
  venue_email: string | null;
  venue_phone: string | null;
  venue_website: string | null;
  venue_booking_url: string | null;
  venue_maps_url: string | null;
  venue_language: VenueLanguage;
  requested_local: string;
  requested_for: string;
  party_size: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  consent: { share_contact?: boolean; cc_user?: boolean; text?: string; at?: string } | null;
  notes: string | null;
  status: AiReservationStatus;
  reason: AiReservationReason | null;
  user_options: Record<string, unknown> | null;
  alternatives: Alternative[] | null;
  chosen_alternative: (Alternative & { index?: number }) | null;
  confirmation_code: string | null;
  confirmation: Record<string, unknown> | null;
  venue_reply_excerpt: string | null;
  attempts: number;
  sent_at: string | null;
  reminder_sent_at: string | null;
  venue_replied_at: string | null;
  confirmed_at: string | null;
  expires_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
};

// Mismo grafo que public.ai_reservation_transition_ok (la base es la que manda; esto es para la UI
// y para las pruebas de contrato).
export const TRANSITIONS: Record<AiReservationStatus, AiReservationStatus[]> = {
  draft: ["awaiting_user_ok", "needs_user", "cancelled", "failed"],
  awaiting_user_ok: ["sent", "cancelled", "expired", "failed"],
  sent: ["venue_replied", "confirmed", "declined", "needs_user", "expired", "cancelled", "failed"],
  venue_replied: ["confirmed", "declined", "needs_user", "expired", "cancelled"],
  needs_user: ["sent", "confirmed", "venue_replied", "declined", "cancelled", "expired"],
  confirmed: ["cancelled"],
  declined: [],
  expired: [],
  cancelled: [],
  failed: [],
};
export const canTransition = (from: AiReservationStatus, to: AiReservationStatus) => TRANSITIONS[from]?.includes(to) ?? false;

/** Texto corto y honesto para la app. Solo "confirmed" dice "Confirmada", y dice por quién. */
export function statusLabel(status: AiReservationStatus, reason?: AiReservationReason | null): string {
  switch (status) {
    case "draft": return "Preparando solicitud · aún no es una reserva";
    case "awaiting_user_ok": return "Falta tu confirmación · aún no escribimos al restaurante";
    case "sent": return "Solicitud enviada al restaurante · aún no es una reserva";
    case "venue_replied": return "El restaurante respondió · revisa la respuesta · aún no es una reserva confirmada";
    case "needs_user":
      if (reason === "no_contact") return "No encontramos un correo de reservas · elige otra vía";
      if (reason === "alternative_offered") return "El restaurante propone otro horario · elige si te sirve";
      if (reason === "payment_required") return "El restaurante pide garantía o pago · decide tú directamente";
      return "El restaurante pide más información · aún no es una reserva";
    case "confirmed": return "Confirmada por escrito por el restaurante";
    case "declined": return "El restaurante no tiene lugar";
    case "expired": return "Venció sin respuesta del restaurante";
    case "cancelled": return "Cancelada";
    case "failed": return "No se pudo enviar";
  }
}

// Estados del Booking Bridge (grupo bridge). Nunca producimos PRICE_RECHECK_REQUIRED ni
// REDIRECTED_TO_PROVIDER: aquí no hay precio ni redirección, hay una solicitud por correo.
export type BridgeIntentState =
  | "SELECTED" | "PRICE_RECHECK_REQUIRED" | "READY_TO_BOOK" | "REDIRECTED_TO_PROVIDER" | "REQUESTED"
  | "PENDING_CONFIRMATION" | "CONFIRMED" | "FAILED" | "CANCELLED" | "EXPIRED";

export function toBridgeState(status: AiReservationStatus, reason?: AiReservationReason | null): BridgeIntentState {
  switch (status) {
    case "draft": return "SELECTED";
    case "awaiting_user_ok": return "READY_TO_BOOK";
    case "sent": return "REQUESTED";
    case "venue_replied": return "PENDING_CONFIRMATION";
    // Sin correo verificable no hay solicitud posible por este canal: el bridge ofrece otra vía.
    case "needs_user": return reason === "no_contact" ? "FAILED" : "PENDING_CONFIRMATION";
    case "confirmed": return "CONFIRMED";
    case "declined": return "FAILED";
    case "failed": return "FAILED";
    case "cancelled": return "CANCELLED";
    case "expired": return "EXPIRED";
  }
}

// ───────────────────────────── Idioma ─────────────────────────────
const ES_COUNTRIES = new Set(["MX", "ES", "AR", "CO", "CL", "PE", "UY", "PY", "BO", "EC", "VE", "CR", "PA", "GT", "HN", "SV", "NI", "DO", "CU", "PR"]);
const FR_COUNTRIES = new Set(["FR", "MC", "LU"]);

/** Idioma del correo al restaurante: el indicado si lo soportamos; si no, por país; inglés por defecto. */
export function pickVenueLanguage(explicit: unknown, country: unknown): VenueLanguage {
  const l = String(explicit ?? "").toLowerCase().slice(0, 2);
  if (l === "es" || l === "en" || l === "fr") return l;
  const c = String(country ?? "").toUpperCase();
  if (ES_COUNTRIES.has(c)) return "es";
  if (FR_COUNTRIES.has(c)) return "fr";
  return "en";
}

// ───────────────────────────── Token de respuesta ─────────────────────────────
export const DEFAULT_REPLY_DOMAIN = "reply.traveliatos.life";
export const DEFAULT_FROM_ADDRESS = "reservas@traveliatos.life";

/** reservas+<token>@<dominio>: cada reserva tiene su propia dirección de respuesta. */
export function replyAddress(token: string, domain = DEFAULT_REPLY_DOMAIN): string {
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("reply_token inválido");
  return `reservas+${token}@${domain}`;
}

/**
 * Busca el token en las direcciones a las que llegó el correo. Solo acepta el dominio de recepción
 * configurado (un correo a otro dominio con el mismo patrón no cuenta).
 */
export function extractReplyToken(addresses: unknown[], domain = DEFAULT_REPLY_DOMAIN): string | null {
  const d = domain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`reservas\\+([0-9a-f]{24})@${d}(?![a-z0-9.-])`, "i");
  for (const a of addresses.flat()) {
    const m = re.exec(String(a ?? ""));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// Dirección de correo estricta (ASCII, una sola @, dominio con etiquetas válidas). Un From con IDN
// sin convertir, comillas, comentarios o varias @ no se interpreta: se trata como no verificable.
const ADDR_RE = /^[a-z0-9._%+'-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Dirección "pelona" de un encabezado From ("Nombre <a@b.com>" → a@b.com), en minúsculas.
 * AUD-02: devuelve null si el encabezado es ambiguo (varios buzones, varias @, parte local entre
 * comillas, comentarios, saltos de línea, caracteres no ASCII). Nunca "adivina" un dominio: antes
 * '"reservas@casa.mx"@evil.test' se leía como reservas@casa.mx.
 */
export function bareAddress(from: unknown): string | null {
  const s = String(from ?? "").trim();
  if (!s || s.length > 400 || /[\r\n\0]/.test(s)) return null;
  const angles = s.match(/<[^<>]*>/g);
  let cand: string;
  if (angles) {
    // Exactamente un <…>, al final, y sin otra @ fuera de comillas en el nombre visible.
    if (angles.length !== 1 || !/>\s*$/.test(s)) return null;
    const display = s.slice(0, s.lastIndexOf("<")).replace(/"[^"]*"/g, "");
    if (/[<>,;]/.test(display) || /@/.test(display)) return null;
    cand = angles[0].slice(1, -1).trim();
  } else {
    cand = s;
  }
  cand = cand.toLowerCase();
  return ADDR_RE.test(cand) ? cand : null;
}
/**
 * A2-RES-01 · Dominios de buzón COMPARTIDO: cualquiera abre una cuenta ahí, así que DMARC pass solo
 * prueba que el correo salió de ESA cuenta, no del restaurante. Con ellos se exige la dirección exacta.
 * Lista amplia y mantenida (gratuitos, proveedores de internet y de hosting de correo). La misma lista
 * vive en SQL (public.ai_res_freemail_domains, migración 20261026010000_r2_reservas_*); una prueba
 * de Vitest exige que coincidan. Aunque un dominio falte aquí, la heurística venueOwnsDomain() lo
 * trata como compartido si no coincide con el sitio web oficial del lugar.
 */
export const SHARED_MAILBOX_DOMAINS = new Set([
  // Google, Microsoft, Yahoo, Apple, AOL
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.es", "hotmail.fr", "hotmail.it", "hotmail.de", "hotmail.co.uk", "hotmail.com.mx", "hotmail.com.ar",
  "hotmail.com.br", "hotmail.cl", "hotmail.be", "hotmail.ca",
  "outlook.com", "outlook.es", "outlook.fr", "outlook.it", "outlook.de", "outlook.com.mx", "outlook.com.ar", "outlook.com.br",
  "outlook.cl", "outlook.co.uk", "outlook.pt",
  "live.com", "live.com.mx", "live.fr", "live.it", "live.co.uk", "live.de", "live.nl", "live.be", "live.ca", "live.com.ar",
  "live.cl", "live.com.pt", "msn.com", "windowslive.com", "passport.com",
  "yahoo.com", "yahoo.com.mx", "yahoo.es", "yahoo.fr", "yahoo.it", "yahoo.de", "yahoo.co.uk", "yahoo.com.ar", "yahoo.com.br",
  "yahoo.ca", "yahoo.cl", "yahoo.com.co", "yahoo.com.pe", "yahoo.com.ve", "yahoo.co.jp", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "aol.fr", "aim.com",
  // Correo cifrado y de pago
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "tutanota.com", "tuta.io", "fastmail.com", "hey.com",
  "mailbox.org", "posteo.de", "hushmail.com", "zoho.com", "zohomail.com",
  // Alemania, Austria, Suiza, Europa del Este
  "gmx.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "gmx.fr", "gmx.es", "web.de", "t-online.de", "freenet.de", "arcor.de",
  "mail.com", "email.com", "usa.com", "seznam.cz", "wp.pl", "o2.pl", "onet.pl", "interia.pl", "abv.bg",
  "yandex.ru", "yandex.com", "ya.ru", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "rambler.ru",
  // Francia
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "neuf.fr", "bbox.fr", "numericable.fr", "club-internet.fr",
  "aliceadsl.fr", "cegetel.net",
  // Italia, España, Portugal
  "libero.it", "virgilio.it", "tiscali.it", "alice.it", "tin.it", "email.it", "fastwebnet.it",
  "telefonica.net", "movistar.es", "ono.com", "terra.es", "sapo.pt",
  // México y Latinoamérica
  "prodigy.net.mx", "infinitummail.com", "telmexmail.com", "terra.com.mx", "terra.com.br", "uol.com.br", "bol.com.br",
  "ig.com.br", "globo.com", "arnet.com.ar", "fibertel.com.ar", "speedy.com.ar",
  // Reino Unido, EE. UU., Canadá, Oceanía
  "btinternet.com", "sky.com", "talktalk.net", "virginmedia.com", "ntlworld.com", "comcast.net", "verizon.net", "att.net",
  "sbcglobal.net", "bellsouth.net", "cox.net", "charter.net", "earthlink.net", "juno.com", "optonline.net", "shaw.ca",
  "rogers.com", "sympatico.ca", "videotron.ca", "bigpond.com", "optusnet.com.au", "xtra.co.nz",
  // Asia
  "qq.com", "163.com", "126.com", "sina.com", "naver.com", "daum.net", "hanmail.net", "rediffmail.com",
  // Otros
  "lycos.com", "inbox.com",
]);
/** Compatibilidad: nombre anterior de la lista (AUD-02). */
export const FREEMAIL = SHARED_MAILBOX_DOMAINS;
export const domainOf = (email: string | null | undefined) => {
  if (!email) return null;
  const i = email.lastIndexOf("@");
  return i > 0 ? email.slice(i + 1).toLowerCase() : null;
};

/**
 * Host del sitio web oficial del lugar, sin "www." ni punto final, en minúsculas. Solo https, ASCII,
 * sin credenciales (la misma expresión que public.ai_res_site_host en SQL). null si no se entiende.
 */
export function siteHost(website: string | null | undefined): string | null {
  const m = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:[/?#]|$)/.exec(String(website ?? "").trim().toLowerCase());
  if (!m) return null;
  const h = m[1].replace(/\.$/, "").replace(/^www\./, "");
  return h.includes(".") && !h.startsWith(".") && !h.includes("..") ? h : null;
}

/**
 * A2-RES-01 · ¿El dominio del correo del restaurante es SUYO? Solo si no es un buzón compartido y es el
 * mismo dominio de su sitio web oficial (o un subdominio de él: reservas@mail.casa.mx con casa.mx).
 * Sin sitio web, o con un sitio en otro dominio, se trata como compartido: se exige la dirección exacta.
 * Misma regla que public.ai_res_venue_owns_domain en SQL.
 */
export function venueOwnsDomain(venueEmail: string | null | undefined, venueWebsite: string | null | undefined): boolean {
  const vd = domainOf(bareAddress(venueEmail));
  const site = siteHost(venueWebsite);
  if (!vd || !site) return false;
  if (SHARED_MAILBOX_DOMAINS.has(vd) || SHARED_MAILBOX_DOMAINS.has(site)) return false;
  return vd === site || vd.endsWith(`.${site}`);
}

/** Resultados de autenticación tal como los da Resend (GET /emails/receiving/{id} → authentication). */
export type AuthResults = { spf?: string; dkim?: string; dmarc?: string } | null | undefined;
const AUTH_VALUES = new Set(["pass", "fail", "gray", "processing_failed", "unknown"]);
const authValue = (v: unknown) => {
  const x = typeof v === "string" ? v.trim().toLowerCase() : "";
  return AUTH_VALUES.has(x) ? x : "missing";
};

export type SenderVerdict = {
  verified: boolean;
  /** dmarc_aligned: DMARC pass (dirección exacta, o dominio propio del restaurante). exact_address_dkim: misma dirección + DKIM alineado. */
  basis: "dmarc_aligned" | "exact_address_dkim" | null;
  from_address: string | null;
  from_domain: string | null;
  auth: { spf: string; dkim: string; dmarc: string };
  /** A2-RES-01: el dominio del correo del restaurante es suyo (coincide con su sitio oficial y no es compartido). */
  venue_owns_domain?: boolean;
  reasons: string[];
};

/**
 * AUD-02 + A2-RES-01 · ¿El correo viene de verdad del restaurante? Solo con autenticación fuerte:
 *   (a) la MISMA dirección a la que escribimos, con DMARC 'pass' o con DKIM 'pass' (para Resend, 'pass'
 *       implica que el dominio firmante coincide con el del From) y DMARC 'gray'; o
 *   (b) otra dirección del dominio del restaurante (o de un subdominio suyo) con DMARC 'pass', SOLO si
 *       el dominio es propio del restaurante (venueOwnsDomain: coincide con su sitio web oficial y no es
 *       un buzón compartido). En un buzón compartido (gmail, live.fr, wanadoo.fr…) o si el dominio no
 *       coincide con el sitio, cualquiera puede tener una cuenta con DMARC pass: se exige la dirección exacta.
 * DMARC con cualquier valor que no sea 'pass' o 'gray' (fail, processing_failed, unknown, ausente o un
 * valor inesperado) descarta: falla cerrada (A2-RES-06). SPF solo nunca basta. Dominio padre, sufijo
 * público, parecidos (guiones, otro TLD, IDN/punycode) → no.
 * Si algo falta o no se entiende, NO se considera verificado: la respuesta se muestra, pero no confirma.
 */
export function senderAuthentication(fromHeader: unknown, venueEmail: string | null | undefined, auth: AuthResults, venueWebsite?: string | null): SenderVerdict {
  const from = bareAddress(fromHeader);
  const venue = bareAddress(venueEmail);
  const a = (auth && typeof auth === "object") ? auth as Record<string, unknown> : {};
  const res = { spf: authValue(a.spf), dkim: authValue(a.dkim), dmarc: authValue(a.dmarc) };
  const owns = venueOwnsDomain(venue, venueWebsite);
  const out = (basis: SenderVerdict["basis"], reasons: string[]): SenderVerdict =>
    ({ verified: basis !== null, basis, from_address: from, from_domain: domainOf(from), auth: res, venue_owns_domain: owns, reasons });
  if (!from) return out(null, ["from_unparseable"]);
  if (!venue) return out(null, ["venue_email_missing"]);
  if (!auth || typeof auth !== "object") return out(null, ["auth_missing"]);
  if (res.dmarc === "fail" || res.dmarc === "processing_failed") return out(null, [`dmarc_${res.dmarc}`]);
  const fd = domainOf(from)!;
  const vd = domainOf(venue)!;
  if (from === venue) {
    if (res.dmarc === "pass") return out("dmarc_aligned", []);
    if (res.dkim === "pass") return out("exact_address_dkim", []);
    return out(null, ["no_aligned_authentication"]);
  }
  if (!owns) return out(null, [SHARED_MAILBOX_DOMAINS.has(vd) || SHARED_MAILBOX_DOMAINS.has(fd) ? "shared_mailbox_address_mismatch" : "address_not_exact_domain_not_owned"]);
  if (!(fd === vd || fd.endsWith(`.${vd}`))) return out(null, ["domain_mismatch"]);
  if (res.dmarc === "pass") return out("dmarc_aligned", []);
  return out(null, ["address_not_exact_without_dmarc"]);
}

/** Atajo booleano (compatibilidad): true solo con autenticación fuerte (ver senderAuthentication). */
export function senderVerified(fromAddress: string | null, venueEmail: string | null, auth: AuthResults, venueWebsite?: string | null): boolean {
  return senderAuthentication(fromAddress, venueEmail, auth, venueWebsite).verified;
}

// ───────────────────────────── Texto de la respuesta ─────────────────────────────
const QUOTE_MARKERS = [
  /^\s*>/, // líneas citadas
  /^\s*-{2,}\s*(original message|mensaje original|message d'origine)/i,
  /^\s*on .{3,200} wrote:\s*$/i,
  /^\s*el .{3,200} escribi[óo]:\s*$/i,
  /^\s*le .{3,200} a [ée]crit\s*:\s*$/i,
  /^\s*(from|de|von)\s*:\s.+/i,
  /^\s*_{5,}\s*$/,
  /^\s*— IATOS · Ref R-[A-Z0-9]{6} —/, // nuestra propia marca al final de cada correo
];

/** Separa lo que escribió el lugar (reply) de lo citado (quoted: nuestro correo original, si lo citó). */
export function splitQuotedReply(text: string): { reply: string; quoted: string } {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const i = lines.findIndex((line) => QUOTE_MARKERS.some((re) => re.test(line)));
  const reply = (i < 0 ? lines : lines.slice(0, i)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { reply, quoted: i < 0 ? "" : lines.slice(i).join("\n") };
}

/** Quita el mensaje citado (nuestro correo original) para clasificar solo lo que escribió el lugar. */
export function stripQuotedReply(text: string): string {
  return splitQuotedReply(text).reply;
}

/** HTML de un correo → texto plano (sin scripts ni estilos), para cuando no viene versión texto. */
export function htmlToText(html: string, keepQuoted = false): string {
  const h = String(html ?? "");
  return (keepQuoted ? h : h.replace(/<blockquote[\s\S]*$/i, "")) // lo citado suele ir en <blockquote>
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

/** Extracto para guardar y mostrar: sin correos, teléfonos ni números tipo tarjeta, recortado. */
export function redactExcerpt(text: string, max = 600): string {
  const t = String(text ?? "")
    .replace(EMAIL_RE, "[correo]")
    .replace(CARD_RE, "[número]")
    // Un teléfono tiene 9+ dígitos; una fecha ISO ("2026-11-03 20") no es un teléfono.
    .replace(PHONE_RE, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) || m.replace(/\D/g, "").length < 9 ? m : "[teléfono]"))
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Una cita del modelo solo cuenta si aparece tal cual (salvo espacios/mayúsculas) en la respuesta. */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const q = norm(String(quote ?? ""));
  return q.length >= 4 && norm(String(text ?? "")).includes(q);
}

// ───────────────────────────── Fecha y hora ─────────────────────────────
export const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
export const isLocalDateTime = (v: unknown): v is string => {
  const m = LOCAL_RE.exec(String(v ?? ""));
  if (!m) return false;
  const [, , mo, d, h, mi] = m.map(Number);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59;
};

/** Diferencia en minutos entre dos horas locales "HH:MM". */
export function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return Math.abs(ah * 60 + am - (bh * 60 + bm));
}

/** Fecha legible para correos y avisos ("martes 3 de noviembre de 2026, 20:30"). */
export function formatLocal(local: string, lang: VenueLanguage | "es" = "es"): string {
  const m = LOCAL_RE.exec(local);
  if (!m) return local;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12));
  const locale = lang === "en" ? "en-US" : lang === "fr" ? "fr-FR" : "es-MX";
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return `${day}, ${h}:${mi}`;
}

// ───────────────────────────── Cron: recordatorio y vencimiento ─────────────────────────────
export type Limits = {
  reminder_after_hours: number;
  expire_after_hours: number;
  intent_ttl_hours: number;
};
export const DEFAULT_LIMITS: Limits = { reminder_after_hours: 24, expire_after_hours: 48, intent_ttl_hours: 72 };

export type CronAction = { kind: "remind" } | { kind: "expire"; note: string } | { kind: "none" };

const H = 3_600_000;

/**
 * Qué hacer con una reserva activa en esta corrida del cron (idempotente: la base solo deja un
 * recordatorio y una transición por estado).
 *  - sent sin respuesta: un recordatorio al restaurante a la mitad del plazo (máx. 24 h), luego vence.
 *  - awaiting_user_ok / draft: el usuario no confirmó en 72 h, o la hora ya pasó → vence.
 *  - needs_user / venue_replied: si la hora de la reserva ya pasó → vence.
 */
export function cronDecision(row: Pick<AiReservationRow, "status" | "sent_at" | "reminder_sent_at" | "expires_at" | "requested_for" | "created_at" | "status_changed_at">, now: Date, limits: Limits = DEFAULT_LIMITS): CronAction {
  const t = now.getTime();
  const at = (v: string | null | undefined) => (v ? new Date(v).getTime() : NaN);
  const reservationAt = at(row.requested_for);
  if (row.status === "sent") {
    const sent = at(row.sent_at);
    const expires = Number.isFinite(at(row.expires_at)) ? at(row.expires_at) : sent + limits.expire_after_hours * H;
    if (t >= expires || t >= reservationAt - 30 * 60_000) return { kind: "expire", note: "El restaurante no respondió a tiempo" };
    const remindAt = sent + Math.min(limits.reminder_after_hours * H, (expires - sent) / 2);
    if (!row.reminder_sent_at && t >= remindAt) return { kind: "remind" };
    return { kind: "none" };
  }
  if (row.status === "awaiting_user_ok" || row.status === "draft") {
    if (t >= reservationAt || t - at(row.created_at) >= limits.intent_ttl_hours * H) {
      return { kind: "expire", note: "No se confirmó el envío a tiempo" };
    }
    return { kind: "none" };
  }
  if (row.status === "needs_user" || row.status === "venue_replied") {
    if (t >= reservationAt) return { kind: "expire", note: "La fecha de la reserva ya pasó" };
  }
  return { kind: "none" };
}

// ───────────────────────────── Opciones cuando no hay correo ─────────────────────────────
/** Vías honestas cuando no encontramos un correo de reservas: nunca inventamos uno. */
export function fallbackOptions(v: { phone?: string | null; booking_url?: string | null; website?: string | null; maps_url?: string | null }) {
  const digits = String(v.phone ?? "").replace(/[^\d+]/g, "");
  const intl = digits.startsWith("+") ? digits.slice(1) : "";
  return {
    phone_url: digits.length >= 8 ? `tel:${digits}` : null,
    // WhatsApp solo si el número está en formato internacional; puede que el lugar no lo use.
    whatsapp_url: intl.length >= 8 ? `https://wa.me/${intl}` : null,
    booking_url: v.booking_url && /^https:\/\//.test(v.booking_url) ? v.booking_url : null,
    website: v.website && /^https:\/\//.test(v.website) ? v.website : null,
    maps_url: v.maps_url && /^https:\/\//.test(v.maps_url) ? v.maps_url : null,
    fixer: true,
  };
}

/** Frase exacta que el usuario confirma antes de que escribamos en su nombre. */
export function confirmPrompt(venueName: string): string {
  return `Confirmar: escribiremos a ${venueName} en tu nombre`;
}

/** Enlace a Google Maps (formato oficial de Maps URLs) para llegar al lugar. */
export function directionsUrl(v: { venue_name: string; venue_address?: string | null; venue_city?: string | null; venue_place_id?: string | null }): string {
  const q = [v.venue_name, v.venue_address ?? v.venue_city].filter(Boolean).join(", ");
  const u = new URL("https://www.google.com/maps/search/");
  u.searchParams.set("api", "1");
  u.searchParams.set("query", q);
  if (v.venue_place_id) u.searchParams.set("query_place_id", v.venue_place_id);
  return u.toString();
}
