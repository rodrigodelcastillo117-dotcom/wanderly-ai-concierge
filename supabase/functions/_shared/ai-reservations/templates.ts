// Correos de Reservas IA. Viven aquí (y no en _shared/email.ts) para que el grupo de correos pueda
// reestilizarlos después sin tocar la lógica: cada función devuelve {subject, html, text}.
//  * Al restaurante: texto sobrio en su idioma (es/en/fr), transparente: dice que lo escribe el
//    asistente de IA de IATOS a petición del cliente, y nunca pide ni manda datos de pago.
//  * Al usuario: español (México); la confirmación cita la respuesta del restaurante como prueba.
// Sin Deno: se prueba con Vitest.
import { escapeHtml, oneLine } from "../email.ts";
import { type AiReservationRow, directionsUrl, formatLocal, type VenueLanguage } from "./core.ts";

export type Mail = { subject: string; html: string; text: string };
type Row = Pick<AiReservationRow, "ref_code" | "venue_name" | "requested_local" | "party_size" | "customer_name" |
  "customer_email" | "customer_phone" | "notes" | "venue_language" | "consent">;

export const refMarker = (ref: string) => `— IATOS · Ref ${ref} —`;

const T = {
  es: {
    subject: (n: number, when: string, ref: string) => `Solicitud de reserva · ${n} ${n === 1 ? "persona" : "personas"} · ${when} · Ref ${ref}`,
    hello: (v: string) => `Hola, equipo de ${v}:`,
    intro: (c: string) => `Les escribo en nombre de ${c} para solicitar una reserva:`,
    when: "Fecha y hora", party: "Personas", name: "A nombre de", phone: "Teléfono de contacto", email: "Correo de contacto", notes: "Notas",
    ask: "¿Podrían confirmarnos por escrito si es posible? Basta con responder a este correo. Si a esa hora no se puede, con gusto consideramos otro horario cercano.",
    thanks: "Muchas gracias,",
    sign: (c: string) => `Iato, asistente de IA de IATOS, en nombre de ${c}`,
    footer: (c: string) => `Este mensaje lo envió IATOS (traveliatos.life), un asistente de viajes con IA, a petición de ${c}. Nunca les pediremos ni enviaremos datos de pago. Si prefieren no recibir estas solicitudes, escríbannos a hola@traveliatos.life.`,
    reminderSubject: (s: string) => `Recordatorio: ${s}`,
    reminder: "Les escribimos de nuevo por si el mensaje anterior se perdió. ¿Podrían indicarnos si es posible esta reserva?",
    altSubject: (when: string, ref: string) => `Aceptamos el horario propuesto · ${when} · Ref ${ref}`,
    alt: (when: string) => `Muchas gracias por su respuesta. El horario que nos proponen nos funciona: ${when}. ¿Nos confirman por escrito la reserva a esa hora?`,
    altHeld: (when: string) => `Muchas gracias por su respuesta. Aceptamos el horario que nos apartaron: ${when}. Nos vemos entonces.`,
    cancelSubject: (ref: string) => `Cancelación de la solicitud · Ref ${ref}`,
    cancel: (when: string) => `Les avisamos que ya no necesitaremos la reserva solicitada para ${when}. Gracias por su atención y disculpen las molestias.`,
  },
  en: {
    subject: (n: number, when: string, ref: string) => `Reservation request · ${n} ${n === 1 ? "guest" : "guests"} · ${when} · Ref ${ref}`,
    hello: (v: string) => `Hello ${v} team,`,
    intro: (c: string) => `I am writing on behalf of ${c} to request a reservation:`,
    when: "Date and time", party: "Guests", name: "Under the name", phone: "Contact phone", email: "Contact email", notes: "Notes",
    ask: "Could you please confirm in writing whether this is possible? Simply replying to this email is enough. If that time is not available, we would be happy to consider a nearby time.",
    thanks: "Thank you very much,",
    sign: (c: string) => `Iato, IATOS AI assistant, on behalf of ${c}`,
    footer: (c: string) => `This message was sent by IATOS (traveliatos.life), an AI travel assistant, at the request of ${c}. We will never ask for or send payment details. If you prefer not to receive these requests, please write to hola@traveliatos.life.`,
    reminderSubject: (s: string) => `Reminder: ${s}`,
    reminder: "We are writing again in case our previous message was missed. Could you let us know whether this reservation is possible?",
    altSubject: (when: string, ref: string) => `We accept the proposed time · ${when} · Ref ${ref}`,
    alt: (when: string) => `Thank you for your reply. The time you proposed works for us: ${when}. Could you confirm the reservation at that time in writing?`,
    altHeld: (when: string) => `Thank you for your reply. We accept the time you are holding for us: ${when}. See you then.`,
    cancelSubject: (ref: string) => `Cancellation of the request · Ref ${ref}`,
    cancel: (when: string) => `We would like to let you know that we no longer need the reservation requested for ${when}. Thank you, and sorry for any inconvenience.`,
  },
  fr: {
    subject: (n: number, when: string, ref: string) => `Demande de réservation · ${n} ${n === 1 ? "personne" : "personnes"} · ${when} · Réf ${ref}`,
    hello: (v: string) => `Bonjour à l'équipe de ${v},`,
    intro: (c: string) => `Je vous écris au nom de ${c} pour demander une réservation :`,
    when: "Date et heure", party: "Personnes", name: "Au nom de", phone: "Téléphone de contact", email: "E-mail de contact", notes: "Remarques",
    ask: "Pourriez-vous nous confirmer par écrit si c'est possible ? Il suffit de répondre à cet e-mail. Si cet horaire n'est pas disponible, nous pouvons envisager un horaire proche.",
    thanks: "Merci beaucoup,",
    sign: (c: string) => `Iato, assistant IA d'IATOS, au nom de ${c}`,
    footer: (c: string) => `Ce message a été envoyé par IATOS (traveliatos.life), un assistant de voyage IA, à la demande de ${c}. Nous ne vous demanderons ni ne vous enverrons jamais de données de paiement. Si vous préférez ne pas recevoir ces demandes, écrivez-nous à hola@traveliatos.life.`,
    reminderSubject: (s: string) => `Rappel : ${s}`,
    reminder: "Nous vous écrivons de nouveau au cas où notre précédent message se serait perdu. Pourriez-vous nous dire si cette réservation est possible ?",
    altSubject: (when: string, ref: string) => `Nous acceptons l'horaire proposé · ${when} · Réf ${ref}`,
    alt: (when: string) => `Merci pour votre réponse. L'horaire proposé nous convient : ${when}. Pourriez-vous nous confirmer la réservation à cet horaire par écrit ?`,
    altHeld: (when: string) => `Merci pour votre réponse. Nous acceptons l'horaire que vous nous avez réservé : ${when}. À bientôt.`,
    cancelSubject: (ref: string) => `Annulation de la demande · Réf ${ref}`,
    cancel: (when: string) => `Nous vous informons que nous n'aurons plus besoin de la réservation demandée pour ${when}. Merci et désolés pour le dérangement.`,
  },
} satisfies Record<VenueLanguage, unknown>;

function details(r: Row, lang: VenueLanguage): Array<[string, string]> {
  const t = T[lang];
  const share = r.consent?.share_contact === true;
  const rows: Array<[string, string]> = [
    [t.when, formatLocal(r.requested_local, lang)],
    [t.party, String(r.party_size)],
    [t.name, r.customer_name],
  ];
  if (share && r.customer_phone) rows.push([t.phone, r.customer_phone]);
  if (share && r.customer_email) rows.push([t.email, r.customer_email]);
  if (r.notes) rows.push([t.notes, r.notes]);
  return rows;
}

function venueMail(r: Row, subject: string, before: string[], withDetails: boolean, after: string[] = []): Mail {
  const lang = r.venue_language;
  const t = T[lang];
  const rows = withDetails ? details(r, lang) : [];
  const text = [
    t.hello(r.venue_name), "",
    ...before.flatMap((x) => [x, ""]),
    ...rows.map(([k, v]) => `• ${k}: ${v}`), ...(rows.length ? [""] : []),
    ...after.flatMap((x) => [x, ""]),
    t.thanks, t.sign(r.customer_name), "IATOS · traveliatos.life", "",
    refMarker(r.ref_code), t.footer(r.customer_name),
  ].join("\n");
  const html = `<!doctype html><html lang="${lang}"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f">
<p>${escapeHtml(t.hello(r.venue_name))}</p>
${before.map((x) => `<p>${escapeHtml(x)}</p>`).join("\n")}
${rows.length ? `<ul>${rows.map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`).join("")}</ul>` : ""}
${after.map((x) => `<p>${escapeHtml(x)}</p>`).join("\n")}
<p>${escapeHtml(t.thanks)}<br/>${escapeHtml(t.sign(r.customer_name))}<br/>IATOS · traveliatos.life</p>
<p style="font-size:12px;color:#6e6e73">${escapeHtml(refMarker(r.ref_code))}<br/>${escapeHtml(t.footer(r.customer_name))}</p>
</body></html>`;
  return { subject: oneLine(subject, 200), html, text };
}

/** Primer correo al restaurante: qué pedimos, los datos y, al final, la pregunta. */
export function venueRequestEmail(r: Row): Mail {
  const t = T[r.venue_language];
  const subject = t.subject(r.party_size, formatLocal(r.requested_local, r.venue_language), r.ref_code);
  return venueMail(r, subject, [t.intro(r.customer_name)], true, [t.ask]);
}

/** Un solo recordatorio si no respondieron. */
export function venueReminderEmail(r: Row): Mail {
  const t = T[r.venue_language];
  const first = venueRequestEmail(r);
  return venueMail(r, t.reminderSubject(first.subject), [t.reminder], true);
}

/** El usuario aceptó un horario alterno. held = el restaurante ya lo había apartado por escrito. */
export function venueAlternativeEmail(r: Row, held: boolean): Mail {
  const t = T[r.venue_language];
  const when = formatLocal(r.requested_local, r.venue_language);
  return venueMail(r, t.altSubject(when, r.ref_code), [held ? t.altHeld(when) : t.alt(when)], true);
}

/** El usuario canceló después de que ya le habíamos escrito. */
export function venueCancellationEmail(r: Row): Mail {
  const t = T[r.venue_language];
  return venueMail(r, t.cancelSubject(r.ref_code), [t.cancel(formatLocal(r.requested_local, r.venue_language))], false);
}

// ───────────────────────────── Calendario ─────────────────────────────
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Pliega líneas a 75 caracteres como pide RFC 5545. */
const fold = (line: string) => {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += i === 0 ? 75 : 74) parts.push((i === 0 ? "" : " ") + line.slice(i, i + (i === 0 ? 75 : 74)));
  return parts.join("\r\n");
};

export type CalendarInput = Pick<AiReservationRow, "ref_code" | "venue_name" | "venue_address" | "venue_city" | "venue_place_id" |
  "requested_for" | "party_size" | "confirmation_code">;

export function reservationIcs(r: CalendarInput, now = new Date(), durationMin = 120): string {
  const start = new Date(r.requested_for);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const desc = `Reserva confirmada por escrito por ${r.venue_name}. ${r.party_size} ${r.party_size === 1 ? "persona" : "personas"}.` +
    (r.confirmation_code ? ` Código: ${r.confirmation_code}.` : "") + ` Ref IATOS ${r.ref_code}.\n${directionsUrl(r)}`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IATOS//Reservas IA//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${r.ref_code}@traveliatos.life`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`Reserva en ${r.venue_name}`)}`,
    `LOCATION:${icsEscape([r.venue_name, r.venue_address ?? r.venue_city].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}

export function googleCalendarUrl(r: CalendarInput, durationMin = 120): string {
  const start = new Date(r.requested_for);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", `Reserva en ${r.venue_name}`);
  u.searchParams.set("dates", `${icsDate(start)}/${icsDate(end)}`);
  u.searchParams.set("details", `Confirmada por escrito por el restaurante. ${r.party_size} personas.${r.confirmation_code ? ` Código: ${r.confirmation_code}.` : ""} Ref ${r.ref_code}.`);
  u.searchParams.set("location", [r.venue_name, r.venue_address ?? r.venue_city].filter(Boolean).join(", "));
  return u.toString();
}

export function outlookCalendarUrl(r: CalendarInput, durationMin = 120): string {
  const start = new Date(r.requested_for);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const u = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  u.searchParams.set("path", "/calendar/action/compose");
  u.searchParams.set("rru", "addevent");
  u.searchParams.set("subject", `Reserva en ${r.venue_name}`);
  u.searchParams.set("startdt", start.toISOString());
  u.searchParams.set("enddt", end.toISOString());
  u.searchParams.set("location", [r.venue_name, r.venue_address ?? r.venue_city].filter(Boolean).join(", "));
  return u.toString();
}

// ───────────────────────────── Correos al usuario ─────────────────────────────
const btn = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;background:#c9a227;color:#141310;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;margin:4px 6px 4px 0">${escapeHtml(label)}</a>`;

function userLayout(title: string, inner: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#0b0b0c;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#eae6df">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <div style="font-size:13px;letter-spacing:.28em;color:#c9a227;text-transform:uppercase;margin-bottom:24px">IATOS AI · Reservas</div>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#fff">${escapeHtml(title)}</h1>
    ${inner}
    <p style="margin-top:32px;font-size:12px;color:#8a8578">IATOS AI · <a href="https://traveliatos.life" style="color:#c9a227">traveliatos.life</a><br/>
    Recibes este correo porque pediste a Iato que escribiera a un restaurante en tu nombre.</p>
  </div></body></html>`;
}

const p = (s: string) => `<p style="font-size:15px;line-height:1.6;color:#cfc9bd">${s}</p>`;
const quoteBlock = (q: string, who: string) =>
  `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #c9a227;background:#16150f;color:#fff;font-size:15px;line-height:1.5">“${escapeHtml(q)}”<br/><span style="font-size:12px;color:#8a8578">— ${escapeHtml(who)}</span></blockquote>`;

export type ConfirmedMailInput = CalendarInput & Pick<AiReservationRow, "requested_local" | "customer_name"> & {
  quote: string;
  receivedAt: string;
  icsUrl: string | null;
  appUrl: string;
};

/** Confirmación al usuario: SOLO cuando el restaurante confirmó por escrito (status confirmed). */
export function userConfirmedEmail(r: ConfirmedMailInput): Mail {
  const when = formatLocal(r.requested_local, "es");
  const title = `${r.venue_name} confirmó tu reserva por escrito`;
  const links: Array<[string, string]> = [
    ...(r.icsUrl ? [[r.icsUrl, "Agregar al calendario (.ics)"] as [string, string]] : []),
    [googleCalendarUrl(r), "Google Calendar"],
    [outlookCalendarUrl(r), "Outlook"],
    [directionsUrl(r), "Cómo llegar"],
  ];
  const inner = [
    p(`<strong style="color:#fff">${escapeHtml(when)}</strong> · ${r.party_size} ${r.party_size === 1 ? "persona" : "personas"} · a nombre de ${escapeHtml(r.customer_name)}` +
      (r.confirmation_code ? ` · Código: <strong style="color:#fff">${escapeHtml(r.confirmation_code)}</strong>` : "")),
    p("Esta es la respuesta del restaurante que lo confirma:"),
    quoteBlock(r.quote, `${r.venue_name}, ${r.receivedAt}`),
    `<div style="margin:18px 0">${links.map(([h, l]) => btn(h, l)).join("")}</div>`,
    p(`La confirmación es del restaurante; IATOS no cobra ni garantiza la reserva. Si cambias de planes, cancélala desde la <a href="${escapeHtml(r.appUrl)}" style="color:#c9a227">app</a> y le avisamos al restaurante. Ref ${escapeHtml(r.ref_code)}.`),
  ].join("\n");
  const text = [
    title, "", `${when} · ${r.party_size} personas · a nombre de ${r.customer_name}${r.confirmation_code ? ` · Código: ${r.confirmation_code}` : ""}`, "",
    "Respuesta del restaurante:", `“${r.quote}” — ${r.venue_name}, ${r.receivedAt}`, "",
    ...links.map(([h, l]) => `${l}: ${h}`), "",
    `La confirmación es del restaurante; IATOS no cobra ni garantiza la reserva. Ref ${r.ref_code}.`,
  ].join("\n");
  return { subject: oneLine(`Reserva confirmada por ${r.venue_name} · ${when}`, 200), html: userLayout(title, inner), text };
}

export type UpdateKind = "alternative_offered" | "declined" | "needs_info" | "payment_required" | "unverified" | "ambiguous" | "expired" | "late";

/** Avisos al usuario que NO son una confirmación (cada uno lo dice). */
export function userUpdateEmail(kind: UpdateKind, r: Pick<AiReservationRow, "venue_name" | "requested_local" | "ref_code"> & {
  excerpt?: string | null; info?: string | null; alternatives?: string[]; appUrl: string;
}): Mail {
  const when = formatLocal(r.requested_local, "es");
  const v = r.venue_name;
  const map: Record<UpdateKind, [string, string]> = {
    alternative_offered: [`${v} propone otro horario`, `No tienen lugar a la hora que pediste (${when}), pero ofrecen: ${(r.alternatives ?? []).join(" · ")}. Elige en la app si alguno te sirve. Aún no es una reserva.`],
    declined: [`${v} no tiene lugar`, `Respondieron que no pueden recibirte el ${when}. Puedes pedirle a Iato otra opción o al Fixer.`],
    needs_info: [`${v} pide más información`, `${r.info ?? "Revisa su respuesta en la app."} Aún no es una reserva.`],
    payment_required: [`${v} pide una garantía o pago`, "IATOS nunca comparte datos de tarjeta. Si quieres seguir, hazlo directamente con el restaurante. Aún no es una reserva."],
    unverified: [`${v} respondió · revísalo tú`, "Recibimos una respuesta, pero no pudimos verificar que venga del restaurante, así que no la tomamos como confirmación. Aún no es una reserva confirmada."],
    ambiguous: [`${v} respondió · revísalo tú`, "Recibimos una respuesta que no pudimos interpretar con certeza. Aún no es una reserva confirmada."],
    expired: [`${v} no respondió a tiempo`, `Tu solicitud para el ${when} venció sin confirmación. Puedes llamar al restaurante o pedir ayuda al Fixer.`],
    late: [`${v} respondió tarde`, "Llegó una respuesta después de que la solicitud se cerró. Revísala y, si te interesa, confirma directamente con el restaurante."],
  };
  const [title, body] = map[kind];
  const inner = [
    p(escapeHtml(body)),
    r.excerpt ? quoteBlock(r.excerpt, v) : "",
    `<div style="margin:18px 0">${btn(r.appUrl, "Ver en IATOS")}</div>`,
    p(`Ref ${escapeHtml(r.ref_code)}.`),
  ].join("\n");
  const text = [title, "", body, ...(r.excerpt ? ["", `“${r.excerpt}” — ${v}`] : []), "", `Ver en IATOS: ${r.appUrl}`, `Ref ${r.ref_code}.`].join("\n");
  return { subject: oneLine(title, 200), html: userLayout(title, inner), text };
}
