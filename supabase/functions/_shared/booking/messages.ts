// Mensaje de solicitud que Iato prepara y el usuario edita y envía desde su app (WhatsApp, correo,
// SMS) o lee por teléfono (guion). Sin Deno. Idiomas: es, en, fr, it, pt, ja (el del lugar).
//
// Solo usa datos que el usuario dio o que vienen del lugar. No promete nada: pide disponibilidad.

export type RequestLang = "es" | "en" | "fr" | "it" | "pt" | "ja";
export const REQUEST_LANGS: RequestLang[] = ["es", "en", "fr", "it", "pt", "ja"];

export type RequestDraftInput = {
  venue: string;
  product_type: "restaurant" | "experience" | "tour" | "hotel" | "event" | "transport";
  date?: string | null; // YYYY-MM-DD, hora local del lugar
  time?: string | null; // HH:MM, hora local del lugar
  party_size?: number | null;
  names?: string | null; // a nombre de quién
  occasion?: string | null;
  dietary?: string | null;
  accessibility?: string | null;
  notes?: string | null;
  contact?: string | null; // cómo responder al usuario (teléfono o correo que él mismo da)
  /** Firma "Enviado con IATOS" (opcional; por defecto no se agrega). */
  sign_iatos?: boolean;
};

/** Idioma del lugar a partir del país (ISO-2). */
export function langForCountry(country?: string | null): RequestLang {
  const c = String(country ?? "").toUpperCase();
  if (["MX", "ES", "AR", "CO", "CL", "PE", "CR", "DO", "PA", "GT", "UY", "EC", "BZ"].includes(c)) return "es";
  if (["FR", "MC", "BE", "MA"].includes(c)) return "fr";
  if (c === "IT") return "it";
  if (["PT", "BR"].includes(c)) return "pt";
  if (c === "JP") return "ja";
  return "en";
}

const LOCALE: Record<RequestLang, string> = { es: "es-MX", en: "en-US", fr: "fr-FR", it: "it-IT", pt: "pt-PT", ja: "ja-JP" };

/** Fecha local del lugar en palabras ("jueves 5 de noviembre de 2026"); sin corrimiento de zona. */
export function formatLocalDate(date: string, lang: RequestLang): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

type T = {
  hello: string;
  ask: (what: string) => string;
  table: string;
  experience: string;
  date: string;
  time: string;
  people: (n: number) => string;
  name: string;
  occasion: string;
  dietary: string;
  accessibility: string;
  notes: string;
  contact: string;
  close: string;
  thanks: string;
  subject: (venue: string, date: string | null) => string;
  call: { intro: (venue: string) => string; ask: string; confirm: string };
  signature: string;
};

const TX: Record<RequestLang, T> = {
  es: {
    hello: "Hola, buen día.",
    ask: (w) => `Quisiera saber si tienen disponibilidad para ${w}:`,
    table: "una mesa", experience: "la experiencia",
    date: "Fecha", time: "Hora", people: (n) => `${n} ${n === 1 ? "persona" : "personas"}`, name: "A nombre de",
    occasion: "Ocasión", dietary: "Restricciones alimentarias", accessibility: "Accesibilidad", notes: "Notas", contact: "Me pueden responder a",
    close: "¿Me podrían confirmar si es posible y, en su caso, las condiciones?", thanks: "Muchas gracias.",
    subject: (v, d) => `Solicitud de reserva · ${v}${d ? ` · ${d}` : ""}`,
    call: { intro: (v) => `Hola, llamo para pedir una reserva en ${v}.`, ask: "¿Tienen disponibilidad?", confirm: "¿Me pueden dar un número de confirmación?" },
    signature: "Enviado con IATOS",
  },
  en: {
    hello: "Hello,",
    ask: (w) => `I would like to know if you have availability for ${w}:`,
    table: "a table", experience: "the experience",
    date: "Date", time: "Time", people: (n) => `${n} ${n === 1 ? "guest" : "guests"}`, name: "Name",
    occasion: "Occasion", dietary: "Dietary requirements", accessibility: "Accessibility", notes: "Notes", contact: "You can reply to",
    close: "Could you please confirm whether this is possible and, if so, the conditions?", thanks: "Thank you very much.",
    subject: (v, d) => `Reservation request · ${v}${d ? ` · ${d}` : ""}`,
    call: { intro: (v) => `Hello, I'm calling to request a reservation at ${v}.`, ask: "Do you have availability?", confirm: "Could I have a confirmation number?" },
    signature: "Sent with IATOS",
  },
  fr: {
    hello: "Bonjour,",
    ask: (w) => `Je souhaiterais savoir si vous avez de la disponibilité pour ${w} :`,
    table: "une table", experience: "l'expérience",
    date: "Date", time: "Heure", people: (n) => `${n} ${n === 1 ? "personne" : "personnes"}`, name: "Au nom de",
    occasion: "Occasion", dietary: "Restrictions alimentaires", accessibility: "Accessibilité", notes: "Remarques", contact: "Vous pouvez me répondre à",
    close: "Pourriez-vous me confirmer si c'est possible et, le cas échéant, les conditions ?", thanks: "Merci beaucoup.",
    subject: (v, d) => `Demande de réservation · ${v}${d ? ` · ${d}` : ""}`,
    call: { intro: (v) => `Bonjour, j'appelle pour une réservation chez ${v}.`, ask: "Avez-vous de la disponibilité ?", confirm: "Pourriez-vous me donner un numéro de confirmation ?" },
    signature: "Envoyé avec IATOS",
  },
  it: {
    hello: "Buongiorno,",
    ask: (w) => `vorrei sapere se avete disponibilità per ${w}:`,
    table: "un tavolo", experience: "l'esperienza",
    date: "Data", time: "Ora", people: (n) => `${n} ${n === 1 ? "persona" : "persone"}`, name: "A nome di",
    occasion: "Occasione", dietary: "Esigenze alimentari", accessibility: "Accessibilità", notes: "Note", contact: "Potete rispondermi a",
    close: "Potreste confermarmi se è possibile e, in tal caso, le condizioni?", thanks: "Grazie mille.",
    subject: (v, d) => `Richiesta di prenotazione · ${v}${d ? ` · ${d}` : ""}`,
    call: { intro: (v) => `Buongiorno, chiamo per prenotare da ${v}.`, ask: "Avete disponibilità?", confirm: "Potrei avere un numero di conferma?" },
    signature: "Inviato con IATOS",
  },
  pt: {
    hello: "Olá, bom dia.",
    ask: (w) => `Gostaria de saber se têm disponibilidade para ${w}:`,
    table: "uma mesa", experience: "a experiência",
    date: "Data", time: "Hora", people: (n) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`, name: "Em nome de",
    occasion: "Ocasião", dietary: "Restrições alimentares", accessibility: "Acessibilidade", notes: "Notas", contact: "Podem responder-me para",
    close: "Poderiam confirmar se é possível e, nesse caso, as condições?", thanks: "Muito obrigado.",
    subject: (v, d) => `Pedido de reserva · ${v}${d ? ` · ${d}` : ""}`,
    call: { intro: (v) => `Olá, ligo para pedir uma reserva no ${v}.`, ask: "Têm disponibilidade?", confirm: "Podem dar-me um número de confirmação?" },
    signature: "Enviado com IATOS",
  },
  ja: {
    hello: "こんにちは。",
    ask: (w) => `${w}の空き状況を教えていただけますでしょうか。`,
    table: "席の予約", experience: "体験の予約",
    date: "日付", time: "時間", people: (n) => `${n}名`, name: "予約名",
    occasion: "目的", dietary: "食事制限", accessibility: "バリアフリー", notes: "備考", contact: "連絡先",
    close: "可能かどうか、またその条件をご確認いただけますと幸いです。", thanks: "よろしくお願いいたします。",
    subject: (v, d) => `予約のお問い合わせ · ${v}${d ? ` · ${d}` : ""}`,
    call: { intro: (v) => `もしもし、${v}の予約をお願いしたくお電話しました。`, ask: "空きはありますか？", confirm: "予約番号をいただけますか？" },
    signature: "IATOSから送信",
  },
};

const clean = (s: unknown, max = 300) => String(s ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max);

export type RequestDraft = { lang: RequestLang; subject: string; body: string; call_script: string[] };

/** Borrador editable de la solicitud. El usuario lo revisa antes de enviarlo. */
export function draftRequest(input: RequestDraftInput, lang: RequestLang): RequestDraft {
  const t = TX[lang] ?? TX.en;
  const venue = clean(input.venue, 160) || "—";
  const what = input.product_type === "restaurant" ? t.table : t.experience;
  const dateTxt = input.date ? formatLocalDate(input.date, lang) : null;
  const lines: string[] = [t.hello, "", t.ask(what), ""];
  const sep = lang === "ja" ? "：" : ": ";
  const row = (k: string, v: string | null | undefined) => { if (v) lines.push(`• ${k}${sep}${v}`); };
  lines.push(`• ${venue}`);
  row(t.date, dateTxt);
  row(t.time, input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : null);
  if (input.party_size && input.party_size > 0) lines.push(`• ${t.people(Math.min(99, Math.round(input.party_size)))}`);
  row(t.name, clean(input.names, 120) || null);
  row(t.occasion, clean(input.occasion, 120) || null);
  row(t.dietary, clean(input.dietary) || null);
  row(t.accessibility, clean(input.accessibility) || null);
  row(t.notes, clean(input.notes, 500) || null);
  row(t.contact, clean(input.contact, 120) || null);
  lines.push("", t.close, t.thanks);
  if (input.sign_iatos) lines.push("", t.signature);
  const call_script = [
    t.call.intro(venue),
    [dateTxt, input.time, input.party_size ? t.people(Math.round(input.party_size)) : null].filter(Boolean).join(" · "),
    t.call.ask,
    t.call.confirm,
  ].filter((l) => l && l.trim());
  return { lang, subject: t.subject(venue, dateTxt), body: lines.join("\n").replace(/\n{3,}/g, "\n\n"), call_script };
}
