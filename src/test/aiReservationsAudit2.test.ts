// Segunda auditoría independiente (grupo reservas) · casos adversariales NUEVOS para AUD-02 y AUD-03.
// Origen: /home/user/audit2/reservas/codigo/src/test/aiReservationsAudit2.test.ts (documentaba el
// comportamiento defectuoso de 7670102). Ronda r2: convertidas en pruebas de REGRESIÓN. Los bloques
// marcados "A2-RES-xx" fallan con el código anterior a la corrección y pasan después.
import { describe, expect, it } from "vitest";
import { bareAddress, htmlToText, senderAuthentication, stripQuotedReply } from "../../supabase/functions/_shared/ai-reservations/core";
import { inboundSenderVerdict } from "../../supabase/functions/_shared/ai-reservations/service";
import { decideReply, parseClassification } from "../../supabase/functions/_shared/ai-reservations/classifier";
import { venueRequestEmail } from "../../supabase/functions/_shared/ai-reservations/templates";

const VENUE = "reservas@casaoaxaca.com.mx";
const ALL = { spf: "pass", dkim: "pass", dmarc: "pass" };
const v = (from: string, auth: unknown, venue = VENUE) => senderAuthentication(from, venue, auth as never);

describe("A2 · AUD-02 · formas del From (RFC 5322, codificación, IDN, mayúsculas, punto final)", () => {
  it("comentario RFC 5322 después de la dirección (forma legítima) → no verificado (falso negativo, seguro)", () => {
    expect(bareAddress("reservas@casaoaxaca.com.mx (Casa Oaxaca)")).toBeNull();
    expect(v("reservas@casaoaxaca.com.mx (Casa Oaxaca)", ALL).verified).toBe(false);
  });
  it("comentario en el nombre visible con la dirección del restaurante y otra dirección real → atacante", () => {
    expect(bareAddress("Casa (reservas@casaoaxaca.com.mx) <atacante@evil.test>")).toBeNull();
    expect(bareAddress('"Casa (reservas@casaoaxaca.com.mx)" <atacante@evil.test>')).toBe("atacante@evil.test");
    expect(v('"Casa (reservas@casaoaxaca.com.mx)" <atacante@evil.test>', ALL).verified).toBe(false);
  });
  it("nombre codificado =?utf-8? con la dirección del restaurante dentro → se ignora el nombre; manda la dirección real", () => {
    expect(v("=?utf-8?Q?reservas=40casaoaxaca.com.mx?= <atacante@evil.test>", ALL).verified).toBe(false);
    expect(v("=?utf-8?B?Q2FzYSBPYXhhY2E=?= <reservas@casaoaxaca.com.mx>", ALL).verified).toBe(true);
  });
  it("IDN: From en Unicode → no se interpreta; From y lugar en punycode iguales → sí; lugar en Unicode → nunca verificable", () => {
    expect(v("reservas@café.mx", ALL, "reservas@café.mx").verified).toBe(false);
    expect(v("reservas@xn--caf-dma.mx", ALL, "reservas@xn--caf-dma.mx").verified).toBe(true);
    expect(v("reservas@xn--caf-dma.mx", ALL, "reservas@café.mx").reasons).toEqual(["venue_email_missing"]);
  });
  it("mayúsculas y punto final en el dominio", () => {
    expect(v("<RESERVAS@CASAOAXACA.COM.MX>", ALL).verified).toBe(true);
    expect(v("reservas@casaoaxaca.com.mx.", ALL).verified).toBe(false); // punto final → no se interpreta (seguro)
  });
});

describe("A2 · AUD-02 · varios From, Sender, discrepancias webhook / descargado / crudo", () => {
  const content = (over: Record<string, unknown>) => ({ from: "Casa <reservas@casaoaxaca.com.mx>", authentication: ALL, ...over });
  it("headers.from con dos encabezados (arreglo) → no verificado", () => {
    expect(inboundSenderVerdict(VENUE, content({ headers: { from: ["reservas@casaoaxaca.com.mx", "atacante@evil.test"] } }), VENUE).verified).toBe(false);
  });
  it("A2-RES-07: headers como lista [{name,value}] o con otra capitalización se cruzan igual con el From", () => {
    const list = inboundSenderVerdict(VENUE, content({ headers: [{ name: "From", value: "atacante@evil.test" }] as never }), VENUE);
    expect(list.verified).toBe(false);
    expect(list.reasons).toContain("header_from_mismatch");
    const upper = inboundSenderVerdict(VENUE, content({ headers: { FROM: "atacante@evil.test" } }), VENUE);
    expect(upper.verified).toBe(false);
    // La forma de lista con el From correcto sí verifica.
    expect(inboundSenderVerdict(VENUE, content({ headers: [{ name: "from", value: "Casa <reservas@casaoaxaca.com.mx>" }] as never }), VENUE).verified).toBe(true);
    expect(inboundSenderVerdict(VENUE, content({ headers: { FROM: "reservas@casaoaxaca.com.mx" } }), VENUE).verified).toBe(true);
  });
  it("A2-RES-07: headers presentes pero ilegibles, sin From o con dos From → no verificado", () => {
    const r = (headers: unknown) => inboundSenderVerdict(VENUE, content({ headers: headers as never }), VENUE);
    expect(r("From: x").reasons).toContain("header_from_unreadable");
    expect(r([{ value: "x" }]).reasons).toContain("header_from_unreadable");
    expect(r({ from: 42 }).reasons).toContain("header_from_unreadable");
    expect(r({ subject: "Re: hola" }).reasons).toContain("header_from_missing");
    expect(r({ from: VENUE, From: "atacante@evil.test" }).reasons).toContain("header_from_multiple");
    expect(r([{ name: "From", value: VENUE }, { name: "FROM", value: VENUE }]).verified).toBe(false);
  });
  it("Sender distinto de From no se considera (DMARC autentica el From) → verificado", () => {
    expect(inboundSenderVerdict(VENUE, content({ headers: { from: VENUE, sender: "atacante@evil.test" } }), VENUE).verified).toBe(true);
  });
  it("From del webhook ≠ From descargado → no; sin From descargado se usa el del webhook (firmado por Svix)", () => {
    expect(inboundSenderVerdict("atacante@evil.test", content({}), VENUE).verified).toBe(false);
    expect(inboundSenderVerdict(VENUE, content({ from: undefined, headers: null }), VENUE).verified).toBe(true);
  });
});

describe("A2 · AUD-02 · valores inesperados en authentication", () => {
  it("mayúsculas/espacios se normalizan", () => {
    expect(v(VENUE, { dmarc: " PASS " }).verified).toBe(true);
    expect(v(VENUE, { dkim: "pass", dmarc: "FAIL" }).verified).toBe(false);
  });
  it("A2-RES-06: un DMARC fuera del enum ('failed', 'permerror', 'reject', 'temperror'…), ausente o no texto → falla cerrada", () => {
    for (const dmarc of ["failed", "permerror", "temperror", "reject", "quarantine", "none", "unknown", "processing_failed", ""]) {
      expect(v(VENUE, { spf: "pass", dkim: "pass", dmarc }).verified, dmarc).toBe(false);
    }
    expect(v(VENUE, { dkim: "pass", dmarc: ["fail"] }).verified).toBe(false);
    expect(v(VENUE, { dkim: "pass", dmarc: { v: "pass" } }).verified).toBe(false);
    expect(v(VENUE, { spf: "pass", dkim: "pass" }).verified).toBe(false); // sin DMARC
    // Control: los dos valores aceptados siguen funcionando con la dirección exacta.
    expect(v(VENUE, { dkim: "pass", dmarc: "gray" }).verified).toBe(true);
    expect(v(VENUE, { dmarc: "pass" }).verified).toBe(true);
  });
  it("authentication como arreglo o texto → no verificado", () => {
    expect(v(VENUE, []).verified).toBe(false);
    expect(v(VENUE, "pass").verified).toBe(false);
  });
});

describe("A2 · AUD-02 · dominios compartidos, subdominios y 'SPF solo'", () => {
  const SHARED = ["live.fr", "wanadoo.fr", "sfr.fr", "yahoo.co.uk", "hotmail.it", "mac.com", "ymail.com", "gmx.net", "web.de",
    "mail.com", "zoho.com", "yandex.ru", "outlook.com.mx", "hotmail.com.mx", "yahoo.com.ar", "infinitummail.com", "terra.com.br", "uol.com.br", "libero.it"];
  it("A2-RES-01 (P1): correo de buzón compartido (antes fuera de la lista FREEMAIL): otra cuenta del mismo proveedor con DMARC pass NO pasa como el restaurante", () => {
    // Un atacante abre su propia cuenta en el mismo proveedor: DMARC pasa legítimamente para su dirección.
    for (const d of SHARED) {
      const r = v(`atacante@${d}`, { spf: "pass", dkim: "pass", dmarc: "pass" }, `restaurante@${d}`);
      expect(r.verified, d).toBe(false);
      // Aunque el lugar declare un sitio web en ese mismo dominio (p. ej. páginas personales del proveedor).
      expect(senderAuthentication(`atacante@${d}`, `restaurante@${d}`, ALL, `https://www.${d}/restaurante`).verified, d).toBe(false);
      // La dirección exacta del restaurante sí verifica.
      expect(v(`restaurante@${d}`, ALL, `restaurante@${d}`).verified, d).toBe(true);
    }
  });
  it("A2-RES-01 (P1): heurística: un dominio que NO está en la lista y no coincide con el sitio oficial se trata como compartido", () => {
    const attacker = (site: string | null) => senderAuthentication("atacante@buzon-nuevo.example", "restaurante@buzon-nuevo.example", ALL, site);
    expect(attacker(null).verified).toBe(false); // sin sitio web
    expect(attacker("https://www.casaoaxaca.com.mx/").verified).toBe(false); // sitio en otro dominio
    expect(attacker(null).reasons).toEqual(["address_not_exact_domain_not_owned"]);
    expect(senderAuthentication("restaurante@buzon-nuevo.example", "restaurante@buzon-nuevo.example", ALL, null).verified).toBe(true);
  });
  it("A2-RES-01 (P1): dominio PROPIO (= sitio oficial): otro buzón o un subdominio del restaurante con DMARC pass sí verifica", () => {
    const site = "https://www.casaoaxaca.com.mx/menu";
    expect(senderAuthentication("maria@casaoaxaca.com.mx", VENUE, ALL, site).verified).toBe(true);
    expect(senderAuthentication("x@mail.casaoaxaca.com.mx", VENUE, ALL, site).verified).toBe(true);
    expect(senderAuthentication("x@mail.casaoaxaca.com.mx", VENUE, ALL, site).venue_owns_domain).toBe(true);
    // Sin DMARC pass, otro buzón no basta aunque el dominio sea propio.
    expect(senderAuthentication("maria@casaoaxaca.com.mx", VENUE, { spf: "pass", dkim: "pass", dmarc: "gray" }, site).verified).toBe(false);
    // El sitio oficial en http, con credenciales o en otro dominio no cuenta como propio.
    for (const bad of ["http://casaoaxaca.com.mx/", "https://user@casaoaxaca.com.mx/", "https://casaoaxaca.mx/", "https://casaoaxaca.com.mx.evil.test/", "https://sites.google.com/view/casaoaxaca"]) {
      expect(senderAuthentication("maria@casaoaxaca.com.mx", VENUE, ALL, bad).verified, bad).toBe(false);
    }
  });
  it("gmail.com (sí está en la lista): otra cuenta de gmail con DMARC pass → no", () => {
    expect(v("atacante@gmail.com", ALL, "casaoaxaca@gmail.com").verified).toBe(false);
    expect(v("casa.oaxaca@gmail.com", ALL, "casaoaxaca@gmail.com").verified).toBe(false); // mismo buzón para Gmail: falso negativo
  });
  it("A2-RES-04 (riesgo P2, reducido): subdominio y otro buzón con DMARC pass solo cuentan si el dominio es propio (= sitio oficial)", () => {
    expect(v("cualquiera@tienda.casaoaxaca.com.mx", { spf: "pass", dkim: "gray", dmarc: "pass" }).verified).toBe(false);
    expect(v("x@a.b.c.casaoaxaca.com.mx", { dmarc: "pass" }).verified).toBe(false);
    const site = "https://casaoaxaca.com.mx/";
    expect(senderAuthentication("cualquiera@tienda.casaoaxaca.com.mx", VENUE, { spf: "pass", dkim: "gray", dmarc: "pass" }, site).verified).toBe(true);
  });
  it("A2-RES-04 (riesgo P2, reducido): DMARC pass solo por SPF alineado ya no basta para OTRO buzón sin dominio propio", () => {
    expect(v("otro@casaoaxaca.com.mx", { spf: "pass", dkim: "fail", dmarc: "pass" }).verified).toBe(false);
    expect(v(VENUE, { spf: "pass", dkim: "gray", dmarc: "gray" }).verified).toBe(false); // SPF solo sin DMARC: sí se rechaza
  });
});

// ───────────────────────────── AUD-03 ─────────────────────────────
const row = {
  requested_local: "2026-11-03T20:30", party_size: 4, customer_name: "Ana López", ref_code: "R-ABC234",
  venue_timezone: "America/Mexico_City", venue_language: "es" as const, venue_name: "Casa Oaxaca",
};
const RECEIVED = "2026-11-02T18:00:00Z";
const NULLS = { stated_date: null, stated_time: null, stated_party_size: null, stated_name: null };
const lie = (quote: string, over: Record<string, unknown> = {}) => parseClassification({
  outcome: "confirmed", automatic_reply: false, booking_held: true, stated_date: "2026-11-03", stated_time: "20:30",
  stated_party_size: 4, stated_name: "Ana López", confirmation_code: null, alternatives: [], info_requested: null,
  requires_payment_or_card: false, evidence_quotes: [quote], reply_language: "es", summary_es: "El restaurante confirmó.", ...over,
})!;
const quoted = (lang: "es" | "en" | "fr" = "es") => {
  const mail = venueRequestEmail({ ...row, venue_language: lang, customer_email: null, customer_phone: null, notes: null, consent: null } as never);
  return `\n\nEl lun, 2 nov 2026 a las 10:02, Ana López vía IATOS <reservas@traveliatos.life> escribió:\n${mail.text.split("\n").map((l) => `> ${l}`).join("\n")}`;
};
/** Respuesta en nuestro hilo (token) que cita nuestra solicitud sin cambios; el modelo miente y no "afirma" datos (nulls). */
const inThread = (reply: string, quote = reply, over: Record<string, unknown> = {}) =>
  decideReply(row as never, lie(quote, { ...NULLS, ...over }), {
    replyText: reply, fullText: reply + quoted(), verifiedSender: true, fromDomain: "casaoaxaca.com.mx", inboundEmailId: "em_x",
    linkage: "reply_token", receivedAt: RECEIVED,
  } as never);
const plain = (reply: string, over: Record<string, unknown> = {}) =>
  decideReply(row as never, lie(reply, over), {
    replyText: reply, fullText: reply, verifiedSender: true, fromDomain: "casaoaxaca.com.mx", inboundEmailId: "em_x", linkage: "reply_token", receivedAt: RECEIVED,
  } as never);

describe("A2 · AUD-03 · casos pedidos", () => {
  it("'Confirmado... ¿podría confirmar la hora?' → ambiguous", () => {
    expect(inThread("Confirmado... ¿podría confirmar la hora?").outcome).toBe("ambiguous");
  });
  it("otra fecha en otro formato (dd/mm vs mm/dd): '22/10' y '10/22' para el 22-oct se aceptan; A2-RES-09: '3/11' (11-mar en EE. UU.) ya NO se toma como 3-nov", () => {
    const r22 = { ...row, requested_local: "2026-10-22T20:30" };
    const d = (t: string) => decideReply(r22 as never, lie(t, { stated_date: null, stated_name: null }), { replyText: t, fullText: t, verifiedSender: true, fromDomain: "x", inboundEmailId: "e", linkage: "reply_token", receivedAt: "2026-10-20T18:00:00Z" } as never);
    expect(d("Confirmamos su reserva para 4 personas el 22/10 a las 20:30.").outcome).toBe("confirmed");
    expect(d("Confirmamos su reserva para 4 personas el 10/22 a las 20:30.").outcome).toBe("confirmed");
    const amb = plain("Confirmed: your table for 4 guests on 3/11 at 8:30 pm.", { stated_date: null, stated_name: null });
    expect(amb.outcome).toBe("ambiguous");
    expect(amb.why).toBe("conditions_not_confirmed:date");
  });
  it("'mañana' resuelto en la zona del lugar; sin fecha de recepción → no se resuelve → ambiguous", () => {
    expect(plain("Confirmamos su reserva para mañana a las 20:30 para 4 personas.", { stated_name: null, stated_date: null }).outcome).toBe("confirmed");
    const d = decideReply(row as never, lie("Confirmamos su reserva para mañana a las 20:30 para 4 personas.", { stated_name: null, stated_date: null }),
      { replyText: "Confirmamos su reserva para mañana a las 20:30 para 4 personas.", verifiedSender: true, fromDomain: "x", inboundEmailId: "e", linkage: "reply_token", receivedAt: null } as never);
    expect(d.outcome).toBe("ambiguous");
  });
  it("personas en letra: 'cuatro' se entiende; 'dos' contradice", () => {
    expect(plain("Confirmamos su reserva para cuatro personas el 3 de noviembre a las 20:30.", { stated_name: null }).outcome).toBe("confirmed");
    expect(plain("Confirmamos su reserva para dos personas el 3 de noviembre a las 20:30.", { stated_name: null, stated_party_size: null }).outcome).toBe("ambiguous");
  });
  it("A2-RES-03 (P2): personas en letra > 12 ('quince') u horas en palabras o sin am/pm ('a las nueve', 'para las 9') se leen: en nuestro hilo NO heredan los datos de la solicitud citada", () => {
    const q = inThread("Confirmado, mesa para quince personas.");
    expect(q.outcome).toBe("ambiguous");
    expect(q.why).toBe("party_size_mismatch");
    for (const t of ["Confirmado, los esperamos a las nueve.", "Confirmado para las 9.", "Confirmed, see you at 9.", "Confirmé, nous vous attendons à neuf heures.", "Confirmado, esperamos vocês às nove."]) {
      const d = inThread(t);
      expect(d.outcome, t).toBe("ambiguous");
      expect(d.why, t).toBe("time_mismatch");
    }
    for (const t of ["Confirmado, mesa para veinte personas.", "Confirmed: table for fifteen guests.", "Confirmado, mesa para dezesseis pessoas."]) {
      expect(inThread(t).outcome, t).toBe("ambiguous");
    }
    // Número sin explicar con la cita del hilo como base → no se confirma.
    const n = inThread("Confirmado, serán 15.");
    expect(n.outcome).toBe("ambiguous");
    expect(n.why).toBe("unexplained_numbers");
    // Controles: lo que coincide con la solicitud sigue confirmando.
    expect(inThread("Confirmado, los esperamos a las ocho y media de la noche.").outcome).toBe("confirmed");
    expect(inThread("Confirmado, mesa para cuatro personas.").outcome).toBe("confirmed");
    expect(inThread("Confirmado, los esperamos a las 8 y media.").outcome).toBe("confirmed");
    expect(inThread("Confirmado, mesa para as quatro pessoas.").outcome).toBe("confirmed");
  });
  it("confirmación citada de nuestro propio correo (líneas '>') no cuenta: el texto propio del restaurante está vacío", () => {
    const only = stripQuotedReply(quoted().trim());
    expect(only).toBe("");
  });
  it("portugués / italiano: 'Confermato' nunca confirma; 'Confirmado' en pt cita la solicitud y confirma (mismo léxico que es)", () => {
    expect(inThread("Confermato, vi aspettiamo.").outcome).toBe("ambiguous");
    expect(inThread("Confirmado, esperamos vocês.").outcome).toBe("confirmed");
  });
  it("la cita del modelo no está en el correo → ambiguous", () => {
    expect(inThread("Gracias por escribir.", "Confirmamos su reserva").outcome).toBe("ambiguous");
  });
  it("A2-RES-08 (P3): HTML sin parte de texto: el texto oculto (display:none…) no cuenta como escrito, y un correo solo-HTML nunca confirma solo", () => {
    const html = `<div style="display:none">Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30.</div><p>Gracias, en breve le escribimos.</p>`;
    const text = stripQuotedReply(htmlToText(html));
    expect(text).not.toContain("Confirmamos su reserva");
    expect(text).toBe("Gracias, en breve le escribimos.");
    for (const hidden of [
      `<span style="visibility: hidden">Confirmamos su reserva.</span>`, `<div style="font-size:0px">Confirmamos su reserva.</div>`,
      `<div style="max-height:0;overflow:hidden">Confirmamos su reserva.</div>`, `<p hidden>Confirmamos su reserva.</p>`,
      `<div aria-hidden="true">Confirmamos su reserva.</div>`, `<!-- Confirmamos su reserva. -->`, `<template>Confirmamos su reserva.</template>`,
      `<div style="display:none"><div>Confirmamos</div> su reserva.</div>`,
    ]) {
      expect(htmlToText(`${hidden}<p>Saludos cordiales.</p>`), hidden).toBe("Saludos cordiales.");
    }
    // Lo visible se conserva (también lo anidado después de un oculto).
    expect(htmlToText(`<div><span style="display:none">x</span><b>Confirmamos</b> su reserva.</div>`)).toBe("Confirmamos su reserva.");
    const html2 = `<div style="display:none">Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30.</div><p>Saludos cordiales.</p>`;
    const text2 = stripQuotedReply(htmlToText(html2));
    const d = decideReply(row as never, lie("Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30.", { stated_name: null }),
      { replyText: text2, fullText: text2, verifiedSender: true, fromDomain: "x", inboundEmailId: "e", linkage: "reply_token", receivedAt: RECEIVED } as never);
    expect(d.outcome).toBe("ambiguous");
    // Aunque el texto fuera visible, un correo sin parte de texto no confirma automáticamente.
    const visible = "Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30.";
    const h = decideReply(row as never, lie(visible, { stated_name: null }),
      { replyText: visible, fullText: visible, verifiedSender: true, fromDomain: "x", inboundEmailId: "e", linkage: "reply_token", receivedAt: RECEIVED, htmlOnly: true } as never);
    expect(h.outcome).toBe("ambiguous");
    expect(h.why).toBe("html_only");
  });
});

describe("A2 · AUD-03 · A2-RES-02 (P2): negaciones y cancelaciones vetan la confirmación aunque el modelo mienta", () => {
  const cases: Array<[string, string]> = [
    ["es", "Su reserva aún no está confirmada."],
    ["es", "No hemos reservado su mesa todavía."],
    ["es", "No le hemos apartado la mesa."],
    ["es", "Su reserva confirmada fue cancelada."],
    ["en", "Your reservation is not confirmed yet."],
    ["en", "We have not confirmed your booking."],
    ["en", "Your confirmed booking has been cancelled."],
    ["pt", "Sua reserva não está confirmada."],
    ["pt", "Não confirmamos a reserva."],
    ["fr", "Votre réservation n'est pas encore confirmée."],
    ["fr", "Nous n'avons pas réservé votre table."],
    ["fr", "Votre réservation confirmée a été annulée."],
    ["pt", "A sua reserva confirmada foi cancelada."],
    ["en", "We haven't booked your table yet."],
    ["es", "Lamentamos informarle que su reserva confirmada queda cancelada."],
  ];
  for (const [lang, text] of cases) {
    it(`[${lang}] "${text}" en nuestro hilo → ambiguous (nunca confirmed)`, () => {
      const d = inThread(text);
      expect(d.outcome).toBe("ambiguous");
      expect(d.confirmation).toBeUndefined();
      expect(String(d.why)).toMatch(/hedge_(negated_confirmation|cancellation|unfortunately|negation)/);
    });
  }
  it("la cita no puede ser una subcadena que recorta la negación ('está confirmada' de 'no está confirmada')", () => {
    expect(inThread("Todavía no está confirmada.", "está confirmada").outcome).toBe("ambiguous");
    expect(inThread("Su reserva está inconfirmada.", "confirmada").outcome).toBe("ambiguous");
  });
  it("controles: confirmaciones reales con cortesías de cancelación o 'no dude' siguen confirmando", () => {
    expect(inThread("Confirmado. No dude en escribirnos si tiene alguna duda.").outcome).toBe("confirmed");
    expect(inThread("Confirmado. Si necesita cancelar, avísenos con 24 horas de anticipación.").outcome).toBe("confirmed");
    expect(inThread("Confirmado. Si necesita cancelar, avísenos con anticipación.").outcome).toBe("confirmed");
    expect(inThread("Confirmed. Our cancellation policy applies.").outcome).toBe("confirmed");
    expect(inThread("Confirmado, sin problema.").outcome).toBe("confirmed");
  });
  it("control: las negaciones que SÍ están en el léxico se frenan", () => {
    expect(inThread("No tenemos lugar, confirmado.").outcome).toBe("ambiguous");
    expect(inThread("Votre réservation n'est pas confirmée.").outcome).toBe("ambiguous");
  });
});

describe("A2 · correo 'revísalo tú' al usuario con texto de un remitente NO verificado", () => {
  it("A2-RES-13 (P3): el extracto ya no conserva enlaces del atacante (se neutralizan como [enlace])", async () => {
    const { redactExcerpt } = await import("../../supabase/functions/_shared/ai-reservations/core");
    const { userUpdateEmail } = await import("../../supabase/functions/_shared/ai-reservations/templates");
    const ex = redactExcerpt("Confirmado. Para garantizar su mesa pague aquí: https://pago-casaoaxaca.evil.test/r/ABC");
    const mail = userUpdateEmail("unverified", { venue_name: "Casa Oaxaca", requested_local: "2026-11-03T20:30", ref_code: "R-ABC234", excerpt: ex, appUrl: "https://x.test" });
    expect(mail.text).not.toContain("pago-casaoaxaca.evil.test");
    expect(mail.html).not.toContain("pago-casaoaxaca.evil.test");
    expect(mail.text).toContain("[enlace]");
    expect(mail.text).toContain("no pudimos verificar");
    for (const u of ["http://evil.test/x", "HTTPS://EVIL.TEST/Pago", "www.evil.test", "pago.evil.test/r/1?x=2", "ftp://evil.test/a"]) {
      expect(redactExcerpt(`pague en ${u} hoy`), u).toBe("pague en [enlace] hoy");
    }
    // Lo demás del extracto no cambia (horas, fechas, puntos finales).
    expect(redactExcerpt("Confirmado para el 3.11 a las 20.30. Gracias.")).toBe("Confirmado para el 3.11 a las 20.30. Gracias.");
  });
});
